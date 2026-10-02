"use client";

import { useState } from "react";
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
  const [showAll, setShowAll] = useState(false);
  // A photo is only copied into text here. The person checks that text before anything is flagged.
  const [reading, setReading] = useState(false);
  const [fromPhoto, setFromPhoto] = useState(false);
  const [checked, setChecked] = useState(false);

  async function readPhoto(file: File) {
    setReading(true); setError(""); setRes(null); setShowAll(false); setFromPhoto(false); setChecked(false);
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
                <label className={`rounded-full border-2 border-ink px-4 py-2 hover:bg-mint focus-within:ring-4 focus-within:ring-teal/60 ${reading ? "opacity-50" : "cursor-pointer"}`}>
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
                {res.rows.length > 0 && res.coverage.unchecked.length > 0 && (
                  <div className="mt-4 rounded-2xl border-2 border-ink/30 bg-paper p-4">
                    <p className="font-bold">We checked {res.coverage.checked} of {res.coverage.candidates} result lines. These lines were not checked, so look at them yourself:</p>
                    <ul className="mt-2 space-y-1 font-mono text-xs">{res.coverage.unchecked.map((l, i) => <li key={i} className="border-l-4 border-sun pl-2">{l}</li>)}</ul>
                  </div>
                )}
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

/** Never a report-wide all-clear unless every result line our code found was checked. */
function headline(res: ResultsResponse) {
  const { outside, unknown } = res.counts;
  const { checked, candidates } = res.coverage;
  if (res.rows.length === 0) return "We couldn't read any results from this. Check the text or ask your clinic.";
  if (outside > 0) return `${outside} ${outside === 1 ? "result is" : "results are"} outside the range on your report.`;
  if (checked < candidates) return `We checked ${checked} of ${candidates} result lines. None of the ones we checked is outside its range.`;
  if (unknown > 0) return `Nothing is marked outside its range, but we couldn't tell for ${unknown} ${unknown === 1 ? "result" : "results"}.`;
  return "Nothing on this report is marked or printed as outside its range.";
}

function Row({ r }: { r: ResultRow }) {
  const tone = r.status === "outside" ? "border-red bg-red-soft" : r.status === "inside" ? "border-ink/30 bg-paper" : "border-ink/30 bg-paper";
  return (
    <li className={`rounded-2xl border-2 p-4 ${tone}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="font-extrabold">{r.test}: {r.value} {r.unit}</p>
        <span className="rounded-full bg-ink px-2.5 py-0.5 text-xs font-bold text-paper">
          {r.status === "outside" ? (r.direction === "high" ? "Above range" : r.direction === "low" ? "Below range" : "Flagged") : r.status === "inside" ? "In range" : "Can't tell"}
        </span>
      </div>
      <p className="mt-1 text-sm">{r.plain_name}</p>
      <p className="mt-1 text-sm font-semibold">{r.reason}</p>
      <p className="mt-2 text-xs font-mono border-l-4 border-sun pl-2">{r.quote}</p>
      <p className="mt-2 text-sm"><span className="font-bold">Ask your clinic:</span> {r.ask}</p>
    </li>
  );
}
