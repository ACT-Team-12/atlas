/**
 * Numbers written as words, read as digits ("tres" and "三" are "3", "ciento veinte" and "一百二十" are "120"), so the
 * number check can see "Tome tres tabletas" against a paper that says "Take 2 tablets".
 *
 * Every reading says whether it could be read at all. `uncheckable` is true when the text has numeral text this file
 * can't interpret: a run of number words that doesn't make one number ("dos tres", "二三"), a digit outside 0-9 ("２",
 * "½", "፪"), or any Amharic, whose number words take prefixes and suffixes a list can't follow. Callers must treat
 * uncheckable as "can't certify", never as "no number" (meaning.ts).
 *
 * Words that are also an article ("un", "una", "une", "một", "一") count as 1 only right before a dose, count or time
 * word ("una tableta", "一片"), since "Llame a un médico" is not a dose.
 *
 * Pure functions, no network. Safe to import in the browser.
 */

export type NumberLanguage = "English" | "Spanish" | "Vietnamese" | "Korean" | "Chinese" | "Amharic" | "French";
export type NumberReading = { numbers: string[]; uncheckable: boolean };

/** A digit that is not 0-9 (fullwidth, Arabic-Indic, Ethiopic, fractions, superscripts). "〇" is read as Chinese. */
const FOREIGN_DIGIT = /[^\P{N}0-9〇]/u;

// ---------------------------------------------------------------- Latin-script languages (en, es, fr, vi)

type Tok = { kind: "n"; v: number; article?: boolean } | { kind: "mul"; v: number } | { kind: "conn" };
type Lexicon = { word: (w: string, prev: string | null, next: string | null) => Tok | null; count: RegExp; french?: boolean };

const map = (o: Record<string, number>) => new Map(Object.entries(o));

const EN = map({
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, once: 1, twice: 2,
});
const ES = map({
  uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, "dieciséis": 16, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiuno: 21, veintiuna: 21, "veintidós": 22, veintidos: 22, "veintitrés": 23, veintitres: 23,
  veinticuatro: 24, veinticinco: 25, "veintiséis": 26, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
  cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400,
  cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700,
  setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
});
const FR = map({
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12,
  treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20, vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60,
});
const VI = map({ "một": 1, "mốt": 1, hai: 2, ba: 3, "bốn": 4, "tư": 4, "năm": 5, "lăm": 5, "sáu": 6, "bảy": 7, "tám": 8, "chín": 9, "mười": 10 });

