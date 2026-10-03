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
import { labQuestionsText } from "@/lib/labsView";
import { LabRows } from "./LabResults";

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

/**
 * Every place an AI-written string shows up, in text nodes and attributes. Each must sit after the report's own full
 * line, inside the same opened row panel or the same question item, and never on a closed row (a button).
 */
function assertAiNeverWithoutLine(rows: ResultRow[]) {
  for (const r of rows) {
    for (const ai of [r.plain_name, r.ask]) {
      for (const el of host.querySelectorAll("*")) {
        for (const a of el.getAttributeNames()) expect(el.getAttribute(a) ?? "", `${a} on <${el.tagName}>`).not.toContain(ai);
      }
      const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
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
    expect(text).toContain("1. AI-ASK about [glucose fasting]?");
    expect(text).toContain(`Your report says: "${ROWS[0].quote}"`);
    for (const line of text.split("\n").filter((l) => l.includes("AI-ASK"))) {
      const next = text.split("\n")[text.split("\n").indexOf(line) + 1];
      expect(next).toMatch(/^ {3}Your report says: "/);
    }
    expect(labQuestionsText([])).toBe("");
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
