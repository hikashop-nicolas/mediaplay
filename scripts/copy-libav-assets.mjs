// Copies the vendored libav.js AC-3/E-AC-3 decoder (libav/) into demo/libav/ so the
// demo can load the decoder worker + wasm from a same-origin URL. Generated
// (gitignored); run via the dev/build:demo scripts or manually.
//
// Consumers of the library copy the same libav/ dir out of node_modules/mediaplay into
// their own served asset dir and point createMediaPlayer's `libav.base` at it (the
// default is `libav/` under document.baseURI).
import { cpSync, mkdirSync, rmSync, readdirSync } from "node:fs";

const SRC = "libav";
const OUT = "demo/public/libav";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(SRC)) cpSync(`${SRC}/${f}`, `${OUT}/${f}`);
console.log("libav assets copied to demo/libav/");
