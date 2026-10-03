import { describe, expect, it } from "vitest";
import { combine, fractionsIn, numberCheck, numberCheckAnyForm, numbersIn, unexpectedNumbers } from "./meaning";

const lisinopril = "lisinopril 10 mg tablet. Take 2 tablets (20 mg total) by mouth once daily. Previously 10 mg once daily.";

describe("meaning check: numbers (no AI)", () => {
  it("reads digits, thousands separators and number words", () => {
    expect(numbersIn("Limit salt to 2,000 mg a day, twice")).toEqual(expect.arrayContaining(["2000", "2"]));
    expect(numbersIn("once daily for 5 days")).toEqual(expect.arrayContaining(["1", "5"]));
  });

  it("accepts an explanation whose numbers all come from the paper, in any language", () => {
    expect(unexpectedNumbers({ plain_language: "Take 2 pills (10 mg each) once a day. That is 20 mg total. Before, you took 1 pill.", source_quote: lisinopril })).toEqual([]);
    expect(unexpectedNumbers({ plain_language: "Tome 2 pastillas de 10 mg una vez al día (20 mg en total).", source_quote: lisinopril })).toEqual([]);
    expect(unexpectedNumbers({ plain_language: "Get the A1c test.", when: "in 3 months", source_quote: "Hemoglobin A1c - due in 3 months" })).toEqual([]);
  });

  it("catches a changed dose or interval", () => {
    expect(unexpectedNumbers({ plain_language: "Take 4 pills (40 mg total) once a day.", source_quote: lisinopril })).toEqual(["4", "40"]);
    // "every 2 hours" has no unexpected number (2 is in "2 puffs"), but 2 never goes with hours in the quote, so it is
    // uncheckable and never certified (Codex round 6).
    const albuterol = { plain_language: "Use 2 puffs every 2 hours.", source_quote: "Albuterol inhaler: 2 puffs with spacer every 4 hours as needed" };
    expect(numberCheck(albuterol)).toEqual({ unexpected: [], uncheckable: true });
    expect(unexpectedNumbers({ plain_language: "Use 2 puffs every 6 hours.", source_quote: "Albuterol inhaler: 2 puffs with spacer every 4 hours as needed" })).toEqual(["6"]);
  });
});

describe("meaning check: combining the two signals", () => {
  const item = { id: "item-0", plain_language: "Take 2 pills once a day.", when: "", source_quote: lisinopril };
  it("flags when the second model finds a difference even if the numbers match", () => {
    const r = combine("item-0", { ...item, plain_language: "Stop taking 2 pills once a day." }, "different", "The paper says take, not stop.");
    expect(r.flagged).toBe(true);
    expect(r.numbers_ok).toBe(true);
  });
  it("flags on numbers alone even when the model says same", () => {
    expect(combine("item-0", { ...item, plain_language: "Take 3 pills once a day." }, "same", "").flagged).toBe(true);
  });
  it("does not flag a matching explanation, and an unclear verdict alone is not a flag", () => {
    expect(combine("item-0", item, "same", "").flagged).toBe(false);
    expect(combine("item-0", item, "unclear", "x").flagged).toBe(false);
  });
  it("certifies only an explicit 'same' with matching numbers; unclear or skipped is never shown as checked (Codex 2026-10-02)", () => {
    expect(combine("item-0", item, "same", "").certified).toBe(true);
    expect(combine("item-0", item, "unclear", "The checker did not return this step.").certified).toBe(false);
    expect(combine("item-0", item, "different", "x").certified).toBe(false);
    expect(combine("item-0", { ...item, plain_language: "Take 3 pills once a day." }, "same", "").certified).toBe(false);
  });
});

