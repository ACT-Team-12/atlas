"use client";

import { useMemo, useState } from "react";
import type { CarePlanResponse, VerifiedItem } from "@/lib/schema";
import { LANGUAGES, READING_LEVELS } from "@/lib/schema";
import { SAMPLE_AVS, SAMPLE_LABEL } from "@/lib/sample";

const KIND_LABEL: Record<string, string> = {
  medication: "Medicine",
  lab_test: "Lab test",
  referral: "Referral",
  follow_up_visit: "Next visit",
  self_care: "Daily care",
  warning_sign: "Warning sign",
};

const KIND_COLOR: Record<string, string> = {
  medication: "bg-sky-100 text-sky-900",
  lab_test: "bg-violet-100 text-violet-900",
  referral: "bg-amber-100 text-amber-900",
  follow_up_visit: "bg-emerald-100 text-emerald-900",
  self_care: "bg-teal-100 text-teal-900",
  warning_sign: "bg-red-100 text-red-900",
};

async function fileToBase64(file: File): Promise<{ data: string; type: "image/jpeg" }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const url = canvas.toDataURL("image/jpeg", 0.85);
  return { data: url.split(",")[1], type: "image/jpeg" };
}

function Highlighted({ text, items, active }: { text: string; items: VerifiedItem[]; active: string | null }) {
  const parts = useMemo(() => {
    const spans = items
      .filter((i) => i.span)
      .map((i) => ({ ...i.span!, id: i.id }))
      .sort((a, b) => a.start - b.start);
    const out: { t: string; id?: string }[] = [];
    let at = 0;
    for (const s of spans) {
      if (s.start < at) continue;
      out.push({ t: text.slice(at, s.start) });
      out.push({ t: text.slice(s.start, s.end), id: s.id });
      at = s.end;
    }
    out.push({ t: text.slice(at) });
    return out;
  }, [text, items]);
  return (
    <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-slate-700">
      {parts.map((p, i) =>
        p.id ? (
          <mark
            key={i}
            id={`src-${p.id}`}
            className={`rounded px-0.5 ${active === p.id ? "bg-yellow-300" : "bg-yellow-100"}`}
          >
            {p.t}
          </mark>
        ) : (
          <span key={i}>{p.t}</span>
        ),
      )}
    </pre>
  );
}

