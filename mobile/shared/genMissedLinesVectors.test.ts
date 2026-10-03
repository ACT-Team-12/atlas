/**
 * Generates mobile/shared/missed-lines-vectors.json: the web reference for the "Lines on your paper we
 * didn't turn into steps" check, as JSON vectors the Android (and later iOS) unit tests replay.
 *
 * Not part of the web suite. CI regenerates it with mobile/shared/check-vectors.sh (web-ci) and fails when the
 * committed file differs, so web drift cannot stay green. To regenerate by hand, on a checkout where
 * web/src/lib/missedLines.ts exports missedLinesPayload / missedFromPayload / missedLinesView (PR 66 and later):
 *   cp mobile/shared/genMissedLinesVectors.test.ts web/src/lib/
 *   cd web && VECTORS_OUT=../mobile/shared/missed-lines-vectors.json pnpm exec vitest run src/lib/genMissedLinesVectors.test.ts
 *   rm src/lib/genMissedLinesVectors.test.ts
 *
 * Every expected value is the website's own check (missedLinesView over the kept items), and the generator
 * also asserts the reference client (missedFromPayload) agrees, with and without the paper's length as the
 * bound, so the file cannot encode a disagreement. The "malformed:" fixtures are the one exception: they have
 * no paper, and their expected value is the reference client's own answer (hidden as "invalid").
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { verifyItems } from "./verify";
import { missedFromPayload, missedLinesPayload, missedLinesView, type MissedLinesPayload, type MissedLinesView } from "./missedLines";
import { SAMPLE_AVS } from "./sample";
import type { CareItem, CarePlanResponse } from "./schema";
import type { CoverageItem } from "./coverage";
import papersFile from "../data/eval/papers.json";

type Item = CoverageItem & { id: string };
const papers = (papersFile as { papers: { id: string; text: string; expected: string[] }[] }).papers;
const base: Omit<CareItem, "source_quote"> = { kind: "self_care", title: "t", plain_language: "p", why: "", when: "", needs_clarification: false, question_for_clinic: "" };
const kept = (source: string, quotes: string[]): Item[] => verifyItems(source, quotes.map((q) => ({ ...base, source_quote: q }))).kept;

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** All subsets when n <= 7, else "all", "none" and `random` seeded random subsets (n = 8 in full would push the file past ~300 KB). */
function subsets(items: Item[], seed: number, random = 58): Item[][] {
  const n = items.length;
  if (n <= 7) return Array.from({ length: 1 << n }, (_, mask) => items.filter((_, i) => mask & (1 << i)));
  const r = rng(seed);
  const out: Item[][] = [items, []];
  for (let k = 0; k < random; k++) out.push(items.filter(() => r() < 0.5));
  return out;
}

const expected = (v: MissedLinesView) =>
  v.show
    ? { show: true, languages: v.languages, total: v.total, covered: v.covered, lines: v.lines.map((l) => l.text) }
    : { show: false, why: v.why };

const fixtures: unknown[] = [];
function add(name: string, source: string, items: Item[], seed = 1, extraKept: string[][] = [], random = 58) {
  const payload = JSON.parse(JSON.stringify(missedLinesPayload(source, items))) as MissedLinesPayload;
  const check = (ids: string[], want: MissedLinesView) => {
    expect(missedFromPayload(payload, ids), `${name} [${ids}]`).toEqual(want);
    expect(missedFromPayload(payload, ids, source.length), `${name} [${ids}] bounded`).toEqual(want);
    return { kept: ids, expected: expected(want) };
  };
  const cases = subsets(items, seed, random).map((keep) => check(keep.map((i) => i.id), missedLinesView(source, keep)));
  // Odd kept lists a phone can send: unknown ids, repeats. Expected is the web check over the real items named.
  for (const ids of extraKept) cases.push(check(ids, missedLinesView(source, items.filter((i) => ids.includes(i.id)))));
  fixtures.push({ name, source_length: source.length, payload, cases });
}

/** A payload that breaks one validation rule: every client must hide it, whichever steps are kept. */
function addMalformed(name: string, payload: unknown, sourceLength: number) {
  const p = payload as MissedLinesPayload;
  const ids = p.show ? Object.keys(p.quotes) : [];
  const cases = [ids, [], [...ids, "nope"]].map((kept) => {
    const got = missedFromPayload(p, kept, sourceLength);
    expect(got, name).toEqual({ show: false, why: "invalid" });
    return { kept, expected: expected(got) };
  });
  fixtures.push({ name: `malformed:${name}`, source_length: sourceLength, payload, cases });
}

