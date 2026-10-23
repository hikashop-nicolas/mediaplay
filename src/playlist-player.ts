// A queue of media: next and previous, repeat, shuffle, and a list to jump around in.
//
// One host element stays put and the single-file player is mounted into it again for each
// entry, so fullscreen survives from one entry to the next and a long queue never holds more
// than the entry that is playing. This file owns the queue and its controls; everything about
// playing one file stays in player.ts.

import { createMediaPlayer as createSingle, type MediaPlayerHandle, type MediaPlayerOptions, type MediaSource, type PlayerChrome } from "./player";
import { strings, type MediaStrings } from "./i18n";
import { PlayQueue, type RepeatMode } from "./queue";

/** One thing in the queue. Lazy, so a folder of hundreds holds no file until its turn. */
export interface QueueEntry {
  /** What the list shows before anything is read: a file name, or the playlist's own label. */
  title: string;
  artist?: string;
  /** Seconds, when known without reading the file. */
  duration?: number;
  /** Produces the media when this entry's turn comes. */
  load: () => Promise<MediaSource>;
  /** True or false when the host knows; otherwise it is guessed from the name. */
  audio?: boolean;
  /** Where it came from, as a path or an address: what a playlist saved from this queue should say. */
  source?: string;
  /** Why this entry cannot play yet: no file next to the playlist, or an address on the web. */
  unavailable?: "missing" | "remote";
}

export interface PlaylistOptions extends MediaPlayerOptions {
  startIndex?: number;
  repeat?: RepeatMode;
  shuffle?: boolean;
  /** Fired when another entry starts, by any route. */
  onTrackChange?: (index: number, entry: QueueEntry) => void;
  /** Fired when the list changes: entries added or removed, or titles read from the files. */
  onQueueChange?: (entries: readonly QueueEntry[]) => void;
  /** Asked before an entry on the web plays. Resolve true to allow. Asked once; a yes stands. */
  allowRemote?: (entry: QueueEntry) => Promise<boolean>;
  /** A person asked for an entry we could not find, so the host can offer to look for it. */
  onMissing?: (entry: QueueEntry, index: number) => void;
  /** The list offers a button to look for the missing files when the host can: it picks a folder
   * and builds the entries again. */
  onChooseFolder?: () => void;
}

export interface PlaylistHandle extends MediaPlayerHandle {
  next(): void;
  previous(): void;
  goTo(index: number): void;
  getQueue(): readonly QueueEntry[];
  getIndex(): number;
  setRepeat(mode: RepeatMode): void;
  getRepeat(): RepeatMode;
  setShuffle(on: boolean): void;
  getShuffle(): boolean;
  add(entries: readonly QueueEntry[]): void;
  remove(index: number): void;
}

