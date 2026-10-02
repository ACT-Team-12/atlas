"use client";

import { useEffect, useRef, useState } from "react";

/**
 * What the person sees during the 15 to 30 seconds the AI takes.
 * Honest by design: it lists what is actually happening and counts real seconds.
 * It never shows a fake progress bar or ticks off stages it can't observe.
 * Typical times: eval medians (read 11.9 s, plan 15.6 s, web/src/data/eval/results.json) and live runs on 2026-10-02 (about 20 s each).
 */
const COPY = {
  read: {
    title: "Reading your paper",
    typical: "Usually 10 to 25 seconds.",
    steps: [
      "The AI reads every line of your paper.",
      "Our own code looks for each step's exact words in your paper. A step it can't find is held back, not shown.",
      "Then a second AI double-checks that each explanation says what its line says.",
    ],
  },
  plan: {
    title: "Building your plan",
    typical: "Usually 15 to 25 seconds.",
    steps: [
      "We pick verified clinics and programs near you that match what you told us.",
      "The AI builds steps around your barriers, using only those.",
      "Our code removes anything it suggests that isn't on our verified list.",
    ],
  },
} as const;

export function WorkingCard({ kind }: { kind: keyof typeof COPY }) {
  const c = COPY[kind];
  const start = useRef(0);
  const [sec, setSec] = useState(0);
  useEffect(() => {
    start.current = Date.now();
    const t = setInterval(() => setSec(Math.floor((Date.now() - start.current) / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="mt-6 rounded-3xl border-2 border-ink bg-paper p-5 sm:p-6 flex flex-col sm:flex-row gap-5 items-start" role="status" aria-live="polite" aria-busy="true">
      <div className="working-paper relative shrink-0 w-24 h-32 rounded-lg border-2 border-ink bg-white overflow-hidden" aria-hidden="true">
        {[18, 30, 42, 54, 66, 78, 90, 102].map((y, i) => (
          <span key={y} className="absolute left-3 h-1.5 rounded-full bg-ink/20" style={{ top: y, width: `${[70, 55, 64, 40, 68, 50, 60, 35][i]}%` }} />
        ))}
        <span className="working-scan absolute inset-x-0 h-6 bg-gradient-to-b from-transparent via-teal/35 to-transparent" />
      </div>
      <div className="min-w-0">
        <p className="display text-2xl">{c.title}<span className="working-dots" aria-hidden="true" /></p>
        <p className="text-sm font-bold text-ink/70 mt-1">
          <span className="tabular-nums">{sec}s</span> · {c.typical}
        </p>
        <ol className="mt-3 space-y-1.5 text-sm font-semibold list-decimal pl-5">
          {c.steps.map((s) => <li key={s}>{s}</li>)}
        </ol>
      </div>
    </div>
  );
}
