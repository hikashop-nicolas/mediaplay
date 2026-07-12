import { createMediaPlayer, type MediaPlayerHandle } from "../src/index";

const playerEl = document.getElementById("player")!;
const fileInput = document.getElementById("file") as HTMLInputElement;
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

async function open(file: File): Promise<void> {
  handle?.destroy();
  playerEl.textContent = "";
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const mime = file.type || EXT_MIME[ext] || "";
  handle = createMediaPlayer(
    playerEl,
    { bytes: new Uint8Array(await file.arrayBuffer()), mime, filename: file.name },
    { onError: (msg) => console.warn(msg) },
  );
  (window as unknown as Record<string, unknown>).mediaHandle = handle; // handy in the console
}

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void open(f);
});

// Drop a file anywhere on the page.
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer?.files?.[0];
  if (f) void open(f);
});
