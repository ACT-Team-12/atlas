import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import {
  budgetReady, clientKey, CLIENT_HOURLY_SECONDS, memoryUsageStore, normalizeIp, pgUsageStore, retentionReady, SITE_HOURLY_SECONDS,
  localUsageForTests, sweepSttUsage, SWEEP_HEARTBEAT, usageStore, type UsageStore,
} from "./sttUsage";
import { GET as sweepRoute } from "@/app/api/transcribe/sweep/route";
import { GET as transcribeGET, POST as transcribePOST } from "@/app/api/transcribe/route";
import { answerAloud, issueQuizToken, usesFor } from "./transcribe";

const SECRET = "s3cret";
const audio = () => new Uint8Array(readFileSync(new URL("./__fixtures__/short.webm", import.meta.url)));
const dg = (transcript: string, duration = 4) =>
  new Response(JSON.stringify({ metadata: { duration }, results: { channels: [{ alternatives: [{ transcript }] }] } }), { status: 200 });
// Real time, not a fixed date: the Postgres store deletes rows whose window has passed by the database clock.
const T = Date.now();
const hour = Math.floor(T / 3_600_000);

describe("network address normalising", () => {
  it("folds IPv4-mapped IPv6 into IPv4 and IPv6 into its /64", () => {
    expect(normalizeIp("::ffff:1.2.3.4")).toBe("1.2.3.4");
    expect(normalizeIp("0:0:0:0:0:ffff:1.2.3.4")).toBe("1.2.3.4");
    expect(normalizeIp(" 1.2.3.4 ")).toBe("1.2.3.4");
    expect(normalizeIp("2001:db8:aa:bb:1::2")).toBe(normalizeIp("2001:0db8:00aa:00bb:ffff:ffff:ffff:ffff"));
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8:0:0::/64");
    expect(clientKey("2001:db8:aa:bb::1", SECRET)).toBe(clientKey("2001:db8:aa:bb::9", SECRET));
    expect(clientKey("2001:db8:aa:bc::1", SECRET)).not.toBe(clientKey("2001:db8:aa:bb::1", SECRET));
    expect(clientKey("1.2.3.4", SECRET)).not.toContain("1.2.3.4");
  });
});

