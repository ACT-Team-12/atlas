import type { LiveStats } from "./db";
import { OTHER, SMALL, suppress, type Count, type HelperFunnelResult } from "./helperFunnel";

/**
 * The live numbers as they may be shown to anyone (/api/stats, /judge). Same rule as the helper funnel: no exact count
 * under 10, and no count that lets one be worked out by subtracting. Averages and rates from fewer than 10 answers are
 * left out, since with one or two answers they are those answers.
 */
export type PublicStats = {
  reads: Count;
  plans: Count;
  quizzes: Count;
  feedback: Count;
  median_read_ms: number | null;
  median_plan_ms: number | null;
  quiz_first_try_rate: number | null;
  avg_rating: number | null;
  would_use: Record<string, Count>;
  roles: Record<string, Count>;
  surfaces: Record<string, Count>;
  languages: Record<string, Count>;
  helper_link_plans: Count | null;
  since: string | null;
};

/**
 * A breakdown of `total`. Entries under 10 show "<10" (with `fold`, they are merged into one entry of that name first,
 * so a rare value is never named). While the total is shown and the entries not shown add up to under 10, the smallest
 * shown entry is marked "hidden" too, so total minus the shown entries never gives a small number.
 */
export function breakdown(total: number, map: Record<string, number>, fold?: string): Record<string, Count> {
  let entries = Object.entries(map);
  if (fold) {
    const small = entries.filter(([, n]) => n < SMALL);
    if (small.length) entries = [...entries.filter(([, n]) => n >= SMALL), [fold, small.reduce((s, [, n]) => s + n, 0)]];
  }
  const hidden = new Set<string>();
  const shown = (k: string, n: number) => n >= SMALL && !hidden.has(k);
  if (total >= SMALL) {
    for (;;) {
      const off = entries.filter(([k, n]) => !shown(k, n));
      if (off.length === 0 || off.reduce((s, [, n]) => s + n, 0) >= SMALL) break;
      const next = entries.filter(([k, n]) => shown(k, n)).sort((a, b) => a[1] - b[1])[0];
      if (!next) break;
      hidden.add(next[0]);
    }
  }
  return Object.fromEntries(entries.map(([k, n]) => [k, n < SMALL ? "<10" : hidden.has(k) ? "hidden" : n]));
}

export function publicStats(s: LiveStats, funnel: HelperFunnelResult): PublicStats {
  const enough = (n: number, v: number | null) => (n >= SMALL ? v : null);
  // The all-time helper count, ruled the same way as the funnel's total (plans minus it must not be under 10).
  let helper: Count | null;
  if (funnel.available) helper = funnel.funnel.all_time.helper_link_plans;
  else if (s.helper_link_plans === null) helper = null;
  else helper = s.helper_link_plans >= SMALL && s.plans >= SMALL && s.plans - s.helper_link_plans < SMALL ? "hidden" : suppress(s.helper_link_plans);
  return {
    reads: suppress(s.reads),
    plans: suppress(s.plans),
    quizzes: suppress(s.quizzes),
    feedback: suppress(s.feedback),
    median_read_ms: enough(s.reads, s.median_read_ms),
    median_plan_ms: enough(s.plans, s.median_plan_ms),
    quiz_first_try_rate: enough(s.feedback, s.quiz_first_try_rate),
    avg_rating: enough(s.feedback, s.avg_rating),
    would_use: breakdown(s.feedback, s.would_use),
    roles: breakdown(s.feedback, s.roles),
    surfaces: breakdown(s.reads, s.surfaces),
    languages: breakdown(s.reads, s.languages, OTHER),
    helper_link_plans: helper,
    since: s.since,
  };
}
