/**
 * "Your medicine changes": every medicine step sorted into STOP, CHANGE, START (and KEEP when the paper says to
 * continue), read from the PAPER'S OWN WORDS only. Pure, no AI, safe in the browser.
 *
 * What decides a row. A medicine step's verified quote, and the list heading it sits under on the paper
 * ("STOP taking these medications:" above "- ibuprofen ..."). Never the AI's title, "when" or explanation: the AI's
 * kind only picks which steps are medicines, as it does for the "Right away" stop rule.
 *
 * - STOP only when stopNowFromPaper (stepsView.ts) says so, the same rule that puts the step under "Right away", so the
 *   card and the list can never disagree about a stop.
 * - CHANGE, START, KEEP from the word lists below, in the seven app languages.
 * - Anything the words do not settle goes to "Ask your pharmacist", never to a guessed row: a negated action ("do not
 *   stop"), a condition ("if", "unless", "until"), a hold ("hold for 2 days, then restart"), two different actions on
 *   one line, a line that disagrees with its heading, a stop word the stop rule does not accept ("do not take more
 *   than"), or no action word at all.
 *
 * Doses. A CHANGE row shows the old dose struck through and the new one only when both are written in the quote
 * ("Previously 10 mg" with one other dose of the same kind, or "from 10 mg to 20 mg"), the number reading of the
 * meaning check (meaning.ts doseReadings) finds exactly those two values of that kind on the line, their naming words
 * do not point at two different medicines, and no other word names what the new dose is for. Otherwise: the quote
 * alone. The doses shown are the paper's characters, copied, never computed.
 *
 * NATIVE-SPEAKER REVIEW NEEDED for every non-English list below; Amharic is the least certain. These lists only choose
 * a row; a word they miss sends the step to "Ask your pharmacist", where its quote is still shown.
 */

import { doseReadings } from "./meaning";
import { listHeadingAny, STEPS_PATTERNS, stopNowFromPaper } from "./stepsView";

export const MED_ROWS = ["stop", "change", "start", "keep", "ask"] as const;
export type MedRow = (typeof MED_ROWS)[number];

export const MED_ROW_LABEL: Record<MedRow, string> = {
  stop: "Stop",
  change: "Change",
  start: "Start",
  keep: "Keep taking",
  ask: "Ask your pharmacist",
};

/** Why a step went where it went. Tests and the phone ports read it; the screen does not show it. */
export type MedReason =
  | "words" // the quote's own action words
  | "heading" // the list heading above the line
  | "words_and_heading" // both, and they agree
  | "negated"
  | "conditional"
  | "hold"
  | "stop_not_now"
  | "mixed"
  | "heading_disagrees"
  | "no_action_words";

export type DoseChange = { was: string; now: string };

export type MedChange = {
  id: string;
  row: MedRow;
  reason: MedReason;
  /** The medicine's name as the paper writes it at the start of the line ("metformin (GLUCOPHAGE)"), or null. */
  name: string | null;
  /** The verified quote, exactly. */
  quote: string;
  /** Only on a CHANGE row, and only as written in the quote. */
  dose: DoseChange | null;
};

const S = String.raw`\s+`;
/** Whole-word alternatives with letter-aware edges (English, Spanish, French, Vietnamese). */
const edged = (src: string) => new RegExp(String.raw`(?<![\p{L}\p{N}\p{M}])(?:${src})(?![\p{L}\p{N}\p{M}])`, "iu");
/** Substring alternatives (Korean, Chinese, Amharic: no word edges, particles attach to the word). */
const bare = (src: string) => new RegExp(src, "iu");
/** A copy without the global flag, so .test() keeps no state between calls. */
const once = (re: RegExp) => new RegExp(re.source, re.flags.replace("g", ""));

type Lists = { start: RegExp; change: RegExp; keep: RegExp; hold: RegExp; neg: RegExp; cond: RegExp };

