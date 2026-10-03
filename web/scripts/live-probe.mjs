// Live probe of the judged path. Usage: node scripts/live-probe.mjs [baseUrl]   (default https://atlas-team12.vercel.app)
// Run on a schedule by .github/workflows/live-probe.yml. Exits non-zero, naming the failed check, when anything is off.
//
// What it checks, in order:
//   1. Every public page answers 200 AND contains a string unique to that page (a status alone can be an error page).
//   2. /api/checker reports the exact published counts (all real instructions accepted, all planted fakes caught).
//   3. ONE real read + plan of the bundled sample paper through the same routes the website uses
//      (/api/extract then /api/plan), so a dead AI key or exhausted API credit fails here instead of in front of a judge.
// Every request carries x-atlas-test: 1, which src/lib/db.ts isTestRequest() honors, so probe runs never count as real use.
// Cost: one extract call + one plan call per run (a few cents).
//
// Expected checker counts can be overridden when the eval set grows: EXPECT_REAL=38 EXPECT_FAKES=101.
import { readFileSync } from "node:fs";

const BASE = (process.argv[2] ?? process.env.PROBE_BASE_URL ?? "https://atlas-team12.vercel.app").replace(/\/$/, "");
const EXPECT_REAL = Number(process.env.EXPECT_REAL ?? 38);
const EXPECT_FAKES = Number(process.env.EXPECT_FAKES ?? 101);
const TIMEOUT_MS = 90_000;
const HEADERS = { "x-atlas-test": "1" };

const PAGES = [
  { path: "/", must: "Your visit, turned into a plan you can finish" },
  { path: "/judge", must: "For judges · ATLAS" },
  { path: "/tests", must: "Our tests · ATLAS" },
  { path: "/privacy", must: "Privacy · ATLAS" },
  { path: "/download", must: "Get the apps · ATLAS" },
];
// pages + checker + read + plan. Fewer executed than this means something was skipped: fail, never a vacuous green.
const EXPECTED_CHECKS = PAGES.length + 3;

const results = [];
let executed = 0;

function record(name, ok, detail) {
  executed++;
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  ${detail}`);
  return ok;
}

async function request(path, init = {}) {
  const t = Date.now();
  const res = await fetch(BASE + path, { ...init, headers: { ...HEADERS, ...(init.headers ?? {}) }, signal: AbortSignal.timeout(TIMEOUT_MS), redirect: "follow" });
  const text = await res.text();
  return { res, text, ms: Date.now() - t };
}

async function getJson(path, init) {
  const { res, text, ms } = await request(path, init);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${path} returned HTTP ${res.status} with a non-JSON body (${text.length} bytes): ${text.slice(0, 160).replace(/\s+/g, " ")}`);
  }
  if (!res.ok) throw new Error(`${path} returned HTTP ${res.status}: ${json?.error ?? JSON.stringify(json).slice(0, 200)}`);
  return { json, ms };
}

