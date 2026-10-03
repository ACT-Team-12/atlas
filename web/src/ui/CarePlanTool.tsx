"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CarePlanResponse, VerifiedItem } from "@/lib/schema";
import { LANGUAGES, READING_LEVELS } from "@/lib/schema";
import { WorkingCard } from "./WorkingCard";
import { SAMPLE_AVS, SAMPLE_LABEL } from "@/lib/sample";
import { BARRIERS, BARRIER_LABEL, type Barrier, formatHours, openNow, opensEvenings, opensWeekends } from "@/lib/resources";
import type { PlanResponse, ResourceCard } from "@/lib/plan";
import type { MeaningResponse, MeaningResult } from "@/lib/meaning";
import { SquashButton } from "./SquashButton";
import { Feedback } from "./Feedback";
import { Understand } from "./Understand";
import { HandoffSheet } from "./HandoffSheet";
import { ShareFamily } from "./ShareFamily";
import { BookIt } from "./BookIt";
import { bookableItem } from "@/lib/booking";
import { readExtractEvents, StreamBroken, StreamFailed } from "@/lib/extractEvents";
import { restoredTab, scrollTargetAfter, shownTab, type Tab } from "@/lib/phoneTabs";
import { canMakeSimpler, isTranscriptEdited } from "@/lib/simpler";
import { isPhoneNow, panelId, PhoneTabBar, scrollElementToTop, scrollTargetY, scrollToPanel, tabId, useIsPhone, type PageScroll } from "./PhoneTabs";
import { speechLines } from "@/lib/speechText";
import {
  closePlan, deletePlan, emptyStore, listPlans, loadStore, OLD_KEY, openPlan, readStartsNewPlan, renamePlan, saveSession,
  STORE_KEY, type Session, type Store,
} from "@/lib/savedPlans";
import { SavedPlans } from "./SavedPlans";
import {
  anchorHolds, isEditable, OWN_INSTANT_SCROLL_MS, OWN_SCROLL_MS, ownScrollEndedByPerson, photoId, planFingerprint, planPlace, readFingerprint, rebaseOwnScroll,
  scrollIsPersons, shouldAutoScroll, type OwnScroll,
} from "@/lib/staleGuard";
import { SPEECH_LANG } from "@/lib/speechLang";

const KIND: Record<string, { label: string; cls: string }> = {
  medication: { label: "Medicine", cls: "bg-sky text-sky-deep" },
  lab_test: { label: "Lab test", cls: "bg-lilac text-ink" },
  referral: { label: "Referral", cls: "bg-peach text-peach-deep" },
  follow_up_visit: { label: "Next visit", cls: "bg-mint text-teal-deep" },
  self_care: { label: "Daily care", cls: "bg-mint-soft text-teal-deep" },
  warning_sign: { label: "Warning sign", cls: "bg-red-soft text-red" },
};

type DeviceVerdict = "match" | "differ" | "missing";

/** Id for a saved plan. randomUUID needs a secure page; the fallback is fine for a local key. */
function newPlanId() {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** Same limit as /api/speak (lib/voice.ts, server only). A longer plan is read by the phone's voice. */
const MAX_SPEAK_CHARS = 4000;

async function fileToBase64(file: File) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.85).split(",")[1];
}

