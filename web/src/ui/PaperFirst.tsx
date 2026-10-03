import type { PaperFirstView } from "@/lib/paperFirst";

/**
 * Renders one step by the paper-first rule (lib/paperFirst.ts). Certified: the explanation, then the paper's words
 * right under it. Anything else: the paper's words first, then the explanation, smaller, with why it is secondary.
 * `variant="print"` uses the plain classes of the printed handoff sheet.
 */
export function PaperFirst({ v, variant = "screen" }: { v: PaperFirstView; variant?: "screen" | "print" }) {
  if (!v.quote) return null;
  const print = variant === "print";
  const quote = (
    <p data-paper-quote="" className={print ? "quote" : v.lead === "quote" ? "mt-1 font-semibold" : "mt-2 border-l-4 border-sun pl-2 text-xs italic text-ink/70"}>
      {v.quoteLabel} &ldquo;{v.quote}&rdquo;
    </p>
  );
  if (v.lead === "explanation") {
    return (
      <div data-lead="explanation">
        <p data-explanation="" className={print ? "" : "mt-1"}>{v.explanation}</p>
        {quote}
      </div>
    );
  }
  return (
    <div data-lead="quote">
      {quote}
      {v.explanation && (
        <p data-explanation="" data-secondary="" className={print ? "secondary" : "mt-2 text-sm text-ink/70"}>
          <span className="font-bold">{v.note}</span> {v.explanation}
        </p>
      )}
    </div>
  );
}
