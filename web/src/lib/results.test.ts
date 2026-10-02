import { describe, expect, it } from "vitest";
import { checkRows, parseRange, printedFlag } from "./results";
import { SAMPLE_LABS } from "./sampleLabs";

const row = (o: Partial<{ test: string; value: string; unit: string; range_text: string; quote: string }>) => ({
  test: "Glucose", value: "126", unit: "mg/dL", range_text: "70-99", quote: "Glucose 126 mg/dL 70-99 H", plain_name: "x", ask: "y", ...o,
});

describe("lab results: our code decides what is outside the range", () => {
  it("parses printed ranges", () => {
    expect(parseRange("70-99")).toEqual({ lo: 70, hi: 99 });
    expect(parseRange("70 - 99")).toEqual({ lo: 70, hi: 99 });
    expect(parseRange("<200")).toEqual({ lo: null, hi: 200 });
    expect(parseRange(">= 60")).toEqual({ lo: 60, hi: null });
    expect(parseRange("see note")).toBeNull();
  });

  it("reads a printed High/Low flag but not 'high-density' in a test name", () => {
    expect(printedFlag("Glucose 126 mg/dL 70-99 H")).toBe("high");
    expect(printedFlag("Potassium 3.2 mmol/L 3.5-5.1 L")).toBe("low");
    expect(printedFlag("HDL (high-density lipoprotein) 52 mg/dL >40")).toBeNull();
  });

  it("flags from the printed flag, or from the value against the printed range", () => {
    const r = checkRows("Glucose 126 mg/dL 70-99 H\nSodium 139 mmol/L 136-145\nLDL 162 mg/dL <100", [
      row({}),
      row({ test: "Sodium", value: "139", range_text: "136-145", quote: "Sodium 139 mmol/L 136-145" }),
      row({ test: "LDL", value: "162", range_text: "<100", quote: "LDL 162 mg/dL <100" }),
    ]);
    expect(r.rows.map((x) => [x.test, x.status, x.direction])).toEqual([["Glucose", "outside", "high"], ["LDL", "outside", "high"], ["Sodium", "inside", null]]);
    expect(r.counts).toEqual({ outside: 2, inside: 1, unknown: 0 });
  });

  it("never trusts a value or range the line doesn't print, and drops rows not in the report", () => {
    const r = checkRows("Sodium 139 mmol/L 136-145", [
      row({ test: "Sodium", value: "150", range_text: "136-145", quote: "Sodium 139 mmol/L 136-145" }),
      row({ test: "Made up", value: "5", range_text: "1-2", quote: "Made up 5 1-2" }),
      row({ test: "Sodium", value: "139", range_text: "100-120", quote: "Sodium 139 mmol/L 136-145" }),
    ]);
    expect(r.dropped).toEqual([{ test: "Sodium", reason: "value_not_in_quote" }, { test: "Made up", reason: "not_in_report" }]);
    // A range the line doesn't print is ignored; our code reads the range the line does print.
    expect(r.rows[0]).toMatchObject({ status: "inside", range_text: "136-145" });
  });

  it("judges from the report's own full line, never from the AI's copy of it", () => {
    const src = "Sodium 139 mmol/L 136-145\nPotassium 3.2 mmol/L 3.5-5.1 L\nLDL 162 mg/dL <100";
    const r = checkRows(src, [
      row({ test: "Sodium", value: "139", range_text: "136-145", quote: "Sodium 139 mmol/L 136-145 ... H" }), // flag added after an ellipsis
      row({ test: "Sodium", value: "139", range_text: "136-145", quote: "Sodium 139 mmol/L 136-145\nPotassium 3.2 mmol/L 3.5-5.1 L" }), // runs into the next line
      row({ test: "Potassium", value: "3.2", range_text: "", quote: "Potassium 3.2" }), // cut short before the flag
      row({ test: "LDL", value: "100", range_text: "<100", quote: "LDL 162 mg/dL <100" }), // value copied from the range
      row({ test: "Ferritin", value: "162", range_text: "<100", quote: "LDL 162 mg/dL <100" }), // another test's name
    ]);
    expect(r.rows.map((x) => [x.test, x.status, x.direction, x.quote])).toEqual([
      ["Potassium", "outside", "low", "Potassium 3.2 mmol/L 3.5-5.1 L"],
      ["Sodium", "inside", null, "Sodium 139 mmol/L 136-145"],
    ]);
    expect(r.dropped).toEqual([
      { test: "Sodium", reason: "not_one_line" },
      { test: "LDL", reason: "value_not_in_quote" },
      { test: "Ferritin", reason: "test_not_in_line" },
    ]);
  });

  it("reads commas, <, <= and High-density without mistaking them", () => {
    const src = "Platelet Count 482,000 /uL 150,000-400,000\nHDL Cholesterol (High-density lipoprotein) 61 mg/dL >40\nC-Reactive Protein <0.5 mg/L (<=3.0)";
    const r = checkRows(src, [
      row({ test: "Platelet Count", value: "482,000", unit: "/uL", range_text: "150,000-400,000", quote: "Platelet Count 482,000 /uL 150,000-400,000" }),
      row({ test: "HDL Cholesterol", value: "61", range_text: ">40", quote: "HDL Cholesterol (High-density lipoprotein) 61 mg/dL >40" }),
      row({ test: "C-Reactive Protein", value: "<0.5", unit: "mg/L", range_text: "<=3.0", quote: "C-Reactive Protein <0.5 mg/L (<=3.0)" }),
      row({ test: "C-Reactive Protein", value: "3.0", unit: "mg/L", range_text: "<=3.0", quote: "C-Reactive Protein <0.5 mg/L (<=3.0)" }),
    ]);
    expect(r.rows.map((x) => [x.test, x.status, x.direction])).toEqual([
      ["Platelet Count", "outside", "high"], ["HDL Cholesterol", "inside", null], ["C-Reactive Protein", "inside", null],
    ]);
    expect(r.dropped).toEqual([{ test: "C-Reactive Protein", reason: "value_not_in_quote" }]);
  });

  it("the original sample report is still judged the same way", () => {
    const rows = SAMPLE_LABS.split("\n").flatMap((l) => {
      const m = l.match(/^(\S.+?)\s{2,}(\d+(?:\.\d+)?)\s/);
      return m && !/Collected/.test(l) ? [row({ test: m[1].trim(), value: m[2], range_text: "", quote: l })] : [];
    });
    expect(rows).toHaveLength(10);
    const r = checkRows(SAMPLE_LABS, rows);
    expect(r.dropped).toEqual([]);
    // Glucose, Potassium, A1c, Total Cholesterol and LDL are outside; the other five are inside.
    expect(r.counts).toEqual({ outside: 5, inside: 5, unknown: 0 });
  });

  it("the sample lab report is clearly labeled and contains no real person", () => {
    expect(SAMPLE_LABS).toContain("SAMPLE");
    expect(SAMPLE_LABS).toMatch(/not a real patient/i);
  });
});
