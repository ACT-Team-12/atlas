/**
 * "Walk me through it": the steps one at a time, big, for someone who is overwhelmed or reads with low vision. Pure
 * rules, no AI: it only re-presents the steps the page already has, in the order the list shows them.
 *
 * - Order is the list's own order (warning signs first, then each time group, earliest first), so "Step 3 of 12" is
 *   the same step as row 3 of the full list.
 * - Pip follows the list's rules (lib/pip.ts, pipSpot and pipQuiet), never a second copy of them: quiet on medicine,
 *   lab, warning and flagged steps, and every line is a fixed one from PIP_LINES.
 * - What the screen says around the step is a FIXED line from the table below, never AI text.
 */

import type { LANGUAGES } from "./schema";
import type { Check } from "./paperFirst";
import { pipQuiet, type PipLine, type PipSpot } from "./pip";
import { WHEN_GROUPS, type WhenGroup } from "./stepsView";

type Lang = (typeof LANGUAGES)[number];

/** Where a step sits in the list: pinned as a warning sign, or in a time group. */
export type WalkGroup = "warning" | WhenGroup;
export type WalkStep<T> = { it: T; group: WalkGroup };

/**
 * The steps in the order the list shows and numbers them: warning signs first, then every time group in WHEN_GROUPS
 * order, paper order inside each. `groupOf` is the list's own grouping (stepWhen), passed in so it is never re-derived.
 */
export function walkSteps<T extends { id: string }>(items: readonly T[], isWarning: (it: T) => boolean, groupOf: (it: T) => WhenGroup): WalkStep<T>[] {
  const warnings = items.filter(isWarning).map((it) => ({ it, group: "warning" as const }));
  const rest = items.filter((it) => !isWarning(it)).map((it) => ({ it, group: groupOf(it) }));
  return [...warnings, ...WHEN_GROUPS.flatMap((g) => rest.filter((s) => s.group === g))];
}

/** Pip on the walk-through screen: nothing, or a marker with its mood and (only when not quiet) a fixed line. */
export type WalkPip = { mood: "arrive" | "cheer" | "quiet"; line: PipLine | null } | null;

/**
 * Pip on the step shown, from the list's own spot (pipSpot). A warning sign or a quiet step (medicine, lab, flagged)
 * never gets a cheer or a line: if it is Pip's spot, a quiet Pip; otherwise no Pip. Otherwise Pip shows only where the
 * list would put it. A cheer belongs to the step just marked done, so it never shows on the next step's screen, where
 * "Nice, that's done" would read as being about that step (Codex review).
 */
export function walkPip(spot: PipSpot, shown: { id: string; kind: string }, check: Check, warning: boolean): WalkPip {
  if (warning || pipQuiet(shown.kind, check)) {
    const here = (spot.at === "step" || spot.at === "greet") && spot.id === shown.id;
    return here ? { mood: "quiet", line: null } : null;
  }
  if (spot.at === "step" && spot.id === shown.id) return { mood: spot.mood, line: spot.line };
  return null;
}

/** Index of the first step at or after `from` that is not done, wrapping around; -1 when every step is done. */
export function nextOpen(steps: readonly { it: { id: string } }[], done: Readonly<Record<string, boolean>>, from: number): number {
  for (let k = 0; k < steps.length; k++) {
    const i = (from + k) % steps.length;
    if (!done[steps[i].it.id]) return i;
  }
  return -1;
}

export type WalkLine =
  | "open" | "openHint" | "progress" | "done" | "doneAlready" | "undoDone" | "notYet" | "askPerson" | "askTitle"
  | "askClinicCall" | "ask211" | "warningLabel" | "warningDo" | "readAloud" | "stop" | "back" | "previous"
  | "finished" | "finishedCount" | "startOver" | "region";

/**
 * Every fixed line on the walk-through screen, per app language. `{n}`, `{total}` and `{done}` are filled in by
 * walkLine. Only position, progress and where to get help; never what to do about your health (the paper says that).
 *
 * Translations: written by the team, not by a model at runtime. The non-English lines (Spanish, Vietnamese, Korean,
 * Chinese, Amharic, French) still need a native speaker's review before launch; Amharic most of all.
 */
