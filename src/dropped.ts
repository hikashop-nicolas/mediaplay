// What a drop or a picker handed over, as a flat list of files. A dropped folder arrives as a
// directory entry, which the files-only view of a drop (dataTransfer.files) shows as one
// useless item, so the entries are read directly.

/** A File that remembers where it sat inside a dropped or picked folder. */
function withPath(file: File, path: string): File {
  if (!(file as File & { webkitRelativePath?: string }).webkitRelativePath) {
    Object.defineProperty(file, "webkitRelativePath", { value: path });
  }
  return file;
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

/** A directory's own files, in batches until the reader is empty (it hands back ~100 at a time). */
async function directoryFiles(dir: FileSystemDirectoryEntry): Promise<File[]> {
  const reader = dir.createReader();
  const files: File[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
    if (!batch.length) break;
    for (const e of batch) {
      if (e.isFile) files.push(withPath(await entryFile(e as FileSystemFileEntry), `${dir.name}/${e.name}`));
    }
  }
  return files;
}

/**
 * The files in a drop: each file itself, and the own files of each folder (subfolders are not
 * entered). Falls back to the plain file list where directory entries are not available.
 */
export async function readDropped(data: DataTransfer): Promise<File[]> {
  const items = Array.from(data.items ?? []).filter((i) => i.kind === "file");
  const entries = items.map((i) => i.webkitGetAsEntry?.() ?? null);
  if (!items.length || entries.some((e) => !e)) return Array.from(data.files);
  const out: File[] = [];
  for (const entry of entries as FileSystemEntry[]) {
    if (entry.isFile) out.push(await entryFile(entry as FileSystemFileEntry));
    else if (entry.isDirectory) out.push(...(await directoryFiles(entry as FileSystemDirectoryEntry)));
  }
  return out;
}
