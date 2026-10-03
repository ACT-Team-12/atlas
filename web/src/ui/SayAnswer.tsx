"use client";

import { useEffect, useRef, useState } from "react";

export const MAX_RECORD_SECONDS = 20;

/** The first recording format this browser can make: WebM/Opus on Chrome, Firefox and Android; MP4 on Safari. */
export function pickMimeType(isSupported: (t: string) => boolean): string | null {
  for (const t of ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]) if (isSupported(t)) return t;
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
  /** Stops whatever this recording holds (its own stream and timer). Set per recording, so a late one can't leak. */
  const release = useRef<(() => void) | null>(null);
  /** Set synchronously on tap, before any await, so a second tap during the permission prompt does nothing. */
  const busy = useRef(false);
  const cancelled = useRef(false);

  useEffect(() => {
    cancelled.current = false; // StrictMode remounts: the component is live again
    return () => {
      cancelled.current = true;
      if (recorder.current?.state === "recording") recorder.current.stop();
      release.current?.();
    };
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
      busy.current = false;
      if (!cancelled.current) setState("idle");
    }
  }

  async function start() {
    if (busy.current) return;
    busy.current = true;
    setMessage(null);
    const type = typeof MediaRecorder === "undefined" ? null : pickMimeType((t) => MediaRecorder.isTypeSupported(t));
    if (!type || !navigator.mediaDevices?.getUserMedia) {
      busy.current = false;
      setMessage("This browser can't record. Tap your answer instead.");
      return;
    }
    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      busy.current = false;
      const denied = e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError");
      if (!cancelled.current) setMessage(denied ? "The microphone is blocked. Allow it in your browser settings, or tap your answer instead." : "We couldn't find a microphone. Tap your answer instead.");
      return;
    }
    // Everything this recording holds, released exactly once on every path: stop, error, limit or unmount.
    let timer: ReturnType<typeof setInterval> | null = null;
    let released = false;
    const free = () => {
      if (released) return;
      released = true;
      if (timer) clearInterval(timer);
      mic.getTracks().forEach((t) => t.stop());
      if (release.current === free) release.current = null;
    };
    if (cancelled.current) { free(); busy.current = false; return; } // gone while the permission prompt was open
    release.current = free;
    try {
      const rec = new MediaRecorder(mic, { mimeType: type, audioBitsPerSecond: 32_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (ev) => { if (ev.data.size > 0) chunks.push(ev.data); };
      rec.onstop = () => {
        free();
        if (recorder.current === rec) recorder.current = null;
        if (cancelled.current) { busy.current = false; return; }
        const base = type.split(";")[0];
        void send(new Blob(chunks, { type: base }), base);
      };
      recorder.current = rec;
      rec.start();
      setSeconds(0);
      setState("recording");
      const startedAt = Date.now();
      timer = setInterval(() => {
        const s = Math.min(MAX_RECORD_SECONDS, Math.floor((Date.now() - startedAt) / 1000));
        setSeconds(s);
        if (s >= MAX_RECORD_SECONDS && rec.state === "recording") rec.stop();
      }, 250);
    } catch {
      free();
      recorder.current = null;
      busy.current = false;
      setState("idle");
      setMessage("We couldn't start recording. Tap your answer instead.");
    }
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
