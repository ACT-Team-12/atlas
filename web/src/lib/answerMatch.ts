/**
 * "Say your answer": which of the quiz's three options did the person say? No AI, runs in the browser.
 *
 * The quiz is still graded exactly as before (the option they land on goes through the same tap path). This only
 * decides which option a spoken or typed answer names, and when in doubt it returns null so the page asks them to
 * tap the answer closest to what they said. A wrong match is worse than no match, so it refuses when:
 *   - the numbers differ in either direction (0.5 is not 5; "half a milligram" is 0.5), or a number can't be read;
 *   - "not" differs: the answer and the option must agree on whether they say not to do something, and an answer
 *     whose own polarity is unclear (a double negative, a leading "no,") never matches anything;
 *   - the best option does not clearly beat the next.
 */

type Lang = "cjk" | "other";

const WORD_NUM: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, once: 1, twice: 2,
  cero: 0, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  zéro: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10,
};
const HALF = new Set(["half", "medio", "media", "demi", "demie"]);
const QUARTER = new Set(["quarter", "quart"]);
const POINT = new Set(["point", "coma", "virgule"]);
const UNIT: Record<string, string> = {
  milligram: "mg", milligrams: "mg", milligramme: "mg", milligrammes: "mg", miligramo: "mg", miligramos: "mg",
  milliliter: "ml", milliliters: "ml", millilitre: "ml", millilitres: "ml", mililitro: "ml", mililitros: "ml",
  microgram: "mcg", micrograms: "mcg", µg: "mcg", gram: "g", grams: "g", gramme: "g", grammes: "g", gramo: "g", gramos: "g",
};

// Words that turn an instruction into "don't". English, Spanish, French and Vietnamese are whole words.
const NEG_WORDS = new Set([
  "not", "no", "never", "avoid", "avoiding", "avoided", "without", "stop", "stopping", "skip", "skipping", "hold", "holding", "refrain", "refraining",
  "nunca", "jamás", "sin", "evite", "evitar", "evita", "deje", "dejar", "suspenda", "suspender", "tampoco",
  "ne", "pas", "jamais", "sans", "évitez", "éviter", "arrêtez", "arrêter", "aucun", "aucune",
  "không", "đừng", "chớ", "tránh", "ngừng", "bỏ",
]);
const FR_NE_PARTNERS = new Set(["pas", "jamais", "plus", "rien", "aucun", "aucune"]);
// "No," at the start is often just a reply ("No, take it with food"), so it makes the polarity unclear.
const DISCOURSE = new Set(["no", "non", "không"]);
// Korean and Chinese negation is part of a longer word, so these are matched inside words.
const KO_NEG = ["않", "마세요", "말고", "말아", "금지", "피하", "피해", "중단", "없이"];
const KO_NEG_WORD = /^(안|못)/;
const ZH_NEG = /避免|不|别|没|勿|停|禁|无|莫/g;
const CJK = /[぀-ヿ㐀-鿿]/;

