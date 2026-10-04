"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { bookSafe, careStepView, paperFirstLines, type Check } from "@/lib/paperFirst";
import type { CarePlanResponse, VerifiedItem } from "@/lib/schema";
import type { MeaningState } from "@/lib/meaningRun";
import type { DeviceRun, DeviceStatus } from "@/lib/deviceRun";
import { closedRow, SEAL_SHORT, SEAL_TEXT, sealOf, shortQuote, stepWhen, WHEN_GROUP_LABEL, WHEN_GROUPS, type Seal, type WhenGroup } from "@/lib/stepsView";
import { askPerson } from "@/lib/askPerson";
import { buildIcs } from "@/lib/booking";
import { dayOptions, formatTime, googleCalendarUrl, localStart, timeOptions } from "@/lib/calendarLinks";
import { SPEECH_LANG } from "@/lib/speechLang";
import { PaperFirst } from "./PaperFirst";
import { ShowOnPaper } from "./ShowOnPaper";

export const KIND: Record<string, { label: string; cls: string }> = {
  medication: { label: "Medicine", cls: "bg-sky text-sky-deep" },
  lab_test: { label: "Lab test", cls: "bg-lilac text-ink" },
  referral: { label: "Referral", cls: "bg-peach text-peach-deep" },
  follow_up_visit: { label: "Next visit", cls: "bg-mint text-teal-deep" },
  self_care: { label: "Daily care", cls: "bg-mint-soft text-teal-deep" },
  warning_sign: { label: "Warning sign", cls: "bg-red-soft text-red" },
};

const GROUP_NOTE: Partial<Record<WhenGroup, string>> = {
  unclear: "Your paper doesn't give a clear time for these yet, or we couldn't confirm one. Check the date on your paper, or ask your clinic.",
};

type Props = {
  care: CarePlanResponse;
  /** The steps still shown (not removed), in paper order. */
  items: VerifiedItem[];
  removedItems: VerifiedItem[];
  /** Paper first (lib/paperFirst.ts): the second check's result for a step, with this device's dispute folded in. */
  checkFor: (id: string) => Check;
  meaning: MeaningState;
  deviceRun: DeviceRun;
  deviceStatus: DeviceStatus;
  done: Record<string, boolean>;
  onDone: (id: string, value: boolean) => void;
  onRemove: (id: string) => void;
  onUndoRemove: (id: string) => void;
  /** The photo this reading came from, so "Show on my paper" boxes the right photo. */
  photo: File | null;
  language: string;
  simpler: { ok: boolean; onClick: () => void };
};

/**
 * "Your steps" (Akhil's concept A, "By when"): warning signs pinned on top, one trust line, then every step as one line
 * in a time group, with one seal, and every "Ask your clinic" question in one list at the end. A tap opens a step:
 * the paper's words and the explanation (paper first), the checks, and the actions.
 *
 * A closed row leads with the AI's title only when the step is certified; otherwise it shows the paper's own words
 * (lib/stepsView.ts, closedRow). Time groups come from the paper's words (stepWhen).
 */
