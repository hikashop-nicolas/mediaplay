// Plays an audio track the browser can't decode, in sync with a (muted) video element.
//
// mediabunny demuxes and, via our registered libav CustomAudioDecoder, decodes the
// track to AudioBuffers on demand. This engine schedules those buffers on a Web Audio
// AudioContext against the video's own clock (the video stays the timing master), and
// keeps them aligned through play, pause, seek and rate changes. Each buffer is placed
// relative to the LIVE video.currentTime, so the stream is self-correcting: any small
// offset introduced by a transition is absorbed within a few (32 ms) buffers.

import { Input, ALL_FORMATS, BufferSource, AudioBufferSink, type InputAudioTrack } from "mediabunny";
import { setLibavBase, registerAc3Decoder } from "./libav-decoder";

const LOOKAHEAD = 1.5; // seconds of audio to keep scheduled ahead (survives main-thread stalls)
const LEAD_IN = 0.05; // small audio-clock headroom at anchor (also the residual A/V offset)
// Re-anchor only on a LARGE desync (a real problem), not momentary video hitches. When
// the video stutters (e.g. a busy main thread), re-anchoring would gap the audio; instead
// let it keep playing from its buffer and re-align as the video recovers.
const DRIFT_MAX = 1.0;
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export interface SyncedAudioHandle {
  destroy(): void;
}

class SyncedAudio {
  private readonly ctx: AudioContext;
  private readonly sink: AudioBufferSink;
  private readonly gain: GainNode; // master output (buffer sources -> gain -> analyser -> speakers)
  private readonly analyser: AnalyserNode;
  private token = 0;
  private readonly active = new Set<AudioBufferSourceNode>();
  private disposed = false;
  private readonly listeners: [string, EventListener][] = [];
  private readonly cleanups: (() => void)[] = [];
  private restartTimer = 0;
  private pauseTimer = 0;
  private currentIter: ReturnType<AudioBufferSink["buffers"]> | null = null;
  private reseeks = 0;
  // Until the first user gesture the video stays force-muted (that's what let it
  // autoplay), so video.muted can't be honored yet; after the gesture unmutes it, the
  // element's muted/volume drive the gain natively (M key, arrows, the controls' slider).
  private muteSynced = false;

  constructor(
    private readonly video: HTMLMediaElement,
    track: InputAudioTrack,
  ) {
    this.ctx = new AudioContext();
    this.gain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.gain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    // Test hook: lets an instrumented page (demo/gaptest) attach an analyzer to the graph.
    (globalThis as { __mediaplayDebugTap?: (ctx: AudioContext, gain: GainNode) => void }).__mediaplayDebugTap?.(this.ctx, this.gain);
    this.sink = new AudioBufferSink(track);
    const on = (ev: string, fn: EventListener) => {
      this.video.addEventListener(ev, fn);
      this.listeners.push([ev, fn]);
    };
    // Suspending the context on pause freezes scheduled audio in place, aligned with
    // the paused video; resuming continues both together.
    on("play", () => {
      // A stuttering video (big file) fires rapid pause/play; do NOT restart the pipeline
      // here (that would gap the audio every hitch). Just cancel a pending suspend and
      // keep playing; the drift check re-aligns if the stutter caused real desync.
      window.clearTimeout(this.pauseTimer);
      void this.ctx.resume();
    });
    on("pause", () => {
      // Debounce: only suspend on a sustained pause, so momentary stalls don't chop audio.
      window.clearTimeout(this.pauseTimer);
      this.pauseTimer = window.setTimeout(() => {
        if (this.video.paused) void this.ctx.suspend();
      }, 300);
    });
    // A seek invalidates everything queued; drop it and re-decode from the new point.
    on("seeking", () => {
      this.stopActive();
      this.token++;
    });
    on("seeked", () => this.restart());
    on("ratechange", () => this.restart());
    // Volume / mute: mirror the video element's state onto the decoded-audio gain, so
    // the player's M / arrow keys and the native controls' volume slider all work.
    on("volumechange", () => this.applyVolume());
    this.applyVolume();

    // The context is created after async work (demux/probe), so it's outside the
    // original user gesture and starts "suspended"; browsers then block resume() until
    // the next interaction. Resume on any gesture until it's actually running. The same
    // first gesture also lifts the autoplay force-mute on the video element (its native
    // track is silent anyway), after which muted/volume are honored natively.
    const tryResume = () => {
      void this.ctx.resume();
      if (!this.muteSynced && !this.disposed) {
        this.muteSynced = true;
        this.video.muted = false;
        this.applyVolume();
      }
      if (this.ctx.state === "running" || this.disposed) removeGesture();
    };
    const gestures = ["pointerdown", "keydown", "touchstart"];
    const removeGesture = () => gestures.forEach((ev) => document.removeEventListener(ev, tryResume));
    gestures.forEach((ev) => document.addEventListener(ev, tryResume, { passive: true }));
    this.cleanups.push(removeGesture);
  }

