import { decodeSubtitleBytes, extractMkvInfo, subtitleFileToVtt, type MkvAudioTrack, type MkvInfo } from "./mkv";
import type { DirectAudioInfo } from "./synced-audio";
import { strings, type MediaStrings } from "./i18n";
import type { SyncedAudioHandle } from "./synced-audio";
import { registerAlacDecoder, setAlacBase } from "./alac-decoder";
import type { Thumbnailer } from "./thumbs";

// Matroska audio CodecID -> a MIME to probe the browser with. Only the codecs a browser
// might refuse (the Dolby / DTS family) need probing; everything else (AAC, MP3, Opus,
// Vorbis, FLAC, PCM) plays. When the browser lacks one of these decoders, an in-memory
// transcode can't rescue it either: WebCodecs shares the same platform decoders, so it
// would fail to decode the source too. Hence we detect and inform rather than transcode.
const AUDIO_PROBE: Record<string, string> = {
  A_EAC3: 'audio/mp4; codecs="ec-3"',
  A_AC3: 'audio/mp4; codecs="ac-3"',
  A_DTS: 'audio/mp4; codecs="dtsc"',
  A_TRUEHD: "audio/true-hd",
  A_MLP: "audio/mlp",
};

/** True when the browser has no decoder for this Matroska audio codec (video still plays silently). */
function browserLacksAudioCodec(codec: string, probe: HTMLMediaElement): boolean {
  const mime = AUDIO_PROBE[codec.toUpperCase()];
  return mime ? probe.canPlayType(mime) === "" : false;
}

// Read-only audio/video player. Plays the bytes via a blob URL in a <video> or <audio>
// element (chosen by MIME). Codec support is whatever the platform browser provides; when
// direct playback fails, the file is remuxed in memory (mediabunny, lazy chunk) into a
// container the browser accepts — no re-encode, the document bytes stay untouched — and
// only if that also fails does the clear "not supported" message show.
// Player shortcuts: space/K play-pause, F fullscreen (video), M mute, arrows seek/volume,
// Home/End jump; handled on the wrapper so they work wherever focus sits in the player.

const STYLE_ID = "mediaplay-style";

/** The file to play. */
export interface MediaSource {
  /** The media, ideally as a disk-backed Blob/File so playback, remux and extraction read it
   * on demand instead of holding the whole (multi-GB) file in RAM. `bytes` is still accepted
   * for callers that already have the data in memory; provide one or the other. */
  blob?: Blob;
  bytes?: Uint8Array;
  /** MIME type; decides <audio> vs <video> and seeds the blob type. */
  mime?: string;
  /** File name (currently informational; reserved for future export naming). */
  filename?: string;
}

/** Where the libass (SubtitlesOctopus) worker + fallback font are served from. */
export interface LibassAssets {
  /** Same-origin URL of subtitles-octopus-worker.js (its .wasm sits beside it). */
  workerUrl?: string;
  /** URL of the Latin fallback font (default.woff2). */
  fontUrl?: string;
  /** Extra font URLs for libass (e.g. a CJK font); merged with any fonts embedded in the file. */
  fonts?: string[];
}

export interface MediaPlayerOptions {
  /** Called with a human-readable message when playback fails irrecoverably. */
  onError?: (message: string) => void;
  /** Override individual UI strings (a host with its own translations wins here). */
  strings?: Partial<MediaStrings>;
  /** Libass asset URLs; default to octopus/… relative to document.baseURI. */
  libass?: LibassAssets;
  /** AC-3/E-AC-3 libav decoder assets; `base` is the served dir (default libav/ under baseURI). */
  libav?: { base?: string };
  /** ALAC decoder assets; `base` is the served dir (default alac/ under baseURI). */
  alac?: { base?: string };
  /** Embedded mode (host drives the player, e.g. a subtitle editor): suppress the
   * document-level keyboard shortcuts and the CC/tracks button so the host owns both. */
  embedded?: boolean;
  /** Video control bar: ours (default) or the browser's. Ours looks the same everywhere and
   * owns its timeline. Audio, and embedded mode, default to the native bar. */
  controls?: "own" | "native";
  /** Hover previews on our timeline (video, our bar only). Default: on, off when embedded,
   * where the host has its own timeline. */
  thumbnails?: boolean;
}

