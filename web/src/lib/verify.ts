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

/** A letter or digit in a script that puts spaces between words (a Chinese or Korean match may sit mid-run). */
const WORD_CHAR = /[\p{Script=Latin}\p{Script=Cyrillic}\p{Script=Greek}\p{N}\p{M}]/u;
const DIGIT = /\p{N}/u;

/**
 * True when `f` at `at` in `norm` starts and ends on a word or number boundary: "take it" is not in "mistake it",
 * "10 mg" is not in "110 mg" or "2.10 mg", "5 mg" is not in "2.5 mg" (Codex round 9).
 */
function onBoundary(norm: string, f: string, at: number): boolean {
  const end = at + f.length;
  const before = norm[at - 1] ?? "";
  const after = norm[end] ?? "";
  if (WORD_CHAR.test(f[0]) && WORD_CHAR.test(before)) return false;
  if (WORD_CHAR.test(f[f.length - 1]) && WORD_CHAR.test(after)) return false;
  if (DIGIT.test(f[0]) && /[.,]/.test(before) && DIGIT.test(norm[at - 2] ?? "")) return false;
  if (DIGIT.test(f[f.length - 1]) && /[.,]/.test(after) && DIGIT.test(norm[end + 1] ?? "")) return false;
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
