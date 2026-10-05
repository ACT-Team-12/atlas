"use client";

import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { LANGUAGES } from "@/lib/schema";
import type { PrepResponse, PrepStep } from "@/lib/prepTimeline";
import { ASK_LABEL, PREP_KIND_LABEL, WHEN_REASON_TEXT } from "@/lib/prepTime";
import { prepSpeechLines } from "@/lib/prepSpeech";
import { SPEECH_LANG } from "@/lib/speechLang";
import { SAMPLE_PREP, SAMPLE_PREP_LABEL } from "@/lib/samplePrep";
import { defaultOpenSlot, EXPLAIN_NOTE, explainState, meaningItems, NO_MEANING, prepAskText, prepClosedRow, prepMustSee, shownExplanation, type MeaningState } from "@/lib/prepView";
import { createRequestGate, type Ticket } from "@/lib/requestGate";
import { PREP_SHEET, printOrView } from "./printView";

type Inputs = { text: string; language: string };

type Lang = (typeof LANGUAGES)[number];
const noop = () => () => {};

/**
 * "Get ready for your procedure": a timeline of the prep steps in a clinic's paper. Every step quotes the paper,
 * and every day or time on the timeline comes from that step's own quote (our code, not the AI). Steps whose quote
 * says no time are listed under "Ask your clinic when". Read aloud uses the phone's own voice only.
 *
 * Fails closed: each step's headline is the paper's own quote. The AI's plain-words explanation appears only after
 * the second-model meaning check (POST /api/meaning, the same one the care plan uses) certifies it.
 */
