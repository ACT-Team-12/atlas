import labSet from "@/data/eval/labs.json";
import { checkRows, type ResultRow } from "./results";

/**
 * Planted-mistake test for "Explain my lab results" (no AI involved). For each sample lab report (written by Team
 * ATLAS, not a real patient) we build the rows a correct reading would return, then plant the mistakes a wrong AI
 * could make. Our code (checkRows) must leave every correct row judged right, and must either drop each planted row
 * or still judge it from what the report actually prints.
 */

export type Truth = "high" | "low" | "inside" | "unknown";
/** `cautious`: why our code shows this row as can't tell on purpose. The truth stays the hand label; the row is counted apart. */
export type LabRow = { test: string; line: string; value: string; unit: string; range_text: string; truth: Truth; cautious?: string };
export type LabReport = { id: string; title: string; layout: string; text: string; rows: LabRow[] };
export const LAB_REPORTS = (labSet as unknown as { reports: LabReport[] }).reports;

type ModelRow = Parameters<typeof checkRows>[1][number];

/** "high" / "low" / "inside" / "unknown", or "flagged" when the line is marked abnormal with no direction. */
export function statusOf(r: ResultRow): Truth | "flagged" {
  if (r.status === "outside") return r.direction ?? "flagged";
  return r.status;
}

const asModelRow = (r: LabRow): ModelRow => ({ test: r.test, value: r.value, unit: r.unit, range_text: r.range_text, quote: r.line, plain_name: "", ask: "" });

/** A number that is not printed anywhere on the line, written with the same decimals. */
function otherNumber(value: string, line: string): string {
  const v = Number(value.replace(/[^\d.]/g, ""));
  const decimals = (value.split(".")[1] ?? "").replace(/\D/g, "").length;
  for (let k = 3; k < 50; k++) {
    const s = (v * k + k).toFixed(decimals);
    if (!line.replace(/,/g, "").includes(s)) return s;
  }
  throw new Error(`no free number for ${value}`);
}

// "drop": the row must be left out (a wrong number or name must never be shown).
// "drop or right": either left out, or kept and judged the same as the truth.
type Expect = "drop" | "drop or right";
type Plant = { kind: string; expect: Expect; row: ModelRow; truth: Truth; cautious: boolean; test: string; what: string };

export const PLANT_KINDS = [
  "changed value", "value copied from the range", "changed range", "range left out", "quote not in report",
  "invented test", "test name from another line", "flag added to the quote", "flag moved from another line", "quote cut short",
] as const;

export function plantsFor(rep: LabReport): Plant[] {
  const out: Plant[] = [];
  rep.rows.forEach((r, i) => {
    const base = asModelRow(r);
    const p = (kind: (typeof PLANT_KINDS)[number], expect: Expect, row: Partial<ModelRow>, what: string) =>
      out.push({ kind, expect, row: { ...base, ...row }, truth: r.truth, cautious: !!r.cautious, test: r.test, what });

    const wrong = otherNumber(r.value, r.line);
    p("changed value", "drop", { value: wrong }, `value ${r.value} changed to ${wrong}`);

    const bound = r.range_text.match(/\d[\d,]*(?:\.\d+)?/g)?.at(-1);
    // Skipped when the result really is the limit ("100" with "<100"): then it is not a mistake.
    if (bound && Number(bound.replace(/,/g, "")) !== Number(r.value.replace(/[^\d.-]/g, ""))) p("value copied from the range", "drop", { value: bound }, `value ${r.value} replaced by the range limit ${bound}`);

    p("changed range", "drop or right", { range_text: "1-2" }, `range ${r.range_text || "(none)"} changed to 1-2`);
    if (r.range_text) p("range left out", "drop or right", { range_text: "" }, `range ${r.range_text} left out`);

    const fakeLine = r.line.replace(r.value, wrong);
    p("quote not in report", "drop", { value: wrong, quote: fakeLine }, `quote rewritten with ${wrong} in place of ${r.value}`);

    const other = rep.rows.find((o, j) => j !== i && !r.line.toLowerCase().includes(o.test.toLowerCase()));
    if (other) p("test name from another line", "drop", { test: other.test }, `${r.test} line labeled as ${other.test}`);

    const fakeFlag = r.truth === "high" ? "L" : "H";
    p("flag added to the quote", "drop or right", { quote: `${r.line} ${fakeFlag}` }, `"${fakeFlag}" added after the line`);
    p("flag added to the quote", "drop or right", { quote: `${r.line} ... ${fakeFlag}` }, `"... ${fakeFlag}" added after the line`);

    const flagged = rep.rows.find((o, j) => j !== i && o.truth !== r.truth && o.truth !== "unknown");
    if (flagged) p("flag moved from another line", "drop or right", { quote: `${r.line}\n${flagged.line}` }, `quote runs into the ${flagged.test} line (${flagged.truth})`);

    const cut = r.line.slice(0, r.line.indexOf(r.value) + r.value.length);
    if (cut.length < r.line.trimEnd().length) p("quote cut short", "drop or right", { quote: cut }, "quote stops right after the value, before the range and flag");
  });
  out.push({
    kind: "invented test", expect: "drop", truth: "high", cautious: false, test: "Vitamin K2", what: "a test the report does not have",
    row: { test: "Vitamin K2", value: "88", unit: "ng/mL", range_text: "10-50", quote: "Vitamin K2 88 ng/mL 10-50 H", plain_name: "", ask: "" },
  });
  return out;
}

