# Playlist plan

Draft, 2026-10-20. Goal: play more than one file. Open a folder or a selection of files, or a
playlist file, and get a queue with next and previous, shuffle for music, and repeat all /
repeat one / stop at the end. Spans mediaplay (the queue, the UI, the parsers) and Omnitext
(getting several files in, which is the harder half).

## What exists today

- `createMediaPlayer(container, source, options)` takes exactly one `MediaSource` (`blob` or
  `bytes`, `mime`, `filename`) and mounts a player for it. 1591 lines in `player.ts`, with its
  own control bar, libass overlay, thumbnails, AC-3 and ALAC side decoders, visualiser.
- `MediaPlayerHandle` exposes `getBytes`, `getMediaElement`, `setSubtitleText`, `focus`,
  `destroy`. Nothing about a queue.
- Omnitext is a strictly single-document host: the open paths take `files[0]` and
  `showOpenFilePicker()` without `multiple`, the drop handler takes `dataTransfer.files[0]`,
  and Android picks one document through `ACTION_OPEN_DOCUMENT`.
- subedit embeds the player (`embedded: true`) with one file and drives it itself. Whatever we
  add must leave that path untouched.

## Constraints worth knowing before designing

- **Folders.** `showDirectoryPicker` is Chromium only; Firefox and Safari have declined the
  local-disk pickers. `<input type="file" webkitdirectory multiple>` works everywhere,
  including Safari and Firefox, and a dropped folder can be walked with
  `webkitGetAsEntry()`. So a folder needs three routes, not one.
- **Android WebView has no Media Session API.** Lock-screen controls, headset buttons and
  playback with the screen off need a native plugin (AndroidX Media3) and a foreground
  service. In-player next/previous buttons need none of that. Keep them in separate phases.
- **The offline promise.** Playlist files routinely point at `http://` URLs. Omnitext's pitch
  is that nothing leaves the browser, and it already has a consent gate
  (`src/remote-consent.ts`) for the few things that fetch. Remote entries are fetched only
  after that gate says yes, once per playlist, and never silently. Decided: allowed behind it.
- **Relative paths.** A playlist names `../Music/track.mp3`. A browser can only resolve that
  against a directory the user granted. Opened from a folder we hold, resolution is easy;
  opened on its own, the entries are names we cannot read, and the player has to say so and
  offer "choose the folder".
- **Memory.** A folder can hold hundreds of files. Only the playing file may be open; the rest
  stay as a name plus a thunk that produces the `MediaSource` when its turn comes.
- **F-Droid.** No new binary blobs, no prebuilt dependencies outside npm, reproducible build
  unaffected. The parsers are a few hundred lines of our own code; mediabunny is already here.

## Design

### The queue lives in mediaplay

`createMediaPlayer` accepts a list as well as a single source, so a host that already works
keeps working:

```ts
createMediaPlayer(el, source);                       // unchanged
createMediaPlayer(el, [entryA, entryB, entryC], {    // new
  playlist: { startIndex: 0, repeat: "all", shuffle: false, onTrackChange: (i, entry) => … },
});
```

A queue entry is deliberately lazy, because a folder of 400 tracks must not hold 400 file
handles or decoders:

```ts
interface QueueEntry {
  /** What to show before anything is read: the file name, or the playlist's own label. */
  title: string;
  /** Produces the media when this entry's turn comes. Called once, then cached. */
  load: () => Promise<MediaSource>;
  /** Known without reading the file (playlist metadata), if the host has it. */
  duration?: number;
  artist?: string;
  /** For an entry we cannot reach: a relative path we have no folder for, or a remote URL. */
  unavailable?: "missing" | "remote";
}
```

Handle gains `next()`, `previous()`, `goTo(index)`, `getQueue()`, `getIndex()`,
`setRepeat(mode)`, `setShuffle(on)`, `add(entries)`, `remove(index)`. Everything else keeps
its current meaning for the entry that is playing.

### Behaviour

- **Advance** on `ended`, and on an unplayable entry after showing its error for about two
  seconds, so one broken file does not end the evening. Advancing uses the activation the
  first play already gave us, so autoplay policy does not bite.