describe("Codex re-review: number words in every explanation language", () => {
  const two = "Take 2 tablets by mouth.";
  it.each<[string, string, string, string]>([
    ["Spanish", "Tome tres tabletas.", "Tome dos tabletas.", "3"],
    ["Spanish", "Tome una tableta.", "Tome 2 tabletas.", "1"],
    ["French", "Prenez trois comprimés.", "Prenez deux comprimés.", "3"],
    ["Vietnamese", "Uống ba viên.", "Uống hai viên.", "3"],
    ["Korean", "세 알을 드세요.", "두 알을 드세요.", "3"],
    ["Chinese", "服用三片。", "服用两片。", "3"],
    ["Chinese", "一起服用四片。", "一起服用二片。", "4"],
  ])("%s: %s is caught, %s is not", (language, changed, same, n) => {
    expect(unexpectedNumbers({ plain_language: changed, source_quote: two }, language as never)).toEqual([n]);
    expect(unexpectedNumbers({ plain_language: same, source_quote: two }, language as never)).toEqual([]);
    expect(combine("x", { id: "x", plain_language: changed, when: "", source_quote: two }, "same", "", language as never)).toMatchObject({ flagged: true, certified: false, unexpected_numbers: [n] });
  });

  it("tens: twenty-four hours in Spanish and French", () => {
    const q = "Do not eat for 24 hours.";
    expect(unexpectedNumbers({ plain_language: "No coma durante veinticuatro horas.", source_quote: q }, "Spanish")).toEqual([]);
    expect(unexpectedNumbers({ plain_language: "No coma durante treinta y seis horas.", source_quote: q }, "Spanish")).toEqual(["36"]);
    expect(unexpectedNumbers({ plain_language: "Ne mangez rien pendant vingt-quatre heures.", source_quote: q }, "French")).toEqual([]);
    expect(unexpectedNumbers({ plain_language: "Ne mangez rien pendant quarante-huit heures.", source_quote: q }, "French")).toEqual(["48"]);
  });

  it("English explanations are read exactly as before (digits only on this path)", () => {
    expect(unexpectedNumbers({ plain_language: "Take three tablets.", source_quote: two }, "English")).toEqual([]);
    expect(unexpectedNumbers({ plain_language: "Take three tablets.", source_quote: two })).toEqual([]);
    expect(unexpectedNumbers({ plain_language: "Take 3 tablets.", source_quote: two }, "English")).toEqual(["3"]);
  });

  it("Amharic: never certified, with or without a number, since its number words can't be read (Codex round 4)", () => {
    const am = { id: "x", plain_language: "ሁለት ጽላቶችን ይውሰዱ።", when: "", source_quote: two };
    expect(combine("x", am, "same", "", "Amharic").certified).toBe(false);
    expect(combine("x", { ...am, source_quote: "Take your tablets by mouth." }, "same", "", "Amharic").certified).toBe(false);
  });
});

