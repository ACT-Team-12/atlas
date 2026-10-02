import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ExtractError, MODEL } from "./extract";
import { LANGUAGES } from "./schema";
import { findSpan } from "./verify";
import { numbersIn } from "./meaning";

/**
 * "Check I understood": one teach-back question per care step.
 *
 * Patients rarely notice their own misunderstandings (Engel et al. 2009: only 20% of the time), so ATLAS asks.
 * Each question carries answer_quote, the exact words in the paper that prove the right answer. Our checker
 * keeps a question only if that quote is in the paper AND inside the same step's quoted line; everything else
 * is dropped and counted. The option wording is the AI's, so the UI always shows the paper's line with the answer.
 */

export const UnderstandRequestSchema = z.object({
  source_text: z.string().min(10).max(20000),
  language: z.enum(LANGUAGES).default("English"),
  items: z
    .array(
      z.object({
        id: z.string().max(40),
        kind: z.string().max(40),
        title: z.string().max(200),
        source_quote: z.string().max(800),
      }),
    )
    .min(1)
    .max(20),
});
export type UnderstandRequest = z.infer<typeof UnderstandRequestSchema>;

const ModelOutput = z.object({
  questions: z.array(
    z.object({
      item_id: z.string(),
      question: z.string(),
      options: z.array(z.string()),
      correct: z.number().int(),
      answer_quote: z.string(),
    }),
  ),
});
export type DraftQuestion = z.infer<typeof ModelOutput>["questions"][number];

export type CheckedQuestion = DraftQuestion & { span: { start: number; end: number } };
export type DropReason = "unknown_step" | "duplicate_step" | "bad_options" | "quote_not_in_paper" | "quote_outside_step" | "answer_not_in_quote" | "distractor_matches_quote";
export type UnderstandResponse = {
  questions: CheckedQuestion[];
  dropped: { item_id: string; reason: DropReason }[];
  model: string;
  ms: number;
};

const SYSTEM = `You help a patient check that they understood their after-visit paper (teach-back).
For each care step you are given, write ONE short multiple-choice question about the single fact the patient must get right to do that step (when, how much, how often, where, or what to do if something happens).
Rules:
- Use ONLY what the paper says. Never add medical facts.
- Exactly 3 options. Exactly one is correct according to the paper. The other two must be plausible but clearly wrong according to the paper.
- correct is the 0-based index of the correct option. Vary its position.
- answer_quote is an exact, contiguous, word-for-word copy of the words in the paper that prove the correct option. It must come from that step's own source_quote.
- question and options are in the requested language, short and plain. answer_quote stays in the paper's language.
- Skip a step if it has no checkable fact.`;

/** Deterministic gate: keeps only questions whose proof is in the paper, inside the step it asks about. */
export function checkQuestions(
  source: string,
  items: UnderstandRequest["items"],
  drafts: DraftQuestion[],
): Pick<UnderstandResponse, "questions" | "dropped"> {
  const stepSpans = new Map(items.map((i) => [i.id, findSpan(source, i.source_quote)]));
  const seen = new Set<string>();
  const questions: CheckedQuestion[] = [];
  const dropped: UnderstandResponse["dropped"] = [];
  for (const q of drafts) {
    const step = stepSpans.get(q.item_id);
    if (step === undefined || step === null) { dropped.push({ item_id: q.item_id, reason: "unknown_step" }); continue; }
    if (seen.has(q.item_id)) { dropped.push({ item_id: q.item_id, reason: "duplicate_step" }); continue; }
    const opts = q.options.map((o) => o.trim());
    const distinct = new Set(opts.map((o) => o.toLowerCase())).size === 3;
    if (opts.length !== 3 || !distinct || opts.some((o) => !o) || q.correct < 0 || q.correct > 2 || !q.question.trim()) {
      dropped.push({ item_id: q.item_id, reason: "bad_options" });
      continue;
    }
    const span = findSpan(source, q.answer_quote);
    if (!span) { dropped.push({ item_id: q.item_id, reason: "quote_not_in_paper" }); continue; }
    if (span.start < step.start || span.end > step.end) { dropped.push({ item_id: q.item_id, reason: "quote_outside_step" }); continue; }
    // The quote is real, but does it back THIS answer? (Codex review, 2026-10-02: correct="3 times daily" with
    // quote "2 times a day" passed.) No AI here: every number in the right answer must be in the quote, and no
    // wrong option may carry exactly the quote's numbers. Answers without numbers keep the quote-in-step rule.
    const quoteNums = new Set(numbersIn(q.answer_quote));
    const nums = (o: string) => numbersIn(o);
    const right = nums(opts[q.correct]);
    if (right.some((n) => !quoteNums.has(n))) { dropped.push({ item_id: q.item_id, reason: "answer_not_in_quote" }); continue; }
    const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((n) => b.includes(n));
    if (opts.some((o, i) => i !== q.correct && nums(o).length > 0 && nums(o).every((n) => quoteNums.has(n)) && !sameSet(nums(o), right))) {
      dropped.push({ item_id: q.item_id, reason: "distractor_matches_quote" });
      continue;
    }
    seen.add(q.item_id);
    questions.push({ ...q, options: opts, span });
  }
  return { questions, dropped };
}

export async function buildQuestions(req: UnderstandRequest): Promise<UnderstandResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ExtractError("Server is missing its AI key. Tell the ATLAS team.", 503);
  const client = new Anthropic({ apiKey });
  const t0 = Date.now();
  const steps = req.items.map((i) => `- id: ${i.id} | ${i.kind} | ${i.title}\n  source_quote: ${i.source_quote}`).join("\n");
  const msg = await client.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    output_config: { effort: "low", format: zodOutputFormat(ModelOutput) },
    messages: [
      {
        role: "user",
        content: `Language for questions and options: ${req.language}.\n<paper>\n${req.source_text}\n</paper>\nCare steps:\n${steps}`,
      },
    ],
  });
  if (msg.stop_reason === "refusal") throw new ExtractError("The AI declined to write questions for this paper.", 422);
  const parsed = ModelOutput.safeParse(msg.parsed_output);
  if (!parsed.success) throw new ExtractError("The AI returned malformed questions. Try again.", 502);
  return { ...checkQuestions(req.source_text, req.items, parsed.data.questions), model: MODEL, ms: Date.now() - t0 };
}
