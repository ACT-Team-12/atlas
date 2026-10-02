"use client";

import { useRef } from "react";
import { setupGsap, useGSAP, gsap, prefersReducedMotion } from "./motion/gsap";

/** Every number is quoted from the linked primary source (verified 2026-10-01). */
const STATS = [
  { big: "36%", line: "of US adults have Basic or Below Basic health literacy. Below Basic is about double the national rate among Medicaid recipients (30%) and the uninsured (28%).",
    src: "NCES, National Assessment of Adult Literacy", href: "https://nces.ed.gov/pubs2006/2006483.pdf", rot: -2 },
  { big: "34.8%", line: "of 103,737 referral scheduling attempts in one large health system ended in a documented completed appointment.",
    src: "Patel et al., J Gen Intern Med 2018", href: "https://link.springer.com/article/10.1007/s11606-018-4392-z", rot: 1.5 },
  { big: "5.8M", line: "people in the US delayed medical care in 2017 because they did not have transportation.",
    src: "Wolfe et al., Am J Public Health 2020", href: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7204444/", rot: -1 },
];

export function Why() {
  const root = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      setupGsap();
      if (prefersReducedMotion()) return;
      const q = gsap.utils.selector(root);
      gsap.from(q(".why-stat"), { scale: 0.6, rotate: -8, y: "-2em", opacity: 0, duration: 0.9, ease: "elastic.out(1,0.8)", stagger: 0.12,
        scrollTrigger: { trigger: root.current, start: "top 70%", once: true } });
    },
    { scope: root },
  );
  return (
    <section ref={root} id="why" className="relative px-3 mt-3 scroll-mt-20" aria-labelledby="why-title">
      <div className="section-card bg-sky px-6 sm:px-12 py-24">
        <p className="hand text-3xl text-sky-deep -rotate-1 mb-5">why this exists</p>
        <h2 id="why-title" className="display text-[clamp(2.4rem,5vw,5rem)] max-w-[15em]">The visit ends. The hard part starts in the parking lot.</h2>
        <div className="mt-14 grid md:grid-cols-3 gap-8">
          {STATS.map((s) => (
            <a key={s.big} href={s.href} target="_blank" rel="noreferrer" className="why-stat group card block p-7 transition-transform hover:-translate-y-1" style={{ rotate: `${s.rot}deg` }}>
              <p className="display text-[clamp(3rem,4.6vw,4.4rem)] text-sky-deep">{s.big}</p>
              <p className="mt-3 text-lg font-semibold leading-snug">{s.line}</p>
              <p className="mt-5 text-sm font-bold text-ink/60 group-hover:text-ink underline decoration-2 underline-offset-4">Source: {s.src} ↗</p>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
