import { describe, expect, it } from "vitest";
import {
  escapesFolder,
  HlsManifestError,
  isRemote,
  naturalCompare,
  parsePlaylist,
  playlistKind,
  writeM3u,
} from "./playlist";

describe("M3U", () => {
  it("reads paths, ignoring blank lines and comments", () => {
    const text = "#EXTM3U\n\n# a comment\nmusic/one.mp3\n\nmusic/two.mp3\n";
    expect(parsePlaylist(text, "mix.m3u").map((e) => e.path)).toEqual(["music/one.mp3", "music/two.mp3"]);
  });

  it("reads EXTINF as duration, artist and title", () => {
    const text = "#EXTM3U\n#EXTINF:215,Some Artist - A Song\none.mp3\n#EXTINF:-1,Just A Title\ntwo.mp3\n";
    expect(parsePlaylist(text, "a.m3u8")).toEqual([
      { path: "one.mp3", duration: 215, artist: "Some Artist", title: "A Song" },
      { path: "two.mp3", title: "Just A Title" },
    ]);
  });

  it("keeps a dash inside a title that has no artist", () => {
    const [e] = parsePlaylist("#EXTINF:10,Solo-Piece\nx.mp3\n", "a.m3u");
    expect(e).toEqual({ path: "x.mp3", duration: 10, title: "Solo-Piece" });
  });

  it("does not carry one entry's EXTINF onto the next", () => {
    const entries = parsePlaylist("#EXTINF:30,First\na.mp3\nb.mp3\n", "a.m3u");
    expect(entries[1]).toEqual({ path: "b.mp3" });
  });

  it("copes with CRLF, a lone CR, a byte order mark and unicode", () => {
    const text = "\uFEFF#EXTM3U\r\n#EXTINF:5,日本語 - 曲\r\nmusique/été.mp3\r\n";
    expect(parsePlaylist(text, "a.m3u8")).toEqual([{ path: "musique/été.mp3", duration: 5, artist: "日本語", title: "曲" }]);
    expect(parsePlaylist("a.mp3\rb.mp3\r", "x.m3u").map((e) => e.path)).toEqual(["a.mp3", "b.mp3"]);
  });

  it("keeps Windows paths as written", () => {
    expect(parsePlaylist("C:\\Music\\one.mp3\n..\\up\\two.mp3\n", "a.m3u").map((e) => e.path)).toEqual([
      "C:\\Music\\one.mp3",
      "..\\up\\two.mp3",
    ]);
  });

  it("keeps remote entries", () => {
    const [e] = parsePlaylist("https://example.test/radio.mp3\n", "a.m3u");
    expect(isRemote(e!.path)).toBe(true);
  });

  it("gives an empty list for an empty file", () => {
    expect(parsePlaylist("", "a.m3u")).toEqual([]);
    expect(parsePlaylist("#EXTM3U\n", "a.m3u")).toEqual([]);
  });

  it("refuses an HLS manifest rather than queueing its segments", () => {
    const hls = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\n#EXTINF:9.9,\nseg0.ts\n#EXT-X-ENDLIST\n";
    expect(() => parsePlaylist(hls, "stream.m3u8")).toThrow(HlsManifestError);
  });
});

describe("PLS", () => {
  const pls = `[playlist]
NumberOfEntries=3
File2=two.mp3
Title2=Second
Length2=120
File1=one.mp3
Title1=First
Length1=-1
File3=three.mp3
Version=2
`;
  it("reads the numbered entries in their own order", () => {
    expect(parsePlaylist(pls, "a.pls")).toEqual([
      { path: "one.mp3", title: "First" },
      { path: "two.mp3", title: "Second", duration: 120 },
      { path: "three.mp3" },
    ]);
  });

  it("is recognised by its content when the name does not say", () => {
    expect(parsePlaylist(pls, "playlist.txt")).toHaveLength(3);
  });

  it("drops a numbered title that has no file", () => {
    expect(parsePlaylist("[playlist]\nTitle1=Orphan\nFile2=x.mp3\n", "a.pls")).toEqual([{ path: "x.mp3" }]);
  });
});

describe("XSPF", () => {
  const xspf = `<?xml version="1.0" encoding="UTF-8"?>
<playlist version="1" xmlns="http://xspf.org/ns/0/">
  <trackList>
    <track>
      <location>file:///home/me/Music/Caf%C3%A9.mp3</location>
      <title>Caf&#233; &amp; Cr&egrave;me</title>
      <creator><![CDATA[Band <1>]]></creator>
      <duration>183500</duration>
    </track>
    <track><location>https://example.test/a.ogg</location></track>
    <track><title>No location</title></track>
  </trackList>
</playlist>`;

  it("reads location, title, creator and duration in milliseconds", () => {
    const entries = parsePlaylist(xspf, "a.xspf");
    expect(entries[0]).toEqual({ path: "/home/me/Music/Café.mp3", title: "Café & Cr&egrave;me", artist: "Band <1>", duration: 183.5 });
    expect(entries[1]).toEqual({ path: "https://example.test/a.ogg" });
    expect(entries, "a track with no location is skipped").toHaveLength(2);
  });

  it("turns a Windows file URL into a drive path", () => {
    const [e] = parsePlaylist("<track><location>file:///C:/Music/a%20b.mp3</location></track>", "a.xspf");
    expect(e!.path).toBe("C:/Music/a b.mp3");
  });
});

describe("what a path can reach", () => {
  it.each([
    ["one.mp3", false],
    ["sub/one.mp3", false],
    ["./sub/../one.mp3", false],
    ["../one.mp3", true],
    ["a/../../one.mp3", true],
    ["/abs/one.mp3", true],
    ["C:\\Music\\one.mp3", true],
    ["\\\\server\\share\\one.mp3", true],
    ["file:///x.mp3", true],
  ])("%s escapes the folder: %s", (path, escapes) => {
    expect(escapesFolder(path)).toBe(escapes);
  });
});

describe("naming", () => {
  it("knows a playlist by its extension, whatever the case", () => {
    expect(playlistKind("A.M3U8")).toBe("m3u");
    expect(playlistKind("a.pls")).toBe("pls");
    expect(playlistKind("a.xspf")).toBe("xspf");
    expect(playlistKind("a.mp3")).toBeNull();
  });

  it("counts the way a person does", () => {
    expect(["ep10.mkv", "ep2.mkv", "Ep1.mkv"].sort(naturalCompare)).toEqual(["Ep1.mkv", "ep2.mkv", "ep10.mkv"]);
  });
});

describe("writing M3U8", () => {
  it("writes EXTINF for entries that have details, and reads back what it wrote", () => {
    const entries = [
      { path: "one.mp3", artist: "Some Artist", title: "A Song", duration: 215.4 },
      { path: "sub\\two.mp3" },
      { path: "https://example.test/r.mp3", title: "Radio" },
    ];
    const text = writeM3u(entries);
    expect(text.startsWith("#EXTM3U\n")).toBe(true);
    expect(text).not.toContain("\\");
    expect(parsePlaylist(text, "out.m3u8")).toEqual([
      { path: "one.mp3", artist: "Some Artist", title: "A Song", duration: 215 },
      { path: "sub/two.mp3" },
      { path: "https://example.test/r.mp3", title: "Radio" },
    ]);
  });
});
