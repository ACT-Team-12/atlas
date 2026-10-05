"use client";

import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { keyTarget, TABS, tabInfo, type FlowState, type Tab } from "@/lib/phoneTabs";
import { useUi } from "./UiLang";

/** Same edge as Tailwind's `md`: below it the steps are tabs, at it and above they stack as before. */
const PHONE_QUERY = "not all and (min-width: 48rem)";

function subscribe(onChange: () => void) {
  const m = window.matchMedia(PHONE_QUERY);
  m.addEventListener("change", onChange);
  return () => m.removeEventListener("change", onChange);
}

/** True on phone widths. The server and the first client render say false, so hydration always matches. */
export function useIsPhone() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(PHONE_QUERY).matches, () => false);
}

export function isPhoneNow() {
  return typeof window !== "undefined" && window.matchMedia(PHONE_QUERY).matches;
}

export const tabId = (t: Tab) => `tab-step-${t}`;
export const panelId = (t: Tab) => `step-${t}`;

const LABEL = { 1: "tab.1", 2: "tab.2", 3: "tab.3" } as const;

/** A scroll the page itself started: how, the element it brings up, and from which window.scrollY to which. */
export type PageScroll = { behavior: "smooth" | "auto"; el: HTMLElement; from: number; to: number };

/** The window.scrollY that puts `el` at the top, under its scroll margin, as the page is laid out now. */
export function scrollTargetY(el: HTMLElement): number {
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  return Math.min(max, Math.max(0, window.scrollY + el.getBoundingClientRect().top - margin));
}

/** Scrolls `el` to the top (under its scroll margin) and says where the window is headed (measured before it moves). */
export function scrollElementToTop(el: HTMLElement, behavior: "smooth" | "auto"): PageScroll {
  const from = window.scrollY;
  const to = scrollTargetY(el);
  el.scrollIntoView({ behavior, block: "start" });
  return { behavior, el, from, to };
}

/**
 * Scrolls a step card to the top, just under the sticky tab bar. With `onlyIfHidden`, it only moves
 * when the card's top is already scrolled up under the bar, so a tap near the top does not jump.
 * Says how and where it scrolled (null when it did not), so the caller can tell its own scroll from the person's.
 */
export function scrollToPanel(t: Tab, onlyIfHidden = false): PageScroll | null {
  const el = document.getElementById(panelId(t));
  if (!el) return null;
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  if (onlyIfHidden && el.getBoundingClientRect().top >= margin - 1) return null;
  return scrollElementToTop(el, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");
}

/** Sticky tab bar for phones. Hidden from md up, where all three steps show at once. */
export function PhoneTabBar({ shown, state, onPick, notice }: { shown: Tab; state: FlowState; onPick: (t: Tab) => void; notice?: string | null }) {
  const info = tabInfo(state);
  const { t: tr } = useUi();
  const refs = useRef<Record<number, HTMLButtonElement | null>>({});
  // While the bar is stuck under the floating nav, the strip between the nav and the bar is covered too, so a step
  // scrolling past never shows in that gap and reads as sitting on top of the tabs. At rest nothing is covered.
  const bar = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const check = () => setStuck(el.getBoundingClientRect().top <= parseFloat(getComputedStyle(el).top) + 1);
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => { window.removeEventListener("scroll", check); window.removeEventListener("resize", check); };
  }, []);
  const closed = TABS.filter((t) => !info[t].available);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const next = keyTarget(shown, e.key, state);
    if (next == null) return;
    e.preventDefault();
    onPick(next);
    refs.current[next]?.focus();
  }

  return (
    // The mint strip behind the bar keeps the steps from showing through while it is stuck.
    <div ref={bar} data-sticky-bar="" data-stuck={stuck || undefined} data-covers-top={stuck || undefined}
      className={`md:hidden sticky top-[4rem] z-30 mt-4 -mx-4 sm:-mx-10 bg-mint-soft px-4 sm:px-10 py-2 ${stuck ? "before:pointer-events-none before:absolute before:inset-x-0 before:bottom-full before:h-[4rem] before:bg-mint-soft before:content-['']" : ""}`}>
      <div role="tablist" aria-label={tr("tab.label")} onKeyDown={onKeyDown}
        className="grid grid-cols-3 gap-1 rounded-full border-2 border-ink bg-paper p-1 shadow-[0_3px_0_var(--ink)]">
        {TABS.map((t) => {
          const { available, done } = info[t];
          const on = t === shown;
          return (
            <button key={t} ref={(el) => { refs.current[t] = el; }} type="button" role="tab" id={tabId(t)}
              aria-selected={on} aria-controls={available ? panelId(t) : undefined}
              aria-disabled={available ? undefined : true} aria-describedby={available ? undefined : "tabs-why"}
              tabIndex={on ? 0 : -1}
              onClick={() => { if (available) onPick(t); }}
              className={`relative rounded-full px-1.5 py-2 text-[0.9rem] font-extrabold leading-tight transition-colors focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-teal-deep ${
                on ? "bg-teal text-paper" : available ? "hover:bg-mint" : "cursor-not-allowed text-ink/70"}`}>
              {t} · {tr(LABEL[t])}
              {done && (
                <span aria-hidden="true" className={`absolute -top-1.5 -right-0.5 grid h-5 w-5 place-items-center rounded-full border-2 border-ink text-[0.65rem] ${on ? "bg-paper text-teal-deep" : "bg-teal text-paper"}`}>✓</span>
              )}
              {done && <span className="sr-only">{tr("tab.done")}</span>}
            </button>
          );
        })}
      </div>
      <p className="sr-only" role="status" aria-live="polite">{notice ?? ""}</p>
      {notice && (
        <p className="mx-auto mt-1.5 w-fit rounded-full bg-sun px-3 py-0.5 text-center text-xs font-bold" aria-hidden="true">{notice}</p>
      )}
      {closed.length > 0 && (
        <p id="tabs-why" className="mx-auto mt-1.5 w-fit rounded-full bg-mint-soft px-3 py-0.5 text-center text-xs font-bold text-ink/75">
          {closed.map((t) => `${t} · ${tr(LABEL[t])}: ${info[t].why ? tr("tab.planFirst") : ""}`).join(". ")}.
        </p>
      )}
    </div>
  );
}
