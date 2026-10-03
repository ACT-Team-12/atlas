import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";
import { buildFunnel, type HelperFunnelResult, type PlanCounts } from "./helperFunnel";

/**
 * Anonymous measurement. Columns are counts, timings, categories and ratings only:
 * no paper text, no names, no addresses, no IP and no free text (see db/migrations/001_atlas_events.sql).
 * Recording is best effort: a database problem never breaks reading a paper or building a plan.
 */

let pool: Pool | null = null;
/** The shared pool (null without DATABASE_URL). The phone-call tables use it too (lib/call/store.ts). */
export function getPool(): Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  if (!pool) {
    pool = new Pool({ connectionString: url, max: 3, idleTimeoutMillis: 10_000 });
    attachDatabasePool(pool);
  }
  return pool;
}

export const ENV = (["production", "preview", "development"] as const).find((e) => e === process.env.VERCEL_ENV) ?? "local";

export type AtlasEvent = {
  surface: "web" | "ios" | "android";
  kind: "read" | "plan" | "quiz" | "feedback";
  language?: string;
  reading_level?: string;
  source_kind?: "text" | "image";
  steps?: number;
  held_back?: number;
  dropped_refs?: number;
  quiz_total?: number;
  quiz_first_try?: number;
  barriers?: string[];
  ms?: number;
  role?: "patient" | "caregiver" | "helper" | "tester";
  rating?: number;
  would_use?: "yes" | "maybe" | "no";
  /** Nonce of the one-time feedback token (unique), so one plan can be rated once. */
  feedback_nonce?: string;
  /** How the person arrived. Only "helper-link" exists; unset means the normal site. Nothing from the link itself is kept. */
  entry?: "helper-link";
};

const COLS = [
  "surface", "kind", "language", "reading_level", "source_kind", "steps", "held_back", "dropped_refs",
  "quiz_total", "quiz_first_try", "barriers", "ms", "role", "rating", "would_use", "feedback_nonce",
] as const;

/**
 * The plan came from a tab that was opened through a helper link (see lib/helperLink.ts). Exact match only.
 * The browser says so itself, like the surface header, so this is a count of what clients report, not proof.
 * The client sends it for the first plan after arriving only (consumeHelperSession), so one link counts at most once per tab.
 */
export function entryOf(req: Request): AtlasEvent["entry"] {
  return req.headers.get("x-atlas-entry") === "helper-link" ? "helper-link" : undefined;
}

/** The insert for one event. Only allow-listed columns ever reach the database; `entry` is added only when set. */
export function eventInsert(e: AtlasEvent, isTest: boolean, env: string, withEntry = true): { sql: string; values: unknown[] } {
  const cols: string[] = [...COLS];
  const values: unknown[] = COLS.map((c) => e[c] ?? null);
  if (withEntry && e.entry === "helper-link") { cols.push("entry"); values.push("helper-link"); }
  return {
    sql: `insert into atlas_events (env, is_test, ${cols.join(", ")}) values ($1, $2, ${cols.map((_, i) => `$${i + 3}`).join(", ")})`,
    values: [env, isTest, ...values],
  };
}

/** Our own scripts and browser tests send this header so their runs never count as real use. */
export function isTestRequest(req: Request) {
  return req.headers.get("x-atlas-test") === "1";
}

/** The native apps say which they are; anything else is the website. */
export function surfaceOf(req: Request): AtlasEvent["surface"] {
  const s = req.headers.get("x-atlas-surface");
  return s === "ios" || s === "android" ? s : "web";
}

export type RecordResult = "ok" | "duplicate" | "failed";

export async function recordEvent(e: AtlasEvent, isTest: boolean): Promise<RecordResult> {
  const p = getPool();
  if (!p) return "failed";
  try {
    const q = eventInsert(e, isTest, ENV);
    try {
      await p.query(q.sql, q.values);
    } catch (err) {
      // 42703 = undefined column: the database has not had migration 007 yet. Count the event without the tag.
      if ((err as { code?: string })?.code !== "42703" || !e.entry) throw err;
      const plain = eventInsert(e, isTest, ENV, false);
      await p.query(plain.sql, plain.values);
    }
    return "ok";
  } catch (err) {
    // 23505 = unique violation: this feedback token was already used.
    if ((err as { code?: string })?.code === "23505") return "duplicate";
    // Error type only, never values, so nothing about a person can land in the host logs.
    console.error("recordEvent failed", err instanceof Error ? err.name : typeof err);
    return "failed";
  }
}

