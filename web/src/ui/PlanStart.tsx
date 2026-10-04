"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import type { PlanStep, ResourceCard } from "@/lib/plan";
import { BARRIER_LABEL, type Barrier, formatHours, openNow, opensEvenings, opensWeekends } from "@/lib/resources";
import { directionsHref, helpsLine, primaryAction, resourceName, telHref, type RankedResource } from "@/lib/planTop";
import { resourceScript } from "@/lib/booking";
import { pipLine } from "@/lib/pip";
import { BY_ATLAS, PLACES_NOTE } from "@/lib/provenance";
import { CalmToggle, PipBubble, PipMarker, PipSlot, usePipCalm } from "./Pip";

/**
 * The plan screen, "Start with 3 calls" (Akhil's concept A): the three verified places that help with the most of the
 * person's problems, each shown once with one big button, then every plan step as one line to tick off. Tapping a line
 * shows the plain plan, the paper's own words, the best option, other options and "Why this?" (the verified quotes).
 * Folded parts stay in the page with class plan-shut (display: none on screen, so also out of the accessibility tree),
 * and the print stylesheet prints them in full (globals.css). Not the hidden attribute: Tailwind's layered
 * `[hidden] { display: none !important }` would beat any print override.
 */

/** A source link, or just its name while the plan is outdated (no link out to a place picked from old answers). */
function SourceLink({ href, label, off }: { href: string; label: string; off?: string }) {
  return off ? <span>{label}</span> : <a className="underline" href={href} target="_blank" rel="noreferrer">{label}</a>;
}

const host = (url: string) => {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
};

function ResourceLinksOff({ off }: { off: string }) {
  return <p className="mt-3 text-sm font-bold text-peach-deep">{off}: calls, websites and directions for this plan are off until then.</p>;
}

/** One seal for a program's proof: its official page, and (in "Why this?") the line quoted from it. */
export function VerifiedSeal({ url, off }: { url: string; off?: string }) {
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-teal-deep">
      <span aria-hidden="true" className="grid h-5 w-5 place-items-center rounded-full bg-teal text-[11px] text-paper">✓</span>
      Verified on the official page: <SourceLink href={url} label={host(url)} off={off} />
    </p>
  );
}

/**
 * A program or health center card. `proof={false}` leaves out a program's quoted line and its source, which the plan
 * rows show once under "Why this?" instead. While the plan is outdated (`off`), no call, website or directions link.
 */
