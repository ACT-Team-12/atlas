import { cuesDiffer } from "./prepCues";
import { readable, unreadable } from "./textReading";

/**
 * Deterministic guards a green check must pass, whatever the second model says (Codex round 13).
 *
 * The meaning check can answer "same" for "Take aspirin" against "Do not take aspirin", or for "in the evening"
 * against "in the morning". A word list can't prove two sentences mean the same thing, but it can refuse a green check
 * whenever the explanation names a time, a frequency or an action change that the paper's line does not, or drops or
 * adds a "do not", "stop", "until" or "only". Each concept is listed in every supported language, so an explanation in
 * Spanish is compared with an English paper by concept, not by word. All of this only removes green checks.
 *
 * Pure functions. Safe to import in the browser.
 */

const W = (words: string[]) => new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${words.join("|")})(?![\p{L}\p{N}])`, "iu");

const CONCEPTS: Record<string, RegExp[]> = {
  morning: [W(["morning", "mornings", "am", "a\\.m\\.?", "breakfast", "mañana", "mañanas", "desayuno", "matin", "matinée", "sáng", "buổi sáng"]), /早上|早晨|上午|早饭|早餐|아침|오전/u],
  late: [W(["evening", "evenings", "night", "nights", "tonight", "bedtime", "midnight", "medianoche", "minuit", "nửa đêm", "afternoon", "pm", "p\\.m\\.?", "dinner", "supper", "tarde", "noche", "cena", "soir", "soirée", "nuit", "coucher", "après-midi", "dîner", "tối", "đêm", "chiều", "buổi tối"]), /晚上|夜|睡前|下午|晚饭|晚餐|저녁|밤|자기 전|오후/u],
  before: [W(["before", "prior", "earlier", "antes", "avant", "trước"]), /之前|以前|전에/u],
  after: [W(["after", "afterwards", "later", "después", "luego", "après", "sau"]), /之后|以后|後|후에/u],
  daily: [W(["daily", "every day", "each day", "a day", "per day", "diario", "diaria", "diariamente", "al día", "cada día", "todos los días", "quotidien", "par jour", "chaque jour", "tous les jours", "hằng ngày", "mỗi ngày"]), /每天|每日|매일|하루에/u],
  weekly: [W(["weekly", "every week", "each week", "a week", "per week", "semanal", "a la semana", "cada semana", "hebdomadaire", "par semaine", "chaque semaine", "hằng tuần", "mỗi tuần"]), /每周|每週|매주|일주일에/u],
  monthly: [W(["monthly", "every month", "a month", "per month", "mensual", "al mes", "cada mes", "mensuel", "par mois", "chaque mois", "hằng tháng", "mỗi tháng"]), /每月|매달|매월/u],
  increase: [W(["increase", "increases", "increased", "raise", "raised", "more", "higher", "double", "doubled", "extra", "aumente", "aumentar", "más", "doble", "augmentez", "augmenter", "plus", "tăng", "thêm"]), /增加|加量|加倍|多吃|늘리|더 많이|두 배/u],
  decrease: [W(["decrease", "decreases", "decreased", "lower", "lowered", "reduce", "reduced", "less", "fewer", "cut", "halve", "disminuya", "disminuir", "reduzca", "reducir", "menos", "réduisez", "réduire", "diminuez", "moins", "giảm", "bớt"]), /减少|減少|减量|減量|少吃|줄이|줄여|덜/u],
  start: [W(["start", "starts", "started", "begin", "begins", "new", "empiece", "comience", "empezar", "nuevo", "nueva", "commencez", "commencer", "nouveau", "nouvelle", "bắt đầu", "mới"]), /开始|開始|新的|시작|새로/u],
};

/** The time, frequency and action concepts a text names. */
export function conceptsIn(text: string): Set<string> {
  const t = readable(text); // the same reading the cue lists use (prepCues.ts)
  const out = new Set<string>();
  for (const [name, res] of Object.entries(CONCEPTS)) if (res.some((r) => r.test(t))) out.add(name);
  return out;
}

/**
 * Why an explanation may not get a green check against its paper line (and "when" text), or null when nothing here
 * objects. `paper` is the line plus its "when" text.
 */
export function certifyBlocker(paper: string, plain: string): "empty" | "unreadable" | "cue" | "concept" | null {
  // Every branch that can't positively read both sides refuses (security review of 9f2c70e).
  if (!paper.trim() || !plain.trim()) return "empty";
  if (unreadable(paper) || unreadable(plain)) return "unreadable";
  if (cuesDiffer(paper, plain)) return "cue";
  const have = conceptsIn(paper);
  for (const c of conceptsIn(plain)) if (!have.has(c)) return "concept";
  return null;
}