/**
 * Deterministic random papers for the differential cases the hand-written fixtures do not reach: many
 * instruction lines (some printed more than once, so groups repeat), and quotes that run across line ends
 * (multi-range merges), touch each other, skip a line with an ellipsis, or stop short of a number.
 */
const POOL = [
  "Take 1 tablet of lisinopril 10 mg every morning.",
  "Take 2 capsules of amoxicillin 500 mg three times a day for 10 days.",
  "Do not drive for 24 hours after the procedure.",
  "Stop taking ibuprofen 200 mg until your next visit.",
  "Call 911 if you have chest pain or trouble breathing.",
  "Return to the clinic in 2 weeks for a blood test.",
  "Avoid alcohol while you take this medicine.",
  "Drink 8 glasses of water each day.",
  "Never take more than 4 doses in 24 hours.",
  "Check your blood sugar before each meal and at bedtime.",
  "Call the office at 404-555-0100 if your fever is over 101 F.",
  "Keep your arm in the sling for 6 weeks.",
  "Use the inhaler 2 puffs every 4 to 6 hours as needed.",
  "Walk for 30 minutes each day if you can.",
];
function randomPaper(seed: number): { source: string; items: Item[] } {
  const r = rng(seed);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const lines = ["Your instructions"];
  for (let i = 0, n = 12 + Math.floor(r() * 8); i < n; i++) lines.push(pick(POOL));
  const source = lines.join("\n");
  const starts: number[] = [];
  for (let i = 0, at = 0; i < lines.length; at += lines[i].length + 1, i++) starts.push(at);
  const line = (i: number) => ({ start: starts[i], end: starts[i] + lines[i].length });
  const items: Item[] = [];
  const quote = (start: number, end: number) => {
    if (end > start) items.push({ id: `q${items.length}`, source_quote: source.slice(start, end), span: { start, end } });
  };
  for (let k = 0, n = 10 + Math.floor(r() * 5); k < n; k++) {
    const i = 1 + Math.floor(r() * (lines.length - 1));
    const l = line(i);
    const kind = Math.floor(r() * 5);
    if (kind === 0) quote(l.start, l.end); // the whole line
    else if (kind === 1 && i + 1 < lines.length) quote(l.start + Math.floor(r() * 10), line(i + 1).start + 12); // across a line end
    else if (kind === 2) { // two quotes that touch, splitting the line (and maybe a number) between them
      const cut = l.start + 1 + Math.floor(r() * (lines[i].length - 1));
      quote(l.start, cut); quote(cut, l.end);
    } else if (kind === 3 && i + 2 < lines.length) { // an ellipsis quote: this line ... the line after next
      const q = `${lines[i]} ... ${lines[i + 2]}`;
      items.push({ id: `q${items.length}`, source_quote: q }); // no span: placed fragment by fragment, as the server does
    } else quote(l.start, l.start + Math.floor(r() * lines[i].length)); // stops short, often before a number
  }
  return { source, items: items.map((it, n) => ({ ...it, id: `q${n}` })) };
}

const EN_PAPER = [
  "Medicines",
  "Take 1 tablet of metformin 500 mg by mouth two times a day with meals.",
  "STOP ibuprofen 200 mg tablet.",
  "Call 911 if you have chest pain or trouble breathing.",
  "Return to the clinic in 3 months for your follow-up visit.",
].join("\n");
const ES_PAPER = [
  "Medicamentos",
  "Tome 1 tableta de metformina 500 mg dos veces al día con las comidas.",
  "No tome ibuprofeno porque puede dañar los riñones.",
  "Si tiene dolor en el pecho, llame al 911 o vaya a la sala de emergencias.",
  "Regrese a la clínica en 3 meses para su cita de seguimiento con el médico.",
].join("\n");