export type LabPlantedReport = {
  reports: number;
  real: {
    total: number; right: number; wrong: { report: string; test: string; truth: Truth; got: string }[];
    /** Rows our code shows as can't tell on purpose (never folded as in range), apart from right and wrong. */
    cautious: { report: string; test: string; truth: Truth; why: string }[];
  };
  planted: {
    total: number; caught: number; dropped: number; judged_right: number;
    /** Kept on a row marked cautious and shown as can't tell: safe, but not counted as judged right. */
    cautious_kept: number;
    byKind: Record<string, { total: number; caught: number }>;
    slipped: { report: string; test: string; kind: string; what: string; truth: Truth; got: string }[];
    examples: Record<string, string>;
  };
};

export function runLabPlantedTest(reports: LabReport[] = LAB_REPORTS): LabPlantedReport {
  const rep: LabPlantedReport = {
    reports: reports.length,
    real: { total: 0, right: 0, wrong: [], cautious: [] },
    planted: { total: 0, caught: 0, dropped: 0, judged_right: 0, cautious_kept: 0, byKind: {}, slipped: [], examples: {} },
  };
  for (const r of reports) {
    // Correct rows, all at once, the way the AI would return them.
    const real = checkRows(r.text, r.rows.map(asModelRow));
    for (const t of r.rows) {
      rep.real.total++;
      const got = real.rows.find((x) => x.test === t.test);
      const s = got ? statusOf(got) : "dropped";
      if (s === t.truth) rep.real.right++;
      else if (t.cautious && s === "unknown") rep.real.cautious.push({ report: r.id, test: t.test, truth: t.truth, why: t.cautious });
      else rep.real.wrong.push({ report: r.id, test: t.test, truth: t.truth, got: s });
    }
    // Each planted mistake on its own.
    for (const pl of plantsFor(r)) {
      const res = checkRows(r.text, [pl.row]);
      const kept = res.rows[0];
      const got = kept ? statusOf(kept) : `dropped (${res.dropped[0]?.reason})`;
      const ok = !kept || (pl.expect === "drop or right" && (statusOf(kept) === pl.truth || (pl.cautious && statusOf(kept) === "unknown")));
      const k = (rep.planted.byKind[pl.kind] ??= { total: 0, caught: 0 });
      rep.planted.total++; k.total++;
      rep.planted.examples[pl.kind] ??= `${r.title}, ${pl.test}: ${pl.what}`;
      if (ok) {
        rep.planted.caught++; k.caught++;
        if (!kept) rep.planted.dropped++;
        else if (statusOf(kept) === pl.truth) rep.planted.judged_right++;
        else rep.planted.cautious_kept++;
      } else {
        rep.planted.slipped.push({ report: r.id, test: pl.test, kind: pl.kind, what: pl.what, truth: pl.truth, got });
      }
    }
  }
  return rep;
}
