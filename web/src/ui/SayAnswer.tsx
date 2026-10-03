"use client";

import { useEffect, useRef, useState } from "react";

export const MAX_RECORD_SECONDS = 20;
/** The automatic stop fires this early, so a timer that runs a little late still lands inside the 20 s. */
const AUTO_STOP_MS = MAX_RECORD_SECONDS * 1000 - 250;
const TOO_LONG = `That recording ran longer than ${MAX_RECORD_SECONDS} seconds, so we didn't send it. Try again, or tap your answer.`;
const LEFT = "Recording stopped when you left the page, so nothing was sent. Tap Say your answer to try again.";

/**
 * Whether a recording ran past the 20 s the privacy page promises, from monotonic clock readings (performance.now)
 * taken when it started and when it was told to stop. Timers in a background tab can fire very late, so this is
 * checked before sending, whatever stopped the recording.
 */
export function recordedTooLong(startedAt: number, stoppedAt: number): boolean {
  return stoppedAt - startedAt > MAX_RECORD_SECONDS * 1000;
}

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
  /** Stops the current recording and notes when, so its length is known before sending. */
  const halt = useRef<(() => void) | null>(null);
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
    let limit: ReturnType<typeof setTimeout> | null = null;
    let onHidden: (() => void) | null = null;
    let stopNow: (() => void) | null = null;
    let released = false;
    const free = () => {
      if (released) return;
      released = true;
      if (timer) clearInterval(timer);
      if (limit) clearTimeout(limit);
      if (onHidden) document.removeEventListener("visibilitychange", onHidden);
      if (stopNow) window.removeEventListener("pagehide", stopNow);
      mic.getTracks().forEach((t) => t.stop());
      if (release.current === free) release.current = null;
    };
    if (cancelled.current) { free(); busy.current = false; return; } // gone while the permission prompt was open
    release.current = free;
    try {
      const rec = new MediaRecorder(mic, { mimeType: type, audioBitsPerSecond: 32_000 });
      const chunks: Blob[] = [];
      let startedAt = 0, stoppedAt: number | null = null, discard = false;
      /** Stop and send (Stop or the 20 s limit), or stop and throw the audio away (the page was hidden or left). */
      const end = (drop: boolean) => {
        if (rec.state !== "recording") return;
        stoppedAt ??= performance.now();
        discard = drop;
        rec.stop();
      };
      const finish = () => end(false);
      rec.ondataavailable = (ev) => { if (ev.data.size > 0) chunks.push(ev.data); };
      rec.onstop = () => {
        free();
        if (recorder.current === rec) recorder.current = null;
        if (halt.current === finish) halt.current = null;
        if (cancelled.current) { busy.current = false; return; }
        // Hidden or left without tapping Stop: nothing is uploaded, and the chunks go with this closure.
        if (discard) {
          chunks.length = 0;
          busy.current = false;
          setState("idle");
          setMessage(LEFT);
          return;
        }
        // Never send more than the 20 s the privacy page promises, however late a throttled timer fired.
        if (recordedTooLong(startedAt, stoppedAt ?? performance.now())) {
          busy.current = false;
          setState("idle");
          setMessage(TOO_LONG);
          return;
        }
        const base = type.split(";")[0];
        void send(new Blob(chunks, { type: base }), base);
      };
      recorder.current = rec;
      rec.start();
      startedAt = performance.now();
      halt.current = finish;
      setSeconds(0);
      setState("recording");
      // Background tabs throttle timers, so also stop the moment the page is hidden or left, and send nothing then.
      onHidden = () => { if (document.visibilityState === "hidden") end(true); };
      stopNow = () => end(true);
      document.addEventListener("visibilitychange", onHidden);
      window.addEventListener("pagehide", stopNow);
      limit = setTimeout(finish, AUTO_STOP_MS);
      timer = setInterval(() => {
        const s = Math.min(MAX_RECORD_SECONDS, Math.floor((performance.now() - startedAt) / 1000));
        setSeconds(s);
        if (s >= MAX_RECORD_SECONDS) finish();
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
    halt.current?.();
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
