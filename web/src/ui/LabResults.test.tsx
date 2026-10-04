// @vitest-environment jsdom
/**
 * "Explain my lab results", concise rows (LabResults.tsx, LabRows), against the real component and the real decision
 * code (results.ts, checkRows). Our code decides what is outside the range; a closed row carries only the report's own
 * words; the AI's plain name and question never show without the report's line.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkRows, type ResultRow } from "@/lib/results";
import { SAMPLE_LABS } from "@/lib/sampleLabs";
import { labClosedRow, labQuestionsText } from "@/lib/labsView";
import { LabRows, UncheckedLines } from "./LabResults";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** What the AI returns for one line. The AI's words are deliberately distinctive so a leak is easy to find. */
function model(test: string, value: string, unit: string, range_text: string, quoteStart: string) {
  const line = SOURCE.split("\n").find((l) => l.startsWith(quoteStart));
  if (!line) throw new Error(`not on the report: ${quoteStart}`);
  return { test, value, unit, range_text, quote: line.trim(), plain_name: `AI-PLAIN [${test}]`, ask: `AI-ASK about [${test}]?` };
}

const SOURCE = `${SAMPLE_LABS}
CRITICAL VALUES
Potassium, repeat          2.4       mmol/L     3.5-5.1           LL CRITICAL
`;

const MODEL = [
  // The AI copies the name in its own case: the row must show the report's own spelling.
  model("glucose fasting", "126", "mg/dL", "70-99", "Glucose, fasting"),
  model("Sodium", "139", "mmol/L", "136-145", "Sodium"),
  model("Potassium", "3.2", "mmol/L", "3.5-5.1", "Potassium   "),
  model("Creatinine", "1.1", "mg/dL", "0.6-1.2", "Creatinine"),
  model("eGFR", "68", "mL/min", ">=60", "eGFR"),
  model("Hemoglobin A1c", "7.4", "%", "<5.7", "Hemoglobin A1c"),
  model("Total Cholesterol", "214", "mg/dL", "<200", "Total Cholesterol"),
  model("LDL Cholesterol", "142", "mg/dL", "<100", "LDL Cholesterol"),
  model("HDL Cholesterol", "44", "mg/dL", ">40", "HDL Cholesterol"),
  model("Triglycerides", "148", "mg/dL", "<150", "Triglycerides"),
  model("Potassium, repeat", "2.4", "mmol/L", "3.5-5.1", "Potassium, repeat"),
];

const ROWS: ResultRow[] = checkRows(SOURCE, MODEL).rows;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

const render = (rows: ResultRow[] = ROWS) => act(() => root.render(<LabRows rows={rows} />));
const rowsIn = (g: string) => [...host.querySelectorAll<HTMLLIElement>(`[data-lab-group="${g}"] li[data-lab-row]`)];
const rowNamed = (name: string) => [...host.querySelectorAll<HTMLLIElement>("li[data-lab-row]")].find((li) => li.querySelector("[data-report-name]")?.textContent === name)!;
const toggleOf = (li: HTMLElement) => li.querySelector<HTMLButtonElement>(":scope > button[aria-expanded]")!;
const panelOf = (li: HTMLElement) => document.getElementById(toggleOf(li).getAttribute("aria-controls")!)!;
/** Visible means neither it nor any parent is hidden. */
const visible = (el: Element | null) => { for (let e = el; e; e = e.parentElement) if ((e as HTMLElement).hidden) return false; return !!el; };

/**
 * Every place an AI-written string shows up, in text nodes and attributes. Each must sit after the report's own full
 * line, inside the same opened row panel or the same question item, and never on a closed row (a button).
 */
