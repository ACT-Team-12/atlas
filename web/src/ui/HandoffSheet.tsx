"use client";

import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import type { VerifiedItem } from "@/lib/schema";
import type { PlanResponse } from "@/lib/plan";
import { careStepView, checkOf, paperFirstLines } from "@/lib/paperFirst";
import { planStepQuotes } from "@/lib/planQuotes";
import type { ShareMeaning } from "@/lib/shareText";

const noop = () => () => {};

const KIND_LABEL: Record<string, string> = {
  medication: "Medicine", lab_test: "Lab test", referral: "Referral", follow_up_visit: "Follow-up visit", self_care: "Self care", warning_sign: "Warning sign",
};

/**
 * A one-page handoff sheet for someone without a smartphone: large type, a box to tick for each step,
 * the paper's own line under every step, verified numbers, and room for a helper's notes.
 * Rendered into <body> and shown only while printing it (see .atlas-sheet rules in globals.css).
 */
type SheetProps = { items: VerifiedItem[]; plan: PlanResponse | null; questions: string[]; language: string; meaning?: ShareMeaning; planItems?: VerifiedItem[] };

export function HandoffSheet(props: SheetProps) {
  // true only in the browser, so the portal never renders on the server
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) return null;
  return createPortal(<HandoffSheetBody {...props} />, document.body);
}

/**
 * The sheet itself. Paper first (lib/paperFirst.ts): a step's plain-words explanation is printed only when the second
 * check certified it; otherwise the sheet prints the paper's own words and says the explanation was left out.
 */
export function HandoffSheetBody({ items, plan, questions, language, meaning, planItems }: SheetProps) {
  const resources = plan ? Object.values(plan.resources) : [];
  const used = new Set(plan?.steps.flatMap((s) => s.resource_ids) ?? []);
  const today = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <div id="atlas-sheet" className="atlas-sheet" aria-hidden="true">
      <h1>My plan after my visit</h1>
      <p className="meta">Printed {today} · Written in {language} · Every step below quotes my paper.</p>

      <h2>What my paper says to do</h2>
      <ol className="steps">
        {items.map((i) => {
          const check = checkOf(meaning?.status === "done" ? meaning.byId[i.id] : undefined);
          const lines = paperFirstLines(careStepView(i, check));
          return (
            <li key={i.id}>
              <span className="box" />
              <div>
                <p className="title"><b>{KIND_LABEL[i.kind] ?? i.kind}</b>{check === "certified" ? `: ${i.title}${i.when ? ` · ${i.when}` : ""}` : ""}</p>
                {lines.map((l, n) => <p key={n} className={l.startsWith("Your paper says:") ? "quote" : undefined} data-paper-quote={l.startsWith("Your paper says:") ? "" : undefined}>{l}</p>)}
              </div>
            </li>
          );
        })}
      </ol>

      {plan && plan.steps.length > 0 && (
        <>
          <h2>My plan (suggestions from ATLAS; if anything differs from my paper, follow my paper)</h2>
          <p>{plan.summary}</p>
          <ol className="plan">
            {plan.steps.map((s, n) => (
              <li key={n}>
                <b>{s.title}.</b> {s.action}
                {planStepQuotes(s, planItems ?? items).map((q, k) => <p key={k} className="quote" data-paper-quote="">Your paper says: &ldquo;{q}&rdquo;</p>)}
              </li>
            ))}
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
    </div>
  );
}
