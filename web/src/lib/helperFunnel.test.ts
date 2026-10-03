import { describe, expect, it } from "vitest";
import { buildFunnel, OTHER, suppress, type PlanCounts } from "./helperFunnel";

const row = (language: string | null, helper_7d: number, all_7d: number, helper_all: number, all_all: number): PlanCounts =>
  ({ language, helper_7d, all_7d, helper_all, all_all });

describe("helper-link funnel suppression", () => {
  it("shows any count under 10 as <10, including zero, and 10 or more exactly", () => {
    expect([0, 1, 9, 10, 11, 250].map(suppress)).toEqual(["<10", "<10", "<10", 10, 11, 250]);
  });

  it("never leaks a small number in totals", () => {
    const f = buildFunnel([row("English", 3, 9, 4, 12)]);
    expect(f.last_7_days).toEqual({ helper_link_plans: "<10", all_plans: "<10" });
    expect(f.all_time).toEqual({ helper_link_plans: "<10", all_plans: 12 });
    expect(JSON.stringify(f)).not.toMatch(/:(3|4|9)\b/);
  });

  it("groups by language, folding languages with under 10 plans into one row", () => {
    const f = buildFunnel([
      row("English", 10, 20, 15, 40),
      row("Spanish", 12, 15, 20, 30),
      row("Amharic", 2, 2, 3, 3),
      row("Korean", 1, 1, 2, 4),
    ]);
    expect(f.by_language.map((r) => r.language)).toEqual(["English", "Spanish", OTHER]);
    // Amharic and Korean are never named: their 7 plans are in "Other languages", which is itself under 10.
    expect(JSON.stringify(f)).not.toMatch(/Amharic|Korean/);
    expect(f.by_language[2].all_time).toEqual({ helper_link_plans: "<10", all_plans: "<10" });
    expect(f.all_time).toEqual({ helper_link_plans: 40, all_plans: 77 });
  });

  it("merges a missing language into the not-given group, and the same language from separate rows", () => {
    const f = buildFunnel([row("Spanish", 5, 6, 6, 7), row("Spanish", 5, 6, 6, 7), row(null, 0, 0, 1, 1)]);
    expect(f.by_language.map((r) => r.language)).toEqual(["Spanish", OTHER]);
    expect(f.all_time).toEqual({ helper_link_plans: 13, all_plans: 15 });
    // Spanish alone is 12 of 14, but showing it would give away the other group's 1 of 1 (13 - 12), so it is hidden too.
    // It says "hidden", not "<10": 12 is not under 10.
    expect(f.by_language[0].all_time).toEqual({ helper_link_plans: "hidden", all_plans: "hidden" });
  });

  it("hides a second row when one hidden row could be worked out from the total", () => {
    const f = buildFunnel([
      row("English", 20, 30, 50, 100),
      row("Spanish", 12, 25, 30, 60),
      row("Vietnamese", 3, 12, 11, 20),
    ]);
    // Vietnamese last-7-day helper count (3) is under 10; the total (35) is shown, so the next smallest (Spanish, 12) is hidden too.
    const [en, es, vi] = f.by_language;
    expect(vi.last_7_days.helper_link_plans).toBe("<10");
    expect(es.last_7_days.helper_link_plans).toBe("hidden");
    expect(en.last_7_days.helper_link_plans).toBe(20);
    expect(f.last_7_days.helper_link_plans).toBe(35);
    // Columns with nothing hidden stay exact.
    expect(vi.all_time).toEqual({ helper_link_plans: 11, all_plans: 20 });
  });

  it("is empty, not invented, when there are no plans", () => {
    const f = buildFunnel([]);
    expect(f.by_language).toEqual([]);
    expect(f.all_time).toEqual({ helper_link_plans: "<10", all_plans: "<10" });
  });
});
