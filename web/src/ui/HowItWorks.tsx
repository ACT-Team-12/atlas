"use client";

import { useRef } from "react";
import { setupGsap, useGSAP, gsap, prefersReducedMotion } from "./motion/gsap";

const STEPS = [
  { n: "1", title: "Snap the paper", body: "Take a photo of the after-visit summary, or paste it. No account, nothing saved unless you choose.", chip: "CAMERA", cls: "bg-mint-soft", note: "the paper you already have" },
  { n: "2", title: "Only what's written", body: "Every medicine, lab, referral and warning sign is explained in your language and tied to the exact line it came from.", chip: "GROUNDED", cls: "bg-sky", note: "if it can't point to it, it won't say it" },
  { n: "3", title: "Plan around what's in the way", body: "Tell us what makes it hard: a ride, the cost, coverage, language. We match verified health centers, MARTA stops and programs.", chip: "VERIFIED", cls: "bg-peach", note: "real places, real phone numbers" },
  { n: "4", title: "Bring it back", body: "Check things off, keep questions for the next visit, and hand off to a community health worker when it needs a person.", chip: "FOLLOW-THROUGH", cls: "bg-lilac", note: "a person when it needs one" },
];

/** Fanned step cards (Lullabuy technique), calmer tilt for healthcare. */
export function HowItWorks() {
  const root = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      setupGsap();
      const q = gsap.utils.selector(root);
      const cards = q(".hw-card") as HTMLElement[];
      const tilt = () => cards.forEach((c) => gsap.to(c, { rotation: gsap.utils.random(-3.5, 3.5), yPercent: gsap.utils.random(-3, 3), scale: 1, duration: 0.85, ease: "elastic.out(1,0.8)" }));
      if (prefersReducedMotion()) return;
      tilt();
      gsap.from(cards, { yPercent: 120, duration: 1, ease: "elastic.out(1,0.8)", stagger: 0.08, scrollTrigger: { trigger: root.current, start: "top 75%", once: true } });
      if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
      const grid = q(".hw-grid")[0] as HTMLElement;
      let active = -1;
      grid.addEventListener("pointermove", (e: PointerEvent) => {
        const r = grid.getBoundingClientRect();
        const i = Math.min(cards.length - 1, Math.floor(((e.clientX - r.left) / r.width) * cards.length));
        if (i === active) return;
        active = i;
        cards.forEach((c, j) => gsap.to(c, j === i ? { rotation: 0, yPercent: -4, scale: 1.05, zIndex: 5, duration: 0.8, ease: "elastic.out(1,0.8)" } : { scale: 0.98, zIndex: 1, duration: 0.8, ease: "elastic.out(1,0.8)" }));
      });
      grid.addEventListener("pointerleave", () => { active = -1; tilt(); });
    },
    { scope: root },
  );
  return (
    <section ref={root} id="how" className="relative px-3 mt-3 scroll-mt-20" aria-labelledby="how-title">
      <div className="section-card bg-paper border-2 border-ink/10 px-6 sm:px-12 py-24">
        <div className="flex flex-wrap items-end justify-between gap-6">
          <h2 id="how-title" className="display text-[clamp(2.4rem,5vw,5rem)]">How it works</h2>
          <p className="hand text-3xl text-teal rotate-1 max-w-[15em]">built for community health workers, nonprofits and the people they help</p>
        </div>
        <ol className="hw-grid mt-14 grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
          {STEPS.map((s) => (
            <li key={s.n} className={`hw-card card relative p-6 pt-5 min-h-[19rem] ${s.cls}`}>
              <p className="hand text-3xl">Step {s.n}</p>
              <span className="chip mt-3 bg-ink text-paper">{s.chip}</span>
              <h3 className="display text-3xl mt-4">{s.title}</h3>
              <p className="mt-3 font-semibold leading-snug">{s.body}</p>
              <p className="hand text-xl mt-5 text-ink/70 -rotate-1">{s.note}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
