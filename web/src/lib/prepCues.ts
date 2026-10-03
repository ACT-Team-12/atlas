import type { LANGUAGES } from "./schema";

type Lang = (typeof LANGUAGES)[number];

/**
 * A rule in code, not AI: a plain-words explanation must keep its paper line's "do not" and its "until".
 *
 * The meaning check (a second model) can answer "same" for "Take insulin that morning" against "do not take it the
 * morning of your procedure". So before any explanation can be shown, our code compares two kinds of cue words:
 *
 * - "no": not, no, never, n't, nothing, without, stop, hold, avoid, skip, ... (a do-not or a stop);
 * - "limit": until, unless, except, only (a condition or a limit on the instruction).
 *
 * If the paper's line has a kind of cue the explanation lacks, or the explanation has one the line lacks, the
 * explanation is hidden. This is a necessary check, not a full one: "Take insulin, do not skip it" still has a "not"
 * and passes here, which is why the meaning check still has to certify it as well.
 *
 * Languages. Cue words are listed for English, Spanish, French, Vietnamese, Chinese and Korean, and a line is read with
 * all of them (a paper can be in any of these). Because a word list for another language can't be proved complete:
 * - an explanation in any language other than English is hidden whenever the paper's line has a cue word;
 * - Amharic explanations are always hidden, and so is any line or explanation in Ethiopic script, since Amharic marks
 *   "not" inside the verb and a word list can't see it.
 * A cue-free line with a non-English explanation is shown only when the explanation has no cue word either.
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
  // Spanish
  "nunca", "jamás", "jamas", "ni", "nada", "nadie", "ningún", "ningun", "ninguno", "ninguna", "tampoco", "sin",
  "deje", "dejar", "deja", "dejen", "suspenda", "suspender", "suspende", "suspendan", "pare", "parar", "detenga", "detener",
  "evite", "evitar", "evita", "eviten", "omita", "omitir", "omite",
  // French
  "ne", "pas", "jamais", "rien", "aucun", "aucune", "sans", "arrêtez", "arrêter", "arrête", "cessez", "cesser",
  "évitez", "éviter", "évite", "interrompez", "interrompre",
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

/** The full rule, used when the timeline is built and the explanation's language is known. True means hide it. */
export function negationBlocked(quote: string, plain: string, language: Lang): boolean {
  if (language === "Amharic") return true;
  if (cuesDiffer(quote, plain)) return true;
  if (language !== "English") {
    const q = cues(quote);
    if (q.no || q.limit) return true;
  }
  return false;
}
