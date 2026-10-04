import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ExtractionSchema, ITEM_KINDS, type CarePlanResponse, type ExtractRequest } from "./schema";
import { verifyItems } from "./verify";
import { missedLinesPayload } from "./missedLines";
import { isWarning } from "./warningPin";

export const MODEL = process.env.ATLAS_MODEL ?? "claude-opus-5-5";

const SYSTEM = `You turn a patient's after-visit summary into a care plan they can act on.
Rules you must follow:
- Use ONLY what is written in the document. Never add medical advice, doses, diagnoses, or instructions that are not in it.
- Every item must include source_quote: an exact, contiguous, word-for-word copy of the line(s) in the document it came from. Do not paraphrase the quote.
- If something important is unclear or missing (for example a lab is ordered but no date or place is given), set needs_clarification true and write the question the patient should ask their clinic.
- Mark anything that says to call 911, go to the ER, or call the office right away as kind "warning_sign".
- plain_language and why must be written for the requested reading level and in the requested language. source_quote always stays in the document's original language.
- If the input is a photo, first transcribe the full document text faithfully into source_text, then quote from that transcription. For text input, leave source_text empty.
- List things a patient would reasonably want to know that the document does NOT say in not_in_document (for example "No date given for the blood test").`;

// Plain schema for the model's structured output (no length limits or defaults;
// those live in ExtractionSchema, which re-validates the result).
const ModelOutput = z.object({
  source_text: z.string(),
  items: z.array(
    z.object({
      kind: z.enum(ITEM_KINDS),
      title: z.string(),
      plain_language: z.string(),
      why: z.string(),
      when: z.string(),
      source_quote: z.string(),
      needs_clarification: z.boolean(),
      question_for_clinic: z.string(),
    }),
  ),
  questions_for_doctor: z.array(z.string()),
  not_in_document: z.array(z.string()),
});

/** Case and punctuation insensitive key for a question (the same key as visitQuestions.ts). */
export const questionKey = (q: string) => q.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Drops repeated questions (case and punctuation insensitive). */
export function dedupe(qs: string[]) {
  const seen = new Set<string>();
  return qs.filter((q) => {
    const k = questionKey(q);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export class ExtractError extends Error {
  constructor(message: string, public status = 500) {
    super(message);
  }
}

export function makeClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ExtractError("Server is missing its AI key. Tell the ATLAS team.", 503);
  return new Anthropic({ apiKey });
}

/** The model request shared by the plain and the streaming routes, so both read a paper the same way. */
export function buildParams(req: ExtractRequest) {
  const userContent: Anthropic.ContentBlockParam[] = [];
  if (req.image_base64 && req.image_media_type) {
    userContent.push({
      type: "image",
      source: { type: "base64", media_type: req.image_media_type, data: req.image_base64 },
    });
  }
  userContent.push({
    type: "text",
    text:
      `Reading level: ${req.reading_level}. Language for explanations: ${req.language}.\n` +
      (req.text ? `After-visit summary text:\n<document>\n${req.text}\n</document>` : "The after-visit summary is the photo above."),
  });

  return {
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: "low" as const, format: zodOutputFormat(ModelOutput) },
    messages: [{ role: "user" as const, content: userContent }],
  };
}

/**
 * Turns the model's raw output into the care plan: re-validates it, checks every quote against the
 * paper, and builds the stats. The streaming route calls this too, so its final payload has the same
 * shape and the same verdicts as the plain route.
 */
export function finishCarePlan(req: ExtractRequest, raw: unknown, stopReason: string | null | undefined, t0: number): CarePlanResponse {
  if (stopReason === "refusal") throw new ExtractError("The AI declined to read this document.", 422);
  const parsed = ExtractionSchema.safeParse(raw);
  if (!parsed.success) throw new ExtractError("The AI returned a malformed care plan. Try again.", 502);

  const sourceKind = req.text ? "text" : "image";
  const source = req.text ?? parsed.data.source_text;
  if (!source || source.trim().length < 10) throw new ExtractError("Could not read any text from that document.", 422);

  const { kept, refused } = verifyItems(source, parsed.data.items);
  const stepQuestions = new Set(parsed.data.items.map((i) => questionKey(i.question_for_clinic)).filter(Boolean));
  return {
    source_text: source,
    source_kind: sourceKind,
    items: kept,
    refused,
    // General questions only. A step's own question stays on its step: it is AI-written, so the screens add it to the
    // next-visit list only once that step is certified (visitQuestions.ts). A general question that repeats any step's
    // question (grounded or not) is dropped, so an unchecked one cannot reach the list this way.
    questions_for_doctor: dedupe(parsed.data.questions_for_doctor).filter((q) => !stepQuestions.has(questionKey(q))),
    not_in_document: parsed.data.not_in_document,
    // The model's kind may only add caution: a quote with warning language counts too (warningPin.ts).
    has_warning_signs: kept.some(isWarning),
    language: req.language,
    model: MODEL,
    stats: { extracted: parsed.data.items.length, grounded: kept.length, refused: refused.length, ms: Date.now() - t0 },
    missed_lines: missedLinesPayload(source, kept),
  };
}

/**
 * Reads a paper the plain way. `signal` is the request's own: when the person clears the paper (or leaves), the
 * model call is cancelled instead of reading the whole paper for nobody.
 */
export async function extractCarePlan(req: ExtractRequest, signal?: AbortSignal): Promise<CarePlanResponse> {
  const client = makeClient();
  const t0 = Date.now();
  signal?.throwIfAborted();
  const msg = await client.messages.parse(buildParams(req), { signal });
  return finishCarePlan(req, msg.parsed_output, msg.stop_reason, t0);
}
