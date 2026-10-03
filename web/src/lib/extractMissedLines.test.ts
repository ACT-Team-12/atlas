import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A model stub that answers at once with a fixed care plan.
const item = (title: string, quote: string) => ({
  kind: "medication" as const, title, plain_language: `About ${title}`, why: "", when: "", source_quote: quote,
  needs_clarification: false, question_for_clinic: "",
});
const OUTPUT = {
  source_text: "",
  items: [
    item("Metformin", "Take 1 tablet by mouth 2 times a day with meals."),
    item("Made up", "Take 3 aspirin every hour"),
    item("Lisinopril", "Take 2 tablets (20 mg total) by mouth once daily"),
  ],
  questions_for_doctor: ["What if I miss a dose?"],
  not_in_document: ["No date given for the blood test"],
};
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { parse: async () => ({ parsed_output: OUTPUT, stop_reason: "end_turn" }) };
  },
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/lib/db", () => ({ isTestRequest: () => true, surfaceOf: () => "web", recordEvent: vi.fn() }));

const { POST } = await import("../app/api/extract/route");
const { SAMPLE_AVS } = await import("./sample");
const { verifyItems } = await import("./verify");
const { missedFromPayload, missedLinesPayload, missedLinesView } = await import("./missedLines");

/** Every field the response carried before missed_lines, in order. None may change. */
const OLD_FIELDS = [
  "source_text", "source_kind", "items", "refused", "questions_for_doctor", "not_in_document",
  "has_warning_signs", "language", "model", "stats",
];

beforeEach(() => vi.stubEnv("ANTHROPIC_API_KEY", "test-key"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/extract returns missed_lines", () => {
  it("adds one optional field and leaves every old field as it was", async () => {
    const res = await POST(new Request("http://localhost/api/extract", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": "203.0.113.10" },
      body: JSON.stringify({ text: SAMPLE_AVS, language: "English", reading_level: "simple" }),
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body)).toEqual([...OLD_FIELDS, "missed_lines"]);

    // Old fields: exactly what the verifier and the request produce.
    const { kept, refused } = verifyItems(SAMPLE_AVS, OUTPUT.items);
    expect(body.source_text).toBe(SAMPLE_AVS);
    expect(body.source_kind).toBe("text");
    expect(body.items).toEqual(JSON.parse(JSON.stringify(kept)));
    expect(body.refused).toEqual(JSON.parse(JSON.stringify(refused)));
    expect(body.items).toHaveLength(2);
    expect(body.language).toBe("English");
    expect(body.stats).toMatchObject({ extracted: 3, grounded: 2, refused: 1 });

    // The new field: the payload for the KEPT items, and it reproduces the website's check.
    expect(body.missed_lines).toEqual(JSON.parse(JSON.stringify(missedLinesPayload(SAMPLE_AVS, kept))));
    expect(body.missed_lines.show).toBe(true);
    for (const keep of [kept, kept.slice(0, 1), kept.slice(1), []]) {
      expect(missedFromPayload(body.missed_lines, keep.map((i) => i.id))).toEqual(missedLinesView(SAMPLE_AVS, keep));
    }
    // Held-back items never cover anything.
    expect(Object.keys(body.missed_lines.quotes)).toEqual(kept.map((i) => i.id));
  });
});
