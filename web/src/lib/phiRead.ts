/**
 * The ONE way the PHI shield reads text. Every path uses it: the browser's shield, the server's guard (including its
 * check for placeholders that are already there), putting the real words back, and the filter that keeps placeholders
 * out of the voice and the call. Two paths that read the same characters differently is how a raw identifier gets past
 * one of them, so there is no second reader.
 *
 * The reading is a copy of the text for MATCHING only. What is sent, shown or spoken is always cut from the raw text,
 * through the map this returns, so a hidden stretch covers every raw character inside it (a zero-width space, a
 * lookalike letter, a stray bracket) and an offset in the reading maps to exactly one place in the raw text.
 *
 * What the reading does:
 *  - drops invisible characters: format and default-ignorable characters (zero-width spaces and joiners, soft hyphen,
 *    word joiner, bidi marks, variation selectors);
 *  - NFKC per character cluster (a letter with its combining marks): fullwidth "Ｍ" is "M", "１" is "1", "ﬁ" is "fi";
 *  - folds lookalikes used to dodge a pattern: Cyrillic and Greek letters that look like Latin ones, the many dashes,
 *    slashes, colons and quotes;
 *  - one kind of space: NBSP and every other space character is " ", a tab is two spaces (a tab separates fields, as
 *    two spaces do), every line break is "\n";
 *  - placeholders (`placeholders: "block"`, the shield's mode): every placeholder and stray bracket is left out of the
 *    reading, so an identifier around or after one ("1234⟦ID_A⟧5678", "Patient: ⟦NAME_A⟧ Maria Lopez") is read whole
 *    and hidden whole, brackets included. A placeholder is never trusted to stand for what it claims: a page's own
 *    placeholders simply read as nothing, so the server finds nothing new in them. `"keep"` keeps every bracket (the
 *    rest of the placeholder is read like any text), for finding placeholders.
 * Case is kept (a capital letter is how a name is told from a word); matching lower-cases the reading.
 */

export type Reading = {
  /** The reading: what every pattern runs on. */
  text: string;
  /** text[j] came from raw[from[j], to[j]). Non-decreasing. */
  from: Int32Array;
  to: Int32Array;
  /**
   * Block mode: where placeholders were left out, as reading offsets (a placeholder at p sat just before text[p]).
   * A field whose value was a placeholder still has a value: it was hidden already, and the field must not be read as
   * empty (an empty field would send the value readers to the next line or make a header table of the line).
   */
  gaps: number[];
};

/** Lookalike letters and punctuation, folded to the ASCII character they imitate. */
const FOLD: Record<string, string> = {};
const pairs = (src: string, dst: string) => { for (let i = 0; i < src.length; i++) FOLD[src[i]] = dst[i]; };
// Cyrillic
pairs("АВЕКМНОРСТХаеорсухіјѕԁһӏІЈЅԜԝУ", "ABEKMHOPCTXaeopcyxijsdhlIJSWwY");
// Greek
pairs("ΑΒΕΖΗΙΚΜΝΟΡΤΥΧοαικνρτυχ", "ABEZHIKMNOPTYXoaikvptux");
// Dashes and minus signs, slashes, colons, quotes and apostrophes.
pairs("‐‑‒–—―−﹘﹣－⁃", "-----------");
pairs("⁄∕⧸", "///");
pairs("꞉∶﹕：", "::::");
pairs("‘’‛ʼʹ`´′", "''''''''");
pairs("“”‟″", "\"\"\"\"");

const IGNORABLE = /[\p{Default_Ignorable_Code_Point}\p{Cf}]/u;
const MARK = /\p{M}/u;
const SPACE = /\p{Zs}/u;
/**
 * Exactly a placeholder the shield makes, and nothing else: only this is left out of the reading as one unit. Any other
 * bracketed text ("⟦John Smith 555-123-4567⟧") loses only its bracket characters and is read like the rest of the paper.
 */
