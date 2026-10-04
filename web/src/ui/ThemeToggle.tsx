"use client";

import { useSyncExternalStore, type KeyboardEvent } from "react";
import { readThemePref, setThemePref, THEME_PREFS, type ThemePref } from "@/lib/theme";

const LABEL: Record<ThemePref, string> = { system: "System", light: "Light", dark: "Dark" };
const HINT: Record<ThemePref, string> = {
  system: "System: match this phone or computer",
  light: "Light: always light",
  dark: "Dark: always dark",
};

function Icon({ pref }: { pref: ThemePref }) {
  const common = { width: 14, height: 14, viewBox: "0 0 16 16", "aria-hidden": true, fill: "none", stroke: "currentColor", strokeWidth: 1.8 } as const;
  if (pref === "light") return (
    <svg {...common}><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" strokeLinecap="round" /></svg>
  );
  if (pref === "dark") return <svg {...common}><path d="M13 9.6A5.5 5.5 0 0 1 6.4 3a5.5 5.5 0 1 0 6.6 6.6z" strokeLinejoin="round" /></svg>;
  return <svg {...common}><circle cx="8" cy="8" r="5.5" /><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" /></svg>;
}

function watchPref(onChange: () => void) {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme-pref"] });
  return () => obs.disconnect();
}

/**
 * System / Light / Dark. A radio group: arrow keys move the choice, as with any radio buttons. The picked button is
 * colored by CSS from <html data-theme-pref> (globals.css .theme-opt), so it is right from the first paint, before React
 * hydrates; aria-checked follows once it does.
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  // The inline script in app/layout.tsx already applied the saved choice to <html>; the buttons just read it from there.
  const pref = useSyncExternalStore(watchPref, readThemePref, () => "system" as ThemePref);
  const pick = (p: ThemePref) => setThemePref(p);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = THEME_PREFS[(THEME_PREFS.indexOf(pref) + step + THEME_PREFS.length) % THEME_PREFS.length];
    pick(next);
    e.currentTarget.querySelector<HTMLButtonElement>(`[data-theme-option="${next}"]`)?.focus();
  };

  return (
    <div role="radiogroup" aria-label="Color theme" onKeyDown={onKey} data-theme-toggle=""
      className={`flex items-center gap-0.5 rounded-full border-2 border-ink bg-paper/90 p-0.5 backdrop-blur shadow-[0_2px_0_var(--ink)] ${className}`}>
      {THEME_PREFS.map((p) => (
        <button key={p} type="button" role="radio" aria-checked={pref === p} tabIndex={pref === p ? 0 : -1} title={HINT[p]}
          data-theme-option={p} onClick={() => pick(p)}
          className="theme-opt flex min-h-8 min-w-8 items-center justify-center gap-1 rounded-full px-2 py-1 text-xs font-bold">
          <Icon pref={p} />
          {/* Phones: the icons stay, the words are read out; from 640px the words show too. */}
          <span className="sr-only sm:not-sr-only">{LABEL[p]}</span>
        </button>
      ))}
    </div>
  );
}