const EN: Lists = {
  start: edged(String.raw`start|started|starting|begin|begins|beginning|restart|resume|new${S}(?:medicines?|medications?|prescriptions?)`),
  change: edged(
    [
      String.raw`(?:increase|decrease|reduce|lower|raise|adjust|change)[sd]?${S}(?:(?:your|the|this)${S})?(?:dose|dosage|how${S}you${S}take)`,
      String.raw`dose${S}(?:was${S}|is${S})?(?:increased|decreased|changed|reduced|lowered|adjusted)|new${S}dose|previously|formerly`,
      String.raw`(?:changed?|switch(?:ed)?)${S}to`,
      // "Increase your lisinopril dose", "Lower metoprolol to 25 mg". Not "may increase your risk": no dose, no amount.
      String.raw`(?:increase|decrease|reduce|lower|raise|adjust|change)[sd]?(?:${S}[\p{L}()]+){1,2}${S}(?:dose|dosage)`,
      String.raw`(?:increase|decrease|reduce|lower|raise)[sd]?(?:${S}[\p{L}()]+){0,3}${S}to${S}\d`,
    ].join("|"),
  ),
  keep: edged(String.raw`continue|continuing|keep${S}(?:taking|using)`),
  hold: edged(String.raw`hold|held|holding|pause|paused|temporarily`),
  neg: edged(
    String.raw`(?:do${S}not|don['’]t|never|not|no${S}longer)(?:${S}\p{L}+){0,2}${S}(?:stop|discontinue|start|begin|increase|decrease|reduce|lower|raise|change|continue|restart|resume|keep|hold|switch)|no${S}changes?`,
  ),
  cond: edged(String.raw`if|unless|in${S}case|until`),
};
const ES: Lists = {
  start: edged(String.raw`empiece|empezar|comience|comenzar|inicie|iniciar|reanude|reanudar|reinicie|reiniciar|vuelva${S}a${S}(?:tomar|empezar)|nuevos?${S}medicamentos?|nuevas?${S}medicinas?`),
  change: edged(String.raw`(?:aumente|disminuya|reduzca|baje|cambie|ajuste)(?:${S}(?:la|su))?${S}dosis|nueva${S}dosis|anteriormente|cambi[eó]${S}a`),
  keep: edged(String.raw`contin[uú]e|continuar|siga${S}tomando|seguir${S}tomando`),
  hold: edged(String.raw`temporalmente|pausa|pause`),
  neg: edged(
    String.raw`(?:no|nunca)(?:${S}\p{L}+){0,2}${S}(?:deje|dejar|suspenda|suspender|empiece|empezar|comience|comenzar|inicie|aumente|disminuya|reduzca|cambie|contin[uú]e|reanude)|sin${S}cambios?`,
  ),
  cond: edged(String.raw`si|a${S}menos${S}que|en${S}caso${S}de|hasta${S}que`),
};
const FR: Lists = {
  start: edged(String.raw`commencez|commencer|débutez|débuter|reprenez|reprendre|recommencez|recommencer|nouveaux?${S}médicaments?`),
  change: edged(String.raw`(?:augmentez|diminuez|réduisez|baissez|changez|modifiez|ajustez)${S}(?:la|votre)${S}(?:dose|posologie)|nouvelle${S}dose|auparavant|anciennement`),
  keep: edged(String.raw`continuez|continuer|poursuivez|poursuivre`),
  hold: edged(String.raw`temporairement|pause`),
  neg: new RegExp(
    String.raw`(?<![\p{L}\p{N}])(?:ne${S}(?:\p{L}+${S}){0,2}|n['’]\s*)(?:commencez|augmentez|diminuez|réduisez|changez|modifiez|continuez|poursuivez|reprenez|arrêtez|arretez|cessez|interrompez|suspendez)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])aucun${S}changement`,
    "iu",
  ),
  cond: edged(String.raw`si|s['’]ils?|sauf${S}si|en${S}cas|jusqu['’]à`),
};
const VI: Lists = {
  start: edged(String.raw`bắt${S}đầu|thuốc${S}mới|dùng${S}lại|uống${S}lại`),
  change: edged(String.raw`tăng${S}liều|giảm${S}liều|đổi${S}liều|thay${S}đổi${S}liều|điều${S}chỉnh${S}liều|liều${S}mới|đổi${S}sang|trước${S}đây`),
  keep: edged(String.raw`tiếp${S}tục|vẫn${S}(?:dùng|uống)`),
  hold: edged(String.raw`tạm${S}(?:ngưng|ngừng|dừng|thời)`),
  neg: edged(String.raw`(?:không|đừng|chớ)(?:${S}\p{L}+){0,3}${S}(?:ngưng|ngừng|dừng|bắt${S}đầu|tăng|giảm|đổi|tiếp${S}tục)|không${S}thay${S}đổi`),
  cond: edged(String.raw`nếu|trừ${S}khi|trường${S}hợp|cho${S}đến${S}khi`),
};
const KO: Lists = {
  start: bare(String.raw`시작|새로\s*처방|새\s*약|새로운\s*약|재개`),
  change: bare(String.raw`증량|감량|용량\s*(?:을\s*)?(?:늘리|늘려|줄이|줄여|변경|조정)|이전\s*용량|(?:으로|로)\s*변경`),
  keep: bare(String.raw`계속`),
  hold: bare(String.raw`일시\s*중단|잠시\s*중단|일시적으로`),
  neg: bare(String.raw`(?:중단|중지|멈추|끊|시작|증량|감량|늘리|줄이|변경|계속)\p{L}*?지\s*(?:마|말|않)|변경\s*없`),
  cond: bare(String.raw`경우|만약|만일|때까지`),
};
const ZH: Lists = {
  start: bare(String.raw`开始|開始|新药|新藥|新处方|新處方|加用|恢复服用|恢復服用|重新服用`),
  change: bare(String.raw`增加剂量|增加劑量|剂量增加|劑量增加|减少剂量|減少劑量|剂量减少|劑量減少|加量|减量|減量|改为|改為|改成|调整剂量|調整劑量|更改剂量|更改劑量|增至|减至|減至|原来|原來|此前`),
  keep: bare(String.raw`继续|繼續`),
  hold: bare(String.raw`暂停|暫停|暂时|暫時`),
  neg: bare(String.raw`(?:不要|不可|不能|不得|请勿|請勿|勿|别|別|切勿)\p{L}{0,6}?(?:停|开始|開始|增加|减少|減少|加量|减量|減量|改|继续|繼續|恢复|恢復)|不变|不變`),
  cond: bare(String.raw`如果|如若|假如|一旦|如有|直到|(?<![\p{L}])若`),
};
const AM: Lists = {
  start: bare(String.raw`ይጀምሩ|ጀምሩ|አዲስ\s*መድ[ሀሃሐ]ኒት|አዲስ\s*መድኃኒት|እንደገና`),
  change: bare(String.raw`ይጨምሩ|ይቀንሱ|ይቀይሩ`),
  keep: bare(String.raw`ይቀጥሉ`),
  hold: bare(String.raw`ለጊዜው`),
  neg: bare(String.raw`አይጀምሩ|አይጨምሩ|አይቀንሱ|አይቀይሩ|አያቁሙ|አያቋርጡ|አይቀጥሉ`),
  cond: bare(String.raw`ከሆነ|ካለብዎት|ካጋጠመዎት|ቢያጋጥምዎ|እስከ`),
};
const LANG_LISTS: [string, Lists][] = [["en", EN], ["es", ES], ["fr", FR], ["vi", VI], ["ko", KO], ["zh", ZH], ["am", AM]];

