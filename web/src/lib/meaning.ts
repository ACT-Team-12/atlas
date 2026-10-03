import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ExtractError } from "./extract";
import { LANGUAGES } from "./schema";
import { readNumberWords, type NumberLanguage } from "./numberWords";

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
  const unexpected = [...new Set([...f.values, ...digitsIn(f.rest), ...(plain?.numbers ?? [])])].filter((n) => !q.allowed.has(n));
  return { unexpected, uncheckable: language === "Amharic" || q.uncheckable || foreignDigits || !!plain?.uncheckable || f.mixed };
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
  return { unexpected: [...inPlain].filter((n) => !q.allowed.has(n)), uncheckable: q.uncheckable || own.uncheckable || (language === "English" && en.uncheckable) || f.mixed };
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
  // An explanation whose numbers can't be read is never certified; with no clash found it shows as "couldn't check".
  return {
    id,
    numbers_ok: unexpected.length === 0,
    unexpected_numbers: unexpected,
    model_verdict: verdict,
    what_differs: verdict === "same" ? "" : what,
    flagged: unexpected.length > 0 || verdict === "different",
    // "unclear", or a step the checker skipped, is neither flagged nor certified: the UI says it could not double-check it.
    certified: verdict === "same" && unexpected.length === 0 && !uncheckable,
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