async function postExtract(body: Record<string, unknown>, signal?: AbortSignal): Promise<CarePlanResponse> {
  const res = await fetch("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
  return json;
}

/**
 * Reads a pasted paper over the streaming route. Throws StreamBroken when the caller should retry
 * with the plain route (connection cut, route missing, server error), or a plain Error to show.
 */
async function streamExtract(body: Record<string, unknown>, onItem: (it: VerifiedItem) => void, signal?: AbortSignal): Promise<CarePlanResponse> {
  let res: Response;
  try {
    res = await fetch("/api/extract/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (signal?.aborted) throw e; // stopped on purpose: do not retry on the plain route
    throw new StreamBroken("Network error");
  }
  if (!res.ok || !res.body) {
    // 404: an older deploy without this route. 5xx: worth one try on the plain route. 503 means no AI key, so retrying won't help.
    if (!res.body || res.status === 404 || (res.status >= 500 && res.status !== 503)) throw new StreamBroken(`HTTP ${res.status}`);
    const json = await res.json().catch(() => ({}));
    throw new Error(json.error ?? "Something went wrong.");
  }
  try {
    return await readExtractEvents(res.body, onItem);
  } catch (e) {
    if (e instanceof StreamFailed && (e.status < 500 || e.status === 503)) throw new Error(e.message);
    if (e instanceof StreamFailed) throw new StreamBroken(e.message);
    throw e;
  }
}

/** Steps shown while the paper is still being read. Not final: no checkboxes, nothing saved, nothing built on them. */
function StreamingSteps({ items }: { items: VerifiedItem[] }) {
  return (
    <div className="mt-8" aria-busy="true">
      <p className="display text-2xl">Still reading your paper<span className="working-dots" aria-hidden="true" /></p>
      <p className="text-sm font-bold text-ink/70 mt-1">
        {items.length} {items.length === 1 ? "step" : "steps"} found so far. We found each one&apos;s words in your paper. More may come.
      </p>
      <ul className="mt-4 space-y-3">
        {items.map((it) => (
          <li key={it.id} className={`step-in rounded-2xl border-2 p-4 ${it.kind === "warning_sign" ? "border-red bg-red-soft/50" : "border-ink/70 bg-paper"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`chip ${KIND[it.kind]?.cls}`}>{KIND[it.kind]?.label}</span>
              <span className="font-extrabold">{it.title}</span>
              {it.when && <span className="text-xs font-bold text-ink/70">· {it.when}</span>}
            </div>
            <p className="mt-1">{it.plain_language}</p>
            <p className="mt-2 border-l-4 border-sun pl-2 text-xs italic text-ink/70">From your paper: &ldquo;{it.source_quote}&rdquo;</p>
          </li>
        ))}
      </ul>
    </div>
  );
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
      {note && <span className="hand text-2xl text-ink/70 -rotate-1">{note}</span>}
    </div>
  );
}

function Resource({ r }: { r: ResourceCard }) {
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
        <div className="mt-3 flex flex-wrap gap-2 text-sm font-bold">
          {c.phone && <a className="rounded-full bg-ink text-paper px-3 py-1.5" href={`tel:${c.phone.replace(/[^\d]/g, "")}`}>Call {c.phone}</a>}
          {c.website && <a className="rounded-full border-2 border-ink px-3 py-1" href={c.website} target="_blank" rel="noreferrer">Website ↗</a>}
          <a className="rounded-full border-2 border-ink px-3 py-1" target="_blank" rel="noreferrer"
            href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(c.city.includes(",") ? `${c.address}, ${c.city} ${c.zip}` : `${c.address}, ${c.city}, GA ${c.zip}`)}&travelmode=transit`}>Transit directions ↗</a>
        </div>
        <p className="mt-2 text-[11px] text-ink/70">
          Source: HRSA health center data{c.source_id === "hrsa-national" ? " (nationwide list, Oct 2)" : ""}
          {hours && c.hours_source_id === "clinic-site" && c.hours_url
            ? <> · hours quoted from <a className="underline" href={c.hours_url} target="_blank" rel="noreferrer">{new URL(c.hours_url).hostname.replace(/^www\./, "")}</a>, checked Oct 2</>
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
      <p className="text-sm italic text-ink/70 mt-1 border-l-4 border-sun pl-2">&ldquo;{p.evidence_quote}&rdquo;</p>
      <div className="mt-3 flex flex-wrap gap-2 text-sm font-bold">
        {p.access.phone && <a className="rounded-full bg-ink text-paper px-3 py-1.5" href={`tel:${p.access.phone.replace(/[^\d]/g, "")}`}>Call {p.access.phone}</a>}
        {p.access.url && <a className="rounded-full border-2 border-ink px-3 py-1" href={p.access.url} target="_blank" rel="noreferrer">Open ↗</a>}
      </div>
      {p.access.text && <p className="text-sm mt-2">{p.access.text}</p>}
      <p className="mt-2 text-[11px] text-ink/70">Verified on the official page: <a className="underline" href={p.source_url} target="_blank" rel="noreferrer">{new URL(p.source_url).hostname}</a></p>
    </div>
  );
}

export function CarePlanTool() {
  const [text, setTextState] = useState("");
  const [photo, setPhotoState] = useState<File | null>(null);
  const [language, setLanguageState] = useState<(typeof LANGUAGES)[number]>("English");
  const [level, setLevelState] = useState<(typeof READING_LEVELS)[number]>("simple");
  // The level the steps on screen were read at (the select can change after a read).
  const [readLevel, setReadLevel] = useState<(typeof READING_LEVELS)[number] | null>(null);
  const [reading, setReading] = useState(false);
  // Verified steps that arrived while the paper is still being read. Shown, never final.
  const [partial, setPartial] = useState<VerifiedItem[]>([]);
  const readRun = useRef(0);
  // Plan requests in flight. A new read or a clear bumps it, so an older plan reply cannot land on newer steps.
  const planRun = useRef(0);
  // What each pending read or plan was sent with, so a reply for inputs the person has since changed is dropped.
  const pendingRead = useRef<{ run: number; fp: string; at: number; abort: AbortController } | null>(null);
  const pendingPlan = useRef<{ run: number; fp: string; at: number; abort: AbortController } | null>(null);
  const lastInteraction = useRef(0);
  // The page's own automatic scroll in progress (where it is headed), and when the page last changed size.
  // Scrolls along that path, or caused by a size change, are not the person and do not cancel an automatic scroll.
  const ownScroll = useRef<OwnScroll | null>(null);
  const ownScrollEl = useRef<HTMLElement | null>(null);
  // Device location requests: a generation so only the latest answer counts, and whether one is out.
  const locGen = useRef(0);
  const [locating, setLocating] = useState(false);
  const layoutChangedAt = useRef(-Infinity);
  const [readNote, setReadNote] = useState<string | null>(null);
  const [planNote, setPlanNote] = useState<string | null>(null);
  const [planReadyNote, setPlanReadyNote] = useState<string | null>(null);
  const [care, setCareState] = useState<CarePlanResponse | null>(null);
  const [barriers, setBarriersState] = useState<Barrier[]>([]);
  const [zip, setZipState] = useState("");
  const [loc, setLocState] = useState<{ lat: number; lng: number } | null>(null);
  const [note, setNoteState] = useState("");
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [active, setActive] = useState<string | null>(null);
  const [removed, setRemovedState] = useState<Record<string, boolean>>({});
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  // What the reading and the plan on screen were made from. If the inputs move on, the result is labelled
  // outdated (still shown) and not saved again until it is redone or the inputs come back.
  const [careFp, setCareFp] = useState<string | null>(null);
  const [planFp, setPlanFp] = useState<string | null>(null);
  // The inputs a read or plan is built from, written the moment they change (before React re-renders).
  // A reply is checked against these when it lands, so a change whose render or effect has not run yet still counts.
  const live = useRef({ text, photo, language, level, care, removed, barriers, zip, loc, note });
  const setText = (v: string) => { live.current.text = v; setTextState(v); };
  const setPhoto = (v: File | null) => { live.current.photo = v; setPhotoState(v); };
  const setLanguage = (v: (typeof LANGUAGES)[number]) => { live.current.language = v; setLanguageState(v); };
  const setLevel = (v: (typeof READING_LEVELS)[number]) => { live.current.level = v; setLevelState(v); };
  const setCare = (v: CarePlanResponse | null) => { live.current.care = v; setCareState(v); };
  const setZip = (v: string) => { live.current.zip = v; setZipState(v); };
  const setLoc = (v: { lat: number; lng: number } | null) => { live.current.loc = v; setLocState(v); };
  const setNote = (v: string) => { live.current.note = v; setNoteState(v); };
  const setBarriers = (v: Barrier[] | ((b: Barrier[]) => Barrier[])) => {
    const next = typeof v === "function" ? v(live.current.barriers) : v;
    live.current.barriers = next; setBarriersState(next);
  };
  const setRemoved = (v: Record<string, boolean> | ((r: Record<string, boolean>) => Record<string, boolean>)) => {
    const next = typeof v === "function" ? v(live.current.removed) : v;
    live.current.removed = next; setRemovedState(next);
  };
  const liveReadFp = () => {
    const l = live.current;
    return readFingerprint({ text: l.photo ? null : l.text, photo: photoId(l.photo), language: l.language, level: l.level });
  };
  const livePlanFp = () => {
    const l = live.current;
    const careIds = (l.care?.items ?? []).filter((i) => !l.removed[i.id]).map((i) => i.id);
    return planFingerprint({ careIds, barriers: l.barriers, language: l.language, note: l.note, place: planPlace(!!l.loc, l.zip), location: l.loc });
  };
  // Photo reads: the quote check runs against the AI's own reading of the photo, so the person checks that reading first.
  const [transcript, setTranscript] = useState<string | null>(null);
  const [photoChecked, setPhotoChecked] = useState(false);
  // Second-model meaning check: does each explanation say the same thing as its quoted line?
  const [meaning, setMeaning] = useState<{ status: "idle" | "loading" | "done" | "error"; byId: Record<string, MeaningResult> }>({ status: "idle", byId: {} });
  const meaningFor = useRef("");
  // The same quote checker, run again on this device (WebAssembly, loaded only after a read). Per step: did the
  // browser find the same words in the same place as the server?
  // Stored with the reading it belongs to, so a newer read never shows an older result.
  const [deviceRun, setDeviceRun] = useState<{ for: CarePlanResponse | null; ok: boolean; byId: Record<string, DeviceVerdict> }>({ for: null, ok: false, byId: {} });
  const loaded = useRef(false);
  const [speaking, setSpeaking] = useState(false);
  const speechRun = useRef(0);
  const speechAudio = useRef<HTMLAudioElement | null>(null);
  const speechUrl = useRef<string | null>(null);
  const speechAbort = useRef<AbortController | null>(null);
  const speechLinesRef = useRef<string[]>([]);
  const [voiceNote, setVoiceNote] = useState("");
  // Phones only: which step card is showing. Desktop shows all three and ignores this.
  const [tab, setTab] = useState<Tab>(1);
  const isPhone = useIsPhone();
  // A scroll to run after the next render, once the newly shown card is on the page.
  // `submittedAt` marks an automatic scroll: it is checked again right before scrolling, and skipped if the
  // person has used the page since they pressed the button. A tab they picked themselves has none.
  const scrollAfter = useRef<{ t: Tab; onlyIfHidden: boolean; anchor?: boolean; submittedAt?: number } | null>(null);
  // A plan that just arrived: once it is on the page, decide (then, not when the reply landed) whether to open and scroll to it.
  const planNav = useRef<{ plan: PlanResponse; submittedAt: number } | null>(null);
  // The card an automatic scroll brought up, kept in place briefly while late content above it loads.
  const scrollAnchor = useRef<{ t: Tab; at: number } | null>(null);
  const [tapToPlay, setTapToPlay] = useState(false);

  // "My saved plans": saved on this device only (localStorage). Nothing is stored on our side; location is never saved.
  const [store, setStore] = useState<Store>(emptyStore);
  const storeRef = useRef<Store>(emptyStore());
  const [saveFailed, setSaveFailed] = useState(false);

  function writeStore(next: Store) {
    if (next === storeRef.current) return;
    storeRef.current = next;
    setStore(next);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(next)); setSaveFailed(false); } catch { setSaveFailed(true); }
  }

  /** Puts a saved plan into the tool. Anything still running belongs to the plan being left, so it is dropped. */
  function applySession(v: Session) {
    pendingRead.current?.abort.abort(); pendingPlan.current?.abort.abort(); pendingRead.current = null; pendingPlan.current = null;
    readRun.current++; planRun.current++; setReading(false); setPlanning(false); stopSpeaking();
    meaningFor.current = ""; setMeaning({ status: "idle", byId: {} });
    setError(null); setPartial([]); setTranscript(null); setPhoto(null); setLoc(null); locGen.current++; setLocating(false);
    setText(v.text); setLanguage(v.language); setLevel(v.level);
    setCare(v.care); setReadLevel(v.care ? v.level : null); setBarriers(v.barriers); setZip(v.zip); setNote(v.note);
    setPlan(v.plan); setDone(v.done); setRemoved(v.removed); setPhotoChecked(v.photoChecked ?? false);
    // Saved plans are only written while their results match their inputs, so what comes back is current,
    // except a plan built from the device location: the position is never saved, so nothing on this page can
    // match it ("device" with no coordinates). It comes back outdated until a fresh position or a ZIP is given.
    setCareFp(v.care ? readFingerprint({ text: v.text, photo: null, language: v.language, level: v.level }) : null);
    const fromDevice = v.plan?.located.by === "device";
    setPlanFp(v.plan ? planFingerprint({
      careIds: (v.care?.items ?? []).filter((i) => !v.removed[i.id]).map((i) => i.id),
      barriers: v.barriers, language: v.language, note: v.note, place: fromDevice ? "device" : planPlace(false, v.zip), location: null,
    }) : null);
    setTab(restoredTab({ hasCare: !!v.care, hasPlan: !!v.plan }));
  }

  /** Empties the tool for a new plan. Saved plans stay as they are. */
  function resetTool() {
    pendingRead.current?.abort.abort(); pendingPlan.current?.abort.abort(); pendingRead.current = null; pendingPlan.current = null;
    setReadNote(null); setPlanNote(null); setPlanReadyNote(null);
    readRun.current++; planRun.current++; setReading(false); setPlanning(false); stopSpeaking();
    meaningFor.current = ""; setMeaning({ status: "idle", byId: {} });
    setError(null); setPartial([]); setTranscript(null); setPhoto(null); setPhotoChecked(false); setReadLevel(null);
    setText(""); setCare(null); setPlan(null); setBarriers([]); setZip(""); setNote(""); setDone({}); setRemoved({}); setRestoredAt(null); setLoc(null); locGen.current++; setLocating(false);
    setCareFp(null); setPlanFp(null);
    setTab(1);
  }

  // One-time load after hydration (localStorage does not exist during the server render).
  // The old single saved session moves into the list once, then its key is removed.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let raw: string | null = null, old: string | null = null;
    try { raw = localStorage.getItem(STORE_KEY); old = localStorage.getItem(OLD_KEY); } catch {}
    const { store: s, migrated } = loadStore(raw, old, newPlanId());
    storeRef.current = s; setStore(s);
    if (migrated) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); localStorage.removeItem(OLD_KEY); } catch {} }
    const open = s.plans.find((p) => p.id === s.active);
    if (open) { applySession(open); setRestoredAt(open.savedAt); }
    loaded.current = true;
    // Runs once on mount by design: applySession only calls setters and refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Is the reading (or the plan) on screen still the one these inputs would get? A plan built from an outdated reading is outdated too.
  const careOutdated = !!care && careFp !== null && readFingerprint({ text: photo ? null : text, photo: photoId(photo), language, level }) !== careFp;
  const planOutdated = !!plan && planFp !== null && (careOutdated || planFingerprint({
    careIds: (care?.items ?? []).filter((i) => !removed[i.id]).map((i) => i.id),
    barriers, language, note, place: planPlace(!!loc, zip), location: loc,
  }) !== planFp);
  const resultsCurrent = !careOutdated && !planOutdated;
  const actionsOffReason = careOutdated ? "Read your paper again first" : "Update the plan first";
  // A plan made near the device's position, with no position or ZIP now: it needs a place before it can be updated.
  const needsPlace = !!plan && plan.located.by === "device" && !loc && !/^\d{5}$/.test(zip);

  // Every change to the open plan is saved into it; the first read or plan of a new one creates it.
  // While a result on screen is outdated, nothing is saved, so a saved plan never sits beside answers it was not built for.
  useEffect(() => {
    if (!loaded.current) return;
    if (!care && !plan) return;
    if (!resultsCurrent) return;
    writeStore(saveSession(storeRef.current, { text, language, level, care, barriers, zip, note, plan, done, removed, photoChecked }, new Date().toISOString(), newPlanId()));
  }, [text, language, level, care, barriers, zip, note, plan, done, removed, photoChecked, resultsCurrent]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /** "Clear it from this device": deletes the open plan. Other saved plans stay. */
  function clearSaved() {
    if (storeRef.current.active) writeStore(deletePlan(storeRef.current, storeRef.current.active));
    resetTool();
  }

  function openSaved(id: string) {
    const p = storeRef.current.plans.find((x) => x.id === id);
    if (!p) return;
    writeStore(openPlan(storeRef.current, id));
    applySession(p);
    setRestoredAt(p.savedAt);
  }

  function deleteSaved(id: string) {
    const wasOpen = storeRef.current.active === id;
    writeStore(deletePlan(storeRef.current, id));
    if (wasOpen) resetTool();
  }

  function newPlan() {
    writeStore(closePlan(storeRef.current));
    resetTool();
  }

  async function checkMeaningFor(c: CarePlanResponse) {
    const key = `${c.source_text.length}:${c.items.length}:${c.stats.ms}`;
    meaningFor.current = key;
    if (c.items.length === 0) return setMeaning({ status: "idle", byId: {} });
    setMeaning({ status: "loading", byId: {} });
    try {
      const res = await fetch("/api/meaning", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: c.items.slice(0, 40).map(({ id, plain_language, when, source_quote }) => ({ id, plain_language, when, source_quote })) }),
      });
      const json: MeaningResponse = await res.json();
      if (meaningFor.current !== key) return; // a newer paper was read meanwhile
      if (!res.ok) throw new Error();
      setMeaning({ status: "done", byId: Object.fromEntries(json.results.map((r) => [r.id, r])) });
    } catch {
      if (meaningFor.current === key) setMeaning({ status: "error", byId: {} });
    }
  }

  async function readPaper(corrected?: string, levelOverride?: (typeof READING_LEVELS)[number]) {
    const usedLevel = levelOverride ?? level;
    // Reading someone else's paper while a saved plan is open starts a new plan instead of overwriting it.
    const openSavedPlan = storeRef.current.plans.find((p) => p.id === storeRef.current.active);
    const fresh = corrected === undefined;
    if (readStartsNewPlan({ openPlanHasPaper: !!openSavedPlan?.care, fresh, isPhoto: fresh && !!photo, sameText: openSavedPlan?.text === text })) writeStore(closePlan(storeRef.current));
    meaningFor.current = ""; setMeaning({ status: "idle", byId: {} });
    setReading(true); setError(null); setCare(null); setPlan(null); setDone({}); setRemoved({}); setRestoredAt(null);
    setTranscript(null); setPhotoChecked(false); setPartial([]); setTab(1);
    if (corrected !== undefined) { setPhoto(null); setText(corrected); }
    const run = ++readRun.current;
    planRun.current++; setPlanning(false); // drop any plan still on its way: it was built from the old steps
    pendingPlan.current?.abort.abort(); pendingPlan.current = null;
    pendingRead.current?.abort.abort();
    setReadNote(null); setPlanNote(null); setPlanReadyNote(null);
    const usePhoto = corrected === undefined && !!photo;
    const abort = new AbortController();
    pendingRead.current = {
      run, abort, at: performance.now(),
      fp: readFingerprint({ text: usePhoto ? null : (corrected ?? text), photo: usePhoto ? photoId(photo) : null, language, level: usedLevel }),
    };
    try {
      const body: Record<string, unknown> = { language, reading_level: usedLevel };
      if (corrected !== undefined) body.text = corrected;
      else if (photo) { body.image_base64 = await fileToBase64(photo); body.image_media_type = "image/jpeg"; } else body.text = text;
      let json: CarePlanResponse;
      if (typeof body.text === "string") {
        // Pasted text: show each verified step as it arrives. Photos keep the plain route (the person checks our reading first).
        try {
          json = await streamExtract(body, (it) => { if (readRun.current === run && pendingRead.current?.fp === liveReadFp()) setPartial((p) => [...p, it]); }, abort.signal);
        } catch (e) {
          if (!(e instanceof StreamBroken) || readRun.current !== run) throw e;
          // The stream broke part way: drop what we showed and read it again the plain way.
          setPartial([]);
          json = await postExtract(body, abort.signal);
        }
      } else json = await postExtract(body, abort.signal);
      if (readRun.current !== run) return;
      const sent = pendingRead.current;
      if (!sent || sent.run !== run) return;
      if (sent.fp !== liveReadFp()) return stopStaleRead(); // changed after sending; the change's effect may not have run yet
      pendingRead.current = null;
      setPartial([]);
      setCare(json);
      setCareFp(sent.fp);
      setReadLevel(usedLevel);
      if (json.source_kind === "image") { setTranscript(json.source_text); return; }
      void checkMeaningFor(json);
      // Scroll after the steps render (scrolling now would aim at where step 2 was before they appeared),
      // and only if the person has not scrolled, tapped or typed since pressing the button.
      const target = scrollTargetAfter("read", isPhoneNow());
      if (target && autoScrollOk(sent.at)) scrollAfter.current = { t: target, onlyIfHidden: false, anchor: true, submittedAt: sent.at };
    } catch (e) {
      if (readRun.current !== run) return; // stopped or replaced: nothing to show
      if (pendingRead.current?.run === run && pendingRead.current.fp !== liveReadFp()) return stopStaleRead();
      pendingRead.current = null;
      setPartial([]); setError(e instanceof Error ? e.message : "Something went wrong.");
    }
    finally { if (readRun.current === run) setReading(false); }
  }

  // A pending read or plan whose inputs changed is stopped, its late reply ignored, and a short note says why.
  function stopStaleRead() {
    readRun.current++; pendingRead.current?.abort.abort(); pendingRead.current = null;
    setReading(false); setPartial([]);
    setReadNote("You changed your paper or settings, so we stopped reading. Press Read my paper again when ready.");
  }

  function stopStalePlan() {
    planRun.current++; pendingPlan.current?.abort.abort(); pendingPlan.current = null;
    setPlanning(false);
    setPlanNote("You changed your answers, so we stopped building the plan. Press Make my plan again when ready.");
  }

  function autoScrollOk(submittedAt: number) {
    return shouldAutoScroll({ submittedAt, lastInteractionAt: lastInteraction.current, focusEditable: isEditable(document.activeElement as HTMLElement | null) });
  }

  // "Too much? Make it simpler": the same paper, read again the normal way at the simple level.
  // It re-reads the text the steps came from (for a photo, the reading the person already checked).
  function makeSimpler() {
    if (!care || !simplerOk) return;
    setLevel("simple");
    void readPaper(care.source_text, "simple");
  }

  async function makePlan() {
    if (needsPhotoCheck) return;
    const run = ++planRun.current;
    pendingPlan.current?.abort.abort();
    const abort = new AbortController();
    const careIds = (care?.items ?? []).filter((i) => !removed[i.id]).map((i) => i.id);
    pendingPlan.current = { run, abort, at: performance.now(), fp: planFingerprint({ careIds, barriers, language, note, place: planPlace(!!loc, zip), location: loc }) };
    setPlanning(true); setError(null); setPlan(null); setPlanNote(null); setPlanReadyNote(null);
    try {
      const body = {
        care: (care?.items ?? []).filter((i) => !removed[i.id]).map((i) => ({ id: i.id, kind: i.kind, title: i.title, plain_language: i.plain_language, when: i.when, source_quote: i.source_quote })),
        barriers, language, note,
        ...(loc ? { location: loc } : /^\d{5}$/.test(zip) ? { zip } : {}),
      };
      const res = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: abort.signal });
      const json = await res.json();
      if (planRun.current !== run) return; // a new read, a clear, or a changed answer happened meanwhile
      const sent = pendingPlan.current;
      if (!sent || sent.run !== run) return;
      if (sent.fp !== livePlanFp()) return stopStalePlan(); // changed after sending; the change's effect may not have run yet
      pendingPlan.current = null;
      if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
      setPlan(json);
      setPlanFp(sent.fp);
      // Step 3 only exists after this render; what happens next is decided once it is on the page.
      planNav.current = { plan: json, submittedAt: sent.at };
    } catch (e) {
      if (planRun.current !== run) return;
      if (pendingPlan.current?.run === run && pendingPlan.current.fp !== livePlanFp()) return stopStalePlan();
      pendingPlan.current = null; setError(e instanceof Error ? e.message : "Something went wrong.");
    }
    finally { if (planRun.current === run) setPlanning(false); }
  }

  // Asking again drops the old position at once: a plan built from it is outdated until this request answers.
  // Only the latest request counts (a typed ZIP also supersedes any request still out).
  function useMyLocation() {
    if (!navigator.geolocation) return setError("This browser can't share location. Type a ZIP instead.");
    const gen = ++locGen.current;
    setLoc(null); setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (locGen.current !== gen) return;
        setLocating(false); setLoc({ lat: p.coords.latitude, lng: p.coords.longitude }); setZip("");
      },
      () => {
        if (locGen.current !== gen) return;
        setLocating(false); setError("Location wasn't shared. Type a ZIP instead.");
      },
      { timeout: 8000 },
    );
  }

  // One cleanup for every way reading ends: stop, finish, error, a new read, unmount. Safe to call twice.
  function silence() {
    speechRun.current++; // ignore end events from the run being cancelled
    speechAbort.current?.abort();
    speechAbort.current = null;
    const a = speechAudio.current;
    if (a) { a.onended = null; a.onerror = null; a.pause(); a.removeAttribute("src"); speechAudio.current = null; }
    if (speechUrl.current) { URL.revokeObjectURL(speechUrl.current); speechUrl.current = null; }
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    setTapToPlay(false);
  }

  function stopSpeaking() {
    silence();
    setSpeaking(false);
    setVoiceNote("");
  }

  // The phone's own voice. One utterance per line: Chrome silently stops a single long utterance after about 15 seconds.
  // If the browser never starts (iPhone Safari can ignore speech that isn't started by a tap), give up after 5 seconds.
  function phoneVoice(lines: string[], run: number) {
    if (!("speechSynthesis" in window)) { setSpeaking(false); setVoiceNote("This device can't read aloud. Try Print or Send to family."); return; }
    setVoiceNote("Reading with your phone's voice.");
    let started = false;
    lines.forEach((line, i) => {
      const u = new SpeechSynthesisUtterance(line);
      u.lang = SPEECH_LANG[language] ?? "en-US";
      u.rate = 0.95;
      u.onstart = () => { started = true; };
      if (i === lines.length - 1) u.onend = () => { if (speechRun.current === run) { setSpeaking(false); setVoiceNote(""); } };
      u.onerror = () => { if (speechRun.current === run) { setSpeaking(false); setVoiceNote(""); } };
      window.speechSynthesis.speak(u);
    });
    window.setTimeout(() => {
      if (speechRun.current !== run || started) return;
      window.speechSynthesis.cancel();
      setSpeaking(false);
      setVoiceNote("This device didn't start reading. Tap Read it out loud again, or use Print or Send to family.");
    }, 5000);
  }

  // Natural voice not usable: drop the audio and read with the phone's voice instead.
  function fallBack(run: number) {
    if (speechRun.current !== run) return;
    const a = speechAudio.current;
    if (a) { a.onended = null; a.onerror = null; a.pause(); speechAudio.current = null; }
    if (speechUrl.current) { URL.revokeObjectURL(speechUrl.current); speechUrl.current = null; }
    setTapToPlay(false);
    phoneVoice(speechLinesRef.current, run);
  }

  async function startAudio(run: number) {
    const a = speechAudio.current;
    if (!a || speechRun.current !== run) return;
    try {
      await a.play();
      setTapToPlay(false);
      setVoiceNote("");
    } catch (e) {
      if (speechRun.current !== run) return;
      // iPhone Safari: the tap that started this expired during the download. One more tap plays it.
      if (e instanceof DOMException && e.name === "NotAllowedError") { setTapToPlay(true); setVoiceNote("The voice is ready. Tap play."); }
      else fallBack(run);
    }
  }

  // Natural voice first (server, ElevenLabs); the phone's voice if that is off, busy, too long, or has no voice for this language.
  async function speak() {
    if (!plan || typeof window === "undefined") return;
    if (speaking) return stopSpeaking();
    silence();
    const run = speechRun.current;
    const lines = speechLines(plan);
    speechLinesRef.current = lines;
    setSpeaking(true);
    setVoiceNote("");
    const text = lines.join("\n");
    if (text.length > MAX_SPEAK_CHARS || !plan.speak_token) return phoneVoice(lines, run);
    const audio = new Audio();
    speechAudio.current = audio;
    const ctrl = new AbortController();
    speechAbort.current = ctrl;
    try {
      const r = await fetch("/api/speak", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, language, token: plan.speak_token }), signal: ctrl.signal });
      if (!r.ok || !(r.headers.get("content-type") ?? "").startsWith("audio/")) throw new Error("no natural voice");
      const blob = await r.blob();
      if (speechRun.current !== run) return; // stopped while loading
      speechAbort.current = null;
      const url = URL.createObjectURL(blob);
      speechUrl.current = url;
      audio.src = url;
      audio.onended = () => { if (speechRun.current === run) { silence(); setSpeaking(false); setVoiceNote(""); } };
      audio.onerror = () => fallBack(run);
      await startAudio(run);
    } catch {
      fallBack(run);
    }
  }

  // An outdated plan is not read aloud: stop any reading in progress the moment it goes out of date.
  useEffect(() => {
    if (planOutdated) stopSpeaking();
    // Only the change to outdated matters; stopSpeaking only touches refs and setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planOutdated]);

  // Stop reading if the plan changes or goes away, or the page unmounts.
  useEffect(() => () => {
    silence();
    setSpeaking(false);
    setVoiceNote("");
  }, [plan]);

  // Any scroll, tap or key press counts as the person using the page (for the automatic scroll rule).
  useEffect(() => {
    const mark = () => { lastInteraction.current = performance.now(); };
    const opts = { capture: true, passive: true } as const;
    const kinds = ["pointerdown", "keydown", "wheel", "touchmove"] as const;
    kinds.forEach((k) => window.addEventListener(k, mark, opts));
    // A scroll with none of those (dragging the scrollbar, find in page) counts too, unless it is the page's own.
    const onScroll = () => {
      const now = performance.now();
      if (scrollIsPersons({ now, y: window.scrollY, own: ownScroll.current, layoutChangedAt: layoutChangedAt.current })) lastInteraction.current = now;
    };
    // The page's own scroll is over. If it stopped short of (or past) its target, the person moved it.
    const onScrollEnd = () => {
      const own = ownScroll.current;
      if (!own) return;
      ownScroll.current = null;
      const now = performance.now();
      if (now <= own.until && ownScrollEndedByPerson({ y: window.scrollY, own, layoutChangedAt: layoutChangedAt.current, now })) lastInteraction.current = now;
    };
    window.addEventListener("scroll", onScroll, opts);
    window.addEventListener("scrollend", onScrollEnd, opts);
    // A size change while the page's own scroll is moving re-aims its path at where the target sits now,
    // so a drag off that path is still seen once the browser's own adjustment has passed.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const now = performance.now();
      layoutChangedAt.current = now;
      const own = ownScroll.current, el = ownScrollEl.current;
      if (own && el?.isConnected && now <= own.until) ownScroll.current = rebaseOwnScroll(own, { y: window.scrollY, to: scrollTargetY(el) });
    });
    ro?.observe(document.body);
    return () => {
      kinds.forEach((k) => window.removeEventListener(k, mark, opts));
      window.removeEventListener("scroll", onScroll, opts);
      window.removeEventListener("scrollend", onScrollEnd, opts);
      ro?.disconnect();
    };
  }, []);

  function markOwnScroll(s: PageScroll | null) {
    if (!s) return;
    const now = performance.now();
    ownScroll.current = { start: now, until: now + (s.behavior === "smooth" ? OWN_SCROLL_MS : OWN_INSTANT_SCROLL_MS), from: s.from, to: s.to };
    ownScrollEl.current = s.el;
  }

  function runScroll(req: { t: Tab; onlyIfHidden: boolean; anchor?: boolean; submittedAt?: number }) {
    // An automatic scroll is checked again here: a tap or scroll since the button press cancels it.
    if (req.submittedAt !== undefined && !autoScrollOk(req.submittedAt)) { scrollAnchor.current = null; return; }
    markOwnScroll(scrollToPanel(req.t, req.onlyIfHidden));
    scrollAnchor.current = req.anchor ? { t: req.t, at: performance.now() } : null;
  }

  // A read or plan whose inputs changed while it was pending is stopped, so its late reply can't land.
  useEffect(() => {
    const r = pendingRead.current;
    if (!r || r.run !== readRun.current) return;
    if (readFingerprint({ text: photo ? null : text, photo: photoId(photo), language, level }) === r.fp) return;
    stopStaleRead();
  }, [text, photo, language, level]);

  useEffect(() => {
    const p = pendingPlan.current;
    if (!p || p.run !== planRun.current) return;
    const careIds = (care?.items ?? []).filter((i) => !removed[i.id]).map((i) => i.id);
    if (planFingerprint({ careIds, barriers, language, note, place: planPlace(!!loc, zip), location: loc }) === p.fp) return;
    stopStalePlan();
  }, [care, removed, barriers, language, note, loc, zip]);

  // Runs after every render; does nothing unless a tab change or a reply asked for a scroll.
  useEffect(() => {
    const req = scrollAfter.current;
    if (!req) return;
    scrollAfter.current = null;
    runScroll(req);
  });

  // A new plan is on the page. If the person has not used the page since pressing the button, open step 3 and
  // bring it up; otherwise leave them where they are (phones say the plan is ready). Decided now, not when it landed.
  // Declared after the scroll effect, so a scroll queued here waits for the tab switch to render.
  useEffect(() => {
    const nav = planNav.current;
    if (!nav || nav.plan !== plan) return;
    planNav.current = null;
    const free = autoScrollOk(nav.submittedAt);
    const phone = isPhoneNow();
    if (free || !phone) setTab(3);
    else setPlanReadyNote("Your plan is ready. Open 3 · Plan.");
    const target = scrollTargetAfter("plan", phone);
    if (!target || !free) return;
    const next = { t: target, onlyIfHidden: false, anchor: true, submittedAt: nav.submittedAt };
    // On a phone the card shows only after the tab switch renders; if step 3 is already open, nothing re-renders.
    if (phone && tab !== 3) scrollAfter.current = next;
    else runScroll(next);
    // Only a new plan matters here; tab is read as of that render, and the helpers only read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan]);

  // Late content (the on-device check, the double-check, the quiz) can grow above the card just scrolled to.
  // While the anchor holds, put the card back under the top; it lets go as soon as the person uses the page.
  useEffect(() => {
    const section = document.getElementById("try");
    if (!section || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      const a = scrollAnchor.current;
      if (!a) return;
      const now = performance.now();
      if (!anchorHolds({ anchorAt: a.at, now, lastInteractionAt: lastInteraction.current, focusEditable: isEditable(document.activeElement as HTMLElement | null) })) { scrollAnchor.current = null; return; }
      const el = document.getElementById(panelId(a.t));
      if (!el) return;
      const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
      if (Math.abs(el.getBoundingClientRect().top - margin) > 4) markOwnScroll(scrollElementToTop(el, "auto"));
    });
    ro.observe(section);
    return () => ro.disconnect();
  }, []);

  // Re-check every shown step on this device once a reading is final (and, for a photo, once the person checked it).
  // The checker is fetched only now, so a visitor who never reads a paper never downloads it.
  const deviceWanted = !!care && !(care.source_kind === "image" && !photoChecked) && care.items.length > 0;
  useEffect(() => {
    if (!care || !deviceWanted) return;
    let live = true;
    import("@/lib/deviceChecker")
      .then(async ({ loadDeviceChecker, sameSpan }) => {
        const checker = await loadDeviceChecker();
        const byId: Record<string, DeviceVerdict> = {};
        for (const it of care.items) {
          const mine = checker.findSpan(care.source_text, it.source_quote);
          byId[it.id] = sameSpan(it.span, mine) ? "match" : mine ? "differ" : "missing";
        }
        if (live) setDeviceRun({ for: care, ok: true, byId });
      })
      .catch(() => { if (live) setDeviceRun({ for: care, ok: false, byId: {} }); });
    return () => { live = false; };
  }, [care, deviceWanted]);

  function pickTab(t: Tab, onlyIfHidden = true) {
    setTab(t);
    if (t === 3) setPlanReadyNote(null); // they opened the plan
    scrollAfter.current = { t, onlyIfHidden };
  }

  // The handoff sheet is the only thing printed while html.print-sheet is set; afterprint clears it.
  function printSheet() {
    const root = document.documentElement;
    const done = () => { root.classList.remove("print-sheet"); window.removeEventListener("afterprint", done); };
    root.classList.add("print-sheet");
    window.addEventListener("afterprint", done);
    window.print();
  }

  const careById = Object.fromEntries((care?.items ?? []).map((i) => [i.id, i]));
  // Show "Book it now" once per thing to book: on the first plan step that serves it.
  const bookAt = new Map<string, number>();
  plan?.steps.forEach((s, i) => {
    const b = bookableItem(s.care_ids.map((id) => careById[id]).filter(Boolean));
    if (b && !bookAt.has(b.id)) bookAt.set(b.id, i);
  });
  const items = (care?.items ?? []).filter((i) => !removed[i.id]);
  // A photo's steps quote the AI's own reading of it, so nothing is shown or planned until the person checks that reading.
  const needsPhotoCheck = care?.source_kind === "image" && !photoChecked;
  const removedItems = (care?.items ?? []).filter((i) => removed[i.id]);
  const deviceStatus: "idle" | "loading" | "done" | "error" =
    !care || needsPhotoCheck || care.items.length === 0 ? "idle" : deviceRun.for !== care ? "loading" : deviceRun.ok ? "done" : "error";
  const flow = { hasCare: !!care, hasPlan: !!plan };
  const openName = store.plans.find((p) => p.id === store.active)?.name ?? null;
  // The person changed our reading of their photo. Accepting or re-reading the old text would silently drop their fix.
  const transcriptEdited = !!care && isTranscriptEdited(transcript, care.source_text);
  const simplerOk = canMakeSimpler({ readLevel, hasCare: !!care, needsPhotoCheck, reading, sourceLength: care?.source_text.trim().length ?? 0, transcriptEdited, hasPlan: !!plan, planning });
  const shown = shownTab(tab, flow);
  // Phones: one step card at a time. Hidden cards stay mounted (state, timers and requests carry on).
  const panel = (t: Tab) => ({
    id: panelId(t),
    ...(isPhone ? { role: "tabpanel", "aria-labelledby": tabId(t) } : {}),
  });
  const onPhone = (t: Tab) => (t === shown ? "" : "max-md:hidden");

  return (
    <section id="try" className="relative px-3 mt-3 scroll-mt-20" aria-labelledby="try-title">
      <div className="section-card bg-mint-soft px-4 sm:px-10 py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="try-title" className="display text-[clamp(2.4rem,5vw,5rem)]">Try it</h2>
          <p className="hand text-3xl text-teal-deep rotate-1 max-w-[16em]">use the sample, or a paper you&apos;re comfortable sharing</p>
        </div>

        {restoredAt && (
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-teal bg-paper p-4">
            <p className="font-bold">Welcome back. {openName ? <>&ldquo;{openName}&rdquo; is</> : "Your plan is"} saved on this device ({new Date(restoredAt).toLocaleString()}).</p>
            <button type="button" onClick={clearSaved} className="rounded-full border-2 border-ink px-4 py-1.5 text-sm font-bold hover:bg-red-soft">Clear it from this device</button>
          </div>
        )}

        <SavedPlans plans={listPlans(store)} activeId={store.active} busy={reading || planning} saveFailed={saveFailed}
          onOpen={openSaved} onRename={(id, name) => writeStore(renamePlan(storeRef.current, id, name))} onDelete={deleteSaved} onNew={newPlan} />

        {error && <p role="alert" className="mt-6 rounded-2xl border-2 border-red bg-red-soft p-4 font-bold text-red">{error}</p>}

        <PhoneTabBar shown={shown} state={flow} onPick={pickTab} notice={plan && shown !== 3 ? planReadyNote : null} />

        {/* Step 1 */}
        <div {...panel(1)} className={`card mt-10 max-md:mt-4 p-5 sm:p-8 max-md:scroll-mt-44 ${onPhone(1)}`}>
          <StepHeader n={1} title="Your visit paper" done={!!care} note="optional, but it makes the plan yours" />
          <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_15rem]">
            <div>
              <textarea data-lenis-prevent aria-label="After-visit summary text" className="h-44 w-full rounded-2xl border-2 border-ink/70 bg-paper p-4 text-sm focus:border-teal"
                placeholder="Paste the after-visit summary here..." value={text} onChange={(e) => { setText(e.target.value); setPhoto(null); }} />
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm font-bold">
                <button type="button" className="rounded-full border-2 border-ink px-4 py-2 hover:bg-mint" onClick={() => { setText(SAMPLE_AVS); setPhoto(null); setTab(1); }}>Use the sample paper</button>
                <label className="cursor-pointer rounded-full border-2 border-ink px-4 py-2 hover:bg-mint">
                  📷 {photo ? photo.name : "Take or upload a photo"}
                  <input type="file" accept="image/*" capture="environment" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0] ?? null; setPhoto(f); if (f) setText(""); }} />
                </label>
              </div>
              <p className="mt-2 text-xs text-ink/70">{SAMPLE_LABEL}.</p>
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

          {readNote && <p role="status" className="mt-4 rounded-2xl border-2 border-sun bg-paper p-3 text-sm font-bold">{readNote}</p>}
          {careOutdated && !reading && (
            <div role="status" className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-sun bg-paper p-3 text-sm font-bold">
              <p className="flex-1 min-w-[14rem]">You changed your paper or settings after we read it. The steps below are from the earlier version, and changes are not saved until you read it again.</p>
              <button type="button" onClick={() => readPaper()} disabled={!photo && text.trim().length < 20}
                className="rounded-full border-2 border-ink bg-sun px-4 py-1.5 disabled:opacity-40">Read it again</button>
            </div>
          )}
          {/* Always mounted so screen readers hear each count change; one update per verified step, never per word. */}
          <p className="sr-only" role="status" aria-live="polite">
            {reading && partial.length > 0 ? `${partial.length} ${partial.length === 1 ? "step" : "steps"} found so far` : ""}
          </p>
          {reading && partial.length === 0 && <WorkingCard kind="read" />}
          {reading && partial.length > 0 && <StreamingSteps items={partial} />}

          {care && needsPhotoCheck && (
            <div className="mt-8 rounded-2xl border-2 border-sky-deep bg-sky/60 p-4 sm:p-5">
              <p className="font-extrabold">Check how we read your photo</p>
              <p className="text-sm font-semibold text-ink/70">
                Every step below has to quote this text. If a word or number is wrong here, fix it, then read it again so the steps come from your corrected text.
              </p>
              <textarea data-lenis-prevent aria-label="Text read from your photo" className="mt-3 h-44 w-full rounded-2xl border-2 border-ink/70 bg-paper p-4 text-sm focus:border-teal"
                value={transcript ?? care.source_text} onChange={(e) => setTranscript(e.target.value)} />
              <div className="mt-3 flex flex-wrap gap-3 text-sm font-bold">
                <button type="button" className="rounded-full bg-ink text-paper px-4 py-2 disabled:opacity-40"
                  disabled={reading || (transcript ?? care.source_text).trim().length < 20 || transcript === care.source_text}
                  onClick={() => readPaper(transcript ?? care.source_text)}>Use my corrected text</button>
                <button type="button" className="rounded-full border-2 border-ink px-4 py-2 hover:bg-mint disabled:opacity-40"
                  disabled={transcriptEdited} aria-describedby={transcriptEdited ? "photo-edited" : undefined}
                  onClick={() => { setPhotoChecked(true); void checkMeaningFor(care); }}>It matches my paper</button>
                {transcriptEdited && (
                  <button type="button" className="rounded-full border-2 border-ink px-4 py-2 hover:bg-mint" onClick={() => setTranscript(care.source_text)}>Undo my changes</button>
                )}
              </div>
              {transcriptEdited && (
                <p id="photo-edited" className="mt-2 text-sm font-bold text-ink/70">You changed the text, so use your corrected text, or undo your changes.</p>
              )}
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
              {deviceStatus === "loading" && <p className="mt-1 text-xs font-semibold text-ink/70">Checking each step again on this device...</p>}
              {deviceStatus === "error" && <p className="mt-1 text-xs font-semibold text-ink/70">This device couldn&apos;t run its own check, so each step shows our server&apos;s check only.</p>}
              {simplerOk && (
                <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1">
                  <button type="button" onClick={makeSimpler} aria-describedby="simpler-why"
                    className="rounded-full border-2 border-ink bg-sun px-4 py-2 text-sm font-bold shadow-[0_2px_0_var(--ink)] hover:bg-mint focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-teal-deep">
                    Too much? Make it simpler
                  </button>
                  <span id="simpler-why" className="text-xs font-semibold text-ink/70">Reads your paper again in plainer words, in the same language.</span>
                </div>
              )}
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
                            {it.when && <span className="text-xs font-bold text-ink/70">· {it.when}</span>}
                          </div>
                          <p className="mt-1">{it.plain_language}</p>
                          {it.needs_clarification && it.question_for_clinic && <p className="mt-2 rounded-xl bg-peach p-2 text-sm font-semibold text-peach-deep">Ask your clinic: {it.question_for_clinic}</p>}
                          <p className="mt-2 border-l-4 border-sun pl-2 text-xs italic text-ink/70">From your paper: &ldquo;{it.source_quote}&rdquo;</p>
                          {deviceStatus === "done" && deviceRun.byId[it.id] === "match" && (
                            <p className="mt-1 text-[11px] font-bold text-teal-deep" data-device-check="match">✓ Checked on this device: same words, same place in your paper</p>
                          )}
                          {deviceStatus === "done" && deviceRun.byId[it.id] && deviceRun.byId[it.id] !== "match" && (
                            <p role="note" className="mt-2 rounded-xl bg-peach p-2 text-sm font-semibold text-peach-deep" data-device-check="differ">
                              Double-check this one: this device&apos;s own check {deviceRun.byId[it.id] === "missing" ? "could not find these words in your paper" : "found these words in a different place in your paper"}. Read the line from your paper above.
                            </p>
                          )}
                          {meaning.status === "loading" && <p className="mt-1 text-[11px] font-semibold text-ink/70">Double-checking this against your paper...</p>}
                          {meaning.status === "done" && meaning.byId[it.id]?.flagged && (
                            <p role="note" className="mt-2 rounded-xl bg-peach p-2 text-sm font-semibold text-peach-deep">
                              Double-check this one with your clinic: our second check says the explanation may not match your paper.
                              {meaning.byId[it.id].what_differs ? ` ${meaning.byId[it.id].what_differs.charAt(0).toUpperCase()}${meaning.byId[it.id].what_differs.slice(1)}` : ""}
                              {meaning.byId[it.id].unexpected_numbers.length > 0 ? ` (Number not in your paper: ${meaning.byId[it.id].unexpected_numbers.join(", ")}.)` : ""}
                            </p>
                          )}
                          {meaning.status === "done" && meaning.byId[it.id]?.certified && (
                            <p className="mt-1 text-[11px] font-bold text-teal-deep">✓ Double-checked: the explanation matches this line</p>
                          )}
                          {meaning.status === "done" && meaning.byId[it.id] && !meaning.byId[it.id].flagged && !meaning.byId[it.id].certified && (
                            <p className="mt-1 text-[11px] font-semibold text-ink/70">Not double-checked: our second check couldn&apos;t confirm this one. Read the line from your paper above.</p>
                          )}
                        </div>
                        <button type="button" aria-label={`Remove ${it.title}`} className="text-xs font-bold text-ink/70 hover:text-red"
                          onClick={() => setRemoved((r) => ({ ...r, [it.id]: true }))}>Remove</button>
                      </div>
                    </li>
                  ))}
                </ul>
                <div className="space-y-4">
                  <div className="rounded-2xl border-2 border-ink/70 bg-paper p-4">
                    <p className="font-extrabold mb-2">Your paper, every step highlighted</p>
                    {/* Focusable so keyboard users can scroll the paper (axe scrollable-region-focusable). */}
                    <div data-lenis-prevent tabIndex={0} role="region" aria-label="Your paper with every step highlighted"
                      className="max-h-[26rem] overflow-auto rounded-lg focus-visible:outline-2 focus-visible:outline-teal"><Highlighted text={care.source_text} items={items} active={active} /></div>
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
                      <p className="text-xs text-ink/70">Worth asking your clinic about.</p>
                      <ul className="mt-2 list-disc pl-5 text-sm">{care.not_in_document.map((q, i) => <li key={i}>{q}</li>)}</ul>
                    </div>
                  )}
                  {care.refused.length > 0 && (
                    <div className="rounded-2xl border-2 border-ink/30 bg-paper p-4">
                      <p className="font-extrabold">Held back to protect you ({care.refused.length})</p>
                      <p className="text-xs text-ink/70">The AI suggested these, but the words aren&apos;t in your paper.</p>
                      <ul className="mt-2 list-disc pl-5 text-sm">{care.refused.map((r) => <li key={r.id}>{r.title}</li>)}</ul>
                    </div>
                  )}
                </div>
              </div>
              <Understand key={`${care.source_text.length}:${items.map((i) => i.id).join(",")}:${language}`} care={care} items={items} language={language} />
              <button type="button" onClick={() => pickTab(2, false)}
                className="md:hidden mt-8 w-full rounded-full border-2 border-ink bg-sun px-5 py-3 text-lg font-extrabold shadow-[0_3px_0_var(--ink)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-teal-deep">
                Next: your needs →
              </button>
            </div>
          )}
        </div>

        {/* Step 2 */}
        <div {...panel(2)} className={`card mt-6 max-md:mt-4 p-5 sm:p-8 scroll-mt-24 max-md:scroll-mt-44 ${onPhone(2)}`}>
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
              <label className="text-sm font-bold" htmlFor="zip">Your ZIP</label>
              <input id="zip" inputMode="numeric" maxLength={5} className="mt-1 w-full rounded-xl border-2 border-ink/70 bg-paper p-2.5"
                placeholder="e.g. 30340" value={zip} onChange={(e) => { setZip(e.target.value.replace(/\D/g, "")); setLoc(null); locGen.current++; setLocating(false); }} />
              <button type="button" onClick={useMyLocation} className="mt-2 text-sm font-bold underline decoration-2 underline-offset-4">
                {locating ? "Finding your location..." : loc ? "✓ Using your location (stays on this device)" : "Or use my location"}
              </button>
            </div>
            <label className="text-sm font-bold">Anything else we should know? (optional)
              <textarea data-lenis-prevent className="mt-1 h-24 w-full rounded-xl border-2 border-ink/70 bg-paper p-2.5" placeholder="e.g. no car, I work mornings, I prefer home remedies first"
                value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
          <div className="mt-6">
            <SquashButton onClick={makePlan} disabled={planning || needsPhotoCheck || (barriers.length === 0 && items.length === 0)} bg="var(--ink)" accent="var(--mint)">
              {planning ? "Building your plan..." : "Make my plan"}
            </SquashButton>
            {needsPhotoCheck && <p className="mt-3 text-sm font-bold text-ink/70">First check how we read your photo in step 1.</p>}
            {planNote && <p role="status" className="mt-3 rounded-2xl border-2 border-sun bg-paper p-3 text-sm font-bold">{planNote}</p>}
            {planning && <WorkingCard kind="plan" />}
          </div>
        </div>

        {plan && care && <HandoffSheet items={items.filter((i) => i.grounded)} plan={plan} questions={care.questions_for_doctor} language={language} />}

        {/* Step 3 */}
        {plan && (
          <div {...panel(3)} className={`card mt-6 max-md:mt-4 p-5 sm:p-8 scroll-mt-24 max-md:scroll-mt-44 ${onPhone(3)}`}>
            <StepHeader n={3} title="Your plan" done note={plan.located.label} />
            {planOutdated && (
              <div role="status" className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-sun bg-sun/30 p-3 text-sm font-bold">
                {careOutdated
                  ? <p>This plan was made from your earlier paper. Read it again in step 1, then make a new plan.</p>
                  : <>
                      <p className="flex-1 min-w-[14rem]">
                        {needsPlace
                          ? "This plan used your location from before, and your location is never saved. Use my location again or enter a ZIP in step 2, then update the plan."
                          : "You changed your answers after this plan was made, so it may not fit them. Changes are not saved until you update it."}
                      </p>
                      <button type="button" onClick={makePlan} disabled={planning || needsPlace || (barriers.length === 0 && items.length === 0)}
                        className="rounded-full border-2 border-ink bg-sun px-4 py-1.5 disabled:opacity-40">Update plan</button>
                    </>}
              </div>
            )}
            <p className="mt-4 text-lg font-semibold max-w-[50em]">{plan.summary}</p>
            <div className="mt-4 flex flex-wrap gap-3 text-sm font-bold">
              {/* An outdated plan can't be read aloud, printed as a handoff, sent or booked from; the on-screen note says why. */}
              {planOutdated && <span id="plan-actions-off" className="basis-full text-sm font-bold text-peach-deep">{actionsOffReason}: read aloud, the handoff sheet, Send to family and Book it now are off until then.</span>}
              {tapToPlay
                ? <button type="button" onClick={() => void startAudio(speechRun.current)} disabled={planOutdated} aria-describedby={planOutdated ? "plan-actions-off" : undefined} className="rounded-full border-2 border-ink bg-sun px-4 py-2 disabled:opacity-40">▶ Tap to play</button>
                : <button type="button" onClick={speak} aria-pressed={speaking} disabled={planOutdated} aria-describedby={planOutdated ? "plan-actions-off" : undefined}
                    className={`rounded-full border-2 border-ink px-4 py-2 disabled:opacity-40 ${speaking ? "bg-ink text-paper" : "bg-sun"}`}>
                    {speaking ? "⏹ Stop reading" : "🔊 Read it out loud"}
                  </button>}
              {tapToPlay && <button type="button" onClick={stopSpeaking} className="rounded-full border-2 border-ink px-4 py-2">Cancel</button>}
              <span role="status" className={voiceNote ? "self-center text-xs font-semibold text-ink/70" : "sr-only"}>{voiceNote}</span>
              <button type="button" onClick={() => window.print()} className="rounded-full border-2 border-ink px-4 py-2">🖨️ Print for the next visit</button>
              <button type="button" onClick={printSheet} disabled={planOutdated} aria-describedby={planOutdated ? "plan-actions-off" : undefined} className="rounded-full border-2 border-ink px-4 py-2 disabled:opacity-40">📄 Print a handoff sheet</button>
              {care && <ShareFamily items={items} plan={plan} questions={care.questions_for_doctor} meaning={meaning} disabled={planOutdated} describedBy={planOutdated ? "plan-actions-off" : undefined} />}
              <span className="self-center text-ink/70">{plan.stats.steps} steps · {plan.stats.candidates} verified options checked · {plan.stats.dropped_refs} unverified suggestions removed</span>
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
                    {s.barrier && <span className="chip bg-paper border border-ink/30">{BARRIER_LABEL[s.barrier as Barrier] ?? s.barrier}</span>}
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
                  {[...bookAt.values()].includes(i) && (
                    <BookIt items={s.care_ids.map((id) => careById[id]).filter(Boolean)} barriers={barriers} language={language} offReason={planOutdated ? actionsOffReason : undefined} />
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
            <Feedback key={plan.summary} language={language} token={plan.feedback_token ?? null} />
            <p className="mt-6 text-xs text-ink/70">ATLAS explains your own paperwork and points to verified public resources. It is not medical advice. Model: {plan.model}.</p>
          </div>
        )}
      </div>
    </section>
  );
}
