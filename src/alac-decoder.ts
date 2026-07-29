// A mediabunny CustomAudioDecoder for ALAC (Apple Lossless), backed by a WebAssembly build
// of Apple's own reference decoder (Apache-2.0; see alac/NOTICE.md).
//
// Only Safari decodes ALAC natively, so on every other browser an .m4a of Apple Lossless
// simply fails to play. This fills that in. The module is about 21 KB of wasm, served as a
// static asset like the libass and libav assets, and loaded lazily: a session that never
// opens an ALAC file never fetches it.
//
// Registered with mediabunny, which needs our fork to know ALAC exists at all: the codec is
// absent from the published package's codec union, so a decoder cannot even be registered
// for it there.

import { CustomAudioDecoder, registerDecoder, AudioSample, type EncodedPacket } from "mediabunny";

const ALAC_LOADER = "alac.mjs";

let alacBase = "";
let modulePromise: Promise<AlacModule> | null = null;

/** The Emscripten module surface we use. */
interface AlacModule {
  _malloc(size: number): number;
  _free(ptr: number): void;
  _alac_create(cookiePtr: number, cookieSize: number): number;
  _alac_destroy(ctx: number): void;
  _alac_decode(ctx: number, pkt: number, pktSize: number, out: number, capacityFrames: number): number;
  _alac_channels(ctx: number): number;
  _alac_bit_depth(ctx: number): number;
  _alac_frame_length(ctx: number): number;
  _alac_sample_rate(ctx: number): number;
  _alac_bytes_per_frame(ctx: number): number;
  HEAPU8: Uint8Array;
}

/** Set where the ALAC wasm assets are served from (must end with "/"); call before decoding. */
export function setAlacBase(base: string): void {
  alacBase = base.endsWith("/") ? base : base + "/";
}

function loadAlac(): Promise<AlacModule> {
  if (!modulePromise) {
    if (!alacBase) throw new Error("mediaplay: ALAC asset base not set");
    // A failed dynamic import is cached by the browser for the page's lifetime, so a
    // transient hiccup would otherwise disable ALAC for the whole session. Clear the
    // promise on failure so a later attempt can retry (same reasoning as the libav loader).
    modulePromise = import(/* @vite-ignore */ `${alacBase}${ALAC_LOADER}`)
      .then((mod: { default: (opts?: Record<string, unknown>) => Promise<AlacModule> }) =>
        mod.default({ locateFile: (path: string) => `${alacBase}${path}` }))
      .catch((e: unknown) => {
        modulePromise = null;
        throw e;
      });
  }
  return modulePromise;
}

/**
 * True when the browser can already play ALAC itself, in which case there is no reason to
 * fetch the decoder at all. Safari can; nothing else does.
 */
export function browserPlaysAlac(): boolean {
  if (typeof document === "undefined") return false;
  const probe = document.createElement("audio");
  return probe.canPlayType('audio/mp4; codecs="alac"') !== "";
}

class AlacDecoder extends CustomAudioDecoder {
  private mod: AlacModule | null = null;
  private ctx = 0;
  private outPtr = 0;
  private frameLength = 0;
  private channels = 0;
  private bitDepth = 0;
  private sampleRate = 0;
  // Output clock, re-anchored on a discontinuity so timestamps stay monotonic across seeks.
  private clockTs = 0;
  private clockSamples = 0;
  private anchored = false;

  static supports(codec: string): boolean {
    return codec === "alac";
  }

  async init(): Promise<void> {
    const mod = await loadAlac();
    this.mod = mod;

    // The magic cookie (ALACSpecificConfig) is mandatory: it carries the frame length, bit
    // depth and channel count, and the decoder cannot be configured without it.
    const description = this.config.description;
    if (!description) throw new Error("mediaplay: ALAC track has no magic cookie");
    const cookie = description instanceof Uint8Array
      ? description
      : new Uint8Array(description as ArrayBuffer);

    const cookiePtr = mod._malloc(cookie.byteLength);
    mod.HEAPU8.set(cookie, cookiePtr);
    this.ctx = mod._alac_create(cookiePtr, cookie.byteLength);
    mod._free(cookiePtr);
    if (!this.ctx) throw new Error("mediaplay: the ALAC magic cookie was rejected");

    this.channels = mod._alac_channels(this.ctx);
    this.bitDepth = mod._alac_bit_depth(this.ctx);
    this.frameLength = mod._alac_frame_length(this.ctx);
    this.sampleRate = mod._alac_sample_rate(this.ctx);
    this.outPtr = mod._malloc(mod._alac_bytes_per_frame(this.ctx) * this.frameLength);
  }

