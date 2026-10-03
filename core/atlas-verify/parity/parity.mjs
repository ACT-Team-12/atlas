// Parity test: the TypeScript checker (web/src/lib, imported as-is) against the Rust checker built to WebAssembly.
//
//   node --experimental-strip-types --import ./parity/register.mjs parity/parity.mjs [--wasm pkg/atlas_verify.wasm]
//        [--out parity.json] [--no-native]
//
// For every case it compares findSpan (same span or same null; a non-numeric offset is recorded and counted), and for
// every distinct string normalize and fakesFor. It also runs the Rust checker report natively (cargo example) and
// deep-compares it with the TS runCheckerTest(). Exits 1 on any mismatch. The output file is deterministic.
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";
import { load } from "../js/atlas_verify.mjs";

const CRATE = new URL("../", import.meta.url);
const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : dflt;
};
const wasmPath = arg("--wasm", fileURLToPath(new URL("pkg/atlas_verify.wasm", CRATE)));
const outPath = arg("--out", fileURLToPath(new URL("parity.json", CRATE)));
const native = !process.argv.includes("--no-native");

const ts = await import("../../../web/src/lib/verify.ts");
const tsChecker = await import("../../../web/src/lib/checkerTest.ts");
const { SAMPLE_AVS } = await import("../../../web/src/lib/sample.ts");
const { SAMPLE_LABS } = await import("../../../web/src/lib/sampleLabs.ts");
const labs = (await import("../../../web/src/data/eval/labs.json")).default;
const rust = await load(readFileSync(wasmPath));

// Case mapping (toLowerCase vs Rust to_lowercase) only agrees when both sides use the same Unicode version. A newer
// Unicode adds case pairs (e.g. U+A7CE/U+A7CF in 17.0), so a version skew is a real disagreement, not noise: fail
// before comparing anything.
const UNICODE = { node: process.versions.unicode, rust: rust.unicodeVersion() };
if (UNICODE.node !== UNICODE.rust) {
  console.error(`Unicode version mismatch: Node ${process.version} has ${UNICODE.node}, the Rust build has ${UNICODE.rust}. Pin both (see README).`);
  process.exit(1);
}

// ---------- sources ----------
const sources = new Map();
sources.set("sample_avs", SAMPLE_AVS);
sources.set("sample_labs", SAMPLE_LABS);
for (const p of tsChecker.PAPERS) sources.set(`paper:${p.id}`, p.text);
for (const r of labs.reports) sources.set(`lab:${r.id}`, r.text);
// Derived sources that put hard characters in front of real text: "\u0130" (two units after lower-casing), an emoji
// (a surrogate pair), Amharic, and every space turned into a no-break space.
for (const p of tsChecker.PAPERS) {
  sources.set(`paper:${p.id}+prefix`, `\u0130 \u{1F48A} \u1230\u120b\u121d ${p.text}`);
  sources.set(`paper:${p.id}+nbsp`, p.text.replace(/ /g, "\u00a0"));
}

// ---------- cases ----------
const cases = [];
const add = (origin, source, quote) => cases.push({ origin, source, quote });

// 1. The quotes in verify.test.ts.
for (const q of [
  "Take 1 tablet by mouth 2 times a day with meals.",
  "Hemoglobin A1c ... due in 3 months",
  "due in 3 months ... Hemoglobin A1c",
  "Take aspirin 81 mg daily",
  "",
  "..",
  "metformin (GLUCOPHAGE) 500 mg tablet",
  "Increase insulin to 20 units",
]) add("verify.test.ts", "sample_avs", q);
add("verify.test.ts", { inline: "Call the office if your\n  blood sugar is above 300" }, "call the office if your blood sugar is above 300");
add("verify.test.ts", { inline: "Patient\u2019s log" }, "patient's log");

// 2. Every line of the two sample documents, against itself and against the other one.
for (const [id, other] of [["sample_avs", "sample_labs"], ["sample_labs", "sample_avs"]]) {
  for (const line of sources.get(id).split("\n").filter((l) => l.trim())) {
    add(`${id} line`, id, line);
    add(`${id} line vs ${other}`, other, line);
  }
}

