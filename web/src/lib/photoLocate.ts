import { guessOcrLang, matchOnPhoto, type Bbox, type Span } from "./paperMatch";
import type { OcrPage } from "./paperOcr";

/**
 * The photo half of "Show on my paper", kept out of the component so it can be tested without a browser.
 * The OCR module (and its download) is only reached through the dynamic import below.
 */

export type Stage = "loading" | "reading";
/** `pct` drives the progress bar; `message` is the text of the role="status" line. */
export type LocateProgress = { stage: Stage; pct: number; message: string };
export type LocateResult =
  | { kind: "found"; page: OcrPage; boxes: Bbox[]; matched: number; total: number }
  | { kind: "not_found" };

export function progressMessage(stage: Stage, pct: number): string {
  return stage === "loading"
    ? "Getting the reader ready on this device (the first time it downloads about 7 MB)..."
    : `Reading your photo on this device... ${pct}%`;
}

export async function locateOnPhoto(text: string, span: Span | null, photo: File, onProgress: (p: LocateProgress) => void): Promise<LocateResult> {
  const { readPhoto } = await import("./paperOcr");
  const page = await readPhoto(photo, guessOcrLang(text), (stage, f) => {
    const pct = Math.round(f * 100);
    onProgress({ stage, pct, message: progressMessage(stage, pct) });
  });
  const m = matchOnPhoto(text, span, page.words);
  if (m.status !== "found") return { kind: "not_found" };
  return { kind: "found", page, boxes: m.boxes, matched: m.matched, total: m.total };
}
