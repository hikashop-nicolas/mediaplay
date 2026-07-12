# Legacy media formats: transcode-to-play (plan)

Status: **planned, not started** (green-light explicitly before building).
Prerequisite context: the AC-3/E-AC-3 (and DTS/TrueHD) audio decoding already ships;
this plan is about **video** in legacy containers.

## Goal

Play SD-era legacy files fully client-side:

| Container | Typical video codec | Typical audio |
|---|---|---|
| `.avi` (DivX/XviD era) | MPEG-4 Part 2 ASP, MSMPEG4v2/v3 | MP3, AC-3 |
| `.mpg` / `.vob` (MPEG-PS) | MPEG-1 / MPEG-2 | MP2, AC-3, DTS |
| `.wmv` / `.asf` | WMV1/WMV2/WMV3 (VC-1) | WMA v1/v2 |
| `.flv` | H.263-variant (Sorenson), VP6, or H.264 | MP3, AAC |

None of these video codecs (H.264-in-FLV aside) are decodable by any browser or by
WebCodecs, so a demuxer alone can never make them play. The only client-side path is
**software-decode the video ourselves and hand the browser something it can play**.

## Architecture: streaming transcode into MSE

Decode with FFmpeg (our own custom libav.js build — same toolchain that produced the
shipped audio decoder), re-encode video with the platform's **WebCodecs
`VideoEncoder`** (H.264, hardware-accelerated on all modern machines), stream the
result as **fragmented MP4 into MediaSource Extensions** so playback starts within a
couple of seconds while the rest converts in the background:

```
bytes ──> libav.js (demux avi/asf/mpegps/flv + decode mpeg4/vc1/mpeg2/…)
             │ raw frames                        │ audio packets
             ▼                                   ▼
   WebCodecs VideoEncoder (h264)        existing synced-audio engine
             │ fMP4 fragments (mediabunny)      (libav decode → Web Audio)
             ▼
   MediaSource SourceBuffer ──> <video> (muted, video-only)
```

Key decisions:
- **Audio does NOT go through the transcode.** The existing decoded-audio engine
  (libav → Web Audio, synced to the video clock) already handles playback, volume,
  seeks; the transcoded stream is **video-only**, which also halves the muxing work.
- **No re-encode of the audio, no GPL, no web-demuxer.** Everything demuxes/decodes in
  our LGPL libav build; stock ffmpeg.wasm (~12 MB, GPL) and bilibili/web-demuxer
  (demux-only, feeds WebCodecs which cannot decode these codecs; does not compose with
  mediabunny plugins like @kenzuya/mediabunny-mpeg4) were considered and rejected.
- **Seeking** = abort + restart the transcode from the target time (libav seeks the
  demuxer), same single-flight pattern the audio engine uses.

## Phases

1. **Build + feasibility probe.** New libav.js variant `legacy-video`
   (demuxer-avi, demuxer-asf, demuxer-mpegps, demuxer-flv; decoder-mpeg4,
   decoder-msmpeg4v2/v3, decoder-wmv1/2/3, decoder-vc1, decoder-mpeg1video,
   decoder-mpeg2video, decoder-flv1, decoder-vp6; audio decoder-mp2/mp3,
   decoder-wmav1/wmav2 + the shipped ac3/eac3/dca). Estimated 2–3.5 MB wasm,
   lazy-loaded. Measure decode fps on real SD samples in the browser (single thread);
   go/no-go per codec.
2. **Video pipeline.** libav frame loop → `VideoFrame` → `VideoEncoder` (h264,
   `realtime` latency mode) → mediabunny `Mp4OutputFormat` fragmented output →
   `StreamTarget` → MSE `SourceBuffer`. Backpressure: encode at most ~10 s ahead.
3. **Audio + sync.** Feed the file's audio track to the existing synced-audio engine
   via a libav packet iterator (the same mechanism the DTS/TrueHD path uses); the MSE
   video element stays the clock master, muted.
4. **Player integration.** Route by container magic when direct playback AND remux
   fail; reuse the "Converting for playback…" notice with a progress readout;
   teardown/seek/rate plumbing.
5. **Hardening.** Memory budget (input bytes + fMP4 tail; drop consumed fragments),
   encoder fallback to VP8 where H.264 encode is unavailable, tests + a gaptest-style
   A/V drift harness.

## Explicitly OUT of scope (HD / modern-codec software decode)

- **Hi10P (10-bit H.264)**, common in anime encodes: no browser, GPU, or WebCodecs
  path exists, and software-decoding 1080p10 H.264 in single-threaded WASM is far
  below realtime.
- **HEVC on platforms without licensed decoders**, same reason.
- **1080p VC-1 / interlaced HD MPEG-2**: same single-thread ceiling.
- Why the ceiling is hard: WASM threads require cross-origin isolation (COOP/COEP
  headers), which GitHub Pages cannot serve; the `coi-serviceworker` workaround exists
  but is fragile with our SW update flow. Revisit only if hosting gains real headers
  or WebCodecs grows these codecs.

The player's behavior for these stays: play what the platform can (often video-only or
nothing) and show the clear "not supported" notice.
