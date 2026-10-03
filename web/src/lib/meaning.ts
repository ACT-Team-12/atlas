import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ExtractError } from "./extract";
import { LANGUAGES } from "./schema";
import { NAME_BEFORE_LETTER, readNumberWords, type NumberLanguage } from "./numberWords";
import { certifyBlocker } from "./semanticGuard";

/**
 * Meaning check: does each plain-language explanation say the same thing as the line it quotes?
 *
 * The span checker proves the quote is really in the paper. It cannot prove the explanation next to it
 * means the same thing. Two independent signals look for that:
 *  1. Numbers (no AI): every number in the explanation must appear in the step's quote or its "when" text.
 *  2. A second model (a different one from the model that wrote the explanation) compares action,
 *     timing, amount and who does it, and must say exactly what differs.
 * Either signal flags the step so the person double-checks it with their clinic.
 */

export const CHECKER_MODEL = process.env.ATLAS_CHECKER_MODEL ?? "claude-sonnet-5-5";

export const MeaningRequestSchema = z.object({
  /** The language the explanations are written in, so their number words can be read (numberWords.ts). */
  language: z.enum(LANGUAGES).optional(),
  items: z
    .array(
      z.object({
        id: z.string().max(40),
        plain_language: z.string().max(800),
        when: z.string().max(200).default(""),
        source_quote: z.string().max(800),
      }),
    )
    .min(1)
    .max(40),
});
export type MeaningRequest = z.infer<typeof MeaningRequestSchema>;

export type MeaningResult = {
  id: string;
  flagged: boolean;
  numbers_ok: boolean;
  unexpected_numbers: string[];
  model_verdict: "same" | "different" | "unclear";
  what_differs: string;
  /** True only when the second model said "same" AND every number checks out. Only this earns the green check. */
  certified: boolean;
};
export type MeaningResponse = { results: MeaningResult[]; flagged: number; checker_model: string; ms: number };

const WORD_NUM: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", twice: "2", once: "1" };

/** Numbers written as digits (1, 2.5, 2,000), plus common English number words, normalized. */
export function numbersIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d+(?:[.,]\d+)*/g)) out.add(m[0].replace(/,(?=\d{3}\b)/g, ""));
  for (const m of text.toLowerCase().matchAll(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twice|once)\b/g)) out.add(WORD_NUM[m[1]]);
  return [...out];
}

type NumItem = { plain_language: string; when?: string; source_quote: string };
export type NumberCheck = { unexpected: string[]; uncheckable: boolean };
const digitsIn = (t: string) => [...t.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => m[0].replace(/,(?=\d{3}\b)/g, ""));

/**
 * Fractions, read as one value each, never as whole numbers. Before this, "1/2" read as a 1 and a 2 and "half a
 * tablet" as no number at all, so "Take 1/2 tablet" against "Take 2 tablets" passed the number check (Codex round 5).
 * - "1/2", "1 / 2", "1⁄2" are the one value "1/2";
 * - "half", "medio/media", "mitad", "demi/demie", "moitié", "nửa", "半", "반" are "1/2"; "quarter", "cuarto", "quart" "1/4";
 * - a whole number plus a fraction ("1 1/2", "1-1/2", "1 and a half", "una y media", "un et demi", "một giờ rưỡi",
 *   "一个半", "한 시간 반") is `mixed`: too easy to misread, so the step is uncheckable (never certified, held back).
 * `rest` is the text with digit fractions blanked, for the whole-number readers.
 */
