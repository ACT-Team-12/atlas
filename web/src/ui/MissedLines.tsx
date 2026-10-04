"use client";

import { useEffect, useId, useMemo, useState } from "react";
import type { CarePlanResponse } from "@/lib/schema";
import { missedLinesAnnouncement, missedLinesView, type MissedLinesView } from "@/lib/missedLines";
import { useUi } from "./UiLang";

/**
 * The coverage check for one plan, computed once per paper and per set of removed steps.
 * Uses the steps the person still sees (removed ones no longer count as "in a step") and passes the
 * spans the server's verifier already found, so the check is a single pass over the paper.
 */
export function useMissedLines(care: CarePlanResponse | null, removed: Record<string, boolean>): MissedLinesView {
  return useMemo(
    () => (care ? missedLinesView(care.source_text, care.items.filter((i) => !removed[i.id])) : { show: false, why: "empty" }),
    [care, removed],
  );
}

/**
 * "Lines on your paper we didn't turn into steps": instruction-like sentences no kept step quotes,
 * word for word, collapsed behind one button. Renders nothing when the check cannot read the paper's
 * language, so it never claims "all covered" for a paper it could not check.
 */
export function MissedLines({ view }: { view: MissedLinesView }) {
  const { t, tn } = useUi();
  const english = missedLinesAnnouncement(view);
  // The same announcement in the person's language; lib/missedLines.ts keeps the English one (phone ports, vectors).
  const message = !english ? "" : view.show && view.lines.length > 0 ? tn("missedAnnounce", view.lines.length, { title: t("missed.title") }) : t("missed.allIn");
  // A live region only speaks when its text CHANGES after it is on the page, so the region is always
  // mounted and the message lands a moment later. It also speaks again when a removed step changes the count.
  const [spoken, setSpoken] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSpoken(message), 400);
    return () => clearTimeout(t);
  }, [message]);
  return (
    <>
      <p role="status" aria-live="polite" className="sr-only" data-missed-lines-status>{spoken}</p>
      <MissedLinesBody view={view} />
    </>
  );
}

function MissedLinesBody({ view }: { view: MissedLinesView }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { t, tn } = useUi();
  if (!view.show) return null;
  const n = view.lines.length;

  if (n === 0) {
    return (
      <div className="mt-5 rounded-2xl border-2 border-ink/70 bg-mint-soft p-4" data-missed-lines="none">
        <p className="font-extrabold">
          <span aria-hidden="true">✓ </span>{t("missed.allIn")}
        </p>
        <p className="mt-1 text-xs font-semibold text-ink/70">{t("missed.canMiss")}</p>
      </div>
    );
  }

  return (
    <div className="mt-5 rounded-2xl border-2 border-ink/70 bg-paper" data-missed-lines={n}>
      <h3 className="m-0">
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={panelId}
          className="flex w-full items-center gap-3 rounded-2xl p-4 text-left font-extrabold hover:bg-mint-soft focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-teal-deep">
          <span className="flex-1">{t("missed.title")}</span>
          <span className="shrink-0 rounded-full border-2 border-ink bg-sun px-2.5 py-0.5 text-xs font-extrabold">{tn("lines", n)}</span>
          <span aria-hidden="true" className={`shrink-0 text-lg leading-none transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
        </button>
      </h3>
      <div id={panelId} hidden={!open} className="px-4 pb-4">
        <p className="text-sm font-semibold text-ink/80">{t("missed.readThese")}</p>
        <ul className="mt-3 space-y-2">
          {view.lines.map((l) => (
            <li key={l.start} className="border-l-4 border-teal pl-2 text-sm">&ldquo;{l.text}&rdquo;</li>
          ))}
        </ul>
        <p className="mt-3 text-xs font-semibold text-ink/70">{t("missed.canMissEnd")}</p>
      </div>
    </div>
  );
}