function assertAiNeverWithoutLine(rows: ResultRow[]) {
  // Walk the DOM once, then check every AI string against it (the same checks, without a full walk per string).
  const attrs: [string, string][] = [];
  for (const el of host.querySelectorAll("*")) for (const a of el.getAttributeNames()) attrs.push([`${a} on <${el.tagName}>`, el.getAttribute(a) ?? ""]);
  const texts: Node[] = [];
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);
  expect(texts.length).toBeGreaterThan(0);
  for (const r of rows) {
    for (const ai of [r.plain_name, r.ask]) {
      for (const [where, value] of attrs) if (value.includes(ai)) expect(value, where).not.toContain(ai);
      for (const n of texts) {
        if (!n.textContent?.includes(ai)) continue;
        const el = n.parentElement!;
        expect(el.closest("button"), `"${ai}" on a closed row`).toBeNull();
        const box = el.closest("[data-lab-panel], [data-ask-clinic] li")!;
        expect(box, `"${ai}" outside a row panel or a question item`).not.toBeNull();
        const line = [...box.querySelectorAll("[data-paper-quote]")].find((q) => q.textContent!.includes(`“${r.quote}”`));
        expect(line, `"${ai}" without the report's line "${r.quote}"`).toBeDefined();
        expect(line!.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING, `"${ai}" before its report line`).toBeTruthy();
      }
    }
  }
}

describe("flagged results: one row each, the report's own words, our code's chip", () => {
  it("our code (not the AI) puts these outside the range, in report order", () => {
    render();
    const names = rowsIn("outside").map((li) => li.querySelector("[data-report-name]")!.textContent);
    expect(names).toEqual(["Glucose, fasting", "Potassium", "Hemoglobin A1c", "Total Cholesterol", "LDL Cholesterol", "Potassium, repeat"]);
  });

  it("the closed row shows the name, value and range exactly as printed, and a High/Low chip", () => {
    render();
    const g = rowNamed("Glucose, fasting");
    expect(g.querySelector("[data-report-value]")!.textContent).toBe("126 mg/dL");
    expect(g.querySelector("[data-report-range]")!.textContent).toBe("70-99");
    expect(g.querySelector("[data-chip]")!.textContent).toBe("High");
    const k = rowNamed("Potassium");
    expect(k.querySelector("[data-report-value]")!.textContent).toBe("3.2 mmol/L");
    expect(k.querySelector("[data-chip]")!.textContent).toBe("Low");
    const a1c = rowNamed("Hemoglobin A1c");
    expect(a1c.querySelector("[data-report-range]")!.textContent).toBe("<5.7");
    // Every part of every closed row is on the report's own line.
    for (const li of host.querySelectorAll<HTMLLIElement>("li[data-lab-row]")) {
      const r = ROWS.find((x) => x.quote.includes(li.querySelector("[data-report-name]")!.textContent!))!;
      for (const sel of ["[data-report-name]", "[data-report-range]"]) {
        const t = li.querySelector(sel)?.textContent;
        if (t) expect(r.quote).toContain(t);
      }
      expect(r.quote).toContain(r.value);
      if (r.unit) expect(r.quote).toContain(r.unit);
    }
  });

  it("a closed row has no AI-written word, and the panel is closed", () => {
    render();
    for (const li of rowsIn("outside").filter((x) => !x.dataset.critical)) {
      expect(toggleOf(li).getAttribute("aria-expanded")).toBe("false");
      expect(panelOf(li).hidden).toBe(true);
      expect(toggleOf(li).textContent).not.toMatch(/AI-/);
    }
  });

  it("opening a row shows our reason, the report's line first, then the plain name (marked) and the question", () => {
    render();
    const g = rowNamed("Glucose, fasting");
    act(() => toggleOf(g).click());
    const panel = panelOf(g);
    expect(panel.hidden).toBe(false);
    expect(panel.textContent).toContain("Your report marks this line as high.");
    const block = panel.querySelector("[data-lead]")!;
    expect(block.getAttribute("data-lead")).toBe("quote");
    expect(block.firstElementChild!.textContent).toContain("Your report says:");
    expect(block.querySelector("[data-explanation]")!.textContent).toContain("not double-checked");
    expect(panel.querySelector("[data-lab-ask]")!.textContent).toContain("AI-ASK about [glucose fasting]?");
  });
});

