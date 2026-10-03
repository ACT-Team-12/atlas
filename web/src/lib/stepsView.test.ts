import { describe, expect, it } from "vitest";
import { closedRow, sealOf, shortQuote, stepWhen, whenFromText, type WhenGroup } from "./stepsView";
import { SAMPLE_AVS } from "./sample";

describe("whenFromText: the time group from the paper's own words", () => {
  // Every quote here is a line of the sample paper (lib/sample.ts), checked below to be on it word for word.
  const SAMPLE: [string, WhenGroup, string[]][] = [
    ["metformin (GLUCOPHAGE) 500 mg tablet. Take 1 tablet by mouth 2 times a day with meals.", "daily", ["2 times a day"]],
    ["lisinopril 10 mg tablet. Take 2 tablets (20 mg total) by mouth once daily. Previously 10 mg once daily.", "daily", ["once daily", "daily"]],
    ["ibuprofen (ADVIL) 200 mg tablet. Avoid NSAIDs due to kidney function.", "unclear", []],
    ["Hemoglobin A1c - due in 3 months", "later", ["due in 3 months"]],
    ["Basic metabolic panel - fasting, complete within 2 weeks at any Quest or Labcorp location", "soon", ["within 2 weeks"]],
    ["Referral to Ophthalmology for diabetic eye exam. Their office will call you to schedule. If you have not heard from them in 10 days, call 404-555-0134.", "soon", ["in 10 days"]],
    ["Return to clinic in 3 months, or sooner if needed.", "later", ["in 3 months"]],
    ["Check your blood sugar every morning before breakfast and write down the number. Bring your log to your next visit.", "daily", ["every morning"]],
    ["Walk 30 minutes, 5 days a week, as tolerated.", "daily", ["5 days a week"]],
    ["Limit sugary drinks such as soda and sweet tea.", "unclear", []],
  ];
  it.each(SAMPLE)("sample line %#: %s", (quote, group, words) => {
    expect(SAMPLE_AVS.replace(/\s+/g, " ")).toContain(quote);
    const got = whenFromText(quote);
    expect(got.group).toBe(group);
    if (words.length) expect(got.words.filter((w) => !words.includes(w))).toEqual([]);
    else expect(got.words).toEqual([]);
  });

  const EDGE: [string, WhenGroup][] = [
    ["Stop taking aspirin now.", "today"],
    ["Start this medicine today.", "today"],
    ["Starting today, take one pill every morning.", "today"], // today + every day: start today
    ["Take your first dose tonight.", "today"],
    ["Go to the lab right away.", "today"],
    ["Follow up in 1 week.", "soon"],
    ["See the eye doctor in a week.", "soon"],
    ["Call us tomorrow.", "soon"],
    ["Recheck your blood pressure in two weeks.", "soon"],
    ["Follow up in 6 weeks.", "later"],
    ["Within 30 days, schedule a visit.", "later"],
    ["Repeat the test in 1 year.", "later"],
    ["Repeat labs every 3 months.", "later"],
    ["Take 1 tablet twice a day.", "daily"],
    ["Take 1 tablet 3 times daily.", "daily"],
    ["Use the inhaler every 6 hours as needed.", "daily"],
    ["Weigh yourself each morning.", "daily"],
    ["Take at bedtime.", "daily"],
    ["Inject once a week.", "daily"],
    // Lengths, not moments: "for 10 days" says how long, not when.
    ["Take antibiotics for 10 days.", "unclear"],
    // Two moments that disagree: never pick one.
    ["Get labs in 10 days and see the doctor in 3 months.", "unclear"],
    // No time words at all.
    ["Avoid NSAIDs.", "unclear"],
    ["Call 911 if you have chest pain.", "unclear"],
    // "now" inside another word is not "now"; "known" is not a time.
    ["Tell us about any known allergies.", "unclear"],
    // Spanish
    ["Deje de tomar ibuprofeno hoy.", "today"],
    ["Empiece ahora mismo.", "today"],
    ["Tome 1 tableta dos veces al día con las comidas.", "daily"],
    ["Revise su azúcar cada mañana antes del desayuno.", "daily"],
    ["Camine 30 minutos, 5 días a la semana.", "daily"],
    ["Hágase el análisis de sangre dentro de 2 semanas.", "soon"],
    ["Si no le llaman en 10 días, llame al 404-555-0134.", "soon"],
    ["Regrese a la clínica en 3 meses.", "later"],
    ["Hemoglobina A1c en tres meses.", "later"],
    ["Tome antibióticos por 10 días.", "unclear"],
    ["Llame mañana.", "unclear"], // "mañana" alone can be "morning" or "tomorrow": never guessed
    // Any other language: nothing is read, so the step waits under "check the date"
    ["Uống 1 viên mỗi ngày.", "unclear"],
    ["매일 한 알 드세요.", "unclear"],
    ["Prenez un comprimé tous les jours.", "unclear"],
    ["每天服用一片。", "unclear"],
  ];
  it.each(EDGE)("%s -> %s", (quote, group) => {
    expect(whenFromText(quote).group).toBe(group);
  });

  it("keeps the time words exactly as written, in order", () => {
    expect(whenFromText("Starting TODAY, take one pill Every Morning.").words).toEqual(["TODAY", "Every Morning"]);
    expect(whenFromText("Stop right now.").words).toEqual(["right now"]);
  });
});