/** Stop words of all seven languages (the very patterns stepsView.ts and safetyWords.ts use). */
const STOP_WORDS = ["STOP", "STOP_VI", "STOP_FR", "STOP_KO", "STOP_ZH", "STOP_AM"].map((k) => once(STEPS_PATTERNS[k]));

/** "from 10 mg to 20 mg" in the Latin-script languages; the doses must carry the same unit word. */
const AMOUNT = String.raw`(?<![\d.,])(\d+(?:[.,]\d+)?\s*(mg|mcg|µg|g|ml|units?|unidades?|unités?|đơn${S}vị|IU|UI)(?![\p{L}\p{M}]))`;
const FROM_TO = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:from|de|desde|từ)${S}${AMOUNT}${S}(?:to|a|hasta|à|lên|xuống|thành|đến|tới)${S}${AMOUNT}(?![\p{L}\p{N}])`,
  "giu",
);
/** "Previously 10 mg" (English): the paper's own word for the old dose. */
const PREVIOUSLY = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:previously|formerly)[:,]?${S}${AMOUNT}(?![\p{L}\p{N}])`, "giu");

const prepare = (t: string) => t.normalize("NFC").replace(/\s+/g, " ").trim();

type Signals = { stop: boolean; change: boolean; start: boolean; keep: boolean; hold: boolean; neg: boolean; cond: boolean };

function signalsOf(text: string): Signals {
  const t = prepare(text);
  const any = (pick: (l: Lists) => RegExp) => LANG_LISTS.some(([, l]) => pick(l).test(t));
  FROM_TO.lastIndex = 0;
  const fromTo = FROM_TO.test(t);
  FROM_TO.lastIndex = 0;
  return {
    stop: STOP_WORDS.some((re) => re.test(t)),
    change: any((l) => l.change) || fromTo,
    start: any((l) => l.start),
    keep: any((l) => l.keep),
    hold: any((l) => l.hold),
    neg: any((l) => l.neg),
    cond: any((l) => l.cond),
  };
}

