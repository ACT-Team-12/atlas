import { describe, expect, it } from "vitest";
import { findTestName, isCritical, labChip, labClosedRow } from "./labsView";

describe("labsView", () => {
  it("finds the test name as the line prints it", () => {
    expect(findTestName("Glucose, fasting         126       mg/dL", "glucose fasting")?.text).toBe("Glucose, fasting");
    expect(findTestName("Sodium 139", "Potassium")).toBeNull();
    expect(findTestName("Sodium 139", "")).toBeNull();
  });

  it("reads critical from the report's own line only", () => {
    expect(isCritical("Potassium 2.4 mmol/L 3.5-5.1 LL")).toBe(true);
    expect(isCritical("Potassium 6.9 mmol/L 3.5-5.1 HH")).toBe(true);
    expect(isCritical("Troponin 2.1 ng/mL <0.04 CRITICAL")).toBe(true);
    expect(isCritical("Glucose 40 mg/dL 70-99 L (panic value)")).toBe(true);
    expect(isCritical("Glucose 126 mg/dL 70-99 H")).toBe(false);
    expect(isCritical("HHV-6 antibody 1.2")).toBe(false);
  });

  it("the chip comes from our code's status and direction", () => {
    expect(labChip({ status: "outside", direction: "high" }).label).toBe("High");
    expect(labChip({ status: "outside", direction: "low" }).label).toBe("Low");
    expect(labChip({ status: "outside", direction: null }).label).toBe("Flagged");
    expect(labChip({ status: "inside", direction: null }).label).toBe("In range");
    expect(labChip({ status: "unknown", direction: null }).label).toBe("Can't tell");
  });

  it("a closed row is made of the line's own words", () => {
    const c = labClosedRow({ quote: "LDL Cholesterol          142       mg/dL      <100              H", test: "ldl cholesterol", value: "142", unit: "mg/dL", range_text: "<100" });
    expect(c).toEqual({ name: "LDL Cholesterol", value: "142", unit: "mg/dL", range: "<100", critical: false });
  });

  it("a shorter AI name can't drop a printed qualifier: the name runs from the line's start to the result (Codex review)", () => {
    const at = (quote: string, test: string, value: string) => labClosedRow({ quote, test, value, unit: "", range_text: "" }).name;
    expect(at("HDL Cholesterol    38    mg/dL    >40    L", "Cholesterol", "38")).toBe("HDL Cholesterol");
    expect(at("High Sensitivity CRP 1.0 mg/L 0.0-3.0", "CRP", "1.0")).toBe("High Sensitivity CRP");
    expect(at("Cholesterol, HDL: 38 mg/dL >40 L", "Cholesterol", "38")).toBe("Cholesterol, HDL");
    expect(at("Vitamin B12   450   pg/mL   200-900", "Vitamin B12", "450")).toBe("Vitamin B12");
  });
});
