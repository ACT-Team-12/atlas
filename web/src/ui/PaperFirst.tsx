import type { PaperFirstView } from "@/lib/paperFirst";
import { useUi } from "./UiLang";

/**
 * Renders one step by the paper-first rule (lib/paperFirst.ts). Certified: the explanation, then the paper's words
 * right under it. Anything else: the paper's words first, labelled "Copied word for word from your paper", then the
 * explanation, smaller, under a label saying it was not double-checked yet.
 * `variant="print"` uses the plain classes of the printed handoff sheet.
 */
export function PaperFirst({ v, variant = "screen" }: { v: PaperFirstView; variant?: "screen" | "print" }) {
  const { t } = useUi();
  if (!v.quote) return null;
  const print = variant === "print";
  // The labels in the person's language (lib/uiText.ts); the quote itself is never translated. lib/paperFirst.ts keeps
  // its English labels for what leaves the screen and for the phone ports.
  const src = v.screenLabel.endsWith("report") ? "report" : "paper";
  const quoteLabel = t(src === "report" ? "pf.says.report" : "pf.says.paper");
  const screenLabel = t(src === "report" ? "pf.screen.report" : "pf.screen.paper");
  const note = v.note === null ? null : t(v.note.startsWith("Plain words") ? "pf.note.unchecked" : "pf.note.flagged");
  if (v.lead === "explanation") {
    return (
      <div data-lead="explanation">
        <p data-explanation="" className={print ? "" : "mt-1"}>{v.explanation}</p>
        <p data-paper-quote="" className={print ? "quote" : "mt-2 border-l-4 border-sun pl-2 text-xs italic text-ink/70"}>
          {quoteLabel} &ldquo;{v.quote}&rdquo;
        </p>
      </div>
    );
  }
  if (print) {
    return (
      <div data-lead="quote">
        <p data-paper-quote="" className="quote">{quoteLabel} &ldquo;{v.quote}&rdquo;</p>
        {v.explanation && <p data-explanation="" data-secondary="" className="secondary"><span>{note}</span> {v.explanation}</p>}
      </div>
    );
  }
  return (
    <div data-lead="quote">
      <div data-paper-quote="" className="mt-1 border-l-4 border-sun pl-2">
        <p className="text-[11px] font-extrabold uppercase tracking-wide text-teal-deep">{screenLabel}</p>
        <p className="font-semibold">&ldquo;{v.quote}&rdquo;</p>
      </div>
      {v.explanation && (
        <div data-explanation="" data-secondary="" className="mt-3 text-sm text-ink/70">
          <p className="text-xs font-bold">{note}</p>
          <p>{v.explanation}</p>
        </div>
      )}
    </div>
  );
}
