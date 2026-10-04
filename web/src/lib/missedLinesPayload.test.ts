import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { verifyItems } from "./verify";
import { missedFromPayload, missedLinesAnnouncement, missedLinesPayload, missedLinesPayloadValid, missedLinesView, type MissedLinesPayload } from "./missedLines";
import { SAMPLE_AVS } from "./sample";
import type { CareItem, CarePlanResponse, VerifiedItem } from "./schema";
import type { CoverageItem } from "./coverage";
import papersFile from "../data/eval/papers.json";

/**
 * The phone apps rebuild the "Lines on your paper we didn't turn into steps" section from `missed_lines`
 * and the ids of the steps still kept. That is only safe if it equals the website's own check for EVERY
 * set of removed steps, so this file checks exactly that: all subsets when a plan has <= 10 items, else
 * 200 seeded random subsets.
 */

type Item = CoverageItem & { id: string };
const papers = (papersFile as { papers: { id: string; text: string; expected: string[] }[] }).papers;

const base: Omit<CareItem, "source_quote"> = { kind: "self_care", title: "t", plain_language: "p", why: "", when: "", needs_clarification: false, question_for_clinic: "" };
function kept(source: string, quotes: string[]): VerifiedItem[] {
  const { kept: k } = verifyItems(source, quotes.map((q) => ({ ...base, source_quote: q })));
  return k;
}

/** Seeded PRNG (mulberry32) so a failure always reproduces. */
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

/** Every kept-subset to try: all of them for n <= 10, else 200 seeded random ones plus "all" and "none". */
function keptSubsets(items: Item[], seed = 1): Item[][] {
  const n = items.length;
  if (n <= 10) return Array.from({ length: 1 << n }, (_, mask) => items.filter((_, i) => mask & (1 << i)));
  const r = rng(seed);
  const out = [items, []];
  for (let k = 0; k < 200; k++) out.push(items.filter(() => r() < 0.5));
  return out;
}

