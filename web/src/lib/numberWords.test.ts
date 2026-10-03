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

describe("Codex round 5: a singular time or unit word after an article is still a number", () => {
  it.each([
    ["Spanish", "Espere un minuto.", "1"],
    ["Spanish", "Espere un segundo.", "1"],
    ["Spanish", "Use una unidad.", "1"],
    ["French", "Attendez une minute.", "1"],
    ["French", "Attendez une seconde.", "1"],
    ["French", "Appliquez un patch.", "1"],
    ["Vietnamese", "Chờ một phút.", "1"],
    ["Vietnamese", "Chờ một giây.", "1"],
    ["Chinese", "等一分钟。", "1"],
    ["Korean", "한 시간 기다리세요.", "1"],
  ] as const)("%s %j reads %s", (lang, text, n) => {
    expect(readNumberWords(text, lang)).toEqual({ numbers: [n], uncheckable: false });
  });

  it.each([
    ["Spanish", "Espere un minuto."],
    ["French", "Attendez une minute."],
    ["Vietnamese", "Chờ một phút."],
    ["Chinese", "等一分钟。"],
    ["Korean", "일 분 기다리세요."],
    ["English", "Wait one minute."],
  ] as const)("%s %j against \"Wait 2 minutes\" is caught in prep and never certified", (lang, plain) => {
    const quote = "Wait 2 minutes.";
    expect(numberCheckAnyForm({ plain_language: plain, source_quote: quote }, lang).unexpected).toEqual(["1"]);
    // English number words on the care-plan path are left to the second model (meaning.ts numberCheck), so only the
    // other languages are asserted here.
    if (lang !== "English") expect(combine("x", { id: "x", when: "", source_quote: quote, plain_language: plain }, "same", "", lang).certified).toBe(false);
  });

  it("an article before an ordinary noun is still not a number", () => {
    expect(readNumberWords("Llame a un médico.", "Spanish").numbers).toEqual([]);
    expect(readNumberWords("Appelez un médecin.", "French").numbers).toEqual([]);
    expect(readNumberWords("이 병은 위험합니다.", "Korean").numbers).toEqual([]);
  });
});

describe("Codex round 9: English \"a\" and \"an\" before a unit are 1", () => {
  it("reads \"a tablet\" and \"an hour\" as 1, but not \"a doctor\", \"once a day\" or \"half a tablet\"", () => {
    expect(readNumberWords("Take a tablet.", "English").numbers).toEqual(["1"]);
    expect(readNumberWords("Stop eating an hour before.", "English").numbers).toEqual(["1"]);
    expect(readNumberWords("Call a doctor.", "English").numbers).toEqual([]);
    expect(readNumberWords("Take it once a day.", "English").numbers).toEqual(["1"]);
    expect(readNumberWords("Take it twice a day.", "English").numbers).toEqual(["2"]);
    expect(readNumberWords("Take half a tablet.", "English").numbers).toEqual([]);
  });
  it.each([
    ["Take 2 tablets.", "Take a tablet."],
    ["Take 1 tablet.", "Take two tablets."],
    ["Stop 2 days before your procedure.", "Stop a day before your procedure."],
  ])("paper %j, explanation %j: caught in prep, never certified", (quote, plain) => {
    const any = numberCheckAnyForm({ plain_language: plain, source_quote: quote });
    expect(any.unexpected.length > 0 || any.uncheckable).toBe(true);
    expect(combine("x", { id: "x", when: "", source_quote: quote, plain_language: plain }, "same", "").certified).toBe(false);
  });
  it("\"a tablet\" against \"Take 1 tablet\" still certifies", () => {
    expect(combine("x", { id: "x", when: "", source_quote: "Take 1 tablet.", plain_language: "Take a tablet." }, "same", "").certified).toBe(true);
  });
});

describe("Codex round 10: \"vitamin A\" is a name, not 1", () => {
  it.each([
    ["Take vitamin A tablet daily.", "Take 1 tablet daily."],
    ["Take Vitamin A 5000 units daily.", "Take 1 tablet of 5000 units daily."],
    ["Get your hepatitis A shot.", "Get 1 shot."],
  ])("paper %j, explanation %j: caught in prep, never certified", (quote, plain) => {
    const any = numberCheckAnyForm({ plain_language: plain, source_quote: quote });
    expect(any.unexpected.length > 0 || any.uncheckable).toBe(true);
    expect(combine("x", { id: "x", when: "", source_quote: quote, plain_language: plain }, "same", "").certified).toBe(false);
  });
  it("reads no number in \"vitamin A\" or \"Class A\", and still reads \"A tablet\"", () => {
    expect(readNumberWords("Take vitamin A tablet daily.", "English").numbers).toEqual([]);
    expect(readNumberWords("Use the Class A inhaler.", "English").numbers).toEqual([]);
    expect(readNumberWords("A tablet is enough.", "English").numbers).toEqual(["1"]);
  });
});

describe("Codex round 11: a capital A before a unit is still 1", () => {
  it.each([["TAKE A TABLET."], ["Take A tablet."]])("%j against \"Take 2 tablets\" is caught", (plain) => {
    const any = numberCheckAnyForm({ plain_language: plain, source_quote: "Take 2 tablets." });
    expect(any.unexpected.length > 0 || any.uncheckable).toBe(true);
    expect(combine("x", { id: "x", when: "", source_quote: "Take 2 tablets.", plain_language: plain }, "same", "").certified).toBe(false);
  });
});
