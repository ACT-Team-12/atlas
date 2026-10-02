"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CarePlanResponse, VerifiedItem } from "@/lib/schema";
import { LANGUAGES, READING_LEVELS } from "@/lib/schema";
import { SAMPLE_AVS, SAMPLE_LABEL } from "@/lib/sample";
import { BARRIERS, BARRIER_LABEL, type Barrier } from "@/lib/resources";
import type { PlanResponse, ResourceCard } from "@/lib/plan";
import { SquashButton } from "./SquashButton";
import { Understand } from "./Understand";

const KIND: Record<string, { label: string; cls: string }> = {
  medication: { label: "Medicine", cls: "bg-sky text-sky-deep" },
  lab_test: { label: "Lab test", cls: "bg-lilac text-ink" },
  referral: { label: "Referral", cls: "bg-peach text-peach-deep" },
  follow_up_visit: { label: "Next visit", cls: "bg-mint text-teal-deep" },
  self_care: { label: "Daily care", cls: "bg-mint-soft text-teal-deep" },
  warning_sign: { label: "Warning sign", cls: "bg-red-soft text-red" },
};

const SAVE_KEY = "atlas-session-v1";
type Saved = {
  text: string; language: (typeof LANGUAGES)[number]; level: (typeof READING_LEVELS)[number];
  care: CarePlanResponse | null; barriers: Barrier[]; zip: string; note: string; plan: PlanResponse | null;
  done: Record<string, boolean>; removed: Record<string, boolean>; photoChecked?: boolean; savedAt: string;
};

const SPEECH_LANG: Record<string, string> = { English: "en-US", Spanish: "es-US", Vietnamese: "vi-VN", Korean: "ko-KR", Chinese: "zh-CN", Amharic: "am-ET", French: "fr-FR" };

async function fileToBase64(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
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
      {parts.map((p, i) => p.id
        ? <mark key={i} className={`rounded px-0.5 transition-colors ${active === p.id ? "bg-sun" : "bg-sun/35"}`}>{p.t}</mark>
        : <span key={i}>{p.t}</span>)}
    </pre>
  );
}

function StepHeader({ n, title, done, note }: { n: number; title: string; done?: boolean; note?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className={`grid place-items-center w-10 h-10 rounded-full border-2 border-ink font-extrabold ${done ? "bg-teal text-paper" : "bg-paper"}`}>{done ? "✓" : n}</span>
      <h3 className="display text-3xl">{title}</h3>
      {note && <span className="hand text-2xl text-ink/60 -rotate-1">{note}</span>}
    </div>
  );
}

function Resource({ r }: { r: ResourceCard }) {
  if (r.type === "clinic") {
    const c = r.clinic;
    return (
      <div className="rounded-2xl border-2 border-ink/80 bg-paper p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip bg-mint text-teal-deep">Health center</span>
          {r.km != null && <span className="text-xs font-bold text-ink/60">{r.km} km away</span>}
        </div>
        <p className="font-extrabold mt-2">{c.name}</p>
        <p className="text-sm font-semibold text-ink/75">{c.address}, {c.city} {c.zip}</p>
        <p className="text-sm font-semibold mt-1">Fees adjust to your income and family size (federal health center rule).</p>
        {c.nearest_rail && <p className="text-sm mt-1">🚆 {c.nearest_rail.name}, {(c.nearest_rail.meters / 1000).toFixed(1)} km straight-line</p>}
        {c.nearest_bus && <p className="text-sm">🚌 Bus stop: {c.nearest_bus.name}</p>}
        <div className="mt-3 flex flex-wrap gap-2 text-sm font-bold">
          <a className="rounded-full bg-ink text-paper px-3 py-1.5" href={`tel:${c.phone.replace(/[^\d]/g, "")}`}>Call {c.phone}</a>
          {c.website && <a className="rounded-full border-2 border-ink px-3 py-1" href={c.website} target="_blank" rel="noreferrer">Website ↗</a>}
          <a className="rounded-full border-2 border-ink px-3 py-1" target="_blank" rel="noreferrer"
            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${c.address}, ${c.city}, GA ${c.zip}`)}&travelmode=transit`}>Transit directions ↗</a>
        </div>
        <p className="mt-2 text-[11px] text-ink/50">Source: HRSA health center data · {c.hours_per_week ? `${c.hours_per_week} hrs/week listed` : "hours not listed"}</p>
      </div>
    );
  }
  const p = r.program;
  return (
    <div className="rounded-2xl border-2 border-ink/80 bg-paper p-4">
      <span className="chip bg-sky text-sky-deep">Program</span>
      <p className="font-extrabold mt-2">{p.name}</p>
      <p className="text-sm italic text-ink/70 mt-1 border-l-4 border-sun pl-2">&ldquo;{p.evidence_quote}&rdquo;</p>
      <div className="mt-3 flex flex-wrap gap-2 text-sm font-bold">
        {p.access.phone && <a className="rounded-full bg-ink text-paper px-3 py-1.5" href={`tel:${p.access.phone.replace(/[^\d]/g, "")}`}>Call {p.access.phone}</a>}
        {p.access.url && <a className="rounded-full border-2 border-ink px-3 py-1" href={p.access.url} target="_blank" rel="noreferrer">Open ↗</a>}
      </div>
      {p.access.text && <p className="text-sm mt-2">{p.access.text}</p>}
      <p className="mt-2 text-[11px] text-ink/50">Verified on the official page: <a className="underline" href={p.source_url} target="_blank" rel="noreferrer">{new URL(p.source_url).hostname}</a></p>
    </div>
  );
}