const rowsOf = (s: Signals): MedRow[] => (["stop", "change", "start", "keep"] as const).filter((r) => s[r]);

type Item = { id: string; kind: string; source_quote: string; span?: { start: number; end: number } | null };

/** Which row one medicine step goes in, and why. Non-medicine steps are not sorted (null). */
export function classifyMedicine(it: Item, paper = ""): { row: MedRow; reason: MedReason } | null {
  if (it.kind !== "medication") return null;
  const heading = listHeadingAny(paper, it.span);
  const q = signalsOf(it.source_quote);
  const h = heading ? signalsOf(heading) : null;
  const both = h ? [q, h] : [q];
  const ask = (reason: MedReason) => ({ row: "ask" as const, reason });
  if (both.some((s) => s.neg)) return ask("negated");
  if (both.some((s) => s.cond)) return ask("conditional");
  if (both.some((s) => s.hold)) return ask("hold");
  // A stop word counts only where the "Right away" rule accepts it, so the card and the list agree about every stop.
  if (both.some((s) => s.stop) && !stopNowFromPaper(it, paper)) return ask("stop_not_now");
  const qr = rowsOf(q);
  const hr = h ? rowsOf(h) : [];
  if (qr.length > 1 || hr.length > 1) return ask("mixed");
  if (qr.length === 1 && hr.length === 1 && qr[0] !== hr[0]) return ask("heading_disagrees");
  if (qr.length === 1) return { row: qr[0], reason: hr.length ? "words_and_heading" : "words" };
  if (hr.length === 1) return { row: hr[0], reason: "heading" };
  return ask("no_action_words");
}

/** Words that may follow a dose without naming what it is for ("20 mg total", "10 mg once daily", "500 mg tablet"). */
const AFTER_DOSE_OK = new Set(
  (
    "tablet tablets tab tabs pill pills capsule capsules total by mouth orally po once twice daily a an per each every day days " +
    "in the morning evening night bedtime at with meals meal food as needed and for weekly qd bid tid " +
    "tableta tabletas pastilla pastillas cápsula cápsulas al día diario diaria por vía oral boca cada una vez veces con comida comidas " +
    "comprimé comprimés gélule gélules par jour fois une le matin soir avec repas " +
    "viên mỗi ngày lần uống sáng tối"
  ).split(" "),
);
/** Words skipped before that check: "20 mg of aspirin" looks at "aspirin". */
const AFTER_DOSE_SKIP = new Set(["of", "de", "du", "des", "d", "của"]);

/** True when the words right after this dose (up to the end of its sentence) never name something else. */
function nothingNamedAfter(text: string, end: number): boolean {
  const rest = text.slice(end).split(/[.;!?\n]/)[0];
  const words = [...rest.matchAll(/[\p{L}\p{M}]+/gu)].map((m) => m[0].toLowerCase());
  for (const w of words) {
    if (AFTER_DOSE_SKIP.has(w)) continue;
    return AFTER_DOSE_OK.has(w);
  }
  return true;
}

const valueOf = (amount: string) => (amount.match(/\d+(?:[.,]\d+)?/)?.[0] ?? "").replace(",", ".");
const unitWord = (amount: string) => amount.replace(/^[\d.,\s]+/, "").replace(/\s+/g, " ").toLowerCase();

/**
 * The old and new dose, as written in the quote, or null. Never computed, never filled in from anywhere else.
 */
