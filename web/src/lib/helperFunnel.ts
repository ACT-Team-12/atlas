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
/** [bigger, smaller]: the smaller is a part of the bigger, so bigger minus smaller is a group of its own. */
const PAIRS: [Col, Col][] = [["all_7d", "helper_7d"], ["all_all", "helper_all"], ["all_all", "all_7d"], ["helper_all", "helper_7d"]];
export const OTHER = "Other languages";
export const NOT_GIVEN = "Not given";

export function suppress(n: number): Count {
  return n < SMALL ? "<10" : n;
}

/**
 * Languages with fewer than SMALL plans in all are folded into one "Other languages" row, so a rare language is never named.
 * Then counts are suppressed: under SMALL shows "<10". A shown count is also marked "hidden" when subtracting it from a
 * shown count it is part of (helper from all, last 7 days from all time) would give a number under 10, and when the total
 * minus the shown rows of a column would give one hidden row, or hidden rows adding up to under 10.
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

  // Index grouped.length is the total row.
  const all = [...grouped, total];
  const T = grouped.length;
  const hidden = all.map(() => new Set<Col>());
  const visible = (i: number, c: Col) => all[i][c] >= SMALL && !hidden[i].has(c);
  // Repeat until nothing changes: hiding one count can make another one work-out-able.
  for (let changed = true; changed; ) {
    changed = false;
    const hide = (i: number, c: Col) => { if (!hidden[i].has(c)) { hidden[i].add(c); changed = true; } };
    // Within a row: all minus helper (plans not from a link) and all time minus last 7 days (older plans) must not be
    // under 10. The smaller side is hidden, so all-time plans (also public as the plans count) always stay exact.
    all.forEach((r, i) => { for (const [a, b] of PAIRS) if (visible(i, a) && visible(i, b) && r[a] - r[b] < SMALL) hide(i, b); });
    // Across rows: with the total shown, the hidden rows of a column must be at least two and add up to 10 or more.
    for (const c of COLS) {
      if (!visible(T, c) || T === 0) continue;
      const off = grouped.map((_, i) => i).filter((i) => !visible(i, c));
      const offSum = off.reduce((s, i) => s + grouped[i][c], 0);
      if (off.length === 0 || (off.length >= 2 && offSum >= SMALL)) continue;
      let next = -1;
      grouped.forEach((r, i) => { if (visible(i, c) && (next < 0 || r[c] < grouped[next][c])) next = i; });
      hide(next >= 0 ? next : T, c);
    }
  }

  const show = (r: PlanCounts, c: Col, h: Set<Col>): Count => (r[c] < SMALL ? "<10" : h.has(c) ? "hidden" : r[c]);
  const cell = (r: PlanCounts, h: Set<Col>, helper: Col, allCol: Col): FunnelCell => ({ helper_link_plans: show(r, helper, h), all_plans: show(r, allCol, h) });
  return {
    last_7_days: cell(total, hidden[T], "helper_7d", "all_7d"),
    all_time: cell(total, hidden[T], "helper_all", "all_all"),
    by_language: grouped.map((r, i) => ({
      language: r.language!,
      last_7_days: cell(r, hidden[i], "helper_7d", "all_7d"),
      all_time: cell(r, hidden[i], "helper_all", "all_all"),
    })),
  };
}
