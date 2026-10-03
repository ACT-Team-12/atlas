"use client";

import { useState } from "react";
import type { CarePlanResponse, VerifiedItem } from "@/lib/schema";
import type { CheckedQuestion, UnderstandResponse } from "@/lib/understand";

type Props = { care: CarePlanResponse; items: VerifiedItem[]; language: string };

/**
 * "Check I understood": a teach-back quiz built from the person's own paper.
 * People rarely notice their own misunderstandings, so ATLAS asks one question per step.
 * Every answer is shown next to the exact line from the paper that proves it.
 * The parent passes a key built from the paper, steps and language, so any change starts a fresh quiz.
 */
export function Understand({ care, items, language }: Props) {
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [data, setData] = useState<UnderstandResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const [tries, setTries] = useState<Record<string, number[]>>({});

  async function start() {
    setStatus("loading"); setError(null); setTries({}); setAt(0);
    try {
      const res = await fetch("/api/understand", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_text: care.source_text,
          language,
          items: items.slice(0, 20).map(({ id, kind, title, source_quote }) => ({ id, kind, title, source_quote })),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
      setData(json);
      setStatus(json.questions.length ? "ready" : "error");
      if (!json.questions.length) setError("We couldn't write questions we could check against your paper. Your steps above are still checked.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setStatus("error");
    }
  }

  const qs = data?.questions ?? [];
  const q: CheckedQuestion | undefined = qs[at];
  const picked = q ? tries[q.item_id] ?? [] : [];
  const solved = q ? picked.includes(q.correct) : false;
  const firstTry = qs.filter((x) => (tries[x.item_id] ?? [])[0] === x.correct).length;
  // Finished only after the person taps past the last answer, so they always see what their paper says on it.
  const finished = qs.length > 0 && at >= qs.length;
  const lookAgain = qs.filter((x) => { const t = tries[x.item_id] ?? []; return t.length > 0 && t[0] !== x.correct; });
  // Never the AI's title (it is not checked): the step's number in the list, and the paper's words where it matters.
  const titleOf = (id: string) => `step ${items.findIndex((i) => i.id === id) + 1}`;
  const quoteOf = (id: string) => items.find((i) => i.id === id)?.source_quote ?? "";
  const proof = (x: CheckedQuestion) => care.source_text.slice(x.span.start, x.span.end);

  return (
    <div className="mt-6 rounded-2xl border-2 border-teal bg-paper p-4 sm:p-6" aria-labelledby="understand-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p id="understand-title" className="font-extrabold text-lg">Check I understood</p>
          <p className="text-sm font-semibold text-ink/70">One quick question per step. Most people don&apos;t notice what they misread, so we ask.</p>
        </div>
        {(status === "idle" || status === "error") && (
          <button type="button" onClick={start} disabled={items.length === 0}
            className="rounded-full bg-teal text-paper px-5 py-2.5 font-bold disabled:opacity-40">
            {status === "error" ? "Try again" : "Quiz me on my paper"}
          </button>
        )}
      </div>

      <div aria-live="polite">
        {status === "loading" && <p className="mt-4 font-semibold text-ink/70">Writing questions from your paper and checking each answer against it...</p>}
        {status === "error" && error && <p role="alert" className="mt-4 rounded-xl bg-red-soft p-3 font-semibold text-red">{error}</p>}

        {status === "ready" && q && !finished && (
          <div className="mt-5">
            <p className="text-xs font-bold uppercase tracking-wider text-ink/70">Question {at + 1} of {qs.length} · {titleOf(q.item_id)}</p>
            <p className="mt-1 text-xl font-extrabold">{q.question}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3" role="group" aria-label="Answers">
              {q.options.map((o, i) => {
                const tried = picked.includes(i);
                const right = tried && i === q.correct;
                const wrong = tried && i !== q.correct;
                return (
                  <button key={i} type="button" disabled={solved || tried} aria-pressed={tried}
                    onClick={() => setTries((t) => ({ ...t, [q.item_id]: [...(t[q.item_id] ?? []), i] }))}
                    className={`rounded-2xl border-2 p-3 text-left font-bold transition-colors ${right ? "border-teal bg-mint" : wrong ? "border-red bg-red-soft line-through decoration-2" : "border-ink/70 bg-paper hover:bg-mint-soft"}`}>
                    {o}
                  </button>
                );
              })}
            </div>
            {picked.length > 0 && (
              <div className={`mt-3 rounded-xl p-3 ${solved ? "bg-mint-soft" : "bg-peach"}`}>
                <p className="font-bold">{solved ? (picked.length === 1 ? "Yes, that matches your paper." : "That one matches your paper.") : "Not quite. Here is what your paper says:"}</p>
                <p className="mt-1 border-l-4 border-sun pl-2 text-sm italic">&ldquo;{proof(q)}&rdquo;</p>
              </div>
            )}
            {solved && (
              <button type="button" onClick={() => setAt((n) => n + 1)} className="mt-3 rounded-full bg-ink text-paper px-5 py-2 font-bold">
                {at + 1 < qs.length ? "Next question" : "See how I did"}
              </button>
            )}
          </div>
        )}

        {status === "ready" && finished && (
          <div className="mt-5 rounded-xl bg-mint-soft p-4">
            <p className="text-lg font-extrabold">You matched your paper on {firstTry} of {qs.length} on the first try.</p>
            {lookAgain.length > 0 ? (
              <div className="mt-1 font-semibold">
                <p>Worth a second look, or a question for your clinic:</p>
                <ul className="mt-1 list-disc pl-5 text-sm">{lookAgain.map((x) => <li key={x.item_id} data-paper-quote="">Your paper says: &ldquo;{quoteOf(x.item_id)}&rdquo;</li>)}</ul>
              </div>
            ) : (
              <p className="mt-1 font-semibold">Nice. You got every step right the first time.</p>
            )}
            <button type="button" onClick={start} className="mt-3 rounded-full border-2 border-ink px-4 py-1.5 text-sm font-bold">Ask me again</button>
          </div>
        )}
      </div>

      {data && (
        <p className="mt-4 text-[11px] font-semibold text-ink/70">
          Every answer here is backed by words in your paper, checked by our own checker inside the same step. {data.dropped.length > 0 ? `${data.dropped.length} question${data.dropped.length === 1 ? "" : "s"} held back because the proof was not in the right place.` : ""}
        </p>
      )}
    </div>
  );
}
