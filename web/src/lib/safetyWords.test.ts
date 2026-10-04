import { describe, expect, it } from "vitest";
import { stepWhen } from "./stepsView";
import { isWarning, warningFromPaper } from "./warningPin";

/** A medicine step on a paper: the quote is the line (after its bullet), with its span, as the server sends it. */
function med(paper: string, quote: string) {
  const start = paper.indexOf(quote);
  if (start < 0) throw new Error(`not on the paper: ${quote}`);
  return { kind: "medication", source_quote: quote, when: "", span: { start, end: start + quote.length } };
}
const groupOn = (paper: string, quote: string) => stepWhen(med(paper, quote), "unchecked", paper).group;
const inline = (quote: string) => stepWhen({ kind: "medication", source_quote: quote, when: "" }, "unchecked").group;

type Lang = {
  warn: string[];
  notWarn: string[];
  /** A paper with a STOP heading over a list, and the listed line. */
  stopHeading: [string, string];
  stopInline: string[];
  /** Negated, conditional, later-event, limit or how-to-take: never moved under "Right away". */
  notNow: string[];
};

// Real-looking lines, many taken from the public handouts cited in safetyWords.ts.
const LANGS: Record<string, Lang> = {
  vi: {
    warn: ["Hãy gọi ngay 9-1-1 nếu quý vị bị đau ngực hoặc khó thở.", "Đến phòng cấp cứu nếu quý vị bị ngất xỉu.", "ĐÂY LÀ TRƯỜNG HỢP CẤP CỨU!"],
    notWarn: ["Uống 1 viên mỗi sáng sau khi ăn.", "Đây không phải là trường hợp cấp cứu. Gọi phòng khám trong giờ làm việc."],
    stopHeading: ["NGƯNG dùng các thuốc sau:\n- ibuprofen 200 mg viên.", "ibuprofen 200 mg viên."],
    stopInline: ["Ngừng uống aspirin.", "Ngưng dùng naproxen ngay."],
    notNow: ["Không được tự ý ngưng thuốc metformin.", "Đừng ngưng thuốc prednisone đột ngột.", "Ngưng dùng aspirin nếu quý vị bị chảy máu.", "Ngưng dùng thuốc sau 5 ngày.", "Không uống quá 4 viên mỗi ngày.", "Ngưng aspirin trước khi phẫu thuật."],
  },
  ko: {
    warn: ["다음과 같은 경우 911에 전화하여 즉시 도움을 받으십시오: 호흡 곤란.", "가슴 통증이 있으면 응급실로 가십시오.", "숨이 차서 말을 하기 어렵다면 9-1-1 로 전화하십시오."],
    notWarn: ["하루에 두 번 식사와 함께 1정을 복용하십시오.", "응급 상황이 아닙니다. 진료 시간에 병원에 전화하십시오."],
    stopHeading: ["다음 약의 복용을 중단하십시오:\n- 이부프로펜 200mg 정제", "이부프로펜 200mg 정제"],
    stopInline: ["아스피린 복용을 중단하십시오.", "나프록센을 끊으십시오."],
    notNow: ["메트포르민을 임의로 중단하지 마십시오.", "구토하면 메트포르민 복용을 중단하십시오.", "5일 후에 복용을 중단하십시오.", "하루에 4정 이상 복용하지 마십시오.", "항생제 복용 중단 후 최대 3개월 까지 지속될 수 있습니다.", "수술 전에 아스피린을 중단하십시오."],
  },
  zh: {
    warn: ["如果您出现胸痛或呼吸困难，请立即致电911。", "如有严重出血，请前往最近的急救室。", "如果出現嚴重症狀，請致電911或前往急診室就診。"],
    notWarn: ["每天早上服用1片。", "这不是紧急情况，请在工作时间致电诊所。"],
    stopHeading: ["停止服用以下药物：\n1、布洛芬 200毫克", "布洛芬 200毫克"],
    stopInline: ["停用阿司匹林。", "請停用布洛芬。"],
    notNow: ["请勿在未告知您医生的情况下突然停止服用利伐沙班。", "如果出现皮疹，请停用此药。", "在手术前暂时停止服用阿哌沙班。", "不要服用超过4片。", "服药7天后停用。"],
  },
  am: {
    warn: ["ከታች የተዘረዘሩት ካለዎት ወደ 911 ይደውሉ፦ የደረት ህመም", "የመተንፈስ ችግር ካለብዎት ወደ ድንገተኛ ክፍል ይሂዱ።", "ወዲያውኑ ወደ ሐኪምዎ ይደውሉ ወይም ይሂዱ።"],
    notWarn: ["በቀን አንድ ጊዜ አንድ ክኒን ይውሰዱ።", "ይህ ድንገተኛ አይደለም።"],
    stopHeading: ["እነዚህን መድሃኒቶች መውሰድ ያቁሙ፦\n- ኢቡፕሮፌን 200 ሚግ", "ኢቡፕሮፌን 200 ሚግ"],
    stopInline: ["የቲቢ መድኃኒት መውሰድዎን ያቁሙ።", "አስፕሪን አይውሰዱ።"],
    notNow: ["መድሃኒቱን በድንገት አያቁሙ።", "ዶክተርዎ ያቁሙ እስከሚሉዎት ደረስ መውሰድ አለብዎት።", "ሽፍታ ካለብዎት መውሰድ ያቁሙ።", "ከቀዶ ጥገና በፊት አስፕሪን ያቁሙ።"],
  },
  fr: {
    warn: ["Rendez-vous aux urgences si vous avez des difficultés à respirer.", "Appelez le 9-1-1 si vous vous évanouissez.", "Douleur thoracique qui s'aggrave"],
    notWarn: ["Prenez 1 comprimé deux fois par jour avec les repas.", "Ce n'est pas une urgence. Appelez votre médecin pendant les heures d'ouverture."],
    stopHeading: ["ARRÊTEZ de prendre ces médicaments :\n- ibuprofène 200 mg comprimé", "ibuprofène 200 mg comprimé"],
    stopInline: ["Arrêtez l'aspirine.", "Cessez de prendre le naproxène sans délai."],
    notNow: ["N'arrêtez pas de prendre la metformine.", "Ne pas arrêter brusquement la prednisone.", "Arrêtez l'aspirine si vous saignez.", "Arrêtez l'aspirine avant votre chirurgie.", "Ne prenez pas plus de 3000 mg sur une période de 24 heures.", "Arrêtez l'antibiotique après 5 jours."],
  },
};

