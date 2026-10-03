"use client";

import { useEffect, useEffectEvent, useId, useRef, useState } from "react";
import { helperBanner, markHelperSession, parseHelperFragment, type HelperPresets } from "@/lib/helperLink";

function scrollToTry() {
  const el = document.getElementById("try");
  if (!el) return;
  const lenis = (window as unknown as { __lenis?: { scrollTo: (t: HTMLElement, o?: { immediate?: boolean }) => void } }).__lenis;
  if (lenis) lenis.scrollTo(el, { immediate: true });
  else el.scrollIntoView();
}

/**
 * Reads a helper link (see lib/helperLink.ts) once the page is in the browser. Valid presets are handed to `onArrive`,
 * which puts them in the normal inputs, so every one stays editable. The fragment is then replaced with plain "#try",
 * so the choices do not stay in the address bar, the history entry or a bookmark. An invalid link does nothing.
 */
export function useHelperArrival(onArrive: (p: HelperPresets) => void) {
  const [arrival, setArrival] = useState<HelperPresets | null>(null);
  const arrive = useEffectEvent((p: HelperPresets) => {
    markHelperSession();
    onArrive(p);
    setArrival(p);
  });

  useEffect(() => {
    let timer = 0;
    const check = () => {
      const p = parseHelperFragment(window.location.hash);
      if (!p) return;
      arrive(p);
      try { window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}#try`); } catch {}
      scrollToTry();
      // The first-visit intro holds the page for about a second and a half; land on the tool once it lets go.
      const again = () => scrollToTry();
      window.addEventListener("atlas:intro-done", again, { once: true });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => window.removeEventListener("atlas:intro-done", again), 5000);
    };
    check();
    window.addEventListener("hashchange", check);
    return () => { window.removeEventListener("hashchange", check); window.clearTimeout(timer); };
  }, []);

  return { arrival, dismiss: () => setArrival(null) };
}

/** "Someone helping you set this up in Spanish for 30310. You can change anything." Dismissible; changes nothing else. */
export function HelperBanner({ arrival, onDismiss }: { arrival: HelperPresets | null; onDismiss: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const textId = useId();
  // The page jumps to the tool, so keyboard and screen-reader focus moves with it, onto this note.
  useEffect(() => { if (arrival) ref.current?.focus({ preventScroll: true }); }, [arrival]);
  if (!arrival) return null;
  const b = helperBanner(arrival);
  return (
    <div ref={ref} tabIndex={-1} role="status" aria-labelledby={textId} data-helper-banner="" className="mt-6 focus:outline-3 focus:outline-teal flex flex-wrap items-start gap-3 rounded-2xl border-2 border-teal bg-paper p-4">
      <div className="flex-1 min-w-[14rem]">
        <p id={textId} lang={b.lang} className="font-bold">{b.text}</p>
        {b.english && <p lang="en" className="mt-1 text-sm font-semibold text-ink/70">{b.english}</p>}
      </div>
      <button type="button" onClick={() => { onDismiss(); document.getElementById("try-title")?.focus({ preventScroll: true }); }} className="rounded-full border-2 border-ink px-4 py-1.5 text-sm font-bold hover:bg-mint">
        <span aria-hidden="true">✕ </span>Close this note
      </button>
    </div>
  );
}
