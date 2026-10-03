import { createHmac } from "node:crypto";
import type { Pool } from "pg";
import { ENV, getPool } from "./db";

/**
 * Shared budget for "Say your answer". Every limit is reserved in ONE all-or-nothing step before the provider is
 * called, and counted across every server instance (Postgres table atlas_stt_usage, db/migrations/005_stt_usage.sql):
 *   - uses per quiz token (about one per question, plus a few retries)
 *   - audio-seconds per client per hour and per day (client = keyed hash of the network address, IPv6 by /64)
 *   - audio-seconds for the whole site per hour and per day (the cost ceiling)
 * The client limits sit well below the site limits, so one client cannot spend the whole site's budget.
 * If the database cannot be reached, that one request is refused (503); nothing is left locked.
 */
export type Ask = { bucket: string; win: number; amount: number; cap: number; ttlSec: number };
export type Adjust = { bucket: string; win: number; delta: number };
export type Reserve = { ok: true } | { ok: false; bucket: string };
export interface UsageStore {
  /** Adds every amount, or none if any bucket would go over its cap. */
  reserve(asks: Ask[], now: number): Promise<Reserve>;
  /** Corrects usage that already happened (never refused, never below zero). */
  adjust(items: Adjust[]): Promise<void>;
}

export const SITE_HOURLY_SECONDS = 1_800;
export const SITE_DAILY_SECONDS = 9_000;
export const CLIENT_HOURLY_SECONDS = 600;
export const CLIENT_DAILY_SECONDS = 1_500;

const keyOf = (b: string, w: number) => `${b}@${w}`;

/** Local development and tests only: one process, so memory is the whole truth. */
export function memoryUsageStore(): UsageStore & { reset(): void; used(bucket: string, win: number): number } {
  const rows = new Map<string, { used: number; expires: number }>();
  return {
    async reserve(asks, now) {
      for (const [k, r] of rows) if (r.expires < now) rows.delete(k);
      for (const a of asks) {
        const used = rows.get(keyOf(a.bucket, a.win))?.used ?? 0;
        if (used + a.amount > a.cap) return { ok: false, bucket: a.bucket };
      }
      for (const a of asks) {
        const k = keyOf(a.bucket, a.win);
        rows.set(k, { used: (rows.get(k)?.used ?? 0) + a.amount, expires: now + a.ttlSec * 1000 });
      }
      return { ok: true };
    },
    async adjust(items) {
      for (const i of items) {
        const r = rows.get(keyOf(i.bucket, i.win));
        if (r) r.used = Math.max(0, r.used + i.delta);
      }
    },
    reset: () => rows.clear(),
    used: (bucket, win) => rows.get(keyOf(bucket, win))?.used ?? 0,
  };
}

/** Postgres: rows locked in a fixed order inside one transaction, so concurrent instances cannot both slip under a cap. */
export function pgUsageStore(pool: Pool): UsageStore {
  return {
    async reserve(asks, now) {
      const sorted = [...asks].sort((a, b) => (a.bucket < b.bucket ? -1 : a.bucket > b.bucket ? 1 : a.win - b.win));
      const buckets = sorted.map((a) => a.bucket), wins = sorted.map((a) => a.win);
      const amounts = sorted.map((a) => a.amount), expires = sorted.map((a) => new Date(now + a.ttlSec * 1000).toISOString());
      const c = await pool.connect();
      try {
        await c.query("begin");
        await c.query(
          `insert into atlas_stt_usage (bucket, win, used, expires_at)
           select * from unnest($1::text[], $2::bigint[], array_fill(0, array[cardinality($1::text[])]), $3::timestamptz[])
           on conflict (bucket, win) do nothing`,
          [buckets, wins, expires],
        );
        const { rows } = await c.query<{ bucket: string; win: string; used: number }>(
          `select bucket, win, used from atlas_stt_usage
           where (bucket, win) in (select * from unnest($1::text[], $2::bigint[]))
           order by bucket, win for update`,
          [buckets, wins],
        );
        const used = new Map(rows.map((r) => [keyOf(r.bucket, Number(r.win)), r.used]));
        const over = sorted.find((a) => (used.get(keyOf(a.bucket, a.win)) ?? 0) + a.amount > a.cap);
        if (over) { await c.query("rollback"); return { ok: false, bucket: over.bucket }; }
        await c.query(
          `update atlas_stt_usage u set used = u.used + r.amount
           from unnest($1::text[], $2::bigint[], $3::int[]) as r(bucket, win, amount)
           where u.bucket = r.bucket and u.win = r.win`,
          [buckets, wins, amounts],
        );
        await c.query("commit");
      } catch (e) {
        await c.query("rollback").catch(() => {});
        throw e;
      } finally {
        c.release();
      }
      return { ok: true };
    },
    async adjust(items) {
      if (items.length === 0) return;
      await pool.query(
        `update atlas_stt_usage u set used = greatest(0, u.used + r.delta)
         from unnest($1::text[], $2::bigint[], $3::int[]) as r(bucket, win, delta)
         where u.bucket = r.bucket and u.win = r.win`,
        [items.map((i) => i.bucket), items.map((i) => i.win), items.map((i) => i.delta)],
      );
    },
  };
}

