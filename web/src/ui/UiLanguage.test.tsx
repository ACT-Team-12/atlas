// @vitest-environment jsdom
/**
 * The guard for a real finding: a teammate tried the site in Vietnamese and "the headings stay in english". The AI's
 * words came back in Vietnamese; the app's own labels did not.
 *
 * For each app language, this renders the real tool with the team's sample paper (its saved live reading), checks the
 * steps, makes a plan, and asserts that none of the app's own English lines (lib/uiText.ts) is anywhere on the page or
 * the printed handoff sheet. The paper's words and the AI's words are not checked: those are never translated here.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CarePlanResponse } from "@/lib/schema";
import type { PlanResponse } from "@/lib/plan";
import { LANGUAGES } from "@/lib/schema";
import { ui, UI_LANG_CODE, UI_PLURAL, UI_TEXT, type Lang } from "@/lib/uiText";
import { CarePlanTool } from "./CarePlanTool";
import { LabRows, UncheckedLines } from "./LabResults";
import { UiLangProvider } from "./UiLang";
import type { ResultRow } from "@/lib/results";

vi.mock("@/lib/deviceChecker", () => ({ loadDeviceChecker: () => Promise.reject(new Error("no wasm in tests")), sameSpan: () => false }));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The sample paper as the live server read it on Oct 4 (12 steps, 2 warning signs), shared with the iOS tests. */
const SAMPLE = JSON.parse(readFileSync(join(__dirname, "../../../mobile/ios/ATLASTests/Fixtures/extract_sample_live.json"), "utf8")) as CarePlanResponse;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function plan(): PlanResponse {
  return {
    summary: "PLAN SUMMARY", located: { by: "zip", label: "ZIP 30340" }, ask_a_person: true, ask_a_person_reason: "REASON.", model: "test",
    stats: { steps: 2, candidates: 4, dropped_refs: 1 },
    steps: [
      { title: "PLAN STEP ONE", action: "ACTION ONE", why: "WHY ONE", barrier: "transport", care_ids: ["item-5"], resource_ids: ["k1", "g1"], dropped_refs: [] },
      { title: "PLAN STEP TWO", action: "ACTION TWO", why: "", barrier: null, care_ids: ["item-3"], resource_ids: [], dropped_refs: [] },
    ],
    resources: {
      k1: { type: "clinic", id: "k1", km: 2, clinic: { id: "k1", name: "CLINIC NAME", org: "", address: "1 Main St", city: "Atlanta", zip: "30303", county: "", phone: "404-555-0100", website: "https://clinic.example", lat: 0, lng: 0, hours_per_week: null, setting: "", health_center_type: "", nearest_rail: { name: "RAIL", stop_id: "r", meters: 900 }, nearest_bus: { name: "BUS", stop_id: "b", meters: 100 }, barriers: ["transport"], source_id: "hrsa", hours: [{ day: 1, open: "0800", close: "1700" }], hours_source_id: "clinic-site", hours_quote: "QUOTE", hours_url: "https://clinic.example/hours" } },
      g1: { type: "program", id: "g1", program: { id: "g1", name: "PROGRAM NAME", barriers: ["transport"], access: { phone: "404-555-0199", url: "https://ride.example", text: "ACCESS TEXT" }, languages: [], evidence_quote: "EVIDENCE", source_url: "https://ride.example/about" } },
    },
    feedback_token: "tok",
  } as unknown as PlanResponse;
}

let root: Root;
let host: HTMLDivElement;

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/extract/stream") return Promise.resolve(new Response(null, { status: 404 }));
    if (url === "/api/extract") return Promise.resolve(json(SAMPLE));
    // One step certified, one flagged, the rest unchecked: every seal and every paper-first label is on screen.
    if (url === "/api/meaning") return Promise.resolve(json({ results: SAMPLE.items.map((it, i) => ({ id: it.id, flagged: i === 1, certified: i === 0, numbers_ok: true, unexpected_numbers: [], model_verdict: i === 1 ? "different" : "same", what_differs: "" })) }));
    if (url === "/api/plan") return Promise.resolve(json(plan()));
    return Promise.reject(new Error(`no ${url} in this test`));
  }));
  vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q, addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {} }));
  Element.prototype.scrollIntoView = () => {};
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const drain = () => new Promise((r) => setTimeout(r, 0));
function setValue(el: HTMLTextAreaElement | HTMLSelectElement, value: string, event: string) {
  // The element's own prototype (its own window), so this never mixes realms when files share a worker.
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!.call(el, value);
  el.dispatchEvent(new Event(event, { bubbles: true }));
}
const button = (label: string) => {
  const b = [...host.querySelectorAll("button")].find((x) => x.textContent?.includes(label));
  if (!b) throw new Error(`no button "${label}"`);
  return b;
};

/** The longest fixed piece of an English line (between {placeholders}), long enough not to match by accident. */
function englishPieces(prefixes: RegExp): string[] {
  const out = new Set<string>();
  const add = (s: string) => {
    const piece = s.split(/\{\w+\}/).map((x) => x.trim()).sort((a, b) => b.length - a.length)[0];
    if (piece && piece.length >= 10) out.add(piece);
  };
  for (const [k, row] of Object.entries(UI_TEXT)) if (prefixes.test(k)) add((row as Record<Lang, string>).English);
  for (const byLang of Object.values(UI_PLURAL)) for (const f of Object.values((byLang as Record<Lang, Record<string, string>>).English)) add(f);
  return [...out];
}

