/**
 * "Say your answer": speech never grades. This only proposes "Did you mean ...?" for one option, and the person's
 * own tap is the only answer the quiz records. No AI, runs in the browser.
 *
 * A suggestion is made only for a near-exact restatement: after dropping filler words, what was said and exactly
 * one option have the same content words in the same order (so increase/decrease, before/after, with/without, morning/night, not,
 * stop... must all agree, in every supported language), and the same quantities in the same order, each a
 * (value, unit, role) tuple such as (1, tablet, dose), (2, time, frequency), (5, day, duration). 5 g is not 5 mg,
 * "2 tablets 1 time" is not "1 tablet 2 times", and a number we cannot read means no suggestion. Otherwise null.
 */

export type Quantity = { value: string; unit: string; role: "dose" | "frequency" | "duration" | "bare" };

const WORD_NUM: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  cero: 0, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  zéro: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10,
};
const FREQ_WORD: Record<string, number> = { once: 1, twice: 2, thrice: 3 };
const HALF = new Set(["half", "medio", "media", "demi", "demie"]);
const QUARTER = new Set(["quarter", "quart"]);
const POINT = new Set(["point", "coma", "virgule"]);

/** Canonical unit and its role. Space-separated languages by word; Chinese, Japanese and Korean by suffix. */
const UNITS: [string[], string, Quantity["role"]][] = [
  [["mg", "milligram", "milligrams", "milligramme", "milligrammes", "miligramo", "miligramos", "밀리그램", "毫克"], "mg", "dose"],
  [["g", "gram", "grams", "gramme", "grammes", "gramo", "gramos", "gam", "그램", "克"], "g", "dose"],
  [["mcg", "µg", "microgram", "micrograms", "microgramo", "microgramos", "microgramme", "microgrammes", "微克"], "mcg", "dose"],
  [["ml", "milliliter", "milliliters", "millilitre", "millilitres", "mililitro", "mililitros", "밀리리터", "毫升"], "ml", "dose"],
  [["tablet", "tablets", "tableta", "tabletas", "comprimé", "comprimés", "viên", "알", "정", "片"], "tablet", "dose"],
  [["pill", "pills", "pastilla", "pastillas", "pilule", "pilules"], "pill", "dose"],
  [["capsule", "capsules", "cápsula", "cápsulas", "gélule", "gélules", "캡슐", "粒"], "capsule", "dose"],
  [["puff", "puffs", "inhalación", "inhalaciones", "bouffée", "bouffées", "nhát", "회분"], "puff", "dose"],
  [["drop", "drops", "gota", "gotas", "goutte", "gouttes", "giọt", "방울", "滴"], "drop", "dose"],
  [["unit", "units", "unidad", "unidades", "unité", "unités", "đơn", "단위", "单位"], "unit", "dose"],
  [["time", "times", "vez", "veces", "fois", "lần", "번", "次"], "time", "frequency"],
  [["day", "days", "día", "días", "jour", "jours", "ngày", "일", "天"], "day", "duration"],
  [["week", "weeks", "semana", "semanas", "semaine", "semaines", "tuần", "주", "周", "星期"], "week", "duration"],
  [["hour", "hours", "hora", "horas", "heure", "heures", "giờ", "시간", "小时"], "hour", "duration"],
  [["minute", "minutes", "minuto", "minutos", "phút", "분", "分钟"], "minute", "duration"],
  [["month", "months", "mes", "meses", "mois", "tháng", "개월", "个月"], "month", "duration"],
];
const UNIT = new Map<string, { unit: string; role: Quantity["role"] }>();
for (const [words, unit, role] of UNITS) for (const w of words) UNIT.set(w, { unit, role });
// Longest first, so 毫克 is read before 克.
const CJK_UNITS = [...UNIT.keys()].filter((w) => /[぀-ヿ㐀-鿿가-힯]/.test(w)).sort((a, b) => b.length - a.length);

/** Filler that never changes what an answer means. Everything else (not, with, before, increase...) must agree. */
const STOP = new Set([
  "i", "you", "we", "it", "a", "an", "the", "to", "of", "my", "your", "me", "um", "uh", "er", "so", "just", "like", "think", "guess",
  "should", "would", "will", "can", "do", "does", "did", "is", "are", "am", "be", "that", "this", "then", "okay", "ok", "yeah", "yes",
  "well", "maybe", "probably", "need", "have", "has", "supposed", "please", "im", "m",
  "el", "la", "los", "las", "lo", "le", "les", "l", "de", "del", "que", "y", "yo", "usted", "creo", "debo", "pues", "eh", "este",
  "du", "des", "d", "je", "vous", "il", "elle", "on", "et", "euh", "dois", "pense", "ben",
  "tôi", "bạn", "à", "ừ", "ờ", "thì", "là",
  "저는", "제가", "음", "어",
]);
const ZH_STOP = /[我你的了吧呢吗啊嗯]/g;
const CJK = /[぀-ヿ㐀-鿿]/;