it("writes the vectors", () => {
  const en = kept(EN_PAPER, [...EN_PAPER.split("\n").slice(1), "Take 1 tablet of metformin 500 mg"]);
  add("en", EN_PAPER, en, 1, [["nope", "__proto__", en[1].id, en[1].id]]);
  add("es", ES_PAPER, kept(ES_PAPER, [...ES_PAPER.split("\n").slice(1), "Tome 1 tableta de metformina 500 mg"]));
  const both = `${EN_PAPER}\n\n${ES_PAPER}`;
  add("en+es", both, kept(both, ["STOP ibuprofen 200 mg tablet.", "No tome ibuprofeno porque puede dañar los riñones.", "Call 911 if you have chest pain"]));

  for (const p of papers) add(`eval:${p.id}`, p.text, kept(p.text, p.expected));

  const lines = SAMPLE_AVS.split("\n").map((l) => l.trim()).filter((l) => l.length > 8);
  add("sample", SAMPLE_AVS, kept(SAMPLE_AVS, lines), 7);

  const live = JSON.parse(
    readFileSync(join(process.cwd(), "..", "mobile", "ios", "ATLASTests", "Fixtures", "extract_sample_live.json"), "utf8"),
  ) as CarePlanResponse;
  add("live-12-items", live.source_text, live.items as Item[], 11);

  const joined = "Instructions\nTake 1 tablet for 10 days.\nCall 911 if you have chest pain.";
  const at = joined.indexOf("10 days");
  const ls = joined.indexOf("Take");
  add("two-quotes-cover-one-number", joined, [
    { id: "a", source_quote: joined.slice(ls, at + 1), span: { start: ls, end: at + 1 } },
    { id: "b", source_quote: joined.slice(at + 1, at + 7), span: { start: at + 1, end: at + 7 } },
  ]);

  const twice = "Call 911 if you have chest pain.\nTake 1 tablet daily.\nCall 911 if you have chest pain.";
  const twiceItems = kept(twice, ["Call 911 if you have chest pain.", "Take 1 tablet daily."]);
  add("repeated-line", twice, twiceItems);
  const second = twice.lastIndexOf("Call 911");
  add("repeated-line-second-copy-quoted", twice, [
    { id: "late", source_quote: "Call 911 if you have chest pain.", span: { start: second, end: twice.length } },
    ...twiceItems,
  ]);

  const fr = "Prenez 1 comprimé de metformine 500 mg deux fois par jour avec les repas.\nSi vous avez une douleur dans la poitrine, appelez le 911.";
  add("hidden-unsupported-language", fr, kept(fr, ["Prenez 1 comprimé", "appelez le 911"]));
  const none = "Your diagnoses today are listed below. Your blood pressure was normal and the visit went well.";
  add("hidden-no-instructions", none, kept(none, ["Your blood pressure was normal"]));
  add("hidden-empty", "  \n", []);

  let multi = 0;
  for (let k = 1; k <= 6; k++) {
    const { source, items } = randomPaper(1000 + k);
    const payload = missedLinesPayload(source, items);
    if (payload.show) {
      multi += Object.values(payload.quotes).filter((r) => r.length > 1).length;
      expect(new Set(payload.sentences.map((x) => x.group)).size, `random-${k} repeats lines`).toBeLessThan(payload.sentences.length);
    }
    add(`random-${k}`, source, items, 2000 + k, [], 18);
  }
  expect(multi, "some random quotes are ellipsis quotes with more than one range").toBeGreaterThan(0);

  // Malformed payloads: one broken rule each, built from the English fixture.
  const en0 = JSON.parse(JSON.stringify(missedLinesPayload(EN_PAPER, en))) as Extract<MissedLinesPayload, { show: true }>;
  const L = EN_PAPER.length;
  const s0 = en0.sentences[0];
  const firstId = Object.keys(en0.quotes)[0];
  const withQuote = (r: unknown) => ({ ...en0, quotes: { ...en0.quotes, [firstId]: [r] } });
  const withSentence = (patch: object) => ({ ...en0, sentences: [{ ...s0, ...patch }, ...en0.sentences.slice(1)] });
  addMalformed("kept range [-1, 2147483647]", withQuote([-1, 2147483647]), L);
  addMalformed("range past the paper", withQuote([0, L + 1]), L);
  addMalformed("range start after end", withQuote([20, 10]), L);
  addMalformed("empty range", withQuote([10, 10]), L);
  addMalformed("range of one number", withQuote([10]), L);
  addMalformed("range of three numbers", withQuote([0, 10, 20]), L);
  addMalformed("no sentences", { ...en0, sentences: [] }, L);
  addMalformed("sentence end before start", withSentence({ start: s0.end, end: s0.start }), L);
  addMalformed("sentence past the paper", withSentence({ end: L + 5 }), L);
  addMalformed("critical outside its sentence", withSentence({ critical: [[s0.end, s0.end + 1]] }), L);
  addMalformed("group points forward", withSentence({ group: 1 }), L);
  addMalformed("group negative", withSentence({ group: -1 }), L);

  const out = process.env.VECTORS_OUT;
  if (!out) throw new Error("set VECTORS_OUT");
  const doc = {
    about: "Web reference vectors for missed_lines (web/src/lib/missedLines.ts missedFromPayload). Expected = missedLinesView over the kept items. Regenerate: see mobile/shared/README.md.",
    fixtures,
  };
  writeFileSync(out, JSON.stringify(doc) + "\n");
});
