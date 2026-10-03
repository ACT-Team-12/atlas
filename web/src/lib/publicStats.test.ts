import { describe, expect, it } from "vitest";
import { publicStats } from "./publicStats";
import type { LiveStats } from "./db";
import { buildFunnel } from "./helperFunnel";

const live = (o: Partial<LiveStats> = {}): LiveStats => ({
  reads: 40, plans: 25, quizzes: 3, feedback: 4,
  median_read_ms: 8000, median_plan_ms: 9000, quiz_first_try_rate: 0.5, avg_rating: 4.5,
  would_use: { yes: 3, no: 1 }, roles: { patient: 2, caregiver: 2 },
  surfaces: { web: 31, ios: 9 }, languages: { English: 30, Spanish: 6, Amharic: 1 },
  helper_link_plans: 20, since: "2026-09-30T00:00:00.000Z", ...o,
});

/** Every count in the public payload that is an exact number under 10. */
function smallNumbers(v: unknown, path = ""): string[] {
  if (typeof v === "number") return Number.isInteger(v) && v < 10 ? [path] : [];
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => smallNumbers(x, `${path}.${k}`));
  return [];
}

describe("public stats", () => {
  it("never publishes an exact count under 10, in totals or in any breakdown", () => {
    const p = publicStats(live(), { available: false, reason: "error" });
    const counts = { ...p, median_read_ms: null, median_plan_ms: null, quiz_first_try_rate: null, avg_rating: null };
    expect(smallNumbers(counts)).toEqual([]);
    expect(p.reads).toBe(40);
    expect(p.quizzes).toBe("<10");
    expect(p.feedback).toBe("<10");
  });

  it("does not name a rare language, and hides a breakdown entry the total would give away", () => {
    const p = publicStats(live(), { available: false, reason: "error" });
    expect(JSON.stringify(p)).not.toContain("Amharic");
    // web 31 + ios 9 = reads 40: showing 31 would give away the 9.
    expect(p.surfaces).toEqual({ web: "hidden", ios: "<10" });
  });

  it("leaves out averages and rates worked out from fewer than 10 answers", () => {
    const p = publicStats(live(), { available: false, reason: "error" });
    expect(p.avg_rating).toBeNull();
    expect(p.quiz_first_try_rate).toBeNull();
    expect(publicStats(live({ feedback: 12 }), { available: false, reason: "error" }).avg_rating).toBe(4.5);
  });

  it("hides the helper-link count when plans minus it would be under 10", () => {
    expect(publicStats(live({ plans: 25, helper_link_plans: 20 }), { available: false, reason: "error" }).helper_link_plans).toBe("hidden");
    expect(publicStats(live({ plans: 40, helper_link_plans: 20 }), { available: false, reason: "error" }).helper_link_plans).toBe(20);
    expect(publicStats(live({ helper_link_plans: null }), { available: false, reason: "not-migrated" }).helper_link_plans).toBeNull();
  });

  it("uses the funnel's own all-time helper count when the funnel is available, so the two never disagree", () => {
    const funnel = buildFunnel([{ language: "English", helper_7d: 0, all_7d: 0, helper_all: 13, all_all: 15 }]);
    const p = publicStats(live({ plans: 15, helper_link_plans: 13 }), { available: true, funnel });
    expect(p.helper_link_plans).toBe(funnel.all_time.helper_link_plans);
    expect(p.helper_link_plans).toBe("hidden");
  });
});
