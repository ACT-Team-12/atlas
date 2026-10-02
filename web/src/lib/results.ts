import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ExtractError, MODEL } from "./extract";
import { LANGUAGES } from "./schema";
import { findSpan } from "./verify";

/**
 * "Explain my lab results": asked for by a real patient on Oct 2 ("a summary option that only highlights what I
 * need to improve or cut back on"). The AI reads the report and explains each test in plain words. Our code,
 * not the AI, decides what is outside the range: only a High/Low flag printed on that line of the report, or a
 * value outside the range printed on that same line. Every row quotes its line, and no advice is given beyond
 * questions to ask the clinic.
 */

export const ResultsRequestSchema = z.object({
  text: z.string().min(20, "Paste the lab report as text (at least a few lines).").max(20000),
  language: z.enum(LANGUAGES).default("English"),
});
export type ResultsRequest = z.infer<typeof ResultsRequestSchema>;

const ModelRows = z.object({
  rows: z.array(z.object({
    test: z.string(),
    value: z.string(),
    unit: z.string(),
    range_text: z.string(),
    quote: z.string(),
    plain_name: z.string(),
    ask: z.string(),
  })),
});
type ModelRow = z.infer<typeof ModelRows>["rows"][number];

export type ResultStatus = "outside" | "inside" | "unknown";
export type ResultRow = {
  test: string; value: string; unit: string; range_text: string; quote: string; plain_name: string; ask: string;
  status: ResultStatus; direction: "high" | "low" | null; reason: string;
};
export type ResultsResponse = {
  rows: ResultRow[];
  dropped: { test: string; reason: "not_in_report" | "value_not_in_quote" }[];
  counts: { outside: number; inside: number; unknown: number };
  model: string; ms: number;
};

const NUM = /-?\d+(?:\.\d+)?/;
const num = (s: string) => { const m = s.replace(/,/g, "").match(NUM); return m ? Number(m[0]) : null; };
const tokens = (s: string): string[] => s.replace(/,/g, "").match(/\d+(?:\.\d+)?/g) ?? [];

/** A range as printed: "70-99", "70 - 99", "<200", "< 5.7", ">=60", "> 40". null when it isn't one of these. */
export function parseRange(r: string): { lo: number | null; hi: number | null } | null {
  const t = r.replace(/,/g, "").trim();
  let m = t.match(/^(-?\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return { lo: Number(m[1]), hi: Number(m[2]) };
  m = t.match(/^(<=?|less than|under)\s*(-?\d+(?:\.\d+)?)$/i);
  if (m) return { lo: null, hi: Number(m[2]) };
  m = t.match(/^(>=?|greater than|over)\s*(-?\d+(?:\.\d+)?)$/i);
  if (m) return { lo: Number(m[2]), hi: null };
  return null;
}

/** A High/Low flag printed in the report's own line ("H", "L", "High", "Low", "Abnormal", "Critical"). */
export function printedFlag(quote: string): "high" | "low" | "abnormal" | null {
  if (/\b(high|hh)\b|(?:^|\s)\(?H\)?(?=\s|$)/i.test(quote) && !/\bhigh[- ]?density\b/i.test(quote)) return "high";
  if (/\b(low|ll)\b|(?:^|\s)\(?L\)?(?=\s|$)/i.test(quote) && !/\blow[- ]?density\b/i.test(quote)) return "low";
  if (/\b(abnormal|critical|out of range)\b/i.test(quote)) return "abnormal";
  return null;
}

/** The deterministic part: decide inside / outside / unknown from the quote, the value and the printed range. */
export function judgeRow(r: ModelRow): Omit<ResultRow, keyof ModelRow> {
  const flag = printedFlag(r.quote.replace(new RegExp(r.test.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig"), " "));
  const range = tokens(r.range_text).every((t) => tokens(r.quote).includes(t)) ? parseRange(r.range_text) : null;
  const v = num(r.value);
  if (flag === "high" || flag === "low") return { status: "outside", direction: flag, reason: "Your report marks this line as " + (flag === "high" ? "high" : "low") + "." };
  if (flag === "abnormal") return { status: "outside", direction: null, reason: "Your report marks this line as abnormal." };
  if (range && v !== null) {
    if (range.hi !== null && v > range.hi) return { status: "outside", direction: "high", reason: `${r.value} is above the range printed on your report (${r.range_text}).` };
    if (range.lo !== null && v < range.lo) return { status: "outside", direction: "low", reason: `${r.value} is below the range printed on your report (${r.range_text}).` };
    return { status: "inside", direction: null, reason: `Inside the range printed on your report (${r.range_text}).` };
  }
  return { status: "unknown", direction: null, reason: "Your report doesn't print a range we can read for this one." };
}

export function checkRows(source: string, rows: ModelRow[]): Pick<ResultsResponse, "rows" | "dropped" | "counts"> {
  const out: ResultRow[] = [];
  const dropped: ResultsResponse["dropped"] = [];
  for (const r of rows) {
    if (!findSpan(source, r.quote)) { dropped.push({ test: r.test, reason: "not_in_report" }); continue; }
    if (!tokens(r.value).length || !tokens(r.value).every((t) => tokens(r.quote).includes(t))) { dropped.push({ test: r.test, reason: "value_not_in_quote" }); continue; }
    out.push({ ...r, ...judgeRow(r) });
  }
  const counts = { outside: 0, inside: 0, unknown: 0 };
  for (const r of out) counts[r.status]++;
  // Outside first, then unknown, then inside.
  const order: Record<ResultStatus, number> = { outside: 0, unknown: 1, inside: 2 };
  out.sort((a, b) => order[a.status] - order[b.status]);
  return { rows: out, dropped, counts };
}

const SYSTEM = `You read a person's lab report and list every test result on it.
For each result return: test (as printed), value (exactly as printed, digits only plus any < or >), unit, range_text (the reference range exactly as printed on that line, or "" if none), quote (the full line from the report, copied exactly), plain_name (one short sentence in the requested language saying what this test measures, in plain words, no judgment about the person), ask (one short question in the requested language the person could ask their clinic about this result).
Rules: copy quote, value and range_text exactly. Do not decide whether a result is high or low; our code does that from the report. Do not diagnose, do not suggest treatments, foods or doses. Skip lines that are not test results.`;

export async function explainResults(req: ResultsRequest): Promise<ResultsResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ExtractError("Server is missing its AI key. Tell the ATLAS team.", 503);
  const t0 = Date.now();
  const client = new Anthropic({ apiKey });
  const msg = await client.messages.parse({
    model: MODEL,
    max_tokens: 8000,
    system: SYSTEM,
    output_config: { effort: "low", format: zodOutputFormat(ModelRows) },
    messages: [{ role: "user", content: JSON.stringify({ language: req.language, report: req.text }) }],
  });
  if (msg.stop_reason === "refusal") throw new ExtractError("The AI declined to read this report.", 422);
  const parsed = ModelRows.safeParse(msg.parsed_output);
  if (!parsed.success) throw new ExtractError("The AI returned a malformed answer. Try again.", 502);
  return { ...checkRows(req.text, parsed.data.rows), model: MODEL, ms: Date.now() - t0 };
}
