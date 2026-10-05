"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { CarePlanResponse, VerifiedItem } from "@/lib/schema";
import { guessOcrLang, spanContext, type Bbox } from "@/lib/paperMatch";
import { locateOnPhoto, progressMessage, UNSUPPORTED_MESSAGE, type Stage } from "@/lib/photoLocate";
import type { OcrPage } from "@/lib/paperOcr";
import type { Check } from "@/lib/paperFirst";
import { shortQuote } from "@/lib/stepsView";

/**
 * "Show on my paper": one tap shows where a step's words are on the person's own paper.
 * Pasted text: the paper with the verified span highlighted. Photo: the photo, read on this device, with boxes over
 * the same words; if we are not sure where they are, or the paper is in a language the reader has no data for (only
 * English and Spanish), we say so and show the text view instead. Nothing new leaves
 * the device: the text is already here, and the photo is read in this browser tab.
 */
export function ShowOnPaper({ care, item, photo, check }: { care: CarePlanResponse; item: VerifiedItem; photo: File | null; check: Check }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const statusId = useId();

  useEffect(() => {
    const d = ref.current;
    if (open && d && !d.open) d.showModal();
  }, [open]);

  if (!spanContext(care.source_text, item.span)) return null;
  // Paper first (lib/paperFirst.ts): the AI's title names the step only when it was certified; otherwise the paper's words do.
  const name = check === "certified" ? item.title : `“${shortQuote(item.source_quote, 48)}”`;
  const readsPhoto = care.source_kind === "image" && photo !== null && guessOcrLang(care.source_text) !== null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`Show on my paper: ${name}`} aria-haspopup="dialog"
        className="mt-2 rounded-full border-2 border-ink bg-paper px-3 py-1 text-xs font-bold hover:bg-mint">
        📄 Show on my paper
      </button>
      {open && (
        <dialog ref={ref} aria-labelledby={titleId} aria-describedby={statusId} onClose={() => setOpen(false)}
          onClick={(e) => { if (e.target === e.currentTarget) e.currentTarget.close(); }}
          className="m-auto w-[min(44rem,calc(100vw-1rem))] max-h-[92dvh] overflow-hidden rounded-3xl border-2 border-ink bg-paper p-0 text-ink backdrop:bg-ink/60">
          <div className="flex max-h-[92dvh] flex-col">
            <div className="flex items-start gap-3 border-b-2 border-ink/20 p-4">
              <div className="flex-1">
                <h2 id={titleId} className="display text-2xl">On your paper</h2>
                <p className="mt-1 text-sm font-bold">{name}</p>
              </div>
              <button type="button" onClick={() => ref.current?.close()}
                className="rounded-full border-2 border-ink px-4 py-2 text-sm font-bold hover:bg-mint">Close</button>
            </div>
            <div className="overflow-y-auto p-4" data-lenis-prevent>
              <Panel care={care} item={item} photo={care.source_kind === "image" ? photo : null} statusId={statusId} />
              <p className="mt-4 text-xs font-semibold text-ink/70">
                🔒 Nothing new is sent to any server for this: it uses only what is already on this device{readsPhoto ? ", and your photo is read right here" : ""}.
              </p>
            </div>
          </div>
        </dialog>
      )}
    </>
  );
}

type PhotoState =
  | { kind: "reading"; stage: Stage; pct: number; message: string }
  | { kind: "found"; page: OcrPage; boxes: Bbox[]; matched: number; total: number; url: string }
  | { kind: "not_found" }
  | { kind: "error" };