describe("results in range fold away behind one disclosure", () => {
  it("'N results in range' is a closed disclosure holding exactly the in-range rows", () => {
    render();
    const section = host.querySelector('[data-lab-group="inside"]')!;
    const btn = section.querySelector<HTMLButtonElement>(":scope > button[aria-expanded]")!;
    expect(btn.textContent).toContain("5 results in range");
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    const fold = document.getElementById(btn.getAttribute("aria-controls")!)!;
    expect(fold.hidden).toBe(true);
    expect(rowsIn("inside").map((li) => li.querySelector("[data-chip]")!.textContent)).toEqual(Array(5).fill("In range"));
    act(() => btn.click());
    expect(btn.getAttribute("aria-expanded")).toBe("true");
    expect(fold.hidden).toBe(false);
  });

  it("no flagged row is ever inside the fold", () => {
    render();
    for (const li of rowsIn("inside")) expect(li.dataset.labRow).toBe("inside");
  });
});

describe("critical lines stay loud and open", () => {
  it("a line the report marks critical is open from the start, red, and says to call", () => {
    render();
    const crit = rowNamed("Potassium, repeat");
    expect(crit.dataset.critical).toBe("true");
    expect(crit.className).toContain("border-red");
    expect(toggleOf(crit).getAttribute("aria-expanded")).toBe("true");
    expect(panelOf(crit).hidden).toBe(false);
    expect(crit.querySelector("[data-critical-note]")!.textContent).toContain("critical");
    // Its loud note is on the row itself, not in the panel.
    expect(toggleOf(crit).contains(crit.querySelector("[data-critical-note]"))).toBe(true);
    expect(crit.closest('[data-lab-group="inside"]')).toBeNull();
  });

  it("a critical marker before the value, on a number inside its range, is still flagged, never folded (Codex review)", () => {
    const src = "CHEMISTRY\nCRITICAL Potassium      4.0       mmol/L     3.5-5.1\nSodium   139   mmol/L   136-145\n";
    const res = checkRows(src, [
      { test: "Potassium", value: "4.0", unit: "mmol/L", range_text: "3.5-5.1", quote: "CRITICAL Potassium      4.0       mmol/L     3.5-5.1", plain_name: "AI-PLAIN [k]", ask: "AI-ASK [k]?" },
      { test: "Sodium", value: "139", unit: "mmol/L", range_text: "136-145", quote: "Sodium   139   mmol/L   136-145", plain_name: "AI-PLAIN [na]", ask: "AI-ASK [na]?" },
    ]);
    expect(res.counts).toEqual({ outside: 1, inside: 1, unknown: 0 });
    expect(res.rows[0]).toMatchObject({ test: "Potassium", status: "outside", direction: null, reason: "Your report marks this line critical." });
    render(res.rows);
    // The closed row's name is the line's own words up to the result, so the marker before the name stays on it.
    const k = rowNamed("CRITICAL Potassium");
    expect(k.closest('[data-lab-group="outside"]')).not.toBeNull();
    expect(k.dataset.critical).toBe("true");
    expect(k.querySelector("[data-chip]")!.textContent).toBe("Flagged");
    expect(toggleOf(k).getAttribute("aria-expanded")).toBe("true");
    expect(host.querySelector("[data-ask-clinic]")!.textContent).toContain("AI-ASK [k]?");
  });

  it("the AI's test name can never swallow a critical marker (security review): fails closed", () => {
    const line = "CRITICAL Potassium      4.0       mmol/L     3.5-5.1";
    // The AI names the test "CRITICAL Potassium", so the name covers the marker. The line is still critical.
    const res = checkRows(`${line}\n`, [{ test: "CRITICAL Potassium", value: "4.0", unit: "mmol/L", range_text: "3.5-5.1", quote: line, plain_name: "AI-PLAIN [k]", ask: "AI-ASK [k]?" }]);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({ status: "outside", reason: "Your report marks this line critical." });
    render(res.rows);
    expect(host.querySelector('[data-lab-group="inside"]')).toBeNull();
    expect(host.querySelector("li[data-lab-row]")!.getAttribute("data-critical")).toBe("true");
    // A name that itself says "critical" is loud too: never quieter than the report.
    const named = "Critical Care Panel Sodium   139   mmol/L   136-145";
    expect(checkRows(`${named}\n`, [{ test: "Critical Care Panel Sodium", value: "139", unit: "mmol/L", range_text: "136-145", quote: named, plain_name: "x", ask: "y" }]).rows[0].status).toBe("outside");
  });
});

