"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { VerifiedItem } from "@/lib/schema";
import type { PlanResponse } from "@/lib/plan";

const noop = () => () => {};

const KIND_LABEL: Record<string, string> = {
  medication: "Medicine", lab_test: "Lab test", referral: "Referral", follow_up_visit: "Follow-up visit", self_care: "Self care", warning_sign: "Warning sign",
};

/**
 * A one-page handoff sheet for someone without a smartphone: large type, a box to tick for each step,
 * the paper's own line under every step, verified numbers, and room for a helper's notes.
 * Rendered into <body> and shown only while printing it (see .atlas-sheet rules in globals.css).
 */
export function HandoffSheet({ items, plan, questions, language }: { items: VerifiedItem[]; plan: PlanResponse | null; questions: string[]; language: string }) {
  // true only in the browser, so the portal never renders on the server
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) return null;

  const resources = plan ? Object.values(plan.resources) : [];
  const used = new Set(plan?.steps.flatMap((s) => s.resource_ids) ?? []);
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return createPortal(
    <div id="atlas-sheet" className="atlas-sheet" aria-hidden="true">
      <h1>My plan after my visit</h1>
      <p className="meta">Printed {today} · Written in {language} · Every step below quotes my paper.</p>

      <h2>What my paper says to do</h2>
      <ol className="steps">
        {items.map((i) => (
          <li key={i.id}>
            <span className="box" />
            <div>
              <p className="title"><b>{KIND_LABEL[i.kind] ?? i.kind}:</b> {i.title}{i.when ? ` · ${i.when}` : ""}</p>
              <p>{i.plain_language}</p>
              <p className="quote">My paper says: &ldquo;{i.source_quote}&rdquo;</p>
            </div>
          </li>
        ))}
      </ol>

      {plan && plan.steps.length > 0 && (
        <>
          <h2>My plan</h2>
          <ol className="plan">
            {plan.steps.map((s, n) => <li key={n}><b>{s.title}.</b> {s.action}</li>)}
          </ol>
        </>
      )}

      {resources.some((r) => used.has(r.id)) && (
        <>
          <h2>Who can help (checked numbers)</h2>
          <ul className="help">
            {resources.filter((r) => used.has(r.id)).map((r) =>
              r.type === "clinic"
                ? <li key={r.id}><b>{r.clinic.name}</b> · {r.clinic.phone} · {r.clinic.address}, {r.clinic.city} {r.clinic.zip}{r.clinic.nearest_bus ? ` · Bus: ${r.clinic.nearest_bus.name}` : ""}</li>
                : <li key={r.id}><b>{r.program.name}</b>{r.program.access.phone ? ` · ${r.program.access.phone}` : ""}{r.program.access.text ? ` · ${r.program.access.text}` : ""}</li>,
            )}
          </ul>
        </>
      )}

      {questions.length > 0 && (
        <>
          <h2>Questions for my next visit</h2>
          <ul>{questions.map((q, n) => <li key={n}>{q}</li>)}</ul>
        </>
      )}

      <h2>Notes from my helper</h2>
      <div className="lines"><span /><span /><span /></div>

      <p className="foot">Made with ATLAS (atlas-team12.vercel.app). This explains your own paper. It is not medical advice. If something feels urgent, call your clinic or 911.</p>
    </div>,
    document.body,
  );
}
