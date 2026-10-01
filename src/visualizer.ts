// Audio visualisers: a 2D oscilloscope (the waveform, triggered like a scope) and
// frequency bars. Both are drawn on a canvas with the same glow treatment.

/** Where to start the drawn window: the first rising zero crossing, so a steady tone stands
 *  still instead of sliding sideways every frame. 0 when the buffer never crosses. */
export function triggerOffset(buf: Float32Array<ArrayBuffer>, window: number): number {
  const last = buf.length - window;
  if (last <= 0) return 0;
  for (let i = 0; i < last; i++) {
    if (buf[i]! <= 0 && buf[i + 1]! > 0) return i;
  }
  return 0;
}

/** `count` points across buf[offset .. offset+window], interpolated between samples.
 *  Averaging buckets instead would flatten every peak, which is the whole shape. */
export function scopeLine(buf: Float32Array<ArrayBuffer>, offset: number, window: number, count: number, out?: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
  const line = out && out.length === count ? out : new Float32Array(count);
  if (count === 0) return line;
  const span = Math.min(window, buf.length - offset) - 1;
  if (span <= 0) {
    line.fill(buf[offset] ?? 0);
    return line;
  }
  const step = span / Math.max(1, count - 1);
  for (let k = 0; k < count; k++) {
    const pos = offset + k * step;
    const i = Math.floor(pos);
    const frac = pos - i;
    const a = buf[i] ?? 0;
    const b = buf[i + 1] ?? a;
    line[k] = a + (b - a) * frac;
  }
  return line;
}

/** How many samples to draw out of a buffer of `bufferLength`. Never the whole buffer:
 *  the trigger searches the samples the window leaves behind it, and with nothing left
 *  the window stays pinned to index 0, whose phase moves every frame, so the trace drifts
 *  sideways instead of standing still. */
export function drawWindow(bufferLength: number, requested: number): number {
  return Math.max(2, Math.min(requested, Math.floor(bufferLength / 2)));
}

/** One 0..1 level per bar from the analyser's frequency bins. The bins are linear in Hz
 *  and hearing is not, so each bar covers a geometric slice: linear bars would cram
 *  everything audible into the left eighth and leave the rest dead. Each bar takes the
 *  loudest bin it covers, so a narrow tone stays visible instead of being averaged away. */
export function barLevels(freq: Uint8Array<ArrayBuffer>, bars: number, out?: Float32Array<ArrayBuffer>): Float32Array<ArrayBuffer> {
  const levels = out && out.length === bars ? out : new Float32Array(bars);
  const bins = freq.length;
  if (bars === 0 || bins === 0) return levels;
  for (let i = 0; i < bars; i++) {
    const lo = Math.min(bins - 1, Math.floor(bins ** (i / bars)));
    const hi = Math.min(bins, Math.max(lo + 1, Math.floor(bins ** ((i + 1) / bars))));
    let peak = 0;
    for (let b = lo; b < hi; b++) if (freq[b]! > peak) peak = freq[b]!;
    levels[i] = peak / 255;
  }
  return levels;
}

export type VisualMode = "scope" | "bars";

/** Mix a #rrggbb colour towards white; the lit core of a glowing line is paler than its
 *  halo. Anything that is not plain hex comes back untouched. */
export function lighten(colour: string, amount: number): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (!hex) return colour;
  const n = parseInt(hex[1]!, 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const [r, g, b] = [mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255)];
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** The halo is a blurred copy of the shape: two passes, a wide soft bloom and a tighter
 *  one, added under a thin bright core. Stacking plain strokes instead gives a plateau of
 *  colour rather than a falloff, which reads as one thick line and not as a glow. */
const BLOOM = [
  { blur: 10, alpha: 0.55, width: 3 },
  { blur: 3.5, alpha: 0.8, width: 2.2 },
];
/** Where canvas filters are missing (older Safari), fall back to stacked strokes, faint
 *  enough that they still read as a halo. */
const GLOW_LAYERS: [number, number][] = [
  [16, 0.03], [12, 0.04], [9, 0.055], [7, 0.07], [5, 0.09], [3.5, 0.12],
];
const CORE_WIDTH = 2;

export interface VisualOptions {
  /** Stroke colour; the player passes its accent. */
  colour?: string;
  /** Halo around the shape. On by default; off draws it bare. */
  glow?: boolean;
  /** Which visualisation to draw. */
  mode?: VisualMode;
  /** Samples drawn per frame, oscilloscope only. Shorter shows the waveform, longer the
   *  envelope. Never the whole analyser buffer: the trigger needs samples to search. */
  window?: number;
}

/** Draws whatever the analyser is carrying, frame by frame, into a canvas.
 *  The analyser arrives through a callback: an audio file can switch from the element's
 *  own graph to the decoded one (AC-3 and friends) after playback has started. */
