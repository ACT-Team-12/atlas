"use client";

import { useEffect, useRef, useState } from "react";
import { setupGsap, gsap, prefersReducedMotion } from "./motion/gsap";
import { Mark } from "./Mark";

const introDone = () => window.dispatchEvent(new Event("atlas:intro-done"));

/**
 * Intro: a mint field, the mark pops in, a line underlines "only what's written", then the field retracts along
 * one fat stroke to uncover the page. Once per browser session; skipped under reduced motion; a timeout always
 * removes the overlay.
 */
export function Preloader() {
  const root = useRef<HTMLDivElement>(null);
  const started = useRef(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const finish = () => {
      document.documentElement.style.overflow = "";
      try { sessionStorage.setItem("atlas-intro", "1"); } catch {}
      setDone(true);
      introDone();
    };
    const forced = new URLSearchParams(window.location.search).has("intro");
    let seen = false;
    try { seen = sessionStorage.getItem("atlas-intro") === "1"; } catch {}
    if (prefersReducedMotion() || (seen && !forced) || !root.current) {
      setDone(true);
      introDone();
      return;
    }
    setupGsap();
    document.documentElement.style.overflow = "hidden";
    const q = gsap.utils.selector(root);
    const safety = window.setTimeout(finish, 4000);
    const tl = gsap.timeline({ onComplete: () => { window.clearTimeout(safety); finish(); } });
    tl.set(q(".pl-path"), { drawSVG: "0% 100%" })
      .fromTo(q(".pl-mark"), { scale: 0, rotate: -40, autoAlpha: 0 }, { scale: 1, rotate: 0, autoAlpha: 1, duration: 0.6, ease: "elastic.out(1,0.75)" }, 0.1)
      .fromTo(q(".pl-word"), { autoAlpha: 0, y: 8 }, { autoAlpha: 1, y: 0, duration: 0.3, ease: "energy" }, 0.5)
      .fromTo(q(".pl-line"), { scaleX: 0, autoAlpha: 1 }, { scaleX: 1, autoAlpha: 1, duration: 0.45, ease: "power2.out" }, 0.7)
      .to(q(".pl-mark, .pl-word, .pl-line"), { scale: 0, rotate: 30, autoAlpha: 0, duration: 0.45, ease: "elastic.in(1,0.75)" }, 1.15)
      .to(q(".pl-path"), { keyframes: { "92%": { strokeWidth: "7%", ease: "circ.out" }, "100%": { drawSVG: "100% 100%" } }, duration: 1.1 }, 1.2)
      .add(introDone, 1.55);
  }, []);

  if (done) return null;
  return (
    <div ref={root} className="fixed inset-0 z-[100] pointer-events-none" aria-hidden="true">
      <svg viewBox="0 0 1080 1080" preserveAspectRatio="none" className="absolute inset-0 w-full h-full">
        <path className="pl-path" d="M-160 140 C 240 -120, 520 420, 300 640 S 620 1180, 900 820 S 1260 380, 1240 1240"
          fill="none" stroke="var(--mint)" strokeWidth="75%" strokeLinecap="round" />
      </svg>
      <div className="absolute inset-0 grid place-items-center">
        <div className="relative flex flex-col items-center gap-3">
          <div className="pl-mark invisible"><Mark size={120} /></div>
          <p className="pl-word hand text-4xl text-ink invisible">only what&apos;s written</p>
          <span className="pl-line invisible block h-1.5 w-48 rounded-full bg-teal origin-left" />
        </div>
      </div>
    </div>
  );
}
