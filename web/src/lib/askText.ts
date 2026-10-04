import type { LANGUAGES } from "./schema";
import { warningFromPaper } from "./warningPin";
import type { AskPerson } from "./askPerson";

/**
 * "Ask my paper": every fixed string the feature shows, per app language, plus the two pure rules that decide what
 * may be shown without any AI at all: the urgent-question check and the ready question for a clinic or pharmacist.
 * Pure, no AI, safe in the browser and on the server.
 *
 * Translations: written by the team, not by a model at runtime. The non-English lines still need a native speaker's
 * review before launch; Amharic most of all (same status as pip.ts).
 */

type Lang = (typeof LANGUAGES)[number];

export type AskStrings = {
  title: string;
  intro: string;
  label: string;
  placeholder: string;
  button: string;
  asking: string;
  /** The fixed answer when no quote from the paper survives the checker. Never AI text. */
  refusal: string;
  readyLabel: string;
  readyHint: string;
  /** Built only from the person's own question and these fixed words. */
  readyQuestion: (question: string) => string;
  copy: string;
  copied: string;
  urgentTitle: string;
  urgentBody: string;
  urgentPaper: string;
  /** Over the paper's words when they lead (same wording as paperFirst.ts in English). */
  paperLabel: string;
  /** Over the AI's one-line lead-in, which is never certified (same wording as paperFirst.ts in English). */
  leadNote: string;
  held: (n: number) => string;
  error: string;
};