export default function Home() {
  const [text, setText] = useState("");
  const [photo, setPhoto] = useState<File | null>(null);
  const [language, setLanguage] = useState<(typeof LANGUAGES)[number]>("English");
  const [level, setLevel] = useState<(typeof READING_LEVELS)[number]>("simple");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [plan, setPlan] = useState<CarePlanResponse | null>(null);
  const [confirmed, setConfirmed] = useState<Record<string, boolean>>({});
  const [removed, setRemoved] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setPlan(null);
    setConfirmed({});
    setRemoved({});
    try {
      const body: Record<string, unknown> = { language, reading_level: level };
      if (photo) {
        const img = await fileToBase64(photo);
        body.image_base64 = img.data;
        body.image_media_type = img.type;
      } else {
        body.text = text;
      }
      const res = await fetch("/api/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
      setPlan(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }

  const visible = plan?.items.filter((i) => !removed[i.id]) ?? [];
  const doneCount = visible.filter((i) => confirmed[i.id]).length;

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 text-slate-900">
      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-emerald-700">ATLAS · Team 12 · ATL Innovation Cup 2026</p>
        <h1 className="mt-1 text-3xl font-bold">Your visit, turned into a plan you can actually follow.</h1>
        <p className="mt-2 max-w-3xl text-slate-600">
          Paste or photograph the after-visit summary your clinic gave you. ATLAS pulls out every medicine change, lab, referral and
          warning sign, explains it in plain words, and shows you the exact line it came from. If it cannot find something in your
          paper, it will not make it up.
        </p>
      </header>

      <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[1fr_auto]">
        <div>
          <textarea
            className="h-48 w-full rounded-lg border border-slate-300 p-3 text-sm focus:border-emerald-600 focus:outline-none"
            placeholder="Paste your after-visit summary here..."
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPhoto(null);
            }}
          />
          <div className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <button
              type="button"
              className="rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50"
              onClick={() => {
                setText(SAMPLE_AVS);
                setPhoto(null);
              }}
            >
              Use the sample summary
            </button>
            <label className="cursor-pointer rounded-md border border-slate-300 px-3 py-1.5 hover:bg-slate-50">
              {photo ? `Photo: ${photo.name}` : "Or take / upload a photo"}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setPhoto(f);
                  if (f) setText("");
                }}
              />
            </label>
            <span className="text-xs text-slate-500">{SAMPLE_LABEL}. Please do not upload real records yet.</span>
          </div>
        </div>
        <div className="flex flex-col gap-3 md:w-56">
          <label className="text-sm">
            Explain it in
            <select className="mt-1 w-full rounded-md border border-slate-300 p-2" value={language} onChange={(e) => setLanguage(e.target.value as typeof language)}>
              {LANGUAGES.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Reading level
            <select className="mt-1 w-full rounded-md border border-slate-300 p-2" value={level} onChange={(e) => setLevel(e.target.value as typeof level)}>
              {READING_LEVELS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={loading || (!photo && text.trim().length < 20)}
            onClick={run}
            className="mt-auto rounded-lg bg-emerald-700 px-4 py-3 font-semibold text-white hover:bg-emerald-800 disabled:opacity-40"
          >
            {loading ? "Reading your summary..." : "Make my plan"}
          </button>
        </div>
      </section>

      {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}

      {plan && (
        <>
          {plan.has_warning_signs && (
            <div className="mt-6 rounded-xl border-2 border-red-500 bg-red-50 p-4 text-red-900">
              <p className="font-bold">Your paper lists warning signs.</p>
              <p className="text-sm">They are marked in red below. If you have any of them right now, follow what your paper says: call your clinic, or call 911.</p>
            </div>
          )}

          <div className="mt-6 flex flex-wrap items-center gap-4 text-sm text-slate-600">
            <span className="font-semibold text-slate-900">
              {doneCount} of {visible.length} steps checked off
            </span>
            <span>
              {plan.stats.grounded} found in your paper · {plan.stats.refused} hidden because we could not find them in your paper · {(plan.stats.ms / 1000).toFixed(1)}s
            </span>
          </div>

          <div className="mt-4 grid gap-6 lg:grid-cols-[1.2fr_1fr]">
            <ul className="space-y-3">
              {visible.map((item) => (
                <li
                  key={item.id}
                  onMouseEnter={() => setActive(item.id)}
                  onMouseLeave={() => setActive(null)}
                  className={`rounded-xl border p-4 shadow-sm ${item.kind === "warning_sign" ? "border-red-300 bg-red-50/40" : "border-slate-200 bg-white"}`}
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      aria-label={`Mark ${item.title} done`}
                      className="mt-1 h-5 w-5 accent-emerald-700"
                      checked={!!confirmed[item.id]}
                      onChange={(e) => setConfirmed((c) => ({ ...c, [item.id]: e.target.checked }))}
                    />
                    <div className="flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${KIND_COLOR[item.kind]}`}>{KIND_LABEL[item.kind]}</span>
                        <span className="font-semibold">{item.title}</span>
                        {item.when && <span className="text-xs text-slate-500">· {item.when}</span>}
                      </div>
                      <p className="mt-1 text-slate-800">{item.plain_language}</p>
                      {item.why && <p className="mt-1 text-sm text-slate-600">Why: {item.why}</p>}
                      {item.needs_clarification && item.question_for_clinic && (
                        <p className="mt-2 rounded-md bg-amber-50 p-2 text-sm text-amber-900">Ask your clinic: {item.question_for_clinic}</p>
                      )}
                      <p className="mt-2 border-l-2 border-yellow-400 pl-2 text-xs italic text-slate-500">From your paper: &ldquo;{item.source_quote}&rdquo;</p>
                    </div>
                    <button type="button" className="text-xs text-slate-400 hover:text-red-600" onClick={() => setRemoved((r) => ({ ...r, [item.id]: true }))}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>

            <aside className="space-y-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <h2 className="mb-2 font-semibold">Your paper, with every step highlighted</h2>
                <div className="max-h-[28rem] overflow-auto">
                  <Highlighted text={plan.source_text} items={visible} active={active} />
                </div>
              </div>
              {plan.questions_for_doctor.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <h2 className="mb-2 font-semibold">Questions to bring to your next visit</h2>
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {plan.questions_for_doctor.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>
              )}
              {plan.not_in_document.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <h2 className="mb-2 font-semibold">What your paper does not say</h2>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
                    {plan.not_in_document.map((q, i) => (
                      <li key={i}>{q}</li>
                    ))}
                  </ul>
                </div>
              )}
              {plan.refused.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <h2 className="mb-1 font-semibold">Held back to protect you ({plan.refused.length})</h2>
                  <p className="mb-2 text-xs text-slate-600">
                    The AI suggested these, but we could not find the words in your paper, so we did not show them as instructions.
                  </p>
                  <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
                    {plan.refused.map((r) => (
                      <li key={r.id}>{r.title}</li>
                    ))}
                  </ul>
                </div>
              )}
            </aside>
          </div>
          <p className="mt-6 text-xs text-slate-500">
            ATLAS explains what your own paperwork says. It is not medical advice and does not diagnose. Model: {plan.model}.
          </p>
        </>
      )}
    </main>
  );
}
