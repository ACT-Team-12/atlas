"use client";

import { bookSafe, careStepView, checkOf, type Check } from "@/lib/paperFirst";
import { readingGeneralQuestions, visitQuestionsTagged } from "@/lib/visitQuestions";
import { PaperFirst } from "./PaperFirst";
import { planStepQuotes } from "@/lib/planQuotes";
import { useCallback, useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { landingTop, readyTarget, ReadyCue, type Ready } from "./ReadyCue";
import type { CarePlanResponse, VerifiedItem } from "@/lib/schema";
import { LANGUAGES, READING_LEVELS } from "@/lib/schema";
import { WorkingCard } from "./WorkingCard";
import { SAMPLE_AVS, SAMPLE_LABEL } from "@/lib/sample";
import { mayFillSample, TRY_SAMPLE_EVENT, TRY_SAMPLE_HASH } from "@/lib/sampleStart";
import { BARRIERS, type Barrier } from "@/lib/resources";
import type { PlanResponse } from "@/lib/plan";
import { topResources } from "@/lib/planTop";
import { ProblemRow, TopCalls } from "./PlanStart";
import { DockLabel } from "./DockLabel";
import { restoredPlan } from "@/lib/planText";
import { SquashButton } from "./SquashButton";
import { Feedback } from "./Feedback";
import { Understand } from "./Understand";
import { AskPaper } from "./AskPaper";
import { HandoffSheet } from "./HandoffSheet";
import { HANDOFF_SHEET, printOrView, printPageOr } from "./printView";
import { ReadIn } from "./ReadIn";
import { MissedLines, useMissedLines } from "./MissedLines";
import { missedLineTexts } from "@/lib/missedLines";
import { ShareFamily } from "./ShareFamily";
import { CallMe } from "./CallMe";
import { callMeKey } from "@/lib/call/callKey";
import { BookIt } from "./BookIt";
import { bookableItem } from "@/lib/booking";
import { readExtractEvents, StreamBroken, StreamFailed } from "@/lib/extractEvents";
import { failureKey, RequestFailed } from "@/lib/requestError";
import { restoredTab, scrollTargetAfter, shownTab, type Tab } from "@/lib/phoneTabs";
import { canMakeSimpler, isTranscriptEdited } from "@/lib/simpler";
import { isPhoneNow, panelId, PhoneTabBar, scrollElementToTop, scrollTargetY, scrollToPanel, tabId, useIsPhone, type PageScroll } from "./PhoneTabs";
import { paidVoiceAllowed, speechLines } from "@/lib/speechText";
import {
  CHECK_POLICY, checksKey, closePlan, deletePlan, emptyStore, listPlans, loadStore, OLD_KEY, openPlan, readStartsNewPlan, renamePlan,
  STORE_KEY, type Session, type Store,
} from "@/lib/savedPlans";
import { SavedPlans } from "./SavedPlans";
import {
  anchorHolds, isEditable, NO_LAYOUT_SHIFT, OWN_INSTANT_SCROLL_MS, ownScrollArrived, OWN_SCROLL_MS, ownScrollEndedByPerson, planFingerprint, planPlace, readFingerprint, readFingerprintFor, rebaseOwnScroll,
  scrollIsPersons, shouldAutoScroll, type LayoutShift, type OwnScroll,
} from "@/lib/staleGuard";
import { SPEECH_LANG } from "@/lib/speechLang";
import { CareSteps, KIND } from "./CareSteps";
import { isWarning } from "@/lib/warningPin";
import { SessionSummary } from "./SessionSummary";
import { helperSessionKey } from "@/lib/sessionSummary";
import { deviceStatus as deviceStatusOf, NO_DEVICE_RUN, runIdFor, type DeviceRun, type DeviceVerdict } from "@/lib/deviceRun";
// Static, so erasing never waits on a chunk download; the WebAssembly itself is still fetched only after a read.
import { forgetDeviceChecker, loadDeviceChecker, sameSpan } from "@/lib/deviceChecker";
import { streamThenPlain } from "@/lib/readCancel";
import { DeletedPlans, deleteOnDevice, dropDeleted, saveStore, watchDeletions } from "@/lib/tombstones";
import { autosaveStore } from "@/lib/autosave";
import { fetchMeaning, IDLE_MEANING, RunFence, runMeaningCheck, type MeaningState } from "@/lib/meaningRun";
import { consumeHelperSession, entryHeaders } from "@/lib/helperLink";
import { HelperBanner, useHelperArrival } from "./HelperArrival";
import { keyFor, locatedLine, ui, uiCount, UI_LANG_CODE, type UiKey, type UiPluralKey } from "@/lib/uiText";
import { paperLangCode, safeLine, UiLangProvider, useUi } from "./UiLang";

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
  let res: Response;
  try {
    res = await fetch("/api/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    throw new RequestFailed(0, "Network error");
  }
  return replyJson<CarePlanResponse>(res);
}

/**
 * The JSON body of one of our routes, or a RequestFailed carrying its status and the server's own (English) words,
 * which are logged, never shown. A reply that is not JSON at all counts as a server failure.
 */
async function replyJson<T>(res: Response): Promise<T> {
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new RequestFailed(res.status, json?.error ?? `HTTP ${res.status}`);
  if (json === null) throw new RequestFailed(502, "Reply was not JSON");
  return json as T;
}

/**
 * Reads a pasted paper over the streaming route. Throws StreamBroken when the caller should retry
 * with the plain route (connection cut, route missing, server error), or a RequestFailed (failureKey says what to show).
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
    const json = await res.json().catch(() => null);
    throw new RequestFailed(res.status, json?.error ?? `HTTP ${res.status}`);
  }
  try {
    return await readExtractEvents(res.body, onItem);
  } catch (e) {
    if (e instanceof StreamFailed && (e.status < 500 || e.status === 503)) throw new RequestFailed(e.status, e.message);
    if (e instanceof StreamFailed) throw new StreamBroken(e.message);
    throw e;
  }
}

/**
 * Steps shown while the paper is still being read. Not final: no checkboxes, nothing saved, nothing built on them.
 * A step is styled as a warning exactly when "Your steps" pins it as one (lib/warningPin.ts): the model's kind or the
 * paper's own words, so a mislabeled "call 911" line is red here too.
 */
export function StreamingSteps({ items }: { items: VerifiedItem[] }) {
  const { t, ts, tn } = useUi();
  return (
    <div className="mt-8" aria-busy="true">
      <p className="display text-2xl">{t("paper.stillReading")}<span className="working-dots" aria-hidden="true" /></p>
      <p className="text-sm font-bold text-ink/70 mt-1">
        {tn("stepsFoundSoFar", items.length)} {t("paper.foundSoFarMore")}
      </p>
      <ul className="mt-4 space-y-3">
        {items.map((it) => (
          <li key={it.id} data-warning={isWarning(it) ? "" : undefined} className={`step-in rounded-2xl border-2 p-4 ${isWarning(it) ? "border-red bg-red-soft/50" : "border-ink/70 bg-paper"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className={`chip ${KIND[it.kind]?.cls}`}>{ts(keyFor("kind", it.kind, "kind.step"))}</span>
            </div>
            {/* Not checked yet while streaming, so the paper's words lead (lib/paperFirst.ts). */}
            <PaperFirst v={careStepView(it, "unchecked")} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function StepHeader({ n, title, done, note, id }: { n: number; title: string; done?: boolean; note?: string; id?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span className={`grid place-items-center w-10 h-10 rounded-full border-2 border-ink font-extrabold ${done ? "bg-teal text-paper" : "bg-paper"}`}>{done ? "✓" : n}</span>
      {/* With an id it is a landing spot (the ready cue moves focus here), so it takes focus without joining the tab order. */}
      <h3 id={id} tabIndex={id ? -1 : undefined} className="display text-3xl outline-none focus-visible:outline-3 focus-visible:outline-teal-deep">{title}</h3>
      {note && <span className="hand text-2xl text-ink/70 -rotate-1">{note}</span>}
    </div>
  );
}

/** `ready`: the cue to raise instead when an automatic scroll is cancelled at the last check (Codex review, round 4). */
type ScrollRequest = { t: Tab; onlyIfHidden: boolean; anchor?: boolean; submittedAt?: number; ready?: { what: Ready; ref: object } };

/** The fingerprint of a save from before results were checked against answers: no inputs ever match it. */
const UNMATCHED_SAVE = "saved-before-results-were-checked";

/**
 * A plan step's done tick, kept in the same saved `done` record as the paper's steps (whose keys are care ids, never
 * starting with "plan:"), so it is saved and reopened with the plan. Cleared when a new plan replaces it.
 */
const planTickKey = (i: number) => `plan:${i}`;
const dropPlanTicks = (d: Record<string, boolean>) => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith("plan:")));

export function CarePlanTool() {
  const [text, setTextState] = useState("");
  const [photo, setPhotoState] = useState<File | null>(null);
  const [language, setLanguageState] = useState<(typeof LANGUAGES)[number]>("English");
  // The app's own words in the chosen language (lib/uiText.ts); children read it from UiLangProvider below.
  const t = (key: UiKey, vars?: Record<string, string | number>) => ui(language, key, vars);
  const tn = (key: UiPluralKey, n: number, vars?: Record<string, string | number>) => uiCount(language, key, n, vars);
  // A safety line with its English beside it until reviewed (UiLang.tsx, ts).
  const ts = (key: UiKey, vars?: Record<string, string | number>): ReactNode => safeLine(language, key, vars);
  const [level, setLevelState] = useState<(typeof READING_LEVELS)[number]>("simple");
  // The level the steps on screen were read at (the select can change after a read).
  const [readLevel, setReadLevel] = useState<(typeof READING_LEVELS)[number] | null>(null);
  const [reading, setReading] = useState(false);
  // Verified steps that arrived while the paper is still being read. Shown, never final.
  const [partial, setPartial] = useState<VerifiedItem[]>([]);
  const readRun = useRef(0);
  // Cancels the read in flight; erasing the open paper aborts it, so the paper is not sent again.
  const readAbort = useRef<AbortController | null>(null);
  // Plan requests in flight. A new read or a clear bumps it, so an older plan reply cannot land on newer steps.
  const planRun = useRef(0);
  // What each pending read or plan was sent with, so a reply for inputs the person has since changed is dropped.
  const pendingRead = useRef<{ run: number; fp: string; at: number; abort: AbortController } | null>(null);
  const pendingPlan = useRef<{ run: number; fp: string; at: number; abort: AbortController } | null>(null);
  const lastInteraction = useRef(0);
  // The page's own automatic scroll in progress (where it is headed), and when the page last changed size.
  // Scrolls along that path, or caused by a size change, are not the person and do not cancel an automatic scroll.
  const ownScroll = useRef<OwnScroll | null>(null);
  // An automatic scroll asked for while the page's own scroll is still moving waits until that one settles:
  // only then can a scrollbar drag along the same path be told from it.
  const waitingScroll = useRef<ScrollRequest | null>(null);
  const waitingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runScrollRef = useRef<(req: ScrollRequest) => void>(() => {});
  const ownScrollEl = useRef<HTMLElement | null>(null);
  // Device location requests: a generation so only the latest answer counts, and whether one is out.
  const locGen = useRef(0);
  const [locating, setLocatingState] = useState(false);
  const layoutShift = useRef<LayoutShift>(NO_LAYOUT_SHIFT);
  // Where the page was at the last scroll event: a scroll event that did not move the page is not the person.
  const lastScrollY = useRef(0);
  const [readNote, setReadNote] = useState<string | null>(null);
  const [planNote, setPlanNote] = useState<string | null>(null);
  const [planReadyNote, setPlanReadyNote] = useState<string | null>(null);
  // A result landed while the person was elsewhere on the page (ReadyCue). `ref` is that exact result: the cue
  // shows only while it is still the one on screen and still current (Codex review).
  const [ready, setReady] = useState<{ what: Ready; ref: object } | null>(null);
  const clearReady = useCallback(() => setReady(null), []);
  const [care, setCareState] = useState<CarePlanResponse | null>(null);
  const [barriers, setBarriersState] = useState<Barrier[]>([]);
  const [zip, setZipState] = useState("");
  const [loc, setLocState] = useState<{ lat: number; lng: number } | null>(null);
  const [note, setNoteState] = useState("");
  const [planning, setPlanning] = useState(false);
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, boolean>>({});
  const [removed, setRemovedState] = useState<Record<string, boolean>>({});
  const [restoredAt, setRestoredAt] = useState<string | null>(null);
  // What the reading and the plan on screen were made from. If the inputs move on, the result is labelled
  // outdated (still shown) and not saved again until it is redone or the inputs come back.
  const [careFp, setCareFp] = useState<string | null>(null);
  const [planFp, setPlanFp] = useState<string | null>(null);
  // The inputs a read or plan is built from, written the moment they change (before React re-renders).
  // A reply is checked against these when it lands, so a change whose render or effect has not run yet still counts.
  const live = useRef({ text, photo, language, level, care, removed, barriers, zip, loc, locating, note });
  const setText = (v: string) => { live.current.text = v; setTextState(v); };
  const setPhoto = (v: File | null) => { live.current.photo = v; setPhotoState(v); };
  const setLanguage = (v: (typeof LANGUAGES)[number]) => { live.current.language = v; setLanguageState(v); };
  const setLevel = (v: (typeof READING_LEVELS)[number]) => { live.current.level = v; setLevelState(v); };
  const setCare = (v: CarePlanResponse | null) => { live.current.care = v; setCareState(v); };
  const setZip = (v: string) => { live.current.zip = v; setZipState(v); };
  const setLoc = (v: { lat: number; lng: number } | null) => { live.current.loc = v; setLocState(v); };
  const setLocating = (v: boolean) => { live.current.locating = v; setLocatingState(v); };
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
    return readFingerprintFor({ text: l.text, photo: l.photo, language: l.language, level: l.level });
  };
  const livePlanFp = () => {
    const l = live.current;
    const careIds = (l.care?.items ?? []).filter((i) => !l.removed[i.id]).map((i) => i.id);
    return planFingerprint({ careIds, barriers: l.barriers, language: l.language, note: l.note, place: planPlace(!!l.loc, l.zip, l.locating), location: l.loc });
  };
  // Photo reads: the quote check runs against the AI's own reading of the photo, so the person checks that reading first.
  const [transcript, setTranscript] = useState<string | null>(null);
  const [photoChecked, setPhotoChecked] = useState(false);
  // The photo a reading came from, kept with that reading so "Show on my paper" never boxes a different photo.
  const [readPhoto, setReadPhoto] = useState<{ for: CarePlanResponse; file: File } | null>(null);
  // Second-model meaning check: does each explanation say the same thing as its quoted line?
  const [meaning, setMeaning] = useState<MeaningState>(IDLE_MEANING);
  // One check at a time, with its own id and abort: Clear, Delete, a new read and unmount cancel it (lib/meaningRun.ts).
  const [meaningFence] = useState(() => new RunFence());
  // The steps and language the current verdicts were made for (savedPlans.ts checksKey); what a save may store.
  const meaningFor = useRef<string | null>(null);
  // The same quote checker, run again on this device (WebAssembly, loaded only after a read). Per step: did the
  // browser find the same words in the same place as the server?
  // Stored with the id of the reading it belongs to (never the reading, which holds the paper), so a newer read
  // never shows an older result and Clear leaves nothing of the paper behind.
  const [deviceRun, setDeviceRun] = useState<DeviceRun>(NO_DEVICE_RUN);
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
  const scrollAfter = useRef<ScrollRequest | null>(null);
  // A plan that just arrived: once it is on the page, decide (then, not when the reply landed) whether to open and scroll to it.
  const planNav = useRef<{ plan: PlanResponse; submittedAt: number } | null>(null);
  // The card an automatic scroll brought up, kept in place briefly while late content above it loads.
  const scrollAnchor = useRef<{ t: Tab; at: number } | null>(null);
  const [tapToPlay, setTapToPlay] = useState(false);
  // The plan card, and whether it is off screen: on phones the plan's action bar shows only while the card is on screen.
  // With no IntersectionObserver the bar simply stays.
  const planCard = useRef<HTMLDivElement | null>(null);
  const [dockAway, setDockAway] = useState(() => typeof IntersectionObserver !== "undefined");
  const hasPlan = !!plan;
  useEffect(() => {
    const el = planCard.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setDockAway(!entries.some((e) => e.isIntersecting)));
    io.observe(el);
    return () => io.disconnect();
  }, [hasPlan]);

  // "My saved plans": saved on this device only (localStorage). Nothing is stored on our side; location is never saved.
  const [store, setStore] = useState<Store>(emptyStore);
  const storeRef = useRef<Store>(emptyStore());
  const [saveFailed, setSaveFailed] = useState(false);
  const [deleteFailed, setDeleteFailed] = useState(false);
  // Ids of plans deleted on this device, from any tab (lib/tombstones.ts). Ids only, never paper text.
  const [deleted] = useState(() => new DeletedPlans(() => localStorage));
  // Session epoch: bumped whenever the open session ends (deleted, cleared, another plan opened, a new plan), so a save
  // scheduled by an earlier render never writes that session's paper back (lib/autosave.ts).
  const sessionEpoch = useRef(0);
  const [epoch, setEpoch] = useState(0);
  function endSession() { setEpoch(++sessionEpoch.current); }

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

  /** Saves the list. A plan another tab deleted is never written back; if it is the one open here, its paper is erased. */
  function writeStore(next: Store) {
    if (next === storeRef.current) return;
    const r = saveStore(() => localStorage, deleted, next);
    storeRef.current = r.store; setStore(r.store); setSaveFailed(!r.ok);
    if (r.openWasDeleted) eraseOpenPaper();
  }

  /** Puts a saved plan into the tool. Anything still running belongs to the plan being left, so it is dropped. */
  function applySession(v: Session) {
    endSession();
    pendingRead.current?.abort.abort(); pendingPlan.current?.abort.abort(); pendingRead.current = null; pendingPlan.current = null;
    readRun.current++; planRun.current++; setReading(false); setPlanning(false); stopSpeaking();
    meaningFence.cancel(); setMeaning(IDLE_MEANING);
    setError(null); setPartial([]); setTranscript(null); setPhoto(null); setReadPhoto(null); setLoc(null); locGen.current++; setLocating(false); setReady(null); setPlanReadyNote(null);
    setText(v.text); setLanguage(v.language); setLevel(v.level);
    setCare(v.care); setReadLevel(v.care ? v.level : null); setBarriers(v.barriers); setZip(v.zip); setNote(v.note);
    // A plan saved before ids were filtered out (lib/planText.ts) comes back without them. A plan with nothing to clean
    // is the same object, so its speak token stays valid; one that changed loses its token (it signed the old text), so
    // it reads with the device voice and offers no phone call.
    setPlan(v.plan && restoredPlan(v.plan)); setDone(v.done); setRemoved(v.removed); setPhotoChecked(v.photoChecked ?? false);
    // Saved plans are only written while their results match their inputs, so what comes back is current,
    // except a plan built from the device location: the position is never saved, so nothing on this page can
    // match it ("device" with no coordinates). It comes back outdated until a fresh position or a ZIP is given.
    // A save from before that rule (no `matched`) may hold later edits beside an older result: it comes back
    // outdated (a fingerprint nothing matches) until the paper is read again and the plan remade.
    const unmatched = v.matched !== true ? UNMATCHED_SAVE : null;
    setCareFp(v.care ? unmatched ?? readFingerprint({ text: v.text, photo: null, language: v.language, level: v.level }) : null);
    const fromDevice = v.plan?.located.by === "device";
    setPlanFp(v.plan ? unmatched ?? planFingerprint({
      careIds: (v.care?.items ?? []).filter((i) => !v.removed[i.id]).map((i) => i.id),
      barriers: v.barriers, language: v.language, note: v.note, place: fromDevice ? "device" : planPlace(false, v.zip), location: null,
    }) : null);
    // The second check's verdicts come back from the save itself, never by sending the paper again (the privacy page:
    // nothing is uploaded when a saved plan is reopened). Only when they were made for exactly these steps and this
    // language; a save from before verdicts were kept shows its steps as checked once (found Oct 5 on the live site).
    meaningFor.current = null;
    // Only for a save that is current (matched) and read in the plan's own language: an outdated save never gets
    // its verdicts back. (Saved data is the person's own; this guards against stale saves, not a person editing them.)
    const careLang = v.care?.language ?? v.language;
    if (v.care && v.checks && v.matched === true && careLang === v.language && v.checks.key === checksKey(v.care.items, careLang)) {
      meaningFor.current = v.checks.key;
      setMeaning({ status: "done", byId: v.checks.byId, policy: v.checks.policy }); // the policy too, or the next save drops them (Codex round 4)
    }
    setTab(restoredTab({ hasCare: !!v.care, hasPlan: !!v.plan }));
  }

  /** Empties the tool for a new plan. Saved plans stay as they are. */
  function resetTool() {
    endSession();
    pendingRead.current?.abort.abort(); pendingPlan.current?.abort.abort(); pendingRead.current = null; pendingPlan.current = null;
    setReadNote(null); setPlanNote(null); setPlanReadyNote(null); setReady(null);
    readRun.current++; planRun.current++; setReading(false); setPlanning(false); stopSpeaking();
    meaningFence.cancel(); setMeaning(IDLE_MEANING);
    setError(null); setPartial([]); setTranscript(null); setPhoto(null); setReadPhoto(null); setPhotoChecked(false); setReadLevel(null);
    setText(""); setCare(null); setPlan(null); setBarriers([]); setZip(""); setNote(""); setDone({}); setRemoved({}); setRestoredAt(null); setLoc(null); locGen.current++; setLocating(false);
    setCareFp(null); setPlanFp(null);
    setTab(1); setDeviceRun(NO_DEVICE_RUN);
  }

  // One-time load after hydration (localStorage does not exist during the server render).
  // The old single saved session moves into the list once, then its key is removed.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    let raw: string | null = null, old: string | null = null;
    try { raw = localStorage.getItem(STORE_KEY); old = localStorage.getItem(OLD_KEY); } catch {}
    const { store: found, migrated } = loadStore(raw, old, newPlanId());
    // A plan deleted on this device stays deleted, even if a tab without this check wrote it back.
    const s = dropDeleted(found, deleted.all()).store;
    storeRef.current = s; setStore(s);
    if (migrated || s !== found) { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); if (migrated) localStorage.removeItem(OLD_KEY); } catch {} }
    const open = s.plans.find((p) => p.id === s.active);
    if (open) { applySession(open); setRestoredAt(open.savedAt); }
    loaded.current = true;
    // Runs once on mount by design: applySession only calls setters and refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // A helper link (/helper) starts a fresh plan with its presets in the normal inputs. Runs after the restore above.
  const helper = useHelperArrival((p) => { newPlan(); if (p.language) setLanguage(p.language); if (p.level) setLevel(p.level); if (p.zip) setZip(p.zip); });

  // "Try it with a sample" (lib/sampleStart.ts): fill the sample in, then bring "Read my paper" into view and focus it,
  // so the next thing to press is on screen. Each bump of readJump asks for one jump, after the render that enabled it.
  const [readJump, setReadJump] = useState(0);
  const loadSample = () => { setText(SAMPLE_AVS); setPhoto(null); setTab(1); setReadJump((n) => n + 1); };
  const arriveWithSample = useEffectEvent(() => {
    // Never replace a paper the person typed or photographed; just show them the button. On a phone a restored plan
    // can be open on tab 2 or 3, where step 1 is hidden, so the button's tab is opened first either way (Codex review).
    if (mayFillSample(live.current.text, !!live.current.photo, SAMPLE_AVS)) loadSample();
    else { setTab(1); setReadJump((n) => n + 1); }
  });
  useEffect(() => {
    const toTry = () => { try { window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#try`); } catch {} };
    const fromHash = () => {
      if (window.location.hash !== TRY_SAMPLE_HASH) return;
      toTry();
      arriveWithSample();
    };
    // The home button's href is #try-sample, so a tap before this page is interactive still arrives here on load.
    // Once it is, the button also sends the event (Next changes the hash without a hashchange); tidy the hash after.
    let tidy = 0;
    const fromEvent = () => {
      arriveWithSample();
      window.clearTimeout(tidy);
      tidy = window.setTimeout(() => { if (window.location.hash === TRY_SAMPLE_HASH) toTry(); }, 100);
    };
    fromHash();
    window.addEventListener(TRY_SAMPLE_EVENT, fromEvent);
    window.addEventListener("hashchange", fromHash);
    return () => { window.clearTimeout(tidy); window.removeEventListener(TRY_SAMPLE_EVENT, fromEvent); window.removeEventListener("hashchange", fromHash); };
  }, []);
  useEffect(() => {
    if (!readJump) return;
    const askedAt = performance.now();
    const go = () => {
      // Never pull the person away: not after they have tapped, typed or scrolled since, nor out of a field they are in.
      if (lastInteraction.current > askedAt) return;
      if (isEditable(document.activeElement as HTMLElement | null)) return;
      const el = document.getElementById("read-my-paper");
      if (!el) return;
      el.scrollIntoView({ block: "center" });
      el.focus({ preventScroll: true });
    };
    // The first-visit intro (Preloader) holds the page with overflow hidden for about a second and a half, and says
    // "atlas:intro-done" twice: once mid-animation (still locked) and once after it lets go. Jump once: right away, or
    // on the first intro-done that arrives after the lock is gone, never both.
    if (document.documentElement.style.overflow === "hidden") {
      const onIntro = () => {
        if (document.documentElement.style.overflow === "hidden") return; // still locked: wait for the next one
        window.removeEventListener("atlas:intro-done", onIntro);
        go();
      };
      window.addEventListener("atlas:intro-done", onIntro);
      const stop = window.setTimeout(() => window.removeEventListener("atlas:intro-done", onIntro), 6000);
      return () => { window.clearTimeout(stop); window.removeEventListener("atlas:intro-done", onIntro); };
    }
    const frame = requestAnimationFrame(go);
    return () => cancelAnimationFrame(frame);
  }, [readJump]);

  // Is the reading (or the plan) on screen still the one these inputs would get? A plan built from an outdated reading is outdated too.
  const careOutdated = !!care && careFp !== null && readFingerprintFor({ text, photo, language, level }) !== careFp;
  // Not enough to read yet: "Read my paper" is off and a note says what to do first.
  const needsPaper = !photo && text.trim().length < 20;
  const planOutdated = !!plan && planFp !== null && (careOutdated || planFingerprint({
    careIds: (care?.items ?? []).filter((i) => !removed[i.id]).map((i) => i.id),
    barriers, language, note, place: planPlace(!!loc, zip, locating), location: loc,
  }) !== planFp);
  // The ready cue, only for the exact result that raised it and only while that result is current.
  const cueFor: Ready | null = !ready ? null
    : ready.what === "steps" ? (care === ready.ref && !careOutdated ? "steps" : null)
    : ready.what === "photo" ? (care === ready.ref && !careOutdated && !photoChecked ? "photo" : null)
    : (plan === ready.ref && !planOutdated ? "plan" : null);
  const resultsCurrent = !careOutdated && !planOutdated;
  const actionsOffReason = t(careOutdated ? "plan.offPaper" : "plan.offPlan");
  // A plan made near the device's position, with no position or ZIP now: it needs a place before it can be updated.
  const needsPlace = !!plan && plan.located.by === "device" && !loc && !/^\d{5}$/.test(zip);

  // Every change to the open plan is saved into it; the first read or plan of a new one creates it.
  // While a result on screen is outdated, nothing is saved, so a saved plan never sits beside answers it was not built for.
  useEffect(() => {
    if (!resultsCurrent) return;
    const next = autosaveStore({
      loaded: loaded.current, epoch, currentEpoch: sessionEpoch.current, store: storeRef.current,
      session: {
        text, language, level, care, barriers, zip, note, plan, done, removed, photoChecked, matched: true,
        // The check's verdicts, kept on this device with the steps they were made for (savedPlans.ts, checksKey).
        // Only verdicts made for exactly these steps: ids like item-1 repeat between readings.
        // Kept only when the server says it checked under this build's rules and model (checkPolicy.ts).
        ...(care && meaning.status === "done" && meaning.policy === CHECK_POLICY && meaningFor.current === checksKey(care.items, care.language ?? language)
          ? { checks: { key: meaningFor.current, policy: meaning.policy, byId: meaning.byId } } : {}),
      }, now: new Date().toISOString(), newId: newPlanId(),
    });
    if (next) writeStore(next);
    // writeStore only touches refs, setters and localStorage; a new render's copy changes nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, language, level, care, barriers, zip, note, plan, done, removed, photoChecked, meaning, resultsCurrent, epoch]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /**
   * Empties the tool after the open paper was deleted, and drops the on-device checker that re-checked it: a load still
   * in flight is aborted, so nothing waiting on it keeps the paper. Every path that deletes the open plan calls this.
   */
  function eraseOpenPaper() {
    resetTool();
    readAbort.current?.abort();
    forgetDeviceChecker();
  }

  /**
   * Deletes plan `id` from this device's storage (recorded for other tabs first), read back to be sure. When storage
   * still holds it, nothing changes on screen and the person is told it was not deleted (a reload would bring it back).
   */
  function deleteFromDevice(id: string): boolean {
    const r = deleteOnDevice(() => localStorage, deleted, deletePlan(storeRef.current, id), id);
    if (!r) { setDeleteFailed(true); return false; }
    storeRef.current = r.store; setStore(r.store); setSaveFailed(false); setDeleteFailed(false);
    if (r.openWasDeleted) eraseOpenPaper(); // another tab had already deleted the plan open here
    return true;
  }

  // Another tab deleted plans: drop them here too, and erase the open paper if it was one of them.
  useEffect(() => watchDeletions(window, () => localStorage, deleted, (dead) => {
    const r = dropDeleted(storeRef.current, dead);
    if (r.store !== storeRef.current) { storeRef.current = r.store; setStore(r.store); }
    if (r.openWasDeleted) eraseOpenPaper();
    // Subscribes once: the handler only uses refs, setters and eraseOpenPaper (which does the same).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  /** "Clear it from this device": deletes the open plan. Other saved plans stay. */
  function clearSaved() {
    if (storeRef.current.active && !deleteFromDevice(storeRef.current.active)) return;
    eraseOpenPaper();
  }

  function openSaved(id: string) {
    const p = storeRef.current.plans.find((x) => x.id === id);
    if (!p) return;
    writeStore(openPlan(storeRef.current, id));
    if (storeRef.current.active !== id) return; // deleted in another tab meanwhile
    applySession(p);
    setRestoredAt(p.savedAt);
  }

  function deleteSaved(id: string): boolean {
    const wasOpen = storeRef.current.active === id;
    if (!deleteFromDevice(id)) return false;
    if (wasOpen) eraseOpenPaper();
    return true;
  }

  function newPlan() {
    writeStore(closePlan(storeRef.current));
    resetTool();
  }

  function checkMeaningFor(c: CarePlanResponse) {
    // An older save has no language on its reading: use the plan's, so number words are read in the right language.
    const lang = c.language ?? language;
    meaningFor.current = checksKey(c.items, lang); // the steps these verdicts will belong to
    return runMeaningCheck(meaningFence, c.items, fetchMeaning, setMeaning, lang);
  }

  // Leaving the page cancels a meaning check still in flight.
  useEffect(() => () => meaningFence.cancel(), [meaningFence]);

  async function readPaper(corrected?: string, levelOverride?: (typeof READING_LEVELS)[number]) {
    const usedLevel = levelOverride ?? level;
    // Reading someone else's paper while a saved plan is open starts a new plan instead of overwriting it.
    const openSavedPlan = storeRef.current.plans.find((p) => p.id === storeRef.current.active);
    const fresh = corrected === undefined;
    if (readStartsNewPlan({ openPlanHasPaper: !!openSavedPlan?.care, fresh, isPhoto: fresh && !!photo, sameText: openSavedPlan?.text === text })) writeStore(closePlan(storeRef.current));
    meaningFence.cancel(); setMeaning(IDLE_MEANING);
    setReading(true); setError(null); setCare(null); setPlan(null); setDone({}); setRemoved({}); setRestoredAt(null);
    setTranscript(null); setPhotoChecked(false); setPartial([]); setTab(1);
    if (corrected !== undefined) { setPhoto(null); setText(corrected); }
    const run = ++readRun.current;
    const ac = new AbortController();
    readAbort.current = ac;
    planRun.current++; setPlanning(false); // drop any plan still on its way: it was built from the old steps
    pendingPlan.current?.abort.abort(); pendingPlan.current = null;
    pendingRead.current?.abort.abort();
    setReadNote(null); setPlanNote(null); setPlanReadyNote(null); setReady(null);
    const usePhoto = corrected === undefined && !!photo;
    pendingRead.current = {
      run, abort: ac, at: performance.now(),
      fp: readFingerprintFor({ text: corrected ?? text, photo: usePhoto ? photo : null, language, level: usedLevel }),
    };
    try {
      const body: Record<string, unknown> = { language, reading_level: usedLevel };
      if (corrected !== undefined) body.text = corrected;
      else if (photo) { body.image_base64 = await fileToBase64(photo); body.image_media_type = "image/jpeg"; } else body.text = text;
      if (readRun.current !== run) return; // cleared or replaced while the photo was prepared: never send it
      let json: CarePlanResponse;
      if (typeof body.text === "string") {
        // Pasted text: show each verified step as it arrives. Photos keep the plain route (the person checks our reading first).
        // If the stream broke part way, drop what we showed and read it again the plain way, unless this read was cleared.
        json = await streamThenPlain(
          (signal) => streamExtract(body, (it) => { if (readRun.current === run && pendingRead.current?.fp === liveReadFp()) setPartial((p) => [...p, it]); }, signal),
          (signal) => postExtract(body, signal),
          ac.signal, () => readRun.current === run, () => setPartial([]),
        );
      } else json = await postExtract(body, ac.signal);
      if (readRun.current !== run) return;
      const sent = pendingRead.current;
      if (!sent || sent.run !== run) return;
      if (sent.fp !== liveReadFp()) return stopStaleRead(); // changed after sending; the change's effect may not have run yet
      pendingRead.current = null;
      setPartial([]);
      setCare(json);
      setCareFp(sent.fp);
      if (json.source_kind === "image" && photo) setReadPhoto({ for: json, file: photo });
      setReadLevel(usedLevel);
      if (json.source_kind === "image") {
        setTranscript(json.source_text);
        // The photo check waits in step 1; if they moved on while it read, the cue brings them back to it (Codex review, round 5).
        if (!autoScrollOk(sent.at)) setReady({ what: "photo", ref: json });
        return;
      }
      void checkMeaningFor(json);
      // Scroll after the steps render (scrolling now would aim at where step 2 was before they appeared),
      // and only if the person has not scrolled, tapped or typed since pressing the button.
      const target = scrollTargetAfter("read", isPhoneNow());
      if (!autoScrollOk(sent.at)) setReady({ what: "steps", ref: json }); // they moved on: offer the way back instead of moving them
      else if (target) scrollAfter.current = { t: target, onlyIfHidden: false, anchor: true, submittedAt: sent.at, ready: { what: "steps", ref: json } };
    } catch (e) {
      if (readRun.current !== run) return; // stopped or replaced: nothing to show
      if (pendingRead.current?.run === run && pendingRead.current.fp !== liveReadFp()) return stopStaleRead();
      pendingRead.current = null;
      setPartial([]);
      // The server's words are English: they go to the console, and the person reads a fixed line in their language.
      console.error("read failed", e instanceof RequestFailed ? e.status : "", e instanceof Error ? e.message : e);
      setError(t(failureKey(e, "read")));
    }
    finally { if (readRun.current === run) setReading(false); }
  }

  // A pending read or plan whose inputs changed is stopped, its late reply ignored, and a short note says why.
  function stopStaleRead() {
    readRun.current++; pendingRead.current?.abort.abort(); pendingRead.current = null;
    setReading(false); setPartial([]);
    setReadNote(t("paper.readStopped"));
  }

  function stopStalePlan() {
    planRun.current++; pendingPlan.current?.abort.abort(); pendingPlan.current = null;
    setPlanning(false);
    setPlanNote(t("needs.planStopped"));
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
    // No plan while a location request is out: it would be made for a place the person is replacing.
    if (needsPhotoCheck || live.current.locating) return;
    const run = ++planRun.current;
    pendingPlan.current?.abort.abort();
    const abort = new AbortController();
    const careIds = (care?.items ?? []).filter((i) => !removed[i.id]).map((i) => i.id);
    pendingPlan.current = { run, abort, at: performance.now(), fp: planFingerprint({ careIds, barriers, language, note, place: planPlace(!!loc, zip, locating), location: loc }) };
    setPlanning(true); setError(null); setPlan(null); setPlanNote(null); setPlanReadyNote(null); setReady(null);
    try {
      const body = {
        care: (care?.items ?? []).filter((i) => !removed[i.id]).map((i) => ({ id: i.id, kind: i.kind, title: i.title, plain_language: i.plain_language, when: i.when, source_quote: i.source_quote })),
        barriers, language, note,
        ...(loc ? { location: loc } : /^\d{5}$/.test(zip) ? { zip } : {}),
      };
      let res: Response;
      try {
        res = await fetch("/api/plan", { method: "POST", headers: { "Content-Type": "application/json", ...entryHeaders() }, body: JSON.stringify(body), signal: abort.signal });
      } catch (e) {
        if (abort.signal.aborted) throw e;
        throw new RequestFailed(0, "Network error");
      }
      // Read now, judged after the staleness checks below: a late failure for a changed plan is never shown.
      const reply = await replyJson<PlanResponse>(res).then((json) => ({ json }), (err: unknown) => ({ err }));
      if (planRun.current !== run) return; // a new read, a clear, or a changed answer happened meanwhile
      const sent = pendingPlan.current;
      if (!sent || sent.run !== run) return;
      if (sent.fp !== livePlanFp()) return stopStalePlan(); // changed after sending; the change's effect may not have run yet
      pendingPlan.current = null;
      if ("err" in reply) throw reply.err;
      const json = reply.json;
      setPlan(json);
      setDone(dropPlanTicks); // ticks belong to the plan's steps; a new plan starts with none
      setPlanFp(sent.fp);
      consumeHelperSession();
      // Step 3 only exists after this render; what happens next is decided once it is on the page.
      planNav.current = { plan: json, submittedAt: sent.at };
    } catch (e) {
      if (planRun.current !== run) return;
      if (pendingPlan.current?.run === run && pendingPlan.current.fp !== livePlanFp()) return stopStalePlan();
      pendingPlan.current = null;
      console.error("plan failed", e instanceof RequestFailed ? e.status : "", e instanceof Error ? e.message : e);
      setError(t(failureKey(e, "plan")));
    }
    finally { if (planRun.current === run) setPlanning(false); }
  }

  // Asking again drops the old position at once: a plan built from it is outdated until this request answers.
  // Only the latest request counts (a typed ZIP also supersedes any request still out).
  function useMyLocation() {
    if (!navigator.geolocation) return setError(t("needs.noGeo"));
    const gen = ++locGen.current;
    setLoc(null); setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        if (locGen.current !== gen) return;
        setLocating(false); setLoc({ lat: p.coords.latitude, lng: p.coords.longitude }); setZip("");
      },
      () => {
        if (locGen.current !== gen) return;
        setLocating(false); setError(t("needs.geoDenied"));
      },
      { timeout: 8000 },
    );
  }

  // The phone's own voice. One utterance per line: Chrome silently stops a single long utterance after about 15 seconds.
  // If the browser never starts (iPhone Safari can ignore speech that isn't started by a tap), give up after 5 seconds.
  function phoneVoice(lines: string[], run: number) {
    if (!("speechSynthesis" in window)) { setSpeaking(false); setVoiceNote(t("voice.cant")); return; }
    setVoiceNote(t("voice.phone"));
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
      setVoiceNote(t("voice.didntStart"));
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
      if (e instanceof DOMException && e.name === "NotAllowedError") { setTapToPlay(true); setVoiceNote(t("voice.tapPlay")); }
      else fallBack(run);
    }
  }

  // Natural voice first (server, ElevenLabs); the phone's voice if that is off, busy, too long, or has no voice for this language.
  async function speak() {
    if (!plan || typeof window === "undefined") return;
    if (speaking) return stopSpeaking();
    if (planOutdated) return;
    silence();
    const run = speechRun.current;
    const lines = speechLines(plan, planItems);
    speechLinesRef.current = lines;
    setSpeaking(true);
    setVoiceNote("");
    const text = lines.join("\n");
    // The paid voice reads only the plan's own signed text; with the paper's words added, the device's voice reads it.
    if (text.length > MAX_SPEAK_CHARS || !plan.speak_token || !paidVoiceAllowed(plan, lines)) return phoneVoice(lines, run);
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

  // An outdated plan is not read aloud or printed as a handoff: stop any reading in progress the moment it goes out of date,
  // and drop a handoff print still set up (its sheet is no longer rendered).
  useEffect(() => {
    // Stopping speech sets state, on purpose: the reading must end the moment the plan goes out of date.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (planOutdated) { stopSpeaking(); document.documentElement.classList.remove("print-sheet", "print-view"); }
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
    lastScrollY.current = window.scrollY;
    const onScroll = (e: Event) => {
      const now = performance.now();
      // Chrome fires a scroll event without moving the page when content appears (measured live, Oct 4: pressing
      // Make my plan inserts the working card and a scroll event arrives at the same scrollY). Nothing moved, so it is
      // not the person, and a phone left alone must still open its plan (Akhil's report).
      // Only the page's own scroll is checked this way: a scroll inside a box (the paper viewer, a long list) reaches this
      // capture listener too without moving the page, and is still the person (Codex review).
      const y = window.scrollY;
      const t = e.target;
      const isBox = t instanceof Element && t !== document.documentElement && t !== document.body;
      if (!isBox) {
        const moved = Math.abs(y - lastScrollY.current) >= 1;
        lastScrollY.current = y;
        if (!moved) return;
      }
      if (scrollIsPersons({ now, y, own: ownScroll.current, layout: layoutShift.current })) lastInteraction.current = now;
    };
    // The page's own scroll is over. If it stopped short of (or past) its target, the person moved it.
    const onScrollEnd = () => {
      const own = ownScroll.current;
      if (!own) return;
      ownScroll.current = null;
      const now = performance.now();
      if (now <= own.until && ownScrollEndedByPerson({ y: window.scrollY, own, layout: layoutShift.current, now })) lastInteraction.current = now;
      releaseWaitingScroll();
    };
    window.addEventListener("scroll", onScroll, opts);
    window.addEventListener("scrollend", onScrollEnd, opts);
    // A size change while the page's own scroll is moving re-aims its path at where the target sits now,
    // so a drag off that path is still seen once the browser's own adjustment has passed.
    // The position here already includes the browser's adjustment, so only a scroll event reporting it is the browser's.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const now = performance.now();
      layoutShift.current = { at: now, y: window.scrollY };
      const own = ownScroll.current, el = ownScrollEl.current;
      if (own && el?.isConnected && now <= own.until) ownScroll.current = rebaseOwnScroll(own, { y: window.scrollY, to: scrollTargetY(el) });
    });
    ro?.observe(document.body);
    return () => {
      kinds.forEach((k) => window.removeEventListener(k, mark, opts));
      window.removeEventListener("scroll", onScroll, opts);
      window.removeEventListener("scrollend", onScrollEnd, opts);
      ro?.disconnect();
      if (waitingTimer.current) clearTimeout(waitingTimer.current);
      waitingScroll.current = null;
    };
    // Reads refs only (runScrollRef holds the latest runScroll).
  }, []);

  /** The waiting automatic scroll goes now (checked again against use of the page), or is dropped. */
  function releaseWaitingScroll() {
    if (waitingTimer.current) { clearTimeout(waitingTimer.current); waitingTimer.current = null; }
    const req = waitingScroll.current;
    waitingScroll.current = null;
    if (req) runScrollRef.current(req);
  }

  /** Waits for the page's own scroll to settle: at scrollend, or when its time is up, short of its target counting as the person. */
  function waitForOwnScroll(req: ScrollRequest, own: OwnScroll) {
    waitingScroll.current = req;
    if (waitingTimer.current) clearTimeout(waitingTimer.current);
    waitingTimer.current = setTimeout(() => {
      waitingTimer.current = null;
      if (!waitingScroll.current) return;
      // Judge the page's scroll as it is now: re-aimed by a size change since, or a newer one (the anchor putting
      // the card back), which is waited out in turn. No page scroll left means scrollend already judged it.
      const still = ownScroll.current;
      if (still && performance.now() <= still.until) return waitForOwnScroll(waitingScroll.current, still);
      if (still) {
        ownScroll.current = null;
        if (!ownScrollArrived({ y: window.scrollY, own: still })) lastInteraction.current = performance.now();
      }
      releaseWaitingScroll();
    }, Math.max(0, own.until - performance.now()) + 20);
  }

  function markOwnScroll(s: PageScroll | null) {
    if (!s) return;
    const now = performance.now();
    ownScroll.current = { start: now, until: now + (s.behavior === "smooth" ? OWN_SCROLL_MS : OWN_INSTANT_SCROLL_MS), from: s.from, to: s.to };
    ownScrollEl.current = s.el;
  }

  function runScroll(req: ScrollRequest) {
    // An automatic scroll is checked again here: a tap or scroll since the button press cancels it.
    // Cancelled: offer the way back instead, so the result is never left off screen with no sign of it.
    if (req.submittedAt !== undefined && !autoScrollOk(req.submittedAt)) { scrollAnchor.current = null; if (req.ready) setReady(req.ready); return; }
    const own = ownScroll.current;
    if (req.submittedAt !== undefined && own && performance.now() <= own.until) return waitForOwnScroll(req, own);
    markOwnScroll(scrollToPanel(req.t, req.onlyIfHidden));
    scrollAnchor.current = req.anchor ? { t: req.t, at: performance.now() } : null;
  }

  runScrollRef.current = runScroll;

  // A read or plan whose inputs changed while it was pending is stopped, so its late reply can't land.
  useEffect(() => {
    const r = pendingRead.current;
    if (!r || r.run !== readRun.current) return;
    if (readFingerprintFor({ text, photo, language, level }) === r.fp) return;
    stopStaleRead();
    // stopStale* reads only this render's t, whose language is already a dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, photo, language, level]);

  useEffect(() => {
    const p = pendingPlan.current;
    if (!p || p.run !== planRun.current) return;
    const careIds = (care?.items ?? []).filter((i) => !removed[i.id]).map((i) => i.id);
    if (planFingerprint({ careIds, barriers, language, note, place: planPlace(!!loc, zip, locating), location: loc }) === p.fp) return;
    stopStalePlan();
    // stopStale* reads only this render's t, whose language is already a dependency here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [care, removed, barriers, language, note, loc, zip, locating]);

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
    else setPlanReadyNote(t("plan.ready"));
    if (!free) setReady({ what: "plan", ref: nav.plan }); // they moved on: the floating "Your plan is ready" button takes them there
    const target = scrollTargetAfter("plan", phone);
    if (!target || !free) return;
    const next: ScrollRequest = { t: target, onlyIfHidden: false, anchor: true, submittedAt: nav.submittedAt, ready: { what: "plan", ref: nav.plan } };
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
    loadDeviceChecker()
      .then((checker) => {
        if (!live) return; // cleared or changed while the checker loaded: never hand it this paper
        const byId: Record<string, DeviceVerdict> = {};
        // One call for the whole plan: the paper is mapped once, not once per step.
        const spans = checker.findSpans(care.source_text, care.items.map((it) => it.source_quote));
        care.items.forEach((it, k) => {
          const mine = spans[k];
          byId[it.id] = sameSpan(it.span, mine) ? "match" : mine ? "differ" : "missing";
        });
        if (live) setDeviceRun({ run: runIdFor(care), ok: true, byId });
      })
      .catch(() => { if (live) setDeviceRun({ run: runIdFor(care), ok: false, byId: {} }); });
    return () => { live = false; };
  }, [care, deviceWanted]);

  function pickTab(t: Tab, onlyIfHidden = true) {
    setTab(t);
    if (t === 3) { setPlanReadyNote(null); setReady((r) => (r?.what === "plan" ? null : r)); } // they opened the plan
    scrollAfter.current = { t, onlyIfHidden };
  }

  // "Show me" on the ready cue: the plan opens step 3; the steps (or the photo check) come to the top of step 1.
  // Focus then follows to the result's heading, so keyboard and screen-reader users land there too (Codex review).
  function goToReady(r: Ready) {
    setReady(null);
    const focusTarget = () => readyTarget(r)?.focus({ preventScroll: true });
    if (r === "plan") {
      pickTab(3, false);
      requestAnimationFrame(() => requestAnimationFrame(focusTarget)); // after step 3 has rendered and scrolled
      return;
    }
    setTab(1);
    requestAnimationFrame(() => {
      const el = readyTarget(r);
      if (!el) return;
      const calm = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.style.scrollMarginTop = `${landingTop(el)}px`; // clear of whatever covers the top on this screen
      markOwnScroll(scrollElementToTop(el, calm ? "auto" : "smooth"));
      focusTarget();
    });
  }

  // The handoff sheet shown on screen as the page, printed from its bar (printView.ts, PrintViewBar).
  function printSheet(e: { currentTarget: Element }) {
    if (planOutdated) return;
    printOrView(HANDOFF_SHEET, e.currentTarget);
  }

  // Print the plan page; where the browser can't print from a button (Chrome on iPhone, or an app's browser that never
  // starts a print), the handoff sheet, which holds the plan and the paper's words, is shown on screen to print from
  // the browser's menu instead (printView.ts).
  function printPlan(e: { currentTarget: Element }) {
    if (planOutdated) return;
    printPageOr(HANDOFF_SHEET, e.currentTarget);
  }

  const careById = Object.fromEntries((care?.items ?? []).map((i) => [i.id, i]));
  // Show "Book it now" once per thing to book: on the first plan step that serves it.
  const bookAt = new Map<string, number>();
  plan?.steps.forEach((s, i) => {
    const b = bookableItem(s.care_ids.map((id) => careById[id]).filter(Boolean));
    if (b && !bookAt.has(b.id)) bookAt.set(b.id, i);
  });
  // "Start with these 3": the verified places that help with the most plan steps (lib/planTop.ts, no AI).
  const top = plan ? topResources(plan) : [];
  const items = (care?.items ?? []).filter((i) => !removed[i.id]);
  // Every grounded step the plan could point at, removed or not: a plan step's paper quote never drops out (round 12).
  const planItems = (care?.items ?? []).filter((i) => i.grounded);
  // Paper first (lib/paperFirst.ts): only a step the second check certified, and this device's own check did not
  // dispute, may lead with its explanation.
  const checkFor = (id: string): Check => {
    if (care && deviceRun.run === runIdFor(care) && deviceRun.ok && deviceRun.byId[id] && deviceRun.byId[id] !== "match") return "flagged";
    return meaning.status === "done" ? checkOf(meaning.byId[id]) : "unchecked";
  };
  // The same rule for what leaves the screen (share, print): a step this device disputed is never certified there.
  const paperMeaning = {
    status: meaning.status,
    byId: Object.fromEntries(Object.entries(meaning.byId).map(([id, r]) => [id, checkFor(id) === "flagged" ? { ...r, certified: false, flagged: true } : r])),
  };
  // Questions for the next visit, paper first (lib/visitQuestions.ts): a step's own question only when certified.
  // General questions with every step's own question taken out, held-back steps included, before any surface uses them.
  const generalQuestions = care ? readingGeneralQuestions(care) : [];
  const nextVisitTagged = care ? visitQuestionsTagged({ items: items.filter((i) => i.grounded), general: generalQuestions, also: care.items, checkFor }) : [];
  const nextVisit = nextVisitTagged.map((q) => q.text);
  // A photo's steps quote the AI's own reading of it, so nothing is shown or planned until the person checks that reading.
  const needsPhotoCheck = care?.source_kind === "image" && !photoChecked;
  const removedItems = (care?.items ?? []).filter((i) => removed[i.id]);
  const missed = useMissedLines(care, removed);
  const deviceStatus = deviceStatusOf(care, needsPhotoCheck, deviceRun);
  const flow = { hasCare: !!care, hasPlan: !!plan };
  const openName = store.plans.find((p) => p.id === store.active)?.name ?? null;
  // The person changed our reading of their photo. Accepting or re-reading the old text would silently drop their fix.
  const transcriptEdited = !!care && isTranscriptEdited(transcript, care.source_text);
  const simplerOk = canMakeSimpler({ readLevel, hasCare: !!care, needsPhotoCheck, reading, sourceLength: care?.source_text.trim().length ?? 0, transcriptEdited, hasPlan: !!plan, planning });
  const shown = shownTab(tab, flow);
  // The phone tab bar's "Your plan is ready" holds to the same rule as the cue: never for an outdated plan (Codex review, round 4).
  const phonePlanNote = plan && shown !== 3 && !planOutdated ? planReadyNote : null;
  // Phones: one step card at a time. Hidden cards stay mounted (state, timers and requests carry on).
  const panel = (t: Tab) => ({
    id: panelId(t),
    ...(isPhone ? { role: "tabpanel", "aria-labelledby": tabId(t) } : {}),
  });
  const onPhone = (t: Tab) => (t === shown ? "" : "max-md:hidden");

  return (
    <UiLangProvider language={language} paperLang={paperLangCode(care?.source_text ?? text)}>
    <section id="try" lang={UI_LANG_CODE[language]} className="relative px-3 mt-3 scroll-mt-20" aria-labelledby="try-title">
      <div className="section-card bg-mint-soft px-4 sm:px-10 py-20">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 id="try-title" tabIndex={-1} className="display text-[clamp(2.4rem,5vw,5rem)]">{t("paper.sectionTitle")}</h2>
          <p className="hand text-3xl text-teal-deep rotate-1 max-w-[16em]">{t("paper.sectionNote")}</p>
        </div>

        {restoredAt && (
          <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-teal bg-paper p-4">
            <p className="font-bold">{t("paper.welcomeBack")} {openName ? t("paper.savedNamed", { name: openName, when: new Date(restoredAt).toLocaleString(UI_LANG_CODE[language]) }) : t("paper.savedHere", { when: new Date(restoredAt).toLocaleString(UI_LANG_CODE[language]) })}</p>
            <button type="button" onClick={clearSaved} className="rounded-full border-2 border-ink px-4 py-1.5 text-sm font-bold hover:bg-red-soft">{t("paper.clearSaved")}</button>
          </div>
        )}

        <HelperBanner arrival={helper.arrival} onDismiss={helper.dismiss} />

        <SavedPlans plans={listPlans(store)} activeId={store.active} busy={reading || planning} saveFailed={saveFailed} deleteFailed={deleteFailed}
          onOpen={openSaved} onRename={(id, name) => writeStore(renamePlan(storeRef.current, id, name))} onDelete={deleteSaved} onNew={newPlan} />

        {error && <p role="alert" className="mt-6 rounded-2xl border-2 border-red bg-red-soft p-4 font-bold text-red">{error}</p>}

        <PhoneTabBar shown={shown} state={flow} onPick={pickTab} notice={phonePlanNote} />
        {/* Only while that exact result is still on screen and current; the tab bar already announces the phone plan. */}
        <ReadyCue ready={cueFor} announce={!(cueFor === "plan" && !!phonePlanNote)} onGo={goToReady} onSeen={clearReady} />

        {/* Step 1 */}
        <div {...panel(1)} className={`card mt-10 max-md:mt-4 p-5 sm:p-8 max-md:scroll-mt-44 ${onPhone(1)}`}>
          <StepHeader n={1} title={t("paper.title")} done={!!care} note={t("paper.titleNote")} />
          <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_15rem]">
            <div>
              <textarea data-lenis-prevent aria-label={t("paper.textLabel")} className="h-44 w-full rounded-2xl border-2 border-ink/70 bg-paper p-4 text-sm focus:border-teal"
                placeholder={t("paper.placeholder")} value={text} onChange={(e) => { setText(e.target.value); setPhoto(null); }} />
              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm font-bold">
                <button type="button" className="rounded-full border-2 border-ink px-4 py-2 hover:bg-mint" onClick={loadSample}>{t("paper.useSample")}</button>
                <label className="cursor-pointer rounded-full border-2 border-ink px-4 py-2 hover:bg-mint">
                  📷 {photo ? photo.name : t("common.photoButton")}
                  <input type="file" accept="image/*" capture="environment" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0] ?? null; setPhoto(f); if (f) setText(""); }} />
                </label>
              </div>
              <p className="mt-2 text-xs text-ink/70">{language === "English" ? SAMPLE_LABEL : t("paper.sampleLabel")}.</p>
              <div className="mt-5"><ReadIn language={language} level={level} onLanguage={setLanguage} onLevel={setLevel} /></div>
            </div>
            <div className="flex flex-col gap-3">
              {/* A greyed-out button alone says nothing; say what to do first (the Oct 4 watched try). */}
              {needsPaper && <p id="read-hint" className="mt-auto text-sm font-bold text-ink/80">{t("paper.addFirst")}</p>}
              <SquashButton id="read-my-paper" onClick={() => readPaper()} disabled={reading || needsPaper} describedBy={needsPaper ? "read-hint" : undefined}
                bg="var(--teal)" accent="var(--sun)" className={needsPaper ? "" : "mt-auto"}>
                {reading ? t("common.reading") : t("paper.read")}
              </SquashButton>
            </div>
          </div>

          {readNote && <p role="status" className="mt-4 rounded-2xl border-2 border-sun bg-paper p-3 text-sm font-bold">{readNote}</p>}
          {careOutdated && !reading && (
            <div role="status" className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-sun bg-paper p-3 text-sm font-bold">
              <p className="flex-1 min-w-[14rem]">{t("paper.changedAfterRead")}</p>
              <button type="button" onClick={() => readPaper()} disabled={!photo && text.trim().length < 20}
                className="rounded-full border-2 border-ink bg-sun px-4 py-1.5 disabled:opacity-40">{t("paper.readAgain")}</button>
            </div>
          )}
          {/* Always mounted so screen readers hear each count change; one update per verified step, never per word. */}
          <p className="sr-only" role="status" aria-live="polite">
            {reading && partial.length > 0 ? tn("stepsFoundSoFar", partial.length) : ""}
          </p>
          {reading && partial.length === 0 && <WorkingCard kind="read" />}
          {reading && partial.length > 0 && <StreamingSteps items={partial} />}

          {care && needsPhotoCheck && (
            <div className="mt-8 rounded-2xl border-2 border-sky-deep bg-sky/60 p-4 sm:p-5">
              <p id="photo-check-title" tabIndex={-1} className="font-extrabold scroll-mt-28 outline-none focus-visible:outline-3 focus-visible:outline-teal-deep">{t("paper.checkPhotoTitle")}</p>
              <p className="text-sm font-semibold text-ink/70">
                {ts("paper.checkPhotoBody")}
              </p>
              <textarea data-lenis-prevent aria-label={t("paper.photoTextLabel")} className="mt-3 h-44 w-full rounded-2xl border-2 border-ink/70 bg-paper p-4 text-sm focus:border-teal"
                value={transcript ?? care.source_text} onChange={(e) => setTranscript(e.target.value)} />
              <div className="mt-3 flex flex-wrap gap-3 text-sm font-bold">
                <button type="button" className="rounded-full bg-ink text-paper px-4 py-2 disabled:opacity-40"
                  disabled={reading || (transcript ?? care.source_text).trim().length < 20 || transcript === care.source_text}
                  onClick={() => readPaper(transcript ?? care.source_text)}>{t("paper.useCorrected")}</button>
                <button type="button" className="rounded-full border-2 border-ink px-4 py-2 hover:bg-mint disabled:opacity-40"
                  disabled={transcriptEdited} aria-describedby={transcriptEdited ? "photo-edited" : undefined}
                  onClick={() => { setPhotoChecked(true); void checkMeaningFor(care); }}>{ts("paper.itMatches")}</button>
                {transcriptEdited && (
                  <button type="button" className="rounded-full border-2 border-ink px-4 py-2 hover:bg-mint" onClick={() => setTranscript(care.source_text)}>{t("paper.undoChanges")}</button>
                )}
              </div>
              {transcriptEdited && (
                <p id="photo-edited" className="mt-2 text-sm font-bold text-ink/70">{t("paper.photoEdited")}</p>
              )}
            </div>
          )}

          {care && !needsPhotoCheck && (
            <div>
              {/* "Your steps", grouped by when (CareSteps.tsx). Every row follows the paper-first rule. */}
              <CareSteps key={runIdFor(care)} care={care} items={items} removedItems={removedItems} checkFor={checkFor} meaning={meaning}
                deviceRun={deviceRun} deviceStatus={deviceStatus} done={done} language={language}
                onDone={(id, v) => setDone((d) => ({ ...d, [id]: v }))}
                onRemove={(id) => setRemoved((r) => ({ ...r, [id]: true }))}
                onUndoRemove={(id) => setRemoved((x) => { const n = { ...x }; delete n[id]; return n; })}
                photo={readPhoto?.for === care ? readPhoto.file : null} simpler={{ ok: simplerOk, onClick: makeSimpler }} />
              <MissedLines view={missed} />
              <Understand key={`${care.source_text.length}:${items.map((i) => i.id).join(",")}:${language}`} care={care} items={items} language={language} />
              {/* "Ask my paper": answers only in the paper's own words, checked, or "your paper doesn't say" (lib/ask.ts). */}
              {/* Off while the paper on screen differs from the one read: it would answer from the old text (Codex review). */}
              {!careOutdated && <AskPaper key={`${runIdFor(care)}:${language}`} care={care} items={items} language={language}
                photo={readPhoto?.for === care ? readPhoto.file : null} />}
              <button type="button" onClick={() => pickTab(2, false)}
                className="md:hidden mt-8 w-full rounded-full border-2 border-ink bg-sun px-5 py-3 text-lg font-extrabold shadow-[0_3px_0_var(--ink)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-teal-deep">
                {t("paper.nextNeeds")}
              </button>
            </div>
          )}
        </div>

        {/* Step 2 */}
        <div {...panel(2)} className={`card mt-6 max-md:mt-4 p-5 sm:p-8 scroll-mt-24 max-md:scroll-mt-44 ${onPhone(2)}`}>
          <StepHeader n={2} title={t("needs.title")} done={!!plan} note={t("needs.note")} />
          <div className="mt-6 flex flex-wrap gap-2.5" role="group" aria-label={t("needs.group")}>
            {BARRIERS.map((b) => {
              const on = barriers.includes(b);
              return (
                <button key={b} type="button" aria-pressed={on} onClick={() => setBarriers((x) => (on ? x.filter((y) => y !== b) : [...x, b]))}
                  className={`rounded-full border-2 border-ink px-4 py-2.5 text-sm font-bold transition-all ${on ? "bg-teal text-paper shadow-[0_3px_0_var(--ink)] -translate-y-0.5" : "bg-paper hover:bg-mint"}`}>
                  {on ? "✓ " : ""}{t(keyFor("barrier", b, "needs.group"))}
                </button>
              );
            })}
          </div>
          <div className="mt-6 grid gap-4 md:grid-cols-[14rem_1fr]">
            <div>
              <label className="text-sm font-bold" htmlFor="zip">{t("needs.zip")}</label>
              <input id="zip" inputMode="numeric" maxLength={5} className="mt-1 w-full rounded-xl border-2 border-ink/70 bg-paper p-2.5"
                placeholder={t("needs.zipExample")} value={zip} onChange={(e) => { setZip(e.target.value.replace(/\D/g, "")); setLoc(null); locGen.current++; setLocating(false); }} />
              <button type="button" onClick={useMyLocation} className="mt-2 text-sm font-bold underline decoration-2 underline-offset-4">
                {locating ? t("needs.locating") : loc ? t("needs.usingLocation") : t("needs.useLocation")}
              </button>
            </div>
            <label className="text-sm font-bold">{t("needs.anythingElse")}
              <textarea data-lenis-prevent className="mt-1 h-24 w-full rounded-xl border-2 border-ink/70 bg-paper p-2.5" placeholder={t("needs.anythingElseExample")}
                value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
          </div>
          <div className="mt-6">
            <SquashButton onClick={makePlan} disabled={planning || needsPhotoCheck || locating || (barriers.length === 0 && items.length === 0)} bg="var(--ink)" accent="var(--mint)">
              {planning ? t("needs.building") : t("needs.makePlan")}
            </SquashButton>
            {needsPhotoCheck && <p className="mt-3 text-sm font-bold text-ink/70">{t("needs.checkPhotoFirst")}</p>}
            {planNote && <p role="status" className="mt-3 rounded-2xl border-2 border-sun bg-paper p-3 text-sm font-bold">{planNote}</p>}
            {planning && <WorkingCard kind="plan" />}
          </div>
        </div>

        {plan && care && !planOutdated && <HandoffSheet items={items.filter((i) => i.grounded)} plan={plan} questions={generalQuestions} language={language} meaning={paperMeaning} planItems={planItems} alsoOnPaper={missedLineTexts(missed)} paper={care.source_text} />}

        {/* Step 3 */}
        {plan && (
          <div {...panel(3)} ref={planCard} data-outdated={planOutdated || undefined} className={`card mt-6 max-md:mt-4 p-5 sm:p-8 max-md:pb-36 scroll-mt-24 max-md:scroll-mt-44 ${planOutdated ? "plan-outdated" : ""} ${onPhone(3)}`}>
            {/* Printing from the browser menu while the plan is outdated prints only this, never the outdated plan. */}
            {planOutdated && <p className="outdated-print-note">{t("plan.outdatedPrint", { reason: actionsOffReason })}</p>}
            <StepHeader n={3} id="plan-title" title={t("plan.title")} done note={locatedLine(language, plan.located)} />
            {planOutdated && (
              <div role="status" className="mt-4 flex flex-wrap items-center gap-3 rounded-2xl border-2 border-sun bg-sun/30 p-3 text-sm font-bold">
                {careOutdated
                  ? <p>{t("plan.outdatedPaper")}</p>
                  : <>
                      <p className="flex-1 min-w-[14rem]">
                        {needsPlace
                          ? t("plan.outdatedPlace")
                          : t("plan.outdatedAnswers")}
                      </p>
                      <button type="button" onClick={makePlan} disabled={planning || needsPlace || locating || (barriers.length === 0 && items.length === 0)}
                        className="rounded-full border-2 border-ink bg-sun px-4 py-1.5 disabled:opacity-40">{t("plan.update")}</button>
                    </>}
              </div>
            )}
            <p className="mt-4 text-xs font-bold uppercase tracking-wide text-ink/70">{ts("plan.suggestions")}</p>
            <p className="mt-1 text-lg font-semibold max-w-[50em]">{plan.summary}</p>
            {/* On the first screen at every width: right under the summary, before the actions and the three calls. */}
            {plan.ask_a_person && (
              <div className="mt-4 rounded-2xl border-2 border-peach-deep bg-peach p-4 max-w-[50em]">
                <p className="font-extrabold text-peach-deep">{t("plan.needsPerson")}</p>
                <p className="text-sm font-semibold">{plan.ask_a_person_reason} {t("plan.call211")}</p>
                <p className="mt-2 text-xs font-semibold"><a className="underline decoration-2 underline-offset-4" href="/helper">{t("plan.helperLink")}</a></p>
              </div>
            )}
            {/* An outdated plan can't be read aloud, printed, sent, booked or called from; the on-screen note says why. */}
            {planOutdated && <p id="plan-actions-off" className="mt-3 text-sm font-bold text-peach-deep">{t("plan.actionsOff", { reason: actionsOffReason })}</p>}
            {/* One set of plan actions. Wider screens: a row under the summary. Phones: a bar fixed to the bottom while
                this card is on screen (globals.css, .plan-dock). Screen only; the print stylesheet leaves it out. */}
            <div role="group" aria-label={t("plan.actions")} data-away={dockAway || undefined} data-lenis-prevent
              className="plan-dock mt-4 flex flex-wrap items-center gap-3 text-sm font-bold">
              {tapToPlay
                ? <button type="button" onClick={() => void startAudio(speechRun.current)} disabled={planOutdated} aria-describedby={planOutdated ? "plan-actions-off" : undefined} className="rounded-full border-2 border-ink bg-sun px-4 py-2 disabled:opacity-40"><DockLabel icon="▶" short={t("dock.play.short")} long={t("dock.play.long")} /></button>
                : <button type="button" onClick={speak} aria-pressed={speaking} disabled={planOutdated} aria-describedby={planOutdated ? "plan-actions-off" : undefined}
                    className={`rounded-full border-2 border-ink px-4 py-2 disabled:opacity-40 ${speaking ? "bg-ink text-paper" : "bg-sun"}`}>
                    {speaking ? <DockLabel icon="⏹" short={t("dock.stop.short")} long={t("dock.stop.long")} /> : <DockLabel icon="🔊" short={t("dock.listen.short")} long={t("dock.listen.long")} />}
                  </button>}
              {tapToPlay && <button type="button" onClick={stopSpeaking} className="rounded-full border-2 border-ink px-4 py-2"><DockLabel icon="✕" short={t("dock.cancel")} long={t("dock.cancel")} /></button>}
              {!planOutdated && <CallMe key={callMeKey(language, plan)} plan={plan} language={language} short={t("dock.callMe.short")} />}
              {care && <ShareFamily items={items} plan={plan} questions={generalQuestions} meaning={paperMeaning} planItems={planItems} disabled={planOutdated} describedBy={planOutdated ? "plan-actions-off" : undefined} short={t("dock.send.short")} />}
              <button type="button" onClick={printPlan} disabled={planOutdated} aria-describedby={planOutdated ? "plan-actions-off" : undefined} className="rounded-full border-2 border-ink px-4 py-2 disabled:opacity-40"><DockLabel icon="🖨️" short={t("dock.print.short")} long={t("dock.print.long")} /></button>
              <button type="button" onClick={printSheet} disabled={planOutdated} aria-describedby={planOutdated ? "plan-actions-off" : undefined} className="rounded-full border-2 border-ink px-4 py-2 disabled:opacity-40"><DockLabel icon="📄" short={t("dock.handoff.short")} long={t("dock.handoff.long")} /></button>
              <span role="status" className={voiceNote ? "dock-note self-center text-xs font-semibold text-ink/70" : "sr-only"}>{voiceNote}</span>
            </div>
            <p className="mt-3 text-xs font-bold text-ink/70">{tn("planStats", plan.stats.steps, { c: plan.stats.candidates, d: plan.stats.dropped_refs })}</p>
            <TopCalls top={top} chosen={barriers} language={language} off={planOutdated ? actionsOffReason : undefined} offId={planOutdated ? "plan-actions-off" : undefined} />
            <div className="mt-6">
              <section aria-labelledby="plan-rows-title" className="min-w-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h4 id="plan-rows-title" className="display text-2xl">{t("plan.yourPlanN", { steps: tn("steps", plan.steps.length) })}</h4>
                  <p className="text-xs font-bold text-ink/70">{t("plan.tapOne")}</p>
                </div>
                <ol className="mt-3 space-y-2.5">
                  {plan.steps.map((s, i) => (
                    <ProblemRow key={i} step={s} index={i} quotes={planStepQuotes(s, planItems)} resources={plan.resources}
                      done={!!done[planTickKey(i)]} onDone={(on) => setDone((d) => ({ ...d, [planTickKey(i)]: on }))}
                      off={planOutdated ? actionsOffReason : undefined}
                      bookIt={[...bookAt.values()].includes(i)
                        ? <BookIt items={s.care_ids.map((id) => careById[id]).filter(Boolean).map((i) => bookSafe(i, checkFor(i.id)))} barriers={barriers} language={language} offReason={planOutdated ? actionsOffReason : undefined} />
                        : undefined} />
                  ))}
                </ol>
              </section>
            </div>
            {nextVisit.length > 0 && (
              <div className="mt-6 rounded-2xl border-2 border-ink/70 bg-paper p-5">
                <p className="display text-2xl">{t("plan.nextVisitQuestions")}</p>
                <ul className="mt-2 list-disc pl-5 space-y-1">{nextVisitTagged.map((q, i) => <li key={i} lang={q.english ? "en" : undefined}>{q.text}</li>)}</ul>
              </div>
            )}
            {care && !planOutdated && <SessionSummary key={helperSessionKey(store.active, plan.summary)} barriers={barriers} items={items} done={done} plan={plan} questions={nextVisit} language={language} readingLevel={readLevel ?? level} />}
            <Feedback key={plan.summary} language={language} token={plan.feedback_token ?? null} />
            <p className="mt-6 text-xs text-ink/70">{t("common.notMedicalAdvice", { model: plan.model })}</p>
          </div>
        )}
      </div>
    </section>
    </UiLangProvider>
  );
}
