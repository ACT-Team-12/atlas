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
export type MappedSource = {
  readonly norm: string;
  readonly starts: readonly number[];
  readonly ends: readonly number[];
  readonly boundary: readonly boolean[];
};

/**
 * Maps a source once so many quotes can be checked against it with `findSpanIn` (mapping a 20,000-character paper
 * costs ~20 ms, so 40 items re-mapping it would spend most of a second). The caller owns the result and keeps it only
 * for its own request or batch: this module holds no state, so no paper outlives the request that sent it.
 */
export function mapSource(src: string): MappedSource {
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

/**
 * The first occurrence of `needle` in `hay` at or after `from` that starts AND ends on a boundary, or -1. Same answer
 * as calling `indexOf` again from each rejected occurrence, but Knuth-Morris-Pratt over UTF-16 units enumerates every
 * occurrence (overlapping ones included, in start order) in one O(hay + needle) pass. Re-running `indexOf` re-compares
 * the whole needle at every rejected occurrence, which is O(hay * needle): a run of U+0130 against a "U+0307 i" quote
 * has an unaligned occurrence at nearly every position.
 */
export function indexOfAligned(
  hay: string,
  needle: string,
  from: number,
  boundary: readonly boolean[],
  // Test hook: counts loop steps, so tests can assert linear work without timing anything.
  stats?: { steps: number },
): number {
  const m = needle.length;
  if (m === 0) return -1;
  let steps = 0;
  // pi[k]: length of the longest proper prefix of needle[0..k] that is also its suffix.
  const pi = new Int32Array(m);
  for (let k = 1, j = 0; k < m; k++) {
    steps++;
    while (j > 0 && needle.charCodeAt(k) !== needle.charCodeAt(j)) { j = pi[j - 1]; steps++; }
    if (needle.charCodeAt(k) === needle.charCodeAt(j)) j++;
    pi[k] = j;
  }
  for (let i = Math.max(from, 0), j = 0; i < hay.length; i++) {
    steps++;
    const c = hay.charCodeAt(i);
    while (j > 0 && c !== needle.charCodeAt(j)) { j = pi[j - 1]; steps++; }
    if (c === needle.charCodeAt(j)) j++;
    if (j === m) {
      const at = i + 1 - m;
      if (boundary[at] && boundary[i + 1]) {
        if (stats) stats.steps += steps;
        return at;
      }
      j = pi[j - 1];
    }
  }
  if (stats) stats.steps += steps;
  return -1;
}

export function findSpan(source: string, quote: string): { start: number; end: number } | null {
  return findSpanIn(mapSource(source), quote);
}

/** `findSpan` against a source already mapped by `mapSource`, for checking many quotes against one paper. */
export function findSpanIn(mapped: MappedSource, quote: string): { start: number; end: number } | null {
  const frags = fragments(quote);
  if (frags.length === 0) return null;
  const { norm, starts, ends, boundary } = mapped;
  let cursor = 0;
  let first = -1;
  let lastEnd = -1;
  for (const f of frags) {
    // The first occurrence that starts AND ends between source characters; an occurrence inside a case expansion
    // (e.g. starting at the U+0307 that "İ" lower-cases into) is skipped, and the search goes on past it.
    const at = indexOfAligned(norm, f, cursor, boundary);
    if (at < 0) return null;
    if (first < 0) first = at;
    lastEnd = at + f.length;
    cursor = lastEnd;
  }
  return { start: starts[first], end: ends[lastEnd - 1] };
}

/** Checks one item against a mapped source. `index` is its place in the model's full list, which sets its id. */
export function verifyItem(source: MappedSource, item: CareItem, index: number): VerifiedItem {
  const span = findSpanIn(source, item.source_quote);
  return { ...item, id: `item-${index}`, grounded: span !== null, span };
}

export function verifyItems(source: string, items: CareItem[]): { kept: VerifiedItem[]; refused: VerifiedItem[] } {
  const kept: VerifiedItem[] = [];
  const refused: VerifiedItem[] = [];
  const mapped = mapSource(source);
  items.forEach((item, i) => {
    const v = verifyItem(mapped, item, i);
    (v.grounded ? kept : refused).push(v);
  });
  return { kept, refused };
}
