/**
 * Warning and stop words for the app's other languages: Vietnamese, Korean, Chinese, Amharic and French. Pure, no AI,
 * read from the paper's own words only. English and Spanish stay in warningPin.ts and stepsView.ts, unchanged.
 *
 * SAFETY DIRECTION. These lists can only ADD caution. warningFromPaper is "the English/Spanish answer OR this file's",
 * and stopNowFromPaper is "the English/Spanish answer OR this file's", so nothing here can remove a pin or move a step
 * to a later group. A false positive pins a step or lists it under "Right away" (more caution); a false negative is
 * what happened before these lists existed.
 *
 * MATCHING. Text is read with every run of spaces as one space (as the English matcher does) and in Unicode NFC form,
 * so a Vietnamese paper typed with combining accents reads the same as one typed with precomposed letters. Vietnamese
 * and French use whole-word edges like the English list. Korean, Chinese and Amharic are matched as substrings: Chinese
 * has no spaces, and Korean and Amharic attach particles and prefixes to the word ("응급실에", "የደረት"), so word edges
 * would miss them. Their exclusions (negated, conditional, later-event, limits, how-to-take) are listed explicitly.
 *
 * How-to-take: "with" (avec, với, 함께, 同时, ጋር) is an exclusion, as in English ("do not take it with warfarin"),
 * except "with your doctor" / "and contact the doctor at the same time": "stop this medicine and talk with your doctor"
 * is still a stop (Codex review, two rounds).
 *
 * NATIVE-SPEAKER REVIEW NEEDED for every non-English entry below. Amharic is the least certain.
 *
 * Sources. Terms marked "seen" appear in the cited public patient handout; the rest are standard patient-instruction
 * wording that has not yet been checked against a source.
 * - Vietnamese: https://ethnomed.org/wp-content/uploads/2016/06/HeartAttackBrochure-Vietnamese_a11y.pdf (seen: gọi 9-1-1,
 *   cấp cứu, đau ngực, khó thở); index https://medlineplus.gov/languages/vietnamese.html
 * - Korean: https://med.umich.edu/1libr/Pharmacy/Translations/AntibioticDischargeAdultsKOR.pdf (seen: 911에 전화,
 *   즉시, 호흡 곤란, 복용 중단, 중단한 후, 최대, 이상, 경우) and
 *   https://www.med.umich.edu/1libr/Asthma/ActionPlans/AAP12andUpKorean.pdf (seen: 9-1-1, 가슴 조임, 숨이 차, 즉시 병원)
 * - Chinese: https://anticoagulationtoolkit.org/sites/default/files/toolkit_pdfs/patient/handouts_chinese/Rivaroxaban2019MAQIzho-CN.pdf
 *   (seen: 请勿…突然停止服用, 急救室, 胸痛, 胸闷, 呼吸困难, 晕厥, 立即致电 911, 手术前暂时停止服用, 如果, 无法止血) and
 *   https://www.ontariohealth.ca/sites/ontariohealth/files/2023-04/PatientHandoutPaxlovid-TraditionalChinese.pdf
 *   (seen: 急診室, 呼吸困難, 胸痛, 意識喪失, 停用)
 * - Amharic: https://pbws.s3.amazonaws.com/PBWSSaveYourLifeHandout_Amharic.pdf (seen: 911 ይደውሉ, የደረት ህመም,
 *   የመተንፈስ ችግር, የትንፋሽ እጥረት, ድንገተኛ ክፍል), https://www.mass.gov/files/documents/2016/07/rs/ltbi-medicine-instructions-amharic.pdf
 *   (seen: መውሰድዎን ያቁሙ, ወዲያውኑ ወደ ሐኪምዎ ይደውሉ) and
 *   https://www.ceh.org.au/wp-content/uploads/2023/04/Correct_use_of_medicines_Amharic_WEB.pdf (seen: ያቁሙ እስከሚሉዎት,
 *   "until they tell you to stop", which is why እስከ is an exclusion; አይውሰዱ)
 * - French: https://www.med.umich.edu/1libr/Surgery/OrthoSurgery/Translations/InstructionsAfterOrthoSurgeryFRN.pdf (seen:
 *   Appelez le 911, Douleur thoracique, Essoufflement, service des urgences, Arrêtez de prendre, Ne prenez pas plus de),
 *   https://www.med.umich.edu/1libr/CVC/Translations/HeartCathGroinAccessFRN.pdf (seen: Composez immédiatement le 911,
 *   difficultés à respirer, AVC) and
 *   https://myhealth.alberta.ca/Alberta/AlbertaDocuments/COVID-Care-Instructions-After-You-Leave-the-ED-or-UCC-French.pdf
 *   (seen: Appelez le 9-1-1, difficultés respiratoires, douleurs thoraciques, vous vous évanouissez, perdez connaissance)
 */

