import { describe, expect, it } from "vitest";
import { PhiShieldRefused, TOKEN_RE, shield } from "./phiShield";
import { guardPlan } from "./phiGuard";
import { SAMPLE_AVS } from "./sample";
import { SAMPLE_LABS } from "./sampleLabs";
import { SAMPLE_PREP } from "./samplePrep";
import { NAMED_PAPER } from "./__fixtures__/phiPaper";
import { plantedPapers } from "./phiPlanted";
import papers from "../data/eval/papers.json";
import labs from "../data/eval/labs.json";
import extractSample from "../../../mobile/ios/ATLASTests/Fixtures/extract_sample_live.json";
import planSample from "../../../mobile/ios/ATLASTests/Fixtures/plan_sample_30303_live.json";

/**
 * False refusals: the shield refuses (413) text it cannot check safely, so a normal paper must never be refused. Every
 * paper in the repo's eval and sample sets, plus one ordinary after-visit paper per supported language (written for
 * this test by Team ATLAS, not real patients), goes through the shield here.
 */

const MULTILINGUAL: [string, string][] = [
  ["Spanish", "RESUMEN DE LA VISITA\nPaciente: María José Hernández   Fecha de nacimiento: 14/03/1958\nTeléfono: (404) 555-0199\n\nMedicamentos:\n- Metformina 500 mg: tome 1 tableta dos veces al día con las comidas.\n- Lisinopril 10 mg: tome 1 tableta cada mañana.\n\nRegrese en 3 meses para el análisis de hemoglobina A1c.\nLlame al 911 si tiene dolor de pecho o dificultad para respirar.\nPresión arterial: 132/84 mmHg. Peso: 78 kg. Temperatura: 37,2 °C."],
  ["Vietnamese", "TÓM TẮT LẦN KHÁM\nBệnh nhân: Nguyễn Thị Lan   Ngày sinh: 02/07/1965\n\nThuốc:\n- Metformin 500 mg: uống 1 viên, ngày 2 lần, sau bữa ăn.\n- Amlodipine 5 mg: uống 1 viên mỗi sáng.\n\nTái khám sau 3 tháng để xét nghiệm HbA1c.\nGọi 911 nếu bị đau ngực hoặc khó thở."],
  ["Korean", "진료 요약\n환자: 김민준   생년월일: 1962년 5월 9일\n\n약:\n- 메트포르민 500 mg: 하루 2번, 식사와 함께 1정 복용하세요.\n- 리시노프릴 10 mg: 매일 아침 1정 복용하세요.\n\n3개월 후 당화혈색소 검사를 받으세요.\n가슴 통증이나 호흡 곤란이 있으면 911에 전화하세요."],
  ["Chinese", "就诊摘要\n患者：王小明　出生日期：1959年11月20日\n\n药物：\n- 二甲双胍 500 mg：每日两次，每次1片，随餐服用。\n- 赖诺普利 10 mg：每天早上服用1片。\n\n3个月后复查糖化血红蛋白（HbA1c）。\n如有胸痛或呼吸困难，请拨打911。"],
  ["Amharic", "የጉብኝት ማጠቃለያ\nታካሚ: አበበ በቀለ   የትውልድ ቀን: 12/01/1960\n\nመድሃኒቶች:\n- ሜትፎርሚን 500 mg: በቀን ሁለት ጊዜ ከምግብ ጋር 1 ኪኒን ይውሰዱ።\n- ሊሲኖፕሪል 10 mg: በየቀኑ ጠዋት 1 ኪኒን ይውሰዱ።\n\nከ3 ወር በኋላ ለHbA1c ምርመራ ይመለሱ።\nየደረት ህመም ወይም የመተንፈስ ችግር ካለ ወደ 911 ይደውሉ።"],
  ["French", "RÉSUMÉ DE CONSULTATION\nPatiente : Hélène Dubois-Lefèvre   Date de naissance : 21/06/1961\n\nMédicaments :\n- Metformine 500 mg : prenez 1 comprimé 2 fois par jour, au cours des repas.\n- Lisinopril 10 mg : prenez 1 comprimé chaque matin.\n\nRevenez dans 3 mois pour le dosage de l’hémoglobine glyquée (HbA1c).\nAppelez le 911 en cas de douleur thoracique ou d’essoufflement. « Ne sautez pas de dose. »\nTempérature : 37,5 °C."],
];

