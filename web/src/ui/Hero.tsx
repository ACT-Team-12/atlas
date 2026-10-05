"use client";

import { useEffect, useRef, useState } from "react";
import { setupGsap, useGSAP, gsap, SplitText, prefersReducedMotion } from "./motion/gsap";
import { WaveBlobs } from "./WaveBlobs";
import { SquashButton } from "./SquashButton";
import { isPlainClick, TRY_SAMPLE_EVENT, TRY_SAMPLE_HASH } from "@/lib/sampleStart";

/** Illustrative loop of what a plan card looks like. Built from our labeled sample paper, not a real patient. */
const LOOP = [
  { chip: "From your paper", chipCls: "bg-mint text-teal-deep", title: "Start metformin 500 mg", body: "1 tablet, 2 times a day, with meals.", quote: "Take 1 tablet by mouth 2 times a day with meals." },
  { chip: "Ask your clinic", chipCls: "bg-peach text-peach-deep", title: "Fasting blood test", body: "Within 2 weeks. The paper doesn't say how many hours to fast.", quote: "fasting, complete within 2 weeks" },
  { chip: "Getting there", chipCls: "bg-sky text-sky-deep", title: "Closest health center", body: "Sliding fee by law. Nearest MARTA stop shown on the plan.", quote: "verified HRSA record" },
];

export function PlanLoop() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const t = window.setInterval(() => setI((x) => (x + 1) % LOOP.length), 2600);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="relative w-[min(22rem,86vw)]">
      <div className="card p-5 rotate-[-2deg] bg-paper">
        <div className="flex items-center justify-between">
          <span className="hand text-2xl text-ink-soft">Your plan</span>
          <span className="text-xs font-bold text-ink/70">sample</span>
        </div>
        {/* All three stacked in one grid cell, only the current one shown, so the card is always as tall as the tallest.
            When the height changed with each turn, the browser nudged the page to keep the rest in place, and that scroll
            counted as the person using the page: a phone left alone never opened its plan (Akhil, Oct 4, measured live). */}
        <div className="mt-3 grid" data-plan-loop="">
          {LOOP.map((s, j) => (
            <div key={j === i ? `on-${i}` : j} aria-hidden={j !== i || undefined} data-loop-item={j === i ? "on" : "off"}
              className={`col-start-1 row-start-1 ${j === i ? "animate-[fadein_0.5s_ease]" : "invisible"}`}>
              <span className={`chip ${s.chipCls}`}>{s.chip}</span>
              <p className="display text-2xl mt-3">{s.title}</p>
              <p className="mt-2 font-semibold text-ink/80">{s.body}</p>
              <p className="mt-3 border-l-4 border-sun pl-2 text-sm italic text-ink/70">&ldquo;{s.quote}&rdquo;</p>
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
        <WaveBlobs tints={["#cdeee3", "#dbf3ea", "#e6f6f0"]} />
        <div className="relative z-10 w-full grid lg:grid-cols-[1.3fr_1fr] gap-10 items-center px-6 sm:px-12 pt-28 pb-16">
          <div>
            <p data-reveal className="hero-note hand text-3xl text-teal-deep -rotate-2 mb-4 inline-block">
              for whoever is helping someone after a clinic visit
            </p>
            <h1 data-reveal className="hero-title display text-[clamp(2.8rem,6.6vw,6.6rem)] text-ink">
              Your visit, turned into a plan you can actually finish.
            </h1>
            <p data-reveal className="hero-sub mt-6 max-w-[34em] text-lg font-semibold text-ink/85">
              Snap the after-visit summary. ATLAS explains every step in your language and shows the exact line it came
              from. Then it plans around what gets in the way, like a ride, the cost or the language, using verified
              Atlanta health centers and programs. If it can&apos;t point to it, it won&apos;t say it.
            </p>
            <div data-reveal className="hero-cta mt-8 flex flex-wrap gap-3">
              {/* Fills the sample in and brings "Read my paper" into view (lib/sampleStart.ts). */}
              <SquashButton href={TRY_SAMPLE_HASH} onClick={(e) => { if (isPlainClick(e)) window.dispatchEvent(new Event(TRY_SAMPLE_EVENT)); }} bg="var(--teal)" accent="var(--sun)">Try it with a sample</SquashButton>
              <SquashButton href="#how" bg="var(--paper)" fg="var(--ink)" accent="var(--sky)">How it works</SquashButton>
            </div>
          </div>
          <div data-reveal className="hero-card relative justify-self-center">
            <PlanLoop />
            <p className="hero-note hand text-2xl text-ink absolute -left-8 -bottom-10 rotate-[-6deg] max-w-[10em]">no account needed</p>
          </div>
        </div>
      </div>
    </section>
  );
}