- **Repeat**: `"off"` stops at the end of the last entry, `"all"` wraps, `"one"` repeats the
  current entry. One button cycling the three, remembered in localStorage beside the existing
  visualiser preference.
- **Shuffle**: offered only when every entry is audio, which is what was asked. Implemented as
  a shuffled order of indices computed once per enable (so previous goes back to what you
  actually heard), reshuffled on a wrap in `"all"`.
- **Previous** behaves the way players do: restart the current entry if more than ~3 seconds
  have played, otherwise go back one.
- **Metadata**: mediabunny 1.51 already reads `MetadataTags` (title, artist, album, cover
  images) through `getMetadataTags`, so the list can show real titles and the cover can feed
  the visualiser stage and Media Session artwork. Read lazily, one entry at a time, never for
  the whole folder at once.
- **Media Session** (web only in the first pass): metadata for the current entry and
  `nexttrack` / `previoustrack` / `play` / `pause` handlers whenever the queue holds more than
  one entry.

### UI

A playlist button in the control bar opens a panel over the stage: index, title, artist,
duration, the current one marked, click to jump, a remove control per row, and the three
controls (previous, next, repeat, plus shuffle for audio). Next and previous also sit in the
bar itself when the queue has more than one entry, which is the only change to the bar's
default look. Keyboard: `n` / `p`, and the existing shortcuts keep their meaning. Reordering
by drag is a later phase, not part of the first one.

### Playlist files

Parsers live in mediaplay as pure functions, so they are testable without a DOM and usable by
any host:

```ts
parsePlaylist(text: string, filename: string): PlaylistEntry[]   // { path, title?, duration? }
writeM3u(entries): string
```

- **M3U / M3U8**: `#EXTM3U`, `#EXTINF:<seconds>,<Artist> - <Title>`, one path per line,
  `#` comments ignored. M3U8 is UTF-8; plain M3U is decoded with the existing encoding sniffer.
  Note that `.m3u8` is also the HLS manifest extension: a file whose entries are `#EXT-X-…`
  segments is an HLS stream, which we do not play, and it should say so rather than produce a
  queue of nothing.
- **PLS**: `[playlist]`, `FileN=`, `TitleN=`, `LengthN=`, `NumberOfEntries=`.
- **XSPF**: XML, `<track><location>`, `<title>`, `<duration>` in milliseconds.
- **CUE** is a different animal (one audio file cut into indexed tracks) and is out of scope
  here; worth its own plan if you want it.

Path resolution: entries are resolved against the folder the playlist came from, when we have
it. An entry that escapes that folder, or an absolute path, cannot be read by a browser and is
marked `missing`; `http(s)` entries are marked `remote`. Both show in the list, greyed, so the
playlist is honest about what it holds. A `remote` entry becomes playable once the host
grants consent for the playlist: the entry's `load` then hands the player the URL (streamed by
the media element, not downloaded into memory), and the player shows that the source is
online while it plays.

## Omnitext side

1. **Several files at once.** `showOpenFilePicker({ multiple: true })`, `multiple` on the
   fallback input, and the whole of `dataTransfer.files` on drop. More than one media file
   becomes a queue; more than one of anything else keeps today's behaviour (first file wins),
   since Omnitext edits one document.
2. **A folder.** `showDirectoryPicker()` where it exists, `<input webkitdirectory>` elsewhere,
   and `webkitGetAsEntry()` for a dropped folder. Files are filtered to the media formats
   already in `formats/binary-viewers.ts` and sorted naturally, so `ep2` precedes `ep10`.
   Decided: the folder's own files only, no descent into subfolders.
3. **Playlist formats.** Register `.m3u`, `.m3u8`, `.pls`, `.xspf` as formats whose editor is
   the media player. Opened from a folder we hold, entries resolve and play. Opened alone, the
   player shows the list and a "choose the folder" button that grants the directory and
   resolves them.
