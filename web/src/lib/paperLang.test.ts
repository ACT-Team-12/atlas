import { describe, expect, it } from "vitest";
import { detectPaperLang } from "./paperLang";
import { paperLangCode } from "@/ui/UiLang";
import { SAMPLE_AVS } from "./sample";

/** Short after-visit papers written by the team for this test, one per app language (not real patients). */
const PAPERS: Record<string, string> = {
  en: SAMPLE_AVS,
  es: "Tome 1 tableta por la boca dos veces al día con las comidas. Llame a su médico si tiene fiebre. Regrese en dos semanas para una cita de control de la presión.",
  fr: "Prenez 1 comprimé par la bouche deux fois par jour avec les repas. Appelez votre médecin si vous avez de la fièvre. Revenez dans deux semaines pour un contrôle de la tension.",
  vi: "Uống 1 viên thuốc mỗi ngày hai lần cùng với bữa ăn. Gọi bác sĩ nếu quý vị bị sốt. Quay lại sau hai tuần để kiểm tra huyết áp.",
  ko: "metformin 500 mg: 하루 두 번 식사와 함께 1정을 드세요. 열이 나면 의사에게 전화하세요. 2주 후에 혈압 검사를 받으러 오세요.",
  zh: "metformin 500 mg：每天两次，随餐口服 1 片。如果发烧，请给医生打电话。两周后回来复查血压。",
  am: "metformin 500 mg፦ በቀን ሁለት ጊዜ ከምግብ ጋር 1 ኪኒን ይውሰዱ። ትኩሳት ካለብዎ ለሐኪምዎ ይደውሉ። ከሁለት ሳምንት በኋላ ለደም ግፊት ምርመራ ይመለሱ።",
};

describe("the paper's own language, for its quotes' lang attribute (Codex review of PR 93, round 4)", () => {
  for (const [code, paper] of Object.entries(PAPERS)) {
    it(`a paper in ${code} is ${code}`, () => {
      expect(detectPaperLang(paper)).toBe(code);
      expect(paperLangCode(paper)).toBe(code);
    });
  }

  // Short lines, near the 20 characters the app accepts (Codex review, round 5).
  const SHORT: Record<string, string> = {
    en: "Take metformin at noon.",
    es: "Tome la medicina ahora.",
    fr: "Prenez le comprimé ce soir.",
    vi: "Uống 1 viên metformin mỗi ngày.",
    ko: "매일 아침 약을 드세요.",
    zh: "每天早上吃一片药。",
    am: "በየቀኑ ጠዋት መድኃኒት ይውሰዱ።",
  };
  for (const [code, line] of Object.entries(SHORT)) {
    it(`a short line in ${code} is ${code}`, () => expect(detectPaperLang(line)).toBe(code));
  }

  it("says nothing rather than something wrong", () => {
    expect(detectPaperLang("")).toBe("");
    expect(detectPaperLang("500 mg 2x")).toBe(""); // no words to tell from
    expect(detectPaperLang("1日2回、食後に1錠を服用してください。")).toBe(""); // Japanese: not an app language
    // English and Spanish evenly mixed: neither one is the paper's language.
    expect(detectPaperLang("Take 1 tablet with meals every day. Tome 1 tableta con las comidas cada día.")).toBe("");
    expect(detectPaperLang("Nehmen Sie täglich eine Tablette.")).toBe(""); // German: too few known words
  });

  it("Traditional Chinese is still Chinese", () => {
    expect(detectPaperLang("每天兩次，隨餐口服一片。如果發燒，請給醫生打電話。")).toBe("zh");
  });
});