  /** Decoded-audio gain follows the video element's volume (and, once the autoplay
   *  force-mute has been lifted, its muted flag). */
  private applyVolume(): void {
    this.gain.gain.value = this.muteSynced && this.video.muted ? 0 : this.video.volume;
  }

  start(): void {
    this.restart();
  }

  /** Stop the current run and (debounced) start a fresh one at the live position. A
   *  scrub fires many seek events; coalescing them avoids spinning up a decode pipeline
   *  per event. */
  private restart(): void {
    if (this.disposed) return;
    this.token++; // invalidate the running loop immediately (stops scheduling)
    this.stopActive();
    window.clearTimeout(this.restartTimer);
    this.restartTimer = window.setTimeout(() => void this.launch(), 120);
  }

  /** Single-flight decode: close the previous iterator (freeing its decoder in the libav
   *  worker) before opening a new one, so decoders never pile up and OOM the worker. */
  private async launch(): Promise<void> {
    if (this.disposed) return;
    const myToken = ++this.token;
    const prev = this.currentIter;
    this.currentIter = null;
    if (prev) {
      try {
        await prev.return();
      } catch {
        /* iterator already finished */
      }
    }
    if (myToken !== this.token || this.disposed) return; // superseded while closing
    const iter = this.sink.buffers(this.video.currentTime);
    this.currentIter = iter;
    await this.run(myToken, iter);
  }

  private stopActive(): void {
    for (const n of this.active) {
      try {
        n.stop();
        n.disconnect();
      } catch {
        /* already stopped */
      }
    }
    this.active.clear();
  }

