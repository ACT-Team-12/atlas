"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { bookSafe, careStepView, paperFirstLines, type Check } from "@/lib/paperFirst";
import type { CarePlanResponse, VerifiedItem } from "@/lib/schema";
import type { MeaningState } from "@/lib/meaningRun";
import type { DeviceRun, DeviceStatus } from "@/lib/deviceRun";
import { isWarning } from "@/lib/warningPin";
import { closedRow, sealOf, shortQuote, stepWhen, WHEN_GROUPS, type Seal } from "@/lib/stepsView";
import { askPerson, type AskPerson } from "@/lib/askPerson";
import { readingGeneralQuestions, stepVisitQuestion, uniqueStepQuestions } from "@/lib/visitQuestions";
import { buildIcs } from "@/lib/booking";
import { dayOptions, formatTime, googleCalendarUrl, localStart, timeOptions } from "@/lib/calendarLinks";
import { SPEECH_LANG } from "@/lib/speechLang";
import { pipLine, pipSpot, type PipSpot } from "@/lib/pip";
import { nextOpen, walkEnglishBeside, walkLine, walkPip, walkSteps, type WalkStep } from "@/lib/walkThrough";
import { MedicineChanges } from "./MedicineChanges";
import { PaperFirst } from "./PaperFirst";
import { ShowOnPaper } from "./ShowOnPaper";
import { CalmToggle, PipBubble, PipMarker, PipSlot, usePipCalm } from "./Pip";
import { englishBeside, keyFor } from "@/lib/uiText";
import { useUi, PaperWords, withEnglish } from "./UiLang";

