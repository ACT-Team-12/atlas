import {
  checkCoverage, criticalRanges, instructionSentences, quotedRanges, splitSentences,
  type CoverageItem, type CoverageLang, type UncoveredSentence,
} from "./coverage";
import { normalize } from "./verify";

/**
 * View logic for the "Lines on your paper we didn't turn into steps" section (ui/MissedLines.tsx).
 *
 * The one rule that matters: never show "every instruction-like line is in a step" unless the check
 * could actually read the paper. The coverage lexicons exist for English and a Spanish starter set only.
 * Run on a French or Korean paper, they find no instructions at all, and an "all covered" message would
 * be a false claim. So the section is shown only when the PAPER's language is one the check supports.
 *
 * The paper's language decides, not the language the plan is written in: kept items quote the paper word
 * for word, so an English paper explained in Korean is still checked against English rules, and a paper
 * in an unsupported language is never checked, whatever the output language.
 */

export type MissedLinesView =
  /** "invalid": a missed_lines payload broke a rule in missedLinesPayloadValid (only from missedFromPayload). */
  | { show: false; why: "empty" | "unsupported_language" | "no_instructions" | "invalid" }
  | { show: true; languages: CoverageLang[]; total: number; covered: number; lines: UncoveredSentence[] };

/* Words that are common in one language and rare in the others. Ambiguous ones (en, de, la, que, no, si)
 * are left out on purpose, because Spanish, French and Portuguese share them. */