const CORPUS: [string, string][] = [
  ["sample after-visit summary", SAMPLE_AVS],
  ["sample lab report", SAMPLE_LABS],
  ["sample prep paper", SAMPLE_PREP],
  ["named-patient fixture", NAMED_PAPER],
  ...(papers as { papers: { id: string; text: string }[] }).papers.map((p): [string, string] => [`eval paper ${p.id}`, p.text]),
  ...(labs as { reports: { id: string; text: string }[] }).reports.map((r): [string, string] => [`lab report ${r.id}`, r.text]),
  ...plantedPapers().map((p): [string, string] => [`planted paper ${p.id}`, p.text]),
  ...MULTILINGUAL.map(([lang, text]): [string, string] => [`${lang} paper`, text]),
];

describe("no normal paper is refused", () => {
  it(`all ${CORPUS.length} papers pass the shield`, () => {
    const refused: string[] = [];
    let hidden = 0;
    for (const [name, text] of CORPUS) {
      try {
        hidden += shield(text).offsetMap.length;
      } catch (e) {
        if (!(e instanceof PhiShieldRefused)) throw e;
        refused.push(`${name}: ${e.message}`);
      }
    }
    console.log(`phiCorpus: ${CORPUS.length} papers, ${refused.length} refused, ${hidden} identifier stretches hidden`);
    expect(refused).toEqual([]);
  });

  it.each(MULTILINGUAL)("the %s paper keeps its care words and dosing numbers", (_lang, text) => {
    const r = shield(text);
    const out = r.text;
    console.log(`phiCorpus ${_lang}: hidden ${JSON.stringify(r.offsetMap.map((s) => text.slice(s.start, s.end)))}`);
    for (const kept of ["500 mg", "10 mg", "911"].filter((k) => text.includes(k))) expect(out).toContain(kept);
  });

  // Labels are read in English, Spanish, French and Vietnamese. Korean, Chinese and Amharic labels are not yet: those
  // papers pass (no refusal) but their identifiers are not hidden, a stated limit.
  it.each([
    ["Spanish", ["María José Hernández", "14/03/1958", "(404) 555-0199"]],
    ["French", ["Hélène Dubois-Lefèvre", "21/06/1961"]],
    ["Vietnamese", ["Nguyễn Thị Lan", "02/07/1965"]],
  ])("the %s paper hides its patient's identifiers", (lang, ids) => {
    const text = MULTILINGUAL.find(([l]) => l === lang)![1];
    const out = shield(text).text;
    for (const id of ids) expect(out).not.toContain(id);
  });
});

describe("the sample paper's plan: only redactions change, and step ids map back", () => {
  it("the AI gets opaque ids and the paper's words (identifiers aside); the plan comes back with the real ids", async () => {
    type Item = { id: string; kind: string; title: string; plain_language: string; when: string; source_quote: string };
    const items = (extractSample as unknown as { items: Item[] }).items;
    const care = items.map(({ id, kind, title, plain_language, when, source_quote }) => ({ id, kind, title, plain_language, when, source_quote }));
    const fixture = planSample as unknown as { steps: { care_ids: string[] }[] };
    const back = await guardPlan({ care, barriers: ["transport", "cost"], language: "English", note: "" } as never, async (req) => {
      const sent = (req as unknown as { care: Item[] }).care;
      sent.forEach((c, i) => {
        expect(c.id).toMatch(/^atlas-step-\d+$/);
        expect(c.kind).toBe(care[i].kind);
        for (const k of ["title", "plain_language", "when", "source_quote"] as const) {
          // The sent text is the original with some stretches replaced by placeholders, and nothing else changed.
          const pattern = c[k].split(new RegExp(TOKEN_RE.source, "g")).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s\\S]+?");
          expect(new RegExp(`^${pattern}$`).test(care[i][k]), `${k}: ${c[k]}`).toBe(true);
        }
      });
      // The model answers with the ids it was sent.
      const toOpaque = new Map(care.map((c, i) => [c.id, sent[i].id]));
      return { ...fixture, steps: fixture.steps.map((s) => ({ ...s, care_ids: s.care_ids.map((id) => toOpaque.get(id)!) })) };
    });
    expect(back).toEqual(fixture);
  });
});
