// Measures the meaning check. Usage: pnpm exec node scripts/meaning-eval.mjs [baseUrl]
// For each labeled sample paper: read it for real, check the untouched explanations (any flag is a false alarm),
// then plant meaning flips into copies (changed number, swapped time word, start/stop reversed) and count how many
// get flagged, and by which signal. Writes src/data/eval/meaning.json. Requests are marked as test traffic.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const { papers } = JSON.parse(readFileSync(new URL("../src/data/eval/papers.json", import.meta.url), "utf8"));
const H = { "content-type": "application/json", "x-atlas-test": "1" };
async function post(path, body) {
  const res = await fetch(BASE + path, { method: "POST", headers: H, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${json.error}`);
  return json;
}

const SWAPS = [["morning", "evening"], ["evening", "morning"], ["daily", "weekly"], ["day", "week"], ["before", "after"], ["after", "before"], ["days", "weeks"], ["weeks", "months"]];
function flipsFor(it) {
  const out = [];
  const num = it.plain_language.match(/\d+/);
  if (num) out.push({ kind: "changed number", text: it.plain_language.replace(num[0], String(Number(num[0]) * 2 + 1)) });
  for (const [a, b] of SWAPS) {
    const re = new RegExp(`\\b${a}\\b`, "i");
    if (re.test(it.plain_language)) { out.push({ kind: "swapped time word", text: it.plain_language.replace(re, b) }); break; }
  }
  if (/\bstop\b/i.test(it.plain_language)) out.push({ kind: "start/stop reversed", text: it.plain_language.replace(/\bstop\b/i, "Keep") });
  else if (/\b(take|start)\b/i.test(it.plain_language)) out.push({ kind: "start/stop reversed", text: it.plain_language.replace(/\b(take|start)\b/i, "Stop taking") });
  return out;
}

const rows = [];
let model = "";
for (const p of papers) {
  process.stdout.write(`${p.id} ... `);
  const care = await post("/api/extract", { text: p.text, reading_level: "simple", language: "English" });
  const base = care.items.map(({ id, plain_language, when, source_quote }) => ({ id, plain_language, when, source_quote }));
  const orig = await post("/api/meaning", { items: base });
  model = orig.checker_model;
  const planted = [];
  for (const it of base) for (const f of flipsFor(it)) planted.push({ ...it, id: `${it.id}~${planted.length}`, plain_language: f.text, kind: f.kind });
  const flipped = planted.length ? await post("/api/meaning", { items: planted.map(({ id, plain_language, when, source_quote }) => ({ id, plain_language, when, source_quote })) }) : { results: [] };
  const byId = new Map(flipped.results.map((r) => [r.id, r]));
  const caught = planted.map((f) => {
    const r = byId.get(f.id);
    const flagged = r?.flagged ?? false;
    // Keep the exact text of anything missed, so a miss can be read and explained, not just counted.
    return { kind: f.kind, flagged, by_numbers: !(r?.numbers_ok ?? true), by_model: r?.model_verdict === "different", ...(flagged ? {} : { quote: f.source_quote, planted_text: f.plain_language }) };
  });
  rows.push({
    id: p.id,
    originals: base.length,
    false_alarms: orig.results.filter((r) => r.flagged).map((r) => ({ id: r.id, numbers: r.unexpected_numbers, why: r.what_differs })),
    planted: caught.length,
    caught: caught.filter((c) => c.flagged).length,
    by_kind: caught,
    ms: orig.ms,
  });
  console.log(`false alarms ${rows.at(-1).false_alarms.length}/${base.length}, caught ${rows.at(-1).caught}/${caught.length}`);
}
const all = rows.flatMap((r) => r.by_kind);
const kinds = [...new Set(all.map((c) => c.kind))];
const out = {
  measured_at: new Date().toISOString(),
  base_url: BASE.startsWith("http://localhost") ? "local production build" : BASE,
  commit: (() => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "unknown"; } })(),
  checker_model: model,
  command: "node scripts/meaning-eval.mjs",
  totals: {
    originals: rows.reduce((a, r) => a + r.originals, 0),
    false_alarms: rows.reduce((a, r) => a + r.false_alarms.length, 0),
    planted: all.length,
    caught: all.filter((c) => c.flagged).length,
    caught_by_numbers: all.filter((c) => c.by_numbers).length,
    caught_by_model: all.filter((c) => c.by_model).length,
    by_kind: Object.fromEntries(kinds.map((k) => [k, { planted: all.filter((c) => c.kind === k).length, caught: all.filter((c) => c.kind === k && c.flagged).length }])),
  },
  rows,
};
writeFileSync(new URL("../src/data/eval/meaning.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out.totals, null, 2));
