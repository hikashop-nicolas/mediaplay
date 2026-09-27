/**
 * Change the speed of a decoded audio stream without changing its pitch.
 *
 * A media element does this for you (preservesPitch is on by default), but the decoded
 * path does not go through one: it schedules AudioBuffers itself, and an
 * AudioBufferSourceNode's playbackRate is plain resampling, so 1.5x also raises everyone
 * a fifth. This is WSOLA: cut the input into overlapping frames, slide each one to where
 * it best continues what was already written, and overlap-add them at a fixed output hop.
 * Dropping or repeating whole pitch periods changes the duration and leaves the waveform's
 * period, and so the pitch, alone.
 *
 * Fed chunk by chunk, it keeps its own state across them, so frames straddling a chunk
 * boundary are not a special case.
 */

/** Analysis/synthesis frame, in seconds. Long enough to hold a pitch period of a low
 *  voice, short enough that a transient is not smeared across it. */
const FRAME_SECONDS = 0.043;

export class TimeStretcher {
  private readonly frame: number; // N, the window length
  private readonly hop: number; // Hs, the output hop (half the window: Hann is COLA there)
  private readonly analysisHop: number; // Ha, how far the input advances per frame
  private readonly search: number; // how far either side of nominal we look for a fit
  private readonly window: Float32Array;
  /** Input held per channel, starting at absolute sample `pendingStart`. */
  private pending: Float32Array[];
  private pendingStart = 0;
  private filled = 0; // absolute index one past the last sample held
  /** The half-frame awaiting the next frame's first half, per channel. */
  private tail: Float32Array[];
  private nominal = 0; // where the next frame would start if we never slid it
  private prev = -1; // where the previous frame actually started

  constructor(
    private readonly channels: number,
    sampleRate: number,
    /** Playback speed. Above 1 the output is shorter than the input, and vice versa. */
    rate: number,
  ) {
    // A power of two keeps the hop exact, which matters for Hann's constant overlap-add.
    this.frame = 2 ** Math.round(Math.log2(Math.max(256, sampleRate * FRAME_SECONDS)));
    this.hop = this.frame / 2;
    this.analysisHop = Math.max(1, Math.round(this.hop * rate));
    this.search = this.hop >> 2;
    this.window = new Float32Array(this.frame);
    for (let i = 0; i < this.frame; i++) this.window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / this.frame);
    this.pending = Array.from({ length: channels }, () => new Float32Array(0));
    this.tail = Array.from({ length: channels }, () => new Float32Array(this.hop));
  }

  /** Feed one decoded chunk. Returns whatever output that completed, possibly nothing. */
  push(input: Float32Array[]): Float32Array<ArrayBuffer>[] | null {
    this.append(input);
    const out: Float32Array<ArrayBuffer>[] = Array.from({ length: this.channels }, () => new Float32Array(0));
    const frames: Float32Array[][] = [];
    // Everything a frame can reach: its own length, plus the slide, plus the half frame
    // after it that becomes the next frame's template.
    while (this.filled >= this.nominal + this.search + this.frame + this.hop) {
      frames.push(this.nextFrame());
    }
    if (!frames.length) return null;
    for (let c = 0; c < this.channels; c++) {
      const joined = new Float32Array(frames.length * this.hop);
      for (const [i, f] of frames.entries()) joined.set(f[c]!, i * this.hop);
      out[c] = joined;
    }
    this.trim();
    return out;
  }

  /** One WSOLA frame: pick where it starts, window it, overlap-add, keep the new tail. */
  private nextFrame(): Float32Array[] {
    const pos = this.prev < 0 ? this.nominal : this.bestMatch();
    const out: Float32Array[] = [];
    for (let c = 0; c < this.channels; c++) {
      const src = this.pending[c]!;
      const base = pos - this.pendingStart;
      const tail = this.tail[c]!;
      const block = new Float32Array(this.hop);
      for (let i = 0; i < this.hop; i++) block[i] = tail[i]! + this.window[i]! * src[base + i]!;
      for (let i = 0; i < this.hop; i++) tail[i] = this.window[this.hop + i]! * src[base + this.hop + i]!;
      out.push(block);
    }
    this.prev = pos;
    // Ha from the previous NOMINAL, not from where the slide landed: advancing from the
    // chosen position folds every slide into the rate, and the output drifts off speed.
    this.nominal += this.analysisHop;
    return out;
  }

  /**
   * Where, near the nominal position, the input best continues the half frame already
   * written. Without this the overlap-add joins two pieces of waveform whose periods do
   * not line up, which is the hollow, phasey sound of plain overlap-add.
   */
  private bestMatch(): number {
    const ref = this.pending[0]!;
    // What would have come next had we not moved on: the yardstick for "continues".
    const template = this.prev + this.hop - this.pendingStart;
    const lo = Math.max(this.pendingStart, this.nominal - this.search);
    const hi = Math.min(this.nominal + this.search, this.filled - this.frame - this.hop);
    let best = this.nominal;
    let bestScore = -Infinity;
    // Every other sample: at 48 kHz one sample is 20 microseconds, and the half-sample
    // error that skipping one costs is inaudible next to halving the work.
    for (let p = lo; p <= hi; p += 2) {
      const at = p - this.pendingStart;
      let dot = 0;
      let energy = 0;
      for (let i = 0; i < this.hop; i += 2) {
        const v = ref[at + i]!;
        dot += v * ref[template + i]!;
        energy += v * v;
      }
      // Normalised, or the loudest window wins rather than the best-fitting one.
      const score = dot / Math.sqrt(energy + 1e-9);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  }

  private append(input: Float32Array[]): void {
    const add = input[0]?.length ?? 0;
    if (!add) return;
    for (let c = 0; c < this.channels; c++) {
      const src = input[Math.min(c, input.length - 1)]!; // mono decoded into a stereo run
      const grown = new Float32Array(this.pending[c]!.length + add);
      grown.set(this.pending[c]!);
      grown.set(src, this.pending[c]!.length);
      this.pending[c] = grown;
    }
    this.filled += add;
  }

  /** Drop input no frame can reach any more. */
  private trim(): void {
    const keep = Math.min(this.nominal - this.search, this.prev);
    const drop = keep - this.pendingStart;
    if (drop <= 0) return;
    for (let c = 0; c < this.channels; c++) this.pending[c] = this.pending[c]!.slice(drop);
    this.pendingStart = keep;
  }
}
