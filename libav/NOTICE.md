# libav.js — AC-3 / E-AC-3 / DTS / TrueHD decoder (LGPL-2.1)

These files are a **custom [libav.js](https://github.com/Yahweasel/libav.js) build**
containing only FFmpeg's AC-3, E-AC-3, DTS (dca), TrueHD and MLP audio decoders,
compiled to WebAssembly. They are used by mediaplay to play audio tracks that browsers
can't decode natively.

- `libav-6.9.8.1-audio.mjs` — loader/factory
- `libav-6.9.8.1-audio.wasm.mjs` — Emscripten glue
- `libav-6.9.8.1-audio.wasm.wasm` — the compiled decoders

## License

These files incorporate FFmpeg (libavutil, libavcodec) and are licensed under the
**GNU Lesser General Public License, version 2.1 or later (LGPL-2.1+)**. FFmpeg is
Copyright (c) 2000–2024 Fabrice Bellard and the FFmpeg developers; the libav.js wrapper
is Copyright (c) 2019–2025 Yahweasel. No GPL-only components are enabled. Only the
`ac3`/`eac3`/`dca`/`truehd`/`mlp` decoders and the `ac3`/`dca`/`mlp` parsers are built in.

mediaplay itself is MIT; it uses this LGPL component as a separate, replaceable module
(served as its own static assets), which LGPL permits. To exercise your LGPL rights you
may replace these files with your own libav.js build of the same interface.

## Rebuilding

```
# in a checkout of https://github.com/Yahweasel/libav.js
cd configs
node mkconfig.js audio '["avcodec","decoder-eac3","decoder-ac3","parser-ac3","decoder-dca","parser-dca","decoder-truehd","decoder-mlp","parser-mlp"]'
cd ..
docker build -f Dockerfile.development -t libavjs-dev .
docker run --rm -v "$PWD:/src" -w /src libavjs-dev bash -lc 'make -j"$(nproc)" build-audio'
# then copy dist/libav-<ver>-audio.mjs, .wasm.mjs, .wasm.wasm here
```
