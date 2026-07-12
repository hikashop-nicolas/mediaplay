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

const LOOKAHEAD = 0.6; // seconds of audio to schedule ahead of the video clock
const sleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export interface SyncedAudioHandle {
  destroy(): void;
}

class SyncedAudio {
  private readonly ctx: AudioContext;
  private readonly sink: AudioBufferSink;
  private token = 0;
  private readonly active = new Set<AudioBufferSourceNode>();
  private disposed = false;
  private readonly listeners: [string, EventListener][] = [];
  private readonly cleanups: (() => void)[] = [];
  private restartTimer = 0;
  private currentIter: ReturnType<AudioBufferSink["buffers"]> | null = null;

  constructor(
    private readonly video: HTMLMediaElement,
    track: InputAudioTrack,
  ) {
    this.ctx = new AudioContext();
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
    try {
      for await (const { buffer, timestamp, duration } of iter) {
        // Backpressure: hold until the video clock is within LOOKAHEAD of this buffer
        // (or we've been superseded / paused).
        while ((this.video.paused || timestamp > this.video.currentTime + LOOKAHEAD) && token === this.token && !this.disposed) {
          await sleep(40);
        }
        if (token !== this.token || this.disposed) return;

        const rate = this.video.playbackRate || 1;
        const now = this.ctx.currentTime;
        let when = now + (timestamp - this.video.currentTime) / rate;
        let offset = 0;
        if (when < now) {
          // This buffer is already (partly) in the past relative to the clock.
          offset = (now - when) * rate;
          when = now;
        }
        if (offset >= duration) continue; // fully in the past, skip it

        const node = this.ctx.createBufferSource();
        node.buffer = buffer;
        node.playbackRate.value = rate;
        node.connect(this.ctx.destination);
        node.onended = () => this.active.delete(node);
        try {
          node.start(when, offset);
        } catch {
          continue;
        }
        this.active.add(node);
        if (++scheduled === 1) console.info(`[mediaplay:audio] scheduling (ctx=${this.ctx.state}, @${timestamp.toFixed(2)}s)`);
      }
    } catch (e) {
      console.warn("[mediaplay:audio] scheduling stopped:", e);
    }
  }

  destroy(): void {
    this.disposed = true;
    this.token++;
    window.clearTimeout(this.restartTimer);
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
export async function playSyncedAudio(
  video: HTMLMediaElement,
  bytes: Uint8Array,
  audioIndex: number,
  base: string,
): Promise<SyncedAudioHandle | "undecodable" | null> {
  setLibavBase(base);
  registerAc3Decoder();
  try {
    // Pass the view directly (no copy): the file can be very large.
    const input = new Input({ source: new BufferSource(bytes), formats: ALL_FORMATS });
    const tracks = await input.getTracks();
    const audioTracks = tracks.filter((t) => t.isAudioTrack());
    const track = audioTracks[audioIndex] ?? audioTracks[0];
    if (!track) return null;
    console.info(`[mediaplay:audio] track ${audioIndex} codec=${track.codec}; probing decode...`);
    // Probe: pull the first decoded buffer. If the decoder can't handle it, this rejects.
    const probe = new AudioBufferSink(track);
    const firstIter = probe.buffers(0)[Symbol.asyncIterator]();
    const first = await firstIter.next();
    void firstIter.return?.();
    if (first.done || !first.value) {
      console.warn("[mediaplay:audio] probe produced no buffer");
      return "undecodable";
    }
    console.info(`[mediaplay:audio] probe ok (first buffer @${first.value.timestamp.toFixed(2)}s); starting sync engine`);
    const engine = new SyncedAudio(video, track);
    engine.start();
    return { destroy: () => engine.destroy() };
  } catch (e) {
    console.warn("[mediaplay:audio] playSyncedAudio failed:", e);
    return "undecodable";
  }
}
