/**
 * "Your medicine changes": every medicine step sorted into STOP, CHANGE, START (and KEEP when the paper says to
 * continue), read from the PAPER'S OWN WORDS only. Pure, no AI, safe in the browser.
 *
 * What decides a row. A medicine step's verified quote, and the list heading it sits under on the paper
 * ("STOP taking these medications:" above "- ibuprofen ..."). Never the AI's title, "when" or explanation: the AI's
 * kind only picks which steps are medicines, as it does for the "Right away" stop rule.
 *
 * - STOP only when stopNowFromPaper (stepsView.ts) also says so, the same rule that puts the step under "Right away",
 *   so the card never shows a Stop the list does not. The reverse is not promised: a stop line the card is unsure of
 *   (say "Stop aspirin, you may bleed") goes to "Ask your pharmacist", still on the card, in the paper's words.
 * - CHANGE, START, KEEP from the word lists below, in the seven app languages.
 * - Anything the words do not settle goes to "Ask your pharmacist", never to a guessed row: a negated action ("do not
 *   stop", "no need to stop"), a condition or a later moment ("if", "until", "when", "after starting"), a
 *   description or history ("you stopped taking it last year", "you may feel dizzy"), a hold ("hold for 2 days, then restart"), two different actions on
 *   one line, a line that disagrees with its heading, a stop word the stop rule does not accept ("do not take more
 *   than"), or no action word at all.
 *
 * Doses. A CHANGE row shows the old dose struck through and the new one only when both are written in the quote
 * ("Previously 10 mg" with one other dose of the same kind, or "from 10 mg to 20 mg" next to a change verb such as
 * "increase", never a range of strengths), the new dose is written once, the number reading of the
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
  | "not_an_instruction" // a description or history ("you stopped taking it last year", "you may feel dizzy")
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

/**
 * Per language: the action words, a hold, a negation of an action, a condition or a later moment ("if", "when",
 * "after starting"), and words that make the line a description or history rather than an instruction ("you stopped
 * taking it last year", "you may feel dizzy"). The last three send the line to "Ask your pharmacist".
 */
