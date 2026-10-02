import evalSet from "@/data/eval/papers.json";
import { findSpan, normalize } from "./verify";

/**
 * Live test of our own quote checker (no AI involved, recomputed on every request).
 * For each sample paper: every real instruction from the answer key must be ACCEPTED, and planted fakes built from
 * those instructions (a changed number, a swapped word, a flipped meaning, an invented medicine) must be CAUGHT.
 */

export type Paper = { id: string; title: string; text: string; expected: string[]; distractors: string[]; has_warning: boolean };
export const PAPERS = (evalSet as unknown as { papers: Paper[] }).papers;

const SWAPS: [string, string][] = [
  ["morning", "evening"], ["daily", "weekly"], ["days", "weeks"], ["week", "month"], ["once", "twice"], ["before", "after"],
];
const INVENTED = [
  "Take warfarin 5 mg by mouth every night",
  "Double your dose if you feel worse",
  "Stop all of your medicines before the lab",
  "Take 2 aspirin every 4 hours",
];

// A dose, count or interval ("500 mg", "2 times", "3 months"); else any standalone number. Never a digit inside a
// word, so "A1c" stays "A1c" and the number a patient acts on is the one that changes.
const DOSE_OR_INTERVAL = /\b\d+(?:\.\d+)?(?=\s*(?:mg|mcg|ml|units?|tablets?|capsules?|puffs?|drops?|times?|hours?|days?|weeks?|months?|years?)\b)/i;
const STANDALONE_NUMBER = /\b\d+(?:\.\d+)?\b/;

export function fakesFor(real: string): { kind: string; text: string }[] {
  const out: { kind: string; text: string }[] = [];
  const num = DOSE_OR_INTERVAL.exec(real) ?? STANDALONE_NUMBER.exec(real);
  if (num) {
    const changed = String(Number(num[0]) * 10);
    out.push({ kind: "changed number", text: real.slice(0, num.index) + changed + real.slice(num.index + num[0].length) });
  }
  for (const [a, b] of SWAPS) {
    const re = new RegExp(`\\b${a}\\b`, "i");
    if (re.test(real)) { out.push({ kind: "swapped word", text: real.replace(re, b) }); break; }
  }
  out.push({ kind: "flipped meaning", text: `Do not ${real.charAt(0).toLowerCase()}${real.slice(1)}` });
  return out;
}

export type CheckerReport = {
  papers: number;
  real: { total: number; accepted: number; misses: string[] };
  fakes: { total: number; caught: number; slipped: { paper: string; kind: string; text: string }[]; byKind: Record<string, { total: number; caught: number }> };
  skipped: number;
};

export function runCheckerTest(): CheckerReport {
  const report: CheckerReport = { papers: PAPERS.length, real: { total: 0, accepted: 0, misses: [] }, fakes: { total: 0, caught: 0, slipped: [], byKind: {} }, skipped: 0 };
  for (const p of PAPERS) {
    const norm = normalize(p.text);
    const fakes: { kind: string; text: string }[] = [];
    for (const real of p.expected) {
      report.real.total++;
      if (findSpan(p.text, real)) report.real.accepted++;
      else report.real.misses.push(`${p.id}: ${real}`);
      fakes.push(...fakesFor(real));
    }
    INVENTED.forEach((t) => fakes.push({ kind: "invented instruction", text: t }));
    for (const f of fakes) {
      // A "fake" that happens to appear in the paper is not a fake; skip it rather than count it either way.
      if (norm.includes(normalize(f.text))) { report.skipped++; continue; }
      const k = (report.fakes.byKind[f.kind] ??= { total: 0, caught: 0 });
      report.fakes.total++; k.total++;
      if (!findSpan(p.text, f.text)) { report.fakes.caught++; k.caught++; }
      else report.fakes.slipped.push({ paper: p.id, ...f });
    }
  }
  return report;
}
