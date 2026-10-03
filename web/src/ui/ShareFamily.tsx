"use client";

import { useId, useState } from "react";
import type { VerifiedItem } from "@/lib/schema";
import type { PlanResponse } from "@/lib/plan";
import { planShareText, SHARE_TITLE, type ShareMeaning } from "@/lib/shareText";

/** "Send to family": hands the plan to the phone's own share sheet (text, email, WhatsApp). Falls back to copy, email and text links. */
export function ShareFamily({ items, plan, questions, meaning, planItems }: { items: VerifiedItem[]; plan: PlanResponse; questions: string[]; meaning: ShareMeaning; planItems: VerifiedItem[] }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const panelId = useId();
  const text = planShareText({ items, plan, questions, meaning, planItems });
  // Never send while the double-check is still running: its warnings must be in the message.
  const checking = meaning.status === "loading";

  async function share() {
    setNote("");
    if (typeof navigator !== "undefined" && typeof navigator.share === "function") {
      try {
        await navigator.share({ title: SHARE_TITLE, text });
        setNote("Sent.");
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return; // they closed the share sheet
      }
    }
    setOpen((o) => !o);
  }

  function copy() {
    navigator.clipboard?.writeText(text).then(() => setNote("Copied. Paste it into a text or email.")).catch(() => setNote("Couldn't copy. Select the text below and copy it."));
  }

  return (
    <>
      <button type="button" onClick={share} disabled={checking} aria-expanded={open} aria-controls={panelId} className="rounded-full border-2 border-ink bg-mint px-4 py-2 disabled:opacity-60">
        📤 {checking ? "Send to family (finishing the double-check...)" : "Send to family"}
      </button>
      {open && (
        <div id={panelId} className="basis-full mt-1 rounded-2xl border-2 border-ink bg-paper p-4 font-normal">
          <p className="font-extrabold">Send the plan to whoever helps with appointments</p>
          <div className="mt-2 flex flex-wrap gap-2 text-sm font-bold">
            <button type="button" onClick={copy} className="rounded-full border-2 border-ink px-3 py-1.5">Copy the plan</button>
            <a className="rounded-full border-2 border-ink px-3 py-1.5" href={`mailto:?subject=${encodeURIComponent(SHARE_TITLE)}&body=${encodeURIComponent(text)}`}>Email it</a>
            <a className="rounded-full border-2 border-ink px-3 py-1.5" href={`sms:?&body=${encodeURIComponent(text)}`}>Text it</a>
          </div>
          <label className="mt-3 block text-xs font-bold text-ink/70">What they will get
            <textarea readOnly data-lenis-prevent value={text} className="mt-1 h-40 w-full rounded-xl border-2 border-ink/40 bg-paper p-2 font-mono text-xs" />
          </label>
        </div>
      )}
      <span className="sr-only" aria-live="polite">{note}</span>
      {note && <span aria-hidden="true" className="self-center text-xs font-semibold text-ink/70">{note}</span>}
      <span className="basis-full text-xs font-semibold text-ink/70">Send to family goes from your own phone. ATLAS doesn&apos;t see or keep it.</span>
    </>
  );
}
