"use client";

import { useState } from "react";
import { LANGUAGES } from "@/lib/schema";
import type { ResultRow, ResultsResponse } from "@/lib/results";
import { SAMPLE_LABS, SAMPLE_LABS_LABEL } from "@/lib/sampleLabs";

/** "Explain my lab results": shows only what the report itself marks or prints as outside its range. */
export function LabResults() {
  const [text, setText] = useState("");
  const [language, setLanguage] = useState<(typeof LANGUAGES)[number]>("English");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [res, setRes] = useState<ResultsResponse | null>(null);
  const [showAll, setShowAll] = useState(false);

  async function explain() {
    setBusy(true); setError(""); setRes(null); setShowAll(false);
    try {
      const r = await fetch("/api/results", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, language }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Something went wrong.");
      setRes(j);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const flagged = res?.rows.filter((r) => r.status === "outside") ?? [];
  const rest = res?.rows.filter((r) => r.status !== "outside") ?? [];

  return (
    <section id="labs" className="relative px-3 mt-3 scroll-mt-20" aria-labelledby="labs-title">
      <div className="section-card bg-peach px-4 sm:px-10 py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="labs-title" className="display text-[clamp(2rem,4.5vw,4rem)]">Explain my lab results</h2>
          <p className="hand text-2xl text-ink/80 -rotate-1 max-w-[18em]">a patient asked us for this on Oct 2</p>
        </div>
        <p className="mt-3 max-w-2xl text-sm font-semibold text-ink/80">
          Paste your lab report. You see only the lines your report itself marks High or Low, or where the number is outside the range printed on that line.
          The AI explains each test in plain words. Our code, not the AI, decides what is outside the range. No advice, only questions to bring to your clinic.
        </p>

        <div className="card mt-8 p-5 sm:p-8">
          <div className="grid gap-5 lg:grid-cols-[1fr_15rem]">
            <div>
              <textarea data-lenis-prevent aria-label="Lab report text" className="h-44 w-full rounded-2xl border-2 border-ink/70 bg-paper p-4 font-mono text-xs focus:border-teal"
                placeholder="Paste the lab report here..." value={text} onChange={(e) => setText(e.target.value)} />
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm font-bold">
                <button type="button" className="rounded-full border-2 border-ink px-4 py-2 hover:bg-mint" onClick={() => setText(SAMPLE_LABS)}>Use the sample lab report</button>
              </div>
              <p className="mt-2 text-xs text-ink/70">{SAMPLE_LABS_LABEL}. Nothing you paste here is stored.</p>
            </div>
            <div className="flex flex-col gap-3">
              <label className="text-sm font-bold">Explain it in
                <select className="mt-1 w-full rounded-xl border-2 border-ink/70 bg-paper p-2.5" value={language} onChange={(e) => setLanguage(e.target.value as typeof language)}>
                  {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
                </select>
              </label>
              <button type="button" onClick={explain} disabled={busy || text.trim().length < 20}
                className="mt-auto rounded-full bg-ink px-5 py-3 font-bold text-paper disabled:opacity-50">
                {busy ? "Reading..." : "Show what's flagged"}
              </button>
            </div>
          </div>

          <div aria-live="polite">
            {error && <p role="alert" className="mt-6 rounded-2xl border-2 border-red bg-red-soft p-4 font-bold text-red">{error}</p>}
            {res && (
              <div className="mt-8">
                <p className="font-extrabold text-lg">
                  {res.counts.outside === 0 ? "Nothing on this report is marked or printed as outside its range." : `${res.counts.outside} ${res.counts.outside === 1 ? "result is" : "results are"} outside the range on your report.`}
                </p>
                <p className="text-xs font-semibold text-ink/70 mt-1">
                  {res.counts.inside} inside the range{res.counts.unknown ? `, ${res.counts.unknown} with no range we could read` : ""}.
                  {res.dropped.length > 0 && ` ${res.dropped.length} line${res.dropped.length === 1 ? "" : "s"} left out because the AI's copy didn't match your report.`}
                </p>
                <ul className="mt-4 space-y-3">{flagged.map((r, i) => <Row key={i} r={r} />)}</ul>
                {rest.length > 0 && (
                  <>
                    <button type="button" onClick={() => setShowAll((s) => !s)} aria-expanded={showAll} className="mt-4 rounded-full border-2 border-ink px-4 py-1.5 text-sm font-bold">
                      {showAll ? "Hide the others" : `Show the other ${rest.length}`}
                    </button>
                    {showAll && <ul className="mt-3 space-y-3">{rest.map((r, i) => <Row key={i} r={r} />)}</ul>}
                  </>
                )}
                <p className="mt-4 text-xs text-ink/70">Ranges differ between labs and people. Only your clinic can say what a result means for you.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function Row({ r }: { r: ResultRow }) {
  const tone = r.status === "outside" ? "border-red bg-red-soft" : r.status === "inside" ? "border-ink/30 bg-paper" : "border-ink/30 bg-paper";
  return (
    <li className={`rounded-2xl border-2 p-4 ${tone}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-extrabold">{r.test}: {r.value} {r.unit}</p>
        <span className="rounded-full bg-ink px-2.5 py-0.5 text-xs font-bold text-paper">
          {r.status === "outside" ? (r.direction === "high" ? "Above range" : r.direction === "low" ? "Below range" : "Flagged") : r.status === "inside" ? "In range" : "No range"}
        </span>
      </div>
      <p className="mt-1 text-sm">{r.plain_name}</p>
      <p className="mt-1 text-sm font-semibold">{r.reason}</p>
      <p className="mt-2 text-xs font-mono border-l-4 border-sun pl-2">{r.quote}</p>
      <p className="mt-2 text-sm"><span className="font-bold">Ask your clinic:</span> {r.ask}</p>
    </li>
  );
}