function clean(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/[’‘]/g, "'")
    .replace(/\bcannot\b/g, "can not")
    .replace(/n't\b/g, " not")
    .replace(/\bn'/g, "ne ")
    .replace(/[^\p{L}\p{N}\p{M}.,/\s]/gu, " ")
    .replace(/(\D)[.,](?!\d)/g, "$1 ")
    .replace(/\s+/g, " ").trim();
}

const canon = (n: number) => String(Math.round(n * 10_000) / 10_000);

/** Words with every number turned into one token "#0.5"; bad = a number we could not read. */
function words(s: string): { list: string[]; bad: boolean } {
  let t = clean(s);
  let bad = /\d[.,]\d+[.,]\d/.test(t);
  t = t.replace(/(\d+)\s*[- ]\s*(\d+)\s*\/\s*(\d+)/g, (_, w, a, b) => ` #${canon(Number(w) + Number(a) / Number(b))} `);
  t = t.replace(/(?<![#\d.])(\d+)\s*\/\s*(\d+)/g, (_, a, b) => (Number(b) === 0 ? ((bad = true), " ") : ` #${canon(Number(a) / Number(b))} `));
  t = t.replace(/(\d+),(\d{3})(?!\d)/g, (_, a, b) => (a === "0" ? `${a}.${b}` : `${a}${b}`));
  t = t.replace(/(?<![#\d.])(\d+)[.,](\d+)/g, (_, a, b) => ` #${canon(Number(`${a}.${b}`))} `);
  t = t.replace(/(^|\s)[.,](\d+)/g, (_, p, b) => `${p}#${canon(Number(`0.${b}`))} `);
  t = t.replace(/(^|[^#\d.])(\d+)/g, (_, p, d) => `${p} #${canon(Number(d))} `);
  if (/\d[.,/]|[.,/]\d|\//.test(t.replace(/#\d+(\.\d+)?/g, ""))) bad = true;
  const raw = t.split(/\s+/).map((w) => (w.startsWith("#") ? w : w.replace(/[.,/]/g, ""))).filter(Boolean);

  const out: string[] = [];
  const num = (w: string | undefined) => (w === undefined ? null : w.startsWith("#") ? Number(w.slice(1)) : w in WORD_NUM ? WORD_NUM[w] : null);
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i];
    if (POINT.has(w)) {
      const last = out[out.length - 1];
      const prev = last?.startsWith("#") ? Number(last.slice(1)) : null;
      const digits: string[] = [];
      while (i + 1 < raw.length) {
        const n = num(raw[i + 1]);
        if (n === null || !Number.isInteger(n) || n > 9) break;
        digits.push(String(n));
        i++;
      }
      if (digits.length === 0) { bad = true; continue; }
      if (prev !== null) out.pop();
      out.push(`#${canon(Number(`${prev ?? 0}.${digits.join("")}`))}`);
      continue;
    }
    if (HALF.has(w) || QUARTER.has(w)) {
      const part = HALF.has(w) ? 0.5 : 0.25;
      const last = out[out.length - 1];
      if (last === "#1" || last === "a" || last === "an") out.pop();
      // "one and a half" / "uno y medio" / "un et demi"
      if ((out[out.length - 1] === "and" || out[out.length - 1] === "y" || out[out.length - 1] === "et") && out[out.length - 2]?.startsWith("#")) {
        const whole = Number(out[out.length - 2].slice(1));
        out.splice(out.length - 2, 2, `#${canon(whole + part)}`);
      } else out.push(`#${canon(part)}`);
      continue;
    }
    if (w in FREQ_WORD) { out.push(`#${FREQ_WORD[w]}`, "time"); continue; }
    const n = num(w);
    out.push(n !== null ? `#${canon(n)}` : w);
  }
  return { list: out, bad };
}

/** "taking" and "take" are the same word; so are "eating" and "eat". */
function stem(w: string): string {
  if (!/^[a-z]+$/.test(w) || w.length < 4) return w;
  return w.replace(/ing$/, "").replace(/e$/, "");
}

type Read = { quantities: Quantity[]; content: string[]; bad: boolean };

function read(s: string): Read {
  const { list, bad } = words(s);
  const quantities: Quantity[] = [];
  const rest: string[] = [];
  for (let i = 0; i < list.length; i++) {
    const w = list[i];
    if (w.startsWith("#")) {
      const value = w.slice(1);
      const u = UNIT.get(list[i + 1] ?? "");
      if (u) { quantities.push({ value, unit: u.unit, role: u.role }); i++; continue; }
      // A number written against a CJK unit ("5毫克", "2번") or followed by one with a space.
      const next = list[i + 1] ?? "";
      const cj = CJK_UNITS.find((k) => next.startsWith(k));
      if (cj) {
        const u2 = UNIT.get(cj)!;
        quantities.push({ value, unit: u2.unit, role: u2.role });
        if (next.length > cj.length) list[i + 1] = next.slice(cj.length); else i++;
        continue;
      }
      quantities.push({ value, unit: "", role: "bare" });
      continue;
    }
    rest.push(w);
  }
  const text = rest.join(" ");
  if (CJK.test(text)) {
    const chars = [...text.replace(ZH_STOP, "").replace(/\s/g, "")];
    const content = chars.length < 2 ? chars : chars.slice(1).map((c, i) => chars[i] + c);
    return { quantities, content, bad };
  }
  return { quantities, content: rest.filter((w) => !STOP.has(w)).map(stem), bad };
}

/** The quantities in a text, in order, as (value, unit, role). */
export function quantities(s: string): Quantity[] {
  return read(s).quantities;
}

const sameQuantities = (a: Quantity[], b: Quantity[]) =>
  a.length === b.length && a.every((q, i) => q.value === b[i].value && q.unit === b[i].unit && q.role === b[i].role);
/** Same content words in the same order, repeats included: "A before B" is not "B before A". */
const sameSequence = (a: string[], b: string[]) => a.length === b.length && a.every((w, i) => w === b[i]);

/** Index of the one option the words restate, or null. Only ever a suggestion for the person to confirm. */
export function suggestOption(answer: string, options: string[]): number | null {
  const said = read(answer);
  if (said.bad || (said.content.length === 0 && said.quantities.length === 0)) return null;
  const hits = options
    .map((o, i) => ({ i, r: read(o) }))
    .filter(({ r }) => !r.bad && sameQuantities(r.quantities, said.quantities) && sameSequence(r.content, said.content));
  return hits.length === 1 ? hits[0].i : null;
}