export const KIND: Record<string, { label: string; cls: string }> = {
  medication: { label: "Medicine", cls: "bg-sky text-sky-deep" },
  lab_test: { label: "Lab test", cls: "bg-lilac text-ink" },
  referral: { label: "Referral", cls: "bg-peach text-peach-deep" },
  follow_up_visit: { label: "Next visit", cls: "bg-mint text-teal-deep" },
  self_care: { label: "Daily care", cls: "bg-mint-soft text-teal-deep" },
  warning_sign: { label: "Warning sign", cls: "bg-red-soft text-red" },
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
  const { t, ts, tn, lang, paperLang } = useUi();
  // A removed warning sign still names its kind with the English beside it (a safety label, Codex review round 4).
  const removedSays = (kind: string) => {
    const k = keyFor("kind", kind, "kind.step");
    return withEnglish(t("steps.removedSays", { kind: t(k) }), englishBeside(lang, k));
  };

  const warnings = items.filter(isWarning);
  // Every step in the order shown (lib/walkThrough.ts): warning signs, then each time group. The list and "Walk me
  // through it" both read this one order, so "Step 3 of 12" is row 3.
  const walk = useMemo(() => walkSteps(items, isWarning, (it) => stepWhen(it, checkFor(it.id), care.source_text).group), [items, checkFor, care.source_text]);
  const groups = useMemo(() => WHEN_GROUPS.map((g) => ({ g, list: walk.filter((s) => s.group === g).map((s) => s.it) })).filter((x) => x.list.length > 0), [walk]);
  // Numbered in the order shown, so "step 3" is the third row a person sees.
  const order = walk.map((s) => s.it);
  const numberOf = (id: string) => order.findIndex((i) => i.id === id) + 1;

  // Pip (Akhil's "you are here" marker, lib/pip.ts): on the first step not done, earliest group first. Warning signs
  // are never its spot. A step just marked done gets a quiet cheer for a moment (not medicine, labs or a flagged step),
  // then Pip moves on. What it says is a fixed line, read once through the polite live region below.
  const stepOrder = groups.flatMap((x) => x.list);
  const [cheering, setCheering] = useState<string | null>(null);
  useEffect(() => {
    if (!cheering) return;
    const t = setTimeout(() => setCheering(null), 1400);
    return () => clearTimeout(t);
  }, [cheering]);
  // When the first current step is a quiet card (medicine, lab, warning-kind or flagged), Pip greets once at the
  // "Your steps" heading instead, so a first-time person still hears it. Gone for good once any step is marked done,
  // warning signs included (they are never Pip's spot, but a done one still means this is not a first view).
  const [greetOver, setGreetOver] = useState(false);
  // Any step ever marked done, including one since removed (its done mark stays in the saved record; Codex review).
  const anyDoneAtAll = Object.values(p.done).some(Boolean);
  const spot = pipSpot(stepOrder, p.done, checkFor, cheering, !greetOver && !anyDoneAtAll);
  const { calm } = usePipCalm();

  // "Walk me through it" (lib/walkThrough.ts): one step at a time. `walkAt` is the step shown (by id, so a check
  // that lands and regroups the list never swaps the step under the person), "end" the closing screen, null the list.
  // The order is fixed when the walk starts: a late check can move a step to another time group, and the walk must
  // neither skip it nor show it twice (Codex review). Each step still shows its current group and check.
  const [walkAt, setWalkAt] = useState<string | "end" | null>(null);
  const [walkIds, setWalkIds] = useState<string[]>([]);
  const walkSeq = useMemo(() => walkIds.flatMap((id) => walk.filter((s) => s.it.id === id)), [walkIds, walk]);
  const walkIndex = walkAt && walkAt !== "end" ? walkSeq.findIndex((s) => s.it.id === walkAt) : -1;
  const walkStep = walkIndex >= 0 ? walkSeq[walkIndex] : null;
  // A step removed while shown ends the walk on its closing screen, never on a different step.
  const walking = walkAt !== null;
  const shownPip = walkStep ? walkPip(spot, walkStep.it, checkFor(walkStep.it.id), walkStep.group === "warning") : null;
  const listPipText = spot.at !== "none" && spot.line ? pipLine(p.language, spot.line) : "";
  // While walking, Pip speaks only about the step on screen, by the same quiet rules (never on medicine, lab or warning).
  const pipText = walking ? (shownPip?.line ? pipLine(p.language, shownPip.line) : "") : listPipText;
  // Keyed on where Pip is too, not only on the words: two steps cheered one after the other both say "Nice, that's
  // done", and the second must still be read. Clearing first makes the repeated words a fresh change (Codex review).
  // The greeting shares the key of the same step's own "Start here", so a late check that turns that step quiet (or
  // back) moves the words between card and heading without reading them a second time (Codex review).
  const listPipKey = spot.at === "step" ? `${spot.id}:${spot.mood}` : spot.at === "greet" ? `${spot.id}:arrive` : spot.at;
  const pipKey = walking ? `walk:${walkAt}:${shownPip?.mood ?? "none"}` : listPipKey;
  // Pip is one character: during the heading greeting no card shows him (every card's slot stays reserved, empty).
  const cardPip: Extract<PipSpot, { at: "step" }> | null = spot.at === "step" ? spot : null;
  const [pipSaid, setPipSaid] = useState("");
  useEffect(() => {
    const clear = setTimeout(() => setPipSaid(""), 0);
    const t = setTimeout(() => setPipSaid(pipText), 300);
    return () => { clearTimeout(clear); clearTimeout(t); };
  }, [pipText, pipKey]);

  const seals = items.map((i) => sealOf(checkFor(i.id)));
  const twice = seals.filter((s) => s === "twice").length;
  const recheck = seals.filter((s) => s === "recheck").length;
  // Paper first (lib/visitQuestions.ts): a step's own question only when certified, else the paper's words. The general
  // list never repeats a step's question (older readings carried each one there too, so it showed twice).
  const stepQuestions = uniqueStepQuestions(items, checkFor);
  const generalQuestions = readingGeneralQuestions(care);
  const questionCount = stepQuestions.length + generalQuestions.length;

  // A check that disagrees can land after the steps are on screen. Opening the step is not an announcement, so a
  // polite live region (always mounted, text set a moment later) names each one by its paper words (Codex review).
  const flaggedNote = recheck === 0 ? "" : tn("flaggedStatus", recheck, { quotes: items
    .filter((i) => sealOf(checkFor(i.id)) === "recheck").map((i) => `"${shortQuote(i.source_quote, 60)}"`).join(", ") });
  const [spoken, setSpoken] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setSpoken(flaggedNote), 400);
    return () => clearTimeout(t);
  }, [flaggedNote]);

  const isOpen = (id: string) => open[id] ?? sealOf(checkFor(id)) === "recheck";
  const toggle = (id: string) => setOpen((o) => ({ ...o, [id]: !isOpen(id) }));
  // "Go to this step" from the medicine card: open the step, bring it up, and move focus to it (keyboard and
  // screen-reader users land on the step, not back at the top). The link's own #step-id still works when printed.
  const goTo = (id: string) => {
    setOpen((o) => ({ ...o, [id]: true }));
    requestAnimationFrame(() => {
      const li = document.getElementById(`step-${id}`);
      if (!li) return;
      const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      li.scrollIntoView?.({ block: "start", behavior: still ? "auto" : "smooth" });
      li.querySelector<HTMLButtonElement>("button[aria-expanded]")?.focus({ preventScroll: true });
    });
  };

  // One way to mark a step done, for the list and the walk-through alike: the same saved record, Pip's cheer, the end
  // of the first-view greeting.
  const markDone = (id: string, v: boolean) => { p.onDone(id, v); setCheering(v ? id : null); if (v) setGreetOver(true); };

  const walkButton = useRef<HTMLButtonElement>(null);
  const [walkReturn, setWalkReturn] = useState(0);
  // Back on the list: focus returns to the button that opened the walk-through.
  useEffect(() => { if (walkReturn) walkButton.current?.focus(); }, [walkReturn]);
  const startWalk = () => {
    if (walk.length === 0) return;
    speech.stop(); // a row being read aloud is hidden once the walk opens
    const at = nextOpen(walk, p.done, 0);
    setWalkIds(walk.map((s) => s.it.id));
    setWalkAt(walk[at < 0 ? 0 : at].it.id);
  };

  // Read aloud carries the explanation only when certified (paperFirstLines). If the step's check changes while it is
  // being read (a late device check that disagrees), the queued lines no longer match, so the reading stops (Codex review).
  const spokeAs = useRef<Check | null>(null);
  const speakStep = (it: VerifiedItem) => {
    spokeAs.current = checkFor(it.id);
    speech.toggle(it.id, paperFirstLines(careStepView(it, spokeAs.current)));
  };
  const speakingCheck = speech.speaking ? checkFor(speech.speaking) : null;
  const stopSpeech = speech.stop;
  useEffect(() => { if (speakingCheck !== null && speakingCheck !== spokeAs.current) stopSpeech(); }, [speakingCheck, stopSpeech]);
  const exitWalk = () => { speech.stop(); setWalkAt(null); setWalkReturn((n) => n + 1); };

  const row = (it: VerifiedItem, warn = false) => (
    <StepRow key={it.id} it={it} n={numberOf(it.id)} warn={warn} check={checkFor(it.id)} open={isOpen(it.id)} onToggle={() => toggle(it.id)}
      done={!!p.done[it.id]} onDone={(v) => markDone(it.id, v)} onRemove={() => p.onRemove(it.id)}
      pip={!warn && cardPip?.id === it.id ? cardPip : null} pipText={pipText} calm={calm}
      care={care} photo={p.photo} meaning={p.meaning} deviceRun={p.deviceRun} deviceStatus={p.deviceStatus}
      speaking={speech.speaking === it.id} onSpeak={() => speakStep(it)}
      onHover={setActive} />
  );

  return (
    <div className="mt-8" data-steps="by-when">
      <p role="status" aria-live="polite" className="sr-only" data-flagged-status="">{spoken}</p>
      <p role="status" aria-live="polite" className="sr-only" data-pip-status="">{pipSaid}</p>
      {walking && (
        <WalkThrough step={walkStep} index={walkIndex} steps={walkSeq} done={p.done} checkFor={checkFor} language={p.language}
          pip={shownPip} pipText={pipText} calm={calm} speaking={!!walkStep && speech.speaking === walkStep.it.id}
          onSpeak={() => walkStep && speakStep(walkStep.it)}
          onGo={(at) => { speech.stop(); setWalkAt(at); }} onDone={markDone} onExit={exitWalk} />
      )}
      {/* The full list stays in the page while walking: hidden on screen, printed as usual (globals.css, .walk-away). */}
      <div className={walking ? "walk-away" : undefined} data-walk-away={walking || undefined}>
      {(care.has_warning_signs || warnings.length > 0) && (
        <section aria-labelledby="warn-title" className="mb-5 rounded-2xl border-2 border-red bg-red-soft p-4 text-red" data-warnings="">
          <h3 id="warn-title" tabIndex={-1} className="display text-xl scroll-mt-28 outline-none focus-visible:outline-3 focus-visible:outline-teal-deep">{ts("steps.warnTitle")}</h3>
          <p className="text-sm font-semibold">{ts("steps.warnBody")}</p>
          {warnings.length > 0 && <ul className="mt-3 space-y-2">{warnings.map((it) => row(it, true))}</ul>}
        </section>
      )}

      <div className="flex items-start gap-3 rounded-2xl bg-mint-soft px-3 py-2 text-sm font-bold text-teal-deep" data-trust-line="">
        <SealMark seal="twice" />
        <p className="min-w-0 flex-1">
          {tn("trustLine", items.length)}
          {p.meaning.status === "loading" ? t("steps.trustLoading") : ` ${tn("checkedTwice", twice)}`}
          {recheck > 0 && <span className="text-peach-deep"> {tn("needSecondLook", recheck)}</span>}
        </p>
      </div>
      <p className="mt-2 text-xs font-bold text-ink/70">{tn("foundHeld", care.stats.grounded)} · {tn("heldBack", care.stats.refused)} · {(care.stats.ms / 1000).toFixed(1)}s</p>
      {p.deviceStatus === "loading" && <p className="mt-1 text-xs font-semibold text-ink/70">{t("steps.deviceLoading")}</p>}
      {p.deviceStatus === "error" && <p className="mt-1 text-xs font-semibold text-ink/70">{t("steps.deviceError")}</p>}
      {p.simpler.ok && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <button type="button" onClick={p.simpler.onClick} aria-describedby="simpler-why"
            className="rounded-full border-2 border-ink bg-sun px-4 py-2 text-sm font-bold shadow-[0_2px_0_var(--ink)] hover:bg-mint focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-teal-deep">
            {t("steps.simpler")}
          </button>
          <span id="simpler-why" className="text-xs font-semibold text-ink/70">{t("steps.simplerWhy")}</span>
        </div>
      )}
      {walk.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
          <button ref={walkButton} type="button" onClick={startWalk} aria-describedby="walk-why" data-walk-open=""
            className="min-h-[48px] rounded-full border-2 border-ink bg-teal px-5 py-2 text-base font-extrabold text-paper shadow-[0_2px_0_var(--ink)] hover:bg-teal-deep focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-teal-deep">
            <span lang={SPEECH_LANG[p.language] ?? "en-US"}>{walkLine(p.language, "open")}</span>
          </button>
          <span id="walk-why" lang={SPEECH_LANG[p.language] ?? "en-US"} className="text-xs font-semibold text-ink/70">{walkLine(p.language, "openHint")}</span>
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.15fr_1fr]">
        <div>
          <div data-pip-heading-area="">
            <div className="flex items-start justify-between gap-2">
              <h3 id="steps-title" tabIndex={-1} className="display text-2xl scroll-mt-28 outline-none focus-visible:outline-3 focus-visible:outline-teal-deep">{t("steps.title")}</h3>
              <div className="flex items-center gap-2" data-pip-heading="">
                <CalmToggle />
                {/* Pip's heading spot (the first-view greeting, or every step done); reserved either way so the heading
                    never shifts. */}
                {stepOrder.length > 0 && <PipSlot>{(spot.at === "header" || spot.at === "greet") && <PipMarker key={spot.at} mood={spot.mood} calm={calm} />}</PipSlot>}
              </div>
            </div>
            {spot.at === "header" && <div className="mt-1 flex justify-end" data-pip-done-all=""><PipBubble text={pipText} /></div>}
            {spot.at === "greet" && <div className="mt-1 flex justify-end" data-pip-greet=""><PipBubble text={pipText} pointDown /></div>}
          </div>
          <p className="text-xs font-semibold text-ink/70">{t("steps.tapHint")}</p>
          {/* Above the time groups, not inside "Right away": a change or a new medicine is often daily, not right away,
              and the card must not file it under a time the paper does not give it. */}
          <MedicineChanges items={items} paper={care.source_text} onGo={goTo} />
          {groups.length === 0 && warnings.length === 0 && <p className="mt-3 text-sm font-semibold">{t("steps.noneLeft")}</p>}
          {groups.map(({ g, list }) => (
            <section key={g} aria-labelledby={`when-${g}`} className="mt-4" data-when-group={g}>
              <h4 id={`when-${g}`} className="flex items-baseline justify-between gap-2 font-extrabold">
                <span className="display text-lg">{ts(keyFor("when", g, "when.unclear"))}</span>
                <span className="text-xs font-bold text-ink/70">{tn("steps", list.length)}</span>
              </h4>
              {g === "unclear" && <p className="text-xs font-semibold text-ink/70">{ts("when.unclearNote")}</p>}
              <ul className="mt-2 space-y-2">{list.map((it) => row(it))}</ul>
            </section>
          ))}
        </div>

        <div className="space-y-4">
          {questionCount > 0 && <AskClinic stepQuestions={stepQuestions} general={generalQuestions} />}
          {care.not_in_document.length > 0 && (
            <section aria-labelledby="not-said-title" className="rounded-2xl border-2 border-ink/70 bg-paper p-4">
              <h3 id="not-said-title" className="font-extrabold">{t("steps.notSaidTitle")}</h3>
              <p className="text-xs text-ink/70">{t("steps.notSaidNote")}</p>
              <ul className="mt-2 list-disc pl-5 text-sm">{care.not_in_document.map((q, i) => <li key={i}>{q}</li>)}</ul>
            </section>
          )}
          <div className="rounded-2xl border-2 border-ink/70 bg-paper p-4">
            <p className="font-extrabold mb-2">{t("steps.paperHighlighted")}</p>
            {/* Focusable so keyboard users can scroll the paper (axe scrollable-region-focusable). */}
            <div data-lenis-prevent tabIndex={0} role="region" aria-label={t("steps.paperRegion")}
              className="max-h-[26rem] overflow-auto rounded-lg focus-visible:outline-2 focus-visible:outline-teal"><div lang={paperLang}><Highlighted text={care.source_text} items={items} active={active} /></div></div>
          </div>
          {p.removedItems.length > 0 && (
            <div className="rounded-2xl border-2 border-ink/30 bg-paper p-4 text-sm">
              <p className="font-extrabold">{tn("removedCount", p.removedItems.length)}</p>
              <ul className="mt-2 space-y-1">
                {p.removedItems.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-2">
                    <span data-paper-quote="">{removedSays(r.kind)} &ldquo;<PaperWords>{r.source_quote}</PaperWords>&rdquo;</span>
                    <button type="button" className="font-bold underline" onClick={() => p.onUndoRemove(r.id)}>{t("common.undo")}</button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {care.refused.length > 0 && (
            <div className="rounded-2xl border-2 border-ink/30 bg-paper p-4">
              <p className="font-extrabold">{tn("heldTitle", care.refused.length)}</p>
              <p className="text-xs text-ink/70">{ts("steps.heldNote")}</p>
              {/* Never the AI's title: a held-back step has no paper words to stand next to it (Codex round 13). */}
              <ul className="mt-2 list-disc pl-5 text-sm">{care.refused.map((r, n) => (
                <li key={r.id}>{tn("heldItem", n + 1)} {t(r.held_reason === "sentence_too_long" ? "steps.held.sentence_too_long" : r.held_reason === "skips_across" ? "steps.held.skips_across" : "steps.held.missing")}</li>
              ))}</ul>
            </div>
          )}
        </div>
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
  /** Pip's spot when it is on this row (never on a warning sign), what it says, and calm mode. */
  pip?: Extract<PipSpot, { at: "step" }> | null; pipText?: string; calm?: boolean;
};

function StepRow({ it, n, warn, check, open, onToggle, done, onDone, onRemove, care, photo, meaning, deviceRun, deviceStatus, speaking, onSpeak, onHover, pip, pipText, calm = false }: RowProps) {
  const panelId = useId();
  const seal = sealOf(check);
  // Warning signs are never shortened: the part that says what to do ("call 911") must stay on the row.
  const closed = closedRow(it, check, { full: warn });
  const device = deviceStatus === "done" ? deviceRun.byId[it.id] : undefined;
  const m = meaning.status === "done" ? meaning.byId[it.id] : undefined;
  // Not certified: the "Ask your clinic" box below already carries the paper-words question, so no second copy here.
  const question = stepVisitQuestion(it, check) ?? "";
  const kind = KIND[it.kind];
  const { t, ts } = useUi();
  return (
    <li id={`step-${it.id}`} onMouseEnter={() => onHover(it.id)} onMouseLeave={() => onHover(null)} data-step={it.id} data-seal={seal} data-open={open || undefined} data-pip-here={pip?.mood}
      className={`scroll-mt-44 md:scroll-mt-24 rounded-2xl border-2 bg-paper ${warn ? "border-red" : open ? "border-ink" : "border-ink/20"}`}>
      <div className="flex items-start gap-3 p-3">
        <input type="checkbox" aria-label={t("steps.markDone", { n })} className="mt-1 h-6 w-6 flex-none accent-[var(--teal)]"
          checked={done} onChange={(e) => onDone(e.target.checked)} />
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={panelId}
          className="group grid flex-1 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-xl text-left">
          <span className="min-w-0" data-closed-row={closed.lead}>
            {closed.lead === "explanation"
              ? <span className={`block font-extrabold leading-snug ${done ? "line-through text-ink/70" : ""}`}>{closed.title}</span>
              // Open, the panel shows the paper's whole line first; the row does not repeat it on screen (no duplicate
              // quote). The button keeps the line's start in its name, so focus that lands here (a "Go to this step"
              // link) still says which step it is (Codex review). Always shortened, so the full line is still shown only once.
              : open ? <span className="sr-only" data-open-name="">{t("steps.fromYourPaper")}: &ldquo;<PaperWords>{shortQuote(it.source_quote, Math.min(40, Math.floor(it.source_quote.length * 0.6)))}</PaperWords>&rdquo;</span>
              : (
                <span className={`block leading-snug ${done ? "line-through text-ink/70" : ""}`} data-paper-quote="">
                  <span className="block text-[11px] font-extrabold uppercase tracking-wide text-ink/70">{t("steps.fromYourPaper")}</span>
                  <span className="font-bold">&ldquo;<PaperWords>{closed.quote}</PaperWords>&rdquo;</span>
                </span>
              )}
            <span className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-ink/70 ${closed.lead === "quote" && open ? "" : "mt-1"}`}>
              {kind && <span className={`chip ${kind.cls}`}>{ts(keyFor("kind", it.kind, "kind.step"))}</span>}
              {closed.lead === "explanation" && closed.when && <span>{closed.when}</span>}
              {closed.lead === "quote" && closed.paperWhen.length > 0 && <span>{closed.paperWhen.map((w) => `“${w}”`).join(", ")}</span>}
              {question && <span className="rounded-full bg-peach px-2 text-[11px] font-extrabold text-peach-deep">{t("steps.ask")}</span>}
              {/* Only the "double-check" seal speaks up with words on the row; the quiet ones say theirs to screen readers. */}
              <span data-seal-label="" className={seal === "recheck" ? "rounded-full border border-peach-deep bg-peach px-2 text-[11px] font-extrabold text-peach-deep" : "sr-only"}>{ts(keyFor("seal", seal, "seal.once"))}</span>
            </span>
          </span>
          <SealMark seal={seal} />
          <span aria-hidden="true" className="font-extrabold text-ink/70 transition-transform group-aria-expanded:rotate-90">›</span>
        </button>
        {/* Pip's reserved spot on the card's right edge: every step row keeps it, so text never moves when Pip hops. */}
        {!warn && <PipSlot className="-my-1">{pip && <PipMarker key={pip.mood} mood={pip.mood} calm={calm} />}</PipSlot>}
      </div>
      {pip?.line && pipText && <div className="-mt-2 flex justify-end px-3 pb-2"><PipBubble text={pipText} /></div>}
      <div id={panelId} hidden={!open} className="space-y-2 px-3 pb-3 sm:pl-12">
        {device && device !== "match" && (
          <p role="note" className="rounded-xl bg-peach p-2 text-sm font-semibold text-peach-deep" data-device-check="differ">
            {ts(device === "missing" ? "steps.deviceDiffer.missing" : "steps.deviceDiffer.differ")}
          </p>
        )}
        {m?.flagged && (
          <p role="note" className="rounded-xl bg-peach p-2 text-sm font-semibold text-peach-deep" data-meaning-check="flagged">
            {ts("steps.meaningFlagged")}
            {/* The checker's own note is written in English (lib/meaning.ts), so it is marked as English. */}
            {m.what_differs ? <span lang="en" data-what-differs=""> {m.what_differs.charAt(0).toUpperCase()}{m.what_differs.slice(1)}</span> : ""}
            {m.unexpected_numbers.length > 0 ? t("steps.numberNotInPaper", { nums: m.unexpected_numbers.join(", ") }) : ""}
          </p>
        )}
        <PaperFirst v={careStepView(it, check)} />
        {seal === "once" ? (
          // Checked once: the long reason waits behind "Why?" so the card reads as a step, not a disclaimer.
          <details className="text-xs font-bold text-ink/70" data-seal-text={seal}>
            <summary className="inline-flex cursor-pointer items-center gap-2 rounded-full focus-visible:outline-2 focus-visible:outline-teal-deep">
              <SealMark seal={seal} />
              <span>{ts(keyFor("seal", seal, "seal.once"))}{meaning.status === "loading" ? t("steps.doubleCheckingNow") : ""}</span>
              <span className="underline">{t("steps.why")}</span>
            </summary>
            <p className="mt-1 pl-8 font-semibold">
              {ts(keyFor("seal", `${seal}.text`, "seal.once.text"))}
              {device === "match" && <span data-device-check="match">{t("steps.deviceMatch")}</span>}
              {m && !m.flagged && !m.certified && t("steps.notConfirmed")}
            </p>
          </details>
        ) : (
          <p className={`flex items-start gap-2 text-xs font-bold ${seal === "twice" ? "text-teal-deep" : "text-peach-deep"}`} data-seal-text={seal}>
            <SealMark seal={seal} />
            <span>
              {ts(keyFor("seal", `${seal}.text`, "seal.once.text"))}
              {device === "match" && <span data-device-check="match">{t("steps.deviceMatch")}</span>}
              {meaning.status === "loading" && t("steps.doubleCheckingThis")}
              {m && !m.flagged && !m.certified && t("steps.notConfirmed")}
            </span>
          </p>
        )}
        {question && check === "certified" && <p className="rounded-xl bg-peach p-2 text-sm font-semibold text-peach-deep">{t("steps.onQuestionsList")} {question}</p>}
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
          <AskAPerson it={it} check={check} />
          <ShowOnPaper care={care} item={it} photo={photo} check={check} />
          <RemindMe it={it} check={check} />
          <button type="button" onClick={onSpeak} aria-pressed={speaking}
            className={`mt-2 rounded-full border-2 border-ink px-3 py-1 ${speaking ? "bg-ink text-paper" : "bg-paper hover:bg-mint"}`}>
            {speaking ? t("steps.stop") : t("steps.readAloud")}
          </button>
          <button type="button" aria-label={t("steps.removeN", { n })} onClick={onRemove} className="mt-2 rounded-full px-3 py-1 text-ink/70 hover:text-red">{t("steps.remove")}</button>
        </div>
      </div>
    </li>
  );
}

type WalkProps = {
  /** The step shown, or null for the closing screen. */
  step: WalkStep<VerifiedItem> | null; index: number; steps: WalkStep<VerifiedItem>[];
  done: Record<string, boolean>; checkFor: (id: string) => Check; language: string;
  pip: ReturnType<typeof walkPip>; pipText: string; calm: boolean;
  speaking: boolean; onSpeak: () => void;
  /** Show another step by id, or the closing screen. */
  onGo: (at: string | "end") => void;
  onDone: (id: string, value: boolean) => void; onExit: () => void;
};

/**
 * "Walk me through it": one step per screen, big type. The step's own words follow the paper-first rule exactly as
 * the list does (PaperFirst), so unconfirmed AI words keep their "not double-checked yet" label. Done marks the step
 * done the same way the list's tick does; Not yet moves on and leaves it open; Ask a person opens the step's own
 * "Ask your pharmacist / clinic" help. Focus moves to the step's heading on every change; Escape goes back to the list.
 */
function WalkThrough({ step, index, steps, done, checkFor, language, pip, pipText, calm, speaking, onSpeak, onGo, onDone, onExit }: WalkProps) {
  const heading = useRef<HTMLHeadingElement>(null);
  const box = useRef<HTMLElement>(null);
  const shown = step?.it.id ?? "end";
  // Each new step starts at the top of the screen (under the sticky header), with focus on its heading. Instant, no
  // smooth scroll, so nothing moves for someone who asked for less motion.
  useEffect(() => {
    box.current?.scrollIntoView?.({ block: "start" });
    heading.current?.focus({ preventScroll: true });
  }, [shown]);
  const t = (line: Parameters<typeof walkLine>[1], values?: Record<string, number>) => walkLine(language, line, values);
  // The walk's own lines are in the person's language; the paper's words and the list's labels around them are not,
  // so each line carries its own lang for screen readers, never the whole region (Codex review).
  const lang = SPEECH_LANG[language] ?? "en-US";
  const tl = (line: Parameters<typeof walkLine>[1], values?: Record<string, number>) => <span lang={lang}>{t(line, values)}</span>;
  // Done and undo said out loud: the next heading takes focus, so this polite region confirms what just changed.
  const [said, setSaid] = useState("");
  const announce = (text: string) => { setSaid(""); setTimeout(() => setSaid(text), 50); };
  const next = steps[index + 1]?.it.id ?? "end";
  const doneCount = steps.filter((s) => done[s.it.id]).length;
  const firstOpen = nextOpen(steps, done, 0);
  return (
    <section ref={box} role="region" aria-label={t("region")} data-walk-through="" className="walk-through scroll-mt-24 max-md:scroll-mt-44 rounded-3xl border-2 border-ink bg-paper p-4 sm:p-6"
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onExit(); } }}>
      <p role="status" aria-live="polite" className="sr-only" lang={lang} data-walk-status="">{said}</p>
      <button type="button" onClick={onExit} data-walk-exit=""
        className="min-h-[48px] rounded-full border-2 border-ink bg-paper px-4 py-2 text-base font-bold hover:bg-mint focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-teal-deep">
        <span aria-hidden="true">← </span>{tl("back")}
      </button>
      {step ? (
        <WalkCard key={step.it.id} step={step} index={index} total={steps.length} done={!!done[step.it.id]} check={checkFor(step.it.id)} tl={tl} language={language}
          heading={heading} pip={pip} pipText={pipText} calm={calm} speaking={speaking} onSpeak={onSpeak}
          onDone={() => { onDone(step.it.id, true); announce(t("doneAlready")); onGo(next); }}
          // The undo button goes away with the done state, so focus returns to the step's heading.
          onUndo={() => { onDone(step.it.id, false); announce(t("undoDone")); heading.current?.focus(); }} onNotYet={() => onGo(next)}
          onPrevious={index > 0 ? () => onGo(steps[index - 1].it.id) : null} />
      ) : (
        <div className="walk-card mt-5" data-calm={calm || undefined} data-walk-end="">
          <h3 ref={heading} tabIndex={-1} className="display text-3xl leading-tight outline-none focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-teal-deep" data-walk-heading="">
            {tl("finished")}
          </h3>
          <p className="mt-2 text-xl font-bold">{tl("finishedCount", { done: doneCount, total: steps.length })}</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            {firstOpen >= 0 && (
              <button type="button" onClick={() => onGo(steps[firstOpen].it.id)}
                className="min-h-[56px] rounded-2xl border-2 border-ink bg-sun px-4 py-3 text-lg font-extrabold shadow-[0_3px_0_var(--ink)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-teal-deep">
                {tl("startOver")}
              </button>
            )}
            <button type="button" onClick={onExit}
              className="min-h-[56px] rounded-2xl border-2 border-ink bg-teal px-4 py-3 text-lg font-extrabold text-paper shadow-[0_3px_0_var(--ink)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-teal-deep">
              {tl("back")}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

type WalkCardProps = {
  step: WalkStep<VerifiedItem>; index: number; total: number; done: boolean; check: Check; language: string;
  tl: (line: Parameters<typeof walkLine>[1], values?: Record<string, number>) => React.ReactNode;
  heading: React.RefObject<HTMLHeadingElement | null>;
  pip: ReturnType<typeof walkPip>; pipText: string; calm: boolean; speaking: boolean; onSpeak: () => void;
  onDone: () => void; onUndo: () => void; onNotYet: () => void; onPrevious: (() => void) | null;
};

function WalkCard({ step, index, total, done, check, language, tl, heading, pip, pipText, calm, speaking, onSpeak, onDone, onUndo, onNotYet, onPrevious }: WalkCardProps) {
  const { it, group } = step;
  const warn = group === "warning";
  const [asking, setAsking] = useState(false);
  const askId = useId();
  const ask = askPerson(it, check);
  const question = stepVisitQuestion(it, check);
  const seal = sealOf(check);
  const kind = KIND[it.kind];
  const { t, ts } = useUi();
  const big = "min-h-[56px] rounded-2xl border-2 border-ink px-4 py-3 text-lg font-extrabold shadow-[0_3px_0_var(--ink)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-teal-deep";
  return (
    <div className={`walk-card mt-5 ${warn ? "rounded-2xl border-4 border-red p-3 sm:p-4" : ""}`} data-calm={calm || undefined} data-walk-step={it.id} data-walk-group={group} data-seal={seal}>
      <div className="flex items-start justify-between gap-3">
        <h3 ref={heading} tabIndex={-1} className="min-w-0 outline-none focus-visible:outline-3 focus-visible:outline-offset-4 focus-visible:outline-teal-deep" data-walk-heading="">
          <span className="block text-base font-extrabold uppercase tracking-wide text-ink/70" data-walk-progress="">{tl("progress", { n: index + 1, total })}</span>
          <span className={`display block text-2xl leading-tight sm:text-3xl ${warn ? "text-red" : ""}`} data-walk-when="">{warn ? withEnglish(tl("warningLabel"), walkEnglishBeside(language, "warningLabel")) : ts(keyFor("when", group, "when.unclear"))}</span>
        </h3>
        {/* Pip's reserved spot, as on a list row; never on a warning sign. */}
        {!warn && <PipSlot>{pip && <PipMarker key={pip.mood} mood={pip.mood} calm={calm} />}</PipSlot>}
      </div>
      {pip?.line && pipText && <div className="mt-1 flex justify-end"><PipBubble text={pipText} /></div>}
      <div aria-hidden="true" className="mt-3 h-2 overflow-hidden rounded-full bg-ink/10"><div className="h-full rounded-full bg-teal" style={{ width: `${((index + 1) / total) * 100}%` }} /></div>
      {!warn && group === "unclear" && <p className="mt-2 text-base font-semibold text-ink/70">{ts("when.unclearNote")}</p>}
      <p className="mt-3 flex flex-wrap items-center gap-2 text-sm font-bold text-ink/70">
        {kind && <span className={`chip ${kind.cls}`}>{ts(keyFor("kind", it.kind, "kind.step"))}</span>}
        <SealMark seal={seal} />
        <span data-seal-label="" className={seal === "recheck" ? "text-peach-deep" : ""}>{ts(keyFor("seal", seal, "seal.once"))}</span>
      </p>
      {/* The paper's words, by the same rule as the list (PaperFirst), only bigger (globals.css, .walk-paper). */}
      <div className="walk-paper mt-2 text-2xl leading-snug sm:text-3xl"><PaperFirst v={careStepView(it, check)} /></div>
      {/* After the paper's words, never before them: the paper says what to do; this line only points back to it. */}
      {warn && <p role="note" className="mt-3 rounded-xl bg-red-soft p-3 text-lg font-bold text-red" data-walk-warning="">{withEnglish(tl("warningDo"), walkEnglishBeside(language, "warningDo"))}</p>}
      {question && check === "certified" && <p className="mt-3 rounded-xl bg-peach p-3 text-base font-semibold text-peach-deep">{t("steps.onQuestionsList")} {question}</p>}
      {done && (
        <p className="mt-4 flex flex-wrap items-center gap-3 text-lg font-extrabold text-teal-deep" data-walk-done-status="">
          <span>✓ {tl("doneAlready")}</span>
          <button type="button" onClick={onUndo} className="min-h-[48px] rounded-full border-2 border-ink/60 bg-paper px-4 py-2 text-base font-bold text-ink hover:bg-mint">{tl("undoDone")}</button>
        </p>
      )}
      <button type="button" onClick={onSpeak} aria-pressed={speaking} data-walk-speak=""
        className={`mt-4 min-h-[48px] rounded-full border-2 border-ink px-5 py-2 text-base font-bold ${speaking ? "bg-ink text-paper" : "bg-paper hover:bg-mint"}`}>
        <span aria-hidden="true">{speaking ? "⏹ " : "🔊 "}</span>{speaking ? tl("stop") : tl("readAloud")}
      </button>
      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <button type="button" onClick={onDone} data-walk-done="" className={`${big} bg-teal text-paper`}>✓ {tl("done")}</button>
        <button type="button" onClick={onNotYet} data-walk-not-yet="" className={`${big} bg-paper hover:bg-mint`}>{tl("notYet")} <span aria-hidden="true">→</span></button>
        <button type="button" onClick={() => setAsking((a) => !a)} aria-expanded={asking} aria-controls={askId} data-walk-ask=""
          className={`${big} bg-sun hover:bg-mint`}>💬 {tl("askPerson")}</button>
      </div>
      <div id={askId} hidden={!asking} className="mt-3 rounded-xl border-2 border-dashed border-ink/40 p-3 text-base" data-walk-ask-panel="">
        <p className="font-extrabold">{tl("askTitle")}</p>
        {warn ? <p className="mt-1 font-bold text-red">{withEnglish(tl("warningDo"), walkEnglishBeside(language, "warningDo"))}</p> : (
          <>
            {ask ? <div className="mt-1" data-ask-person-panel="" data-ask-person={ask.who}><AskPersonBody ask={ask} big /></div> : <p className="mt-1 font-semibold">{tl("askClinicCall")}</p>}
            <p className="mt-2 text-sm font-semibold text-ink/70" data-walk-211="">{tl("ask211")}</p>
          </>
        )}
      </div>
      {onPrevious && (
        <button type="button" onClick={onPrevious} data-walk-previous="" className="mt-4 min-h-[48px] rounded-full px-4 py-2 text-base font-bold underline decoration-2 underline-offset-4">
          <span aria-hidden="true">← </span>{tl("previous")}
        </button>
      )}
    </div>
  );
}

/** Every "Ask your clinic" question in one list. A step's question carries the paper line it is about. */
function AskClinic({ stepQuestions, general }: { stepQuestions: { it: VerifiedItem; q: string }[]; general: string[] }) {
  const [copied, setCopied] = useState(false);
  const { t } = useUi();
  const lines = [...stepQuestions.map((s) => s.q), ...general];
  function copy() {
    navigator.clipboard?.writeText(lines.map((q, i) => `${i + 1}. ${q}`).join("\n")).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {});
  }
  return (
    <section aria-labelledby="ask-clinic-title" className="rounded-2xl border-2 border-dashed border-peach-deep bg-paper p-4" data-ask-clinic="">
      <h3 id="ask-clinic-title" className="display text-xl">{t("askClinic.title", { n: lines.length })}</h3>
      <p className="text-xs text-ink/70">{t("askClinic.bring")}</p>
      <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">
        {stepQuestions.map(({ it, q }) => (
          <li key={it.id}>
            {q}
            <span className="block text-xs font-semibold text-ink/70" data-paper-quote="">{t("askClinic.aboutLine")} &ldquo;<PaperWords>{shortQuote(it.source_quote, 60)}</PaperWords>&rdquo;</span>
          </li>
        ))}
      </ol>
      {general.length > 0 && (
        <>
          {stepQuestions.length > 0 && <h4 className="mt-3 text-xs font-extrabold uppercase tracking-wide text-ink/70">{t("askClinic.more")}</h4>}
          <ol start={stepQuestions.length + 1} className="mt-2 list-decimal space-y-2 pl-5 text-sm">
            {general.map((q, k) => <li key={`d${k}`}>{q}</li>)}
          </ol>
        </>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={copy} className="rounded-full border-2 border-ink px-3 py-1 text-xs font-bold hover:bg-mint">{t("common.copyQuestions")}</button>
        <span role="status" className="text-xs font-semibold text-ink/70">{copied ? t("common.copied") : ""}</span>
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
  const panelId = useId();
  const { t } = useUi();
  const ask = askPerson(it, check);
  if (!ask) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={panelId} data-ask-person={ask.who}
        className="mt-2 rounded-full border-2 border-ink bg-sun px-3 py-1 hover:bg-mint">💬 {t(ask.who === "pharmacist" ? "ask.pharmacist" : "ask.clinic")}</button>
      <div id={panelId} hidden={!open} className="basis-full rounded-xl border-2 border-dashed border-ink/40 p-3 text-sm" data-ask-person-panel="">
        <AskPersonBody ask={ask} />
      </div>
    </>
  );
}

/** What "Ask your pharmacist" / "Ask your clinic" shows: who to show it to, the paper-words question, and a copy button. */
/** `big`: the walk-through's sizes (a 48px copy button and larger text). The question stays in English (lang="en"):
 *  it is read to the pharmacist or clinic and is built from the paper's own words. */
function AskPersonBody({ ask, big = false }: { ask: AskPerson; big?: boolean }) {
  const [copied, setCopied] = useState(false);
  const { t } = useUi();
  function copy() {
    navigator.clipboard?.writeText(ask.question).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {});
  }
  return (
    <>
      <p className={`${big ? "text-sm" : "text-xs"} font-bold text-ink/70`}>{t(ask.who === "pharmacist" ? "ask.showPharmacist" : "ask.showClinic")}</p>
      <p lang="en" className="mt-1 font-semibold" data-ask-question="">{ask.question}</p>
      <div className="mt-2 flex items-center gap-2">
        <button type="button" onClick={copy} className={`rounded-full border-2 border-ink font-bold hover:bg-mint ${big ? "min-h-[48px] px-4 py-2 text-base" : "px-3 py-1 text-xs"}`}>{t("ask.copyQuestion")}</button>
        <span role="status" className="text-xs font-semibold text-ink/70">{copied ? t("common.copied") : ""}</span>
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
  const { t, code } = useUi();
  const days = useMemo(() => dayOptions(new Date(), 14, code), [code]);
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
        className="mt-2 rounded-full border-2 border-ink bg-paper px-3 py-1 hover:bg-mint">{t("remind.button")}</button>
      <div id={panelId} hidden={!open} className="basis-full rounded-xl border-2 border-dashed border-ink/40 p-3 text-sm">
        <div className="flex flex-wrap items-end gap-3">
          <label className="font-bold">{t("remind.day")}
            <select value={day} onChange={(e) => setDay(e.target.value)} className="ml-2 rounded-lg border-2 border-ink/60 bg-paper px-2 py-1">
              {days.map((d) => <option key={d.value} value={d.value}>{d.label}, {d.sub}</option>)}
            </select>
          </label>
          <label className="font-bold">{t("remind.time")}
            <select value={time} onChange={(e) => setTime(e.target.value)} className="ml-2 rounded-lg border-2 border-ink/60 bg-paper px-2 py-1">
              {timeOptions().map((t) => <option key={t} value={t}>{formatTime(t, code)}</option>)}
            </select>
          </label>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <a href={googleUrl} target="_blank" rel="noreferrer" className="rounded-full bg-teal px-3 py-1 font-bold text-paper">{t("remind.google")}</a>
          <button type="button" onClick={download} className="rounded-full border-2 border-ink px-3 py-1 font-bold">{t("remind.ics")}</button>
        </div>
        <p className="mt-1 text-xs text-ink/70">{t(check === "certified" ? "remind.carriesBoth" : "remind.carriesLine")}</p>
      </div>
    </>
  );
}

/** One step read aloud with the device's voice, by the paper-first rule: the explanation only when certified. */
function useStepSpeech(language: string) {
  const [speaking, setSpeakingState] = useState<string | null>(null);
  const speakingNow = useRef<string | null>(null);
  const setSpeaking = (id: string | null) => { speakingNow.current = id; setSpeakingState(id); };
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
  /** Stops a step being read (moving to another step, leaving the walk-through, or its check changing). Nothing else. */
  const stop = useCallback(() => {
    if (speakingNow.current === null) return;
    run.current++;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    speakingNow.current = null;
    setSpeakingState(null);
  }, []);
  return { speaking, toggle, stop };
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
