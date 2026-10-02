import type { CareItem, VerifiedItem } from "./schema";

/**
 * Span verifier: the deterministic check that keeps the AI honest.
 *
 * Every care-plan item the model returns must quote the patient's own document.
 * We normalize both sides (case, whitespace, quote marks, dashes, bullets) and require
 * the quote to appear in the source. Items that fail are refused, never shown as fact.
 */

export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[•●▪·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Builds a normalized copy plus a map from normalized index to original index. */
function normalizeWithMap(src: string): { norm: string; map: number[] } {
  let norm = "";
  const map: number[] = [];
  let lastSpace = true;
  for (let i = 0; i < src.length; i++) {
    const c = normalize(src[i]) || " ";
    if (c === " ") {
      if (lastSpace) continue;
      norm += " ";
      map.push(i);
      lastSpace = true;
    } else {
      norm += c;
      map.push(i);
      lastSpace = false;
    }
  }
  return { norm: norm.trimEnd(), map };
}

/** Strips ellipses the model sometimes adds; each fragment must still be found in order. */
function fragments(quote: string): string[] {
  return normalize(quote)
    .split(/\.\.\.|…/)
    .map((f) => f.replace(/^["'\s]+|["'\s]+$/g, "").trim())
    .filter((f) => f.length >= 3);
}

export function findSpan(source: string, quote: string): { start: number; end: number } | null {
  const frags = fragments(quote);
  if (frags.length === 0) return null;
  const { norm, map } = normalizeWithMap(source);
  let cursor = 0;
  let first = -1;
  let lastEnd = -1;
  for (const f of frags) {
    const at = norm.indexOf(f, cursor);
    if (at < 0) return null;
    if (first < 0) first = at;
    lastEnd = at + f.length;
    cursor = lastEnd;
  }
  const start = map[first];
  const end = map[lastEnd - 1] + 1;
  return { start, end };
}

export function verifyItems(source: string, items: CareItem[]): { kept: VerifiedItem[]; refused: VerifiedItem[] } {
  const kept: VerifiedItem[] = [];
  const refused: VerifiedItem[] = [];
  items.forEach((item, i) => {
    const span = findSpan(source, item.source_quote);
    const v: VerifiedItem = { ...item, id: `item-${i}`, grounded: span !== null, span };
    (span ? kept : refused).push(v);
  });
  return { kept, refused };
}