4. **Saving a queue.** Decided: Omnitext writes the queue back as M3U8 (`writeM3u`), UTF-8,
   relative paths against the folder when there is one, `#EXTINF` from the tags we have read.
   Save As offers it for any queue; a queue opened from a playlist file saves back to it.
5. **The document model.** A queue is one Omnitext document: the filename shown is the playing
   entry, the title bar carries the playlist name when there is one, Close closes the lot.
   Recent files records the folder or the playlist file, not each track.
6. **Android.** `FileOpenerPlugin.pickDocument` gains `EXTRA_ALLOW_MULTIPLE`, plus a
   `pickFolder` on `ACTION_OPEN_DOCUMENT_TREE` that lists the tree's media children, and
   intake for `ACTION_SEND_MULTIPLE`. Decided: in-app controls only. Lock-screen controls and
   screen-off playback (Media3 plugin plus a foreground service) are out of this release, so
   the F-Droid recipe gains no dependency.

## Status

Done 2026-10-23, in mediaplay and Omnitext: steps 1 to 10, checked in node (queue, parsers,
sources), in a real browser (cypress, 12 tests) and headless Chrome against Omnitext, and on the
phone for the multi-file picker, the folder picker and a playlist file. Not exercised: a
multiple share (SEND_MULTIPLE), which adb cannot send; the code is in and compiles. One change
from the plan: the Android pickers describe documents and stage each when it plays, because the
plugin copies a file out of its provider and a queue must not copy fifty.

## Steps

Each step ends green and shippable on its own.

1. **Queue core in mediaplay.** List source, lazy entries, auto-advance, next/previous/goTo,
   repeat modes with persistence, handle API. Bar gets previous/next and the repeat button
   when the queue has more than one entry. No panel yet.
2. **Playlist panel and metadata.** The panel described above, titles and durations from
   mediabunny tags read lazily, cover art where present, shuffle for all-audio queues,
   keyboard shortcuts.
3. **Parsers.** `parsePlaylist` for M3U/M3U8/PLS/XSPF with the HLS guard, `writeM3u`, unit
   tests over a small corpus (`test-corpus/` already exists) including CRLF, BOM, unicode
   titles, Windows paths and a malformed file.
4. **Omnitext: several files.** Picker, input and drop accept many; media selections build a
   queue. Title and recents behaviour as above.
5. **Omnitext: a folder.** The three routes, media filter, natural sort, subfolder rule.
6. **Omnitext: playlist files.** The four formats registered, resolution against a known
   folder, the "choose the folder" path, remote entries behind the consent gate, and saving a
   queue back as M3U8.
7. **Android pickers.** Multi-select, folder tree, `ACTION_SEND_MULTIPLE`.
8. **Media Session on the web.** Metadata and handlers; the Android native side stays a
   decision, not a step.
9. **Accessibility pass**, its own commit per repo rule: the panel as a real list, roles and
   names on the new buttons, focus order, touch targets.
10. **Docs**: mediaplay README and demo (drop a folder on it), Omnitext README, release notes.

## Checks per step

- Unit tests in mediaplay for the queue state machine (advance, wrap, repeat one, shuffle order
  stability, previous within 3 seconds, skipping an unplayable entry) and for every parser.
- A cypress run in mediaplay driving a three-file queue: plays through, next, previous, repeat
  one, shuffle on an audio queue, remove the playing entry.
- Omnitext unit tests for the folder scan (filter, natural sort) and the resolution rules, plus
  an end-to-end open of several files.
- Manual on the phone for the Android pickers, and on Safari and Firefox for the folder input,
  since those are exactly the routes the automated runs do not cover.

## Decisions

Settled 2026-10-23.

1. Folders: the folder's own files only. No subfolder descent in this release.
2. Omnitext saves a queue as an M3U8 playlist file.
3. Android: in-app controls only. No Media3 plugin, no foreground service, no new F-Droid
   dependency. Revisit after release if people ask for screen-off playback.
4. Remote entries in a playlist play behind the existing consent prompt, once per playlist.
5. Shuffle is offered for all-audio queues only; the button is hidden for a queue holding any
   video (assumed from the original ask, "for music only").
