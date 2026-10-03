import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { bookSafe, careStepView, checkedText, checkOf, labRowView, paperFirstLines, paperFirstView } from "./paperFirst";
import { buildIcs, callScript, eventDescription } from "./booking";
import { PaperFirst } from "@/ui/PaperFirst";
import { HandoffSheetBody } from "@/ui/HandoffSheet";
import { planShareText } from "./shareText";
import { PLAN_IS_A_SUGGESTION, speechLines } from "./speechText";
import { shownExplanation } from "./prepView";
import type { VerifiedItem } from "./schema";
import type { PlanResponse } from "./plan";
import type { MeaningResult } from "./meaning";
import type { PrepStep } from "./prepTimeline";

// A paraphrase that flips the paper: if it ever reaches the person without the paper's words, the test fails.
const QUOTE = "Do not take metformin the morning of your procedure.";
const PARA = "PARAPHRASE-TAKE-METFORMIN";
const TITLE = "TITLE-START-METFORMIN";
const WHEN = "WHEN-MORNING";

const item = (o: Partial<VerifiedItem> = {}): VerifiedItem => ({
  id: "c1", kind: "medication", title: TITLE, plain_language: PARA, why: "", when: WHEN, source_quote: QUOTE,
  needs_clarification: false, question_for_clinic: "", grounded: true, span: { start: 0, end: QUOTE.length }, ...o,
});
const result = (o: Partial<MeaningResult> = {}): MeaningResult => ({
  id: "c1", flagged: false, numbers_ok: true, unexpected_numbers: [], model_verdict: "same", what_differs: "", certified: true, ...o,
});
const plan: PlanResponse = {
  summary: "Your plan.", steps: [{ title: "Get a ride", action: "Call the ride line.", why: "", barrier: "transport", care_ids: ["c1"], resource_ids: [], dropped_refs: [] } as PlanResponse["steps"][number]],
  resources: {}, ask_a_person: false, ask_a_person_reason: "", located: { by: "zip", label: "30303" },
  stats: { candidates: 0, steps: 1, dropped_refs: 0, ms: 1 }, model: "x",
} as PlanResponse;

const AI_WORDS = [PARA, TITLE, WHEN];
const NOT_CERTIFIED: { name: string; meaning: { status: "idle" | "loading" | "done" | "error"; byId: Record<string, MeaningResult> } | undefined }[] = [
  { name: "never checked", meaning: undefined },
  { name: "checking", meaning: { status: "loading", byId: {} } },
  { name: "check failed", meaning: { status: "error", byId: {} } },
  { name: "not returned", meaning: { status: "done", byId: {} } },
  { name: "unclear", meaning: { status: "done", byId: { c1: result({ certified: false, model_verdict: "unclear" }) } } },
  { name: "flagged", meaning: { status: "done", byId: { c1: result({ certified: false, flagged: true, model_verdict: "different" }) } } },
];
const CERTIFIED = { status: "done" as const, byId: { c1: result() } };

