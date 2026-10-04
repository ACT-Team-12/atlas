"use client";

import { useEffect } from "react";

export type Ready = "steps" | "plan";

/** The heading each cue takes the person to (focusable, tabIndex -1); the cue hides once it is plainly on screen. */
export const READY_TARGET: Record<Ready, string> = { steps: "steps-title", plan: "plan-title" };

const LABEL: Record<Ready, string> = { steps: "Your steps are ready", plan: "Your plan is ready" };

/**
 * Plainly on screen: the whole heading inside the middle band of the viewport (the observer's rootMargin keeps the
 * sticky header and the bottom bar out). One edge entering the viewport is not enough (Codex review).
 */
export function readableNow(e: { isIntersecting: boolean; intersectionRatio: number }): boolean {
  return e.isIntersecting && e.intersectionRatio >= 0.99;
}

/**
 * "Your plan is ready: show me". Both watched tries (Oct 4) scrolled away from the tool during the 15 to 25 seconds
 * the AI takes; one never found her plan, because the only sign was a small note in the phone tab bar. When a result
 * lands and the page has decided not to move the person (they tapped or scrolled since pressing the button), this
 * button floats at the bottom of the screen until they use it or the result's heading comes plainly into view.
 * `announce` is false when another live region already says the same thing (the phone tab bar's plan note).
 */
export function ReadyCue({ ready, announce, onGo, onSeen }: { ready: Ready | null; announce: boolean; onGo: (r: Ready) => void; onSeen: () => void }) {
  useEffect(() => {
    if (!ready || typeof IntersectionObserver === "undefined") return;
    const el = document.getElementById(READY_TARGET[ready]);
    if (!el) return;
    const io = new IntersectionObserver((entries) => { if (entries.some(readableNow)) onSeen(); },
      { rootMargin: "-20% 0px -25% 0px", threshold: [1] });
    io.observe(el);
    return () => io.disconnect();
  }, [ready, onSeen]);

  return (
    <>
      {/* Always mounted, so the arrival is announced once, politely. */}
      <p className="sr-only" role="status" aria-live="polite">{ready && announce ? LABEL[ready] : ""}</p>
      {ready && (
        <div className="ready-cue fixed inset-x-0 bottom-24 z-40 flex justify-center px-4 print:hidden md:bottom-8" data-ready-cue={ready}>
          <button type="button" onClick={() => onGo(ready)}
            className="min-h-[52px] rounded-full border-2 border-ink bg-sun px-5 py-3 text-base font-extrabold shadow-[0_4px_0_var(--ink)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-teal-deep">
            <span aria-hidden="true">✓ </span>{LABEL[ready]}: <span className="underline decoration-2 underline-offset-4">show me</span>
          </button>
        </div>
      )}
    </>
  );
}