/** Runs the same budget rules against a store: memory always, real Postgres when TEST_DATABASE_URL is set (CI). */
function budgetRules(name: string, makeStore: () => Promise<{ store: UsageStore; used: (b: string, w: number) => Promise<number>; reset: () => Promise<void> }>) {
  describe(`budget rules (${name})`, () => {
    const fetchMock = vi.fn();
    let s: Awaited<ReturnType<typeof makeStore>>;
    beforeAll(async () => { s = await makeStore(); });
    beforeEach(async () => {
      vi.stubGlobal("fetch", fetchMock);
      vi.stubEnv("DEEPGRAM_API_KEY", "dg-test");
      vi.stubEnv("FEEDBACK_SECRET", SECRET);
      fetchMock.mockReset();
      await s.reset();
      vi.spyOn(console, "error").mockImplementation(() => {});
    });
    afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

    const ask = (over: Partial<Parameters<typeof answerAloud>[0]> = {}) => answerAloud({
      audio: audio(), type: "audio/webm", language: "English", token: issueQuizToken("English", 5, SECRET, T)!, ip: "1.2.3.4",
      now: T, store: s.store, ...over,
    });

    it("one client cannot spend the whole site's hourly budget (per-client cap sits below it)", async () => {
      expect(CLIENT_HOURLY_SECONDS).toBeLessThan(SITE_HOURLY_SECONDS / 2);
      fetchMock.mockImplementation(async () => dg("ok", 30));
      let ok = 0;
      for (let i = 0; i < 40; i++) {
        const token = issueQuizToken("English", 20, SECRET, T + i)!;
        try { await ask({ token }); ok++; } catch (e) { expect(e).toMatchObject({ status: 429 }); break; }
      }
      expect(ok * 30).toBeLessThanOrEqual(CLIENT_HOURLY_SECONDS);
      // Someone else still gets through.
      fetchMock.mockImplementation(async () => dg("ok", 4));
      await expect(ask({ ip: "5.6.7.8", token: issueQuizToken("English", 5, SECRET, T + 99)! })).resolves.toBe("ok");
    });

    it("audio the provider rejects (bad input) does not spend the site budget, only the client's", async () => {
      fetchMock.mockResolvedValue(new Response("bad audio", { status: 400 }));
      await expect(ask()).rejects.toMatchObject({ status: 502 });
      expect(await s.used("lgh", hour)).toBe(0);
      expect(await s.used(`lch:${clientKey("1.2.3.4", SECRET)}`, hour)).toBe(6); // 3,790 bytes could hold up to about 5.05 s at 6 kbps, so 6 s is reserved
    });

    it("a provider outage or timeout leaves no site budget behind (nothing sticks)", async () => {
      fetchMock.mockRejectedValue(new DOMException("timed out", "TimeoutError"));
      for (let i = 0; i < 5; i++) await expect(ask({ ip: `9.9.9.${i}` })).rejects.toBeTruthy();
      expect(await s.used("lgh", hour)).toBe(0);
      fetchMock.mockResolvedValue(dg("back", 3));
      await expect(ask({ ip: "7.7.7.7" })).resolves.toBe("back");
    });

    it("settles to the real length, even past the cap, so the next call is refused", async () => {
      fetchMock.mockResolvedValue(dg("long", 34));
      await ask();
      expect(await s.used("lgh", hour)).toBe(34);
      await s.store.adjust([{ bucket: "lgh", win: hour, delta: SITE_HOURLY_SECONDS }]);
      await expect(ask({ ip: "8.8.8.8" })).rejects.toMatchObject({ status: 429 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("a quiz token is good for about one answer per question plus a few retries", async () => {
      fetchMock.mockImplementation(async () => dg("ok", 1));
      const token = issueQuizToken("English", 2, SECRET, T)!;
      let n = 0;
      for (let i = 0; i < 20; i++) {
        try { await ask({ token, ip: `10.0.${i}.1` }); n++; } catch (e) { expect(e).toMatchObject({ status: 429 }); break; }
      }
      expect(n).toBe(usesFor(2));
      expect(usesFor(2)).toBeLessThanOrEqual(6);
    });

    it("reserves before calling the provider: an over-budget request never reaches it", async () => {
      await s.store.adjust([]);
      await s.store.reserve([{ bucket: "lgh", win: hour, amount: SITE_HOURLY_SECONDS - 1, cap: SITE_HOURLY_SECONDS, ttlSec: 7200 }], T);
      await expect(ask()).rejects.toMatchObject({ status: 429 });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
}

budgetRules("memory", async () => {
  const m = memoryUsageStore();
  return { store: m, used: async (b, w) => m.used(b, w), reset: async () => m.reset() };
});

// CI runs a postgres:15 service with TEST_DATABASE_URL. In CI a missing URL is a failure, never a silent skip.
const PG = process.env.TEST_DATABASE_URL ?? process.env.STT_PG_URL;
if (process.env.CI && !PG) {
  describe("postgres store", () => {
    it("needs TEST_DATABASE_URL in CI", () => { throw new Error("TEST_DATABASE_URL is not set, so the shared-budget tests did not run."); });
  });
}
describe.skipIf(!PG)("postgres store", () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: PG, max: 8 });
    await pool.query("drop table if exists atlas_stt_usage");
    await pool.query(readFileSync(new URL("../../db/migrations/005_stt_usage.sql", import.meta.url), "utf8"));
  });
  afterAll(async () => { await pool?.end(); });

  it("never lets concurrent reservations pass a cap", async () => {
    const store = pgUsageStore(pool);
    const results = await Promise.all(Array.from({ length: 40 }, () =>
      store.reserve([{ bucket: "lgh", win: 1, amount: 30, cap: 600, ttlSec: 7200 }, { bucket: "lgd", win: 1, amount: 30, cap: 9000, ttlSec: 90000 }], T)));
    expect(results.filter((r) => r.ok).length).toBe(20);
    const { rows } = await pool.query("select bucket, used from atlas_stt_usage order by bucket");
    expect(rows).toEqual([{ bucket: "lgd", used: 600 }, { bucket: "lgh", used: 600 }]);
  });

  it("is all or nothing across buckets", async () => {
    const store = pgUsageStore(pool);
    await pool.query("delete from atlas_stt_usage");
    const r = await store.reserve([{ bucket: "a", win: 1, amount: 5, cap: 10, ttlSec: 60 }, { bucket: "b", win: 1, amount: 5, cap: 4, ttlSec: 60 }], T);
    expect(r).toEqual({ ok: false, bucket: "b" });
    const { rows } = await pool.query("select coalesce(sum(used), 0)::int as n from atlas_stt_usage");
    expect(rows[0].n).toBe(0);
    await store.adjust([{ bucket: "a", win: 1, delta: -100 }]);
    const again = await pool.query("select coalesce(min(used), 0)::int as n from atlas_stt_usage");
    expect(again.rows[0].n).toBe(0);
  });

  it("the sweep physically deletes every row by two days after it was written (Codex review, 2026-10-02)", async () => {
    const store = pgUsageStore(pool);
    await pool.query("delete from atlas_stt_usage");
    const now = Date.now(), twoDaysAgo = now - 2 * 86_400_000 - 60_000;
    const day = Math.floor(twoDaysAgo / 86_400_000), hr = Math.floor(twoDaysAgo / 3_600_000);
    await store.reserve([
      { bucket: "lcd:old", win: day, amount: 5, cap: 1500, ttlSec: 172_800 },
      { bucket: "lch:old", win: hr, amount: 5, cap: 600, ttlSec: 7_200 },
      { bucket: "lt:old", win: 0, amount: 1, cap: 8, ttlSec: 25_200 },
    ], twoDaysAgo);
    await store.reserve([{ bucket: "lch:new", win: Math.floor(now / 3_600_000), amount: 5, cap: 600, ttlSec: 7_200 }], now);
    expect(await sweepSttUsage(pool)).toBe(3);
    const { rows } = await pool.query("select bucket from atlas_stt_usage order by bucket");
    expect(rows).toEqual([{ bucket: "lch:new" }, { bucket: SWEEP_HEARTBEAT }]);
  });

  it("the mic is on only while the sweep keeps succeeding (Codex round 3, 2026-10-03)", async () => {
    vi.stubEnv("CRON_SECRET", "cron-s3cret");
    vi.stubEnv("DATABASE_URL", PG!);
    vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await pool.query("delete from atlas_stt_usage");
      localUsageForTests(); // clears the once-a-minute readiness cache
      expect(await budgetReady(1)).toBe(false); // configured, but no sweep has ever succeeded
      await sweepSttUsage(pool);
      expect(await budgetReady(1)).toBe(false); // cached for a minute
      expect(await budgetReady(1 + 61_000)).toBe(true);
      // The cron stops (or its DELETE is refused): the heartbeat goes stale and the feature turns off.
      await pool.query("update atlas_stt_usage set expires_at = now() - interval '1 second' where bucket = $1", [SWEEP_HEARTBEAT]);
      expect(await budgetReady(1 + 122_000)).toBe(false);
      // A stale heartbeat is replaced by the next good sweep, never counted as a deleted counter.
      expect(await sweepSttUsage(pool)).toBe(0);
      expect(await budgetReady(1 + 183_000)).toBe(true);
      const hb = await pool.query("select expires_at > now() + interval '2 hours' as fresh from atlas_stt_usage where bucket = $1", [SWEEP_HEARTBEAT]);
      expect(hb.rows).toEqual([{ fresh: true }]);
    } finally { vi.unstubAllEnvs(); vi.restoreAllMocks(); localUsageForTests(); }
  });

  it("the sweep route needs the cron secret and reports what it deleted", async () => {
    vi.stubEnv("CRON_SECRET", "cron-s3cret");
    vi.stubEnv("DATABASE_URL", PG!);
    try {
      expect((await sweepRoute(new Request("http://x/api/transcribe/sweep"))).status).toBe(401);
      expect((await sweepRoute(new Request("http://x/api/transcribe/sweep", { headers: { authorization: "Bearer nope" } }))).status).toBe(401);
      const r = await sweepRoute(new Request("http://x/api/transcribe/sweep", { headers: { authorization: "Bearer cron-s3cret" } }));
      expect(r.status).toBe(200);
      expect(typeof (await r.json()).deleted).toBe("number");
      vi.stubEnv("CRON_SECRET", "");
      expect((await sweepRoute(new Request("http://x/api/transcribe/sweep", { headers: { authorization: "Bearer " } }))).status).toBe(503);
    } finally { vi.unstubAllEnvs(); }
  });

  budgetRules("postgres", async () => {
    const store = pgUsageStore(pool);
    return {
      store,
      used: async (b, w) => Number((await pool.query("select used from atlas_stt_usage where bucket = $1 and win = $2", [b, w])).rows[0]?.used ?? 0),
      reset: async () => { await pool.query("delete from atlas_stt_usage"); },
    };
  });
});

describe("database unreachable", () => {
  it("refuses that one request with 503 and leaves nothing locked", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "dg-test");
    vi.stubEnv("FEEDBACK_SECRET", SECRET);
    const fetchMock = vi.fn(async () => dg("ok", 2));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(console, "error").mockImplementation(() => {});
    let down = true;
    const m = memoryUsageStore();
    const flaky: UsageStore = {
      reserve: async (a, n) => { if (down) throw new Error("ECONNREFUSED"); return m.reserve(a, n); },
      adjust: async (i) => m.adjust(i),
    };
    const go = () => answerAloud({ audio: audio(), type: "audio/webm", language: "English", token: issueQuizToken("English", 5, SECRET, T)!, ip: "1.1.1.1", now: T, store: flaky });
    await expect(go()).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).not.toHaveBeenCalled();
    down = false;
    await expect(go()).resolves.toBe("ok");
    vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks();
  });
});

