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
export type DropReason = "not_in_report" | "not_one_line" | "test_not_in_line" | "value_not_in_quote";
export type ResultsResponse = {
  rows: ResultRow[];
  dropped: { test: string; reason: DropReason }[];
  counts: { outside: number; inside: number; unknown: number };
  model: string; ms: number;
};

const NUM = /-?\d+(?:\.\d+)?/;
const num = (s: string) => { const m = s.replace(/,/g, "").match(NUM); return m ? Number(m[0]) : null; };
const tokens = (s: string): string[] => s.replace(/,/g, "").match(/\d+(?:\.\d+)?/g) ?? [];
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const letters = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/** A range as printed: "70-99", "70 - 99", "<200", "< 5.7", ">=60", "≥ 60", "> 40". null when it isn't one of these. */
export function parseRange(r: string): { lo: number | null; hi: number | null } | null {
  const t = r.replace(/,/g, "").trim();
  let m = t.match(/^(-?\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(-?\d+(?:\.\d+)?)$/);
  if (m) return { lo: Number(m[1]), hi: Number(m[2]) };
  m = t.match(/^(<=?|≤|less than|under)\s*(-?\d+(?:\.\d+)?)$/i);
  if (m) return { lo: null, hi: Number(m[2]) };
  m = t.match(/^(>=?|≥|greater than|over)\s*(-?\d+(?:\.\d+)?)$/i);
  if (m) return { lo: Number(m[2]), hi: null };
  return null;
}

/** A High/Low flag printed in the report's own line ("H", "L", "High", "Low", "Abnormal", "Critical"). */
export function printedFlag(quote: string): "high" | "low" | "abnormal" | null {
  // "High-density" and "Low-density" are part of a test name, not a flag.
  const q = quote.replace(/\b(high|low)[- ]?density\b/gi, " ");
  if (/\b(high|hh)\b|(?:^|\s)\(?H\)?(?=\s|$)/i.test(q)) return "high";
  if (/\b(low|ll)\b|(?:^|\s)\(?L\)?(?=\s|$)/i.test(q)) return "low";
  if (/\b(abnormal|critical|out of range)\b/i.test(q)) return "abnormal";
  return null;
}

// Every range printed on a line: "70-99", "4.0 - 11.0", "<200", ">=60", "≤3.0".
const RANGE_ON_LINE = /(?:<=|>=|≤|≥|<|>)\s*\d+(?:\.\d+)?|\d+(?:\.\d+)?\s*(?:-|–|to)\s*\d+(?:\.\d+)?/g;

/**
 * Reads one printed line the way our code (not the AI) sees it: the line without the test name, with thousands
 * commas taken out of numbers, the range printed on it, and the numbers left once that range is set aside.
 * The AI's range is used only to pick between ranges the line itself prints; a range the line doesn't print is ignored.
 */
function readLine(line: string, r: Pick<ModelRow, "test" | "value" | "range_text">) {
  const noName = r.test.trim() ? line.replace(new RegExp(escapeRe(r.test.trim()), "ig"), " ") : line;
  const plain = noName.replace(/(\d),(?=\d{3}\b)/g, "$1");
  let found = [...plain.matchAll(RANGE_ON_LINE)].filter((m) => parseRange(m[0]));
  // A value printed like "<0.5" looks like a range; set it aside when the line prints another one.
  const bare = (s: string) => s.replace(/[\s,]/g, "");
  if (found.length > 1) found = found.filter((m) => bare(m[0]) !== bare(r.value));
  const want = tokens(r.range_text);
  const pick = found.find((m) => want.length > 0 && tokens(m[0]).join(" ") === want.join(" ")) ?? (found.length === 1 ? found[0] : undefined);
  const rest = pick ? plain.slice(0, pick.index) + " " + plain.slice(pick.index + pick[0].length) : plain;
  return { flag: printedFlag(noName), rangeText: pick ? pick[0].trim() : "", range: pick ? parseRange(pick[0]) : null, numbers: tokens(rest) };
}

/**
 * The deterministic part: decide inside / outside / unknown from the line itself. `quote` must be the report's own
 * line (checkRows passes the full line it found, never the AI's copy), so a flag or range the AI adds, drops or
 * moves from another line changes nothing.
 */
export function judgeRow(r: ModelRow): Omit<ResultRow, keyof ModelRow> {
  const { flag, range, rangeText } = readLine(r.quote, r);
  const v = num(r.value);
  if (flag === "high" || flag === "low") return { status: "outside", direction: flag, reason: "Your report marks this line as " + (flag === "high" ? "high" : "low") + "." };
  if (flag === "abnormal") return { status: "outside", direction: null, reason: "Your report marks this line as abnormal." };
  if (range && v !== null) {
    if (range.hi !== null && v > range.hi) return { status: "outside", direction: "high", reason: `${r.value} is above the range printed on your report (${rangeText}).` };
    if (range.lo !== null && v < range.lo) return { status: "outside", direction: "low", reason: `${r.value} is below the range printed on your report (${rangeText}).` };
    return { status: "inside", direction: null, reason: `Inside the range printed on your report (${rangeText}).` };
  }
  return { status: "unknown", direction: null, reason: "Your report doesn't print a range we can read for this one." };
}

/** The whole printed line the quote sits on, or why it can't be used. */
function lineOf(source: string, quote: string): { line: string } | { reason: DropReason } {
  const span = findSpan(source, quote);
  if (!span) return { reason: "not_in_report" };
  if (/[\r\n]/.test(source.slice(span.start, span.end))) return { reason: "not_one_line" };
  const start = source.lastIndexOf("\n", span.start - 1) + 1;
  const nl = source.indexOf("\n", span.end);
  return { line: source.slice(start, nl < 0 ? source.length : nl).trim() };
}

export function checkRows(source: string, rows: ModelRow[]): Pick<ResultsResponse, "rows" | "dropped" | "counts"> {
  const out: ResultRow[] = [];
  const dropped: ResultsResponse["dropped"] = [];
  for (const r of rows) {
    const at = lineOf(source, r.quote);
    if ("reason" in at) { dropped.push({ test: r.test, reason: at.reason }); continue; }
    const { line } = at;
    // The test name must be printed on that line, so a real line can't be shown under another test's name.
    if (!letters(r.test) || !letters(line).includes(letters(r.test))) { dropped.push({ test: r.test, reason: "test_not_in_line" }); continue; }
    // The value must be a number printed on that line outside its range, so a range limit can't pass as the result.
    const { numbers, rangeText } = readLine(line, r);
    if (!tokens(r.value).length || !tokens(r.value).every((t) => numbers.includes(t))) { dropped.push({ test: r.test, reason: "value_not_in_quote" }); continue; }
    const unit = r.unit && letters(line).includes(letters(r.unit)) ? r.unit : "";
    const row = { ...r, quote: line, range_text: rangeText, unit };
    out.push({ ...row, ...judgeRow(row) });
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
