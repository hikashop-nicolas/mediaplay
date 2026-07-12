// A mediabunny CustomAudioDecoder backed by a custom libav.js build that decodes the
// Dolby AC-3 / E-AC-3 family (the codecs browsers refuse). libav runs in its own Web
// Worker (the non-threaded "wasm" variant, so no cross-origin isolation is required),
// so decoding stays off the main thread. Registered once; mediabunny then uses it
// automatically for ac3/eac3 whenever WebCodecs can't.
//
// The WASM/glue are served as static assets (like the libass octopus assets): the host
// serves three files under a base URL and mediaplay dynamically imports the loader from
// there. This keeps the ~0.9 MB decoder out of the main bundle and lazy.

import { CustomAudioDecoder, registerDecoder, AudioSample, type EncodedPacket } from "mediabunny";

const LIBAV_LOADER = "libav-6.9.8.1-eac3.mjs"; // the variant we build in-repo (see scripts/build-libav.sh)

let libavBase = "";
let libavPromise: Promise<unknown> | null = null;

/** Set where the libav assets are served from (must end with "/"); call before decoding. */
export function setLibavBase(base: string): void {
  libavBase = base.endsWith("/") ? base : base + "/";
}

/** Load the libav.js eac3 variant once, from the configured asset base. */
function loadLibav(): Promise<any> {
  if (!libavPromise) {
    if (!libavBase) throw new Error("mediaplay: libav asset base not set");
    const url = new URL(LIBAV_LOADER, libavBase).href;
    libavPromise = import(/* @vite-ignore */ url).then((factory: any) => factory.LibAV({ base: libavBase }));
  }
  return libavPromise as Promise<any>;
}

class LibavAc3Decoder extends CustomAudioDecoder {
  private libav: any = null;
  private ctx = 0;
  private pkt = 0;
  private frame = 0;
  // Output timestamp clock, re-anchored on any discontinuity (e.g. a seek that reuses us).
  private clockTs = 0;
  private clockSamples = 0;
  private anchored = false;

  static supports(codec: string): boolean {
    return codec === "eac3" || codec === "ac3";
  }

  async init(): Promise<void> {
    this.libav = await loadLibav();
    const name = this.codec === "eac3" ? "eac3" : "ac3";
    const [, ctx, pkt, frame] = await this.libav.ff_init_decoder(name);
    this.ctx = ctx;
    this.pkt = pkt;
    this.frame = frame;
    // Interleaved 32-bit float out -> AudioSample "f32", ready for Web Audio.
    await this.libav.AVCodecContext_sample_fmt_s(ctx, this.libav.AV_SAMPLE_FMT_FLT);
  }

  async decode(packet: EncodedPacket): Promise<void> {
    const frames = await this.libav.ff_decode_multi(this.ctx, this.pkt, this.frame, [{ data: packet.data }], false);
    this.emit(frames, packet.timestamp);
  }

  async flush(): Promise<void> {
    const frames = await this.libav.ff_decode_multi(this.ctx, this.pkt, this.frame, [], true);
    this.emit(frames, undefined);
  }

  private emit(frames: any[], packetTs: number | undefined): void {
    for (const f of frames) {
      const channels = this.libav.ff_channels(f);
      const rate = f.sample_rate;
      const nb = f.data.length / Math.max(1, channels);
      // Re-anchor the clock if the input jumps (seek) or on the first frame; otherwise
      // advance it by the decoded frame length so timestamps stay monotonic and gap-free.
      const expected = this.clockTs + this.clockSamples / rate;
      if (packetTs !== undefined && (!this.anchored || Math.abs(packetTs - expected) > 0.1)) {
        this.clockTs = packetTs;
        this.clockSamples = 0;
        this.anchored = true;
      }
      const ts = this.clockTs + this.clockSamples / rate;
      this.clockSamples += nb;
      this.onSample(new AudioSample({ data: f.data, format: "f32", numberOfChannels: channels, sampleRate: rate, timestamp: ts }));
    }
  }

  async close(): Promise<void> {
    if (this.ctx && this.libav) {
      try {
        await this.libav.ff_free_decoder(this.ctx, this.pkt, this.frame);
      } catch {
        /* worker already gone */
      }
    }
    this.ctx = this.pkt = this.frame = 0;
  }
}

let registered = false;
/** Register the AC-3/E-AC-3 decoder with mediabunny (idempotent). */
export function registerAc3Decoder(): void {
  if (registered) return;
  registerDecoder(LibavAc3Decoder);
  registered = true;
}
