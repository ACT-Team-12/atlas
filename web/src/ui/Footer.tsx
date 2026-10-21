"use client";

import { useRef } from "react";
import { setupGsap, useGSAP, gsap } from "./motion/gsap";
import { Mark } from "./Mark";
import { SquashButton } from "./SquashButton";
import { useSite } from "./SiteLang";

export function Footer() {
  const root = useRef<HTMLElement>(null);
  const { s } = useSite();
  useGSAP(
    () => {
      setupGsap();
      const mm = gsap.matchMedia();
      mm.add("(min-width: 992px) and (prefers-reduced-motion: no-preference)", () => {
        const q = gsap.utils.selector(root);
        gsap.timeline({ scrollTrigger: { trigger: root.current, start: "clamp(top bottom)", end: "clamp(top top)", scrub: 0.2 } })
          .from(q(".ft-row"), { y: "-10em", ease: "none" }, 0)
          .from(q(".ft-tag"), { scale: 0.9, xPercent: -30, y: "14em", rotate: 20, ease: "none" }, 0);
      });
    },
    { scope: root },
  );
  return (
    <footer ref={root} className="relative px-3 pt-3 pb-3 mt-3">
      <div className="section-card bg-ink text-paper px-6 sm:px-12 py-20 overflow-hidden">
        <div className="ft-row grid lg:grid-cols-[1.4fr_1fr] gap-12 items-end">
          <div>
            <h2 className="display text-[clamp(2.4rem,5.6vw,5.6rem)]">{s("footer.title")}</h2>
            <div className="mt-8 flex flex-wrap gap-3">
              <SquashButton href="/#try" bg="var(--paper)" fg="var(--ink)" accent="var(--mint)">{s("footer.try")}</SquashButton>
              <SquashButton href="/tests" bg="var(--teal)" accent="var(--sun)">{s("trust.proofLink")}</SquashButton>
              {/* The repo is private (404 for visitors), so this points to the judge tour instead. */}
              <SquashButton href="/judge" bg="var(--ink-soft)" accent="var(--sky)">{s("footer.judges")}</SquashButton>
            </div>
          </div>
          <div className="ft-tag justify-self-end rotate-[-4deg] rounded-[1.5rem] bg-mint text-ink border-2 border-paper p-6 w-[16rem]">
            <p className="font-extrabold tracking-widest text-sm">{s("footer.step")}</p>
            <p className="display text-4xl mt-1">{s("footer.done")}</p>
            <p className="hand text-2xl mt-2">{s("footer.doneNote")}</p>
          </div>
        </div>
        <div className="ft-row mt-16 pt-8 border-t border-paper/20 flex flex-wrap items-center justify-between gap-6 text-sm font-semibold text-paper/70">
          <div className="flex items-center gap-3"><Mark size={36} /><span>ATLAS · Team 12 · ATL Innovation Cup 2026</span></div>
          <p>Akhil · Timothy · Lilian · Anusmita · Stephen · <a className="underline decoration-2 underline-offset-4 hover:text-paper" href="/privacy">{s("footer.privacy")}</a> · <a className="underline decoration-2 underline-offset-4 hover:text-paper" href="/tests">{s("nav.tests")}</a> · <a className="underline decoration-2 underline-offset-4 hover:text-paper" href="/download">{s("footer.apps")}</a> · <a className="underline decoration-2 underline-offset-4 hover:text-paper" href="/helper">{s("footer.helper")}</a> · <a className="underline decoration-2 underline-offset-4 hover:text-paper" href="/judge">{s("footer.judges")}</a></p>
        </div>
      </div>
    </footer>
  );
}
