import { describe, expect, it } from "vitest";
import { finishCarePlan } from "./extract";
import { streamCarePlan, type ModelStream } from "./extractStream";
import { guardExtract, guardExtractStream, guardMeaning, guardPlan, guardText, guardUnderstand } from "./phiGuard";
import { PhiShield, hasToken } from "./phiShield";
import { shieldText, unshieldCarePlan } from "./phiResponses";
import { missedFromPayload } from "./missedLines";
import { checkQuestions, type UnderstandResponse } from "./understand";
import { RequestSchema, type CarePlanResponse, type ExtractRequest, type VerifiedItem } from "./schema";
import type { ExtractEvent } from "./extractEvents";
import { NAMED_PAPER, NAMED_PAPER_IDENTIFIERS as IDENTIFIERS } from "./__fixtures__/phiPaper";

/**
 * A stand-in for the model: it quotes the SAME pieces of whatever text it is given (by line, and part of a line), so
 * the plain read and the shielded read can be compared field by field.
 */
function fakeModelOutput(doc: string) {
  const lines = doc.split("\n");
  const at = (needle: string) => lines.find((l) => l.includes(needle))!;
  const item = (title: string, quote: string, extra: Record<string, unknown> = {}) => ({
    kind: "medication", title, plain_language: `About: ${quote}`, why: "", when: "", source_quote: quote, needs_clarification: false, question_for_clinic: "", ...extra,
  });
  const metformin = at("metformin");
  return {
    source_text: "",
    items: [
      item("Metformin", metformin.slice(metformin.indexOf("take"))), // a partial quote that leaves the name out
      item("Lisinopril", "Take 2 tablets (20 mg total) by mouth once daily"),
      item("Stop ibuprofen", at("ibuprofen")), // the whole line, name and all
      item("A1c", "Hemoglobin A1c - due in 3 months", { kind: "lab_test" }),
      item("Made up", "Take 3 aspirin every hour"),
      item("Sugar", at("blood sugar"), { kind: "warning_sign" }),
    ],
    questions_for_doctor: [`Ask about ${lines[1].split("   ")[0].slice(9)}`],
    not_in_document: ["No date given for the eye exam"],
  };
}

const req = (text: string): ExtractRequest => RequestSchema.parse({ text, reading_level: "simple", language: "English" });
const strip = (p: CarePlanResponse) => ({ ...p, stats: { ...p.stats, ms: 0 } });

describe("the shielded read lands on the same words as the plain read", () => {
  const plain = strip(finishCarePlan(req(NAMED_PAPER), fakeModelOutput(NAMED_PAPER), "end_turn", Date.now()));

  it("the model saw no identifier, and the answer is identical to reading the original", async () => {
    let seen = "";
    const shielded = strip(await guardExtract(req(NAMED_PAPER), async (r) => {
      seen = r.text!;
      return finishCarePlan(r, fakeModelOutput(r.text!), "end_turn", Date.now());
    }));
    for (const id of IDENTIFIERS) expect(seen).not.toContain(id);
    expect(seen).toContain("Dr. Lee");
    expect(seen).toContain("404-555-0134");
    expect(shielded).toEqual(plain);
    expect(JSON.stringify(shielded)).not.toMatch(/⟦/);
  });

  it("Show on my paper: each kept step's span slices its quote out of the original paper", async () => {
    const shielded = await guardExtract(req(NAMED_PAPER), async (r) => finishCarePlan(r, fakeModelOutput(r.text!), "end_turn", 0));
    expect(shielded.items.length).toBe(5);
    for (const it of shielded.items) expect(NAMED_PAPER.slice(it.span!.start, it.span!.end)).toBe(it.source_quote);
    const ibu = shielded.items.find((i) => i.title === "Stop ibuprofen")!;
    expect(ibu.source_quote).toBe("Ms. Lopez, stop ibuprofen 200 mg. Avoid NSAIDs due to kidney function.");
  });

  it("missed lines: the same sentences, offsets and verdicts for every set of removed steps", async () => {
    const shielded = await guardExtract(req(NAMED_PAPER), async (r) => finishCarePlan(r, fakeModelOutput(r.text!), "end_turn", 0));
    expect(shielded.missed_lines).toEqual(plain.missed_lines);
    const ids = plain.items.map((i) => i.id);
    for (let mask = 0; mask < 1 << ids.length; mask++) {
      const kept = ids.filter((_, i) => mask & (1 << i));
      expect(missedFromPayload(shielded.missed_lines!, kept, NAMED_PAPER.length)).toEqual(missedFromPayload(plain.missed_lines!, kept, NAMED_PAPER.length));
    }
  });

  it("a photo read (nothing shielded) passes through unchanged", async () => {
    const photo = { ...plain, source_kind: "image" as const };
    const r = await guardExtract(RequestSchema.parse({ image_base64: "aGk=", image_media_type: "image/jpeg" }), async () => photo);
    expect(r).toEqual(photo);
  });
});

