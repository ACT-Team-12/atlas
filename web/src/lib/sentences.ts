/**
 * The one sentence scanner, shared by the span widener (verify.ts enclosingSentence) and the time reader
 * (prepTime.ts firstClause), so the sentence a step SHOWS is the sentence its time words are READ from.
 *
 * A sentence ends at ".", "!" or "?" (plus any closing quote or bracket) followed by whitespace or the end of the
 * text, whatever the case of the next letter: "Take bisacodyl. stop iron 3 days before" is two sentences, so the iron
 * timing can never place the bisacodyl. Pasted or OCR'd text that lost its space ("pill.stop") is split too. The only
 * exceptions are spelled out:
 * - a title or "for example" never ends a sentence: Dr. Mr. Mrs. Ms. St. No. e.g. i.e. vs.;
 * - a number at the start of a line is a list marker ("1. Take ..."), not an end;
 * - a unit or abbreviation that often ends a sentence (a.m. p.m. mg. g. ml. hr. min. etc. ...) ends one before a
 *   capital or digit, and before a lowercase word that starts an instruction ("Take 5 mg. stop aspirin" is two
 *   sentences, so is "5 mg.stop"); it goes on before a small joining word ("7 a.m. the morning of"). Any other
 *   lowercase word after it ("5 mg. aspirin 3 days before") is AMBIGUOUS: hasAmbiguousEnd() reports it, and prep
 *   mode never places such a step on the timeline.
 *
 * Pure functions. Safe to import in the browser.
 */

