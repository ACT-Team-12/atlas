/**
 * Generates mobile/shared/safety-vectors.json: the web reference for the safety rules the phone apps port by hand,
 * so iOS and Android are checked against the same table as the website.
 *
 * - "patterns": the exact source and flags of every pattern the rules use. The ports keep the same pattern text and
 *   their tests fail when it differs, so a word added on the web cannot be missing on a phone.
 * - "warning": which steps are pinned as warning signs (web/src/lib/warningPin.ts isWarning / warningFromPaper).
 *
 * Not part of the web suite. CI regenerates it with mobile/shared/check-vectors.sh (web-ci) and fails when the
 * committed file differs. To regenerate by hand:
 *   cp mobile/shared/genSafetyVectors.test.ts web/src/lib/
 *   cd web && VECTORS_OUT=../mobile/shared/safety-vectors.json pnpm exec vitest run src/lib/genSafetyVectors.test.ts
 *   rm src/lib/genSafetyVectors.test.ts
 */
import { writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { isWarning, warningFromPaper, WARNING_PATTERNS } from "./warningPin";
import { SAMPLE_AVS } from "./sample";
import papersFile from "../data/eval/papers.json";

const papers = (papersFile as { papers: { id: string; text: string }[] }).papers;
const pattern = (re: RegExp) => ({ source: re.source, flags: re.flags });
const lines = (text: string) => text.split("\n").map((l) => l.trim()).filter(Boolean);

/** Hand-written lines: the warningPin tests' own cases plus edges a port can get wrong (case, spacing, word edges). */
const WARNING_LINES = [
  "Call 911 or go to the nearest emergency room if you have chest pain, trouble breathing, or sudden weakness on one side of your body.",
  "Go to the ER if the swelling spreads.",
  "Seek medical care if your fever lasts more than 3 days.",
  "If you have chest pressure, get help right away.",
  "Call us if you feel short of breath.",
  "Go to urgent care if the cut opens.",
  "Call the office right away if your temperature is above 101 F.",
  "This is not an emergency, but call 911 if you cannot breathe.",
  "Call our office right away if your fever is over 101 F.",
  "Call the doctor's office immediately if the wound bleeds.",
  "Call the doctor\u2019s office immediately if the wound bleeds.",
  "Llame al 911 si tiene dolor de pecho.",
  "Vaya a la sala de emergencias si tiene dificultad para respirar.",
  "Busque atención médica si se desmaya.",
  "Si tiene convulsiones, llame al 911.",
  "No es una emergencia. Llame a la clínica en horario de oficina.",
  "metformin (GLUCOPHAGE) 500 mg tablet. Take 1 tablet by mouth 2 times a day with meals.",
  "Walk 30 minutes, 5 days a week, as tolerated.",
  "Limit sugary drinks such as soda and sweet tea.",
  "Hemoglobin A1c - due in 3 months",
  "Take it after dinner every evening.",
  "This is not an emergency. Call your doctor during office hours.",
  "Call the office if you have questions.",
  "This is a non-emergency line.",
  "It is not urgent.",
  "Go to the er if needed.",
  "Peter will call you.",
  "CALL 911 IF YOU HAVE CHEST PAIN.",
  "call\u00a0911\u00a0now",
  "Call 9110 for billing.",
  "Room 911B is on the left.",
  "Seek care.",
  "Seek prompt medical attention.",
  "You may feel faint when you stand up.",
  "Watch for signs of a stroke.",
  "Severe headache or sudden numbness: go to the hospital.",
  "Go to the nearest hospital.",
  "Get medical help right away if you have a rash.",
  "If you have thoughts of suicide, call 988.",
  "Do not drive for 24 hours after the procedure.",
  "",
];

it("writes the vectors", () => {
  const seen = new Set<string>();
  const warning: { quote: string; kind: string; paper: boolean; pinned: boolean }[] = [];
  const add = (quote: string, kind = "self_care") => {
    const key = `${kind}\u0000${quote}`;
    if (seen.has(key)) return;
    seen.add(key);
    warning.push({ quote, kind, paper: warningFromPaper(quote), pinned: isWarning({ kind, source_quote: quote }) });
  };
  for (const q of WARNING_LINES) add(q);
  for (const q of lines(SAMPLE_AVS)) add(q);
  for (const p of papers) for (const q of lines(p.text)) add(q);
  // The model's kind only adds: a warning_sign is pinned whatever its words, any other kind only by its words.
  for (const q of ["Call the office if your blood sugar is above 300 two times in a row.", "Take 1 tablet daily.", ""]) add(q, "warning_sign");
  for (const kind of ["medication", "lab_test", "referral", "follow_up_visit", "unknown_kind"]) add(WARNING_LINES[0], kind);

  // The table must exercise both answers, or a port that always says yes (or no) would pass.
  expect(warning.filter((w) => w.paper).length).toBeGreaterThan(20);
  expect(warning.filter((w) => !w.paper).length).toBeGreaterThan(20);

  const out = process.env.VECTORS_OUT;
  if (!out) throw new Error("set VECTORS_OUT");
  const doc = {
    about: "Web reference vectors for the safety rules (web/src/lib/warningPin.ts). Regenerate: see mobile/shared/README.md.",
    patterns: Object.fromEntries(Object.entries(WARNING_PATTERNS).map(([k, re]) => [k, pattern(re)])),
    warning,
  };
  writeFileSync(out, JSON.stringify(doc, null, 1) + "\n");
});