/** Lines the page shows for the steps and the plan (labs and prep have their own sections). */
const PAGE = /^(common|paper|work|kind|when|seal|pf|steps|ask|askClinic|remind|show|pip|missed|needs|barrier|plan|dock|voice|tab|share|quiz|sheet|book|fb|saved)\./;

async function walkThrough(lang: Lang) {
  act(() => root.render(<CarePlanTool />));
  const select = host.querySelector<HTMLSelectElement>("#try select")!;
  act(() => setValue(select, lang, "change"));
  act(() => setValue(host.querySelector<HTMLTextAreaElement>("#try textarea")!, SAMPLE.source_text, "input"));
  await act(async () => { button(ui(lang, "paper.read")).click(); await drain(); await drain(); });
  await act(async () => { button(ui(lang, "barrier.transport")).click(); await drain(); });
  await act(async () => { button(ui(lang, "needs.makePlan")).click(); await drain(); await drain(); });
}

describe("the steps and plan screens show no English of their own in another language", () => {
  for (const lang of LANGUAGES.filter((l) => l !== "English")) {
    it(`${lang}: steps, plan, dock and the printed handoff sheet`, { timeout: 30_000 }, async () => {
      await walkThrough(lang);
      // The plan really rendered (its summary is the AI's, untranslated), and so did the sheet.
      expect(host.textContent).toContain("PLAN SUMMARY");
      const sheet = document.getElementById("atlas-sheet");
      expect(sheet).not.toBeNull();
      // Left out on purpose: the helper's session summary is an English record draft for a case note (its read-only
      // box), and the AI's own words in the sample reading (made in English) are never translated by the app.
      const page = host.cloneNode(true) as HTMLElement;
      page.querySelectorAll("textarea[readonly]").forEach((el) => el.remove());
      const text = `${page.textContent}\n${sheet!.textContent}`;
      const aiWords = SAMPLE.items.flatMap((it) => [it.title, it.when, it.plain_language, it.why ?? ""]).join("\n");
      // Every line translated in this language must not appear in English.
      const left = englishPieces(PAGE).filter((p) => text.includes(p) && !aiWords.includes(p) && !Object.values(UI_TEXT).some((row) => (row as Record<Lang, string>)[lang].includes(p)));
      expect(left).toEqual([]);
      // And the lines are really there in this language: headings, chips, seals, warning box, plan, dock.
      for (const k of ["steps.title", "steps.warnTitle", "kind.medication", "when.today", "seal.twice", "pf.screen.paper", "plan.title", "dock.print.long", "sheet.title", "plan.needsPerson", "plan.call211"] as const) {
        expect(text, k).toContain(ui(lang, k));
      }
      // Screen readers get the right language for the app's own words.
      expect(host.querySelector("#try")!.getAttribute("lang")).toBe(UI_LANG_CODE[lang]);
      expect(sheet!.getAttribute("lang")).toBe(UI_LANG_CODE[lang]);
    });
  }

  it("English stays exactly as before, and the guard above really sees the English lines when they are there", { timeout: 30_000 }, async () => {
    await walkThrough("English");
    const text = host.textContent ?? "";
    expect(englishPieces(PAGE).filter((p) => text.includes(p)).length).toBeGreaterThan(60);
    expect(host.textContent).toContain("Your steps");
    expect(host.textContent).toContain("Copied word for word from your paper");
    expect(host.textContent).toContain("Start with these");
  });
});

describe("lab results show no English of their own in another language", () => {
  const rows = [
    { test: "Glucose", value: "130", unit: "mg/dL", range_text: "70-99", quote: "Glucose 130 mg/dL 70-99 H", status: "outside", direction: "high", reason: "130 is above the range printed on your report (70-99).", plain_name: "Blood sugar", ask: "ASK ONE" },
    { test: "Sodium", value: "140", unit: "mmol/L", range_text: "135-145", quote: "Sodium 140 mmol/L 135-145", status: "inside", direction: null, reason: "Inside the range printed on your report (135-145).", plain_name: "Salt", ask: "" },
    { test: "Iron", value: "<5", unit: "", range_text: "0-10", quote: "Iron <5 0-10", status: "unknown", direction: null, reason: "Your report prints this as <5, so we can't tell where it falls against the range (0-10).", plain_name: "Iron", ask: "ASK TWO" },
  ] as unknown as ResultRow[];
  for (const lang of LANGUAGES.filter((l) => l !== "English")) {
    it(lang, () => {
      act(() => root.render(<UiLangProvider language={lang}><LabRows rows={rows} /><UncheckedLines coverage={{ checked: 3, candidates: 5, unchecked: ["CRITICAL K 7.0"] }} /></UiLangProvider>));
      const text = host.textContent ?? "";
      const left = englishPieces(/^(labs|askClinic|common|pf)\./).filter((p) => text.includes(p) && !Object.values(UI_TEXT).some((row) => (row as Record<Lang, string>)[lang].includes(p)));
      expect(left).toEqual([]);
      expect(text).toContain(ui(lang, "labs.chip.high"));
      expect(text).toContain(ui(lang, "labs.reason.above", { value: "130", range: "70-99" }));
    });
  }
});