type Lists = { start: RegExp; change: RegExp; keep: RegExp; hold: RegExp; neg: RegExp; cond: RegExp; history: RegExp };

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
    String.raw`(?:do${S}not|don['’]t|never|not|no${S}longer)(?:${S}\p{L}+){0,2}${S}(?:stop|discontinue|start|begin|increase|decrease|reduce|lower|raise|change|continue|restart|resume|keep|hold|switch)|no${S}changes?|no${S}need${S}to|need${S}not|needn['’]t|not${S}necessary|unnecessary|without${S}stopping`,
  ),
  // "when", "after", "before" are a later moment, except a meal or bedtime ("before breakfast" is how to take it).
  cond: edged(
    String.raw`if|unless|in${S}case|until|when|whenever|while|after(?!${S}(?:meals?|breakfast|lunch|dinner|supper|eating|food))|before(?!${S}(?:meals?|breakfast|lunch|dinner|supper|eating|food|bed|bedtime|sleep))`,
  ),
  history: edged(
    String.raw`you(?:${S}have)?${S}(?:stopped|started|began|took|were|used)|last${S}(?:year|month|week)|ago|already|in${S}the${S}past|may|might|could|yesterday` +
      // Passive past ("Metformin was started in 2022") and a year that is not a dose ("2000 units" is a dose).
      String.raw`|(?:was|were|has${S}been|have${S}been|had${S}been)${S}(?:\p{L}+${S})?(?:started|stopped|discontinued|increased|decreased|changed|reduced|lowered|raised|adjusted|begun|held)|(?:19|20)\d\d(?!${S}?(?:mg|mcg|units?|iu|ml|g)(?![\p{L}]))`,
  ),
};
const ES: Lists = {
  start: edged(String.raw`empiece|empezar|comience|comenzar|inicie|iniciar|reanude|reanudar|reinicie|reiniciar|vuelva${S}a${S}(?:tomar|empezar)|nuevos?${S}medicamentos?|nuevas?${S}medicinas?`),
  change: edged(String.raw`(?:aumente|disminuya|reduzca|baje|cambie|ajuste)(?:${S}(?:la|su))?${S}dosis|nueva${S}dosis|anteriormente|cambi[eó]${S}a`),
  keep: edged(String.raw`contin[uú]e|continuar|siga${S}tomando|seguir${S}tomando`),
  hold: edged(String.raw`temporalmente|pausa|pause`),
  neg: edged(
    String.raw`(?:no|nunca)(?:${S}\p{L}+){0,2}${S}(?:deje|dejar|suspenda|suspender|empiece|empezar|comience|comenzar|inicie|aumente|disminuya|reduzca|cambie|contin[uú]e|reanude)|sin${S}cambios?|no${S}(?:hay${S}(?:necesidad|que)|es${S}necesario|necesita)`,
  ),
  cond: edged(
    String.raw`si|a${S}menos${S}que|en${S}caso${S}de|hasta${S}que|cuando|mientras|despu[eé]s${S}de(?!${S}(?:las${S})?(?:comidas?|desayun\p{L}*|cenar?|almorzar|comer))|antes${S}de(?!${S}(?:las${S})?(?:comidas?|desayun\p{L}*|cenar?|almorzar|comer|acostarse|dormir))`,
  ),
  history: edged(String.raw`puede|pueden|podr[ií]a|el${S}año${S}pasado|usted${S}(?:dej[oó]|empez[oó]|tomaba)|ayer|fue${S}(?:suspendid[oa]|iniciad[oa]|aumentad[oa]|cambiad[oa]|empezad[oa]|disminuid[oa])`),
};
const FR: Lists = {
  start: edged(String.raw`commencez|commencer|débutez|débuter|reprenez|reprendre|recommencez|recommencer|nouveaux?${S}médicaments?`),
  change: edged(String.raw`(?:augmentez|diminuez|réduisez|baissez|changez|modifiez|ajustez)${S}(?:la|votre)${S}(?:dose|posologie)|nouvelle${S}dose|auparavant|anciennement`),
  keep: edged(String.raw`continuez|continuer|poursuivez|poursuivre`),
  hold: edged(String.raw`temporairement|pause`),
  neg: new RegExp(
    String.raw`(?<![\p{L}\p{N}])(?:ne${S}(?:\p{L}+${S}){0,2}|n['’]\s*)(?:commencez|augmentez|diminuez|réduisez|changez|modifiez|continuez|poursuivez|reprenez|arrêtez|arretez|cessez|interrompez|suspendez)(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(?:aucun${S}changement|pas${S}(?:nécessaire|besoin)|inutile)(?![\p{L}\p{N}])`,
    "iu",
  ),
  cond: edged(
    String.raw`si|s['’]ils?|sauf${S}si|en${S}cas|jusqu['’]à|quand|lorsque|lorsqu['’]\p{L}+|pendant${S}que|après(?!${S}(?:les${S})?(?:repas|manger))|avant(?!${S}(?:les${S})?(?:repas|manger|le${S}coucher|de${S}dormir))`,
  ),
  history: edged(String.raw`peut|peuvent|pourrait|l['’]an${S}dernier|vous${S}avez${S}(?:arrêté|commencé|pris)|hier|a${S}été${S}(?:arrêtée?|commencée?|augmentée?|modifiée?|diminuée?)`),
};
const VI: Lists = {
  start: edged(String.raw`bắt${S}đầu|thuốc${S}mới|dùng${S}lại|uống${S}lại`),
  change: edged(String.raw`tăng${S}liều|giảm${S}liều|đổi${S}liều|thay${S}đổi${S}liều|điều${S}chỉnh${S}liều|liều${S}mới|đổi${S}sang|trước${S}đây`),
  keep: edged(String.raw`tiếp${S}tục|vẫn${S}(?:dùng|uống)`),
  hold: edged(String.raw`tạm${S}(?:ngưng|ngừng|dừng|thời)`),
  neg: edged(String.raw`(?:không|đừng|chớ)(?:${S}\p{L}+){0,3}${S}(?:ngưng|ngừng|dừng|bắt${S}đầu|tăng|giảm|đổi|tiếp${S}tục)|không${S}thay${S}đổi|không${S}cần`),
  cond: edged(String.raw`nếu|trừ${S}khi|trường${S}hợp|cho${S}đến${S}khi|(?:sau|trước)${S}khi(?!${S}(?:ăn|ngủ))|(?<!(?:sau|trước)${S})khi`),
  history: edged(String.raw`có${S}thể|năm${S}ngoái|hôm${S}qua|đã${S}được|đã${S}(?:ngưng|ngừng|dừng|bắt${S}đầu|uống|dùng)`),
};
const KO: Lists = {
  start: bare(String.raw`시작|새로\s*처방|새\s*약|새로운\s*약|재개`),
  change: bare(String.raw`증량|감량|용량\s*(?:을\s*)?(?:늘리|늘려|줄이|줄여|변경|조정)|이전\s*용량|(?:으로|로)\s*변경`),
  keep: bare(String.raw`계속`),
  hold: bare(String.raw`일시\s*중단|잠시\s*중단|일시적으로`),
  neg: bare(String.raw`(?:중단|중지|멈추|끊|시작|증량|감량|늘리|줄이|변경|계속)\p{L}*?지\s*(?:마|말|않)|변경\s*없|필요\s*(?:가|는)?\s*없|않아도`),
  cond: bare(String.raw`경우|만약|만일|때까지|(?<!식)후|(?<!식)전에|때(?!문)`),
  history: bare(String.raw`수\s*있|작년|어제`),
};
const ZH: Lists = {
  start: bare(String.raw`开始|開始|新药|新藥|新处方|新處方|加用|恢复服用|恢復服用|重新服用`),
  change: bare(String.raw`增加剂量|增加劑量|剂量增加|劑量增加|减少剂量|減少劑量|剂量减少|劑量減少|加量|减量|減量|改为|改為|改成|调整剂量|調整劑量|更改剂量|更改劑量|增至|减至|減至|原来|原來|此前`),
  keep: bare(String.raw`继续|繼續`),
  hold: bare(String.raw`暂停|暫停|暂时|暫時`),
  neg: bare(String.raw`(?:不要|不可|不能|不得|请勿|請勿|勿|别|別|切勿)\p{L}{0,6}?(?:停|开始|開始|增加|减少|減少|加量|减量|減量|改|继续|繼續|恢复|恢復)|不变|不變|不需要|不必|无需|無需|不用`),
  cond: bare(String.raw`如果|如若|假如|一旦|如有|直到|(?<![\p{L}])若|(?<![饭飯餐])[后後]|之前|以前|(?<![小暂暫同按及准準])[时時]`),
  history: bare(String.raw`可能|去年|昨天|曾经|曾經|已经|已經|已于|已於`),
};
const AM: Lists = {
  start: bare(String.raw`ይጀምሩ|ጀምሩ|አዲስ\s*መድ[ሀሃሐ]ኒት|አዲስ\s*መድኃኒት|እንደገና`),
  change: bare(String.raw`ይጨምሩ|ይቀንሱ|ይቀይሩ`),
  keep: bare(String.raw`ይቀጥሉ`),
  hold: bare(String.raw`ለጊዜው`),
  neg: bare(String.raw`አይጀምሩ|አይጨምሩ|አይቀንሱ|አይቀይሩ|አያቁሙ|አያቋርጡ|አይቀጥሉ|አያስፈልግም`),
  cond: bare(String.raw`ከሆነ|ካለብዎት|ካጋጠመዎት|ቢያጋጥምዎ|እስከ|በኋላ|በፊት`),
  history: bare(String.raw`ይችላል|ትናንት`),
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

/** A verb that changes a dose. A "from 10 mg to 20 mg" counts as a change only next to one ("strengths range from"). */
const CHANGE_VERB = edged(
  String.raw`increase[sd]?|decrease[sd]?|reduce[sd]?|lower(?:ed)?|raise[sd]?|change[sd]?|switch(?:ed)?|adjust(?:ed)?|aumente|disminuya|reduzca|baje|cambie|ajuste|augmentez|diminuez|réduisez|baissez|changez|modifiez|ajustez|tăng|giảm|đổi|thay${S}đổi|điều${S}chỉnh`,
);
/**
 * The verb must GOVERN the from-to: it opens the clause (an instruction, "Increase lisinopril from 10 mg to 20 mg",
 * "Lisinopril: increase from..."), with at most five words before "from", none of them range words. "Adverse events
 * increase across tablet strengths from 10 mg to 20 mg" is a description of a range, not a change (Codex round 2).
 */
const GOVERNS = new RegExp(String.raw`^(?:[-*•‣–]\s*)?(?:${CHANGE_VERB.source})((?:\s+[\p{L}\p{M}()'’-]+){0,5})\s*$`, "iu");
const RANGE_WORDS = edged(String.raw`ranges?|ranging|across|between|strengths?|available|rango|entre|disponibles?|gamme|khoảng`);
const fromToWithVerb = (t: string) =>
  [...t.matchAll(FROM_TO)].filter((m) => {
    const before = t.slice(0, m.index ?? 0);
    const clause = before.slice(Math.max(...[".", ";", ":", "!", "?", ",", "(", "\n", "。", "；", "："].map((c) => before.lastIndexOf(c))) + 1).trim();
    const g = GOVERNS.exec(clause);
    return !!g && !RANGE_WORDS.test(g[1] ?? "");
  });

/**
 * A negation earlier in the same clause than the first action word: "No need to stop", "No hay necesidad de dejar",
 * "Il n'est pas nécessaire d'arrêter", "不需要停止". The stop phrases that ARE a negation ("do not take", "no tome",
 * "ne prenez pas", "不要服用") start the match themselves, so they still read as a stop.
 */
const NEG_TOKEN = /(?<![\p{L}])(?:not|no|never|without|nunca|sin|ne|pas|jamais|sans|không|đừng|chớ|chưa)(?![\p{L}])|n['’]|[不别別勿无無未没沒]/giu;
function negatedBeforeAction(t: string, actions: RegExp[]): boolean {
  // Commas end a clause here too: "No taper needed, stop prednisone today" is a stop (Codex round 2).
  for (const clause of t.split(/[.;:!?,。；：，]/)) {
    const at = Math.min(...actions.map((re) => { const m = once(re).exec(clause); return m ? m.index : Infinity; }));
    if (!Number.isFinite(at)) continue;
    for (const m of clause.matchAll(NEG_TOKEN)) if ((m.index ?? 0) < at) return true;
  }
  return false;
}

type Signals = { stop: boolean; change: boolean; start: boolean; keep: boolean; hold: boolean; neg: boolean; cond: boolean; history: boolean };

function signalsOf(text: string): Signals {
  const t = prepare(text);
  const any = (pick: (l: Lists) => RegExp) => LANG_LISTS.some(([, l]) => pick(l).test(t));
  const actions = [...STOP_WORDS, ...LANG_LISTS.flatMap(([, l]) => [l.start, l.change, l.keep, l.hold]), CHANGE_VERB];
  // A negation, condition, hold or history word changes an action only in the sentence that holds the action:
  // "Stop taking aspirin now. You may feel dizzy." is a stop (Codex round 2). A sentence with no action word is
  // context, read by no rule here.
  const sentences = t.split(/[.;!?。；\n]/).filter((x) => actions.some((re) => once(re).test(x)) || fromToWithVerb(x).length > 0);
  const inAction = (pick: (l: Lists) => RegExp) => sentences.some((x) => LANG_LISTS.some(([, l]) => pick(l).test(x)));
  return {
    stop: STOP_WORDS.some((re) => re.test(t)),
    change: any((l) => l.change) || fromToWithVerb(t).length > 0,
    start: any((l) => l.start),
    keep: any((l) => l.keep),
    hold: inAction((l) => l.hold),
    neg: inAction((l) => l.neg) || negatedBeforeAction(t, actions),
    cond: inAction((l) => l.cond),
    history: inAction((l) => l.history),
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
  if (both.some((s) => s.history)) return ask("not_an_instruction");
  // A stop word counts only where the "Right away" rule accepts it: every Stop on the card is under "Right away" too.
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
  // Every word to the end of the sentence, not just the first: "20 mg tablet of amlodipine daily" names amlodipine
  // after allowed words (Codex round 2).
  return words.every((w) => AFTER_DOSE_SKIP.has(w) || AFTER_DOSE_OK.has(w));
}

const valueOf = (amount: string) => (amount.match(/\d+(?:[.,]\d+)?/)?.[0] ?? "").replace(",", ".");
const unitWord = (amount: string) => amount.replace(/^[\d.,\s]+/, "").replace(/\s+/g, " ").toLowerCase();

/**
 * The old and new dose, as written in the quote, or null. Never computed, never filled in from anywhere else.
 */
export function doseChangeFromPaper(quote: string): DoseChange | null {
  const t = quote.replace(/\s+/g, " ");
  // A range ("strengths range from 10 mg to 20 mg") is not a change: only a from-to next to a change verb counts.
  const fromTo = fromToWithVerb(t);
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
  // The new dose written once: two medicines on the same new value can't be told apart (Codex review).
  if (wasR.length === 0 || nowR.length !== 1) return null;
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
