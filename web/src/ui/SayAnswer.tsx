"use client";

import { useEffect, useRef, useState } from "react";

export const MAX_RECORD_SECONDS = 20;

/** The first recording format this browser can make: WebM/Opus on Chrome, Firefox and Android; MP4 on Safari. */
export function pickMimeType(isSupported: (t: string) => boolean): string | null {
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"]) if (isSupported(t)) return t;
  return null;
}

type Props = {
  /** From GET /api/transcribe plus this quiz's language and token. False renders nothing at all. */
  enabled: boolean;
  language: string;
  token: string;
  onTranscript: (text: string) => void;
};

/**
 * "Say your answer": records up to 20 seconds, sends it to /api/transcribe, and hands back the words so the person
 * sees them in the answer box and can fix them before checking. Recording starts only when they tap.
 */
export function SayAnswer({ enabled, language, token, onTranscript }: Props) {
  const [state, setState] = useState<"idle" | "recording" | "sending">("idle");
  const [seconds, setSeconds] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelled = useRef(false);

  const release = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  };
  useEffect(() => () => {
    cancelled.current = true;
    if (recorder.current?.state === "recording") recorder.current.stop();
    release();
  }, []);

  if (!enabled) return null;

  async function send(blob: Blob, type: string) {
    setState("sending");
    try {
      const qs = new URLSearchParams({ language, token });
      const res = await fetch(`/api/transcribe?${qs}`, { method: "POST", headers: { "content-type": type }, body: blob });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "We couldn't hear that. Try again, or tap your answer.");
      const text = typeof json.transcript === "string" ? json.transcript.trim() : "";
      if (!text) { setMessage("We didn't catch any words. Try again, a little closer to the phone."); return; }
      onTranscript(text);
      setMessage("Here is what we heard. Fix any words, then check your answer.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "We couldn't hear that. Try again, or tap your answer.");
    } finally {
      if (!cancelled.current) setState("idle");
    }
  }

  async function start() {
    setMessage(null);
    const type = typeof MediaRecorder === "undefined" ? null : pickMimeType((t) => MediaRecorder.isTypeSupported(t));
    if (!type || !navigator.mediaDevices?.getUserMedia) { setMessage("This browser can't record. Tap your answer instead."); return; }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      setMessage(denied ? "The microphone is blocked. Allow it in your browser settings, or tap your answer instead." : "We couldn't find a microphone. Tap your answer instead.");
      return;
    }
    const rec = new MediaRecorder(stream.current, { mimeType: type, audioBitsPerSecond: 32_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (ev) => { if (ev.data.size > 0) chunks.push(ev.data); };
    rec.onstop = () => {
      release();
      if (cancelled.current) return;
      const base = type.split(";")[0];
      void send(new Blob(chunks, { type: base }), base);
    };
    recorder.current = rec;
    rec.start();
    setSeconds(0);
    setState("recording");
    const startedAt = Date.now();
    timer.current = setInterval(() => {
      const s = Math.min(MAX_RECORD_SECONDS, Math.floor((Date.now() - startedAt) / 1000));
      setSeconds(s);
      if (s >= MAX_RECORD_SECONDS && rec.state === "recording") rec.stop();
    }, 250);
  }

  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  return (
    <div className="mt-2">
      {state === "recording" ? (
        <button type="button" onClick={stop} aria-label={`Stop recording, ${seconds} of ${MAX_RECORD_SECONDS} seconds`}
          className="rounded-full bg-red text-paper px-4 py-2 font-bold">
          Stop ({seconds}s of {MAX_RECORD_SECONDS}s)
        </button>
      ) : (
        <button type="button" onClick={start} disabled={state === "sending"} aria-label="Say your answer out loud"
          className="rounded-full border-2 border-ink px-4 py-2 font-bold disabled:opacity-40">
          Say your answer
        </button>
      )}
      <p aria-live="polite" className="mt-1 text-sm font-semibold text-ink/70">
        {state === "recording" ? `Listening... ${seconds} of ${MAX_RECORD_SECONDS} seconds. Tap Stop when you're done.` : state === "sending" ? "Turning your words into text..." : message ?? ""}
      </p>
    </div>
  );
}