const DIGIT_FRACTION = /\d+(?:[.,]\d+)?(?:\s+|-)\d+\s*[/⁄∕]\s*\d+|\d+\s*[/⁄∕]\s*\d+/gu;
const MIXED_DIGITS = /^\d+(?:[.,]\d+)?(?:\s+|-)\d/u;
const HALF_WORD = /(?<![\p{L}\p{M}])(?:half|halves|medio|media|medias|mitad|demi|demie|demis|moitié|nửa)(?![\p{L}\p{M}])|半(?!夜)|(?<![가-힣])반(?![가-힣])/giu;
const QUARTER_WORD = /(?<![\p{L}\p{M}])(?:quarter|quarters|cuarto|cuartos|cuarta|quart|quarts)(?![\p{L}\p{M}])/giu;
const MIXED_WORDS = [
  /(?<![\p{L}\p{M}])(?:and|&)\s+(?:a|one)\s+half(?![\p{L}\p{M}])/iu,
  /(?<![\p{L}\p{M}])y\s+medi[oa](?![\p{L}\p{M}])/iu,
  /(?<![\p{L}\p{M}])et\s+demie?(?![\p{L}\p{M}])/iu,
  /rưỡi/iu,
  /[一二两兩三四五六七八九十\d][^\s半]{1,2}半/u,
  /(?:알|정|시간|개|잔|컵|스푼|숟가락|봉|포)\s*반(?![가-힣])/u,
  // Fractions we don't read as values ("one third of a tablet", "an eighth"), and ordinals that look like them
  // (Codex round 11): never certified, rather than read as the whole number before them.
  /(?<![\p{L}\p{M}])(?:thirds?|fifths?|sixths?|sevenths?|eighths?|ninths?|tenths?|twelfths?|sixteenths?|tercios?|octavos?|tiers|huitièmes?|cinquièmes?|sixièmes?|phần)(?![\p{L}\p{M}])/iu,
  /分之/u,
  // A number grouped with a space or an apostrophe ("1 500 mg", "1'500 mg"), which the digit readers would split in two.
  /\d[ \u00A0\u202F'’]\d{3}(?!\d)/u,
];

export function fractionsIn(text: string): { values: string[]; rest: string; mixed: boolean } {
  const values = new Set<string>();
  let mixed = MIXED_WORDS.some((r) => r.test(text));
  const rest = text.replace(DIGIT_FRACTION, (f) => {
    if (MIXED_DIGITS.test(f)) mixed = true;
    else values.add(f.replace(/\s+/g, "").replace(/[⁄∕]/gu, "/"));
    return " ";
  });
  if (rest.match(HALF_WORD)) values.add("1/2");
  if (rest.match(QUARTER_WORD)) values.add("1/4");
  return { values: [...values], rest, mixed };
}

/**
 * What a quote (or its "when") allows: digits, fractions, English number words, and number words in the explanation's
 * language. `uncheckable` when the quote itself has numeral text that can't be read ("½ tablet", "1 1/2 tablets").
 */
function quoteNumbers(item: { when?: string; source_quote: string }, language?: NumberLanguage): { allowed: Set<string>; uncheckable: boolean } {
  const allowed = new Set<string>();
  let uncheckable = false;
  for (const t of [item.source_quote, item.when ?? ""]) {
    const f = fractionsIn(t);
    f.values.forEach((n) => allowed.add(n));
    numbersIn(f.rest).forEach((n) => allowed.add(n));
    const en = readNumberWords(f.rest, "English");
    en.numbers.forEach((n) => allowed.add(n));
    uncheckable ||= en.uncheckable || f.mixed;
    if (language && language !== "English" && language !== "Amharic") readNumberWords(f.rest, language).numbers.forEach((n) => allowed.add(n));
  }
  return { allowed, uncheckable };
}

// ---------------------------------------------------------------- which number goes with which unit

const UNIT_CLASSES: [string, RegExp][] = [
  ["dose", /^(?:tablets?|pills?|capsules?|puffs?|drops?|doses?|patch(?:es)?|injections?|units?|sprays?|tabletas?|pastillas?|c[áa]psulas?|comprimidos?|gotas?|inhalaci[óo]n|inhalaciones|unidades|unidad|parches?|comprim[ée]s?|pilules?|g[ée]lules?|cachets?|gouttes?|bouff[ée]es?|unit[ée]s?|viên|giọt|nhát|liều|miếng)$/u],
  ["mass", /^(?:mg|mcg|g|grams?|milligrams?|micrograms?|gramos?|miligramos?|grammes?|milligrammes?|gam)$/u],
  ["volume", /^(?:ml|l|oz|ounces?|cups?|glass(?:es)?|liters?|litres?|teaspoons?|tablespoons?|tsp|tbsp|tazas?|vasos?|onzas?|litros?|cucharadas?|cucharaditas?|verres?|tasses?|onces?|cuill[èe]res?|cốc|ly|lít|muỗng|thìa)$/u],
  ["minute", /^(?:minutes?|mins?|minutos?|phút)$/u],
  ["hour", /^(?:hours?|hrs?|horas?|heures?|giờ)$/u],
  ["day", /^(?:days?|d[íi]as?|jours?|ngày)$/u],
  ["week", /^(?:weeks?|semanas?|semaines?|tuần)$/u],
  ["month", /^(?:months?|mes|meses|mois|tháng)$/u],
  ["times", /^(?:times?|x|vez|veces|fois|lần)$/u],
  ["ratio", /^(?:parts?|partes?|parties?|phần)$/u],
  ["clock", /^(?:am|pm|a\.m\.?|p\.m\.?|o'clock|o’clock|h)$/u],
];
const CJK_UNIT_CLASSES: [string, RegExp][] = [
  ["dose", /^(?:片|粒|颗|顆|알|정|캡슐|방울)/u],
  ["mass", /^(?:毫克|밀리그램)/u],
  ["volume", /^(?:毫升|杯|밀리리터|컵|잔)/u],
  ["minute", /^(?:分钟|分鐘|분)/u],
  ["hour", /^(?:小时|小時|시간)/u],
  ["day", /^(?:天|日|일)/u],
  ["week", /^(?:周|週|星期|주)/u],
  ["month", /^(?:个月|個月|개월|달)/u],
  ["times", /^(?:次|회|번)/u],
  ["clock", /^(?:点|點|시)/u],
];
function unitClass(word: string | undefined): string | null {
  if (!word) return null;
  const w = word.toLowerCase();
  for (const [c, re] of UNIT_CLASSES) if (re.test(w)) return c;
  for (const [c, re] of CJK_UNIT_CLASSES) if (re.test(w)) return c;
  return null;
}

/**
 * Each number in `text` with the kind of unit right after it ("2 puffs" is 2 dose, "every 4 hours" is 4 hour,
 * "twice" is 2 times). `words` also reads number words in the given languages. `found` is every value read here.
 */
const CONTEXT_STOP = new Set([
  "take", "use", "give", "apply", "inhale", "drink", "eat", "the", "a", "an", "and", "or", "of", "with", "by", "at", "to",
  "for", "your", "then", "also", "every", "each", "per", "total", "daily", "once", "twice", "mouth", "in", "on", "is",
  "it", "you", "should", "please", "do", "not", "start", "stop", "continue", "keep", "inject", "swallow", "chew",
  "spray", "insert", "place", "put", "mix", "dissolve", "measure", "now",
]);
const HALF_WORD_ONE = /^(?:half|halves|medio|media|medias|mitad|demi|demie|demis|moitié|nửa|半|반)$/iu;
const QUARTER_WORD_ONE = /^(?:quarter|quarters|cuarto|cuartos|cuarta|quart|quarts)$/iu;

function numberUnits(text: string, languages: NumberLanguage[]): { pairs: [string, string | null][]; ctxs: string[][]; found: Set<string> } {
  const toks = [...text.matchAll(/\d{3}[-.]\d{3}[-.]\d{4}|\d{1,2}:\d{2}|\d+(?:st|nd|rd|th)(?![\p{L}\p{M}])|\d+(?:[.,]\d+)*(?:\s*[/⁄∕]\s*\d+)?|[ap]\.\s?m\.?|[\p{L}\p{M}]+/giu)].map((m) => m[0]);
  const pairs: [string, string | null][] = [];
  const ctxs: string[][] = [];
  const found = new Set<string>();
  // The words that name what a number is for: up to three words just before it, back to the previous number,
  // leaving out small words ("warfarin" in "Take warfarin 2 mg", "vitamin k" in "and vitamin K 5 mg").
  const ctxBefore = (i: number, cls: string | null): string[] => {
    const out: string[] = [];
    for (let k = i - 1; k >= 0 && out.length < 3; k--) {
      const t = toks[k];
      if (/^\d/.test(t)) break;
      const w = t.toLowerCase();
      // A unit of the same kind belongs to the previous number ("2 mg and vitamin K 5 mg"); another kind names what
      // this one counts ("2 tablets (20 mg total)").
      const u = unitClass(w);
      if ((u && (u === cls || cls === null)) || CONTEXT_STOP.has(w)) continue;
      if (languages.some((l) => readNumberWords(w, l).numbers.length > 0)) break;
      out.push(w);
    }
    return out;
  };
  const push = (v: string, c: string | null, i: number) => { pairs.push([v, c]); ctxs.push(ctxBefore(i, c)); };
  const isNumberTok = (t: string | undefined) => !!t && (/^\d/.test(t) || languages.some((l) => readNumberWords(t, l).numbers.length > 0));
  // The unit right after a number, or one or two words on ("2 bisacodyl tablets"), never past another number.
  const unitAfter = (i: number): string | null => {
    for (let k = i + 1; k <= i + 3 && k < toks.length; k++) {
      const c = unitClass(toks[k]);
      if (c) return c;
      if (isNumberTok(toks[k])) return null;
    }
    return null;
  };
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    const next = toks[i + 1];
    if (/^\d{1,2}:\d{2}$/.test(tok) || /^\d{3}[-.]\d{3}[-.]\d{4}$/.test(tok)) {
      // A clock time's hour is a "clock" number; its minutes, and a phone number's groups, never need lining up.
      tok.split(/[:.-]/).forEach((part, k) => { found.add(part); push(part, tok.includes(":") ? (k === 0 ? "clock" : "clockmin") : "phone", i); });
      continue;
    }
    if (HALF_WORD_ONE.test(tok) || QUARTER_WORD_ONE.test(tok)) {
      const v = HALF_WORD_ONE.test(tok) ? "1/2" : "1/4";
      found.add(v);
      push(v, unitAfter(i) ?? "portion", i);
      continue;
    }
    let value: string | null = null;
    let cls: string | null = null;
    if (/^\d+(?:st|nd|rd|th)$/i.test(tok)) {
      value = tok.replace(/\D+$/, "");
      cls = "ordinal";
    } else if (/^\d/.test(tok)) {
      value = tok.replace(/\s+/g, "").replace(/[⁄∕]/gu, "/").replace(/,(?=\d{3}\b)/g, "");
      cls = unitAfter(i);
    } else if (/^(?:once|twice)$/i.test(tok)) {
      value = /^once$/i.test(tok) ? "1" : "2";
      cls = "times";
    } else {
      // The "a" of "once a day" or "half a tablet" is not a number (numberWords.ts reads it with the word before).
      if (/^an?$/i.test(tok) && /^(?:once|twice|times?|half|quarter|per|every|each|and)$/i.test(toks[i - 1] ?? "")) continue;
      // "vitamin A", "Class A": a name, not 1 (Codex round 10).
      if (/^an?$/i.test(tok) && NAME_BEFORE_LETTER.test((toks[i - 1] ?? "").toLowerCase())) continue;
      for (const lang of languages) {
        const both = readNumberWords(`${tok} ${next ?? ""}`, lang).numbers;
        if (both.length === 1 && readNumberWords(next ?? "", lang).numbers.length === 0) { value = both[0]; break; }
      }
      if (value !== null) cls = unitAfter(i);
    }
    if (value === null) continue;
    found.add(value);
    push(value, cls, i);
  }
  return { pairs, ctxs, found };
}

/**
 * True when the quote names two or more different numbers and the explanation's numbers can't each be matched to the
 * same number WITH THE SAME UNIT in the quote. "2 puffs every 4 hours" read as "4 puffs every 2 hours" has the same
 * set of numbers, so the set check alone passes it (Codex round 6). A number in the explanation with no unit we
 * know, or one we could not place (a number word in Chinese or Korean, a compound like "twenty-four"), also counts:
 * we can't tell which quantity it is, so the step is not certified.
 */
function unitsSwapped(quoteTexts: string[], plain: string, plainNumbers: Set<string>, languages: NumberLanguage[]): boolean {
  const qRead = quoteTexts.map((t) => numberUnits(t, ["English", ...languages.filter((l) => l !== "English")]));
  const q = qRead.flatMap((r) => r.pairs);
  const qCtx = qRead.flatMap((r) => r.ctxs);
  if (new Set(q.map(([n]) => n)).size < 2 || plainNumbers.size === 0) return false;
  const p = numberUnits(plain, languages);
  if ([...plainNumbers].some((n) => !p.found.has(n))) return true;
  // Only the numbers the caller counts ("one of the lab locations" is not a quantity on the care-plan path).
  const keep = p.pairs.map(([n]) => plainNumbers.has(n));
  const pCtx = p.ctxs.filter((_, k) => keep[k]);
  p.pairs = p.pairs.filter((_, k) => keep[k]);
  // When the quote gives one kind of unit two different values ("warfarin 2 mg and vitamin K 5 mg"), a number in the
  // explanation must also share a naming word with the quote's same number, or the doses may have swapped places
  // between medicines (Codex round 7). Can't tell: not certified.
  const values = (c: string) => new Set(q.filter(([, qc]) => qc === c).map(([n]) => n));
  // Only a word that names ONE value counts ("lispro", not the shared "insulin" of "insulin glargine 10 units and
  // insulin lispro 5 units", Codex round 8), and the explanation's words must not name another value too.
  const namesOf = (n: string, c: string) => new Set(q.flatMap(([qn, qc], k) => (qn === n && qc === c ? qCtx[k] : [])));
  const aligned = (n: string, c: string, ctx: string[]) => {
    const others = [...values(c)].filter((v) => v !== n).map((v) => namesOf(v, c));
    const own = [...namesOf(n, c)].filter((w) => !others.some((o) => o.has(w)));
    const pointsElsewhere = ctx.some((w) => others.some((o) => o.has(w)) && !namesOf(n, c).has(w));
    return own.some((w) => ctx.includes(w)) && !pointsElsewhere;
  };
  const free = new Set(["clockmin", "phone"]);
  if (p.pairs.some(([n, c], k) => c !== null && !free.has(c) && values(c).size >= 2 && !aligned(n, c, pCtx[k]))) return true;
  const known = new Set(q.map(([n, c]) => `${n}|${c}`));
  // A number with no unit is fine only where the quote never gives that number a unit either ("100 Sample Street").
  // ...and only when the quote has a single unitless value, so two unitless numbers can't trade places (round 12).
  const unitlessValues = new Set(q.filter(([, c]) => c === null).map(([m]) => m));
  const unitless = (n: string) => unitlessValues.size < 2 && q.some(([m]) => m === n) && q.every(([m, c]) => m !== n || c === null);
  return p.pairs.some(([n, c]) => (c === null ? !unitless(n) : !known.has(`${n}|${c}`)));
}

/**
 * Deterministic signal for the care plan: numbers in the explanation that the quote (or when) does not contain.
 * A total the paper states elsewhere in the same quote is fine; an invented dose or interval is not.
 * Digits and fractions always count. Number words count too when the explanation's language is given and is not
 * English ("Tome tres tabletas" against "Take 2 tablets"); English words stay out on this path, as before, because
 * "one of the lab locations" is not a dose (the second model covers English words). `uncheckable` (numeral text that
 * can't be read, a whole number plus a fraction, or any Amharic explanation) means it can never be certified.
 */
export function numberCheck(item: NumItem, language?: NumberLanguage): NumberCheck {
  const q = quoteNumbers(item, language);
  const f = fractionsIn(item.plain_language);
  const plain = language && language !== "English" ? readNumberWords(f.rest, language) : null;
  const foreignDigits = readNumberWords(item.plain_language.replace(/\p{L}/gu, " "), "English").uncheckable;
  const counted = new Set([...f.values, ...digitsIn(f.rest), ...(plain?.numbers ?? [])]);
  const unexpected = [...counted].filter((n) => !q.allowed.has(n));
  // English number words stay out of `unexpected` (see above). But an English word WITH a unit after it ("four
  // puffs", "twice") is a quantity: if the quote doesn't have that number, or it sits on another unit, the step is
  // not certified (Codex round 6).
  const english = !language || language === "English";
  const langs: NumberLanguage[] = english ? ["English"] : language === "Amharic" ? [] : [language];
  const wordQty = english ? numberUnits(f.rest, ["English"]).pairs.filter(([n, c]) => c !== null && !counted.has(n)).map(([n]) => n) : [];
  // Any English number word the quote doesn't have ("three Tylenol" against "two Tylenol") blocks the green check,
  // unit or no unit (Codex round 13). It is not flagged, since "one of the lab locations" is not a dose.
  const enWords = english ? readNumberWords(f.rest, "English") : null;
  const wordsOff = wordQty.some((n) => !q.allowed.has(n)) || !!enWords?.numbers.some((n) => !q.allowed.has(n)) || !!enWords?.uncheckable;
  const swapped = unexpected.length === 0 && unitsSwapped([item.source_quote, item.when ?? ""], item.plain_language, new Set([...counted, ...wordQty]), langs);
  return { unexpected, uncheckable: language === "Amharic" || q.uncheckable || foreignDigits || !!plain?.uncheckable || f.mixed || swapped || wordsOff };
}
export const unexpectedNumbers = (item: NumItem, language?: NumberLanguage): string[] => numberCheck(item, language).unexpected;

/**
 * Stricter form for prep mode: digits, fractions AND number words (English, and the explanation's language) in the
 * explanation must be in the quote, as digits or words. "Take four tablets" or "Tome cuatro tabletas" against "Take 2
 * tablets" is caught; "two" or "dos" against "2" is fine. Numeral text that can't be read makes it uncheckable, which
 * blocks it.
 */
export function numberCheckAnyForm(item: NumItem, language: NumberLanguage = "English"): NumberCheck {
  const q = quoteNumbers(item, language);
  const f = fractionsIn(item.plain_language);
  const en = readNumberWords(f.rest, "English");
  const own = language === "English" ? en : readNumberWords(f.rest, language);
  const inPlain = new Set([...f.values, ...numbersIn(f.rest), ...en.numbers, ...own.numbers]);
  const unexpected = [...inPlain].filter((n) => !q.allowed.has(n));
  const langs: NumberLanguage[] = language === "English" || language === "Amharic" ? ["English"] : ["English", language];
  const swapped = unexpected.length === 0 && unitsSwapped([item.source_quote, item.when ?? ""], item.plain_language, inPlain, langs);
  return { unexpected, uncheckable: q.uncheckable || own.uncheckable || (language === "English" && en.uncheckable) || f.mixed || swapped };
}
export const unexpectedNumbersAnyForm = (item: NumItem, language: NumberLanguage = "English"): string[] => numberCheckAnyForm(item, language).unexpected;

const ModelOutput = z.object({
  results: z.array(z.object({ id: z.string(), verdict: z.enum(["same", "different", "unclear"]), what_differs: z.string() })),
});

const SYSTEM = `You check a patient-facing explanation against the exact line it came from in their after-visit paper.
The person sees three things together: the explanation, the "when" text, and the line from the paper itself. Judge the explanation plus "when" against the line.
Compare ONLY: the action (start, stop, take, avoid, call, go), the medicine or test, the amount or dose, how often, the condition for doing it (for example "as needed for wheezing"), when or how long, and who must act.
- "different": a point above is changed, reversed, or dropped in a way that could make the person do the wrong thing. You must be able to name the exact words in the line and the exact words in the explanation that clash. Put them in what_differs as: paper says "..." but explanation says "..." (or: explanation leaves out "...").
- "same": nothing above clashes. Simpler words, another language, added reasons, and a detail that appears in the "when" text are all fine.
- "unclear": you are not sure. Prefer "unclear" over guessing "different".
Do not invent words that are not in the line. Never judge whether the medical advice is good.`;

export function combine(id: string, item: MeaningRequest["items"][number], verdict: MeaningResult["model_verdict"], what: string, language?: NumberLanguage): MeaningResult {
  const { unexpected, uncheckable } = numberCheck(item, language);
  // Whatever the second model said: a dropped or added "do not", or a time, frequency or action the paper's line
  // doesn't name, never gets the green check (semanticGuard.ts, Codex round 13).
  const blocked = certifyBlocker(`${item.source_quote} ${item.when ?? ""}`, item.plain_language) !== null;
  // An explanation whose numbers can't be read is never certified; with no clash found it shows as "couldn't check".
  return {
    id,
    numbers_ok: unexpected.length === 0,
    unexpected_numbers: unexpected,
    model_verdict: verdict,
    what_differs: verdict === "same" ? "" : what,
    flagged: unexpected.length > 0 || verdict === "different",
    // "unclear", or a step the checker skipped, is neither flagged nor certified: the UI says it could not double-check it.
    certified: verdict === "same" && unexpected.length === 0 && !uncheckable && !blocked,
  };
}

export async function checkMeaning(req: MeaningRequest): Promise<MeaningResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ExtractError("Server is missing its AI key. Tell the ATLAS team.", 503);
  const client = new Anthropic({ apiKey });
  const t0 = Date.now();
  const msg = await client.messages.parse({
    model: CHECKER_MODEL,
    max_tokens: 6000,
    system: SYSTEM,
    output_config: { effort: "low", format: zodOutputFormat(ModelOutput) },
    messages: [{
      role: "user",
      content: JSON.stringify(req.items.map((i) => ({ id: i.id, line_from_paper: i.source_quote, when: i.when, explanation: i.plain_language }))),
    }],
  });
  if (msg.stop_reason === "refusal") throw new ExtractError("The checker declined this request.", 422);
  const parsed = ModelOutput.safeParse(msg.parsed_output);
  if (!parsed.success) throw new ExtractError("The checker returned a malformed answer. Try again.", 502);
  const byId = new Map(parsed.data.results.map((r) => [r.id, r]));
  // An item the model skipped counts as unclear, never as checked.
  const results = req.items.map((i) => {
    const r = byId.get(i.id);
    return combine(i.id, i, r?.verdict ?? "unclear", r?.what_differs ?? "The checker did not return this step.", req.language);
  });
  return { results, flagged: results.filter((r) => r.flagged).length, checker_model: CHECKER_MODEL, ms: Date.now() - t0 };
}