describe("the AI's words never show without the report's line", () => {
  it("closed, opened and in the questions list", () => {
    render();
    assertAiNeverWithoutLine(ROWS);
    for (const li of host.querySelectorAll<HTMLLIElement>("li[data-lab-row]")) if (toggleOf(li).getAttribute("aria-expanded") === "false") act(() => toggleOf(li).click());
    act(() => host.querySelector<HTMLButtonElement>('[data-lab-group="inside"] > button')!.click());
    assertAiNeverWithoutLine(ROWS);
  });
});

describe("Ask your clinic: one list with Copy", () => {
  it("collects the questions for flagged results, each with its report line", () => {
    render();
    const list = host.querySelector("[data-ask-clinic]")!;
    expect(list.querySelector("h3")!.textContent).toBe("Ask your clinic (6)");
    const first = list.querySelector("li")!;
    expect(first.querySelector("[data-paper-quote]")!.textContent).toContain(ROWS[0].quote);
    expect(first.textContent).toContain("AI-ASK about [glucose fasting]?");
    // In-range results' questions stay with their own rows, not on this list.
    expect(list.textContent).not.toContain("AI-ASK about [Sodium]?");
  });

  it("Copy carries every question with its report line", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    render();
    await act(async () => { [...host.querySelectorAll("button")].find((b) => b.textContent === "Copy questions")!.click(); });
    const text = (writeText.mock.calls[0] as unknown as [string])[0];
    expect(text).toContain(`1. Your report says: "${ROWS[0].quote}"\n   AI-ASK about [glucose fasting]?`);
    // Report line first, then the question, for every one (Codex review).
    const lines = text.split("\n");
    for (const [i, line] of lines.entries()) {
      if (!line.includes("AI-ASK")) continue;
      expect(line).toMatch(/^ {3}AI-ASK/);
      expect(lines[i - 1]).toMatch(/^\d+\. Your report says: "/);
    }
    expect(labQuestionsText([])).toBe("");
  });

  it.each([
    ["denied", { clipboard: { writeText: () => Promise.reject(new Error("denied")) } }],
    ["missing", {}],
  ])("Copy says so when the clipboard is %s (Codex review)", async (_, nav) => {
    vi.stubGlobal("navigator", nav);
    render();
    await act(async () => { [...host.querySelectorAll("button")].find((b) => b.textContent === "Copy questions")!.click(); });
    expect(host.querySelector("[data-ask-clinic] [role=status]")!.textContent).toMatch(/^Couldn't copy/);
  });
});

describe("security review checklist", () => {
  it("(1) every row's AI text comes after the report's exact line, in every row state; no path shows it alone", () => {
    render();
    for (const r of ROWS) {
      const li = rowNamed(labClosedRow(r).name);
      if (toggleOf(li).getAttribute("aria-expanded") === "false") act(() => toggleOf(li).click());
      const block = panelOf(li).querySelector("[data-lead]")!;
      // The lab plain name is never certified (labRowView): the report's line always leads.
      expect(block.getAttribute("data-lead")).toBe("quote");
      expect(block.firstElementChild!.hasAttribute("data-paper-quote")).toBe(true);
      expect(block.firstElementChild!.textContent).toContain(`“${r.quote}”`);
    }
    act(() => host.querySelector<HTMLButtonElement>('[data-lab-group="inside"] > button')!.click());
    assertAiNeverWithoutLine(ROWS);
  });

  it("(2) a line with no range, or one our code can't place, is never folded as in range (fails closed)", () => {
    const src = "Vitamin D    18    ng/mL\nFerritin    <5    ng/mL    10-200\nSodium   139   mmol/L   136-145\n";
    const res = checkRows(src, [
      { test: "Vitamin D", value: "18", unit: "ng/mL", range_text: "", quote: "Vitamin D    18    ng/mL", plain_name: "a", ask: "b" },
      { test: "Ferritin", value: "<5", unit: "ng/mL", range_text: "10-200", quote: "Ferritin    <5    ng/mL    10-200", plain_name: "a", ask: "b" },
      { test: "Sodium", value: "139", unit: "mmol/L", range_text: "136-145", quote: "Sodium   139   mmol/L   136-145", plain_name: "a", ask: "b" },
    ]);
    render(res.rows);
    const inside = rowsIn("inside").map((li) => li.querySelector("[data-report-name]")!.textContent);
    expect(inside).toEqual(["Sodium"]);
    // Vitamin D has no range: "Can't tell", visible, not in the fold.
    const d = rowNamed("Vitamin D");
    expect(d.dataset.labRow).toBe("unknown");
    expect(d.closest('[data-lab-group="unknown"]')).not.toBeNull();
    expect(visible(d)).toBe(true);
    // No range on the line means no range on the row: nothing is filled in.
    expect(d.querySelector("[data-report-range]")).toBeNull();
    // Ferritin "<5" against 10-200 is below the range: flagged, visible.
    expect(rowNamed("Ferritin").closest('[data-lab-group="outside"]')).not.toBeNull();
    for (const li of rowsIn("inside")) expect(li.dataset.labRow).toBe("inside");
  });

  it("(3) the chip comes from the report's own line, never from the AI's copy of the range", () => {
    const line = "Glucose, fasting         126       mg/dL      70-99";
    // The AI claims a range of 70-200 (which would make 126 in range). Our code reads the line's own 70-99.
    const res = checkRows(`${line}\n`, [{ test: "Glucose, fasting", value: "126", unit: "mg/dL", range_text: "70-200", quote: line, plain_name: "a", ask: "b" }]);
    render(res.rows);
    const g = rowNamed("Glucose, fasting");
    expect(g.querySelector("[data-chip]")!.textContent).toBe("High");
    expect(g.querySelector("[data-report-range]")!.textContent).toBe("70-99");
    // And an H printed on the line wins over an AI range that says otherwise.
    const flagged = "Potassium   4.0   mmol/L   3.5-5.1   H";
    expect(checkRows(`${flagged}\n`, [{ test: "Potassium", value: "4.0", unit: "mmol/L", range_text: "3.5-5.1", quote: flagged, plain_name: "a", ask: "b" }]).rows[0]).toMatchObject({ status: "outside", direction: "high" });
  });

  it("(3b) the AI's test name or unit can't absorb a mark, and the AI can't pick between two ranges (Codex review)", () => {
    const one = (line: string, test: string, value: string, unit: string, range_text: string) =>
      checkRows(`${line}\n`, [{ test, value, unit, range_text, quote: line, plain_name: "a", ask: "b" }]).rows[0];
    // The mark sits in what the AI calls the name: never in range.
    expect(one("Potassium H 4.0 mmol/L 3.5-5.1", "Potassium H", "4.0", "mmol/L", "3.5-5.1").status).not.toBe("inside");
    // The AI calls the mark a unit: never in range.
    expect(one("Potassium 4.0 H 3.5-5.1", "Potassium", "4.0", "H", "3.5-5.1").status).not.toBe("inside");
    // Two printed ranges that disagree: the AI's choice doesn't make it in range.
    const two = one("Glucose 110 mg/dL 70-99 100-125", "Glucose", "110", "mg/dL", "100-125");
    expect(two.status).toBe("unknown");
    // A panic mark is a flag; a marked line with no number still counts toward coverage.
    expect(one("Troponin 2.1 ng/mL 0-0.04 PANIC", "Troponin", "2.1", "ng/mL", "0-0.04").status).toBe("outside");
    const cov = checkRows("Sodium 139 mmol/L 136-145\nTroponin unable to calculate CRITICAL\n", [
      { test: "Sodium", value: "139", unit: "mmol/L", range_text: "136-145", quote: "Sodium 139 mmol/L 136-145", plain_name: "a", ask: "b" },
    ]).coverage;
    expect(cov).toMatchObject({ candidates: 2, checked: 1, unchecked: ["Troponin unable to calculate CRITICAL"] });
    // Ordinary in-range lines stay in range.
    expect(one("Sodium   139   mmol/L   136-145", "Sodium", "139", "mmol/L", "136-145").status).toBe("inside");
    expect(one("HDL Cholesterol   44   mg/dL   >40", "HDL Cholesterol", "44", "mg/dL", ">40").status).toBe("inside");
  });

  it("in every row panel the report line comes before any AI text, and the question shows once", () => {
    render();
    act(() => host.querySelector<HTMLButtonElement>('[data-lab-group="inside"] > button')!.click());
    for (const r of ROWS) {
      const li = rowNamed(labClosedRow(r).name);
      if (toggleOf(li).getAttribute("aria-expanded") === "false") act(() => toggleOf(li).click());
      const panel = panelOf(li);
      const text = panel.textContent!;
      const lineAt = text.indexOf(`“${r.quote}”`);
      expect(lineAt).toBeGreaterThan(-1);
      for (const ai of [r.plain_name, r.ask]) {
        expect(text.indexOf(ai), ai).toBeGreaterThan(lineAt);
        expect(text.split(ai).length - 1, `${ai} once`).toBe(1);
      }
      // Only our code's reason sits above the line.
      expect(text.slice(0, lineAt)).not.toMatch(/AI-/);
    }
  });

  it("AI fields only add caution: the model dressing a line as normal never folds it (security review)", () => {
    const L = {
      h: "Potassium 4.0 H 3.5-5.1",
      crit: "CRITICAL Sodium 140 mmol/L 136-145",
      none: "Vitamin D 18 ng/mL",
      liter: "Urine Volume 1.8 L 0.8-2.0",
      skip: "Glucose 250 prev 80 mg/dL 70-99",
    };
    const src = Object.values(L).join("\n") + "\n";
    const m = (quote: string, test: string, value: string, unit: string, range_text: string) => ({ test, value, unit, range_text, quote, plain_name: "a", ask: "b" });
    const res = checkRows(src, [
      m(L.h, "Potassium", "4.0", "H", "3.5-5.1"), // the H flag called a unit
      m(L.crit, "CRITICAL Sodium", "140", "mmol/L", "136-145"), // the marker swallowed by the name
      m(L.none, "Vitamin D", "18", "ng/mL", "10-100"), // a range the line does not print
      m(L.liter, "Urine Volume", "1.8", "L", "0.8-2.0"), // a lone L called liters
      m(L.skip, "Glucose 250 prev", "80", "mg/dL", "70-99"), // the name skips past the real result
    ]);
    expect(res.rows).toHaveLength(5);
    expect(res.counts.inside).toBe(0);
    render(res.rows);
    expect(host.querySelector('[data-lab-group="inside"]')).toBeNull();
    for (const li of host.querySelectorAll<HTMLLIElement>("li[data-lab-row]")) {
      expect(visible(li)).toBe(true);
      expect(li.dataset.labRow).not.toBe("inside");
    }
    expect(rowNamed("Vitamin D").querySelector("[data-report-range]")).toBeNull();
    expect(rowNamed("CRITICAL Sodium").dataset.critical).toBe("true");
  });

  it("third Codex pass: earlier numbers, short marks, critical-only reports and the 40-line cap all fail closed", () => {
    const one = (line: string, test: string, value: string, unit = "mg/dL", range_text = "70-99") =>
      checkRows(`${line}\n`, [{ test, value, unit, range_text, quote: line, plain_name: "a", ask: "b" }]).rows[0];
    // The AI's name starts the search after the real result.
    expect(one("Glucose 250 previous result 80 mg/dL 70-99", "previous result", "80").status).toBe("unknown");
    // Short marks printedFlag doesn't name.
    for (const mark of ["A", "ABN", "abn", "CRIT", "hh", "ll", "!", "*"]) expect(one(`Glucose 90 mg/dL 70-99 ${mark}`, "Glucose", "90").status, mark).not.toBe("inside");
    // Unmarked lines still read in range.
    expect(one("Glucose 90 mg/dL 70-99", "Glucose", "90").status).toBe("inside");
    // A critical-only report: no rows, and the critical line is shown, loud.
    const only = checkRows("Troponin unable to calculate CRITICAL\n", []);
    expect(only.rows).toEqual([]);
    act(() => root.render(<UncheckedLines coverage={only.coverage} />));
    expect(host.querySelector("[data-unchecked-critical]")!.textContent).toContain("critical");
    expect(host.querySelector("li[data-critical]")!.textContent).toBe("Troponin unable to calculate CRITICAL");
    // Past the 40-line cap, a critical line is kept first and the rest are counted.
    const lines = ["Sodium 139 mmol/L 136-145", ...Array.from({ length: 40 }, (_, i) => `Test${i} ${i + 1} mg/dL 0-${i + 50}`), "Potassium 2.0 mmol/L 3.5-5.1 PANIC"];
    const capped = checkRows(lines.join("\n") + "\n", [{ test: "Sodium", value: "139", unit: "mmol/L", range_text: "136-145", quote: lines[0], plain_name: "a", ask: "b" }]).coverage;
    expect(capped).toMatchObject({ candidates: 42, checked: 1 });
    expect(capped.unchecked[0]).toBe("Potassium 2.0 mmol/L 3.5-5.1 PANIC");
    act(() => root.render(<UncheckedLines coverage={capped} />));
    expect(host.textContent).toContain("And 1 more line not shown here.");
  });

  it("(4) critical rows stay pinned in the flagged group and open, with the in-range fold closed", () => {
    render();
    const crit = rowNamed("Potassium, repeat");
    expect(visible(crit)).toBe(true);
    expect(visible(panelOf(crit))).toBe(true);
    expect(crit.closest('[data-lab-group="outside"]')).not.toBeNull();
    expect(document.getElementById(host.querySelector('[data-lab-group="inside"] > button')!.getAttribute("aria-controls")!)!.hidden).toBe(true);
  });
});

describe("accessibility", () => {
  it("every row is a disclosure that controls its own panel; groups are headed", () => {
    render();
    const toggles = [...host.querySelectorAll<HTMLButtonElement>("li[data-lab-row] > button[aria-expanded]")];
    expect(toggles).toHaveLength(ROWS.length);
    for (const b of toggles) {
      const panel = document.getElementById(b.getAttribute("aria-controls")!)!;
      expect(panel.hidden).toBe(b.getAttribute("aria-expanded") === "false");
      expect(b.closest("li")!.contains(panel)).toBe(true);
    }
    for (const s of host.querySelectorAll("section[aria-labelledby]")) expect(document.getElementById(s.getAttribute("aria-labelledby")!)?.tagName).toBe("H3");
    expect(host.querySelectorAll("button button")).toHaveLength(0);
  });
});
