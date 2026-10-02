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

/**
 * Splits on the ellipses the model sometimes adds; each fragment must still be found in order.
 * Only EMPTY fragments are dropped (a leading or trailing ellipsis). If any remaining fragment is shorter than 3
 * characters the whole quote is refused (returns []): silently dropping it would let "Take ... 5 ... mg" ground on
 * "Take a seat." with the invented dose never checked.
 */
function fragments(quote: string): string[] {
  const frags = normalize(quote)
    .split(/\.\.\.|…/)
    .map((f) => f.replace(/^["'\s]+|["'\s]+$/g, "").trim())
    .filter((f) => f.length > 0);
  return frags.some((f) => f.length < 3) ? [] : frags;
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

/** Checks one item. `index` is its place in the model's full list, which sets its id. */
export function verifyItem(source: string, item: CareItem, index: number): VerifiedItem {
  const span = findSpan(source, item.source_quote);
  return { ...item, id: `item-${index}`, grounded: span !== null, span };
}

export function verifyItems(source: string, items: CareItem[]): { kept: VerifiedItem[]; refused: VerifiedItem[] } {
  const kept: VerifiedItem[] = [];
  const refused: VerifiedItem[] = [];
  items.forEach((item, i) => {
    const v = verifyItem(source, item, i);
    (v.grounded ? kept : refused).push(v);
  });
  return { kept, refused };
}
