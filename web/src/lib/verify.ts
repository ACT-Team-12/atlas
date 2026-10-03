import type { CareItem, VerifiedItem } from "./schema";
import { LINE_BREAK as LINE_END, sentenceEndAt } from "./sentences";

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
  /** The source itself, for checks that read the paper's own words around a match (verifyItem). */
  readonly src: string;
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
  return { src, norm: trimmed, starts, ends, boundary };
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
 * One UTF-16 unit that is part of a word in a script that puts spaces between words: ASCII letters and digits, the
 * Latin-1 and Latin Extended letters (Vietnamese included), combining marks, Greek, Cyrillic, Armenian, Hebrew,
 * Arabic (with its digits), Devanagari, Georgian, Ethiopic and fullwidth letters and digits. Chinese, Japanese,
 * Korean and Thai never count: they don't put spaces between words, so a match may sit mid-run. Plain ranges, so the
 * Rust port (core/atlas-verify) is exact. Erring toward MORE word characters only refuses more quotes.
 */
const WORD_CHAR =
  /[A-Za-z0-9\u00AA\u00B2\u00B3\u00B5\u00B9\u00BA\u00BC-\u00BE\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02FF\u0300-\u036F\u0370-\u03FF\u0400-\u052F\u0530-\u058F\u0590-\u05FF\u0600-\u06FF\u0900-\u097F\u10A0-\u10FF\u1200-\u139F\u1E00-\u1FFF\u2070-\u209F\u2150-\u218F\uFF10-\uFF19\uFF21-\uFF3A\uFF41-\uFF5A]/;
/** A character that can join two runs of digits into one number: . , / ⁄ ∕ ' and a space. */
const NUMBER_JOIN = /[.,/\u2044\u2215' ]/;
const FRACTION_SLASH = /[/\u2044\u2215]/;
/** A digit, in any of the digit sets above. */
const DIGIT = /[0-9\u0660-\u0669\u06F0-\u06F9\u0966-\u096F\uFF10-\uFF19]/;

/**
 * True when `f` at `at` in `norm` starts and ends on a word or number boundary: "take it" is not in "mistake it",
 * "10 mg" is not in "110 mg" or "2.10 mg", "5 mg" is not in "2.5 mg" (Codex round 9), "2 tablets" is not in "1/2 tablets".
 */
function onBoundary(norm: string, f: string, at: number): boolean {
  const end = at + f.length;
  const before = norm[at - 1] ?? "";
  const after = norm[end] ?? "";
  if (WORD_CHAR.test(f[0]) && WORD_CHAR.test(before)) return false;
  if (WORD_CHAR.test(f[f.length - 1]) && WORD_CHAR.test(after)) return false;
  // Inside one number: a decimal or thousands mark, a fraction slash, an apostrophe group mark ("1'500") or a space
  // between digits ("1 500", or the "1 1/2" of a mixed fraction): "2 tablets" is not in "1/2 tablets" (Codex round 10).
  if (DIGIT.test(f[0]) && NUMBER_JOIN.test(before) && DIGIT.test(norm[at - 2] ?? "")) return false;
  if (DIGIT.test(f[f.length - 1]) && NUMBER_JOIN.test(after) && DIGIT.test(norm[end + 1] ?? "")) return false;
  // A fraction slash with a space on either side ("1 / 2", "3 ⁄ 4") still joins the two numbers (Codex round 11).
  if (DIGIT.test(f[0]) && spacedSlash(norm, at - 1, -1)) return false;
  if (DIGIT.test(f[f.length - 1]) && spacedSlash(norm, end, 1)) return false;
  return true;
}

/** From `i` walking in `step` direction: an optional space, a fraction slash, an optional space, then a digit. */
function spacedSlash(norm: string, i: number, step: 1 | -1): boolean {
  let j = i;
  if (norm[j] === " ") j += step;
  if (!FRACTION_SLASH.test(norm[j] ?? "")) return false;
  j += step;
  if (norm[j] === " ") j += step;
  return DIGIT.test(norm[j] ?? "");
}

/**
 * The first occurrence of `needle` in `hay` at or after `from` that starts AND ends on a boundary and that `accept`
 * allows, or -1. Same answer as calling `indexOf` again from each rejected occurrence, but Knuth-Morris-Pratt over UTF-16 units enumerates every
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
  // Word and number edges (onBoundary), checked inside this one pass so the search stays linear: re-running it
  // after each rejected occurrence would be O(hay * needle) on a paper like "aaaa...".
  accept: (at: number) => boolean = () => true,
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
      if (boundary[at] && boundary[i + 1] && accept(at)) {
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
    // The first occurrence that starts AND ends between source characters (never inside one character's case
    // expansion, e.g. at the U+0307 that "İ" lower-cases into) and on a word or number edge ("10 mg" is not in
    // "110 mg"). Rejected occurrences are skipped and the search goes on past them.
    const at = indexOfAligned(norm, f, cursor, boundary, undefined, (a) => onBoundary(norm, f, a));
    if (at < 0) return null;
    if (first < 0) first = at;
    lastEnd = at + f.length;
    cursor = lastEnd;
  }
  return { start: starts[first], end: ends[lastEnd - 1] };
}

/**
 * The whole sentence (or sentences) around a matched span: back to the start of the sentence the span starts in and
 * on to the end of the sentence it ends in, never past a line break. A list marker ("- ", "1. ", "• ") at the start
 * of the line is left out. Showing this, not the model's copy, means a quote can't leave out the words around it:
 * "take it the morning of your procedure" is shown as "If you take insulin, do not take it the morning of your
 * procedure." Sentence ends come from the shared scanner (sentences.ts), the same one prep reads time words with.
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

/** True when a line break or a sentence end falls inside `span` (before its last character). */
export function crossesSentence(source: string, span: { start: number; end: number }): boolean {
  for (let i = span.start; i < span.end; i++) {
    if (LINE_END.test(source[i])) return true;
    const after = sentenceEndAt(source, i, span.end);
    if (after >= 0 && after < span.end) return true;
  }
  return false;
}

/** The care plan route's request limit for one quote (plan.ts, meaning.ts, understand.ts all cap source_quote at 800). */
const MAX_QUOTE = 800;

/**
 * Checks one item. `index` is its place in the model's full list, which sets its id. A grounded item carries the
 * whole sentence its quote sits in, from the paper itself (enclosingSentence), so a fragment can't drop a "do not".
 * If that sentence is longer than the routes accept, the item is held back: it is never cut down to the fragment,
 * since the words left out could be the "do not" (the person reads that sentence in the paper instead).
 */
export function verifyItem(mapped: MappedSource, item: CareItem, index: number): VerifiedItem {
  const source = mapped.src;
  const found = findSpanIn(mapped, item.source_quote);
  if (!found) return { ...item, id: `item-${index}`, grounded: false, span: null };
  // A "..." quote may only skip words inside one sentence on one line: "stop aspirin ... take insulin" must not fuse
  // two lines (or two sentences) of the paper into one step (Codex round 7).
  if (fragments(item.source_quote).length > 1 && crossesSentence(source, found)) {
    return { ...item, id: `item-${index}`, grounded: false, span: null, held_reason: "skips_across" };
  }
  const span = enclosingSentence(source, found);
  if (span.end - span.start > MAX_QUOTE) return { ...item, id: `item-${index}`, grounded: false, span: null, held_reason: "sentence_too_long" };
  return { ...item, source_quote: source.slice(span.start, span.end), id: `item-${index}`, grounded: true, span };
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
