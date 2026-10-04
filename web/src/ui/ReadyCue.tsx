"use client";

import { useEffect } from "react";

export type Ready = "steps" | "plan";

/** The heading each cue takes the person to (focusable, tabIndex -1); the cue hides once it is plainly on screen. */
export const READY_TARGET: Record<Ready, string> = { steps: "steps-title", plan: "plan-title" };

const LABEL: Record<Ready, string> = { steps: "Your steps are ready", plan: "Your plan is ready" };

/**
 * Plainly on screen: the whole heading between 15% and 80% of the viewport's HEIGHT, clear of the sticky header and
 * the bottom bar. One edge entering the viewport is not enough (Codex review). Plain geometry rather than an
 * IntersectionObserver rootMargin, whose percentages resolve against the viewport's width (W3C Intersection Observer,
 * "Percentages are resolved relative to the width of the undilated rectangle"), which collapses the band on a
 * landscape phone (Codex review, round 2).
 */
export function readableRect(r: { top: number; bottom: number; height: number }, viewportHeight: number): boolean {
  return r.height > 0 && r.top >= viewportHeight * 0.15 && r.bottom <= viewportHeight * 0.8;
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
    if (!ready) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const el = document.getElementById(READY_TARGET[ready]);
      if (el && readableRect(el.getBoundingClientRect(), window.innerHeight)) onSeen();
    };
    const soon = () => { if (!frame) frame = requestAnimationFrame(check); };
    soon(); // it may already be in plain view when the result lands
    window.addEventListener("scroll", soon, { passive: true });
    window.addEventListener("resize", soon);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", soon); window.removeEventListener("resize", soon); };
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
