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
    expect(r.rows[0].status).toBe("unknown"); // a range the line doesn't print is ignored
  });

  it("the sample lab report is clearly labeled and contains no real person", () => {
    expect(SAMPLE_LABS).toContain("SAMPLE");
    expect(SAMPLE_LABS).toMatch(/not a real patient/i);
  });
});
