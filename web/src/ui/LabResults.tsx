"use client";

import { labRowView } from "@/lib/paperFirst";
import { PaperFirst } from "./PaperFirst";
import { useId, useState, type ReactNode } from "react";
import { isCritical, labChip, labClosedRow, labGroups, labQuestions, labQuestionsText, type LabChip, type LabQuestion } from "@/lib/labsView";
import { LANGUAGES } from "@/lib/schema";
import type { ResultRow, ResultsResponse } from "@/lib/results";
import { SAMPLE_LABS, SAMPLE_LABS_LABEL } from "@/lib/sampleLabs";
import { keyFor, labReason, LANGUAGE_NAME, ui, uiCount, uiLang, UI_LANG_CODE, type UiKey, type UiPluralKey } from "@/lib/uiText";
import { failureKey, logFailure, postJson } from "@/lib/requestError";
import { EnglishBeside, paperLangCode, safeLine, UiLangProvider, useUi, PaperWords } from "./UiLang";

type T = (key: UiKey, vars?: Record<string, string | number>) => string;
type TN = (key: UiPluralKey, n: number, vars?: Record<string, string | number>) => string;

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
  const t: T = (key, vars) => ui(language, key, vars);
  const tn: TN = (key, n, vars) => uiCount(language, key, n, vars);
  const ts = (key: UiKey) => safeLine(language, key);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [res, setRes] = useState<ResultsResponse | null>(null);
  // A photo is only copied into text here. The person checks that text before anything is flagged.
  const [reading, setReading] = useState(false);
  const [fromPhoto, setFromPhoto] = useState(false);
  const [checked, setChecked] = useState(false);

  async function readPhoto(file: File) {
    setReading(true); setError(""); setRes(null); setFromPhoto(false); setChecked(false);
    if (!file.type.startsWith("image/")) { setError(t("labs.notPhoto")); setReading(false); return; }
    if (file.size > 25_000_000) { setError(t("labs.tooLarge")); setReading(false); return; }
    let image_base64: string;
    try { image_base64 = await fileToBase64(file); } catch { setError(t("labs.photoFailed")); setReading(false); return; }
    try {
      const j = await postJson<{ text: string }>("/api/results/read", { image_base64, image_media_type: "image/jpeg" });
      setText(j.text);
      setFromPhoto(true);
    } catch (e) {
      // The route's words are English: logged, and the person reads a fixed line in their language (Codex round 5).
      logFailure("lab photo read", e);
      setError(t(failureKey(e, "read")));
    } finally {
      setReading(false);
    }
  }

  const unreadable = fromPhoto && text.includes("[unreadable]");
  const canExplain = !busy && !reading && text.trim().length >= 20 && (!fromPhoto || (checked && !unreadable));

  async function explain() {
    setBusy(true); setError(""); setRes(null);
    try {
      setRes(await postJson<ResultsResponse>("/api/results", { text, language }));
    } catch (e) {
      logFailure("lab results", e);
      setError(t(failureKey(e, "other")));
    } finally {
      setBusy(false);
    }
  }

  return (
    <UiLangProvider language={language} paperLang={paperLangCode(text)}>
    <section id="labs" lang={UI_LANG_CODE[language]} className="relative px-3 mt-3 scroll-mt-20" aria-labelledby="labs-title">
      <div className="section-card bg-peach px-4 sm:px-10 py-16">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="labs-title" className="display text-[clamp(2rem,4.5vw,4rem)]">{t("labs.title")}</h2>
          <p className="hand text-2xl text-ink/80 -rotate-1 max-w-[18em]">{t("labs.note")}</p>
        </div>
        <p className="mt-3 max-w-2xl text-sm font-semibold text-ink/80">
          {t("labs.intro1")}{" "}
          {t("labs.intro2")}
        </p>

        <div className="card mt-8 p-5 sm:p-8">
          <div className="grid gap-5 lg:grid-cols-[1fr_15rem]">
            <div>
              {fromPhoto && (
                <div id="labs-photo-note" className="mb-3 rounded-2xl border-2 border-sky-deep bg-sky/60 p-4">
                  <p className="font-extrabold">{ts("labs.photoCheckTitle")}</p>
                  <p className="mt-1 text-sm font-semibold text-ink/70">
                    {ts("labs.photoCheckBody")}
                  </p>
                </div>
              )}
              <textarea data-lenis-prevent aria-label={t(fromPhoto ? "labs.textLabelPhoto" : "labs.textLabel")}
                aria-describedby={fromPhoto ? "labs-photo-note" : undefined}
                className="h-44 w-full rounded-2xl border-2 border-ink/70 bg-paper p-4 font-mono text-xs focus:border-teal"
                placeholder={t("labs.placeholder")} value={text} onChange={(e) => { setText(e.target.value); setRes(null); }} />
              {fromPhoto && (
                <label className="mt-3 flex items-start gap-2 text-sm font-bold">
                  <input type="checkbox" className="mt-0.5 h-5 w-5 accent-teal" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
                  {ts("labs.checkedNumbers")}
                </label>
              )}
              {unreadable && <p className="mt-2 text-sm font-bold text-red">{t("labs.unreadable")}</p>}
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm font-bold">
                <button type="button" className="rounded-full border-2 border-ink px-4 py-2 hover:bg-mint"
                  onClick={() => { setText(SAMPLE_LABS); setFromPhoto(false); setChecked(false); setRes(null); }}>{t("labs.useSample")}</button>
                <label className={`rounded-full border-2 border-ink px-4 py-2 hover:bg-mint focus-within:ring-4 focus-within:ring-teal-deep ${reading ? "opacity-50" : "cursor-pointer"}`}>
                  📷 {t("labs.photoButton")}
                  <input type="file" accept="image/*" className="sr-only" disabled={reading}
                    onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void readPhoto(f); }} />
                </label>
              </div>
              <p className="mt-2 text-xs text-ink/70">{language === "English" ? `${SAMPLE_LABS_LABEL}. Nothing you paste or photograph here is stored.` : t("labs.sampleLabel")}</p>
            </div>
            <div className="flex flex-col gap-3">
              <label className="text-sm font-bold">{t("common.explainIn")}
                <select className="mt-1 w-full rounded-xl border-2 border-ink/70 bg-paper p-2.5" value={language} onChange={(e) => setLanguage(e.target.value as typeof language)}>
                  {LANGUAGES.map((l) => <option key={l} value={l} lang={UI_LANG_CODE[l]}>{LANGUAGE_NAME[l]}</option>)}
                </select>
              </label>
              <button type="button" onClick={explain} disabled={!canExplain}
                className="mt-auto rounded-full bg-ink px-5 py-3 font-bold text-paper disabled:opacity-50">
                {busy ? t("common.reading") : t("labs.show")}
              </button>
              {fromPhoto && !checked && <p className="text-xs font-bold text-ink/70">{ts("labs.checkPhotoFirst")}</p>}
            </div>
          </div>

          <div aria-live="polite">
            <p role="status" className={reading || fromPhoto ? "mt-4 text-sm font-bold" : "sr-only"}>
              {reading ? t("labs.readingPhoto") : fromPhoto ? (checked ? "" : ts("labs.readPhotoCheck")) : ""}
            </p>
            {error && <p role="alert" className="mt-6 rounded-2xl border-2 border-red bg-red-soft p-4 font-bold text-red">{error}</p>}
            {res && (
              <div className="mt-8">
                <p className="font-extrabold text-lg">{headline(res, t, tn, ts)}</p>
                {res.rows.length > 0 && (
                  <p className="text-xs font-semibold text-ink/70 mt-1">
                    {tn("labsInside", res.counts.inside)}{res.counts.unknown ? tn("labsCouldntTell", res.counts.unknown) : ""}.
                    {res.dropped.length > 0 && ` ${t("labs.leftOutMismatch", { lines: tn("lines", res.dropped.length) })}`}
                  </p>
                )}
                <UncheckedLines coverage={res.coverage} />
                <LabRows rows={res.rows} />
                <p className="mt-4 text-xs text-ink/70">{t("labs.rangesDiffer")}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
    </UiLangProvider>
  );
}

