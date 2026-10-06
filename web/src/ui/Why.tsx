"use client";

import { useRef } from "react";
import { setupGsap, useGSAP, gsap, prefersReducedMotion } from "./motion/gsap";
import { useSite } from "./SiteLang";

/** Every number is quoted from the linked primary source (verified 2026-10-01). The words are lib/siteText.ts why.N. */
const STATS = [
  { big: "36%", line: "why.0",
    src: "NCES, National Assessment of Adult Literacy", href: "https://nces.ed.gov/pubs2006/2006483.pdf", rot: -2 },
  { big: "34.8%", line: "why.1",
    src: "Patel et al., J Gen Intern Med 2018", href: "https://link.springer.com/article/10.1007/s11606-018-4392-z", rot: 1.5 },
  { big: "5.8M", line: "why.2",
    src: "Wolfe et al., Am J Public Health 2020", href: "https://pmc.ncbi.nlm.nih.gov/articles/PMC7204444/", rot: -1 },
] as const;

export function Why() {
  const root = useRef<HTMLElement>(null);
  const { s: t } = useSite();
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
        {/* The section's point leads (a teammate's review, Oct 4): what it is about, big; the line under it, smaller. */}
        <h2 id="why-title" className="display text-[clamp(2.6rem,5.5vw,5.5rem)] text-sky-deep">{t("why.title")}</h2>
        <p className="mt-4 text-[clamp(1.35rem,2.4vw,2.1rem)] font-bold leading-snug max-w-[24em]">{t("why.lead")}</p>
        <div className="mt-14 grid md:grid-cols-3 gap-8">
          {STATS.map((s) => (
            <a key={s.big} href={s.href} target="_blank" rel="noreferrer" className="why-stat group card block p-7 transition-transform hover:-translate-y-1" style={{ rotate: `${s.rot}deg` }}>
              <p className="display text-[clamp(3rem,4.6vw,4.4rem)] text-sky-deep">{s.big}</p>
              <p className="mt-3 text-lg font-semibold leading-snug">{t(s.line)}</p>
              <p className="mt-5 text-sm font-bold text-ink/70 group-hover:text-ink underline decoration-2 underline-offset-4">{t("why.source")} <span lang="en">{s.src}</span> ↗</p>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}
