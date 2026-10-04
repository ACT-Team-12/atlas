/**
 * Which steps are pinned as warning signs. Pure, no AI, safe in the browser.
 *
 * The model's kind may only ADD caution: a step it labels "warning_sign" is pinned, and so is any step whose own quote
 * from the paper carries warning language (call 911, the emergency room, seek care, chest pain, trouble breathing...),
 * whatever kind the model gave it. A mislabeled "self_care" that says "go to the emergency room" is never hidden in a
 * time group. English and Spanish words, read from the paper's quote only.
 */

/** A whole-word pattern with letter-aware edges ("días", "atención"). */
const word = (src: string, flags = "iu") => new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${src})(?![\p{L}\p{N}])`, flags);
const S = String.raw`\s+`;

const WARNING_WORDS = word(
  [
    String.raw`911`,
    String.raw`emergency${S}(?:room|department|services|care)|emergencies|emergency`,
    String.raw`urgent${S}care|go${S}to${S}the${S}(?:nearest${S})?hospital`,
    String.raw`seek${S}(?:\p{L}+${S})?(?:care|help|attention|treatment)|get${S}(?:medical${S})?help${S}(?:right${S}away|now|immediately)`,
    String.raw`call${S}(?:(?:the|your|our)${S})?(?:\p{L}+['’]s${S})?(?:office|clinic|doctor|physician|provider|nurse|care${S}team)${S}(?:right${S}away|immediately|at${S}once|now)`,
    String.raw`chest${S}(?:pain|pressure|tightness)`,
    String.raw`(?:trouble|difficulty|hard)${S}breathing|short(?:ness)?${S}of${S}breath|can(?:no|['’])t${S}breathe|cannot${S}breathe`,
    String.raw`faint(?:ing|ed)|feel(?:s|ing)?${S}faint|pass(?:ing)?${S}out|seizures?|stroke`,
    String.raw`sudden${S}(?:weakness|numbness|confusion)|severe${S}(?:bleeding|pain|headache|allergic)|suicid\p{L}*`,
    // Spanish
    String.raw`llame${S}al${S}911|sala${S}de${S}emergencias?|emergencias?|urgencias|vaya${S}al${S}hospital`,
    String.raw`busque${S}(?:atenci[oó]n|ayuda)|dolor${S}(?:de|en${S}el)${S}pecho|dificultad${S}para${S}respirar|falta${S}de${S}aire|desmay\p{L}*|convulsi\p{L}*`,
  ].join("|"),
);
/** Emergency words said NOT to apply: "not an emergency", "non-emergency", "no es una emergencia". */
const NOT_EMERGENCY = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:not${S}(?:an${S}|a${S})?|non-?|no${S}es${S}(?:una${S})?)(?:emergency|emergencia|urgent)(?![\p{L}\p{N}])`, "giu");
/** "ER" only in capitals: "er" is part of too many words and names. */
const ER = word("ER", "u");

/** True when the paper's own words in this quote are warning language. */
export function warningFromPaper(quote: string): boolean {
  // "This is not an emergency" is not warning language; any other warning words in the quote still count.
  const t = quote.replace(/\s+/g, " ").replace(NOT_EMERGENCY, " ");
  return WARNING_WORDS.test(t) || ER.test(t);
}

/** Pinned as a warning sign: the model said so, or the paper's quote does. Never removed by the model's kind. */
export const isWarning = (it: { kind: string; source_quote: string }) => it.kind === "warning_sign" || warningFromPaper(it.source_quote);

/**
 * The patterns above, exported only so mobile/shared/safety-vectors.json can carry their exact source: the iOS and
 * Android ports keep the same pattern text and their tests fail if it drifts from this file.
 */
export const WARNING_PATTERNS = { WARNING_WORDS, NOT_EMERGENCY, ER } as const;
