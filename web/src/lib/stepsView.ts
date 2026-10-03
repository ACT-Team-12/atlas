/**
 * "Your steps", grouped by when (Akhil's concept A). Pure functions, no AI, safe in the browser.
 *
 * The paper-first rule (paperFirst.ts) decides what a closed step row may say:
 *
 * - Certified (the second check said "same"): the row leads with the AI's short title and its "when", e.g.
 *   "Stop taking ibuprofen · Stop now".
 * - Anything else (still checking, flagged, check failed, never checked): the row shows the PAPER's own words,
 *   shortened at a word boundary and marked as the paper's, and never the AI's title or "when".
 *
 * Time groups follow the same rule. A step is placed by the time words inside its own verified quote from the paper.
 * Only a certified step may fall back to the AI's "when" when its quote names no time. An uncertified step whose quote
 * names no time (or names two that disagree) goes under "Check the date on your paper". Nothing is guessed.
 */

import { type Check } from "./paperFirst";

export const WHEN_GROUPS = ["today", "soon", "daily", "later", "unclear"] as const;
export type WhenGroup = (typeof WHEN_GROUPS)[number];

export const WHEN_GROUP_LABEL: Record<WhenGroup, string> = {
  // Counted from the paper (the visit), not from the day a saved plan is reopened: no heading says "today" about a
  // paper that may be weeks old (Codex review).
  today: "Right away",
  soon: "Within about 2 weeks",
  daily: "Every day or every week",
  later: "Later (weeks or months away)",
  unclear: "Check the date on your paper",
};

export type TextWhen = {
  group: WhenGroup;
  /** The time words exactly as written, in the order they appear. Empty when nothing was found. */
  words: string[];
};

/** Number words a paper may use for a count, English and Spanish. "a"/"an"/"un"/"una" mean one ("in a week"). */
const NUM_WORDS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  fourteen: 14, fifteen: 15, twenty: 20, thirty: 30,
  un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  catorce: 14, quince: 15, veinte: 20, treinta: 30,
};
const NUM = String.raw`(\d{1,3}|${Object.keys(NUM_WORDS).sort((a, b) => b.length - a.length).join("|")})`;
const toNum = (s: string) => (/^\d+$/.test(s) ? Number(s) : NUM_WORDS[s.toLowerCase()] ?? NaN);

