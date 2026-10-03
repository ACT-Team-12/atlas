import { INVENTED, PAPERS, fakesFor } from "./checkerTest";
import { findSpanIn, mapSource } from "./verify";
import type { Span } from "./deviceChecker";

/**
 * Cases for "same checker, server and this browser": every real instruction, distractor, planted fake and invented
 * instruction against its eval paper, with the span the SERVER's checker (verify.ts) found. The browser recomputes
 * each one with the WebAssembly checker and counts how many are identical.
 */
export type ParityCase = { paper: number; quote: string; server: Span | null };
export type ParitySet = { papers: string[]; cases: ParityCase[] };

export function deviceParitySet(): ParitySet {
  const cases: ParityCase[] = [];
  PAPERS.forEach((p, paper) => {
    const quotes = [...p.expected, ...p.distractors, ...p.expected.flatMap((e) => fakesFor(e).map((f) => f.text)), ...INVENTED];
    const mapped = mapSource(p.text);
    for (const quote of quotes) cases.push({ paper, quote, server: findSpanIn(mapped, quote) });
  });
  return { papers: PAPERS.map((p) => p.text), cases };
}
