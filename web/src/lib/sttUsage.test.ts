import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import {
  clientKey, CLIENT_HOURLY_SECONDS, memoryUsageStore, normalizeIp, pgUsageStore, SITE_HOURLY_SECONDS, type UsageStore,
} from "./sttUsage";
import { answerAloud, issueQuizToken, reserveFor, usesFor } from "./transcribe";

const SECRET = "s3cret";
const audio = (n = 4000) => new Uint8Array(n).fill(3);
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

/** Runs the same budget rules against a store: memory always, real Postgres when STT_PG_URL is set. */
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
      expect(await s.used(`lch:${clientKey("1.2.3.4", SECRET)}`, hour)).toBe(reserveFor(4000, "audio/webm"));
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
      await s.store.reserve([{ bucket: "lgh", win: hour, amount: SITE_HOURLY_SECONDS - 10, cap: SITE_HOURLY_SECONDS, ttlSec: 7200 }], T);
      await expect(ask()).rejects.toMatchObject({ status: 429 });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
}

budgetRules("memory", async () => {
  const m = memoryUsageStore();
  return { store: m, used: async (b, w) => m.used(b, w), reset: async () => m.reset() };
});

const PG = process.env.STT_PG_URL;
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
