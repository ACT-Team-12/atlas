import type { PaperFirstView } from "@/lib/paperFirst";

/**
 * Renders one step by the paper-first rule (lib/paperFirst.ts). Certified: the explanation, then the paper's words
 * right under it. Anything else: the paper's words first, labelled "Copied word for word from your paper", then the
 * explanation, smaller, under a label saying it was not double-checked yet.
 * `variant="print"` uses the plain classes of the printed handoff sheet.
 */
export function PaperFirst({ v, variant = "screen" }: { v: PaperFirstView; variant?: "screen" | "print" }) {
  if (!v.quote) return null;
  const print = variant === "print";
  if (v.lead === "explanation") {
    return (
      <div data-lead="explanation">
        <p data-explanation="" className={print ? "" : "mt-1"}>{v.explanation}</p>
        <p data-paper-quote="" className={print ? "quote" : "mt-2 border-l-4 border-sun pl-2 text-xs italic text-ink/70"}>
          {v.quoteLabel} &ldquo;{v.quote}&rdquo;
        </p>
      </div>
    );
  }
  if (print) {
    return (
      <div data-lead="quote">
        <p data-paper-quote="" className="quote">{v.quoteLabel} &ldquo;{v.quote}&rdquo;</p>
        {v.explanation && <p data-explanation="" data-secondary="" className="secondary"><span>{v.note}</span> {v.explanation}</p>}
      </div>
    );
  }
  return (
    <div data-lead="quote">
      <div data-paper-quote="" className="mt-1 border-l-4 border-sun pl-2">
        <p className="text-[11px] font-extrabold uppercase tracking-wide text-teal-deep">{v.screenLabel}</p>
        <p className="font-semibold">&ldquo;{v.quote}&rdquo;</p>
      </div>
      {v.explanation && (
        <div data-explanation="" data-secondary="" className="mt-3 text-sm text-ink/70">
          <p className="text-xs font-bold">{v.note}</p>
          <p>{v.explanation}</p>
        </div>
      )}
    </div>
  );
}
