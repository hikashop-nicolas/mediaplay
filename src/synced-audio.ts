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
  private levelTimer = 0;
  private currentIter: ReturnType<AudioBufferSink["buffers"]> | null = null;
  private reseeks = 0;

  constructor(
    private readonly video: HTMLMediaElement,
    track: InputAudioTrack,
  ) {
    this.ctx = new AudioContext();
    this.gain = this.ctx.createGain();
    this.analyser = this.ctx.createAnalyser();
    this.gain.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    // Signal meter: report the actual output level so we can tell "flowing" from "silent".
    const buf = new Float32Array(this.analyser.fftSize);
    this.levelTimer = window.setInterval(() => {
      this.analyser.getFloatTimeDomainData(buf);
      let peak = 0;
      for (const v of buf) peak = Math.max(peak, Math.abs(v));
      console.info(`[mediaplay:audio] output level peak=${peak.toFixed(4)} (ctx=${this.ctx.state}, nodes=${this.active.size})`);
    }, 2000);
    this.sink = new AudioBufferSink(track);
    const on = (ev: string, fn: EventListener) => {
      this.video.addEventListener(ev, fn);
      this.listeners.push([ev, fn]);
    };
    // Suspending the context on pause freezes scheduled audio in place, aligned with
    // the paused video; resuming continues both together.
    on("play", () => {
      console.info(`[mediaplay:audio] video play @${this.video.currentTime.toFixed(2)}`);
      void this.ctx.resume();
      this.restart();
    });
    on("pause", () => {
      console.info(`[mediaplay:audio] video pause @${this.video.currentTime.toFixed(2)}`);
      void this.ctx.suspend();
    });
    // A seek invalidates everything queued; drop it and re-decode from the new point.
    on("seeking", () => {
      this.stopActive();
      this.token++;
    });
    on("seeked", () => this.restart());
    on("ratechange", () => this.restart());

    // The context is created after async work (demux/probe), so it's outside the
    // original user gesture and starts "suspended"; browsers then block resume() until
    // the next interaction. Resume on any gesture until it's actually running.
    const tryResume = () => {
      void this.ctx.resume();
      if (this.ctx.state === "running" || this.disposed) removeGesture();
    };
    const gestures = ["pointerdown", "keydown", "touchstart"];
    const removeGesture = () => gestures.forEach((ev) => document.removeEventListener(ev, tryResume));
    gestures.forEach((ev) => document.addEventListener(ev, tryResume, { passive: true }));
    this.cleanups.push(removeGesture);
    console.info(`[mediaplay:audio] AudioContext state=${this.ctx.state}, sampleRate=${this.ctx.sampleRate}`);
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
          // Map so media-time = the live video position plays now (+ a small lead), i.e.
          // audio stays in sync with the video rather than lagging by the buffer offset.
          anchorCtx = this.ctx.currentTime + LEAD_IN;
          anchorMedia = this.video.currentTime;
          anchored = true;
        }
        const when = anchorCtx + (timestamp - anchorMedia) / rate;

        // Backpressure: keep at most LOOKAHEAD scheduled ahead of the audio clock.
        while (when > this.ctx.currentTime + LOOKAHEAD && token === this.token && !this.disposed) {
          await sleep(80);
        }
        if (token !== this.token || this.disposed) return;

        // Drift: if the audio's media position has slipped from the video clock (the two
        // clocks tick slightly differently, or a pause/resume nudged them), re-anchor.
        if (!this.video.paused && this.ctx.state === "running") {
          const audioMediaNow = anchorMedia + (this.ctx.currentTime - anchorCtx) * rate;
          if (Math.abs(audioMediaNow - this.video.currentTime) > DRIFT_MAX) {
            this.restart();
            return;
          }
        }
        if (when < this.ctx.currentTime - duration) continue; // wholly in the past, skip

        const node = this.ctx.createBufferSource();
        node.buffer = buffer;
        node.playbackRate.value = rate;
        node.connect(this.gain);
        node.onended = () => this.active.delete(node);
        try {
          node.start(Math.max(when, this.ctx.currentTime));
        } catch {
          continue;
        }
        this.active.add(node);
        if (++scheduled === 1) {
          this.reseeks = 0;
          console.info(`[mediaplay:audio] scheduling (ctx=${this.ctx.state}, @${timestamp.toFixed(2)}s, vt=${this.video.currentTime.toFixed(2)})`);
        }
      }
    } catch (e) {
      console.warn("[mediaplay:audio] scheduling stopped:", e);
    }
  }

  destroy(): void {
    this.disposed = true;
    this.token++;
    window.clearTimeout(this.restartTimer);
    window.clearInterval(this.levelTimer);
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
    console.info(`[mediaplay:audio] track ${audioIndex} codec=${track.codec}; starting sync engine`);
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