const EN_WORDS = new Set([
  "the", "and", "you", "your", "to", "of", "for", "with", "is", "if", "this", "are", "be", "will", "or", "at",
  "take", "call", "each", "after", "before", "have", "has", "by", "on", "it", "what", "when", "do", "not",
  "as", "from", "until", "then", "up", "out", "any", "all", "once", "twice", "daily", "every", "day", "days",
  "due", "week", "weeks", "month", "months", "times", "today", "visit", "clinic", "doctor", "mouth", "tablet",
  "tablets", "blood", "pain", "fever", "office", "our", "we", "was", "were", "may", "can", "should", "need",
  "use", "new", "than", "without", "about", "into", "get", "go", "see", "stop", "start", "keep", "eat", "drink",
]);
const ES_WORDS = new Set([
  "el", "los", "las", "usted", "su", "sus", "para", "con", "por", "una", "y", "del", "al", "es", "está",
  "esta", "cada", "día", "dia", "tome", "llame", "pero", "cuando", "tiene", "debe", "hasta", "después", "antes", "como",
]);
/** Latin-script languages the check does NOT support (French, Portuguese, Haitian Creole, German, Italian, Somali). */
const OTHER_WORDS = new Set([
  "le", "les", "des", "vous", "votre", "vos", "et", "pour", "avec", "une", "du", "au", "aux", "est", "sont", "pas",
  "ne", "dans", "sur", "prenez", "appelez", "jours", "chaque", "você", "seu", "sua", "com", "os", "não", "uma",
  "dos", "das", "ao", "pou", "ak", "nan", "yo", "ou", "pa",
  "sie", "die", "der", "und", "mit", "nicht", "bei", "ist", "ein", "eine", "il", "di", "che", "per", "della",
  "non", "sono", "iyo", "ka", "ku", "waa", "haddii", "oo",
]);
/** Letters that only Vietnamese uses among the app's languages (Spanish accents are not in this set). */
const VIETNAMESE = /[ăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/giu;
const LETTER = /\p{L}/gu;
const LATIN_LETTER = /\p{Script=Latin}/gu;

/** A language counts as present when its marker words are both frequent enough and not a stray few. */
const MIN_HITS = 3;
const MIN_SHARE_OF_WORDS = 0.06;
/** Any unsupported language above this share of the recognized marker words hides the section. */
const MAX_OTHER_SHARE = 0.2;
/** Sentence-level check: sentences with at least this many words must each be readable as English or Spanish. */
const LONG_SENTENCE_WORDS = 5;
/**
 * Long sentences with no English or Spanish marker word at all (terse clinical lines such as "ED attending
 * reviewed chest x-ray: no pneumonia.", or an unlisted language): up to 1, or up to this share, is allowed.
 */
const MAX_UNMARKED_SHARE = 0.2;

const count = (s: string, re: RegExp) => s.match(re)?.length ?? 0;

/**
 * Which coverage lexicons fit this paper, or null when the check cannot be trusted on it:
 * mostly non-Latin script (Korean, Chinese, Amharic), Vietnamese, a noticeable share of French,
 * Portuguese or Creole, or too little recognizable text to tell.
 * A paper that is part English and part Spanish gets both lexicons.
 */
export function paperLanguages(source: string): CoverageLang[] | null {
  const letters = count(source, LETTER);
  if (letters === 0) return null;
  if (count(source, LATIN_LETTER) / letters < 0.95) return null;
  if (count(source, VIETNAMESE) / letters > 0.01) return null;

  const words = source.toLowerCase().match(/\p{L}+/gu) ?? [];
  let en = 0, es = 0, other = 0;
  for (const w of words) {
    if (EN_WORDS.has(w)) en++;
    if (ES_WORDS.has(w)) es++;
    if (OTHER_WORDS.has(w)) other++;
  }
  const recognized = en + es + other;
  if (recognized === 0) return null;
  if (other >= MIN_HITS && other / recognized > MAX_OTHER_SHARE) return null;

  if (!sentencesAssignable(source)) return null;

  const present = (hits: number) => hits >= MIN_HITS && hits / words.length >= MIN_SHARE_OF_WORDS;
  const langs: CoverageLang[] = [];
  if (present(en)) langs.push("en");
  if (present(es)) langs.push("es");
  return langs.length > 0 ? langs : null;
}

/**
 * Fails closed on a paper that mixes in a language the check cannot read, sentence by sentence, so a few
 * English lines cannot vouch for German or Somali instructions. A long sentence that has more
 * unsupported-language marker words than English or Spanish ones hides the section on its own. Long
 * sentences with no marker word of any language (an unlisted language, or a terse drug line) are allowed
 * only up to MAX_UNMARKED_SHARE of the long sentences.
 */
function sentencesAssignable(source: string): boolean {
  let long = 0, unmarked = 0;
  for (const s of splitSentences(source)) {
    const words = s.text.toLowerCase().match(/\p{L}+/gu) ?? [];
    if (words.length < LONG_SENTENCE_WORDS) continue;
    long++;
    let supported = 0, other = 0;
    for (const w of words) {
      if (EN_WORDS.has(w) || ES_WORDS.has(w)) supported++;
      if (OTHER_WORDS.has(w)) other++;
    }
    if (other > supported) return false;
    if (supported === 0) unmarked++;
  }
  return unmarked <= 1 || unmarked / long <= MAX_UNMARKED_SHARE;
}

/**
 * Everything the section needs, computed once per plan. Pass the kept items WITH the spans verifyItems
 * already found: then the check is one pass over the paper and never searches for a quote again.
 */
export function missedLinesView(source: string, items: CoverageItem[]): MissedLinesView {
  if (!source.trim()) return { show: false, why: "empty" };
  const languages = paperLanguages(source);
  if (!languages) return { show: false, why: "unsupported_language" };
  const report = checkCoverage(source, items, { languages });
  // No instruction-like line found at all: "every line is in a step" would be true only vacuously.
  if (report.total === 0) return { show: false, why: "no_instructions" };
  return { show: true, languages, total: report.total, covered: report.covered, lines: report.uncovered };
}

/** The verbatim lines for the printed handoff sheet: empty whenever the section is hidden or all is covered. */
export function missedLineTexts(view: MissedLinesView): string[] {
  return view.show ? view.lines.map((l) => l.text) : [];
}

/**
 * What a screen reader hears when the result arrives or changes (a polite live status in the UI).
 * Empty when the section is hidden, so nothing is announced for a paper the check could not read.
 */
export function missedLinesAnnouncement(view: MissedLinesView): string {
  if (!view.show) return "";
  const n = view.lines.length;
  if (n === 0) return "Every instruction-like line on your paper is in a step.";
  return `${n === 1 ? "1 line" : `${n} lines`} on your paper ${n === 1 ? "looks" : "look"} like instructions but ${n === 1 ? "is" : "are"} not in a step. Open "Lines on your paper we didn't turn into steps" to read ${n === 1 ? "it" : "them"}.`;
}

/* ------------------------------------------------------------------------------------------ */
/* The same check, returned by POST /api/extract so the phone apps never match text themselves. */
/* ------------------------------------------------------------------------------------------ */

/** A [start, end) pair of UTF-16 offsets into source_text. Clients only compare these numbers; they never slice with them. */
export type OffsetRange = [number, number];

/**
 * `missed_lines` on the /api/extract response (and on the stream's final "done" plan). It lets a client
 * rebuild missedLinesView for ANY set of removed steps with integer comparisons only: no text matching,
 * no Unicode normalization.
 *
 * Coverage is NOT a per-item property. checkCoverage merges every kept item's quoted stretches first, so a
 * number can be covered only by two items' quotes together (one ends where the next begins), and a line
 * also counts as covered when a word-for-word repeat of it elsewhere is covered. So the payload carries
 * the raw pieces, and the client runs the same small interval check:
 *
 *  show false: hide the section and announce nothing. `why` never depends on which steps are kept.
 *  show true:
 *   1. R = the `quotes[id]` ranges of every KEPT item id (an id missing from `quotes` adds nothing).
 *   2. Sort R by start. Merge into M: walking in order, a range whose start <= the last merged end extends
 *      it (end = max of the two ends); otherwise it starts a new merged range. Touching ranges merge.
 *   3. Sentence s is matched when some range m in M has m.start < s.end and m.end > s.start, AND for every
 *      [a, b] in s.critical some m in M has m.start <= a and m.end >= b.
 *   4. A sentence is covered when ANY sentence with the same `group` is matched.
 *   5. lines = the sentences that are not covered, in array order; covered = total - lines.length,
 *      where total = sentences.length.
 */
export type MissedLinesPayload =
  | { show: false; why: "empty" | "unsupported_language" | "no_instructions" }
  | {
      show: true;
      languages: CoverageLang[];
      /** Each item id's quoted stretches of the paper. Items that quote nothing locatable are left out. */
      quotes: Record<string, OffsetRange[]>;
      /** Every instruction-like sentence on the paper, in reading order. */
      sentences: {
        text: string;
        start: number;
        end: number;
        reason: UncoveredSentence["reason"];
        /** Numbers and stop / not / never / avoid words: each must sit inside ONE merged kept range. */
        critical: OffsetRange[];
        /** Index (into sentences) of the first sentence with the same normalized text. Its own index if none earlier. */
        group: number;
      }[];
    };

/**
 * Builds `missed_lines` for a plan. `items` are ALL the kept items, with the spans the verifier found.
 * Pure and deterministic; no model call.
 */
export function missedLinesPayload(source: string, items: (CoverageItem & { id: string })[]): MissedLinesPayload {
  if (!source.trim()) return { show: false, why: "empty" };
  const languages = paperLanguages(source);
  if (!languages) return { show: false, why: "unsupported_language" };
  const found = instructionSentences(source, { languages });
  if (found.length === 0) return { show: false, why: "no_instructions" };

  const quotes = Object.fromEntries(
    items
      .map((it) => [it.id, quotedRanges(source, it).map((r): OffsetRange => [r.start, r.end])] as const)
      .filter(([, r]) => r.length > 0),
  );
  const firstByText = new Map<string, number>();
  const sentences = found.map((s, i) => {
    const key = normalize(s.text);
    if (!firstByText.has(key)) firstByText.set(key, i);
    return {
      text: s.text, start: s.start, end: s.end, reason: s.reason,
      critical: criticalRanges(s).map((r): OffsetRange => [r.start, r.end]),
      group: firstByText.get(key)!,
    };
  });
  return { show: true, languages, quotes, sentences };
}

const isOffset = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0;

/**
 * The rules every client checks before computing anything from a show:true payload (the Android app has the
 * same rules in MissedLines.valid). `sourceLength` is the UTF-16 length of the response's source_text when known.
 *  - at least one sentence (with none, "every line is in a step" would be vacuous);
 *  - every range is two integers with 0 <= start < end, and end <= sourceLength when it is known;
 *  - each sentence's critical ranges sit inside that sentence;
 *  - each group points at an earlier-or-same sentence that is its own group's first (group(group) === group).
 * It takes `unknown` on purpose: the payload arrives as JSON, and a range like [-1, 2147483647] (which overlaps
 * every sentence) would otherwise claim the whole paper is covered.
 */
export function missedLinesPayloadValid(payload: unknown, sourceLength?: number): boolean {
  const limit = sourceLength ?? Number.MAX_SAFE_INTEGER;
  const range = (r: unknown): r is OffsetRange =>
    Array.isArray(r) && r.length === 2 && isOffset(r[0]) && isOffset(r[1]) && r[0] < r[1] && r[1] <= limit;
  if (typeof payload !== "object" || payload === null) return false;
  const p = payload as { show?: unknown; languages?: unknown; quotes?: unknown; sentences?: unknown };
  if (p.show !== true || !Array.isArray(p.languages) || !Array.isArray(p.sentences) || p.sentences.length === 0) return false;
  if (typeof p.quotes !== "object" || p.quotes === null || Array.isArray(p.quotes)) return false;
  const sentences = p.sentences as unknown[];
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i] as { text?: unknown; start?: unknown; end?: unknown; critical?: unknown; group?: unknown } | null;
    if (typeof s !== "object" || s === null || typeof s.text !== "string") return false;
    if (!range([s.start, s.end])) return false;
    const [start, end] = [s.start as number, s.end as number];
    if (!Array.isArray(s.critical) || !s.critical.every((c) => range(c) && c[0] >= start && c[1] <= end)) return false;
    const g = s.group;
    if (typeof g !== "number" || !Number.isSafeInteger(g) || g < 0 || g > i) return false;
    if ((sentences[g] as { group?: unknown }).group !== g) return false;
  }
  return Object.values(p.quotes).every((rs) => Array.isArray(rs) && rs.every(range));
}

