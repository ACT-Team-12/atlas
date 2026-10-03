/**
 * Generates mobile/shared/missed-lines-vectors.json: the web reference for the "Lines on your paper we
 * didn't turn into steps" check, as JSON vectors the Android (and later iOS) unit tests replay.
 *
 * Not part of the web suite. To regenerate, on a checkout where web/src/lib/missedLines.ts exports
 * missedLinesPayload / missedFromPayload / missedLinesView (PR 66 and later):
 *   cp mobile/shared/genMissedLinesVectors.test.ts web/src/lib/
 *   cd web && VECTORS_OUT=../mobile/shared/missed-lines-vectors.json pnpm exec vitest run src/lib/genMissedLinesVectors.test.ts
 *   rm src/lib/genMissedLinesVectors.test.ts
 *
 * Every expected value is the website's own check (missedLinesView over the kept items), and the generator
 * also asserts the reference client (missedFromPayload) agrees, so the file cannot encode a disagreement.
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

/** All subsets when n <= 7, else "all", "none" and 58 seeded random subsets (n = 8 in full would push the file past ~300 KB). */
function subsets(items: Item[], seed: number): Item[][] {
  const n = items.length;
  if (n <= 7) return Array.from({ length: 1 << n }, (_, mask) => items.filter((_, i) => mask & (1 << i)));
  const r = rng(seed);
  const out: Item[][] = [items, []];
  for (let k = 0; k < 58; k++) out.push(items.filter(() => r() < 0.5));
  return out;
}

const expected = (v: MissedLinesView) =>
  v.show
    ? { show: true, languages: v.languages, total: v.total, covered: v.covered, lines: v.lines.map((l) => l.text) }
    : { show: false, why: v.why };

const fixtures: unknown[] = [];
function add(name: string, source: string, items: Item[], seed = 1, extraKept: string[][] = []) {
  const payload = JSON.parse(JSON.stringify(missedLinesPayload(source, items))) as MissedLinesPayload;
  const cases = subsets(items, seed).map((keep) => {
    const ids = keep.map((i) => i.id);
    const want = missedLinesView(source, keep);
    expect(missedFromPayload(payload, ids), `${name} [${ids}]`).toEqual(want);
    return { kept: ids, expected: expected(want) };
  });
  // Odd kept lists a phone can send: unknown ids, repeats. Expected is the web check over the real items named.
  for (const ids of extraKept) {
    const want = missedLinesView(source, items.filter((i) => ids.includes(i.id)));
    expect(missedFromPayload(payload, ids)).toEqual(want);
    cases.push({ kept: ids, expected: expected(want) });
  }
  fixtures.push({ name, payload, cases });
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

  const out = process.env.VECTORS_OUT;
  if (!out) throw new Error("set VECTORS_OUT");
  const doc = {
    about: "Web reference vectors for missed_lines (web/src/lib/missedLines.ts missedFromPayload). Expected = missedLinesView over the kept items. Regenerate: see mobile/shared/README.md.",
    fixtures,
  };
  writeFileSync(out, JSON.stringify(doc) + "\n");
});
