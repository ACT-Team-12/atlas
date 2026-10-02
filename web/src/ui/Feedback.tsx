"use client";

import { useState } from "react";

const ROLES = [
  { v: "patient", label: "It's my paper" },
  { v: "caregiver", label: "I help a family member" },
  { v: "helper", label: "I help people at work (CHW, navigator, nurse)" },
  { v: "tester", label: "Just trying it out" },
] as const;
const RATINGS = [
  { v: 1, label: "Not helpful" }, { v: 2, label: "A little" }, { v: 3, label: "Okay" }, { v: 4, label: "Helpful" }, { v: 5, label: "Very helpful" },
] as const;
const USE = [{ v: "yes", label: "Yes" }, { v: "maybe", label: "Maybe" }, { v: "no", label: "No" }] as const;

/** Three taps, no typing: nothing identifying can be sent. Saved anonymously so we can report real use. */
export function Feedback({ language }: { language: string }) {
  const [role, setRole] = useState<(typeof ROLES)[number]["v"] | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [use, setUse] = useState<(typeof USE)[number]["v"] | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [msg, setMsg] = useState<string | null>(null);

  async function send() {
    if (!role || !rating || !use) return;
    setState("sending"); setMsg(null);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, rating, would_use: use, language }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Something went wrong.");
      setState("done");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Something went wrong.");
      setState("error");
    }
  }

  const pill = (on: boolean) => `rounded-full border-2 px-4 py-2 text-sm font-bold transition-colors ${on ? "border-ink bg-ink text-paper" : "border-ink/60 bg-paper hover:bg-mint-soft"}`;

  if (state === "done") {
    return (
      <div className="mt-6 rounded-2xl border-2 border-teal bg-mint-soft p-5" role="status">
        <p className="font-extrabold">Thank you. That helps us make ATLAS better.</p>
        <p className="text-sm font-semibold text-ink/70">Saved without your paper, your name or your location. See the totals on <a className="underline" href="/tests">our tests page</a>.</p>
      </div>
    );
  }
  return (
    <div className="mt-6 rounded-2xl border-2 border-ink/70 bg-paper p-5" aria-labelledby="fb-title">
      <p id="fb-title" className="display text-2xl">How did this go?</p>
      <p className="text-sm font-semibold text-ink/70">Three taps, no typing. Saved anonymously.</p>
      <fieldset className="mt-4">
        <legend className="text-sm font-bold">Who are you?</legend>
        <div className="mt-2 flex flex-wrap gap-2">{ROLES.map((r) => <button key={r.v} type="button" aria-pressed={role === r.v} className={pill(role === r.v)} onClick={() => setRole(r.v)}>{r.label}</button>)}</div>
      </fieldset>
      <fieldset className="mt-4">
        <legend className="text-sm font-bold">How helpful was your plan?</legend>
        <div className="mt-2 flex flex-wrap gap-2">{RATINGS.map((r) => <button key={r.v} type="button" aria-pressed={rating === r.v} className={pill(rating === r.v)} onClick={() => setRating(r.v)}>{r.v} · {r.label}</button>)}</div>
      </fieldset>
      <fieldset className="mt-4">
        <legend className="text-sm font-bold">Would you use ATLAS again after a visit?</legend>
        <div className="mt-2 flex flex-wrap gap-2">{USE.map((u) => <button key={u.v} type="button" aria-pressed={use === u.v} className={pill(use === u.v)} onClick={() => setUse(u.v)}>{u.label}</button>)}</div>
      </fieldset>
      <button type="button" onClick={send} disabled={!role || !rating || !use || state === "sending"}
        className="mt-5 rounded-full bg-teal text-paper px-5 py-2.5 font-bold disabled:opacity-40">{state === "sending" ? "Sending..." : "Send"}</button>
      {msg && <p role="alert" className="mt-3 rounded-xl bg-red-soft p-3 text-sm font-semibold text-red">{msg}</p>}
    </div>
  );
}
