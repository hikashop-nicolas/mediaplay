import {
  createMediaPlayer,
  entriesFromFiles,
  entriesFromPlaylist,
  fileFinder,
  HlsManifestError,
  parsePlaylist,
  playlistKind,
  readDropped,
  type MediaPlayerHandle,
} from "../src/index";

const playerEl = document.getElementById("player")!;
const fileInput = document.getElementById("file") as HTMLInputElement;
const folderInput = document.getElementById("folder") as HTMLInputElement;
let handle: MediaPlayerHandle | null = null;

// A rough MIME guess by extension, for containers the browser doesn't map itself.
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
};

/** Clear the stage, then let `make` mount into it. */
function show(make: () => MediaPlayerHandle): void {
  handle?.destroy();
  playerEl.textContent = "";
  handle = make();
  (window as unknown as Record<string, unknown>).mediaHandle = handle; // handy in the console
}

async function openOne(file: File): Promise<void> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = file.type || EXT_MIME[ext] || "";
  show(() => createMediaPlayer(playerEl, { blob: file, mime, filename: file.name }, { onError: (msg) => console.warn(msg) }));
}

/** One or several files, a folder, or a playlist: whichever it is becomes a queue or a single file. */
async function open(files: File[]): Promise<void> {
  const playlist = files.find((f) => playlistKind(f.name));
  if (playlist) {
    try {
      const items = parsePlaylist(await playlist.text(), playlist.name);
      const rel = (playlist as File & { webkitRelativePath?: string }).webkitRelativePath || playlist.name;
      const entries = entriesFromPlaylist(items, fileFinder(files, rel));
      show(() => createMediaPlayer(playerEl, entries, { allowRemote: async () => confirm("This playlist plays from the web. Allow it?") }));
    } catch (e) {
      if (e instanceof HlsManifestError) alert(e.message);
      else throw e;
    }
    return;
  }
  const entries = entriesFromFiles(files);
  if (entries.length > 1) show(() => createMediaPlayer(playerEl, entries, { onError: (msg) => console.warn(msg) }));
  else if (files[0]) await openOne(entries.length ? files.find((f) => f.name === entries[0]!.title)! : files[0]);
}

fileInput.addEventListener("change", () => {
  if (fileInput.files?.length) void open([...fileInput.files]);
});
folderInput.addEventListener("change", () => {
  if (folderInput.files?.length) void open([...folderInput.files]);
});

// Drop files or a folder anywhere on the page.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  if (!e.dataTransfer) return;
  const files = await readDropped(e.dataTransfer);
  if (files.length) void open(files);
});
