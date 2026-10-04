/**
 * Generates mobile/shared/safety-vectors.json: the web reference for the safety rules the phone apps port by hand,
 * so iOS and Android are checked against the same table as the website.
 *
 * - "patterns": the exact source and flags of every pattern the rules use. The ports keep the same pattern text and
 *   their tests fail when it differs, so a word added on the web cannot be missing on a phone.
 * - "warning": which steps are pinned as warning signs (web/src/lib/warningPin.ts isWarning / warningFromPaper).
 * - "when", "heading", "step": the "Your steps" by-when groups (web/src/lib/stepsView.ts whenFromText, listHeading and
 *   stepWhen, which also puts a medicine the paper says to stop under "Right away"). "step" cases name a paper in
 *   "papers" and carry the step's span on it, as the server sends it.
 * - "when_rule_groups" and "num_words": the tables whenFromText reads beside its patterns.
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
import { listHeading, NUM_WORDS, stepWhen, STEPS_PATTERNS, whenFromText, WHEN_GROUP_LABEL, WHEN_GROUPS, WHEN_RULE_GROUPS } from "./stepsView";
import type { Check } from "./paperFirst";
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

/** Time words: the stepsView tests' own lines plus edges (Spanish letters, negation, number words, clashes). */
const WHEN_LINES = [
  "Stop taking aspirin now.", "Start this medicine today.", "Starting today, take one pill every morning.", "Take your first dose tonight.",
  "Go to the lab right away.", "Follow up in 1 week.", "See the eye doctor in a week.", "Call us tomorrow.", "Recheck your blood pressure in two weeks.",
  "Follow up in 6 weeks.", "Within 30 days, schedule a visit.", "Repeat the test in 1 year.", "Repeat labs every 3 months.", "Take 1 tablet twice a day.",
  "Take 1 tablet 3 times daily.", "Use the inhaler every 6 hours as needed.", "Weigh yourself each morning.", "Take at bedtime.", "Inject once a week.",
  "Take antibiotics for 10 days.", "Get labs in 10 days and see the doctor in 3 months.", "Avoid NSAIDs.", "Call 911 if you have chest pain.",
  "Tell us about any known allergies.", "Deje de tomar ibuprofeno hoy.", "Empiece ahora mismo.", "Tome 1 tableta dos veces al día con las comidas.",
  "Revise su azúcar cada mañana antes del desayuno.", "Camine 30 minutos, 5 días a la semana.", "Hágase el análisis de sangre dentro de 2 semanas.",
  "Si no le llaman en 10 días, llame al 404-555-0134.", "Si le llaman en 10 días, vaya a la cita.", "Do not start this medicine today.",
  "Don't take it every day.", "Don\u2019t take it every day.", "Never stop it now.", "No empiece hoy.", "Stop taking it today. Do not restart.",
  "Take both pills at once.", "Tome o remédio esta tarde, não amanhã.", "Commencez ce médicament aujourd'hui à la maison, ça va.",
  "Regrese a la clínica en 3 meses.", "Hemoglobina A1c en tres meses.", "Tome antibióticos por 10 días.", "Llame mañana.", "Stop right now.",
  "Return in 0 days.", "Return in fourteen days.", "Return in fifteen days.", "Come back in 2 weeks, then every day after.", "Walk daily.\nRest nightly.",
  "Take it in the next 3 days.", "Due in 12 months.", "Vuelva el próximo mes.", "Cada 6 meses, hágase el examen.", "Tómelo al acostarse.",
  "In a few days, call us.", "This week, see the nurse.", "La semana que viene, vaya al laboratorio.", "Take 2 times per day.",
  "TAKE ONE TABLET DAILY.", "Use it 3 days a week.", "Por día, tome 2 tabletas.", "", "   ",
];

/** Papers for the step cases: the sample, the eval papers and lists under STOP headings (the after-visit layout). */
const STEP_PAPERS: Record<string, string> = {
  sample: SAMPLE_AVS,
  "stop-list": "Medications\nSTOP taking these medications:\n- ibuprofen 200 mg tablet.\n- naproxen 220 mg tablet.\nCONTINUE taking these medications:\n- metformin 500 mg tablet. Take 1 tablet 2 times a day.",
  "stop-conditional": "STOP taking these medications if your kidney test is high:\n- ibuprofen 200 mg tablet.",
  "stop-gap": "STOP taking these medications:\n\nibuprofen 200 mg tablet.",
  "stop-numbered": "Stop these medicines:\n1. aspirin 81 mg tablet\n2) warfarin 5 mg tablet",
  "stop-es": "DEJE de tomar estos medicamentos:\n- ibuprofeno 200 mg tableta.\nSIGA tomando estos medicamentos:\n- metformina 500 mg tableta, dos veces al día.",
  "stop-inline": "Discontinue naproxen.\nDo not take aspirin.\nNo tome ibuprofeno.\nStop taking aspirin without delay.\nDo not stop taking metformin.\nNo deje de tomar metformina.\nStop taking metformin if you are vomiting.\nStop aspirin before your surgery.\nDo not take more than 4 tablets.\nDo not suddenly stop taking prednisone.\nDo not take prednisone on an empty stomach.\nDo not take ibuprofen with alcohol.\nStop it with no delay.\nSuspenda la aspirina sin demora.",
};
for (const p of papers) STEP_PAPERS[`eval:${p.id}`] = p.text;
const BULLET_PREFIX = /^\s*(?:[-*•‣–]|\d{1,2}[.)])\s+/u;

