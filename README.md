# mediaplay

A standalone, framework-agnostic, client-side **audio / video player** for the browser.
It plays a file's raw bytes in a `<video>` / `<audio>` element and, when the browser
can't play them directly, **remuxes in memory** ([mediabunny](https://mediabunny.dev/))
into a container it accepts, **without re-encoding**, so the file's data stays untouched.
Audio codecs the browser can't decode at all (**Dolby AC-3 / E-AC-3**) are decoded by a
bundled FFmpeg WASM decoder and played through Web Audio in sync with the video.
Embedded and external **subtitles** (SRT / ASS / SSA / VTT) are extracted and rendered,
with styled ASS via [libass](https://github.com/jellyfin/JavascriptSubtitlesOctopus)
using the fonts embedded in the file. No server, no upload: nothing ever leaves the
browser.

```ts
import { createMediaPlayer } from "mediaplay";

const handle = createMediaPlayer(
  containerEl,
  { bytes: fileBytes, mime: "video/mp4", filename: "clip.mp4" },
  { onError: (msg) => console.warn(msg) },
);

// later:
handle.focus();
handle.destroy();
```

## What it does

- **Plays the bytes as-is** through a blob URL, using whatever codecs the platform
  supports. Only the file you open is touched; the player is read-only.
- **Falls back by remuxing** (stream copy where possible, WebCodecs transcode where the
  platform can decode but not stream-copy) into MP4 / WebM / OGG / WAV when direct
  playback fails, all in memory. If that also fails, a clear "not supported" message shows.
- **Decodes Dolby audio itself.** AC-3 / E-AC-3 tracks (which no browser decodes) go
  through a bundled FFmpeg-based WASM decoder and play via Web Audio, kept in sync with
  the muted video through play / pause / seek / speed changes. Volume and mute (keys and
  the native slider) apply to the decoded sound too.
- **Subtitles.** Text subtitle tracks embedded in Matroska / WebM (`S_TEXT/UTF8`,
  `S_TEXT/ASS`, `S_TEXT/WEBVTT`) are extracted to WebVTT and offered in a track menu;
  ASS/SSA tracks render styled via libass, using the **font attachments embedded in the
  file** (so CJK signs and karaoke render with the intended faces). External `.srt` /
  `.ass` / `.ssa` / `.vtt` files can be loaded from the menu, with legacy encodings
  (Shift_JIS, EUC-KR, GB18030, Windows-1252) auto-detected.
- **Audio-track switching** for files with multiple embedded audio tracks (by in-memory
  stream-copy remux, or by restarting the decoder in decoded-audio mode).
- **Keyboard controls:** `Space`/`K` play-pause, `F` fullscreen, `M` mute, `S`/`D`
  speed, `C` subtitles, `←`/`→` seek, `↑`/`↓` volume, `Home`/`End` jump. Shortcuts keep
  working even when the native controls (e.g. the timeline) have focus.

## Supported formats

**Containers.** Direct playback covers whatever the browser's `<video>` / `<audio>`
element accepts (typically MP4 / M4V, WebM, Ogg, MP3, WAV, FLAC; Matroska on Chromium).
When direct playback fails, the in-memory remux fallback covers every container
mediabunny can demux: **MP4 / MOV, Matroska / WebM (.mkv / .mka), MPEG-TS (.mts /
.m2ts), MP3, WAV, Ogg, FLAC, ADTS/AAC**. Containers with no demuxer (AVI, WMV, RM…)
show the "not supported" message.

**Video codecs.** Whatever the platform decodes — typically H.264/AVC, VP8, VP9, AV1,
and HEVC where the OS licenses it. There is no software video decoding.

**Audio codecs.**

| Codec | How it plays |
|---|---|
| AAC, MP3, Opus, Vorbis, FLAC, PCM | Natively by the browser (directly or after remux) |
| **AC-3, E-AC-3 (Dolby Digital / Plus)** | Bundled FFmpeg WASM decoder → Web Audio, synced to the video |
| **DTS, TrueHD** | Same bundled decoder, fed from the Matroska reader |

Legacy SD containers/codecs (DivX/XviD AVI, MPEG-PS, WMV, FLV) are a planned
transcode-to-play feature — see [`_plans/LEGACY_FORMATS_PLAN.md`](./_plans/LEGACY_FORMATS_PLAN.md),
which also documents what is explicitly out of scope (Hi10P, HEVC without platform
support, HD software decode).

## Subtitle assets (libass)

Styled ASS rendering runs libass in a same-origin Web Worker, so the host must serve
three files: the worker JS, its `.wasm`, and a fallback font. They ship with the
`@jellyfin/libass-wasm` dependency under `node_modules/@jellyfin/libass-wasm/dist/js/`;
copy them into your served static directory and point the player at them:

```ts
createMediaPlayer(el, source, {
  libass: {
    workerUrl: "/assets/octopus/subtitles-octopus-worker.js", // .wasm must sit beside it
    fontUrl: "/assets/octopus/default.woff2",
  },
});
```

The defaults are `octopus/subtitles-octopus-worker.js` and `octopus/default.woff2`
resolved against `document.baseURI`. Without these assets, ASS tracks fall back to the
plain-text WebVTT rendering; everything else works. See
`scripts/copy-octopus-assets.mjs` for the copy step the demo uses. Fonts embedded in
the media file are extracted and handed to libass automatically; extra host fonts can
be passed via `libass.fonts` (URLs).

## Dolby decoder assets (libav)

AC-3 / E-AC-3 decoding uses a custom [libav.js](https://github.com/Yahweasel/libav.js)
build containing only FFmpeg's ac3/eac3 decoders (~0.9 MB, LGPL-2.1 — see
`libav/NOTICE.md` for license text and rebuild instructions). The three files ship in
this package's `libav/` directory; copy them into your served static directory and
point the player at them:

```ts
createMediaPlayer(el, source, {
  libav: { base: "/assets/libav/" }, // default: libav/ under document.baseURI
});
```

See `scripts/copy-libav-assets.mjs` for the copy step the demo uses. Without these
assets, AC-3/E-AC-3 files play video-only with an "audio codec unsupported" notice.

## API

- `createMediaPlayer(container, source, options?) => MediaPlayerHandle`
  - `source: { bytes: Uint8Array; mime?: string; filename?: string }`
  - `options: { onError?; strings?; libass?: { workerUrl?, fontUrl?, fonts? }; libav?: { base? } }`
  - `handle: { getBytes(); focus(); destroy() }`
- `setLocale(code)` / `strings(override?)` — built-in i18n (English, French, Japanese);
  a host with its own translations passes `options.strings` to override individual labels.
- Subtitle helpers, usable headlessly: `extractMkvInfo`, `extractMkvSubtitles`,
  `subtitleFileToVtt`, `decodeSubtitleBytes`, `srtToVtt`, `assFileToVtt`.

## Develop

```bash
npm install
npm run dev        # demo at the printed URL (drop a media file)
npm run test       # subtitle-parser unit tests
npm run typecheck
npm run build      # emits dist/
# audio regression harness: symlink a real file to demo/public/movie.mkv, then open
# /gaptest.html on the dev server - an AudioWorklet measures dropouts per second
```

## License

MIT for mediaplay itself. Two separately-served LGPL components: the libass
worker/wasm/font from `@jellyfin/libass-wasm` (see its `COPYRIGHT`), and the FFmpeg
ac3/eac3 decoder build in `libav/` (LGPL-2.1, see `libav/NOTICE.md`).