/**
 * Result lines our code found but no row covers. Shown whenever there are any, even with no rows at all, and a line the
 * report marks critical or panic is red and first (security review). Says how many were left off past the cap.
 */
export function UncheckedLines({ coverage }: { coverage: ResultsResponse["coverage"] }) {
  const { checked, candidates, unchecked } = coverage;
  const { t, ts, tn } = useUi();
  if (unchecked.length === 0) return null;
  const crit = unchecked.filter(isCritical);
  const more = candidates - checked - unchecked.length;
  return (
    <div className={`mt-4 rounded-2xl border-2 p-4 ${crit.length ? "border-red bg-red-soft" : "border-ink/30 bg-paper"}`} data-unchecked="">
      {crit.length > 0 && <p className="font-extrabold text-red" data-unchecked-critical="">{ts(crit.length === 1 ? "labs.critOne" : "labs.critTop")}</p>}
      <p className="font-bold">{t("labs.weChecked", { n: checked, m: candidates })}</p>
      <ul className="mt-2 space-y-1 font-mono text-xs">{unchecked.map((l, i) => (
        <li key={i} data-critical={isCritical(l) || undefined} className={`border-l-4 pl-2 ${isCritical(l) ? "border-red font-bold text-red" : "border-sun"}`}><PaperWords>{l}</PaperWords></li>
      ))}</ul>
      {more > 0 && <p className="mt-2 text-xs font-bold">{tn("labsMoreLines", more)}</p>}
    </div>
  );
}

