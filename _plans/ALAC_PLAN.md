# ALAC playback (plan)

Status: **done** (2026-07-29). All five phases complete; ALAC plays.

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
- **Structure it for upstream, decide later whether to send it.** Superseded the original
  "no PR" call once `@mediabunny/ac3` turned up: keep the core demux change as one clean
  commit and the decoder as a separate package, which is exactly how upstream already
  handles codecs outside WebCodecs. Costs nothing if we never send it.

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

### Built, and verified against the manifest

`npm run corpus:alac` generates it; `npm run check:alac-corpus` proves it. Five fixtures,
321KB committed, each 0.5s (still six 4096-frame packets, so multi-packet decoding is
exercised without megabytes in the repository).

The check decodes every fixture with a decoder we did not write and asserts each channel
reproduces its source tone **sample for sample**. It also *discovers* the channel
permutation rather than assuming it: each channel carries its own frequency, so for every
decoded channel it asks which source tone that channel reproduces exactly. One must match,
and each must be claimed once, which proves losslessness and yields the ordering together.
Verified non-vacuous: perturbing one sample in ~22,000 fails every fixture.

### Channel order is not WAV order

Confirmed by round-tripping the 5.1 fixture and identifying each channel by its tone, not
by trusting the metadata:

```
5.1  WAV order:  L R C LFE Ls Rs          ALAC -> source: [2, 0, 1, 4, 5, 3]
7.1  (MPEG_7_1_A)                          ALAC -> source: [2, 6, 7, 0, 1, 4, 5, 3]
```

The 5.1 mapping was measured twice by independent means (by hand from a round trip, then
by the corpus check) and agrees.

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
3. **The no-upstream-PR decision was wrong** and is revised below.

### Measured: @mediabunny/ac3 would not shrink anything

Checked, because it looked like an easy win. It is not:

| | payload | codecs covered |
|---|---|---|
| mediaplay's libav assets | 1043 KB | ac3, eac3, dts, truehd, mlp |
| `@mediabunny/ac3` (min bundle) | 1121 KB | ac3, eac3 |

**78 KB larger for three fewer codecs**, and DTS, TrueHD and MLP would still need the libav
build alongside it, so the real comparison is 1121 KB *plus* a libav build against 1043 KB
total. Our build is already size-optimised for exactly the codec set we need; theirs is a
general-purpose build of two.

There is a second reason not to switch, already measured in this repo: `@mediabunny/ac3`
decodes in a Web Worker, and `libav-decoder.ts` records that worker mode put a postMessage
round trip on every packet and dragged throughput below realtime, where the direct call
path decodes at about 80x realtime. Switching would re-introduce a problem already solved.

So: keep the libav build. The ac3 package stays useful only as the structural template for
the ALAC decoder.

## The upstream split: core demuxes, package decodes

`@mediabunny/ac3` shows the division upstream already works to, and ALAC fits it exactly:

- **Core knows the codec and demuxes it.** For ac3 that is the union entry, two
  codec-to-string mappings, the string-to-codec parse, the decoder-config detection, and
  the ISOBMFF sample entry. Core ships **no** ac3 decoder.
- **A separate package decodes it**, through the custom coder API.

So ALAC becomes a small, self-contained core change (the same five touchpoints in
`src/codec.ts` plus the sample entry and cookie box in `isobmff-demuxer.ts`) and a
standalone decoder package carrying Apple's Apache-2.0 WASM.

That core change is proposable upstream on its own terms: it is demuxing support in a
demuxing library, matching a pattern they established. The earlier reading that they would
decline ALAC on scope was wrong. Build it in the fork, keep the core change as a clean
separate commit so it can become a PR, and ship the decoder as its own package either way.

## Phase 2: demux, in the fork (done)

Fork `fork-main`, commit `a02d8df` (the core change, written to be PR-able) plus a dist
rebuild. All five fixtures demux with the right codec, channel count, sample rate and a
24-byte cookie, and their packets read in the expected counts. The fork's suite matches
upstream's failure set exactly: 7 pre-existing failures, 294 tests, 5 added.

What the corpus caught, which is why mono and surround were worth generating:

- **The sample entry lies about ALAC.** Every fixture declares 2 channels in its
  AudioSampleEntry regardless of the truth (1, 2, 6, 8), and the entry's sample rate is a
  16.16 fixed-point field that cannot represent 96 kHz at all. Both are taken from the
  magic cookie instead. A stereo-only corpus would have passed while being wrong.
- **The cookie is a FullBox.** Its content opens with a version and flags; the 24 bytes
  after them are what every ALAC decoder calls the magic cookie, so those four are stripped
  once in the demuxer rather than by each consumer.

And one thing worth knowing before any upstream PR:

- **ALAC is the first codec mediabunny can demux but not encode.** No ALAC encoder exists
  in WebCodecs, in the server extension, or in any extension package. The suite enumerates
  the audio codec union and round-trips each one, so adding ALAC made it demand an encoder
  that cannot exist; the loop now skips it explicitly. Upstream would need to accept that
  the union can contain a decode-only codec, which is a design question rather than a
  detail, and the likeliest thing to be argued about in review.

## Phase 3: the decoder (done)

Apple's decoder, Apache-2.0, built decoder-only through Emscripten in a pinned Docker
image (`emscripten/emsdk:4.0.7`), so no local toolchain is needed. **21 KB of wasm** plus
10 KB of glue, against roughly 1 MB for the libav build beside it.

Two things the port turned up, both in `alac/NOTICE.md`:

- **Apple's endianness detection does not know about wasm.** `EndianPortable.c` recognises
  only i386, x86_64 and Windows as little-endian, so on wasm32 it takes the big-endian path
  and every byte swap becomes a no-op. The magic cookie is big-endian, so the decoder was
  configured from a byte-reversed frame length and sample rate. The build passes
  `-DTARGET_RT_LITTLE_ENDIAN=1`, correct unconditionally since WebAssembly is little-endian
  by specification, and Apple's sources stay byte-for-byte upstream.
- **24-bit output is packed three-byte samples**, not sign-extended 32-bit containers. The
  plan assumed the opposite. Reading it the wrong way gives something that still sounds
  like plausible audio.

## Phase 3 (original notes)

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
- A Cypress test that actually plays a file. Note for anyone reading the original plan:
  this said "alongside the existing ones", which was wrong. mediaplay had `cypress` as a
  devDependency and a `test:e2e` script but **no config and no specs**, and CI never ran
  it. The suite had to be set up from nothing, so ALAC is its first spec.
- The 24-bit case specifically: the decoder returns 32-bit containers for 24-bit input,
  and the conversion to Float32 planes is where a scaling error would hide. The
  byte-exact check catches it.

## Phase 5: wire mediaplay (done)

Small, because the existing fallback already fitted: an unplayable file is converted in
memory to WAV, WAV is PCM, so with the decoder registered that path handles ALAC with no
encoder anywhere. Safari needs no special case at all: it plays ALAC natively, so no error
fires, the conversion path is never entered, and the wasm is never fetched.

**Known limitation found here:** mediabunny's WAV output writes 16-bit PCM, so a 24-bit
source is narrowed going through this fallback. The decoder is exact at 24 bits; the
conversion is not. Measured deviation is one LSB, consistently in one direction. Fixable by
passing a `codec: 'pcm-s24'` conversion option once the source depth is known, which the
generic path does not currently track.

## Phase 5 (original notes)

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
