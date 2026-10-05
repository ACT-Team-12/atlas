"use client";

import { useEffect, useRef, useState } from "react";
import { closePrintView, PRINT_VIEW_EVENT, type PrintTarget } from "./printView";

/**
 * The bar over a sheet shown on screen because this browser can't print from a button (printView.ts). It says how to
 * print from the browser's own menu, and Done goes back. Rendered once, in <body>, so it stays visible while the rest
 * of the page is hidden.
 */
export function PrintViewBar() {
  const [target, setTarget] = useState<PrintTarget | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const on = (e: Event) => setTarget((e as CustomEvent<PrintTarget>).detail);
    window.addEventListener(PRINT_VIEW_EVENT, on);
    return () => window.removeEventListener(PRINT_VIEW_EVENT, on);
  }, []);

  useEffect(() => {
    if (!target) return;
    heading.current?.focus();
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") done(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
    // done only reads target, which is this effect's dependency
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);

  function done() {
    if (!target) return;
    closePrintView(target);
    setTarget(null);
  }

  if (!target) return null;
  return (
    <div id="print-view-bar" role="region" aria-labelledby="print-view-title" data-print-view={target.sheetId}
      className="fixed inset-x-0 top-0 z-[100] border-b-2 border-ink bg-sun px-4 py-3 print:hidden">
      <div className="mx-auto flex max-w-3xl items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="print-view-title" ref={heading} tabIndex={-1} className="font-extrabold outline-none">This is your sheet, ready to print</h2>
          <p className="text-sm font-semibold">
            This browser can&apos;t print from a button. Use its menu: tap Share (the square with an arrow) or the &#8943; menu,
            then Print, where you can also save it as a PDF. Or open ATLAS in Safari.
          </p>
        </div>
        <button type="button" onClick={done}
          className="shrink-0 rounded-full border-2 border-ink bg-paper px-4 py-2 font-extrabold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-teal-deep">
          Done
        </button>
      </div>
    </div>
  );
}