// 3. Eval papers: answer key, distractors, the TS planted fakes, invented instructions, and cross-paper quotes.
const INVENTED = [
  "Take warfarin 5 mg by mouth every night",
  "Double your dose if you feel worse",
  "Stop all of your medicines before the lab",
  "Take 2 aspirin every 4 hours",
];
for (const p of tsChecker.PAPERS) {
  const id = `paper:${p.id}`;
  for (const e of p.expected) {
    add("papers expected", id, e);
    add("papers expected +prefix source", `${id}+prefix`, e);
    add("papers expected +nbsp source", `${id}+nbsp`, e);
    for (const f of tsChecker.fakesFor(e)) add(`papers fake: ${f.kind}`, id, f.text);
  }
  for (const d of p.distractors) add("papers distractor", id, d);
  for (const t of INVENTED) add("papers invented", id, t);
  const other = tsChecker.PAPERS[(tsChecker.PAPERS.indexOf(p) + 1) % tsChecker.PAPERS.length];
  for (const e of other.expected) add("papers cross-paper", id, e);
}

// 4. Lab reports: each row's printed line, test name, range and value with unit.
for (const r of labs.reports) {
  for (const row of r.rows) {
    add("labs line", `lab:${r.id}`, row.line);
    add("labs test", `lab:${r.id}`, row.test);
    if (row.range_text) add("labs range", `lab:${r.id}`, row.range_text);
    add("labs value+unit", `lab:${r.id}`, `${row.value} ${row.unit}`);
  }
}

