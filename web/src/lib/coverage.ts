import { findSpan, normalize } from "./verify";

/**
 * Coverage check: "what on the paper did we NOT turn into a step?"
 *
 * The span verifier (verify.ts) blocks INVENTED steps: every kept item must quote the paper.
 * It cannot see MISSING steps. This module is the other half. It splits the paper into
 * sentences, marks the ones that look like instructions to the patient, and reports which of
 * those no kept item's quote touches.
 *
 * Pure and deterministic: no network, no model. Runs in time linear in the paper's length
 * (plus one verifier lookup per item that arrives without a span).
 *
 * The instruction heuristic is deliberately conservative and documented in docs/coverage-check.md.
 * A false "uncovered" costs the patient one extra line to read; a missed one costs nothing
 * worse than having no check at all, so the rules lean toward clear, explainable signals.
 */

export type CoverageLang = "en" | "es";

export type Sentence = { text: string; start: number; end: number };

export type UncoveredSentence = Sentence & {
  /** Which rule marked it as an instruction (for debugging and for a future UI tooltip). */
  reason: InstructionReason;
};

export type InstructionReason = "imperative" | "phrase" | "conditional" | "dose_or_timing";

export type CoverageReport = {
  /** Instruction-like sentences found on the paper. */
  total: number;
  /** How many of them overlap a kept item's quote. */
  covered: number;
  /** The rest, in reading order, with offsets into the original source text. */
  uncovered: UncoveredSentence[];
};

/** The minimum a kept item needs: its quote, and the span the verifier found if it has one. */
export type CoverageItem = { source_quote: string; span?: { start: number; end: number } | null };

export type CoverageOptions = {
  /** Lexicons to apply. Defaults to English only (the conservative choice; see the doc). */
  languages?: CoverageLang[];
};

/* ------------------------------------------------------------------------------------------ */
/* Lexicons. Each language adds patterns; nothing here is language-specific outside this block. */
/* ------------------------------------------------------------------------------------------ */

type Lexicon = {
  /** Sentence starts with one of these (after bullets, "please", and a short "Label:" are removed). */
  imperativeStart: RegExp;
  /** Phrases that mark a patient action anywhere in the sentence. */
  phrase: RegExp;
  /** Opens a condition ("if you have ..."). */
  conditionalOpen: RegExp;
  /** An action that must follow the condition for it to count ("... call", "... go"). */
  conditionalAction: RegExp;
  /** Dose with a unit, or a frequency / time window. */
  doseOrTiming: RegExp;
  /** Polite or connective words removed from the start before the imperative check. */
  leadIn: RegExp;
  /** Lines that are never patient instructions, whatever else they contain. */
  exclude: RegExp;
};

