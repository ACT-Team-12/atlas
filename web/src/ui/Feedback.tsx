"use client";

import { useState } from "react";
import { useUi } from "./UiLang";
import { failureKey, logFailure, postJson, RequestFailed } from "@/lib/requestError";

const ROLES = [
  { v: "patient", label: "fb.role.patient" },
  { v: "caregiver", label: "fb.role.caregiver" },
  { v: "helper", label: "fb.role.helper" },
  { v: "tester", label: "fb.role.tester" },
] as const;
const RATINGS = [
  { v: 1, label: "fb.rating.1" }, { v: 2, label: "fb.rating.2" }, { v: 3, label: "fb.rating.3" }, { v: 4, label: "fb.rating.4" }, { v: 5, label: "fb.rating.5" },
] as const;
const USE = [{ v: "yes", label: "fb.use.yes" }, { v: "maybe", label: "fb.use.maybe" }, { v: "no", label: "fb.use.no" }] as const;

/** Three taps, no typing: nothing identifying can be sent. Saved anonymously so we can report real use. */
export function Feedback({ language, token }: { language: string; token: string | null }) {
  const [role, setRole] = useState<(typeof ROLES)[number]["v"] | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [use, setUse] = useState<(typeof USE)[number]["v"] | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);
  const { t } = useUi();

  async function send() {
    if (!role || !rating || !use) return;
    setState("sending"); setMsg(null);
    try {
      await postJson("/api/feedback", { role, rating, would_use: use, language, token });
      setState("done");
    } catch (e) {
      // The feedback route's own outcomes (lib/feedback route): 409 means this plan's answer is already saved, so it is
      // a thank-you, not an error; 403 is an expired link; 503 could not save (Codex review, round 6).
      const status = e instanceof RequestFailed ? e.status : -1;
      if (status === 409) { setState("done"); return; }
      logFailure("feedback", e);
      setMsg(t(status === 403 ? "fb.expired" : status === 503 ? "fb.notSaved" : failureKey(e, "other")));
      setState("error");
    }
  }

  const pill = (on: boolean) => `rounded-full border-2 px-4 py-2 text-sm font-bold transition-colors ${on ? "border-ink bg-ink text-paper" : "border-ink/60 bg-paper hover:bg-mint-soft"}`;

  // No token means this server cannot accept a rating for this plan, so the card is not offered.
  if (!token) return null;

  if (state === "done") {
    return (
      <div className="mt-6 rounded-2xl border-2 border-teal bg-mint-soft p-5" role="status">
        <p className="font-extrabold">{t("fb.thanks")}</p>
        <p className="text-sm font-semibold text-ink/70">{t("fb.savedWithout")} <a className="underline" href="/tests">{t("fb.testsPage")}</a>.</p>
      </div>
    );
  }
  return (
    <div className="mt-6 rounded-2xl border-2 border-ink/70 bg-paper p-5" aria-labelledby="fb-title">
      <p id="fb-title" className="display text-2xl">{t("fb.title")}</p>
      <p className="text-sm font-semibold text-ink/70">{t("fb.intro")}</p>
      <fieldset className="mt-4">
        <legend className="text-sm font-bold">{t("fb.who")}</legend>
        <div className="mt-2 flex flex-wrap gap-2">{ROLES.map((r) => <button key={r.v} type="button" aria-pressed={role === r.v} className={pill(role === r.v)} onClick={() => setRole(r.v)}>{t(r.label)}</button>)}</div>
      </fieldset>
      <fieldset className="mt-4">
        <legend className="text-sm font-bold">{t("fb.helpful")}</legend>
        <div className="mt-2 flex flex-wrap gap-2">{RATINGS.map((r) => <button key={r.v} type="button" aria-pressed={rating === r.v} className={pill(rating === r.v)} onClick={() => setRating(r.v)}>{r.v} · {t(r.label)}</button>)}</div>
      </fieldset>
      <fieldset className="mt-4">
        <legend className="text-sm font-bold">{t("fb.again")}</legend>
        <div className="mt-2 flex flex-wrap gap-2">{USE.map((u) => <button key={u.v} type="button" aria-pressed={use === u.v} className={pill(use === u.v)} onClick={() => setUse(u.v)}>{t(u.label)}</button>)}</div>
      </fieldset>
      <button type="button" onClick={send} disabled={!role || !rating || !use || state === "sending"}
        className="mt-5 rounded-full bg-teal text-paper px-5 py-2.5 font-bold disabled:opacity-40">{t(state === "sending" ? "fb.sending" : "fb.send")}</button>
      {msg && <p role="alert" className="mt-3 rounded-xl bg-red-soft p-3 text-sm font-semibold text-red">{msg}</p>}
    </div>
  );
}
