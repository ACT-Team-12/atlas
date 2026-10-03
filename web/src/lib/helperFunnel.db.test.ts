import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";

/**
 * Real Postgres: runs in CI (web-ci.yml starts one) and skips without TEST_DATABASE_URL.
 * Each run works in its own throwaway schemas, so it never touches or counts anyone else's rows.
 */
const BASE = process.env.TEST_DATABASE_URL;
const STAMP = `${process.pid}_${Date.now()}`;
const MIGRATED = `helper_funnel_${STAMP}`;
const OLD = `helper_funnel_old_${STAMP}`;
const withSchema = (url: string, schema: string) => `${url}${url.includes("?") ? "&" : "?"}options=${encodeURIComponent(`-c search_path=${schema}`)}`;

async function migrate(schema: string, files: RegExp) {
  const c = new pg.Client({ connectionString: withSchema(BASE!, schema) });
  await c.connect();
  const dir = new URL("../../db/migrations/", import.meta.url);
  for (const f of readdirSync(dir).filter((f) => files.test(f)).sort()) await c.query(readFileSync(new URL(f, dir), "utf8"));
  return c;
}

async function funnelFor(schema: string) {
  vi.resetModules();
  process.env.DATABASE_URL = withSchema(BASE!, schema);
  const db = await import("./db");
  return db.helperFunnel();
}

describe.skipIf(!BASE)("helper-link funnel (real database)", () => {
  let admin: pg.Client;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: BASE });
    await admin.connect();
    await admin.query(`create schema ${MIGRATED}`);
    await admin.query(`create schema ${OLD}`);

    const c = await migrate(MIGRATED, /^(001|002|007)_.*\.sql$/);
    const rows = (n: number, env: string, test: boolean, kind: string, language: string | null, entry: string | null, daysAgo = 0) =>
      c.query(`insert into atlas_events (at, env, is_test, surface, kind, language, entry)
        select now() - make_interval(days => $7), $1, $2, 'web', $3, $4, $5 from generate_series(1, $6)`,
      [env, test, kind, language, entry, n, daysAgo]);
    // Real production plans.
    await rows(12, "production", false, "plan", "English", "helper-link");
    await rows(3, "production", false, "plan", "English", null);
    await rows(5, "production", false, "plan", "English", null, 30);
    await rows(10, "production", false, "plan", "Spanish", "helper-link");
    await rows(3, "production", false, "plan", "Spanish", "helper-link", 30);
    await rows(2, "production", false, "plan", "Amharic", "helper-link");
    // Never counted: our own tests, previews, localhost, and reads.
    await rows(50, "production", true, "plan", "English", "helper-link");
    await rows(50, "preview", false, "plan", "English", "helper-link");
    await rows(50, "local", false, "plan", "Korean", "helper-link");
    await rows(50, "production", false, "read", "French", "helper-link");
    await c.end();

    // A database that has not had migration 007 yet.
    await (await migrate(OLD, /^(001|002)_.*\.sql$/)).end();
  });

  afterAll(async () => {
    await admin?.query(`drop schema if exists ${MIGRATED} cascade`);
    await admin?.query(`drop schema if exists ${OLD} cascade`);
    await admin?.end();
  });

  it("counts production plans only, excluding test runs, previews, localhost and reads", async () => {
    const r = await funnelFor(MIGRATED);
    expect(r.available).toBe(true);
    if (!r.available) return;
    // 35 production plans; counting any of the 50-row test, preview, local or read groups would make it 85 or more.
    expect(r.funnel.all_time.all_plans).toBe(35);
    // 24 of 27 and 27 of 35 would give away 3 and 8 plans not from a helper link (and 27 of 35 gives 8 older plans), so those are hidden.
    expect(r.funnel.last_7_days).toEqual({ helper_link_plans: "hidden", all_plans: "hidden" });
    expect(r.funnel.all_time.helper_link_plans).toBe("hidden");
  });

  it("groups by language and never shows a number under 10", async () => {
    const r = await funnelFor(MIGRATED);
    if (!r.available) throw new Error("expected the funnel");
    expect(r.funnel.by_language.map((x) => x.language)).toEqual(["English", "Spanish", "Other languages"]);
    expect(JSON.stringify(r.funnel)).not.toMatch(/Amharic|Korean|French/);
    const counts = r.funnel.by_language.flatMap((x) => [x.last_7_days, x.all_time]).flatMap((c) => [c.helper_link_plans, c.all_plans]);
    for (const n of counts) expect(typeof n === "string" ? ["<10", "hidden"].includes(n) : n >= 10).toBe(true);
    expect(r.funnel.by_language[2].all_time).toEqual({ helper_link_plans: "<10", all_plans: "<10" });
  });

  it("is not available, rather than zero, before migration 007", async () => {
    expect(await funnelFor(OLD)).toEqual({ available: false, reason: "not-migrated" });
  });
});