function Panel({ care, item, photo, statusId }: { care: CarePlanResponse; item: VerifiedItem; photo: File | null; statusId: string }) {
  const [state, setState] = useState<PhotoState>({ kind: "reading", stage: "loading", pct: 0, message: progressMessage("loading", 0) });
  // Decided from the text we already read, before any OCR code or data is fetched.
  const unsupported = photo !== null && guessOcrLang(care.source_text) === null;

  useEffect(() => {
    if (!photo || unsupported) return;
    let live = true;
    let url: string | null = null;
    locateOnPhoto(care.source_text, item.span, photo, (p) => { if (live) setState({ kind: "reading", ...p }); })
      .then((r) => {
        if (!live) return;
        if (r.kind !== "found") { setState({ kind: "not_found" }); return; }
        url = URL.createObjectURL(photo);
        setState({ ...r, url });
      })
      .catch(() => { if (live) setState({ kind: "error" }); });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [photo, unsupported, care.source_text, item.span]);

  if (unsupported) {
    return (
      <>
        <p id={statusId} role="status" className="mb-3 text-sm font-bold">{UNSUPPORTED_MESSAGE}</p>
        <TextPaper text={care.source_text} span={item.span!} />
      </>
    );
  }
  if (!photo) {
    return (
      <>
        <p id={statusId} role="status" className="mb-3 text-sm font-bold">
          {care.source_kind === "image"
            ? "Your photo is no longer open on this page, so here is the quote in the text we read from it. Quoted on your paper:"
            : "Quoted on your paper, highlighted below."}
        </p>
        <TextPaper text={care.source_text} span={item.span!} />
      </>
    );
  }
  if (state.kind === "reading") {
    return (
      <div aria-busy="true">
        <p id={statusId} role="status" className="text-sm font-bold">
          {state.message}
        </p>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-mint-soft" aria-hidden="true">
          <div className="h-full bg-teal" style={{ width: `${state.stage === "reading" ? state.pct : 5}%` }} />
        </div>
      </div>
    );
  }
  if (state.kind === "found") {
    return (
      <>
        <p id={statusId} role="status" className="mb-3 text-sm font-bold">
          Quoted on your paper: highlighted on your photo ({state.matched} of {state.total} words matched).
        </p>
        <PhotoPaper state={state} />
        <p className="mt-3 border-l-4 border-sun pl-2 text-sm italic text-ink/80">
          &ldquo;{care.source_text.slice(item.span!.start, item.span!.end)}&rdquo;
        </p>
      </>
    );
  }
  return (
    <>
      <p id={statusId} role="status" className="mb-3 rounded-xl bg-peach p-2 text-sm font-semibold text-peach-deep">
        {state.kind === "error"
          ? "This device could not read your photo. Here is the quote from the text we read:"
          : "We could not find this exact spot on your photo. Here is the quote from the text we read:"}
      </p>
      <TextPaper text={care.source_text} span={item.span!} />
    </>
  );
}

function scrollBehavior(): ScrollBehavior {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/** The whole paper, with the verified span (exact offsets) marked and scrolled into view with the lines around it. */
function TextPaper({ text, span }: { text: string; span: { start: number; end: number } }) {
  const mark = useRef<HTMLElement>(null);
  useEffect(() => { mark.current?.scrollIntoView({ block: "center", behavior: scrollBehavior() }); }, [span.start, span.end]);
  return (
    <div tabIndex={0} role="region" aria-label="Your paper" data-lenis-prevent
      className="max-h-[55dvh] overflow-auto rounded-2xl border-2 border-ink/70 bg-paper p-3">
      <pre className="whitespace-pre-wrap font-sans text-sm leading-6 text-ink/80">
        {text.slice(0, span.start)}
        <mark ref={mark} className="rounded bg-sun px-0.5 text-ink outline-2 outline-teal-deep">
          <span className="sr-only">Quoted on your paper: </span>
          {text.slice(span.start, span.end)}
          <span className="sr-only"> (end of quote)</span>
        </mark>
        {text.slice(span.end)}
      </pre>
    </div>
  );
}

/** The photo with a box over each line of the matched words. Boxes are placed in percent of the image read. */
function PhotoPaper({ state }: { state: Extract<PhotoState, { kind: "found" }> }) {
  const first = useRef<HTMLDivElement>(null);
  useEffect(() => { first.current?.scrollIntoView({ block: "center", behavior: scrollBehavior() }); }, [state]);
  const { width: W, height: H } = state.page;
  const pad = Math.max(2, Math.round(W / 400));
  return (
    <div tabIndex={0} role="region" aria-label="Your photo" data-lenis-prevent className="max-h-[60dvh] overflow-auto rounded-2xl border-2 border-ink/70 bg-paper">
      <div className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL of the person's own photo */}
        <img src={state.url} alt="Your photo, with the quoted words boxed" className="block h-auto w-full" />
        {/* Boxes drawn on the photo of the paper. The photo is light in both themes, so these keep the light
            theme's teal-deep and sun (7:1 against white) instead of following the page theme. */}
        {state.boxes.map((b, i) => (
          <div key={i} ref={i === 0 ? first : undefined} aria-hidden="true"
            className="absolute rounded-sm border-2 border-[#075e5a] bg-[#ffc94d]/40 mix-blend-multiply"
            style={{
              left: `${((b.x0 - pad) / W) * 100}%`, top: `${((b.y0 - pad) / H) * 100}%`,
              width: `${((b.x1 - b.x0 + 2 * pad) / W) * 100}%`, height: `${((b.y1 - b.y0 + 2 * pad) / H) * 100}%`,
            }} />
        ))}
      </div>
    </div>
  );
}
