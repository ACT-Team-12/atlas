/**
 * Numbers written as words in the languages an explanation can be written in, read as digits ("tres" and "三" are
 * "3"), so the number check can see "Tome tres tabletas" against a paper that says "Take 2 tablets".
 *
 * Words that are also an article ("un", "una", "une", "một", "一") count as 1 only right before a dose, count or time
 * word ("una tableta", "一片"), since "Llame a un médico" is not a dose. Amharic is not read here: its number words
 * take prefixes and suffixes a list can't follow, so callers fail closed for it (meaning.ts).
 *
 * Pure functions, no network. Safe to import in the browser.
 */

export type NumberLanguage = "English" | "Spanish" | "Vietnamese" | "Korean" | "Chinese" | "Amharic" | "French";

const L = String.raw`[\p{L}\p{N}]`;
const word = (w: string) => new RegExp(String.raw`(?<!${L})(?:${w})(?!${L})`, "giu");

// ---- Spanish ----
const ES_UNITS: Record<string, number> = {
  uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
  trece: 13, catorce: 14, quince: 15, "dieciséis": 16, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiuno: 21, "veintidós": 22, veintidos: 22, "veintitrés": 23, veintitres: 23, veinticuatro: 24,
  veinticinco: 25, "veintiséis": 26, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, cien: 100, ciento: 100,
};
const ES_TENS: Record<string, number> = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
const ES_COUNT = String.raw`(?:tabletas?|pastillas?|c[áa]psulas?|comprimidos?|dosis|vez|veces|cucharadas?|cucharaditas?|gotas?|horas?|d[íi]as?|semanas?|mes|meses|sobres?|vasos?|tazas?|inhalaciones?|inhalaci[óo]n|aplicaciones?|inyecci[óo]n)`;

// ---- French ----
const FR_UNITS: Record<string, number> = {
  deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13,
  quatorze: 14, quinze: 15, seize: 16, cent: 100,
};
const FR_TENS: Record<string, number> = { vingt: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60 };
const FR_COUNT = String.raw`(?:comprim[ée]s?|pilules?|g[ée]lules?|cachets?|fois|doses?|cuill[èe]res?|gouttes?|heures?|jours?|semaines?|mois|sachets?|verres?|tasses?|inhalations?|bouff[ée]es?|injections?)`;

// ---- Vietnamese ----
const VI_UNITS: Record<string, number> = { hai: 2, ba: 3, "bốn": 4, "tư": 4, "năm": 5, "sáu": 6, "bảy": 7, "tám": 8, "chín": 9 };
const VI_COUNT = String.raw`(?:viên|lần|liều|giờ|ngày|tuần|tháng|gói|cốc|ly|giọt|muỗng|thìa|nhát|ống|vỉ)`;

// ---- Korean ----
const KO_NATIVE: [string, number][] = [["하나", 1], ["둘", 2], ["셋", 3], ["넷", 4], ["다섯", 5], ["여섯", 6], ["일곱", 7], ["여덟", 8], ["아홉", 9], ["열", 10]];
const KO_NATIVE_BEFORE: [string, number][] = [["한", 1], ["두", 2], ["세", 3], ["네", 4], ["다섯", 5], ["여섯", 6], ["일곱", 7], ["여덟", 8], ["아홉", 9], ["열", 10]];
const KO_SINO: Record<string, number> = { "일": 1, "이": 2, "삼": 3, "사": 4, "오": 5, "육": 6, "칠": 7, "팔": 8, "구": 9, "십": 10 };
const KO_COUNT = String.raw`(?:알|정|번|시간|개|잔|컵|봉|포|방울|회|캡슐|스푼|숟가락|일|주|달|개월|분|밀리그램)`;

// ---- Chinese ----
const ZH_DIGIT: Record<string, number> = { "零": 0, "〇": 0, "一": 1, "二": 2, "两": 2, "兩": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9 };
const ZH_COUNT = "片粒颗顆次天日周週个個小时時杯袋包滴勺匙支瓶毫克";

function spanish(text: string, out: Set<string>) {
  const t = text.toLowerCase();
  for (const m of t.matchAll(word(String.raw`(${Object.keys(ES_TENS).join("|")})(?:\s+y\s+(uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve))?`))) {
    const unit = m[2] ? (m[2] === "una" ? 1 : ES_UNITS[m[2]]) : 0;
    out.add(String(ES_TENS[m[1]] + unit));
  }
  const tensTail = new Set<number>();
  for (const m of t.matchAll(word(String.raw`(?:${Object.keys(ES_TENS).join("|")})\s+y\s+(?:uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)`))) tensTail.add(m.index! + m[0].length);
  for (const m of t.matchAll(word(Object.keys(ES_UNITS).join("|")))) {
    if (tensTail.has(m.index! + m[0].length)) continue; // the "seis" of "treinta y seis"
    out.add(String(ES_UNITS[m[0]]));
  }
  if (word(String.raw`(?:un|una)\s+${ES_COUNT}`).test(t)) out.add("1");
}

