import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
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
  // process.stderr, not console: vitest drops console output from a file whose tests are all skipped.
  process.stderr.write(`\nstore.pg.test.ts SKIPPED: CALL_TEST_DATABASE_URL is not set${process.env.CI ? " (CI)" : ""}, so the call SQL was not run against Postgres.\n`);
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
    expect([row?.sealed_phone, row?.sealed_text, row?.sealed_token, row?.has_audio, await store.getAudio("f", NOW), row?.phase, row?.last4]).toEqual([null, null, null, false, null, "done", null]);
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
    expect([g?.phase, g?.sealed_phone, g?.sealed_text, g?.sealed_token, g?.last4]).toEqual(["expired", null, null, null, null]);
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

  it("never holds a live plan call and a new code for one number, even when the code is typed while a new one starts", async () => {
    await store.startCode(session("r1", "h9"), NOW);
    // The code is typed (code -> calling) in a transaction that has not committed yet ...
    const typing = await pool.connect();
    await typing.query("begin");
    await typing.query("update atlas_calls set phase = 'calling', code_hash = null where id = 'r1' and phase = 'code'");
    // ... while a new code for the same number starts (it sees r1 still in 'code' and waits on it).
    const starting = store.startCode(session("r2", "h9", { code_expires_at: new Date(NOW + 10 * 60_000) }), NOW);
    await new Promise((r) => setTimeout(r, 200));
    await typing.query("commit");
    typing.release();
    expect(await starting).toBe("in-flight");
    const { rows } = await pool.query("select id, phase from atlas_calls where phone_hash = 'h9' order by id");
    expect(rows).toEqual([{ id: "r1", phase: "calling" }]);
  });

  it("sweeps expired sessions and counters", async () => {
    await store.sweep(NOW + 3 * 24 * 3600_000);
    const { rows } = await pool.query("select (select count(*) from atlas_calls)::int as s, (select count(*) from atlas_call_counters)::int as c");
    expect(rows[0]).toEqual({ s: 0, c: 0 });
  });
});

/** The first shape of the call tables (commit ea00157), before the one-live-session index existed. */
const FIRST_SCHEMA = `
create table atlas_calls (
  id text primary key, phone_hash text not null, last4 text not null check (last4 ~ '^[0-9]{4}$'), language text not null,
  phase text not null check (phase in ('code', 'code_missed', 'expired', 'calling', 'done', 'failed')),
  code_hash text, attempts smallint not null default 0, code_expires_at timestamptz, code_status text, plan_status text,
  plan_mode text check (plan_mode in ('stream', 'talk')), note text, sealed_phone bytea, sealed_text bytea, sealed_token bytea,
  sealed_audio bytea, created_at timestamptz not null default now(), expires_at timestamptz not null);
create unique index atlas_calls_one_code_uq on atlas_calls (phone_hash) where phase = 'code';
create table atlas_call_counters (id text primary key, n integer not null check (n >= 0), expires_at timestamptz not null);
`;
const migration = (name: string) => readFileSync(new URL(`../../../db/migrations/${name}`, import.meta.url), "utf8");

describe.skipIf(!url)("call migrations (real Postgres)", () => {
  let pool: Pool;
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 4 });
    await pool.query("drop table if exists atlas_calls; drop table if exists atlas_call_counters;");
    await pool.query(FIRST_SCHEMA);
    // What the old race could leave: one number with a live plan call AND a live code, neither expired.
    await pool.query(`insert into atlas_calls (id, phone_hash, last4, language, phase, code_status, plan_status, sealed_phone, sealed_text, created_at, expires_at) values
      ('plan', 'dup', '2368', 'English', 'calling', 'completed', 'answered', '\\x01', '\\x02', now() - interval '5 minutes', now() + interval '25 minutes'),
      ('code', 'dup', '2368', 'English', 'code', null, null, '\\x03', '\\x04', now() - interval '1 minute', now() + interval '29 minutes'),
      ('old', 'old', '1111', 'English', 'calling', null, null, '\\x05', null, now() - interval '40 minutes', now() - interval '10 minutes'),
      ('ok', 'solo', '2222', 'English', 'code', null, null, '\\x06', null, now(), now() + interval '30 minutes')`);
  });
  afterAll(async () => { await pool?.end(); });

  it("a duplicate live pair keeps the runtime path from building the index, and says so instead of failing silently", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await ensureSchema(pool)).toBe(false);
    expect(JSON.stringify(spy.mock.calls)).toContain("one-live-session index missing");
    spy.mockRestore();
  });

  it("the versioned migration resolves the pair (the plan call survives), builds the index, and is idempotent", async () => {
    await pool.query(migration("003_atlas_calls.sql"));
    await pool.query(migration("006_atlas_calls_one_live.sql"));
    await pool.query(migration("006_atlas_calls_one_live.sql"));
    const { rows } = await pool.query("select id, phase, last4, sealed_phone, sealed_text from atlas_calls order by id");
    expect(rows).toEqual([
      { id: "code", phase: "failed", last4: null, sealed_phone: null, sealed_text: null },
      { id: "ok", phase: "code", last4: "2222", sealed_phone: Buffer.from([6]), sealed_text: null },
      { id: "old", phase: "expired", last4: null, sealed_phone: null, sealed_text: null },
      { id: "plan", phase: "calling", last4: "2368", sealed_phone: Buffer.from([1]), sealed_text: Buffer.from([2]) },
    ]);
    const idx = await pool.query("select 1 from pg_indexes where tablename = 'atlas_calls' and indexname = 'atlas_calls_one_live_uq'");
    expect(idx.rowCount).toBe(1);
    expect(await ensureSchema(pool)).toBe(true);
  });
});
