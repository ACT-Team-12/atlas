import type { OpenPeriod } from "./resources";

/**
 * Do these opening hours really come from this quote? Used to keep clinic-site hours honest.
 *
 * The quote is split into parts, each starting with a day expression ("Monday - Friday", "MON", "Tuesday –
 * Friday,"). Each part covers a set of days. For every open period, its day must be covered by some part, and
 * its opening and closing time must each appear, with am/pm, in a part covering that day. Times are matched on
 * token boundaries, so "1" does not match inside "10" (Codex review, 2026-10-02).
 */
const DAY_RE = "(mon(?:day)?s?|tue(?:s(?:day)?)?s?|wed(?:nesday)?s?|thu(?:r(?:s(?:day)?)?)?s?|fri(?:day)?s?|sat(?:urday)?s?|sun(?:day)?s?)";
const JOIN_RE = "\\s*(-|to|through|thru|&|and|,)\\s*";
const dayIndex = (t: string) => ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].indexOf(t.slice(0, 3));

export function normalizeQuote(q: string) {
  return q.toLowerCase().replace(/\*\*/g, " ").replace(/[–—]/g, "-").replace(/ | /g, " ")
    .replace(/\b([ap])\.\s?m\.?/g, "$1m").replace(/\s+/g, " ").trim();
}

type Part = { days: Set<number>; text: string };

export function quoteParts(quote: string): Part[] {
  const q = normalizeQuote(quote);
  const expr = new RegExp(`\\b${DAY_RE}(?:${JOIN_RE}${DAY_RE}\\b)*\\b`, "g");
  const found = [...q.matchAll(expr)];
  return found.map((m, i) => {
    const days = new Set<number>();
    const tokens = [...m[0].matchAll(new RegExp(`${DAY_RE}|(-|to|through|thru)`, "g"))].map((t) => t[0].trim());
    for (let k = 0; k < tokens.length; k++) {
      const d = dayIndex(tokens[k]);
      if (d < 0) continue;
      const isRange = ["-", "to", "through", "thru"].includes(tokens[k + 1] ?? "") && dayIndex(tokens[k + 2] ?? "") >= 0;
      if (isRange) { const e = dayIndex(tokens[k + 2]); for (let x = d; x <= e; x++) days.add(x); k += 2; } else days.add(d);
    }
    const end = i + 1 < found.length ? found[i + 1].index! : q.length;
    return { days, text: q.slice(m.index! + m[0].length, end) };
  });
}

/** "08:00" -> a regex matching "8am", "8 am", "8:00 am"; "16:30" -> "4:30pm". The meridiem may be omitted only before a range. */
function timeRe(hhmm: string, allowBareBeforeRange: boolean) {
  const [h, m] = hhmm.split(":").map(Number);
  const h12 = h % 12 || 12, mer = h < 12 ? "am" : "pm";
  const mm = m ? `:${String(m).padStart(2, "0")}` : "(?::00)?";
  const withMer = `(?<![\\d:])${h12}${mm}\\s*${mer}\\b`;
  return new RegExp(allowBareBeforeRange ? `${withMer}|(?<![\\d:])${h12}${mm}(?=\\s*(?:-|to)\\s*\\d)` : withMer);
}

export function hoursMatchQuote(quote: string, hours: OpenPeriod[]): { ok: boolean; reason?: string } {
  const parts = quoteParts(quote);
  if (!parts.length) return { ok: false, reason: "no day names in the quote" };
  for (const p of hours) {
    const covering = parts.filter((x) => x.days.has(p.day));
    if (!covering.length) return { ok: false, reason: `day ${p.day} is not in the quote` };
    const sameMer = (Number(p.open.slice(0, 2)) < 12) === (Number(p.close.slice(0, 2)) < 12);
    if (!covering.some((x) => timeRe(p.open, sameMer).test(x.text))) return { ok: false, reason: `opening ${p.open} on day ${p.day} is not in the quote` };
    if (!covering.some((x) => timeRe(p.close, false).test(x.text))) return { ok: false, reason: `closing ${p.close} on day ${p.day} is not in the quote` };
  }
  return { ok: true };
}
