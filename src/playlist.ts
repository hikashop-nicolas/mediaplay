// Playlist files as data: M3U/M3U8, PLS and XSPF in, M3U8 out. Pure functions with no DOM, so a
// host can use them without the player, and they run in a worker as well as on the page.

export interface PlaylistEntry {
  /** Where the file is: a relative or absolute path, or a URL. As written in the playlist. */
  path: string;
  title?: string;
  artist?: string;
  /** Seconds, when the playlist says. */
  duration?: number;
}

export type PlaylistKind = "m3u" | "pls" | "xspf";

/** What a playlist is, by name. */
export function playlistKind(filename: string): PlaylistKind | null {
  const ext = /\.([a-z0-9]+)$/i.exec(filename)?.[1]?.toLowerCase();
  if (ext === "m3u" || ext === "m3u8") return "m3u";
  if (ext === "pls") return "pls";
  if (ext === "xspf") return "xspf";
  return null;
}

/** True for a path that is a web address rather than a file. */
export function isRemote(path: string): boolean {
  return /^https?:\/\//i.test(path);
}

export class HlsManifestError extends Error {
  constructor() {
    super("This is a streaming manifest (HLS), not a list of files.");
    this.name = "HlsManifestError";
  }
}

/** Entries of a playlist file, whichever of the supported kinds it is. */
export function parsePlaylist(text: string, filename: string): PlaylistEntry[] {
  const body = text.replace(/^﻿/, "");
  const kind = playlistKind(filename) ?? sniffKind(body);
  if (kind === "pls") return parsePls(body);
  if (kind === "xspf") return parseXspf(body);
  return parseM3u(body);
}

function sniffKind(text: string): PlaylistKind {
  const head = text.trimStart().slice(0, 200).toLowerCase();
  if (head.startsWith("[playlist]")) return "pls";
  if (head.startsWith("<?xml") || head.startsWith("<playlist")) return "xspf";
  return "m3u";
}

// #EXT-X- tags belong to HLS: the lines under them are media segments and variant streams,
// which a player drives itself, not tracks to queue.
const HLS = /^#EXT-X-(?:TARGETDURATION|MEDIA-SEQUENCE|STREAM-INF|VERSION|PLAYLIST-TYPE|ENDLIST|KEY|MAP)\b/m;

export function parseM3u(text: string): PlaylistEntry[] {
  if (HLS.test(text)) throw new HlsManifestError();
  const entries: PlaylistEntry[] = [];
  let pending: Pick<PlaylistEntry, "title" | "artist" | "duration"> = {};
  for (const raw of text.split(/\r\n|\n|\r/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      const info = /^#EXTINF:\s*(-?[\d.]+)\s*(?:,(.*))?$/i.exec(line);
      if (info) {
        pending = {};
        const secs = Number(info[1]);
        if (secs > 0) pending.duration = secs;
        const label = info[2]?.trim();
        if (label) Object.assign(pending, splitArtistTitle(label));
      }
      continue;
    }
    entries.push({ path: line, ...pending });
    pending = {};
  }
  return entries;
}

/** "Artist - Title" is the convention EXTINF follows; anything else is all title. */
function splitArtistTitle(label: string): { title: string; artist?: string } {
  const at = label.indexOf(" - ");
  if (at > 0 && at < label.length - 3) return { artist: label.slice(0, at).trim(), title: label.slice(at + 3).trim() };
  return { title: label };
}

export function parsePls(text: string): PlaylistEntry[] {
  const files = new Map<number, PlaylistEntry>();
  for (const raw of text.split(/\r\n|\n|\r/)) {
    const m = /^\s*(File|Title|Length)(\d+)\s*=\s*(.*)$/i.exec(raw);
    if (!m) continue;
    const n = Number(m[2]);
    const value = m[3]!.trim();
    const e = files.get(n) ?? { path: "" };
    const key = m[1]!.toLowerCase();
    if (key === "file") e.path = value;
    else if (key === "title" && value) e.title = value;
    else if (key === "length" && Number(value) > 0) e.duration = Number(value);
    files.set(n, e);
  }
  return [...files.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, e]) => e)
    .filter((e) => e.path);
}

export function parseXspf(text: string): PlaylistEntry[] {
  const entries: PlaylistEntry[] = [];
  for (const block of text.matchAll(/<track\b[^>]*>([\s\S]*?)<\/track>/gi)) {
    const field = (name: string): string | undefined => {
      const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i").exec(block[1]!);
      return m ? xmlText(m[1]!) || undefined : undefined;
    };
    const location = field("location");
    if (!location) continue;
    const entry: PlaylistEntry = { path: fromFileUrl(location) };
    const title = field("title");
    const artist = field("creator");
    const ms = Number(field("duration"));
    if (title) entry.title = title;
    if (artist) entry.artist = artist;
    if (ms > 0) entry.duration = ms / 1000;
    entries.push(entry);
  }
  return entries;
}

/** The text of an XML element: CDATA unwrapped, the five named entities and numeric ones decoded. */
function xmlText(raw: string): string {
  const cdata = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(raw);
  if (cdata) return cdata[1]!.trim();
  return raw
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

/** XSPF writes locations as URIs; a file:// one is a path, and its escapes are real characters. */
function fromFileUrl(location: string): string {
  if (/^file:\/\//i.test(location)) {
    try {
      return decodeURIComponent(location.replace(/^file:\/\/(?:localhost)?/i, "").replace(/^\/([a-z]:)/i, "$1"));
    } catch {
      return location;
    }
  }
  return location;
}

/** What a path names once Windows separators and the leading ./ are out of the way. */
export function splitPath(path: string): string[] {
  return path
    .replace(/\\/g, "/")
    .split("/")
    .filter((part) => part && part !== ".");
}

/** True for a path a browser can never reach from a folder it was given: absolute or climbing out. */
export function escapesFolder(path: string): boolean {
  if (/^([a-z]:|\/|\\\\)/i.test(path) || /^file:/i.test(path)) return true;
  let depth = 0;
  for (const part of splitPath(path)) {
    if (part === "..") depth--;
    else depth++;
    if (depth < 0) return true;
  }
  return false;
}

/**
 * Write entries as an M3U8: UTF-8, one #EXTINF per entry that has something to say, forward
 * slashes. The caller decides what path to put in each entry.
 */
export function writeM3u(entries: readonly PlaylistEntry[]): string {
  const lines = ["#EXTM3U"];
  for (const e of entries) {
    const label = e.artist && e.title ? `${e.artist} - ${e.title}` : (e.title ?? "");
    if (e.duration !== undefined || label) {
      lines.push(`#EXTINF:${e.duration !== undefined ? Math.round(e.duration) : -1},${label}`);
    }
    lines.push(e.path.replace(/\\/g, "/"));
  }
  return lines.join("\n") + "\n";
}

/** Order file names the way a person counts: "ep2" before "ep10", case aside. */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}
