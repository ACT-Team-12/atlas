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
  return true;
}

export function findSpan(source: string, quote: string): { start: number; end: number } | null {
  const frags = fragments(quote);
  if (frags.length === 0) return null;
  const { norm, starts, ends } = normalizeWithMap(source);
  let cursor = 0;
  let first = -1;
  let lastEnd = -1;
  for (const f of frags) {
    let at = norm.indexOf(f, cursor);
    while (at >= 0 && !onBoundary(norm, f, at)) at = norm.indexOf(f, at + 1);
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
export function verifyItem(source: string, item: CareItem, index: number): VerifiedItem {
  const found = findSpan(source, item.source_quote);
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
  items.forEach((item, i) => {
    const v = verifyItem(source, item, i);
    (v.grounded ? kept : refused).push(v);
  });
  return { kept, refused };
}
