"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { PlanResponse } from "@/lib/plan";
import type { LANGUAGES } from "@/lib/schema";
import { paidSpeechText } from "@/lib/speechText";
import { nextPoll, pollDelayMs, pollNotice, POLL_WINDOW_MS, startPoll, type PollState } from "@/lib/call/poll";
import { DockLabel } from "./DockLabel";
import { LANGUAGE_NAME } from "@/lib/uiText";
import { useUi } from "./UiLang";

/**
 * "Call me with my plan": ATLAS phones the person and reads the plan in its language. For someone who can't read or
 * remember instructions, a call is easier than a screen. First a short call speaks a 4-digit code (that proves it is
 * their phone), then the plan call plays the same natural voice as "Read it out loud", with "press 1 to hear it again".
 * Hidden entirely when calls are off on this deployment (/api/call/config) or the plan has no speak token.
 */
type Language = (typeof LANGUAGES)[number];
type Status = {
  phase: "code" | "code_missed" | "expired" | "calling" | "done" | "failed" | "gone";
  /** From the server only while the session is live; the page keeps its own copy (`suffix`) for display. */
  last4?: string | null;
  code_status?: string | null;
  plan_status?: string | null;
  attempts_left?: number;
  /** true: the right code was entered on the plan call. false: ATLAS has no record of that. null/absent: not known. */
  gate_passed?: boolean | null;
};

const MAX_CALL_CHARS = 4000; // same limit as the natural voice (lib/voice.ts)
const MISSED = ["busy", "cancelled", "failed", "rejected", "timeout", "unanswered"];
const post = (url: string, body: unknown, signal?: AbortSignal) =>
  fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal });
/** One status poll may take this long; past it the poll counts as failed, so a hung request never stops the loop. */
const POLL_TIMEOUT_MS = 15_000;

/** The status line under the call panel. Exported for its tests. */
export function line(s: Status, suffix: string, typed: string): string {
  const n = `...${suffix}`;
  switch (s.phase) {
    case "code":
      if (s.code_status === "ringing") return `Ringing ${n} with your code...`;
      if (s.code_status === "answered") return `Answered. Listen for the 4 digits, then type them below.`;
      if (s.code_status === "completed") return `Code call finished. Type the 4 digits below.`;
      if (s.code_status === "unknown") return `We couldn't confirm the call to ${n}. If your phone rings, type the 4 digits below. If it doesn't, try again in 10 minutes.`;
      return `Calling ${n} with a 4-digit code...`;
    case "calling":
      if (!s.plan_status) return "Code is right. Getting your plan ready to call...";
      if (s.plan_status === "ringing") return `Ringing ${n} with your plan...`;
      if (s.plan_status === "unknown") return `We couldn't confirm the plan call to ${n}. If your phone rings, pick up. If it doesn't ring in a few minutes, it isn't coming, and your number and plan text will be deleted.`;
      if (s.plan_status === "answered") return `Answered. On the phone keypad, enter your code${typed ? ` ${typed.split("").join(" ")}` : ""}, then press #. Then ATLAS reads your plan; press 1 to hear it again.`;
      return `Calling ${n} with your plan. When you answer, enter your code${typed ? ` ${typed.split("").join(" ")}` : ""} on the keypad, then press #.`;
    case "done":
      if (s.plan_status && MISSED.includes(s.plan_status)) return `No one answered at ${n}. Your number and plan text were deleted.`;
      // Only an explicit false: an older server, or a status that does not know, keeps the plain wording.
      // false covers silence, wrong codes and a record that failed to save, so it says only what is true of all three.
      if (s.gate_passed === false) {
        return "The call ended, and ATLAS could not confirm your plan was read: it plays only after the 4-digit code is entered on the phone keypad. Your number and plan text were deleted. You can ask for a new call below.";
      }
      return `Call finished. Your number and plan text were deleted.`;
    case "code_missed":
      return `No one answered the code call at ${n}. You can try again.`;
    case "failed":
      return "The plan call didn't go through. Your number and plan text were deleted. You can try again.";
    default:
      return "That call has ended. You can start a new one.";
  }
}

