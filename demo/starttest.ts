// Measures how long the real player takes from mount to the first AUDIBLE decoded sample.
// Fetches ?src= (default /movie.mkv, symlink a file into demo/public) into a Blob first, so
// the timing covers only the player; a click gives the page the activation audio needs.
import { createMediaPlayer } from "../src/index";

const logEl = document.getElementById("log")!;
const log = (s: string): void => {
  console.info(`[starttest] ${s}`);
  logEl.textContent += `\n${s}`;
};
let t0 = 0;
const since = (): string => `${(performance.now() - t0).toFixed(0)}ms`;

// First non-zero sample on the render thread = first sound; then dropouts (>=5 ms of
// zeros) per second, to check seeks and track switches keep it flowing.
const worklet = `registerProcessor("first-sound", class extends AudioWorkletProcessor {
  constructor() { super(); this.done = false; this.zeros = 0; this.gaps = 0; this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      if (ch[i] === 0) { this.zeros++; continue; }
      if (!this.done) { this.done = true; this.port.postMessage({ first: true }); }
      if (this.zeros >= 240) this.gaps++;
      this.zeros = 0;
    }
    this.n += ch.length;
    if (this.done && this.n >= sampleRate) { this.port.postMessage({ gaps: this.gaps }); this.n = 0; this.gaps = 0; }
    return true;
  }
});`;
(globalThis as unknown as Record<string, unknown>).__mediaplayDebugTap = (ctx: AudioContext, gain: GainNode) => {
  log(`engine created at ${since()}`);
  void (async () => {
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([worklet], { type: "text/javascript" })));
    const det = new AudioWorkletNode(ctx, "first-sound");
    gain.connect(det);
    const mute = ctx.createGain();
    mute.gain.value = 0;
    det.connect(mute).connect(ctx.destination);
    const video = document.querySelector("video")!;
    det.port.onmessage = (e) => {
      if (e.data.first) log(`FIRST SOUND at ${since()} (ctx ${ctx.state})`);
      else log(`vt=${video.currentTime.toFixed(2)} gaps=${e.data.gaps}`);
    };
  })();
};

const src = new URLSearchParams(location.search).get("src") || "/movie.mkv";
const t = performance.now();
const blob = await (await fetch(src)).blob();
log(`fetched ${(blob.size / 1e6).toFixed(0)} MB in ${((performance.now() - t) / 1000).toFixed(1)}s; click the button`);
document.getElementById("go")!.addEventListener("click", () => {
  t0 = performance.now();
  createMediaPlayer(document.getElementById("player")!, { blob, mime: "video/x-matroska", filename: "movie.mkv" });
  log("mounted");
});
