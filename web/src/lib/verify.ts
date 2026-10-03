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
 */
function normalizeWithMap(src: string): { norm: string; starts: number[]; ends: number[] } {
  let norm = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let lastSpace = true;
  let i = 0;
  for (const ch of src) {
    const c = normalize(ch) || " ";
    const next = i + ch.length;
    if (c === " ") {
      if (!lastSpace) {
        norm += " ";
        starts.push(i);
        ends.push(next);
        lastSpace = true;
      }
    } else {
      norm += c;
      for (let k = 0; k < c.length; k++) {
        starts.push(i);
        ends.push(next);
      }
      lastSpace = false;
    }
    i = next;
  }
  return { norm: norm.trimEnd(), starts, ends };
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
  const { norm, starts, ends } = normalizeWithMap(source);
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
  return { start: starts[first], end: ends[lastEnd - 1] };
}

const LINE_END = /[\r\n\v\f\u0085\u2028\u2029]/;
const CLOSERS = /["'”’)\]]/;
/** A period after one of these does not end a sentence ("Dr. Lee", "7 a.m. the morning of", "1. Take"). */
const ABBREVIATION = /(?:^|[^\p{L}\p{N}.])(?:dr|mr|mrs|ms|st|sr|jr|no|vs|etc|approx|apt|ste|ave|rd|blvd|mt|ft|oz|tbsp|tsp|e\.g|i\.e|a\.m|p\.m|[ap]|\d{1,2})$/iu;

/** If a sentence ends at `i` (a . ! or ?), the index just past it and any closing quote or bracket; otherwise -1. */
function sentenceEndAt(src: string, i: number, lineEnd: number): number {
  if (!/[.!?]/.test(src[i])) return -1;
  let k = i + 1;
  while (k < lineEnd && CLOSERS.test(src[k])) k++;
  if (k < lineEnd && !/\s/.test(src[k])) return -1;
  let n = k;
  while (n < lineEnd && /\s/.test(src[n])) n++;
  // A lowercase word next ("7 a.m. the morning of") means the sentence goes on.
  if (n < lineEnd && /\p{Ll}/u.test(src[n])) return -1;
  if (src[i] === "." && ABBREVIATION.test(src.slice(Math.max(0, i - 12), i))) return -1;
  return k;
}

/**
 * The whole sentence (or sentences) around a matched span: back to the start of the sentence the span starts in and
 * on to the end of the sentence it ends in, never past a line break. A list marker ("- ", "1. ", "• ") at the start
 * of the line is left out. Showing this, not the model's copy, means a quote can't leave out the words around it:
 * "take it the morning of your procedure" is shown as "If you take insulin, do not take it the morning of your
 * procedure." Sentence ends are read conservatively, so when in doubt more of the line is shown, never less.
 */
export function enclosingSentence(source: string, span: { start: number; end: number }): { start: number; end: number } {
  let lineStart = span.start;
  while (lineStart > 0 && !LINE_END.test(source[lineStart - 1])) lineStart--;
  let start = lineStart;
  for (let i = lineStart; i < span.start; i++) {
    const after = sentenceEndAt(source, i, source.length);
    if (after >= 0 && after <= span.start) start = after;
  }
  const lastChar = Math.max(span.start, span.end - 1);
  let lineEnd = lastChar;
  while (lineEnd < source.length && !LINE_END.test(source[lineEnd])) lineEnd++;
  let end = lineEnd;
  for (let i = lastChar; i < lineEnd; i++) {
    const after = sentenceEndAt(source, i, lineEnd);
    if (after >= 0) { end = after; break; }
  }
  while (start < end && /\s/.test(source[start])) start++;
  if (start === lineStart) {
    const marker = /^(?:[-•*·▪●]|\d{1,2}[.)])\s+/u.exec(source.slice(start, Math.min(end, start + 8)));
    if (marker && start + marker[0].length <= span.start) start += marker[0].length;
  }
  while (end > start && /\s/.test(source[end - 1])) end--;
  return { start: Math.min(start, span.start), end: Math.max(end, span.end) };
}

/** The care plan route's request limit for one quote (plan.ts, meaning.ts, understand.ts all cap source_quote at 800). */
const MAX_QUOTE = 800;

/**
 * Checks one item. `index` is its place in the model's full list, which sets its id. A grounded item carries the
 * whole sentence its quote sits in, from the paper itself (enclosingSentence), so a fragment can't drop a "do not".
 * If that sentence is longer than the routes accept, the matched words themselves are kept.
 */
export function verifyItem(source: string, item: CareItem, index: number): VerifiedItem {
  const found = findSpan(source, item.source_quote);
  if (!found) return { ...item, id: `item-${index}`, grounded: false, span: null };
  const whole = enclosingSentence(source, found);
  const span = whole.end - whole.start <= MAX_QUOTE ? whole : found;
  return { ...item, source_quote: source.slice(span.start, span.end), id: `item-${index}`, grounded: true, span };
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