  private async run(token: number, iter: ReturnType<AudioBufferSink["buffers"]>): Promise<void> {
    if (this.ctx.state === "suspended" && !this.video.paused) {
      try {
        await this.ctx.resume();
      } catch {
        /* needs a user gesture; the next play/gesture will resume */
      }
    }
    let scheduled = 0;
    // Anchor mapping media-time <-> audio-clock time, fixed for this run so buffers are
    // laid down contiguously (gapless). The video clock is used only to establish the
    // anchor and to detect drift; per-buffer live-clock scheduling made the audio jitter.
    let anchorCtx = 0;
    let anchorMedia = 0;
    let nextWhen = 0; // running audio-clock cursor: the next buffer starts exactly here
    let anchored = false;
    try {
      for await (const { buffer, timestamp, duration } of iter) {
        if (token !== this.token || this.disposed) return;
        // Cold start: the first decoded buffer can arrive late, by which point the video
        // has run ahead. Re-seek the now-warm decoder to the live position rather than
        // decode-and-skip hundreds of stale buffers. Guarded + capped so it can't loop.
        if (!anchored && this.reseeks < 3 && !this.video.paused && this.video.currentTime - timestamp > 2) {
          this.reseeks++;
          this.restart();
          return;
        }
        // Drop buffers before the live position (from a coarse seek) until we anchor.
        if (!anchored && timestamp < this.video.currentTime - 0.1) continue;

        const rate = this.video.playbackRate || 1;
        if (!anchored) {
          // Anchor: the live video position plays now (+ a small lead), so audio stays in
          // sync. From here buffers are laid down back-to-back from the nextWhen cursor -
          // sample-accurate, so there is no gap or overlap (and no click) between them.
          anchorCtx = this.ctx.currentTime + LEAD_IN;
          anchorMedia = this.video.currentTime;
          nextWhen = anchorCtx;
          anchored = true;
        }

        // Backpressure: keep at most LOOKAHEAD of audio scheduled ahead of the clock.
        while (nextWhen > this.ctx.currentTime + LOOKAHEAD && token === this.token && !this.disposed) {
          await sleep(80);
        }
        if (token !== this.token || this.disposed) return;

        // Drift: re-anchor only on a large desync (the two clocks tick slightly
        // differently over time); momentary video stutters are tolerated so audio is smooth.
        if (!this.video.paused && this.ctx.state === "running") {
          const audioMediaNow = anchorMedia + (this.ctx.currentTime - anchorCtx) * rate;
          if (Math.abs(audioMediaNow - this.video.currentTime) > DRIFT_MAX) {
            this.restart();
            return;
          }
        }

        // If the cursor fell behind the clock (decode starved, rare), snap it up to now
        // instead of scheduling in the past. Otherwise buffers abut exactly.
        if (nextWhen < this.ctx.currentTime) nextWhen = this.ctx.currentTime;

        const node = this.ctx.createBufferSource();
        node.buffer = buffer;
        node.playbackRate.value = rate;
        node.connect(this.gain);
        node.onended = () => this.active.delete(node);
        try {
          node.start(nextWhen);
        } catch {
          continue;
        }
        nextWhen += duration / rate;
        this.active.add(node);
        if (++scheduled === 1) this.reseeks = 0;
      }
    } catch (e) {
      console.warn("[mediaplay:audio] scheduling stopped:", e);
    }
  }

  destroy(): void {
    this.disposed = true;
    this.token++;
    window.clearTimeout(this.restartTimer);
    window.clearTimeout(this.pauseTimer);
    void this.currentIter?.return();
    this.currentIter = null;
    this.stopActive();
    for (const [ev, fn] of this.listeners) this.video.removeEventListener(ev, fn);
    this.listeners.length = 0;
    for (const fn of this.cleanups) fn();
    this.cleanups.length = 0;
    try {
      void this.ctx.close();
    } catch {
      /* already closed */
    }
  }
}

/**
 * Start playing `bytes`' audio track number `audioIndex` (index into the file's audio
 * tracks) in sync with `video`, decoding it with the libav AC-3/E-AC-3 decoder served
 * from `base`. The caller should mute `video` first. Returns a handle, or "undecodable"
 * if the track can't be decoded, or null if there's no such track.
 */
// Only one decoded-audio stream exists at a time. This is semantically right (you can't
// watch two videos at once) and defends against a host mounting the player more than once
// (e.g. a double-open race): a stale engine would otherwise keep its own AudioContext and
// decoder alive, overlapping audio and starving the decoder.
let currentEngine: SyncedAudio | null = null;
function stopCurrentEngine(): void {
  currentEngine?.destroy();
  currentEngine = null;
}

export async function playSyncedAudio(
  video: HTMLMediaElement,
  bytes: Uint8Array,
  audioIndex: number,
  base: string,
): Promise<SyncedAudioHandle | "undecodable" | null> {
  setLibavBase(base);
  registerAc3Decoder();
  // Tear down any previous stream up front, so two concurrent starts can't both run.
  stopCurrentEngine();
  try {
    // Pass the view directly (no copy): the file can be very large.
    const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
    const tracks = await input.getTracks();
    const audioTracks = tracks.filter((t) => t.isAudioTrack());
    const track = audioTracks[audioIndex] ?? audioTracks[0];
    if (!track) return null;
    // A newer start may have happened while we awaited getTracks; it wins.
    stopCurrentEngine();
    const engine = new SyncedAudio(video, track);
    currentEngine = engine;
    engine.start();
    return {
      destroy: () => {
        engine.destroy();
        if (currentEngine === engine) currentEngine = null;
      },
    };
  } catch (e) {
    console.warn("[mediaplay:audio] playSyncedAudio failed:", e);
    return "undecodable";
  }
}
