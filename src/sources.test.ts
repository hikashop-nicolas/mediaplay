import { describe, expect, it } from "vitest";
import { entriesFromFiles, entriesFromPlaylist, fileFinder, isAudioName, isMediaName } from "./sources";

/** A File that claims a place inside a picked folder, as the browser's folder input does. */
function file(name: string, folder = ""): File {
  const f = new File(["x"], name);
  if (folder) Object.defineProperty(f, "webkitRelativePath", { value: `${folder}/${name}` });
  return f;
}

describe("a folder or a pile of files", () => {
  it("keeps the media, in the order a person counts, and drops the rest", () => {
    const entries = entriesFromFiles([
      file("ep10.mkv", "Show"),
      file("cover.jpg", "Show"),
      file("ep2.mkv", "Show"),
      file("notes.txt", "Show"),
      file("Ep1.mkv", "Show"),
    ]);
    expect(entries.map((e) => e.title)).toEqual(["Ep1.mkv", "ep2.mkv", "ep10.mkv"]);
  });

  it("knows sound from picture by name", () => {
    expect(isMediaName("a.FLAC")).toBe(true);
    expect(isMediaName("a.pdf")).toBe(false);
    expect(isAudioName("a.mp3")).toBe(true);
    expect(isAudioName("a.mkv")).toBe(false);
  });

  it("gives the player the file itself, with a type, when the entry's turn comes", async () => {
    const [entry] = entriesFromFiles([file("movie.mkv")]);
    const source = await entry!.load();
    expect(source.blob).toBeInstanceOf(File);
    expect(source.mime).toBe("video/x-matroska");
    expect(entry!.audio).toBe(false);
  });
});

describe("what a playlist points at", () => {
  const album = [file("01 One.mp3", "Album"), file("02 Two.mp3", "Album"), file("art.jpg", "Album")];
  const list = file("mix.m3u8", "Album");
  const find = fileFinder([...album, list], "Album/mix.m3u8");

  it("finds a file beside the playlist", () => {
    expect(find("01 One.mp3")?.name).toBe("01 One.mp3");
    expect(find("./02 Two.mp3")?.name).toBe("02 Two.mp3");
  });

  it("finds it however the playlist spells the separators and the case", () => {
    expect(find(".\\01 one.MP3")?.name).toBe("01 One.mp3");
  });

  it("finds a file by name when the playlist was written somewhere else", () => {
    expect(find("C:\\Users\\me\\Music\\Album\\02 Two.mp3")?.name).toBe("02 Two.mp3");
    expect(find("/home/me/Music/01 One.mp3")?.name).toBe("01 One.mp3");
  });

  it("does not guess when two files share the name", () => {
    const twin = fileFinder([file("a.mp3", "X"), file("a.mp3", "Y")], "X/list.m3u");
    expect(twin("elsewhere/a.mp3")).toBeUndefined();
    expect(twin("a.mp3")?.webkitRelativePath).toBe("X/a.mp3");
  });

  it("finds nothing for a file that is not there", () => {
    expect(find("missing.mp3")).toBeUndefined();
  });

  it("keeps every line of the playlist, marking what cannot play", async () => {
    const entries = entriesFromPlaylist(
      [
        { path: "01 One.mp3", title: "First", artist: "Band", duration: 61 },
        { path: "gone.mp3" },
        { path: "https://example.test/live.mp3", title: "Radio" },
      ],
      find,
    );
    expect(entries.map((e) => e.unavailable)).toEqual([undefined, "missing", "remote"]);
    expect(entries[0]).toMatchObject({ title: "First", artist: "Band", duration: 61 });
    expect((await entries[0]!.load()).blob).toBeInstanceOf(File);
    expect(entries[1]!.title).toBe("gone.mp3");
    expect((await entries[2]!.load()).url).toBe("https://example.test/live.mp3");
  });
});