describe.each(Object.entries(LANGS))("%s: warning and stop words from the paper", (_lang, L) => {
  it.each(L.warn)("pins %s", (q) => {
    expect(warningFromPaper(q)).toBe(true);
    expect(isWarning({ kind: "self_care", source_quote: q })).toBe(true);
  });
  it.each(L.notWarn)("does not pin %s", (q) => {
    expect(isWarning({ kind: "self_care", source_quote: q })).toBe(false);
  });
  it("a medicine under the paper's STOP heading goes under Right away", () => {
    expect(groupOn(...L.stopHeading)).toBe("today");
    // Not a medicine: the kind picks which steps may be read this way.
    const [paper, quote] = L.stopHeading;
    expect(stepWhen({ ...med(paper, quote), kind: "self_care" }, "unchecked", paper).group).toBe("unclear");
  });
  it.each(L.stopInline)("a stop in the quote itself goes under Right away: %s", (q) => {
    expect(inline(q)).toBe("today");
  });
  it.each(L.notNow)("never moved under Right away: %s", (q) => {
    expect(inline(q)).not.toBe("today");
  });
});

describe("the added languages only add caution", () => {
  it("911 written as 9-1-1 or next to non-Latin letters pins; inside a longer number or word it does not", () => {
    for (const q of ["Call 9-1-1 now.", "拨打911", "911에 전화하십시오"]) expect(warningFromPaper(q), q).toBe(true);
    for (const q of ["Room 911B is on the left.", "Call 9110 for billing.", "Order 19-1-1"]) expect(warningFromPaper(q), q).toBe(false);
  });
  it("reads a paper typed with combining accents the same as one typed with precomposed letters", () => {
    const nfd = "Đến phòng cấp cứu nếu quý vị bị ngất xỉu.".normalize("NFD");
    expect(warningFromPaper(nfd)).toBe(true);
    expect(inline("Ngừng uống aspirin.".normalize("NFD"))).toBe("today");
  });
  it("English and Spanish answers are unchanged", () => {
    expect(inline("Do not stop taking metformin.")).toBe("unclear");
    expect(inline("Stop taking aspirin without delay.")).toBe("today");
    expect(warningFromPaper("This is not an emergency. Call your doctor during office hours.")).toBe(false);
    expect(warningFromPaper("Llame al 911 si tiene dolor de pecho.")).toBe(true);
  });
});
