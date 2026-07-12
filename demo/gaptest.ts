// Instrumented reproduction of the synced-audio path. Fetches /movie.mkv (drop a
// symlink into demo/public), plays it muted in a <video>, decodes the E-AC-3 track via
// playSyncedAudio (the exact production path), and MEASURES the rendered audio on the
// audio render thread: an AudioWorklet counts dropout runs (>=240 zero samples = 5ms)
// per second. A 50ms heartbeat measures main-thread jank. Everything logs as [gaptest].
import { playSyncedAudio } from "../src/synced-audio";

const logEl = document.getElementById("log")!;
const video = document.getElementById("v") as HTMLVideoElement;
const lines: string[] = [];
function log(s: string): void {
  console.info(`[gaptest] ${s}`);
  lines.push(s);
  if (lines.length > 40) lines.shift();
  logEl.textContent = lines.join("\n");
}

// Gap detector: runs on the audio render thread, immune to main-thread jank.
const workletCode = `
class GapDetector extends AudioWorkletProcessor {
  constructor() {
    super();
    this.zeroRun = 0; this.gaps = 0; this.longest = 0; this.frames = 0;
    this.sumSq = 0; this.n = 0; this.started = false;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        const v = ch[i];
        this.sumSq += v * v; this.n++;
        if (v === 0) {
          this.zeroRun++;
        } else {
          this.started = true;
          if (this.zeroRun >= 240) { this.gaps++; if (this.zeroRun > this.longest) this.longest = this.zeroRun; }
          this.zeroRun = 0;
        }
      }
      this.frames += ch.length;
      if (this.frames >= sampleRate) {
        this.port.postMessage({ gaps: this.gaps, longestMs: (this.longest / sampleRate) * 1000, rms: Math.sqrt(this.sumSq / this.n), started: this.started });
        this.frames = 0; this.gaps = 0; this.longest = 0; this.sumSq = 0; this.n = 0;
      }
    }
    return true;
  }
}
registerProcessor("gap-detector", GapDetector);
`;

let tapReady: Promise<void> | null = null;
(globalThis as unknown as Record<string, unknown>).__mediaplayDebugTap = (ctx: AudioContext, gain: GainNode) => {
  tapReady = (async () => {
    const url = URL.createObjectURL(new Blob([workletCode], { type: "text/javascript" }));
    await ctx.audioWorklet.addModule(url);
    const det = new AudioWorkletNode(ctx, "gap-detector");
    gain.connect(det); // parallel tap; detector outputs nothing audible
    const sink = ctx.createGain();
    sink.gain.value = 0;
    det.connect(sink);
    sink.connect(ctx.destination);
    let sec = 0;
    det.port.onmessage = (e) => {
      const { gaps, longestMs, rms, started } = e.data as { gaps: number; longestMs: number; rms: number; started: boolean };
      sec++;
      log(
        `t=${sec}s gaps=${gaps} longest=${longestMs.toFixed(0)}ms rms=${rms.toFixed(4)} started=${started} ` +
          `vt=${video.currentTime.toFixed(2)} vready=${video.readyState} jankMax=${jankMax.toFixed(0)}ms`,
      );
      jankMax = 0;
    };
    log("worklet tap attached");
  })();
};

// Main-thread jank heartbeat.
let jankMax = 0;
let last = performance.now();
setInterval(() => {
  const now = performance.now();
  const lag = now - last - 50;
  if (lag > jankMax) jankMax = lag;
  last = now;
}, 50);

async function run(): Promise<void> {
  log("fetching /movie.mkv …");
  const t0 = performance.now();
  const res = await fetch("/movie.mkv");
  if (!res.ok) {
    log(`FETCH FAILED ${res.status} — symlink the movie to demo/public/movie.mkv`);
    return;
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  log(`fetched ${(bytes.length / 1e6).toFixed(0)} MB in ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  video.src = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "video/x-matroska" }));
  video.muted = true;
  await video.play().catch((e) => log(`video.play blocked: ${e}`));
  log(`video playing=${!video.paused}`);

  const base = new URL("/libav/", location.href).toString();
  const handle = await playSyncedAudio(video, bytes, 0, base);
  log(`playSyncedAudio -> ${handle === "undecodable" ? "undecodable" : handle ? "playing" : "no track"}`);
  await tapReady;
}

void run();
