"use client";

import { useId, useState } from "react";
import type { VerifiedItem } from "@/lib/schema";
import type { PlanResponse } from "@/lib/plan";
import { planShareText, SHARE_TITLE, type ShareMeaning } from "@/lib/shareText";
import { DockLabel } from "./DockLabel";
import { useUi } from "./UiLang";

/** "Send to family": hands the plan to the phone's own share sheet (text, email, WhatsApp). Falls back to copy, email and text links. */
export function ShareFamily({ items, plan, questions, meaning, planItems, disabled = false, describedBy, short }: {
  items: VerifiedItem[]; plan: PlanResponse; questions: string[]; meaning: ShareMeaning; planItems: VerifiedItem[];
  /** Off while the plan is outdated: it would send a plan that no longer fits the person's answers. */
  disabled?: boolean; describedBy?: string;
  /** A one-word label for phones (the plan's bottom bar); wider screens keep the full words. */
  short?: string;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const panelId = useId();
  const { t } = useUi();
  const text = planShareText({ items, plan, questions, meaning, planItems });
  // Never send while the double-check is still running: its warnings must be in the message.
  const checking = meaning.status === "loading";

  async function share() {
    setNote("");
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: SHARE_TITLE, text });
        setNote(t("share.sent"));
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return; // they closed the share sheet
      }
    }
    setOpen((o) => !o);
  }

  function copy() {
    navigator.clipboard?.writeText(text).then(() => setNote(t("share.copied"))).catch(() => setNote(t("share.copyFailed")));
  }

  return (
    <>
      <button type="button" onClick={share} disabled={checking || disabled} aria-expanded={open && !disabled} aria-controls={panelId} aria-describedby={describedBy} className="rounded-full border-2 border-ink bg-mint px-4 py-2 disabled:opacity-60">
        {short
          ? <DockLabel icon="📤" short={checking ? t("dock.send.checking") : short} long={t(checking ? "dock.send.checkingLong" : "dock.send.long")} />
          : <>📤 {t(checking ? "dock.send.checkingLong" : "dock.send.long")}</>}
      </button>
      {open && !disabled && (
        <div id={panelId} className="basis-full mt-1 rounded-2xl border-2 border-ink bg-paper p-4 font-normal">
          <p className="font-extrabold">{t("share.title")}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-sm font-bold">
            <button type="button" onClick={copy} className="rounded-full border-2 border-ink px-3 py-1.5">{t("share.copy")}</button>
            <a className="rounded-full border-2 border-ink px-3 py-1.5" href={`mailto:?subject=${encodeURIComponent(SHARE_TITLE)}&body=${encodeURIComponent(text)}`}>{t("share.email")}</a>
            <a className="rounded-full border-2 border-ink px-3 py-1.5" href={`sms:?&body=${encodeURIComponent(text)}`}>{t("share.text")}</a>
          </div>
          <label className="mt-3 block text-xs font-bold text-ink/70">{t("share.preview")}
            <textarea lang="en" readOnly data-lenis-prevent value={text} className="mt-1 h-40 w-full rounded-xl border-2 border-ink/40 bg-paper p-2 font-mono text-xs" />
          </label>
        </div>
      )}
      <span className="sr-only" aria-live="polite">{note}</span>
      {note && <span aria-hidden="true" className="self-center text-xs font-semibold text-ink/70">{note}</span>}
      <span className="basis-full text-xs font-semibold text-ink/70">{t("share.private")}</span>
    </>
  );
}
