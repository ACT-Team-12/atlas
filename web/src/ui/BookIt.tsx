"use client";

import { useId, useMemo, useState } from "react";
import type { Barrier } from "@/lib/resources";
import { bookableItem, bookingTarget, buildIcs, callScript, eventDescription, type BookableItem } from "@/lib/booking";

/** "Book it now" for one plan step: call script, call button, add-to-calendar file, and why it still matters. */
export function BookIt({ items, barriers, language }: { items: BookableItem[]; barriers: Barrier[]; language: string }) {
  const item = bookableItem(items);
  const target = useMemo(() => (item ? bookingTarget(item) : null), [item]);
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState("");
  const [copied, setCopied] = useState(false);
  const panelId = useId();
  const dateId = useId();
  if (!item) return null;

  const script = callScript(item, barriers, language);

  function copy() {
    navigator.clipboard?.writeText(script.join("\n")).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {});
  }

  function download() {
    if (!item || !when) return;
    const start = new Date(when);
    if (Number.isNaN(start.getTime())) return;
    const ics = buildIcs({
      uid: `${item.id}-${start.getTime()}@atlas-team12.vercel.app`,
      start,
      minutes: 60,
      title: item.title,
      description: eventDescription(item, target),
    });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${item.title.replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase() || "appointment"}.ics`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="mt-4 print:hidden">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={panelId}
        className="rounded-full border-2 border-ink bg-paper px-4 py-2 text-sm font-bold">
        📅 {open ? "Hide booking help" : "Book it now"}
      </button>
      {open && (
        <div id={panelId} className="mt-3 rounded-2xl border-2 border-ink bg-paper p-4 space-y-4">
          <div>
            <p className="font-extrabold">1. Call {target ? "the number on your paper" : "the place your paper names, or the clinic that gave it to you"}</p>
            {target ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-sm font-bold">
                <a className="rounded-full bg-ink text-paper px-3 py-1.5" href={`tel:${target.phone.replace(/[^\d]/g, "")}`}>Call {target.phone}</a>
                <span className="text-xs font-semibold text-ink/70">This number is in the line from your paper.</span>
              </div>
            ) : (
              <p className="text-sm text-ink/70 mt-1">Use the phone number printed on your paper. The clinics and programs in your plan help with rides and costs; they can&apos;t book this for you.</p>
            )}
          </div>

          <div>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-extrabold">2. What to say</p>
              <button type="button" onClick={copy} className="rounded-full border border-ink/40 px-2.5 py-0.5 text-xs font-bold">{copied ? "Copied" : "Copy"}</button>
            </div>
            {language !== "English" && <p className="text-xs text-ink/70 mt-1">In English, so the front desk can follow it. A helper can read it for you.</p>}
            <ol className="mt-2 space-y-1 text-sm list-decimal pl-5">{script.map((l, i) => <li key={i}>{l}</li>)}</ol>
          </div>

          <div>
            <label htmlFor={dateId} className="font-extrabold block">3. Got a time? Put it on your phone</label>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <input id={dateId} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)}
                className="rounded-xl border-2 border-ink/60 bg-paper px-3 py-1.5 text-sm" />
              <button type="button" onClick={download} disabled={!when}
                className="rounded-full bg-teal text-paper px-4 py-1.5 text-sm font-bold disabled:opacity-40">Add to my calendar</button>
            </div>
            <p className="text-xs text-ink/70 mt-1">Reminds you the day before and 2 hours before. The reminder carries the line from your paper.</p>
          </div>

          <div className="rounded-xl bg-peach/70 p-3">
            <p className="font-extrabold text-sm">Even if you feel better, your paper still says:</p>
            <p className="text-sm italic mt-1 border-l-4 border-sun pl-2">&ldquo;{item.source_quote}&rdquo;</p>
            <p className="text-xs text-ink/70 mt-1">Feeling better is the most common reason people skip a referral. Ask your clinic before you skip it.</p>
          </div>
        </div>
      )}
    </div>
  );
}
