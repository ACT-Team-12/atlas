import { describe, expect, it } from "vitest";
import { checkRows, parseRange, printedFlag, resultLines, ResultsReadRequestSchema } from "./results";
import { SAMPLE_LABS } from "./sampleLabs";

const row = (o: Partial<{ test: string; value: string; unit: string; range_text: string; quote: string }>) => ({
  test: "Glucose", value: "126", unit: "mg/dL", range_text: "70-99", quote: "Glucose 126 mg/dL 70-99 H", plain_name: "x", ask: "y", ...o,
});

describe("lab results: our code decides what is outside the range", () => {
  it("parses printed ranges, keeping whether the limit itself is included", () => {
    expect(parseRange("70-99")).toEqual({ lo: { at: 70, incl: true }, hi: { at: 99, incl: true } });
    expect(parseRange("70 - 99")).toEqual({ lo: { at: 70, incl: true }, hi: { at: 99, incl: true } });
    expect(parseRange("-2 to 3")).toEqual({ lo: { at: -2, incl: true }, hi: { at: 3, incl: true } });
    expect(parseRange("<200")).toEqual({ lo: null, hi: { at: 200, incl: false } });
    expect(parseRange("<=200")).toEqual({ lo: null, hi: { at: 200, incl: true } });
    expect(parseRange(">= 60")).toEqual({ lo: { at: 60, incl: true }, hi: null });
    expect(parseRange(">60")).toEqual({ lo: { at: 60, incl: false }, hi: null });
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
      row({ test: "Sodium", value: "139", range_text: "136-145", quote: "Sodium 139 mmol/L 136-145 ... H" }), // flag added after an ellipsis: too short to check, so the quote is refused
      row({ test: "Sodium", value: "139", range_text: "136-145", quote: "Sodium 139 mmol/L 136-145\nPotassium 3.2 mmol/L 3.5-5.1 L" }), // runs into the next line
      row({ test: "Potassium", value: "3.2", range_text: "", quote: "Potassium 3.2" }), // cut short before the flag
      row({ test: "LDL", value: "100", range_text: "<100", quote: "LDL 162 mg/dL <100" }), // value copied from the range
      row({ test: "Ferritin", value: "162", range_text: "<100", quote: "LDL 162 mg/dL <100" }), // another test's name
    ]);
    expect(r.rows.map((x) => [x.test, x.status, x.direction, x.quote])).toEqual([
      ["Potassium", "outside", "low", "Potassium 3.2 mmol/L 3.5-5.1 L"],
    ]);
    expect(r.dropped).toEqual([
      { test: "Sodium", reason: "not_in_report" },
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

  it("a photo read accepts only images of a sane size", () => {
    const img = "a".repeat(200);
    expect(ResultsReadRequestSchema.safeParse({ image_base64: img, image_media_type: "image/jpeg" }).success).toBe(true);
    expect(ResultsReadRequestSchema.safeParse({ image_base64: img, image_media_type: "application/pdf" }).success).toBe(false);
    expect(ResultsReadRequestSchema.safeParse({ image_base64: "a".repeat(8_000_001), image_media_type: "image/png" }).success).toBe(false);
    expect(ResultsReadRequestSchema.safeParse({ image_media_type: "image/png" }).success).toBe(false);
  });

  it("the sample lab report is clearly labeled and contains no real person", () => {
    expect(SAMPLE_LABS).toContain("SAMPLE");
    expect(SAMPLE_LABS).toMatch(/not a real patient/i);
  });
});

// Cases from an adversarial review of the first version. Each one failed before and passes now.
describe("lab results: adversarial review cases", () => {
  const one = (line: string, o: Parameters<typeof row>[0]) => checkRows(line, [row({ quote: line, ...o })]);
  const status = (res: ReturnType<typeof checkRows>) => res.rows.map((x) => [x.status, x.direction]);

  it("1. the value must be the line's own result, with its sign and < or >", () => {
    const wbc = "WBC 5.0 x10^3/uL 4.0-10.0";
    expect(one(wbc, { test: "WBC", value: "4.0", unit: "x10^3/uL", range_text: "4.0-10.0" }).dropped[0]?.reason).toBe("value_not_in_quote"); // a range limit
    expect(one(wbc, { test: "WBC", value: "10", unit: "x10^3/uL", range_text: "" }).dropped[0]?.reason).toBe("value_not_in_quote"); // a number from the unit
    expect(one(wbc, { test: "WBC", value: "5.0", unit: "x10^3/uL", range_text: "4.0-10.0" }).rows[0]?.status).toBe("inside");
    const be = "Base Excess -1 mmol/L (-2 to 3)";
    expect(one(be, { test: "Base Excess", value: "1", unit: "mmol/L", range_text: "-2 to 3" }).dropped[0]?.reason).toBe("value_not_in_quote");
    expect(status(one(be, { test: "Base Excess", value: "-1", unit: "mmol/L", range_text: "-2 to 3" }))).toEqual([["inside", null]]);
    const crp = "CRP <0.5 mg/L 0.0-3.0";
    expect(one(crp, { test: "CRP", value: "0.5", unit: "mg/L", range_text: "0.0-3.0" }).dropped[0]?.reason).toBe("value_not_in_quote");
    expect(one(crp, { test: "Sodium", value: "<0.5", unit: "mg/L", range_text: "0.0-3.0" }).dropped[0]?.reason).toBe("test_not_in_line");
  });

  it("2. < and > leave the limit out, and a value printed as <x or >x is a span, not a number", () => {
    expect(status(one("LDL 200 mg/dL <200", { test: "LDL", value: "200", range_text: "<200" }))).toEqual([["outside", "high"]]);
    expect(status(one("LDL 200 mg/dL <=200", { test: "LDL", value: "200", range_text: "<=200" }))).toEqual([["inside", null]]);
    expect(status(one("eGFR 60 mL/min >60", { test: "eGFR", value: "60", unit: "mL/min", range_text: ">60" }))).toEqual([["outside", "low"]]);
    expect(status(one("eGFR 60 mL/min >=60", { test: "eGFR", value: "60", unit: "mL/min", range_text: ">=60" }))).toEqual([["inside", null]]);
    expect(status(one("Bilirubin <0.2 mg/dL 0.1-1.2", { test: "Bilirubin", value: "<0.2", range_text: "0.1-1.2" }))).toEqual([["unknown", null]]);
    expect(status(one("Troponin >50 ng/L <14", { test: "Troponin", value: ">50", unit: "ng/L", range_text: "<14" }))).toEqual([["outside", "high"]]);
    expect(status(one("CRP <0.5 mg/L 0.0-3.0", { test: "CRP", value: "<0.5", unit: "mg/L", range_text: "0.0-3.0" }))).toEqual([["unknown", null]]);
    expect(status(one("CRP <0.5 mg/L <=3.0", { test: "CRP", value: "<0.5", unit: "mg/L", range_text: "<=3.0" }))).toEqual([["inside", null]]);
  });

  it("3. a flag is only read after the value, never from the unit or the test name", () => {
    // A lone "L" may be liters or Low. The AI naming the unit "L" may only add caution, never clear it: in range by the
    // printed range is still "can't tell", shown and never folded (security review; this was "inside" before).
    expect(status(one("Volume 3.0 L 2.0-4.0", { test: "Volume", value: "3.0", unit: "L", range_text: "2.0-4.0" }))).toEqual([["unknown", null]]);
    expect(status(one("Volume 3.0 L 2.0-4.0", { test: "Volume", value: "3.0", unit: "", range_text: "2.0-4.0" }))).toEqual([["unknown", null]]);
    expect(status(one("Potassium 3.2 L 3.5-5.1", { test: "Potassium", value: "3.2", unit: "", range_text: "3.5-5.1" }))).toEqual([["outside", "low"]]);
    expect(status(one("CRP 1.0 mg/L 0.0-3.0", { test: "CRP", value: "1.0", unit: "mg/L", range_text: "0.0-3.0" }))).toEqual([["inside", null]]);
    // "High Sensitivity" in the name is not a flag, even when the AI shortens the name.
    expect(status(one("High Sensitivity CRP 1.0 mg/L 0.0-3.0", { test: "CRP", value: "1.0", unit: "mg/L", range_text: "0.0-3.0" }))).toEqual([["inside", null]]);
    expect(status(one("High Sensitivity CRP 1.0 mg/L 0.0-3.0", { test: "High Sensitivity CRP", value: "1.0", unit: "mg/L", range_text: "0.0-3.0" }))).toEqual([["inside", null]]);
    // A real flag after an HDL or LDL name with High-density or Low-density in it still counts.
    expect(status(one("HDL Cholesterol (High-density lipoprotein) 35 mg/dL >40 L", { test: "HDL Cholesterol", value: "35", range_text: ">40" }))).toEqual([["outside", "low"]]);
    expect(status(one("LDL (Low-density lipoprotein) 90 mg/dL 0-99 H", { test: "LDL", value: "90", range_text: "0-99" }))).toEqual([["outside", "high"]]);
    expect(status(one("High-density lipoprotein (HDL) 38 L mg/dL >=40", { test: "High-density lipoprotein (HDL)", value: "38", range_text: ">=40" }))).toEqual([["outside", "low"]]);
    // Parenthesized and starred flags.
    expect(status(one("Uric Acid 8.1 mg/dL 3.5-7.2 (H)", { test: "Uric Acid", value: "8.1", range_text: "3.5-7.2" }))).toEqual([["outside", "high"]]);
    expect(status(one("Sodium 128 mmol/L 136-145 LL*", { test: "Sodium", value: "128", unit: "mmol/L", range_text: "136-145" }))).toEqual([["outside", "low"]]);
  });

  it("4. an empty or partial reading reports which result lines were not checked", () => {
    const src = "Glucose 126 mg/dL 70-99 H\nSodium 139 mmol/L 136-145\nHemoglobin A1c 7.4 % <5.7 H\nCollected 09/28/2026 08:12";
    expect(checkRows(src, []).coverage).toEqual({ candidates: 3, checked: 0, unchecked: ["Glucose 126 mg/dL 70-99 H", "Sodium 139 mmol/L 136-145", "Hemoglobin A1c 7.4 % <5.7 H"] });
    const part = checkRows(src, [row({ test: "Sodium", value: "139", unit: "mmol/L", range_text: "136-145", quote: "Sodium 139 mmol/L 136-145" })]);
    expect(part.counts.outside).toBe(0);
    expect(part.coverage).toEqual({ candidates: 3, checked: 1, unchecked: ["Glucose 126 mg/dL 70-99 H", "Hemoglobin A1c 7.4 % <5.7 H"] });
  });
});

describe("critical headings (Codex review)", () => {
  it("a heading made only of the marker and heading words is not an unchecked result; a real critical line still is", () => {
    const src = ["CRITICAL VALUES", "*** Panic Results ***", "Critical values and alerts:", "Troponin unable to calculate CRITICAL", "Potassium 6.9 mmol/L 3.5-5.1 HH"].join("\n");
    expect(resultLines(src)).toEqual(["Troponin unable to calculate CRITICAL", "Potassium 6.9 mmol/L 3.5-5.1 HH"]);
  });

  it("page and count marks don't turn a heading into a result; a bare critical number still counts (round 2)", () => {
    const heads = ["CRITICAL VALUES - PAGE 2", "CRITICAL RESULTS (2)", "Critical values, page 2 of 3", "PANIC VALUES #3", "Critical results 1/2 continued"];
    expect(resultLines(heads.join("\n"))).toEqual([]);
    expect(resultLines("CRITICAL 6.9\nCRITICAL (6.9)")).toEqual(["CRITICAL 6.9", "CRITICAL (6.9)"]);
  });

  it("a line marked CRITICAL is outside even when the model calls it normal and the value sits in range", () => {
    for (const line of ["Potassium 4.0 mmol/L 3.5-5.1 CRITICAL", "CRITICAL Potassium 4.0 mmol/L 3.5-5.1", "Potassium 4.0 mmol/L 3.5-5.1 panic"]) {
      const res = checkRows(`${line}\n`, [{ ...row({ test: "Potassium", value: "4.0", unit: "mmol/L normal", range_text: "3.5-5.1", quote: line }), plain_name: "Normal potassium", ask: "Is this normal?" }]);
      // Outside, by the critical rule or by the trailing mark read as a flag; never inside or can't tell.
      expect(res.rows.map((r) => r.status), line).toEqual(["outside"]);
      expect(res.rows[0].reason, line).toMatch(/^Your report marks this line (critical|as abnormal)\.$/);
    }
  });
});
