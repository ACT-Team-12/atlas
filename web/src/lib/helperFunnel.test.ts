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
    // 13 of 15 would give away 2 plans not from a helper link, so the 13 is hidden.
    expect(f.all_time).toEqual({ helper_link_plans: "hidden", all_plans: 15 });
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
    // 11 of 20 would give away 9 plans not from a helper link, so the 11 is hidden; all plans stay exact.
    expect(vi.all_time).toEqual({ helper_link_plans: "hidden", all_plans: 20 });
  });

  it("is empty, not invented, when there are no plans", () => {
    const f = buildFunnel([]);
    expect(f.by_language).toEqual([]);
    expect(f.all_time).toEqual({ helper_link_plans: "<10", all_plans: "<10" });
  });
});

// ---------- subtraction attacks ----------

type Num = Record<"helper_7d" | "all_7d" | "helper_all" | "all_all", number | null>;
/** What a reader sees for one row, as numbers where shown and null where hidden or "<10". */
const seen = (c: { last_7_days: { helper_link_plans: unknown; all_plans: unknown }; all_time: { helper_link_plans: unknown; all_plans: unknown } }): Num => {
  const n = (v: unknown) => (typeof v === "number" ? v : null);
  return { helper_7d: n(c.last_7_days.helper_link_plans), all_7d: n(c.last_7_days.all_plans), helper_all: n(c.all_time.helper_link_plans), all_all: n(c.all_time.all_plans) };
};
const PAIRS = [["all_7d", "helper_7d"], ["all_all", "helper_all"], ["all_all", "all_7d"], ["helper_all", "helper_7d"]] as const;

/** Every exact count under 10 a reader can work out by subtracting what the funnel shows. */
function derivableSmall(f: ReturnType<typeof buildFunnel>): string[] {
  const out: string[] = [];
  const rows = [{ name: "total", v: seen(f) }, ...f.by_language.map((r) => ({ name: r.language, v: seen(r) }))];
  for (const { name, v } of rows) {
    for (const [a, b] of PAIRS) {
      const x = v[a], y = v[b];
      if (x !== null && y !== null && x - y < 10) out.push(`${name}: ${a} - ${b} = ${x - y}`);
    }
  }
  const total = seen(f);
  for (const c of ["helper_7d", "all_7d", "helper_all", "all_all"] as const) {
    const t = total[c];
    if (t === null || f.by_language.length === 0) continue;
    const cells = f.by_language.map((r) => seen(r)[c]);
    const hidden = cells.filter((x) => x === null).length;
    const rest = t - cells.reduce<number>((s, x) => s + (x ?? 0), 0);
    if (hidden === 1 || (hidden > 1 && rest < 10)) out.push(`${c}: total minus shown rows = ${rest} over ${hidden} hidden rows`);
  }
  return out;
}

describe("helper-link funnel against subtraction", () => {
  it("hides helper counts whose gap to all plans is under 10, in rows and totals", () => {
    const f = buildFunnel([row("English", 3, 12, 11, 20), row("Spanish", 12, 20, 30, 40)]);
    expect(derivableSmall(f)).toEqual([]);
    // All plans stay exact (they are also public as the plans count); the helper side is what gets hidden.
    expect(f.all_time.all_plans).toBe(60);
  });

  it("hides a last-7-days count whose gap to all time is under 10", () => {
    const f = buildFunnel([row("English", 10, 10, 13, 13)]);
    expect(derivableSmall(f)).toEqual([]);
  });

  it("never lets any exact count under 10 be worked out, over many random tables", () => {
    let seed = 7;
    const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let k = 0; k < 400; k++) {
      const langs = ["English", "Spanish", "Vietnamese", "Korean", null].slice(0, 1 + rnd(5));
      const rows = langs.map((l) => {
        const all_all = rnd(60), all_7d = rnd(all_all + 1), helper_all = rnd(all_all + 1), helper_7d = Math.min(all_7d, rnd(helper_all + 1));
        return row(l, helper_7d, all_7d, helper_all, all_all);
      });
      const f = buildFunnel(rows);
      expect(derivableSmall(f), JSON.stringify(rows)).toEqual([]);
    }
  });
});