export function CarePlanTool() {
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [language, setLanguage] = useState<(typeof LANGUAGES)[number]>("English");
  const [level, setLevel] = useState<(typeof READING_LEVELS)[number]>("simple");
  const [reading, setReading] = useState(false);
  const [care, setCare] = useState<CarePlanResponse | null>(null);
  const [barriers, setBarriers] = useState<Barrier[]>([]);
  const [zip, setZip] = useState("");
  const [loc, setLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [note, setNote] = useState("");
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Record<string, boolean>>({});
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  // Photo reads: the quote check runs against the AI's own reading of the photo, so the person checks that reading first.
  const [transcript, setTranscript] = useState<string | null>(null);
  const [photoChecked, setPhotoChecked] = useState(false);
  const loaded = useRef(false);

  // Saved on this device only (localStorage). Nothing is stored on our side; location is never saved.
  // One-time restore after hydration: localStorage does not exist during the server render.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) {
        const v = JSON.parse(raw) as Saved;
        setText(v.text ?? ""); setLanguage(v.language ?? "English"); setLevel(v.level ?? "simple");
        setCare(v.care ?? null); setBarriers(v.barriers ?? []); setZip(v.zip ?? ""); setNote(v.note ?? "");
        setPlan(v.plan ?? null); setDone(v.done ?? {}); setRemoved(v.removed ?? {}); setPhotoChecked(v.photoChecked ?? false);
        if (v.care || v.plan) setRestoredAt(v.savedAt);
      }
    } catch {}
    loaded.current = true;
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!loaded.current) return;
    if (!care && !plan) return;
    try {
      const v: Saved = { text, language, level, care, barriers, zip, note, plan, done, removed, photoChecked, savedAt: new Date().toISOString() };
      localStorage.setItem(SAVE_KEY, JSON.stringify(v));
    } catch {}
  }, [text, language, level, care, barriers, zip, note, plan, done, removed, photoChecked]);

  function clearSaved() {
    try { localStorage.removeItem(SAVE_KEY); } catch {}
    setText(""); setCare(null); setPlan(null); setBarriers([]); setZip(""); setNote(""); setDone({}); setRemoved({}); setRestoredAt(null); setLoc(null);
  }

  async function readPaper(corrected?: string) {
    setReading(true); setError(null); setCare(null); setPlan(null); setDone({}); setRemoved({}); setRestoredAt(null);
    setTranscript(null); setPhotoChecked(false);
    if (corrected !== undefined) { setPhoto(null); setText(corrected); }
    try {
      const body: Record<string, unknown> = { language, reading_level: level };
      if (corrected !== undefined) body.text = corrected;
      else if (photo) { body.image_base64 = await fileToBase64(photo); body.image_media_type = "image/jpeg"; } else body.text = text;
      const res = await fetch("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
      setCare(json);
      if (json.source_kind === "image") { setTranscript(json.source_text); return; }
      document.getElementById("step-2")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setReading(false); }
  }

  async function makePlan() {
    if (needsPhotoCheck) return;
    setPlanning(true); setError(null); setPlan(null);
    try {
      const body = {
        care: (care?.items ?? []).filter((i) => !removed[i.id]).map((i) => ({ id: i.id, kind: i.kind, title: i.title, plain_language: i.plain_language, when: i.when, source_quote: i.source_quote })),
        barriers, language, note,
        ...(loc ? { location: loc } : /^\d{5}$/.test(zip) ? { zip } : {}),
      };
      const res = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
      setPlan(json);
      document.getElementById("step-3")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setPlanning(false); }
  }

  function useMyLocation() {
    if (!navigator.geolocation) return setError("This browser can't share location. Type a ZIP instead.");
    navigator.geolocation.getCurrentPosition(
      (p) => { setLoc({ lat: p.coords.latitude, lng: p.coords.longitude }); setZip(""); },
      () => setError("Location wasn't shared. Type a ZIP instead."),
      { timeout: 8000 },
    );
  }

  function speak() {
    if (!plan || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const lines = [plan.summary, ...plan.steps.map((s, i) => `${i + 1}. ${s.title}. ${s.action}`)];
    const u = new SpeechSynthesisUtterance(lines.join(" "));
    u.lang = SPEECH_LANG[language] ?? "en-US";
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  }

  const careById = Object.fromEntries((care?.items ?? []).map((i) => [i.id, i]));
  const items = (care?.items ?? []).filter((i) => !removed[i.id]);
  // A photo's steps quote the AI's own reading of it, so nothing is shown or planned until the person checks that reading.
  const needsPhotoCheck = care?.source_kind === "image" && !photoChecked;
  const removedItems = (care?.items ?? []).filter((i) => removed[i.id]);

  return (
    <section id="try" className="relative px-3 mt-3 scroll-mt-20" aria-labelledby="try-title">
      <div className="section-card bg-mint-soft px-4 sm:px-10 py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="try-title" className="display text-[clamp(2.4rem,5vw,5rem)]">Try it</h2>
          <p className="hand text-3xl text-teal-deep rotate-1 max-w-[16em]">use the sample, or a paper you&apos;re comfortable sharing</p>
        </div>

        {restoredAt && (
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-teal bg-paper p-4">
            <p className="font-bold">Welcome back. Your last plan is saved on this device ({new Date(restoredAt).toLocaleString()}).</p>
            <button type="button" onClick={clearSaved} className="rounded-full border-2 border-ink px-4 py-1.5 text-sm font-bold hover:bg-red-soft">Clear it from this device</button>
          </div>
        )}

        {error && <p role="alert" className="mt-6 rounded-2xl border-2 border-red bg-red-soft p-4 font-bold text-red">{error}</p>}

        {/* Step 1 */}
        <div className="card mt-10 p-5 sm:p-8">
          <StepHeader n={1} title="Your visit paper" done={!!care} note="optional, but it makes the plan yours" />
          <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_15rem]">
            <div>
              <textarea aria-label="After-visit summary text" className="h-44 w-full rounded-2xl border-2 border-ink/70 bg-paper p-4 text-sm focus:border-teal"
                placeholder="Paste the after-visit summary here..." value={text} onChange={(e) => { setText(e.target.value); setPhoto(null); }} />
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm font-bold">
                <button type="button" className="rounded-full border-2 border-ink px-4 py-2 hover:bg-mint" onClick={() => { setText(SAMPLE_AVS); setPhoto(null); }}>Use the sample paper</button>
                <label className="cursor-pointer rounded-full border-2 border-ink px-4 py-2 hover:bg-mint">
                  📷 {photo ? photo.name : "Take or upload a photo"}
                  <input type="file" accept="image/*" capture="environment" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0] ?? null; setPhoto(f); if (f) setText(""); }} />
                </label>
              </div>
              <p className="mt-2 text-xs text-ink/55">{SAMPLE_LABEL}.</p>
            </div>
            <div className="flex flex-col gap-3">
              <label className="text-sm font-bold">Explain it in
                <select className="mt-1 w-full rounded-xl border-2 border-ink/70 bg-paper p-2.5" value={language} onChange={(e) => setLanguage(e.target.value as typeof language)}>
                  {LANGUAGES.map((l) => <option key={l}>{l}</option>)}
                </select>
              </label>
              <label className="text-sm font-bold">Reading level
                <select className="mt-1 w-full rounded-xl border-2 border-ink/70 bg-paper p-2.5" value={level} onChange={(e) => setLevel(e.target.value as typeof level)}>
                  {READING_LEVELS.map((l) => <option key={l}>{l}</option>)}
                </select>
              </label>
              <SquashButton onClick={() => readPaper()} disabled={reading || (!photo && text.trim().length < 20)} bg="var(--teal)" accent="var(--sun)" className="mt-auto">
                {reading ? "Reading..." : "Read my paper"}
              </SquashButton>
            </div>
          </div>

          {care && needsPhotoCheck && (
            <div className="mt-8 rounded-2xl border-2 border-sky-deep bg-sky/60 p-4 sm:p-5">
              <p className="font-extrabold">Check how we read your photo</p>
              <p className="text-sm font-semibold text-ink/70">
                Every step below has to quote this text. If a word or number is wrong here, fix it, then read it again so the steps come from your corrected text.
              </p>
              <textarea aria-label="Text read from your photo" className="mt-3 h-44 w-full rounded-2xl border-2 border-ink/70 bg-paper p-4 text-sm focus:border-teal"
                value={transcript ?? care.source_text} onChange={(e) => setTranscript(e.target.value)} />
              <div className="mt-3 flex flex-wrap gap-3 text-sm font-bold">
                <button type="button" className="rounded-full bg-ink text-paper px-4 py-2 disabled:opacity-40"
                  disabled={reading || (transcript ?? care.source_text).trim().length < 20 || transcript === care.source_text}
                  onClick={() => readPaper(transcript ?? care.source_text)}>Use my corrected text</button>
                <button type="button" className="rounded-full border-2 border-ink px-4 py-2 hover:bg-mint" onClick={() => setPhotoChecked(true)}>It matches my paper</button>
              </div>
            </div>
          )}

          {care && !needsPhotoCheck && (
            <div className="mt-8">
              {care.has_warning_signs && (
                <div className="mb-5 rounded-2xl border-2 border-red bg-red-soft p-4 text-red">
                  <p className="font-extrabold">Your paper lists warning signs (marked red).</p>
                  <p className="text-sm font-semibold">If you have any of them right now, do what your paper says: call your clinic, or call 911.</p>
                </div>
              )}
              <p className="text-sm font-bold text-ink/70">{care.stats.grounded} steps found in your paper · {care.stats.refused} held back because we couldn&apos;t find the words · {(care.stats.ms / 1000).toFixed(1)}s</p>
              <div className="mt-4 grid gap-5 lg:grid-cols-[1.15fr_1fr]">
                <ul className="space-y-3">
                  {items.map((it) => (
                    <li key={it.id} onMouseEnter={() => setActive(it.id)} onMouseLeave={() => setActive(null)}
                      className={`rounded-2xl border-2 p-4 ${it.kind === "warning_sign" ? "border-red bg-red-soft/50" : "border-ink/70 bg-paper"}`}>
                      <div className="flex items-start gap-3">
                        <input type="checkbox" aria-label={`Mark ${it.title} done`} className="mt-1 h-5 w-5 accent-[var(--teal)]"
                          checked={!!done[it.id]} onChange={(e) => setDone((d) => ({ ...d, [it.id]: e.target.checked }))} />
                        <div className="flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className={`chip ${KIND[it.kind]?.cls}`}>{KIND[it.kind]?.label}</span>
                            <span className="font-extrabold">{it.title}</span>
                            {it.when && <span className="text-xs font-bold text-ink/55">· {it.when}</span>}
                          </div>
                          <p className="mt-1">{it.plain_language}</p>
                          {it.needs_clarification && it.question_for_clinic && <p className="mt-2 rounded-xl bg-peach p-2 text-sm font-semibold text-peach-deep">Ask your clinic: {it.question_for_clinic}</p>}
                          <p className="mt-2 border-l-4 border-sun pl-2 text-xs italic text-ink/60">From your paper: &ldquo;{it.source_quote}&rdquo;</p>
                        </div>
                        <button type="button" aria-label={`Remove ${it.title}`} className="text-xs font-bold text-ink/45 hover:text-red"
                          onClick={() => setRemoved((r) => ({ ...r, [it.id]: true }))}>Remove</button>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="space-y-4">
                  <div className="rounded-2xl border-2 border-ink/70 bg-paper p-4">
                    <p className="font-extrabold mb-2">Your paper, every step highlighted</p>
                    <div className="max-h-[26rem] overflow-auto"><Highlighted text={care.source_text} items={items} active={active} /></div>
                  </div>
                  {removedItems.length > 0 && (
                    <div className="rounded-2xl border-2 border-ink/30 bg-paper p-4 text-sm">
                      <p className="font-extrabold">You removed {removedItems.length}</p>
                      <ul className="mt-2 space-y-1">
                        {removedItems.map((r) => (
                          <li key={r.id} className="flex items-center justify-between gap-2">
                            <span>{r.title}</span>
                            <button type="button" className="font-bold underline" onClick={() => setRemoved((x) => { const n = { ...x }; delete n[r.id]; return n; })}>Undo</button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {care.not_in_document.length > 0 && (
                    <div className="rounded-2xl border-2 border-ink/70 bg-paper p-4">
                      <p className="font-extrabold">What your paper does not say</p>
                      <p className="text-xs text-ink/60">Worth asking your clinic about.</p>
                      <ul className="mt-2 list-disc pl-5 text-sm">{care.not_in_document.map((q, i) => <li key={i}>{q}</li>)}</ul>
                    </div>
                  )}
                  {care.refused.length > 0 && (
                    <div className="rounded-2xl border-2 border-ink/30 bg-paper p-4">
                      <p className="font-extrabold">Held back to protect you ({care.refused.length})</p>
                      <p className="text-xs text-ink/60">The AI suggested these, but the words aren&apos;t in your paper.</p>
                      <ul className="mt-2 list-disc pl-5 text-sm">{care.refused.map((r) => <li key={r.id}>{r.title}</li>)}</ul>
                    </div>
                  )}
                </div>
              </div>
              <Understand key={`${care.source_text.length}:${items.map((i) => i.id).join(",")}:${language}`} care={care} items={items} language={language} />
            </div>
          )}
        </div>

        {/* Step 2 */}
        <div id="step-2" className="card mt-6 p-5 sm:p-8 scroll-mt-24">
          <StepHeader n={2} title="What gets in the way?" done={!!plan} note="pick any that fit" />
          <div className="mt-6 flex flex-wrap gap-2.5" role="group" aria-label="Barriers">
            {BARRIERS.map((b) => {
              const on = barriers.includes(b);
              return (
                <button key={b} type="button" aria-pressed={on} onClick={() => setBarriers((x) => (on ? x.filter((y) => y !== b) : [...x, b]))}
                  className={`rounded-full border-2 border-ink px-4 py-2.5 text-sm font-bold transition-all ${on ? "bg-teal text-paper shadow-[0_3px_0_var(--ink)] -translate-y-0.5" : "bg-paper hover:bg-mint"}`}>
                  {on ? "✓ " : ""}{BARRIER_LABEL[b]}
                </button>
              );
            })}
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-[14rem_1fr]">
            <div>
              <label className="text-sm font-bold" htmlFor="zip">Your ZIP (metro Atlanta)</label>
              <input id="zip" inputMode="numeric" maxLength={5} className="mt-1 w-full rounded-xl border-2 border-ink/70 bg-paper p-2.5"
                placeholder="e.g. 30340" value={zip} onChange={(e) => { setZip(e.target.value.replace(/\D/g, "")); setLoc(null); }} />
              <button type="button" onClick={useMyLocation} className="mt-2 text-sm font-bold underline decoration-2 underline-offset-4">
                {loc ? "✓ Using your location (stays on this device)" : "Or use my location"}
              </button>
            </div>
            <label className="text-sm font-bold">Anything else we should know? (optional)
              <textarea className="mt-1 h-24 w-full rounded-xl border-2 border-ink/70 bg-paper p-2.5" placeholder="e.g. no car, I work mornings, I prefer home remedies first"
                value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
          <div className="mt-6">
            <SquashButton onClick={makePlan} disabled={planning || needsPhotoCheck || (barriers.length === 0 && items.length === 0)} bg="var(--ink)" accent="var(--mint)">
              {planning ? "Building your plan..." : "Make my plan"}
            </SquashButton>
            {needsPhotoCheck && <p className="mt-3 text-sm font-bold text-ink/70">First check how we read your photo in step 1.</p>}
          </div>
        </div>

        {/* Step 3 */}
        {plan && (
          <div id="step-3" className="card mt-6 p-5 sm:p-8 scroll-mt-24">
            <StepHeader n={3} title="Your plan" done note={plan.located.label} />
            <p className="mt-4 text-lg font-semibold max-w-[50em]">{plan.summary}</p>
            <div className="mt-4 flex flex-wrap gap-3 text-sm font-bold">
              <button type="button" onClick={speak} className="rounded-full border-2 border-ink bg-sun px-4 py-2">🔊 Read it out loud</button>
              <button type="button" onClick={() => window.print()} className="rounded-full border-2 border-ink px-4 py-2">🖨️ Print for the next visit</button>
              <span className="self-center text-ink/55">{plan.stats.steps} steps · {plan.stats.candidates} verified options checked · {plan.stats.dropped_refs} unverified suggestions removed</span>
            </div>
            {plan.ask_a_person && (
              <div className="mt-5 rounded-2xl border-2 border-peach-deep bg-peach p-4">
                <p className="font-extrabold text-peach-deep">This needs a person too</p>
                <p className="text-sm font-semibold">{plan.ask_a_person_reason} Call 211 (United Way of Greater Atlanta) or your community health worker.</p>
              </div>
            )}
            <ol className="mt-6 space-y-5">
              {plan.steps.map((s, i) => (
                <li key={i} className="rounded-3xl border-2 border-ink bg-mint-soft/60 p-5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="display text-3xl text-teal">{i + 1}</span>
                    <p className="display text-2xl">{s.title}</p>
                    <span className="chip bg-paper border border-ink/30">{s.barrier}</span>
                  </div>
                  <p className="mt-2 font-semibold">{s.action}</p>
                  {s.why && <p className="mt-1 text-sm text-ink/75">Why: {s.why}</p>}
                  {s.care_ids.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {s.care_ids.map((id) => careById[id] && <span key={id} className="text-xs rounded-full bg-paper border border-ink/30 px-2 py-1">📄 {careById[id].title}</span>)}
                    </div>
                  )}
                  {s.resource_ids.length > 0 && (
                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                      {s.resource_ids.map((id) => plan.resources[id] && <Resource key={id} r={plan.resources[id]} />)}
                    </div>
                  )}
                </li>
              ))}
            </ol>
            {care && care.questions_for_doctor.length > 0 && (
              <div className="mt-6 rounded-2xl border-2 border-ink/70 bg-paper p-5">
                <p className="display text-2xl">Questions for your next visit</p>
                <ul className="mt-2 list-disc pl-5 space-y-1">{care.questions_for_doctor.map((q, i) => <li key={i}>{q}</li>)}</ul>
              </div>
            )}
            <p className="mt-6 text-xs text-ink/55">ATLAS explains your own paperwork and points to verified public resources. It is not medical advice. Model: {plan.model}.</p>
          </div>
        )}
      </div>
    </section>
  );
}
