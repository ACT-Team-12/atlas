import { describe, expect, it } from "vitest";
import { readNumberWords, type NumberLanguage } from "./numberWords";
import { combine, numberCheckAnyForm } from "./meaning";

const COMPOUNDS: Record<Exclude<NumberLanguage, "Amharic">, [string, string, string, string, string]> = {
  English: ["eighty mg", "one hundred mg", "a hundred and twenty mg", "two hundred mg", "five hundred mg"],
  Spanish: ["ochenta mg", "cien mg", "ciento veinte mg", "doscientos mg", "quinientos mg"],
  French: ["quatre-vingts mg", "cent mg", "cent vingt mg", "deux cents mg", "cinq cents mg"],
  Vietnamese: ["tám mươi mg", "một trăm mg", "một trăm hai mươi mg", "hai trăm mg", "năm trăm mg"],
  Korean: ["팔십 밀리그램", "백 밀리그램", "백이십 밀리그램", "이백 밀리그램", "오백 밀리그램"],
  Chinese: ["八十毫克", "一百毫克", "一百二十毫克", "两百毫克", "五百毫克"],
};
const VALUES = ["80", "100", "120", "200", "500"];

describe("Codex round 4: compound numbers in every supported language", () => {
  for (const [lang, texts] of Object.entries(COMPOUNDS)) {
    it.each(texts.map((t, i) => [t, VALUES[i]]))(`${lang}: %s is %s`, (text, n) => {
      expect(readNumberWords(text, lang as NumberLanguage)).toEqual({ numbers: [n], uncheckable: false });
    });
  }
  it("more compounds", () => {
    expect(readNumberWords("treinta y seis horas", "Spanish").numbers).toEqual(["36"]);
    expect(readNumberWords("doscientos cincuenta mg", "Spanish").numbers).toEqual(["250"]);
    expect(readNumberWords("soixante-quinze mg", "French").numbers).toEqual(["75"]);
    expect(readNumberWords("quatre-vingt-dix mg", "French").numbers).toEqual(["90"]);
    expect(readNumberWords("hai mươi tư giờ", "Vietnamese").numbers).toEqual(["24"]);
    expect(readNumberWords("여든 알", "Korean").numbers).toEqual(["80"]);
    expect(readNumberWords("스물네 시간", "Korean").numbers).toEqual(["24"]);
    expect(readNumberWords("二十四小时", "Chinese").numbers).toEqual(["24"]);
    expect(readNumberWords("one hundred and five", "English").numbers).toEqual(["105"]);
  });
});

describe("Codex round 4: numeral text the parser can't read is uncheckable, never \"no number\"", () => {
  it.each<[string, NumberLanguage]>([
    ["服用２片", "Chinese"], ["Tome ½ tableta", "Spanish"], ["ይውሰዱ ፪", "Amharic"], ["Tome dos tres tabletas", "Spanish"],
    ["服用二三片", "Chinese"], ["Uống hai ba viên", "Vietnamese"], ["ሁለት ጽላቶችን ይውሰዱ", "Amharic"],
  ])("%s", (text, lang) => expect(readNumberWords(text, lang).uncheckable).toBe(true));

  it("plain text with no numbers is parsed, not uncheckable", () => {
    expect(readNumberWords("Tome su pastilla con agua.", "Spanish")).toEqual({ numbers: [], uncheckable: false });
    expect(readNumberWords("一起服用", "Chinese")).toEqual({ numbers: [], uncheckable: false });
  });

  it("prep: an uncheckable explanation is blocked", () => {
    expect(numberCheckAnyForm({ plain_language: "Tome ½ tableta.", source_quote: "Take your tablet." }, "Spanish")).toMatchObject({ uncheckable: true });
    expect(numberCheckAnyForm({ plain_language: "Take eighty mg.", source_quote: "Take 8 mg." }, "English").unexpected).toEqual(["80"]);
    expect(numberCheckAnyForm({ plain_language: "Tome quinientos mg.", source_quote: "Take 200 mg." }, "Spanish").unexpected).toEqual(["500"]);
    expect(numberCheckAnyForm({ plain_language: "Tome doscientos mg.", source_quote: "Take 200 mg." }, "Spanish")).toEqual({ unexpected: [], uncheckable: false });
  });

  it("care plan: uncheckable numbers prevent certification; Amharic is never certified", () => {
    const it0 = { id: "x", when: "", source_quote: "Take 200 mg." };
    expect(combine("x", { ...it0, plain_language: "服用２百毫克" }, "same", "", "Chinese").certified).toBe(false);
    expect(combine("x", { ...it0, plain_language: "服用五百毫克" }, "same", "", "Chinese")).toMatchObject({ certified: false, flagged: true, unexpected_numbers: ["500"] });
    expect(combine("x", { ...it0, plain_language: "服用两百毫克" }, "same", "", "Chinese").certified).toBe(true);
    expect(combine("x", { ...it0, source_quote: "Take your tablet.", plain_language: "ጽላትዎን ይውሰዱ።" }, "same", "", "Amharic").certified).toBe(false);
  });
});
