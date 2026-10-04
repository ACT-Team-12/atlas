import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { ExtractError, MODEL } from "./extract";
import { LANGUAGES } from "./schema";
import { findSpanIn, mapSource, type MappedSource } from "./verify";
import { criticalOnLine, findTestName, isCritical } from "./labsView";

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
/** Which result lines of the report our code found, and how many of them a kept row covers. */
export type Coverage = { candidates: number; checked: number; unchecked: string[] };
export type ResultsResponse = {
  rows: ResultRow[];
  dropped: { test: string; reason: DropReason }[];
  counts: { outside: number; inside: number; unknown: number };
  coverage: Coverage;
  model: string; ms: number;
};

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One side of a range or of a measured value: a number, and whether the number itself is included. */
export type Bound = { at: number; incl: boolean };
/** An interval. A missing side is open-ended. A plain measured value is a single point (both sides included). */
export type Interval = { lo: Bound | null; hi: Bound | null };

const N = String.raw`-?\d+(?:\.\d+)?`;
const DASH = String.raw`\s*(?:-|–|to)\s*`;

/** A range as printed: "70-99", "70 - 99", "<200", "<= 5.7", ">=60", "≥ 60", "> 40". "<" and ">" exclude the limit. */
export function parseRange(r: string): Interval | null {
  const t = r.replace(/,/g, "").trim();
  let m = t.match(new RegExp(`^(${N})${DASH}(${N})$`));
  if (m) return { lo: { at: Number(m[1]), incl: true }, hi: { at: Number(m[2]), incl: true } };
  m = t.match(new RegExp(`^(<=|≤|<|less than|under)\\s*(${N})$`, "i"));
  if (m) return { lo: null, hi: { at: Number(m[2]), incl: /=|≤/.test(m[1]) } };
  m = t.match(new RegExp(`^(>=|≥|>|greater than|over)\\s*(${N})$`, "i"));
  if (m) return { lo: { at: Number(m[2]), incl: /=|≥/.test(m[1]) }, hi: null };
  return null;
}

/** A measured value as printed: "126" is a point, "<0.5" is everything below 0.5, ">=200" is 200 and up. */
export function parseValue(v: string): Interval | null {
  const m = v.replace(/,/g, "").trim().match(new RegExp(`^(<=|>=|≤|≥|<|>)?\\s*(${N})$`));
  if (!m) return null;
  const at = Number(m[2]), op = m[1] ?? "";
  if (!op) return { lo: { at, incl: true }, hi: { at, incl: true } };
  if (op === "<" || op === "<=" || op === "≤") return { lo: null, hi: { at, incl: op !== "<" } };
  return { lo: { at, incl: op !== ">" }, hi: null };
}

/** Where a measured value falls against a range. "unknown" unless the whole value is on one side. */
export function classify(v: Interval, r: Interval): "inside" | "high" | "low" | "unknown" {
  if (r.hi && v.lo && (v.lo.at > r.hi.at || (v.lo.at === r.hi.at && (!r.hi.incl || !v.lo.incl)))) return "high";
  if (r.lo && v.hi && (v.hi.at < r.lo.at || (v.hi.at === r.lo.at && (!r.lo.incl || !v.hi.incl)))) return "low";
  const underTop = !r.hi || (!!v.hi && (v.hi.at < r.hi.at || (v.hi.at === r.hi.at && (r.hi.incl || !v.hi.incl))));
  const overBottom = !r.lo || (!!v.lo && (v.lo.at > r.lo.at || (v.lo.at === r.lo.at && (r.lo.incl || !v.lo.incl))));
  return underTop && overBottom ? "inside" : "unknown";
}

/**
 * A High/Low flag in a piece of a printed line: H, L, HH, LL, (H), (L), H*, High, Low, Abnormal, Critical.
 * judgeRow only passes the part of the line after the value with the range and unit taken out, so a test name
 * ("High Sensitivity CRP", "High-density lipoprotein") or a unit ("mg/L") is never read as a flag.
 */