const EN_LEX: Lexicon = {
  count: /^(?:tablets?|pills?|capsules?|doses?|times?|drops?|puffs?|hours?|days?|weeks?|months?|mg|ml|cups?|glasses?|spoons?|teaspoons?|tablespoons?)$/,
  word: (w, _p, next) => {
    if (w === "hundred") return { kind: "mul", v: 100 };
    if (w === "thousand") return { kind: "mul", v: 1000 };
    if (w === "and") return { kind: "conn" };
    if (w === "a" && (next === "hundred" || next === "thousand")) return { kind: "n", v: 1 };
    const v = EN.get(w);
    return v === undefined ? null : { kind: "n", v };
  },
};
const ES_LEX: Lexicon = {
  count: /^(?:tabletas?|pastillas?|c[áa]psulas?|comprimidos?|dosis|vez|veces|cucharadas?|cucharaditas?|gotas?|horas?|d[íi]as?|semanas?|mes|meses|sobres?|vasos?|tazas?|inhalaciones|inhalaci[óo]n|mg|ml)$/,
  word: (w) => {
    if (w === "mil") return { kind: "mul", v: 1000 };
    if (w === "y") return { kind: "conn" };
    if (w === "un" || w === "una") return { kind: "n", v: 1, article: true };
    const v = ES.get(w);
    return v === undefined ? null : { kind: "n", v };
  },
};
const FR_LEX: Lexicon = {
  french: true,
  count: /^(?:comprim[ée]s?|pilules?|g[ée]lules?|cachets?|fois|doses?|cuill[èe]res?|gouttes?|heures?|jours?|semaines?|mois|sachets?|verres?|tasses?|inhalations?|bouff[ée]es?|mg|ml)$/,
  word: (w, prev) => {
    if (w === "cent" || w === "cents") return { kind: "mul", v: 100 };
    if (w === "mille") return { kind: "mul", v: 1000 };
    if (w === "et") return { kind: "conn" };
    // "quatre-vingts" is 4 x 20.
    if ((w === "vingt" || w === "vingts") && prev === "quatre") return { kind: "mul", v: 20 };
    const v = FR.get(w);
    return v === undefined ? null : { kind: "n", v, article: w === "un" || w === "une" };
  },
};
const VI_LEX: Lexicon = {
  count: /^(?:viên|lần|liều|giờ|ngày|tuần|tháng|gói|cốc|ly|giọt|muỗng|thìa|nhát|ống|vỉ|mg|ml)$/u,
  word: (w) => {
    if (w === "mươi") return { kind: "mul", v: 10 };
    if (w === "trăm") return { kind: "mul", v: 100 };
    if (w === "nghìn" || w === "ngàn") return { kind: "mul", v: 1000 };
    if (w === "linh" || w === "lẻ") return { kind: "conn" };
    const v = VI.get(w);
    return v === undefined ? null : { kind: "n", v, article: w === "một" };
  },
};

/** The smallest non-zero place of n (120 -> 10, 200 -> 100, 7 -> 1). */
const place = (n: number) => { let p = 1; while (n > 0 && n % (p * 10) === 0) p *= 10; return p; };

/** One run of number words in order, or null when they don't make one number ("dos tres"). */
function compose(toks: Tok[], french: boolean): number | null {
  let total = 0;
  let cur = 0;
  let any = false;
  for (const t of toks) {
    if (t.kind === "conn") continue;
    if (t.kind === "mul") {
      if (t.v === 1000) { total += (cur || 1) * 1000; cur = 0; any = true; continue; }
      const low = cur % t.v;
      cur = cur - low + (low || 1) * t.v;
      any = true;
      continue;
    }
    if (!any) { cur = t.v; any = true; continue; }
    // French 70 and 90 are 60+10 and 80+10 ("soixante-dix", "quatre-vingt-dix").
    const ok = cur === 0 || t.v < place(cur) || (french && cur % 20 === 0 && t.v < 20);
    if (!ok) return null;
    cur += t.v;
  }
  return any ? total + cur : null;
}

function readLatin(text: string, lex: Lexicon, lang: NumberLanguage): NumberReading {
  const t = text.toLowerCase();
  const words = [...t.matchAll(/\p{L}+/gu)].map((m) => ({ w: m[0], at: m.index!, end: m.index! + m[0].length }));
  const out = new Set<string>();
  let uncheckable = false;
  let i = 0;
  while (i < words.length) {
    const prev = i > 0 ? words[i - 1].w : null;
    const first = lex.word(words[i].w, prev, words[i + 1]?.w ?? null);
    if (!first || first.kind === "conn") { i++; continue; }
    const run: Tok[] = [first];
    let j = i + 1;
    while (j < words.length && /^[\s\-–]*$/u.test(t.slice(words[j - 1].end, words[j].at))) {
      const tok = lex.word(words[j].w, words[j - 1].w, words[j + 1]?.w ?? null);
      if (!tok) break;
      run.push(tok);
      j++;
    }
    while (run.length && run[run.length - 1].kind === "conn") { run.pop(); j--; }
    const nextWord = words[j]?.w ?? "";
    const single = run.length === 1 && run[0].kind === "n" ? run[0] : null;
    if (single?.article && !lex.count.test(nextWord)) { i = j; continue; } // "un médico", "một người"
    // "năm" is also "year": "mỗi năm", "hằng năm", "năm nay" are not a number.
    if (lang === "Vietnamese" && single && words[i].w === "năm" && (/^(?:mỗi|hằng|hàng|các|những)$/u.test(prev ?? "") || /^(?:nay|ngoái|tới|sau)$/u.test(nextWord))) { i = j; continue; }
    const n = compose(run, !!lex.french);
    if (n === null) uncheckable = true;
    else out.add(String(n));
    i = j;
  }
  return { numbers: [...out], uncheckable };
}

