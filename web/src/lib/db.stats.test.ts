import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

/**
 * Real Postgres: runs in CI (web-ci.yml starts one) and skips without TEST_DATABASE_URL.
 * Each run works in its own throwaway schema, so it never touches or counts anyone else's rows.
 */
const BASE = process.env.TEST_DATABASE_URL;
const SCHEMA = `helper_stats_${process.pid}_${Date.now()}`;
const withSchema = (url: string) => `${url}${url.includes("?") ? "&" : "?"}options=${encodeURIComponent(`-c search_path=${SCHEMA}`)}`;

describe.skipIf(!BASE)("helper-link plans in /api/stats (real database)", () => {
  let admin: pg.Client;
  let db: typeof import("./db");

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: BASE });
    await admin.connect();
    await admin.query(`create schema ${SCHEMA}`);
    const scoped = new pg.Client({ connectionString: withSchema(BASE!) });
    await scoped.connect();
    const dir = new URL("../../db/migrations/", import.meta.url);
    // Main's migrations only; other branches add their own files, which this test does not need.
    for (const f of readdirSync(dir).filter((f) => /^(001|002|007)_.*\.sql$/.test(f)).sort()) {
      await scoped.query(readFileSync(new URL(f, dir), "utf8"));
    }
    const row = (env: string, test: boolean, kind: string, entry: string | null) =>
      scoped.query(`insert into atlas_events (env, is_test, surface, kind, entry) values ($1, $2, 'web', $3, $4)`, [env, test, kind, entry]);
    await row("production", false, "plan", "helper-link"); // counts
    await row("production", false, "plan", "helper-link"); // counts
    await row("production", false, "plan", null);          // a normal plan
    await row("production", true, "plan", "helper-link");  // our own test run
    await row("preview", false, "plan", "helper-link");    // a preview deploy
    await row("local", false, "plan", "helper-link");      // localhost
    await row("production", false, "read", "helper-link"); // not a plan
    await scoped.end();
    process.env.DATABASE_URL = withSchema(BASE!);
    db = await import("./db");
  });

  afterAll(async () => {
    await admin?.query(`drop schema if exists ${SCHEMA} cascade`);
    await admin?.end();
  });

  it("counts production helper-link plans only, excluding tests, previews and localhost", async () => {
    const s = await db.liveStats();
    expect(s).not.toBeNull();
    expect(s!.helper_link_plans).toBe(2);
    expect(s!.plans).toBe(3);
  });

  it("refuses any other entry value at the database", async () => {
    const c = new pg.Client({ connectionString: withSchema(BASE!) });
    await c.connect();
    await expect(c.query(`insert into atlas_events (env, surface, kind, entry) values ('local', 'web', 'plan', '30310')`)).rejects.toThrow();
    await c.end();
  });

  it("records the tag through recordEvent, and no column holds a ZIP", async () => {
    expect(await db.recordEvent({ surface: "web", kind: "plan", language: "Spanish", steps: 3, entry: "helper-link" }, true)).toBe("ok");
    const c = new pg.Client({ connectionString: withSchema(BASE!) });
    await c.connect();
    const cols = await c.query(`select column_name from information_schema.columns where table_schema = $1 and table_name = 'atlas_events'`, [SCHEMA]);
    expect(cols.rows.map((r) => r.column_name).filter((n: string) => /zip|location|note|link|address/.test(n))).toEqual([]);
    const last = await c.query(`select entry, is_test from atlas_events order by id desc limit 1`);
    expect(last.rows[0]).toEqual({ entry: "helper-link", is_test: true });
    await c.end();
  });
});
