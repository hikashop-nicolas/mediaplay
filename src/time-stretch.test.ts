import { describe, expect, it } from "vitest";
import { TimeStretcher } from "./time-stretch";

const SR = 48000;

/** A sine, handed over in the ~32 ms chunks the decoder produces. */
function feed(hz: number, seconds: number, rate: number, channels = 1): Float32Array {
  const st = new TimeStretcher(channels, SR, rate);
  const chunk = Math.round(SR * 0.032);
  const total = Math.round(SR * seconds);
  const parts: Float32Array[] = [];
  for (let start = 0; start < total; start += chunk) {
    const n = Math.min(chunk, total - start);
    const block = new Float32Array(n);
    for (let i = 0; i < n; i++) block[i] = Math.sin((2 * Math.PI * hz * (start + i)) / SR);
    const out = st.push(Array.from({ length: channels }, () => block));
    if (out) parts.push(out[0]!);
  }
  const joined = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    joined.set(p, at);
    at += p.length;
  }
  return joined;
}

/** Dominant frequency by zero crossings, over the steady middle of the signal. */
function pitchOf(x: Float32Array): number {
  const from = Math.round(x.length * 0.2);
  const to = Math.round(x.length * 0.8);
  let crossings = 0;
  for (let i = from + 1; i < to; i++) if (x[i - 1]! < 0 && x[i]! >= 0) crossings++;
  return (crossings * SR) / (to - from);
}

describe("TimeStretcher", () => {
  for (const rate of [0.5, 0.75, 1.5, 2]) {
    it(`keeps the pitch at ${rate}x`, () => {
      const out = feed(440, 2, rate);
      expect(pitchOf(out)).toBeGreaterThan(430);
      expect(pitchOf(out)).toBeLessThan(450);
    });

    it(`changes the duration by ${rate}x`, () => {
      const out = feed(440, 2, rate);
      // A frame's worth of input is held back at the start, hence the tolerance.
      expect(out.length / SR).toBeGreaterThan(2 / rate - 0.15);
      expect(out.length / SR).toBeLessThan(2 / rate + 0.05);
    });
  }

  it("resampling is what it avoids: a plain speed-up would move the pitch", () => {
    // The same 2 seconds read 1.5x faster, the way an AudioBufferSourceNode does it.
    const src = new Float32Array(Math.round(SR * 2));
    for (let i = 0; i < src.length; i++) src[i] = Math.sin((2 * Math.PI * 440 * i) / SR);
    const resampled = new Float32Array(Math.floor(src.length / 1.5));
    for (let i = 0; i < resampled.length; i++) resampled[i] = src[Math.round(i * 1.5)]!;
    expect(pitchOf(resampled)).toBeGreaterThan(640); // 440 * 1.5
  });

  it("holds its state across chunk boundaries rather than restarting each time", () => {
    // Two channels of the same sine: a frame straddling a chunk edge must not click.
    const out = feed(220, 1.5, 1.25, 2);
    let worst = 0;
    for (let i = 1; i < out.length; i++) worst = Math.max(worst, Math.abs(out[i]! - out[i - 1]!));
    // One sample of a 220 Hz sine moves by at most 2*pi*220/48000 = 0.029.
    expect(worst).toBeLessThan(0.1);
  });

  it("emits nothing until it has a whole frame, then keeps up", () => {
    const st = new TimeStretcher(1, SR, 1.5);
    expect(st.push([new Float32Array(256)])).toBeNull();
    expect(st.push([new Float32Array(4096)])).not.toBeNull();
  });
});