const S = String.raw`\s+`;
/** Whole-word alternatives (Vietnamese, French) with letter-aware edges, as in warningPin.ts. */
const edged = (src: string) => String.raw`(?<![\p{L}\p{N}])(?:${src})(?![\p{L}\p{N}])`;

/** "911" or "9-1-1" next to any letter but a Latin one ("911에", "拨打911", "9-1-1"), never inside a longer number. */
const EMERGENCY_NUMBER = String.raw`(?<![\p{N}A-Za-z\u00C0-\u024F])(?:911|9-1-1)(?![\p{N}A-Za-z\u00C0-\u024F])`;

const WARNING_VI = [
  String.raw`gọi${S}(?:ngay${S})?(?:cho${S})?cấp${S}cứu|cấp${S}cứu|khẩn${S}cấp`,
  String.raw`đau${S}ngực|tức${S}ngực|khó${S}thở|thở${S}gấp|ngất${S}xỉu|ngất|bất${S}tỉnh|co${S}giật|đột${S}quỵ`,
  String.raw`chảy${S}máu${S}(?:nhiều|không${S}cầm)|(?:đến|đi)${S}bệnh${S}viện${S}ngay`,
  String.raw`gọi${S}(?:cho${S})?(?:bác${S}sĩ|phòng${S}khám)(?:${S}\p{L}+){0,3}${S}ngay`,
].join("|");
const WARNING_FR = [
  String.raw`urgences?|appele[rz]${S}les${S}secours`,
  String.raw`douleurs?${S}(?:thoraciques?|(?:à|dans)${S}la${S}poitrine)|oppression${S}thoracique`,
  String.raw`difficultés?${S}(?:à${S}respirer|respiratoires?)|du${S}mal${S}à${S}respirer|essoufflements?|souffle${S}court`,
  String.raw`évanoui\p{L}*|perte${S}de${S}connaissance|perde[zr]${S}connaissance|convulsions?|crises?${S}d['’]épilepsie|AVC|accident${S}vasculaire${S}cérébral`,
  String.raw`consulte[rz]${S}(?:un${S}médecin${S})?(?:immédiatement|d['’]urgence|sans${S}tarder)|(?:rende[zr]-vous|alle[rz])${S}(?:aux${S}urgences|à${S}l['’]hôpital)`,
  String.raw`appele[rz]${S}(?:votre${S}|le${S})?(?:médecin|cabinet|clinique)${S}(?:immédiatement|tout${S}de${S}suite)`,
  String.raw`saignements?${S}(?:abondants?|importants?|graves?)`,
].join("|");
const WARNING_KO = [
  String.raw`응급|구급차`,
  String.raw`흉통|가슴\s*통증|가슴\s*조임|가슴이\s*(?:아프|조이|답답)`,
  String.raw`호흡\s*곤란|숨이\s*(?:차|가쁘)|숨\s*가쁨|숨쉬기\s*(?:가\s*)?(?:어렵|힘들)`,
  String.raw`기절|실신|의식을\s*잃|발작|경련|뇌졸중`,
  String.raw`즉시\s*(?:병원|의사|의료진|진료)`,
].join("|");
const WARNING_ZH = [
  String.raw`急诊|急診|急救|紧急|緊急`,
  String.raw`胸痛|胸口痛|胸部疼痛|胸闷|胸悶`,
  String.raw`呼吸困难|呼吸困難|呼吸急促|呼吸短促|气短|氣短|喘不过气|喘不過氣`,
  String.raw`晕倒|暈倒|晕厥|暈厥|昏厥|昏倒|失去知觉|失去知覺|意识丧失|意識喪失|抽搐|癫痫发作|癲癇發作|中风|中風`,
  String.raw`立即就医|立即就醫|马上就医|馬上就醫|立即寻求医疗|立即尋求醫療|立即致电|立即致電`,
  String.raw`严重出血|嚴重出血|大量出血|出血不止|无法止血|無法止血`,
].join("|");
const WARNING_AM = [
  String.raw`ድንገተኛ`,
  String.raw`የደረት\s*(?:ህመም|ሕመም)`,
  String.raw`የመተንፈስ\s*ችግር|(?:የ)?ትንፋሽ\s*(?:እጥረት|ማጠር)`,
  String.raw`ራስን\s*መሳት|መናድ|ስትሮክ`,
  String.raw`ወዲያውኑ\s*(?:ወደ\s*)?(?:[ሐሀሃ]ኪም|ሆስፒታል)|ወደ\s*ሆስፒታል\s*ይሂዱ`,
].join("|");

