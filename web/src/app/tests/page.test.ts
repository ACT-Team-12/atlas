import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { LiveStats } from "@/lib/db";

const db = vi.hoisted(() => ({ live: null as LiveStats | null }));
vi.mock("@/lib/db", () => ({
  liveStats: async () => db.live,
  helperFunnel: async () => ({ available: false, reason: "no-database" }),
}));

const stats = (o: Partial<LiveStats> = {}): LiveStats => ({
  reads: 7, plans: 3, quizzes: 2, feedback: 4,
  median_read_ms: 8000, median_plan_ms: 9000, quiz_first_try_rate: 0.5, avg_rating: 4.5,
  would_use: { yes: 3, maybe: 1 }, roles: { patient: 2, caregiver: 2 },
  surfaces: { web: 7 }, languages: { Amharic: 7 },
  helper_link_plans: 2, since: null, ...o,
});

/** The visible text of the live-use section of /tests, rendered from the real page. */
async function liveSection(): Promise<string> {
  const { default: TestsPage } = await import("./page");
  const html = renderToStaticMarkup(await TestsPage());
  const start = html.indexOf('aria-labelledby="live-title"');
  const end = html.lastIndexOf("<section", html.indexOf('aria-labelledby="limits-title"'));
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end).replace(/<[^>]*>/g, " ").replace(/&lt;/g, "<").replace(/\s+/g, " ");
}

describe("/tests live numbers", () => {
  beforeEach(() => { db.live = null; });

  it("never shows an exact count under 10", async () => {
    db.live = stats();
    const text = await liveSection();
    expect(text).toContain("papers read");
    // Any standalone number under 10 is a leak. ("<10" is the allowed label.)
    expect(text.replace(/<10/g, "").match(/(?<![\d.])\d(?![\d.])/g)).toBeNull();
    expect(text).not.toContain("average 4.5");
  });

  it("still shows counts of 10 and more exactly", async () => {
    db.live = stats({ reads: 40, plans: 25, feedback: 30, would_use: { yes: 20, no: 10 }, roles: { patient: 18, caregiver: 12 } });
    const text = await liveSection();
    expect(text).toContain("40 papers read");
    expect(text).toContain("25 plans built");
    expect(text).toContain("20 of 30");
    expect(text).toContain("average 4.5 of 5");
  });
});
