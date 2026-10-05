"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import type { PlanStep, ResourceCard } from "@/lib/plan";
import { BARRIER_LABEL, type Barrier, formatHours, openNow, opensEvenings, opensWeekends } from "@/lib/resources";
import { directionsHref, primaryAction, resourceName, telHref, type RankedResource } from "@/lib/planTop";
import { resourceScript } from "@/lib/booking";
import { pipLine } from "@/lib/pip";
import { CalmToggle, PipBubble, PipMarker, PipSlot, usePipCalm } from "./Pip";
import { keyFor } from "@/lib/uiText";
import { useUi, PaperWords } from "./UiLang";

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
  const { t } = useUi();
  return <p className="mt-3 text-sm font-bold text-peach-deep">{t("plan.linksOff", { reason: off })}</p>;
}

/** One seal for a program's proof: its official page, and (in "Why this?") the line quoted from it. */
export function VerifiedSeal({ url, off }: { url: string; off?: string }) {
  const { t } = useUi();
  return (
    <p className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-teal-deep">
      <span aria-hidden="true" className="grid h-5 w-5 place-items-center rounded-full bg-teal text-[11px] text-paper">✓</span>
      {t("plan.verifiedOn")} <SourceLink href={url} label={host(url)} off={off} />
    </p>
  );
}

/**
 * A program or health center card. `proof={false}` leaves out a program's quoted line and its source, which the plan
 * rows show once under "Why this?" instead. While the plan is outdated (`off`), no call, website or directions link.
 */
