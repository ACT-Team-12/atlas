// "Test the imagination" (Mission 3): runs AI-generated hypothesis personas through the LIVE product.
// Each persona pairs one of our labeled sample papers with a language, reading level, barriers and a metro Atlanta ZIP.
// These are simulations, not customer evidence. Requests carry x-atlas-test so they never count as real use.
// Usage: pnpm exec node scripts/persona-runs.mjs [baseUrl]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const BASE = (process.argv[2] ?? "https://atlas-team12.vercel.app").replace(/\/$/, "");
const { papers } = JSON.parse(readFileSync(new URL("../src/data/eval/papers.json", import.meta.url), "utf8"));
const paper = (id) => papers.find((p) => p.id === id).text;

export const PERSONAS = [
  { id: "refugee-parent-clarkston", who: "Parent who resettled in Clarkston, speaks Amharic, child just left the ED with asthma", paper: "pediatric-asthma", language: "Amharic", reading_level: "simple", barriers: ["language", "transport", "cost"], zip: "30021", note: "No car. I work mornings." },
  { id: "night-shift-doraville", who: "Night-shift warehouse worker in Doraville, Spanish first, new diabetes medicine and a fasting lab", paper: "diabetes-hypertension", language: "Spanish", reading_level: "simple", barriers: ["schedule", "transport"], zip: "30340", note: "I work nights and sleep in the day." },
  { id: "teen-caregiver-tucker", who: "Teenager who translates for a grandparent after a heart failure hospital stay", paper: "heart-failure-discharge", language: "Vietnamese", reading_level: "standard", barriers: ["language", "referrals", "tech"], zip: "30084", note: "I translate for my grandma. She does not use a smartphone." },
  { id: "uninsured-worker-south-atlanta", who: "Day laborer without insurance after an urgent care visit", paper: "uti-urgent-care", language: "English", reading_level: "simple", barriers: ["insurance", "cost", "food"], zip: "30315", note: "" },
  { id: "chw-west-end", who: "Community health worker helping a client with a new blood pressure medicine between other visits", paper: "hypertension-new-med", language: "English", reading_level: "detailed", barriers: ["referrals", "schedule", "housing"], zip: "30310", note: "Helping a client today. Need the fastest path to the cardiology referral." },
];

const SCRIPT = { Amharic: /[ሀ-፿]/, Vietnamese: /[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i, Spanish: /\b(el|la|los|las|de|para|con|su|una)\b/i, English: /\b(the|your|to|and)\b/i };

async function post(path, body) {
  const t = Date.now();
  const res = await fetch(BASE + path, { method: "POST", headers: { "content-type": "application/json", "x-atlas-test": "1" }, body: JSON.stringify(body) });
  const json = await res.json();
  return { ok: res.ok, status: res.status, json, ms: Date.now() - t };
}

const runs = [];
for (const p of PERSONAS) {
  process.stdout.write(`${p.id} ... `);
  const read = await post("/api/extract", { text: paper(p.paper), language: p.language, reading_level: p.reading_level });
  if (!read.ok) { runs.push({ persona: p, error: `extract ${read.status}: ${read.json.error}` }); console.log("extract failed"); continue; }
  const care = read.json;
  const plain = care.items.map((i) => i.plain_language).join(" ");
  const plan = await post("/api/plan", {
    care: care.items.map(({ id, kind, title, plain_language, when, source_quote }) => ({ id, kind, title, plain_language, when, source_quote })),
    barriers: p.barriers, zip: p.zip, language: p.language, note: p.note,
  });
  const pr = plan.json;
  const cards = plan.ok ? Object.values(pr.resources) : [];
  const clinics = cards.filter((r) => r.type === "clinic");
  runs.push({
    persona: p,
    read: { ms: read.ms, extracted: care.stats.extracted, grounded: care.stats.grounded, held_back: care.stats.refused, warning: care.has_warning_signs, not_in_document: care.not_in_document.length, in_requested_language: SCRIPT[p.language].test(plain) },
    plan: plan.ok ? {
      ms: plan.ms, steps: pr.stats.steps, dropped_refs: pr.stats.dropped_refs, candidates: pr.stats.candidates, located: pr.located.label,
      ask_a_person: pr.ask_a_person, nearest_clinic_km: clinics.length ? Math.min(...clinics.map((c) => c.km ?? 999)) : null,
      clinics: clinics.map((c) => `${c.clinic.name} (${c.km} km)`), programs: cards.filter((r) => r.type === "program").map((r) => r.program.name),
      barriers_covered: [...new Set(pr.steps.map((s) => s.barrier))], summary: pr.summary,
      in_requested_language: SCRIPT[p.language].test(pr.summary + " " + pr.steps.map((s) => s.action).join(" ")),
    } : { error: `plan ${plan.status}: ${pr.error}` },
    sample_step: care.items[0] ? { title: care.items[0].title, plain_language: care.items[0].plain_language, quote: care.items[0].source_quote } : null,
  });
  console.log(`read ${read.ms} ms, plan ${plan.ok ? plan.ms + " ms" : "failed"}`);
}
const out = { ran_at: new Date().toISOString(), base_url: BASE, label: "SIMULATED: AI-generated hypothesis personas run through the live product. Not customer evidence.", runs };
mkdirSync(new URL("../../research/evidence/", import.meta.url), { recursive: true });
writeFileSync(new URL("../../research/evidence/2026-10-02-ai-persona-runs.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log("saved research/evidence/2026-10-02-ai-persona-runs.json");