const EN: Lexicon = {
  imperativeStart:
    /^(?:take|use|apply|inhale|start|begin|stop|continue|finish|complete|resume|hold|skip|call|schedule|make|book|return|come back|go|see|follow up|check|monitor|measure|record|write|log|weigh|count|track|avoid|limit|reduce|cut|increase|decrease|drink|eat|keep|wear|rest|elevate|ice|walk|exercise|bring|pick up|refill|get|seek|watch|wash|clean|change|do not|don't|dont|never|be sure|make sure|remember|ask|tell|notify|contact|report)\b/,
  phrase:
    /\b(?:call 911|go to the (?:er|emergency)|follow[- ]up|next (?:visit|appointment)|appointments?|refills?|referral|due (?:in|on|by)|will call you|you (?:should|must|need to|will need to)|make sure|be sure to|as needed)\b/,
  conditionalOpen: /\bif (?:you|your)\b/,
  conditionalAction: /\b(?:call|go|return|come|seek|contact|get help|tell)\b/,
  doseOrTiming: new RegExp(
    [
      String.raw`\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|ml|units?|tablets?|tabs?|capsules?|caps?|pills?|puffs?|drops?|sprays?|patch(?:es)?|teaspoons?|tsp|tablespoons?|tbsp|inhalations?)\b`,
      String.raw`\b(?:once|twice|three times|four times|\d+ times)\s+(?:a|per|each)\s+(?:day|week|night)\b`,
      String.raw`\bevery\s+(?:\d+(?:\s*(?:to|-)\s*\d+)?\s+)?(?:hours?|days?|weeks?|morning|evening|night|day)\b`,
      String.raw`\b(?:in|within|for|after)\s+\d+(?:\s*(?:to|-)\s*\d+)?\s+(?:hours?|days?|weeks?|months?)\b`,
      String.raw`\b(?:daily|nightly|at bedtime)\b`,
    ].join("|"),
  ),
  leadIn: /^(?:please|and|then|also)\s+/,
  exclude: new RegExp(
    [
      // Lines written for staff, not the patient.
      String.raw`not for patient`,
      String.raw`\bprovider note\b`,
      String.raw`\bfor (?:office|internal|staff) use\b`,
      String.raw`\bclinician only\b`,
      String.raw`^billing\b`,
      String.raw`\bbilling code\b`,
      // Signatures.
      String.raw`^(?:electronically )?signed\b`,
      String.raw`^signature\b`,
      String.raw`^sincerely\b`,
      String.raw`^(?:attending|provider|physician|doctor|nurse|clinician)(?: name)?\s*:`,
      // Boilerplate that no care plan turns into a step.
      String.raw`^page \d+(?: of \d+)?$`,
      String.raw`^printed (?:on|by|at)\b`,
      String.raw`\bnot (?:a substitute|intended)\b`,
      String.raw`\bthank you for choosing\b`,
      String.raw`\ball rights reserved\b`,
      String.raw`©`,
      String.raw`\bconfidential\b`,
      String.raw`\bmychart\b`,
      String.raw`\bif you have (?:any )?questions\b`,
      String.raw`^(?:patient name|dob|date of birth|mrn|account)\s*:`,
      // Why the visit happened, not what to do next ("Reason for visit: Follow-up for high blood sugar.").
      String.raw`^(?:reason for (?:your |today's )?visit|visit reason|chief complaint)\s*:`,
    ].join("|"),
  ),
};

/**
 * Spanish starter set: the most common discharge-paper forms only. Opt in with languages: ["en", "es"].
 * "no" counts only before a verb form ("No tome ..."), never alone, so "No hay neumonía" stays out.
 */
const ES: Lexicon = {
  imperativeStart:
    /^(?:tome|tomar|use|aplique|llame|vaya|regrese|vuelva|evite|deje de|empiece|comience|continúe|continue|siga|beba|pésese|pesese|revise|programe|acuda|haga|mantenga|no (?:tome|coma|beba|use|maneje|deje))(?![\p{L}])/u,
  phrase:
    /(?:llame al 911|sala de emergencias|cita|seguimiento|próxima visita|proxima visita|le llamaremos|debe|según sea necesario)(?![\p{L}])/u,
  conditionalOpen: /(?:^|[^\p{L}])si (?:tiene|usted|su|nota|siente)(?![\p{L}])/u,
  conditionalAction: /(?:^|[^\p{L}])(?:llame|vaya|regrese|acuda|busque)(?![\p{L}])/u,
  doseOrTiming: new RegExp(
    [
      String.raw`\b\d+(?:[.,]\d+)?\s*(?:mg|mcg|ml|tabletas?|pastillas?|cápsulas?|capsulas?|gotas?|inhalaciones?)(?![\p{L}])`,
      String.raw`\b(?:una|dos|tres|\d+) (?:vez|veces) al (?:día|dia)(?![\p{L}])`,
      String.raw`\bcada \d+ horas(?![\p{L}])`,
      String.raw`\b(?:en|dentro de|por) \d+ (?:horas|días|dias|semanas|meses)(?![\p{L}])`,
    ].join("|"),
    "u",
  ),
  leadIn: /^(?:por favor|y|luego|también|tambien)\s+/u,
  exclude: /(?:^|[^\p{L}])(?:no es para el paciente|firmado|uso interno|página \d+|si tiene preguntas)(?![\p{L}])/u,
};

const LEXICONS: Record<CoverageLang, Lexicon> = { en: EN, es: ES };

/* ------------------------------------------------------------------------------------------ */
/* Sentence splitting.                                                                        */
/* ------------------------------------------------------------------------------------------ */

/** Abbreviations whose trailing period does not end a sentence. Compared lower-cased. */
const ABBREVIATIONS = new Set(["dr", "mr", "mrs", "ms", "st", "vs", "etc", "e.g", "i.e", "approx", "no", "dept", "inc", "sr", "jr", "dra", "sra"]);

const LINE_BREAK = /\r\n|\r|\n|\u2028|\u2029/g;
const TERMINAL = /[.!?]\s*$/;
const LOWER_START = /^\s*\p{Ll}/u;
const HAS_LETTER = /\p{L}/u;
const IS_SPACE = /\s/;
const IS_CLOSER = /["'”’)\]]/;

/**
 * Splits text into sentences with [start, end) offsets into the ORIGINAL string (UTF-16 units, the same
 * convention as findSpan). Rules, in order:
 *  - A blank line always ends a sentence.
 *  - A line break ends a sentence, unless the line has no closing punctuation or colon AND the next line
 *    starts with a lower-case letter (a wrapped line from a PDF or a photo).
 *  - Inside a line, ".", "!" or "?" (plus any closing quote or bracket) followed by whitespace ends a sentence,
 *    unless the next word starts lower-case or the word before the period is a known abbreviation ("Dr.").
 *    A decimal ("0.5 mg") has no whitespace after its period, so it never splits.
 * Pieces with no letter at all (a lone "-" or a date) are dropped.
 */
export function splitSentences(source: string): Sentence[] {
  // 1. Physical lines with offsets.
  const lines: { start: number; end: number }[] = [];
  let lineStart = 0;
  LINE_BREAK.lastIndex = 0;
  for (let m = LINE_BREAK.exec(source); m; m = LINE_BREAK.exec(source)) {
    lines.push({ start: lineStart, end: m.index });
    lineStart = m.index + m[0].length;
  }
  lines.push({ start: lineStart, end: source.length });

  // 2. Join wrapped lines into blocks.
  const blocks: { start: number; end: number }[] = [];
  let cur: { start: number; end: number } | null = null;
  for (const ln of lines) {
    const text = source.slice(ln.start, ln.end);
    if (text.trim() === "") {
      if (cur) blocks.push(cur);
      cur = null;
      continue;
    }
    if (cur) {
      const prev = source.slice(cur.start, cur.end);
      const joins = !TERMINAL.test(prev) && !/:\s*$/.test(prev) && LOWER_START.test(text);
      if (joins) {
        cur.end = ln.end;
        continue;
      }
      blocks.push(cur);
    }
    cur = { start: ln.start, end: ln.end };
  }
  if (cur) blocks.push(cur);

  // 3. Split each block at sentence ends. One left-to-right pass per block.
  const out: Sentence[] = [];
  for (const b of blocks) {
    let pieceStart = b.start;
    let wordStart = b.start; // start of the current whitespace-delimited word
    for (let i = b.start; i < b.end; i++) {
      const c = source[i];
      if (IS_SPACE.test(c)) {
        wordStart = i + 1;
        continue;
      }
      if (c !== "." && c !== "!" && c !== "?") continue;
      let j = i + 1;
      while (j < b.end && (source[j] === "." || source[j] === "!" || source[j] === "?" || IS_CLOSER.test(source[j]))) j++;
      if (j < b.end && !IS_SPACE.test(source[j])) continue; // "0.5", "a.m", "x-ray.Next" stays together
      let k = j;
      while (k < b.end && IS_SPACE.test(source[k])) k++;
      if (k < b.end && LOWER_START.test(source[k])) continue; // "Dr. smith" style or a mid-sentence period
      if (c === ".") {
        const word = source.slice(wordStart, i).toLowerCase().replace(/^["'(\[]+/, "");
        if (ABBREVIATIONS.has(word)) continue;
      }
      pushPiece(source, pieceStart, j, out);
      pieceStart = j;
      i = j - 1;
    }
    pushPiece(source, pieceStart, b.end, out);
  }
  return out;
}

function pushPiece(source: string, start: number, end: number, out: Sentence[]): void {
  while (start < end && IS_SPACE.test(source[start])) start++;
  while (end > start && IS_SPACE.test(source[end - 1])) end--;
  if (end <= start) return;
  const text = source.slice(start, end);
  if (!HAS_LETTER.test(text)) return;
  out.push({ text, start, end });
}

/* ------------------------------------------------------------------------------------------ */
/* Classification.                                                                            */
/* ------------------------------------------------------------------------------------------ */

const PHONE = /(?:\+?1[\s.-]*)?(?:\(\d{3}\)|\d{3})[\s.-]*\d{3}[\s.-]*\d{4}(?:\s*(?:x|ext\.?)\s*\d+)?/g;
const PHONE_LABEL =
  /\b(?:phone|tel|telephone|fax|main|line|office|clinic|after|hours|number|numbers|pharmacy|nurse|ext|extension|toll|free|mobile|cell|hotline|or|and|tel[eé]fono)\b/gu;

/** A line that is only a label plus phone number(s): "Phone: (404) 555-0100 | Fax: 404-555-0101". */
function isPhoneOnly(norm: string): boolean {
  PHONE.lastIndex = 0;
  if (!PHONE.test(norm)) return false;
  const rest = norm.replace(PHONE, " ").replace(PHONE_LABEL, " ").replace(/[^\p{L}\p{N}]+/gu, "");
  return rest.length === 0;
}

function stripLead(t: string, lex: Lexicon): string {
  let s = t.replace(/^(?:[-*+>]|\d{1,2}[.)])\s+/, "");
  // Remove up to two lead-ins ("please", "and then") without a loop that could run long.
  s = s.replace(lex.leadIn, "");
  s = s.replace(lex.leadIn, "");
  return s;
}

function startsImperative(t: string, lex: Lexicon): boolean {
  const s = stripLead(t, lex);
  if (lex.imperativeStart.test(s)) return true;
  // "New medicine: take 1 tablet", "Furosemide 40 mg: take ..." -> check after a short label too.
  const colon = s.indexOf(":");
  if (colon > 0 && colon <= 40) {
    const after = stripLead(s.slice(colon + 1).trimStart(), lex);
    if (lex.imperativeStart.test(after)) return true;
  }
  return false;
}

/**
 * Returns why a sentence reads as a patient instruction, or null if it does not.
 * Exclusions (staff notes, signatures, boilerplate, phone-only lines, headers) win over every signal.
 */
export function classifySentence(text: string, options: CoverageOptions = {}): InstructionReason | null {
  const lexes = (options.languages ?? ["en"]).map((l) => LEXICONS[l]);
  const norm = normalize(text);
  if (!norm) return null;

  for (const lex of lexes) if (lex.exclude.test(norm)) return null;
  if (isPhoneOnly(norm)) return null;

  const imperative = lexes.some((lex) => startsImperative(norm, lex));

  // Headers: "Medicines", "Follow-up", "FOLLOW-UP APPOINTMENTS", "When to seek care:".
  const trimmed = text.trim();
  const hasTerminal = /[.!?]["'”’)\]]*$/.test(trimmed);
  const words = norm.split(" ").length;
  const hasDigit = /\p{N}/u.test(norm);
  const letters = trimmed.replace(/[^\p{L}]/gu, "");
  const allCaps = letters.length > 0 && letters === letters.toUpperCase() && letters !== letters.toLowerCase();
  if (/:\s*$/.test(trimmed) && words <= 6) return null;
  if (!hasTerminal && !hasDigit && !imperative && (words <= 4 || allCaps)) return null;

  if (imperative) return "imperative";
  for (const lex of lexes) {
    if (lex.phrase.test(norm)) return "phrase";
  }
  for (const lex of lexes) {
    const open = lex.conditionalOpen.exec(norm);
    if (open && lex.conditionalAction.test(norm.slice(open.index + open[0].length))) return "conditional";
  }
  for (const lex of lexes) {
    if (lex.doseOrTiming.test(norm)) return "dose_or_timing";
  }
  return null;
}

/* ------------------------------------------------------------------------------------------ */
/* Coverage.                                                                                  */
/* ------------------------------------------------------------------------------------------ */

/**
 * Compares the paper's instruction-like sentences with the kept items' quotes.
 *
 * A sentence is covered when its [start, end) overlaps any kept item's span by at least one character.
 * Items use the span the verifier already found; an item without one is located with findSpan (the same
 * normalization the verifier uses). An item whose quote cannot be found covers nothing.
 * findSpan returns the FIRST occurrence only, so a sentence whose normalized text repeats a covered
 * sentence word for word ("Call 911 if ..." printed twice) is counted as covered too.
 */
export function checkCoverage(source: string, items: CoverageItem[], options: CoverageOptions = {}): CoverageReport {
  const spans: { start: number; end: number }[] = [];
  for (const it of items) {
    const span = it.span ?? findSpan(source, it.source_quote);
    if (span && span.end > span.start) spans.push(span);
  }
  spans.sort((a, b) => a.start - b.start);
  // Merge overlapping spans so the sweep below is a single pass.
  const merged: { start: number; end: number }[] = [];
  for (const s of spans) {
    const last = merged[merged.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else merged.push({ ...s });
  }

  const instructions: { s: Sentence; reason: InstructionReason; covered: boolean }[] = [];
  let p = 0;
  for (const s of splitSentences(source)) {
    const reason = classifySentence(s.text, options);
    if (!reason) continue;
    while (p < merged.length && merged[p].end <= s.start) p++;
    const covered = p < merged.length && merged[p].start < s.end;
    instructions.push({ s, reason, covered });
  }

  const coveredText = new Set(instructions.filter((x) => x.covered).map((x) => normalize(x.s.text)));
  let covered = 0;
  const uncovered: UncoveredSentence[] = [];
  for (const x of instructions) {
    if (x.covered || coveredText.has(normalize(x.s.text))) covered++;
    else uncovered.push({ ...x.s, reason: x.reason });
  }
  return { total: instructions.length, covered, uncovered };
}