describe("the streaming read", () => {
  function model(doc: string): ModelStream {
    const out = fakeModelOutput(doc);
    const raw = JSON.stringify(out);
    return {
      text: (async function* () { for (let i = 0; i < raw.length; i += 37) yield raw.slice(i, i + 37); })(),
      final: async () => ({ parsed: out, stopReason: "end_turn" }),
    };
  }

  it("every streamed step and the final plan are the plain read's, and no placeholder is sent", async () => {
    const plainEvents: ExtractEvent[] = [];
    const plainPlan = await streamCarePlan(req(NAMED_PAPER), model(NAMED_PAPER), (e) => plainEvents.push(e), 0);
    const events: ExtractEvent[] = [];
    const g = guardExtractStream(req(NAMED_PAPER), (e) => events.push(e));
    for (const id of IDENTIFIERS) expect(g.req.text).not.toContain(id);
    const plan = g.restore(await streamCarePlan(g.req, model(g.req.text!), g.emit, 0));
    expect(events).toEqual(plainEvents);
    expect(strip(plan)).toEqual(strip(plainPlan));
    expect(JSON.stringify(events)).not.toMatch(/⟦/);
  });
});

describe("the other AI routes' server pass", () => {
  it("prep and lab results: the model sees placeholders, the answer has the real words", async () => {
    let seen = "";
    const out = await guardText({ text: NAMED_PAPER, language: "English" }, async (r) => {
      seen = r.text;
      return { quote: r.text.split("\n")[6] };
    });
    for (const id of IDENTIFIERS) expect(seen).not.toContain(id);
    expect(out.quote).toBe("Maria, take metformin 500 mg by mouth 2 times a day with meals.");
  });

  it("understand: proof spans are moved onto the original paper", async () => {
    const items = [{ id: "item-0", kind: "medication", title: "Maria's metformin", source_quote: "Maria, take metformin 500 mg by mouth 2 times a day with meals." }];
    let seen = "";
    const out = await guardUnderstand({ source_text: NAMED_PAPER, language: "English", items }, async (r): Promise<UnderstandResponse> => {
      seen = JSON.stringify(r);
      const { questions, dropped } = checkQuestions(r.source_text, r.items, [
        { item_id: r.items[0].id, question: "How often?", options: ["2 times a day", "once", "never"], correct: 0, answer_quote: "2 times a day" },
      ]);
      return { questions, dropped, model: "m", ms: 0 };
    });
    for (const id of IDENTIFIERS) expect(seen).not.toContain(id);
    expect(out.questions).toHaveLength(1);
    expect(NAMED_PAPER.slice(out.questions[0].span.start, out.questions[0].span.end)).toBe("2 times a day");
  });

  it("meaning: quotes and explanations are shielded with names learned from any of them", async () => {
    let seen = "";
    const out = await guardMeaning({ items: [
      { id: "a", plain_language: "Take it twice a day.", when: "", source_quote: "Patient: Maria Lopez" },
      { id: "b", plain_language: "Maria takes 500 mg.", when: "", source_quote: "Maria, take metformin 500 mg" },
    ] }, async (r) => { seen = JSON.stringify(r); return { what: r.items[1].plain_language }; });
    expect(seen).not.toContain("Maria");
    expect(out.what).toBe("Maria takes 500 mg.");
  });

  it("plan: care steps and the note are shielded, and the plan text is NOT unshielded", async () => {
    let seen = "";
    const care = [{ id: "item-0", kind: "medication", title: "Metformin", plain_language: "Take it.", when: "", source_quote: "Ms. Lopez, take metformin. DOB: 04/12/1961" }];
    const out = await guardPlan({ care, barriers: [], language: "English", note: "My name is on the paper: Patient: Maria Lopez" }, async (r) => {
      seen = JSON.stringify(r);
      return { summary: `Hello ${r.care[0].source_quote.slice(4, 12)}` };
    });
    for (const id of ["Lopez", "04/12/1961", "Maria"]) expect(seen).not.toContain(id);
    expect(out.summary).not.toContain("Lopez"); // a placeholder copied by the AI is never turned back into the name
  });
});

describe("unshieldCarePlan", () => {
  it("puts real words in every text field of every step, kept or held back", () => {
    const session = new PhiShield();
    const ctx = shieldText(session, NAMED_PAPER);
    const out = fakeModelOutput(ctx.result.text);
    out.items.push({ ...out.items[0], title: "For ⟦NAME_B⟧", plain_language: "⟦NAME_B⟧ should", why: "⟦NAME_B⟧", when: "⟦NAME_B⟧", question_for_clinic: "⟦NAME_B⟧?", source_quote: "not on the paper ⟦NAME_B⟧", needs_clarification: true });
    out.questions_for_doctor.push("Ask ⟦NAME_A⟧");
    out.not_in_document.push("⟦MRN_A⟧ unclear");
    const plan = unshieldCarePlan(finishCarePlan(req(ctx.result.text), out, "end_turn", 0), ctx, session.tokens);
    expect(hasToken(JSON.stringify(plan))).toBe(false);
    const held = plan.refused.find((i: VerifiedItem) => i.title.startsWith("For"))!;
    expect(held).toMatchObject({ title: "For Maria", plain_language: "Maria should", why: "Maria", when: "Maria", question_for_clinic: "Maria?", source_quote: "not on the paper Maria" });
    expect(plan.questions_for_doctor).toContain("Ask Maria Lopez");
    expect(plan.not_in_document).toContain("88412907 unclear");
    expect(plan.source_text).toBe(NAMED_PAPER);
  });
});
