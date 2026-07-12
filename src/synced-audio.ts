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
      void this.ctx.resume();
      this.restart();
    });
    on("pause", () => void this.ctx.suspend());
    // A seek invalidates everything queued; drop it and re-decode from the new point.
    on("seeking", () => {
      this.stopActive();
      this.token++;
    });
    on("seeked", () => this.restart());
    on("ratechange", () => this.restart());
  }

  start(): void {
    this.restart();
  }

  private restart(): void {
    if (this.disposed) return;
    this.token++;
    void this.run(this.token, this.video.currentTime);
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

  private async run(token: number, fromTime: number): Promise<void> {
    if (this.ctx.state === "suspended" && !this.video.paused) {
      try {
        await this.ctx.resume();
      } catch {
        /* needs a user gesture; the next play will resume */
      }
    }
    try {
      for await (const { buffer, timestamp, duration } of this.sink.buffers(fromTime)) {
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
      }
    } catch {
      // Decode error / end of stream: stop scheduling for this run.
    }
  }

  destroy(): void {
    this.disposed = true;
    this.token++;
    this.stopActive();
    for (const [ev, fn] of this.listeners) this.video.removeEventListener(ev, fn);
    this.listeners.length = 0;
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
    // Probe: pull the first decoded buffer. If the decoder can't handle it, this rejects.
    const probe = new AudioBufferSink(track);
    const firstIter = probe.buffers(0)[Symbol.asyncIterator]();
    const first = await firstIter.next();
    void firstIter.return?.();
    if (first.done || !first.value) return "undecodable";

    const engine = new SyncedAudio(video, track);
    engine.start();
    return { destroy: () => engine.destroy() };
  } catch {
    return "undecodable";
  }
}
