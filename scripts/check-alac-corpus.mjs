#!/usr/bin/env node
// Verify the ALAC corpus is what the manifest says it is.
//
// Everything downstream trusts two claims: that each fixture decodes to the exact PCM the
// generator's formula produces, and that the channel permutation is what we think it is. If
// either is wrong, a decoder test built on it would be measuring the wrong thing while
// looking perfectly healthy. So check it here, once, against a decoder we did not write.
//
// ALAC is lossless, so this is not "close enough": every sample must match exactly.
//
// The channel permutation is DISCOVERED rather than assumed. Each channel of the corpus
// carries its own frequency, so for every decoded channel we ask which of the manifest's
// tones it reproduces sample for sample. Exactly one must match, and every tone must be
// claimed exactly once. That proves losslessness and yields the ordering at the same time.
//
// macOS only (uses afconvert to decode). The .m4a files are committed, so this runs when
// the corpus changes rather than in CI.

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sampleAt } from "./gen-alac-corpus.mjs";

const ROOT = new URL("..", import.meta.url).pathname;
const CORPUS = join(ROOT, "test-corpus", "alac");

/** Read a PCM WAV into per-channel arrays of integers. */
function readWav(path) {
  const b = readFileSync(path);
  // Walk the chunks rather than assuming a 44-byte header: afconvert may emit extra ones.
  let pos = 12;
  let fmt = null;
  let data = null;
  while (pos + 8 <= b.length) {
    const id = b.toString("latin1", pos, pos + 4);
    const size = b.readUInt32LE(pos + 4);
    if (id === "fmt ") {
      fmt = { channels: b.readUInt16LE(pos + 10), rate: b.readUInt32LE(pos + 12), bits: b.readUInt16LE(pos + 22) };
    } else if (id === "data") {
      data = b.subarray(pos + 8, pos + 8 + size);
    }
    pos += 8 + size + (size % 2); // chunks are word-aligned
  }
  if (!fmt || !data) throw new Error(`${path}: no fmt/data chunk`);

  const bytes = fmt.bits / 8;
  const frames = Math.floor(data.length / (bytes * fmt.channels));
  const out = Array.from({ length: fmt.channels }, () => new Int32Array(frames));
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < fmt.channels; c++) {
      const o = (f * fmt.channels + c) * bytes;
      out[c][f] = fmt.bits === 16
        ? data.readInt16LE(o)
        : (data.readUInt8(o) | (data.readUInt8(o + 1) << 8) | (data.readInt8(o + 2) << 16));
    }
  }
  return { ...fmt, frames, channels: out };
}

/** Does this decoded channel reproduce `freq` exactly, for every sample? */
function matchesTone(channel, freq, rate, bits) {
  for (let f = 0; f < channel.length; f++) {
    if (channel[f] !== sampleAt(freq, f, rate, bits)) return false;
  }
  return true;
}

const manifest = JSON.parse(readFileSync(join(CORPUS, "manifest.json"), "utf8"));
const work = join(tmpdir(), `alac-check-${process.pid}`);
mkdirSync(work, { recursive: true });

let failures = 0;
for (const fx of manifest) {
  const decoded = join(work, `${fx.name}.wav`);
  const depth = fx.bits === 24 ? "LEI24" : "LEI16";
  try {
    execFileSync("afconvert", ["-f", "WAVE", "-d", depth, join(CORPUS, fx.file), decoded], { stdio: "ignore" });
  } catch (e) {
    if (e.code === "ENOENT") {
      console.error("afconvert not found; this check is macOS-only.");
      process.exit(2);
    }
    throw e;
  }

  const wav = readWav(decoded);
  const problems = [];
  if (wav.channels.length !== fx.channels) problems.push(`channel count ${wav.channels.length}, expected ${fx.channels}`);
  if (wav.rate !== fx.rate) problems.push(`rate ${wav.rate}, expected ${fx.rate}`);
  if (wav.bits !== fx.bits) problems.push(`bit depth ${wav.bits}, expected ${fx.bits}`);
  if (wav.frames !== fx.frames) problems.push(`frames ${wav.frames}, expected ${fx.frames}`);

  // Which source tone does each decoded channel carry?
  const order = [];
  if (!problems.length) {
    for (let c = 0; c < wav.channels.length; c++) {
      const hits = fx.freqs
        .map((freq, i) => (matchesTone(wav.channels[c], freq, fx.rate, fx.bits) ? i : -1))
        .filter((i) => i >= 0);
      if (hits.length !== 1) {
        problems.push(`channel ${c} matches ${hits.length} source tones exactly (expected 1): not lossless, or not a pure tone`);
        break;
      }
      order.push(hits[0]);
    }
  }
  if (!problems.length && new Set(order).size !== order.length) {
    problems.push(`channels are not a permutation of the source: ${order.join(",")}`);
  }

  if (problems.length) {
    failures++;
    console.log(`FAIL ${fx.file}`);
    for (const p of problems) console.log(`       ${p}`);
  } else {
    const perm = order.join(",");
    const identity = order.every((v, i) => v === i);
    console.log(`ok   ${fx.file}  ${fx.channels}ch ${fx.bits}-bit ${fx.rate}Hz  sample-exact  `
      + (identity ? "channel order unchanged" : `ALAC->source channel order [${perm}]`));
  }
}

rmSync(work, { recursive: true, force: true });
if (failures) {
  console.error(`\n${failures} fixture(s) are not what the manifest claims.`);
  process.exit(1);
}
console.log(`\nall ${manifest.length} fixtures decode sample-exactly to the manifest's tones.`);
