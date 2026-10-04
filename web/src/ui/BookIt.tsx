"use client";

import { useId, useMemo, useState } from "react";
import type { Barrier } from "@/lib/resources";
import { bookableItem, bookingTarget, buildIcs, callScript, eventDescription, type BookableItem } from "@/lib/booking";
import { TIME_CHIPS, dayOptions, describeStart, formatTime, googleCalendarUrl, localStart, timeOptions } from "@/lib/calendarLinks";

/** "Book it now" for one plan step: call script, call button, add-to-calendar file, and why it still matters. */
/** `offReason` turns booking off (the plan is outdated, so its script and barriers may not fit) and says why. */
export function BookIt({ items, barriers, language, offReason }: { items: BookableItem[]; barriers: Barrier[]; language: string; offReason?: string }) {
  const item = bookableItem(items);
  const target = useMemo(() => (item ? bookingTarget(item) : null), [item]);
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState("");
  const [time, setTime] = useState("");
  const [copied, setCopied] = useState(false);
  const panelId = useId();
  const otherDayId = useId();
  const otherTimeId = useId();
  const days = useMemo(() => dayOptions(new Date(), 14), []);
  if (!item) return null;
  const start = localStart(day, time);

  const script = callScript(item, barriers, language);

  function copy() {
    navigator.clipboard?.writeText(script.join("\n")).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {});
  }

  function googleUrl() {
    if (!item || !start) return "#";
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
    return googleCalendarUrl({ title: item.title, start, minutes: 60, details: eventDescription(item, target), timeZone });
  }

  function download() {
    if (!item || !start) return;
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
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open && !offReason} aria-controls={panelId} disabled={!!offReason}
        className="rounded-full border-2 border-ink bg-paper px-4 py-2 text-sm font-bold disabled:opacity-40">
        📅 {open && !offReason ? "Hide booking help" : "Book it now"}
      </button>
      {offReason && <span className="ml-3 text-xs font-bold text-peach-deep">{offReason}</span>}
      {open && !offReason && (
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
              <button type="button" onClick={copy} className="rounded-full border border-ink/60 px-2.5 py-0.5 text-xs font-bold">{copied ? "Copied" : "Copy"}</button>
            </div>
            {language !== "English" && <p className="text-xs text-ink/70 mt-1">In English, so the front desk can follow it. A helper can read it for you.</p>}
            <ol className="mt-2 space-y-1 text-sm list-decimal pl-5">{script.map((l, i) => <li key={i}>{l}</li>)}</ol>
          </div>

          <div>
            <p className="font-extrabold">3. Got a time? Put it on your phone</p>
            {item.when.trim() && <p className="text-xs font-semibold text-ink/70 mt-0.5">When, as ATLAS read your paper (double-checked): {item.when.trim()}</p>}

            <p className="mt-3 text-sm font-bold" id={`${panelId}-day`}>Day</p>
            <div role="group" aria-labelledby={`${panelId}-day`} className="mt-1 flex gap-2 overflow-x-auto pb-1" data-lenis-prevent>
              {days.map((d) => (
                <button key={d.value} type="button" aria-pressed={day === d.value} onClick={() => setDay(d.value)}
                  className={`shrink-0 rounded-xl border-2 px-3 py-1.5 text-left leading-tight ${day === d.value ? "border-ink bg-ink text-paper" : "border-ink/60 bg-paper hover:bg-mint-soft"}`}>
                  <span className="block text-sm font-bold">{d.label}</span>
                  <span className={`block text-xs ${day === d.value ? "text-paper/90" : "text-ink/70"}`}>{d.sub}</span>
                </button>
              ))}
            </div>
            <label htmlFor={otherDayId} className="mt-1 inline-flex items-center gap-2 text-xs font-semibold text-ink/70">Later date:
              <input id={otherDayId} type="date" min={days[0].value} value={days.some((d) => d.value === day) ? "" : day}
                onChange={(e) => setDay(e.target.value)} className="rounded-lg border-2 border-ink/60 bg-paper px-2 py-0.5 text-xs" />
            </label>

            <p className="mt-3 text-sm font-bold" id={`${panelId}-time`}>Time</p>
            <div role="group" aria-labelledby={`${panelId}-time`} className="mt-1 flex flex-wrap gap-2">
              {TIME_CHIPS.map((t) => (
                <button key={t} type="button" aria-pressed={time === t} onClick={() => setTime(t)}
                  className={`rounded-full border-2 px-3 py-1 text-sm font-bold ${time === t ? "border-ink bg-ink text-paper" : "border-ink/60 bg-paper hover:bg-mint-soft"}`}>
                  {formatTime(t)}
                </button>
              ))}
              <label htmlFor={otherTimeId} className="sr-only">Other time</label>
              <select id={otherTimeId} value={(TIME_CHIPS as readonly string[]).includes(time) ? "" : time} onChange={(e) => setTime(e.target.value)}
                className="rounded-full border-2 border-ink/60 bg-paper px-3 py-1 text-sm font-bold">
                <option value="">Other time</option>
                {timeOptions().map((t) => <option key={t} value={t}>{formatTime(t)}</option>)}
              </select>
            </div>

            <div className="mt-3 rounded-xl border-2 border-dashed border-ink/40 p-3" aria-live="polite">
              {start ? (
                <>
                  <p className="text-sm font-bold">{describeStart(start)}: {item.title}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <a href={googleUrl()} target="_blank" rel="noreferrer" className="rounded-full bg-teal text-paper px-4 py-1.5 text-sm font-bold">Add to Google Calendar ↗</a>
                    <button type="button" onClick={download} className="rounded-full border-2 border-ink px-4 py-1.5 text-sm font-bold">Apple or Outlook (.ics)</button>
                  </div>
                </>
              ) : (
                <p className="text-sm font-semibold text-ink/70">{!day && !time ? "Pick a day and a time." : !day ? "Now pick a day." : "Now pick a time."}</p>
              )}
            </div>
            <p className="text-xs text-ink/70 mt-1">The .ics file reminds you the day before and 2 hours before. Both carry the line from your paper.</p>
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
