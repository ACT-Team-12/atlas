/**
 * PHI shield: finds a patient's identifying details in a paper and swaps each for a placeholder like ⟦NAME_A⟧
 * before the text reaches an AI vendor. The real words are put back (strings AND character offsets) before
 * anything reaches the screen. Pure and deterministic: no model, no network, no storage, no logging.
 *
 * Hidden: the patient's name (and later uses of it, first name alone, "Ms. Lopez"), date of birth, an age over 89,
 * record / account / member / insurance ids, SSN, and the patient's own phone, email and street address.
 * Kept on purpose: visit and test dates, clinic and doctor names, clinic and referral phone numbers, medicines,
 * doses, tests and diagnoses. The care steps need them, and they identify the provider, not the patient.
 *
 * Three rules, each enforced below and tested in phiShield.test.ts:
 *  - A date is hidden only when it is labeled as a birth date (DOB, Date of birth, Born) or sits under such a label in
 *    a header table. Any other date stays.
 *  - A phone, email or address is hidden only when it is labeled as the patient's (Home phone, Cell, Patient
 *    address...) or a plain "Phone:" / "Address:" / "Email:" sits in the patient's own header lines. An unlabeled
 *    number ("call 404-555-0134") always stays.
 *  - Ids are hidden only when labeled (MRN, Acct, Member ID...), except the SSN shape 123-45-6789, which is hidden
 *    anywhere.
 *
 * Placeholders end in LETTERS, never digits: the missed-lines check treats every digit in a sentence as a number a
 * quote must cover, and the meaning check compares numbers, so a digit in a placeholder would change both.
 */

export const PHI_KINDS = ["NAME", "DOB", "AGE", "MRN", "ACCT", "ID", "SSN", "PHONE", "EMAIL", "ADDR"] as const;
export type PhiKind = (typeof PHI_KINDS)[number];

/** Added to every AI prompt that reads a shielded paper: copy placeholders exactly in quotes, never write them elsewhere. */
export const PLACEHOLDER_RULE =
  "\n- Some personal details are hidden as placeholders like ⟦NAME_A⟧ or ⟦DOB_A⟧. Inside a quote, copy a placeholder exactly, character for character. Never guess what a placeholder hides, and never put one in your own words (titles, explanations, questions).";

/** Any placeholder this module can make. */
export const TOKEN_RE = /⟦(NAME|DOB|AGE|MRN|ACCT|ID|SSN|PHONE|EMAIL|ADDR)_([A-Z]{1,3})⟧/g;

/** One replaced stretch: [start, end) in the original text, [rStart, rEnd) in the redacted text. */
export type Segment = { start: number; end: number; rStart: number; rEnd: number; token: string; kind: PhiKind };

export type ShieldResult = {
  /** The redacted text: what the server and the AI see. */
  text: string;
  /** placeholder to original words. Kept in memory only, by whoever made it. */
  tokens: Map<string, string>;
  /** The replaced stretches in order, for mapping offsets back to the original. */
  offsetMap: Segment[];
};

type Hit = { start: number; end: number; kind: PhiKind };

/* ------------------------------------------------------------------------------------------ */
/* Patterns.                                                                                  */
/* ------------------------------------------------------------------------------------------ */

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE_SRC =
  String.raw`(?:\d{1,2}[\/.-]\d{1,2}[\/.-](?:\d{4}|\d{2})(?!\d)|\d{4}-\d{1,2}-\d{1,2}(?!\d)|(?:${MONTHS})\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}(?!\d)|\d{1,2}\s+(?:${MONTHS})\.?,?\s+\d{4}(?!\d))`;