/** Lowercase, expand "n't" and French "n'", and drop punctuation that is not part of a number. */
function clean(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'")
    .replace(/\bcannot\b/g, "can not")
    .replace(/n't\b/g, " not")
    .replace(/\bn'/g, "ne ")
    .replace(/[^\p{L}\p{N}\p{M}.,/\s-]/gu, " ")
    .replace(/(\D)[.,](?!\d)/g, "$1 ") // sentence punctuation, not a decimal
    .replace(/\s+/g, " ").trim();
}

type Parsed = { words: string[]; nums: Set<string>; bad: boolean };
const canon = (n: number) => String(Math.round(n * 10_000) / 10_000);

/** Words with every quantity turned into one canonical number token "#0.5"; bad = a number we could not read. */
function parse(s: string): Parsed {
  let t = clean(s);
  let bad = /\d[.,]\d+[.,]\d/.test(t);
  t = t.replace(/(\d+)\s*[- ]\s*(\d+)\s*\/\s*(\d+)/g, (_, w, a, b) => ` #${canon(Number(w) + Number(a) / Number(b))} `); // 1 1/2
  t = t.replace(/(?<![#\d.])(\d+)\s*\/\s*(\d+)/g, (_, a, b) => (Number(b) === 0 ? (bad = true, " ") : ` #${canon(Number(a) / Number(b))} `));
  t = t.replace(/(\d+),(\d{3})(?!\d)/g, (m, a, b) => (a === "0" ? `${a}.${b}` : `${a}${b}`)); // 1,000 but 0,500
  t = t.replace(/(?<![#\d.])(\d+)[.,](\d+)/g, (_, a, b) => ` #${canon(Number(`${a}.${b}`))} `);
  t = t.replace(/(^|\s)[.,](\d+)/g, (_, p, b) => `${p}#${canon(Number(`0.${b}`))} `);
  t = t.replace(/(^|[^#\d.])(\d+)/g, (_, p, d) => `${p} #${canon(Number(d))} `);
  if (/\d[.,/]|[.,/]\d|\//.test(t.replace(/#\d+(\.\d+)?/g, ""))) bad = true;
  const raw = t.split(/\s+/).map((w) => (w.startsWith("#") ? w : w.replace(/[.,/-]/g, ""))).filter(Boolean).map((w) => UNIT[w] ?? w);

  // Spoken quantities: "zero point five", "point five", "one and a half", "half a", "a quarter".
  const out: string[] = [];
  const numAt = (i: number): number | null => {
    const w = raw[i];
    if (w === undefined) return null;
    if (w.startsWith("#")) return Number(w.slice(1));
    return w in WORD_NUM ? WORD_NUM[w] : null;
  };
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i];
    if (POINT.has(w)) {
      const prev = out.length && out[out.length - 1].startsWith("#") ? Number(out[out.length - 1].slice(1)) : null;
      const digits: string[] = [];
      while (i + 1 < raw.length && numAt(i + 1) !== null && Number.isInteger(numAt(i + 1)) && (numAt(i + 1) as number) < 10) digits.push(String(numAt(++i)));
      if (digits.length === 0) { bad = true; continue; }
      const value = Number(`${prev ?? 0}.${digits.join("")}`);
      if (prev !== null) out.pop();
      out.push(`#${canon(value)}`);
      continue;
    }
    if (HALF.has(w) || QUARTER.has(w)) {
      const part = HALF.has(w) ? 0.5 : 0.25;
      // "one half", "a half", "un demi" are just the part; "one and a half" is folded in the pass below.
      const last = out[out.length - 1];
      if (last === "#1" || last === "a" || last === "an") out.pop();
      out.push(`#${canon(part)}`);
      continue;
    }
    const n = numAt(i);
    out.push(n !== null ? `#${canon(n)}` : w);
  }
  // "one and a half": "#1 and a" then half handled above only when last is "a"; fold "#1 and #0.5" too.
  for (let i = 2; i < out.length; i++) {
    if ((out[i - 1] === "and" || out[i - 1] === "y" || out[i - 1] === "et") && out[i - 2].startsWith("#") && (out[i] === "#0.5" || out[i] === "#0.25") && raw.some((r) => HALF.has(r) || QUARTER.has(r))) {
      out.splice(i - 2, 3, `#${canon(Number(out[i - 2].slice(1)) + Number(out[i].slice(1)))}`);
    }
  }
  return { words: out, nums: new Set(out.filter((w) => w.startsWith("#"))), bad };
}

/** 0 = says to do it, 1 = says not to, null = unclear (two negatives, or a leading "no,"). */
function polarity(s: string): 0 | 1 | null {
  const n = clean(s);
  let count = (n.match(ZH_NEG) ?? []).length;
  const words = n.split(" ").filter(Boolean);
  const hasPartner = words.some((w) => FR_NE_PARTNERS.has(w));
  for (const w of words) {
    if (w === "ne" && hasPartner) continue; // French "ne ... pas" is one negative
    if (NEG_WORDS.has(w)) count++;
    else if (KO_NEG.some((k) => w.includes(k)) || (KO_NEG_WORD.test(w) && w.length <= 2)) count++;
  }
  if (count === 0) return 0;
  if (count > 1) return null;
  if (words.length > 1 && DISCOURSE.has(words[0])) return null;
  return 1;
}

function lang(s: string): Lang { return CJK.test(s) ? "cjk" : "other"; }

function tokens(p: Parsed, l: Lang): string[] {
  if (l === "cjk") {
    // Chinese and Japanese have no spaces: compare overlapping character pairs.
    const chars = [...p.words.join("")];
    return chars.length < 2 ? chars : chars.slice(1).map((c, i) => chars[i] + c);
  }
  return p.words.filter((w) => w.length > 1 || w.startsWith("#"));
}

/** Index of the option the answer names, or null when it is unclear. */
export function matchOption(answer: string, options: string[]): number | null {
  const a = parse(answer);
  if (a.bad) return null;
  const pol = polarity(answer);
  if (pol === null) return null;
  const said = tokens(a, lang(answer));
  if (said.length === 0) return null;
  const saidSet = new Set(said);
  const scored = options.map((o, i) => {
    const p = parse(o);
    const opt = tokens(p, lang(o));
    const sameNums = p.nums.size === a.nums.size && [...p.nums].every((n) => a.nums.has(n));
    if (p.bad || opt.length === 0 || !sameNums || polarity(o) !== pol) return { i, ok: false, f1: 0 };
    const optSet = new Set(opt);
    const overlap = [...optSet].filter((t) => saidSet.has(t)).length;
    const recall = overlap / optSet.size;
    const precision = overlap / saidSet.size;
    const f1 = overlap === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    return { i, ok: recall >= 0.6, f1 };
  });
  const ranked = scored.filter((s) => s.ok).sort((x, y) => y.f1 - x.f1);
  if (ranked.length === 0) return null;
  if (ranked.length > 1 && ranked[0].f1 - ranked[1].f1 < 0.1) return null;
  return ranked[0].i;
}
