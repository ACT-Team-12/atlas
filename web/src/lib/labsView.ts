/**
 * "Explain my lab results", the concise view (Akhil's pattern from the care steps, PR 73). Pure functions, no AI, safe
 * in the browser (results.ts holds the AI call, so the page imports its types only and its helpers from here).
 *
 * Our code, not the AI, decides what is outside the range (results.ts, judgeRow). This file only decides how a row
 * shows, by the paper-first rule (paperFirst.ts):
 *
 * - A closed row carries the report's own words only: the test name as printed on the line, the value and the range
 *   exactly as printed, and our code's High / Low chip. No AI-written word is on a closed row.
 * - The AI's plain name for the test and its "ask your clinic" question are never double-checked, so they appear only
 *   next to the report's own line: in the opened row after the line, and in the questions list with the line.
 * - A line the report marks critical or panic (or HH / LL) is loud on its row and opens by itself.
 */

import type { ResultRow } from "./results";

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Finds the test name on the line, ignoring case and punctuation ("Glucose Fasting" finds "Glucose, Fasting"), and
 * returns it as the line prints it. results.ts uses the same function to drop a row whose name is not on its line.
 */
export function findTestName(line: string, test: string): { text: string; start: number; end: number } | null {
  const words = test.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (!words.length) return null;
  const m = new RegExp(`(?<![\\p{L}\\p{N}])${words.map(escapeRe).join("[^\\p{L}\\p{N}]+")}(?![\\p{L}\\p{N}])`, "iu").exec(line);
  return m ? { text: m[0], start: m.index, end: m.index + m[0].length } : null;
}

/** A line the report itself marks critical or panic, or with a doubled flag (HH, LL). Read from the report's line only. */
export function isCritical(line: string): boolean {
  return /(?<![\p{L}\p{N}])(?:critical|panic)(?![\p{L}\p{N}])/iu.test(line) || /(?:^|[\s(\[*])(?:HH|LL)(?=$|[\s)\]*!])/.test(line);
}

/**
 * isCritical on the line with the test name blanked out, so a name never makes a line critical and a marker anywhere
 * else on it (before the value too: "CRITICAL Potassium 4.0") does. results.ts (judgeRow) and the row use this one rule.
 */
export function criticalOnLine(line: string, test: string): boolean {
  const name = findTestName(line, test);
  return isCritical(name ? line.slice(0, name.start) + " ".repeat(name.text.length) + line.slice(name.end) : line);
}

export type LabChip ={ label: string; tone: "high" | "low" | "flag" | "inside" | "unknown" };

/** The chip on a row, from our code's decision (status and direction), never from the AI. */
export function labChip(r: Pick<ResultRow, "status" | "direction">): LabChip {
  if (r.status === "outside") return r.direction === "high" ? { label: "High", tone: "high" } : r.direction === "low" ? { label: "Low", tone: "low" } : { label: "Flagged", tone: "flag" };
  if (r.status === "inside") return { label: "In range", tone: "inside" };
  return { label: "Can't tell", tone: "unknown" };
}

/** What a closed row shows: every part copied from the report's own line. */
export type LabClosedRow = { name: string; value: string; unit: string; range: string; critical: boolean };

export function labClosedRow(r: Pick<ResultRow, "quote" | "test" | "value" | "unit" | "range_text">): LabClosedRow {
  // checkRows keeps a row only when the name is on its line, so the fallback (the start of the line) is a safety net.
  const name = findTestName(r.quote, r.test)?.text ?? r.quote.split(/\s{2,}|\t/)[0].trim();
  return { name, value: r.value, unit: r.unit, range: r.range_text, critical: criticalOnLine(r.quote, r.test) };
}

/** The rows by what our code decided: outside first, then the ones it couldn't tell, then the ones in range. */
export function labGroups(rows: ResultRow[]) {
  return {
    flagged: rows.filter((r) => r.status === "outside"),
    unsure: rows.filter((r) => r.status === "unknown"),
    inRange: rows.filter((r) => r.status === "inside"),
  };
}

/** One "Ask your clinic" question, always with the report line it is about. */
export type LabQuestion = { ask: string; line: string };

/** The questions for the rows that are outside the range or that we couldn't tell, in the order shown. */
export function labQuestions(rows: ResultRow[]): LabQuestion[] {
  const { flagged, unsure } = labGroups(rows);
  return [...flagged, ...unsure].filter((r) => r.ask.trim()).map((r) => ({ ask: r.ask.trim(), line: r.quote }));
}

/** What Copy puts on the clipboard: each question with its report line, so the question never travels without it. */
export function labQuestionsText(qs: LabQuestion[]): string {
  return qs.map((q, i) => `${i + 1}. ${q.ask}\n   Your report says: "${q.line}"`).join("\n");
}
