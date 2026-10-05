"use client";

import { useEffect, useState } from "react";
import type { CarePlanResponse, VerifiedItem } from "@/lib/schema";
import type { CheckedQuestion, UnderstandResponse } from "@/lib/understand";
import { suggestOption } from "@/lib/answerMatch";
import { SayAnswer } from "./SayAnswer";
import { useUi, PaperWords } from "./UiLang";

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
  // "Say your answer" (Deepgram): on only when the server has the key. Off means no mic and no answer box.
  const [voice, setVoice] = useState<{ enabled: boolean; languages: string[] }>({ enabled: false, languages: [] });
  const [said, setSaid] = useState<Record<string, string>>({});
  const [hint, setHint] = useState<string | null>(null);
  // "Did you mean ...?": the option the words seem to restate. Only the person's Yes (or a tap) records an answer.
  const [suggested, setSuggested] = useState<number | null>(null);
  const { t, tn } = useUi();

  useEffect(() => {
    let live = true;
    fetch("/api/transcribe")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (live && j && j.enabled === true && Array.isArray(j.languages)) setVoice({ enabled: true, languages: j.languages }); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  async function start() {
    setStatus("loading"); setError(null); setTries({}); setAt(0); setSaid({}); setHint(null); setSuggested(null);
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
      if (!res.ok) throw new Error(json.error ?? t("common.somethingWrong"));
      setData(json);
      setStatus(json.questions.length ? "ready" : "error");
      if (!json.questions.length) setError(t("quiz.noQuestions"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common.somethingWrong"));
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
  const stepNo = (id: string) => items.findIndex((i) => i.id === id) + 1;
  const quoteOf = (id: string) => items.find((i) => i.id === id)?.source_quote ?? "";
  const proof = (x: CheckedQuestion) => care.source_text.slice(x.span.start, x.span.end);
  const voiceHere = voice.enabled && voice.languages.includes(language) && Boolean(data?.answer_token);
  const pick = (x: CheckedQuestion, i: number) => setTries((t) => ({ ...t, [x.item_id]: [...(t[x.item_id] ?? []), i] }));
  // Speech never grades: the words can only suggest an option, and the person confirms it (or taps another).
  function checkSaid(x: CheckedQuestion) {
    const i = suggestOption(said[x.item_id] ?? "", x.options);
    setSuggested(null);
    if (i === null) { setHint(t("quiz.noMatch")); return; }
    if ((tries[x.item_id] ?? []).includes(i)) { setHint(t("quiz.alreadyTried", { option: x.options[i] })); return; }
    setHint(null);
    setSuggested(i);
  }

  return (
    <div className="mt-6 rounded-2xl border-2 border-teal bg-paper p-4 sm:p-6" aria-labelledby="understand-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p id="understand-title" className="font-extrabold text-lg">{t("quiz.title")}</p>
          <p className="text-sm font-semibold text-ink/70">{t("quiz.intro")}</p>
        </div>
        {(status === "idle" || status === "error") && (
          <button type="button" onClick={start} disabled={items.length === 0}
            className="rounded-full bg-teal text-paper px-5 py-2.5 font-bold disabled:opacity-40">
            {t(status === "error" ? "quiz.tryAgain" : "quiz.start")}
          </button>
        )}
      </div>

      <div aria-live="polite">
        {status === "loading" && <p className="mt-4 font-semibold text-ink/70">{t("quiz.loading")}</p>}
        {status === "error" && error && <p role="alert" className="mt-4 rounded-xl bg-red-soft p-3 font-semibold text-red">{error}</p>}

        {status === "ready" && q && !finished && (
          <div className="mt-5">
            <p className="text-xs font-bold uppercase tracking-wider text-ink/70">{t("quiz.questionOf", { n: at + 1, m: qs.length, k: stepNo(q.item_id) })}</p>
            <p className="mt-1 text-xl font-extrabold">{q.question}</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-3" role="group" aria-label={t("quiz.answers")}>
              {q.options.map((o, i) => {
                const tried = picked.includes(i);
                const right = tried && i === q.correct;
                const wrong = tried && i !== q.correct;
                return (
                  <button key={i} type="button" disabled={solved || tried} aria-pressed={tried}
                    onClick={() => { setHint(null); setSuggested(null); pick(q, i); }}
                    className={`rounded-2xl border-2 p-3 text-left font-bold transition-colors ${right ? "border-teal bg-mint" : wrong ? "border-red bg-red-soft line-through decoration-2" : "border-ink/70 bg-paper hover:bg-mint-soft"}`}>
                    {o}
                  </button>
                );
              })}
            </div>
            {voiceHere && !solved && (
              <div className="mt-3 rounded-xl border-2 border-ink/20 p-3">
                <label htmlFor={`said-${q.item_id}`} className="font-bold">{t("quiz.sayIt")}</label>
                <SayAnswer key={q.item_id} enabled={voiceHere} language={language} token={data?.answer_token ?? ""}
                  onTranscript={(text) => { setHint(null); setSuggested(null); setSaid((m) => ({ ...m, [q.item_id]: text })); }} />
                <textarea id={`said-${q.item_id}`} rows={2} value={said[q.item_id] ?? ""} maxLength={500}
                  onChange={(e) => { const v = e.target.value; setSuggested(null); setSaid((m) => ({ ...m, [q.item_id]: v })); }}
                  className="mt-2 w-full rounded-xl border-2 border-ink/70 bg-paper p-2 font-semibold"
                  placeholder={t("quiz.answerHere")} />
                <button type="button" onClick={() => checkSaid(q)} disabled={!(said[q.item_id] ?? "").trim()}
                  className="mt-2 rounded-full bg-ink text-paper px-4 py-1.5 text-sm font-bold disabled:opacity-40">
                  {t("quiz.checkMine")}
                </button>
                {suggested !== null && q.options[suggested] !== undefined && (
                  <div role="group" aria-label={t("quiz.confirm")} className="mt-2 rounded-xl bg-peach p-2">
                    <p className="font-bold">{t("quiz.didYouMean", { option: q.options[suggested] })}</p>
                    <div className="mt-2 flex gap-2">
                      <button type="button" onClick={() => { const i = suggested; setSuggested(null); pick(q, i); }}
                        className="rounded-full bg-ink text-paper px-4 py-1.5 text-sm font-bold">{t("common.yes")}</button>
                      <button type="button" onClick={() => { setSuggested(null); setHint(t("quiz.tapMeant")); }}
                        className="rounded-full border-2 border-ink px-4 py-1.5 text-sm font-bold">{t("common.no")}</button>
                    </div>
                  </div>
                )}
                {hint && <p role="status" className="mt-2 text-sm font-semibold">{hint}</p>}
              </div>
            )}
            {voice.enabled && !voiceHere && data?.answer_token && !voice.languages.includes(language) && !solved && (
              <p className="mt-2 text-sm font-semibold text-ink/70">{t("quiz.voiceNotIn", { language })}</p>
            )}
            {picked.length > 0 && (
              <div className={`mt-3 rounded-xl p-3 ${solved ? "bg-mint-soft" : "bg-peach"}`}>
                <p className="font-bold">{solved ? t(picked.length === 1 ? "quiz.rightFirst" : "quiz.rightLater") : t("quiz.notQuite")}</p>
                <p className="mt-1 border-l-4 border-sun pl-2 text-sm italic">&ldquo;<PaperWords>{proof(q)}</PaperWords>&rdquo;</p>
              </div>
            )}
            {solved && (
              <button type="button" onClick={() => { setHint(null); setSuggested(null); setAt((n) => n + 1); }} className="mt-3 rounded-full bg-ink text-paper px-5 py-2 font-bold">
                {t(at + 1 < qs.length ? "quiz.next" : "quiz.seeHow")}
              </button>
            )}
          </div>
        )}

        {status === "ready" && finished && (
          <div className="mt-5 rounded-xl bg-mint-soft p-4">
            <p className="text-lg font-extrabold">{t("quiz.score", { n: firstTry, m: qs.length })}</p>
            {lookAgain.length > 0 ? (
              <div className="mt-1 font-semibold">
                <p>{t("quiz.lookAgain")}</p>
                <ul className="mt-1 list-disc pl-5 text-sm">{lookAgain.map((x) => <li key={x.item_id} data-paper-quote="">{t("pf.says.paper")} &ldquo;<PaperWords>{quoteOf(x.item_id)}</PaperWords>&rdquo;</li>)}</ul>
              </div>
            ) : (
              <p className="mt-1 font-semibold">{t("quiz.allRight")}</p>
            )}
            <button type="button" onClick={start} className="mt-3 rounded-full border-2 border-ink px-4 py-1.5 text-sm font-bold">{t("quiz.again")}</button>
          </div>
        )}
      </div>

      {data && (
        <p className="mt-4 text-[11px] font-semibold text-ink/70">
          {t("quiz.backed")} {data.dropped.length > 0 ? tn("questionsHeld", data.dropped.length) : ""}
        </p>
      )}
    </div>
  );
}