export type LiveStats = {
  reads: number;
  plans: number;
  quizzes: number;
  feedback: number;
  median_read_ms: number | null;
  median_plan_ms: number | null;
  quiz_first_try_rate: number | null;
  avg_rating: number | null;
  would_use: Record<string, number>;
  roles: Record<string, number>;
  surfaces: Record<string, number>;
  languages: Record<string, number>;
  /** Plans built in a tab opened from a helper link. Null when the database does not have the column yet. */
  helper_link_plans: number | null;
  since: string | null;
};

/** Production use only; test runs and local or preview traffic are excluded. */
export async function liveStats(): Promise<LiveStats | null> {
  const p = getPool();
  if (!p) return null;
  try {
    const real = `env = 'production' and not is_test`;
    const [totals, roles, uses, surfaces, langs, helper] = await Promise.all([
      p.query(`select
          count(*) filter (where kind = 'read')::int as reads,
          count(*) filter (where kind = 'plan')::int as plans,
          count(*) filter (where kind = 'quiz')::int as quizzes,
          count(*) filter (where kind = 'feedback')::int as feedback,
          percentile_cont(0.5) within group (order by ms) filter (where kind = 'read') as median_read_ms,
          percentile_cont(0.5) within group (order by ms) filter (where kind = 'plan') as median_plan_ms,
          sum(quiz_first_try) filter (where kind = 'feedback' and quiz_total > 0)::float / nullif(sum(quiz_total) filter (where kind = 'feedback' and quiz_total > 0), 0) as quiz_first_try_rate,
          avg(rating) filter (where kind = 'feedback')::float as avg_rating,
          min(at) as since
        from atlas_events where ${real}`),
      p.query(`select role as k, count(*)::int as n from atlas_events where ${real} and kind = 'feedback' and role is not null group by role`),
      p.query(`select would_use as k, count(*)::int as n from atlas_events where ${real} and kind = 'feedback' and would_use is not null group by would_use`),
      p.query(`select surface as k, count(*)::int as n from atlas_events where ${real} and kind = 'read' group by surface`),
      p.query(`select language as k, count(*)::int as n from atlas_events where ${real} and kind = 'read' and language is not null group by language`),
      // Its own query: only a database without migration 007 (42703) gives null here; any other failure fails the stats as before.
      p.query(`select count(*)::int as n from atlas_events where ${real} and kind = 'plan' and entry = 'helper-link'`)
        .then((r) => r.rows[0].n as number, (err) => { if ((err as { code?: string })?.code === "42703") return null; throw err; }),
    ]);
    const t = totals.rows[0];
    const toMap = (r: { rows: { k: string; n: number }[] }) => Object.fromEntries(r.rows.map((x) => [x.k, x.n]));
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return {
      reads: t.reads, plans: t.plans, quizzes: t.quizzes, feedback: t.feedback,
      median_read_ms: num(t.median_read_ms), median_plan_ms: num(t.median_plan_ms),
      quiz_first_try_rate: num(t.quiz_first_try_rate), avg_rating: num(t.avg_rating),
      would_use: toMap(uses), roles: toMap(roles), surfaces: toMap(surfaces), languages: toMap(langs),
      helper_link_plans: helper,
      since: t.since ? new Date(t.since).toISOString() : null,
    };
  } catch (err) {
    console.error("liveStats failed", err instanceof Error ? err.name : typeof err);
    return null;
  }
}

/**
 * The helper-link funnel for /judge (see lib/helperFunnel.ts): production plans only, test runs excluded, counted by language.
 * Not available (rather than zeros) when there is no database, migration 007 is missing, or the query fails.
 */
export async function helperFunnel(): Promise<HelperFunnelResult> {
  const p = getPool();
  if (!p) return { available: false, reason: "no-database" };
  try {
    const recent = `at >= now() - interval '7 days'`;
    const r = await p.query<PlanCounts>(`select language,
        count(*) filter (where entry = 'helper-link' and ${recent})::int as helper_7d,
        count(*) filter (where ${recent})::int as all_7d,
        count(*) filter (where entry = 'helper-link')::int as helper_all,
        count(*)::int as all_all
      from atlas_events where env = 'production' and not is_test and kind = 'plan' group by language`);
    return { available: true, funnel: buildFunnel(r.rows) };
  } catch (err) {
    // 42703 = undefined column: migration 007 has not been applied, so there is no entry to count yet.
    if ((err as { code?: string })?.code === "42703") return { available: false, reason: "not-migrated" };
    console.error("helperFunnel failed", err instanceof Error ? err.name : typeof err);
    return { available: false, reason: "error" };
  }
}