describe("stepWhen: an uncertified step is never placed by the AI's 'when'", () => {
  const stop = { source_quote: "ibuprofen (ADVIL) 200 mg tablet. Avoid NSAIDs due to kidney function.", when: "Stop now" };
  it("certified, the paper names no time: the AI's 'when' may place it", () => {
    expect(stepWhen(stop, "certified")).toEqual({ group: "today", words: [], from: "explanation" });
  });
  it.each(["unchecked", "flagged"] as const)("%s, the paper names no time: 'Check the date on your paper', whatever the AI says", (check) => {
    expect(stepWhen(stop, check)).toEqual({ group: "unclear", words: [], from: "none" });
  });
  it.each(["certified", "unchecked", "flagged"] as const)("%s: the paper's words win over the AI's 'when'", (check) => {
    const lab = { source_quote: "Basic metabolic panel - fasting, complete within 2 weeks", when: "today" };
    expect(stepWhen(lab, check)).toMatchObject({ group: "soon", from: "paper" });
  });
  it("certified, but the paper's own time words disagree: not rescued by the AI's 'when'", () => {
    expect(stepWhen({ source_quote: "Labs in 10 days, visit in 3 months.", when: "today" }, "certified").group).toBe("unclear");
  });
});

describe("closedRow: what a closed step row may say", () => {
  const it1 = {
    title: "Take 2 lisinopril pills now, not 1",
    when: "Start today · once a day",
    source_quote: "lisinopril 10 mg tablet. Take 2 tablets (20 mg total) by mouth once daily. Previously 10 mg once daily.",
  };
  it("certified: the AI's title and when", () => {
    expect(closedRow(it1, "certified")).toEqual({ lead: "explanation", title: it1.title, when: it1.when });
  });
  it.each(["unchecked", "flagged"] as const)("%s: the paper's words only, never the AI's title or when", (check) => {
    const row = closedRow(it1, check);
    expect(row.lead).toBe("quote");
    const shown = JSON.stringify(row);
    expect(shown).not.toContain(it1.title);
    expect(shown).not.toContain("Start today");
    if (row.lead === "quote") {
      expect(row.quote.endsWith("…")).toBe(true);
      expect(it1.source_quote.startsWith(row.quote.slice(0, -1))).toBe(true);
      expect(row.paperWhen).toEqual(["daily"]);
    }
  });
  it("full keeps the whole quote (warning signs)", () => {
    const warn = { title: "Chest pain: call 911", when: "", source_quote: "Call 911 or go to the nearest emergency room if you have chest pain, trouble breathing, or sudden weakness on one side of your body." };
    const row = closedRow(warn, "unchecked", { full: true });
    expect(row).toMatchObject({ lead: "quote", quote: warn.source_quote, full: true });
  });
});

describe("shortQuote", () => {
  it("leaves a short quote alone", () => expect(shortQuote("Walk 30 minutes.")).toBe("Walk 30 minutes."));
  it("cuts at a word boundary, drops trailing punctuation, adds an ellipsis", () => {
    const q = "Basic metabolic panel - fasting, complete within 2 weeks at any Quest or Labcorp location";
    const s = shortQuote(q, 40);
    expect(s).toBe("Basic metabolic panel - fasting…");
    expect(s.length).toBeLessThanOrEqual(41);
  });
  it("never cuts inside a word", () => {
    const q = "Supercalifragilisticexpialidocious tablets every morning with breakfast and water";
    for (const max of [20, 30, 45, 60]) {
      const s = shortQuote(q, max).replace(/…$/, "");
      expect(q.startsWith(s)).toBe(true);
      expect(q.slice(s.length)).toMatch(/^($|[\s,;:.-])/);
    }
  });
});

describe("sealOf", () => {
  it("folds the checks into one seal", () => {
    expect(sealOf("certified")).toBe("twice");
    expect(sealOf("unchecked")).toBe("once");
    expect(sealOf("flagged")).toBe("recheck");
  });
});