/** Warning words in the five languages, plus 911 written next to non-Latin letters or as 9-1-1. */
const WARNING_MORE = new RegExp([EMERGENCY_NUMBER, edged(WARNING_VI), edged(WARNING_FR), WARNING_KO, WARNING_ZH, WARNING_AM].join("|"), "iu");

/** Emergency words said NOT to apply ("ce n'est pas une urgence", "응급이 아닙니다", "不是紧急情况", "ድንገተኛ አይደለም"). */
const NOT_EMERGENCY_MORE = new RegExp(
  [
    edged(String.raw`không${S}phải(?:${S}\p{L}+){0,3}${S}(?:cấp${S}cứu|khẩn${S}cấp)`),
    edged(String.raw`pas${S}(?:une${S}|d['’]\s*)?urgen\p{L}*|non(?:-|${S})urgen\p{L}*|hors${S}urgence`),
    String.raw`비\s*응급|응급(?:\s*상황)?(?:이|은|는|가)?\s*아(?:닙|닌|니)`,
    String.raw`(?:不是|并非|並非|非)\s*(?:一个|一個)?\s*(?:紧急|緊急|急诊|急診)|不紧急|不緊急`,
    String.raw`ድንገተኛ(?:\s+\p{L}+)?\s+አይደለም|ድንገተኛ\s+ያልሆነ`,
  ].join("|"),
  "giu",
);

/** The paper's text as these lists read it: one space for every run of spaces, Unicode NFC. */
const prepare = (t: string) => t.normalize("NFC").replace(/\s+/g, " ");

/** True when the quote has warning words in Vietnamese, Korean, Chinese, Amharic or French (or 911 as above). */
export function warningFromPaperMore(quote: string): boolean {
  return WARNING_MORE.test(prepare(quote).replace(NOT_EMERGENCY_MORE, " "));
}

/**
 * Stop words per language, each with the words that make a stop NOT start now: negated ("đừng ngưng", "n'arrêtez
 * pas", "중단하지 마십시오", "请勿…停止", "አያቁሙ"), conditional, tied to a later event, a limit, or how to take it.
 * A language's exclusions apply to its own stop words.
 */