// 5. Hand-written adversarial cases.
const A = (source, quote, note) => add(`adversarial: ${note}`, { inline: source }, quote);
A("Take \u201cone\u201d pill \u2014 don\u2019t skip", '"one" pill - don\'t skip', "curly quotes and em dash");
A("Take\u00a01\u00a0tablet\u00a0daily", "take 1 tablet daily", "NBSP in source");
A("Take 1 tablet daily", "take\u00a01\u00a0tablet", "NBSP in quote");
A("Hemoglobin A1c \u2013 due in 3 months", "hemoglobin a1c - due in 3 months", "en dash");
A("Potassium 3.5 \u2212 5.1 mmol/L", "3.5 - 5.1", "minus sign");
A("Range 3.5 - 5.1", "3.5 \u2015 5.1", "horizontal bar in quote");
A("\u{1F48A} Take 1 tablet \u{1F48A} daily", "take 1 tablet \u{1F48A} daily", "emoji in both");
A("Take 1 tablet daily", "take 1 tablet \u{1F48A}", "emoji only in quote");
A("\u{1F468}\u200d\u{1F469}\u200d\u{1F467} family visit", "family visit", "ZWJ emoji sequence before quote");
A("Tome 1 tableta por la ma\u00f1ana. \u00bfPreguntas? Llame al m\u00e9dico.", "TOME 1 TABLETA POR LA MA\u00d1ANA", "Spanish uppercase quote");
A("Tome 1 tableta por la ma\u00f1ana.", "por la man\u0303ana", "Spanish NFD vs NFC (no Unicode normalization in TS)");
A("U\u1ed1ng 1 vi\u00ean m\u1ed7i s\u00e1ng sau khi \u0103n", "U\u1ed0NG 1 VI\u00caN M\u1ed6I S\u00c1NG", "Vietnamese uppercase quote");
A("\u1260\u1240\u1295 \u1201\u1208\u1275 \u130a\u12dc \u12ed\u12cd\u1230\u12f1", "\u1201\u1208\u1275 \u130a\u12dc", "Amharic");
A("\u6bcf\u5929\u65e9\u4e0a\u670d\u7528\u4e00\u7247\u836f", "\u670d\u7528\u4e00\u7247", "Chinese");
A("\u6bcf\u5929\u65e9\u4e0a\u670d\u7528\u4e00\u7247\u836f", "\u670d\u7528\u4e8c\u7247", "Chinese changed number");
A("STRASSE \u1e9e", "strasse \u00df", "capital sharp s");
A("\u0130la\u00e7 g\u00fcnde iki kez", "ila\u00e7 g\u00fcnde", "Turkish dotted capital I vs plain i");
A("\u0130la\u00e7 g\u00fcnde iki kez", "g\u00fcnde iki kez", "Turkish dotted capital I, offsets after it");
A("\u0130\u0130\u0130 abc", "abc", "three dotted capital I, match at the very end");
A("\u0130 take 1 tablet daily with food", "take 1 tablet", "dotted capital I early, match mid-text");
A("\u039f\u0394\u039f\u03a3 \u039a\u0391\u0399", "\u03bf\u03b4\u03bf\u03c2", "Greek final sigma in quote only");
A("\u039f\u0394\u039f\u03a3 \u039a\u0391\u0399", "\u039f\u0394\u039f\u03a3", "Greek uppercase on both sides");
A("\u039f\u0394\u039f\u03a3 \u039a\u0391\u0399", "\u03bf\u03b4\u03bf\u03c3", "Greek medial sigma");
A("\u03bf\u03b4\u03bf\u03c2 \u03ba\u03b1\u03b9", "\u039f\u0394\u039f\u03a3", "Greek lowercase final sigma in source, capitals in quote");
A("\u03a3\u03a3 \u03b4\u03cc\u03c3\u03b7", "\u03c3\u03c2 \u03b4\u03cc\u03c3\u03b7", "Greek sigma pair");
A("\u{1D400}\u{10400} x", "\u{1D400}\u{10428} x", "math bold A (no case) next to a Deseret capital");
A("Dose İ 5 mg", "̇ 5 mg", "match starting inside the U+0130 expansion (must refuse)");
A("Dose İ 5 mg", "Dose i", "match ending inside the U+0130 expansion (must refuse)");
A("İlaç", "̇laç", "word starting inside the U+0130 expansion (must refuse)");
A("İ 5 mg, then ̇ 5 mg", "̇ 5 mg", "unaligned occurrence first, aligned one later");
A("Dose İ 5 mg", "İ 5 MG", "whole U+0130 on both sides");
A("\u{10400}\u{10401} dose", "\u{10428}\u{10429} dose", "Deseret capitals in source, small letters in quote");
A("\u{10400}\u{10401} dose", "\u{10400}\u{10401} dose", "Deseret capitals on both sides");
A("take 1 tablet. take 1 tablet. take 1 tablet.", "take 1 tablet", "repeated substring");
A("take 1 tablet. take 1 tablet. take 1 tablet.", "take 1 tablet ... take 1 tablet ... take 1 tablet", "repeated with ellipses");
A("take 1 tablet. take 1 tablet.", "take 1 tablet ... take 1 tablet ... take 1 tablet", "more repeats than source");
A("", "take 1 tablet", "empty source");
A("", "", "both empty");
A("take 1 tablet", "", "empty quote");
A("take 1 tablet", "   \n\t ", "whitespace-only quote");
A("   \n\t ", "   ", "whitespace-only both");
A("take 1 tablet", "...", "ellipsis-only quote");
A("take 1 tablet", "\u2026", "unicode ellipsis only");
A("take 1 tablet", "take 1 tablet daily with food and water", "quote longer than source");
A("metformin 500 mg", "form", "mid-word");
A("metformin 500 mg", "tformin 50", "mid-word both ends");
A("metformin 500 mg", '"metformin 500 mg"', "quote wrapped in quotes");
A("metformin 500 mg", "\u2018metformin 500 mg\u2019", "quote wrapped in curly single quotes");
A("\u2022 metformin 500 mg \u25cf daily", "metformin 500 mg daily", "bullets in source");
A("metformin 500 mg daily", "\u2022 metformin \u00b7 500 mg", "bullets in quote");
A("take 1 tablet then rest", "....take 1 tablet", "four dots");
A("take 1 tablet then rest", "take...1 tablet", "ellipsis splits short fragment");
A("take 1 tablet then rest", "take 1 tablet\u2026then rest", "unicode ellipsis between fragments");
A("take 1 tablet then rest", "a...b...c", "only short fragments");
A("take 1 tablet then rest", "tak...ablet", "3-unit fragments");
A("Dose ꟎ daily", "꟏ daily", "Unicode 17.0 case pair (U+A7CE/U+A7CF), differs on older Unicode");
A("꟎Ꟑ dose", "꟏ꟑ dose", "Latin Extended-D case pairs from Unicode 14.0 and 17.0 in one word");
A("Take a seat.", "Take ... 5 ... mg", "invented dose in short ellipsis fragments (must refuse)");
A("Take 1 tablet by mouth daily.", "Take 1 tablet ... daily", "legit ellipsis quote (must pass)");
A("Take 1 tablet by mouth daily.", "... Take 1 tablet ...", "leading and trailing ellipsis");
A("Take 1 tablet by mouth daily.", "Take 1 tablet ...... daily", "double ellipsis leaves an empty middle fragment");
A("take 1 tablet\r\nthen rest", "tablet then", "CRLF");
A("take 1 tablet\u0085then rest", "tablet then", "NEL is not JS whitespace");
A("take 1 tablet\u0085then rest", "tablet\u0085then", "NEL on both sides");
A("take 1 tablet\ufeffthen rest", "tablet then", "BOM is JS whitespace");
A("take 1 tablet\u200bthen rest", "tablet then", "zero-width space is not whitespace");
A("take 1 tablet\u3000then rest", "tablet then", "ideographic space");
A("take 1 tablet\u2028then rest", "tablet then", "line separator");
A("Dose:   5mg   ", "dose: 5mg", "trailing spaces in source");
A("  leading spaces then text", "leading spaces", "leading spaces in source");
A("Take 1 tablet.", "Take 1 tablet. ", "trailing space in quote");
A("Take \u2033two\u2033 drops", '"two" drops', "double prime");
A("Take \u2032two\u2032 drops", "'two' drops", "prime");
A("x".repeat(500) + " needle " + "y".repeat(500), "needle", "long source");
A("\u00c9TAPE 1 : prendre 1 comprim\u00e9", "\u00e9tape 1 : prendre", "French accented capital");
A("D\u00f9ng 2 l\u1ea7n m\u1ed7i ng\u00e0y", "d\u00d9ng 2 l\u1ea6n", "Vietnamese mixed case");

