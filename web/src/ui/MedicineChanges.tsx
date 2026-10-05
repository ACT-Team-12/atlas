"use client";

import { useId, useMemo } from "react";
import type { VerifiedItem } from "@/lib/schema";
import { doseWords, MED_ROW_LABEL, medicineChanges, type MedRow } from "@/lib/medicineChanges";
import { shortQuote } from "@/lib/stepsView";

const ROW_LOOK: Record<MedRow, { mark: string; cls: string }> = {
  stop: { mark: "✕", cls: "border-red bg-red-soft text-red" },
  change: { mark: "↻", cls: "border-peach-deep bg-peach text-peach-deep" },
  start: { mark: "+", cls: "border-teal bg-mint-soft text-teal-deep" },
  keep: { mark: "=", cls: "border-ink/40 bg-paper text-ink" },
  ask: { mark: "?", cls: "border-ink/40 border-dashed bg-paper text-ink" },
};

const ROW_NOTE: Partial<Record<MedRow, string>> = {
  ask: "Your paper's words don't say clearly whether to stop, change, start or keep these. Ask your pharmacist before you change anything.",
};

/**
 * "Your medicine changes" (lib/medicineChanges.ts): every medicine step sorted into Stop, Change, Start (and Keep
 * taking, only when the paper says to continue), Stop first. Each line shows the paper's own words, never the AI's.
 * A Change line shows an old and a new dose only when both are written in the paper's line; the strike-through is
 * also said in words ("was 10 mg, now 20 mg"). Each line links to its step in the list below.
 *
 * No Pip here (lib/pip.ts: Pip stays quiet around medicine). Prints with the page: plain links, no buttons.
 */
export function MedicineChanges({ items, paper, onGo }: { items: VerifiedItem[]; paper: string; onGo?: (id: string) => void }) {
  const titleId = useId();
  const groups = useMemo(() => medicineChanges(items, paper), [items, paper]);
  if (groups.length === 0) return null;
  return (
    <section aria-labelledby={titleId} data-med-changes="" className="med-changes mt-4 rounded-2xl border-2 border-ink bg-paper p-3 sm:p-4">
      <h4 id={titleId} className="display text-xl">Your medicine changes</h4>
      <p className="text-xs font-semibold text-ink/70">Sorted by your paper&apos;s own words. Stop comes first: it is the easiest one to miss.</p>
      {groups.map(({ row, list }) => (
        <section key={row} aria-labelledby={`${titleId}-${row}`} data-med-row={row} className={`mt-3 rounded-xl border-2 p-2 sm:p-3 ${ROW_LOOK[row].cls}`}>
          <h5 id={`${titleId}-${row}`} className="flex items-center gap-2 font-extrabold">
            <span aria-hidden="true" className="grid h-6 w-6 flex-none place-items-center rounded-full border-2 border-current text-sm">{ROW_LOOK[row].mark}</span>
            <span>{MED_ROW_LABEL[row]}</span>
            <span className="text-xs font-bold">({list.length} {list.length === 1 ? "medicine" : "medicines"})</span>
          </h5>
          {ROW_NOTE[row] && <p className="mt-1 text-xs font-semibold" data-med-row-note="">{ROW_NOTE[row]}</p>}
          <ul className="mt-2 space-y-2">
            {list.map((c) => (
              <li key={c.id} data-med={c.id} className="rounded-lg bg-paper p-2 text-ink">
                {c.name && <p className="font-extrabold" data-med-name="">{c.name}</p>}
                {c.dose && (
                  // The strike-through is never the only signal: the words "was" and "now" say it, on screen and aloud.
                  <p className="text-sm font-bold" data-med-dose="" data-dose-words={doseWords(c.dose)}>
                    Dose on your paper: was <del className="decoration-2">{c.dose.was}</del>, now <strong>{c.dose.now}</strong>
                  </p>
                )}
                <div data-paper-quote="" className="mt-1 border-l-4 border-sun pl-2">
                  <p className="text-[11px] font-extrabold uppercase tracking-wide text-teal-deep">Copied word for word from your paper</p>
                  <p className="font-semibold">&ldquo;{c.quote}&rdquo;</p>
                </div>
                <a href={`#step-${c.id}`} data-med-go={c.id}
                  onClick={(e) => { if (!onGo) return; e.preventDefault(); onGo(c.id); }}
                  className="med-go mt-1 inline-block text-xs font-bold underline focus-visible:outline-2 focus-visible:outline-teal-deep">
                  Go to this step<span className="sr-only">: &ldquo;{shortQuote(c.quote, 50)}&rdquo;</span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </section>
  );
}