const STOP_LANGS: { lang: string; stop: RegExp; notNow: RegExp }[] = [
  {
    lang: "vi",
    stop: new RegExp(edged(String.raw`ngưng|ngừng|dừng|(?:không|đừng)${S}(?:được${S})?(?:dùng|uống)`), "iu"),
    notNow: new RegExp(
      edged(
        [
          String.raw`(?:không|đừng|chớ)(?:${S}\p{L}+){0,3}${S}(?:ngưng|ngừng|dừng)`,
          String.raw`nếu|trừ${S}khi|khi|trường${S}hợp`,
          String.raw`trước|sau${S}(?:khi|\d|một|hai|ba|bốn|năm|vài)`,
          String.raw`quá|nhiều${S}hơn|tối${S}đa|vượt`,
          String.raw`với(?!${S}(?:bác${S}sĩ|dược${S}sĩ|y${S}tá|phòng${S}khám|nhân${S}viên))|cùng${S}lúc|lúc${S}đói|bụng${S}đói|rượu`,
        ].join("|"),
      ),
      "iu",
    ),
  },
  {
    lang: "fr",
    stop: new RegExp(edged(String.raw`arrêt(?:ez|er)|arret(?:ez|er)|cess(?:ez|er)|interromp(?:ez|re)|suspend(?:ez|re)|ne${S}(?:prenez|pas${S}prendre|plus${S}prendre)|n['’]utilisez${S}(?:pas|plus)`), "iu"),
    notNow: new RegExp(
      edged(
        [
          String.raw`n['’]\s*(?:arrêtez|arretez|interrompez|cessez|suspendez)|ne${S}(?:\p{L}+${S}){0,2}(?:arrêt|arret|cess|interromp|suspend)\p{L}*`,
          String.raw`si|s['’]ils?|sauf|lorsque|lorsqu['’]\p{L}+|quand|en${S}cas`,
          String.raw`avant|après|dès${S}que`,
          String.raw`plus${S}de|dépasse[rz]|au-delà|maximum`,
          String.raw`avec(?!${S}(?:votre|le|la|l['’]|un|une)\s*(?:médecin|docteur|pharmacien|infirmi\p{L}+|équipe|clinique|cabinet))|sans(?!${S}(?:délai|tarder|attendre))|à${S}jeun|estomac${S}vide|en${S}même${S}temps|alcool`,
        ].join("|"),
      ),
      "iu",
    ),
  },
  {
    lang: "ko",
    stop: new RegExp(String.raw`중단|중지|멈추|멈춰|끊으|끊고|끊어|복용하지\s*마|드시지\s*마|먹지\s*마|사용하지\s*마|복용\s*금지`, "iu"),
    notNow: new RegExp(
      [
        String.raw`(?:중단|중지|멈추|끊)\p{L}*?지\s*(?:마|말|않)`,
        String.raw`경우|만약|만일|(?:하|으|이|되|나|생기|나타나|있으|없으|않으)면(?![\p{L}])|때(?!문)`,
        String.raw`전에|이전|후에|이후|일\s*후|주\s*후|수술\s*전`,
        String.raw`이상|초과|넘게|넘지|최대`,
        String.raw`(?<!의사와 |의사와|약사와 |약사와|의료진과 |의료진과)(?:함께|같이)|동시에|공복|빈속|식전|식후|술과|술을|음주`,
      ].join("|"),
      "iu",
    ),
  },
  {
    lang: "zh",
    stop: new RegExp(String.raw`停止|停用|停服|停药|停藥|不要(?:再)?(?:服用|吃|使用)|请勿服用|請勿服用|勿服用|禁止服用|不可服用`, "iu"),
    notNow: new RegExp(
      [
        String.raw`(?:不要|不可|不能|不得|请勿|請勿|勿|别|別|切勿)\p{L}{0,24}?停`,
        String.raw`如果|如若|若|假如|一旦|如有|如出现|如出現|(?<![小暂暫同按及准準])[时時]`,
        String.raw`之前|以前|术前|術前|前一天|之后|之後|以后|以後|[天日周週月]后|[天日周週月]後`,
        String.raw`超过|超過|多于|多於|最多`,
        String.raw`空腹|同时(?!联系|聯繫|致电|致電|告知|询问|詢問|就医|就醫)|同時(?!联系|聯繫|致电|致電|告知|询问|詢問|就医|就醫)|一起服用|与\p{L}{1,10}?同服|與\p{L}{1,10}?同服|同服|饮酒|飲酒|酒精`,
      ].join("|"),
      "iu",
    ),
  },
  {
    lang: "am",
    stop: new RegExp(String.raw`ያቁሙ|አቁሙ|ያቋርጡ|አቋርጡ|አይውሰዱ|አትውሰድ|አትውሰጂ`, "iu"),
    notNow: new RegExp(
      [
        String.raw`አያቁሙ|አያቋርጡ|ማቆም\s*የለብዎትም|አታቁም|አታቋርጥ`,
        String.raw`እስከ|ከሆነ|ካለብዎት|ካለዎት|ካጋጠመዎት|ቢያጋጥምዎ|ቢሰማዎ|ከተሰማዎ`,
        String.raw`በፊት|በኋላ`,
        String.raw`በላይ`,
        String.raw`(?<![ሐሀ]ኪምዎ |[ሐሀ]ኪም |ዶክተርዎ |ዶክተር )ጋር|በባዶ\s*ሆድ|አልኮል`,
      ].join("|"),
      "iu",
    ),
  },
];

/**
 * True when, in one of these languages, the quote or its list heading says to stop and neither names anything that
 * makes the stop not start now. Callers check the kind (medicines only) and OR this with the English/Spanish rule.
 */
export function stopNowMore(quote: string, heading: string): boolean {
  const texts = [quote, heading].map((t) => prepare(t).trim()).filter(Boolean);
  return STOP_LANGS.some(({ stop, notNow }) => !texts.some((t) => notNow.test(t)) && texts.some((t) => stop.test(t)));
}

/**
 * A list line for headings in these languages too: "・" and "1、" (no space needed after them) as well as the English
 * markers; a heading may end with ":", "：" (full width) or "፦" (Ethiopic preface colon).
 */
export const BULLET_ANY = /^\s*(?:(?:[-*•‣–]|\d{1,2}[.)])\s+|・|\d{1,2}[、．])/u;
export const HEADING_ENDS = [":", "：", "፦"] as const;

/** The patterns above, for mobile/shared/safety-vectors.json (the phone ports keep the same text). */
export const SAFETY_WORD_PATTERNS: Record<string, RegExp> = {
  WARNING_MORE,
  NOT_EMERGENCY_MORE,
  ...Object.fromEntries(STOP_LANGS.flatMap(({ lang, stop, notNow }) => [[`STOP_${lang.toUpperCase()}`, stop], [`NOT_NOW_${lang.toUpperCase()}`, notNow]])),
  BULLET_ANY,
};
export const STOP_LANG_ORDER = STOP_LANGS.map((l) => l.lang);
