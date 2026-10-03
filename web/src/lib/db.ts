import { attachDatabasePool } from "@vercel/functions";
import { Pool } from "pg";

/**
 * Anonymous measurement. Columns are counts, timings, categories and ratings only:
 * no paper text, no names, no addresses, no IP and no free text (see db/migrations/001_atlas_events.sql).
 * Recording is best effort: a database problem never breaks reading a paper or building a plan.
 */

let pool: Pool | null = null;
function getPool(): Pool | null {
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
};

const COLS = [
  "surface", "kind", "language", "reading_level", "source_kind", "steps", "held_back", "dropped_refs",
  "quiz_total", "quiz_first_try", "barriers", "ms", "role", "rating", "would_use", "feedback_nonce",
] as const;

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
  const values = COLS.map((c) => e[c] ?? null);
  try {
    await p.query(
      `insert into atlas_events (env, is_test, ${COLS.join(", ")}) values ($1, $2, ${COLS.map((_, i) => `$${i + 3}`).join(", ")})`,
      [ENV, isTest, ...values],
    );
    return "ok";
  } catch (err) {
    // 23505 = unique violation: this feedback token was already used.
    if ((err as { code?: string })?.code === "23505") return "duplicate";
    // Error type only, never values, so nothing about a person can land in the host logs.
    console.error("recordEvent failed", err instanceof Error ? err.name : typeof err);
    return "failed";
  }
}

/**
 * A shared daily ceiling for a paid AI route, counted in Postgres so every server instance shares it (the guard in
 * guard.ts is per instance). One atomic upsert per request: the count goes up first, then we compare, so two
 * instances racing at the limit can't both slip under it. "unavailable" means no database, a missing table or a
 * database error; /api/prep then refuses with 503 rather than make an uncounted paid model call (fails closed).
 * Counts only (route name, UTC day), never the paper or the IP (db/migrations/004_daily_usage.sql).
 */
export type DailySlot = { status: "ok" | "over"; used: number; limit: number } | { status: "unavailable" };

export async function takeDailySlot(bucket: string, limit: number): Promise<DailySlot> {
  const p = getPool();
  if (!p) return { status: "unavailable" };
  try {
    const r = await p.query(
      `insert into atlas_daily_usage (day, bucket, n) values ((now() at time zone 'utc')::date, $1, 1)
       on conflict (day, bucket) do update set n = atlas_daily_usage.n + 1
       returning n`,
      [bucket],
    );
    const used = Number(r.rows[0]?.n);
    if (!Number.isFinite(used)) return { status: "unavailable" };
    return { status: used > limit ? "over" : "ok", used, limit };
  } catch (err) {
    console.error("takeDailySlot failed", err instanceof Error ? err.name : typeof err, (err as { code?: string })?.code ?? "");
    return { status: "unavailable" };
  }
}

/** Seconds until the next UTC midnight, when the daily count starts again. */
export function secondsToUtcMidnight(now = Date.now()): number {
  const d = new Date(now);
  return Math.max(1, Math.ceil((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - now) / 1000));
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
  since: string | null;
};

/** Production use only; test runs and local or preview traffic are excluded. */
export async function liveStats(): Promise<LiveStats | null> {
  const p = getPool();
  if (!p) return null;
  try {
    const real = `env = 'production' and not is_test`;
    const [totals, roles, uses, surfaces, langs] = await Promise.all([
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
    ]);
    const t = totals.rows[0];
    const toMap = (r: { rows: { k: string; n: number }[] }) => Object.fromEntries(r.rows.map((x) => [x.k, x.n]));
    const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
    return {
      reads: t.reads, plans: t.plans, quizzes: t.quizzes, feedback: t.feedback,
      median_read_ms: num(t.median_read_ms), median_plan_ms: num(t.median_plan_ms),
      quiz_first_try_rate: num(t.quiz_first_try_rate), avg_rating: num(t.avg_rating),
      would_use: toMap(uses), roles: toMap(roles), surfaces: toMap(surfaces), languages: toMap(langs),
      since: t.since ? new Date(t.since).toISOString() : null,
    };
  } catch (err) {
    console.error("liveStats failed", err instanceof Error ? err.name : typeof err);
    return null;
  }
}