// ---------------------------------------------------------------- Chinese

const ZH_DIGIT: Record<string, number> = { "零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "兩": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
const ZH_UNIT: Record<string, number> = { "十": 10, "百": 100, "千": 1000 };
const ZH_COUNT = "片粒颗顆次天日周週个個小时時杯袋包滴勺匙支瓶毫克";
/** Words that contain a numeral character but are not numbers ("together", "must", "by all means", "percent of"). */
const ZH_NOT_NUMBERS = /一起|一定|一些|一样|一樣|一般|一直|一切|一下|一旦|统一|統一|唯一|万一|萬一|千万|千萬|百分之/gu;

function zhCompose(s: string): number | null {
  let total = 0, section = 0;
  let pending: number | null = null;
  let lastDigit = false;
  for (const c of s) {
    if (c in ZH_DIGIT) {
      if (c === "零" || c === "〇") { lastDigit = false; continue; }
      if (lastDigit) return null; // "二三": two or three, not one number
      pending = ZH_DIGIT[c]; lastDigit = true;
    } else if (c in ZH_UNIT) {
      section += (pending ?? 1) * ZH_UNIT[c]; pending = null; lastDigit = false;
    } else if (c === "万" || c === "萬") {
      total += (section + (pending ?? 0) || 1) * 10000; section = 0; pending = null; lastDigit = false;
    }
  }
  return total + section + (pending ?? 0);
}

function readChinese(text: string): NumberReading {
  const t = text.replace(ZH_NOT_NUMBERS, (m) => " ".repeat(m.length));
  const out = new Set<string>();
  let uncheckable = false;
  for (const m of t.matchAll(/[零〇一二两兩三四五六七八九十百千万萬]+/gu)) {
    const next = t[m.index! + m[0].length] ?? "";
    if (m[0] === "一" && !ZH_COUNT.includes(next)) continue; // "一" alone is "a"
    const n = zhCompose(m[0]);
    if (n === null) uncheckable = true;
    else out.add(String(n));
  }
  return { numbers: [...out], uncheckable };
}

// ---------------------------------------------------------------- Korean

const KO_SINO: Record<string, number> = { "일": 1, "이": 2, "삼": 3, "사": 4, "오": 5, "육": 6, "칠": 7, "팔": 8, "구": 9 };
const KO_SINO_UNIT: Record<string, number> = { "십": 10, "백": 100, "천": 1000 };
const KO_COUNT = String.raw`(?:알|정|번|시간|개|잔|컵|봉|포|방울|회|캡슐|스푼|숟가락|일|주|달|개월|분|밀리그램|밀리리터|mg|ml)`;
const KO_TENS: Record<string, number> = { "스물": 20, "스무": 20, "서른": 30, "마흔": 40, "쉰": 50, "예순": 60, "일흔": 70, "여든": 80, "아흔": 90 };
const KO_UNITS_FULL: Record<string, number> = { "하나": 1, "둘": 2, "셋": 3, "넷": 4, "다섯": 5, "여섯": 6, "일곱": 7, "여덟": 8, "아홉": 9 };
const KO_UNITS_BEFORE: Record<string, number> = { "한": 1, "두": 2, "세": 3, "네": 4, "다섯": 5, "여섯": 6, "일곱": 7, "여덟": 8, "아홉": 9, "열": 10 };

function koSino(s: string): number | null {
  let total = 0;
  let pending: number | null = null;
  for (const c of s) {
    if (c in KO_SINO) { if (pending !== null) return null; pending = KO_SINO[c]; }
    else if (c in KO_SINO_UNIT) { total += (pending ?? 1) * KO_SINO_UNIT[c]; pending = null; }
    else if (c === "만") { total = (total + (pending ?? 0) || 1) * 10000; pending = null; }
  }
  return total + (pending ?? 0);
}

function readKorean(text: string): NumberReading {
  const out = new Set<string>();
  let uncheckable = false;
  const tens = Object.keys(KO_TENS).join("|");
  const before = Object.keys(KO_UNITS_BEFORE).join("|");
  const full = Object.keys(KO_UNITS_FULL).join("|");
  const used: [number, number][] = [];
  const free = (a: number, b: number) => !used.some(([x, y]) => a < y && x < b);
  // Native: "여든 알" (80), "스물네 시간" (24), "스물다섯" (25)
  for (const m of text.matchAll(new RegExp(String.raw`(?<![가-힣])(${tens})\s*(?:(${full})(?![가-힣])|(${before})(?=\s*${KO_COUNT}))?`, "gu"))) {
    out.add(String(KO_TENS[m[1]] + (m[2] ? KO_UNITS_FULL[m[2]] : m[3] ? KO_UNITS_BEFORE[m[3]] : 0)));
    used.push([m.index!, m.index! + m[0].length]);
  }
  for (const m of text.matchAll(new RegExp(String.raw`(?<![가-힣])(${full})(?![가-힣])`, "gu"))) {
    if (free(m.index!, m.index! + m[0].length)) { out.add(String(KO_UNITS_FULL[m[1]])); used.push([m.index!, m.index! + m[0].length]); }
  }
  for (const m of text.matchAll(new RegExp(String.raw`(?<![가-힣])(${before})\s*${KO_COUNT}`, "gu"))) {
    if (free(m.index!, m.index! + m[1].length)) { out.add(String(KO_UNITS_BEFORE[m[1]])); used.push([m.index!, m.index! + m[1].length]); }
  }
  // Sino-Korean: "이백" (200), "백이십" (120), or any run right before a count word ("삼 일", "오백 밀리그램")
  // Lazy, so the count word "일" (day) in "삼일" is not read as a second numeral.
  for (const m of text.matchAll(new RegExp(String.raw`(?<![가-힣])([일이삼사오육칠팔구십백천만]+?)(?=(\s*${KO_COUNT})|[^가-힣]|$)`, "gu"))) {
    const s = m[1];
    if (!free(m.index!, m.index! + s.length)) continue;
    if (!/[십백천만]/u.test(s) && !m[2]) continue; // "이" (this), "사" alone: not a number without a count word
    const n = koSino(s);
    if (n === null) uncheckable = true;
    else out.add(String(n));
  }
  return { numbers: [...out], uncheckable };
}

// ---------------------------------------------------------------- entry point

/** Number words in one language, as digit strings, plus whether any numeral text could not be read. */
export function readNumberWords(text: string, language: NumberLanguage): NumberReading {
  if (language === "Amharic") return { numbers: [], uncheckable: true };
  const foreign = FOREIGN_DIGIT.test(text);
  const r =
    language === "English" ? readLatin(text, EN_LEX, language)
    : language === "Spanish" ? readLatin(text, ES_LEX, language)
    : language === "French" ? readLatin(text, FR_LEX, language)
    : language === "Vietnamese" ? readLatin(text, VI_LEX, language)
    : language === "Korean" ? readKorean(text)
    : readChinese(text);
  return { numbers: r.numbers, uncheckable: r.uncheckable || foreign };
}

/** Just the numbers (for callers that only widen an allowed set). */
export const numberWords = (text: string, language: NumberLanguage): string[] => readNumberWords(text, language).numbers;