describe("Codex round 5: a fraction is one value, never two whole numbers", () => {
  const base = { id: "x", when: "" };
  const caught = (paper: string, plain: string, lang?: "English" | "Spanish" | "French" | "Vietnamese" | "Chinese" | "Korean") => {
    const any = numberCheckAnyForm({ source_quote: paper, plain_language: plain }, lang);
    return { certified: combine("x", { ...base, source_quote: paper, plain_language: plain }, "same", "", lang).certified, prepBlocked: any.unexpected.length > 0 || any.uncheckable };
  };
  it.each([
    ["Take 1/2 tablet.", "Take 2 tablets."],
    ["Take 1 / 2 tablet.", "Take 2 tablets."],
    ["Take 1⁄2 tablet.", "Take 2 tablets."],
    ["Take 1/2 tablet.", "Take 1 tablet."],
    ["Take 1 1/2 tablets.", "Take 1 tablet."],
    ["Take 1-1/2 tablets.", "Take 1 1/2 tablets."],
    ["Take half a tablet.", "Take 1 tablet."],
    ["Take 1 and a half tablets.", "Take 1 tablet."],
    ["Take 2 tablets.", "Take 1/2 tablet."],
    ["Take 2 tablets.", "Take half a tablet."],
  ])("paper %j, explanation %j: never certified, blocked in prep", (paper, plain) => {
    expect(caught(paper, plain)).toEqual({ certified: false, prepBlocked: true });
  });
  it.each([
    ["Spanish", "Tome media tableta."],
    ["French", "Prenez un demi comprimé."],
    ["Vietnamese", "Uống nửa viên."],
    ["Chinese", "服用半片。"],
    ["Korean", "반 알을 드세요."],
    ["Spanish", "Tome una tableta y media."],
    ["Vietnamese", "Uống một viên rưỡi."],
    ["Chinese", "服用一片半。"],
    ["Korean", "한 알 반을 드세요."],
  ] as const)("%s explanation %j against \"Take 2 tablets\": never certified, blocked in prep", (lang, plain) => {
    expect(caught("Take 2 tablets.", plain, lang)).toEqual({ certified: false, prepBlocked: true });
  });
  it("the same fraction, in any form, still certifies", () => {
    expect(caught("Take 1/2 tablet.", "Take 1/2 tablet.")).toEqual({ certified: true, prepBlocked: false });
    expect(caught("Take 1/2 tablet.", "Take half a tablet.")).toEqual({ certified: true, prepBlocked: false });
    expect(caught("Take 1/2 tablet.", "Tome media tableta.", "Spanish")).toEqual({ certified: true, prepBlocked: false });
    expect(caught("5 hours before your procedure, drink the second half of the bowel prep.", "Drink the second half of the prep 5 hours before.")).toEqual({ certified: true, prepBlocked: false });
    expect(caught("Do not eat after midnight.", "半夜以后不要吃东西。", "Chinese")).toEqual({ certified: true, prepBlocked: false });
    expect(caught("Take 2 tablets.", "반드시 두 알을 드세요.", "Korean")).toEqual({ certified: true, prepBlocked: false });
    expect(fractionsIn("Take 1/2 tablet and 1 1/2 cups.")).toMatchObject({ values: ["1/2"], mixed: true });
  });
});

describe("Codex round 6: the same numbers on swapped units are never certified", () => {
  const base = { id: "x", when: "" };
  const albuterol = "Albuterol inhaler: 2 puffs with spacer every 4 hours as needed";
  it.each([
    [albuterol, "Use 4 puffs every 2 hours.", undefined],
    [albuterol, "Use four puffs every two hours.", "English"],
    [albuterol, "Use 4 puffs as needed.", undefined],
    [albuterol, "Use 2 of them every 2 hours.", undefined],
    [albuterol, "Use 4 inhalaciones cada 2 horas.", "Spanish"],
    [albuterol, "Utilisez 4 bouffées toutes les 2 heures.", "French"],
    [albuterol, "Dùng 4 nhát mỗi 2 giờ.", "Vietnamese"],
    [albuterol, "每2小时吸4次。", "Chinese"],
    ["Take 1 tablet 3 times a day for 7 days.", "Take 3 tablets once a day for 7 days.", undefined],
    ["Drink 8 ounces every 15 minutes.", "Drink 15 ounces every 8 minutes.", undefined],
  ] as const)("paper %j, explanation %j: never certified, blocked in prep", (paper, plain, lang) => {
    expect(combine("x", { ...base, source_quote: paper, plain_language: plain }, "same", "", lang).certified).toBe(false);
    const any = numberCheckAnyForm({ source_quote: paper, plain_language: plain }, lang ?? "English");
    expect(any.unexpected.length > 0 || any.uncheckable).toBe(true);
  });
  it.each([
    [albuterol, "Use 2 puffs every 4 hours when you need it.", undefined],
    [albuterol, "Every 4 hours, use 2 puffs.", undefined],
    [albuterol, "Use two puffs every four hours.", "English"],
    [albuterol, "Use 2 inhalaciones cada 4 horas.", "Spanish"],
    ["Take 2 bisacodyl tablets at 3 PM.", "Take 2 bisacodyl tablets at 3 PM.", undefined],
    ["Arrive at 7:00 AM at Midtown Endoscopy Center, 2nd floor, 100 Sample Street.", "Get there at 7:00 AM, 2nd floor.", undefined],
    ["Call 404-555-0199 if you cannot finish the prep.", "Call 404-555-0199 if you can't finish.", undefined],
  ] as const)("paper %j, explanation %j: still certified and shown", (paper, plain, lang) => {
    expect(combine("x", { ...base, source_quote: paper, plain_language: plain }, "same", "", lang).certified).toBe(true);
    expect(numberCheckAnyForm({ source_quote: paper, plain_language: plain }, lang ?? "English")).toEqual({ unexpected: [], uncheckable: false });
  });
});