export function doseChangeFromPaper(quote: string): DoseChange | null {
  const t = quote.replace(/\s+/g, " ");
  const fromTo = [...t.matchAll(FROM_TO)];
  const prev = [...t.matchAll(PREVIOUSLY)];
  if (fromTo.length + prev.length !== 1) return null;
  let was: string;
  let now: string;
  let nowEnd: number;
  // The "from 10 mg to 20 mg" words themselves: "to" after the old dose is not a name.
  let joined: [number, number] = [-1, -1];
  if (fromTo.length === 1) {
    const m = fromTo[0];
    was = m[1];
    now = m[3];
    if (unitWord(was) !== unitWord(now)) return null;
    nowEnd = (m.index ?? 0) + m[0].length;
    joined = [m.index ?? 0, nowEnd];
  } else {
    was = prev[0][1];
    // The new dose: the one other value with the same unit word on the line, written out.
    const unit = unitWord(was);
    const others = [...t.matchAll(new RegExp(AMOUNT, "giu"))].filter((m) => unitWord(m[1]) === unit && valueOf(m[1]) !== valueOf(was));
    if (new Set(others.map((m) => valueOf(m[1]))).size !== 1) return null;
    now = others[0][1];
    nowEnd = (others[0].index ?? 0) + others[0][0].length;
  }
  if (valueOf(was) === valueOf(now)) return null;
  if (!nothingNamedAfter(t, nowEnd)) return null;
  // The meaning check's own reading: exactly these two values of that kind of dose on the line, and their naming
  // words do not point at two different medicines.
  const readings = doseReadings(t);
  const wasR = readings.filter((r) => r.value.replace(",", ".") === valueOf(was));
  const nowR = readings.filter((r) => r.value.replace(",", ".") === valueOf(now));
  if (wasR.length === 0 || nowR.length === 0) return null;
  const unitKind = nowR[0].unit;
  if (wasR.some((r) => r.unit !== unitKind) || nowR.some((r) => r.unit !== unitKind)) return null;
  const values = new Set(readings.filter((r) => r.unit === unitKind).map((r) => r.value.replace(",", ".")));
  if (values.size !== 2) return null;
  // Each dose also must not be followed by a name ("Previously 10 mg aspirin"), and the words before them must agree.
  const filler = new Set(["from", "de", "desde", "từ", "previously", "formerly", "increase", "decrease", "reduce", "change", "to", "a", "à", "hasta", "lên", "xuống", "thành", "đến", "tới"]);
  const namesOf = (rs: typeof readings) => new Set(rs.flatMap((r) => r.names).filter((w) => !filler.has(w)));
  const a = namesOf(wasR);
  const b = namesOf(nowR);
  if (a.size > 0 && b.size > 0 && ![...a].some((w) => b.has(w))) return null;
  for (const m of t.matchAll(new RegExp(AMOUNT, "giu"))) {
    const at = m.index ?? 0;
    if (at >= joined[0] && at < joined[1]) continue;
    if (!nothingNamedAfter(t, at + m[0].length)) return null;
  }
  return { was: was.trim(), now: now.trim() };
}

/** Words that mean the start of a line is an instruction, not a medicine's name. */
const INSTRUCTION =
  /(?<![\p{L}])(?:take|takes|taking|tome|tomar|prenez|prendre|uống|dùng|use|apply|increase|decrease|reduce|lower|raise|adjust|change|switch|aumente|disminuya|reduzca|baje|cambie|ajuste|augmentez|diminuez|réduisez|baissez|changez|modifiez|ajustez|tăng|giảm|đổi|from|desde|từ|to|dose|dosis|liều)(?![\p{L}])|복용|드시|용량|服用|剂量|劑量|ይውሰዱ/iu;

/**
 * The medicine's name as the paper writes it: the words at the very start of the quote, up to its first number
 * ("metformin (GLUCOPHAGE) 500 mg tablet" gives "metformin (GLUCOPHAGE)"). Null when the line starts with an
 * instruction instead ("Stop taking ibuprofen"), or the start is too long to be a name. Copied, never rewritten.
 */
export function medicineName(quote: string): string | null {
  const t = quote.replace(/\s+/g, " ").trim();
  const m = t.match(/^([\p{L}][\p{L}\p{M}\s()'’/.-]*?)\s*\d/u);
  if (!m) return null;
  const name = m[1].trim().replace(/[\s,:;-]+$/u, "");
  if (!name || name.length > 48 || name.split(" ").length > 6) return null;
  const s = signalsOf(name);
  if (s.stop || s.change || s.start || s.keep || s.hold || INSTRUCTION.test(name)) return null;
  return name;
}

/** One medicine step on the card. */
export function medicineChange(it: Item, paper = ""): MedChange | null {
  const c = classifyMedicine(it, paper);
  if (!c) return null;
  return {
    id: it.id,
    row: c.row,
    reason: c.reason,
    name: medicineName(it.source_quote),
    quote: it.source_quote.replace(/\s+/g, " ").trim(),
    dose: c.row === "change" ? doseChangeFromPaper(it.source_quote) : null,
  };
}

/** Every medicine step, by row, in paper order inside each row. Rows with nothing are left out. */
export function medicineChanges(items: Item[], paper = ""): { row: MedRow; list: MedChange[] }[] {
  const all = items.map((it) => medicineChange(it, paper)).filter((c): c is MedChange => c !== null);
  return MED_ROWS.map((row) => ({ row, list: all.filter((c) => c.row === row) })).filter((g) => g.list.length > 0);
}

/** "was 10 mg, now 20 mg": the words a screen reader hears and a printed card shows, not a color. */
export const doseWords = (d: DoseChange) => `was ${d.was}, now ${d.now}`;