export function printedFlag(text: string): "high" | "low" | "abnormal" | null {
  const t = text.replace(/\b(high|low)[- ]?(density|sensitivity)\b/gi, " ");
  const letter = (c: string) => new RegExp(`(?:^|[\\s(\\[*])(?:${c}${c}|${c})(?=$|[\\s)\\]*!])`).test(t);
  if (letter("H") || /\bhigh\b/i.test(t)) return "high";
  if (letter("L") || /\blow\b/i.test(t)) return "low";
  if (/\b(abnormal|critical|panic|out of range)\b/i.test(t)) return "abnormal";
  return null;
}

const NUMC = String.raw`(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?`;
// A number standing on its own (not part of "T4", "B12", "25-Hydroxy", "x10^3" or "1.73m2"), maybe with < > <= >= or a minus.
const ATOM = new RegExp(String.raw`(?<=^|[\s(\[:=])(?:<=|>=|≤|≥|<|>)?\s?-?${NUMC}(?=$|[\s)\]%;*]|,(?!\d)|[a-zA-Zµμ/])`, "g");
// A range printed on a line: "70-99", "4.0 - 11.0", "150,000-400,000", "-2 to 3", "<200", ">=60". Never part of a date.
const RANGE = new RegExp(String.raw`(?<![\w.^/-])(?:(?:<=|>=|≤|≥|<|>)\s*-?${NUMC}|-?${NUMC}\s*(?:-|–|to)\s*-?${NUMC})(?![\w.]|-\d)`, "g");

/** Short report marks beyond printedFlag's: A, ABN, CRIT, hh/ll/h/l in any case, or a standalone "!" or "*". */
const OTHER_MARK = /(?:^|[\s(\[])(?:A|[Aa][Bb][Nn]|[Cc][Rr][Ii][Tt]|[HhLl]{1,2})(?=$|[\s)\]*!])|(?:^|\s)[!*]+(?=$|\s)/;

type Span = { text: string; start: number; end: number };
const spans = (re: RegExp, s: string): Span[] => [...s.matchAll(re)].map((m) => ({ text: m[0], start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }));
const inside = (a: Span, b: Span) => a.start >= b.start && a.end <= b.end;

/** The test name as printed on the line (labsView.ts, shared with the page). */
const findName = findTestName;

type LineRead = {
  value: Span; valueRange: Interval; range: Interval | null; rangeText: string;
  flag: "high" | "low" | "abnormal" | null; loneL: boolean; unitSeen: boolean;
  /** Where the value falls against each range the line prints after it. More than one that disagree: we can't tell. */
  verdicts: ("inside" | "high" | "low" | "unknown")[];
  /** A flag anywhere on the line, read with nothing the AI returned taken out (only the ranges and the value). */
  lineMark: "high" | "low" | "abnormal" | null;
};

/**
 * Reads one printed line the way our code (not the AI) sees it. The value is the first number standing on its own
 * after the test name that is not part of a range. The range is one the line itself prints (the AI's range only picks
 * between several). The flag is looked for only after the value, with the range and the unit taken out.
 */
