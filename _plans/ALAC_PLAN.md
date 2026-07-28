# ALAC playback (plan)

Status: **planned, not started**. Drafted 2026-07-29.

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

## Phase 0: tidy the fork first

`hikashop-nicolas/mediabunny` is based on 1.50.8 and sits 16 commits behind upstream main
(now 1.51.0). Of its three functional commits, **two are already merged upstream**:
PR #441 (aux writer) and PR #442 (BlockDuration). Only PR #443 (S_TEXT/ASS muxing) is
still open.

So: rebase the fork onto current upstream, keeping only the ASS commit and the
dist-committing plumbing that makes it consumable as a git dependency. Re-pin and re-test
subedit, which consumes it at `113b0f2`, before anything ALAC touches it.

Doing this first avoids building ALAC on top of two commits that are now redundant.

## Phase 1: a test corpus we generate ourselves

macOS ships `afconvert`, which encodes ALAC natively, so nothing needs downloading.
Verified: a synthetic 3-second stereo tone converts to a 119KB `.m4a` carrying a proper
`alac` sample entry (2 channels, 16-bit, 44100Hz) with the 36-byte magic cookie.

Generate from a script, the way richdoc's corpus is generated, and commit the output:

- 16-bit stereo 44.1kHz (the common case)
- 24-bit stereo 96kHz (different bit depth, the cookie's `bitDepth` path)
- mono
- 5.1 if `afconvert` will produce it (channel layout handling)
- the same tone as ALAC-in-Matroska, for the `A_ALAC` path

Separately, keep **one real-world album track** outside the repo as a confidence check.
Real files bring cover art, chapters and odd tagging that a generated corpus will not.

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
"sounds right", not "close enough" — sample-exact or it is broken.

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
- **Channel layouts beyond stereo.** ALAC's channel ordering is not the same as WebAudio's
  for 5.1. If `afconvert` will not produce multichannel, this stays untested and should be
  stated as unsupported rather than assumed.
- **Memory on long tracks.** The existing synced-audio engine streams and schedules
  buffers, so this should inherit that; it is worth confirming rather than assuming, since
  a lossless album track is large.
