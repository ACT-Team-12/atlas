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
 *
 * Every pattern here runs on the canonical text (phiRead.ts canonicalize), which is also exactly what is sent: what was
 * checked is what the AI gets. Characters that could make the two differ are refused (PhiCharRefused).
 *
 * Fails closed: there is no cap on how many identifiers are spread, and a text too long to shield is refused
 * (PhiShieldRefused), never sent half shielded.
 */

import { PhiShieldRefused, canonicalize, detectionView, rawRange, readText, type Canon, type Reading } from "./phiRead";

export { PhiCharRefused, PhiShieldRefused } from "./phiRead";

/** The longest text one shield call accepts. Longer texts are refused, never partly shielded. */
export const MAX_SHIELD_CHARS = 200_000;

const checkSize = (text: string) => {
  if (text.length > MAX_SHIELD_CHARS) throw new PhiShieldRefused();
};

export const PHI_KINDS = ["NAME", "DOB", "AGE", "MRN", "ACCT", "ID", "SSN", "PHONE", "EMAIL", "ADDR"] as const;
export type PhiKind = (typeof PHI_KINDS)[number];

/** Added to every AI prompt that reads a shielded paper: copy placeholders exactly in quotes, never write them elsewhere. */
export const PLACEHOLDER_RULE =
  "\n- Some personal details are hidden as placeholders like ⟦NAME_A⟧ or ⟦DOB_A⟧. Inside a quote, copy a placeholder exactly, character for character. Never guess what a placeholder hides, and never put one in your own words (titles, explanations, questions).";

/** Any placeholder this module can make. */
export const TOKEN_RE = /⟦(NAME|DOB|AGE|MRN|ACCT|ID|SSN|PHONE|EMAIL|ADDR)_([A-Z]{1,3})⟧/g;

/**
 * One replaced stretch: [start, end) in the original text, [rStart, rEnd) in the redacted text. `kind: "EDIT"` is a
 * canonical edit (a line break or space unified, an invisible character removed...), whose `token` is what was sent.
 */
export type Segment = { start: number; end: number; rStart: number; rEnd: number; token: string; kind: PhiKind | "EDIT" };

export type ShieldResult = {
  /** The redacted text: what the server and the AI see. */
  text: string;
  /** placeholder to original words. Kept in memory only, by whoever made it. */
  tokens: Map<string, string>;
  /** The hidden identifiers in order (no canonical edits): what was hidden, and where. */
  offsetMap: Segment[];
  /** Every change from the original in order, identifiers AND canonical edits: map offsets back through this one. */
  map: Segment[];
};

type Hit = { start: number; end: number; kind: PhiKind };

/* ------------------------------------------------------------------------------------------ */
/* Patterns.                                                                                  */
/* ------------------------------------------------------------------------------------------ */

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
// 01/01/1970, 1/1/70, 01-01-1970, 01.01.1970, 01 / 01 / 1970, 1970-01-01, 1970/01/01, Jan 1 1970, Jan. 1st, 1970,
// Jan-01-1970, 1 Jan 1970, 1-Jan-1970.
const DATE_SRC =
  String.raw`(?:\d{1,2} ?[\/.-] ?\d{1,2} ?[\/.-] ?(?:\d{4}|\d{2})(?!\d)|\d{4} ?[\/.-] ?\d{1,2} ?[\/.-] ?\d{1,2}(?!\d)|(?:${MONTHS})\.?[ -]*\d{1,2}(?:st|nd|rd|th)?,?[ -]*\d{4}(?!\d)|\d{1,2}(?:st|nd|rd|th)?[ -]*(?:${MONTHS})\.?,?[ -]*\d{4}(?!\d))`;
const DATE_AT = new RegExp(`^${DATE_SRC}`, "i");
/** A labeled birth date may also be 8 digits with no separators (19700101, 01011970). */
const DOB_COMPACT_AT = /^\d{8}(?!\d)/;
/** True when a date-shaped value could be a real calendar date (an id like 12-34-5678 is not). */
function plausibleDate(s: string): boolean {
  const n = s.match(/\d+/g)?.map(Number) ?? [];
  if (n.length < 3) return true; // a month name: a date
  const [a, b, c] = n;
  if (String(n[0]).length === 4 || /^\d{4}/.test(s)) return b >= 1 && b <= 12 && c >= 1 && c <= 31;
  return (a >= 1 && a <= 12 && b >= 1 && b <= 31) || (a >= 1 && a <= 31 && b >= 1 && b <= 12);
}
const PHONE_SRC = String.raw`(?:\+?1[\s.-]*)?(?:\(\d{3}\)|\d{3})[\s.-]*\d{3}[\s.-]*\d{4}(?!\d)(?:\s*(?:x|ext\.?)\s*\d{1,5})?`;
const PHONE_AT = new RegExp(`^${PHONE_SRC}`, "i");
const EMAIL_SRC = String.raw`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`;
const EMAIL_AT = new RegExp(`^${EMAIL_SRC}`);
// An id: an optional short letter prefix, then a run that contains a digit, then more digit-bearing groups. Dots,
// slashes and underscores may sit inside it (ABC.123.456, 12/3456); a trailing one is trimmed.
const ID_AT = /^(?:[A-Za-z]{1,5}[ .\/_-]?)?[A-Za-z0-9]*\d[A-Za-z0-9._\/-]*(?:[ ][A-Za-z0-9]*\d[A-Za-z0-9._\/-]*)*/;
const SSN_VALUE_AT = /^(?:\d{3}|[xX*]{3})[- ]?(?:\d{2}|[xX*]{2})[- ]?\d{4}(?!\d)/;
const SSN_ANYWHERE = /(?<![\d-])\d{3}-\d{2}-\d{4}(?![\d-])/g;

