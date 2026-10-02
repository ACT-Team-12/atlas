"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { LANGUAGES } from "@/lib/schema";
import type { PrepResponse, PrepStep } from "@/lib/prepTimeline";
import { ASK_LABEL, PREP_KIND_LABEL, WHEN_REASON_TEXT } from "@/lib/prepTime";
import { prepSpeechLines } from "@/lib/prepSpeech";
import { SPEECH_LANG } from "@/lib/speechLang";
import { SAMPLE_PREP, SAMPLE_PREP_LABEL } from "@/lib/samplePrep";
import { EXPLAIN_NOTE, explainState, meaningItems, NO_MEANING, type MeaningState } from "@/lib/prepView";

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
  const meaningFor = useRef<PrepResponse | null>(null);
  const run = useRef(0);

  function silence() {
    run.current++;
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }
  // Stop reading if the section unmounts.
  useEffect(() => () => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);

  async function build() {
    silence(); setSpeaking(false); setVoiceNote("");
    setBusy(true); setError(""); setRes(null); setMeaning(NO_MEANING); meaningFor.current = null;
    try {
      const r = await fetch("/api/prep", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, language }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Something went wrong.");
      setRes({ ...j, language });
      void check(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  // Second-model meaning check on every explanation. Until it answers, or if it flags, is unsure or fails, only the
  // paper's words are shown (prepView.ts).
  async function check(r: PrepResponse) {
    const items = meaningItems(r);
    meaningFor.current = r;
    if (items.length === 0) { setMeaning({ status: "done", byId: {} }); return; }
    setMeaning({ status: "loading", byId: {} });
    try {
      const resp = await fetch("/api/meaning", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ items }) });
      const j = await resp.json();
      if (meaningFor.current !== r) return; // a newer paper was read meanwhile
      if (!resp.ok || !Array.isArray(j.results)) throw new Error("check failed");
      setMeaning({ status: "done", byId: Object.fromEntries((j.results as MeaningState["byId"][string][]).map((x) => [x.id, x])) });
    } catch {
      if (meaningFor.current === r) setMeaning({ status: "error", byId: {} });
    }
  }

  // The phone's own voice, one utterance per line (Chrome stops a long one after about 15 seconds). No paid voice here.
  function readAloud() {
    if (!res) return;
    if (speaking) { silence(); setSpeaking(false); setVoiceNote(""); return; }
    if (!("speechSynthesis" in window)) { setVoiceNote("This device can't read aloud. Try Print instead."); return; }
    silence();
    const me = run.current;
    const lines = prepSpeechLines(res, res.language, meaning);
    let started = false;
    setSpeaking(true);
    setVoiceNote("Reading with your phone's voice.");
    const end = () => { if (run.current === me) { setSpeaking(false); setVoiceNote(""); } };
    lines.forEach((line, i) => {
      const u = new SpeechSynthesisUtterance(line);
      u.lang = SPEECH_LANG[res.language] ?? "en-US";
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
    const root = document.documentElement;
    const done = () => { root.classList.remove("print-prep"); window.removeEventListener("afterprint", done); };
    root.classList.add("print-prep");
    window.addEventListener("afterprint", done);
    window.print();
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
                placeholder="Paste your prep instructions here..." value={text} onChange={(e) => { setText(e.target.value); setRes(null); setMeaning(NO_MEANING); meaningFor.current = null; }} />
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm font-bold">
                <button type="button" className="rounded-full border-2 border-ink px-4 py-2 hover:bg-mint"
                  onClick={() => { setText(SAMPLE_PREP); setRes(null); setError(""); setMeaning(NO_MEANING); meaningFor.current = null; }}>Use the sample prep paper</button>
              </div>
              <p className="mt-2 text-xs text-ink/70">{SAMPLE_PREP_LABEL}. Nothing you paste here is stored.</p>
            </div>
            <div className="flex flex-col gap-3">
              <label className="text-sm font-bold">Explain it in
                <select className="mt-1 w-full rounded-xl border-2 border-ink/70 bg-paper p-2.5" value={language} onChange={(e) => setLanguage(e.target.value as Lang)}>
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
                    {res.held_back.count} {res.held_back.count === 1 ? "step was" : "steps were"} left out because the AI&apos;s quote wasn&apos;t found in your paper.
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

                <ol className="mt-6 space-y-6" aria-label="Your prep timeline">
                  {res.timeline.map((g) => (
                    <li key={g.slot}>
                      <h3 className="text-xl font-extrabold">{g.label}</h3>
                      <ul className="mt-2 space-y-3">{g.steps.map((s) => <Step key={s.id} s={s} meaning={meaning} />)}</ul>
                    </li>
                  ))}
                </ol>

                {res.ask.length > 0 && (
                  <div className="mt-8 rounded-2xl border-2 border-sun bg-paper p-4">
                    <h3 className="text-xl font-extrabold">{ASK_LABEL}</h3>
                    <p className="text-sm font-semibold text-ink/70">Your paper does not say a day and time for these. Ask your clinic before your procedure.</p>
                    <ul className="mt-3 space-y-3">{res.ask.map((s) => <Step key={s.id} s={s} meaning={meaning} />)}</ul>
                  </div>
                )}
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

function Step({ s, meaning }: { s: PrepStep; meaning: MeaningState }) {
  const state = explainState(s, meaning);
  return (
    <li className="min-w-0 rounded-2xl border-2 border-ink/30 bg-paper p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-xs font-bold uppercase tracking-wide text-ink/70">Your paper says</span>
        <span className="rounded-full bg-ink px-2.5 py-0.5 text-xs font-bold text-paper">{PREP_KIND_LABEL[s.kind]}</span>
      </div>
      <p className="mt-1 border-l-4 border-sun pl-2 font-extrabold [overflow-wrap:anywhere]">{s.source_quote}</p>
      {s.slot && s.when_words.length > 0 && (
        <p className="mt-2 text-sm font-semibold">When, in your paper&apos;s words: {s.when_words.map((w) => `"${w}"`).join(", ")}</p>
      )}
      {!s.slot && s.reason !== "placed" && (
        <p className="mt-2 text-sm font-semibold">
          {WHEN_REASON_TEXT[s.reason]}{s.when_words.length > 0 ? ` It says: ${s.when_words.map((w) => `"${w}"`).join(", ")}.` : ""}
        </p>
      )}
      {state === "certified" && (
        <p className="mt-2 text-sm [overflow-wrap:anywhere]">
          <span className="font-bold">In plain words (double-checked against your paper):</span> {s.plain_language}
        </p>
      )}
      {state !== "certified" && state !== "none" && (
        <p className="mt-2 text-xs font-semibold text-ink/70">{EXPLAIN_NOTE[state]}</p>
      )}
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
        {explainState(s, meaning) === "certified" && <p>In plain words: {s.plain_language}</p>}
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
