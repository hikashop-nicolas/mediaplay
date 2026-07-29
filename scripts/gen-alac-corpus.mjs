#!/usr/bin/env node
// Generate the ALAC test corpus.
//
// Why generated rather than collected: the fixtures need to be provably synthetic (nothing
// downloaded, no licensing question) and, more importantly, we need to know exactly what
// PCM went in. ALAC is lossless, so a decoder can be checked sample-exactly against its
// input, and that only works if the input is something we can reproduce.
//
// So this writes the source PCM from a formula, encodes it with `afconvert` (macOS ships an
// ALAC encoder), and records the parameters in a manifest. Only the .m4a files and the
// manifest are committed; the expected PCM is regenerated from the manifest by the test,
// which keeps several megabytes of WAV out of the repository.
//
// Each channel gets its OWN frequency. With identical tones, per-channel level is the same
// everywhere and a channel-ordering bug is invisible; by frequency it is obvious. That
// matters because ALAC does not use WAV channel order (see _plans/ALAC_PLAN.md).
//
// Usage: node scripts/gen-alac-corpus.mjs   (macOS only; needs afconvert)

import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT = join(ROOT, "test-corpus", "alac");

// Short on purpose: 0.5s at 44.1kHz is ~22050 frames, which is still six 4096-frame ALAC
// packets, so multi-packet decoding is exercised without committing megabytes.
const FIXTURES = [
  { name: "stereo-16", rate: 44100, bits: 16, freqs: [440, 660], seconds: 0.5, layout: null },
  { name: "mono-16", rate: 44100, bits: 16, freqs: [523], seconds: 0.5, layout: null },
  { name: "stereo-24", rate: 96000, bits: 24, freqs: [440, 660], seconds: 0.5, layout: null },
  // 5.1 and 7.1 in WAV order (L R C LFE Ls Rs [...]); afconvert reorders to ALAC's own
  // order on the way in, which is exactly the behaviour these fixtures exist to pin down.
  { name: "surround-51", rate: 48000, bits: 16, freqs: [220, 277, 330, 392, 440, 523], seconds: 0.5, layout: "MPEG_5_1_A" },
  { name: "surround-71", rate: 48000, bits: 16, freqs: [200, 260, 320, 380, 440, 500, 560, 620], seconds: 0.5, layout: "MPEG_7_1_A" },
];

/** The sample value for one channel at one frame. Kept trivially reproducible: the test
    regenerates the expected PCM with this same formula from the manifest. */
export function sampleAt(freq, frame, rate, bits) {
  const peak = bits === 24 ? 3_000_000 : 12_000;
  return Math.round(peak * Math.sin((2 * Math.PI * freq * frame) / rate));
}

/** A RIFF/WAVE file. Written by hand because node has no wav writer and 24-bit needs it. */
function wav({ rate, bits, freqs, seconds }) {
  const channels = freqs.length;
  const frames = Math.round(rate * seconds);
  const bytesPerSample = bits / 8;
  const data = Buffer.alloc(frames * channels * bytesPerSample);
  let o = 0;
  for (let f = 0; f < frames; f++) {
    for (const freq of freqs) {
      const v = sampleAt(freq, f, rate, bits);
      if (bits === 16) {
        data.writeInt16LE(v, o);
      } else {
        // 24-bit little-endian: the low three bytes of the 32-bit value.
        data.writeUInt8(v & 0xff, o);
        data.writeUInt8((v >> 8) & 0xff, o + 1);
        data.writeUInt8((v >> 16) & 0xff, o + 2);
      }
      o += bytesPerSample;
    }
  }
  const byteRate = rate * channels * bytesPerSample;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * bytesPerSample, 32);
  header.writeUInt16LE(bits, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function main() {
  mkdirSync(OUT, { recursive: true });
  const work = join(tmpdir(), `alac-corpus-${process.pid}`);
  mkdirSync(work, { recursive: true });

  const manifest = [];
  for (const f of FIXTURES) {
    const src = join(work, `${f.name}.wav`);
    writeFileSync(src, wav(f));
    const dst = join(OUT, `${f.name}.m4a`);
    const args = ["-f", "m4af", "-d", "alac"];
    if (f.layout) args.push("-l", f.layout);
    try {
      execFileSync("afconvert", [...args, src, dst], { stdio: "ignore" });
    } catch (e) {
      if (e.code === "ENOENT") {
        console.error("afconvert not found. This corpus is generated on macOS; the .m4a files");
        console.error("are committed, so this is only needed in order to change them.");
        process.exit(2);
      }
      throw e;
    }
    manifest.push({ ...f, file: `${f.name}.m4a`, channels: f.freqs.length, frames: Math.round(f.rate * f.seconds) });
    console.log(`${f.name}.m4a  ${statSync(dst).size} bytes  ${f.freqs.length}ch ${f.bits}-bit ${f.rate}Hz`);
  }

  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  rmSync(work, { recursive: true, force: true });
  console.log(`\n${readdirSync(OUT).length - 1} fixtures in test-corpus/alac/`);
}

// Only when run directly: check-alac-corpus.mjs imports sampleAt from here, and without
// this guard that import regenerates the whole corpus as a side effect.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
