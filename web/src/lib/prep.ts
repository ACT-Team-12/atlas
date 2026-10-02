import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ExtractError, MODEL } from "./extract";
import { buildPrepTimeline, PrepModelOutput, type PrepRequest, type PrepResponse } from "./prepTimeline";

const SYSTEM = `You read the instructions a clinic gave a person to get ready for a procedure (a colonoscopy, an endoscopy, a surgery, a scan).
List every instruction the person must act on: what to stop eating or drinking and when, medicines to stop, hold or take and when, bowel prep, what to bring, the arrival time and place, a ride requirement, and what to call the clinic about.
For each one return:
- kind: food_drink, medicine, bowel_prep, bring, arrival, ride, call, or other.
- plain_language: one or two short sentences in the requested language saying what to do, in plain words. Do not add any number, time, dose or day that is not in the quote.
- source_quote: the exact words from the paper, copied word for word from ONE line or sentence. Include the words that say when, if that line says when. Never join words from different lines. Never paraphrase. source_quote always stays in the paper's own language.
- ai_slot: when the quote says to do it: days_before, day_before, evening_before, hours_before, morning_of, arrival, after, or not_stated if the quote itself does not say.
Use ONLY what the paper says. Do not add medical advice. Skip headings, names, dates of birth, and lines that are not instructions.`;

/** Calls the model, then hands its answer to the deterministic part (prepTimeline.ts). */
export async function preparePrep(req: PrepRequest): Promise<PrepResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ExtractError("Server is missing its AI key. Tell the ATLAS team.", 503);
  const t0 = Date.now();
  const client = new Anthropic({ apiKey });
  const msg = await client.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    output_config: { effort: "low", format: zodOutputFormat(PrepModelOutput) },
    messages: [{ role: "user", content: JSON.stringify({ language: req.language, paper: req.text }) }],
  });
  if (msg.stop_reason === "refusal") throw new ExtractError("The AI declined to read this paper.", 422);
  const parsed = PrepModelOutput.safeParse(msg.parsed_output);
  if (!parsed.success) throw new ExtractError("The AI returned a malformed answer. Try again.", 502);
  return { ...buildPrepTimeline(req.text, parsed.data.items), model: MODEL, ms: Date.now() - t0 };
}