export function CareSteps(p: Props) {
  const { care, items, checkFor } = p;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState<string | null>(null);
  const speech = useStepSpeech(p.language);

  const warnings = items.filter((i) => i.kind === "warning_sign");
  const groups = useMemo(() => {
    const by = new Map<WhenGroup, VerifiedItem[]>(WHEN_GROUPS.map((g) => [g, []]));
    for (const it of items) if (it.kind !== "warning_sign") by.get(stepWhen(it, checkFor(it.id)).group)!.push(it);
    return WHEN_GROUPS.map((g) => ({ g, list: by.get(g)! })).filter((x) => x.list.length > 0);
  }, [items, checkFor]);
  // Numbered in the order shown, so "step 3" is the third row a person sees.
  const order = [...warnings, ...groups.flatMap((x) => x.list)];
  const numberOf = (id: string) => order.findIndex((i) => i.id === id) + 1;

  const seals = items.map((i) => sealOf(checkFor(i.id)));
  const twice = seals.filter((s) => s === "twice").length;
  const recheck = seals.filter((s) => s === "recheck").length;
  const stepQuestions = items.filter((i) => i.needs_clarification && i.question_for_clinic.trim());
  const questionCount = stepQuestions.length + care.questions_for_doctor.length;

  // A check that disagrees can land after the steps are on screen. Opening the step is not an announcement, so a
  // polite live region (always mounted, text set a moment later) names each one by its paper words (Codex review).
  const flaggedNote = recheck === 0 ? "" : `${recheck} ${recheck === 1 ? "step needs" : "steps need"} a second look, opened below: ${items
    .filter((i) => sealOf(checkFor(i.id)) === "recheck").map((i) => `"${shortQuote(i.source_quote, 60)}"`).join(", ")}.`;
  const [spoken, setSpoken] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSpoken(flaggedNote), 400);
    return () => clearTimeout(t);
  }, [flaggedNote]);

  const isOpen = (id: string) => open[id] ?? sealOf(checkFor(id)) === "recheck";
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !isOpen(id) }));

  const row = (it: VerifiedItem, warn = false) => (
    <StepRow key={it.id} it={it} n={numberOf(it.id)} warn={warn} check={checkFor(it.id)} open={isOpen(it.id)} onToggle={() => toggle(it.id)}
      done={!!p.done[it.id]} onDone={(v) => p.onDone(it.id, v)} onRemove={() => p.onRemove(it.id)}
      care={care} photo={p.photo} meaning={p.meaning} deviceRun={p.deviceRun} deviceStatus={p.deviceStatus}
      speaking={speech.speaking === it.id} onSpeak={() => speech.toggle(it.id, paperFirstLines(careStepView(it, checkFor(it.id))))}
      onHover={setActive} />
  );

  return (
    <div className="mt-8" data-steps="by-when">
      <p role="status" aria-live="polite" className="sr-only" data-flagged-status="">{spoken}</p>
      {(care.has_warning_signs || warnings.length > 0) && (
        <section aria-labelledby="warn-title" className="mb-5 rounded-2xl border-2 border-red bg-red-soft p-4 text-red" data-warnings="">
          <h3 id="warn-title" className="display text-xl">Warning signs from your paper</h3>
          <p className="text-sm font-semibold">If you have any of them right now, do what your paper says: call your clinic, or call 911.</p>
          {warnings.length > 0 && <ul className="mt-3 space-y-2">{warnings.map((it) => row(it, true))}</ul>}
        </section>
      )}

      <div className="flex items-start gap-3 rounded-2xl bg-mint-soft px-3 py-2 text-sm font-bold text-teal-deep" data-trust-line="">
        <SealMark seal="twice" />
        <p className="min-w-0 flex-1">
          {items.length === 1 ? "Your 1 step uses words from your paper." : `All ${items.length} steps use words from your paper.`}
          {p.meaning.status === "loading" ? " Double-checking each one now..." : ` ${twice} checked twice.`}
          {recheck > 0 && <span className="text-peach-deep"> {recheck} {recheck === 1 ? "needs" : "need"} a second look.</span>}
        </p>
      </div>
      <p className="mt-2 text-xs font-bold text-ink/70">{care.stats.grounded} steps found in your paper · {care.stats.refused} held back because we couldn&apos;t show their words from your paper · {(care.stats.ms / 1000).toFixed(1)}s</p>
      {p.deviceStatus === "loading" && <p className="mt-1 text-xs font-semibold text-ink/70">Checking each step again on this device...</p>}
      {p.deviceStatus === "error" && <p className="mt-1 text-xs font-semibold text-ink/70">This device couldn&apos;t run its own check, so each step shows our server&apos;s check only.</p>}
      {p.simpler.ok && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <button type="button" onClick={p.simpler.onClick} aria-describedby="simpler-why"
            className="rounded-full border-2 border-ink bg-sun px-4 py-2 text-sm font-bold shadow-[0_2px_0_var(--ink)] hover:bg-mint focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-teal-deep">
            Too much? Make it simpler
          </button>
          <span id="simpler-why" className="text-xs font-semibold text-ink/70">Reads your paper again in plainer words, in the same language.</span>
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <h3 className="display text-2xl">Your steps</h3>
          <p className="text-xs font-semibold text-ink/70">Tap a step to see your paper&apos;s words, what they mean, and more. Times count from your visit, as your paper says them.</p>
          {groups.length === 0 && warnings.length === 0 && <p className="mt-3 text-sm font-semibold">No steps are left. Undo a removed step, or read your paper again.</p>}
          {groups.map(({ g, list }) => (
            <section key={g} aria-labelledby={`when-${g}`} className="mt-4" data-when-group={g}>
              <h4 id={`when-${g}`} className="flex items-baseline justify-between gap-2 font-extrabold">
                <span className="display text-lg">{WHEN_GROUP_LABEL[g]}</span>
                <span className="text-xs font-bold text-ink/70">{list.length} {list.length === 1 ? "step" : "steps"}</span>
              </h4>
              {GROUP_NOTE[g] && <p className="text-xs font-semibold text-ink/70">{GROUP_NOTE[g]}</p>}
              <ul className="mt-2 space-y-2">{list.map((it) => row(it))}</ul>
            </section>
          ))}
        </div>

        <div className="space-y-4">
          {questionCount > 0 && <AskClinic care={care} stepQuestions={stepQuestions} />}
          {care.not_in_document.length > 0 && (
            <section aria-labelledby="not-said-title" className="rounded-2xl border-2 border-ink/70 bg-paper p-4">
              <h3 id="not-said-title" className="font-extrabold">What your paper does not say</h3>
              <p className="text-xs text-ink/70">Worth asking your clinic about.</p>
              <ul className="mt-2 list-disc pl-5 text-sm">{care.not_in_document.map((q, i) => <li key={i}>{q}</li>)}</ul>
            </section>
          )}
          <div className="rounded-2xl border-2 border-ink/70 bg-paper p-4">
            <p className="font-extrabold mb-2">Your paper, every step highlighted</p>
            {/* Focusable so keyboard users can scroll the paper (axe scrollable-region-focusable). */}
            <div data-lenis-prevent tabIndex={0} role="region" aria-label="Your paper with every step highlighted"
              className="max-h-[26rem] overflow-auto rounded-lg focus-visible:outline-2 focus-visible:outline-teal"><Highlighted text={care.source_text} items={items} active={active} /></div>
          </div>
          {p.removedItems.length > 0 && (
            <div className="rounded-2xl border-2 border-ink/30 bg-paper p-4 text-sm">
              <p className="font-extrabold">You removed {p.removedItems.length}</p>
              <ul className="mt-2 space-y-1">
                {p.removedItems.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <span data-paper-quote="">{KIND[r.kind]?.label ?? "Step"}: your paper says &ldquo;{r.source_quote}&rdquo;</span>
                    <button type="button" className="font-bold underline" onClick={() => p.onUndoRemove(r.id)}>Undo</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {care.refused.length > 0 && (
            <div className="rounded-2xl border-2 border-ink/30 bg-paper p-4">
              <p className="font-extrabold">Held back to protect you ({care.refused.length})</p>
              <p className="text-xs text-ink/70">The AI suggested these, but we couldn&apos;t show their words from your paper, so we don&apos;t show what it said. Read your paper itself.</p>
              {/* Never the AI's title: a held-back step has no paper words to stand next to it (Codex round 13). */}
              <ul className="mt-2 list-disc pl-5 text-sm">{care.refused.map((r, n) => (
                <li key={r.id}>Held back {n + 1}: {r.held_reason === "sentence_too_long" ? "its sentence in your paper is too long to show here." : r.held_reason === "skips_across" ? "its words come from different lines of your paper." : "its words are not in your paper."}</li>
              ))}</ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SealMark({ seal }: { seal: Seal }) {
  const look = seal === "twice" ? "bg-teal text-paper" : seal === "once" ? "border-2 border-teal bg-paper text-teal-deep" : "border-2 border-peach-deep bg-peach text-peach-deep";
  return <span aria-hidden="true" className={`grid h-6 w-6 flex-none place-items-center rounded-full text-[11px] font-extrabold ${look}`}>{seal === "twice" ? "✓✓" : seal === "once" ? "✓" : "!"}</span>;
}

type RowProps = {
  it: VerifiedItem; n: number; warn: boolean; check: Check; open: boolean; onToggle: () => void;
  done: boolean; onDone: (v: boolean) => void; onRemove: () => void;
  care: CarePlanResponse; photo: File | null; meaning: MeaningState; deviceRun: DeviceRun; deviceStatus: DeviceStatus;
  speaking: boolean; onSpeak: () => void; onHover: (id: string | null) => void;
};

function StepRow({ it, n, warn, check, open, onToggle, done, onDone, onRemove, care, photo, meaning, deviceRun, deviceStatus, speaking, onSpeak, onHover }: RowProps) {
  const panelId = useId();
  const seal = sealOf(check);
  // Warning signs are never shortened: the part that says what to do ("call 911") must stay on the row.
  const closed = closedRow(it, check, { full: warn });
  const device = deviceStatus === "done" ? deviceRun.byId[it.id] : undefined;
  const m = meaning.status === "done" ? meaning.byId[it.id] : undefined;
  const question = it.needs_clarification && it.question_for_clinic.trim() ? it.question_for_clinic : "";
  const kind = KIND[it.kind];
  return (
    <li onMouseEnter={() => onHover(it.id)} onMouseLeave={() => onHover(null)} data-step={it.id} data-seal={seal} data-open={open || undefined}
      className={`rounded-2xl border-2 bg-paper ${warn ? "border-red" : open ? "border-ink" : "border-ink/20"}`}>
      <div className="flex items-start gap-3 p-3">
        <input type="checkbox" aria-label={`Mark step ${n} done`} className="mt-1 h-6 w-6 flex-none accent-[var(--teal)]"
          checked={done} onChange={(e) => onDone(e.target.checked)} />
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panelId}
          className="group grid flex-1 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-xl text-left">
          <span className="min-w-0" data-closed-row={closed.lead}>
            {closed.lead === "explanation"
              ? <span className={`block font-extrabold leading-snug ${done ? "line-through text-ink/70" : ""}`}>{closed.title}</span>
              // Open, the panel shows the paper's whole line first; the row does not repeat it (no duplicate quote).
              : open ? null
              : (
                <span className={`block leading-snug ${done ? "line-through text-ink/70" : ""}`} data-paper-quote="">
                  <span className="block text-[11px] font-extrabold uppercase tracking-wide text-ink/70">From your paper</span>
                  <span className="font-bold">&ldquo;{closed.quote}&rdquo;</span>
                </span>
              )}
            <span className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-ink/70 ${closed.lead === "quote" && open ? "" : "mt-1"}`}>
              {kind && <span className={`chip ${kind.cls}`}>{kind.label}</span>}
              {closed.lead === "explanation" && closed.when && <span>{closed.when}</span>}
              {closed.lead === "quote" && closed.paperWhen.length > 0 && <span>{closed.paperWhen.map((w) => `“${w}”`).join(", ")}</span>}
              {question && <span className="rounded-full bg-peach px-2 text-[11px] font-extrabold text-peach-deep">? Ask</span>}
              {/* Only the "double-check" seal speaks up with words on the row; the quiet ones say theirs to screen readers. */}
              <span data-seal-label="" className={seal === "recheck" ? "rounded-full border border-peach-deep bg-peach px-2 text-[11px] font-extrabold text-peach-deep" : "sr-only"}>{SEAL_SHORT[seal]}</span>
            </span>
          </span>
          <SealMark seal={seal} />
          <span aria-hidden="true" className="font-extrabold text-ink/70 transition-transform group-aria-expanded:rotate-90">›</span>
        </button>
      </div>
      <div id={panelId} hidden={!open} className="space-y-2 px-3 pb-3 sm:pl-12">
        {device && device !== "match" && (
          <p role="note" className="rounded-xl bg-peach p-2 text-sm font-semibold text-peach-deep" data-device-check="differ">
            Double-check this one: this device&apos;s own check {device === "missing" ? "could not find these words in your paper" : "found these words in a different place in your paper"}. Read the line from your paper below.
          </p>
        )}
        {m?.flagged && (
          <p role="note" className="rounded-xl bg-peach p-2 text-sm font-semibold text-peach-deep" data-meaning-check="flagged">
            Double-check this one with your clinic: our second check says the explanation may not match your paper.
            {m.what_differs ? ` ${m.what_differs.charAt(0).toUpperCase()}${m.what_differs.slice(1)}` : ""}
            {m.unexpected_numbers.length > 0 ? ` (Number not in your paper: ${m.unexpected_numbers.join(", ")}.)` : ""}
          </p>
        )}
        <PaperFirst v={careStepView(it, check)} />
        {seal === "once" ? (
          // Checked once: the long reason waits behind "Why?" so the card reads as a step, not a disclaimer.
          <details className="text-xs font-bold text-ink/70" data-seal-text={seal}>
            <summary className="inline-flex cursor-pointer items-center gap-2 rounded-full focus-visible:outline-2 focus-visible:outline-teal-deep">
              <SealMark seal={seal} />
              <span>{SEAL_SHORT[seal]}{meaning.status === "loading" ? " · double-checking now..." : ""}</span>
              <span className="underline">Why?</span>
            </summary>
            <p className="mt-1 pl-8 font-semibold">
              {SEAL_TEXT[seal]}
              {device === "match" && <span data-device-check="match"> This device found the same words in the same place.</span>}
              {m && !m.flagged && !m.certified && " Our second check couldn't confirm this one."}
            </p>
          </details>
        ) : (
          <p className={`flex items-start gap-2 text-xs font-bold ${seal === "twice" ? "text-teal-deep" : "text-peach-deep"}`} data-seal-text={seal}>
            <SealMark seal={seal} />
            <span>
              {SEAL_TEXT[seal]}
              {device === "match" && <span data-device-check="match"> This device found the same words in the same place.</span>}
              {meaning.status === "loading" && " Double-checking this against your paper..."}
              {m && !m.flagged && !m.certified && " Our second check couldn't confirm this one."}
            </span>
          </p>
        )}
        {question && <p className="rounded-xl bg-peach p-2 text-sm font-semibold text-peach-deep">On your questions list: {question}</p>}
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
          <AskAPerson it={it} check={check} />
          <ShowOnPaper care={care} item={it} photo={photo} check={check} />
          <RemindMe it={it} check={check} />
          <button type="button" onClick={onSpeak} aria-pressed={speaking}
            className={`mt-2 rounded-full border-2 border-ink px-3 py-1 ${speaking ? "bg-ink text-paper" : "bg-paper hover:bg-mint"}`}>
            {speaking ? "⏹ Stop" : "🔊 Read aloud"}
          </button>
          <button type="button" aria-label={`Remove step ${n}`} onClick={onRemove} className="mt-2 rounded-full px-3 py-1 text-ink/70 hover:text-red">Remove</button>
        </div>
      </div>
    </li>
  );
}

/** Every "Ask your clinic" question in one list. A step's question carries the paper line it is about. */
function AskClinic({ care, stepQuestions }: { care: CarePlanResponse; stepQuestions: VerifiedItem[] }) {
  const [copied, setCopied] = useState(false);
  const lines = [...stepQuestions.map((i) => i.question_for_clinic.trim()), ...care.questions_for_doctor];
  function copy() {
    navigator.clipboard?.writeText(lines.map((q, i) => `${i + 1}. ${q}`).join("\n")).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {});
  }
  return (
    <section aria-labelledby="ask-clinic-title" className="rounded-2xl border-2 border-dashed border-peach-deep bg-paper p-4" data-ask-clinic="">
      <h3 id="ask-clinic-title" className="display text-xl">Ask your clinic ({lines.length})</h3>
      <p className="text-xs text-ink/70">Bring these to your next call or visit.</p>
      <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">
        {stepQuestions.map((i) => (
          <li key={i.id}>
            {i.question_for_clinic}
            <span className="block text-xs font-semibold text-ink/70" data-paper-quote="">About this line of your paper: &ldquo;{shortQuote(i.source_quote, 60)}&rdquo;</span>
          </li>
        ))}
      </ol>
      {care.questions_for_doctor.length > 0 && (
        <>
          {stepQuestions.length > 0 && <h4 className="mt-3 text-xs font-extrabold uppercase tracking-wide text-ink/70">More questions for your next visit</h4>}
          <ol start={stepQuestions.length + 1} className="mt-2 list-decimal space-y-2 pl-5 text-sm">
            {care.questions_for_doctor.map((q, k) => <li key={`d${k}`}>{q}</li>)}
          </ol>
        </>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={copy} className="rounded-full border-2 border-ink px-3 py-1 text-xs font-bold hover:bg-mint">Copy questions</button>
        <span role="status" className="text-xs font-semibold text-ink/70">{copied ? "Copied" : ""}</span>
      </div>
    </section>
  );
}

/**
 * "Ask your pharmacist" (a medicine step) or "Ask your clinic" (any other step), only while the explanation is not
 * double-checked: a question ready to read out or copy, built from the paper's own words only (lib/askPerson.ts).
 */
function AskAPerson({ it, check }: { it: VerifiedItem; check: Check }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const panelId = useId();
  const ask = askPerson(it, check);
  if (!ask) return null;
  function copy() {
    navigator.clipboard?.writeText(ask!.question).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {});
  }
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={panelId} data-ask-person={ask.who}
        className="mt-2 rounded-full border-2 border-ink bg-sun px-3 py-1 hover:bg-mint">💬 {ask.label}</button>
      <div id={panelId} hidden={!open} className="basis-full rounded-xl border-2 border-dashed border-ink/40 p-3 text-sm" data-ask-person-panel="">
        <p className="text-xs font-bold text-ink/70">{ask.who === "pharmacist" ? "Show or read this to your pharmacist. It uses only your paper's words." : "Show or read this to your clinic. It uses only your paper's words."}</p>
        <p className="mt-1 font-semibold" data-ask-question="">{ask.question}</p>
        <div className="mt-2 flex items-center gap-2">
          <button type="button" onClick={copy} className="rounded-full border-2 border-ink px-3 py-1 text-xs font-bold hover:bg-mint">Copy question</button>
          <span role="status" className="text-xs font-semibold text-ink/70">{copied ? "Copied" : ""}</span>
        </div>
      </div>
    </>
  );
}

/**
 * "Remind me": a calendar reminder for one step. Its title is the step's kind, never the AI's title, and its text is
 * what may leave the screen under the paper-first rule (paperFirstLines): the explanation only when certified.
 */
function RemindMe({ it, check }: { it: VerifiedItem; check: Check }) {
  const [open, setOpen] = useState(false);
  const days = useMemo(() => dayOptions(new Date(), 14), []);
  const [day, setDay] = useState(days[0].value);
  const [time, setTime] = useState("09:00");
  const panelId = useId();
  const start = localStart(day, time);
  const title = bookSafe(it, check).title;
  const details = [...paperFirstLines(careStepView(it, check)), "Made with ATLAS (atlas-team12.vercel.app). Not medical advice."].join("\n");

  function download() {
    if (!start) return;
    const ics = buildIcs({ uid: `${it.id}-${start.getTime()}-remind@atlas-team12.vercel.app`, start, minutes: 15, title, description: details });
    const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "atlas-reminder.ics";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const googleUrl = start ? googleCalendarUrl({ title, start, minutes: 15, details, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York" }) : "#";

  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={panelId}
        className="mt-2 rounded-full border-2 border-ink bg-paper px-3 py-1 hover:bg-mint">⏰ Remind me</button>
      <div id={panelId} hidden={!open} className="basis-full rounded-xl border-2 border-dashed border-ink/40 p-3 text-sm">
        <div className="flex flex-wrap items-end gap-3">
          <label className="font-bold">Day
            <select value={day} onChange={(e) => setDay(e.target.value)} className="ml-2 rounded-lg border-2 border-ink/40 bg-paper px-2 py-1">
              {days.map((d) => <option key={d.value} value={d.value}>{d.label}, {d.sub}</option>)}
            </select>
          </label>
          <label className="font-bold">Time
            <select value={time} onChange={(e) => setTime(e.target.value)} className="ml-2 rounded-lg border-2 border-ink/40 bg-paper px-2 py-1">
              {timeOptions().map((t) => <option key={t} value={t}>{formatTime(t)}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <a href={googleUrl} target="_blank" rel="noreferrer" className="rounded-full bg-teal px-3 py-1 font-bold text-paper">Add to Google Calendar ↗</a>
          <button type="button" onClick={download} className="rounded-full border-2 border-ink px-3 py-1 font-bold">Apple or Outlook (.ics)</button>
        </div>
        <p className="mt-1 text-xs text-ink/70">The reminder carries the line from your paper{check === "certified" ? " and the double-checked explanation" : ""}.</p>
      </div>
    </>
  );
}

/** One step read aloud with the device's voice, by the paper-first rule: the explanation only when certified. */
function useStepSpeech(language: string) {
  const [speaking, setSpeaking] = useState<string | null>(null);
  const run = useRef(0);
  useEffect(() => () => {
    run.current++;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);
  function toggle(id: string, lines: string[]) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const mine = ++run.current;
    window.speechSynthesis.cancel();
    if (speaking === id) { setSpeaking(null); return; }
    setSpeaking(id);
    lines.forEach((line, i) => {
      const u = new SpeechSynthesisUtterance(line);
      u.lang = SPEECH_LANG[language] ?? "en-US";
      u.rate = 0.95;
      if (i === lines.length - 1) u.onend = () => { if (run.current === mine) setSpeaking(null); };
      u.onerror = () => { if (run.current === mine) setSpeaking(null); };
      window.speechSynthesis.speak(u);
    });
  }
  return { speaking, toggle };
}

function Highlighted({ text, items, active }: { text: string; items: VerifiedItem[]; active: string | null }) {
  const parts = useMemo(() => {
    const spans = items.filter((i) => i.span).map((i) => ({ ...i.span!, id: i.id })).sort((a, b) => a.start - b.start);
    const out: { t: string; id?: string }[] = [];
    let at = 0;
    for (const s of spans) {
      if (s.start < at) continue;
      out.push({ t: text.slice(at, s.start) }, { t: text.slice(s.start, s.end), id: s.id });
      at = s.end;
    }
    out.push({ t: text.slice(at) });
    return out;
  }, [text, items]);
  return (
    <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-ink/80">
      {parts.map((part, i) => part.id
        ? <mark key={i} className={`rounded px-0.5 transition-colors ${active === part.id ? "bg-sun" : "bg-sun/35"}`}>{part.t}</mark>
        : <span key={i}>{part.t}</span>)}
    </pre>
  );
}
