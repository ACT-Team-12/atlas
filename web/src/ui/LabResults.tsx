"use client";

import { labRowView } from "@/lib/paperFirst";
import { PaperFirst } from "./PaperFirst";
import { useId, useState } from "react";
import { isCritical, labChip, labClosedRow, labGroups, labQuestions, labQuestionsText, type LabChip, type LabQuestion } from "@/lib/labsView";
import { LANGUAGES } from "@/lib/schema";
import type { ResultRow, ResultsResponse } from "@/lib/results";
import { SAMPLE_LABS, SAMPLE_LABS_LABEL } from "@/lib/sampleLabs";

/** Shrinks a photo or screenshot to at most 1600 px on its long side and returns JPEG base64 (no data: prefix). */
async function fileToBase64(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff"; // a see-through screenshot would turn black as a JPEG
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.9).split(",")[1];
}

/** "Explain my lab results": shows only what the report itself marks or prints as outside its range. */
export function LabResults() {
  const [text, setText] = useState("");
  const [language, setLanguage] = useState<(typeof LANGUAGES)[number]>("English");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [res, setRes] = useState<ResultsResponse | null>(null);
  // A photo is only copied into text here. The person checks that text before anything is flagged.
  const [reading, setReading] = useState(false);
  const [fromPhoto, setFromPhoto] = useState(false);
  const [checked, setChecked] = useState(false);

  async function readPhoto(file: File) {
    setReading(true); setError(""); setRes(null); setFromPhoto(false); setChecked(false);
    try {
      if (!file.type.startsWith("image/")) throw new Error("That file is not a photo. Use a photo or screenshot.");
      if (file.size > 25_000_000) throw new Error("That photo is too large. Try a smaller one.");
      const image_base64 = await fileToBase64(file);
      const r = await fetch("/api/results/read", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ image_base64, image_media_type: "image/jpeg" }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Something went wrong.");
      setText(j.text);
      setFromPhoto(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong reading that photo.");
    } finally {
      setReading(false);
    }
  }

  const unreadable = fromPhoto && text.includes("[unreadable]");
  const canExplain = !busy && !reading && text.trim().length >= 20 && (!fromPhoto || (checked && !unreadable));

  async function explain() {
    setBusy(true); setError(""); setRes(null);
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

  return (
    <section id="labs" className="relative px-3 mt-3 scroll-mt-20" aria-labelledby="labs-title">
      <div className="section-card bg-peach px-4 sm:px-10 py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="labs-title" className="display text-[clamp(2rem,4.5vw,4rem)]">Explain my lab results</h2>
          <p className="hand text-2xl text-ink/80 -rotate-1 max-w-[18em]">a patient asked us for this on Oct 2</p>
        </div>
        <p className="mt-3 max-w-2xl text-sm font-semibold text-ink/80">
          Paste your lab report, or take a photo or screenshot of it. You see only the lines your report itself marks High or Low, or where the number is outside the range printed on that line.
          The AI explains each test in plain words. Our code, not the AI, decides what is outside the range. No advice, only questions to bring to your clinic.
        </p>

        <div className="card mt-8 p-5 sm:p-8">
          <div className="grid gap-5 lg:grid-cols-[1fr_15rem]">
            <div>
              {fromPhoto && (
                <div id="labs-photo-note" className="mb-3 rounded-2xl border-2 border-sky-deep bg-sky/60 p-4">
                  <p className="font-extrabold">This is how we read your photo. Check the numbers against your screen before you continue.</p>
                  <p className="mt-1 text-sm font-semibold text-ink/70">
                    The AI copied this text from your photo. It can misread a number. Fix anything that is wrong right here. Only this text is used.
                  </p>
                </div>
              )}
              <textarea data-lenis-prevent aria-label={fromPhoto ? "Lab report text read from your photo. Check and fix it." : "Lab report text"}
                aria-describedby={fromPhoto ? "labs-photo-note" : undefined}
                className="h-44 w-full rounded-2xl border-2 border-ink/70 bg-paper p-4 font-mono text-xs focus:border-teal"
                placeholder="Paste the lab report here..." value={text} onChange={(e) => { setText(e.target.value); setRes(null); }} />
              {fromPhoto && (
                <label className="mt-3 flex items-start gap-2 text-sm font-bold">
                  <input type="checkbox" className="mt-0.5 h-5 w-5 accent-teal" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                  I checked these numbers against my report
                </label>
              )}
              {unreadable && <p className="mt-2 text-sm font-bold text-red">Some parts say [unreadable]. Type in what your report shows there first.</p>}
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm font-bold">
                <button type="button" className="rounded-full border-2 border-ink px-4 py-2 hover:bg-mint"
                  onClick={() => { setText(SAMPLE_LABS); setFromPhoto(false); setChecked(false); setRes(null); }}>Use the sample lab report</button>
                <label className={`rounded-full border-2 border-ink px-4 py-2 hover:bg-mint focus-within:ring-4 focus-within:ring-teal-deep ${reading ? "opacity-50" : "cursor-pointer"}`}>
                  📷 Take or upload a photo / screenshot
                  <input type="file" accept="image/*" className="sr-only" disabled={reading}
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void readPhoto(f); }} />
                </label>
              </div>
              <p className="mt-2 text-xs text-ink/70">{SAMPLE_LABS_LABEL}. Nothing you paste or photograph here is stored.</p>
            </div>
            <div className="flex flex-col gap-3">
              <label className="text-sm font-bold">Explain it in
                <select className="mt-1 w-full rounded-xl border-2 border-ink/70 bg-paper p-2.5" value={language} onChange={(e) => setLanguage(e.target.value as typeof language)}>
                  {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
                </select>
              </label>
              <button type="button" onClick={explain} disabled={!canExplain}
                className="mt-auto rounded-full bg-ink px-5 py-3 font-bold text-paper disabled:opacity-50">
                {busy ? "Reading..." : "Show what's flagged"}
              </button>
              {fromPhoto && !checked && <p className="text-xs font-bold text-ink/70">First check the text we read from your photo.</p>}
            </div>
          </div>

          <div aria-live="polite">
            <p role="status" className={reading || fromPhoto ? "mt-4 text-sm font-bold" : "sr-only"}>
              {reading ? "Reading your photo..." : fromPhoto ? (checked ? "" : "We read your photo. Check the text above.") : ""}
            </p>
            {error && <p role="alert" className="mt-6 rounded-2xl border-2 border-red bg-red-soft p-4 font-bold text-red">{error}</p>}
            {res && (
              <div className="mt-8">
                <p className="font-extrabold text-lg">{headline(res)}</p>
                {res.rows.length > 0 && (
                  <p className="text-xs font-semibold text-ink/70 mt-1">
                    {res.counts.inside} inside the range{res.counts.unknown ? `, ${res.counts.unknown} we couldn't tell` : ""}.
                    {res.dropped.length > 0 && ` ${res.dropped.length} line${res.dropped.length === 1 ? "" : "s"} left out because the AI's copy didn't match your report.`}
                  </p>
                )}
                <UncheckedLines coverage={res.coverage} />
                <LabRows rows={res.rows} />
                <p className="mt-4 text-xs text-ink/70">Ranges differ between labs and people. Only your clinic can say what a result means for you.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

/**
 * Result lines our code found but no row covers. Shown whenever there are any, even with no rows at all, and a line the
 * report marks critical or panic is red and first (security review). Says how many were left off past the cap.
 */
export function UncheckedLines({ coverage }: { coverage: ResultsResponse["coverage"] }) {
  const { checked, candidates, unchecked } = coverage;
  if (unchecked.length === 0) return null;
  const crit = unchecked.filter(isCritical);
  const more = candidates - checked - unchecked.length;
  return (
    <div className={`mt-4 rounded-2xl border-2 p-4 ${crit.length ? "border-red bg-red-soft" : "border-ink/30 bg-paper"}`} data-unchecked="">
      {crit.length > 0 && <p className="font-extrabold text-red" data-unchecked-critical="">Your report marks {crit.length === 1 ? "a line" : `${crit.length} lines`} critical that we couldn&apos;t check. Call your clinic about {crit.length === 1 ? "it" : "them"} today.</p>}
      <p className="font-bold">We checked {checked} of {candidates} result lines. These lines were not checked, so look at them yourself:</p>
      <ul className="mt-2 space-y-1 font-mono text-xs">{unchecked.map((l, i) => (
        <li key={i} data-critical={isCritical(l) || undefined} className={`border-l-4 pl-2 ${isCritical(l) ? "border-red font-bold text-red" : "border-sun"}`}>{l}</li>
      ))}</ul>
      {more > 0 && <p className="mt-2 text-xs font-bold">And {more} more {more === 1 ? "line" : "lines"} not shown here. Read your whole report.</p>}
    </div>
  );
}

/** Never a report-wide all-clear unless every result line our code found was checked. */
function headline(res: ResultsResponse) {
  const { outside, unknown } = res.counts;
  const { checked, candidates } = res.coverage;
  if (res.rows.length === 0) return res.coverage.unchecked.length
    ? "We couldn't check any results on this. Read the lines below on your report, or ask your clinic."
    : "We couldn't read any results from this. Check the text or ask your clinic.";
  if (outside > 0) return `${outside} ${outside === 1 ? "result is" : "results are"} outside the range on your report.`;
  if (checked < candidates) return `We checked ${checked} of ${candidates} result lines. None of the ones we checked is outside its range.`;
  if (unknown > 0) return `Nothing is marked outside its range, but we couldn't tell for ${unknown} ${unknown === 1 ? "result" : "results"}.`;
  return "Nothing on this report is marked or printed as outside its range.";
}

/**
 * The results, concise (Akhil's pattern, PR 73): each line outside its range is one row (the report's own name, value
 * and range, and our code's chip) that opens to the report's line, the plain words and the question. Results in range
 * fold behind one disclosure. Every question is collected into one "Ask your clinic" list, each with its report line.
 */
export function LabRows({ rows }: { rows: ResultRow[] }) {
  const [inRangeOpen, setInRangeOpen] = useState(false);
  const foldId = useId();
  const { flagged, unsure, inRange } = labGroups(rows);
  const questions = labQuestions(rows);
  return (
    <div className="mt-4 grid gap-5 lg:grid-cols-[1.15fr_1fr]" data-lab-rows="">
      <div className="min-w-0 space-y-5">
        {flagged.length > 0 && (
          <section aria-labelledby="labs-out-title" data-lab-group="outside">
            <h3 id="labs-out-title" className="display text-xl">Outside the range on your report ({flagged.length})</h3>
            <p className="text-xs font-semibold text-ink/70">Tap a result to see your report&apos;s line, what the test is, and a question to ask.</p>
            <ul className="mt-2 space-y-2">{flagged.map((r, i) => <LabRow key={`o${i}`} r={r} />)}</ul>
          </section>
        )}
        {unsure.length > 0 && (
          <section aria-labelledby="labs-unsure-title" data-lab-group="unknown">
            <h3 id="labs-unsure-title" className="display text-xl">We couldn&apos;t tell ({unsure.length})</h3>
            <p className="text-xs font-semibold text-ink/70">Look at these lines on your report, or ask your clinic.</p>
            <ul className="mt-2 space-y-2">{unsure.map((r, i) => <LabRow key={`u${i}`} r={r} />)}</ul>
          </section>
        )}
        {inRange.length > 0 && (
          <section aria-labelledby="labs-in-title" data-lab-group="inside">
            <h3 id="labs-in-title" className="sr-only">Results in range</h3>
            <button type="button" onClick={() => setInRangeOpen((o) => !o)} aria-expanded={inRangeOpen} aria-controls={foldId}
              className="group inline-flex items-center gap-1.5 rounded-full border-2 border-ink/60 bg-paper px-4 py-1.5 text-sm font-bold hover:bg-mint-soft">
              {inRange.length} {inRange.length === 1 ? "result" : "results"} in range
              <span aria-hidden="true" className="inline-block transition-transform group-aria-expanded:rotate-90">›</span>
            </button>
            <ul id={foldId} hidden={!inRangeOpen} className="mt-3 space-y-2">{inRange.map((r, i) => <LabRow key={`i${i}`} r={r} />)}</ul>
          </section>
        )}
      </div>
      {questions.length > 0 && <div className="min-w-0"><LabAskClinic questions={questions} /></div>}
    </div>
  );
}

const CHIP_LOOK: Record<LabChip["tone"], string> = {
  high: "bg-red text-paper", low: "bg-sky-deep text-paper", flag: "bg-red text-paper", inside: "bg-mint text-teal-deep", unknown: "bg-sun text-ink",
};

function LabRow({ r }: { r: ResultRow }) {
  const closed = labClosedRow(r);
  const chip = labChip(r);
  const panelId = useId();
  // A line the report marks critical opens by itself and stays loud.
  const [open, setOpen] = useState(closed.critical);
  const outside = r.status === "outside";
  return (
    <li data-lab-row={r.status} data-critical={closed.critical || undefined} data-open={open || undefined}
      className={`rounded-2xl border-2 ${closed.critical ? "border-red bg-red-soft" : outside ? "border-red bg-paper" : open ? "border-ink bg-paper" : "border-ink/20 bg-paper"}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={panelId}
        className="group grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-2xl p-3 text-left">
        <span className="min-w-0" data-closed-row="report">
          <span className="block font-extrabold leading-snug [overflow-wrap:anywhere]" data-report-name="">{closed.name}</span>
          <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm font-bold">
            <span data-report-value="">{closed.value}{closed.unit ? ` ${closed.unit}` : ""}</span>
            {closed.range && <span className="text-xs text-ink/70">range <span data-report-range="">{closed.range}</span></span>}
          </span>
          {closed.critical && <span className="mt-1 block text-xs font-extrabold text-red" data-critical-note="">Your report marks this line critical. Call your clinic about it today.</span>}
        </span>
        <span className={`chip ${CHIP_LOOK[chip.tone]}`} data-chip={chip.tone}>{chip.label}</span>
        <span aria-hidden="true" className="font-extrabold text-ink/70 transition-transform group-aria-expanded:rotate-90">›</span>
      </button>
      <div id={panelId} hidden={!open} className="space-y-2 px-3 pb-3" data-lab-panel="">
        {/* Our code's reason, then paper first (lib/paperFirst.ts): the report's own line leads, and the AI's plain name
            for the test follows it, marked as not double-checked. The question comes after the line too. */}
        <p className="text-sm font-semibold">{r.reason}</p>
        <div className="font-mono text-sm"><PaperFirst v={labRowView(r)} /></div>
        {r.ask.trim() && <p className="text-sm" data-lab-ask=""><span className="font-bold">Ask your clinic:</span> {r.ask}</p>}
      </div>
    </li>
  );
}

/** Every question in one list, each with the report line it is about. Copy carries the lines too. */
function LabAskClinic({ questions }: { questions: LabQuestion[] }) {
  const [copied, setCopied] = useState("");
  function copy() {
    // No clipboard, or permission denied: say so, so the button never fails silently (Codex review).
    Promise.resolve().then(() => navigator.clipboard.writeText(labQuestionsText(questions)))
      .then(() => { setCopied("Copied"); setTimeout(() => setCopied(""), 1800); })
      .catch(() => setCopied("Couldn't copy. Select the questions above and copy them yourself."));
  }
  return (
    <section aria-labelledby="labs-ask-title" className="rounded-2xl border-2 border-dashed border-peach-deep bg-paper p-4" data-ask-clinic="">
      <h3 id="labs-ask-title" className="display text-xl">Ask your clinic ({questions.length})</h3>
      <p className="text-xs text-ink/70">Questions about the results above. Bring them to your next call or visit.</p>
      <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">
        {questions.map((q, i) => (
          <li key={i}>
            <span className="block text-xs font-semibold text-ink/70 [overflow-wrap:anywhere]" data-paper-quote="">Your report says: &ldquo;{q.line}&rdquo;</span>
            <span data-lab-ask="">{q.ask}</span>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={copy} className="rounded-full border-2 border-ink px-3 py-1 text-xs font-bold hover:bg-mint">Copy questions</button>
        <span role="status" className="text-xs font-semibold text-ink/70">{copied}</span>
      </div>
    </section>
  );
}
