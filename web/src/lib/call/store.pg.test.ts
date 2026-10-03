import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ensureSchema, PgCallStore, reserveSlots, WIPE, type NewSession } from "./store";

/**
 * The SQL of PgCallStore against a real Postgres. Runs only with CALL_TEST_DATABASE_URL pointing at a throwaway
 * database (it drops and recreates the call tables); CI has no Postgres, so there the flow is covered by
 * MemoryCallStore in call.test.ts and this file is skipped.
 */
const url = process.env.CALL_TEST_DATABASE_URL;
const NOW = Date.UTC(2026, 9, 2, 15, 0, 0);
if (!url) {
  // Not a silent pass: say what did not run. (CI has no Postgres yet; a later change adds one and makes this required.)
  console.warn(`store.pg.test.ts SKIPPED: CALL_TEST_DATABASE_URL is not set${process.env.CI ? " (CI)" : ""}, so the call SQL was not run against Postgres.`);
}

describe.skipIf(!url)("PgCallStore (real Postgres)", () => {
  let pool: Pool;
  let store: PgCallStore;
  const session = (id: string, hash = "h1", over: Partial<NewSession> = {}): NewSession => ({
    id, phone_hash: hash, last4: "2368", language: "English", code_hash: "c0de", code_expires_at: new Date(NOW + 10 * 60_000),
    sealed_phone: Buffer.from([1, 2, 3]), sealed_text: Buffer.from([4, 5]), sealed_token: Buffer.from([6]), expires_at: new Date(NOW + 30 * 60_000), ...over,
  });

  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 12 });
    await pool.query("drop table if exists atlas_calls; drop table if exists atlas_call_counters;");
    expect(await ensureSchema(pool)).toBe(true);
    expect(await ensureSchema(pool)).toBe(true); // idempotent
    store = new PgCallStore(pool);
  });
  afterAll(async () => { await pool?.end(); });

  it("allows one live code per number, and an expired code stops blocking", async () => {
    expect(await store.startCode(session("a"), NOW)).toBe("ok");
    expect(await store.startCode(session("b"), NOW)).toBe("in-flight");
    expect(await store.startCode(session("c", "h2"), NOW)).toBe("ok");
    expect(await store.startCode(session("d"), NOW + 11 * 60_000)).toBe("ok");
    expect((await store.get("a", NOW))?.phase).toBe("expired");
  });

  it("round-trips the encrypted bytes and hides an expired row", async () => {
    const row = await store.get("c", NOW);
    expect(row?.sealed_phone).toEqual(Buffer.from([1, 2, 3]));
    expect(row?.expires_at.getTime()).toBe(NOW + 30 * 60_000);
    expect(await store.get("c", NOW + 31 * 60_000)).toBeNull();
  });

  it("spends attempts atomically, at most 3, even when they race", async () => {
    await store.startCode(session("e", "h3"), NOW);
    const r = await Promise.all(Array.from({ length: 8 }, () => store.takeAttempt("e", NOW)));
    expect(r.filter(Boolean).length).toBe(3);
    expect(await store.takeAttempt("e", NOW)).toBeNull();
  });

  it("moves a session past its code exactly once, and wipes", async () => {
    await store.startCode(session("f", "h4"), NOW);
    const r = await Promise.all(Array.from({ length: 6 }, () => store.update("f", { phase: "calling", code_hash: null }, ["code"])));
    expect(r.filter(Boolean).length).toBe(1);
    expect(await store.update("f", { sealed_audio: Buffer.from([7, 7]) })).toBe(true);
    expect((await store.get("f", NOW))?.has_audio).toBe(true);
    expect(await store.getAudio("f", NOW)).toEqual(Buffer.from([7, 7]));
    expect(await store.update("f", { ...WIPE, phase: "done", plan_status: "completed" })).toBe(true);
    const row = await store.get("f", NOW);
    expect([row?.sealed_phone, row?.sealed_text, row?.sealed_token, row?.has_audio, await store.getAudio("f", NOW), row?.phase]).toEqual([null, null, null, false, null, "done"]);
  });

  it("caps counters atomically under a race, and gives slots back", async () => {
    const r = await Promise.all(Array.from({ length: 10 }, () => store.takeSlot("num:x:2026-10-02", 3, NOW)));
    expect(r.filter(Boolean).length).toBe(3);
    expect(await store.counter("num:x:2026-10-02")).toBe(3);
    expect(await store.takeSlot("zero", 0, NOW)).toBe(false);
    await store.takeSlot("site:y", 1, NOW);
    expect(await reserveSlots(store, [{ key: "num:y", cap: 3 }, { key: "site:y", cap: 1 }], NOW)).toEqual({ ok: false, refused: 1 });
    expect(await store.counter("num:y")).toBe(0);
  });

  it("wipes a session whose code ran out, without touching a live call", async () => {
    await store.startCode(session("g", "h5"), NOW);
    await store.startCode(session("h", "h6"), NOW);
    await store.update("h", { phase: "calling", code_hash: null }, ["code"]);
    await store.sweep(NOW + 11 * 60_000);
    const g = await store.get("g", NOW + 11 * 60_000);
    expect([g?.phase, g?.sealed_phone, g?.sealed_text, g?.sealed_token]).toEqual(["expired", null, null, null]);
    expect((await store.get("h", NOW + 11 * 60_000))?.sealed_phone).toEqual(Buffer.from([1, 2, 3]));
  });

  it("binds a call UUID once, atomically, and reports match, mismatch and gone", async () => {
    await store.startCode(session("u", "h7"), NOW);
    const r = await Promise.all(["x1", "x2", "x3"].map((u) => store.claimUuid("u", "plan", u, NOW)));
    expect(r.filter((v) => v === "bound").length).toBe(1);
    const won = (await store.get("u", NOW))!.plan_uuid!;
    expect(await store.claimUuid("u", "plan", won, NOW)).toBe("match");
    expect(await store.claimUuid("u", "plan", "other", NOW)).toBe("mismatch");
    expect(await store.claimUuid("nope", "plan", won, NOW)).toBe("gone");
  });

  it("restarts a windowed counter once its window has passed", async () => {
    expect(await store.takeSlot("gap:z", 1, NOW, 60_000)).toBe(true);
    expect(await store.takeSlot("gap:z", 1, NOW + 30_000, 60_000)).toBe(false);
    expect(await store.takeSlot("gap:z", 1, NOW + 60_000, 60_000)).toBe(true);
    expect(await store.counter("gap:z", NOW + 61_000)).toBe(1);
    expect(await store.counter("gap:z", NOW + 121_000)).toBe(0);
  });

  it("refuses a new code while a plan call to the number is live, and records placing without overwriting an event", async () => {
    await store.startCode(session("p", "h8"), NOW);
    await store.update("p", { phase: "calling", code_hash: null }, ["code"]);
    expect(await store.startCode(session("q", "h8"), NOW)).toBe("in-flight");
    await store.update("p", { plan_status: "answered" });
    expect(await store.markPlaced("p", "plan", "unknown", null, NOW)).toBe(true);
    expect((await store.get("p", NOW))?.plan_status).toBe("answered");
    await store.sweep(NOW + 6 * 60_000); // confirmed by an event: left alone
    expect((await store.get("p", NOW + 6 * 60_000))?.phase).toBe("calling");
    await store.update("p", { plan_status: "unknown" });
    await store.sweep(NOW + 6 * 60_000); // unconfirmed past 5 minutes: wiped
    const row = await store.get("p", NOW + 6 * 60_000);
    expect([row?.phase, row?.sealed_phone, row?.sealed_text]).toEqual(["failed", null, null]);
  });

  it("sweeps expired sessions and counters", async () => {
    await store.sweep(NOW + 3 * 24 * 3600_000);
    const { rows } = await pool.query("select (select count(*) from atlas_calls)::int as s, (select count(*) from atlas_call_counters)::int as c");
    expect(rows[0]).toEqual({ s: 0, c: 0 });
  });
});
