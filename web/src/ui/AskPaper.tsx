"use client";

import { PaperWords, withEnglish } from "./UiLang";

import { useEffect, useId, useRef, useState } from "react";
import type { CarePlanResponse, VerifiedItem } from "@/lib/schema";
import type { AskResponse } from "@/lib/ask";
import { askAboutQuestion, askEnglishBeside, askText, isUrgentQuestion, MAX_QUESTION } from "@/lib/askText";
import { warningFromPaper } from "@/lib/warningPin";
import { ShowOnPaper } from "./ShowOnPaper";

/** `photo`: the photo this paper was read from, while it is still open, so Show on my paper can mark it (as the steps do). */
type Props = { care: CarePlanResponse; items: VerifiedItem[]; language: string; photo?: File | null };

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "done"; question: string; res: AskResponse };

/**
 * "Ask my paper": a question answered only with the paper's own words (lib/ask.ts checks every quote server-side).
 * Paper first: the quotes lead, labelled "Copied word for word from your paper"; the one-line lead-in (fixed words
 * around a topic taken from a quote) comes after, smaller, under "not double-checked yet". Nothing survives: the fixed refusal and a ready question built
 * from the person's own words. An urgent question gets 911 / 211 guidance and the paper's own warning lines, never
 * an AI answer, and is caught here before anything is sent. The parent remounts this on any new paper or language.
 */
export function AskPaper({ care, items, language, photo = null }: Props) {
  const t = askText(language);
  const [question, setQuestion] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const ctrl = useRef<AbortController | null>(null);
  const inputId = useId();

  useEffect(() => () => ctrl.current?.abort(), []);

  async function ask() {
    const q = question.replace(/\s+/g, " ").trim();
    if (q.length < 3) return;
    ctrl.current?.abort();
    if (isUrgentQuestion(q)) { setState({ kind: "done", question: q, res: { kind: "urgent" } }); return; }
    const c = new AbortController();
    ctrl.current = c;
    setState({ kind: "loading" });
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source_text: care.source_text, language, question: q }),
        signal: c.signal,
      });
      // The server's own error words are English; the person sees fixed words in their language instead.
      if (c.signal.aborted) return;
      if (!res.ok) {
        const daily = res.headers.get("x-atlas-limit") === "shared-daily";
        setState({ kind: "error", message: res.status === 429 ? (daily ? t.today : t.busy) : res.status === 503 ? t.unavailable : t.error });
        return;
      }
      const json = await res.json();
      if (c.signal.aborted) return;
      if (json?.kind !== "answer" && json?.kind !== "not_in_paper" && json?.kind !== "urgent") throw new Error("bad answer");
      setState({ kind: "done", question: q, res: onThisPaper(json as AskResponse, care.source_text) });
    } catch {
      if (c.signal.aborted) return;
      setState({ kind: "error", message: t.error });
    }
  }

  const res = state.kind === "done" ? state.res : null;
  const held = res && res.kind !== "urgent" ? res.dropped.length : 0;
  // Only lines whose OWN words are warning language: the model's "warning_sign" kind is not evidence (Codex review).
  const warnings = items.filter((i) => i.grounded && warningFromPaper(i.source_quote));

  return (
    <div className="mt-6 rounded-2xl border-2 border-teal bg-paper p-4 sm:p-6" aria-labelledby="ask-paper-title" data-ask-paper="">
      <p id="ask-paper-title" className="font-extrabold text-lg">{t.title}</p>
      <p className="text-sm font-semibold text-ink/70">{t.intro}</p>
      <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void ask(); }}>
        <label htmlFor={inputId} className="sr-only">{t.label}</label>
        <input id={inputId} type="text" value={question} maxLength={MAX_QUESTION} placeholder={t.placeholder}
          onChange={(e) => {
            setQuestion(e.target.value);
            // A new question: the one in flight is cancelled and an answer on screen is cleared, so an answer is never
            // shown under a question it wasn't for (Codex review, round 3).
            ctrl.current?.abort();
            if (state.kind !== "idle") setState({ kind: "idle" });
          }}
          className="min-w-0 flex-1 basis-56 rounded-xl border-2 border-ink/70 bg-paper p-2.5 font-semibold" />
        <button type="submit" disabled={state.kind === "loading" || question.trim().length < 3}
          className="rounded-full bg-teal text-paper px-5 py-2.5 font-bold disabled:opacity-40">{t.button}</button>
      </form>

      <div aria-live="polite">
        {state.kind === "done" && <p className="mt-4 text-sm font-bold" data-ask-asked="">&ldquo;{state.question}&rdquo;</p>}
        {state.kind === "loading" && <p className="mt-4 font-semibold text-ink/70">{t.asking}</p>}
        {state.kind === "error" && <p role="alert" className="mt-4 rounded-xl bg-red-soft p-3 font-semibold text-red">{state.message}</p>}

        {res?.kind === "urgent" && (
          <div className="mt-4 rounded-2xl border-2 border-red bg-red-soft p-4" data-ask-result="urgent">
            <p className="font-extrabold text-red" data-ask-urgent-title="">{withEnglish(t.urgentTitle, askEnglishBeside(language, "urgentTitle"))}</p>
            <p className="mt-1 font-semibold" data-ask-urgent-body="">{withEnglish(t.urgentBody, askEnglishBeside(language, "urgentBody"))}</p>
            {warnings.length > 0 && (
              <div className="mt-3">
                <p className="text-sm font-bold">{withEnglish(t.urgentPaper, askEnglishBeside(language, "urgentPaper"))}</p>
                <ul className="mt-1 space-y-1">
                  {warnings.map((w) => <li key={w.id} data-paper-quote="" className="border-l-4 border-sun pl-2 text-sm font-semibold">&ldquo;<PaperWords>{w.source_quote}</PaperWords>&rdquo;</li>)}
                </ul>
              </div>
            )}
          </div>
        )}

        {res?.kind === "not_in_paper" && state.kind === "done" && <Refusal question={state.question} language={language} />}

        {res?.kind === "answer" && (
          <div className="mt-4" data-ask-result="answer">
            <div data-paper-quote="" className="border-l-4 border-sun pl-2">
              <p className="text-[11px] font-extrabold uppercase tracking-wide text-teal-deep">{t.paperLabel}</p>
              <ul className="space-y-2">
                {res.quotes.map((q, i) => (
                  <li key={`${q.span.start}-${q.span.end}`}>
                    <p className="font-semibold">&ldquo;<PaperWords>{q.text}</PaperWords>&rdquo;</p>
                    <ShowOnPaper care={care} photo={care.source_kind === "image" ? photo : null} check="unchecked"
                      item={{ id: `ask-${i}`, kind: "self_care", title: "", plain_language: "", why: "", when: "", source_quote: q.text, needs_clarification: false, question_for_clinic: "", grounded: true, span: q.span }} />
                  </li>
                ))}
              </ul>
            </div>
            {res.topic && (
              <div data-explanation="" data-secondary="" className="mt-3 text-sm text-ink/70">
                <p className="text-xs font-bold">{t.leadNote}</p>
                <p>{t.about(res.topic)}</p>
              </div>
            )}
          </div>
        )}

        {held > 0 && <p className="mt-3 text-[11px] font-semibold text-ink/70" data-ask-held={held}>{t.held(held)}</p>}
      </div>
    </div>
  );
}