/** Never a report-wide all-clear unless every result line our code found was checked. */
function headline(res: ResultsResponse, t: T, tn: TN, ts: (key: UiKey) => ReactNode): ReactNode {
  const { outside, unknown } = res.counts;
  const { checked, candidates } = res.coverage;
  if (res.rows.length === 0) return res.coverage.unchecked.length ? ts("labs.noneChecked") : ts("labs.noneRead");
  if (outside > 0) return tn("labsOutside", outside);
  if (checked < candidates) return t("labs.partlyChecked", { n: checked, m: candidates });
  if (unknown > 0) return tn("labsUnknownOnly", unknown);
  return t("labs.allClear");
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
  const { t, ts, tn } = useUi();
  return (
    <div className="mt-4 grid gap-5 lg:grid-cols-[1.15fr_1fr]" data-lab-rows="">
      <div className="min-w-0 space-y-5">
        {flagged.length > 0 && (
          <section aria-labelledby="labs-out-title" data-lab-group="outside">
            <h3 id="labs-out-title" className="display text-xl">{ts("labs.outTitle", { n: flagged.length })}</h3>
            <p className="text-xs font-semibold text-ink/70">{t("labs.outHint")}</p>
            <ul className="mt-2 space-y-2">{flagged.map((r, i) => <LabRow key={`o${i}`} r={r} />)}</ul>
          </section>
        )}
        {unsure.length > 0 && (
          <section aria-labelledby="labs-unsure-title" data-lab-group="unknown">
            <h3 id="labs-unsure-title" className="display text-xl">{t("labs.unsureTitle", { n: unsure.length })}</h3>
            <p className="text-xs font-semibold text-ink/70">{ts("labs.unsureHint")}</p>
            <ul className="mt-2 space-y-2">{unsure.map((r, i) => <LabRow key={`u${i}`} r={r} />)}</ul>
          </section>
        )}
        {inRange.length > 0 && (
          <section aria-labelledby="labs-in-title" data-lab-group="inside">
            <h3 id="labs-in-title" className="sr-only">{t("labs.inRangeTitle")}</h3>
            <button type="button" onClick={() => setInRangeOpen((o) => !o)} aria-expanded={inRangeOpen} aria-controls={foldId}
              className="group inline-flex items-center gap-1.5 rounded-full border-2 border-ink/60 bg-paper px-4 py-1.5 text-sm font-bold hover:bg-mint-soft">
              {tn("labsInRangeButton", inRange.length)}
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
  const { t, ts, lang } = useUi();
  return (
    <li data-lab-row={r.status} data-critical={closed.critical || undefined} data-open={open || undefined}
      className={`rounded-2xl border-2 ${closed.critical ? "border-red bg-red-soft" : outside ? "border-red bg-paper" : open ? "border-ink bg-paper" : "border-ink/20 bg-paper"}`}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={panelId}
        className="group grid w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 rounded-2xl p-3 text-left">
        <span className="min-w-0" data-closed-row="report">
          <span className="block font-extrabold leading-snug [overflow-wrap:anywhere]" data-report-name="">{closed.name}</span>
          <span className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-sm font-bold">
            <span data-report-value="">{closed.value}{closed.unit ? ` ${closed.unit}` : ""}</span>
            {closed.range && <span className="text-xs text-ink/70">{t("labs.range")} <span data-report-range="">{closed.range}</span></span>}
          </span>
          {closed.critical && <span className="mt-1 block text-xs font-extrabold text-red" data-critical-note="">{ts("labs.critRow")}</span>}
        </span>
        <span className={`chip ${CHIP_LOOK[chip.tone]}`} data-chip={chip.tone}>{ts(keyFor("labs.chip", chip.tone, "labs.chip.unknown"))}</span>
        <span aria-hidden="true" className="font-extrabold text-ink/70 transition-transform group-aria-expanded:rotate-90">›</span>
      </button>
      <div id={panelId} hidden={!open} className="space-y-2 px-3 pb-3" data-lab-panel="">
        {/* Our code's reason, then paper first (lib/paperFirst.ts): the report's own line leads, and the AI's plain name
            for the test follows it, marked as not double-checked. The question comes after the line too. */}
        <p className="text-sm font-semibold">{labReason(lang, r.reason)}{uiLang(lang) !== "English" && <EnglishBeside en={r.reason} />}</p>
        <div className="font-mono text-sm"><PaperFirst v={labRowView(r)} /></div>
        {r.ask.trim() && <p className="text-sm" data-lab-ask=""><span className="font-bold">{t("labs.askClinic")}</span> {r.ask}</p>}
      </div>
    </li>
  );
}

/** Every question in one list, each with the report line it is about. Copy carries the lines too. */
function LabAskClinic({ questions }: { questions: LabQuestion[] }) {
  const [copied, setCopied] = useState("");
  const { t } = useUi();
  function copy() {
    // No clipboard, or permission denied: say so, so the button never fails silently (Codex review).
    Promise.resolve().then(() => navigator.clipboard.writeText(labQuestionsText(questions)))
      .then(() => { setCopied(t("common.copied")); setTimeout(() => setCopied(""), 1800); })
      .catch(() => setCopied(t("common.copyFailed")));
  }
  return (
    <section aria-labelledby="labs-ask-title" className="rounded-2xl border-2 border-dashed border-peach-deep bg-paper p-4" data-ask-clinic="">
      <h3 id="labs-ask-title" className="display text-xl">{t("askClinic.title", { n: questions.length })}</h3>
      <p className="text-xs text-ink/70">{t("labs.askIntro")}</p>
      <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm">
        {questions.map((q, i) => (
          <li key={i}>
            <span className="block text-xs font-semibold text-ink/70 [overflow-wrap:anywhere]" data-paper-quote="">{t("pf.says.report")} &ldquo;<PaperWords>{q.line}</PaperWords>&rdquo;</span>
            <span data-lab-ask="">{q.ask}</span>
          </li>
        ))}
      </ol>
      <div className="mt-3 flex items-center gap-2">
        <button type="button" onClick={copy} className="rounded-full border-2 border-ink px-3 py-1 text-xs font-bold hover:bg-mint">{t("common.copyQuestions")}</button>
        <span role="status" className="text-xs font-semibold text-ink/70">{copied}</span>
      </div>
    </section>
  );
}