// 6. Seeded fuzz: random substrings of real sources with case, whitespace, quote, dash, ellipsis and insert edits.
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEED = 20261002;
const rnd = mulberry32(SEED);
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const WS = ["  ", "\n", "\u00a0", "\t \n", "\u3000", "\r\n", "\ufeff"];
const DASHES = ["\u2010", "\u2013", "\u2014", "\u2015", "\u2212"];
const INSERTS = ["\u{1F48A}", "\u0130", "\u00f1", "\u1201", "\u670d", "\u00e9", "\u2022", "\u2026", "...", "\u039f\u03a3", "x"];
const MUTATIONS = [
  (s) => s.toUpperCase(),
  (s) => s.toLowerCase(),
  (s) => s.replace(/ /g, () => (rnd() < 0.3 ? pick(WS) : " ")),
  (s) => s.replace(/'/g, "\u2019").replace(/"/g, "\u201c"),
  (s) => s.replace(/-/g, () => pick(DASHES)),
  (s) => {
    const sp = [...s.matchAll(/ /g)].map((m) => m.index);
    if (!sp.length) return s;
    const at = pick(sp);
    return s.slice(0, at) + pick([" ... ", "\u2026", "..."]) + s.slice(at + 1);
  },
  (s) => {
    const cps = Array.from(s);
    if (cps.length < 2) return s;
    cps.splice(Math.floor(rnd() * cps.length), 1);
    return cps.join("");
  },
  (s) => {
    const cps = Array.from(s);
    cps.splice(Math.floor(rnd() * (cps.length + 1)), 0, pick(INSERTS));
    return cps.join("");
  },
  (s) => {
    const parts = s.split(" ");
    if (parts.length < 4) return s;
    const mid = Math.floor(parts.length / 2);
    return `${parts.slice(mid).join(" ")} ... ${parts.slice(0, mid).join(" ")}`;
  },
  (s) => `"${s}"`,
];
const sourceIds = [...sources.keys()];
const FUZZ = 600;
for (let n = 0; n < FUZZ; n++) {
  const id = pick(sourceIds);
  const cps = Array.from(sources.get(id));
  const len = 3 + Math.floor(rnd() * 60);
  const start = Math.floor(rnd() * Math.max(1, cps.length - len));
  let q = cps.slice(start, start + len).join("");
  const edits = Math.floor(rnd() * 3);
  for (let k = 0; k < edits; k++) q = pick(MUTATIONS)(q);
  add(`fuzz (${edits} edits)`, id, q);
}

// ---------- compare ----------
const enc = (r) => (r === null ? null : [r.start === undefined ? "undefined" : r.start, Number.isNaN(r.end) ? "NaN" : r.end]);
const resolveSource = (s) => (typeof s === "string" ? sources.get(s) : s.inline);
const mismatches = [];
const out = [];
let found = 0, refused = 0, oddOffsets = 0;
for (const [i, c] of cases.entries()) {
  const src = resolveSource(c.source);
  const a = enc(ts.findSpan(src, c.quote));
  const b = enc(rust.findSpan(src, c.quote));
  const same = JSON.stringify(a) === JSON.stringify(b);
  if (!same) mismatches.push({ what: "findSpan", case: i, origin: c.origin, source: c.source, quote: c.quote, ts: a, rust: b });
  if (a === null) refused++;
  else {
    found++;
    if (typeof a[0] !== "number" || typeof a[1] !== "number") oddOffsets++;
  }
  out.push({ i, origin: c.origin, source: c.source, quote: c.quote, span: a, same });
}

// Outcomes that must hold in BOTH implementations, not just agree.
const MUST = [
  ["Take a seat.", "Take ... 5 ... mg", false],
  ["Take 1 tablet by mouth daily.", "Take 1 tablet ... daily", true],
  ["\u039f\u0394\u039f\u03a3 \u039a\u0391\u0399", "\u039f\u0394\u039f\u03a3", true],
  ["\u{10400}\u{10401} dose", "\u{10400}\u{10401} dose", true],
  ["Dose İ 5 mg", "̇ 5 mg", false],
  ["Dose İ 5 mg", "Dose i", false],
  // At the request limits (20,000-character source, 600-character quote): an unaligned occurrence at every odd
  // position and none aligned. The old search re-compared the whole quote at each one, O(source * quote).
  ["\u0130".repeat(20000), "\u0307i".repeat(300), false],
];
// Exact spans that must hold in both (the U+0130 map shift used to break these).
const MUST_SPAN = [
  ["\u0130la\u00e7 g\u00fcnde iki kez", "g\u00fcnde iki kez", 5, 18],
  ["\u0130\u0130\u0130 abc", "abc", 4, 7],
  ["\u0130 take 1 tablet daily with food", "take 1 tablet", 2, 15],
  ["\u0130 5 mg, then \u0307 5 mg", "\u0307 5 mg", 13, 19],
  // The one aligned occurrence comes after ~20,000 unaligned ones.
  ["\u0130".repeat(20000) + " \u0307" + "\u0130".repeat(299), "\u0307i".repeat(299) + "\u0307", 20001, 20301],
];
for (const [src, q, s0, e0] of MUST_SPAN) {
  for (const [name, impl] of [["ts", ts], ["rust", rust]]) {
    const r = impl.findSpan(src, q);
    if (!r || r.start !== s0 || r.end !== e0) mismatches.push({ what: "must span", impl: name, source: src, quote: q, got: r, expected: [s0, e0] });
  }
}
for (const [src, q, found] of MUST) {
  for (const [name, impl] of [["ts", ts], ["rust", rust]]) {
    if ((impl.findSpan(src, q) !== null) !== found) mismatches.push({ what: "must", impl: name, source: src, quote: q, expected_found: found });
  }
}

const strings = new Set();
for (const s of sources.values()) strings.add(s);
for (const c of cases) {
  strings.add(c.quote);
  if (typeof c.source !== "string") strings.add(c.source.inline);
}
let normalizeChecked = 0, fakesChecked = 0;
for (const s of strings) {
  normalizeChecked++;
  const a = ts.normalize(s), b = rust.normalize(s);
  if (a !== b) mismatches.push({ what: "normalize", input: s, ts: a, rust: b });
  fakesChecked++;
  const fa = tsChecker.fakesFor(s), fb = rust.fakesFor(s);
  if (!isDeepStrictEqual(fa, fb)) mismatches.push({ what: "fakesFor", input: s, ts: fa, rust: fb });
}

// Differential test of the changed-number fake (String(Number(x) * 10)) over high-precision decimal strings, where
// shortest-digit ties and exponent switches live. Seeded; the inputs are not stored, only counted.
const numRnd = mulberry32(SEED + 1);
const digitsOf = (len) => Array.from({ length: len }, () => Math.floor(numRnd() * 10)).join("");
const numberInputs = [
  "991294491764.48132665", // the case that exposed Rust's round-half-up tie
  "0.07", "1.005", "99999999999999999999", "100000000000000000000", "0.0000001", "0.000001", "1e5",
  "123456789012345678901234567890", "0.00000000000000000000123", "9007199254740993", "4.35",
];
for (let n = 0; n < 3000; n++) {
  const shape = numRnd();
  let s;
  if (shape < 0.15) s = `0.${"0".repeat(Math.floor(numRnd() * 12))}${digitsOf(1 + Math.floor(numRnd() * 20))}`;
  else if (shape < 0.3) s = digitsOf(15 + Math.floor(numRnd() * 15)); // around and past the 1e21 switch
  else s = `${digitsOf(1 + Math.floor(numRnd() * 18))}.${digitsOf(1 + Math.floor(numRnd() * 22))}`;
  numberInputs.push(s);
}
let numberChecked = 0;
for (const x of numberInputs) {
  numberChecked++;
  const s = `take ${x} mg`;
  const fa = tsChecker.fakesFor(s), fb = rust.fakesFor(s);
  if (!isDeepStrictEqual(fa, fb)) mismatches.push({ what: "fakesFor (number)", input: s, ts: fa, rust: fb });
}

let checkerReport = { compared: false };
if (native) {
  const tsReport = tsChecker.runCheckerTest();
  const raw = execFileSync("cargo", ["run", "-q", "-j", "2", "--example", "checker_report", "--manifest-path", fileURLToPath(new URL("Cargo.toml", CRATE))], { encoding: "utf8" });
  const rustReport = JSON.parse(raw);
  const equal = isDeepStrictEqual(tsReport, rustReport);
  if (!equal) mismatches.push({ what: "runCheckerTest", ts: tsReport, rust: rustReport });
  checkerReport = {
    compared: true,
    equal,
    papers: tsReport.papers,
    real: { total: tsReport.real.total, accepted: tsReport.real.accepted },
    fakes: { total: tsReport.fakes.total, caught: tsReport.fakes.caught, slipped: tsReport.fakes.slipped.length },
    skipped: tsReport.skipped,
  };
}

const byOrigin = {};
for (const c of out) {
  const key = c.origin.startsWith("adversarial") ? "adversarial" : c.origin.startsWith("fuzz") ? "fuzz" : c.origin.startsWith("papers fake") ? "papers fake" : c.origin;
  byOrigin[key] = (byOrigin[key] ?? 0) + 1;
}
const report = {
  about: "TS checker (web/src/lib/verify.ts, checkerTest.ts) vs Rust checker (core/atlas-verify, WebAssembly). Spans are [start, end] in UTF-16 units; \"undefined\"/\"NaN\" would mark a non-numeric offset (none expected since the U+0130 fix).",
  fuzz_seed: SEED,
  unicode_version: UNICODE.node,
  totals: {
    find_span_cases: cases.length,
    found,
    refused,
    found_with_unusable_ts_offsets: oddOffsets,
    normalize_checked: normalizeChecked,
    fakes_for_checked: fakesChecked,
    fakes_for_number_checked: numberChecked,
    mismatches: mismatches.length,
  },
  cases_by_origin: byOrigin,
  checker_report: checkerReport,
  mismatches,
  sources: Object.fromEntries(sources),
  cases: out,
};
writeFileSync(outPath, `${JSON.stringify(report, null, 1)}\n`);
console.log(JSON.stringify({ wasm: wasmPath, ...report.totals, checker_report: checkerReport }, null, 1));
process.exit(mismatches.length === 0 ? 0 : 1);
