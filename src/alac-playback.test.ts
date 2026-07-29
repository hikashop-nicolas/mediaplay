import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Output, WavOutputFormat } from "mediabunny";
import { registerAlacDecoder, setAlacBase } from "./alac-decoder";
import { sampleAt } from "../scripts/gen-alac-corpus.mjs";

// End to end, through the path the player actually uses.
//
// An ALAC file fails to play on every browser but Safari, so mediaplay falls back to
// converting it in memory (mediabunny's Conversion, the same tryRemux path used for any
// unplayable container) into WAV, which is PCM and needs no encoder. This checks that the
// conversion really produces the original audio rather than merely producing *a* file:
// ALAC is lossless, so the WAV must carry the samples the corpus generator wrote. One
// caveat: mediabunny's WAV output writes 16-bit PCM, so a 24-bit source is narrowed here.
// The decoder itself is exact at 24 bits (alac-decoder.test.ts); this path is not, and the
// test says so rather than pretending otherwise.
//
// What this does NOT cover is the browser then playing the WAV. That needs a real browser
// with working media decode, which is what the Cypress suite is for.

const CORPUS = join(__dirname, "../test-corpus/alac");
const WASM = join(__dirname, "../alac/dist/alac.mjs");
const ready = existsSync(join(CORPUS, "manifest.json")) && existsSync(WASM);

type Fixture = {
  file: string; channels: number; rate: number; bits: number; frames: number; freqs: number[];
};
const manifest: Fixture[] = ready
  ? (JSON.parse(readFileSync(join(CORPUS, "manifest.json"), "utf8")) as Fixture[])
  : [];

/** Per-channel integer samples from a PCM WAV. */
function readWavChannels(bytes: Uint8Array): { channels: Int32Array[]; bits: number; rate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 12;
  let fmt: { channels: number; rate: number; bits: number } | null = null;
  let data: Uint8Array | null = null;
  while (pos + 8 <= bytes.byteLength) {
    const id = String.fromCharCode(bytes[pos]!, bytes[pos + 1]!, bytes[pos + 2]!, bytes[pos + 3]!);
    const size = view.getUint32(pos + 4, true);
    if (id === "fmt ") {
      fmt = { channels: view.getUint16(pos + 10, true), rate: view.getUint32(pos + 12, true), bits: view.getUint16(pos + 22, true) };
    } else if (id === "data") {
      data = bytes.subarray(pos + 8, pos + 8 + size);
    }
    pos += 8 + size + (size % 2);
  }
  if (!fmt || !data) throw new Error("not a PCM wav");

  const bytesPer = fmt.bits / 8;
  const frames = Math.floor(data.byteLength / (bytesPer * fmt.channels));
  const channels = Array.from({ length: fmt.channels }, () => new Int32Array(frames));
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < fmt.channels; c++) {
      const o = (f * fmt.channels + c) * bytesPer;
      channels[c]![f] = fmt.bits === 16
        ? dv.getInt16(o, true)
        : fmt.bits === 24
          ? (dv.getUint8(o) | (dv.getUint8(o + 1) << 8) | (dv.getInt8(o + 2) << 16))
          : dv.getInt32(o, true);
    }
  }
  return { channels, bits: fmt.bits, rate: fmt.rate };
}

describe.skipIf(!ready)("ALAC playback conversion", () => {
  for (const fx of manifest) {
    it(`converts ${fx.file} to playable PCM without losing a sample`, async () => {
      // The player loads the wasm from a served base; in node point it at the build dir.
      setAlacBase(new URL("../alac/dist/", import.meta.url).href);
      registerAlacDecoder();

      const bytes = new Uint8Array(readFileSync(join(CORPUS, fx.file)));
      const input = new Input({ source: new BlobSource(new Blob([bytes as BlobPart])), formats: ALL_FORMATS });
      const target = new BufferTarget();
      const output = new Output({ format: new WavOutputFormat(), target });
      const conversion = await Conversion.init({ input, output });
      expect(conversion.isValid, `${fx.file}: conversion rejected the input`).toBe(true);
      await conversion.execute();
      expect(target.buffer, `${fx.file}: no output`).toBeTruthy();

      const wav = readWavChannels(new Uint8Array(target.buffer as ArrayBuffer));
      expect(wav.rate).toBe(fx.rate);
      expect(wav.channels.length).toBe(fx.channels);

      // Each output channel must reproduce one source tone, and each tone must be claimed
      // once: content and channel ordering checked together, as everywhere else here.
      //
      // One caveat, and a real limitation rather than a test convenience: mediabunny's WAV
      // output writes 16-bit PCM, so a 24-bit source is truncated on the way through this
      // fallback. The decoder itself is exact at 24 bits (see alac-decoder.test.ts); it is
      // the conversion that narrows. So compare at whatever depth the WAV actually carries,
      // which for a 24-bit source means the top 16 bits must still match exactly.
      // Where the depth is unchanged the match is exact. Where it narrows, the WAV writer's
      // rounding convention is its own (measured: it lands consistently 1 LSB below a
      // round-half-up), so allow a single least-significant bit there and nowhere else.
      const narrowBy = Math.max(0, fx.bits - wav.bits);
      const tolerance = narrowBy > 0 ? 1 : 0;
      const expectedAt = (freq: number, f: number): number => {
        const v = sampleAt(freq, f, fx.rate, fx.bits);
        return narrowBy > 0 ? Math.round(v / (1 << narrowBy)) : v;
      };
      const shift = wav.bits - fx.bits;
      const claimed = new Set<number>();
      for (let c = 0; c < wav.channels.length; c++) {
        const matches = fx.freqs
          .map((freq, i) => {
            for (let f = 0; f < fx.frames; f++) {
              const got = shift > 0 ? wav.channels[c]![f]! >> shift : wav.channels[c]![f]!;
              if (Math.abs(got - expectedAt(freq, f)) > tolerance) return -1;
            }
            return i;
          })
          .filter((i) => i >= 0);
        expect(matches.length, `${fx.file} channel ${c}: matched ${matches.length} source tones exactly (expected 1)`).toBe(1);
        expect(claimed.has(matches[0]!)).toBe(false);
        claimed.add(matches[0]!);
      }
      expect(claimed.size).toBe(fx.channels);
    }, 60_000);
  }
});
