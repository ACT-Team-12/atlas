// Measured eval of "Explain my lab results" with real AI calls. Usage: node scripts/lab-eval.mjs [baseUrl]   (default http://localhost:3000)
// 1. Text: sends each labeled sample lab report in src/data/eval/labs.json to /api/results and compares the status our
//    code gives each row (high / low / inside / can't tell) with the hand-labeled truth.
// 2. Photo: sends each report's screenshot (data-raw/lab-photos/<id>.png, drawn by scripts/render_lab_photos.py) to
//    /api/results/read, checks how many result lines came back with the same numbers, then runs /api/results on that
//    text unedited, as if the person changed nothing.
// Writes src/data/eval/lab-eval.json. The reports are samples written by Team ATLAS, not real patients.
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const BASE = (process.argv[2] ?? "http://localhost:3000").replace(/\/$/, "");
const { reports } = JSON.parse(readFileSync(new URL("../src/data/eval/labs.json", import.meta.url), "utf8"));
const H = { "content-type": "application/json", "x-atlas-test": "1" };

async function post(path, body) {
  const t = Date.now();
  const res = await fetch(BASE + path, { method: "POST", headers: H, body: JSON.stringify(body) });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${json.error}`);
  return { json, ms: Date.now() - t };
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)) : 0; };
const squash = (s) => s.replace(/\s+/g, " ").trim();
const letters = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
const statusOf = (r) => (r.status === "outside" ? r.direction ?? "flagged" : r.status);
const isFlag = (s) => s === "high" || s === "low" || s === "flagged";
// Numbers on a line, in order. A minus right after a digit is a range dash ("65-99" or "65–99"), not a sign.
const nums = (s) => (s.replace(/(\d),(?=\d{3})/g, "$1").match(/(?<!\d)[-−]?\d+(?:\.\d+)?/g) ?? []).map((n) => n.replace("−", "-"));

/** Compares one /api/results answer with the truth rows. `match` finds the returned row for a truth row. */
function score(rep, res, match) {
  const rows = rep.rows.map((t) => {
    const got = match(t, res.rows);
    const s = got ? statusOf(got) : "not shown";
    return { test: t.test, truth: t.truth, got: s, right: s === t.truth };
  });
  const used = new Set(rep.rows.map((t) => match(t, res.rows)).filter(Boolean));
  return {
    rows,
    found: rows.filter((r) => r.got !== "not shown").length,
    right: rows.filter((r) => r.right).length,
    flags_truth: rows.filter((r) => r.truth === "high" || r.truth === "low").length,
    flags_right: rows.filter((r) => (r.truth === "high" || r.truth === "low") && r.right).length,
    false_flags: rows.filter((r) => !isFlag(r.truth) && isFlag(r.got)).length,
    missed_flags: rows.filter((r) => isFlag(r.truth) && !isFlag(r.got)).length,
    dropped: res.dropped.length,
    dropped_reasons: res.dropped.map((d) => `${d.test}: ${d.reason}`),
    extra: res.rows.filter((r) => !used.has(r)).map((r) => r.quote),
    coverage: res.coverage,
    ms: res.ms,
  };
}

const byLine = (t, rows) => rows.find((r) => squash(r.quote) === squash(t.line));
// For photo text the spacing differs, so match on the test name and the value printed on the line.
const byNameAndValue = (t, rows) => rows.find((r) => letters(r.quote).includes(letters(t.test)) && nums(r.quote).includes(nums(t.value)[0]));

const text = [], photo = [];
let model = "";
for (const rep of reports) {
  process.stdout.write(`${rep.id} text ... `);
  const { json, ms } = await post("/api/results", { text: rep.text, language: "English" });
  model = json.model;
  const s = score(rep, json, byLine);
  text.push({ id: rep.id, title: rep.title, rows_total: rep.rows.length, wall_ms: ms, ...s });
  console.log(`right ${s.right}/${rep.rows.length}, dropped ${s.dropped}, ${ms} ms`);

  process.stdout.write(`${rep.id} photo ... `);
  const png = readFileSync(new URL(`../data-raw/lab-photos/${rep.id}.png`, import.meta.url)).toString("base64");
  const read = await post("/api/results/read", { image_base64: png, image_media_type: "image/png" });
  const lines = read.json.text.split("\n").map(squash);
  // A truth line counts as read right when one line of the transcript has its test name and exactly the same numbers.
  const linesRight = rep.rows.filter((t) => lines.some((l) => letters(l).includes(letters(t.test)) && nums(l).join(" ") === nums(t.line).join(" ")));
  const exact = rep.rows.filter((t) => lines.includes(squash(t.line))).length;
  const after = await post("/api/results", { text: read.json.text, language: "English" });
  const p = score(rep, after.json, byNameAndValue);
  photo.push({
    id: rep.id, rows_total: rep.rows.length, read_ms: read.ms,
    lines_numbers_right: linesRight.length, lines_exact: exact,
    lines_wrong: rep.rows.filter((t) => !linesRight.includes(t)).map((t) => ({ test: t.test, truth_line: squash(t.line), read_as: lines.find((l) => letters(l).includes(letters(t.test))) ?? "(not found)" })),
    unreadable_marks: (read.json.text.match(/\[unreadable\]/g) ?? []).length,
    explain_wall_ms: after.ms, ...p,
  });
  console.log(`numbers right ${linesRight.length}/${rep.rows.length}, status right ${p.right}/${rep.rows.length}, read ${read.ms} ms`);
}

const sum = (xs, k) => xs.reduce((a, r) => a + (typeof r[k] === "number" ? r[k] : r[k].length), 0);
const commit = (() => { try { return execSync("git rev-parse --short HEAD").toString().trim(); } catch { return "unknown"; } })();
const out = {
  measured_at: new Date().toISOString(),
  base_url: BASE.startsWith("http://localhost") ? "local dev server" : BASE,
  commit,
  model,
  command: "node scripts/lab-eval.mjs",
  reports: reports.length,
  text: {
    totals: {
      rows: sum(text, "rows_total"), found: sum(text, "found"), right: sum(text, "right"),
      flags_truth: sum(text, "flags_truth"), flags_right: sum(text, "flags_right"),
      false_flags: sum(text, "false_flags"), missed_flags: sum(text, "missed_flags"),
      dropped: sum(text, "dropped"), extra: sum(text, "extra"),
      lines_checked: text.reduce((a, r) => a + r.coverage.checked, 0), lines_found: text.reduce((a, r) => a + r.coverage.candidates, 0),
      median_ms: median(text.map((r) => r.wall_ms)),
    },
    rows: text,
  },
  photo: {
    note: "Screenshots drawn from the sample text, not camera photos. Statuses are from the read text used unedited.",
    totals: {
      rows: sum(photo, "rows_total"), lines_numbers_right: sum(photo, "lines_numbers_right"), lines_exact: sum(photo, "lines_exact"),
      unreadable_marks: sum(photo, "unreadable_marks"), found: sum(photo, "found"), right: sum(photo, "right"),
      false_flags: sum(photo, "false_flags"), missed_flags: sum(photo, "missed_flags"), dropped: sum(photo, "dropped"),
      median_read_ms: median(photo.map((r) => r.read_ms)),
    },
    rows: photo,
  },
};
writeFileSync(new URL("../src/data/eval/lab-eval.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ text: out.text.totals, photo: out.photo.totals }, null, 2));