/** Each line of a paper as a step: the quote without its bullet, and its span on the paper. */
function paperSteps(text: string): { quote: string; span: { start: number; end: number } }[] {
  const out: { quote: string; span: { start: number; end: number } }[] = [];
  let at = 0;
  for (const line of text.split("\n")) {
    const pre = BULLET_PREFIX.exec(line)?.[0].length ?? 0;
    const quote = line.slice(pre).trimEnd();
    if (quote.trim()) out.push({ quote, span: { start: at + pre, end: at + pre + quote.length } });
    at += line.length + 1;
  }
  return out;
}

/** The checks and AI "when" values each step is tried with: the AI's words may only place a certified step. */
const STEP_VARIANTS: [Check, string][] = [["certified", ""], ["certified", "in 3 months"], ["certified", "Stop now"], ["unchecked", "today"], ["flagged", "every day"]];

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

  const when = [...new Set([...WHEN_LINES, ...lines(SAMPLE_AVS), ...papers.flatMap((p) => lines(p.text))])].map((text) => ({ text, ...whenFromText(text) }));
  expect(new Set(when.map((w) => w.group)).size).toBe(WHEN_GROUPS.length);

  const heading: { paper: string; span: { start: number; end: number } | null; heading: string }[] = [];
  const step: { paper: string; quote: string; span: { start: number; end: number } | null; kind: string; check: Check; when: string; expected: ReturnType<typeof stepWhen> }[] = [];
  for (const [name, text] of Object.entries(STEP_PAPERS)) {
    for (const st of paperSteps(text)) {
      heading.push({ paper: name, span: st.span, heading: listHeading(text, st.span) });
      for (const kind of ["medication", "self_care"]) {
        for (const [check, w] of STEP_VARIANTS) {
          // Without a span only the quote can say "stop" (no heading is found): tried once per kind.
          for (const span of check === "certified" && w === "" ? [st.span, null] : [st.span]) {
            const it = { source_quote: st.quote, when: w, kind, span };
            step.push({ paper: name, quote: st.quote, span, kind, check, when: w, expected: stepWhen(it, check, text) });
          }
        }
      }
    }
  }
  // Spans a client can send that point nowhere useful.
  for (const span of [{ start: -1, end: 3 }, { start: 100000, end: 100001 }, { start: 0, end: 0 }]) heading.push({ paper: "stop-list", span, heading: listHeading(STEP_PAPERS["stop-list"], span) });
  heading.push({ paper: "stop-list", span: null, heading: listHeading(STEP_PAPERS["stop-list"], null) });
  expect(heading.filter((h) => h.heading).length).toBeGreaterThan(3);
  expect(step.filter((s) => s.expected.group === "today" && s.expected.words.length === 0 && s.expected.from === "paper").length, "stop-now cases").toBeGreaterThan(10);
  expect(new Set(step.map((s) => s.expected.from)).size).toBe(3);

  const out = process.env.VECTORS_OUT;
  if (!out) throw new Error("set VECTORS_OUT");
  const doc = {
    about: "Web reference vectors for the safety rules (web/src/lib/warningPin.ts, web/src/lib/stepsView.ts). Regenerate: see mobile/shared/README.md.",
    patterns: Object.fromEntries(Object.entries({ ...WARNING_PATTERNS, ...STEPS_PATTERNS }).map(([k, re]) => [k, pattern(re)])),
    when_rule_groups: WHEN_RULE_GROUPS,
    num_words: NUM_WORDS,
    group_labels: WHEN_GROUPS.map((g) => [g, WHEN_GROUP_LABEL[g]]),
    warning,
    when,
    papers: STEP_PAPERS,
    heading,
    step,
  };
  // One case per line, so a change to a rule shows as the cases it changed.
  const body = Object.entries(doc).map(([k, v]) =>
    Array.isArray(v) && v.length && typeof v[0] === "object"
      ? `${JSON.stringify(k)}:[\n${v.map((x) => JSON.stringify(x)).join(",\n")}\n]`
      : `${JSON.stringify(k)}:${JSON.stringify(v)}`,
  );
  writeFileSync(out, `{\n${body.join(",\n")}\n}\n`);
});
