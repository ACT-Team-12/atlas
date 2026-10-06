"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Mark } from "./Mark";
import { ThemeToggle } from "./ThemeToggle";
import { SiteLangPicker, useSite } from "./SiteLang";
import type { SiteKey } from "@/lib/siteText";

const LINKS: { href: string; label: SiteKey }[] = [
  { href: "/#how", label: "nav.how" },
  { href: "/#try", label: "nav.try" },
  { href: "/#why", label: "nav.why" },
  { href: "/#trust", label: "nav.trust" },
  { href: "/tests", label: "nav.tests" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const { s, lang } = useSite();
  // On a phone, translated labels are longer than the English ones: the wordmark folds away as it does on scroll, so
  // the language picker and "Try it" fit (measured at 360 and 390 px in all 7 languages).
  const compact = scrolled || lang !== "English";
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 50);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  return (
    <header data-covers-top="" className="fixed top-3 inset-x-3 z-50 flex items-center justify-between gap-2 sm:gap-3 pointer-events-none">
      <Link href="/" className="pointer-events-auto flex items-center gap-2 rounded-full bg-paper/90 backdrop-blur px-3 py-2 border-2 border-ink shadow-[0_2px_0_var(--ink)]">
        <Mark size={28} />
        <span className={`display text-lg transition-[max-width,opacity] duration-500 overflow-hidden whitespace-nowrap ${compact ? "max-w-0 opacity-0 sm:max-w-[8em] sm:opacity-100" : "max-w-[8em]"}`}>
          ATLAS
        </span>
      </Link>
      <div className="pointer-events-auto flex items-center gap-1 sm:gap-1.5">
      <nav aria-label="Main" className="hidden md:flex items-center gap-1.5">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href}
            className="rounded-full bg-mint-soft border-2 border-ink px-4 py-2 font-bold text-sm hover:bg-mint transition-colors shadow-[0_2px_0_var(--ink)]">
            {s(l.label)}
          </Link>
        ))}
      </nav>
      <SiteLangPicker />
      <ThemeToggle />
      <Link href="/#try" className="md:hidden whitespace-nowrap rounded-full bg-ink text-paper px-3 sm:px-4 py-2.5 font-bold text-sm">{s("nav.try")}</Link>
      </div>
    </header>
  );
}
