import { describe, expect, it } from "vitest";
import { SAMPLE_AVS } from "./sample";
import { isWarning, warningFromPaper } from "./warningPin";

const SAMPLE_911 = "Call 911 or go to the nearest emergency room if you have chest pain, trouble breathing, or sudden weakness on one side of your body.";

describe("warning pinning: the paper's words can only add caution", () => {
  it("pins the sample paper's 911 line even when the model labeled it something else", () => {
    expect(SAMPLE_AVS).toContain(SAMPLE_911);
    for (const kind of ["self_care", "follow_up_visit", "medication", "referral", "lab_test"]) expect(isWarning({ kind, source_quote: SAMPLE_911 }), kind).toBe(true);
  });

  it.each([
    "Go to the ER if the swelling spreads.",
    "Seek medical care if your fever lasts more than 3 days.",
    "If you have chest pressure, get help right away.",
    "Call us if you feel short of breath.",
    "Go to urgent care if the cut opens.",
    "Call the office right away if your temperature is above 101 F.", // Codex review
    "This is not an emergency, but call 911 if you cannot breathe.",
    "Llame al 911 si tiene dolor de pecho.",
    "Vaya a la sala de emergencias si tiene dificultad para respirar.",
  ])("reads warning language in %s", (q) => {
    expect(warningFromPaper(q)).toBe(true);
    expect(isWarning({ kind: "self_care", source_quote: q })).toBe(true);
  });

  it("a model warning_sign stays pinned even with no warning words (the kind adds caution)", () => {
    expect(isWarning({ kind: "warning_sign", source_quote: "Call the office if your blood sugar is above 300 two times in a row." })).toBe(true);
  });

  it.each([
    "metformin (GLUCOPHAGE) 500 mg tablet. Take 1 tablet by mouth 2 times a day with meals.",
    "Walk 30 minutes, 5 days a week, as tolerated.",
    "Limit sugary drinks such as soda and sweet tea.",
    "Hemoglobin A1c - due in 3 months",
    "Take it after dinner every evening.", // "er" inside words is not "ER"
    "This is not an emergency. Call your doctor during office hours.", // Codex review
    "Call the office if you have questions.",
  ])("leaves ordinary steps unpinned: %s", (q) => {
    expect(isWarning({ kind: "self_care", source_quote: q })).toBe(false);
  });
});