/** A whole-word pattern. JavaScript's \b only knows ASCII letters, so "días" and "mañana" need letter-aware edges. */
const word = (src: string) => new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${src})(?![\p{L}\p{N}])`, "giu");

const S = String.raw`\s+`;
const DAY_UNIT = String.raw`(days?|d[ií]as?|weeks?|semanas?)`;
const LONG_UNIT = String.raw`(months?|mes|meses|years?|a[nñ]os?)`;
/** "within", "in", "in the next", "dentro de", "en los próximos": a moment ahead, never a length ("for 2 weeks"). */
const AHEAD = String.raw`(?:within|in|after|in${S}the${S}next|over${S}the${S}next|during${S}the${S}next|due${S}in|dentro${S}de|en|en${S}l[oa]s${S}pr[oó]xim[oa]s|despu[eé]s${S}de)`;

/** Letters English and Spanish never use (Portuguese, French...): a shared phrase like "esta tarde" is not read there. */
const OTHER_LATIN = /[ãõçâêôàèùûëïœ]/iu;
/** A negation earlier in the same clause: "Do not start this medicine today" is never placed under "Right away". */
const NEGATION = /(?<![\p{L}])(?:not|\p{L}+n['’]t|never|no|nunca|ni|tampoco)(?![\p{L}])/iu;

type Rule = { group: WhenGroup | ((m: RegExpMatchArray) => WhenGroup | null); re: RegExp };

const RULES: Rule[] = [
  // Today: now, today, tonight, right away.
  { group: "today", re: word(String.raw`today|tonight|right${S}now|now|right${S}away|immediately|this${S}(?:morning|afternoon|evening)`) },
  { group: "today", re: word(String.raw`hoy|ahora${S}mismo|ahora|de${S}inmediato|inmediatamente|enseguida|esta${S}(?:noche|tarde|ma[nñ]ana)`) },
  // A count of days or weeks ahead: up to 14 days is the next 2 weeks, more is later on.
  {
    group: (m) => {
      const n = toNum(m[1]);
      if (!Number.isFinite(n) || n < 1) return null;
      const days = /^(?:w|s)/i.test(m[2]) ? n * 7 : n;
      return days <= 14 ? "soon" : "later";
    },
    re: word(String.raw`${AHEAD}${S}${NUM}${S}${DAY_UNIT}`),
  },
  { group: "soon", re: word(String.raw`tomorrow|this${S}week|next${S}week|in${S}a${S}few${S}days|within${S}a${S}few${S}days`) },
  { group: "soon", re: word(String.raw`esta${S}semana|la${S}pr[oó]xima${S}semana|la${S}semana${S}que${S}viene|en${S}unos${S}d[ií]as`) },
  // Months or years ahead.
  { group: "later", re: word(String.raw`${AHEAD}${S}${NUM}${S}${LONG_UNIT}`) },
  { group: "later", re: word(String.raw`next${S}(?:month|year)|every${S}${NUM}${S}(?:months|years)|el${S}pr[oó]ximo${S}(?:mes|a[nñ]o)|el${S}(?:mes|a[nñ]o)${S}que${S}viene|cada${S}${NUM}${S}(?:meses|a[nñ]os)`) },
  // Again and again: every day, every morning, twice a day, 5 days a week, weekly.
  {
    group: "daily",
    re: word(String.raw`daily|nightly|weekly|every${S}(?:day|morning|night|evening|afternoon|week)|each${S}(?:day|morning|night|evening|week)|at${S}bedtime|once${S}a${S}(?:day|week)|twice${S}a${S}(?:day|week)|${NUM}${S}times?${S}(?:a|per|each)${S}(?:day|week)|${NUM}${S}times${S}daily|${NUM}${S}days?${S}(?:a|per|each)${S}week|every${S}${NUM}${S}(?:hours|days|weeks)|(?:a|per)${S}day`),
  },
  {
    group: "daily",
    re: word(String.raw`diario|diaria|diariamente|semanalmente|cada${S}(?:d[ií]a|ma[nñ]ana|noche|tarde|semana)|todos${S}los${S}d[ií]as|todas${S}las${S}(?:ma[nñ]anas|noches|tardes)|al${S}acostarse|una${S}vez${S}al${S}d[ií]a|dos${S}veces${S}al${S}d[ií]a|${NUM}${S}veces${S}(?:al|por)${S}(?:d[ií]a|semana)|${NUM}${S}d[ií]as${S}(?:a|por)${S}(?:la${S})?semana|cada${S}${NUM}${S}(?:horas|d[ií]as|semanas)|(?:al|por)${S}d[ií]a`),
  },
];

/**
 * Reads which time group a piece of text names, from its own words only. English and Spanish time words; any other
 * language finds nothing and lands in "unclear". Two groups that disagree ("in 10 days ... in 3 months") are "unclear"
 * too, except "today" with "every day" ("Starting today, take it every morning"), which is "today".
 */
export function whenFromText(text: string): TextWhen {
  const t = text.replace(/\s+/g, " ");
  if (OTHER_LATIN.test(t)) return { group: "unclear", words: [] };
  const hits: { group: WhenGroup; text: string; at: number }[] = [];
  for (const rule of RULES) {
    for (const m of t.matchAll(rule.re)) {
      const g = typeof rule.group === "function" ? rule.group(m) : rule.group;
      if (g) hits.push({ group: g, text: m[0], at: m.index ?? 0 });
    }
  }
  // A phrase inside a longer one is the same words ("now" inside "right now"): keep the longer.
  const kept = hits
    .sort((a, b) => a.at - b.at || b.text.length - a.text.length)
    .filter((h, i, all) => !all.some((o, j) => j !== i && o.at <= h.at && o.at + o.text.length >= h.at + h.text.length && o.text.length > h.text.length));
  const words = [...new Set(kept.map((h) => h.text))];
  if (kept.some((h) => NEGATION.test(t.slice(0, h.at).split(/[.;:!?]/).pop() ?? ""))) return { group: "unclear", words };
  const groups = new Set(kept.map((h) => h.group));
  if (groups.size === 0) return { group: "unclear", words: [] };
  if (groups.size === 1) return { group: [...groups][0], words };
  if (groups.size === 2 && groups.has("today") && groups.has("daily")) return { group: "today", words };
  return { group: "unclear", words };
}

export type StepWhen = TextWhen & {
  /** Where the group came from: the paper's own words, the AI's "when" (certified steps only), or nowhere. */
  from: "paper" | "explanation" | "none";
};

/**
 * The time group for one care step. The paper's quote decides. Only a certified step may fall back to its AI "when",
 * and only when the quote names no time at all; an uncertified step is never placed by the AI's words.
 */
export function stepWhen(it: { source_quote: string; when: string }, check: Check): StepWhen {
  const paper = whenFromText(it.source_quote);
  if (paper.group !== "unclear") return { ...paper, from: "paper" };
  if (check === "certified" && paper.words.length === 0 && it.when.trim()) {
    const ai = whenFromText(it.when);
    if (ai.group !== "unclear") return { group: ai.group, words: [], from: "explanation" };
  }
  return { group: "unclear", words: paper.words, from: paper.words.length ? "paper" : "none" };
}

/** The paper's words, shortened at a word boundary with an ellipsis. Whole words only, never a cut word. */
export function shortQuote(quote: string, max = 72): string {
  const t = quote.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  // The last space that keeps it within max; a first word longer than max is kept whole.
  let at = t.slice(0, max + 1).lastIndexOf(" ");
  if (at <= 0) at = t.indexOf(" ", max);
  if (at < 0) return t;
  const head = t.slice(0, at).replace(/[\s,;:.\-\u2013(]+$/u, "");
  return `${head}…`;
}

/** What a closed row shows. Only the certified kind carries any AI-written words. */
export type ClosedRow =
  | { lead: "explanation"; title: string; when: string }
  | { lead: "quote"; quote: string; full: boolean; paperWhen: string[] };

/**
 * The closed row for one step. `full` keeps the whole quote (warning signs are never shortened: the part that says
 * "call 911" must not fall behind an ellipsis).
 */
export function closedRow(it: { title: string; when: string; source_quote: string }, check: Check, opts: { full?: boolean } = {}): ClosedRow {
  if (check === "certified" && it.title.trim()) return { lead: "explanation", title: it.title.trim(), when: it.when.trim() };
  const full = !!opts.full;
  return { lead: "quote", quote: full ? it.source_quote.replace(/\s+/g, " ").trim() : shortQuote(it.source_quote), full, paperWhen: whenFromText(it.source_quote).words };
}

/** One seal per step: the device check, the meaning check and the caveat label folded into one state. */
export type Seal = "twice" | "once" | "recheck";

export function sealOf(check: Check): Seal {
  return check === "certified" ? "twice" : check === "flagged" ? "recheck" : "once";
}

export const SEAL_TEXT: Record<Seal, string> = {
  twice: "Checked twice: the words are on your paper, and a second check agrees with the explanation.",
  once: "Checked once: the words are on your paper. The explanation was not double-checked, so trust your paper's words.",
  recheck: "Double-check this one: the words are on your paper, but a check disagreed. Follow your paper.",
};

export const SEAL_SHORT: Record<Seal, string> = { twice: "Checked twice", once: "Checked once", recheck: "Double-check this" };