function readLine(line: string, r: Pick<ModelRow, "test" | "unit" | "range_text">): LineRead | null {
  const name = findName(line, r.test);
  if (!name) return null;
  const ranges = spans(RANGE, line).filter((s) => s.start >= name.end && parseRange(s.text));
  const dashRanges = ranges.filter((s) => !/^[<>≤≥]/.test(s.text));
  const value = spans(ATOM, line).find((a) => a.start >= name.end && !dashRanges.some((d) => inside(a, d)));
  if (!value) return null;
  const valueRange = parseValue(value.text);
  if (!valueRange) return null;
  const others = ranges.filter((s) => !(s.start <= value.start && s.end >= value.end));
  const want = r.range_text.replace(/[\s,]/g, "");
  const pick = others.find((s) => want && s.text.replace(/[\s,]/g, "") === want.replace(/≤/g, "<=").replace(/≥/g, ">=")) ??
    others.find((s) => want && (s.text.match(/\d[\d.]*/g) ?? []).join(" ") === (r.range_text.replace(/,/g, "").match(/\d[\d.]*/g) ?? []).join(" ")) ??
    (others.length === 1 ? others[0] : undefined);
  // The part of the line after the value, with every range blanked out.
  let tail = line.slice(value.end);
  for (const s of ranges) if (s.start >= value.end) tail = tail.slice(0, s.start - value.end) + " ".repeat(s.text.length) + tail.slice(s.end - value.end);
  // Take out the unit once, so a liter "L" or "mg/L" is never read as Low.
  const unit = r.unit.trim();
  const at = unit ? new RegExp(`(?<=^|\\s)${escapeRe(unit)}(?=$|\\s)`).exec(tail) : null;
  if (at) tail = tail.slice(0, at.index) + " ".repeat(unit.length) + tail.slice(at.index + unit.length);
  const words = tail.trim().split(/\s+/).filter(Boolean);
  // The whole line with only our code's spans blanked (the ranges and the value), never the AI's name or unit.
  let whole = line;
  // No exception, not even a liter "L": the unit is the AI's word, and an AI field may only add caution (security
  // review). "1.8 L 0.8-2.0" is "can't tell", shown, never folded as in range.
  for (const s of [...spans(RANGE, line), value]) whole = whole.slice(0, s.start) + " ".repeat(s.end - s.start) + whole.slice(s.end);
  return {
    verdicts: others.map((s) => parseRange(s.text)).filter((x): x is Interval => !!x).map((x) => classify(valueRange, x)),
    // Also short marks printedFlag doesn't name (A, ABN, CRIT, "!", lowercase hh/ll/h/l): any of them keeps a line
    // out of "in range" (security review). Over-cautious on purpose: "Vitamin A" reads as can't tell.
    lineMark: printedFlag(whole) ?? (OTHER_MARK.test(whole) ? "abnormal" : null),
    value, valueRange, range: pick ? parseRange(pick.text) : null, rangeText: pick ? pick.text.trim() : "",
    flag: printedFlag(tail), loneL: !at && words.length === 1 && words[0] === "L", unitSeen: !!at,
  };
}

/**
 * The deterministic part: decide inside / outside / unknown from the line itself. `quote` must be the report's own
 * line (checkRows passes the full line it found, never the AI's copy), so a flag or range the AI adds, drops or
 * moves from another line changes nothing.
 */
export function judgeRow(r: ModelRow): Omit<ResultRow, keyof ModelRow> {
  const judged = failClosed(r, judgeByValue(r));
  // A line the report marks critical or panic (anywhere on it but the test name, before the value too) is never in
  // range and never "can't tell": a range check must not give it an all-clear (Codex review).
  if (criticalOnLine(r.quote) && judged.status !== "outside") {
    return { status: "outside", direction: null, reason: "Your report marks this line critical." };
  }
  return judged;
}

/**
 * Fail closed on what the AI's own fields could hide (security review): a mark on the line that the AI's test name or
 * unit absorbed ("Potassium H 4.0", unit "H"), or two printed ranges that disagree (the AI's range_text picks one).
 * Either way an "inside" becomes "can't tell", which stays visible and never counts toward an all-clear.
 */
function failClosed(r: ModelRow, judged: Omit<ResultRow, keyof ModelRow>): Omit<ResultRow, keyof ModelRow> {
  if (judged.status !== "inside") return judged;
  const read = readLine(r.quote, r);
  if (!read) return judged;
  // The AI's test name decides where the value search starts. Any number standing on its own before the value we read
  // (inside the name or before it: "Glucose 250 previous result 80" named "previous result") may be the real result,
  // so the line can't be in range (security review).
  if (spans(ATOM, r.quote).some((a) => a.start < read.value.start)) return { status: "unknown", direction: null, reason: "This line has a number before the result we read, so we can't be sure which number is the result. Look at the line, or ask your clinic." };
  if (new Set(read.verdicts).size > 1) return { status: "unknown", direction: null, reason: "Your report prints more than one range on this line, and they disagree. Ask your clinic which one applies." };
  if (read.lineMark) return { status: "unknown", direction: null, reason: "Your report has a mark on this line we couldn't place. Look at the line, or ask your clinic." };
  return judged;
}

