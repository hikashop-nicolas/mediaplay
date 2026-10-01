# Audio visualizer plan

Draft, 2026-10-01. Goal: a 2D oscilloscope drawn while audio plays, switchable off, in the
empty stage area an audio file leaves above the control bar. The reference is the 2D
oscilloscope in TimArt/3DAudioVisualizers (its other two, a 3D pipe and a 3D spectrum, are
what needed OpenGL and geometry shaders; a 2D scope does not).

## Where it lives

In mediaplay, not in Omnitext. The player owns both audio paths and the control bar, and it
already persists the playback rate in localStorage (player.ts:376), so the toggle follows that
precedent and Omnitext needs no change. Pure JS, no new binary: the F-Droid recipe is untouched.

## Not three.js

A time-domain scope is a polyline. Canvas 2D draws it at 60 fps on any phone for a couple of
kilobytes, and the module is imported dynamically so nothing grows for people who never switch
it on. three.js is a 3D scene graph of roughly 170 KB gzipped and almost none of it applies
here. If a richer visual is wanted later, a single full-screen fragment shader in raw WebGL is
about 3 KB of code and buys far more per kilobyte; three.js stays in reserve for actual 3D.

## Where the samples come from

Two paths, and the visualizer takes whichever is playing:

- Decoded audio (AC-3, E-AC-3, DTS, TrueHD, ALAC) already runs through a Web Audio graph with
  an AnalyserNode in the master chain (synced-audio.ts:73, gain to analyser to destination).
  Nothing to build: expose it.
- Everything else plays through a bare audio element with no Web Audio at all (player.ts:323).
  That path needs an AudioContext and a MediaElementAudioSourceNode, created the first time the
  scope is switched on, never torn down afterwards.

The element path is the one real risk and the thing to test first: once an element is routed
through a context it stays routed, so a suspended context or a missing connection to destination
plays the file silently. Resume the context on the user gesture that turns the scope on, connect
source to analyser to destination in one go, and keep a test that asserts audio still reaches
destination after a toggle off and on.

## Drawing it

- getFloatTimeDomainData into a Float32Array, fftSize 2048 to start, redrawn on rAF.
- Map the buffer across the canvas width by linear interpolation between samples, not by
  averaging buckets: averaging flattens the peaks and gives a limp line. This is the point the
  reference project makes about 44,100 samples not fitting a few hundred pixels.
- Trigger like a real scope, otherwise the waveform slides around and looks broken: start the
  drawn window at the first rising zero crossing in the buffer, falling back to offset 0 when
  there is none. This is what makes a steady tone stand still.
- Canvas sized in CSS pixels times devicePixelRatio; stroke in the player's accent colour,
  resolved per theme so it reads in both; no glow at first, shadowBlur is the expensive part.
- Silence draws a flat line, not an empty canvas, so the thing visibly exists before play.

## Switching it on and off

- A button in the audio control bar, next to the existing controls, with its state in
  localStorage under the rate key's neighbour.
- Default on for audio-only files (that stage is empty anyway, which is what this is for),
  default off for video, where it would sit over the picture.
- Default off when prefers-reduced-motion is set, whatever the file.
- A MediaPlayerOptions field for a host that wants to force it either way, defaulting to the
  rules above, so Omnitext can later mirror it in Settings if that turns out to be wanted.

## Cost

The rAF loop stops on pause, on ended, and when the page is hidden, so a backgrounded phone
pays nothing. One analyser, one Float32Array reused per frame, no allocation in the loop.

## Testing

Automation Chrome decodes no media, so none of this can be checked visually in a browser here:
verification is on the connected phone, plus unit tests that drive an OfflineAudioContext or a
stub analyser and assert the trigger picks the rising zero crossing, the interpolation keeps
peak amplitude, and the element path still reaches destination after toggling.

## Order

1. The analyser plumbing for both paths, with the silent-audio test. No UI.
2. The canvas and the draw loop, wired to the decoded path (an analyser already exists there).
3. The control bar button, persistence and the defaults above.
4. The accessibility pass (button name, state, focus, touch target) in its own commit, per the
   repo rule.
