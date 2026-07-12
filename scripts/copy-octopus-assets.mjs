// Copies the SubtitlesOctopus (libass WASM) worker + fallback font from the installed
// @jellyfin/libass-wasm package into demo/octopus/ so the demo can spawn its worker
// from a same-origin URL. Generated (gitignored); run via the dev/build:demo scripts
// or manually:  node scripts/copy-octopus-assets.mjs
//
// Consumers of the library do the equivalent copy into their own served asset dir and
// point createMediaPlayer's `libass.workerUrl` / `libass.fontUrl` at it (the defaults
// are octopus/subtitles-octopus-worker.js and octopus/default.woff2 under baseURI).
import { cpSync, mkdirSync, rmSync } from "node:fs";

const SRC = "node_modules/@jellyfin/libass-wasm/dist/js";
const OUT = "demo/octopus";

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const f of ["subtitles-octopus-worker.js", "subtitles-octopus-worker.wasm", "default.woff2", "COPYRIGHT"]) {
  cpSync(`${SRC}/${f}`, `${OUT}/${f}`);
}
console.log("octopus assets copied to demo/octopus/");
