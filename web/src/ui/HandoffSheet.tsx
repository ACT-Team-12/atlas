"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { VerifiedItem } from "@/lib/schema";
import type { PlanResponse } from "@/lib/plan";
import { careStepView, checkOf, paperFirstLines } from "@/lib/paperFirst";
import { planStepQuotes } from "@/lib/planQuotes";
import type { ShareMeaning } from "@/lib/shareText";
import { visitQuestionsTagged } from "@/lib/visitQuestions";
import { keyFor, LANGUAGE_NAME, ui, uiLang } from "@/lib/uiText";
import { EnglishBeside, useUi, PaperWords } from "./UiLang";
import { medicineChanges } from "@/lib/medicineChanges";

const noop = () => () => {};

/**
 * A one-page handoff sheet for someone without a smartphone: large type, a box to tick for each step,
 * the paper's own line under every step, verified numbers, and room for a helper's notes.
 * Rendered into <body> and shown only while printing it (see .atlas-sheet rules in globals.css).
 */
type SheetProps = {
  items: VerifiedItem[]; plan: PlanResponse | null; questions: string[]; language: string; meaning?: ShareMeaning; planItems?: VerifiedItem[];
  /** Instruction-like lines no step quotes (lib/missedLines). Empty when there are none or the check can't read the paper. */
  alsoOnPaper?: string[];
  /** The paper's text, so medicine lines can be read with the list heading above them (lib/medicineChanges). */
  paper?: string;
};

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
export function HandoffSheetBody({ items, plan, questions, language, meaning, planItems, alsoOnPaper = [], paper = "" }: SheetProps) {
  const meds = medicineChanges(items, paper);
  const resources = plan ? Object.values(plan.resources) : [];
  const used = new Set(plan?.steps.flatMap((s) => s.resource_ids) ?? []);
  // Each step's own question only when certified; otherwise the paper's words (lib/visitQuestions.ts).
  const nextVisit = visitQuestionsTagged({ items, general: questions, also: planItems, checkFor: (id) => checkOf(meaning?.status === "done" ? meaning.byId[id] : undefined) });
  const { t, ts, code, lang } = useUi();
  const today = new Date().toLocaleDateString(code, { year: "numeric", month: "long", day: "numeric" });
  // The sheet's own words in the person's language. lib/paperFirst.ts writes the lines in English; only their labels
  // change here, never the paper's words between the quotes.
  const says = "Your paper says:";
  const localLine = (l: string): ReactNode => l.startsWith(says) ? <>{t("pf.says.paper")}<PaperWords>{l.slice(says.length)}</PaperWords></>
    : l.startsWith("(The plain-words explanation is left out here because it was not") ? t("sheet.leftOutUnchecked")
    : l.startsWith("(The plain-words explanation is left out here because a second") ? t("sheet.leftOutFlagged") : l;
  const kindLabel = (k: string) => ts(keyFor("sheet.kind", k, keyFor("kind", k, "kind.step")));

  return (
    <div id="atlas-sheet" className="atlas-sheet" aria-hidden="true" lang={code}>
      <h1>{t("sheet.title")}</h1>
      <p className="meta">{t("sheet.meta", { date: today, language: LANGUAGE_NAME[uiLang(language)] })}</p>

      {meds.length > 0 && (
        <>
          <h2>{t("med.sheetTitle")}</h2>
          <p className="meta">{ts("med.sheetNote")}</p>
          <ul className="meds" data-sheet-meds="">
            {meds.map(({ row, list }) => (
              <li key={row} data-med-row={row}>
                <b>{ts(keyFor("med.row", row, "med.row.ask"))}</b>
                {list.map((c) => (
                  <div key={c.id}>
                    {c.name && <p><b>{c.name}</b></p>}
                    {c.dose && <p>{t("med.sheetDoseWas")} <del>{c.dose.was}</del>, {t("med.doseNow")} <b>{c.dose.now}</b>{lang !== "English" && <EnglishBeside en={`${ui("English", "med.sheetDoseWas")} ${c.dose.was}, ${ui("English", "med.doseNow")} ${c.dose.now}`} />}</p>}
                    <p className="quote" data-paper-quote="">{t("pf.says.paper")} &ldquo;<PaperWords>{c.quote}</PaperWords>&rdquo;</p>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}

      <h2>{t("sheet.whatToDo")}</h2>
      <ol className="steps">
        {items.map((i) => {
          const check = checkOf(meaning?.status === "done" ? meaning.byId[i.id] : undefined);
          const lines = paperFirstLines(careStepView(i, check));
          return (
            <li key={i.id}>
              <span className="box" />
              <div>
                <p className="title"><b>{kindLabel(i.kind)}</b>{check === "certified" ? `: ${i.title}${i.when ? ` · ${i.when}` : ""}` : ""}</p>
                {lines.map((l, n) => <p key={n} className={l.startsWith(says) ? "quote" : undefined} data-paper-quote={l.startsWith(says) ? "" : undefined}>{localLine(l)}</p>)}
              </div>
            </li>
          );
        })}
      </ol>

      {alsoOnPaper.length > 0 && (
        <>
          <h2>{t("sheet.alsoOnPaper")}</h2>
          <p className="meta">{t("sheet.alsoNote")}</p>
          <ul>{alsoOnPaper.map((t, n) => <li key={n}>&ldquo;<PaperWords>{t}</PaperWords>&rdquo;</li>)}</ul>
        </>
      )}

      {plan && plan.steps.length > 0 && (
        <>
          <h2>{ts("sheet.myPlan")}</h2>
          <p>{plan.summary}</p>
          <ol className="plan">
            {plan.steps.map((s, n) => (
              <li key={n}>
                <b>{s.title}.</b> {s.action}
                {planStepQuotes(s, planItems ?? items).map((q, k) => <p key={k} className="quote" data-paper-quote="">{t("pf.says.paper")} &ldquo;<PaperWords>{q}</PaperWords>&rdquo;</p>)}
              </li>
            ))}
          </ol>
        </>
      )}

      {resources.some((r) => used.has(r.id)) && (
        <>
          <h2>{ts("prov.helpHeadingSheet")}</h2>
          <ul className="help">
            {resources.filter((r) => used.has(r.id)).map((r) =>
              r.type === "clinic"
                ? <li key={r.id}><b>{r.clinic.name}</b> · {r.clinic.phone} · {r.clinic.address}, {r.clinic.city} {r.clinic.zip}{r.clinic.nearest_bus ? ` · ${t("sheet.bus", { name: r.clinic.nearest_bus.name })}` : ""}</li>
                : <li key={r.id}><b>{r.program.name}</b>{r.program.access.phone ? ` · ${r.program.access.phone}` : ""}{r.program.access.text ? ` · ${r.program.access.text}` : ""}</li>,
            )}
          </ul>
        </>
      )}

      {nextVisit.length > 0 && (
        <>
          <h2>{t("sheet.questions")}</h2>
          <ul>{nextVisit.map((q, n) => <li key={n} lang={q.english ? "en" : undefined}>{q.text}</li>)}</ul>
        </>
      )}

      <h2>{t("sheet.notes")}</h2>
      <div className="lines"><span /><span /><span /></div>

      <p className="foot">{ts("sheet.foot")}</p>
    </div>
  );
}