export const LINE_BREAK = /[\r\n\v\f\u0085\u2028\u2029]/;
const CLOSERS = /["'”’)\]]/;
const NEVER_END = new Set(["dr", "mr", "mrs", "ms", "st", "no", "e.g", "i.e", "vs"]);
const END_UNLESS_LOWER = new Set([
  "a.m", "p.m", "mg", "mcg", "g", "ml", "l", "oz", "tsp", "tbsp", "etc", "approx", "apt", "ste", "ave", "rd", "blvd", "jr",
  "sr", "ft", "hr", "hrs", "min", "mins", "sec", "secs", "wk", "wks", "mo", "mos", "tab", "tabs", "cap", "caps",
]);
/** Words that start an instruction: after "5 mg." they begin a new sentence even in lowercase. */
export const INSTRUCTION_START = new Set([
  // English
  "take", "stop", "hold", "call", "start", "skip", "avoid", "do", "don't", "don’t", "dont", "never", "eat", "drink",
  "arrive", "bring", "use", "apply", "check", "continue", "resume", "wait", "keep", "have", "go", "come", "tell", "ask",
  "begin", "finish", "swallow", "chew", "inject", "remove", "wear", "fast", "nothing", "no", "please", "then",
  // Spanish
  "tome", "deje", "pare", "suspenda", "llame", "empiece", "comience", "evite", "omita", "coma", "beba", "llegue",
  "traiga", "use", "aplique", "revise", "continúe", "continue", "siga", "espere", "nunca",
  // French
  "prenez", "arrêtez", "cessez", "appelez", "commencez", "évitez", "mangez", "buvez", "arrivez", "apportez",
  "utilisez", "appliquez", "vérifiez", "continuez", "reprenez", "attendez", "ne", "n'", "jamais",
  // Vietnamese
  "uống", "ngừng", "ngưng", "dừng", "gọi", "bắt", "tránh", "bỏ", "ăn", "đến", "mang", "dùng", "bôi", "kiểm", "tiếp",
  "chờ", "không", "đừng",
]);
/** Small words that carry a sentence on after "a.m." or "mg." ("7 a.m. the morning of", "5 mg. by mouth"). */
const JOINING = new Set([
  "the", "a", "an", "on", "at", "in", "and", "or", "with", "before", "after", "to", "of", "for", "until", "by", "each",
  "every", "per", "daily", "twice", "once", "your", "if", "as", "when", "total", "tablet", "tablets", "by", "from",
  "de", "del", "la", "el", "y", "o", "con", "por", "cada", "du", "le", "et", "ou", "avec", "par", "và", "hoặc", "mỗi",
]);

/** The word starting at `n` (letters and an apostrophe), lowercased. */
function wordAt(src: string, n: number, limit: number): string {
  const m = /^[\p{L}'’]+/u.exec(src.slice(n, Math.min(limit, n + 40)));
  return m ? m[0].toLowerCase() : "";
}

/** The letters-and-dots word just before index `i` ("a.m" before the last "." of "a.m."). */
function wordBefore(src: string, i: number): { text: string; start: number } {
  let s = i;
  while (s > 0 && /[\p{L}\p{N}.]/u.test(src[s - 1])) s--;
  return { text: src.slice(s, i).toLowerCase(), start: s };
}

/**
 * If a sentence ends at `i` (a ".", "!" or "?"), the index just past it and any closing quote or bracket;
 * otherwise -1. `limit` is where the text being scanned stops (a line end, or the text's length).
 */
export function sentenceEndAt(src: string, i: number, limit: number = src.length): number {
  if (!/[.!?]/.test(src[i] ?? "")) return -1;
  // "..." is one ending: only its last dot can end the sentence.
  if (src[i] === "." && src[i + 1] === ".") return -1;
  let k = i + 1;
  while (k < limit && CLOSERS.test(src[k])) k++;
  const next = k < limit ? src[k] : "";
  const spaced = next === "" || /\s/.test(next);
  if (src[i] === "." && /\p{N}/u.test(src[i - 1] ?? "") && /\p{N}/u.test(next)) return -1; // 2.5 mg
  if (!spaced) {
    // Lost space after a full word ("pill.stop", "today!Call"): still an end. Not inside "a.m" or "e.g" or "2.5".
    const w = wordBefore(src, i);
    const bare = w.text.replace(/\./g, "");
    if (END_UNLESS_LOWER.has(w.text) && INSTRUCTION_START.has(wordAt(src, k, limit))) return k; // "5 mg.stop"
    if (!/\p{L}/u.test(next) || w.text.includes(".") || bare.length < 2 || !/^\p{L}+$/u.test(bare)) return -1;
    if (NEVER_END.has(w.text) || END_UNLESS_LOWER.has(w.text)) return -1;
    return k;
  }
  if (src[i] !== ".") return k;
  const w = wordBefore(src, i);
  if (NEVER_END.has(w.text)) return -1;
  // A number alone at the start of a line is a list marker: "1. Take ...".
  if (/^\d{1,2}$/.test(w.text)) {
    let ls = w.start;
    while (ls > 0 && !LINE_BREAK.test(src[ls - 1])) ls--;
    if (/^[\s\-•*·▪●]*$/u.test(src.slice(ls, w.start))) return -1;
  }
  if (END_UNLESS_LOWER.has(w.text)) {
    let n = k;
    while (n < limit && /\s/.test(src[n])) n++;
    if (n < limit && /\p{Ll}/u.test(src[n]) && !INSTRUCTION_START.has(wordAt(src, n, limit))) return -1;
  }
  return k;
}

/**
 * True when `text` has a unit or time abbreviation ("mg.", "a.m.", "etc.") followed by a lowercase word that is
 * neither an instruction start (then it is an end) nor a small joining word (then it goes on): we can't tell
 * whether a new sentence starts there, so prep mode places no time from it.
 */
export function hasAmbiguousEnd(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "." || text[i + 1] === "." || sentenceEndAt(text, i, text.length) >= 0) continue;
    if (!END_UNLESS_LOWER.has(wordBefore(text, i).text)) continue;
    let n = i + 1;
    while (n < text.length && CLOSERS.test(text[n])) n++;
    while (n < text.length && /\s/.test(text[n])) n++;
    if (n >= text.length || !/\p{Ll}/u.test(text[n])) continue;
    if (!JOINING.has(wordAt(text, n, text.length))) return true;
  }
  return false;
}

/** The end of the first sentence of `text` (just past its terminator), or -1 when the whole text is one sentence. */
export function firstSentenceEnd(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const after = sentenceEndAt(text, i, text.length);
    if (after >= 0 && after < text.length) return after;
  }
  return -1;
}