  async decode(packet: EncodedPacket): Promise<void> {
    const mod = this.mod;
    if (!mod || !this.ctx) return;

    const pktPtr = mod._malloc(packet.data.byteLength);
    mod.HEAPU8.set(packet.data, pktPtr);
    const frames = mod._alac_decode(this.ctx, pktPtr, packet.data.byteLength, this.outPtr, this.frameLength);
    mod._free(pktPtr);
    if (frames <= 0) return; // a packet we cannot decode is dropped rather than fatal

    this.emit(this.toFloat32(mod, frames), frames, packet.timestamp);
  }

  /**
   * Interleaved integer samples to interleaved Float32 in [-1, 1].
   *
   * The layout depends on the bit depth and is not uniform: 16-bit is int16, but 20- and
   * 24-bit are PACKED three-byte samples rather than sign-extended 32-bit containers.
   * Reading 24-bit the other way yields something that still sounds like plausible audio,
   * which is why the corpus covers it.
   */
  private toFloat32(mod: AlacModule, frames: number): Float32Array {
    const count = frames * this.channels;
    const out = new Float32Array(count);
    const heap = mod.HEAPU8;
    if (this.bitDepth === 16) {
      const scale = 1 / 32768;
      for (let i = 0; i < count; i++) {
        const at = this.outPtr + i * 2;
        out[i] = (((heap[at]! | (heap[at + 1]! << 8)) << 16) >> 16) * scale;
      }
    } else if (this.bitDepth === 20 || this.bitDepth === 24) {
      const scale = 1 / 8388608;
      for (let i = 0; i < count; i++) {
        const at = this.outPtr + i * 3;
        // Sign-extend the packed 24-bit value by shifting it into the top of a 32-bit int.
        out[i] = ((((heap[at]! | (heap[at + 1]! << 8) | (heap[at + 2]! << 16)) << 8) >> 8)) * scale;
      }
    } else {
      const scale = 1 / 2147483648;
      for (let i = 0; i < count; i++) {
        const at = this.outPtr + i * 4;
        out[i] = ((heap[at]! | (heap[at + 1]! << 8) | (heap[at + 2]! << 16) | (heap[at + 3]! << 24)) | 0) * scale;
      }
    }
    return out;
  }

  private emit(data: Float32Array, frames: number, packetTs: number | undefined): void {
    const expected = this.clockTs + this.clockSamples / this.sampleRate;
    if (packetTs !== undefined && (!this.anchored || Math.abs(packetTs - expected) > 0.1)) {
      this.clockTs = packetTs;
      this.clockSamples = 0;
      this.anchored = true;
    }
    const timestamp = this.clockTs + this.clockSamples / this.sampleRate;
    this.clockSamples += frames;

    this.onSample(new AudioSample({
      data,
      format: "f32",
      numberOfChannels: this.channels,
      sampleRate: this.sampleRate,
      timestamp,
    }));
  }

  async flush(): Promise<void> {
    // ALAC packets are independent, so nothing is held back.
  }

  async close(): Promise<void> {
    if (this.mod && this.ctx) {
      if (this.outPtr) this.mod._free(this.outPtr);
      this.mod._alac_destroy(this.ctx);
    }
    this.ctx = 0;
    this.outPtr = 0;
    this.mod = null;
  }
}

let registered = false;

/** Register the ALAC decoder with mediabunny. Idempotent. */
export function registerAlacDecoder(): void {
  if (registered) return;
  registerDecoder(AlacDecoder);
  registered = true;
}
