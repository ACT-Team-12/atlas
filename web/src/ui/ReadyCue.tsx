"use client";

import { useEffect } from "react";
import type { UiKey } from "@/lib/uiText";
import { useUi } from "./UiLang";

export type Ready = "steps" | "plan" | "photo";

/** The heading each cue takes the person to (focusable, tabIndex -1); the cue hides once it is plainly on screen. */
export const READY_TARGET: Record<Ready, string> = { steps: "steps-title", plan: "plan-title", photo: "photo-check-title" };

/**
 * The element a cue takes the person to. For the steps that is the warning signs when the paper has any: they sit
 * above "Your steps" and are not repeated in the list, so landing on "Your steps" would scroll a "call 911" past
 * the top of the screen (Codex review, round 7).
 */
export function readyTarget(r: Ready): HTMLElement | null {
  if (r === "steps") {
    const warn = document.getElementById("warn-title");
    if (warn) return warn;
  }
  return document.getElementById(READY_TARGET[r]);
}

const LABEL: Record<Ready, UiKey> = { steps: "ready.steps", plan: "ready.plan", photo: "ready.photo" };

/**
 * Plainly on screen: the whole heading between 15% and 80% of the viewport's HEIGHT, clear of the sticky header and
 * the bottom bar. One edge entering the viewport is not enough (Codex review). Plain geometry rather than an
 * IntersectionObserver rootMargin, whose percentages resolve against the viewport's width (W3C Intersection Observer,
 * "Percentages are resolved relative to the width of the undilated rectangle"), which collapses the band on a
 * landscape phone (Codex review, round 2).
 */
export function readableRect(r: { top: number; bottom: number; height: number }, viewportHeight: number, coveredTop = 0): boolean {
  // Never under what is stuck to the top of the screen (the header, the stuck phone tab bar): measured, not guessed,
  // because on a short landscape phone the tab bar reaches past 15% of the height (Codex review, round 3).
  const top = Math.max(viewportHeight * 0.15, coveredTop + 4);
  return r.height > 0 && r.top >= top && r.bottom <= viewportHeight * 0.8;
}

/** The lowest bottom edge of anything marked data-covers-top (the fixed header; the phone tab bar while stuck). */
export function coveredTopNow(): number {
  return [...document.querySelectorAll<HTMLElement>("[data-covers-top]")]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.height > 0 && r.top < window.innerHeight / 2)
    .reduce((low, r) => Math.max(low, r.bottom), 0);
}

/**
 * How far below the top "Show me" lands a heading: past the fixed header and the phone tab bar's sticky footprint
 * (the bar sticks once the page scrolls there, so it counts before it is stuck), never above the heading's own scroll
 * margin. Measured, because on a short landscape phone the bar reaches past that fixed margin (Codex review, round 6).
 */
export function landingTop(el: HTMLElement): number {
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  const bar = document.querySelector<HTMLElement>("[data-sticky-bar]");
  const barCover = bar && bar.offsetHeight > 0 ? (parseFloat(getComputedStyle(bar).top) || 0) + bar.offsetHeight : 0;
  return Math.max(margin, coveredTopNow() + 8, barCover + 8);
}

/**
 * "Your plan is ready: show me". Both watched tries (Oct 4) scrolled away from the tool during the 15 to 25 seconds
 * the AI takes; one never found her plan, because the only sign was a small note in the phone tab bar. When a result
 * lands and the page has decided not to move the person (they tapped or scrolled since pressing the button), this
 * button floats at the bottom of the screen until they use it or the result's heading comes plainly into view.
 * `announce` is false when another live region already says the same thing (the phone tab bar's plan note).
 */
export function ReadyCue({ ready, announce, onGo, onSeen }: { ready: Ready | null; announce: boolean; onGo: (r: Ready) => void; onSeen: () => void }) {
  const { t } = useUi();
  useEffect(() => {
    if (!ready) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      const el = readyTarget(ready);
      if (el && readableRect(el.getBoundingClientRect(), window.innerHeight, coveredTopNow())) onSeen();
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
      <p className="sr-only" role="status" aria-live="polite">{ready && announce ? t(LABEL[ready]) : ""}</p>
      {ready && (
        <div className="ready-cue fixed inset-x-0 bottom-24 z-40 flex justify-center px-4 print:hidden md:bottom-8" data-ready-cue={ready}>
          <button type="button" onClick={() => onGo(ready)}
            className="min-h-[52px] rounded-full border-2 border-ink bg-sun px-5 py-3 text-base font-extrabold shadow-[0_4px_0_var(--ink)] focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-teal-deep">
            <span aria-hidden="true">✓ </span>{t(LABEL[ready])}: <span className="underline decoration-2 underline-offset-4">{t("ready.showMe")}</span>
          </button>
        </div>
      )}
    </>
  );
}