describe("deletion is guaranteed before anything is written (Codex round 2, 2026-10-02)", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it("on a database without CRON_SECRET the feature is off: no mic, no row, no provider call", async () => {
    vi.stubEnv("DEEPGRAM_API_KEY", "dg-test");
    vi.stubEnv("FEEDBACK_SECRET", SECRET);
    vi.stubEnv("DATABASE_URL", PG ?? "postgres://nobody@127.0.0.1:1/none");
    vi.stubEnv("CRON_SECRET", "");
    const fetchMock = vi.fn(async () => dg("ok", 2));
    vi.stubGlobal("fetch", fetchMock);
    expect(retentionReady()).toBe(false);
    expect(usageStore()).toBeNull();
    expect(await budgetReady()).toBe(false);
    const config = await (await transcribeGET()).json();
    expect(config.enabled).toBe(false);
    const token = issueQuizToken("English", 5, SECRET)!;
    const r = await transcribePOST(new Request(`http://x/api/transcribe?language=English&token=${encodeURIComponent(token)}`, {
      method: "POST", headers: { "content-type": "audio/webm" }, body: audio(),
    }));
    expect(r.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("with CRON_SECRET set the sweep can run, so the database store is allowed", () => {
    vi.stubEnv("DATABASE_URL", PG ?? "postgres://nobody@127.0.0.1:1/none");
    vi.stubEnv("CRON_SECRET", "cron-s3cret");
    expect(retentionReady()).toBe(true);
    expect(usageStore()).not.toBeNull();
  });

  it("without a database (local runs, memory only) no sweep is needed", () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("CRON_SECRET", "");
    vi.stubEnv("VERCEL", "");
    expect(retentionReady()).toBe(true);
  });
});
