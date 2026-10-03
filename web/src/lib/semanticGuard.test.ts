import { describe, expect, it } from "vitest";
import { certifyBlocker, conceptsIn } from "./semanticGuard";
import { combine } from "./meaning";
import { PREP_TRUTH } from "./prepPlanted";

const certified = (paper: string, plain: string, language?: "English" | "Spanish") =>
  combine("x", { id: "x", when: "", source_quote: paper, plain_language: plain }, "same", "", language).certified;

describe("semanticGuard: every branch that can't establish sameness refuses (security review of 9f2c70e)", () => {
  it.each([
    ["zero-width space inside a word", "Take your pill in the morning.", "Take your pill in the eve​ning."],
    ["soft hyphen inside a word", "Take your pill in the morning.", "Take your pill in the eve­ning."],
    ["Cyrillic look-alike letter", "Take your pill in the morning.", "Take your pill in the еvening."],
    ["fullwidth letters", "Take your pill in the morning.", "Take your pill in the ｅｖｅｎｉｎｇ."],
    ["decomposed accent (NFD)", "Take your pill before meals.", "Tome su pastilla después de comer."],
    ["Greek look-alike in a do-not", "Do not take aspirin.", "Dο take aspirin."],
    ["empty explanation", "Take your pill.", ""],
    ["empty paper", "", "Take your pill."],
    ["zero-width space inside the paper's do-not", "Do n\u200Bot take aspirin.", "Take aspirin."],
    ["unsupported script", "Take your pill in the morning.", "กินยาตอนเย็น"],
  ])("%s: never certified", (_name, paper, plain) => {
    expect(certifyBlocker(paper, plain)).not.toBeNull();
    expect(certified(paper, plain)).toBe(false);
  });

  it("is the same reading for every Unicode form of the same text (no parser differential)", () => {
    const texts = [
      ...PREP_TRUTH.flatMap((t) => [t.quote, t.plain]),
      "Tómela después de comer por la noche.", "Prenez-le le soir après le dîner.", "Uống thuốc vào buổi sáng.",
      "Take two tablets in the morning and one at bedtime.", "Do not eat or drink after midnight.",
    ];
    for (const t of texts) {
      const base = [...conceptsIn(t)].sort();
      for (const form of ["NFC", "NFD", "NFKC", "NFKD"] as const) expect([...conceptsIn(t.normalize(form))].sort(), `${form}: ${t}`).toEqual(base);
      expect([...conceptsIn(t.toUpperCase())].sort(), `upper: ${t}`).toEqual(base);
    }
  });

  it("a faithful explanation still passes, in English and Spanish", () => {
    expect(certifyBlocker("Take your pill in the morning.", "Take your pill in the morning.")).toBeNull();
    expect(certifyBlocker("Take your pill in the morning.", "Tome su pastilla por la mañana.")).toBeNull();
    expect(certified("Take your pill in the morning.", "Tome su pastilla por la mañana.", "Spanish")).toBe(true);
  });
});
