import type { LANGUAGES } from "./schema";

type Lang = (typeof LANGUAGES)[number];

/**
 * A rule in code, not AI: no plain-words explanation is shown for a line that says "do not", "stop" or "until".
 *
 * The meaning check (a second model) can answer "same" for "Take insulin that morning" against "do not take it the
 * morning of your procedure". Comparing cue words is not enough either: "Take insulin unless your doctor says not to"
 * keeps both the "not" and the "unless" of "do not take insulin unless your doctor told you to" and still reverses it.
 * So prep mode fails closed on two kinds of cue words:
 *
 * - "no": not, no, never, n't, nothing, without, stop, hold, avoid, skip, fast, omit, ... (a do-not or a stop);
 * - "limit": until, unless, except, only (a condition or a limit on the instruction).
 *
 * If the paper's sentence has any cue word, its explanation is never shown: the person reads the paper's own
 * sentence. If the sentence has none and the explanation has one (an added "do not"), the explanation is hidden too.
 * Only an explanation with no cue word, of a sentence with no cue word, can be shown, and still only after the meaning
 * check certifies it.
 *
 * Languages. Cue words are listed for English, Spanish, French, Vietnamese, Chinese and Korean, and every text is
 * read with all of them (a paper can be in any of these). Amharic explanations are always hidden, and so is any line
 * or explanation in Ethiopic script, since Amharic marks "not" inside the verb and a word list can't see it.
 *
 * Pure functions, no network. Safe to import in the browser.
 */

export type Cues = { no: boolean; limit: boolean };

// Letters and digits in any script; a Latin cue word must not touch one on either side ("note" is not "not").
const W = (words: string[]) => new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${words.join("|")})(?![\p{L}\p{N}])`, "iu");

const NO_WORDS = W([
  // English
  "not", "no", "never", "cannot", "nothing", "none", "nobody", "neither", "nor", "without",
  "stop", "stops", "stopped", "stopping", "hold", "holds", "holding", "held", "avoid", "avoids", "avoiding",
  "skip", "skips", "skipping", "skipped", "refrain", "discontinue", "discontinued", "quit", "cease", "withhold", "npo", "nil",
  "fast", "fasts", "fasting", "fasted", "omit", "omits", "omitting", "omitted", "withheld", "withholding", "pause",
  "pauses", "paused", "pausing", "suspend", "suspends", "suspended", "suspending", "abstain", "abstaining", "exclude",
  "avoided", "prohibit", "prohibits", "prohibited", "contraindicated", "contraindication", "forbid", "forbids",
  "forbidden", "ban", "banned", "disallowed", "restrict", "restricted", "restriction", "withdraw", "withdrawn",
  "ceased", "quitting", "refrained", "excluded", "unsafe",
  // Spanish
  "nunca", "jamás", "jamas", "ni", "nada", "nadie", "ningún", "ningun", "ninguno", "ninguna", "tampoco", "sin",
  "deje", "dejar", "deja", "dejen", "suspenda", "suspender", "suspende", "suspendan", "pare", "parar", "detenga", "detener",
  "evite", "evitar", "evita", "eviten", "omita", "omitir", "omite", "ayuno", "ayunas", "ayunar", "ayune",
  "prohibido", "prohibida", "prohíbe", "contraindicado", "contraindicada", "evitarse", "evitado", "suspendido",
  // French
  "ne", "pas", "jamais", "rien", "aucun", "aucune", "sans", "arrêtez", "arrêter", "arrête", "cessez", "cesser",
  "évitez", "éviter", "évite", "interrompez", "interrompre", "jeûne", "jeûner", "jeûnez", "à jeun", "omettez", "omettre",
  "interdit", "interdite", "interdits", "contre-indiqué", "contre-indiquée", "déconseillé", "déconseillée", "évité",
  // Vietnamese
  "không", "đừng", "chớ", "ngừng", "ngưng", "dừng", "tránh", "cấm", "chưa", "bỏ", "nhịn",
]);
/** "don't", "can't", "isn't" (English) and "n'oubliez", "n'est" (French). */
const NO_CONTRACTIONS = /n['’]t(?!\p{L})|(?<!\p{L})n['’](?=\p{L})/iu;
/** Chinese and Korean negation and stop words, matched anywhere (these scripts have no spaces between words). */
const NO_CJK = /[不别別勿没沒无無未停禁免避莫戒忌]|않|말고|마세요|마십시오|말아|말것|금지|중단|멈추|멈춰|끊|없|금식|피하|피해|삼가|(?:^|[\s,.])(?:안|못)\s|못하/u;

const LIMIT_WORDS = W([
  // English
  "until", "till", "unless", "except", "excepting", "only",
  // Spanish
  "hasta", "salvo", "excepto", "a menos que", "solo", "sólo", "solamente", "únicamente", "unicamente",
  // French
  "sauf", "excepté", "jusqu", "jusque", "à moins", "seulement", "uniquement",
  // Vietnamese
  "trừ", "cho đến", "đến khi", "chỉ",
]);
const LIMIT_CJK = /直到|除|只|仅|僅|까지|제외|외에는/u;

/** Ethiopic script (Amharic, Tigrinya): "not" is part of the verb, so no word list can find it. */
const ETHIOPIC = /[ሀ-᎟ⶀ-⷟꬀-꬯]/u;

export function cues(text: string): Cues {
  return {
    no: NO_WORDS.test(text) || NO_CONTRACTIONS.test(text) || NO_CJK.test(text),
    limit: LIMIT_WORDS.test(text) || LIMIT_CJK.test(text),
  };
}

/**
 * True when the explanation does not keep the line's cue words, in either direction, or when the words can't be
 * read at all (Ethiopic script). Language-free, so the page can re-check any step it is about to show.
 */
export function cuesDiffer(quote: string, plain: string): boolean {
  if (ETHIOPIC.test(quote) || ETHIOPIC.test(plain)) return true;
  const q = cues(quote);
  const p = cues(plain);
  return q.no !== p.no || q.limit !== p.limit;
}

/**
 * True when no explanation may be shown for this sentence: it, or the explanation, has a cue word, or either is in
 * Ethiopic script. Language-free, so the page re-checks every step it is about to show (prepView.ts).
 */
export function cuesForbid(quote: string, plain: string): boolean {
  if (ETHIOPIC.test(quote) || ETHIOPIC.test(plain)) return true;
  const q = cues(quote);
  const p = cues(plain);
  return q.no || q.limit || p.no || p.limit;
}

/** The full rule, used when the timeline is built and the explanation's language is known. True means hide it. */
export function negationBlocked(quote: string, plain: string, language: Lang): boolean {
  return language === "Amharic" || cuesForbid(quote, plain);
}
