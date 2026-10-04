/**
 * How the PHI shield reads text. Two parts:
 *
 * 1. canonicalize(): the text the shield detects on AND sends, built once, up front. Every pattern runs on it (skipping
 *    only exact placeholders, detectionView), placeholders are put into it, and it is what the AI receives, so the checked
 *    characters and the sent characters are the same. Characters that could make the two readings differ (invisible
 *    characters inside a word, bidi overrides, stray brackets, styled or compatibility letters and digits, words mixing
 *    or faking Latin with Cyrillic or Greek, Unicode line separators, control characters) are REFUSED: nothing is sent.
 *    Both the browser and the server call the same function, so they refuse the same texts.
 *
 * 2. readText(): a lenient reading used only to FIND placeholders in text a model wrote (the voice and call filter and
 *    putting real words back): it drops invisible characters, applies NFKC and folds lookalikes, so a placeholder
 *    written with an invisible or lookalike character in it is still found. It over-matches by design; it never decides
 *    what is sent to the AI.
 */

export type Reading = {
  /** The reading: what every pattern runs on. */
  text: string;
  /** text[j] came from raw[from[j], to[j]). Non-decreasing. */
  from: Int32Array;
  to: Int32Array;
  /**
   * detectionView: where placeholders were left out, as reading offsets (a placeholder at p sat just before text[p]).
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
/** Fillers drawn as a blank (Hangul fillers): read as a space. Other invisible characters, separators included, join. */
const BLANK = /[\u115F\u1160\u3164\uFFA0]/;
const DIGIT = /\p{Nd}/u;
/**
 * Any decimal digit (Arabic-Indic "٨٨٤", Devanagari, Thai...) read as its ASCII digit: a model reads them as numbers,
 * so the shield must too. Unicode puts each script's digits 0-9 in a run of ten, found once on first use.
 */
let digitZeros: number[] | null = null;
function asciiDigit(cp: number): string {
  if (!digitZeros) {
    digitZeros = [];
    for (let c = 0x80; c < 0x20000; c++) {
      if (DIGIT.test(String.fromCodePoint(c)) && !DIGIT.test(String.fromCodePoint(c - 1))) {
        for (let z = c; DIGIT.test(String.fromCodePoint(z)); z += 10) digitZeros.push(z);
      }
    }
  }
  let lo = 0, hi = digitZeros.length - 1, zero = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (digitZeros[mid] <= cp) { zero = digitZeros[mid]; lo = mid + 1; } else hi = mid - 1; }
  return zero >= 0 && cp - zero < 10 ? String(cp - zero) : String.fromCodePoint(cp);
}
const MARK = /\p{M}/u;
const SPACE = /\p{Zs}/u;
/**
 * Exactly a placeholder the shield makes, and nothing else: only this is left out of the reading as one unit. Any other
 * bracketed text ("⟦John Smith 555-123-4567⟧") loses only its bracket characters and is read like the rest of the paper.
 */
const BRACKET_RUN = /⟦(?:NAME|DOB|AGE|MRN|ACCT|ID|SSN|PHONE|EMAIL|ADDR)_[A-Z]{1,3}⟧/y;

