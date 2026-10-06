"use client";

import { useEffect, useRef, useState } from "react";
import { setupGsap, useGSAP, gsap, SplitText, prefersReducedMotion } from "./motion/gsap";
import { WaveBlobs } from "./WaveBlobs";
import { SquashButton } from "./SquashButton";
import { isPlainClick, TRY_SAMPLE_EVENT, TRY_SAMPLE_HASH } from "@/lib/sampleStart";
import { useSite } from "./SiteLang";

/** Illustrative loop of what a plan card looks like. Built from our labeled sample paper, not a real patient. */
/** The words come from lib/siteText.ts (loop.N.*); each quote stays in English, as the paper wrote it. */
const LOOP = [
  { n: 0, chipCls: "bg-mint text-teal-deep", quote: "Take 1 tablet by mouth 2 times a day with meals." },
  { n: 1, chipCls: "bg-peach text-peach-deep", quote: "fasting, complete within 2 weeks" },
  { n: 2, chipCls: "bg-sky text-sky-deep", quote: "verified HRSA record" },
] as const;

export function PlanLoop() {
  const [i, setI] = useState(0);
  const { s } = useSite();
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const t = window.setInterval(() => setI((x) => (x + 1) % LOOP.length), 2600);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="relative w-[min(22rem,86vw)]">
      <div className="card p-5 rotate-[-2deg] bg-paper">
        <div className="flex items-center justify-between">
          <span className="hand text-2xl text-ink-soft">{s("loop.yourPlan")}</span>
          <span className="text-xs font-bold text-ink/70">{s("loop.sample")}</span>
        </div>
        {/* All three stacked in one grid cell, only the current one shown, so the card is always as tall as the tallest.
            When the height changed with each turn, the browser nudged the page to keep the rest in place, and that scroll
            counted as the person using the page: a phone left alone never opened its plan (Akhil, Oct 4, measured live). */}
        <div className="mt-3 grid" data-plan-loop="">
          {LOOP.map((c, j) => (
            <div key={j === i ? `on-${i}` : j} aria-hidden={j !== i || undefined} data-loop-item={j === i ? "on" : "off"}
              className={`col-start-1 row-start-1 ${j === i ? "animate-[fadein_0.5s_ease]" : "invisible"}`}>
              <span className={`chip ${c.chipCls}`}>{s(`loop.${c.n}.chip`)}</span>
              <p className="display text-2xl mt-3">{s(`loop.${c.n}.title`)}</p>
              <p className="mt-2 font-semibold text-ink/80">{s(`loop.${c.n}.body`)}</p>
              <p lang="en" className="mt-3 border-l-4 border-sun pl-2 text-sm italic text-ink/70">&ldquo;{c.quote}&rdquo;</p>
            </div>
          ))}
        </div>
        <div className="mt-4 flex gap-1.5">
          {LOOP.map((_, j) => <span key={j} className={`h-1.5 flex-1 rounded-full ${j === i ? "bg-teal" : "bg-ink/15"}`} />)}
        </div>
      </div>
      <style>{"@keyframes fadein{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}"}</style>
    </div>
  );
}

export function Hero() {
  const root = useRef<HTMLElement>(null);
  const { s } = useSite();
  useGSAP(
    (_ctx, contextSafe) => {
      setupGsap();
      const q = gsap.utils.selector(root);
      if (prefersReducedMotion()) return;
      const run = contextSafe!(() => {
        const split = new SplitText(q(".hero-title"), { type: "words" });
        gsap.timeline()
          .set(q("[data-reveal]"), { visibility: "visible" })
          .fromTo(q(".hero-bg"), { clipPath: "ellipse(20% 0% at 100% 100%)" }, { clipPath: "ellipse(150% 130% at 100% 100%)", duration: 1.1, ease: "circ.out" }, 0)
          .from(split.words, { transformOrigin: "top left", yPercent: -10, xPercent: 30, scaleY: 0.2, scaleX: 0.9, rotate: 5, opacity: 0, duration: 0.85, ease: "elastic.out(1,0.8)", stagger: 0.07 }, 0.2)
          .from(q(".hero-sub"), { y: "-0.75em", opacity: 0, duration: 0.35, ease: "energy" }, 0.65)
          .from(q(".hero-cta > *"), { y: "-0.75em", opacity: 0, duration: 0.35, ease: "energy", stagger: 0.08 }, 0.75)
          .from(q(".hero-note"), { scale: 0, rotate: -20, opacity: 0, duration: 0.8, ease: "elastic.out(1,0.8)", stagger: 0.15 }, 0.9)
          .from(q(".hero-card"), { yPercent: 30, rotate: 8, scale: 0.85, opacity: 0, duration: 1.1, ease: "elastic.out(1,0.8)" }, 0.5);
      });
      if (document.querySelector(".pl-path")) {
        window.addEventListener("atlas:intro-done", run, { once: true });
        return () => window.removeEventListener("atlas:intro-done", run);
      }
      run();
    },
    { scope: root },
  );

  return (
    <section ref={root} className="relative px-3 pt-3">
      <div className="hero-bg section-card bg-mint min-h-[100svh] flex items-center">
        <WaveBlobs tints={["var(--wave-1)", "var(--wave-2)", "var(--wave-3)"]} />
        <div className="relative z-10 w-full grid lg:grid-cols-[1.3fr_1fr] gap-10 items-center px-6 sm:px-12 pt-28 pb-16">
          <div>
            <p data-reveal className="hero-note hand text-3xl text-teal-deep -rotate-2 mb-4 inline-block">
              {s("hero.note")}
            </p>
            <h1 data-reveal className="hero-title display text-[clamp(2.8rem,6.6vw,6.6rem)] text-ink">
              {s("hero.title")}
            </h1>
            <p data-reveal className="hero-sub mt-6 max-w-[34em] text-lg font-semibold text-ink/85">
              {s("hero.sub")}
            </p>
            <div data-reveal className="hero-cta mt-8 flex flex-wrap gap-3">
              {/* Fills the sample in and brings "Read my paper" into view (lib/sampleStart.ts). */}
              <SquashButton href={TRY_SAMPLE_HASH} onClick={(e) => { if (isPlainClick(e)) window.dispatchEvent(new Event(TRY_SAMPLE_EVENT)); }} bg="var(--teal)" accent="var(--sun)">{s("hero.try")}</SquashButton>
              <SquashButton href="#how" bg="var(--paper)" fg="var(--ink)" accent="var(--sky)">{s("nav.how")}</SquashButton>
            </div>
          </div>
          <div data-reveal className="hero-card relative justify-self-center">
            <PlanLoop />
            <p className="hero-note hand text-2xl text-ink absolute -left-8 -bottom-10 rotate-[-6deg] max-w-[10em]">{s("hero.noAccount")}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
