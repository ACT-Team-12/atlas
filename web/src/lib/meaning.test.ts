import { describe, expect, it } from "vitest";
import { combine, numbersIn, unexpectedNumbers } from "./meaning";

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
    // Known blind spot: "every 2 hours" passes because 2 appears elsewhere in the quote ("2 puffs").
    // The second model is what catches this one; the meaning eval measures it.
    expect(unexpectedNumbers({ plain_language: "Use 2 puffs every 2 hours.", source_quote: "Albuterol inhaler: 2 puffs with spacer every 4 hours as needed" })).toEqual([]);
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
});
