/**
 * The helper-link funnel on /judge: plans built from a helper link vs all plans, in the last 7 days and all time, by language.
 * Small numbers are never shown: any count under SMALL becomes "<10", and a second count becomes "hidden" where the first
 * could otherwise be worked out by subtracting the others from the total. No ZIP or location exists to report.
 */

export const SMALL = 10;
/** "<10": the count is under 10. "hidden": it is 10 or more, hidden so a "<10" next to it can't be worked out from the total. */
export type Count = number | "<10" | "hidden";
export type FunnelCell = { helper_link_plans: Count; all_plans: Count };
export type FunnelRow = { language: string; last_7_days: FunnelCell; all_time: FunnelCell };
export type HelperFunnel = { last_7_days: FunnelCell; all_time: FunnelCell; by_language: FunnelRow[] };
export type HelperFunnelResult =
  | { available: true; funnel: HelperFunnel }
  | { available: false; reason: "no-database" | "not-migrated" | "error" };

/** One row from the database: production plans, test runs excluded, grouped by language (null when none was sent). */
export type PlanCounts = { language: string | null; helper_7d: number; all_7d: number; helper_all: number; all_all: number };

const COLS = ["helper_7d", "all_7d", "helper_all", "all_all"] as const;
type Col = (typeof COLS)[number];
export const OTHER = "Other languages";
export const NOT_GIVEN = "Not given";

export function suppress(n: number): Count {
  return n < SMALL ? "<10" : n;
}

/**
 * Languages with fewer than SMALL plans in all are folded into one "Other languages" row, so a rare language is never named.
 * Then each column is suppressed: under SMALL hides, and if exactly one row in a column is hidden while the total is shown,
 * the next smallest row is marked "hidden" too, so total minus the others never gives the small number.
 */
export function buildFunnel(rows: PlanCounts[]): HelperFunnel {
  const zero = (language: string): PlanCounts => ({ language, helper_7d: 0, all_7d: 0, helper_all: 0, all_all: 0 });
  const add = (a: PlanCounts, b: PlanCounts) => { for (const c of COLS) a[c] += b[c]; };

  const byLang = new Map<string, PlanCounts>();
  for (const r of rows) {
    const name = r.language?.trim() || NOT_GIVEN;
    if (!byLang.has(name)) byLang.set(name, zero(name));
    add(byLang.get(name)!, r);
  }
  const named: PlanCounts[] = [];
  const other = zero(OTHER);
  for (const r of byLang.values()) {
    if (r.all_all >= SMALL && r.language !== NOT_GIVEN) named.push(r);
    else add(other, r);
  }
  named.sort((a, b) => b.all_all - a.all_all || a.language!.localeCompare(b.language!));
  const grouped = other.all_all > 0 ? [...named, other] : named;

  const total = zero("");
  for (const r of grouped) add(total, r);

  const hidden = grouped.map(() => new Set<Col>());
  for (const c of COLS) {
    grouped.forEach((r, i) => { if (r[c] < SMALL) hidden[i].add(c); });
    const hiddenRows = grouped.filter((_, i) => hidden[i].has(c)).length;
    if (hiddenRows === 1 && total[c] >= SMALL) {
      let next = -1;
      grouped.forEach((r, i) => { if (!hidden[i].has(c) && (next < 0 || r[c] < grouped[next][c])) next = i; });
      if (next >= 0) hidden[next].add(c);
    }
  }

  const show = (r: PlanCounts, c: Col, h?: Set<Col>): Count => (r[c] < SMALL ? "<10" : h?.has(c) ? "hidden" : r[c]);
  const cell = (r: PlanCounts, h: Set<Col> | undefined, helper: Col, all: Col): FunnelCell => ({ helper_link_plans: show(r, helper, h), all_plans: show(r, all, h) });
  return {
    last_7_days: cell(total, undefined, "helper_7d", "all_7d"),
    all_time: cell(total, undefined, "helper_all", "all_all"),
    by_language: grouped.map((r, i) => ({
      language: r.language!,
      last_7_days: cell(r, hidden[i], "helper_7d", "all_7d"),
      all_time: cell(r, hidden[i], "helper_all", "all_all"),
    })),
  };
}
