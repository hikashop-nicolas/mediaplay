# mediaplay

A standalone, framework-agnostic, client-side **audio / video player** for the browser.
It plays a file's raw bytes in a `<video>` / `<audio>` element and, when the browser
can't play them directly, **remuxes in memory** ([mediabunny](https://mediabunny.dev/))
into a container it accepts, **without re-encoding**, so the file's data stays untouched.
Embedded and external **subtitles** (SRT / ASS / SSA / VTT) are extracted and rendered,
with styled ASS via [libass](https://github.com/jellyfin/JavascriptSubtitlesOctopus).
No server, no upload: nothing ever leaves the browser.

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
- **Subtitles.** Text subtitle tracks embedded in Matroska / WebM (`S_TEXT/UTF8`,
  `S_TEXT/ASS`, `S_TEXT/WEBVTT`) are extracted to WebVTT and offered in a track menu;
  ASS/SSA tracks render styled via libass. External `.srt` / `.ass` / `.ssa` / `.vtt`
  files can be loaded from the menu.
- **Audio-track switching** for files with multiple embedded audio tracks (done by an
  in-memory stream-copy remux keeping only the chosen track).
- **Keyboard controls:** `Space`/`K` play-pause, `F` fullscreen, `M` mute, `S`/`D`
  speed, `C` subtitles, `←`/`→` seek, `↑`/`↓` volume, `Home`/`End` jump.

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
`scripts/copy-octopus-assets.mjs` for the copy step the demo uses.

## API

- `createMediaPlayer(container, source, options?) => MediaPlayerHandle`
  - `source: { bytes: Uint8Array; mime?: string; filename?: string }`
  - `options: { onError?; strings?; libass? }`
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
```

## License

MIT. Bundles no media; the libass worker/wasm/font come from `@jellyfin/libass-wasm`
(see its `COPYRIGHT`).
