import { describe, expect, it } from "vitest";
import { ItemScanner } from "./itemScanner";
import { streamCarePlan, type ModelStream } from "./extractStream";
import { finishCarePlan } from "./extract";
import { readExtractEvents, StreamBroken, StreamFailed, encodeEvent, type ExtractEvent } from "./extractEvents";
import { RequestSchema } from "./schema";
import { SAMPLE_AVS } from "./sample";

const item = (title: string, quote: string, extra: Record<string, unknown> = {}) => ({
  kind: "medication", title, plain_language: `About ${title}`, why: "", when: "", source_quote: quote,
  needs_clarification: false, question_for_clinic: "", ...extra,
});

// Mirrors the model's output order (source_text, items, questions, not_in_document).
const OUTPUT = {
  source_text: "",
  items: [
    item("Metformin", "metformin (GLUCOPHAGE) 500 mg tablet"),
    item("Made up", "Take 3 aspirin every hour", { why: 'a "quoted" {brace} and ] bracket \\ slash' }),
    item("Lisinopril", "Take 2 tablets (20 mg total) by mouth once daily", { kind: "medication", when: "daily" }),
  ],
  questions_for_doctor: ["What if I miss a dose?"],
  not_in_document: ["No date given for the blood test"],
};
const RAW = JSON.stringify(OUTPUT, null, 1);
const req = RequestSchema.parse({ text: SAMPLE_AVS, reading_level: "simple", language: "English" });

function fakeModel(text: string, chunk: number, parsed: unknown = JSON.parse(text)): ModelStream {
  return {
    text: (async function* () {
      for (let i = 0; i < text.length; i += chunk) yield text.slice(i, i + chunk);
    })(),
    final: async () => ({ parsed, stopReason: "end_turn" }),
  };
}

describe("ItemScanner", () => {
  it("returns each item only once its object is complete, at every cut point", () => {
    for (let cut = 0; cut <= RAW.length; cut++) {
      const s = new ItemScanner();
      const got = s.push(RAW.slice(0, cut));
      // Everything returned from a truncated prefix is a complete, parseable item, in order.
      got.forEach((g, i) => expect(JSON.parse(g)).toEqual(OUTPUT.items[i]));
      expect(got.length).toBeLessThanOrEqual(3);
      const rest = s.push(RAW.slice(cut));
      expect([...got, ...rest].map((g) => JSON.parse(g))).toEqual(OUTPUT.items);
      expect(s.found).toBe(3);
    }
  });

  it("is not fooled by braces, brackets, escaped quotes or the word items inside strings", () => {
    const tricky = JSON.stringify({
      source_text: 'line "items": [ {not an item} ] \\" }',
      items: [item("A", "x { y } [z]"), item('B "q"', "items: [{}]")],
      questions_for_doctor: ['{"items":[{"kind":"x"}]}'],
      not_in_document: [],
    });
    const s = new ItemScanner();
    const got: string[] = [];
    for (const c of tricky) got.push(...s.push(c)); // one character at a time
    expect(got.map((g) => JSON.parse(g).title)).toEqual(["A", 'B "q"']);
  });

  it("returns nothing for a cut-off item", () => {
    const s = new ItemScanner();
    expect(s.push('{"source_text":"","items":[{"kind":"medication","title":"half')).toEqual([]);
    expect(s.push('"')).toEqual([]);
    expect(s.push("}")).toEqual(['{"kind":"medication","title":"half"}']); // only now is it complete
  });
});

describe("streamCarePlan", () => {
  it("emits only grounded items, and they match the final result", async () => {
    for (const chunk of [1, 7, 64, RAW.length]) {
      const events: ExtractEvent[] = [];
      const plan = await streamCarePlan(req, fakeModel(RAW, chunk), (e) => events.push(e), Date.now());
      const streamed = events.filter((e) => e.type === "item").map((e) => (e as { item: unknown }).item);
      expect(streamed).toEqual(plan.items);
      expect(streamed.every((i) => (i as { grounded: boolean }).grounded)).toBe(true);
      expect(plan.refused.map((r) => r.title)).toEqual(["Made up"]);
      expect(streamed.map((i) => (i as { id: string }).id)).toEqual(["item-0", "item-2"]);
    }
  });

  it("final payload equals what the plain route builds from the same output", async () => {
    const plan = await streamCarePlan(req, fakeModel(RAW, 13), () => {}, 0);
    const plain = finishCarePlan(req, JSON.parse(RAW), "end_turn", 0);
    expect({ ...plan, stats: { ...plan.stats, ms: 0 } }).toEqual({ ...plain, stats: { ...plain.stats, ms: 0 } });
    expect(Object.keys(plan).sort()).toEqual(
      ["has_warning_signs", "items", "model", "not_in_document", "questions_for_doctor", "refused", "source_kind", "source_text", "stats"],
    );
  });

  it("sends no early steps for a photo", async () => {
    const photo = RequestSchema.parse({ image_base64: "abc", image_media_type: "image/jpeg" });
    const parsed = { ...OUTPUT, source_text: SAMPLE_AVS };
    const events: ExtractEvent[] = [];
    const plan = await streamCarePlan(photo, fakeModel(JSON.stringify(parsed), 5), (e) => events.push(e), 0);
    expect(events).toEqual([]);
    expect(plan.source_kind).toBe("image");
  });

  it("throws the plain route's error when the output is malformed", async () => {
    await expect(streamCarePlan(req, fakeModel(RAW, 9, { items: "nope" }), () => {}, 0)).rejects.toThrow(/malformed/);
  });
});

function bodyOf(parts: string[]) {
  const enc = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(c) { parts.forEach((p) => c.enqueue(enc.encode(p))); c.close(); },
  });
}

describe("readExtractEvents", () => {
  const plan = finishCarePlan(req, JSON.parse(RAW), "end_turn", 0);
  const lines = [...plan.items.map((i) => encodeEvent({ type: "item", item: i })), encodeEvent({ type: "done", plan })].join("");

  it("reads lines split across chunks and returns the final plan", async () => {
    const seen: string[] = [];
    const parts = lines.match(/[\s\S]{1,11}/g)!;
    const got = await readExtractEvents(bodyOf(parts), (i) => seen.push(i.id));
    expect(seen).toEqual(["item-0", "item-2"]);
    expect(got).toEqual(plan);
  });

  it("treats a stream that ends before the result as broken", async () => {
    const cut = lines.slice(0, lines.lastIndexOf('{"type":"done"') + 30);
    await expect(readExtractEvents(bodyOf([cut]), () => {})).rejects.toBeInstanceOf(StreamBroken);
  });

  it("surfaces the server's error", async () => {
    const err = encodeEvent({ type: "error", error: "The AI declined to read this document.", status: 422 });
    await expect(readExtractEvents(bodyOf([err]), () => {})).rejects.toBeInstanceOf(StreamFailed);
  });
});
