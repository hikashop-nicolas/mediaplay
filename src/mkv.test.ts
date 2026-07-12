import { describe, it, expect } from "vitest";
import { srtToVtt, assFileToVtt, subtitleFileToVtt, decodeSubtitleBytes, extractMkvInfo } from "./mkv";

describe("srtToVtt", () => {
  it("adds the WEBVTT header, drops cue indices, and dots the decimals", () => {
    const srt = "1\n00:00:01,000 --> 00:00:02,500\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nWorld";
    const vtt = srtToVtt(srt);
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(vtt).toContain("00:00:01.000 --> 00:00:02.500\nHello");
    expect(vtt).toContain("00:00:03.000 --> 00:00:04.000\nWorld");
    expect(vtt).not.toMatch(/^\s*1\s*$/m); // index line gone
  });

  it("tolerates a UTF-8 BOM and CRLF line endings", () => {
    const srt = "﻿1\r\n00:00:00,000 --> 00:00:01,000\r\nHi\r\n";
    expect(srtToVtt(srt)).toContain("00:00:00.000 --> 00:00:01.000\nHi");
  });
});

describe("assFileToVtt", () => {
  it("converts Dialogue events, honoring the Format column order and stripping tags", () => {
    const ass = [
      "[Script Info]",
      "[V4+ Styles]",
      "Format: Name, Fontname",
      "Style: Default,Arial",
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\i1}Styled{\\i0} line",
    ].join("\n");
    const vtt = assFileToVtt(ass);
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    expect(vtt).toContain("00:00:01.000 --> 00:00:03.000");
    expect(vtt).toContain("Styled line"); // {\i1}/{\i0} override tags stripped
  });

  it("converts \\N to a newline", () => {
    const ass = ["[Events]", "Format: Layer, Start, End, Text", "Dialogue: 0,0:00:00.00,0:00:01.00,line1\\Nline2"].join("\n");
    expect(assFileToVtt(ass)).toContain("line1\nline2");
  });
});

describe("subtitleFileToVtt", () => {
  it("routes by extension", () => {
    const srt = new TextEncoder().encode("1\n00:00:01,000 --> 00:00:02,000\nA");
    expect(subtitleFileToVtt("x.srt", srt)).toContain("00:00:01.000 --> 00:00:02.000");
    const vtt = new TextEncoder().encode("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nA");
    expect(subtitleFileToVtt("x.vtt", vtt).startsWith("WEBVTT")).toBe(true);
  });
});

describe("decodeSubtitleBytes", () => {
  it("decodes valid UTF-8", () => {
    expect(decodeSubtitleBytes(new TextEncoder().encode("héllo"))).toBe("héllo");
  });
  it("never throws on non-UTF-8 bytes (windows-1252 fallback)", () => {
    expect(() => decodeSubtitleBytes(new Uint8Array([0x41, 0xe9, 0x42]))).not.toThrow();
  });
});

describe("extractMkvInfo", () => {
  it("returns empty tracks for non-Matroska bytes", () => {
    expect(extractMkvInfo(new Uint8Array([0x00, 0x01, 0x02, 0x03]))).toEqual({ subtitles: [], audio: [] });
  });
});
