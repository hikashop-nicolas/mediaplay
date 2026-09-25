# Own control bar plan

Draft, 2026-09-25. Goal: replace the browser's native media control bar with our own, so the
player looks and behaves the same everywhere, and so the timeline is ours to build on. The
first thing built on it is the hover thumbnail preview asked for in omnitext issue 22.

## Why replace the native bar

- The native timeline lives in a closed shadow DOM. We cannot read its geometry, so we cannot
  know which timestamp the pointer is over, and cannot anchor a preview to it. A hover preview
  requires our own scrubber; there is no half measure.
- Most of the awkward code in player.ts exists to work around the native bar:
  - the document-level capture keydown handler, because focus lands inside the controls'
    shadow DOM and it eats Space and F;
  - ot-media-idle, which mimics the native idle hide for our own floating buttons;
  - hiding the native fullscreen button (ot-media-ownfs) because it fullscreens the bare video
    and leaves the libass canvas behind, plus the fullscreenchange upgrade and the VTT bridge
    that catch the paths where it still happens;
  - the CC and fullscreen buttons floating at hardcoded left offsets, because they cannot join
    a bar we do not own;
  - the dblclick handler that has to guess where the native bar is (clientY > bottom - 70).
- The player then looks identical in Chrome, Firefox, Safari, the PWA and the APK.

## Known limits

- iPhone has no element fullscreen: video fullscreen there is the system player, so our bar
  does not follow it. On that platform we keep the native controls for the fullscreen state.
- Custom controls mean we own accessibility: roles, names, focus order, touch target sizes.
  That work goes in its own commit (repo rule).

## Thumbnails: how the frames come out

mediabunny is already a dependency and ships CanvasSink, which decodes a frame at an arbitrary
timestamp straight from the source bytes. Preferred over the usual hidden second video element:

- it works for files the browser cannot decode natively (the whole remux path);
- it does not take a second video decoder slot, which is scarce on mobile;
- it gives an async iterator, so a coarse grid can be prefetched while idle.

Shape: lazy decode at the hovered timestamp, throttled to about 100 ms, small LRU cache keyed
on the rounded timestamp, plus an idle prefetch every N seconds (N scaled to the duration) so
the first hover is not blank. Thumbnails are off by default in embedded mode, because issue 22
explicitly asks for them not to appear in subedit.

## Steps

All four done 2026-09-25 (1e01b43, a0eb4aa, 86bf5f7, e37cdf2).

1. The bar itself, video only, behind a `controls` option ("own" | "native"), native staying
   available as the fallback and for audio. Play/pause, scrubber with the buffered ranges,
   current time and duration, volume with mute, idle auto-hide, click to play/pause.
2. Move the CC/tracks and fullscreen buttons into the bar and delete the workarounds above
   that stop being necessary: the native fullscreen hiding, the dblclick offset guess, the
   separate idle-hide for the floating buttons. Add the speed control to the menu.
3. Hover thumbnails on the scrubber via CanvasSink, with the caching described above; off by
   default in embedded mode.
4. Accessibility pass, separate commit: roles and names on every control, the scrubber as a
   real slider with keyboard support, focus visible, reduced-motion respected.

## Checks per step

Typecheck, the vitest suite, and the Cypress e2e run (which drives the demo page, so the bar
gets exercised there). Subedit consumes the player embedded: after step 2, re-check its preview
before pinning the new commit into Omnitext.