export function Resource({ r, off, proof = true }: { r: ResourceCard; off?: string; proof?: boolean }) {
  if (r.type === "clinic") {
    const c = r.clinic;
    const hours = formatHours(c.hours);
    const open = openNow(c);
    return (
      <div className="rounded-2xl border-2 border-ink/80 bg-paper p-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip bg-mint text-teal-deep">Health center</span>
          {r.km != null && <span className="text-xs font-bold text-ink/70">{r.km} km away</span>}
          {open != null && <span className={`chip ${open ? "bg-teal text-paper" : "bg-paper border border-ink/30 text-ink/70"}`}>{open ? "Listed as open now" : "Listed as closed now"}</span>}
          {(opensEvenings(c) || opensWeekends(c)) && <span className="chip bg-sun text-ink">{[opensEvenings(c) && "Evenings", opensWeekends(c) && "Weekends"].filter(Boolean).join(" + ")}</span>}
        </div>
        <p className="font-extrabold mt-2">{c.name}</p>
        <p className="text-sm font-semibold text-ink/75">{c.address}, {c.city} {c.zip}</p>
        <p className="text-sm font-semibold mt-1">Fees adjust to your income and family size (federal health center rule).</p>
        {c.nearest_rail && <p className="text-sm mt-1">🚆 {c.nearest_rail.name}, {(c.nearest_rail.meters / 1000).toFixed(1)} km straight-line</p>}
        {c.nearest_bus && <p className="text-sm">🚌 Bus stop: {c.nearest_bus.name}</p>}
        {hours && c.hours_source_id === "clinic-site" && (
          <>
            <p className="text-sm mt-1">🕘 Hours: {hours}</p>
            <p className="text-xs italic text-ink/70 mt-1 border-l-4 border-sun pl-2">&ldquo;{c.hours_quote}&rdquo;</p>
          </>
        )}
        {hours && c.hours_source_id !== "clinic-site" && <p className="text-sm mt-1">🕘 Listed hours: {hours} <span className="text-ink/70">(call to confirm)</span></p>}
        {off ? <ResourceLinksOff off={off} /> : <div className="mt-3 flex flex-wrap gap-2 text-sm font-bold">
          {c.phone && <a className="rounded-full bg-ink text-paper px-3 py-1.5" href={telHref(c.phone)}>Call {c.phone}</a>}
          {c.website && <a className="rounded-full border-2 border-ink px-3 py-1" href={c.website} target="_blank" rel="noreferrer">Website ↗</a>}
          <a className="rounded-full border-2 border-ink px-3 py-1" target="_blank" rel="noreferrer" href={directionsHref(c)}>Transit directions ↗</a>
        </div>}
        <p className="mt-2 text-[11px] text-ink/70">
          Source: HRSA health center data{c.source_id === "hrsa-national" ? " (nationwide list, Oct 2)" : ""}
          {hours && c.hours_source_id === "clinic-site" && c.hours_url
            ? <> · hours quoted from <SourceLink href={c.hours_url} label={host(c.hours_url)} off={off} />, checked Oct 2</>
            : hours ? " · hours from its Google Maps listing, checked Oct 2" : c.hours_per_week ? ` · ${c.hours_per_week} hrs/week listed, times not listed` : " · hours not listed"}
        </p>
      </div>
    );
  }
  const p = r.program;
  return (
    <div className="rounded-2xl border-2 border-ink/80 bg-paper p-4">
      <span className="chip bg-sky text-sky-deep">Program</span>
      <p className="font-extrabold mt-2">{p.name}</p>
      {/* The quote and the how-to text can hold a number to call or text: not offered while the plan is outdated. */}
      {proof && !off && <p className="text-sm italic text-ink/70 mt-1 border-l-4 border-sun pl-2">&ldquo;{p.evidence_quote}&rdquo;</p>}
      {off ? <ResourceLinksOff off={off} /> : <div className="mt-3 flex flex-wrap gap-2 text-sm font-bold">
        {p.access.phone && <a className="rounded-full bg-ink text-paper px-3 py-1.5" href={telHref(p.access.phone)}>Call {p.access.phone}</a>}
        {p.access.url && <a className="rounded-full border-2 border-ink px-3 py-1" href={p.access.url} target="_blank" rel="noreferrer">Open ↗</a>}
      </div>}
      {p.access.text && !off && <p className="text-sm mt-2">{p.access.text}</p>}
      {proof && <p className="mt-2 text-[11px] text-ink/70">Verified on the official page: <SourceLink href={p.source_url} label={host(p.source_url)} off={off} /></p>}
    </div>
  );
}

function BarrierChips({ barriers }: { barriers: Barrier[] }) {
  return <>{barriers.map((b) => <span key={b} className="chip bg-paper border border-ink/30 text-ink">{BARRIER_LABEL[b]}</span>)}</>;
}

/** A disclosure button: says what it opens, and whether it is open. */
function Toggle({ open, controls, onClick, children, disabled, describedBy }: { open: boolean; controls: string; onClick: () => void; children: ReactNode; disabled?: boolean; describedBy?: string }) {
  return (
    <button type="button" aria-expanded={open} aria-controls={controls} onClick={onClick} disabled={disabled} aria-describedby={describedBy}
      className="inline-flex items-center gap-1.5 rounded-full border-2 border-ink/60 bg-paper px-3 py-1.5 text-sm font-bold hover:bg-mint-soft disabled:opacity-40">
      {children}
      <span aria-hidden="true" className={`plan-chev inline-block transition-transform ${open ? "rotate-90" : ""}`}>›</span>
    </button>
  );
}