export const WALK_LINES: Record<Lang, Record<WalkLine, string>> = {
  English: {
    open: "Walk me through it", openHint: "One step at a time, in big type.", progress: "Step {n} of {total}",
    done: "Done", doneAlready: "Marked done", undoDone: "Not done after all", notYet: "Not yet", askPerson: "Ask a person",
    askTitle: "Ask a person about this step", askClinicCall: "Call your clinic and read them the words from your paper above.",
    ask211: "For help with rides, food, money or anything else, call 211 (United Way of Greater Atlanta) or your community health worker.",
    warningLabel: "Warning sign from your paper", warningDo: "If you have this right now, do what your paper says: call your clinic, or call 911.",
    readAloud: "Read aloud", stop: "Stop", back: "Back to the full list", previous: "Previous step",
    finished: "You went through every step.", finishedCount: "{done} of {total} marked done.", startOver: "Go through the open steps again",
    region: "One step at a time",
  },
  // NATIVE REVIEW NEEDED (Spanish).
  Spanish: {
    open: "Guíeme paso a paso", openHint: "Un paso a la vez, en letra grande.", progress: "Paso {n} de {total}",
    done: "Hecho", doneAlready: "Marcado como hecho", undoDone: "Todavía no está hecho", notYet: "Todavía no", askPerson: "Preguntar a una persona",
    askTitle: "Pregunte a una persona sobre este paso", askClinicCall: "Llame a su clínica y léales las palabras de su papel que están arriba.",
    ask211: "Para ayuda con transporte, comida, dinero u otra cosa, llame al 211 (United Way of Greater Atlanta) o a su trabajador comunitario de salud.",
    warningLabel: "Señal de alerta de su papel", warningDo: "Si tiene esto ahora mismo, haga lo que dice su papel: llame a su clínica o llame al 911.",
    readAloud: "Leer en voz alta", stop: "Parar", back: "Volver a la lista completa", previous: "Paso anterior",
    finished: "Revisó todos los pasos.", finishedCount: "{done} de {total} marcados como hechos.", startOver: "Revisar otra vez los pasos pendientes",
    region: "Un paso a la vez",
  },
  // NATIVE REVIEW NEEDED (Vietnamese).
  Vietnamese: {
    open: "Hướng dẫn tôi từng bước", openHint: "Mỗi lần một bước, chữ lớn.", progress: "Bước {n} / {total}",
    done: "Xong", doneAlready: "Đã đánh dấu xong", undoDone: "Chưa xong", notYet: "Chưa", askPerson: "Hỏi một người",
    askTitle: "Hỏi một người về bước này", askClinicCall: "Gọi phòng khám và đọc cho họ những chữ trong giấy của bạn ở trên.",
    ask211: "Để được giúp về đi lại, thức ăn, tiền bạc hay việc khác, hãy gọi 211 (United Way of Greater Atlanta) hoặc nhân viên y tế cộng đồng của bạn.",
    warningLabel: "Dấu hiệu cảnh báo trong giấy của bạn", warningDo: "Nếu bạn đang bị như vậy, hãy làm theo giấy của bạn: gọi phòng khám, hoặc gọi 911.",
    readAloud: "Đọc to", stop: "Dừng", back: "Quay lại danh sách đầy đủ", previous: "Bước trước",
    finished: "Bạn đã xem hết mọi bước.", finishedCount: "Đã xong {done} / {total}.", startOver: "Xem lại các bước chưa xong",
    region: "Mỗi lần một bước",
  },
  // NATIVE REVIEW NEEDED (Korean).
  Korean: {
    open: "한 단계씩 안내해 주세요", openHint: "한 번에 한 단계씩, 큰 글씨로.", progress: "{total}단계 중 {n}단계",
    done: "완료", doneAlready: "완료로 표시됨", undoDone: "아직 안 했어요", notYet: "아직", askPerson: "사람에게 묻기",
    askTitle: "이 단계에 대해 사람에게 물어보세요", askClinicCall: "병원에 전화해서 위에 있는 서류의 문장을 읽어 주세요.",
    ask211: "교통, 음식, 돈 등 도움이 필요하면 211(United Way of Greater Atlanta)이나 지역 보건 요원에게 전화하세요.",
    warningLabel: "서류에 있는 위험 신호", warningDo: "지금 이런 증상이 있으면 서류에 적힌 대로 하세요: 병원에 전화하거나 911에 전화하세요.",
    readAloud: "소리 내어 읽기", stop: "멈추기", back: "전체 목록으로 돌아가기", previous: "이전 단계",
    finished: "모든 단계를 다 보았어요.", finishedCount: "{total}개 중 {done}개 완료.", startOver: "남은 단계 다시 보기",
    region: "한 번에 한 단계씩",
  },
  // NATIVE REVIEW NEEDED (Chinese, Simplified).
  Chinese: {
    open: "一步一步带我做", openHint: "一次一步，大字显示。", progress: "第 {n} 步，共 {total} 步",
    done: "完成", doneAlready: "已标记完成", undoDone: "其实还没完成", notYet: "还没有", askPerson: "问一个人",
    askTitle: "就这一步问一个人", askClinicCall: "打电话给您的诊所，把上面您文件里的原话读给他们听。",
    ask211: "如需交通、食物、钱或其他方面的帮助，请拨打 211（United Way of Greater Atlanta）或联系您的社区健康工作者。",
    warningLabel: "您文件里的危险信号", warningDo: "如果您现在有这种情况，请按文件说的做：打电话给诊所，或拨打 911。",
    readAloud: "朗读", stop: "停止", back: "返回完整列表", previous: "上一步",
    finished: "您已经看完每一步。", finishedCount: "共 {total} 步，已完成 {done} 步。", startOver: "再看一遍没完成的步骤",
    region: "一次一步",
  },
  // NATIVE REVIEW NEEDED (Amharic): highest priority for review.
  Amharic: {
    open: "ደረጃ በደረጃ አሳዩኝ", openHint: "አንድ ደረጃ በአንድ ጊዜ፣ በትልቅ ፊደል።", progress: "ደረጃ {n} ከ {total}",
    done: "ተጠናቋል", doneAlready: "ተጠናቋል ተብሎ ተመዝግቧል", undoDone: "ገና አልተጠናቀቀም", notYet: "ገና ነው", askPerson: "ሰው ይጠይቁ",
    askTitle: "ስለዚህ ደረጃ ሰው ይጠይቁ", askClinicCall: "ወደ ክሊኒክዎ ይደውሉ እና ከላይ ያሉትን የወረቀትዎን ቃላት ያንብቡላቸው።",
    ask211: "ለትራንስፖርት፣ ለምግብ፣ ለገንዘብ ወይም ለሌላ እርዳታ ወደ 211 (United Way of Greater Atlanta) ወይም ወደ ማህበረሰብ ጤና ሰራተኛዎ ይደውሉ።",
    warningLabel: "ከወረቀትዎ የአደጋ ምልክት", warningDo: "ይህ አሁን ካለብዎ ወረቀትዎ የሚለውን ያድርጉ፦ ወደ ክሊኒክዎ ወይም ወደ 911 ይደውሉ።",
    readAloud: "ጮክ ብለው ያንብቡ", stop: "አቁም", back: "ወደ ሙሉ ዝርዝሩ ይመለሱ", previous: "ቀዳሚ ደረጃ",
    finished: "ሁሉንም ደረጃዎች አይተዋል።", finishedCount: "ከ {total} ውስጥ {done} ተጠናቀዋል።", startOver: "ያልተጠናቀቁትን ደረጃዎች እንደገና ይመልከቱ",
    region: "አንድ ደረጃ በአንድ ጊዜ",
  },
  // NATIVE REVIEW NEEDED (French).
  French: {
    open: "Guidez-moi pas à pas", openHint: "Une étape à la fois, en gros caractères.", progress: "Étape {n} sur {total}",
    done: "Fait", doneAlready: "Marqué comme fait", undoDone: "Pas encore fait finalement", notYet: "Pas encore", askPerson: "Demander à quelqu'un",
    askTitle: "Demandez à quelqu'un pour cette étape", askClinicCall: "Appelez votre clinique et lisez-leur les mots de votre papier ci-dessus.",
    ask211: "Pour de l'aide pour le transport, la nourriture, l'argent ou autre chose, appelez le 211 (United Way of Greater Atlanta) ou votre agent de santé communautaire.",
    warningLabel: "Signe d'alerte de votre papier", warningDo: "Si vous avez cela en ce moment, faites ce que dit votre papier : appelez votre clinique, ou appelez le 911.",
    readAloud: "Lire à voix haute", stop: "Arrêter", back: "Revenir à la liste complète", previous: "Étape précédente",
    finished: "Vous avez parcouru toutes les étapes.", finishedCount: "{done} sur {total} marquées comme faites.", startOver: "Revoir les étapes non faites",
    region: "Une étape à la fois",
  },
};

/** A walk-through line in the person's language (English when the language is not in the table), with values filled in. */
export function walkLine(language: string, line: WalkLine, values: Record<string, number> = {}): string {
  const text = (WALK_LINES as Record<string, Record<WalkLine, string>>)[language]?.[line] ?? WALK_LINES.English[line];
  return text.replace(/\{(\w+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
}
