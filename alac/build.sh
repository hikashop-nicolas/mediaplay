#!/bin/sh
# Build the ALAC decoder to WebAssembly.
#
# Runs Emscripten in Docker rather than requiring a local install: the toolchain is pinned
# to an image tag, so the build is reproducible and nobody has to put a compiler on their
# machine to check out this repository. The built artefacts are committed, so this only
# needs running to change them.
#
# Usage: ./alac/build.sh
set -e

IMAGE="emscripten/emsdk:4.0.7"
HERE="$(cd "$(dirname "$0")" && pwd)"

# Decoder sources only: the encoder (ALACEncoder.cpp, ag_enc.c, dp_enc.c, matrix_enc.c) is
# deliberately not compiled, since mediaplay reads ALAC and never writes it.

# Apple's EndianPortable.c recognises only i386, x86_64 and Windows as little-endian, so on
# wasm32 it falls through and every byte swap silently becomes a no-op. The magic cookie is
# big-endian, so without this the frame length and sample rate come back byte-reversed and
# the decoder is configured with nonsense. WebAssembly is little-endian by specification,
# so defining this is unconditionally correct here; it is passed on the command line to
# leave Apple's sources untouched.

EXPORTS='["_alac_create","_alac_destroy","_alac_decode","_alac_channels","_alac_bit_depth","_alac_frame_length","_alac_sample_rate","_alac_bytes_per_frame","_malloc","_free"]'

docker run --rm -v "$HERE:/work" -w /work "$IMAGE" emcc \
  src/ALACDecoder.cpp \
  src/ALACBitUtilities.c \
  src/ag_dec.c \
  src/dp_dec.c \
  src/matrix_dec.c \
  src/EndianPortable.c \
  alac-wasm.cpp \
  -I src \
  -DTARGET_RT_LITTLE_ENDIAN=1 \
  -O3 \
  -flto \
  -fno-exceptions \
  -fno-rtti \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s EXPORT_NAME=createAlacModule \
  -s ENVIRONMENT=web,worker \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s FILESYSTEM=0 \
  -s ASSERTIONS=0 \
  -s EXPORTED_FUNCTIONS="$EXPORTS" \
  -s EXPORTED_RUNTIME_METHODS='["HEAPU8","HEAP16","HEAP32"]' \
  --closure 0 \
  -o dist/alac.mjs

ls -la "$HERE/dist"