/**
 * The reference client: missedLinesView rebuilt from the payload and the ids of the steps still kept.
 * Equal to missedLinesView(source, keptItems) for every removal set (see missedLines.test.ts). A show:true
 * payload that breaks a rule in missedLinesPayloadValid is hidden as "invalid": no list, no all-covered claim.
 */
export function missedFromPayload(payload: MissedLinesPayload, keptIds: Iterable<string>, sourceLength?: number): MissedLinesView {
  if (!payload.show) return { show: false, why: payload.why };
  if (!missedLinesPayloadValid(payload, sourceLength)) return { show: false, why: "invalid" };
  const ranges: OffsetRange[] = [];
  for (const id of new Set(keptIds)) if (Object.prototype.hasOwnProperty.call(payload.quotes, id)) ranges.push(...payload.quotes[id]);
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: OffsetRange[] = [];
  for (const [start, end] of ranges) {
    const last = merged[merged.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  const matchedGroups = new Set<number>();
  for (const s of payload.sentences) {
    const overlaps = merged.some(([a, b]) => a < s.end && b > s.start);
    if (overlaps && s.critical.every(([a, b]) => merged.some(([ms, me]) => ms <= a && me >= b))) matchedGroups.add(s.group);
  }
  const lines = payload.sentences
    .filter((s) => !matchedGroups.has(s.group))
    .map(({ text, start, end, reason }) => ({ text, start, end, reason }));
  const total = payload.sentences.length;
  return { show: true, languages: payload.languages, total, covered: total - lines.length, lines };
}

/** "1 line" / "3 lines", for the collapsed heading's badge. */
export function lineCountLabel(n: number): string {
  return `${n} ${n === 1 ? "line" : "lines"}`;
}
