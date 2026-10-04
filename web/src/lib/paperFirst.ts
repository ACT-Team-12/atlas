/**
 * Paper first: the one rule every surface uses to show an AI explanation next to the paper's own words.
 *
 * Word lists and a second model can only REDUCE how often an explanation is certified; neither can promise that an
 * explanation means what the paper says. So the guarantee is structural:
 *
 * - Certified (the meaning check said "same" and every number checks out): the explanation may lead, and the paper's
 *   verbatim quote is shown right with it.
 * - Anything else (still checking, check failed, unclear, flagged, never checked): the paper's verbatim quote leads,
 *   labelled "Copied word for word from your paper" on screen, and the explanation is visibly secondary under a label
 *   saying it was not double-checked yet.
 * - Text that leaves the screen (read aloud, share, print) carries the explanation ONLY when certified. Otherwise it
 *   carries the quote alone, plus the note.
 * - No quote, no explanation: an explanation with nothing from the paper to stand next to is never shown.
 *
 * Pure functions. Safe to import in the browser and on the server.
 */

export type Check = "certified" | "flagged" | "unchecked";

/** The second check's result for one item, as any surface has it (missing means it never ran or hasn't finished). */
export function checkOf(m: { certified?: boolean; flagged?: boolean } | null | undefined): Check {
  if (m?.flagged) return "flagged";
  if (m?.certified) return "certified";
  return "unchecked";
}

export type PaperFirstView = {
  /** What the person sees first. "explanation" only when certified. */
  lead: "explanation" | "quote";
  /** The label for the quote in text that leaves the screen (read aloud, share, print), e.g. "Your paper says:". */
  quoteLabel: string;
  /** The label for the quote on screen when it leads: a reassurance, e.g. "Copied word for word from your paper". */
  screenLabel: string;
  /** The verbatim words from the paper. Always present when anything is shown. */
  quote: string;
  /** The AI's words (title, when, explanation joined), or null when there is nothing to show. */
  explanation: string | null;
  /** Why the explanation is secondary, or null when certified. */
  note: string | null;
};

const NOTE: Record<Exclude<Check, "certified">, string> = {
  // A label, not an instruction: the paper's words are already right above it, and "Ask your pharmacist" (askPerson.ts)
  // is the help offered instead of "go read your paper".
  unchecked: "Plain words (not double-checked yet)",
  flagged: "Explanation that our second check says may not match your paper. Follow your paper, and ask your clinic.",
};

/**
 * The view for one step. `explanation` is every AI-written string the surface would show for it (title, when,
 * plain words), in order; empty parts are dropped. `source` names what the quote comes from ("paper", "report").
 */
export function paperFirstView(input: { quote: string; explanation: (string | null | undefined)[]; check: Check; source?: string }): PaperFirstView {
  const quote = input.quote.trim();
  const words = input.explanation.map((s) => (s ?? "").trim()).filter(Boolean).join(" · ");
  const quoteLabel = `Your ${input.source ?? "paper"} says:`;
  const screenLabel = `Copied word for word from your ${input.source ?? "paper"}`;
  if (!quote) return { lead: "quote", quoteLabel, screenLabel, quote: "", explanation: null, note: null };
  if (input.check === "certified" && words) return { lead: "explanation", quoteLabel, screenLabel, quote, explanation: words, note: null };
  return { lead: "quote", quoteLabel, screenLabel, quote, explanation: words || null, note: words ? NOTE[input.check === "certified" ? "unchecked" : input.check] : null };
}

/** The lines a surface may read aloud, share or print for one step: the explanation only when certified. */
export function paperFirstLines(v: PaperFirstView): string[] {
  if (!v.quote) return [];
  const quoteLine = `${v.quoteLabel} "${v.quote}"`;
  if (v.lead === "explanation" && v.explanation) return [v.explanation, quoteLine];
  if (!v.note) return [quoteLine];
  return [quoteLine, v.note === NOTE.flagged ? LEFT_OUT.flagged : LEFT_OUT.unchecked];
}

const LEFT_OUT = {
  unchecked: "(The plain-words explanation is left out here because it was not double-checked yet.)",
  flagged: "(The plain-words explanation is left out here because a second check says it may not match.)",
};

/** One care-plan step. Certified: the title and when stay in the card header and the plain words lead. Otherwise the
 *  AI's title and when are part of the secondary explanation too, since they are its words, not the paper's. */
export function careStepView(it: { title: string; when: string; plain_language: string; source_quote: string }, check: Check): PaperFirstView {
  return paperFirstView({ quote: it.source_quote, explanation: check === "certified" ? [it.plain_language] : [it.title, it.when, it.plain_language], check });
}

/** One lab row: the report's own line leads; the AI's plain name for the test is never checked, so it is secondary. */
export function labRowView(r: { quote: string; plain_name: string }): PaperFirstView {
  return paperFirstView({ quote: r.quote, explanation: [r.plain_name], check: "unchecked", source: "report" });
}

/** What the meaning check is asked about: every AI string a certified card shows, the title included (round 13). */
export const checkedText = (title: string, plain: string) => [title.trim(), plain.trim()].filter(Boolean).join(". ");

const BOOK_TITLE: Record<string, string> = {
  medication: "Medicine", lab_test: "Lab test", referral: "Referral", follow_up_visit: "Follow-up visit", self_care: "Self care", warning_sign: "Warning sign",
};

/**
 * A care step as booking (call script, calendar event and its alarms) may use it: the title is the step's kind,
 * never the AI's title, and the AI's "when" goes only with a certified step. The quote always goes (round 13).
 */
export function bookSafe<T extends { id: string; kind: string; title: string; when: string; source_quote: string }>(it: T, check: Check): T {
  return { ...it, title: `${BOOK_TITLE[it.kind] ?? "Appointment"} from your paper`, when: check === "certified" ? it.when : "" };
}