const DATE_AT = new RegExp(`^${DATE_SRC}`, "i");
const PHONE_SRC = String.raw`(?:\+?1[\s.-]*)?(?:\(\d{3}\)|\d{3})[\s.-]*\d{3}[\s.-]*\d{4}(?!\d)(?:\s*(?:x|ext\.?)\s*\d{1,5})?`;
const PHONE_AT = new RegExp(`^${PHONE_SRC}`, "i");
const EMAIL_SRC = String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`;
const EMAIL_AT = new RegExp(`^${EMAIL_SRC}`);
// An id: an optional short letter prefix, then a run that contains a digit, then more digit-bearing groups.
const ID_AT = /^(?:[A-Za-z]{1,5}[ -]?)?[A-Za-z0-9]*\d[A-Za-z0-9-]*(?:[ ][A-Za-z0-9]*\d[A-Za-z0-9-]*)*/;
const SSN_VALUE_AT = /^(?:\d{3}|[xX*]{3})[- ]?(?:\d{2}|[xX*]{2})[- ]?\d{4}(?!\d)/;
const SSN_ANYWHERE = /(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/g;

// After a label: optional spaces, then ":", "#", "-" or "." (any mix), then spaces. `strict` labels require one of them.
const SEP_OPT = String.raw`\s*(?:[:#.-]\s*)*`;
const SEP_REQ = String.raw`\s*[:#-][:#\s-]*`;

type LabelRule = { kind: PhiKind | "CONTACT_PHONE" | "CONTACT_ADDR" | "CONTACT_EMAIL"; re: RegExp; explicit?: boolean };

// Each rule matches a label (at a word start) and the separator after it. The value is read from where the match ends.
const L = (src: string, sep: string) => new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${src})${sep}`, "giu");
const LABELS: LabelRule[] = [
  { kind: "NAME", re: L(String.raw`patient(?:['’]s)?\s+(?:full\s+)?name|pt\.?\s+name|patient|pt|(?:full\s+)?name|emergency\s+contact|guardian|parent(?:\s*\/\s*guardian)?`, SEP_REQ) },
  { kind: "NAME", re: L(String.raw`patient(?:['’]s)?\s+(?:full\s+)?name`, String.raw`\s+`) },
  { kind: "DOB", re: L(String.raw`d\.?\s?o\.?\s?b\.?|date\s+of\s+birth|birth\s*date|born(?:\s+on)?`, SEP_OPT) },
  { kind: "AGE", re: L(String.raw`age|aged`, SEP_OPT) },
  { kind: "MRN", re: L(String.raw`mrn|medical\s+record(?:\s+(?:number|no\.?|#))?|med\.?\s+rec(?:ord)?\.?(?:\s*(?:#|no\.?|number))?|chart\s*(?:#|number|no\.?)|patient\s+id|pt\.?\s+id`, SEP_OPT) },
  { kind: "ACCT", re: L(String.raw`acct\.?(?:\s*(?:#|no\.?|number))?|account(?:\s*(?:#|no\.?|number))?|encounter\s*(?:#|no\.?|number|id)|csn|fin`, SEP_OPT) },
  { kind: "ID", re: L(String.raw`member\s*(?:id|#|no\.?|number)|insurance\s*(?:id|#|no\.?|number)|subscriber\s*(?:id|#|no\.?|number)|policy\s*(?:id|#|no\.?|number)|medicaid\s*(?:id|#|no\.?|number)|medicare\s*(?:id|#|no\.?|number)|id\s*#`, SEP_OPT) },
  { kind: "ID", re: L(String.raw`id`, SEP_REQ) },
  { kind: "SSN", re: L(String.raw`ssn|ss#|social\s+security(?:\s+(?:number|no\.?|#))?|soc\.?\s+sec\.?(?:\s*#)?`, SEP_OPT) },
  // Contact labels that say on their own that the value is the patient's.
  { kind: "CONTACT_PHONE", explicit: true, re: L(String.raw`patient(?:['’]s)?\s+(?:phone|tel(?:ephone)?|number)|home\s+(?:phone|tel(?:ephone)?|number)|cell(?:\s*phone)?|mobile(?:\s*phone)?|your\s+phone(?:\s+number)?|primary\s+phone|contact\s+(?:phone|number)`, SEP_REQ) },
  { kind: "CONTACT_ADDR", explicit: true, re: L(String.raw`patient(?:['’]s)?\s+address|home\s+address|mailing\s+address|your\s+address|street\s+address`, SEP_REQ) },
  { kind: "CONTACT_EMAIL", explicit: true, re: L(String.raw`patient(?:['’]s)?\s+e-?mail|your\s+e-?mail|personal\s+e-?mail`, SEP_REQ) },
  // Plain contact labels: hidden only in the patient's own header lines.
  { kind: "CONTACT_PHONE", re: L(String.raw`phone(?:\s+(?:number|#|no\.?))?|tel(?:ephone)?|ph`, SEP_REQ) },
  { kind: "CONTACT_ADDR", re: L(String.raw`address|addr`, SEP_REQ) },
  { kind: "CONTACT_EMAIL", re: L(String.raw`e-?mail`, SEP_REQ) },
];

/** Words that, right before a plain label, say it belongs to the clinic or a provider ("Clinic phone:", "Provider name:"). */
const PROVIDER_QUALIFIER = /(?:^|[^\p{L}])(?:clinic|office|provider|doctor|dr\.?|physician|pcp|facility|pharmacy|hospital|practice|department|dept\.?|nurse|nursing|after[\s-]?hours|scheduling|appointments?|appt\.?|billing|fax|lab|laboratory|referral|specialist|medication|medicine|drug|test|plan|program|company|employer|insurance|main|front\s+desk|location|site|center)\s*$/iu;

/** Field labels that are not identifiers but end a value on a header line ("Visit:", "Provider:"). */
const OTHER_FIELD = /(?<![\p{L}\p{N}])(?:visit(?:\s+date)?|date(?:\s+of\s+(?:service|visit))?|provider|pcp|doctor|physician|attending|clinic|location|department|dept|room|sex|gender|allergies|weight|height|language|reason(?:\s+for\s+visit)?|diagnosis|admitted|discharged|admission|discharge|insurance|plan|fax|time|appointment|appt)\s*:/giu;

/** Words that end (or rule out) a name value: care words, field words, instruction words. */
const NOT_NAME = new Set([
  "please", "take", "call", "return", "follow", "you", "your", "the", "a", "an", "is", "was", "has", "will", "should", "to", "for",
  "with", "at", "in", "on", "of", "and", "or", "if", "see", "education", "instructions", "information", "portal", "name", "dob",
  "date", "birth", "born", "age", "sex", "gender", "mrn", "acct", "account", "member", "id", "ssn", "phone", "visit", "provider",
  "clinic", "medicine", "medical", "family", "health", "care", "center", "hospital", "primary", "pediatrics", "urgent",
  "emergency", "department", "summary", "after", "discharge", "instruction", "pcp", "doctor", "dr", "md", "do", "np", "rn", "pa",
  "address", "email", "e-mail", "tel", "cell", "home", "mobile", "unknown", "none", "n/a", "na", "self", "same", "above",
  "male", "female", "room", "allergies", "insurance", "diagnosis", "reason", "attending", "admitted", "discharged",
]);
/** Kept out of name spreading: titles, suffixes, month and day names (a patient called "May" must not hide "May 5"). */
const NO_SPREAD = new Set([
  "mr", "mrs", "ms", "miss", "mx", "jr", "sr", "ii", "iii", "iv",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
]);
const NAME_WORD = /^[\p{L}][\p{L}'’.-]*/u;
/** Both spellings a paper uses for a word: "Clinic" and "CLINIC" (and "clinic" when `lower`). */
const caps = (words: string[], lower = false) =>
  words.flatMap((w) => [w[0].toUpperCase() + w.slice(1), w.toUpperCase(), ...(lower ? [w] : [])]).join("|");
/** Provider titles and credentials: "Dr. Lee" and "Lee, MD" are the doctor, never the patient. */
const PROVIDER_BEFORE = new RegExp(
  String.raw`(?:^|[^\p{L}])(?:${caps(["dr", "doctor", "nurse", "np", "pa", "rn", "md", "dds", "dmd", "prof", "professor", "provider", "physician"], true)})\.?\s+(?:\p{Lu}[\p{L}'’.-]*\s+){0,2}$`, "u");
const PROVIDER_AFTER = /^,?\s*(?:m\.?d\.?|d\.?o\.?|n\.?p\.?|r\.?n\.?|p\.?a\.?(?:-c)?|f\.?n\.?p\.?|d\.?n\.?p\.?|ph\.?d\.?|dds|dmd|aprn|cnm|pharmd)(?![\p{L}])/iu;
/** Organization words, capitalized as in a name: "Grady Primary Care", "Lopez Family Clinic", "Smith Street". */
const ORG_WORDS = ["clinic", "hospital", "medical", "medicine", "health", "healthcare", "care", "center", "centre", "pharmacy", "family",
  "primary", "pediatrics", "memorial", "university", "street", "st", "avenue", "ave", "road", "rd", "boulevard", "blvd", "drive",
  "lane", "ln", "way", "county", "lab", "labs", "laboratory", "urgent", "dental", "women's", "womens", "children's", "childrens",
  "institute", "group", "associates", "practice"];
const ORG_AFTER = new RegExp(String.raw`^\s+(?:\p{Lu}[\p{L}'’.-]*\s+){0,2}(?:${caps(ORG_WORDS)})\.?(?![\p{L}])`, "u");
const HONORIFIC = /(?<![\p{L}])(?:Mr|Mrs|Ms|Miss|Mx)\.?\s+([\p{Lu}][\p{L}'’-]+)/gu;
const AGE_PHRASE = /(?<![\p{L}\p{N}])(\d{2,3})(?:[\s-]*(?:years?|yrs?)[\s-]*old|[\s-]*y\.?\s?\/?\s?o\.?(?![\p{L}]))/giu;
const CITY_STATE_ZIP = /^[ \t]*[\p{L}][\p{L} .'’-]*,?\s+[A-Z]{2}\.?\s+\d{5}(?:-\d{4})?[ \t]*$/u;

const isSpace = (c: string | undefined) => c === " " || c === "\t";

/* ------------------------------------------------------------------------------------------ */
/* Placeholder bookkeeping.                                                                   */
/* ------------------------------------------------------------------------------------------ */

const letters = (n: number): string => {
  // 0 -> A, 25 -> Z, 26 -> AA ... (bijective base 26)
  let s = "";
  let k = n + 1;
  while (k > 0) {
    const r = (k - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    k = Math.floor((k - 1) / 26);
  }
  return s;
};

/** Placeholders already in a text (a paper that was shielded before, or one that happens to contain the bracket). */
export function tokensIn(text: string): string[] {
  return [...text.matchAll(new RegExp(TOKEN_RE.source, "g"))].map((m) => m[0]);
}

/* ------------------------------------------------------------------------------------------ */
/* The session.                                                                               */
/* ------------------------------------------------------------------------------------------ */

/**
 * One shielding session: the papers and fields of one request (server) or of one page (client). Names and ids
 * found in one text are hidden in every text this session shields, with the same placeholder for the same words.
 */
export class PhiShield {
  /** placeholder -> original */
  readonly tokens = new Map<string, string>();
  private readonly byOriginal = new Map<string, string>();
  private readonly counters = new Map<PhiKind, number>();
  private readonly reserved = new Set<string>();
  /** Words to hide wherever they appear (names), and exact values (ids, phones, emails). */
  private readonly names = new Map<string, true>();
  private readonly values = new Map<string, PhiKind>();

  constructor(opts: { reserved?: Iterable<string> } = {}) {
    for (const t of opts.reserved ?? []) this.reserved.add(t);
  }

  /** Learns the identifiers in a text (labels, header lines) so later texts in this session hide them too. */
  learn(text: string): void {
    for (const t of tokensIn(text)) this.reserved.add(t);
    for (const h of detectPositional(text)) this.remember(text.slice(h.start, h.end), h.kind);
  }

  /** True when this session has learned any identifier. */
  get knowsAny(): boolean {
    return this.names.size > 0 || this.values.size > 0;
  }

  /**
   * Most names and ids one session spreads through later text. A real paper has one patient (a few name parts, a
   * handful of ids); the cap keeps a crafted paper with thousands of "Name:" labels from making every later text pay
   * once per name. Each labeled occurrence is still hidden where it stands; only the spreading stops growing.
   */
  static readonly MAX_SPREAD = 48;
  /** Longest name or id value that is spread (a real name or id is short; a run-on "value" is not one). */
  static readonly MAX_SPREAD_LEN = 80;

  /** How many names and ids this session spreads (for tests). */
  get spreadCount(): number {
    return this.names.size + this.values.size;
  }

  private remember(value: string, kind: PhiKind): void {
    const v = value.trim();
    if (!v || v.length > PhiShield.MAX_SPREAD_LEN) return;
    const room = () => this.names.size + this.values.size < PhiShield.MAX_SPREAD;
    if (kind === "NAME") {
      if (room()) this.names.set(v, true);
      for (const part of v.split(/[\s,]+/)) {
        const p = part.replace(/^[.'’-]+|[.'’-]+$/g, "");
        if (p.length >= 2 && !NO_SPREAD.has(p.toLowerCase()) && !NOT_NAME.has(p.toLowerCase()) && room()) this.names.set(p, true);
      }
    } else if (!room()) {
      return;
    } else if ((kind === "MRN" || kind === "ACCT" || kind === "ID" || kind === "SSN") && v.replace(/[^A-Za-z0-9]/g, "").length >= 5) {
      this.values.set(v, kind);
    } else if (kind === "PHONE" || kind === "EMAIL") {
      this.values.set(v, kind);
    }
  }

  private tokenFor(original: string, kind: PhiKind): string {
    const key = `${kind}\u0000${original}`;
    const have = this.byOriginal.get(key);
    if (have) return have;
    let n = this.counters.get(kind) ?? 0;
    let token: string;
    do token = `⟦${kind}_${letters(n++)}⟧`;
    while (this.reserved.has(token) || this.tokens.has(token));
    this.counters.set(kind, n);
    this.byOriginal.set(key, token);
    this.tokens.set(token, original);
    return token;
  }

  /** Shields one text with everything this session knows plus what this text itself shows. */
  shield(text: string): ShieldResult {
    for (const t of tokensIn(text)) this.reserved.add(t);
    const hits: Hit[] = [...detectPositional(text)];
    for (const h of hits) this.remember(text.slice(h.start, h.end), h.kind);
    hits.push(...this.spread(text));
    // Placeholders already in the text are never touched. A prefix count of their characters answers "does this hit
    // overlap one?" in constant time per hit (a scan of every placeholder per hit is quadratic on a crafted paper).
    const inToken = new Uint32Array(text.length + 1);
    const marks = new Uint8Array(text.length);
    for (const b of tokenRanges(text)) marks.fill(1, b.start, b.end);
    for (let i = 0; i < text.length; i++) inToken[i + 1] = inToken[i] + marks[i];
    const chosen = resolve(hits.filter((h) => inToken[h.end] - inToken[h.start] === 0));

    let out = "";
    let at = 0;
    const offsetMap: Segment[] = [];
    for (const h of chosen) {
      out += text.slice(at, h.start);
      const original = text.slice(h.start, h.end);
      const token = this.tokenFor(original, h.kind);
      offsetMap.push({ start: h.start, end: h.end, rStart: out.length, rEnd: out.length + token.length, token, kind: h.kind });
      out += token;
      at = h.end;
    }
    out += text.slice(at);
    const tokens = new Map<string, string>();
    for (const s of offsetMap) tokens.set(s.token, this.tokens.get(s.token)!);
    return { text: out, tokens, offsetMap };
  }

  /** Every later use of a learned name or id, anywhere in the text. */
  private spread(text: string): Hit[] {
    const out: Hit[] = [];
    // One pass over the text for all names (at most MAX_SPREAD of them), longest first in the alternation, so
    // "Maria Lopez" wins over "Maria" where both match.
    const names = [...this.names.keys()].sort((a, b) => b.length - a.length);
    if (names.length) {
      const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.map((n) => escapeRe(n).replace(/\s+/g, "[ \\t]+")).join("|")})(?![\\p{L}\\p{N}])`, "giu");
      for (const m of text.matchAll(re)) {
        const start = m.index, end = start + m[0].length;
        if (!/\p{Lu}/u.test(m[0][0])) continue; // "may", "will", "rose" in a sentence are words, not the patient
        const before = text.slice(Math.max(0, start - 40), start);
        const after = text.slice(end, end + 60);
        if (PROVIDER_BEFORE.test(before) || PROVIDER_AFTER.test(after) || ORG_AFTER.test(after) || ORG_BEFORE.test(before)) continue;
        out.push({ start, end, kind: "NAME" });
      }
    }
    for (const [value, kind] of this.values) {
      const re = new RegExp(`(?<![A-Za-z0-9])${escapeRe(value)}(?![A-Za-z0-9])`, "g");
      for (const m of text.matchAll(re)) out.push({ start: m.index, end: m.index + m[0].length, kind });
    }
    return out;
  }
}

/** "Lopez" in "Memorial Lopez" / "St. Lopez" style org names: a capitalized org word right before. */
const ORG_BEFORE = new RegExp(String.raw`(?:^|[^\p{L}])(?:${caps(["clinic", "hospital", "medical", "health", "healthcare", "center", "pharmacy", "memorial", "university", "saint", "st"])})\.?\s+$`, "u");

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function tokenRanges(text: string): { start: number; end: number }[] {
  return [...text.matchAll(new RegExp(TOKEN_RE.source, "g"))].map((m) => ({ start: m.index, end: m.index + m[0].length }));
}

/** Keeps non-overlapping hits: earliest start first, the longer one on a tie. */
function resolve(hits: Hit[]): Hit[] {
  const sorted = [...hits].filter((h) => h.end > h.start).sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Hit[] = [];
  for (const h of sorted) {
    const last = out[out.length - 1];
    if (last && h.start < last.end) {
      if (h.end > last.end) last.end = h.end; // merge an overlap into one hidden stretch
      continue;
    }
    out.push({ ...h });
  }
  return out;
}

/* ------------------------------------------------------------------------------------------ */
/* Positional detection: labels, header lines, header tables.                                 */
/* ------------------------------------------------------------------------------------------ */

type Line = { start: number; end: number; text: string };

function splitLines(text: string): Line[] {
  const lines: Line[] = [];
  let start = 0;
  for (const m of text.matchAll(/\r\n|[\n\r\u0085\u2028\u2029]/g)) {
    lines.push({ start, end: m.index, text: text.slice(start, m.index) });
    start = m.index + m[0].length;
  }
  lines.push({ start, end: text.length, text: text.slice(start) });
  return lines;
}

type LabelHit = { rule: LabelRule; labelStart: number; valueStart: number };

/** All label matches on a line, earliest first, longest label on a tie, no two overlapping. */
function labelsOn(line: string): LabelHit[] {
  const found: LabelHit[] = [];
  for (const rule of LABELS) {
    rule.re.lastIndex = 0;
    for (const m of line.matchAll(rule.re)) found.push({ rule, labelStart: m.index, valueStart: m.index + m[0].length });
  }
  found.sort((a, b) => a.labelStart - b.labelStart || b.valueStart - a.valueStart);
  const out: LabelHit[] = [];
  for (const f of found) {
    const last = out[out.length - 1];
    if (last && f.labelStart < last.valueStart) continue;
    out.push(f);
  }
  return out.filter((f) => accept(line, f));
}

/** Drops label matches that are really part of a sentence or belong to a provider. */
function accept(line: string, f: LabelHit): boolean {
  // Only the words just before the label matter; a bounded slice keeps a line of thousands of labels linear.
  const before = line.slice(Math.max(0, f.labelStart - 48), f.labelStart);
  const label = line.slice(f.labelStart, f.valueStart);
  const k = f.rule.kind;
  // A label inside a sentence ("the patient: take ...", "born on", "age 7") is kept only if a real value follows it:
  // the value readers below decide (a name reader stops at instruction words, a date reader needs a date).
  if (PROVIDER_QUALIFIER.test(before) && !f.rule.explicit) return false;
  if (k === "NAME" && /^\s*(?:pt|patient)\b/i.test(label) === false && /^\s*name/i.test(label) && /(?:^|[^\p{L}])(?:your|my|his|her|their|the|drug|test|brand|generic|plan|program|user|file|company|business|street|facility|clinic|provider|doctor|pharmacy)\s+$/iu.test(before)) return false;
  // Lower-case labels mid-sentence ("born on", "age 7", "id") need a value right after, checked by the value readers.
  return true;
}

/**
 * Where values can end on a line: a wide gap, a tab, a bar or semicolon, or another field label ("Visit:"). Found once
 * per line, sorted, so finding each field's end is a binary search (rescanning the line per label is quadratic).
 */
function lineStops(line: string): number[] {
  const stops: number[] = [];
  for (const m of line.matchAll(/[ \t]{2,}|\t|[ \t]*\|[ \t]*|;/g)) stops.push(m.index);
  for (const m of line.matchAll(OTHER_FIELD)) stops.push(m.index);
  return stops.sort((a, b) => a - b);
}

/** Where a field's value ends: the first stop after it, the next label on the line, or the line end. */
function valueEnd(stops: readonly number[], lineLength: number, from: number, next: number | undefined): number {
  let lo = 0, hi = stops.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (stops[mid] > from) hi = mid; else lo = mid + 1;
  }
  return Math.min(next ?? lineLength, lo < stops.length ? stops[lo] : lineLength);
}

/** Reads a name value: up to 4 name-like words, stopping at a care / field / instruction word. */
function readName(s: string): number {
  let i = 0;
  let words = 0;
  let lastEnd = 0;
  const hon = /^(?:Mr|Mrs|Ms|Miss|Mx)\.?\s+/.exec(s);
  if (hon) i = hon[0].length;
  while (words < 4) {
    while (isSpace(s[i])) i++;
    if (s[i] === ",") { i++; continue; }
    const m = NAME_WORD.exec(s.slice(i));
    if (!m) break;
    const w = m[0].replace(/[.'’-]+$/, "");
    if (NOT_NAME.has(w.toLowerCase())) break;
    i += m[0].length;
    lastEnd = i;
    words++;
  }
  return words > 0 ? lastEnd : 0;
}

/** Length of the value of one labeled field at the start of `s` (already cut at the field's end), or 0. */
function readValue(kind: LabelRule["kind"], s: string): number {
  const lead = s.length - s.trimStart().length;
  const v = s.slice(lead);
  let n = 0;
  switch (kind) {
    case "NAME": n = readName(v); break;
    case "DOB": n = DATE_AT.exec(v)?.[0].length ?? 0; break;
    case "AGE": {
      const m = /^(\d{2,3})(?!\d)/.exec(v);
      n = m && Number(m[1]) >= 90 && Number(m[1]) <= 130 ? m[0].length : 0;
      break;
    }
    case "SSN": n = SSN_VALUE_AT.exec(v)?.[0].length ?? 0; break;
    case "MRN": case "ACCT": case "ID": {
      const m = ID_AT.exec(v);
      const id = m ? m[0].replace(/[\s-]+$/, "") : "";
      n = id && !DATE_AT.test(v) && id.replace(/[^A-Za-z0-9]/g, "").length >= 4 ? id.length : 0;
      break;
    }
    case "CONTACT_PHONE": n = PHONE_AT.exec(v)?.[0].length ?? 0; break;
    case "CONTACT_EMAIL": n = EMAIL_AT.exec(v)?.[0].length ?? 0; break;
    case "CONTACT_ADDR": n = /\d/.test(v) && /\p{L}/u.test(v) ? v.replace(/[\s,;]+$/, "").length : 0; break;
  }
  return n > 0 ? lead + n : 0;
}

const ANCHOR_KINDS = new Set<LabelRule["kind"]>(["NAME", "DOB", "MRN", "ACCT", "ID", "SSN"]);
const kindOf = (k: LabelRule["kind"]): PhiKind =>
  k === "CONTACT_PHONE" ? "PHONE" : k === "CONTACT_ADDR" ? "ADDR" : k === "CONTACT_EMAIL" ? "EMAIL" : k;

/**
 * Every identifier found by its position: labeled fields, the patient's header lines, a header table, an
 * honorific ("Ms. Lopez"), an age over 89, and the SSN shape.
 */
export function detectPositional(text: string): Hit[] {
  const lines = splitLines(text);
  const hits: Hit[] = [];
  let prevPatient = false;
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (!line.text.trim()) { prevPatient = false; continue; }
    const labels = labelsOn(line.text);
    // A line is the patient's when it carries an identity label with a value, or it is a field line
    // (it starts with a contact label) right under a patient line.
    const stops = labels.length ? lineStops(line.text) : [];
    const trimmedLength = line.text.trimEnd().length;
    const fields: { hit: LabelHit; len: number }[] = labels.map((hit, i) => {
      const end = valueEnd(stops, line.text.length, hit.valueStart, labels[i + 1]?.labelStart);
      return { hit, len: readValue(hit.rule.kind, line.text.slice(hit.valueStart, end)) };
    });
    const anchored = fields.some((f) => f.len > 0 && ANCHOR_KINDS.has(f.hit.rule.kind));
    const startsWithField = labels.length > 0 && /^\s*(?:[-*•>]\s*)?$/.test(line.text.slice(0, labels[0].labelStart));
    const patientLine: boolean = anchored || (prevPatient && startsWithField);
    for (const f of fields) {
      if (!f.len) continue;
      const k = f.hit.rule.kind;
      const contact = k === "CONTACT_PHONE" || k === "CONTACT_ADDR" || k === "CONTACT_EMAIL";
      if (contact && !f.hit.rule.explicit && !patientLine) continue;
      const start = line.start + f.hit.valueStart;
      hits.push({ start, end: start + f.len, kind: kindOf(k) });
      // An address can go on to a "City, ST 30310" line.
      // (Only a short line is tested: the pattern backtracks on a long run of spaces, and a city line is never long.)
      if (k === "CONTACT_ADDR" && f.hit.valueStart + f.len >= trimmedLength && lines[li + 1] && lines[li + 1].text.length <= 120 && CITY_STATE_ZIP.test(lines[li + 1].text)) {
        const nx = lines[li + 1];
        const lead = nx.text.length - nx.text.trimStart().length;
        hits.push({ start: nx.start + lead, end: nx.start + nx.text.trimEnd().length, kind: "ADDR" });
      }
    }
    // A header table: a line of identity labels with no values, then the values in the same order below.
    if (!anchored && li + 1 < lines.length) hits.push(...headerTable(line, lines[li + 1]));
    prevPatient = patientLine;
  }
  for (const m of text.matchAll(HONORIFIC)) {
    const start = m.index + m[0].length - m[1].length;
    const after = text.slice(start + m[1].length, start + m[1].length + 60);
    if (PROVIDER_AFTER.test(after) || ORG_AFTER.test(after) || NOT_NAME.has(m[1].toLowerCase())) continue;
    hits.push({ start, end: start + m[1].length, kind: "NAME" });
  }
  for (const m of text.matchAll(AGE_PHRASE)) {
    const n = Number(m[1]);
    if (n >= 90 && n <= 130) hits.push({ start: m.index, end: m.index + m[1].length, kind: "AGE" });
  }
  for (const m of text.matchAll(SSN_ANYWHERE)) hits.push({ start: m.index, end: m.index + m[0].length, kind: "SSN" });
  return hits;
}

const TABLE_LABEL: { re: RegExp; kind: PhiKind }[] = [
  { re: /^(?:patient(?:\s+name)?|name|pt)$/i, kind: "NAME" },
  { re: /^(?:d\.?o\.?b\.?|date\s+of\s+birth|birth\s*date)$/i, kind: "DOB" },
  { re: /^(?:mrn|medical\s+record(?:\s+(?:number|no\.?|#))?|patient\s+id)$/i, kind: "MRN" },
  { re: /^(?:acct\.?(?:\s*#)?|account(?:\s*#)?)$/i, kind: "ACCT" },
  { re: /^(?:member\s*(?:id|#)|insurance\s*(?:id|#)|subscriber\s*id)$/i, kind: "ID" },
  { re: /^(?:ssn)$/i, kind: "SSN" },
];

/** "Name        DOB          MRN" over "Maria Lopez 04/12/1961  88412907": cells split on wide gaps, matched in order. */
function headerTable(head: Line, row: Line): Hit[] {
  const cells = (l: Line) => [...l.text.matchAll(/\S+(?: \S+)*/g)].map((m) => ({ text: m[0], start: l.start + m.index }));
  const heads = cells(head);
  if (heads.length < 2) return [];
  const kinds = heads.map((h) => TABLE_LABEL.find((t) => t.re.test(h.text.replace(/:$/, "")))?.kind ?? null);
  if (kinds.filter(Boolean).length < 2 || !kinds.some((k) => k === "NAME" || k === "DOB" || k === "MRN")) return [];
  const vals = cells(row);
  if (vals.length !== heads.length) return [];
  const out: Hit[] = [];
  vals.forEach((v, i) => {
    const kind = kinds[i];
    if (!kind) return;
    const n = readValue(kind, v.text);
    if (n > 0) out.push({ start: v.start, end: v.start + n, kind });
  });
  return out;
}

/* ------------------------------------------------------------------------------------------ */
/* One-shot helpers.                                                                          */
/* ------------------------------------------------------------------------------------------ */

/** Shields one paper on its own. */
export function shield(text: string, session: PhiShield = new PhiShield()): ShieldResult {
  session.learn(text);
  return session.shield(text);
}

/** Puts the original words back for every placeholder in `tokens`. Placeholders it does not know are left as they are. */
export function unshieldString(s: string, tokens: ReadonlyMap<string, string>): string {
  if (!s.includes("⟦")) return s;
  return s.replace(new RegExp(TOKEN_RE.source, "g"), (t) => tokens.get(t) ?? t);
}

/** unshieldString over every string inside a JSON value (objects and arrays are copied, never changed in place). */
export function unshieldDeep<T>(value: T, tokens: ReadonlyMap<string, string>): T {
  if (typeof value === "string") return unshieldString(value, tokens) as T;
  if (Array.isArray(value)) return value.map((v) => unshieldDeep(v, tokens)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = unshieldDeep(v, tokens);
    return out as T;
  }
  return value;
}

/**
 * Maps an offset in the redacted text back to the original. An offset inside a placeholder snaps to the start of the
 * hidden words (`bias: "start"`) or their end (`bias: "end"`), so a range around a placeholder covers the whole value.
 */
export function toOriginal(offsetMap: readonly Segment[], pos: number, bias: "start" | "end"): number {
  let delta = 0;
  for (const s of offsetMap) {
    if (pos <= s.rStart) return pos + delta;
    if (pos < s.rEnd) return bias === "start" ? s.start : s.end;
    delta = s.end - s.rEnd;
  }
  return pos + delta;
}

/** Maps a [start, end) range in the redacted text to the original text. */
export function rangeToOriginal(offsetMap: readonly Segment[], r: { start: number; end: number }): { start: number; end: number } {
  return { start: toOriginal(offsetMap, r.start, "start"), end: toOriginal(offsetMap, r.end, "end") };
}

/* ------------------------------------------------------------------------------------------ */
/* Output filter for the plan, the read-aloud voice and the phone call.                       */
/* ------------------------------------------------------------------------------------------ */

const ANY_TOKEN = /⟦[^⟧\n]{0,40}⟧|[⟦⟧]|(?<![\p{L}\p{N}_])(?:NAME|DOB|AGE|MRN|ACCT|ID|SSN|PHONE|EMAIL|ADDR)_[A-Z]{1,3}(?![\p{L}\p{N}_])/gu;

/** True when a placeholder, a bracket of one, or its bare name ("NAME_A") is in the text. */
export function hasToken(s: string): boolean {
  return new RegExp(ANY_TOKEN.source, "u").test(s);
}

/**
 * Removes every placeholder (and any bare "NAME_A" a model may write without the brackets) and tidies the spacing and
 * punctuation left behind. Used on everything ATLAS itself writes for the plan, the voice and the call: those surfaces
 * must never say a placeholder, and they never had the real words.
 */
export function stripTokens(s: string): string {
  if (!hasToken(s)) return s;
  const M = "\u0000"; // marks where a placeholder was, so only the words around it are tidied
  return s
    .replace(/\u0000/g, "")
    .replace(ANY_TOKEN, M)
    .split("\n")
    .map((line) =>
      line
        // "⟦NAME_A⟧, take" at the start of a sentence (or after "1. "): drop it and its comma, capitalize what follows.
        .replace(/(^\s*|[.!?:]\s+|\d+[.)]\s+)\u0000(?:\s*\u0000)*\s*[,;:]?\s*(\p{Ll})?/gu, (_, lead: string, c?: string) => lead + (c ? c.toUpperCase() : ""))
        // "the clinic, ⟦NAME_A⟧." / "Hello ⟦NAME_A⟧, see": drop it with the comma or space before it.
        .replace(/[,;]?[ \t]*\u0000/g, "")
        .replace(/\(\s*\)|\[\s*\]/g, "")
        .replace(/[ \t]{2,}/g, " ")
        .replace(/[ \t]+([,.;:!?])/g, "$1")
        .replace(/[ \t]+$/, ""),
    )
    .join("\n");
}