export function PrepMode() {
  const [text, setText] = useState("");
  const [language, setLanguage] = useState<Lang>("English");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [res, setRes] = useState<(PrepResponse & { language: Lang }) | null>(null);
  const [speaking, setSpeaking] = useState(false);
  const [voiceNote, setVoiceNote] = useState("");
  const [meaning, setMeaning] = useState<MeaningState>(NO_MEANING);
  // Every edit invalidates the request in flight (and its meaning check), so a slow answer never lands on new inputs.
  const gate = useRef(createRequestGate<Inputs>());
  const onScreen = useRef<Inputs>({ text: "", language: "English" });
  const run = useRef(0);

  function inputsChanged(next: Partial<Inputs>) {
    gate.current.invalidate();
    onScreen.current = { ...onScreen.current, ...next };
    silence(); setSpeaking(false); setVoiceNote("");
    setRes(null); setMeaning(NO_MEANING); setBusy(false); setError("");
  }

  function silence() {
    run.current++;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }
  // Stop reading if the section unmounts.
  useEffect(() => {
    const g = gate.current;
    return () => {
      g.invalidate();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  async function build() {
    silence(); setSpeaking(false); setVoiceNote("");
    setBusy(true); setError(""); setRes(null); setMeaning(NO_MEANING);
    const ticket = gate.current.start(onScreen.current);
    const current = () => gate.current.isCurrent(ticket, onScreen.current);
    try {
      const r = await fetch("/api/prep", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(ticket.inputs), signal: ticket.signal });
      const j = await r.json();
      if (!current()) return; // the paper or language changed while we waited: drop this answer
      if (!r.ok) throw new Error(j.error ?? "Something went wrong.");
      setRes({ ...j, language: ticket.inputs.language as Lang });
      void check(j, ticket);
    } catch (e) {
      if (!current()) return;
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      if (current()) setBusy(false);
    }
  }

  // Second-model meaning check on every explanation. Until it answers, or if it flags, is unsure or fails, only the
  // paper's words are shown (prepView.ts).
  async function check(r: PrepResponse, ticket: Ticket<Inputs>) {
    const current = () => gate.current.isCurrent(ticket, onScreen.current);
    const items = meaningItems(r);
    if (items.length === 0) { setMeaning({ status: "done", byId: {} }); return; }
    setMeaning({ status: "loading", byId: {} });
    try {
      const resp = await fetch("/api/meaning", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items, language: ticket.inputs.language }), signal: ticket.signal });
      const j = await resp.json();
      if (!current()) return; // a newer paper or language meanwhile
      if (!resp.ok || !Array.isArray(j.results)) throw new Error("check failed");
      setMeaning({ status: "done", byId: Object.fromEntries((j.results as MeaningState["byId"][string][]).map((x) => [x.id, x])) });
    } catch {
      if (current()) setMeaning({ status: "error", byId: {} });
    }
  }

  // The phone's own voice, one utterance per line (Chrome stops a long one after about 15 seconds). No paid voice here.
  function readAloud() {
    if (!res) return;
    if (speaking) { silence(); setSpeaking(false); setVoiceNote(""); return; }
    if (!("speechSynthesis" in window)) { setVoiceNote("This device can't read aloud. Try Print instead."); return; }
    silence();
    const me = run.current;
    // The paper's words and our labels in English (the time reader only reads English papers); a certified
    // explanation in the language the person chose.
    const lines = prepSpeechLines(res, meaning);
    let started = false;
    setSpeaking(true);
    setVoiceNote("Reading with your phone's voice.");
    const end = () => { if (run.current === me) { setSpeaking(false); setVoiceNote(""); } };
    lines.forEach((line, i) => {
      const u = new SpeechSynthesisUtterance(line.text);
      u.lang = line.voice === "explanation" ? (SPEECH_LANG[res.language] ?? "en-US") : "en-US";
      u.rate = 0.9;
      u.onstart = () => { started = true; };
      if (i === lines.length - 1) u.onend = end;
      u.onerror = end;
      window.speechSynthesis.speak(u);
    });
    window.setTimeout(() => {
      if (run.current !== me || started) return;
      silence();
      setSpeaking(false);
      setVoiceNote("This device didn't start reading. Tap Read it out loud again, or use Print.");
    }, 5000);
  }

  function print() {
    printOrView(PREP_SHEET); // the sheet on screen first, printed from its bar (printView.ts)
  }

  const placed = res ? res.timeline.reduce((n, g) => n + g.steps.length, 0) : 0;

  return (
    <section id="prep" className="relative px-3 mt-3 scroll-mt-20" aria-labelledby="prep-title">
      <div className="section-card bg-lilac px-4 sm:px-10 py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="prep-title" className="display text-[clamp(2rem,4.5vw,4rem)] min-w-0">Get ready for your procedure</h2>
          <p className="hand text-2xl text-ink/80 -rotate-1 max-w-[18em]">a nurse asked us for this on Oct 2</p>
        </div>
        <p className="mt-3 max-w-2xl text-sm font-semibold text-ink/80">
          Paste the prep paper your clinic gave you for a colonoscopy, a scope, a surgery or a scan. You get the steps in order: days before, the day before, the evening before, the morning of, when you arrive, and after.
          Every step quotes your paper. A step goes at a day or time only if its own line in your paper says so. If it doesn&apos;t, it goes under &quot;{ASK_LABEL}&quot;.
        </p>

        <div className="card mt-8 p-5 sm:p-8">
          <div className="grid gap-5 lg:grid-cols-[1fr_15rem]">
            <div className="min-w-0">
              <textarea data-lenis-prevent aria-label="Prep paper text"
                className="h-44 w-full rounded-2xl border-2 border-ink/70 bg-paper p-4 font-mono text-xs focus:border-teal"
                placeholder="Paste your prep instructions here..." value={text} onChange={(e) => { inputsChanged({ text: e.target.value }); setText(e.target.value); }} />
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm font-bold">
                <button type="button" className="rounded-full border-2 border-ink px-4 py-2 hover:bg-mint"
                  onClick={() => { inputsChanged({ text: SAMPLE_PREP }); setText(SAMPLE_PREP); }}>Use the sample prep paper</button>
              </div>
              <p className="mt-2 text-xs text-ink/70">{SAMPLE_PREP_LABEL}. Nothing you paste here is stored.</p>
            </div>
            <div className="flex flex-col gap-3">
              <label className="text-sm font-bold">Explain it in
                <select className="mt-1 w-full rounded-xl border-2 border-ink/70 bg-paper p-2.5" value={language} onChange={(e) => { inputsChanged({ language: e.target.value }); setLanguage(e.target.value as Lang); }}>
                  {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
                </select>
              </label>
              <button type="button" onClick={build} disabled={busy || text.trim().length < 20}
                className="mt-auto rounded-full bg-ink px-5 py-3 font-bold text-paper disabled:opacity-50">
                {busy ? "Reading..." : "Build my timeline"}
              </button>
            </div>
          </div>

          <div aria-live="polite">
            <p role="status" className={busy || voiceNote ? "mt-4 text-sm font-bold" : "sr-only"}>
              {busy ? "Reading your paper..." : voiceNote}
            </p>
            {error && <p role="alert" className="mt-6 rounded-2xl border-2 border-red bg-red-soft p-4 font-bold text-red">{error}</p>}
            {res && (
              <div className="mt-8">
                <p className="font-extrabold text-lg">
                  {placed + res.ask.length === 0
                    ? "We couldn't find prep steps in this paper that quote it. Check the text or ask your clinic."
                    : `${placed} ${placed === 1 ? "step" : "steps"} on your timeline, ${res.ask.length} to ask your clinic about.`}
                </p>
                {res.held_back.count > 0 && (
                  <p className="mt-1 text-xs font-semibold text-ink/70">
                    {res.held_back.count} {res.held_back.count === 1 ? "step was" : "steps were"} left out because the AI&apos;s quote wasn&apos;t found word for word in your paper.
                  </p>
                )}
                {placed + res.ask.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-3 text-sm font-bold">
                    <button type="button" onClick={readAloud} aria-pressed={speaking} className={`rounded-full border-2 border-ink px-4 py-2 ${speaking ? "bg-ink text-paper" : "bg-sun"}`}>
                      {speaking ? "⏹ Stop reading" : "🔊 Read it out loud"}
                    </button>
                    <button type="button" onClick={print} className="rounded-full border-2 border-ink px-4 py-2">🖨️ Print my timeline</button>
                  </div>
                )}

                <PrepTimeline res={res} meaning={meaning} />
                <p className="mt-4 text-xs text-ink/70">
                  Your clinic&apos;s paper is what counts. If anything here differs from it, follow the paper and call your clinic.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
      {res && <PrepSheet res={res} meaning={meaning} />}
    </section>
  );
}

/**
 * The timeline, concise (Akhil's pattern, PR 73): one collapsed group per time, in order, with only the next group open.
 * A closed group still shows its must-see steps ("Stop drinking", "Do not eat", when to call), whole and in red. Every
 * step is one line of the paper's own words that opens to the rest. "Ask your clinic when" stays one open list.
 */
export function PrepTimeline({ res, meaning }: { res: Pick<PrepResponse, "timeline" | "ask">; meaning: MeaningState }) {
  const first = defaultOpenSlot(res.timeline);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const isOpen = (slot: string) => open[slot] ?? slot === first;
  const base = useId();
  return (
    <>
      <ol className="mt-6 space-y-4" aria-label="Your prep timeline">
        {res.timeline.map((g) => {
          const shut = !isOpen(g.slot);
          const listId = `${base}-${g.slot}`;
          const folded = shut ? g.steps.filter((s) => !prepMustSee(s)).length : 0;
          return (
            <li key={g.slot} data-prep-group={g.slot} data-open={!shut || undefined}
              className={`rounded-2xl border-2 ${shut ? "border-ink/20" : "border-ink"} bg-paper/60 p-3`}>
              <h3>
                <button type="button" aria-expanded={!shut} aria-controls={listId} onClick={() => setOpen((o) => ({ ...o, [g.slot]: shut }))}
                  className="group flex w-full items-baseline justify-between gap-2 rounded-xl text-left">
                  <span className="display text-xl">{g.label}</span>
                  <span className="flex items-baseline gap-2 text-xs font-bold text-ink/70">
                    {g.steps.length} {g.steps.length === 1 ? "step" : "steps"}
                    <span aria-hidden="true" className="text-base font-extrabold transition-transform group-aria-expanded:rotate-90">›</span>
                  </span>
                </button>
              </h3>
              {/* Open: every step in paper order, in the region the heading controls. Closed: that region is hidden, and
                  the must-see steps show in their own list outside it, so the disclosure's state matches what it controls
                  (Codex review). */}
              {shut && folded < g.steps.length && (
                <ul className="mt-2 space-y-2" data-must-see-list="">
                  {g.steps.filter(prepMustSee).map((s) => <Step key={s.id} s={s} meaning={meaning} />)}
                </ul>
              )}
              <ul id={listId} hidden={shut} className="mt-2 space-y-2">
                {(shut ? g.steps.filter((s) => !prepMustSee(s)) : g.steps).map((s) => <Step key={s.id} s={s} meaning={meaning} />)}
              </ul>
              {/* Only when must-see steps show in a closed group: say that more sit behind its heading. */}
              {folded > 0 && folded < g.steps.length && (
                <p className="mt-2 text-xs font-semibold text-ink/70" data-folded-count="">+ {folded} more {folded === 1 ? "step" : "steps"} here. Tap the heading to see {folded === 1 ? "it" : "them"}.</p>
              )}
            </li>
          );
        })}
      </ol>
      {res.ask.length > 0 && <AskWhen steps={res.ask} meaning={meaning} />}
    </>
  );
}

/** "Ask your clinic when": one list, always open, with Copy. Each line is the paper's own sentence. */
function AskWhen({ steps, meaning }: { steps: PrepStep[]; meaning: MeaningState }) {
  const [copied, setCopied] = useState("");
  function copy() {
    // No clipboard, or permission denied: say so, so the button never fails silently (Codex review).
    Promise.resolve().then(() => navigator.clipboard.writeText(prepAskText(steps)))
      .then(() => { setCopied("Copied"); setTimeout(() => setCopied(""), 1800); })
      .catch(() => setCopied("Couldn't copy. Select the questions above and copy them yourself."));
  }
  return (
    <section aria-labelledby="prep-ask-title" className="mt-6 rounded-2xl border-2 border-dashed border-peach-deep bg-paper p-4" data-ask-when="">
      <h3 id="prep-ask-title" className="display text-xl">{ASK_LABEL} ({steps.length})</h3>
      <p className="text-sm font-semibold text-ink/70">Your paper does not say a day and time for these. Ask your clinic before your procedure.</p>
      <ul className="mt-3 space-y-2">{steps.map((s) => <Step key={s.id} s={s} meaning={meaning} />)}</ul>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={copy} className="rounded-full border-2 border-ink px-3 py-1 text-xs font-bold hover:bg-mint">Copy these questions</button>
        <span role="status" className="text-xs font-semibold text-ink/70">{copied}</span>
      </div>
    </section>
  );
}

function Step({ s, meaning }: { s: PrepStep; meaning: MeaningState }) {
  const state = explainState(s, meaning);
  // The only way the AI's words reach this card: the shared paper-first rule (prepView.ts, paperFirst.ts).
  const shown = shownExplanation(s, meaning);
  const closed = prepClosedRow(s);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <li data-prep-step={s.id} data-must-see={closed.full || undefined} data-open={open || undefined}
      className={`min-w-0 rounded-2xl border-2 bg-paper ${closed.full ? "border-red" : open ? "border-ink" : "border-ink/20"}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={panelId}
        className="group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-2xl p-3 text-left">
        <span className="min-w-0" data-closed-row="quote">
          <span className="block text-[11px] font-extrabold uppercase tracking-wide text-ink/70">{closed.full ? <span className="text-red">Don&apos;t miss · your paper says</span> : "Your paper says"}</span>
          <span className="block font-bold leading-snug [overflow-wrap:anywhere]" data-paper-quote="">&ldquo;{closed.quote}&rdquo;</span>
          <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-bold text-ink/70">
            <span className="chip bg-ink text-paper">{PREP_KIND_LABEL[s.kind]}</span>
            {closed.whenWords.length > 0 && <span>{closed.whenWords.map((w) => `“${w}”`).join(", ")}</span>}
          </span>
        </span>
        <span aria-hidden="true" className="font-extrabold text-ink/70 transition-transform group-aria-expanded:rotate-90">›</span>
      </button>
      <div id={panelId} hidden={!open} className="px-3 pb-3" data-prep-panel="">
        <p className="text-xs font-bold uppercase tracking-wide text-ink/70">Your paper says, in full</p>
        <p className="mt-1 border-l-4 border-sun pl-2 font-extrabold [overflow-wrap:anywhere]" data-paper-quote="">{s.source_quote}</p>
        {s.slot && s.when_words.length > 0 && (
          <p className="mt-2 text-sm font-semibold">When, in your paper&apos;s words: {s.when_words.map((w) => `"${w}"`).join(", ")}</p>
        )}
        {!s.slot && s.reason !== "placed" && (
          <p className="mt-2 text-sm font-semibold">
            {WHEN_REASON_TEXT[s.reason]}{s.when_words.length > 0 ? ` It says: ${s.when_words.map((w) => `"${w}"`).join(", ")}.` : ""}
          </p>
        )}
        {shown && (
          <p className="mt-2 text-sm [overflow-wrap:anywhere]" data-explanation="">
            <span className="font-bold">In plain words (double-checked against your paper):</span> {shown}
          </p>
        )}
        {state !== "certified" && state !== "none" && (
          <p className="mt-2 text-xs font-semibold text-ink/70">{EXPLAIN_NOTE[state]}</p>
        )}
      </div>
    </li>
  );
}

/** Large-type print copy of the timeline, rendered into <body> and shown only while printing it (globals.css). */
function PrepSheet({ res, meaning }: { res: PrepResponse & { language: Lang }; meaning: MeaningState }) {
  const mounted = useSyncExternalStore(noop, () => true, () => false);
  if (!mounted) return null;
  const line = (s: PrepStep) => (
    <li key={s.id}>
      <span className="box" />
      <div>
        <p><b>{s.source_quote}</b></p>
        {shownExplanation(s, meaning) && <p>In plain words: {shownExplanation(s, meaning)}</p>}
      </div>
    </li>
  );
  return createPortal(
    <div id="atlas-prep-sheet" className="atlas-prep-sheet" aria-hidden="true">
      <h1>Getting ready for my procedure</h1>
      <p className="meta">Written in {res.language} · Every step quotes my clinic&apos;s paper. A step has a day or time only if its own line says so.</p>
      {res.timeline.map((g) => (
        <section key={g.slot}>
          <h2>{g.label}</h2>
          <ol className="steps">{g.steps.map(line)}</ol>
        </section>
      ))}
      {res.ask.length > 0 && (
        <section>
          <h2>{ASK_LABEL}</h2>
          <p className="meta">My paper does not say a day and time for these.</p>
          <ol className="steps">{res.ask.map(line)}</ol>
        </section>
      )}
      <p className="foot">If anything here differs from the clinic&apos;s paper, follow the paper and call the clinic. Made with ATLAS.</p>
    </div>,
    document.body,
  );
}