function judgeByValue(r: ModelRow): Omit<ResultRow, keyof ModelRow> {
  const read = readLine(r.quote, r);
  if (!read) return { status: "unknown", direction: null, reason: "We couldn't find this result on the line." };
  const { value, valueRange, range, rangeText, flag, loneL } = read;
  const byRange = range ? classify(valueRange, range) : null;
  if (loneL) {
    // "3.0 L 2.0-4.0": the L right after the number may be liters or Low. Only the printed range can settle it.
    if (byRange === "low") return { status: "outside", direction: "low", reason: `${value.text} is below the range printed on your report (${rangeText}).` };
    if (byRange === "high") return { status: "outside", direction: "high", reason: `${value.text} is above the range printed on your report (${rangeText}).` };
    return { status: "unknown", direction: null, reason: "Your report shows an L after the number. It may mean liters, or it may mean low. Ask your clinic." };
  }
  if (flag === "high" || flag === "low") return { status: "outside", direction: flag, reason: "Your report marks this line as " + flag + "." };
  if (flag === "abnormal") return { status: "outside", direction: null, reason: "Your report marks this line as abnormal." };
  if (byRange === "high") return { status: "outside", direction: "high", reason: `${value.text} is above the range printed on your report (${rangeText}).` };
  if (byRange === "low") return { status: "outside", direction: "low", reason: `${value.text} is below the range printed on your report (${rangeText}).` };
  if (byRange === "inside") return { status: "inside", direction: null, reason: `Inside the range printed on your report (${rangeText}).` };
  if (byRange === "unknown") return { status: "unknown", direction: null, reason: `Your report prints this as ${value.text}, so we can't tell where it falls against the range (${rangeText}).` };
  return { status: "unknown", direction: null, reason: "Your report doesn't print a range we can read for this one." };
}

/** The whole printed line the quote sits on, or why it can't be used. */
function lineOf(source: string, paper: MappedSource, quote: string): { line: string } | { reason: DropReason } {
  const span = findSpanIn(paper, quote);
  if (!span) return { reason: "not_in_report" };
  if (/[\r\n]/.test(source.slice(span.start, span.end))) return { reason: "not_one_line" };
  const start = source.lastIndexOf("\n", span.start - 1) + 1;
  const nl = source.indexOf("\n", span.end);
  return { line: source.slice(start, nl < 0 ? source.length : nl).trim() };
}