export class Visualizer {
  private raf = 0;
  private buf: Float32Array<ArrayBuffer> = new Float32Array(2048);
  private freq: Uint8Array<ArrayBuffer> = new Uint8Array(1024);
  private line: Float32Array<ArrayBuffer> = new Float32Array(0);
  private levels: Float32Array<ArrayBuffer> = new Float32Array(0);
  private readonly window: number;
  private readonly colour: string;
  private readonly core: string;
  private readonly glow: boolean;
  private mode: VisualMode;
  private readonly onVisibility = () => {
    if (document.hidden) this.pause();
    else if (this.wanted) this.start();
  };
  /** Switched on by the user, as opposed to merely running: a hidden page pauses the loop
   *  without forgetting that it should resume. */
  private wanted = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly getAnalyser: () => AnalyserNode | null,
    opts: VisualOptions = {},
  ) {
    this.window = opts.window ?? 1024;
    this.colour = opts.colour ?? "#e2483d";
    this.glow = opts.glow ?? true;
    this.core = this.glow ? lighten(this.colour, 0.45) : this.colour;
    this.mode = opts.mode ?? "scope";
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  setMode(mode: VisualMode): void {
    this.mode = mode;
    this.draw(); // the new mode shows at once, even on a paused file
  }

  start(): void {
    this.wanted = true;
    if (this.raf || document.hidden) {
      this.draw(); // a hidden page still gets this frame, so the canvas is never blank
      return;
    }
    const tick = () => {
      this.draw();
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Stop drawing but keep the last frame: used on pause, where a frozen trace is right. */
  pause(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  stop(): void {
    this.wanted = false;
    this.pause();
  }

  destroy(): void {
    this.stop();
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  /** One frame. Public so a test can drive it without a running clock. */
  draw(): void {
    const canvas = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    const analyser = this.getAnalyser();
    if (this.mode === "bars") this.drawBars(ctx, analyser, w, h, dpr);
    else this.drawScope(ctx, analyser, w, h, dpr);
  }

  private drawScope(ctx: CanvasRenderingContext2D, analyser: AnalyserNode | null, w: number, h: number, dpr: number): void {
    const points = Math.min(w, 1200); // one point per device pixel is plenty
    if (analyser) {
      if (this.buf.length !== analyser.fftSize) this.buf = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(this.buf);
    } else this.buf.fill(0);
    const window_ = drawWindow(this.buf.length, this.window);
    this.line = scopeLine(this.buf, triggerOffset(this.buf, window_), window_, points, this.line);

    const mid = h / 2;
    const amp = mid * 0.9;
    ctx.beginPath();
    for (let k = 0; k < points; k++) {
      const x = (k / Math.max(1, points - 1)) * w;
      const y = mid - Math.max(-1, Math.min(1, this.line[k]!)) * amp;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    this.paint(ctx, dpr, false);
  }

  private drawBars(ctx: CanvasRenderingContext2D, analyser: AnalyserNode | null, w: number, h: number, dpr: number): void {
    const bars = Math.max(12, Math.min(64, Math.floor(w / (16 * dpr))));
    if (analyser) {
      if (this.freq.length !== analyser.frequencyBinCount) this.freq = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(this.freq);
    } else this.freq.fill(0);
    this.levels = barLevels(this.freq, bars, this.levels);

    const slot = w / bars;
    const width = slot * 0.62;
    const gap = (slot - width) / 2;
    const seat = Math.max(2 * dpr, width * 0.16); // silence still shows a row of seats
    const radius = Math.min(width / 2, 6 * dpr);
    ctx.beginPath();
    for (let i = 0; i < bars; i++) {
      const value = Math.max(0, Math.min(1, this.levels[i]!));
      const barH = Math.max(seat, value * h * 0.92);
      ctx.roundRect(i * slot + gap, h - barH, width, barH, [radius, radius, 0, 0]);
    }
    this.paint(ctx, dpr, true);
  }

  /** The glow, then the shape itself. The halo is a blurred copy rather than a stack of
   *  wide strokes: stacked strokes pile colour up into a plateau, so the line comes out
   *  thick instead of glowing. The core is painted last and sharp, in a lighter tint, the
   *  way a lit filament looks against its own halo. */
  private paint(ctx: CanvasRenderingContext2D, dpr: number, fill: boolean): void {
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const prev = ctx.globalCompositeOperation;
    if (this.glow) {
      ctx.strokeStyle = this.colour;
      ctx.fillStyle = this.colour;
      ctx.globalCompositeOperation = "lighter";
      if (typeof ctx.filter === "string") {
        for (const { blur, alpha, width } of BLOOM) {
          ctx.filter = `blur(${(blur * dpr).toFixed(1)}px)`;
          ctx.globalAlpha = alpha;
          ctx.lineWidth = Math.max(1, width * dpr);
          if (fill) ctx.fill();
          else ctx.stroke();
        }
        ctx.filter = "none";
      } else {
        for (const [width, alpha] of GLOW_LAYERS) {
          ctx.globalAlpha = alpha;
          ctx.lineWidth = Math.max(1, width * dpr);
          ctx.stroke();
        }
      }
    }
    ctx.globalCompositeOperation = prev;
    ctx.globalAlpha = 1;
    // The pale core belongs to a thin line, where it reads as the lit filament. Over the
    // area of a bar the same tint just looks washed out, so a bar keeps the full colour.
    ctx.strokeStyle = this.core;
    ctx.fillStyle = this.colour;
    if (fill) ctx.fill();
    else {
      ctx.lineWidth = Math.max(1, CORE_WIDTH * dpr);
      ctx.stroke();
    }
  }
}
