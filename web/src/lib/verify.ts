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
    // Final sigma: "ΟΔΟΣ" lower-cases to "οδος" as a whole word but to "οδοσ" one letter at a time (how the source
    // is mapped below), so both sides use the plain σ.
    .replace(/ς/g, "σ")
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/[•●▪·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Builds a normalized copy plus, for every normalized UTF-16 unit, the original [start, end) it came from.
 * The source is walked one CODE POINT at a time, so a letter outside the BMP is lower-cased like any other, and a
 * letter that lower-cases to two units ("İ" becomes "i" + U+0307) gets an entry for each, keeping later offsets right.
 * `boundary[k]` is true when normalized position k is where one source character's output begins (or the end), so a
 * match can be required to start and end between source characters, never inside one character's expansion.
 */
function normalizeWithMap(src: string): { norm: string; starts: number[]; ends: number[]; boundary: boolean[] } {
  let norm = "";
  const starts: number[] = [];
  const ends: number[] = [];
  const boundary: boolean[] = [];
  let lastSpace = true;
  let i = 0;
  for (const ch of src) {
    const c = normalize(ch) || " ";
    const next = i + ch.length;
    if (c === " ") {
      if (!lastSpace) {
        boundary[norm.length] = true;
        norm += " ";
        starts.push(i);
        ends.push(next);
        lastSpace = true;
      }
    } else {
      boundary[norm.length] = true;
      norm += c;
      for (let k = 0; k < c.length; k++) {
        starts.push(i);
        ends.push(next);
      }
      lastSpace = false;
    }
    i = next;
  }
  const trimmed = norm.trimEnd();
  boundary[trimmed.length] = true;
  return { norm: trimmed, starts, ends, boundary };
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
  const { norm, starts, ends, boundary } = normalizeWithMap(source);
  let cursor = 0;
  let first = -1;
  let lastEnd = -1;
  for (const f of frags) {
    // The first occurrence that starts AND ends between source characters; an occurrence inside a case expansion
    // (e.g. starting at the U+0307 that "İ" lower-cases into) is skipped, and the search goes on past it.
    let at = norm.indexOf(f, cursor);
    while (at >= 0 && !(boundary[at] && boundary[at + f.length])) at = norm.indexOf(f, at + 1);
    if (at < 0) return null;
    if (first < 0) first = at;
    lastEnd = at + f.length;
    cursor = lastEnd;
  }
  return { start: starts[first], end: ends[lastEnd - 1] };
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
