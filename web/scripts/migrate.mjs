// Applies db/migrations/*.sql in order. Usage: pnpm exec node --env-file=.env.local scripts/migrate.mjs
// Uses the direct (non-pooled) connection, as Neon recommends for migrations.
import { readdirSync, readFileSync } from "node:fs";
import pg from "pg";

const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;
if (!url) throw new Error("No DATABASE_URL_UNPOOLED or DATABASE_URL in the environment.");
const dir = new URL("../db/migrations/", import.meta.url);
const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    await client.query(readFileSync(new URL(f, dir), "utf8"));
    console.log("applied", f);
  }
  const { rows } = await client.query("select count(*)::int as n from atlas_events");
  console.log("atlas_events rows:", rows[0].n);
} finally {
  await client.end();
}
