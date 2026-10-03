/**
 * "Say your answer": which of the quiz's three options did the person say? No AI, runs in the browser.
 *
 * The quiz is still graded exactly as before (the option they land on goes through the same tap path). This only
 * decides which option a spoken or typed answer names, and it refuses to guess: a number in an option must be in
 * what they said, "not" must agree, and the best option must clearly beat the next. Otherwise it returns null and
 * the page asks them to tap the answer closest to what they said.
 */

const WORD_NUM: Record<string, string> = {
  one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", once: "1", twice: "2",
  uno: "1", una: "1", dos: "2", tres: "3", cuatro: "4", cinco: "5", seis: "6", siete: "7", ocho: "8", nueve: "9", diez: "10",
  un: "1", une: "1", deux: "2", trois: "3", quatre: "4", cinq: "5", sept: "7", huit: "8", neuf: "9", dix: "10",
};
// Negation words in our languages. A spoken "don't" against an option without one (or the reverse) never matches.
const NEGATION = new Set(["not", "no", "never", "dont", "doesnt", "nunca", "ne", "pas", "jamais", "không", "đừng", "chớ", "안", "못", "말고", "마세요", "않"]);
const CJK_NEG = /[不别没勿]/;
const CJK = /[぀-ヿ㐀-鿿]/;

export function normalize(s: string): string {
  return s.normalize("NFKC").toLowerCase()
    .replace(/n['’]t\b/g, " not")
    .replace(/(\d)\s*\/\s*(\d)/g, "$1/$2")
    .replace(/[^\p{L}\p{N}\p{M}/\s]/gu, " ")
    .replace(/\s+/g, " ").trim();
}

export function numbers(s: string): Set<string> {
  const n = normalize(s);
  const out = new Set<string>((n.match(/\d+(?:\/\d+)?/g) ?? []).map((x) => x.replace(/^0+(?=\d)/, "")));
  for (const w of n.split(" ")) if (WORD_NUM[w]) out.add(WORD_NUM[w]);
  return out;
}

function tokens(s: string): string[] {
  const n = normalize(s);
  if (CJK.test(n)) {
    // Chinese and Japanese have no spaces: compare overlapping character pairs.
    const chars = [...n.replace(/\s/g, "")];
    return chars.length < 2 ? chars : chars.slice(1).map((c, i) => chars[i] + c);
  }
  return n.split(" ").filter((w) => w.length > 1 || /\d/.test(w));
}

function negated(s: string): boolean {
  const n = normalize(s);
  if (CJK_NEG.test(n)) return true;
  return n.split(" ").some((w) => NEGATION.has(w) || w.startsWith("않") || w.startsWith("마세"));
}

/** Index of the option the answer names, or null when it is unclear. */
export function matchOption(answer: string, options: string[]): number | null {
  const said = tokens(answer);
  if (said.length === 0) return null;
  const saidSet = new Set(said);
  const saidNums = numbers(answer);
  const saidNeg = negated(answer);
  const scored = options.map((o, i) => {
    const opt = tokens(o);
    if (opt.length === 0) return { i, ok: false, f1: 0 };
    if ([...numbers(o)].some((n) => !saidNums.has(n))) return { i, ok: false, f1: 0 };
    if (negated(o) !== saidNeg) return { i, ok: false, f1: 0 };
    const optSet = new Set(opt);
    const overlap = [...optSet].filter((t) => saidSet.has(t)).length;
    const recall = overlap / optSet.size;
    const precision = overlap / saidSet.size;
    const f1 = overlap === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return { i, ok: recall >= 0.6, f1 };
  });
  const ranked = scored.filter((s) => s.ok).sort((a, b) => b.f1 - a.f1);
  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[0].f1 - ranked[1].f1 < 0.1) return null;
  return ranked[0].i;
}