export const ASK_TEXT: Record<Lang, AskStrings> = {
  English: {
    title: "Ask my paper",
    intro: "Ask a question. ATLAS answers only with your paper's own words, checked word for word. If your paper doesn't say, we tell you.",
    label: "Your question",
    placeholder: "e.g. When do I stop ibuprofen?",
    button: "Ask my paper",
    asking: "Looking in your paper and checking every word...",
    refusal: "Your paper doesn't say. Ask your clinic or pharmacist.",
    readyLabel: "A question ready to ask",
    readyHint: "Show or read this to your clinic or pharmacist. It uses only your own question.",
    readyQuestion: (q) => `My visit paper doesn't answer this: "${q}" Can you help me?`,
    copy: "Copy question",
    copied: "Copied",
    urgentTitle: "This may be an emergency",
    urgentBody: "If this is happening now, call 911 or go to the nearest emergency room. ATLAS does not answer emergency questions. For help that is not an emergency, call 211 (United Way of Greater Atlanta) or your clinic.",
    urgentPaper: "What your paper says about warning signs:",
    paperLabel: "Copied word for word from your paper",
    leadNote: "Plain words (not double-checked yet)",
    held: (n) => `${n} ${n === 1 ? "quote" : "quotes"} from the AI held back because the words were not found on your paper.`,
    error: "Something went wrong. Try again.",
  },
  // NATIVE REVIEW NEEDED (Spanish).
  Spanish: {
    title: "Pregúntele a su papel",
    intro: "Haga una pregunta. ATLAS responde solo con las palabras de su papel, revisadas palabra por palabra. Si su papel no lo dice, se lo decimos.",
    label: "Su pregunta",
    placeholder: "p. ej. ¿Cuándo dejo el ibuprofeno?",
    button: "Preguntarle a mi papel",
    asking: "Buscando en su papel y revisando cada palabra...",
    refusal: "Su papel no lo dice. Pregunte en su clínica o a su farmacéutico.",
    readyLabel: "Una pregunta lista para hacer",
    readyHint: "Muestre o lea esto en su clínica o a su farmacéutico. Usa solo su propia pregunta.",
    readyQuestion: (q) => `Mi papel de la visita no responde esto: "${q}" ¿Me puede ayudar?`,
    copy: "Copiar pregunta",
    copied: "Copiada",
    urgentTitle: "Esto puede ser una emergencia",
    urgentBody: "Si esto está pasando ahora, llame al 911 o vaya a la sala de emergencias más cercana. ATLAS no responde preguntas de emergencia. Para ayuda que no es una emergencia, llame al 211 (United Way of Greater Atlanta) o a su clínica.",
    urgentPaper: "Lo que dice su papel sobre señales de alarma:",
    paperLabel: "Copiado palabra por palabra de su papel",
    leadNote: "En palabras sencillas (todavía sin doble revisión)",
    held: (n) => `${n} ${n === 1 ? "cita" : "citas"} de la IA no se mostraron porque esas palabras no están en su papel.`,
    error: "Algo salió mal. Inténtelo de nuevo.",
  },
  // NATIVE REVIEW NEEDED (Vietnamese).
  Vietnamese: {
    title: "Hỏi giấy của tôi",
    intro: "Hãy đặt câu hỏi. ATLAS chỉ trả lời bằng chính lời trong giấy của bạn, được kiểm tra từng chữ. Nếu giấy không nói, chúng tôi sẽ cho bạn biết.",
    label: "Câu hỏi của bạn",
    placeholder: "vd. Khi nào tôi ngưng ibuprofen?",
    button: "Hỏi giấy của tôi",
    asking: "Đang tìm trong giấy của bạn và kiểm tra từng chữ...",
    refusal: "Giấy của bạn không nói về điều này. Hãy hỏi phòng khám hoặc dược sĩ của bạn.",
    readyLabel: "Câu hỏi soạn sẵn",
    readyHint: "Đưa hoặc đọc câu này cho phòng khám hoặc dược sĩ. Câu này chỉ dùng câu hỏi của chính bạn.",
    readyQuestion: (q) => `Giấy khám bệnh của tôi không trả lời điều này: "${q}" Bạn có thể giúp tôi không?`,
    copy: "Sao chép câu hỏi",
    copied: "Đã sao chép",
    urgentTitle: "Đây có thể là trường hợp cấp cứu",
    urgentBody: "Nếu việc này đang xảy ra, hãy gọi 911 hoặc đến phòng cấp cứu gần nhất. ATLAS không trả lời câu hỏi cấp cứu. Để được giúp đỡ không khẩn cấp, hãy gọi 211 (United Way of Greater Atlanta) hoặc phòng khám của bạn.",
    urgentPaper: "Giấy của bạn nói gì về các dấu hiệu nguy hiểm:",
    paperLabel: "Chép nguyên văn từ giấy của bạn",
    leadNote: "Lời giải thích đơn giản (chưa được kiểm tra lại)",
    held: (n) => `${n} trích dẫn của AI đã bị giữ lại vì không tìm thấy những chữ đó trong giấy của bạn.`,
    error: "Đã có lỗi. Hãy thử lại.",
  },
  // NATIVE REVIEW NEEDED (Korean).
  Korean: {
    title: "내 서류에 물어보기",
    intro: "질문하세요. ATLAS는 서류에 있는 말 그대로만, 한 단어씩 확인해서 답합니다. 서류에 없으면 없다고 알려 드립니다.",
    label: "질문",
    placeholder: "예: 이부프로펜은 언제 끊나요?",
    button: "내 서류에 물어보기",
    asking: "서류에서 찾고 모든 단어를 확인하는 중...",
    refusal: "서류에 나와 있지 않습니다. 병원이나 약사에게 문의하세요.",
    readyLabel: "바로 쓸 수 있는 질문",
    readyHint: "병원이나 약사에게 보여 주거나 읽어 주세요. 본인의 질문만 사용합니다.",
    readyQuestion: (q) => `제 진료 서류에는 이 내용이 없습니다: "${q}" 도와주실 수 있나요?`,
    copy: "질문 복사",
    copied: "복사됨",
    urgentTitle: "응급 상황일 수 있습니다",
    urgentBody: "지금 일어나고 있다면 911에 전화하거나 가장 가까운 응급실로 가세요. ATLAS는 응급 질문에 답하지 않습니다. 응급이 아닌 도움은 211(United Way of Greater Atlanta)이나 병원에 전화하세요.",
    urgentPaper: "위험 신호에 대해 서류에 적힌 내용:",
    paperLabel: "서류에서 그대로 옮긴 말",
    leadNote: "쉬운 설명 (아직 다시 확인되지 않음)",
    held: (n) => `서류에서 찾을 수 없는 AI 인용 ${n}개는 보여 드리지 않았습니다.`,
    error: "문제가 생겼습니다. 다시 시도하세요.",
  },
  // NATIVE REVIEW NEEDED (Chinese, Simplified).
  Chinese: {
    title: "问我的文件",
    intro: "请提问。ATLAS 只用您文件里的原话回答，并逐字核对。如果文件里没有写，我们会告诉您。",
    label: "您的问题",
    placeholder: "例如：我什么时候停用布洛芬？",
    button: "问我的文件",
    asking: "正在文件中查找并逐字核对……",
    refusal: "您的文件里没有写。请询问您的诊所或药剂师。",
    readyLabel: "可以直接问的问题",
    readyHint: "把这句话给诊所或药剂师看或读给他们听。它只用了您自己的问题。",
    readyQuestion: (q) => `我的就诊文件没有回答这个问题："${q}" 您能帮我吗？`,
    copy: "复制问题",
    copied: "已复制",
    urgentTitle: "这可能是紧急情况",
    urgentBody: "如果现在正在发生，请拨打 911 或去最近的急诊室。ATLAS 不回答紧急问题。非紧急的帮助，请拨打 211（United Way of Greater Atlanta）或联系您的诊所。",
    urgentPaper: "您的文件中关于危险信号的内容：",
    paperLabel: "逐字摘自您的文件",
    leadNote: "简单说明（尚未二次核对）",
    held: (n) => `有 ${n} 条 AI 引文因为在您的文件中找不到而未显示。`,
    error: "出了点问题。请再试一次。",
  },
  // NATIVE REVIEW NEEDED (Amharic): highest priority for review.
  Amharic: {
    title: "ወረቀቴን ልጠይቅ",
    intro: "ጥያቄ ይጠይቁ። ATLAS የሚመልሰው በወረቀትዎ ቃላት ብቻ ነው፣ ቃል በቃል ተረጋግጦ። ወረቀትዎ ካልገለጸ እንነግርዎታለን።",
    label: "ጥያቄዎ",
    placeholder: "ለምሳሌ፦ ኢቡፕሮፌን መቼ ላቁም?",
    button: "ወረቀቴን ልጠይቅ",
    asking: "በወረቀትዎ ውስጥ እየፈለግን እያንዳንዱን ቃል እያረጋገጥን ነው...",
    refusal: "ወረቀትዎ ይህን አይገልጽም። ክሊኒክዎን ወይም ፋርማሲስትዎን ይጠይቁ።",
    readyLabel: "ለመጠየቅ የተዘጋጀ ጥያቄ",
    readyHint: "ይህን ለክሊኒክዎ ወይም ለፋርማሲስትዎ ያሳዩ ወይም ያንብቡ። የራስዎን ጥያቄ ብቻ ይጠቀማል።",
    readyQuestion: (q) => `የጉብኝት ወረቀቴ ይህን አይመልስም፦ "${q}" ሊረዱኝ ይችላሉ?`,
    copy: "ጥያቄውን ቅዳ",
    copied: "ተቀድቷል",
    urgentTitle: "ይህ ድንገተኛ ሊሆን ይችላል",
    urgentBody: "ይህ አሁን እየሆነ ከሆነ 911 ይደውሉ ወይም በአቅራቢያ ወዳለው ድንገተኛ ክፍል ይሂዱ። ATLAS የድንገተኛ ጥያቄዎችን አይመልስም። ድንገተኛ ላልሆነ እርዳታ 211 (United Way of Greater Atlanta) ወይም ክሊኒክዎን ይደውሉ።",
    urgentPaper: "ወረቀትዎ ስለ አደገኛ ምልክቶች የሚለው፦",
    paperLabel: "ከወረቀትዎ ቃል በቃል የተገለበጠ",
    leadNote: "ቀላል ማብራሪያ (ገና ድጋሚ አልተረጋገጠም)",
    held: (n) => `በወረቀትዎ ላይ ስላልተገኙ ${n} የAI ጥቅሶች አልታዩም።`,
    error: "ችግር ተፈጥሯል። እንደገና ይሞክሩ።",
  },
  // NATIVE REVIEW NEEDED (French).
  French: {
    title: "Interroger mon document",
    intro: "Posez une question. ATLAS répond uniquement avec les mots de votre document, vérifiés mot pour mot. Si votre document ne le dit pas, nous vous le disons.",
    label: "Votre question",
    placeholder: "ex. Quand dois-je arrêter l'ibuprofène ?",
    button: "Interroger mon document",
    asking: "Recherche dans votre document et vérification de chaque mot...",
    refusal: "Votre document ne le dit pas. Demandez à votre clinique ou à votre pharmacien.",
    readyLabel: "Une question prête à poser",
    readyHint: "Montrez ou lisez ceci à votre clinique ou à votre pharmacien. Elle reprend seulement votre propre question.",
    readyQuestion: (q) => `Mon document de visite ne répond pas à ceci : "${q}" Pouvez-vous m'aider ?`,
    copy: "Copier la question",
    copied: "Copiée",
    urgentTitle: "Cela peut être une urgence",
    urgentBody: "Si cela se produit maintenant, appelez le 911 ou allez aux urgences les plus proches. ATLAS ne répond pas aux questions urgentes. Pour une aide qui n'est pas urgente, appelez le 211 (United Way of Greater Atlanta) ou votre clinique.",
    urgentPaper: "Ce que dit votre document sur les signes d'alerte :",
    paperLabel: "Copié mot pour mot de votre document",
    leadNote: "En mots simples (pas encore vérifié une seconde fois)",
    held: (n) => `${n} ${n === 1 ? "citation" : "citations"} de l'IA retenue${n === 1 ? "" : "s"} car ces mots ne sont pas dans votre document.`,
    error: "Un problème est survenu. Réessayez.",
  },
};

