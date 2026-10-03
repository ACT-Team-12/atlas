// Copies the on-device text reader (tesseract.js worker, its WebAssembly core, and the English and Spanish
// reading data) into public/ocr so "Show on my paper" loads it from our own site, never from a third-party CDN.
// Runs before `next dev` and `next build`. The files are generated, so public/ocr is git-ignored.
import { createRequire } from "node:module";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "public", "ocr");
const require = createRequire(import.meta.url);

const tesseractDir = dirname(require.resolve("tesseract.js/package.json"));
const coreDir = dirname(createRequire(join(tesseractDir, "package.json")).resolve("tesseract.js-core/package.json"));

const copies = [
  [join(tesseractDir, "dist", "worker.min.js"), "worker.min.js"],
  // LSTM-only builds (smaller, and all the "best_int" data needs). The worker picks one for the device.
  ...["tesseract-core-relaxedsimd-lstm.wasm.js", "tesseract-core-simd-lstm.wasm.js", "tesseract-core-lstm.wasm.js"].map((f) => [join(coreDir, f), join("core", f)]),
  ...["eng", "spa"].map((l) => [
    join(dirname(require.resolve(`@tesseract.js-data/${l}/package.json`)), "4.0.0_best_int", `${l}.traineddata.gz`),
    join("lang", `${l}.traineddata.gz`),
  ]),
];

for (const [from, to] of copies) {
  const dest = join(out, to);
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(from, dest);
}
console.log(`copy-ocr: ${copies.length} files into public/ocr`);
