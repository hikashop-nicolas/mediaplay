// A 2D oscilloscope: the time-domain buffer drawn as a line, the way a scope draws it.

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

/** Stroke passes: width in CSS pixels, and how much of the colour each one lays down.
 *  Widest and faintest first, so the line keeps a bright core inside a soft halo. */
const GLOW_LAYERS: [number, number][] = [[12, 0.06], [7, 0.11], [4, 0.20], [2.6, 0.95]];
const CORE_ONLY: [number, number][] = [[2.4, 1]];

export interface ScopeOptions {
  /** Stroke colour; the player passes its accent. */
  colour?: string;
  /** Halo around the line. On by default; off draws the bare stroke. */
  glow?: boolean;
  /** Samples drawn per frame. Shorter shows the waveform, longer shows the envelope.
   *  Never the whole analyser buffer: the trigger needs samples to search through. */
  window?: number;
}

/** Draws whatever the analyser is carrying, frame by frame, into a canvas.
 *  The analyser arrives through a callback: an audio file can switch from the element's
 *  own graph to the decoded one (AC-3 and friends) after playback has started. */
export class Oscilloscope {
  private raf = 0;
  private buf: Float32Array<ArrayBuffer> = new Float32Array(2048);
  private line: Float32Array<ArrayBuffer> = new Float32Array(0);
  private readonly window: number;
  private readonly colour: string;
  private readonly glow: boolean;
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
    opts: ScopeOptions = {},
  ) {
    this.window = opts.window ?? 1024;
    this.colour = opts.colour ?? "#e2483d";
    this.glow = opts.glow ?? true;
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  start(): void {
    this.wanted = true;
    if (this.raf || document.hidden) {
      this.draw(); // a paused page still gets the current frame, so it is never blank
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
    const points = Math.min(w, 1200); // one point per device pixel is plenty
    if (analyser) {
      if (this.buf.length !== analyser.fftSize) this.buf = new Float32Array(analyser.fftSize);
      analyser.getFloatTimeDomainData(this.buf);
    } else this.buf.fill(0);
    const window_ = drawWindow(this.buf.length, this.window);
    const offset = triggerOffset(this.buf, window_);
    this.line = scopeLine(this.buf, offset, window_, points, this.line);

    const mid = h / 2;
    const amp = mid * 0.9;
    ctx.beginPath();
    for (let k = 0; k < points; k++) {
      const x = (k / Math.max(1, points - 1)) * w;
      const y = mid - Math.max(-1, Math.min(1, this.line[k]!)) * amp;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    // The glow is the same path stroked a few times, widest and faintest first, added
    // together rather than painted over. shadowBlur would do it in one pass and costs far
    // more per frame on a phone.
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = this.colour;
    const prev = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "lighter";
    for (const [width, alpha] of this.glow ? GLOW_LAYERS : CORE_ONLY) {
      ctx.globalAlpha = alpha;
      ctx.lineWidth = Math.max(1, width * dpr);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = prev;
  }
}