const REPEAT_KEY = "mediaplay.repeat";
const SHUFFLE_KEY = "mediaplay.shuffle";
const AUDIO_NAME = /\.(mp3|m4a|aac|flac|wav|oga|ogg|opus|weba|mka|wma)(\?|#|$)/i;
/** Long enough to read why an entry was passed over, short enough not to feel stuck. */
const SKIP_DELAY_MS = 2000;

const STYLE_ID = "mediaplay-playlist-style";

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
    .ot-pl-btn { flex:none; display:inline-flex; align-items:center; justify-content:center; background:none;
      border:0; border-bottom:2px solid transparent; color:inherit; font:inherit; line-height:1; padding:5px 6px;
      border-radius:6px; cursor:pointer; }
    @media (hover: hover) { .ot-pl-btn:hover { background:rgba(255,255,255,0.18); } }
    .ot-pl-btn:focus-visible { outline:2px solid #fff; outline-offset:1px; }
    .ot-pl-btn svg { display:block; }
    /* On is told by the underline as well as the colour, so it never rests on colour alone. */
    .ot-pl-btn.on { color:#f3a39c; border-bottom-color:#f3a39c; }
    .ot-pl-btn[hidden] { display:none; }
    /* The bar wraps, and a container query cannot style the container itself, so wrapping is
       always on and only the timeline's move to its own top row waits for a narrow bar. Narrower still, repeat and shuffle live in the list panel only. */
    .ot-pl-bar { flex-wrap:wrap; row-gap:2px; }
    @container (max-width: 520px) { .ot-pl-bar .ot-media-timeline { order:-1; flex:1 0 100%; } }
    @container (max-width: 420px) { .ot-pl-bar .ot-pl-wide { display:none; } }
    /* Audio has no bar of ours, so the controls get a row of their own under the player. */
    .ot-pl-row { display:flex; align-items:center; gap:4px; width:520px; max-width:100%; box-sizing:border-box;
      padding:6px 4px 0; color:#fff; font:13px system-ui, sans-serif; }
    .ot-pl-row .ot-pl-btn { min-width:44px; min-height:44px; }
    .ot-pl-now { flex:1 1 auto; min-width:0; padding:0 8px; overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    .ot-pl-osd { position:absolute; top:12px; left:14px; z-index:2; max-width:70%; padding:6px 12px; border-radius:8px;
      background:rgba(20,20,24,0.85); color:#fff; font:600 13px system-ui, sans-serif; opacity:0; transition:opacity .3s;
      pointer-events:none; }
    .ot-pl-osd.show { opacity:1; }
    .ot-pl-panel { position:absolute; top:0; right:0; bottom:0; z-index:3; box-sizing:border-box; width:min(360px, 100%);
      display:flex; flex-direction:column; background:#101014; color:#fff; font:13px system-ui, sans-serif;
      border-left:1px solid rgba(255,255,255,0.14); }
    .ot-pl-panel[hidden] { display:none; }
    .ot-pl-head { display:flex; align-items:center; gap:4px; padding:6px 8px 6px 12px;
      border-bottom:1px solid rgba(255,255,255,0.14); font-weight:600; }
    .ot-pl-head > span { flex:1 1 auto; }
    .ot-pl-head .ot-pl-btn { min-width:44px; min-height:44px; }
    .ot-pl-list { flex:1 1 auto; margin:0; padding:0; list-style:none; overflow:auto; }
    .ot-pl-item { display:flex; align-items:center; border-bottom:1px solid rgba(255,255,255,0.07); }
    .ot-pl-item[aria-current="true"] { background:rgba(243,163,156,0.16); }
    .ot-pl-pick { flex:1 1 auto; min-width:0; display:flex; gap:10px; align-items:baseline; text-align:left; background:none;
      border:0; color:inherit; font:inherit; padding:10px 12px; min-height:44px; cursor:pointer; }
    @media (hover: hover) { .ot-pl-pick:hover, .ot-pl-del:hover { background:rgba(255,255,255,0.1); } }
    .ot-pl-pick:focus-visible, .ot-pl-del:focus-visible { outline:2px solid #fff; outline-offset:-2px; }
    .ot-pl-num { flex:none; width:2.4em; color:#a8a8b3; font-variant-numeric:tabular-nums; text-align:right; }
    .ot-pl-text { flex:1 1 auto; min-width:0; display:flex; flex-direction:column; }
    .ot-pl-title, .ot-pl-sub { overflow:hidden; white-space:nowrap; text-overflow:ellipsis; }
    .ot-pl-sub { color:#a8a8b3; font-size:12px; }
    .ot-pl-time { flex:none; color:#a8a8b3; font-variant-numeric:tabular-nums; }
    .ot-pl-item.off .ot-pl-title { color:#a8a8b3; font-style:italic; }
    .ot-pl-find { margin:10px 12px; min-height:44px; padding:0 12px; border-radius:8px; cursor:pointer; color:#fff;
      background:rgba(60,60,70,0.9); border:1px solid rgba(255,255,255,0.25); font:600 13px system-ui, sans-serif; }
    .ot-pl-find:focus-visible { outline:2px solid #fff; outline-offset:2px; }
    .ot-pl-del { flex:none; width:44px; min-height:44px; background:none; border:0; color:#a8a8b3; font-size:18px; cursor:pointer; }
    @media (prefers-reduced-motion: reduce) { .ot-pl-osd { transition:none; } }
  `;
  document.head.appendChild(s);
}

const SVG = (body: string) => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false" fill="currentColor">${body}</svg>`;
const ICONS = {
  prev: SVG('<path d="M6 6h2v12H6zm3.5 6 8.5 6V6z"/>'),
  next: SVG('<path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"/>'),
  shuffle: SVG('<path d="M10.6 9.2 5.4 4 4 5.4l5.2 5.2 1.4-1.4zM14.5 4l2 2L4 18.6 5.4 20 18 7.5l2 2V4h-5.5zm.3 9.4-1.4 1.4 3.1 3.1-2 2H20v-5.5l-2 2-3.2-3z"/>'),
  repeat: SVG('<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/>'),
  repeatOne: SVG('<path d="M7 7h10v3l4-4-4-4v3H5v6h2V7zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2v4z"/><path d="M13 15V9h-1l-2 1v1h1.5v4H13z"/>'),
  list: SVG('<path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>'),
};

function fmtDuration(secs: number): string {
  const s = Math.max(0, Math.round(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const p = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(s % 60)}` : `${m}:${p(s % 60)}`;
}

function isAudioEntry(e: QueueEntry): boolean {
  return e.audio ?? AUDIO_NAME.test(e.title);
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode */
  }
}

function recall(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

class PlaylistPlayer implements PlaylistHandle {
  private readonly S: MediaStrings;
  private readonly host: HTMLElement;
  private entries: QueueEntry[];
  private readonly queue: PlayQueue;
  private child: MediaPlayerHandle | null = null;
  private media: HTMLMediaElement | null = null;
  /** Bumped on every change of entry, so a load that comes back late knows it was overtaken. */
  private turn = 0;
  private failures = 0;
  private skipTimer = 0;
  private osdTimer = 0;
  private remoteAllowed = false;
  private panelOpen = false;
  private destroyed = false;
  private repaint: (() => void)[] = [];
  private readonly onDocKey: (e: KeyboardEvent) => void;

  constructor(private readonly container: HTMLElement, entries: readonly QueueEntry[], private readonly opts: PlaylistOptions) {
    ensureStyles();
    this.S = strings(opts.strings);
    this.entries = [...entries];
    const repeat = opts.repeat ?? ((recall(REPEAT_KEY) as RepeatMode | null) ?? "off");
    const shuffle = opts.shuffle ?? recall(SHUFFLE_KEY) === "1";
    this.queue = new PlayQueue(this.entries.length, {
      startIndex: opts.startIndex,
      repeat: repeat === "all" || repeat === "one" ? repeat : "off",
      shuffle: shuffle && this.allAudio(),
    });
    // A playlist opened with none of its files has nothing to play yet: the list is the page.
    this.panelOpen = this.entries.length > 0 && this.entries.every((e) => e.unavailable === "missing");
    this.host = document.createElement("div");
    this.host.className = "ot-media";
    container.appendChild(this.host);
    this.onDocKey = (e) => this.handleKey(e);
    document.addEventListener("keydown", this.onDocKey, true);
    if (this.entries.length) void this.play(this.queue.index);
    else this.child = createSingle(container, {}, { ...this.childOptions(0), host: this.host });
  }

  // --- the handle ---------------------------------------------------------------------

  next(): void {
    void this.step("next", false);
  }
  previous(): void {
    void this.step("previous", false);
  }
  goTo(index: number): void {
    if (index < 0 || index >= this.entries.length) return;
    void this.begin(index);
  }
  getQueue(): readonly QueueEntry[] {
    return this.entries;
  }
  getIndex(): number {
    return this.queue.index;
  }
  getRepeat(): RepeatMode {
    return this.queue.repeat;
  }
  setRepeat(mode: RepeatMode): void {
    this.queue.setRepeat(mode);
    remember(REPEAT_KEY, mode);
    // One entry on repeat loops inside the element, so it needs no gap between plays.
    if (this.media) this.media.loop = mode === "one";
    this.paint();
  }
  getShuffle(): boolean {
    return this.queue.shuffle;
  }
  setShuffle(on: boolean): void {
    const allowed = on && this.allAudio();
    this.queue.setShuffle(allowed);
    remember(SHUFFLE_KEY, allowed ? "1" : "0");
    this.paint();
  }
  add(entries: readonly QueueEntry[]): void {
    if (!entries.length) return;
    const wasEmpty = !this.entries.length;
    this.entries.push(...entries);
    this.queue.add(entries.length);
    if (this.queue.shuffle && !this.allAudio()) this.queue.setShuffle(false);
    this.changed();
    if (wasEmpty) void this.play(0);
  }
  remove(index: number): void {
    if (index < 0 || index >= this.entries.length) return;
    const result = this.queue.remove(index);
    this.entries.splice(index, 1);
    this.changed();
    if (result.removedCurrent) {
      if (result.play === null) {
        this.stopChild();
        this.child = createSingle(this.container, {}, { ...this.childOptions(0), host: this.host });
      } else void this.play(result.play);
    }
  }
  getBytes(): Uint8Array | undefined {
    return this.child?.getBytes();
  }
  getMediaElement(): HTMLMediaElement | undefined {
    return this.child?.getMediaElement();
  }
  setSubtitleText(content: string, filename: string): void {
    this.child?.setSubtitleText(content, filename);
  }
  focus(): void {
    this.child?.focus();
  }
  destroy(): void {
    this.destroyed = true;
    this.turn++;
    window.clearTimeout(this.skipTimer);
    window.clearTimeout(this.osdTimer);
    document.removeEventListener("keydown", this.onDocKey, true);
    this.clearMediaSession();
    this.child?.destroy();
    this.child = null;
    this.host.remove();
  }

  // --- moving through the queue -------------------------------------------------------

  /** Start an entry a person chose, which resets the count of entries that would not play. */
  private async begin(index: number): Promise<void> {
    this.failures = 0;
    this.queue.goTo(index);
    await this.play(index);
  }

  /** The entry after or before this one that can actually play, asking about the web as it goes. */
  private async step(dir: "next" | "previous", auto: boolean): Promise<void> {
    const total = this.entries.length;
    if (!total) return;
    const startedAt = this.queue.index;
    for (let tried = 0; tried < total; tried++) {
      let index: number | null;
      if (dir === "next") {
        index = this.queue.next(auto);
      } else {
        index = this.queue.previous(tried === 0 ? (this.media?.currentTime ?? 0) : 0);
        // Played a while, or nothing before it: Previous starts this one over.
        if (tried === 0 && index === startedAt) {
          if (this.media) this.media.currentTime = 0;
          return;
        }
      }
      if (index === null) return;
      if (await this.reachable(index)) {
        this.failures = 0;
        await this.play(index);
        return;
      }
    }
  }

  /** False for an entry with nothing to play: not found, or on the web and not allowed. */
  private async reachable(index: number): Promise<boolean> {
    const entry = this.entries[index]!;
    if (entry.unavailable === "missing") return false;
    if (entry.unavailable === "remote") {
      if (!this.remoteAllowed) this.remoteAllowed = (await this.opts.allowRemote?.(entry)) === true;
      return this.remoteAllowed;
    }
    return true;
  }

  private async play(index: number): Promise<void> {
    if (this.destroyed) return;
    window.clearTimeout(this.skipTimer);
    const turn = ++this.turn;
    const entry = this.entries[index];
    if (!entry) return;
    this.queue.goTo(index);
    this.paint();
    this.stopChild();
    if (entry.unavailable === "missing") {
      this.opts.onMissing?.(entry, index);
      this.showNote(this.S.notReachable, turn);
      return;
    }
    if (entry.unavailable === "remote" && !(await this.reachable(index))) {
      if (turn === this.turn) this.showNote(this.S.playsOnline, turn);
      return;
    }
    let source: MediaSource;
    try {
      source = await entry.load();
    } catch {
      if (turn === this.turn) this.trackFailed(turn);
      return;
    }
    if (turn !== this.turn || this.destroyed) return;
    this.child = createSingle(this.container, source, {
      ...this.childOptions(turn),
      host: this.host,
    });
    this.opts.onTrackChange?.(index, entry);
    if (source.blob) void this.readTags(index, source.blob, turn);
  }

  private childOptions(turn: number): PlaylistOptions {
    return {
      ...this.opts,
      onError: (message) => {
        this.opts.onError?.(message);
        if (turn === this.turn) this.trackFailed(turn);
      },
      chrome: (parts) => this.addChrome(parts),
    };
  }

  /** An entry would not play. Say so, then move on, unless every entry has now failed. */
  private trackFailed(turn: number): void {
    this.failures++;
    this.showNote(this.S.skipped, turn);
    if (this.failures >= this.entries.length) return;
    this.skipTimer = window.setTimeout(() => {
      if (turn === this.turn) void this.step("next", true);
    }, SKIP_DELAY_MS);
  }

  /** Words over a stage that has nothing playing, with the controls still reachable. */
  private showNote(text: string, turn: number): void {
    if (turn !== this.turn || this.destroyed) return;
    let note = this.host.querySelector<HTMLElement>(".ot-media-msg");
    if (!note) {
      note = document.createElement("div");
      note.className = "ot-media-msg";
      this.host.replaceChildren(note);
    }
    note.textContent = `${text}: ${this.entries[this.queue.index]?.title ?? ""}`;
    if (!this.host.querySelector(".ot-pl-row")) this.addChrome(this.bare());
  }

  private bare(): PlayerChrome {
    const stage = document.createElement("div");
    stage.className = "ot-media-stage";
    this.host.appendChild(stage);
    return { wrap: this.host, stage, bar: null, media: document.createElement("audio"), isAudio: true };
  }

  private stopChild(): void {
    this.child?.destroy();
    this.child = null;
    this.media = null;
  }

  // --- what the controls show ---------------------------------------------------------

  private allAudio(): boolean {
    return this.entries.length > 0 && this.entries.every(isAudioEntry);
  }

  private changed(): void {
    this.paint();
    this.opts.onQueueChange?.(this.entries);
  }

  private paint(): void {
    for (const fn of this.repaint) fn();
  }

  /** Called by the player once its controls exist: add the queue's to them. */
  private addChrome(parts: PlayerChrome): void {
    const { wrap, stage, bar, media, isAudio } = parts;
    this.media = media;
    media.loop = this.queue.repeat === "one";
    media.addEventListener("ended", () => {
      if (media === this.media) void this.step("next", true);
    });
    this.repaint = [];
    const S = this.S;

    const button = (icon: string, label: string, onClick: () => void): HTMLButtonElement => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "ot-pl-btn";
      b.innerHTML = icon;
      b.title = label;
      b.setAttribute("aria-label", label);
      b.addEventListener("click", onClick);
      return b;
    };
    /** Shuffle and repeat appear in the bar and in the panel; each copy keeps itself in step. */
    const makeShuffle = (): HTMLButtonElement => {
      const b = button(ICONS.shuffle, S.shuffle, () => this.setShuffle(!this.queue.shuffle));
      this.repaint.push(() => {
        b.hidden = this.entries.length < 2 || !this.allAudio();
        b.classList.toggle("on", this.queue.shuffle);
        b.setAttribute("aria-pressed", String(this.queue.shuffle));
      });
      return b;
    };
    const makeRepeat = (): HTMLButtonElement => {
      const b = button(ICONS.repeat, S.repeat, () => this.setRepeat(({ off: "all", all: "one", one: "off" } as const)[this.queue.repeat]));
      this.repaint.push(() => {
        const mode = this.queue.repeat;
        b.hidden = this.entries.length < 2;
        b.innerHTML = mode === "one" ? ICONS.repeatOne : ICONS.repeat;
        b.classList.toggle("on", mode !== "off");
        const label = mode === "one" ? S.repeatOne : mode === "all" ? S.repeatAll : S.repeatOff;
        b.title = label;
        b.setAttribute("aria-label", label);
      });
      return b;
    };
    const prev = button(ICONS.prev, S.previousTrack, () => this.previous());
    const next = button(ICONS.next, S.nextTrack, () => this.next());
    const list = button(ICONS.list, S.playlist, () => {
      this.panelOpen = !this.panelOpen;
      this.paint();
    });
    list.setAttribute("aria-haspopup", "dialog");
    const shuffle = makeShuffle();
    const repeat = makeRepeat();
    for (const b of [shuffle, repeat]) b.classList.add("ot-pl-wide");

    const panel = this.buildPanel(makeShuffle(), makeRepeat());
    const syncButtons = () => {
      const multiple = this.entries.length > 1;
      for (const b of [prev, next]) b.hidden = !multiple;
      list.hidden = !multiple;
      list.setAttribute("aria-expanded", String(this.panelOpen));
      panel.root.hidden = !this.panelOpen || !multiple;
    };
    this.repaint.push(syncButtons, panel.refresh);

    const now = document.createElement("span");
    now.className = "ot-pl-now";
    const syncNow = () => {
      const e = this.entries[this.queue.index];
      now.textContent = e ? `${this.queue.index + 1} / ${this.entries.length}   ${e.artist ? `${e.artist} - ` : ""}${e.title}` : "";
      now.hidden = this.entries.length < 2;
    };
    this.repaint.push(syncNow);

    if (bar && !isAudio) {
      bar.classList.add("ot-pl-bar");
      bar.querySelector(".ot-media-barbtn")?.after(prev, next);
      const vol = bar.querySelector(".ot-media-volwrap");
      const after = [shuffle, repeat, list];
      if (vol) vol.after(...after);
      else bar.append(...after);
    } else {
      const row = document.createElement("div");
      row.className = "ot-pl-row";
      row.append(prev, next, now, shuffle, repeat, list);
      stage.appendChild(row);
    }
    wrap.appendChild(panel.root);
    if (!isAudio) this.announce(wrap);
    this.paint();
    this.syncMediaSession(media);
  }

  /** The title of an entry over the picture for a moment, since a video bar has no room for it. */
  private announce(wrap: HTMLElement): void {
    const e = this.entries[this.queue.index];
    if (!e || this.entries.length < 2) return;
    const osd = document.createElement("div");
    osd.className = "ot-pl-osd";
    osd.textContent = `${this.queue.index + 1} / ${this.entries.length}   ${e.title}`;
    wrap.appendChild(osd);
    window.requestAnimationFrame(() => osd.classList.add("show"));
    window.clearTimeout(this.osdTimer);
    this.osdTimer = window.setTimeout(() => osd.classList.remove("show"), 2600);
  }

  private buildPanel(shuffle: HTMLButtonElement, repeat: HTMLButtonElement): { root: HTMLElement; refresh: () => void } {
    const S = this.S;
    const root = document.createElement("div");
    root.className = "ot-pl-panel";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-label", S.playlist);
    const head = document.createElement("div");
    head.className = "ot-pl-head";
    const title = document.createElement("span");
    title.textContent = S.playlist;
    const close = document.createElement("button");
    close.type = "button";
    close.className = "ot-pl-btn";
    close.textContent = "×";
    close.title = S.close;
    close.setAttribute("aria-label", S.close);
    close.addEventListener("click", () => {
      this.panelOpen = false;
      this.paint();
    });
    head.append(title, shuffle, repeat, close);
    const ol = document.createElement("ol");
    ol.className = "ot-pl-list";
    const find = document.createElement("button");
    find.type = "button";
    find.className = "ot-pl-find";
    find.textContent = S.chooseFolder;
    find.addEventListener("click", () => this.opts.onChooseFolder?.());
    root.append(head, ol, find);
    root.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        this.panelOpen = false;
        this.paint();
        this.host.focus();
        e.stopPropagation();
      }
    });
    const refresh = () => {
      if (root.hidden) return;
      find.hidden = !this.opts.onChooseFolder || !this.entries.some((e) => e.unavailable === "missing");
      ol.textContent = "";
      this.entries.forEach((entry, i) => {
        const li = document.createElement("li");
        li.className = "ot-pl-item" + (entry.unavailable === "missing" ? " off" : "");
        if (i === this.queue.index) li.setAttribute("aria-current", "true");
        const pick = document.createElement("button");
        pick.type = "button";
        pick.className = "ot-pl-pick";
        const num = document.createElement("span");
        num.className = "ot-pl-num";
        num.textContent = String(i + 1);
        const text = document.createElement("span");
        text.className = "ot-pl-text";
        const t = document.createElement("span");
        t.className = "ot-pl-title";
        t.textContent = entry.title;
        text.appendChild(t);
        const sub = entry.unavailable === "missing" ? S.notReachable : entry.unavailable === "remote" ? S.playsOnline : entry.artist;
        if (sub) {
          const s = document.createElement("span");
          s.className = "ot-pl-sub";
          s.textContent = sub;
          text.appendChild(s);
        }
        pick.append(num, text);
        if (entry.duration) {
          const d = document.createElement("span");
          d.className = "ot-pl-time";
          d.textContent = fmtDuration(entry.duration);
          pick.appendChild(d);
        }
        pick.addEventListener("click", () => void this.begin(i));
        const del = document.createElement("button");
        del.type = "button";
        del.className = "ot-pl-del";
        del.textContent = "×";
        del.title = S.removeFromPlaylist;
        del.setAttribute("aria-label", `${S.removeFromPlaylist}: ${entry.title}`);
        del.addEventListener("click", () => this.remove(i));
        li.append(pick, del);
        ol.appendChild(li);
      });
      ol.querySelector('[aria-current="true"]')?.scrollIntoView?.({ block: "nearest" });
    };
    return { root, refresh };
  }

  // --- metadata -----------------------------------------------------------------------

  /** Real titles from the file's tags, read for the entry that is playing and no other. */
  private async readTags(index: number, blob: Blob, turn: number): Promise<void> {
    try {
      const mb = await import("mediabunny");
      const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
      const [tags, duration] = await Promise.all([input.getMetadataTags(), input.computeDuration().catch(() => 0)]);
      const entry = this.entries[index];
      if (!entry || this.destroyed) return;
      if (tags.title) entry.title = tags.title;
      if (tags.artist) entry.artist = tags.artist;
      if (duration > 0) entry.duration = duration;
      if (turn === this.turn && this.media) this.syncMediaSession(this.media, tags.images?.[0]);
      this.changed();
    } catch {
      /* tags are a courtesy; the file name already stands in for them */
    }
  }

  // --- media keys and lock screen, where the browser has them -------------------------

  private syncMediaSession(media: HTMLMediaElement, cover?: { data: Uint8Array; mimeType?: string }): void {
    if (!("mediaSession" in navigator) || this.entries.length < 2) return;
    const session = navigator.mediaSession;
    const e = this.entries[this.queue.index];
    if (!e) return;
    const art: MediaImage[] = [];
    if (cover) art.push({ src: URL.createObjectURL(new Blob([cover.data as BlobPart], { type: cover.mimeType })), type: cover.mimeType });
    session.metadata = new MediaMetadata({ title: e.title, artist: e.artist ?? "", album: "", artwork: art });
    const set = (action: MediaSessionAction, fn: MediaSessionActionHandler) => {
      try {
        session.setActionHandler(action, fn);
      } catch {
        /* this browser does not know the action */
      }
    };
    set("nexttrack", () => this.next());
    set("previoustrack", () => this.previous());
    set("play", () => void media.play());
    set("pause", () => media.pause());
  }

  private clearMediaSession(): void {
    if (!("mediaSession" in navigator)) return;
    for (const a of ["nexttrack", "previoustrack"] as const) {
      try {
        navigator.mediaSession.setActionHandler(a, null);
      } catch {
        /* nothing to clear */
      }
    }
  }

  // --- keys ---------------------------------------------------------------------------

  private handleKey(e: KeyboardEvent): void {
    if (this.destroyed || e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const wrap = this.host;
    if (!wrap.isConnected || (wrap.checkVisibility ? !wrap.checkVisibility() : wrap.offsetParent === null && !document.fullscreenElement)) return;
    const el = e.target instanceof HTMLElement ? e.target : null;
    if (el && el.closest("input, textarea, select, [contenteditable]")) return;
    if (this.entries.length < 2) return;
    if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      this.next();
    } else if (e.key === "p" || e.key === "P") {
      e.preventDefault();
      this.previous();
    }
  }
}

/**
 * Mount a player into `container`. Give it one source, as before, or a list of entries for a
 * queue with next and previous, repeat, shuffle (audio only) and a list.
 */
export function createMediaPlayer(container: HTMLElement, source: MediaSource, opts?: MediaPlayerOptions): MediaPlayerHandle;
export function createMediaPlayer(container: HTMLElement, entries: readonly QueueEntry[], opts?: PlaylistOptions): PlaylistHandle;
export function createMediaPlayer(
  container: HTMLElement,
  what: MediaSource | readonly QueueEntry[],
  opts: PlaylistOptions = {},
): MediaPlayerHandle | PlaylistHandle {
  if (Array.isArray(what)) return new PlaylistPlayer(container, what, opts);
  return createSingle(container, what as MediaSource, opts);
}
