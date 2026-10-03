import { beforeEach, describe, expect, it, vi } from "vitest";

// Wrap the real findSpan so the performance test can prove the check never searches for a quote
// when items already carry the verifier's spans.
vi.mock("./verify", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./verify")>();
  return { ...actual, findSpan: vi.fn(actual.findSpan) };
});

import { findSpan, verifyItems } from "./verify";
import { lineCountLabel, missedLinesView, missedLineTexts, paperLanguages } from "./missedLines";
import { SAMPLE_AVS } from "./sample";
import type { CareItem } from "./schema";
import papersFile from "../data/eval/papers.json";

const papers = (papersFile as { papers: { id: string; text: string; expected: string[] }[] }).papers;
const spy = vi.mocked(findSpan);
beforeEach(() => {
  spy.mockClear(); // braces: a returned function would run as teardown
});

/** Items as verifyItems returns them: each one with the span it found. */
function kept(source: string, quotes: string[]) {
  const base: Omit<CareItem, "source_quote"> = { kind: "self_care", title: "t", plain_language: "p", why: "", when: "", needs_clarification: false, question_for_clinic: "" };
  const { kept: k } = verifyItems(source, quotes.map((q) => ({ ...base, source_quote: q })));
  expect(k.length).toBe(quotes.length);
  return k;
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

const FR_PAPER = [
  "Médicaments",
  "Prenez 1 comprimé de metformine 500 mg deux fois par jour avec les repas.",
  "Arrêtez l'ibuprofène pour protéger vos reins.",
  "Si vous avez une douleur dans la poitrine, appelez le 911.",
  "Revenez à la clinique dans 3 mois pour votre visite de suivi.",
].join("\n");

const PT_PAPER = [
  "Medicamentos",
  "Tome 1 comprimido de metformina 500 mg duas vezes ao dia com as refeições.",
  "Pare o ibuprofeno para proteger os seus rins.",
  "Se você tiver dor no peito, ligue para o 911.",
  "Volte à clínica em 3 meses para a sua consulta de retorno com o médico.",
].join("\n");

const KO_PAPER = "약 복용 안내\n메트포르민 500 mg을 하루 두 번 식사와 함께 복용하세요.\n가슴 통증이 있으면 911에 전화하세요.";
const VI_PAPER = "Uống 1 viên metformin 500 mg hai lần mỗi ngày với bữa ăn.\nNếu bạn bị đau ngực, hãy gọi 911.\nTrở lại phòng khám sau 3 tháng.";
const AM_PAPER = "መድሃኒት በቀን ሁለት ጊዜ ይውሰዱ።\nየደረት ህመም ካለብዎት 911 ይደውሉ።";
const ZH_PAPER = "每天两次随餐服用二甲双胍500毫克。\n如果胸痛，请拨打911。";

describe("paperLanguages", () => {
  it("reads English papers, including the sample and every eval paper, as English", () => {
    expect(paperLanguages(EN_PAPER)).toEqual(["en"]);
    expect(paperLanguages(SAMPLE_AVS)).toEqual(["en"]);
    for (const p of papers) expect(paperLanguages(p.text), p.id).toContain("en");
  });

  it("reads a Spanish paper as Spanish, and a bilingual paper as both", () => {
    expect(paperLanguages(ES_PAPER)).toEqual(["es"]);
    expect(paperLanguages(`${EN_PAPER}\n\n${ES_PAPER}`)).toEqual(["en", "es"]);
  });

  it("refuses languages the check has no rules for", () => {
    for (const [name, text] of Object.entries({ FR_PAPER, PT_PAPER, KO_PAPER, VI_PAPER, AM_PAPER, ZH_PAPER })) {
      expect(paperLanguages(text), name).toBeNull();
    }
  });

  it("refuses an English paper with a real share of an unsupported language", () => {
    expect(paperLanguages(`${EN_PAPER}\n\n${FR_PAPER}`)).toBeNull();
    expect(paperLanguages(`${EN_PAPER}\n\n${KO_PAPER}`)).toBeNull();
  });

  it("refuses English papers that carry instructions in German, Italian or Somali, even a single line", () => {
    const de = "Nehmen Sie 1 Tablette zweimal täglich mit dem Essen.\nBei Brustschmerzen rufen Sie sofort 911 an und nehmen Sie kein Ibuprofen.";
    const it_ = "Prenda 1 compressa due volte al giorno per 10 giorni.\nNon prenda ibuprofene e chiami il 911 se ha dolore al petto.";
    const so = "Qaado 1 kiniin maalintii laba jeer iyo cunto.\nHaddii aad dareento xanuun laabta ka ah, wac 911 oo ha qaadan ibuprofen.";
    const header = "AFTER VISIT SUMMARY\nPatient instructions are listed below. Call the clinic with any problems.\n";
    for (const [name, other] of Object.entries({ de, it_, so })) {
      expect(paperLanguages(header + other), name).toBeNull();
      expect(paperLanguages(`${EN_PAPER}\n${other.split("\n")[1]}`), `${name} one line`).toBeNull();
    }
  });

  it("refuses a paper where several long sentences have no English or Spanish word at all", () => {
    const unlisted = "Ota yksi tabletti kahdesti päivässä ruoan kanssa.\nJos sinulla on rintakipua soita heti hätänumeroon.\nÄlä ota ibuprofeenia tämän lääkkeen kanssa koskaan.";
    expect(paperLanguages(`${EN_PAPER}\n${unlisted}`)).toBeNull();
  });

  it("refuses text too short or too bare to tell", () => {
    expect(paperLanguages("")).toBeNull();
    expect(paperLanguages("12/01/2026 404-555-0100")).toBeNull();
    expect(paperLanguages("Metformin 500 mg")).toBeNull();
  });
});

describe("missedLinesView", () => {
  it("zero uncovered: shows the section with no lines (the 'all covered' state)", () => {
    const lines = EN_PAPER.split("\n").slice(1);
    const v = missedLinesView(EN_PAPER, kept(EN_PAPER, lines));
    expect(v).toMatchObject({ show: true, languages: ["en"], total: 4, covered: 4, lines: [] });
    expect(missedLineTexts(v)).toEqual([]);
  });

  it("several uncovered: lists each one verbatim, in paper order, with offsets into the paper", () => {
    const v = missedLinesView(EN_PAPER, kept(EN_PAPER, ["Take 1 tablet of metformin 500 mg"]));
    if (!v.show) throw new Error("expected the section to show");
    expect(v.total).toBe(4);
    expect(v.covered).toBe(1);
    expect(missedLineTexts(v)).toEqual([
      "STOP ibuprofen 200 mg tablet.",
      "Call 911 if you have chest pain or trouble breathing.",
      "Return to the clinic in 3 months for your follow-up visit.",
    ]);
    for (const l of v.lines) expect(EN_PAPER.slice(l.start, l.end)).toBe(l.text);
  });

  it("no kept items at all: every instruction line is listed", () => {
    const v = missedLinesView(EN_PAPER, []);
    expect(missedLineTexts(v)).toHaveLength(4);
  });

  it("a Spanish paper is checked with the Spanish rules", () => {
    const v = missedLinesView(ES_PAPER, kept(ES_PAPER, ["Tome 1 tableta de metformina 500 mg"]));
    if (!v.show) throw new Error("expected the section to show");
    expect(v.languages).toEqual(["es"]);
    expect(missedLineTexts(v)).toContain("No tome ibuprofeno porque puede dañar los riñones.");
  });

  it("unsupported language hides the section, never claiming everything is covered", () => {
    for (const text of [FR_PAPER, PT_PAPER, KO_PAPER, VI_PAPER, AM_PAPER, ZH_PAPER]) {
      const v = missedLinesView(text, []);
      expect(v).toEqual({ show: false, why: "unsupported_language" });
      expect(missedLineTexts(v)).toEqual([]);
    }
  });

  it("an English paper with German instructions never reaches 'all covered'", () => {
    const paper = `${EN_PAPER}\nBei Brustschmerzen rufen Sie sofort 911 an und nehmen Sie kein Ibuprofen.`;
    const v = missedLinesView(paper, kept(paper, EN_PAPER.split("\n").slice(1)));
    expect(v).toEqual({ show: false, why: "unsupported_language" });
  });

  it("hides the section when the check finds no instruction-like line at all", () => {
    const text = "Your diagnoses today are listed below. Your blood pressure was normal and the visit went well.";
    expect(missedLinesView(text, [])).toEqual({ show: false, why: "no_instructions" });
    expect(missedLinesView("   \n ", [])).toEqual({ show: false, why: "empty" });
  });

  it("the sample paper with a plan that quotes only some lines names the rest", () => {
    const v = missedLinesView(SAMPLE_AVS, kept(SAMPLE_AVS, ["Take 1 tablet by mouth 2 times a day with meals."]));
    if (!v.show) throw new Error("expected the section to show");
    expect(v.lines.length).toBeGreaterThan(3);
    expect(missedLineTexts(v).some((t) => t.includes("ibuprofen"))).toBe(true);
  });

  it("performance path: items with spans never trigger a quote search, and a 20,000-character paper is fast", () => {
    const big = Array.from({ length: 300 }, (_, i) => `Take ${i + 1} tablets of medicine number ${i} every morning with a full glass of water.`).join("\n");
    expect(big.length).toBeGreaterThan(20_000);
    const items = kept(big, Array.from({ length: 150 }, (_, i) => `Take ${2 * i + 1} tablets of medicine number ${2 * i} every morning`));
    spy.mockClear();
    const t0 = performance.now();
    const v = missedLinesView(big, items);
    const ms = performance.now() - t0;
    expect(spy).not.toHaveBeenCalled();
    if (!v.show) throw new Error("expected the section to show");
    expect(v.total).toBe(300);
    expect(v.lines).toHaveLength(150);
    expect(ms).toBeLessThan(250); // generous for CI; the doc's target is well under 50 ms
  });

  it("an item without a span still works, through one quote search", () => {
    const v = missedLinesView(EN_PAPER, [{ source_quote: "STOP ibuprofen 200 mg tablet." }]);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(missedLineTexts(v)).not.toContain("STOP ibuprofen 200 mg tablet.");
  });
});

describe("lineCountLabel", () => {
  it("uses the singular for one", () => {
    expect(lineCountLabel(1)).toBe("1 line");
    expect(lineCountLabel(3)).toBe("3 lines");
  });
});
