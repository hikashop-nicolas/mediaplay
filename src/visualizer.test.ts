import { describe, expect, it } from "vitest";
import { drawWindow, scopeLine, triggerOffset } from "./visualizer";

/** `cycles` periods of a sine across `n` samples, starting at `phase` radians. */
function tone(n: number, cycles: number, phase = 0): Float32Array<ArrayBuffer> {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = Math.sin((i / n) * cycles * 2 * Math.PI + phase);
  return buf;
}

describe("the trigger", () => {
  it("starts the window on a rising zero crossing", () => {
    const buf = tone(2048, 4, Math.PI / 3);
    const off = triggerOffset(buf, 512);
    expect(buf[off]!, "at the crossing").toBeLessThanOrEqual(0);
    expect(buf[off + 1]!, "rising out of it").toBeGreaterThan(0);
  });

  it("holds the same tone still whatever its phase", () => {
    // The point of a trigger: the drawn line must not slide about between frames, which
    // is what differing phase does to an untriggered window.
    const a = tone(2048, 4, 0.4);
    const b = tone(2048, 4, 2.1);
    const la = scopeLine(a, triggerOffset(a, 512), 512, 128);
    const lb = scopeLine(b, triggerOffset(b, 512), 512, 128);
    for (let k = 0; k < la.length; k++) expect(lb[k]!).toBeCloseTo(la[k]!, 1);

    const untriggered = scopeLine(b, 0, 512, 128);
    const slid = untriggered.some((v, k) => Math.abs(v - la[k]!) > 0.2);
    expect(slid, "without the trigger the same tone lands elsewhere").toBe(true);
  });

  it("falls back to the start of a buffer that never crosses", () => {
    expect(triggerOffset(new Float32Array(1024).fill(0.5), 512)).toBe(0);
    expect(triggerOffset(new Float32Array(1024), 512), "silence").toBe(0);
  });
});

describe("the drawn window", () => {
  it("always leaves the trigger somewhere to search", () => {
    // Drawing the whole buffer pins the window to index 0 and the trace drifts sideways,
    // which is what it did until someone watched it on a phone.
    expect(drawWindow(2048, 2048)).toBe(1024);
    expect(drawWindow(2048, 1024)).toBe(1024);
    expect(drawWindow(2048, 512), "a smaller ask is honoured").toBe(512);
    for (const size of [256, 512, 1024, 2048, 4096]) {
      const w = drawWindow(size, size);
      expect(triggerOffset(new Float32Array(size), w), "room to search").toBe(0);
      expect(size - w, "samples left over").toBeGreaterThan(0);
    }
  });
});

describe("the line", () => {
  it("interpolates between samples instead of averaging them", () => {
    const buf = new Float32Array([0, 1]);
    const line = scopeLine(buf, 0, 2, 3);
    expect([...line]).toEqual([0, 0.5, 1]);
  });

  it("keeps the peak of a waveform it has to shrink", () => {
    // 2048 samples into 256 points: averaging buckets would pull the peaks towards zero.
    const line = scopeLine(tone(2048, 1), 0, 2048, 256);
    expect(Math.max(...line), "crest").toBeCloseTo(1, 1);
    expect(Math.min(...line), "trough").toBeCloseTo(-1, 1);
  });

  it("reuses the array it is given, so a frame allocates nothing", () => {
    const out = new Float32Array(64);
    expect(scopeLine(tone(512, 2), 0, 512, 64, out)).toBe(out);
    expect(scopeLine(tone(512, 2), 0, 512, 32, out), "wrong size: a fresh one").not.toBe(out);
  });

  it("draws silence as a flat line rather than nothing", () => {
    const line = scopeLine(new Float32Array(1024), 0, 1024, 64);
    expect(line.length).toBe(64);
    expect([...line].every((v) => v === 0)).toBe(true);
  });
});
