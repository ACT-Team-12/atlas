/**
 * The language a paper is written in, as an HTML lang code, so a screen reader reads the paper's own words (never
 * translated) with the right voice. Covers the app's 7 languages; "" when it can't be told, which leaves the words
 * unmarked rather than marked wrong. Pure, no AI.
 *
 * Why its own detector: the missed-lines coverage check (lib/missedLines.ts, paperLanguages) only knows English and
 * Spanish and fails closed on everything else, which is right for that check and wrong here: a Korean or French paper
 * came out as "" and its quotes were read in the app's language (Codex review of PR 93, round 4).
 *
 * - Script first: Hangul is Korean, Ethiopic is Amharic, Han without kana is Chinese (kana means Japanese, not an app
 *   language, so ""). A paper counts as one script when that script is most of its letters; drug names and numbers
 *   in Latin letters on a Korean paper do not change it.
 * - Latin papers: Vietnamese by its tone and vowel marks; then French, Spanish or English by common words, only when
 *   one clearly leads (or, on a short line, when only one of them is there). A paper mixing two of them evenly is "".
 */
export type PaperLang = "en" | "es" | "fr" | "vi" | "ko" | "zh" | "am" | "";

const count = (s: string, re: RegExp) => s.match(re)?.length ?? 0;

/** Letters only Vietnamese uses among the app's Latin languages: ơ ư đ ă and the stacked or dot-below tone marks. */
const VIETNAMESE = /[ăđơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹĩũ]/giu;

// Common words, lowercase, accents kept. Words shared by two languages ("de", "que", "a", "en") are left out.
const EN = new Set("the and you your with for take if of to is this are be have has call day days daily each by at or from when every week weeks doctor medicine tablet mouth return before after".split(" "));
const ES = new Set("el los las del usted su sus con para una y por cada día días tome llame médico medicina tableta boca semana semanas antes después cuando es este esta".split(" "));
const FR = new Set("le les des du vous votre vos est avec pour dans une et au aux ne pas sur prenez appelez médecin médicament comprimé bouche semaine semaines avant après quand jour jours chaque".split(" "));

export function detectPaperLang(source: string): PaperLang {
  const text = source.normalize("NFC");
  const letters = count(text, /\p{L}/gu);
  if (letters === 0) return "";
  const share = (re: RegExp) => count(text, re) / letters;

  const kana = share(/[\p{Script=Hiragana}\p{Script=Katakana}]/gu);
  const hangul = share(/\p{Script=Hangul}/gu);
  const han = share(/\p{Script=Han}/gu);
  const ethiopic = share(/\p{Script=Ethiopic}/gu);
  if (kana > 0.05) return "";
  if (hangul > 0.5) return "ko";
  if (ethiopic > 0.5) return "am";
  if (han > 0.5) return "zh";
  if (share(/\p{Script=Latin}/gu) < 0.8) return "";

  const vi = count(text, VIETNAMESE);
  // Two of these letters already settle it: none of them occurs in English, Spanish or French (Codex round 5: a short
  // line such as "Uống 1 viên metformin mỗi ngày." has only two).
  if (vi >= 2 && vi / letters > 0.02) return "vi";

  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  const hits = { en: 0, es: 0, fr: 0 };
  for (const w of words) {
    if (EN.has(w)) hits.en++;
    if (ES.has(w)) hits.es++;
    if (FR.has(w)) hits.fr++;
  }
  const ranked = (Object.entries(hits) as ["en" | "es" | "fr", number][]).sort((a, b) => b[1] - a[1]);
  const [[best, top], [, second]] = ranked;
  // A long paper needs three common words and a clear lead; a short line (the app takes 20 characters) is enough
  // with two common words of one language and none of the others ("Take metformin at noon.").
  const clear = (top >= 3 && top >= second * 2) || (top >= 2 && second === 0);
  if (!clear) return "";
  return best;
}