/** One of the top three: name, the problems it helps with, ONE big button, and what to say when they answer. */
function TopCard({ r, rank, chosen, language, off, offId, pip }: { r: RankedResource; rank: number; chosen: Barrier[]; language: string; off?: string; offId?: string; pip?: { text: string; calm: boolean } }) {
  const [say, setSay] = useState(false);
  const sayId = useId();
  const card = r.card;
  const name = resourceName(card);
  const action = primaryAction(card);
  const script = resourceScript(name, r.barriers, language);
  const open = card.type === "clinic" ? openNow(card.clinic) : null;
  return (
    <li className="grid content-start gap-2.5 rounded-[1.2rem] border-2 border-ink bg-paper p-4 shadow-[3px_4px_0_var(--ink)]" data-pip-here={pip ? "arrive" : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="flex flex-wrap gap-1.5">
            <span className={`chip ${card.type === "clinic" ? "bg-mint text-teal-deep" : "bg-sky text-sky-deep"}`}>{card.type === "clinic" ? "Health center" : "Program"}</span>
            <span className="chip border border-ink/40 bg-paper text-ink" data-by-atlas="">{BY_ATLAS}</span>
          </span>
          <h5 className="mt-1.5 text-lg font-extrabold leading-tight break-words">{name}</h5>
        </div>
        <span className="flex flex-none items-start gap-1">
          <span aria-hidden="true" className="display text-4xl text-teal">{rank}</span>
          {/* Pip's reserved spot on the first card's right edge (Akhil's "you are here"), never over the card's text. */}
          {pip && <PipSlot className="-mt-1"><PipMarker mood="arrive" calm={pip.calm} /></PipSlot>}
        </span>
      </div>
      {pip && <div className="-mt-1 flex justify-end"><PipBubble text={pip.text} /></div>}
      <p className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-ink/70">
        {helpsLine(r, chosen)} <BarrierChips barriers={r.barriers.filter((b) => chosen.includes(b))} />
      </p>
      {card.type === "clinic" && (
        <p className="text-sm font-semibold text-ink/80">
          {[card.km != null && `${card.km} km away`, open != null && (open ? "listed as open now" : "listed as closed now"), card.clinic.nearest_rail && `near ${card.clinic.nearest_rail.name}`].filter(Boolean).join(" · ")}
        </p>
      )}
      {card.type === "program" && card.program.access.text && !off && <p className="text-sm font-semibold">{card.program.access.text}</p>}
      {off
        ? <p className="text-sm font-bold text-peach-deep">{off}: calls and websites for this plan are off until then.</p>
        : action && (
          <a href={action.href} {...(action.external ? { target: "_blank", rel: "noreferrer" } : {})}
            className="block rounded-full bg-ink px-5 py-3 text-center text-base font-extrabold text-paper shadow-[0_3px_0_var(--teal)] hover:bg-teal-deep focus-visible:outline-3 focus-visible:outline-offset-2">
            {action.label}{action.external ? " ↗" : ""}
          </a>
        )}
      <div>
        <Toggle open={say && !off} controls={sayId} onClick={() => setSay((s) => !s)} disabled={!!off} describedBy={off ? offId : undefined}>What to say</Toggle>
        <div id={sayId} hidden={!say || !!off} className="mt-2 rounded-xl border-2 border-dashed border-ink/40 p-3 print:hidden">
          {language !== "English" && <p className="text-xs text-ink/70">In English, so the person who answers can follow it. A helper can read it for you.</p>}
          <ol className="mt-1 list-decimal space-y-1 pl-5 text-sm">{script.map((l, i) => <li key={i}>{l}</li>)}</ol>
        </div>
      </div>
      {card.type === "program"
        ? <VerifiedSeal url={card.program.source_url} off={off} />
        : <p className="text-[11px] font-semibold text-ink/70">Source: HRSA health center data. Fees adjust to your income.</p>}
    </li>
  );
}

/** `chosen`: the barriers the person picked in step 2, the only "problems" a top card counts. */
export function TopCalls({ top, chosen, language, off, offId }: { top: RankedResource[]; chosen: Barrier[]; language: string; off?: string; offId?: string }) {
  const { calm } = usePipCalm();
  // Pip marks the first place to start, with a fixed line in the person's language. Not while the plan is outdated:
  // its calls are off then, so Pip does not point at one.
  const pipText = top.length > 0 && !off ? pipLine(language, "start") : "";
  const [pipSaid, setPipSaid] = useState("");
  useEffect(() => {
    const t = setTimeout(() => setPipSaid(pipText), 300);
    return () => clearTimeout(t);
  }, [pipText]);
  if (top.length === 0) return null;
  return (
    <section aria-labelledby="plan-top-title" className="mt-6">
      <p role="status" aria-live="polite" className="sr-only" data-pip-status="">{pipSaid}</p>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 id="plan-top-title" className="display text-2xl">{top.length === 1 ? "Start here" : `Start with these ${top.length}`}</h4>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-xs font-bold text-ink/70">Ranked by how many of the problems you named each one helps with</p>
          <CalmToggle />
        </span>
      </div>
      {/* Who picked these: not the doctor. A caregiver could not tell (Oct 4 try). */}
      <p className="mt-1 max-w-3xl text-sm font-semibold text-ink/80" data-places-note="">{PLACES_NOTE}</p>
      <ol className="mt-3 grid gap-3 lg:grid-cols-3">
        {top.map((r, i) => <TopCard key={r.id} r={r} rank={i + 1} chosen={chosen} language={language} off={off} offId={offId}
          pip={i === 0 && pipText ? { text: pipText, calm } : undefined} />)}
      </ol>
    </section>
  );
}

/**
 * One plan step as a line to tick off. Tap it for the plain plan (with the paper's own words for the steps it serves,
 * never folded away from it), the best option, the other options, Book it now, and "Why this?".
 */
export function ProblemRow({ step, index, quotes, resources, done, onDone, off, bookIt }: {
  step: PlanStep; index: number; quotes: string[]; resources: Record<string, ResourceCard>; done: boolean;
  onDone: (on: boolean) => void; off?: string; bookIt?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const [why, setWhy] = useState(false);
  const base = useId();
  const ids = { body: `${base}-body`, more: `${base}-more`, why: `${base}-why` };
  const cards = [...new Set(step.resource_ids)].map((id) => resources[id]).filter(Boolean);
  const [best, ...others] = cards;
  const programs = cards.filter((c) => c.type === "program");
  const barrier = step.barrier && step.barrier in BARRIER_LABEL ? (step.barrier as Barrier) : null;
  const sub = cards.length ? `${cards.length} ${cards.length === 1 ? "option" : "options"}` : bookIt ? "Booking help inside" : "What to do";
  return (
    <li className={`rounded-2xl border-2 ${done ? "border-teal bg-mint-soft" : "border-ink/70 bg-paper"}`}>
      <div className="flex items-start gap-3 p-3 sm:p-4">
        <input type="checkbox" checked={done} onChange={(e) => onDone(e.target.checked)} aria-label={`Done: ${step.title}`}
          className="mt-1 h-6 w-6 shrink-0 accent-[var(--teal)]" />
        <h5 className="plan-rowhead min-w-0 flex-1">
          <button type="button" aria-expanded={open} aria-controls={ids.body} onClick={() => setOpen((o) => !o)}
            className="flex w-full items-start gap-2 text-left">
            <span className="min-w-0 flex-1">
              <span className="sr-only">Step {index + 1}: </span>
              <span className={`block font-extrabold leading-snug ${done ? "line-through decoration-2" : ""}`}>{step.title}</span>
              <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-bold text-ink/70">
                {barrier && <BarrierChips barriers={[barrier]} />}
                <span>{sub}</span>
                {done && <span className="text-teal-deep">· done</span>}
              </span>
            </span>
            <span aria-hidden="true" className={`plan-chev mt-0.5 inline-block text-xl font-extrabold text-ink/70 transition-transform ${open ? "rotate-90" : ""}`}>›</span>
          </button>
        </h5>
      </div>
      <div id={ids.body} className={`plan-fold ${open ? "" : "plan-shut"} border-t-2 border-ink/10 px-3 pb-4 pt-3 sm:px-4`}>
        <p className="text-[11px] font-extrabold uppercase tracking-wide text-ink/70" data-by-atlas="">{BY_ATLAS}</p>
        <p className="font-semibold">{step.action}</p>
        {/* The plan step is a suggestion, never certified: the paper's own words for its steps stay right next to it. */}
        {quotes.map((q, k) => (
          <p key={k} data-paper-quote="" className="mt-2 border-l-4 border-sun pl-2 text-sm font-semibold">📄 Your paper says: &ldquo;{q}&rdquo;</p>
        ))}
        {best && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-ink/70">Best option · {BY_ATLAS}</p>
            <Resource r={best} off={off} proof={false} />
          </div>
        )}
        {others.length > 0 && (
          <div className="mt-3">
            <Toggle open={more} controls={ids.more} onClick={() => setMore((m) => !m)}>
              {others.length} other {others.length === 1 ? "option" : "options"}
            </Toggle>
            <div id={ids.more} className={`plan-fold ${more ? "" : "plan-shut"} mt-3`}>
              <div className="grid gap-3 md:grid-cols-2">
                {others.map((r) => <Resource key={r.id} r={r} off={off} proof={false} />)}
              </div>
            </div>
          </div>
        )}
        {bookIt}
        <div className="mt-4">
          <Toggle open={why} controls={ids.why} onClick={() => setWhy((w) => !w)}>Why this?</Toggle>
          <div id={ids.why} className={`plan-fold ${why ? "" : "plan-shut"} mt-3 space-y-3`}>
            {step.why && <p className="text-sm text-ink/80">Why: {step.why}</p>}
            {programs.map((c) => c.type === "program" && (
              <div key={c.id} className="rounded-xl bg-mint-soft/70 p-3">
                <p className="text-sm font-extrabold">{c.program.name}</p>
                {/* Can hold a number to call or text: not shown while the plan is outdated. */}
                {!off && <p className="mt-1 border-l-4 border-sun pl-2 text-sm italic text-ink/75">&ldquo;{c.program.evidence_quote}&rdquo;</p>}
                <div className="mt-1.5"><VerifiedSeal url={c.program.source_url} off={off} /></div>
              </div>
            ))}
            {!step.why && programs.length === 0 && <p className="text-sm text-ink/70">This step comes from your paper and the problems you picked.</p>}
          </div>
        </div>
      </div>
    </li>
  );
}
