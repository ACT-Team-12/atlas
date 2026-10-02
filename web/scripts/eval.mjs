// Measured eval of the live AI path. Usage: node scripts/eval.mjs [baseUrl]   (default http://localhost:3000)
// Sends each labeled sample paper in src/data/eval/papers.json to /api/extract, then a plan request to /api/plan and a teach-back quiz request to /api/understand,
// and writes the measured numbers to src/data/eval/results.json. Uses real AI calls (costs a few cents per paper).
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const { papers } = JSON.parse(readFileSync(new URL("../src/data/eval/papers.json", import.meta.url), "utf8"));

const rangeOf = (text, s) => {
  const i = text.toLowerCase().indexOf(s.toLowerCase());
  if (i < 0) throw new Error(`answer key string not in paper: ${s}`);
  return [i, i + s.length];
};
const overlaps = (a, span) => span && span.start < a[1] && a[0] < span.end;

async function post(path, body) {
  const t = Date.now();
  const res = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", "x-atlas-test": "1" }, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${json.error}`);
  return { json, ms: Date.now() - t };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };

const rows = [];
let model = "";
for (const p of papers) {
  process.stdout.write(`${p.id} ... `);
  const { json: care, ms: readMs } = await post("/api/extract", { text: p.text, reading_level: "simple", language: "English" });
  model = care.model;
  if (care.source_text !== p.text) throw new Error(`${p.id}: source_text was changed by the server`);
  const found = p.expected.filter((e) => care.items.some((it) => overlaps(rangeOf(p.text, e), it.span)));
  const promoted = p.distractors.filter((d) => care.items.some((it) => it.kind !== "warning_sign" && overlaps(rangeOf(p.text, d), it.span)));
  const plan = await post("/api/plan", {
    care: care.items.map(({ id, kind, title, plain_language, when, source_quote }) => ({ id, kind, title, plain_language, when, source_quote })),
    barriers: ["transport", "cost"],
    zip: "30303",
    language: "English",
  });
  const quiz = await post("/api/understand", {
    source_text: care.source_text,
    language: "English",
    items: care.items.slice(0, 20).map(({ id, kind, title, source_quote }) => ({ id, kind, title, source_quote })),
  });
  rows.push({
    id: p.id,
    title: p.title,
    expected: p.expected.length,
    found: found.length,
    missed: p.expected.filter((e) => !found.includes(e)),
    extracted: care.stats.extracted,
    grounded: care.stats.grounded,
    held_back: care.stats.refused,
    distractors: p.distractors.length,
    distractors_promoted: promoted,
    warning_expected: p.has_warning,
    warning_flagged: care.has_warning_signs,
    read_ms: readMs,
    plan_steps: plan.json.stats.steps,
    plan_dropped_refs: plan.json.stats.dropped_refs,
    plan_ms: plan.ms,
    quiz_questions: quiz.json.questions.length,
    quiz_dropped: quiz.json.dropped.length,
    quiz_dropped_reasons: quiz.json.dropped.map((d) => d.reason),
    quiz_ms: quiz.ms,
  });
  console.log(`found ${found.length}/${p.expected.length}, grounded ${care.stats.grounded}/${care.stats.extracted}, ${readMs} ms`);
}

const sum = (k) => rows.reduce((a, r) => a + (Array.isArray(r[k]) ? r[k].length : r[k]), 0);
const commit = (() => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "unknown"; } })();
const out = {
  measured_at: new Date().toISOString(),
  base_url: BASE.startsWith("http://localhost") ? "local production build" : BASE,
  commit,
  model,
  command: "node scripts/eval.mjs",
  papers: rows.length,
  totals: {
    expected: sum("expected"),
    found: sum("found"),
    extracted: sum("extracted"),
    grounded: sum("grounded"),
    held_back: sum("held_back"),
    distractors: sum("distractors"),
    distractors_promoted: sum("distractors_promoted"),
    warnings_matched: rows.filter((r) => r.warning_flagged === r.warning_expected).length,
    plan_steps: sum("plan_steps"),
    plan_dropped_refs: sum("plan_dropped_refs"),
    median_read_ms: median(rows.map((r) => r.read_ms)),
    median_plan_ms: median(rows.map((r) => r.plan_ms)),
    quiz_questions: sum("quiz_questions"),
    quiz_dropped: sum("quiz_dropped"),
    median_quiz_ms: median(rows.map((r) => r.quiz_ms)),
  },
  rows,
};
writeFileSync(new URL("../src/data/eval/results.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify(out.totals, null, 2));
