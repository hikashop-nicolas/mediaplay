// Turning what a person hands over (a handful of files, a folder, a playlist file) into queue
// entries. Nothing is read here: an entry holds a File and gives it to the player when its turn
// comes, so a folder of hundreds costs nothing until played.

import type { QueueEntry } from "./playlist-player";
import { isRemote, naturalCompare, splitPath, type PlaylistEntry } from "./playlist";

const VIDEO_EXT = ["mp4", "m4v", "webm", "ogv", "mov", "mkv", "3gp", "3g2", "mts", "m2ts", "avi", "wmv"];
const AUDIO_EXT = ["mp3", "wav", "ogg", "oga", "opus", "m4a", "aac", "flac", "weba", "mka", "wma"];
const MEDIA_NAME = new RegExp(`\\.(${[...VIDEO_EXT, ...AUDIO_EXT].join("|")})$`, "i");
const AUDIO_NAME = new RegExp(`\\.(${AUDIO_EXT.join("|")})$`, "i");

/** A MIME type for containers the browser does not name itself. */
const EXT_MIME: Record<string, string> = {
  mkv: "video/x-matroska",
  mka: "audio/x-matroska",
  avi: "video/x-msvideo",
  wmv: "video/x-ms-wmv",
  wma: "audio/x-ms-wma",
  flac: "audio/flac",
  opus: "audio/ogg",
  m4a: "audio/mp4",
  m4v: "video/mp4",
  mts: "video/mp2t",
  m2ts: "video/mp2t",
  "3gp": "video/3gpp",
  "3g2": "video/3gpp",
};

export function isMediaName(name: string): boolean {
  return MEDIA_NAME.test(name);
}

export function isAudioName(name: string): boolean {
  return AUDIO_NAME.test(name);
}

/**
 * What a queue entry is made from: a File, or anything that can produce one when its turn comes.
 * The second is for a host whose files are not readable in place, like Android, where each is
 * copied out of the document provider only when it plays.
 */
export interface FileSource {
  name: string;
  type?: string;
  /** Where it sat inside a picked folder. */
  webkitRelativePath?: string;
  /** Produces the bytes when asked. A File needs none: it is its own. */
  load?: () => Promise<Blob>;
}

const blobOf = async (f: FileSource): Promise<Blob> => (f.load ? f.load() : (f as unknown as Blob));

/** Where a file sits relative to what was picked: its path inside a folder, else just its name. */
function relativePath(file: FileSource): string {
  return file.webkitRelativePath || file.name;
}

/** The entry for one file: lazy, and honest about whether it is sound. */
export function entryFromFile(file: FileSource): QueueEntry {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return {
    title: file.name,
    source: relativePath(file),
    audio: isAudioName(file.name),
    load: async () => ({ blob: await blobOf(file), mime: file.type || EXT_MIME[ext] || "", filename: file.name }),
  };
}

/**
 * The media among some files, in the order a person counts them: "ep2" before "ep10". Anything
 * that is not media (a cover image, a playlist, a text file) is left out, which is what makes
 * dropping a whole album folder work.
 */
export function sortMedia<T extends FileSource>(files: Iterable<T>): T[] {
  return [...files].filter((f) => isMediaName(f.name)).sort((a, b) => naturalCompare(relativePath(a), relativePath(b)));
}

/** The queue entries for those files, in that order. */
export function entriesFromFiles(files: Iterable<FileSource>): QueueEntry[] {
  return sortMedia(files).map(entryFromFile);
}

/**
 * Find the file a playlist entry names among some files, resolved against the folder the
 * playlist itself was in. The exact relative path wins where the files carry one (a picked
 * folder does). Failing that the bare name does, when exactly one file has it: a playlist
 * written on another machine names C:\Music\a.mp3, and the album folder it came from is
 * what the person picked.
 */
export function fileFinder<T extends FileSource>(files: readonly T[], playlistPath = ""): (path: string) => T | undefined {
  const base = splitPath(playlistPath).slice(0, -1);
  const byPath = new Map<string, T>();
  const byName = new Map<string, T | null>();
  for (const f of files) {
    byPath.set(splitPath(relativePath(f)).join("/").toLowerCase(), f);
    const key = f.name.toLowerCase();
    byName.set(key, byName.has(key) ? null : f);
  }
  return (path) => {
    const wanted = splitPath(path);
    const parts = /^([a-z]:|\/|\\\\)/i.test(path) ? [] : [...base];
    for (const part of wanted) {
      if (part === "..") parts.pop();
      else parts.push(part);
    }
    return byPath.get(parts.join("/").toLowerCase()) ?? byName.get((wanted[wanted.length - 1] ?? "").toLowerCase()) ?? undefined;
  };
}

/**
 * Queue entries for what a playlist file lists. An entry with a file to go with it plays; one
 * we cannot reach is kept and marked, so the list says what the playlist holds rather than
 * quietly shrinking. An entry on the web stays marked remote until the host allows it.
 */
export function entriesFromPlaylist(
  items: readonly PlaylistEntry[],
  find: (path: string) => FileSource | undefined,
): QueueEntry[] {
  return items.map((item) => {
    const label = item.title ?? item.path.split(/[\\/]/).pop() ?? item.path;
    const base: QueueEntry = {
      title: label,
      source: item.path,
      artist: item.artist,
      duration: item.duration,
      audio: isAudioName(item.path) || undefined,
      load: async () => {
        throw new Error("not reachable");
      },
    };
    if (isRemote(item.path)) {
      return { ...base, unavailable: "remote", load: async () => ({ url: item.path }) };
    }
    const file = find(item.path);
    if (!file) return { ...base, unavailable: "missing" };
    const entry = entryFromFile(file);
    return { ...entry, title: item.title ?? entry.title, source: item.path, artist: item.artist, duration: item.duration };
  });
}

/**
 * Playlist lines for a queue, ready for writeM3u. Entries made from a picked folder carry
 * "Album/01.mp3"; saved beside the files the folder name goes, so the playlist keeps working
 * when the folder is moved. A path a playlist spelled itself is kept as it was.
 */
export function playlistFromEntries(entries: readonly QueueEntry[]): PlaylistEntry[] {
  const sources = entries.map((e) => e.source ?? e.title);
  const roots = new Set(sources.map((s) => (s.includes("/") && !/^(\.\.|[a-z]:)/i.test(s) && !s.startsWith("/") ? s.split("/")[0] : "")));
  const strip = roots.size === 1 && !roots.has("");
  return entries.map((e, i) => {
    const source = sources[i]!;
    const line: PlaylistEntry = { path: strip ? source.split("/").slice(1).join("/") : source };
    if (e.title && e.title !== line.path.split(/[\\/]/).pop()) line.title = e.title;
    if (e.artist) line.artist = e.artist;
    if (e.duration) line.duration = e.duration;
    return line;
  });
}