/** The row a successful sweep leaves behind. budgetReady turns the feature off once it has gone stale. */
export const SWEEP_HEARTBEAT = "sweep:ok";
/** Hourly sweeps, so a heartbeat this old means at least two runs in a row failed or never ran. */
export const SWEEP_HEARTBEAT_HOURS = 3;

/**
 * Retention: deletes every row whose window has ended. Every row expires at most two days after it is first written
 * (the longest window is one day, kept one more for the daily cap's late settles). Run hourly by the Vercel cron
 * /api/transcribe/sweep. In the same transaction it writes a heartbeat that lasts SWEEP_HEARTBEAT_HOURS, so the
 * feature stays on only while deletion is actually happening.
 */
export async function sweepSttUsage(pool: Pool): Promise<number> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const r = await c.query("delete from atlas_stt_usage where expires_at < now() and bucket <> $1", [SWEEP_HEARTBEAT]);
    await c.query(
      `insert into atlas_stt_usage (bucket, win, used, expires_at) values ($1, 0, 0, now() + make_interval(hours => $2))
       on conflict (bucket, win) do update set expires_at = excluded.expires_at`,
      [SWEEP_HEARTBEAT, SWEEP_HEARTBEAT_HOURS],
    );
    await c.query("commit");
    return r.rowCount ?? 0;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/**
 * The two-day deletion is guaranteed only when the hourly sweep can run, and the sweep refuses everyone without
 * CRON_SECRET. So on a database, no CRON_SECRET means no rows are ever written: the feature stays off (no mic).
 * Memory (local runs only) needs no sweep: its rows expire in the process and vanish with it.
 */
export function retentionReady(): boolean {
  return getPool() === null || Boolean(process.env.CRON_SECRET);
}

let ready: { at: number; ok: boolean } | null = null;
/**
 * Whether the shared budget can be used here: memory locally; on a database, its table must exist (migration 005),
 * the deletion sweep must be configured (retentionReady) AND have succeeded within SWEEP_HEARTBEAT_HOURS. A stalled
 * or failing sweep (cron gone, DELETE refused) therefore turns the mic off instead of letting counters pile up.
 * Checked at most once a minute per instance, so a missing migration hides the mic instead of failing every answer.
 */
export async function budgetReady(now = Date.now()): Promise<boolean> {
  if (!retentionReady()) return false;
  const pool = getPool();
  if (!pool) return process.env.VERCEL !== "1";
  if (ready && now - ready.at < 60_000) return ready.ok;
  let ok = false;
  try {
    const r = await pool.query("select 1 from atlas_stt_usage where bucket = $1 and expires_at > now()", [SWEEP_HEARTBEAT]);
    ok = (r.rowCount ?? 0) > 0;
    if (!ok) console.error("stt off: no successful usage sweep in the last", SWEEP_HEARTBEAT_HOURS, "hours");
  } catch (e) {
    console.error("stt budget table unavailable", e instanceof Error ? e.name : typeof e, (e as { code?: string })?.code ?? "");
  }
  ready = { at: now, ok };
  return ok;
}

let mem: ReturnType<typeof memoryUsageStore> | null = null;
/** Tests: the local memory store the route uses, emptied. */
export function localUsageForTests() { mem ??= memoryUsageStore(); mem.reset(); ready = null; return mem; }
/**
 * Postgres when DATABASE_URL is set and the deletion sweep is configured; memory only off Vercel (local dev);
 * none on Vercel without a database, and none on a database without CRON_SECRET (nothing written it cannot delete).
 */
export function usageStore(): UsageStore | null {
  if (!retentionReady()) return null;
  const pool = getPool();
  if (pool) return pgUsageStore(pool);
  if (process.env.VERCEL === "1") return null;
  return (mem ??= memoryUsageStore());
}

/** IPv4-mapped IPv6 becomes plain IPv4; any other IPv6 is cut to its /64, the block one household or phone gets. */
export function normalizeIp(raw: string): string {
  const ip = raw.trim().toLowerCase();
  // "::ffff:1.2.3.4" or "0:0:0:0:0:ffff:1.2.3.4": the IPv4 address is the last part.
  if (ip.includes(":") && ip.includes(".")) return ip.slice(ip.lastIndexOf(":") + 1);
  if (!ip.includes(":")) return ip;
  const [head, tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = ip.includes("::") && tail ? tail.split(":") : [];
  const groups = ip.includes("::") ? [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill("0"), ...t] : h;
  return groups.slice(0, 4).map((g) => (g || "0").replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

/** A keyed hash, so the table never holds an address. */
export function clientKey(ip: string, secret = process.env.FEEDBACK_SECRET ?? ""): string {
  return createHmac("sha256", secret).update(`stt-client.${normalizeIp(ip)}`).digest("hex").slice(0, 32);
}
export const tokenKey = (token: string, secret = process.env.FEEDBACK_SECRET ?? "") =>
  createHmac("sha256", secret).update(`stt-token.${token}`).digest("hex").slice(0, 32);
/** Separate counts for production, previews and local runs that share one database. */
export const envPrefix = () => ({ production: "p", preview: "v", development: "d", local: "l" } as const)[ENV];