let checked = 0;
/** Compares the payload route with the website's check for every subset; returns how many subsets were checked. */
function assertEquivalent(name: string, source: string, items: Item[], seed = 1): number {
  // Through JSON, exactly as a phone receives it.
  const payload = JSON.parse(JSON.stringify(missedLinesPayload(source, items))) as MissedLinesPayload;
  const subsets = keptSubsets(items, seed);
  for (const keep of subsets) {
    const want = missedLinesView(source, keep);
    const ids = keep.map((i) => i.id);
    expect(missedFromPayload(payload, ids), `${name} kept=[${ids.join(",")}]`).toEqual(want);
    // A real payload is always within its paper, so the bound never changes the answer.
    expect(missedFromPayload(payload, ids, source.length), `${name} kept=[${ids.join(",")}] bounded`).toEqual(want);
  }
  checked += subsets.length;
  return subsets.length;
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

describe("missed_lines payload equals the website's check for every removal set", () => {
  it("the existing English and Spanish fixtures, and a bilingual paper", () => {
    assertEquivalent("en", EN_PAPER, kept(EN_PAPER, [...EN_PAPER.split("\n").slice(1), "Take 1 tablet of metformin 500 mg"]));
    assertEquivalent("es", ES_PAPER, kept(ES_PAPER, [...ES_PAPER.split("\n").slice(1), "Tome 1 tableta de metformina 500 mg"]));
    const both = `${EN_PAPER}\n\n${ES_PAPER}`;
    assertEquivalent("en+es", both, kept(both, ["STOP ibuprofen 200 mg tablet.", "No tome ibuprofeno porque puede dañar los riñones.", "Call 911 if you have chest pain"]));
  });

  it("every eval paper, with its expected quotes as the plan (all 2^n subsets)", () => {
    for (const p of papers) {
      const items = kept(p.text, p.expected);
      expect(items.length, p.id).toBe(p.expected.length);
      expect(items.length, p.id).toBeLessThanOrEqual(10);
      expect(assertEquivalent(p.id, p.text, items), p.id).toBe(2 ** items.length);
    }
  });

  it("the sample paper, quoted line by line (more than 10 items: 200 seeded subsets)", () => {
    const lines = SAMPLE_AVS.split("\n").map((l) => l.trim()).filter((l) => l.length > 8);
    const items = kept(SAMPLE_AVS, lines);
    expect(items.length).toBeGreaterThan(10);
    expect(assertEquivalent("sample", SAMPLE_AVS, items, 7)).toBe(202);
  });

  it("the real /api/extract response the phone apps' tests replay (12 model-written items)", () => {
    const live = JSON.parse(
      readFileSync(join(process.cwd(), "..", "mobile", "ios", "ATLASTests", "Fixtures", "extract_sample_live.json"), "utf8"),
    ) as CarePlanResponse;
    expect(live.items.length).toBe(12);
    expect(assertEquivalent("live", live.source_text, live.items, 11)).toBe(202);
    // The response fixture predates the field; built now, it must still show lines for this plan.
    expect(missedLinesPayload(live.source_text, live.items).show).toBe(true);
  });

  it("a number covered only by two quotes together (why the payload is ranges, not a per-item list)", () => {
    const paper = "Instructions\nTake 1 tablet for 10 days.\nCall 911 if you have chest pain.";
    const at = paper.indexOf("10 days");
    const lineStart = paper.indexOf("Take");
    // A ends between the "1" and the "0" of "10"; B starts there. Neither alone holds the whole number.
    const a: Item = { id: "a", source_quote: paper.slice(lineStart, at + 1), span: { start: lineStart, end: at + 1 } };
    const b: Item = { id: "b", source_quote: paper.slice(at + 1, at + 7), span: { start: at + 1, end: at + 7 } };
    const target = "Take 1 tablet for 10 days.";
    const missed = (keep: Item[]) => missedLinesView(paper, keep).show && (missedLinesView(paper, keep) as { lines: { text: string }[] }).lines.map((l) => l.text);
    expect(missed([a])).toContain(target);
    expect(missed([b])).toContain(target);
    expect(missed([a, b])).not.toContain(target);
    assertEquivalent("joined", paper, [a, b]);
  });

  it("a line printed twice is covered by a quote of either copy", () => {
    const paper = "Call 911 if you have chest pain.\nTake 1 tablet daily.\nCall 911 if you have chest pain.";
    const items = kept(paper, ["Call 911 if you have chest pain.", "Take 1 tablet daily."]);
    const all = missedLinesView(paper, items);
    expect(all).toMatchObject({ show: true, total: 3, covered: 3 });
    assertEquivalent("twice", paper, items);
    // Only the SECOND copy is quoted (a span the verifier could return for a repeated line): the first counts too.
    const second = paper.lastIndexOf("Call 911");
    const late: Item = { id: "late", source_quote: "Call 911 if you have chest pain.", span: { start: second, end: paper.length } };
    expect(missedLinesView(paper, [late])).toMatchObject({ show: true, total: 3, covered: 2 });
    assertEquivalent("twice-late", paper, [late, ...items]);
  });

  it("ellipsis quotes, items without a span, and an item that quotes nothing locatable", () => {
    const paper = "Take aspirin daily.\nDo not drive for 24 hours.\nCall clinic Monday to book a visit.";
    const items: Item[] = [
      { id: "e", source_quote: "Take aspirin daily. ... Call clinic Monday" },
      { id: "n", source_quote: "Do not drive for 24 hours." },
      { id: "x", source_quote: "This sentence is not on the paper at all." },
    ];
    const payload = missedLinesPayload(paper, items);
    if (!payload.show) throw new Error("expected show");
    expect(Object.keys(payload.quotes).sort()).toEqual(["e", "n"]);
    assertEquivalent("ellipsis", paper, items);
  });

  it("hidden states never depend on the kept steps", () => {
    const fr = "Prenez 1 comprimé de metformine 500 mg deux fois par jour avec les repas.\nSi vous avez une douleur dans la poitrine, appelez le 911.";
    const none = "Your diagnoses today are listed below. Your blood pressure was normal and the visit went well.";
    expect(missedLinesPayload("  \n", [])).toEqual({ show: false, why: "empty" });
    expect(missedLinesPayload(fr, kept(fr, ["Prenez 1 comprimé"]))).toEqual({ show: false, why: "unsupported_language" });
    expect(missedLinesPayload(none, [])).toEqual({ show: false, why: "no_instructions" });
    assertEquivalent("fr", fr, kept(fr, ["Prenez 1 comprimé", "appelez le 911"]));
    assertEquivalent("none", none, kept(none, ["Your blood pressure was normal"]));
  });

  it("random quote spans on every eval paper (fuzz, seeded)", () => {
    const r = rng(42);
    for (let round = 0; round < 60; round++) {
      const p = papers[round % papers.length];
      const n = 2 + Math.floor(r() * 7);
      const items: Item[] = Array.from({ length: n }, (_, i) => {
        const start = Math.floor(r() * p.text.length);
        const end = Math.min(p.text.length, start + 1 + Math.floor(r() * 60));
        return { id: `item-${i}`, source_quote: p.text.slice(start, end), span: { start, end } };
      });
      assertEquivalent(`fuzz-${round}`, p.text, items);
    }
    // Heavy (CPU-bound, 60 seeded rounds): fine alone, but under the full parallel suite on a small machine it has
    // crossed vitest's 5 s default. An explicit timeout, not fewer cases.
  }, 30_000);

  it("ignores unknown and repeated ids, and keeps the old view's line fields only", () => {
    const items = kept(EN_PAPER, ["STOP ibuprofen 200 mg tablet."]);
    const payload = missedLinesPayload(EN_PAPER, items);
    expect(missedFromPayload(payload, ["nope", "__proto__", items[0].id, items[0].id])).toEqual(missedLinesView(EN_PAPER, items));
    const v = missedFromPayload(payload, []);
    if (!v.show) throw new Error("expected show");
    for (const l of v.lines) expect(Object.keys(l).sort()).toEqual(["end", "reason", "start", "text"]);
  });

  it("checked a meaningful number of removal sets in total", () => {
    expect(checked).toBeGreaterThan(1000);
    console.info(`missed_lines equivalence: ${checked} removal sets checked`);
  });
});

describe("a malformed missed_lines payload is hidden, never shown as all covered", () => {
  type Shown = Extract<MissedLinesPayload, { show: true }>;
  type Sentence = Shown["sentences"][number];
  const sentence = (text: string, start: number, end: number, group: number, critical: [number, number][] = []): Sentence =>
    ({ text, start, end, reason: "imperative", critical, group });
  const one = sentence("Take 1 tablet for 10 days.", 0, 26, 0, [[5, 6], [18, 20]]);
  // The kept quote does not touch the sentence, so a valid payload always shows it as missed.
  const good: Shown = { show: true, languages: ["en"], quotes: { a: [[30, 40]] }, sentences: [one] };
  const hidden = { show: false, why: "invalid" };

  it("a valid payload still shows its line", () => {
    expect(missedLinesPayloadValid(good, 40)).toBe(true);
    expect(missedFromPayload(good, ["a"], 40)).toMatchObject({ show: true, total: 1, covered: 0 });
  });

  const bad: Record<string, unknown> = {
    "kept range [-1, 2147483647] overlaps everything": { ...good, quotes: { a: [[-1, 2147483647]] } },
    "one number": { ...good, quotes: { a: [[0]] } },
    "three numbers": { ...good, quotes: { a: [[0, 26, 30]] } },
    "start after end": { ...good, quotes: { a: [[26, 0]] } },
    "empty range": { ...good, quotes: { a: [[5, 5]] } },
    "fraction": { ...good, quotes: { a: [[0.5, 26]] } },
    "string offsets": { ...good, quotes: { a: [["0", "26"]] } },
    "past the paper": { ...good, quotes: { a: [[0, 41]] } },
    "ranges not a list": { ...good, quotes: { a: "0-26" } },
    "an unkept item's bad range still poisons the payload": { ...good, quotes: { ...good.quotes, z: [[-1, 2]] } },
    "no sentences": { ...good, sentences: [] },
    "sentence end before start": { ...good, sentences: [{ ...one, start: 26, end: 0 }] },
    "sentence negative": { ...good, sentences: [{ ...one, start: -1 }] },
    "sentence past the paper": { ...good, sentences: [{ ...one, end: 41 }] },
    "critical outside its sentence": { ...good, sentences: [{ ...one, critical: [[30, 35]] }] },
    "critical one number": { ...good, sentences: [{ ...one, critical: [[17]] }] },
    "critical reversed": { ...good, sentences: [{ ...one, critical: [[19, 17]] }] },
    "group out of range": { ...good, sentences: [{ ...one, group: 1 }] },
    "group negative": { ...good, sentences: [{ ...one, group: -1 }] },
    "group points forward": { ...good, sentences: [one, sentence("Call 911.", 27, 36, 2), sentence("Call 911.", 37, 40, 2)] },
    "group points at a non-first sentence": { ...good, sentences: [one, sentence("Call 911.", 27, 36, 0), sentence("Take 1 tablet for 10 days.", 37, 40, 1)] },
    "an unrelated line put in another line's group": { ...good, sentences: [one, sentence("Call 911 if you have chest pain.", 27, 40, 0)] },
    "a language that is not a string": { ...good, languages: [1] },
  };

  it("a repeat that differs only by case, spacing or punctuation stays in its group", () => {
    const repeat: Shown = { ...good, sentences: [one, sentence("TAKE 1 tablet  for 10 days. ", 27, 40, 0)] };
    expect(missedLinesPayloadValid(repeat, 40)).toBe(true);
  });

  it("an offset that does not fit the phone apps' 32-bit integers is refused even without a paper length", () => {
    expect(missedLinesPayloadValid({ ...good, quotes: { a: [[0, 4294967296]] } })).toBe(false);
    expect(missedLinesPayloadValid({ ...good, quotes: { a: [[0, 2147483647]] } })).toBe(true);
  });

  it.each(Object.keys(bad))("%s", (name) => {
    const p = bad[name] as MissedLinesPayload;
    expect(missedLinesPayloadValid(p, 40)).toBe(false);
    for (const kept of [["a"], ["a", "z"], []]) {
      const v = missedFromPayload(p, kept, 40);
      expect(v).toEqual(hidden);
      expect(missedLinesAnnouncement(v)).toBe("");
    }
  });

  it("without a known paper length, [-1, 2147483647] is still refused; with one, [0, MAX] is too", () => {
    expect(missedFromPayload(bad["kept range [-1, 2147483647] overlaps everything"] as MissedLinesPayload, ["a"])).toEqual(hidden);
    expect(missedFromPayload({ ...good, quotes: { a: [[0, 2147483647]] } }, ["a"], 40)).toEqual(hidden);
  });
});