const postJson = (path, body) => getJson(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

// Run one check; any thrown error (network failure, timeout, bad JSON, HTTP error) is a FAIL with its message.
async function check(name, fn) {
  try {
    const out = await fn();
    return record(name, out.ok, out.detail);
  } catch (e) {
    return record(name, false, e instanceof Error ? e.message : String(e));
  }
}

function loadSample() {
  const src = readFileSync(new URL("../src/lib/sample.ts", import.meta.url), "utf8");
  const m = src.match(/export const SAMPLE_AVS = `([\s\S]*?)`;/);
  if (!m || m[1].includes("${")) throw new Error("could not read SAMPLE_AVS from src/lib/sample.ts as a plain template literal");
  return m[1];
}

console.log(`live probe against ${BASE}`);

// 1. Pages.
for (const p of PAGES) {
  await check(`page ${p.path}`, async () => {
    const { res, text, ms } = await request(p.path);
    if (res.status !== 200) return { ok: false, detail: `HTTP ${res.status} (want 200)` };
    if (!text.includes(p.must)) return { ok: false, detail: `200 but the page-unique string "${p.must}" is missing (${text.length} bytes)` };
    return { ok: true, detail: `200, found "${p.must}", ${ms} ms` };
  });
}

// 2. Quote checker counts.
await check("api/checker counts", async () => {
  const { json } = await getJson("/api/checker");
  const r = json?.real, f = json?.fakes;
  if (typeof r?.total !== "number" || typeof f?.total !== "number") return { ok: false, detail: `unexpected shape: ${JSON.stringify(json).slice(0, 200)}` };
  const got = `real ${r.accepted}/${r.total} accepted, fakes ${f.caught}/${f.total} caught`;
  const ok = r.total === EXPECT_REAL && r.accepted === EXPECT_REAL && f.total === EXPECT_FAKES && f.caught === EXPECT_FAKES;
  return { ok, detail: ok ? got : `${got} (want real ${EXPECT_REAL}/${EXPECT_REAL}, fakes ${EXPECT_FAKES}/${EXPECT_FAKES})` };
});

// 3. One real read + plan of the sample paper.
let care = null;
await check("read sample paper (/api/extract)", async () => {
  const sample = loadSample();
  const { json, ms } = await postJson("/api/extract", { text: sample, reading_level: "simple", language: "English" });
  const items = Array.isArray(json?.items) ? json.items : null;
  if (!items) return { ok: false, detail: `no items array in response: ${JSON.stringify(json).slice(0, 200)}` };
  if (items.length < 1) return { ok: false, detail: `0 steps read from the sample paper, ${ms} ms` };
  const unquoted = items.filter((it) => typeof it.source_quote !== "string" || !it.source_quote.trim() || !it.grounded || !it.span);
  if (unquoted.length) return { ok: false, detail: `${unquoted.length} of ${items.length} steps lack a grounded quote: ${unquoted.map((i) => i.id).join(", ")}` };
  care = items;
  return { ok: true, detail: `${items.length} steps, every one quoted and grounded, ${json.stats?.refused ?? "?"} held back, model ${json.model}, ${ms} ms` };
});

await check("plan from sample paper (/api/plan)", async () => {
  if (!care) return { ok: false, detail: "skipped because the read failed (counted as a failure)" };
  const { json, ms } = await postJson("/api/plan", {
    care: care.map(({ id, kind, title, plain_language, when, source_quote }) => ({ id, kind, title, plain_language, when, source_quote })),
    barriers: ["transport", "cost"],
    zip: "30303",
    language: "English",
  });
  const steps = Array.isArray(json?.steps) ? json.steps : null;
  if (!steps) return { ok: false, detail: `no steps array in response: ${JSON.stringify(json).slice(0, 200)}` };
  if (steps.length < 1) return { ok: false, detail: `0 plan steps, ${ms} ms` };
  const dropped = json.stats?.dropped_refs;
  if (dropped !== 0) return { ok: false, detail: `dropped_refs = ${dropped} (want 0)` };
  const quoted = new Map(care.map((c) => [c.id, c.source_quote]));
  const bad = steps.filter((s) => !Array.isArray(s.care_ids) || !Array.isArray(s.resource_ids) || s.care_ids.length + s.resource_ids.length === 0 || s.care_ids.some((id) => !quoted.get(id)));
  if (bad.length) return { ok: false, detail: `${bad.length} of ${steps.length} plan steps cite nothing, or cite a care step with no quote` };
  return { ok: true, detail: `${steps.length} steps, 0 dropped, every step traced to a quoted line or a verified resource, model ${json.model}, ${ms} ms` };
});

const failed = results.filter((r) => !r.ok);
console.log(`\n${executed}/${EXPECTED_CHECKS} checks executed, ${failed.length} failed`);
if (executed < EXPECTED_CHECKS) {
  console.error(`LIVE PROBE FAILED: only ${executed} of ${EXPECTED_CHECKS} checks executed`);
  process.exit(1);
}
if (failed.length) {
  console.error(`LIVE PROBE FAILED: ${failed.map((f) => `${f.name} (${f.detail})`).join("; ")}`);
  process.exit(1);
}
console.log("LIVE PROBE PASSED");