export function Resource({ r, off, proof = true }: { r: ResourceCard; off?: string; proof?: boolean }) {
  const { t } = useUi();
  if (r.type === "clinic") {
    const c = r.clinic;
    const hours = formatHours(c.hours);
    const open = openNow(c);
    return (
      <div className="rounded-2xl border-2 border-ink/80 bg-paper p-4" data-place-card="">
        <div className="flex flex-wrap items-center gap-2">
          <span className="chip bg-mint text-teal-deep">{t("plan.healthCenter")}</span>
          {/* On every place card, wherever it shows (best option, other options): who suggested it (Codex review). */}
          <span className="chip border border-ink/40 bg-paper text-ink" data-by-atlas="">{t("prov.byAtlas")}</span>
          {r.km != null && <span className="text-xs font-bold text-ink/70">{t("plan.kmAway", { km: r.km })}</span>}
          {open != null && <span className={`chip ${open ? "bg-teal text-paper" : "bg-paper border border-ink/30 text-ink/70"}`}>{t(open ? "plan.openNow" : "plan.closedNow")}</span>}
          {(opensEvenings(c) || opensWeekends(c)) && <span className="chip bg-sun text-ink">{[opensEvenings(c) && t("plan.evenings"), opensWeekends(c) && t("plan.weekends")].filter(Boolean).join(" + ")}</span>}
        </div>
        <p className="font-extrabold mt-2">{c.name}</p>
        <p className="text-sm font-semibold text-ink/75">{c.address}, {c.city} {c.zip}</p>
        <p className="text-sm font-semibold mt-1">{t("plan.feesAdjust")}</p>
        {c.nearest_rail && <p className="text-sm mt-1">🚆 {c.nearest_rail.name}, {t("plan.straightLine", { km: (c.nearest_rail.meters / 1000).toFixed(1) })}</p>}
        {c.nearest_bus && <p className="text-sm">🚌 {t("plan.busStop", { name: c.nearest_bus.name })}</p>}
        {hours && c.hours_source_id === "clinic-site" && (
          <>
            <p className="text-sm mt-1">🕘 {t("plan.hours", { hours })}</p>
            <p className="text-xs italic text-ink/70 mt-1 border-l-4 border-sun pl-2">&ldquo;<PaperWords>{c.hours_quote}</PaperWords>&rdquo;</p>
          </>
        )}
        {hours && c.hours_source_id !== "clinic-site" && <p className="text-sm mt-1">🕘 {t("plan.listedHours", { hours })} <span className="text-ink/70">{t("plan.callToConfirm")}</span></p>}
        {off ? <ResourceLinksOff off={off} /> : <div className="mt-3 flex flex-wrap gap-2 text-sm font-bold">
          {c.phone && <a className="rounded-full bg-ink text-paper px-3 py-1.5" href={telHref(c.phone)}>{t("plan.callPhone", { phone: c.phone })}</a>}
          {c.website && <a className="rounded-full border-2 border-ink px-3 py-1" href={c.website} target="_blank" rel="noreferrer">{t("plan.website")}</a>}
          <a className="rounded-full border-2 border-ink px-3 py-1" target="_blank" rel="noreferrer" href={directionsHref(c)}>{t("plan.directions")} ↗</a>
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
    <div className="rounded-2xl border-2 border-ink/80 bg-paper p-4" data-place-card="">
      <span className="flex flex-wrap gap-1.5">
        <span className="chip bg-sky text-sky-deep">{t("plan.program")}</span>
        <span className="chip border border-ink/40 bg-paper text-ink" data-by-atlas="">{t("prov.byAtlas")}</span>
      </span>
      <p className="font-extrabold mt-2">{p.name}</p>
      {/* The quote and the how-to text can hold a number to call or text: not offered while the plan is outdated. */}
      {proof && !off && <p className="text-sm italic text-ink/70 mt-1 border-l-4 border-sun pl-2">&ldquo;<PaperWords>{p.evidence_quote}</PaperWords>&rdquo;</p>}
      {off ? <ResourceLinksOff off={off} /> : <div className="mt-3 flex flex-wrap gap-2 text-sm font-bold">
        {p.access.phone && <a className="rounded-full bg-ink text-paper px-3 py-1.5" href={telHref(p.access.phone)}>{t("plan.callPhone", { phone: p.access.phone })}</a>}
        {p.access.url && <a className="rounded-full border-2 border-ink px-3 py-1" href={p.access.url} target="_blank" rel="noreferrer">{t("plan.open")}</a>}
      </div>}
      {p.access.text && !off && <p className="text-sm mt-2">{p.access.text}</p>}
      {proof && <p className="mt-2 text-[11px] text-ink/70">{t("plan.verifiedOn")} <SourceLink href={p.source_url} label={host(p.source_url)} off={off} /></p>}
    </div>
  );
}

function BarrierChips({ barriers }: { barriers: Barrier[] }) {
  const { t } = useUi();
  return <>{barriers.map((b) => <span key={b} className="chip bg-paper border border-ink/30 text-ink">{t(keyFor("barrier", b, "needs.group"))}</span>)}</>;
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
  const { t, tn } = useUi();
  // helpsLine (lib/planTop.ts) in the person's language: the same counts, the same rule.
  const named = [...new Set(chosen)].filter((b) => b in BARRIER_LABEL);
  const hits = r.barriers.filter((b) => named.includes(b)).length;
  const helps = named.length > 0 && hits > 0
    ? (named.length === 1 ? t("plan.helpsOne") : tn("helpsWith", named.length, { n: hits, m: named.length }))
    : tn("partOfSteps", r.steps.length);
  // primaryAction (lib/planTop.ts) decides the button; only its words are translated.
  const actionLabel = !action ? "" : action.label.startsWith("Call ") ? t("plan.callPhone", { phone: action.label.slice(5) })
    : action.label === "Apply online" ? t("plan.applyOnline") : action.label === "Open their website" ? t("plan.openSite") : t("plan.directions");
  return (
    <li className="grid content-start gap-2.5 rounded-[1.2rem] border-2 border-ink bg-paper p-4 shadow-[3px_4px_0_var(--ink)]" data-place-card="" data-pip-here={pip ? "arrive" : undefined}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <span className="flex flex-wrap gap-1.5">
            <span className={`chip ${card.type === "clinic" ? "bg-mint text-teal-deep" : "bg-sky text-sky-deep"}`}>{t(card.type === "clinic" ? "plan.healthCenter" : "plan.program")}</span>
            <span className="chip border border-ink/40 bg-paper text-ink" data-by-atlas="">{t("prov.byAtlas")}</span>
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
        {helps} <BarrierChips barriers={r.barriers.filter((b) => chosen.includes(b))} />
      </p>
      {card.type === "clinic" && (
        <p className="text-sm font-semibold text-ink/80">
          {[card.km != null && t("plan.kmAway", { km: card.km }), open != null && t(open ? "plan.openNow" : "plan.closedNow"), card.clinic.nearest_rail && t("plan.near", { name: card.clinic.nearest_rail.name })].filter(Boolean).join(" · ")}
        </p>
      )}
      {card.type === "program" && card.program.access.text && !off && <p className="text-sm font-semibold">{card.program.access.text}</p>}
      {off
        ? <p className="text-sm font-bold text-peach-deep">{t("plan.callsOff", { reason: off })}</p>
        : action && (
          <a href={action.href} {...(action.external ? { target: "_blank", rel: "noreferrer" } : {})}
            className="block rounded-full bg-ink px-5 py-3 text-center text-base font-extrabold text-paper shadow-[0_3px_0_var(--teal)] hover:bg-teal-deep focus-visible:outline-3 focus-visible:outline-offset-2">
            {actionLabel}{action.external ? " ↗" : ""}
          </a>
        )}
      <div>
        <Toggle open={say && !off} controls={sayId} onClick={() => setSay((s) => !s)} disabled={!!off} describedBy={off ? offId : undefined}>{t("plan.whatToSay")}</Toggle>
        <div id={sayId} hidden={!say || !!off} className="mt-2 rounded-xl border-2 border-dashed border-ink/40 p-3 print:hidden">
          {language !== "English" && <p className="text-xs text-ink/70">{t("common.inEnglishForThem")}</p>}
          <ol lang="en" className="mt-1 list-decimal space-y-1 pl-5 text-sm">{script.map((l, i) => <li key={i}>{l}</li>)}</ol>
        </div>
      </div>
      {card.type === "program"
        ? <VerifiedSeal url={card.program.source_url} off={off} />
        : <p className="text-[11px] font-semibold text-ink/70">{t("plan.sourceHrsa")}</p>}
    </li>
  );
}

/** `chosen`: the barriers the person picked in step 2, the only "problems" a top card counts. */
export function TopCalls({ top, chosen, language, off, offId }: { top: RankedResource[]; chosen: Barrier[]; language: string; off?: string; offId?: string }) {
  const { calm } = usePipCalm();
  const { t, ts } = useUi();
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
        <h4 id="plan-top-title" className="display text-2xl">{top.length === 1 ? t("plan.startHere") : t("plan.startWith", { n: top.length })}</h4>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <p className="text-xs font-bold text-ink/70">{t("plan.rankedBy")}</p>
          <CalmToggle />
        </span>
      </div>
      {/* Who picked these: ATLAS. A caregiver could not tell (Oct 4 try). */}
      <p className="mt-1 max-w-3xl text-sm font-semibold text-ink/80" data-places-note="">{ts("prov.placesNote")}</p>
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
  const { t, tn } = useUi();
  const sub = cards.length ? tn("options", cards.length) : bookIt ? t("plan.bookingInside") : t("plan.whatToDo");
  return (
    <li className={`rounded-2xl border-2 ${done ? "border-teal bg-mint-soft" : "border-ink/70 bg-paper"}`}>
      <div className="flex items-start gap-3 p-3 sm:p-4">
        <input type="checkbox" checked={done} onChange={(e) => onDone(e.target.checked)} aria-label={t("plan.doneLabel", { title: step.title })}
          className="mt-1 h-6 w-6 shrink-0 accent-[var(--teal)]" />
        <h5 className="plan-rowhead min-w-0 flex-1">
          <button type="button" aria-expanded={open} aria-controls={ids.body} onClick={() => setOpen((o) => !o)}
            className="flex w-full items-start gap-2 text-left">
            <span className="min-w-0 flex-1">
              <span className="sr-only">{t("plan.stepN", { n: index + 1 })}</span>
              <span className={`block font-extrabold leading-snug ${done ? "line-through decoration-2" : ""}`}>{step.title}</span>
              <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs font-bold text-ink/70">
                {barrier && <BarrierChips barriers={[barrier]} />}
                <span>{sub}</span>
                {done && <span className="text-teal-deep">{t("plan.done")}</span>}
              </span>
            </span>
            <span aria-hidden="true" className={`plan-chev mt-0.5 inline-block text-xl font-extrabold text-ink/70 transition-transform ${open ? "rotate-90" : ""}`}>›</span>
          </button>
        </h5>
      </div>
      <div id={ids.body} className={`plan-fold ${open ? "" : "plan-shut"} border-t-2 border-ink/10 px-3 pb-4 pt-3 sm:px-4`}>
        <p className="text-[11px] font-extrabold uppercase tracking-wide text-ink/70" data-by-atlas="">{t("prov.byAtlas")}</p>
        <p className="font-semibold">{step.action}</p>
        {/* The plan step is a suggestion, never certified: the paper's own words for its steps stay right next to it. */}
        {quotes.map((q, k) => (
          <p key={k} data-paper-quote="" className="mt-2 border-l-4 border-sun pl-2 text-sm font-semibold">📄 {t("pf.says.paper")} &ldquo;<PaperWords>{q}</PaperWords>&rdquo;</p>
        ))}
        {best && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-extrabold uppercase tracking-wide text-ink/70">{t("plan.bestOption")}</p>
            <Resource r={best} off={off} proof={false} />
          </div>
        )}
        {others.length > 0 && (
          <div className="mt-3">
            <Toggle open={more} controls={ids.more} onClick={() => setMore((m) => !m)}>
              {tn("otherOptions", others.length)}
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
          <Toggle open={why} controls={ids.why} onClick={() => setWhy((w) => !w)}>{t("plan.whyThis")}</Toggle>
          <div id={ids.why} className={`plan-fold ${why ? "" : "plan-shut"} mt-3 space-y-3`}>
            {step.why && <p className="text-sm text-ink/80">{t("plan.why", { why: step.why })}</p>}
            {programs.map((c) => c.type === "program" && (
              <div key={c.id} className="rounded-xl bg-mint-soft/70 p-3" data-place-card="">
                <p className="flex flex-wrap items-center gap-1.5 text-sm font-extrabold">{c.program.name}
                  <span className="chip border border-ink/40 bg-paper text-ink" data-by-atlas="">{t("prov.byAtlas")}</span></p>
                {/* Can hold a number to call or text: not shown while the plan is outdated. */}
                {!off && <p className="mt-1 border-l-4 border-sun pl-2 text-sm italic text-ink/75">&ldquo;<PaperWords>{c.program.evidence_quote}</PaperWords>&rdquo;</p>}
                <div className="mt-1.5"><VerifiedSeal url={c.program.source_url} off={off} /></div>
              </div>
            ))}
            {!step.why && programs.length === 0 && <p className="text-sm text-ink/70">{t("plan.fromPaperAndProblems")}</p>}
          </div>
        </div>
      </div>
    </li>
  );
}