/** The fixed "your paper doesn't say" answer, with a question built only from the person's own words. */
function Refusal({ question, language }: { question: string; language: string }) {
  const t = askText(language);
  const ready = askAboutQuestion(question, language);
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(ready.question).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {});
  }
  return (
    <div className="mt-4 rounded-2xl border-2 border-peach-deep bg-peach p-4" data-ask-result="not_in_paper">
      <p className="font-extrabold">{withEnglish(t.refusal, askEnglishBeside(language, "refusal"))}</p>
      <div className="mt-3 rounded-xl border-2 border-dashed border-ink/40 bg-paper p-3 text-sm">
        <p className="text-xs font-bold text-ink/70">{t.readyLabel}. {t.readyHint}</p>
        <p className="mt-1 font-semibold" data-ask-question="">{ready.question}</p>
        <div className="mt-2 flex items-center gap-2">
          <button type="button" onClick={copy} className="rounded-full border-2 border-ink px-3 py-1 text-xs font-bold hover:bg-mint">{t.copy}</button>
          <span role="status" className="text-xs font-semibold text-ink/70">{copied ? t.copied : ""}</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Keeps only quotes whose words are exactly this paper's text at their span, the same span Show on my paper
 * highlights, so the words shown and the place highlighted can never come from two different texts (security review
 * finding). If none is left, the answer becomes the fixed refusal.
 */
export function onThisPaper(res: AskResponse, source: string): AskResponse {
  if (res.kind !== "answer") return res;
  const ok = (q: { text: string; span: { start: number; end: number } }) =>
    Number.isInteger(q.span?.start) && Number.isInteger(q.span?.end) && q.span.start >= 0 && q.span.end <= source.length && q.span.start < q.span.end &&
    source.slice(q.span.start, q.span.end) === q.text;
  const quotes = res.quotes.filter(ok);
  const dropped = [...res.dropped, ...res.quotes.filter((q) => !ok(q)).map(() => "not_in_paper" as const)];
  if (quotes.length === 0) return { kind: "not_in_paper", dropped, model: res.model, ms: res.ms };
  return { ...res, quotes, dropped, topic: quotes.length === res.quotes.length ? res.topic : null };
}
