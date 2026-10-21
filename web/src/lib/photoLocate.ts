import { guessOcrLang, matchOnPhoto, type Bbox, type Span } from "./paperMatch";
import type { OcrPage } from "./paperOcr";

/**
 * The photo half of "Show on my paper", kept out of the component so it can be tested without a browser.
 * The OCR module (and its download) is only reached through the dynamic import below.
 */

export type Stage = "loading" | "reading";
/**
 * `pct` drives the progress bar; `said` is the percent the role="status" line announces. The line's words are the
 * app's own (show.loadingReader, show.readingPhoto in lib/uiText.ts), put in the person's language when it is drawn.
 */
export type LocateProgress = { stage: Stage; pct: number; said: number };
export type LocateResult =
  | { kind: "found"; page: OcrPage; boxes: Bbox[]; matched: number; total: number }
  | { kind: "not_found" }
  /** The paper is in a language the reader has no data for. Nothing was loaded. */
  | { kind: "unsupported" };

/**
 * The status line is a live region, so every change is read aloud. It only names whole steps (0% and 50%; the
 * result line says when it is done), however often the reader reports progress. The bar still moves with `pct`.
 */
export function progressSaid(stage: Stage, pct: number): number {
  return stage === "loading" ? 0 : pct >= 50 ? 50 : 0;
}

export async function locateOnPhoto(text: string, span: Span | null, photo: File, onProgress: (p: LocateProgress) => void): Promise<LocateResult> {
  // Decide before any OCR code or data is fetched: an unsupported paper would download about 7 MB and then fail.
  const lang = guessOcrLang(text);
  if (!lang) return { kind: "unsupported" };
  const { readPhoto } = await import("./paperOcr");
  const page = await readPhoto(photo, lang, (stage, f) => {
    const pct = Math.round(f * 100);
    onProgress({ stage, pct, said: progressSaid(stage, pct) });
  });
  const m = matchOnPhoto(text, span, page.words);
  if (m.status !== "found") return { kind: "not_found" };
  return { kind: "found", page, boxes: m.boxes, matched: m.matched, total: m.total };
}