export interface MediaPlayerHandle {
  /** The original document bytes (the player never mutates them). */
  getBytes(): Uint8Array | undefined;
  /** The underlying <video>/<audio> element, for hosts that drive playback (seek,
   * currentTime, play/pause). Undefined until mounted, or for an empty source. */
  getMediaElement(): HTMLMediaElement | undefined;
  /** Show subtitles from raw text (SRT/VTT/ASS/SSA by filename), replacing any previously
   * set with this method. For live preview of an edited document; video sources only. */
  setSubtitleText(content: string, filename: string): void;
  /** Move keyboard focus into the player. */
  focus(): void;
  /** Tear down: stop playback, revoke blob URLs, remove listeners and DOM. */
  destroy(): void;
}

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-media { height:100%; overflow:auto; background:#000; position:relative;
      display:flex; align-items:center; justify-content:center; outline:none;
      user-select:none; -webkit-user-select:none; -webkit-tap-highlight-color:transparent; }
    /* Column: the bar sits under the picture, where it needs no tap to appear. In
       fullscreen it goes back to floating over the video, like every player does. */
    .ot-media-stage { position:relative; display:flex; flex-direction:column; max-width:100%; max-height:100%; }
    .ot-media-stage video { min-height:0; }
    .ot-media video { max-width:100%; max-height:100%; }
    /* F fullscreens the whole player (wrap), so the libass canvas and the overlays
       ride along; the video then fills the screen with letterboxing. */
    .ot-media:fullscreen .ot-media-stage { width:100%; height:100%; }
    .ot-media:fullscreen video { width:100%; height:100%; max-width:none; max-height:none; object-fit:contain; }
    /* libass canvas parent: out of the flex flow, pinned to the video's box (octopus
       sets position:relative inline, hence the !important). */
    .ot-media-stage .libassjs-canvas-parent { position:absolute !important; top:0; left:0;
      pointer-events:none; } /* decoration: a tap on a subtitle still reaches the video */
    .ot-media audio { width:min(90%, 520px); }
    .ot-media-msg { color:#bbb; padding:24px; font:14px system-ui, sans-serif; text-align:center; }
    .ot-media-rate { position:absolute; top:14px; right:16px; z-index:1; pointer-events:none;
      background:rgba(20,20,24,0.85); color:#fff; font:600 14px system-ui, sans-serif;
      padding:6px 10px; border-radius:8px; opacity:0; transition:opacity .2s; }
    .ot-media-rate.show { opacity:1; }
    .ot-media-toast { position:absolute; top:14px; left:50%; transform:translateX(-50%); z-index:2;
      max-width:min(80%, 560px); background:rgba(20,20,24,0.9); color:#fff; font:600 13px system-ui, sans-serif;
      padding:8px 14px; border-radius:8px; text-align:center; line-height:1.4; opacity:0; transition:opacity .3s; }
    .ot-media-toast.show { opacity:1; }
    .ot-media-tracksbtn { position:absolute; top:12px; left:14px; z-index:2;
      background:rgba(20,20,24,0.85); color:#fff; font:600 13px system-ui, sans-serif;
      padding:6px 10px; border:1px solid rgba(255,255,255,0.25); border-radius:8px; cursor:pointer;
      transition:opacity .25s; }
    /* Only where a pointer can actually hover: on a touch screen :hover sticks after a
       tap, leaving a grey block on the button that was last pressed. */
    @media (hover: hover) { .ot-media-tracksbtn:hover { background:rgba(50,50,58,0.9); } }
    .ot-media-fsbtn { left:84px; font-size:15px; line-height:1; padding:5px 9px; }
    /* The native button fullscreens the bare video, where the styled-subtitle canvas
       cannot follow; ours fullscreens the whole player instead (only where we can). */
    .ot-media-ownfs video::-webkit-media-controls-fullscreen-button { display:none; }
    /* Fullscreen with an idle mouse: hide our chrome like the native controls do. */
    .ot-media.ot-media-idle { cursor:none; }
    .ot-media.ot-media-idle .ot-media-tracksbtn { opacity:0; pointer-events:none; }
    .ot-media:fullscreen.ot-media-idle .ot-media-bar { opacity:0; pointer-events:none; }
    .ot-media-bar { container-type:inline-size; z-index:2; box-sizing:border-box; width:100%;
      user-select:none; -webkit-user-select:none; -webkit-tap-highlight-color:transparent;
      display:flex; align-items:center; gap:10px; padding:8px 12px; color:#fff;
      font:12px system-ui, sans-serif; transition:opacity .25s; background:#16161c; }
    .ot-media:fullscreen .ot-media-bar { position:absolute; left:0; right:0; bottom:0;
      padding:14px 12px 8px; background:linear-gradient(rgba(0,0,0,0), rgba(0,0,0,0.75)); }
    .ot-media-barbtn { flex:none; background:none; border:0; color:inherit; font:inherit; font-size:15px;
      line-height:1; padding:5px 6px; border-radius:6px; cursor:pointer; }
    @media (hover: hover) { .ot-media-barbtn:hover { background:rgba(255,255,255,0.18); } }
    .ot-media-barbtn svg { display:block; }
    .ot-media-timeline { position:relative; flex:1 1 40px; min-width:40px; height:16px; cursor:pointer; touch-action:none; }
    /* The groove; the played/buffered bars and the knob sit on top of it. */
    .ot-media-timeline::before { content:""; position:absolute; left:0; right:0; top:6px; height:4px;
      border-radius:2px; background:rgba(255,255,255,0.3); }
    .ot-media-buffered, .ot-media-played { position:absolute; left:0; top:6px; height:4px; width:0; border-radius:2px; }
    .ot-media-buffered { background:rgba(255,255,255,0.45); }
    .ot-media-played { background:#e2483d; }
    .ot-media-knob { position:absolute; top:2px; left:0; width:12px; height:12px; margin-left:-6px;
      border-radius:50%; background:#e2483d; }
    .ot-media-barbtn:focus-visible, .ot-media-timeline:focus-visible, .ot-media-vol:focus-visible,
    .ot-media-tracksbtn:focus-visible, .ot-media-bigplay:focus-visible { outline:2px solid #fff; outline-offset:2px; }
    @media (prefers-reduced-motion: reduce) {
      .ot-media-bar, .ot-media-tracksbtn, .ot-media-rate, .ot-media-toast { transition:none; }
    }
    /* Fullscreen: a play/pause target in the middle of the screen, where a thumb is,
       rather than only the small one in the corner of the bar. */
    .ot-media-bigplay { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
      z-index:2; display:none; align-items:center; justify-content:center; width:76px; height:76px;
      padding:0; border:0; border-radius:50%; color:#fff; cursor:pointer;
      background:rgba(20,20,24,0.55); transition:opacity .25s; }
    .ot-media-bigplay svg { width:38px; height:38px; }
    .ot-media:fullscreen:not(.ot-media-idle) .ot-media-bigplay { display:flex; }
    .ot-media-preview[hidden] { display:none; }
    .ot-media-preview { position:absolute; bottom:22px; transform:translateX(-50%); pointer-events:none;
      display:flex; flex-direction:column; align-items:center; gap:3px; padding:4px;
      background:rgba(20,20,24,0.92); border:1px solid rgba(255,255,255,0.25); border-radius:8px; }
    .ot-media-preview canvas { display:block; width:min(160px, 38vw); height:auto; border-radius:4px; background:#000; }
    .ot-media-preview span { font:600 11px system-ui, sans-serif; color:#fff; font-variant-numeric:tabular-nums; }
    .ot-media-clock { flex:none; font-variant-numeric:tabular-nums; white-space:nowrap; }
    .ot-media-volwrap { position:relative; flex:none; display:flex; }
    .ot-media-volpop { position:absolute; bottom:calc(100% + 6px); left:50%; transform:translateX(-50%);
      z-index:3; padding:10px 6px; background:rgba(24,24,30,0.97);
      border:1px solid rgba(255,255,255,0.2); border-radius:10px; }
    .ot-media-volpop[hidden] { display:none; }
    /* Vertical slider: writing-mode is the modern way, the appearance is the old fallback. */
    .ot-media-vol { writing-mode:vertical-lr; direction:rtl; -webkit-appearance:slider-vertical;
      width:20px; height:96px; accent-color:#fff; }
    .ot-media-ratebtn { font:600 12px system-ui, sans-serif; font-variant-numeric:tabular-nums; }
    .ot-media-menu { position:absolute; top:44px; left:14px; z-index:3; width:max-content; max-width:min(280px, 80vw);
      background:rgba(24,24,30,0.97); color:#eee; font:13px system-ui, sans-serif;
      border:1px solid rgba(255,255,255,0.2); border-radius:10px; padding:6px; }
    .ot-media-menu h4 { margin:4px 8px; font-size:11px; text-transform:uppercase; letter-spacing:.4px; color:#9aa; }
    .ot-media-menu button { display:block; width:100%; text-align:left; font:inherit; color:inherit;
      background:none; border:0; border-radius:6px; padding:6px 8px; cursor:pointer; }
    @media (hover: hover) { .ot-media-menu button:hover { background:rgba(255,255,255,0.12); } }
    .ot-media-menu button.on::before { content:"✓ "; }
    .ot-media-menu button:not(.on) { padding-left:22px; }
    /* Anchored to our own bar instead of a floating button: above it, right-aligned. */
    .ot-media-menu.ot-media-menu-up { top:auto; left:auto; bottom:52px; right:14px; }
  `;
  document.head.appendChild(s);
}

const SVG = (body: string) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="currentColor">${body}</svg>`;
/** Bar icons, inline so the library stays a single file with no icon font or asset. */
const ICONS = {
  play: SVG('<path d="M8 5v14l11-7z"/>'),
  pause: SVG('<path d="M6 5h4v14H6zm8 0h4v14h-4z"/>'),
  volume: SVG('<path d="M4 9v6h3.5L12 19V5L7.5 9H4z"/><path d="M15 8.8a4 4 0 0 1 0 6.4M17.4 6a7 7 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  muted: SVG('<path d="M4 9v6h3.5L12 19V5L7.5 9H4z"/><path d="m15.5 9.5 5 5m0-5-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>'),
  audio: SVG('<path d="M4 10h2v4H4zm3.5-3h2v10h-2zM11 4h2v16h-2zm3.5 4h2v8h-2zM18 10h2v4h-2z"/>'),
  fullscreen: SVG('<path d="M4 9V4h5v2H6v3H4zm11-5h5v5h-2V6h-3V4zM4 15h2v3h3v2H4v-5zm14 0h2v5h-5v-2h3v-3z"/>'),
};

const SEEK_STEP = 5; // seconds
const VOLUME_STEP = 0.05;
const RATE_STEP = 0.2;
const RATE_KEY = "mediaplay.rate"; // playback speed, remembered across files

/** Rebuild the file keeping only the chosen audio track (stream copy), for audio switching:
 * browsers expose no API to pick among a file's embedded audio tracks. */
async function remuxWithAudioTrack(blob: Blob, keepTrackId: number): Promise<Blob | null> {
  const mb = await import("mediabunny");
  try {
    const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
    const target = new mb.BufferTarget();
    const format = new mb.MkvOutputFormat();
    const output = new mb.Output({ format, target });
    const conversion = await mb.Conversion.init({
      input,
      output,
      audio: (track) => (track.id === keepTrackId ? {} : { discard: true }),
    });
    if (!conversion.isValid) return null;
    await conversion.execute();
    return target.buffer ? new Blob([target.buffer], { type: format.mimeType }) : null;
  } catch {
    return null;
  }
}

/**
 * Repackage the bytes into a browser-friendly container (stream copy where the codec is
 * allowed in the target, WebCodecs transcode where the platform can decode but the copy
 * isn't allowed). Returns null when no target container can represent the tracks.
 */
async function tryRemux(blob: Blob, isAudio: boolean): Promise<Blob | null> {
  const mb = await import("mediabunny");
  // ALAC has no browser decoder outside Safari, so a conversion of one needs ours. This
  // only registers it; the 21 KB of wasm is fetched by the decoder's own init, and only if
  // a track actually turns out to be ALAC. On Safari the file plays natively, no error
  // fires, and this path is never reached at all.
  registerAlacDecoder();
  const targets = isAudio
    ? [new mb.Mp4OutputFormat(), new mb.OggOutputFormat(), new mb.WavOutputFormat()]
    : [new mb.Mp4OutputFormat(), new mb.WebMOutputFormat()];
  for (const format of targets) {
    try {
      const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
      const target = new mb.BufferTarget();
      const output = new mb.Output({ format, target });
      const conversion = await mb.Conversion.init({ input, output });
      if (!conversion.isValid) continue;
      await conversion.execute();
      if (target.buffer) return new Blob([target.buffer], { type: format.mimeType });
    } catch {
      // try the next container
    }
  }
  return null;
}

class MediaPlayer implements MediaPlayerHandle {
  private wrap: HTMLElement | null = null;
  private url: string | null = null;
  private srcBlob: Blob | null = null; // disk-backed source for playback/remux (no full copy in RAM)
  private eagerBytes: Uint8Array | null = null; // set only when the caller passed bytes directly
  private media: HTMLMediaElement | null = null;
  private applyLiveSubtitle: ((content: string, filename: string) => void) | null = null;
  private onDocKey: ((e: KeyboardEvent) => void) | null = null;
  private subUrls: string[] = [];
  private teardown: (() => void)[] = [];
  private decodedAudio: SyncedAudioHandle | null = null;
  private readonly S: MediaStrings;
  private readonly workerUrl: string;
  private readonly fontUrl: string;

  constructor(container: HTMLElement, source: MediaSource, private opts: MediaPlayerOptions) {
    this.S = strings(opts.strings);
    this.workerUrl = opts.libass?.workerUrl ?? new URL("octopus/subtitles-octopus-worker.js", document.baseURI).toString();
    this.fontUrl = opts.libass?.fontUrl ?? new URL("octopus/default.woff2", document.baseURI).toString();
    // Just a string: nothing is fetched until a track actually needs the ALAC decoder.
    setAlacBase(opts.alac?.base ?? new URL("alac/", document.baseURI).toString());
    this.mount(container, source);
  }

  private mount(container: HTMLElement, source: MediaSource): void {
    ensureStyles();
    const S = this.S;
    this.eagerBytes = source.bytes ?? null;
    const mime = source.mime ?? "";
    // Prefer the disk-backed Blob/File; only build one from bytes if that's all we were given.
    this.srcBlob = source.blob ?? (source.bytes && source.bytes.length ? new Blob([source.bytes as BlobPart], mime ? { type: mime } : undefined) : null);
    const wrap = document.createElement("div");
    wrap.className = "ot-media";
    wrap.tabIndex = 0;
    // A mouse click leaves focus on the button it pressed, where Space then activates that
    // button again instead of playing: clicking fullscreen and pressing Space left
    // fullscreen. A pointer click hands focus back to the player; keyboard activation
    // (detail 0) keeps it, so Tab and Space still work through the controls.
    wrap.addEventListener("click", (e) => {
      if (e.detail > 0 && e.target instanceof HTMLElement && e.target.closest("button")) wrap.focus({ preventScroll: true });
    });
    if (this.srcBlob) {
      const srcBlob = this.srcBlob;
      this.url = URL.createObjectURL(srcBlob);
      const isAudio = mime.startsWith("audio/");
      const m = document.createElement(isAudio ? "audio" : "video") as HTMLMediaElement;
      this.media = m;
      m.src = this.url;
      // Embedded hosts (a subtitle editor) keep the native bar unless they ask for ours:
      // they lay out around the player and drive playback themselves.
      const ownBar = !isAudio && (this.opts.controls ?? (this.opts.embedded ? "native" : "own")) === "own";
      m.controls = !ownBar;
      // Inline playback, or iOS hands the video to the system player and our bar is gone.
      if (ownBar) (m as HTMLVideoElement).playsInline = true;
      // Standalone: opening a file is intent to play (policy-blocked = stays paused).
      // Embedded (a subtitle editor): the host decides when to play, so don't autoplay.
      m.autoplay = !this.opts.embedded;
      // Shortcut list goes to assistive tech only; a title tooltip here pops up on
      // every hover over the player, which gets old fast.
      wrap.setAttribute("aria-label", isAudio ? S.mediaKeysAudio : S.mediaKeys);
      // Top-right OSD badge: speed, volume and seek feedback for the keyboard controls.
      const rateBadge = document.createElement("div");
      rateBadge.className = "ot-media-rate";
      let rateTimer = 0;
      const flashBadge = (text: string) => {
        rateBadge.textContent = text;
        rateBadge.classList.add("show");
        window.clearTimeout(rateTimer);
        rateTimer = window.setTimeout(() => rateBadge.classList.remove("show"), 900);
      };
      const fmtClock = (secs: number): string => {
        const s = Math.max(0, Math.floor(secs));
        const h = Math.floor(s / 3600);
        const mn = Math.floor((s % 3600) / 60);
        const sc = s % 60;
        const p = (n: number) => String(n).padStart(2, "0");
        return h ? `${h}:${p(mn)}:${p(sc)}` : `${mn}:${p(sc)}`;
      };
      // Top-centre banner that fades on its own; used for notices like "audio codec
      // unsupported", which shouldn't permanently cover the (still-playing) video.
      const showToast = (text: string, ms = 6500) => {
        const toast = document.createElement("div");
        toast.className = "ot-media-toast";
        toast.textContent = text;
        wrap.appendChild(toast);
        window.requestAnimationFrame(() => toast.classList.add("show"));
        window.setTimeout(() => {
          toast.classList.remove("show");
          window.setTimeout(() => toast.remove(), 350);
        }, ms);
      };
      const flashSeek = () => flashBadge(Number.isFinite(m.duration) ? `${fmtClock(m.currentTime)} / ${fmtClock(m.duration)}` : fmtClock(m.currentTime));
      const flashVolume = () => flashBadge(m.muted ? "🔇" : `🔊 ${Math.round(m.volume * 100)}%`);
      // Playback speed: S slower / D faster, remembered across files (like a player).
      const setRate = (rate: number, show: boolean) => {
        const r = Math.min(4, Math.max(0.2, Math.round(rate * 10) / 10));
        m.playbackRate = r;
        try {
          localStorage.setItem(RATE_KEY, String(r));
        } catch {
          /* private mode */
        }
        if (show) flashBadge(`${r}×`);
      };
      const savedRate = Number(localStorage.getItem(RATE_KEY));
      if (savedRate && savedRate !== 1) m.addEventListener("loadeddata", () => setRate(savedRate, false), { once: true });
      // Assigned in the video-only tracks section below; C toggles subtitles.
      let toggleSubs: () => void = () => undefined;
      // Our control bar, built after the tracks section below (it hosts no track UI yet);
      // the idle-hide and the click handlers there need to know whether it exists.
      let bar: HTMLElement | null = null;
      let bigPlay: HTMLElement | null = null; // centre play/pause, fullscreen only
      // Every popup in the bar registers here: opening one closes the others.
      const popClosers: (() => void)[] = [];
      const closeAllPops = () => {
        for (const c of popClosers) c();
      };
      const stage = document.createElement("div");
      stage.className = "ot-media-stage";
      stage.appendChild(m);
      const togglePlay = () => {
        if (m.paused) void m.play();
        else m.pause();
      };
      const toggleFullscreen = () => {
        if (document.fullscreenElement) void document.exitFullscreen();
        else void wrap.requestFullscreen?.().catch(() => undefined); // wrap, so subs/overlays come along
      };
      const fail = () => {
        wrap.textContent = "";
        const d = document.createElement("div");
        d.className = "ot-media-msg";
        d.textContent = S.mediaUnsupported;
        wrap.appendChild(d);
        this.opts.onError?.(S.mediaUnsupported);
      };
      let remuxed = false;
      m.addEventListener("error", () => {
        if (remuxed) return fail();
        remuxed = true;
        const note = document.createElement("div");
        note.className = "ot-media-msg";
        note.textContent = S.mediaConverting;
        wrap.appendChild(note);
        tryRemux(srcBlob, isAudio).then(
          (blob) => {
            note.remove();
            if (!blob) return fail();
            if (this.url) URL.revokeObjectURL(this.url);
            this.url = URL.createObjectURL(blob);
            m.src = this.url; // a second error on the remuxed source falls through to fail()
          },
          () => {
            note.remove();
            fail();
          },
        );
      });
      // Document-level, CAPTURE phase, so the shortcuts work no matter where focus sits
      // (the open dialog returns focus to the toolbar, drag-drop leaves it on the body)
      // AND win over the video's native controls: after clicking the timeline, focus is
      // inside the controls' shadow DOM, which otherwise consumes Space (native pause
      // toggle fighting ours) and F before our bubble-phase handler ever saw them.
      // Typing and button/menu interaction is never hijacked.
      this.onDocKey = (e: KeyboardEvent) => {
        // Gone, or hidden by a view switch. NOT offsetParent: the fullscreen top layer
        // makes the wrap position:fixed, where offsetParent is null while fully visible.
        if (!wrap.isConnected) return;
        if (wrap.checkVisibility ? !wrap.checkVisibility() : wrap.offsetParent === null && !document.fullscreenElement) return;
        // Already claimed by someone else (e.g. a speed-controller browser extension
        // handling S/D itself): don't double-handle, or every press fires twice.
        if (e.defaultPrevented) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        // Interactive elements keep their keys (typing, menus, our CC buttons) - except
        // the media element itself: keys on the focused native controls are ours.
        const el = e.target instanceof HTMLElement ? e.target : null;
        if (el && el !== m && el.closest("input, textarea, select, button, a, [contenteditable], [role=dialog], [role=menu], [role=listbox]"))
          return;
        const key = e.key === " " ? " " : e.key.length === 1 ? e.key.toLowerCase() : e.key;
        switch (key) {
          case " ":
          case "k":
            togglePlay();
            break;
          case "f":
            if (isAudio) return;
            toggleFullscreen();
            break;
          case "m":
            m.muted = !m.muted;
            flashVolume();
            break;
          case "s":
            setRate(m.playbackRate - RATE_STEP, true);
            break;
          case "d":
            setRate(m.playbackRate + RATE_STEP, true);
            break;
          case "c":
            toggleSubs();
            break;
          case "ArrowLeft":
            m.currentTime = Math.max(0, m.currentTime - SEEK_STEP);
            flashSeek();
            break;
          case "ArrowRight":
            m.currentTime = Math.min(m.duration || Infinity, m.currentTime + SEEK_STEP);
            flashSeek();
            break;
          case "ArrowUp":
            m.volume = Math.min(1, m.volume + VOLUME_STEP);
            m.muted = false;
            flashVolume();
            break;
          case "ArrowDown":
            m.volume = Math.max(0, m.volume - VOLUME_STEP);
            flashVolume();
            break;
          case "Home":
            m.currentTime = 0;
            flashSeek();
            break;
          case "End":
            if (Number.isFinite(m.duration)) m.currentTime = m.duration;
            flashSeek();
            break;
          default:
            return;
        }
        e.preventDefault();
      };
      // Embedded hosts (a subtitle editor) own the keyboard; skip the global shortcuts.
      if (!this.opts.embedded) document.addEventListener("keydown", this.onDocKey, true);
      // After a pointer interaction with the native controls (e.g. clicking the
      // timeline to seek), return focus to the player: it removes the lingering focus
      // ring on the control and keeps the keyboard model consistent.
      m.addEventListener("pointerup", () => {
        window.setTimeout(() => {
          if (wrap.isConnected) wrap.focus({ preventScroll: true });
        }, 0);
      });
      // The open dialog's focus-restore lands on the toolbar after mount (and Chrome
      // shows the focused button's title tooltip over the video). Pull focus into the
      // player once ready, with retries because the restore can land after us.
      const pullFocus = () => {
        if (wrap.isConnected && !wrap.contains(document.activeElement)) wrap.focus();
      };
      m.addEventListener("loadeddata", pullFocus, { once: true });
      window.setTimeout(pullFocus, 600);
      window.setTimeout(pullFocus, 1500);
      // Tracks (video only): embedded subtitles are extracted to WebVTT <track>s (the
      // video element ignores in-container subs), a menu switches subtitle and audio
      // tracks and loads external .srt/.ass/.vtt files, and C toggles subtitles.
      /** Our control bar: play/pause, timeline with the buffered ranges, clock, volume. */
      const buildBar = (extras: HTMLElement[]): HTMLElement => {
        const el = document.createElement("div");
        el.className = "ot-media-bar";
        const playBtn = document.createElement("button");
        playBtn.type = "button";
        playBtn.className = "ot-media-barbtn";
        playBtn.addEventListener("click", togglePlay);
        const bigBtn = document.createElement("button");
        bigBtn.type = "button";
        bigBtn.className = "ot-media-bigplay";
        bigBtn.addEventListener("click", togglePlay);
        bigPlay = bigBtn;
        const timeline = document.createElement("div");
        timeline.className = "ot-media-timeline";
        timeline.tabIndex = 0;
        timeline.setAttribute("role", "slider");
        timeline.setAttribute("aria-label", S.timeline);
        timeline.setAttribute("aria-valuemin", "0");
        const buffered = document.createElement("div");
        buffered.className = "ot-media-buffered";
        const played = document.createElement("div");
        played.className = "ot-media-played";
        const knob = document.createElement("div");
        knob.className = "ot-media-knob";
        timeline.append(buffered, played, knob);
        const clock = document.createElement("span");
        clock.className = "ot-media-clock";
        // Volume: just the icon in the bar, with the slider in a popup above it, so the
        // timeline keeps the width a phone needs. Mouse: hover opens it, click mutes.
        // Touch: the tap opens it, since there is no hover to open it with.
        const volWrap = document.createElement("div");
        volWrap.className = "ot-media-volwrap";
        const muteBtn = document.createElement("button");
        muteBtn.type = "button";
        muteBtn.className = "ot-media-barbtn";
        const volPop = document.createElement("div");
        volPop.className = "ot-media-volpop";
        volPop.hidden = true;
        const vol = document.createElement("input");
        vol.type = "range";
        vol.className = "ot-media-vol";
        vol.min = "0";
        vol.max = "1";
        vol.step = "0.01";
        vol.setAttribute("aria-label", S.volume);
        vol.addEventListener("input", () => {
          m.volume = Number(vol.value);
          m.muted = Number(vol.value) === 0;
        });
        volPop.appendChild(vol);
        volWrap.append(muteBtn, volPop);
        let volTouch = false;
        popClosers.push(() => (volPop.hidden = true));
        const closeVolOutside = (e: MouseEvent) => {
          if (!volWrap.contains(e.target as Node)) volPop.hidden = true;
        };
        document.addEventListener("click", closeVolOutside);
        this.teardown.push(() => document.removeEventListener("click", closeVolOutside));
        muteBtn.addEventListener("pointerdown", (e) => (volTouch = e.pointerType !== "mouse"));
        muteBtn.addEventListener("pointerenter", (e) => {
          if (e.pointerType !== "mouse") return;
          closeAllPops();
          volPop.hidden = false;
        });
        volWrap.addEventListener("pointerleave", (e) => {
          if ((e as PointerEvent).pointerType === "mouse") volPop.hidden = true;
        });
        muteBtn.addEventListener("click", () => {
          if (!volTouch) {
            m.muted = !m.muted;
            return;
          }
          const open = volPop.hidden;
          closeAllPops();
          volPop.hidden = !open;
        });
        el.append(playBtn, timeline, clock, volWrap, ...extras);

        const pct = (t: number) => (Number.isFinite(m.duration) && m.duration > 0 ? Math.min(100, (t / m.duration) * 100) : 0);
        let scrubAt = -1; // >= 0 while a drag is in progress: the time it is pointing at
        const render = () => {
          const p = pct(scrubAt >= 0 ? scrubAt : m.currentTime);
          played.style.width = `${p}%`;
          knob.style.left = `${p}%`;
          clock.textContent = `${fmtClock(scrubAt >= 0 ? scrubAt : m.currentTime)} / ${Number.isFinite(m.duration) ? fmtClock(m.duration) : "--:--"}`;
          timeline.setAttribute("aria-valuetext", clock.textContent);
          timeline.setAttribute("aria-valuenow", String(Math.floor(m.currentTime)));
          timeline.setAttribute("aria-valuemax", String(Number.isFinite(m.duration) ? Math.floor(m.duration) : 0));
          const end = m.buffered.length ? m.buffered.end(m.buffered.length - 1) : 0;
          buffered.style.width = `${pct(end)}%`;
        };
        const renderState = () => {
          playBtn.innerHTML = m.paused ? ICONS.play : ICONS.pause;
          playBtn.title = m.paused ? S.play : S.pause;
          playBtn.setAttribute("aria-label", playBtn.title);
          playBtn.setAttribute("aria-pressed", String(!m.paused));
          bigBtn.innerHTML = playBtn.innerHTML;
          bigBtn.title = playBtn.title;
          bigBtn.setAttribute("aria-label", playBtn.title);
          muteBtn.innerHTML = m.muted || !m.volume ? ICONS.muted : ICONS.volume;
          muteBtn.title = m.muted ? S.unmute : S.mute;
          muteBtn.setAttribute("aria-label", muteBtn.title);
          muteBtn.setAttribute("aria-pressed", String(m.muted));
          vol.value = String(m.muted ? 0 : m.volume);
        };
        // rAF only while playing, for a timeline that moves smoothly (timeupdate fires ~4/s).
        let raf = 0;
        const loop = () => {
          render();
          raf = requestAnimationFrame(loop);
        };
        const startLoop = () => {
          if (!raf) raf = requestAnimationFrame(loop);
          renderState();
        };
        const stopLoop = () => {
          cancelAnimationFrame(raf);
          raf = 0;
          render();
          renderState();
        };
        m.addEventListener("play", startLoop);
        m.addEventListener("pause", stopLoop);
        m.addEventListener("ended", stopLoop);
        for (const ev of ["loadedmetadata", "timeupdate", "progress", "seeked", "volumechange", "durationchange"])
          m.addEventListener(ev, () => {
            render();
            renderState();
          });
        renderState();
        render();

        // Hover preview: the frame under the pointer, decoded from the source bytes.
        const preview = document.createElement("div");
        preview.className = "ot-media-preview";
        preview.hidden = true;
        preview.setAttribute("aria-hidden", "true");
        const shot = document.createElement("canvas");
        const shotCtx = shot.getContext("2d");
        const stamp = document.createElement("span");
        preview.append(shot, stamp);
        timeline.appendChild(preview);
        const wantThumbs = this.opts.thumbnails ?? !this.opts.embedded;
        let thumbs: Thumbnailer | null = null;
        let thumbsAsked = false;
        let hoverAt = -1;
        let painting = false;
        let prefetched = false;
        const paint = async () => {
          if (painting) return;
          painting = true;
          try {
            while (thumbs && !preview.hidden) {
              const t = hoverAt;
              const frame = await thumbs.get(t);
              if (preview.hidden) break;
              if (hoverAt !== t) continue; // moved on while decoding: draw where we are now
              if (frame) {
                shot.width = frame.width;
                shot.height = frame.height;
                shotCtx?.drawImage(frame, 0, 0);
                // Warm the rest of the timeline only once the hovered frame is on screen:
                // the decoder is single-file, and the pointer must not queue behind it.
                if (!prefetched && Number.isFinite(m.duration)) {
                  prefetched = true;
                  void thumbs.prefetch(m.duration);
                }
                break;
              }
              await new Promise((r) => window.setTimeout(r, 100)); // a decode is running
            }
          } finally {
            painting = false;
          }
        };
        const timeAt = (clientX: number): number | null => {
          const r = timeline.getBoundingClientRect();
          if (!r.width || !Number.isFinite(m.duration)) return null;
          return Math.min(m.duration, Math.max(0, ((clientX - r.left) / r.width) * m.duration));
        };
        const hover = (clientX: number) => {
          const t = timeAt(clientX);
          if (t === null) return;
          const r = timeline.getBoundingClientRect();
          hoverAt = t;
          preview.hidden = false;
          // Clamp against the bar: on a phone the timeline is narrower than the preview.
          const box = (preview.parentElement?.parentElement ?? timeline).getBoundingClientRect();
          const half = preview.offsetWidth / 2 || 85;
          const x = Math.min(box.right - 4 - half, Math.max(box.left + 4 + half, clientX));
          preview.style.left = `${x - r.left}px`;
          stamp.textContent = fmtClock(t);
          if (!thumbsAsked) {
            thumbsAsked = true;
            void import("./thumbs").then(async ({ createThumbnailer }) => {
              if (!this.wrap || !srcBlob) return;
              thumbs = await createThumbnailer(srcBlob);
              this.teardown.push(() => thumbs?.destroy());
              void paint();
            });
          }
          void paint();
        };
        if (wantThumbs) {
          timeline.addEventListener("pointermove", (e) => hover(e.clientX));
          timeline.addEventListener("pointerleave", () => (preview.hidden = true));
          for (const ev of ["pointerup", "pointercancel"])
            timeline.addEventListener(ev, (e) => {
              if ((e as PointerEvent).pointerType !== "mouse") preview.hidden = true;
            });
        }

        // Scrubbing: pointer capture so a drag keeps working outside the bar's box. The
        // drag only moves the handle and the preview; the video is seeked when the finger
        // lifts, so the picture does not jump about while the preview already shows it.
        const aimAt = (clientX: number) => {
          const t = timeAt(clientX);
          if (t === null) return;
          scrubAt = t;
          render();
        };
        // The drag is tracked by pointer id rather than by the capture state: if capture
        // is refused, the drag still ends properly instead of sticking to the pointer.
        let scrubId = -1;
        timeline.addEventListener("pointerdown", (e) => {
          scrubId = e.pointerId;
          try {
            timeline.setPointerCapture(e.pointerId);
          } catch {
            /* capture refused: the window listeners below still finish the drag */
          }
          e.preventDefault(); // no text selection, and no drag of the bar itself
          closeAllPops(); // preventDefault also swallows the click that would close them
          aimAt(e.clientX);
        });
        const moveScrub = (e: PointerEvent) => {
          if (e.pointerId === scrubId) aimAt(e.clientX);
        };
        const endScrub = (e: PointerEvent) => {
          if (e.pointerId !== scrubId) return;
          scrubId = -1;
          try {
            timeline.releasePointerCapture(e.pointerId);
          } catch {
            /* never captured */
          }
          if (scrubAt >= 0) m.currentTime = scrubAt;
          scrubAt = -1;
          render();
        };
        timeline.addEventListener("pointermove", moveScrub);
        window.addEventListener("pointermove", moveScrub); // drag beyond the bar
        window.addEventListener("pointerup", endScrub);
        window.addEventListener("pointercancel", endScrub);
        this.teardown.push(() => {
          window.removeEventListener("pointermove", moveScrub);
          window.removeEventListener("pointerup", endScrub);
          window.removeEventListener("pointercancel", endScrub);
        });
        this.teardown.push(stopLoop);
        return el;
      };
      if (!isAudio) {
        interface SubEntry {
          label: string;
          lang: string;
          vtt: string;
          /** Full .ass text: selected tracks render styled via libass (lazy WASM). */
          assDoc?: string;
          el: HTMLTrackElement | null;
        }
        const subTracks: SubEntry[] = [];
        let activeSub = -1;
        let lastSub = 0;
        let audioTracks: MkvAudioTrack[] = [];
        let mkvInfo: MkvInfo | null = null;
        // Routing info for the DTS/TrueHD direct-decode path (Matroska only).
        const directFor = (i: number): DirectAudioInfo | undefined => {
          const t = audioTracks[i];
          return t && mkvInfo ? { mkvTrackNumber: t.number, mkvCodec: t.codec, info: mkvInfo } : undefined;
        };
        let activeAudio = 0;
        // Fonts handed to libass so styled subs use the intended faces (fonts embedded in
        // the file + any the host supplied); populated once track info is parsed, below.
        let libassFonts: string[] = [...(this.opts.libass?.fonts ?? [])];
        let octopus: { dispose(): void; resize?: () => void } | null = null;
        let octopusFor = -1;
        const dropOctopus = () => {
          try {
            octopus?.dispose();
          } catch {
            /* worker already gone */
          }
          octopus = null;
          octopusFor = -1;
          wrap.querySelector(".libassjs-canvas-parent")?.remove(); // stage child
        };
        this.teardown.push(dropOctopus);
        // Styled ASS rendering via SubtitlesOctopus (libass WASM, same-origin worker
        // assets under octopus/). Falls back to the plain-text VTT track on failure.
        const startOctopus = async (i: number) => {
          const entry = subTracks[i]!;
          try {
            const mod = await import("@jellyfin/libass-wasm");
            if (!this.wrap || activeSub !== i) return; // switched away while loading
            const SubtitlesOctopus = mod.default;
            octopus = new SubtitlesOctopus({
              video: m as HTMLVideoElement,
              subContent: entry.assDoc!,
              workerUrl: this.workerUrl,
              fallbackFont: this.fontUrl,
              fonts: libassFonts.length ? libassFonts : undefined,
              onError: () => {
                dropOctopus();
                showVttFallback(i);
              },
            });
            octopusFor = i;
          } catch {
            showVttFallback(i);
          }
        };
        const showVttFallback = (i: number) => {
          if (activeSub !== i) return;
          const entry = subTracks[i]!;
          if (!entry.el) entry.el = attachTrackEl(entry);
          entry.el.track.mode = "showing";
        };
        // When only the bare video is fullscreen (a state we failed to upgrade, below),
        // no sibling canvas can follow; bridge styled subs with the in-video text track.
        const bridgeSubs = () => {
          const entry = activeSub >= 0 ? subTracks[activeSub] : undefined;
          if (!entry || !octopus) return;
          if (document.fullscreenElement === m) {
            if (!entry.el) entry.el = attachTrackEl(entry);
            entry.el.track.mode = "showing";
          } else if (entry.el) {
            entry.el.track.mode = "disabled";
          }
        };

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ot-media-tracksbtn";
        btn.textContent = "CC ▾";
        btn.title = S.tracksMenu;
        btn.setAttribute("aria-label", S.tracksMenu);
        // One popup per button: subtitles, audio and speed each get their own, instead of
        // one menu piling up three unrelated lists. The native bar keeps a combined one.
        type MenuKind = "subs" | "audio" | "speed";
        const pops: { el: HTMLElement; btn: HTMLElement; kinds: MenuKind[] }[] = [];
        let audioBtn: HTMLButtonElement | null = null;
        const closePops = closeAllPops;
        const placePop = (el: HTMLElement, anchor: HTMLElement) => {
          if (!bar) return; // the floating menu keeps its CSS position
          const s = stage.getBoundingClientRect();
          const b = anchor.getBoundingClientRect();
          el.style.bottom = `${Math.round(s.bottom - bar.getBoundingClientRect().top + 8)}px`;
          const w = el.offsetWidth;
          el.style.left = `${Math.round(Math.min(s.width - w - 8, Math.max(8, b.left + b.width / 2 - s.left - w / 2)))}px`;
        };
        const makePop = (anchor: HTMLButtonElement, kinds: MenuKind[]): HTMLElement => {
          const el = document.createElement("div");
          el.className = "ot-media-menu";
          el.setAttribute("role", "menu");
          el.hidden = true;
          // aria-expanded must follow every path that closes the menu, not just the button.
          const obs = new MutationObserver(() => anchor.setAttribute("aria-expanded", String(!el.hidden)));
          obs.observe(el, { attributes: true, attributeFilter: ["hidden"] });
          this.teardown.push(() => obs.disconnect());
          anchor.setAttribute("aria-haspopup", "true");
          anchor.setAttribute("aria-expanded", "false");
          anchor.addEventListener("click", () => {
            const open = el.hidden;
            closePops();
            if (!open) return;
            fillMenu(el, kinds);
            el.hidden = false;
            placePop(el, anchor);
          });
          pops.push({ el, btn: anchor, kinds });
          popClosers.push(() => (el.hidden = true));
          fillMenu(el, kinds);
          return el;
        };
        const closeMenu = (e: MouseEvent) => {
          const t = e.target as Node;
          for (const p of pops) if (!p.el.hidden && !p.el.contains(t) && !p.btn.contains(t)) p.el.hidden = true;
        };
        document.addEventListener("click", closeMenu);
        this.teardown.push(() => document.removeEventListener("click", closeMenu));

        // Hide our chrome (and the cursor) after 2.5s of mouse idle, like the native
        // controls do: in fullscreen always, and over a playing video once we own the bar.
        let idleTimer = 0;
        const poke = () => {
          wrap.classList.remove("ot-media-idle");
          window.clearTimeout(idleTimer);
          if (document.fullscreenElement === wrap)
            idleTimer = window.setTimeout(() => {
              if (pops.every((p) => p.el.hidden)) wrap.classList.add("ot-media-idle");
            }, 2500);
        };
        wrap.addEventListener("pointermove", poke);

        // Double-click toggles fullscreen (like F); without this, Chrome's native
        // handler fullscreens the bare video where none of our overlays can live.
        m.addEventListener("dblclick", (e) => {
          const r = m.getBoundingClientRect();
          if (!bar && e.clientY > r.bottom - 70) return; // over the native control bar
          e.preventDefault();
          window.clearTimeout(clickTimer); // the two clicks must not also toggle playback
          toggleFullscreen();
        });
        // Click the picture to play/pause, delayed so a double click only fullscreens. A
        // touch tap shows or hides the bar instead, as every phone player does.
        let clickTimer = 0;
        let touched = false;
        let wasIdle = false;
        m.addEventListener("pointerdown", (e) => {
          touched = e.pointerType !== "mouse";
          // A finger never lands perfectly still: the move pokes the chrome visible before
          // the click arrives, so the tap must toggle from the state it started in.
          wasIdle = wrap.classList.contains("ot-media-idle");
        });
        m.addEventListener("click", () => {
          if (!bar) return;
          window.clearTimeout(clickTimer);
          if (touched && document.fullscreenElement) {
            if (wasIdle) poke();
            else wrap.classList.add("ot-media-idle");
            return;
          }
          clickTimer = window.setTimeout(togglePlay, 220);
        });

        // Any native path that still fullscreens the bare video (the controls' own
        // fullscreen button) is upgraded to wrap fullscreen. Request wrap DIRECTLY (it
        // contains the video, so fullscreen just moves up to it): exiting first and then
        // re-requesting loses the user activation, so the re-request is rejected and the
        // player drops out of fullscreen entirely. If the direct upgrade still fails, the
        // video stays fullscreen with bridged subs, which never reverts.
        let upgrading = false;
        const onFsChange = () => {
          poke();
          if (document.fullscreenElement === m && !upgrading) {
            upgrading = true;
            wrap.requestFullscreen().then(
              () => (upgrading = false),
              () => {
                upgrading = false;
                bridgeSubs(); // couldn't upgrade: keep the video fullscreen with subtitles
              },
            );
            return;
          }
          bridgeSubs();
          // Nudge libass once the fullscreen layout settles (its own listeners can
          // fire before the video has its final box).
          window.setTimeout(() => octopus?.resize?.(), 250);
        };
        document.addEventListener("fullscreenchange", onFsChange);
        this.teardown.push(() => document.removeEventListener("fullscreenchange", onFsChange));

        const fileInput = document.createElement("input");
        fileInput.type = "file";
        fileInput.accept = ".srt,.vtt,.ass,.ssa";
        fileInput.hidden = true;
        fileInput.addEventListener("change", async () => {
          const f = fileInput.files?.[0];
          fileInput.value = "";
          closePops();
          if (!f) return;
          try {
            const raw = new Uint8Array(await f.arrayBuffer());
            const vtt = subtitleFileToVtt(f.name, raw);
            const isAss = /\.(ass|ssa)$/i.test(f.name);
            addSubTrack(
              { label: f.name.replace(/\.[^.]+$/, ""), lang: "und", vtt, assDoc: isAss ? decodeSubtitleBytes(raw) : undefined },
              true,
            );
          } catch {
            /* unreadable subtitle file */
          }
        });

        const attachTrackEl = (entry: SubEntry): HTMLTrackElement => {
          const track = document.createElement("track");
          track.kind = "subtitles";
          track.label = entry.label;
          track.srclang = entry.lang;
          const url = URL.createObjectURL(new Blob([entry.vtt], { type: "text/vtt" }));
          this.subUrls.push(url);
          track.src = url;
          m.appendChild(track);
          return track;
        };
        const setSub = (i: number) => {
          activeSub = i;
          if (i >= 0) lastSub = i;
          if (octopusFor !== i) dropOctopus();
          const target = i >= 0 ? subTracks[i] : undefined;
          // ASS tracks render styled via libass; the file's embedded fonts (and any host
          // fonts) are handed to it, so CJK signs/songs use the intended faces, not tofu.
          const styled = !!target?.assDoc;
          subTracks.forEach((entry, j) => {
            if (entry.el) entry.el.track.mode = j === i && !styled ? "showing" : "disabled";
          });
          if (target && !styled && !target.el) {
            target.el = attachTrackEl(target);
            target.el.track.mode = "showing";
          }
          if (target && styled && octopusFor !== i) void startOctopus(i);
          rebuildMenu();
        };
        toggleSubs = () => {
          if (subTracks.length) setSub(activeSub >= 0 ? -1 : Math.min(lastSub, subTracks.length - 1));
        };
        const addSubTrack = (entry: Omit<SubEntry, "el">, select: boolean) => {
          subTracks.push({ ...entry, el: null });
          if (select) setSub(subTracks.length - 1);
          else rebuildMenu();
        };

        // Host-driven live subtitle: one dedicated track, replaced (not accumulated) on
        // each call, for previewing an edited document. Updates a running libass render
        // in place when possible so ASS previews don't restart the worker each keystroke.
        let liveIndex = -1;
        this.applyLiveSubtitle = (content: string, filename: string) => {
          let vtt: string;
          try {
            vtt = subtitleFileToVtt(filename, new TextEncoder().encode(content));
          } catch {
            return; // unparseable mid-edit; keep the last good render
          }
          const assDoc = /\.(ass|ssa)$/i.test(filename) ? content : undefined;
          if (liveIndex < 0) {
            addSubTrack({ label: S.subtitles, lang: "und", vtt, assDoc }, true);
            liveIndex = subTracks.length - 1;
            return;
          }
          const entry = subTracks[liveIndex]!;
          entry.vtt = vtt;
          entry.assDoc = assDoc;
          const live = octopus as { setTrack?: (s: string) => void; setCurrentTime?: (t: number) => void; lastRenderTime?: number } | null;
          if (assDoc && octopusFor === liveIndex && live?.setTrack) {
            live.setTrack(assDoc);
            if (m.paused) {
              // Paused: setTrack alone doesn't repaint, and octopus drops a render whose
              // timestamp isn't greater than the last drawn frame's. Clear that guard and
              // nudge the render time forward so octopus draws the new content at the
              // current position, whether the cue moved off (renders empty -> the canvas
              // is cleared first) or was repositioned / retexted (renders in the new spot).
              if (typeof live.lastRenderTime === "number") live.lastRenderTime = -1;
              live.setCurrentTime?.(m.currentTime + 0.001);
            }
            // Playing: the render loop repaints on the next frame; setTrack is enough.
            return;
          }
          if (entry.el) {
            URL.revokeObjectURL(entry.el.src);
            entry.el.remove();
            entry.el = null;
          }
          if (activeSub === liveIndex) {
            dropOctopus();
            setSub(liveIndex);
          }
        };

        const switchAudio = async (i: number) => {
          closePops();
          if (i === activeAudio) return;
          // Decoded-audio mode: every track is browser-undecodable, so restart the libav
          // decoder on the newly chosen track rather than remuxing.
          if (this.decodedAudio) {
            activeAudio = i;
            this.decodedAudio.destroy();
            this.decodedAudio = null;
            rebuildMenu();
            await this.startDecodedAudio(m, i, showToast, directFor(i));
            return;
          }
          const note = document.createElement("div");
          note.className = "ot-media-msg";
          note.textContent = S.mediaConverting;
          wrap.appendChild(note);
          const blob = await remuxWithAudioTrack(srcBlob, audioTracks[i]!.number);
          note.remove();
          if (!blob || !this.wrap) return;
          const pos = m.currentTime;
          const wasPaused = m.paused;
          const rate = m.playbackRate;
          if (this.url) URL.revokeObjectURL(this.url);
          this.url = URL.createObjectURL(blob);
          m.src = this.url;
          m.addEventListener(
            "loadeddata",
            () => {
              m.currentTime = pos;
              m.playbackRate = rate;
              if (!wasPaused) void m.play();
              else m.pause(); // autoplay would otherwise restart a paused player
            },
            { once: true },
          );
          activeAudio = i;
          rebuildMenu();
        };

        /** Fill one popup with the lists it owns. */
        const fillMenu = (host: HTMLElement, kinds: MenuKind[]) => {
          host.textContent = "";
          const section = (label: string) => {
            if (kinds.length < 2) return; // a single-list popup needs no heading
            const h = document.createElement("h4");
            h.textContent = label;
            host.appendChild(h);
          };
          const item = (label: string, on: boolean, fn: () => void, action = false) => {
            const b = document.createElement("button");
            b.type = "button";
            b.setAttribute("role", action ? "menuitem" : "menuitemradio");
            if (!action) b.setAttribute("aria-checked", String(on));
            b.textContent = label;
            if (on) b.classList.add("on");
            b.addEventListener("click", fn);
            host.appendChild(b);
          };
          if (kinds.includes("subs")) {
            section(S.subtitles);
            item(S.subtitlesOff, activeSub < 0, () => {
              setSub(-1);
              closePops();
            });
            subTracks.forEach((entry, i) =>
              item(entry.label || `#${i + 1}`, activeSub === i, () => {
                setSub(i);
                closePops();
              }),
            );
            item(S.loadSubtitles, false, () => fileInput.click(), true);
          }
          if (kinds.includes("audio") && audioTracks.length > 1) {
            section(S.audioTracks);
            audioTracks.forEach((a, i) => item(a.label || a.language || `#${i + 1}`, activeAudio === i, () => void switchAudio(i)));
          }
          if (kinds.includes("speed")) {
            section(S.speed);
            for (const r of [0.5, 0.75, 1, 1.25, 1.5, 2])
              item(`${r}\u00d7`, Math.abs(m.playbackRate - r) < 0.01, () => {
                setRate(r, false);
                closePops();
              });
          }
        };
        const rebuildMenu = () => {
          for (const p of pops) fillMenu(p.el, p.kinds);
          if (audioBtn) audioBtn.hidden = audioTracks.length < 2; // only worth a button with a choice
        };

        window.setTimeout(async () => {
          if (!this.wrap) return;
          try {
            const info = extractMkvInfo(await this.buffer());
            mkvInfo = info;
            // Hand the file's embedded fonts to libass BEFORE selecting a track, so the
            // first styled render already resolves the intended (incl. CJK) faces.
            for (const f of info.fonts) {
              const url = URL.createObjectURL(new Blob([f.data as BlobPart], { type: f.mime || "font/otf" }));
              this.subUrls.push(url); // revoked on dispose alongside the VTT blobs
              libassFonts.push(url);
            }
            // Embedded hosts (subtitle editor) drive subtitles themselves, so don't add
            // or auto-select the file's own subtitle tracks; keep fonts and audio though.
            if (!this.opts.embedded)
              info.subtitles.forEach((s, i) => addSubTrack({ label: s.label || s.language, lang: s.language, vtt: s.vtt, assDoc: s.assDoc }, i === 0));
            audioTracks = info.audio;
            rebuildMenu();
            // Video plays but the audio codec has no browser decoder: the element stays
            // silent with no error event. For AC-3/E-AC-3 we can decode it ourselves
            // (libav) and play it in sync with the muted video; other codecs (DTS,
            // TrueHD) aren't in the decoder, so we just tell the user.
            const activeCodec = audioTracks[activeAudio]?.codec ?? "";
            if (activeCodec && browserLacksAudioCodec(activeCodec, m)) {
              if (/^A_(E?AC3|DTS|TRUEHD|MLP)$/i.test(activeCodec)) void this.startDecodedAudio(m, activeAudio, showToast, directFor(activeAudio));
              else showToast(S.mediaAudioUnsupported);
            }
          } catch {
            /* track info is best-effort */
          }
        });
        const ownFs = !!document.fullscreenEnabled && !!wrap.requestFullscreen;
        // Our own fullscreen button: the native bar's takes the bare video, where the
        // styled-subtitle canvas cannot follow, so that one is hidden when it exists.
        if (ownFs && !ownBar) wrap.classList.add("ot-media-ownfs");
        const fsBtn = document.createElement("button");
        fsBtn.type = "button";
        fsBtn.innerHTML = ICONS.fullscreen;
        fsBtn.title = S.fullscreen;
        fsBtn.setAttribute("aria-label", S.fullscreen);
        fsBtn.addEventListener("click", toggleFullscreen);
        // In embedded mode the host owns subtitle choice, so hide the CC button/menu.
        const showCC = !this.opts.embedded;
        if (ownBar) {
          btn.className = "ot-media-barbtn";
          btn.textContent = "CC";
          btn.title = S.subtitles;
          btn.setAttribute("aria-label", S.subtitles);
          fsBtn.className = "ot-media-barbtn";
          // The speed button wears the current rate, which is also what it is for.
          const speedBtn = document.createElement("button");
          speedBtn.type = "button";
          speedBtn.className = "ot-media-barbtn ot-media-ratebtn";
          speedBtn.title = S.speed;
          speedBtn.setAttribute("aria-label", S.speed);
          const showRate = () => (speedBtn.textContent = `${Math.round(m.playbackRate * 100) / 100}\u00d7`);
          m.addEventListener("ratechange", showRate);
          showRate();
          audioBtn = document.createElement("button");
          audioBtn.type = "button";
          audioBtn.className = "ot-media-barbtn";
          audioBtn.innerHTML = ICONS.audio;
          audioBtn.title = S.audioTracks;
          audioBtn.setAttribute("aria-label", S.audioTracks);
          audioBtn.hidden = true; // shown once the file turns out to have several tracks
          const extras: HTMLElement[] = [speedBtn];
          if (showCC) extras.push(audioBtn, btn);
          if (ownFs) extras.push(fsBtn);
          bar = buildBar(extras);
          stage.append(makePop(speedBtn, ["speed"]));
          if (showCC) stage.append(makePop(audioBtn, ["audio"]), makePop(btn, ["subs"]));
          for (const p of pops) p.el.classList.add("ot-media-menu-up"); // they hang above the bar
        } else {
          fsBtn.className = "ot-media-tracksbtn ot-media-fsbtn";
          if (this.opts.embedded) fsBtn.style.left = "14px";
          if (showCC) {
            wrap.appendChild(btn);
            wrap.appendChild(makePop(btn, ["subs", "audio"])); // one floating menu, as before
          }
          if (ownFs) wrap.appendChild(fsBtn); // iPhone keeps the native one: no element fullscreen there
        }
        rebuildMenu();
        wrap.appendChild(fileInput);
      }
      if (bar) stage.appendChild(bar);
      if (bigPlay) stage.appendChild(bigPlay);
      wrap.appendChild(stage);
      wrap.appendChild(rateBadge);
    } else {
      const d = document.createElement("div");
      d.className = "ot-media-msg";
      d.textContent = S.mediaEmpty;
      wrap.appendChild(d);
    }
    container.appendChild(wrap);
    this.wrap = wrap;
    wrap.focus();
  }

  /** Decode an AC-3/E-AC-3 track with libav and play it in sync with the muted video. */
  private async startDecodedAudio(video: HTMLMediaElement, audioIndex: number, showToast: (text: string) => void, direct?: DirectAudioInfo): Promise<void> {
    const base = this.opts.libav?.base ?? new URL("libav/", document.baseURI).toString();
    // The native track is silent (undecodable) anyway; muting also lets it autoplay
    // (unmuted autoplay is policy-blocked, which left it paused and starved the audio
    // scheduler, since audio only advances while the video clock runs). The engine's
    // first-gesture handler lifts this mute and resumes on the user's play. Embedded
    // hosts drive playback, so don't force play there (it would autoplay in an editor).
    video.muted = true;
    if (!this.opts.embedded) void video.play().catch(() => undefined);
    try {
      const { playSyncedAudio } = await import("./synced-audio");
      if (!this.srcBlob) return;
      const handle = await playSyncedAudio(video, this.srcBlob, audioIndex, base, direct);
      if (!this.wrap) {
        if (handle && handle !== "undecodable") handle.destroy();
        return;
      }
      if (handle && handle !== "undecodable") this.decodedAudio = handle;
      else showToast(this.S.mediaAudioUnsupported);
    } catch (e) {
      console.warn("[mediaplay:audio] decode path failed:", e);
      if (this.wrap) showToast(this.S.mediaAudioUnsupported);
    }
  }

  /** Read the whole file into a TRANSIENT buffer (not cached), for the paths that still need
   * random access: the one-time info/subtitle/font extraction (buffer freed right after), and,
   * until it's streamed, the AC-3/E-AC-3 audio reader (which holds it only while that audio
   * plays). Not caching is what keeps the file out of RAM during normal editing. */
  private async buffer(): Promise<Uint8Array> {
    if (this.eagerBytes) return this.eagerBytes;
    if (!this.srcBlob) return new Uint8Array(0);
    return new Uint8Array(await this.srcBlob.arrayBuffer());
  }

  getBytes(): Uint8Array | undefined {
    return this.eagerBytes ?? undefined;
  }

  getMediaElement(): HTMLMediaElement | undefined {
    return this.media ?? undefined;
  }

  setSubtitleText(content: string, filename: string): void {
    this.applyLiveSubtitle?.(content, filename);
  }

  focus(): void {
    this.wrap?.focus?.();
  }

  destroy(): void {
    this.decodedAudio?.destroy();
    this.decodedAudio = null;
    this.applyLiveSubtitle = null;
    this.media = null;
    for (const fn of this.teardown) fn();
    this.teardown = [];
    if (this.onDocKey) document.removeEventListener("keydown", this.onDocKey, true);
    this.onDocKey = null;
    for (const u of this.subUrls) URL.revokeObjectURL(u);
    this.subUrls = [];
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = null;
    this.wrap?.remove();
    this.wrap = null;
  }
}

/**
 * Mount a read-only media player into `container` and start playing `source`.
 * Returns a handle to read the original bytes, focus, or tear the player down.
 */
export function createMediaPlayer(container: HTMLElement, source: MediaSource, opts: MediaPlayerOptions = {}): MediaPlayerHandle {
  return new MediaPlayer(container, source, opts);
}
