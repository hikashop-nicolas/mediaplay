# ALAC playback (plan)

Status: **Phase 0 done** (2026-07-29). Phases 1 to 5 not started.

## Where we are

Measured, not assumed (`canPlayType` in Chrome, July 2026):

| Codec | Browser | mediaplay today |
|---|---|---|
| AAC (MP4 and ADTS) | plays everywhere | works, nothing to do |
| FLAC (bare and in MP4) | plays everywhere | works, nothing to do |
| **ALAC** | **Chrome and Firefox: no. Safari: yes.** | **fails** |

So of the three libraries that prompted this, two solve problems we do not have. Only
ALAC is a real gap.

Two things make ALAC harder than the AC-3 work that already ships:

1. **Nothing in the stack demuxes it.** mediabunny's audio codec union is `aac, opus,
   mp3, vorbis, flac, ac3, eac3` plus PCM, and `CustomAudioDecoder` is keyed on that
   union, so a custom decoder cannot even be registered for ALAC: the track would never
   be identified as ALAC in the first place. Our own demuxer is Matroska-only, and ALAC
   lives overwhelmingly in `.m4a`.
2. **The decoder has to come from somewhere.** No maintained WebAssembly ALAC decoder
   exists. audiocogs/alac.js was last touched in 2014, carries **no licence at all**, and
   needs the whole Aurora.js framework.

## Decisions taken

- **Apple's own ALAC source, compiled to WebAssembly.** It is Apache-2.0, and the decode
  path (`ALACDecoder.cpp`, `ALACBitUtilities.c`, `ag_dec.c`, `dp_dec.c`, `matrix_dec.c`,
  `EndianPortable.c`) is about 57KB of self-contained C with no dependencies. That yields
  a wasm in the tens of kilobytes and a licence that fits MIT better than the LGPL libav
  bundle we already carry.
- **Not** adding `decoder-alac` to the libav build. It would be an hour's work, but it
  drags 0.9MB for a job worth a fraction of that, under a heavier licence.
- **Not** hand-porting to JavaScript. This is bit-exact lossless DSP, where a
  transcription slip gives quiet corruption rather than a visible failure. The C compiles
  cleanly, so Emscripten gets correctness for free.
- **No upstream PR for the mediabunny change.** Upstream's stated scope is "codecs
  specified by WebCodecs, plus a few PCM", and ALAC is in no browser's WebCodecs, so it
  would likely be declined on scope. We carry it in the fork, as subedit already does.

## Phase 0: tidy the fork first (done)

Two of the fork's three functional commits were already merged upstream (PR #441 aux
writer, PR #442 BlockDuration); only PR #443 (S_TEXT/ASS muxing) is still open. The fork
was rebased onto upstream 1.51.0 and is now **two commits** instead of five: the ASS source
change, and the build that force-adds `dist/modules` past upstream's gitignore so it stays
consumable as a git dependency.

Branch `fork-main`, at `7b5c4d0`. Verified: the fork's own node suite matches unmodified
upstream exactly (7 failures either way, all pre-existing HEVC and ProRes cases that need a
server extension unavailable here).

subedit is re-pinned and green. It also gained the test that should have existed already:
styled ASS-in-MKV muxing is the whole reason for the fork, and nothing in its 120 tests
touched it, so a rebase could have silently removed it with everything still passing.
Upstream's `SUBTITLE_CODECS` is `webvtt` only, so the new test genuinely fails without the
fork.

## Phase 1: a test corpus we generate ourselves

macOS ships `afconvert`, which encodes ALAC natively, so **nothing needs downloading**.
Every case below was produced and verified locally:

| Fixture | Verified output |
|---|---|
| 16-bit stereo 44.1kHz | `alac (0x00000001) from 16-bit source`, 4096 frames/packet |
| 24-bit stereo 96kHz | `alac (0x00000003) from 24-bit source` (the format flag encodes bit depth) |
| 5.1 48kHz | 6 ch, layout `C L R Ls Rs LFE` |
| 7.1 48kHz | 8 ch, layout `C Lc Rc L R Ls Rs LFE` |
| mono | trivial |

Generate them from a script and commit the output, the way richdoc's corpus is generated.
Give **each channel a distinct frequency**, so a channel-ordering bug is detectable rather
than merely suspected: with equal-amplitude tones, per-channel RMS cannot tell channels
apart, but frequency can.

The one case `afconvert` cannot make is **ALAC in Matroska**; it writes `m4af` and `caff`
only. Once the fork demuxes ALAC it can also mux it, so that fixture comes out of Phase 2
rather than here.

Still worth keeping **one real-world album track** outside the repo as a confidence check,
for the cover art, chapters and odd tagging a generated corpus will not have.

### Channel order is not WAV order

Confirmed by round-tripping the 5.1 fixture and identifying each channel by its tone, not
by trusting the metadata:

```
WAV / SMPTE order:  L   R   C   LFE  Ls  Rs
ALAC order:         C   L   R   Ls   Rs  LFE
ALAC index -> WAV:  2   0   1   4    5   3
```

So a multichannel ALAC decode that looks "right" on a level meter can still have the
centre channel in the left speaker. The remap is small and now known; the fixtures test it.

## What upstream has since built, and what it changes

Upstream 1.51.0 is a monorepo with per-codec extension packages, one of which is
**`@mediabunny/ac3`**: an official AC-3 and E-AC-3 decoder and encoder, built on
mediabunny's custom coder API over a size-optimized FFmpeg WASM build, running in a Web
Worker. MPL-2.0.

Three consequences:

1. **There is now a reference implementation to copy.** `packages/ac3/src/decoder.ts` is
   exactly the shape Phase 3 needs: a `CustomAudioDecoder` subclass, a worker client, and
   `registerDecoder`. Follow it rather than inventing a structure.
2. **The blocker is unchanged.** `NON_PCM_AUDIO_CODECS` in 1.51.0 is still the same seven
   codecs, and `supports(codec: AudioCodec)` is typed against that union. The ac3 package
   only works because ac3 was already in it. ALAC still needs the fork edit below.
3. **Reconsider the no-upstream-PR decision at the end.** Upstream clearly does support
   codecs outside WebCodecs, just as separate packages. An ALAC package plus a small core
   change is more plausible than the earlier reading of their scope. Not now, but revisit
   once it works.

### Separately: mediaplay may be able to drop its libav build

mediaplay carries a custom 0.9MB libav.js build purely to decode AC-3, E-AC-3, DTS,
TrueHD and MLP. `@mediabunny/ac3` now covers the first two officially, in a worker, and
smaller. It does **not** cover DTS, TrueHD or MLP, so the libav build cannot go away
entirely, but the split is worth measuring. Out of scope for ALAC; worth its own look.

## Phase 2: demux, in the fork

Insertion points, already located:

- `src/codec.ts`: add `alac` to `NON_PCM_AUDIO_CODECS`. Care needed here: mediabunny maps
  codecs to WebCodecs configs, and no browser has ALAC in WebCodecs. It must report the
  track as undecodable by the platform so the custom-decoder path is the only route, and
  never claim otherwise.
- `src/isobmff/isobmff-demuxer.ts`, in the audio sample-entry chain beside `'flac'` and
  `'ac-3'` (around line 1160): add `alac`, setting `track.info.codec = 'alac'`.
- The same file's box handler: capture the nested `alac` box as `codecDescription`,
  exactly as `dfLa`, `avcC` and `hvcC` already do (around line 1370). That box is the
  magic cookie the decoder needs.

Verify by reading the Phase 1 corpus through the fork and dumping packet counts and the
cookie, before any decoder exists.

## Phase 3: the decoder

Build Apple's decoder-only sources with Emscripten into a small wasm module, served as
static assets under a base URL, the same arrangement as the libav and libass assets.

- Decoder only. The encoder sources are not built.
- Export a minimal C API: init from the magic cookie, decode a packet to interleaved
  samples, destroy.
- `libav/NOTICE.md` has the pattern to follow for provenance and rebuild instructions;
  write the equivalent for ALAC, recording Apache-2.0 and the exact build command.

## Phase 4: verification, and it can be exact

ALAC is **lossless**, which gives an oracle nothing else in this project has: decode our
ALAC back to PCM and compare **byte for byte** against the WAV it was made from. Not
"sounds right", not "close enough": sample-exact or it is broken. Verified end to end on
the stereo fixture, where the round trip is byte-identical across all 529,200 bytes.

For multichannel the comparison has to undo ALAC's channel order first (see Phase 1);
after the remap it is exact again.

That is the centrepiece. Around it:

- Unit tests for cookie parsing (channel count, bit depth, sample rate) per corpus file.
- A Cypress test that actually plays a file, alongside the existing ones.
- The 24-bit case specifically: the decoder returns 32-bit containers for 24-bit input,
  and the conversion to Float32 planes is where a scaling error would hide. The
  byte-exact check catches it.

## Phase 5: wire mediaplay

- Move mediaplay from npm `mediabunny` to the fork, as subedit already does.
- Register the decoder the way `registerAc3Decoder` is registered.
- **Skip the wasm entirely on Safari**, which decodes ALAC natively. Probe first and only
  fetch the decoder when the browser cannot do it, so most Safari users never download it.
- Add `A_ALAC` to `MKV_LIBAV_CODECS`' equivalent for the direct path, so ALAC in Matroska
  works through the machinery that already handles DTS and TrueHD.

## Risks

- **The fork diverges further.** Every carried commit is maintenance. Phase 0 reduces the
  fork to one commit plus plumbing, which is the right time to add a second.
- **Channel layouts beyond stereo.** Resolved as a risk to the extent that it can be
  before building: 5.1 and 7.1 fixtures exist and the ALAC-to-WAV channel mapping is
  measured (above). What remains is getting the remap right in the decoder wiring, which
  the fixtures will catch.
- **Memory on long tracks.** The existing synced-audio engine streams and schedules
  buffers, so this should inherit that; it is worth confirming rather than assuming, since
  a lossless album track is large.
