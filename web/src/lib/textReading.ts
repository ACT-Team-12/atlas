/**
 * One reading of text for every word list and number reader that decides a green check: the do-not and limit cues
 * (prepCues.ts), the time and action concepts (semanticGuard.ts) and the number readers (meaning.ts, numberWords.ts).
 * Two paths that read the same text differently are how a guard gets bypassed (security review of fix/certify-hardening),
 * so they all read it through here.
 *
 * - `readable`: Unicode compatibility form (fullwidth letters and digits, decomposed accents, ligatures), no-break
 *   spaces as spaces, curly apostrophes and quotes as straight ones, every dash as "-".
 * - `unreadable`: text no list here can be trusted to read. An invisible format character (zero-width space, soft
 *   hyphen, joiner) can split a word; a letter outside Latin, Chinese and Korean (Cyrillic or Greek look-alikes,
 *   Ethiopic, Thai, ...) is in no list, and a digit outside 0-9 is read differently by different readers. Checked on
 *   the text as written. Callers must treat it as "can't certify".
 *
 * Not used by the sentence scanner or the span checker: those return offsets into the paper itself, so they must read
 * the raw text. A step whose text is unreadable is never certified, whatever they find.
 *
 * Pure functions. Safe to import in the browser.
 */

export function readable(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[   ]/g, " ")
    .replace(/[‘’‛′ʼ＇]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/[‐-―−]/g, "-");
}

export function unreadable(text: string): boolean {
  // ...or a digit that isn't 0-9 ("½", fullwidth "２", Arabic-Indic "٣", "²"): NFKC would quietly turn it into a
  // different number of characters, so it is refused rather than read.
  return /\p{Cf}/u.test(text) || /(?![\p{Script=Latin}\p{Script=Han}\p{Script=Hangul}])\p{L}/u.test(text) || /[^\P{N}0-9〇]/u.test(text);
}
