import type { OcrWord } from "./paperMatch";

/**
 * On-device OCR for "Show on my paper" (browser only).
 *
 * tesseract.js is imported here and nowhere else, and this module is itself only reached through a dynamic import,
 * so none of it is in the first page load. Its worker, WebAssembly core and reading data are served from our own
 * site (/ocr, copied by scripts/copy-ocr.mjs): about 4 MB of core plus 3 MB (English) or 2 MB (Spanish) of data,
 * downloaded the first time someone taps the button on a photo plan, then cached by the browser.
 * The photo is read inside this browser tab and is never sent anywhere.
 */

export type OcrPage = { width: number; height: number; words: OcrWord[] };
export type OcrProgress = (stage: "loading" | "reading", fraction: number) => void;

/** Long side of the image handed to the reader. Enough for printed text, small enough to read in a few seconds. */
const MAX_SIDE = 2000;

const pages = new WeakMap<File, Map<string, Promise<OcrPage>>>();

async function toCanvas(file: File): Promise<HTMLCanvasElement> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas;
}

async function run(file: File, lang: "eng" | "spa", onProgress?: OcrProgress): Promise<OcrPage> {
  const mod = await import("tesseract.js");
  const createWorker = mod.createWorker ?? (mod as unknown as { default: typeof mod }).default.createWorker;
  const base = `${window.location.origin}/ocr`;
  const worker = await createWorker(lang, 1 /* LSTM only: matches the small "best_int" data */, {
    workerPath: `${base}/worker.min.js`,
    corePath: `${base}/core`,
    langPath: `${base}/lang`,
    workerBlobURL: false,
    logger: (m) => {
      if (!onProgress) return;
      if (m.status === "recognizing text") onProgress("reading", m.progress);
      else onProgress("loading", m.progress);
    },
  });
  try {
    const canvas = await toCanvas(file);
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    const words: OcrWord[] = [];
    let line = 0;
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs) {
        for (const l of para.lines) {
          for (const w of l.words) words.push({ text: w.text, bbox: w.bbox, line });
          line++;
        }
      }
    }
    return { width: canvas.width, height: canvas.height, words };
  } finally {
    await worker.terminate();
  }
}

/** Reads the photo once per language; later taps on other steps reuse the same result. A failed read is retried. */
export function readPhoto(file: File, lang: "eng" | "spa", onProgress?: OcrProgress): Promise<OcrPage> {
  let byLang = pages.get(file);
  if (!byLang) { byLang = new Map(); pages.set(file, byLang); }
  const hit = byLang.get(lang);
  if (hit) return hit;
  const p = run(file, lang, onProgress);
  byLang.set(lang, p);
  p.catch(() => byLang.delete(lang));
  return p;
}