function french(text: string, out: Set<string>) {
  const t = text.toLowerCase();
  const used: [number, number][] = [];
  for (const m of t.matchAll(word(String.raw`(${Object.keys(FR_TENS).join("|")})(?:(?:-|\s+et\s+|\s+)(un|une|${Object.keys(FR_UNITS).filter((k) => FR_UNITS[k] < 20).join("|")}))?`))) {
    const unit = m[2] ? (m[2] === "un" || m[2] === "une" ? 1 : FR_UNITS[m[2]]) : 0;
    out.add(String(FR_TENS[m[1]] + unit));
    used.push([m.index!, m.index! + m[0].length]);
  }
  for (const m of t.matchAll(word(Object.keys(FR_UNITS).join("|")))) {
    if (used.some(([a, b]) => m.index! >= a && m.index! < b)) continue;
    out.add(String(FR_UNITS[m[0]]));
  }
  if (word(String.raw`(?:un|une)\s+${FR_COUNT}`).test(t)) out.add("1");
}

function vietnamese(text: string, out: Set<string>) {
  const t = text.toLowerCase();
  const units = Object.keys(VI_UNITS).join("|");
  const used: [number, number][] = [];
  // "mười hai" (12), "hai mươi" (20), "hai mươi tư" (24)
  for (const m of t.matchAll(word(String.raw`(?:(${units})\s+mươi(?:\s+(một|mốt|${units}|lăm))?|mười(?:\s+(một|${units}|lăm))?)`))) {
    let n: number;
    if (m[1]) n = VI_UNITS[m[1]] * 10 + (m[2] ? (m[2] === "một" || m[2] === "mốt" ? 1 : m[2] === "lăm" ? 5 : VI_UNITS[m[2]]) : 0);
    else n = 10 + (m[3] ? (m[3] === "một" ? 1 : m[3] === "lăm" ? 5 : VI_UNITS[m[3]]) : 0);
    out.add(String(n));
    used.push([m.index!, m.index! + m[0].length]);
  }
  for (const m of t.matchAll(word(units))) {
    if (used.some(([a, b]) => m.index! >= a && m.index! < b)) continue;
    // "năm" is also "year": "mỗi năm", "hằng năm", "năm nay" are not a number.
    if (m[0] === "năm" && (/(?:mỗi|hằng|hàng|các|những)\s+$/u.test(t.slice(0, m.index!)) || /^\s+(?:nay|ngoái|tới|sau)/u.test(t.slice(m.index! + 3)))) continue;
    out.add(String(VI_UNITS[m[0]]));
  }
  if (word(String.raw`một\s+${VI_COUNT}`).test(t)) out.add("1");
}

function korean(text: string, out: Set<string>) {
  for (const [w, n] of KO_NATIVE) if (new RegExp(String.raw`(?<!\p{L})${w}(?!\p{L})`, "gu").test(text)) out.add(String(n));
  for (const [w, n] of KO_NATIVE_BEFORE) if (new RegExp(String.raw`(?<!\p{L})${w}\s*${KO_COUNT}`, "gu").test(text)) out.add(String(n));
  // Sino-Korean with a count word, as its own word: "삼일" (3 days), "이주" (2 weeks), "십분" (10 minutes)
  for (const m of text.matchAll(new RegExp(String.raw`(?<!\p{L})([일이삼사오육칠팔구])?(십)?([일이삼사오육칠팔구])?\s*(?:일|주|개월|시간|분|회|정|알)(?!\p{L})`, "gu"))) {
    if (!m[1] && !m[2] && !m[3]) continue;
    const tens = m[2] ? (m[1] ? KO_SINO[m[1]] : 1) * 10 : 0;
    const unit = m[2] ? (m[3] ? KO_SINO[m[3]] : 0) : (m[1] ? KO_SINO[m[1]] : 0);
    if (!m[2] && m[3]) continue; // two unit syllables in a row is a word, not a number
    out.add(String(tens + unit));
  }
}

function chinese(text: string, out: Set<string>) {
  for (const m of text.matchAll(/[零〇一二两兩三四五六七八九十百]+/gu)) {
    const s = m[0];
    const next = text[m.index! + s.length] ?? "";
    // "一" alone is also "a" or part of a word (一起, 一定, 一些): it counts only before a count word.
    if (s === "一" && !ZH_COUNT.includes(next)) continue;
    const n = zhValue(s);
    if (n !== null) out.add(String(n));
  }
}

/** "三" 3, "十二" 12, "二十" 20, "二十四" 24, "一百" 100. Anything else is read digit by digit. */
function zhValue(s: string): number | null {
  if (/^[零〇一二两兩三四五六七八九]$/u.test(s)) return ZH_DIGIT[s];
  const m = /^([一二两兩三四五六七八九])?十([一二三四五六七八九])?$/u.exec(s);
  if (m) return (m[1] ? ZH_DIGIT[m[1]] : 1) * 10 + (m[2] ? ZH_DIGIT[m[2]] : 0);
  const h = /^([一二两兩三四五六七八九])百$/u.exec(s);
  if (h) return ZH_DIGIT[h[1]] * 100;
  if (/^[零〇一二两兩三四五六七八九]+$/u.test(s)) return Number([...s].map((c) => ZH_DIGIT[c]).join(""));
  return null;
}

/**
 * Number words in one language, as digit strings. English returns nothing here (meaning.ts reads English words
 * itself where it means to), and Amharic returns nothing because it can't be read (see above).
 */
export function numberWords(text: string, language: NumberLanguage): string[] {
  const out = new Set<string>();
  if (language === "Spanish") spanish(text, out);
  else if (language === "French") french(text, out);
  else if (language === "Vietnamese") vietnamese(text, out);
  else if (language === "Korean") korean(text, out);
  else if (language === "Chinese") chinese(text, out);
  return [...out];
}