/** The lenient reading of `raw`, for finding placeholders only. Linear in the length of the text. */
export function readText(raw: string): Reading {
  const n = raw.length;
  const from: number[] = [];
  const to: number[] = [];
  let text = "";
  const gaps: number[] = [];
  const emit = (s: string, a: number, b: number) => {
    for (let k = 0; k < s.length; k++) { from.push(a); to.push(b); }
    text += s;
  };

  let i = 0;
  while (i < n) {
    const c = raw[i];
    const code = c.charCodeAt(0);
    // Plain ASCII (the common case) is read as it is, unless a combining mark or invisible character follows it.
    if (code >= 0x20 && code < 0x7f && c !== "`" && (i + 1 >= n || raw.charCodeAt(i + 1) < 0x7f)) { emit(c, i, i + 1); i++; continue; }
    if (c === "⟦" || c === "⟧") { emit(c, i, i + 1); i++; continue; }
    if (c === "\r") { const end = raw[i + 1] === "\n" ? i + 2 : i + 1; emit("\n", i, end); i = end; continue; }
    if (c === "\n" || c === "\v" || c === "\f") { emit("\n", i, i + 1); i++; continue; }
    // Unicode line and paragraph separators and NEL: a model may read them as a space, so they cannot end a value.
    if (c === "\u0085" || c === "\u2028" || c === "\u2029") { emit(" ", i, i + 1); i++; continue; }
    if (c === "\t") { emit("  ", i, i + 1); i++; continue; }
    if (BLANK.test(c)) { emit(" ", i, i + 1); i++; continue; }
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
      else if (BLANK.test(ch) || !IGNORABLE.test(ch)) break;
      end += ch.length;
    }
    let out = cluster.normalize("NFKC");
    // A compatibility character that expands a lot (an Arabic ligature of a whole phrase) is not part of an identifier.
    if (out.length > 4 * cluster.length) out = cluster;
    let folded = "";
    for (const ch of out) folded += SPACE.test(ch) ? " " : FOLD[ch] ?? (ch > "\x7f" && DIGIT.test(ch) ? asciiDigit(ch.codePointAt(0)!) : ch);
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

/* ------------------------------------------------------------------------------------------ */
/* The canonical text: what the shield detects on AND what it sends.                          */
/* ------------------------------------------------------------------------------------------ */

/**
 * Thrown for a character the shield will not send: one that could make what a person (or a model) reads differ from
 * what the shield checked. The request is refused with this message; nothing is sent.
 */
export class PhiShieldRefused extends Error {
  constructor(message = "This text is too long to hide the patient's details safely. Send a shorter part of the paper.") {
    super(message);
    this.name = "PhiShieldRefused";
  }
}

/** A PhiShieldRefused for one character class (named in the message). */
export class PhiCharRefused extends PhiShieldRefused {
  constructor(what: string) {
    super(`This text has ${what}, which could hide a patient's details from the privacy check. Retype that part or paste it as plain text, then try again.`);
    this.name = "PhiCharRefused";
  }
}

/** One canonical edit: raw[start, end) is sent as `repl`. */
export type Edit = { start: number; end: number; repl: string };

export type Canon = Reading & { edits: Edit[] };

const BIDI_CONTROL = /[‪-‮⁦-⁩]/;
const STYLED = /[①-⓿]|[\u{1D400}-\u{1D7FF}]/u;
/** Compatibility symbols common on medical papers, sent as they are: micro sign, trademark, degrees, ordinals. */
const COMPAT_OK = /[\u00B5\u2122\u2120\u2103\u2109\u00BA\u00AA]/;
const SUPSUB_DIGIT = /[²³¹⁰⁴-⁹₀-₉]/;
/**
 * Latin letters that look like a plain ASCII letter but are not one, and are not used to write any of the app's
 * languages: dotless i and j (ı ȷ), IPA letters (ɑ ɡ ɩ...), small capitals and phonetic letters (ᴀ ʙ ꜱ...). A model
 * reads "Nɑme" as "Name"; the patterns here would not, so they are refused like Cyrillic lookalikes.
 */
const LATIN_LOOKALIKE = /[ıȷɐ-ʯᴀ-ᶿꜰ-ꟿꬰ-꭯]/;
const LATIN = /\p{Script=Latin}/u;
const CYRILLIC = /\p{Script=Cyrillic}/u;
const GREEK = /\p{Script=Greek}/u;
const ALL_LOOKALIKE = "a word written only in Cyrillic or Greek letters that look like Latin ones";
/** Punctuation variants sent as their ASCII form (no letters or digits change). */
const PUNCT: Record<string, string> = {};
for (const [src, dst] of [["‐‑‒–—―−﹘﹣⁃", "-"], ["⁄∕⧸", "/"], ["꞉∶﹕", ":"], ["‘’‛ʼ`´′", "'"], ["“”‟″", "\""]] as const) for (const ch of src) PUNCT[ch] = dst;
const MIXED = "a word mixing Latin letters with look-alike Cyrillic or Greek ones";

/**
 * The text the shield works on, built ONCE, up front: patterns run on it, placeholders are put into it, and it is what
 * the AI is sent. So what was checked and what is sent are the same characters (the only thing the detectors skip is an
 * exact placeholder, see detectionView). Every change from the raw text is listed in `edits` for mapping offsets back.
 *
 * Sent changed (and checked the same way): every line break (\r\n, \r, VT, FF) is "\n"; every space
 * character (NBSP, em space...) is " "; invisible characters (zero-width spaces and joiners, soft hyphen, word joiner,
 * BOM, LRM/RLM) are removed where they do not sit inside a word (inside one, only a soft hyphen is; any other is refused); invisible fillers are " "; a letter and its combining marks are
 * composed (NFC); fullwidth letters and digits, ligatures and digits of any script are their ASCII form; dash, slash,
 * colon and quote variants are ASCII.
 *
 * Refused (PhiCharRefused, nothing sent): control characters other than tab and line breaks; NEL, U+2028 and U+2029;
 * bidi embedding, override
 * and isolate controls; a ⟦ or ⟧ that is not part of an exact placeholder; styled letters and digits (mathematical
 * alphanumerics, circled numbers); two or more superscript or subscript digits in a row; a word that mixes Latin
 * letters with Cyrillic or Greek ones (the classic lookalike disguise).
 */
export function canonicalize(raw: string): Canon {
  const n = raw.length;
  const from: number[] = [];
  const to: number[] = [];
  const edits: Edit[] = [];
  let text = "";
  const emit = (s: string, a: number, b: number) => {
    for (let k = 0; k < s.length; k++) { from.push(a); to.push(b); }
    text += s;
    if (s !== raw.slice(a, b)) edits.push({ start: a, end: b, repl: s });
  };
  // Scripts seen in the current word (letters and marks, invisible characters ignored), to refuse a mixed word.
  // Per word (a run of letters and marks; invisible characters do not end it): which of Latin, Cyrillic and Greek it
  // uses, and whether every letter is a Cyrillic or Greek letter that looks like a Latin one (FOLD). A word using two of
  // the three scripts is refused, and so is a word made only of lookalikes ("Мариа" spelled to read as "Maria"):
  // a model reads either as the Latin word, the patterns here would not. Hangul, Han, Ethiopic and Vietnamese
  // (Latin with marks) are single-script and pass.
  let latin = false, cyr = false, grk = false, letters = 0, confusable = 0;
  const endWord = () => {
    if (letters > 0 && confusable === letters && !latin) throw new PhiCharRefused(ALL_LOOKALIKE);
    latin = false; cyr = false; grk = false; letters = 0; confusable = 0;
  };
  const letter = (ch: string) => {
    letters++;
    if (LATIN.test(ch)) latin = true;
    else if (CYRILLIC.test(ch)) { cyr = true; if (FOLD[ch]) confusable++; }
    else if (GREEK.test(ch)) { grk = true; if (FOLD[ch]) confusable++; }
    if (Number(latin) + Number(cyr) + Number(grk) > 1) throw new PhiCharRefused(MIXED);
  };
  let i = 0;
  while (i < n) {
    const c = raw[i];
    const code = c.charCodeAt(0);
    if (code >= 0x20 && code < 0x7f && c !== "`" && (i + 1 >= n || raw.charCodeAt(i + 1) < 0x7f)) {
      if ((code >= 65 && code <= 90) || (code >= 97 && code <= 122)) letter(c);
      else endWord();
      emit(c, i, i + 1);
      i++;
      continue;
    }
    if (c === "⟦" || c === "⟧") {
      BRACKET_RUN.lastIndex = i;
      const run = c === "⟦" ? BRACKET_RUN.exec(raw) : null;
      if (!run) throw new PhiCharRefused("a ⟦ or ⟧ bracket that is not one of ATLAS's own placeholders");
      endWord();
      for (let k = i; k < i + run[0].length; k++) emit(raw[k], k, k + 1);
      i += run[0].length;
      continue;
    }
    if (c === "\r") { const end = raw[i + 1] === "\n" ? i + 2 : i + 1; endWord(); emit("\n", i, end); i = end; continue; }
    if (c === "\n" || c === "\v" || c === "\f") { endWord(); emit("\n", i, i + 1); i++; continue; }
    // NEL and the Unicode line and paragraph separators: a model may read them as a line break or as a space, and the
    // two readings split fields differently, so they are refused rather than guessed.
    if (c === "\u0085" || c === "\u2028" || c === "\u2029") throw new PhiCharRefused("a Unicode line or paragraph separator");
    if (c === "\t") { endWord(); emit("\t", i, i + 1); i++; continue; }
    if (code < 0x20 || (code >= 0x7f && code < 0xa0)) throw new PhiCharRefused("a control character");
    if (BIDI_CONTROL.test(c)) throw new PhiCharRefused("a hidden text-direction control");
    if (BLANK.test(c)) { endWord(); emit(" ", i, i + 1); i++; continue; }
    const cpAt = (k: number) => String.fromCodePoint(raw.codePointAt(k)!);
    const c1 = cpAt(i);
    if (IGNORABLE.test(c1)) {
      // An invisible character inside a word or number ("Ma\u200Bria", "884\u200B12907") is refused: removing it joins
      // what may have been two words ("Maria\u200BLopez" sent as "MariaLopez" would let "Lopez" alone through), and
      // keeping it hides the word from the patterns. Only a soft hyphen (a line-break hint in a word) is removed there.
      // Elsewhere (a BOM, a mark beside a space or punctuation) it is removed.
      let k = i + c1.length;
      while (k < n && k - i <= 16 && IGNORABLE.test(cpAt(k))) k += cpAt(k).length;
      if (k - i > 16) throw new PhiCharRefused("a run of invisible characters"); // bounded: no rescanning a long run
      const inWord = /[\p{L}\p{N}]/u.test(text.slice(-1)) && k < n && /[\p{L}\p{N}\p{M}]/u.test(String.fromCodePoint(raw.codePointAt(k)!));
      if (inWord && c !== "\u00AD") throw new PhiCharRefused("an invisible character inside a word or number");
      emit("", i, i + c1.length);
      i += c1.length;
      continue;
    }
    if (SPACE.test(c)) { endWord(); emit(" ", i, i + 1); i++; continue; }
    const cp = raw.codePointAt(i)!;
    let end = i + (cp > 0xffff ? 2 : 1);
    const base = raw.slice(i, end);
    const nextCh = end < n ? String.fromCodePoint(raw.codePointAt(end)!) : "";
    // A circled number used as a list marker ("① Take metformin"): one circled number 1 to 20 with no digit or other
    // circled number beside it is sent as "(1)", which is what a model reads. Anywhere else (a run of them, beside a
    // digit) it could spell part of a number and is refused below.
    if (cp >= 0x2460 && cp <= 0x2473 && !/[\p{N}]/u.test(text.slice(-1)) && !/[\p{N}]/u.test(nextCh)) {
      endWord();
      emit(`(${cp - 0x245f})`, i, end);
      i = end;
      continue;
    }
    if (STYLED.test(base)) throw new PhiCharRefused("styled or circled letters or numbers");
    if (LATIN_LOOKALIKE.test(base)) throw new PhiCharRefused("Latin letters that look like other letters (such as ı or ɑ)");
    // Superscript and subscript digits could be read as part of a number or id ("555-12³4", "884-¹-2907", "A¹-2907").
    // Allowed only as a run of at most 3 right after a letter, in a stretch of non-space text with no other digit in it
    // ("m²", "CO₂", a footnote or citation mark "aspirin¹", "études¹²"): 3 digits are too few to be an identifier. The
    // stretch is read at most 64 characters each way.
    if (SUPSUB_DIGIT.test(base)) {
      let runEnd = end;
      while (runEnd < n && SUPSUB_DIGIT.test(raw[runEnd])) runEnd++;
      let a = i, b = runEnd;
      while (a > 0 && i - a < 64 && !/\s/.test(raw[a - 1])) a--;
      while (b < n && b - runEnd < 64 && !/\s/.test(raw[b])) b++;
      const around = raw.slice(a, i) + raw.slice(runEnd, b);
      if (!/\p{L}/u.test(text.slice(-1)) || runEnd - i > 3 || /\p{N}/u.test(around)) {
        throw new PhiCharRefused("a superscript or subscript digit that could be read as part of a number");
      }
      endWord();
      for (let k = i; k < runEnd; k++) emit(raw[k], k, k + 1);
      i = runEnd;
      continue;
    }
    // A cluster: the code point and the combining marks after it (invisible characters inside it are removed).
    let cluster = base;
    while (end < n) {
      const ch = String.fromCodePoint(raw.codePointAt(end)!);
      if (MARK.test(ch) && !IGNORABLE.test(ch)) cluster += ch;
      else if (BLANK.test(ch) || BIDI_CONTROL.test(ch) || !IGNORABLE.test(ch)) break;
      else {
        // An invisible character inside a cluster is removed only when a combining mark follows it; otherwise the
        // cluster ends and the character is judged on its own (inside a word: refused).
        let k = end + ch.length;
        while (k < n && k - end <= 16 && IGNORABLE.test(String.fromCodePoint(raw.codePointAt(k)!))) k += String.fromCodePoint(raw.codePointAt(k)!).length;
        const after = k < n ? String.fromCodePoint(raw.codePointAt(k)!) : "";
        if (!MARK.test(after) || IGNORABLE.test(after)) break;
      }
      end += ch.length;
    }
    let out = cluster.normalize("NFC");
    if (cp >= 0xff01 && cp <= 0xff5e) out = String.fromCharCode(cp - 0xfee0) + cluster.slice(base.length).normalize("NFC"); // fullwidth ASCII
    else if (cp >= 0xfb00 && cp <= 0xfb06) out = out.normalize("NFKC"); // ﬁ ﬂ ﬀ ligatures
    // Unit squares (㎎ ㎖ ㎏) and Roman numerals (Stage Ⅳ): common on medical papers, sent as plain letters.
    else if ((cp >= 0x3380 && cp <= 0x33df) || (cp >= 0x2160 && cp <= 0x217f)) out = out.normalize("NFKC");
    else if (PUNCT[base]) out = PUNCT[base] + cluster.slice(base.length);
    else if (cp > 0x7f && DIGIT.test(base)) out = asciiDigit(cp) + cluster.slice(base.length);
    else {
      // Any other compatibility letter or digit (mathematical letters, circled numbers, Roman numerals, ℡...) would be
      // read by a model as the letter or digit it imitates, while the patterns here would not see it: refused, never
      // normalized only for checking (the checked text and the sent text stay identical). A short allowlist of symbols
      // common on medical papers stays as it is: µ, ½ and the other fractions (not before a digit), ™ ® ℃ ℉ º ª,
      // and a lone superscript digit (checked above).
      const nfkc = cluster.normalize("NFKC");
      if (nfkc !== out && /[\p{L}\p{N}]/u.test(nfkc) && !SUPSUB_DIGIT.test(base)) {
        const fraction = /[¼-¾⅐-⅞]/.test(base);
        if (!(COMPAT_OK.test(base) || (fraction && !/\p{N}/u.test(nextCh)))) throw new PhiCharRefused("compatibility letters or digits (styled, circled or Roman-numeral characters)");
      }
    }
    if (/\p{L}/u.test(out)) { for (const ch of out) if (/\p{L}/u.test(ch)) letter(ch); }
    else endWord();
    emit(out, i, end);
    i = end;
  }
  endWord();
  return { text, from: Int32Array.from(from), to: Int32Array.from(to), gaps: [], edits };
}

/**
 * What the detectors read: the canonical text, character for character, except that an exact placeholder (one an
 * earlier shield made) is skipped, so the identifier around or after it is read whole. A placeholder between two
 * spaces takes one of them with it ("Maria ⟦X⟧ Lopez" reads "Maria Lopez"). `gaps` says where placeholders were.
 * Offsets in `from`/`to` are offsets in the canonical text.
 */
export function detectionView(canon: string): Reading {
  const from: number[] = [];
  const to: number[] = [];
  const gaps: number[] = [];
  let text = "";
  let i = 0;
  while (i < canon.length) {
    if (canon[i] === "⟦") {
      BRACKET_RUN.lastIndex = i;
      const run = BRACKET_RUN.exec(canon);
      if (run) {
        let end = i + run[0].length;
        if (canon[i - 1] === " " && canon[end] === " ") end++;
        gaps.push(text.length);
        i = end;
        continue;
      }
    }
    from.push(i); to.push(i + 1); text += canon[i]; i++;
  }
  return { text, from: Int32Array.from(from), to: Int32Array.from(to), gaps };
}