/** True when every word on the line is a critical marker or a heading word, so nothing on it names a test. */
const HEADING_WORDS = new Set(["critical", "panic", "hh", "ll", "value", "values", "result", "results", "lab", "labs", "range", "ranges", "alert", "alerts", "section", "list", "notification", "notifications", "and", "or", "page", "of", "continued", "cont"]);
function isCriticalHeading(line: string): boolean {
  // Page and count marks ("PAGE 2", "2 of 3", "(2)", "#2") are not a result value (Codex review, round 2).
  const bare = line.replace(/\bpage\s*\d+(?:\s*(?:of|\/)\s*\d+)?/giu, " ").replace(/\b\d+\s*(?:of|\/)\s*\d+\b/giu, " ").replace(/[(#[]\s*\d+\s*[)\]]?/gu, " ");
  if (/\p{N}/u.test(bare)) return false;
  return (line.match(/[\p{L}]+/gu) ?? []).every((w) => HEADING_WORDS.has(w.toLowerCase()));
}

/** Lines that look like a test result: a number standing on its own, plus a printed range or a High/Low flag. */
export function resultLines(source: string): string[] {
  const seen = new Set<string>();
  for (const raw of source.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || seen.has(line)) continue;
    // A line the report marks critical or panic counts even with no number we can read ("Troponin unable to calculate
    // CRITICAL"), so it is never left out of the coverage count (security review). A heading made only of the marker
    // and heading words ("CRITICAL VALUES", "*** Panic results ***") is not a result, so it raises no alarm (Codex review).
    if (isCritical(line)) { if (!isCriticalHeading(line)) seen.add(line); continue; }
    if (!spans(ATOM, line).length) continue;
    if (spans(RANGE, line).some((s) => parseRange(s.text)) || printedFlag(line)) seen.add(line);
  }
  return [...seen];
}

export function checkRows(source: string, rows: ModelRow[]): Pick<ResultsResponse, "rows" | "dropped" | "counts" | "coverage"> {
  const out: ResultRow[] = [];
  const dropped: ResultsResponse["dropped"] = [];
  const paper = mapSource(source);
  for (const r of rows) {
    const at = lineOf(source, paper, r.quote);
    if ("reason" in at) { dropped.push({ test: r.test, reason: at.reason }); continue; }
    const { line } = at;
    // The test name must be printed on that line, so a real line can't be shown under another test's name.
    if (!findName(line, r.test)) { dropped.push({ test: r.test, reason: "test_not_in_line" }); continue; }
    // The value must be the line's own result: the first number after the name that is not part of a range,
    // with the same < or > and the same sign. A range limit or a number from the unit can't pass as the result.
    const read = readLine(line, r);
    const mine = parseValue(r.value);
    const same = (a: Bound | null, b: Bound | null) => (a === null && b === null) || (!!a && !!b && a.at === b.at && a.incl === b.incl);
    if (!read || !mine || !same(mine.lo, read.valueRange.lo) || !same(mine.hi, read.valueRange.hi)) { dropped.push({ test: r.test, reason: "value_not_in_quote" }); continue; }
    const row = { ...r, quote: line, value: read.value.text.trim(), range_text: read.rangeText, unit: read.unitSeen ? r.unit.trim() : "" };
    out.push({ ...row, ...judgeRow(row) });
  }
  const counts = { outside: 0, inside: 0, unknown: 0 };
  for (const r of out) counts[r.status]++;
  // Outside first, then unknown, then inside.
  const order: Record<ResultStatus, number> = { outside: 0, unknown: 1, inside: 2 };
  out.sort((a, b) => order[a.status] - order[b.status]);
  const candidates = resultLines(source);
  const covered = new Set(out.map((r) => r.quote));
  // Every critical line, first; the 40-line cap applies only to the rest, so it never drops one (security review,
  // Codex review round 2). The page names how many were left off.
  const unchecked = candidates.filter((l) => !covered.has(l));
  const shown = [...unchecked.filter(isCritical), ...unchecked.filter((l) => !isCritical(l)).slice(0, 40)];
  return { rows: out, dropped, counts, coverage: { candidates: candidates.length, checked: candidates.length - unchecked.length, unchecked: shown } };
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

/**
 * Lab results from a photo or screenshot. The AI only copies the report into text lines here; nothing is judged.
 * The person checks that text against their screen and fixes it, and only then does the text path above run, so every
 * row still quotes a line from text the person confirmed.
 */
export const ResultsReadRequestSchema = z.object({
  image_base64: z.string().min(100, "Add a photo or screenshot of your lab results.").max(8_000_000, "That photo is too large. Try a smaller one."),
  image_media_type: z.enum(["image/jpeg", "image/png", "image/webp", "image/gif"]),
});
export type ResultsReadRequest = z.infer<typeof ResultsReadRequestSchema>;
export type ResultsReadResponse = { text: string; model: string; ms: number };

const ReadOutput = z.object({ readable: z.boolean(), text: z.string() });

const READ_SYSTEM = `You copy a photo or screenshot of a lab report into plain text. You do not explain or judge anything.
Write one line per test result, keeping what is printed on that row in order: test name, result, units, reference range, and any flag (such as H, L, High, Low).
Copy every number exactly as printed, including <, >, = signs, commas and decimal points. Do not round, convert, fix or guess a number. If part of a number can't be read, write [unreadable] in its place.
Keep section headings (like LIPID PANEL) on their own lines. Leave out names, dates of birth, addresses, phone numbers, account or record numbers and barcodes.
If the image is not a lab report, set readable to false and leave text empty.`;

export async function readLabPhoto(req: ResultsReadRequest): Promise<ResultsReadResponse> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ExtractError("Server is missing its AI key. Tell the ATLAS team.", 503);
  const t0 = Date.now();
  const client = new Anthropic({ apiKey });
  const msg = await client.messages.parse({
    model: MODEL,
    max_tokens: 6000,
    system: READ_SYSTEM,
    output_config: { effort: "low", format: zodOutputFormat(ReadOutput) },
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: req.image_media_type, data: req.image_base64 } },
        { type: "text", text: "Copy the lab results in this image into text lines." },
      ],
    }],
  });
  if (msg.stop_reason === "refusal") throw new ExtractError("The AI declined to read this photo.", 422);
  const parsed = ReadOutput.safeParse(msg.parsed_output);
  if (!parsed.success) throw new ExtractError("The AI returned a malformed answer. Try again.", 502);
  const text = parsed.data.text.trim();
  if (!parsed.data.readable || text.length < 20) {
    throw new ExtractError("We couldn't find lab results in that photo. Try a clearer photo, or paste the text.", 422);
  }
  return { text, model: MODEL, ms: Date.now() - t0 };
}
