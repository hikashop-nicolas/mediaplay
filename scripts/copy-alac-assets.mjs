// Copies the vendored ALAC decoder (alac/dist/) into demo/public/alac/ so the demo can load
// the wasm from a same-origin URL. Generated (gitignored); run via the dev/build:demo
// scripts or manually.
//
// Consumers of the library copy the same files out of node_modules/mediaplay/alac/dist into
// their own served asset dir and point createMediaPlayer's `alac.base` at it (the default is
// `alac/` under document.baseURI).
import { cpSync, mkdirSync, rmSync, readdirSync, existsSync } from "node:fs";

const SRC = "alac/dist";
const OUT = "demo/public/alac";

if (!existsSync(SRC)) {
  console.error("alac/dist is missing; build it with ./alac/build.sh");
  process.exit(1);
}
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(SRC)) cpSync(`${SRC}/${f}`, `${OUT}/${f}`);
console.log("ALAC assets copied to demo/public/alac/");
