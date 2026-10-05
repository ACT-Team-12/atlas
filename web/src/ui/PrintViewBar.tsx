"use client";

import { useEffect, useRef, useState } from "react";
import { printHelp, type PrintHelp } from "@/lib/printSupport";
import { closePrintView, PRINT_VIEW_EVENT, type PrintTarget } from "./printView";

/**
 * The bar over a sheet shown on screen (printView.ts): Print where the browser can print from a button, otherwise how to
 * print from its own menu or the phone's browser, and Done to go back. Rendered once in <body>, before the sheets, and
 * sticky in the page flow rather than fixed over it, so it can never cover the sheet at any width or text size.
 */
export function PrintViewBar() {
  const [target, setTarget] = useState<PrintTarget | null>(null);
  const [help, setHelp] = useState<PrintHelp | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    const on = (e: Event) => {
      setTarget((e as CustomEvent<PrintTarget>).detail);
      setHelp(printHelp(navigator.userAgent, navigator.maxTouchPoints ?? 0));
    };
    window.addEventListener(PRINT_VIEW_EVENT, on);
    return () => window.removeEventListener(PRINT_VIEW_EVENT, on);
  }, []);

  useEffect(() => {
    if (!target) return;
    heading.current?.focus();
    const close = () => { closePrintView(target); setTarget(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", esc);
    // The sheet can go away while shown (the plan went out of date): go back rather than leave a blank page.
    const gone = new MutationObserver(() => { if (!document.getElementById(target.sheetId)) close(); });
    gone.observe(document.body, { childList: true });
    return () => { document.removeEventListener("keydown", esc); gone.disconnect(); };
  }, [target]);

  // The wrapper is always in <body>, empty until a sheet is shown, so it stays ahead of the sheets (which are added to
  // <body> later) and the sticky bar sits above them.
  if (!target || !help) return <div id="print-view-bar" className="print:hidden" />;
  const done = () => { closePrintView(target); setTarget(null); };
  return (
    <div id="print-view-bar" role="region" aria-labelledby="print-view-title" data-print-view={target.sheetId} data-print-how={help.how}
      className="sticky top-0 z-[100] border-b-2 border-ink bg-sun px-4 py-3 print:hidden">
      <div className="mx-auto flex max-w-3xl flex-wrap items-start gap-3">
        <div className="min-w-[12rem] flex-1">
          <h2 id="print-view-title" ref={heading} tabIndex={-1} className="font-extrabold outline-none">Your sheet, ready to print</h2>
          <p className="text-sm font-semibold">{help.text}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          {help.how === "print" && (
            <button type="button" onClick={() => window.print()}
              className="rounded-full border-2 border-ink bg-ink px-4 py-2 font-extrabold text-paper focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-teal-deep">
              Print
            </button>
          )}
          <button type="button" onClick={done}
            className="rounded-full border-2 border-ink bg-paper px-4 py-2 font-extrabold focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-teal-deep">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