// After a label: optional spaces, then ":", "#", "-" or "." (any mix), then spaces. `strict` labels require one of them.
const SEP_OPT = String.raw`\s*(?:[:#.-]\s*)*`;
const SEP_REQ = String.raw`\s*[:#-][:#\s-]*`;

type LabelRule = { kind: PhiKind | "CONTACT_PHONE" | "CONTACT_ADDR" | "CONTACT_EMAIL"; re: RegExp; explicit?: boolean };

// Each rule matches a label (at a word start) and the separator after it. The value is read from where the match ends.
const L = (src: string, sep: string) => new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${src})${sep}`, "giu");
const LABELS: LabelRule[] = [
  { kind: "NAME", re: L(String.raw`patient(?:['’]s)?\s+(?:full\s+)?name|pt\.?\s+name|name\s+of\s+(?:the\s+)?patient|(?:first|last|middle|given|family)\s*name|surname|patient|pt|(?:full\s+)?name|emergency\s+contact|guardian|parent(?:\s*\/\s*guardian)?`, SEP_REQ) },
  { kind: "NAME", re: L(String.raw`patient(?:['’]s)?\s+(?:full\s+)?name`, String.raw`\s+`) },
  // Spanish papers (Spanish is one of the app's languages): the same identity fields.
  { kind: "NAME", re: L(String.raw`nombre\s+(?:del?\s+(?:la\s+)?paciente|completo)|nombre\s+y\s+apellidos?|apellidos?|paciente|nombre`, SEP_REQ) },
  { kind: "DOB", re: L(String.raw`fecha\s+de\s+nacimiento|f\.?\s?nac\.?|nacid[oa](?:\s+el)?`, SEP_OPT) },
  { kind: "MRN", re: L(String.raw`(?:n[uú]mero\s+de\s+)?(?:historia\s+cl[ií]nica|expediente)(?:\s+(?:m[eé]dico|n[uú]mero|no\.?|#))?`, SEP_OPT) },
  { kind: "CONTACT_PHONE", explicit: true, re: L(String.raw`tel[eé]fono\s+del?\s+(?:la\s+)?paciente|celular\s+del?\s+(?:la\s+)?paciente`, SEP_REQ) },
  { kind: "CONTACT_PHONE", re: L(String.raw`tel[eé]fono|celular|m[oó]vil`, SEP_REQ) },
  { kind: "DOB", re: L(String.raw`d\.?\s?o\.?\s?b\.?|date\s+of\s+birth|birth\s*date|born(?:\s+on)?`, SEP_OPT) },
  { kind: "DOB", re: L(String.raw`birth`, SEP_REQ) },
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
const NAME_WORD = /^[\p{L}][\p{L}\p{M}'’.-]*/u;
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
// Tested on the line with whitespace collapsed to single spaces and trimmed (cityLine), so it cannot backtrack across a long
// run of spaces, with no length cutoff.
const CITY_STATE_ZIP = /^[\p{L}][\p{L}.'’-]*(?: [\p{L}.'’-]+)*,? [A-Z]{2}\.? \d{5}(?:-\d{4})?$/u;
const cityLine = (s: string) => CITY_STATE_ZIP.test(s.replace(/\s+/g, " ").trim());

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
  /** For names: true when the name was learned written all in lowercase, so its lowercase uses are the patient's too. */
  private readonly names = new Map<string, boolean>();
  private readonly values = new Map<string, PhiKind>();

  constructor(opts: { reserved?: Iterable<string> } = {}) {
    for (const t of opts.reserved ?? []) this.reserved.add(t);
  }

  /** Learns the identifiers in a text (labels, header lines) so later texts in this session hide them too. */
  learn(text: string): void {
    const { r, hits } = this.read(text);
    for (const h of hits) this.remember(r.text.slice(h.start, h.end), h.kind);
  }

  /**
   * The reading of a text and what its positions show, kept for the last few texts: a route learns each field and then
   * shields it, and reading it twice doubles the cost. Pure functions of the text, so a cached answer is the same answer.
   */
  private readonly readCache = new Map<string, { canon: Canon; r: Reading; hits: Hit[] }>();
  private read(text: string): { canon: Canon; r: Reading; hits: Hit[] } {
    checkSize(text);
    for (const t of tokensIn(text)) this.reserved.add(t);
    let v = this.readCache.get(text);
    if (!v) {
      // The canonical text is built once and is what gets sent; the detectors read it (skipping only placeholders).
      const canon = canonicalize(text);
      const r = detectionView(canon.text);
      v = { canon, r, hits: detectPositional(r.text, r.gaps) };
      if (this.readCache.size >= 32) this.readCache.clear();
      this.readCache.set(text, v);
    }
    return v;
  }

  /** True when `token` was in a text this session read (the paper's own text, or an earlier shield's placeholder). */
  isReserved(token: string): boolean {
    return this.reserved.has(token);
  }

  /** True when this session has learned any identifier. */
  get knowsAny(): boolean {
    return this.names.size > 0 || this.values.size > 0;
  }

  /**
   * How many names and ids this session spreads (for tests). There is NO cap: every learned identifier is hidden
   * everywhere it repeats. Spreading costs one pass over the text whatever the number of identifiers (a word scan with
   * set lookups for names, an Aho-Corasick scan for exact values), so no cap is needed to bound the cost, and a cap
   * would let a long or crafted paper push real identifiers past it.
   */
  get spreadCount(): number {
    return this.names.size + this.values.size;
  }

  private remember(value: string, kind: PhiKind): void {
    const v = value.trim();
    if (!v) return;
    if (kind === "NAME") {
      // A name learned in lowercase ("patient:maria lopez", OCR output) is hidden in lowercase later too; a capitalized
      // one only where it is capitalized ("may", "rose" in a sentence are words).
      const add = (key: string, s: string) => this.names.set(key, (this.names.get(key) ?? false) || !/\p{Lu}/u.test(s));
      const whole = nameKey(v);
      if (whole) add(whole, v);
      for (const part of v.split(/[\s,]+/)) {
        const p = part.replace(/^[.'’-]+|[.'’-]+$/g, "");
        if (p.length >= 2 && !NO_SPREAD.has(p.toLowerCase()) && !NOT_NAME.has(p.toLowerCase())) add(nameKey(p), p);
      }
    } else if ((kind === "MRN" || kind === "ACCT" || kind === "ID" || kind === "SSN") && v.replace(/[^A-Za-z0-9]/g, "").length >= 5) {
      if (!this.values.has(v)) { this.values.set(v, kind); this.matcher = null; }
    } else if (kind === "PHONE" || kind === "EMAIL" || ((kind === "DOB" || kind === "ADDR") && v.replace(/[^A-Za-z0-9]/g, "").length >= 6)) {
      // A birth date or street address written again anywhere ("History reviewed on 01/02/1980") is the same value.
      if (!this.values.has(v)) { this.values.set(v, kind); this.matcher = null; }
    }
  }

  /** Built once per set of values, rebuilt only when a new value is learned. */
  private matcher: AhoCorasick | null = null;

  /** The same identifier gets the same placeholder however it is written: keyed by its reading, not its raw bytes. */
  private tokenFor(original: string, kind: PhiKind): string {
    const key = `${kind}\u0000${readText(original).text}`;
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
    const cached = this.read(text);
    const { canon, r } = cached;
    const read = r.text;
    const hits: Hit[] = [...cached.hits];
    for (const h of hits) this.remember(read.slice(h.start, h.end), h.kind);
    hits.push(...this.spread(read));
    // Matched in the detection view, which is the canonical text minus placeholders; mapped to the canonical text, then
    // to the raw text, so every raw character behind a match is hidden (an earlier placeholder inside one included).
    const toRaw = (h: Hit) => {
      const c = rawRange(r, h.start, h.end, canon.text.length);
      return { ...rawRange(canon, c.start, c.end, text.length), kind: h.kind };
    };
    const chosen = resolve(resolve(hits).map(toRaw));

    // The text sent is the canonical text with each identifier replaced: walk the raw text applying the canonical edits
    // outside the hidden stretches, and a placeholder for each hidden stretch.
    let out = "";
    let at = 0;
    let e = 0;
    const offsetMap: Segment[] = [];
    const map: Segment[] = [];
    const copyTo = (end: number) => {
      while (at < end) {
        while (e < canon.edits.length && canon.edits[e].end <= at) e++;
        const ed = e < canon.edits.length ? canon.edits[e] : null;
        if (ed && ed.start < end) {
          out += text.slice(at, ed.start);
          map.push({ start: ed.start, end: ed.end, rStart: out.length, rEnd: out.length + ed.repl.length, token: ed.repl, kind: "EDIT" });
          out += ed.repl;
          at = ed.end;
          e++;
        } else {
          out += text.slice(at, end);
          at = end;
        }
      }
    };
    for (const h of chosen) {
      copyTo(h.start);
      const original = text.slice(h.start, h.end);
      const token = this.tokenFor(original, h.kind);
      const seg: Segment = { start: h.start, end: h.end, rStart: out.length, rEnd: out.length + token.length, token, kind: h.kind };
      offsetMap.push(seg);
      map.push(seg);
      out += token;
      at = h.end;
    }
    copyTo(text.length);
    const tokens = new Map<string, string>();
    for (const sg of offsetMap) tokens.set(sg.token, this.tokens.get(sg.token)!);
    return { text: out, tokens, offsetMap, map };
  }

  /** Every later use of a learned name or id, anywhere in the text. */
  private spread(text: string): Hit[] {
    const out: Hit[] = [];
    if (this.names.size) {
      // Names: one scan of the words. At each word, the longest learned name (up to MAX_NAME_WORDS words, joined by
      // spaces, a comma or an initial's period) wins. A hyphenated or possessive word ("Lopez-Garcia", "Lopez's") is
      // also checked piece by piece, as a word-boundary match would have found "Lopez" in it.
      const words = [...text.matchAll(WORD)].map((m) => ({ start: m.index, end: m.index + m[0].length, key: m[0].toLowerCase() }));
      const ok = (start: number, end: number, key: string) => {
        if (!/\p{Lu}/u.test(text[start]) && !this.names.get(key)) return false; // "may", "will", "rose" in a sentence are words, not the patient
        const before = text.slice(Math.max(0, start - 40), start);
        const after = text.slice(end, end + 60);
        return !(PROVIDER_BEFORE.test(before) || PROVIDER_AFTER.test(after) || ORG_AFTER.test(after) || ORG_BEFORE.test(before));
      };
      for (let i = 0; i < words.length; i++) {
        let key = "";
        let found = 0;
        for (let k = 0; k < MAX_NAME_WORDS && i + k < words.length; k++) {
          if (k > 0 && !NAME_GAP.test(text.slice(words[i + k - 1].end, words[i + k].start))) break;
          key = k === 0 ? words[i].key : `${key} ${words[i + k].key}`;
          if (this.names.has(key) && ok(words[i].start, words[i + k].end, key)) found = k + 1;
        }
        if (found) {
          out.push({ start: words[i].start, end: words[i + found - 1].end, kind: "NAME" });
          i += found - 1;
          continue;
        }
        const w = words[i];
        if (!/['’.-]/.test(text.slice(w.start, w.end))) continue;
        for (const p of text.slice(w.start, w.end).matchAll(/[\p{L}\p{N}]+/gu)) {
          const s = w.start + p.index, e = s + p[0].length;
          if (this.names.has(p[0].toLowerCase()) && ok(s, e, p[0].toLowerCase())) out.push({ start: s, end: e, kind: "NAME" });
        }
      }
    }
    if (this.values.size) {
      // Ids, phones and emails: every exact occurrence, in one Aho-Corasick pass, with no letter or digit glued on.
      this.matcher ??= new AhoCorasick([...this.values.keys()]);
      const alnum = (c: string | undefined) => c !== undefined && /[A-Za-z0-9]/.test(c);
      this.matcher.scan(text, (start, end, value) => {
        if (alnum(text[start - 1]) || alnum(text[end])) return false;
        out.push({ start, end, kind: this.values.get(value)! });
        return true;
      });
    }
    return out;
  }
}

/** "Lopez" in "Memorial Lopez" / "St. Lopez" style org names: a capitalized org word right before. */
const ORG_BEFORE = new RegExp(String.raw`(?:^|[^\p{L}])(?:${caps(["clinic", "hospital", "medical", "health", "healthcare", "center", "pharmacy", "memorial", "university", "saint", "st"])})\.?\s+$`, "u");

/** A word for name spreading: letters and digits, with inner apostrophes, hyphens or periods ("O'Neil", "Smith-Jones"). */
const WORD = /[\p{L}\p{N}][\p{L}\p{M}\p{N}]*(?:['’.-][\p{L}\p{N}][\p{L}\p{M}\p{N}]*)*/gu;
/** What may sit between the words of one name: spaces, a comma ("Lopez, Maria") or an initial's period ("J. Lopez"). */
const NAME_GAP = /^[.,]?[ \t]+$/;
/** The longest name, in words, matched as one stretch (a name value is at most 4 words plus a title). */
const MAX_NAME_WORDS = 8;
/** A name as the word scan sees it: its words, lower-cased, joined by single spaces. */
const nameKey = (v: string) => [...v.matchAll(WORD)].map((m) => m[0].toLowerCase()).join(" ");

/**
 * Aho-Corasick over a set of exact strings: every occurrence of every string in one pass over the text, whatever the
 * number of strings. At each position the longest string ending there is offered first; `accept` returns false to try
 * the next shorter one (a boundary check failed).
 */
class AhoCorasick {
  private readonly next: Map<string, number>[] = [new Map()];
  private readonly fail: number[] = [0];
  private readonly word: (string | null)[] = [null];
  /** The nearest node on the fail chain that ends a string (or -1). */
  private readonly dict: number[] = [-1];

  constructor(patterns: string[]) {
    for (const p of patterns) {
      let n = 0;
      for (const c of p) {
        let to = this.next[n].get(c);
        if (to === undefined) {
          to = this.next.length;
          this.next.push(new Map());
          this.fail.push(0);
          this.word.push(null);
          this.dict.push(-1);
          this.next[n].set(c, to);
        }
        n = to;
      }
      this.word[n] = p;
    }
    const queue: number[] = [];
    for (const to of this.next[0].values()) queue.push(to);
    for (let q = 0; q < queue.length; q++) {
      const n = queue[q];
      for (const [c, to] of this.next[n]) {
        let f = this.fail[n];
        while (f > 0 && !this.next[f].has(c)) f = this.fail[f];
        const g = this.next[f].get(c);
        this.fail[to] = g !== undefined && g !== to ? g : 0;
        this.dict[to] = this.word[this.fail[to]] !== null ? this.fail[to] : this.dict[this.fail[to]];
        queue.push(to);
      }
    }
  }

  scan(text: string, accept: (start: number, end: number, value: string) => boolean): void {
    let n = 0;
    let i = 0;
    for (const c of text) {
      i += c.length;
      while (n > 0 && !this.next[n].has(c)) n = this.fail[n];
      n = this.next[n].get(c) ?? 0;
      for (let m = this.word[n] !== null ? n : this.dict[n]; m > 0; m = this.dict[m]) {
        const w = this.word[m]!;
        if (accept(i - w.length, i, w)) break;
      }
    }
  }
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
/** Labels found per line text, kept for one detectPositional call (a line is read for labels up to three times). */
let labelMemo: Map<string, LabelHit[]> | null = null;
function labelsOn(line: string): LabelHit[] {
  const memo = labelMemo?.get(line);
  if (memo) return memo;
  const res = labelsOnUncached(line);
  labelMemo?.set(line, res);
  return res;
}
function labelsOnUncached(line: string): LabelHit[] {
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
  // Only the words just before the label matter; a bounded slice keeps a line of thousands of labels linear. The slice
  // starts at a word boundary, so a cut word ("...nic") can never pass for a qualifier ("clinic") and wrongly drop a label.
  let from = Math.max(0, f.labelStart - 48);
  while (from > 0 && from < f.labelStart && /[\p{L}\p{N}.]/u.test(line[from - 1])) from++;
  const before = line.slice(from, f.labelStart);
  const label = line.slice(f.labelStart, f.valueStart);
  const k = f.rule.kind;
  // A label inside a sentence ("the patient: take ...", "born on", "age 7") is kept only if a real value follows it:
  // the value readers below decide (a name reader stops at instruction words, a date reader needs a date).
  if (PROVIDER_QUALIFIER.test(before) && !f.rule.explicit) return false;
  if (k === "NAME" && /^\s*(?:pt|patient)\b/i.test(label) === false && /^\s*name/i.test(label) && /(?:^|[^\p{L}])(?:your|my|his|her|their|the|drug|test|brand|generic|plan|program|user|file|company|business|street|facility|clinic|provider|doctor|pharmacy|procedure|diagnosis|dx|treatment|vaccine|vaccination|immunization|device|assay|condition|problem|study|exam|examination|imaging|scan|surgery|operation|therapy|allergy|allergen|product|item|service|order|panel|specimen|med|medication|medicine|prescription|rx|supply|equipment|document|form|hospital|lab|laboratory|insurance|payer|employer|school|pet)\s+$/iu.test(before)) return false;
  // Lower-case labels mid-sentence ("born on", "age 7", "id") need a value right after, checked by the value readers.
  return true;
}

/**
 * Where values can end on a line: a wide gap, a tab, a bar or semicolon, or another field label ("Visit:"). Found once
 * per line, sorted, so finding each field's end is a binary search (rescanning the line per label is quadratic).
 */
function lineStops(line: string): number[] {
  const stops: number[] = [];
  // Same stops as before the cost fix (any whitespace, not only spaces and tabs), found in one pass.
  for (const m of line.matchAll(/\s{2,}|\t|\s*\|\s*|;/g)) stops.push(m.index);
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

/**
 * Reads a name value: up to 4 name-like words, stopping at a care / field / instruction word. A longer name is read
 * whole when it is all the field holds ("Patient: Maria del Carmen de la Cruz Garcia"): a word limit that cut a
 * name would leave the rest of it in the text.
 */
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
  if (words === 4) {
    const rest = s.slice(lastEnd);
    const more = /^(?:[ \t,]+[\p{L}][\p{L}'’.-]*){1,4}[ \t]*$/u.exec(rest);
    if (more && !more[0].split(/[\s,]+/).some((w) => NOT_NAME.has(w.replace(/[.'’-]+$/, "").toLowerCase()))) lastEnd += more[0].trimEnd().length;
  }
  return words > 0 ? lastEnd : 0;
}

/** The value of one labeled field at the very start of `v`, by kind. */
function readCore(kind: LabelRule["kind"], v: string): number {
  switch (kind) {
    case "NAME": return readName(v);
    case "DOB": return DATE_AT.exec(v)?.[0].length ?? DOB_COMPACT_AT.exec(v)?.[0].length ?? 0;
    case "AGE": {
      const m = /^(\d{2,3})(?!\d)/.exec(v);
      return m && Number(m[1]) >= 90 && Number(m[1]) <= 130 ? m[0].length : 0;
    }
    case "SSN": return SSN_VALUE_AT.exec(v)?.[0].length ?? 0;
    case "MRN": case "ACCT": case "ID": {
      const m = ID_AT.exec(v);
      const id = m ? m[0].replace(/[\s._\/-]+$/, "") : "";
      // A real calendar date after an id label is a date (rule 3), not an id; "12-34-5678" is an id.
      const date = DATE_AT.exec(v);
      if (date && plausibleDate(date[0]) && date[0].length >= id.length) return 0;
      return id && id.replace(/[^A-Za-z0-9]/g, "").length >= 4 ? id.length : 0;
    }
    case "CONTACT_PHONE": return PHONE_AT.exec(v)?.[0].length ?? 0;
    case "CONTACT_EMAIL": return EMAIL_AT.exec(v)?.[0].length ?? 0;
    case "CONTACT_ADDR": return /\d/.test(v) && /\p{L}/u.test(v) ? v.replace(/[\s,;]+$/, "").length : 0;
  }
  return 0;
}

/** Where the value of one labeled field sits in `s` (already cut at the field's end): [from, to), or null. */
function readValue(kind: LabelRule["kind"], s: string): { from: number; to: number } | null {
  const lead = s.length - s.trimStart().length;
  const v = s.slice(lead);
  const at = (from: number, n: number) => (n > 0 ? { from: lead + from, to: lead + from + n } : null);
  const n = readCore(kind, v);
  if (n) return at(0, n);
  // A value in quotes or brackets: `Patient: "Maria Lopez"`, `MRN: (88412907)`. The value starts after the mark.
  const q = /^["'«»(\[{<*_]+/.exec(v);
  if (q) {
    const m = readCore(kind, v.slice(q[0].length));
    if (m) return at(q[0].length, m);
  }
  if (kind === "MRN" || kind === "ACCT" || kind === "ID") {
    // An id field whose first words are not the id ("MRN: NAME_A 88412907", "MRN: see 88412907"): the first id among
    // the field's next few words is the id. Bounded to 6 word starts: constant work per field.
    let k = 0;
    for (const w of v.matchAll(/(?<=\s)\S/g)) {
      if (++k > 6) break;
      const id = readCore(kind, v.slice(w.index));
      if (id) return at(w.index, id);
    }
  }
  return null;
}

const ANCHOR_KINDS = new Set<LabelRule["kind"]>(["NAME", "DOB", "MRN", "ACCT", "ID", "SSN"]);
/** Kinds whose value may sit on the line under the label ("DOB:" then "01/01/1970"), or whose label may break across lines. */
const NEXT_LINE_KINDS = new Set<LabelRule["kind"]>(["NAME", "DOB", "MRN", "ACCT", "ID", "SSN", "AGE"]);
const kindOf = (k: LabelRule["kind"]): PhiKind =>
  k === "CONTACT_PHONE" ? "PHONE" : k === "CONTACT_ADDR" ? "ADDR" : k === "CONTACT_EMAIL" ? "EMAIL" : k;

/** True when a placeholder was left out of the reading anywhere in [a, b] (inclusive). */
type Filled = (a: number, b: number) => boolean;
function filledIn(length: number, gaps: readonly number[]): Filled {
  if (!gaps.length) return () => false;
  const count = new Uint32Array(length + 2);
  for (const g of gaps) count[Math.min(g, length) + 1]++;
  for (let i = 1; i < count.length; i++) count[i] += count[i - 1];
  return (a, b) => count[Math.min(b, length) + 1] - count[Math.max(0, a)] > 0;
}

/** The value of a field read from the start of `line` (its own first field), or null. */
function valueOnLine(kind: LabelRule["kind"], line: Line, from: number): Hit | null {
  const lead = from + (line.text.slice(from).length - line.text.slice(from).trimStart().length);
  if (lead >= line.text.length) return null;
  // (A placeholder before the value is never taken as the value: the reading leaves it out, and what follows is read.)
  // A line that opens with a field of its own ("Number: ...", "Visit: ...") is not the value of the label above it.
  if (from === 0 && /^[\p{L}][\p{L}\p{N}.'#-]*(?: [\p{L}\p{N}.'#-]+)?:/u.test(line.text.slice(lead))) return null;
  // The line must not start with a label of its own ("Patient:" then "DOB: ..." is two fields, not a value).
  const own = labelsOn(line.text);
  if (own.some((l) => l.labelStart <= lead && l.valueStart > lead)) return null;
  const end = valueEnd(lineStops(line.text), line.text.length, lead, own.find((l) => l.labelStart > lead)?.labelStart);
  const v = readValue(kind, line.text.slice(lead, end));
  return v ? { start: line.start + lead + v.from, end: line.start + lead + v.to, kind: kindOf(kind) } : null;
}

/**
 * Every identifier found by its position: labeled fields (the value on the label's line or, when the label ends its
 * line, on the next one; a label may also break across two lines), the patient's header lines, a header table, an
 * honorific ("Ms. Lopez"), an age over 89, and the SSN shape.
 */
export function detectPositional(text: string, gaps: readonly number[] = []): Hit[] {
  labelMemo = new Map();
  try {
    return detectLines(text, gaps);
  } finally {
    labelMemo = null;
  }
}

function detectLines(text: string, gaps: readonly number[]): Hit[] {
  const filled = filledIn(text.length, gaps);
  const lines = splitLines(text);
  const hits: Hit[] = [];
  let prevPatient = false;
  /** Lines that are a value read from the line above, so they count as the patient's. */
  const valueLines = new Set<number>();
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (!line.text.trim()) { prevPatient = false; continue; }
    const labels = labelsOn(line.text);
    // A line is the patient's when it carries an identity label with a value, or it is a field line
    // (it starts with a contact label) right under a patient line.
    const stops = labels.length ? lineStops(line.text) : [];
    const trimmedLength = line.text.trimEnd().length;
    const next = li + 1 < lines.length && lines[li + 1].text.trim() ? lines[li + 1] : null;
    let anchoredBelow = false;
    let filledAnchor = false;
    const fields: { hit: LabelHit; len: number; from: number; end: number }[] = labels.map((hit, i) => {
      const end = valueEnd(stops, line.text.length, hit.valueStart, labels[i + 1]?.labelStart);
      // No block exempts a person-name label: whether a name field is clinical is decided by its label alone
      // ("Medication name:", "Test name:" are dropped in accept()); a bare "Name:" is always read as a person's name.
      const v = readValue(hit.rule.kind, line.text.slice(hit.valueStart, end));
      const len = v ? v.to : 0;
      const from = v ? v.from : 0;
      // A field that held only a placeholder (nothing after it reads as a value) still marks the patient's line. It is
      // never trusted to be the whole value: the next line is still read below, and a header table below still is.
      if (!len && filled(line.start + hit.labelStart, line.start + end) && ANCHOR_KINDS.has(hit.rule.kind)) filledAnchor = true;
      // "DOB:" ending its line, the value on the next line.
      if (!len && next && i === labels.length - 1 && !line.text.slice(hit.valueStart).trim() && (NEXT_LINE_KINDS.has(hit.rule.kind) || hit.rule.explicit)) {
        const below = valueOnLine(hit.rule.kind, next, 0);
        if (below) {
          hits.push(below);
          valueLines.add(li + 1);
          if (ANCHOR_KINDS.has(hit.rule.kind)) anchoredBelow = true;
        }
      }
      return { hit, len, from, end };
    });
    // `anchored`: a value of the patient's was read on this line (or below its label). A line whose identity fields held
    // only placeholders is still the patient's line, but only a read value rules out a header table.
    const anchored = anchoredBelow || fields.some((f) => f.len > 0 && ANCHOR_KINDS.has(f.hit.rule.kind));
    const startsWithField = labels.length > 0 && /^\s*(?:[-*•>]\s*)?$/.test(line.text.slice(0, labels[0].labelStart));
    const patientLine: boolean = anchored || filledAnchor || valueLines.has(li) || (prevPatient && startsWithField);
    for (const f of fields) {
      if (!f.len) continue;
      const k = f.hit.rule.kind;
      const contact = k === "CONTACT_PHONE" || k === "CONTACT_ADDR" || k === "CONTACT_EMAIL";
      if (contact && !f.hit.rule.explicit && !patientLine) continue;
      const start = line.start + f.hit.valueStart;
      hits.push({ start: start + f.from, end: start + f.len, kind: kindOf(k) });
      // A phone right after a labeled name in the same field ("Emergency contact: John Lee 404-555-0101") is that
      // person's phone.
      if (k === "NAME") {
        const rest = line.text.slice(f.hit.valueStart + f.len, f.end);
        let lead = /^[\s,;(-]*(?:(?:ph(?:one)?|tel|cell|mobile|#)\.?:?\s*)?/i.exec(rest)![0].length;
        let ph = PHONE_AT.exec(rest.slice(lead));
        // "(404) 555-0182": the "(" the lead took is the area code's own.
        if (!ph && lead > 0 && rest[lead - 1] === "(") ph = PHONE_AT.exec(rest.slice(--lead));
        if (ph) hits.push({ start: start + f.len + lead, end: start + f.len + lead + ph[0].length, kind: "PHONE" });
      }
      // An address can go on to a "City, ST 30310" line (matched with whitespace collapsed, so it cannot backtrack).
      if (k === "CONTACT_ADDR" && f.hit.valueStart + f.len >= trimmedLength && lines[li + 1] && cityLine(lines[li + 1].text)) {
        const nx = lines[li + 1];
        const lead = nx.text.length - nx.text.trimStart().length;
        hits.push({ start: nx.start + lead, end: nx.start + nx.text.trimEnd().length, kind: "ADDR" });
      }
    }
    // A label broken across two lines: "Date of" / "Birth: 01/01/1970", "Medical Record" / "Number: 0041-77".
    if (next) hits.push(...splitLabel(line, next));
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

/** The last word of a line that may be the first half of a label broken across two lines. */
const LABEL_TAIL = /(?:^|[^\p{L}])(?:patient(?:['’]s)?|pt\.?|name|full|first|last|middle|given|family|date|of|birth|d\.?o\.?b?\.?|medical|med\.?|record|rec\.?|chart|account|acct\.?|encounter|member|insurance|subscriber|policy|medicaid|medicare|social|soc\.?|security|sec\.?|home|cell|mobile|primary|contact|your|street|mailing|e-?mail|phone|emergency|parent|guardian|the)$/iu;

/**
 * The last few words of `line` joined to `next`: a label that starts on `line` and ends on `next` gets its value read
 * on `next` (or, when it ends `next`, nothing: the value-below rule does not chain).
 */
function splitLabel(line: Line, next: Line): Hit[] {
  // At most the last 4 words and 48 characters (a label is never longer), cut at a word start: constant work per line.
  const end = line.text.trimEnd();
  let from = Math.max(0, end.length - 48);
  if (from > 0 && end[from - 1] !== " ") while (from < end.length && end[from] !== " ") from++;
  const head = end.slice(from).trim().split(/ +/).slice(-4).join(" ");
  // Only a line ending in a word that can start or continue a label can carry half of one.
  if (!LABEL_TAIL.test(head)) return [];
  const lead = next.text.length - next.text.trimStart().length;
  const joined = `${head} ${next.text.slice(lead)}`;
  const out: Hit[] = [];
  for (const l of labelsOn(joined)) {
    if (l.labelStart >= head.length || l.valueStart <= head.length + 1) continue; // must cross the line break
    if (!NEXT_LINE_KINDS.has(l.rule.kind) && !l.rule.explicit) continue;
    const h = valueOnLine(l.rule.kind, next, lead + (l.valueStart - head.length - 1));
    if (h) out.push(h);
  }
  return out;
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
  // A row of fields ("Clinic phone: 404-616-1234") is not a row of values.
  if (vals.some((v) => /^[\p{L}][\p{L}\p{N} .'#-]{0,30}:/u.test(v.text))) return [];
  const out: Hit[] = [];
  vals.forEach((v, i) => {
    const kind = kinds[i];
    if (!kind) return;
    const r = readValue(kind, v.text);
    if (r) out.push({ start: v.start + r.from, end: v.start + r.to, kind });
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

/** A placeholder, or its bare name ("NAME_A", "Name_a") as a model may write it without the brackets. Any case. */
const TOKEN_OR_BARE = /⟦(?:NAME|DOB|AGE|MRN|ACCT|ID|SSN|PHONE|EMAIL|ADDR)_[A-Z]{1,3}⟧|(?<![\p{L}\p{N}_⟦])(?:NAME|DOB|AGE|MRN|ACCT|ID|SSN|PHONE|EMAIL|ADDR)_[A-Z]{1,3}(?![\p{L}\p{N}_⟧])/giu;

/**
 * Says which placeholders nobody can put back and must be removed rather than shown: given a placeholder this side did
 * not make, true when it is not the paper's own text either (a model made it up). Undefined: leave unknown ones.
 */
export type DropUnknown = ((token: string) => boolean) | undefined;

/**
 * Puts the original words back for every placeholder in `tokens`, found on the shared reading (a placeholder a model
 * wrote with an invisible character or a lookalike letter in it is still found), and for a known placeholder written
 * bare ("NAME_A"). Placeholders it does not know are left as they are, unless `drop` says to remove them.
 */
export function unshieldString(s: string, tokens: ReadonlyMap<string, string>, drop?: DropUnknown): string {
  if (!s.includes("⟦") && !/[_＿﹍-﹏]/.test(s)) return s;
  const r = readText(s);
  let out = "";
  let at = 0;
  let dropped = false;
  for (const m of r.text.matchAll(TOKEN_OR_BARE)) {
    const t = m[0].startsWith("⟦") ? m[0].toUpperCase() : `⟦${m[0].toUpperCase()}⟧`;
    const known = tokens.get(t);
    const remove = known === undefined && m[0].startsWith("⟦") && drop?.(t) === true;
    if (known === undefined && !remove) continue;
    const { start, end } = rawRange(r, m.index, m.index + m[0].length, s.length);
    out += s.slice(at, start) + (known ?? MARK);
    at = end;
    if (remove) dropped = true;
  }
  if (!at) return s;
  out += s.slice(at);
  return dropped ? tidyMarks(out) : out;
}

/** unshieldString over every string inside a JSON value (objects and arrays are copied, never changed in place). */
export function unshieldDeep<T>(value: T, tokens: ReadonlyMap<string, string>, drop?: DropUnknown): T {
  if (typeof value === "string") return unshieldString(value, tokens, drop) as T;
  if (Array.isArray(value)) return value.map((v) => unshieldDeep(v, tokens, drop)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = unshieldDeep(v, tokens, drop);
    return out as T;
  }
  return value;
}

/** The drop rule for one session: remove a placeholder it did not make and did not read in any text it was sent. */
export const dropUnknownFor = (session: PhiShield): DropUnknown => (t) => !session.tokens.has(t) && !session.isReserved(t);

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

const anyCase = (w: string) => [...w].map((c) => `[${c}${c.toLowerCase()}]`).join("");
/**
 * Anything a placeholder can turn into in a model's output: a bracketed run, a lone bracket, the bare name in any case
 * ("NAME_A", "Name_a", "name_a"), and the bare name with a space for the underscore ("NAME A"; upper case and one letter
 * only, so "ID a" or "Email us" in a sentence stay).
 */
const ANY_TOKEN = new RegExp(
  String.raw`⟦[^⟦⟧]{0,40}⟧|[⟦⟧]|(?<![\p{L}\p{N}_])(?:${PHI_KINDS.map(anyCase).join("|")})_[A-Za-z]{1,3}(?![\p{L}\p{N}_])|(?<![\p{L}\p{N}_])(?:NAME|DOB|MRN|ACCT|SSN|PHONE|EMAIL|ADDR) [A-Z](?![\p{L}\p{N}_])`,
  "gu",
);

/** Could `s` hold a placeholder at all? (A bracket, an underscore in any width, any non-ASCII letter, or "NAME A".) */
const mayHoldToken = (s: string) => /[⟦⟧_＿﹍-﹏]|[^\x00-\x7f]|(?:NAME|DOB|MRN|ACCT|SSN|PHONE|EMAIL|ADDR) [A-Z]/.test(s);

/**
 * True when a placeholder, a bracket of one, or its bare name ("NAME_A") is in the text, found on the shared reading:
 * an invisible character, a fullwidth or lookalike letter inside it does not hide it.
 */
export function hasToken(s: string): boolean {
  return mayHoldToken(s) && new RegExp(ANY_TOKEN.source, "u").test(readText(s).text);
}

/** Marks where a placeholder was in a string being tidied. */
const MARK = "\u0000";

/**
 * Removes every placeholder (and any bare "NAME_A" a model may write without the brackets) and tidies the spacing and
 * punctuation left behind. Used on everything ATLAS itself writes for the plan, the voice and the call: those surfaces
 * must never say a placeholder, and they never had the real words. Placeholders are found on the shared reading and
 * removed from the raw text with every character behind them.
 */
export function stripTokens(s: string): string {
  if (!hasToken(s)) return s;
  const clean = s.replace(/\u0000/g, "");
  const r = readText(clean);
  let marked = "";
  let at = 0;
  for (const m of r.text.matchAll(ANY_TOKEN)) {
    const { start, end } = rawRange(r, m.index, m.index + m[0].length, clean.length);
    marked += clean.slice(at, start) + MARK;
    at = end;
  }
  return tidyMarks(marked + clean.slice(at));
}

/** Drops each MARK with the spacing and punctuation it leaves behind. */
function tidyMarks(marked: string): string {
  return marked
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
