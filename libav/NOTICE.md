# libav.js — AC-3 / E-AC-3 decoder (LGPL-2.1)

These files are a **custom [libav.js](https://github.com/Yahweasel/libav.js) build**
containing only FFmpeg's AC-3 and E-AC-3 audio decoders, compiled to WebAssembly. They
are used by mediaplay to play Dolby audio tracks that browsers can't decode natively.

- `libav-6.9.8.1-eac3.mjs` — loader/factory
- `libav-6.9.8.1-eac3.wasm.mjs` — Emscripten glue
- `libav-6.9.8.1-eac3.wasm.wasm` — the compiled decoder

## License

These files incorporate FFmpeg (libavutil, libavcodec) and are licensed under the
**GNU Lesser General Public License, version 2.1 or later (LGPL-2.1+)**. FFmpeg is
Copyright (c) 2000–2024 Fabrice Bellard and the FFmpeg developers; the libav.js wrapper
is Copyright (c) 2019–2025 Yahweasel. No GPL-only components are enabled. Only the
`ac3`/`eac3` decoders and the `ac3` parser are built in.

mediaplay itself is MIT; it uses this LGPL component as a separate, replaceable module
(served as its own static assets), which LGPL permits. To exercise your LGPL rights you
may replace these files with your own libav.js build of the same interface.

## Rebuilding

```
# in a checkout of https://github.com/Yahweasel/libav.js
cd configs
node mkconfig.js eac3 '["avcodec","decoder-eac3","decoder-ac3","parser-ac3"]'
cd ..
docker build -f Dockerfile.development -t libavjs-dev .
docker run --rm -v "$PWD:/src" -w /src libavjs-dev bash -lc 'make -j"$(nproc)" build-eac3'
# then copy dist/libav-<ver>-eac3.mjs, .wasm.mjs, .wasm.wasm here
```
