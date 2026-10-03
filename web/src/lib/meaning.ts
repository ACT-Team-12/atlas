import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ExtractError } from "./extract";

/**
 * Meaning check: does each plain-language explanation say the same thing as the line it quotes?
 *
 * The span checker proves the quote is really in the paper. It cannot prove the explanation next to it
 * means the same thing. Two independent signals look for that:
 *  1. Numbers (no AI): every number in the explanation must appear in the step's quote or its "when" text.
 *  2. A second model (a different one from the model that wrote the explanation) compares action,
 *     timing, amount and who does it, and must say exactly what differs.
 * Either signal flags the step so the person double-checks it with their clinic.
 */

export const CHECKER_MODEL = process.env.ATLAS_CHECKER_MODEL ?? "claude-sonnet-5-5";

export const MeaningRequestSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.string().max(40),
        plain_language: z.string().max(800),
        when: z.string().max(200).default(""),
        source_quote: z.string().max(800),
      }),
    )
    .min(1)
    .max(40),
});
export type MeaningRequest = z.infer<typeof MeaningRequestSchema>;

export type MeaningResult = {
  id: string;
  flagged: boolean;
  numbers_ok: boolean;
  unexpected_numbers: string[];
  model_verdict: "same" | "different" | "unclear";
  what_differs: string;
  /** True only when the second model said "same" AND every number checks out. Only this earns the green check. */
  certified: boolean;
};
export type MeaningResponse = { results: MeaningResult[]; flagged: number; checker_model: string; ms: number };

const WORD_NUM: Record<string, string> = { one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10", twice: "2", once: "1" };

/** Numbers written as digits (1, 2.5, 2,000), plus common English number words, normalized. */
export function numbersIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\d+(?:[.,]\d+)*/g)) out.add(m[0].replace(/,(?=\d{3}\b)/g, ""));
  for (const m of text.toLowerCase().matchAll(/\b(one|two|three|four|five|six|seven|eight|nine|ten|twice|once)\b/g)) out.add(WORD_NUM[m[1]]);
  return [...out];
}

/**
 * Deterministic signal: numbers in the explanation that the quote (or when) does not contain.
 * A total the paper states elsewhere in the same quote is fine; an invented dose or interval is not.
 * Only digits count against the explanation, because number words differ by language.
 */
export function unexpectedNumbers(item: { plain_language: string; when?: string; source_quote: string }): string[] {
  const allowed = new Set([...numbersIn(item.source_quote), ...numbersIn(item.when ?? "")]);
  const digitsInPlain = [...item.plain_language.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => m[0].replace(/,(?=\d{3}\b)/g, ""));
  return [...new Set(digitsInPlain.filter((n) => !allowed.has(n)))];
}

const ModelOutput = z.object({
  results: z.array(z.object({ id: z.string(), verdict: z.enum(["same", "different", "unclear"]), what_differs: z.string() })),
});

const SYSTEM = `You check a patient-facing explanation against the exact line it came from in their after-visit paper.
The person sees three things together: the explanation, the "when" text, and the line from the paper itself. Judge the explanation plus "when" against the line.
Compare ONLY: the action (start, stop, take, avoid, call, go), the medicine or test, the amount or dose, how often, the condition for doing it (for example "as needed for wheezing"), when or how long, and who must act.
- "different": a point above is changed, reversed, or dropped in a way that could make the person do the wrong thing. You must be able to name the exact words in the line and the exact words in the explanation that clash. Put them in what_differs as: paper says "..." but explanation says "..." (or: explanation leaves out "...").
- "same": nothing above clashes. Simpler words, another language, added reasons, and a detail that appears in the "when" text are all fine.
- "unclear": you are not sure. Prefer "unclear" over guessing "different".
Do not invent words that are not in the line. Never judge whether the medical advice is good.`;

export function combine(id: string, item: MeaningRequest["items"][number], verdict: MeaningResult["model_verdict"], what: string): MeaningResult {
  const unexpected = unexpectedNumbers(item);
  return {
    id,
    numbers_ok: unexpected.length === 0,
    unexpected_numbers: unexpected,
    model_verdict: verdict,
    what_differs: verdict === "same" ? "" : what,
    flagged: unexpected.length > 0 || verdict === "different",
    // "unclear", or a step the checker skipped, is neither flagged nor certified: the UI says it could not double-check it.
    certified: verdict === "same" && unexpected.length === 0,
  };
}

/**
 * `signal` is the request's own: when the person clears the paper, deletes the plan or reads a new one, the model
 * call is cancelled instead of reading the excerpts for nobody.
 */
export async function checkMeaning(req: MeaningRequest, signal?: AbortSignal): Promise<MeaningResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ExtractError("Server is missing its AI key. Tell the ATLAS team.", 503);
  const client = new Anthropic({ apiKey });
  const t0 = Date.now();
  signal?.throwIfAborted();
  const msg = await client.messages.parse({
    model: CHECKER_MODEL,
    max_tokens: 6000,
    system: SYSTEM,
    output_config: { effort: "low", format: zodOutputFormat(ModelOutput) },
    messages: [{
      role: "user",
      content: JSON.stringify(req.items.map((i) => ({ id: i.id, line_from_paper: i.source_quote, when: i.when, explanation: i.plain_language }))),
    }],
  }, { signal });
  if (msg.stop_reason === "refusal") throw new ExtractError("The checker declined this request.", 422);
  const parsed = ModelOutput.safeParse(msg.parsed_output);
  if (!parsed.success) throw new ExtractError("The checker returned a malformed answer. Try again.", 502);
  const byId = new Map(parsed.data.results.map((r) => [r.id, r]));
  // An item the model skipped counts as unclear, never as checked.
  const results = req.items.map((i) => {
    const r = byId.get(i.id);
    return combine(i.id, i, r?.verdict ?? "unclear", r?.what_differs ?? "The checker did not return this step.");
  });
  return { results, flagged: results.filter((r) => r.flagged).length, checker_model: CHECKER_MODEL, ms: Date.now() - t0 };
}