/** In rendered markup or text: the paper's words are there, and come before every AI word that is there. */
function quoteLeads(out: string) {
  const q = out.indexOf(QUOTE.replace(/'/g, "&#x27;"));
  expect(q, "the paper's words are missing").toBeGreaterThanOrEqual(0);
  for (const w of AI_WORDS) {
    const at = out.indexOf(w);
    if (at >= 0) expect(at, `${w} comes before the paper's words`).toBeGreaterThan(q);
  }
}

describe("paper first: the shared rule", () => {
  it("certified: the explanation may lead, with the quote right there", () => {
    const v = paperFirstView({ quote: QUOTE, explanation: [PARA], check: "certified" });
    expect(v).toMatchObject({ lead: "explanation", explanation: PARA, quote: QUOTE, note: null });
    expect(paperFirstLines(v)).toEqual([PARA, `Your paper says: "${QUOTE}"`]);
  });
  it.each(["unchecked", "flagged"] as const)("%s: the quote leads, the explanation is secondary on screen and left out of text", (check) => {
    const v = paperFirstView({ quote: QUOTE, explanation: [TITLE, PARA], check });
    expect(v.lead).toBe("quote");
    expect(v.note).toBeTruthy();
    const lines = paperFirstLines(v);
    expect(lines[0]).toBe(`Your paper says: "${QUOTE}"`);
    expect(lines.join("\n")).not.toContain(PARA);
    expect(lines.join("\n")).not.toContain(TITLE);
  });
  it("no quote: nothing is shown, not even a certified explanation", () => {
    const v = paperFirstView({ quote: "  ", explanation: [PARA], check: "certified" });
    expect(v.explanation).toBeNull();
    expect(paperFirstLines(v)).toEqual([]);
    expect(renderToStaticMarkup(createElement(PaperFirst, { v }))).toBe("");
  });
  it("checkOf: only an explicit certified result counts, and flagged wins", () => {
    expect(checkOf(undefined)).toBe("unchecked");
    expect(checkOf({ certified: false })).toBe("unchecked");
    expect(checkOf({ certified: true })).toBe("certified");
    expect(checkOf({ certified: true, flagged: true })).toBe("flagged");
  });
});

describe("paper first: every surface", () => {
  it.each(NOT_CERTIFIED)("care plan step on screen ($name): the paper's words lead", ({ meaning }) => {
    const check = checkOf(meaning?.status === "done" ? meaning.byId.c1 : undefined);
    const html = renderToStaticMarkup(createElement(PaperFirst, { v: careStepView(item(), check) }));
    expect(html).toContain('data-lead="quote"');
    quoteLeads(html);
  });
  it("care plan step on screen, certified: explanation first, the paper's words with it", () => {
    const html = renderToStaticMarkup(createElement(PaperFirst, { v: careStepView(item(), "certified") }));
    expect(html).toContain('data-lead="explanation"');
    expect(html).toContain(PARA);
    expect(html).toContain("Your paper says:");
  });
  it.each(NOT_CERTIFIED)("printed handoff sheet ($name): the paper's words, no AI words", ({ meaning }) => {
    const html = renderToStaticMarkup(createElement(HandoffSheetBody, { items: [item()], plan, questions: [], language: "English", meaning }));
    quoteLeads(html);
    for (const w of AI_WORDS) expect(html).not.toContain(w);
  });
  it("printed handoff sheet, certified: explanation and the paper's words", () => {
    const html = renderToStaticMarkup(createElement(HandoffSheetBody, { items: [item()], plan, questions: [], language: "English", meaning: CERTIFIED }));
    expect(html).toContain(PARA);
    expect(html).toContain("Your paper says:");
  });
  it.each(NOT_CERTIFIED)("send to family text ($name): the paper's words, no AI words for the step", ({ meaning }) => {
    const t = planShareText({ items: [item()], plan, questions: [], meaning });
    quoteLeads(t);
    for (const w of AI_WORDS) expect(t).not.toContain(w);
  });
  it("read aloud: a plan step tied to a paper step is followed by the paper's words", () => {
    const lines = speechLines(plan, [item()]);
    expect(lines).toEqual([PLAN_IS_A_SUGGESTION, "Your plan.", "1. Get a ride. Call the ride line.", `Your paper says: "${QUOTE}"`]);
    for (const w of AI_WORDS) expect(lines.join("\n")).not.toContain(w);
  });
  it("lab row: the report's line leads, the AI's plain name is secondary", () => {
    const html = renderToStaticMarkup(createElement(PaperFirst, { v: labRowView({ quote: QUOTE, plain_name: PARA }) }));
    expect(html).toContain('data-lead="quote"');
    expect(html).toContain("Your report says:");
    expect(html.indexOf(QUOTE.replace(/'/g, "&#x27;"))).toBeLessThan(html.indexOf(PARA));
  });
  it("prep timeline: an explanation is shown only when certified", () => {
    const step = { id: "p1", source_quote: QUOTE, plain_language: PARA, numbers_blocked: false, negation_blocked: false } as PrepStep;
    expect(shownExplanation(step, { status: "done", byId: {} })).toBeNull();
    expect(shownExplanation(step, { status: "done", byId: { p1: result({ id: "p1", certified: false }) } })).toBeNull();
  });
});

describe("paper first: no surface renders an AI explanation field directly", () => {
  // Every .tsx under src/ui and src/app. An AI explanation (plain_language, plain_name) may only reach the screen
  // through PaperFirst / paperFirstView; writing {x.plain_language} in JSX is how one would get there alone.
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${d}/${e.name}`);
      else if (e.name.endsWith(".tsx")) files.push(`${d}/${e.name}`);
    }
  };
  walk(fileURLToPath(new URL("../ui", import.meta.url)));
  walk(fileURLToPath(new URL("../app", import.meta.url)));
  it("scans every UI file, and none puts plain_language or plain_name straight into JSX", () => {
    expect(files.length).toBeGreaterThan(20);
    const bad = files.filter((f) => /\{\s*[\w.?]*\.(?:plain_language|plain_name)\s*\}/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});

describe("Codex round 12: removing a step never strips a plan step's quote", () => {
  it("share text and read-aloud use every planned step's quote, even after it was removed from the list", () => {
    const t = planShareText({ items: [], plan, questions: [], planItems: [item()] });
    expect(t).toContain(`Your paper says: "${QUOTE}"`);
    expect(t).toContain("Suggestion from ATLAS, not the paper:");
    const lines = speechLines(plan, [item()]);
    expect(lines).toContain(`Your paper says: "${QUOTE}"`);
  });
  it("the printed sheet labels the plan as suggestions and keeps a removed step's quote", () => {
    const html = renderToStaticMarkup(createElement(HandoffSheetBody, { items: [], plan, questions: [], language: "English", planItems: [item()] }));
    expect(html).toContain("suggestions from ATLAS");
    expect(html).toContain("Your paper says:");
  });
});

describe("Codex round 13: titles, held-back steps and bookings", () => {
  it("the meaning check is asked about the title too", () => {
    expect(checkedText(TITLE, PARA)).toBe(`${TITLE}. ${PARA}`);
  });
  it.each(["unchecked", "flagged", "certified"] as const)("booking a %s step never carries the AI's title; its when only when certified", (check) => {
    const b = bookSafe(item({ kind: "lab_test" }), check);
    expect(b.title).toBe("Lab test from your paper");
    expect(b.when).toBe(check === "certified" ? WHEN : "");
    expect(b.source_quote).toBe(QUOTE);
    const ics = buildIcs({ uid: "u", start: new Date(2026, 9, 10, 9), minutes: 60, title: b.title, description: eventDescription(b, null), now: new Date(2026, 9, 1) });
    for (const w of [TITLE, PARA]) expect(ics).not.toContain(w);
    // Each reminder alarm carries the paper's words.
    expect(ics.replace(/\r\n /g, "").match(/BEGIN:VALARM[\s\S]*?END:VALARM/g)!.every((a) => a.includes("From your paper"))).toBe(true);
    for (const l of callScript(b, [], "English")) for (const w of [TITLE, PARA]) expect(l).not.toContain(w);
  });
  it("no UI file puts an AI title next to a held-back or removed step, or in an aria-label", () => {
    const src = readFileSync(fileURLToPath(new URL("../ui/CarePlanTool.tsx", import.meta.url)), "utf8");
    expect(src).not.toMatch(/aria-label=\{`[^`]*\$\{\w+\.title\}/);
    expect(src).not.toMatch(/refused\.map\([^)]*\)\s*=>\s*\(\s*<li[^>]*>\{r\.title\}/);
    expect(src).not.toMatch(/<span>\{r\.title\}<\/span>/);
    const und = readFileSync(fileURLToPath(new URL("../ui/Understand.tsx", import.meta.url)), "utf8");
    expect(und).not.toMatch(/\?\.title/);
  });
});