const BRACKET_RUN = /⟦(?:NAME|DOB|AGE|MRN|ACCT|ID|SSN|PHONE|EMAIL|ADDR)_[A-Z]{1,3}⟧/y;

/** Reads `raw` for matching. Linear in the length of the text. */
export function readText(raw: string, placeholders: "block" | "keep" = "block"): Reading {
  const n = raw.length;
  const from: number[] = [];
  const to: number[] = [];
  let text = "";
  const gaps: number[] = [];
  const emit = (s: string, a: number, b: number) => {
    for (let k = 0; k < s.length; k++) { from.push(a); to.push(b); }
    text += s;
  };
  // The nearest visible character before a position (invisible characters do not separate words). Bounded: a run of
  // thousands of invisible characters must not make every bracket after it rescan the run.
  const visibleBefore = (i: number) => { let k = 0; while (i > 0 && k++ < 8 && IGNORABLE.test(raw[i - 1])) i--; return i > 0 ? raw[i - 1] : ""; };

  let i = 0;
  while (i < n) {
    const c = raw[i];
    const code = c.charCodeAt(0);
    // Plain ASCII (the common case) is read as it is, unless a combining mark or invisible character follows it.
    if (code >= 0x20 && code < 0x7f && c !== "`" && (i + 1 >= n || raw.charCodeAt(i + 1) < 0x7f)) { emit(c, i, i + 1); i++; continue; }
    if (c === "⟦" || c === "⟧") {
      if (placeholders === "keep") { emit(c, i, i + 1); i++; continue; }
      // Block mode: a placeholder (or a stray bracket) is not read at all, so the identifier around or after it is read
      // whole. When it stood between two spaces, one of them goes too ("Maria ⟦X⟧ Lopez" reads "Maria Lopez").
      BRACKET_RUN.lastIndex = i;
      const run = c === "⟦" ? BRACKET_RUN.exec(raw) : null;
      let end = run ? i + run[0].length : i + 1;
      if (visibleBefore(i) === " " && raw[end] === " ") end++;
      if (run) gaps.push(text.length);
      i = end;
      continue;
    }
    if (c === "\r") { const end = raw[i + 1] === "\n" ? i + 2 : i + 1; emit("\n", i, end); i = end; continue; }
    if (c === "\n" || c === "\u0085" || c === " " || c === " " || c === "\v" || c === "\f") { emit("\n", i, i + 1); i++; continue; }
    if (c === "\t") { emit("  ", i, i + 1); i++; continue; }
    if (IGNORABLE.test(c)) { i++; continue; }
    if (SPACE.test(c)) { emit(" ", i, i + 1); i++; continue; }
    // A cluster: one code point and the combining marks (and invisible characters) after it.
    const cp = raw.codePointAt(i)!;
    let end = i + (cp > 0xffff ? 2 : 1);
    let cluster = raw.slice(i, end);
    while (end < n) {
      const d = raw.codePointAt(end)!;
      const ch = String.fromCodePoint(d);
      if (MARK.test(ch)) cluster += ch;
      else if (!IGNORABLE.test(ch)) break;
      end += ch.length;
    }
    let out = cluster.normalize("NFKC");
    // A compatibility character that expands a lot (an Arabic ligature of a whole phrase) is not part of an identifier.
    if (out.length > 4 * cluster.length) out = cluster;
    let folded = "";
    for (const ch of out) folded += SPACE.test(ch) ? " " : FOLD[ch] ?? ch;
    emit(folded, i, end);
    i = end;
  }
  return { text, from: Int32Array.from(from), to: Int32Array.from(to), gaps };
}

/** The raw [start, end) behind the reading's [start, end). An empty range maps to an empty range. */
export function rawRange(r: Reading, start: number, end: number, rawLength: number): { start: number; end: number } {
  if (end <= start) {
    const at = start < r.from.length ? r.from[start] : rawLength;
    return { start: at, end: at };
  }
  return { start: r.from[start], end: r.to[end - 1] };
}