describe("Codex round 6: an English number word with a unit is a quantity on the care-plan path", () => {
  const base = { id: "x", when: "" };
  it("\"three tablets\" against \"Take 2 tablets\" is never certified; \"two tablets\" still is", () => {
    expect(combine("x", { ...base, source_quote: "Take 2 tablets.", plain_language: "Take three tablets." }, "same", "").certified).toBe(false);
    expect(combine("x", { ...base, source_quote: "Take 2 tablets.", plain_language: "Take two tablets." }, "same", "").certified).toBe(true);
    expect(combine("x", { ...base, source_quote: "Go to any lab location.", plain_language: "Go to one of the lab locations." }, "same", "").certified).toBe(true);
  });
});

describe("Codex round 7: doses swapped between two medicines are never certified", () => {
  const base = { id: "x", when: "" };
  const paper = "Take warfarin 2 mg and vitamin K 5 mg.";
  const caught = (plain: string, lang?: "English" | "Spanish") => {
    const any = numberCheckAnyForm({ source_quote: paper, plain_language: plain }, lang ?? "English");
    return { certified: combine("x", { ...base, source_quote: paper, plain_language: plain }, "same", "", lang).certified, prepBlocked: any.unexpected.length > 0 || any.uncheckable };
  };
  it.each([
    "Take warfarin 5 mg and vitamin K 2 mg.",
    "Take warfarin 5 mg.",
    "Take vitamin K 2 mg.",
    "Take 5 mg of warfarin and 2 mg of vitamin K.",
  ])("%j: never certified, blocked in prep", (plain) => {
    expect(caught(plain)).toEqual({ certified: false, prepBlocked: true });
  });
  it("the same doses on the same medicines still certify", () => {
    expect(caught("Take warfarin 2 mg and vitamin K 5 mg each day.")).toEqual({ certified: true, prepBlocked: false });
    expect(caught("Take warfarin 2 mg.")).toEqual({ certified: true, prepBlocked: false });
    expect(combine("x", { ...base, source_quote: lisinopril, plain_language: "Take 2 tablets (20 mg total) once a day." }, "same", "").certified).toBe(true);
  });
});

describe("Codex round 8: a shared word like \"insulin\" never lines up swapped doses", () => {
  const base = { id: "x", when: "" };
  const paper = "Inject insulin glargine 10 units and insulin lispro 5 units.";
  const caught = (plain: string) => {
    const any = numberCheckAnyForm({ source_quote: paper, plain_language: plain });
    return { certified: combine("x", { ...base, source_quote: paper, plain_language: plain }, "same", "").certified, prepBlocked: any.unexpected.length > 0 || any.uncheckable };
  };
  it.each([
    "Inject insulin glargine 5 units and insulin lispro 10 units.",
    "Inject insulin 10 units.",
    "Inject lispro insulin 10 units.",
  ])("%j: never certified, blocked in prep", (plain) => {
    expect(caught(plain)).toEqual({ certified: false, prepBlocked: true });
  });
  it("the right doses on the right insulins still certify", () => {
    expect(caught("Inject insulin glargine 10 units and insulin lispro 5 units each day.")).toEqual({ certified: true, prepBlocked: false });
  });
});
