"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { printOrView, SESSION_SHEET } from "./printView";
import { ACTIVITIES, ACTIVITY_LABEL, type Activity, sessionSummary, SUMMARY_FOOT, SUMMARY_TITLE, type SessionPlanState } from "@/lib/sessionSummary";

const noop = () => () => {};

// Printed alone, like the handoff sheet. Kept here so this panel needs no edits to globals.css.
const PRINT_CSS = `
.atlas-session-sheet { display: none; }
@media print {
  html.print-session body > *:not(#atlas-session-sheet) { display: none !important; }
  html.print-session, html.print-session body { background: #fff !important; }
  html.print-session .atlas-session-sheet { display: block; color: #000; font-size: 12pt; line-height: 1.4; }
}
/* The type rules hold on screen too, for the sheet view in browsers that can't print from a button (printView.ts). */
.atlas-session-sheet h1 { font-size: 18pt; margin: 0 0 4pt; }
.atlas-session-sheet h2 { font-size: 13pt; margin: 12pt 0 4pt; border-bottom: 1.5pt solid #000; padding-bottom: 2pt; break-after: avoid; }
.atlas-session-sheet p { margin: 0 0 2pt; white-space: pre-wrap; overflow-wrap: anywhere; }
.atlas-session-sheet .foot { margin-top: 14pt; font-size: 9pt; color: #333; }`;

/**
 * "For helpers: session summary": a CHW or navigator fills in minutes, notes and consent, then copies or prints a
 * documentation draft for their own notes. Kept in this component's memory only: nothing is sent or saved.
 */
export function SessionSummary(props: SessionPlanState) {
  const [minutes, setMinutes] = useState<Record<Activity, string>>({ explain: "", barriers: "", resources: "", appointments: "" });
  const [notes, setNotes] = useState("");
  const [consent, setConsent] = useState(false);
  const [msg, setMsg] = useState("");
  const id = useId();
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  const s = sessionSummary(props, { minutes, notes, consentDiscussed: consent });

  function copy() {
    navigator.clipboard?.writeText(s.text).then(() => setMsg("Copied. Paste it into your notes.")).catch(() => setMsg("Couldn't copy. Select the text below and copy it."));
  }

  function print() {
    printOrView(SESSION_SHEET); // the sheet on screen first, printed from its bar (printView.ts)
  }

  return (
    <details className="mt-6 rounded-2xl border-2 border-teal bg-paper p-4 sm:p-5 print:hidden">
      <summary className="cursor-pointer font-extrabold text-teal-deep focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-teal-deep">
        For helpers: session summary
      </summary>
      <p className="mt-2 text-xs font-semibold text-ink/70">Stays on this device. A draft for your own notes; you and your clinic decide what goes in a record.</p>

      <fieldset className="mt-4">
        <legend className="text-sm font-bold">Minutes spent on each activity</legend>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {ACTIVITIES.map((a) => (
            <label key={a} className="text-xs font-bold">{ACTIVITY_LABEL[a]}
              <input type="number" inputMode="numeric" min={0} max={600} step={1} value={minutes[a]}
                onChange={(e) => setMinutes((m) => ({ ...m, [a]: e.target.value }))}
                className="mt-1 w-full rounded-xl border-2 border-ink/70 bg-paper p-2 text-sm focus:border-teal" />
            </label>
          ))}
        </div>
        <p className="mt-2 text-sm font-bold">Total: {s.totalMinutes} min</p>
      </fieldset>

      <label className="mt-4 flex items-center gap-3 text-sm font-bold">
        <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="h-5 w-5 accent-[var(--teal)]" />
        Consent discussed with the person
      </label>

      <label className="mt-4 block text-sm font-bold">Helper notes (optional)
        <textarea data-lenis-prevent value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="What you did, what's next. Leave out names and dates of birth."
          className="mt-1 h-24 w-full rounded-xl border-2 border-ink/70 bg-paper p-2.5 text-sm font-normal focus:border-teal" />
      </label>

      <div className="mt-4 flex flex-wrap gap-2 text-sm font-bold">
        <button type="button" onClick={copy} className="rounded-full border-2 border-ink bg-mint px-4 py-2">📋 Copy summary</button>
        <button type="button" onClick={print} className="rounded-full border-2 border-ink px-4 py-2">🖨️ Print summary</button>
        <span className="sr-only" aria-live="polite">{msg}</span>
        {msg && <span aria-hidden="true" className="self-center text-xs font-semibold text-ink/70">{msg}</span>}
      </div>

      <label htmlFor={id} className="mt-4 block text-xs font-bold text-ink/70">What it will say</label>
      <textarea id={id} readOnly data-lenis-prevent value={s.text} className="mt-1 h-56 w-full rounded-xl border-2 border-ink/40 bg-paper p-2 font-mono text-xs" />

      {mounted && createPortal(
        <div id="atlas-session-sheet" className="atlas-session-sheet" aria-hidden="true">
          <style>{PRINT_CSS}</style>
          <h1>{SUMMARY_TITLE}</h1>
          {s.sections.map((sec) => (
            <section key={sec.heading}>
              <h2>{sec.heading}</h2>
              {sec.lines.map((l, n) => <p key={n}>{l}</p>)}
            </section>
          ))}
          <p className="foot">{SUMMARY_FOOT}</p>
        </div>,
        document.body,
      )}
    </details>
  );
}
