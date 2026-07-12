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

const LIBAV_LOADER = "libav-6.9.8.1-audio.mjs"; // the "audio" variant built in-repo (see libav/NOTICE.md)

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
    // noworker: run the decoder on the calling thread. In worker mode every per-packet
    // ff_decode_multi is a postMessage round-trip, which drags throughput below realtime;
    // direct calls decode at ~80x realtime (measured), easily keeping ahead of playback.
    libavPromise = import(/* @vite-ignore */ url).then((factory: any) => factory.LibAV({ base: libavBase, noworker: true }));
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
    // Do NOT force ctx.sample_fmt: decoders ignore it and output their native format
    // (E-AC-3 = FLTP, planar), and overriding it made the copyout misread the planar
    // frame as interleaved - yielding buffers whose second half was padding zeros
    // (16ms sound + 16ms silence per frame, i.e. chopped audio). emit() handles both
    // planar and interleaved frames as they come.
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
      const rate = f.sample_rate;
      // Planar frame (E-AC-3's native FLTP): f.data is an array of per-channel planes.
      // Concatenate them (mediabunny's "f32-planar" expects planes back to back).
      let data: Float32Array;
      let format: "f32" | "f32-planar";
      let channels: number;
      let nb: number;
      if (Array.isArray(f.data)) {
        const planes = f.data as Float32Array[];
        channels = planes.length;
        nb = planes[0]!.length;
        data = new Float32Array(nb * channels);
        planes.forEach((p, i) => data.set(p, i * nb));
        format = "f32-planar";
      } else {
        data = f.data as Float32Array;
        channels = this.libav.ff_channels(f);
        nb = data.length / Math.max(1, channels);
        format = "f32";
      }
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
      this.onSample(new AudioSample({ data, format, numberOfChannels: channels, sampleRate: rate, timestamp: ts }));
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

// --- direct decode API (bypasses mediabunny, whose codec model lacks DTS/TrueHD) ---

/** Matroska CodecID -> FFmpeg decoder name, for codecs our libav build decodes. */
export const MKV_LIBAV_CODECS: Record<string, string> = {
  A_AC3: "ac3",
  A_EAC3: "eac3",
  A_DTS: "dca",
  A_TRUEHD: "truehd",
  A_MLP: "mlp",
};

/** One decoded frame, normalized to per-channel Float32 planes. */
export interface DirectFrame {
  rate: number;
  channels: number;
  nb: number;
  planes: Float32Array[];
}

/** Normalize any libav sample array (s16/s32/f64...) to Float32 in [-1, 1]. */
function toF32(a: ArrayLike<number>): Float32Array {
  if (a instanceof Float32Array) return a;
  const out = new Float32Array(a.length);
  if (a instanceof Int32Array) for (let i = 0; i < a.length; i++) out[i] = a[i]! / 2147483648;
  else if (a instanceof Int16Array) for (let i = 0; i < a.length; i++) out[i] = a[i]! / 32768;
  else if (a instanceof Uint8Array) for (let i = 0; i < a.length; i++) out[i] = (a[i]! - 128) / 128;
  else for (let i = 0; i < a.length; i++) out[i] = a[i]!; // f64 or already-float-ish
  return out;
}

export interface DirectAudioDecoder {
  decode(packets: Uint8Array[]): Promise<DirectFrame[]>;
  flush(): Promise<DirectFrame[]>;
  close(): void;
}

/** Open a decoder for an FFmpeg codec name (see MKV_LIBAV_CODECS); caller feeds raw
 *  encoded packets (e.g. from readAudioPackets) and gets Float32 planes back. */
export async function createDirectAudioDecoder(ffName: string, base: string): Promise<DirectAudioDecoder> {
  setLibavBase(base);
  const libav: any = await (libavPromise ?? loadLibav());
  const [, ctx, pkt, frame] = await libav.ff_init_decoder(ffName);
  const norm = (frames: any[]): DirectFrame[] =>
    frames.map((f: any) => {
      if (Array.isArray(f.data)) {
        // Planar: one array per channel.
        const planes = (f.data as ArrayLike<number>[]).map(toF32);
        return { rate: f.sample_rate, channels: planes.length, nb: planes[0]?.length ?? 0, planes };
      }
      // Interleaved: deinterleave into planes.
      const data = toF32(f.data as ArrayLike<number>);
      const ch = Math.max(1, libav.ff_channels(f));
      const nb = Math.floor(data.length / ch);
      const planes: Float32Array[] = [];
      for (let c = 0; c < ch; c++) {
        const p = new Float32Array(nb);
        for (let i = 0; i < nb; i++) p[i] = data[i * ch + c]!;
        planes.push(p);
      }
      return { rate: f.sample_rate, channels: ch, nb, planes };
    });
  return {
    async decode(packets) {
      if (!packets.length) return [];
      return norm(await libav.ff_decode_multi(ctx, pkt, frame, packets.map((data) => ({ data })), false));
    },
    async flush() {
      return norm(await libav.ff_decode_multi(ctx, pkt, frame, [], true));
    },
    close() {
      Promise.resolve(libav.ff_free_decoder(ctx, pkt, frame)).catch(() => undefined);
    },
  };
}
