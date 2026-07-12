import { decodeSubtitleBytes, extractMkvInfo, subtitleFileToVtt, type MkvAudioTrack } from "./mkv";
import { strings, type MediaStrings } from "./i18n";
import type { SyncedAudioHandle } from "./synced-audio";

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
  bytes: Uint8Array;
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
}

export interface MediaPlayerHandle {
  /** The original document bytes (the player never mutates them). */
  getBytes(): Uint8Array | undefined;
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
      display:flex; align-items:center; justify-content:center; outline:none; }
    .ot-media-stage { position:relative; display:flex; max-width:100%; max-height:100%; }
    .ot-media video { max-width:100%; max-height:100%; }
    /* F fullscreens the whole player (wrap), so the libass canvas and the overlays
       ride along; the video then fills the screen with letterboxing. */
    .ot-media:fullscreen .ot-media-stage { width:100%; height:100%; }
    .ot-media:fullscreen video { width:100%; height:100%; max-width:none; max-height:none; object-fit:contain; }
    /* libass canvas parent: out of the flex flow, pinned to the video's box (octopus
       sets position:relative inline, hence the !important). */
    .ot-media-stage .libassjs-canvas-parent { position:absolute !important; top:0; left:0; }
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
    .ot-media-tracksbtn:hover { background:rgba(50,50,58,0.9); }
    /* Fullscreen with an idle mouse: hide our chrome like the native controls do. */
    .ot-media.ot-media-idle { cursor:none; }
    .ot-media.ot-media-idle .ot-media-tracksbtn { opacity:0; pointer-events:none; }
    .ot-media-menu { position:absolute; top:44px; left:14px; z-index:3; min-width:200px;
      background:rgba(24,24,30,0.97); color:#eee; font:13px system-ui, sans-serif;
      border:1px solid rgba(255,255,255,0.2); border-radius:10px; padding:6px; }
    .ot-media-menu h4 { margin:4px 8px; font-size:11px; text-transform:uppercase; letter-spacing:.4px; color:#9aa; }
    .ot-media-menu button { display:block; width:100%; text-align:left; font:inherit; color:inherit;
      background:none; border:0; border-radius:6px; padding:6px 8px; cursor:pointer; }
    .ot-media-menu button:hover { background:rgba(255,255,255,0.12); }
    .ot-media-menu button.on::before { content:"✓ "; }
    .ot-media-menu button:not(.on) { padding-left:22px; }
  `;
  document.head.appendChild(s);
}

const SEEK_STEP = 5; // seconds
const VOLUME_STEP = 0.05;
const RATE_STEP = 0.2;
const RATE_KEY = "mediaplay.rate"; // playback speed, remembered across files

/** Rebuild the file keeping only the chosen audio track (stream copy), for audio switching:
 * browsers expose no API to pick among a file's embedded audio tracks. */
async function remuxWithAudioTrack(bytes: Uint8Array, keepTrackId: number): Promise<Blob | null> {
  const mb = await import("mediabunny");
  try {
    const input = new mb.Input({ source: new mb.BufferSource(bytes.slice().buffer), formats: mb.ALL_FORMATS });
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
async function tryRemux(bytes: Uint8Array, isAudio: boolean): Promise<Blob | null> {
  const mb = await import("mediabunny");
  const targets = isAudio
    ? [new mb.Mp4OutputFormat(), new mb.OggOutputFormat(), new mb.WavOutputFormat()]
    : [new mb.Mp4OutputFormat(), new mb.WebMOutputFormat()];
  for (const format of targets) {
    try {
      const input = new mb.Input({ source: new mb.BufferSource(bytes.slice().buffer), formats: mb.ALL_FORMATS });
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
  private bytes: Uint8Array | null = null;
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
    this.mount(container, source);
  }

  private mount(container: HTMLElement, source: MediaSource): void {
    ensureStyles();
    const S = this.S;
    this.bytes = source.bytes;
    const wrap = document.createElement("div");
    wrap.className = "ot-media";
    wrap.tabIndex = 0;
    const mime = source.mime ?? "";
    if (source.bytes && source.bytes.length) {
      const blob = new Blob([source.bytes as BlobPart], mime ? { type: mime } : undefined);
      this.url = URL.createObjectURL(blob);
      const isAudio = mime.startsWith("audio/");
      const m = document.createElement(isAudio ? "audio" : "video") as HTMLMediaElement;
      m.src = this.url;
      m.controls = true;
      m.autoplay = true; // opening a file is the user's intent to play; policy-blocked = stays paused
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
        tryRemux(source.bytes, isAudio).then(
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
      // Document-level so the shortcuts work no matter where focus sits (the open
      // dialog returns focus to the toolbar, drag-drop leaves it on the body, ...).
      // Typing and button/menu interaction elsewhere is never hijacked.
      this.onDocKey = (e: KeyboardEvent) => {
        // Gone, or hidden by a view switch. NOT offsetParent: the fullscreen top layer
        // makes the wrap position:fixed, where offsetParent is null while fully visible.
        if (!wrap.isConnected) return;
        if (wrap.checkVisibility ? !wrap.checkVisibility() : wrap.offsetParent === null && !document.fullscreenElement) return;
        // Already claimed by someone else (e.g. a speed-controller browser extension
        // handling S/D itself): don't double-handle, or every press fires twice.
        if (e.defaultPrevented) return;
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const el = e.target instanceof HTMLElement ? e.target : null;
        if (el && !wrap.contains(el) && el.closest("input, textarea, select, button, a, [contenteditable], [role=dialog], [role=menu], [role=listbox]"))
          return;
        const key = e.key === " " ? " " : e.key.length === 1 ? e.key.toLowerCase() : e.key;
        switch (key) {
          case " ":
          case "k":
            if (m.paused) void m.play();
            else m.pause();
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
      document.addEventListener("keydown", this.onDocKey);
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
        const menu = document.createElement("div");
        menu.className = "ot-media-menu";
        menu.hidden = true;
        btn.addEventListener("click", () => {
          menu.hidden = !menu.hidden;
          if (!menu.hidden) rebuildMenu();
        });
        const closeMenu = (e: MouseEvent) => {
          if (!menu.hidden && !menu.contains(e.target as Node) && e.target !== btn) menu.hidden = true;
        };
        document.addEventListener("click", closeMenu);
        this.teardown.push(() => document.removeEventListener("click", closeMenu));

        // Fullscreen chrome: hide the CC button (and cursor) after 2.5s of mouse idle,
        // like the native controls; any movement brings it back.
        let idleTimer = 0;
        const poke = () => {
          wrap.classList.remove("ot-media-idle");
          window.clearTimeout(idleTimer);
          if (document.fullscreenElement === wrap)
            idleTimer = window.setTimeout(() => {
              if (menu.hidden) wrap.classList.add("ot-media-idle");
            }, 2500);
        };
        wrap.addEventListener("pointermove", poke);

        // Double-click toggles fullscreen (like F); without this, Chrome's native
        // handler fullscreens the bare video where none of our overlays can live.
        m.addEventListener("dblclick", (e) => {
          const r = m.getBoundingClientRect();
          if (e.clientY > r.bottom - 70) return; // over the native control bar
          e.preventDefault();
          toggleFullscreen();
        });

        // Any native path that still fullscreens the bare video (the controls' own
        // fullscreen button) is upgraded to wrap fullscreen within the same gesture.
        let upgrading = false;
        const onFsChange = () => {
          poke();
          if (document.fullscreenElement === m && !upgrading) {
            upgrading = true;
            document
              .exitFullscreen()
              .then(() => wrap.requestFullscreen())
              .then(
                () => (upgrading = false),
                () => {
                  upgrading = false;
                  bridgeSubs(); // couldn't upgrade: at least keep subtitles visible
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
          menu.hidden = true;
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

        const switchAudio = async (i: number) => {
          menu.hidden = true;
          if (i === activeAudio) return;
          // Decoded-audio mode: every track is browser-undecodable, so restart the libav
          // decoder on the newly chosen track rather than remuxing.
          if (this.decodedAudio) {
            activeAudio = i;
            this.decodedAudio.destroy();
            this.decodedAudio = null;
            rebuildMenu();
            await this.startDecodedAudio(m, i, showToast);
            return;
          }
          const note = document.createElement("div");
          note.className = "ot-media-msg";
          note.textContent = S.mediaConverting;
          wrap.appendChild(note);
          const blob = await remuxWithAudioTrack(source.bytes, audioTracks[i]!.number);
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

        const rebuildMenu = () => {
          menu.textContent = "";
          const section = (label: string) => {
            const h = document.createElement("h4");
            h.textContent = label;
            menu.appendChild(h);
          };
          const item = (label: string, on: boolean, fn: () => void) => {
            const b = document.createElement("button");
            b.type = "button";
            b.textContent = label;
            if (on) b.classList.add("on");
            b.addEventListener("click", fn);
            menu.appendChild(b);
          };
          section(S.subtitles);
          item(S.subtitlesOff, activeSub < 0, () => {
            setSub(-1);
            menu.hidden = true;
          });
          subTracks.forEach((entry, i) =>
            item(entry.label || `#${i + 1}`, activeSub === i, () => {
              setSub(i);
              menu.hidden = true;
            }),
          );
          item(S.loadSubtitles, false, () => fileInput.click());
          if (audioTracks.length > 1) {
            section(S.audioTracks);
            audioTracks.forEach((a, i) => item(a.label || a.language || `#${i + 1}`, activeAudio === i, () => void switchAudio(i)));
          }
        };
        rebuildMenu();

        window.setTimeout(() => {
          if (!this.wrap) return;
          try {
            const info = extractMkvInfo(source.bytes);
            // Hand the file's embedded fonts to libass BEFORE selecting a track, so the
            // first styled render already resolves the intended (incl. CJK) faces.
            for (const f of info.fonts) {
              const url = URL.createObjectURL(new Blob([f.data as BlobPart], { type: f.mime || "font/otf" }));
              this.subUrls.push(url); // revoked on dispose alongside the VTT blobs
              libassFonts.push(url);
            }
            info.subtitles.forEach((s, i) => addSubTrack({ label: s.label || s.language, lang: s.language, vtt: s.vtt, assDoc: s.assDoc }, i === 0));
            audioTracks = info.audio;
            rebuildMenu();
            // Video plays but the audio codec has no browser decoder: the element stays
            // silent with no error event. For AC-3/E-AC-3 we can decode it ourselves
            // (libav) and play it in sync with the muted video; other codecs (DTS,
            // TrueHD) aren't in the decoder, so we just tell the user.
            const activeCodec = audioTracks[activeAudio]?.codec ?? "";
            if (activeCodec && browserLacksAudioCodec(activeCodec, m)) {
              if (/^A_E?AC3$/i.test(activeCodec)) void this.startDecodedAudio(m, activeAudio, showToast);
              else showToast(S.mediaAudioUnsupported);
            }
          } catch {
            /* track info is best-effort */
          }
        });
        wrap.appendChild(btn);
        wrap.appendChild(menu);
        wrap.appendChild(fileInput);
      }
      const stage = document.createElement("div");
      stage.className = "ot-media-stage";
      stage.appendChild(m);
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
  private async startDecodedAudio(video: HTMLMediaElement, audioIndex: number, showToast: (text: string) => void): Promise<void> {
    const base = this.opts.libav?.base ?? new URL("libav/", document.baseURI).toString();
    // The native track is silent (undecodable) anyway; muting also lets it autoplay
    // (unmuted autoplay is policy-blocked, which left it paused and starved the audio
    // scheduler, since audio only advances while the video clock runs).
    video.muted = true;
    void video.play().catch(() => undefined);
    try {
      const { playSyncedAudio } = await import("./synced-audio");
      const handle = await playSyncedAudio(video, this.bytes!, audioIndex, base);
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

  getBytes(): Uint8Array | undefined {
    return this.bytes ?? undefined;
  }

  focus(): void {
    this.wrap?.focus?.();
  }

  destroy(): void {
    this.decodedAudio?.destroy();
    this.decodedAudio = null;
    for (const fn of this.teardown) fn();
    this.teardown = [];
    if (this.onDocKey) document.removeEventListener("keydown", this.onDocKey);
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