/** The strings in the person's language; any language not in the table falls back to English. */
export function askText(language: string): AskStrings {
  return (ASK_TEXT as Record<string, AskStrings>)[language] ?? ASK_TEXT.English;
}

/** The longest question the route accepts (characters). */
export const MAX_QUESTION = 300;

/** A whole-word pattern with letter-aware edges, as in warningPin.ts. */
const word = (src: string) => new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${src})(?![\p{L}\p{N}])`, "iu");
const S = String.raw`\s+`;

/**
 * How people ASK about an emergency that a paper's warning line would not say: "my chest hurts", "I took too many
 * pills", "he is not breathing". Only adds caution: a question that matches is never sent to the AI.
 */
const ASKED_URGENT = word(
  [
    // English
    String.raw`chest${S}(?:hurts|is${S}hurting)|heart${S}attack|overdos\p{L}*|took${S}too${S}(?:many|much)`,
    String.raw`not${S}breathing|stopped${S}breathing|chok(?:ing|ed)|unconscious|won['’]?t${S}wake${S}up|bleeding${S}(?:a${S}lot|heavily)|won['’]?t${S}stop${S}bleeding`,
    String.raw`kill${S}(?:my|him|her)self|end${S}my${S}life|hurt${S}myself`,
    // Spanish
    String.raw`me${S}duele${S}el${S}pecho|ataque${S}al${S}coraz[oó]n|sobredosis|no${S}puedo${S}respirar|no${S}respira|inconsciente|quitarme${S}la${S}vida`,
    // French
    String.raw`crise${S}cardiaque|surdose|je${S}ne${S}peux${S}(?:pas${S})?respirer|inconscient\p{L}*`,
    // Vietnamese
    String.raw`đau${S}tim|không${S}thở${S}được|quá${S}liều|bất${S}tỉnh`,
  ].join("|"),
);
/** Korean, Chinese and Amharic are matched as substrings (no word edges), as in safetyWords.ts. */
const ASKED_URGENT_CJK_AM = /심장\s*마비|과다\s*복용|숨을\s*못\s*쉬|心脏病发作|心臟病發作|服药过量|服藥過量|喘不上气|不能呼吸|የልብ\s*ድካም|መተንፈስ\s*አልችልም/u;

/**
 * True when the question looks like an emergency happening now. Reuses the paper's warning words (warningPin.ts and
 * safetyWords.ts, all 7 languages) and adds the asking forms above. Errs toward caution: "when should I call 911?"
 * also counts, and gets the 911 / 211 guidance plus the paper's own warning lines instead of an AI answer.
 */
export function isUrgentQuestion(question: string): boolean {
  const t = question.normalize("NFC").replace(/\s+/g, " ");
  return warningFromPaper(t) || ASKED_URGENT.test(t) || ASKED_URGENT_CJK_AM.test(t);
}

/**
 * The ready question when the paper doesn't say: the person's own question inside fixed words, for their clinic or
 * pharmacist. No AI and no paper text, so nothing medical is invented (same shape as askPerson.ts).
 */
export function askAboutQuestion(question: string, language: string): AskPerson {
  const t = askText(language);
  const q = question.replace(/\s+/g, " ").trim().slice(0, MAX_QUESTION);
  return { who: "clinic", label: t.readyLabel, question: t.readyQuestion(q) };
}
