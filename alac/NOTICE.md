# ALAC decoder (Apache-2.0)

`dist/alac.wasm` and `dist/alac.mjs` are a WebAssembly build of **Apple's ALAC reference
implementation**, decoder only, used by mediaplay to play Apple Lossless audio in browsers
that have no ALAC decoder of their own (everything except Safari).

## Provenance

Sources in `src/` are copied verbatim from
[macosforge/alac](https://github.com/macosforge/alac), and are **Apache License 2.0**
(see `src/APPLE_LICENSE.txt` and `LICENSE`). Only the decode path is vendored:

```
ALACDecoder.cpp   ALACBitUtilities.c   ag_dec.c   dp_dec.c   matrix_dec.c   EndianPortable.c
```

The encoder (`ALACEncoder.cpp`, `ag_enc.c`, `dp_enc.c`, `matrix_enc.c`) is deliberately
absent: mediaplay reads ALAC and never writes it.

`alac-wasm.cpp` is ours (MIT, like the rest of mediaplay) and is a thin C ABI over Apple's
C++ decoder class so Emscripten can export it.

Apache-2.0 is compatible with mediaplay's MIT licence. Unlike the LGPL libav build beside
it, this imposes no relinking obligation; it does require preserving the licence and this
attribution, which is what this file is for.

## Rebuilding

```
./alac/build.sh
```

Runs Emscripten in Docker (`emscripten/emsdk:4.0.7`), so no local toolchain is needed and
the build is reproducible. The artefacts are committed, so this only needs running to
change them.

Output is about **21 KB of wasm** plus 9 KB of glue. For comparison, the libav build in
`../libav` is roughly 1 MB; a general-purpose FFmpeg build was never going to compete with
50 KB of purpose-built C.

## One porting note

Apple's `EndianPortable.c` recognises only `__i386__`, `__x86_64__` and Windows as
little-endian. On wasm32 none of those are defined, so it falls through to the big-endian
path and **every byte swap becomes a no-op**. The magic cookie is big-endian, so the
decoder is then configured with a byte-reversed frame length and sample rate, which fails
in a confusing way rather than an obvious one.

The build therefore passes `-DTARGET_RT_LITTLE_ENDIAN=1`. WebAssembly is little-endian by
specification, so this is unconditionally correct for the target, and passing it on the
command line keeps Apple's sources byte-for-byte upstream.

## Output format

The decoder writes interleaved samples at the source bit depth, and the layout is not
uniform:

| Bit depth | Layout |
|---|---|
| 16 | interleaved `int16` (2 bytes per sample) |
| 20 | interleaved packed 3-byte |
| 24 | interleaved **packed 3-byte**, not sign-extended into 32-bit containers |
| 32 | interleaved `int32` |

The 24-bit case is the one that bites: reading it as 32-bit containers produces something
that still looks like plausible audio.