/** `short`: a one-word label for phones (the plan's bottom bar); wider screens keep the full words. */
export function CallMe({ plan, language, short }: { plan: PlanResponse; language: Language; short?: string }) {
  const { t } = useUi();
  const [cfg, setCfg] = useState<{ enabled: boolean; languages: string[] } | null>(null);
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [consent, setConsent] = useState(false);
  const [code, setCode] = useState("");
  const [id, setId] = useState<string | null>(null);
  const [st, setSt] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [typed, setTyped] = useState(""); // the code the person typed: the plan call asks for it again before it plays
  const [suffix, setSuffix] = useState(""); // the number's last 4 digits, kept here: the server clears its copy when the call ends
  const panelId = useId();
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  // A tap or click anywhere else, or Escape, folds the panel away (Akhil, Oct 4: it only closed from its own button).
  // Only the panel hides: what was typed and a call in progress stay as they are. It listens for the finished click,
  // in the bubble phase, so the control that was tapped acts first and the bar does not shrink under the finger, and
  // keyboard and screen-reader activation (a click with no pointer) closes it too (Codex review).
  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      const t = e.target as Node | null;
      if (t && (panel.current?.contains(t) || toggle.current?.contains(t))) return;
      setOpen(false);
    };
    const esc = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOpen(false);
      toggle.current?.focus();
    };
    document.addEventListener("click", outside);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("click", outside); document.removeEventListener("keydown", esc); };
  }, [open]);
  const [poll, setPoll] = useState<PollState>(() => startPoll(0)); // restarted, timed from now, when a call is asked for
  const text = paidSpeechText(plan);
  // The plan this panel's call belongs to. A response that comes back after the plan changed (or the panel went away)
  // is dropped, so a call session can never carry over to another plan. The state reset itself comes from the parent
  // keying this panel by the plan (lib/call/callKey.ts), which remounts it empty.
  const owner = `${language}:${plan.speak_token ?? ""}:${text}`;
  const current = useRef(owner);
  useEffect(() => {
    current.current = owner;
    return () => { current.current = ""; };
  }, [owner]);

  useEffect(() => {
    let alive = true;
    fetch("/api/call/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (alive) setCfg(j && typeof j.enabled === "boolean" ? j : { enabled: false, languages: [] }); })
      .catch(() => { if (alive) setCfg({ enabled: false, languages: [] }); });
    return () => { alive = false; };
  }, []);

  // Follow the call while it is live. Every poll, failed or not, schedules the next (lib/call/poll.ts): a failure shows
  // that status is unavailable and backs off, and the loop stops at the end of the call or at its bounds.
  const live = st && (st.phase === "code" || (st.phase === "calling" && !(st.plan_status && (st.plan_status === "completed" || MISSED.includes(st.plan_status)))));
  useEffect(() => {
    if (!id || !live || poll.stopped) return;
    let alive = true;
    // Never waits past the time bound: the tick that reaches it only records it (nextPoll sets timedOut), no request.
    const delay = Math.max(0, Math.min(pollDelayMs(poll), poll.startedAt + POLL_WINDOW_MS - Date.now()));
    const timer = setTimeout(async () => {
      let j: Status | null = null;
      if (Date.now() - poll.startedAt < POLL_WINDOW_MS) {
        try {
          const r = await post("/api/call/status", { id }, AbortSignal.timeout(POLL_TIMEOUT_MS));
          j = r.ok ? ((await r.json()) as Status) : null;
        } catch { j = null; }
      }
      if (!alive || current.current !== owner) return;
      if (j && typeof j.phase === "string") setSt(j);
      setPoll((p) => nextPoll(p, j && typeof j.phase === "string" ? "ok" : "fail", Date.now()));
    }, delay);
    return () => { alive = false; clearTimeout(timer); };
  }, [id, live, poll, owner]);

  if (!cfg?.enabled || !plan.speak_token) return null;

  async function send(e: FormEvent, url: string, body: unknown, next: (j: Record<string, unknown>) => void) {
    e.preventDefault();
    const mine = owner;
    setBusy(true);
    setMsg("");
    try {
      const r = await post(url, body);
      const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (current.current !== mine) return; // the plan changed while this was in flight: not this plan's call
      if (!r.ok) throw new Error(typeof j.error === "string" ? j.error : "Something went wrong. Try again.");
      next(j);
    } catch (err) {
      if (current.current === mine) setMsg((err as Error).message);
    } finally {
      if (current.current === mine) setBusy(false);
    }
  }

  const askCode = (e: FormEvent) => send(e, "/api/call/start", { phone, consent, text, language, token: plan.speak_token }, (j) => {
    setPoll(startPoll(Date.now()));
    setId(String(j.id));
    setSuffix(typeof j.last4 === "string" ? j.last4 : "");
    setSt({ phase: "code", code_status: j.uncertain ? "unknown" : null });
    setPhone("");
    setCode("");
  });
  const verify = (e: FormEvent) => send(e, "/api/call/verify", { id, code }, (j) => {
    setPoll(startPoll(Date.now()));
    setSt((s) => ({ ...(s ?? {}), phase: "calling", plan_status: j.uncertain ? "unknown" : null }));
    setTyped(code);
    setCode("");
  });
  const restart = () => { setId(null); setSt(null); setMsg(""); setConsent(false); };

  const callable = cfg.languages.includes(language);
  const callLong = t("dock.callMe.long");
  const tooLong = text.length > MAX_CALL_CHARS;
  const showStart = !st || ["code_missed", "expired", "failed", "gone", "done"].includes(st.phase);
  const input = "mt-1 w-full max-w-xs rounded-xl border-2 border-ink bg-paper px-3 py-2 font-mono focus:outline-none focus:ring-4 focus:ring-sky-deep";
  const button = "rounded-full border-2 border-ink bg-sun px-4 py-2 font-extrabold disabled:opacity-60";

  return (
    <>
      <button ref={toggle} type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={panelId} className="rounded-full border-2 border-ink bg-paper px-4 py-2">
        {short ? <DockLabel icon="📞" short={short} long={callLong} /> : `📞 ${callLong}`}
      </button>
      {open && (
        <div ref={panel} id={panelId} className="basis-full mt-1 rounded-2xl border-2 border-ink bg-paper p-4 font-normal">
          <p className="font-extrabold">{t("call.intro", { language: LANGUAGE_NAME[language] })}</p>
          {/* The rest of the panel (the consent, the code steps, what is stored and deleted) stays in English until a native
              speaker reviews it: a machine-drafted consent is not one a person can rely on. Said in their language, and
              marked lang="en" so a screen reader uses an English voice for it (Codex review of PR 93). */}
          {language !== "English" && <p className="mt-1 text-sm font-bold">{t("call.inEnglish", { language: LANGUAGE_NAME[language] })}</p>}
          <div lang="en">
          {!callable ? (
            <p className="mt-2 text-sm font-bold">Phone calls aren&apos;t available in {language} yet. Use Read it out loud or Print instead.</p>
          ) : tooLong ? (
            <p className="mt-2 text-sm font-bold">This plan is too long for a phone call. Use Read it out loud or Print instead.</p>
          ) : (
            <>
              {st && <p role="status" className="mt-2 font-bold">{line(st, suffix, typed)}</p>}
              {st && live && pollNotice(poll) && (
                <p role="status" aria-live="polite" className="mt-1 text-sm font-semibold">{pollNotice(poll)}</p>
              )}
              {st?.phase === "code" && (
                <form onSubmit={verify} className="mt-3 grid gap-2">
                  <label className="grid text-sm font-bold">The 4-digit code from the call
                    <input inputMode="numeric" autoComplete="one-time-code" maxLength={4} value={code}
                      onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="0000" className={input} />
                  </label>
                  <div className="flex flex-wrap gap-2">
                    <button type="submit" disabled={busy || code.length !== 4} className={button}>{busy ? "Checking..." : "Call me with my plan"}</button>
                    <button type="button" onClick={restart} className="rounded-full border-2 border-ink px-4 py-2 font-bold">Use a different number</button>
                  </div>
                </form>
              )}
              {showStart && (
                <form onSubmit={askCode} className="mt-3 grid gap-2">
                  <label className="grid text-sm font-bold">Your phone number (US)
                    <input type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                      placeholder="(404) 555-2368" className={input} />
                  </label>
                  <label className="flex items-start gap-2 text-sm font-semibold">
                    <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4" />
                    <span>ATLAS may call this number about this plan. Only enter your own number. We never call for anything else, and you can hang up any time.</span>
                  </label>
                  <div>
                    <button type="submit" disabled={busy || !consent || phone.replace(/\D/g, "").length < 10} className={button}>
                      {busy ? "Calling you with a code..." : st ? "Call me again" : "Call me with a code"}
                    </button>
                  </div>
                  <p className="text-xs font-semibold text-ink/70">First we call once with a 4-digit code, to check it is your phone. Then we call with your plan: enter the same code on the keypad to hear it, so voicemail or anyone else who answers hears only a request for a code from ATLAS, nothing about your plan.</p>
                </form>
              )}
            </>
          )}
          {msg && <p role="alert" className="mt-2 text-sm font-bold text-peach-deep">{msg}</p>}
          <p className="mt-3 text-xs font-semibold text-ink/70">Your number and plan text are stored encrypted while your call is in progress and deleted from our database when it ends. ATLAS refuses to open them after 30 minutes, and if a delete fails, our cleanup (every 5 minutes) removes them later.</p>
          </div>
        </div>
      )}
    </>
  );
}
