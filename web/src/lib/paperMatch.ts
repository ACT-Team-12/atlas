/**
 * "Show it on my paper": pure logic that places a verified step on the person's paper.
 *
 * Text papers: the step's verified span (offsets from the span verifier) is shown as is, with the lines around it.
 * Photo papers: the browser reads the photo itself (on-device OCR) and we look for the SAME words as the verified
 * span in those OCR words, in order. OCR is noisy (case, punctuation, a word split by a hyphen at a line end, a
 * letter misread), so single words may be close rather than equal, but numbers must match exactly and most words
 * must be there. When that bar is not met, or two places fit equally well, we say we could not find it rather
 * than draw a box in the wrong place.
 */

export type Span = { start: number; end: number };
export type Bbox = { x0: number; y0: number; x1: number; y1: number };
/** One OCR word in reading order. `line` is any id shared by the words on the same printed line. */
export type OcrWord = { text: string; bbox: Bbox; line: number };

export type Token = { norm: string; start: number; end: number };

export type PaperMatch =
  | { status: "found"; first: number; last: number; boxes: Bbox[]; matched: number; total: number }
  | { status: "not_found"; reason: "no_words" | "weak" | "ambiguous" };

// ---------- text papers ----------

/**
 * Cuts the paper into before / quoted / after around a verified span, keeping `contextLines` whole lines on each
 * side. Offsets are used exactly as verified; a span outside the text is refused (null), never clamped into place.
 */
export function spanContext(text: string, span: Span | null, contextLines = 2): { before: string; quote: string; after: string; clippedBefore: boolean; clippedAfter: boolean } | null {
  if (!span || !Number.isInteger(span.start) || !Number.isInteger(span.end)) return null;
  if (span.start < 0 || span.end > text.length || span.end <= span.start) return null;
  const lineStart = (p: number) => (p <= 0 ? 0 : text.lastIndexOf("\n", p - 1) + 1);
  const lineEnd = (p: number) => { const nl = text.indexOf("\n", p); return nl < 0 ? text.length : nl; };
  let from = lineStart(span.start);
  for (let n = 0; n < contextLines && from > 0; n++) from = lineStart(from - 1);
  let to = lineEnd(span.end);
  for (let n = 0; n < contextLines && to < text.length; n++) to = lineEnd(to + 1);
  return {
    before: text.slice(from, span.start),
    quote: text.slice(span.start, span.end),
    after: text.slice(span.end, to),
    clippedBefore: from > 0,
    clippedAfter: to < text.length,
  };
}

// ---------- tokens ----------

const NUM_SEP = /[.,/:\-‐‑–]/u;

/**
 * Lower case, accents removed, only letters and digits kept ("Follow-up," becomes "followup"), except a separator
 * between two digits: "1.5", "1/2" and "10-20" stay as written, so a dose can never equal a different one ("15", "12").
 */
export function normWord(s: string): string {
  const t = s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
  const digit = (c: string | undefined) => c !== undefined && /\p{N}/u.test(c);
  // Kept between digits; the dash variants all become "-".
  return t.replace(/[^\p{L}\p{N}]/gu, (c, i: number) => (NUM_SEP.test(c) && digit(t[i - 1]) && digit(t[i + 1]) ? (/[‐‑–]/u.test(c) ? "-" : c) : ""));
}

const HYPHEN_END = /[-­‐‑]$/;

/**
 * Splits text into word tokens with their offsets. A word broken by a hyphen at the end of a line ("fol-" then
 * "low" on the next line) is joined back into one token.
 */
export function tokenize(text: string): Token[] {
  const raw: { s: string; start: number; end: number; nlAfter: boolean }[] = [];
  const re = /\S+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) raw.push({ s: m[0], start: m.index, end: m.index + m[0].length, nlAfter: false });
  for (let i = 0; i < raw.length - 1; i++) raw[i].nlAfter = text.slice(raw[i].end, raw[i + 1].start).includes("\n");
  const out: Token[] = [];
  for (let i = 0; i < raw.length; i++) {
    let { s, end } = raw[i];
    const start = raw[i].start;
    while (HYPHEN_END.test(s) && raw[i].nlAfter && i + 1 < raw.length) {
      i++;
      s = s.slice(0, -1) + raw[i].s;
      end = raw[i].end;
    }
    const norm = normWord(s);
    if (norm) out.push({ norm, start, end });
  }
  return out;
}

/** OCR words as tokens (index = position of the FIRST word); hyphenated line ends are joined like `tokenize`. */
function ocrTokens(words: OcrWord[]): { norm: string; first: number; last: number }[] {
  const out: { norm: string; first: number; last: number }[] = [];
  for (let i = 0; i < words.length; i++) {
    const first = i;
    let s = words[i].text;
    while (HYPHEN_END.test(s) && i + 1 < words.length && words[i + 1].line !== words[i].line) {
      i++;
      s = s.slice(0, -1) + words[i].text;
    }
    const norm = normWord(s);
    if (norm) out.push({ norm, first, last: i });
  }
  return out;
}

// ---------- word similarity ----------

function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** 2 = same word, 1 = close enough to be an OCR misread, 0 = different. Anything with a digit must be equal. */
export function wordScore(quoteWord: string, ocrWord: string): 0 | 1 | 2 {
  if (quoteWord === ocrWord) return 2;
  if (/\p{N}/u.test(quoteWord) || /\p{N}/u.test(ocrWord)) return 0;
  const len = Math.max(quoteWord.length, ocrWord.length);
  if (Math.min(quoteWord.length, ocrWord.length) < 4) return 0;
  return editDistance(quoteWord, ocrWord) <= Math.floor(len / 4) ? 1 : 0;
}

// ---------- alignment ----------

type Candidate = { a: number; b: number; matched: number; exact: number; score: number };

const MATCH = 2, CLOSE = 1.5, MISS = -1, GAP = -1;

/**
 * Order-preserving alignment of every quote word against some run of OCR words (free start and end on the OCR side).
 * Returns each plausible end position's best alignment, as OCR token ranges [a, b].
 */
function align(q: string[], o: string[]): Candidate[] {
  const n = q.length, m = o.length;
  const W = m + 1;
  const D = new Float64Array((n + 1) * W);
  const T = new Uint8Array((n + 1) * W); // 1 diagonal, 2 up (quote word unmatched), 3 left (extra OCR word)
  const S = new Uint8Array((n + 1) * W); // word score used on the diagonal
  for (let i = 1; i <= n; i++) { D[i * W] = i * GAP; T[i * W] = 2; }
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = wordScore(q[i - 1], o[j - 1]);
      const diag = D[(i - 1) * W + j - 1] + (s === 2 ? MATCH : s === 1 ? CLOSE : MISS);
      const up = D[(i - 1) * W + j] + GAP;
      const left = i === n ? -Infinity : D[i * W + j - 1] + GAP; // no trailing extras: the run ends on a quote word
      let best = diag, t = 1;
      if (up > best) { best = up; t = 2; }
      if (left > best) { best = left; t = 3; }
      D[i * W + j] = best; T[i * W + j] = t; S[i * W + j] = s;
    }
  }
  const out: Candidate[] = [];
  for (let j = 1; j <= m; j++) {
    const here = D[n * W + j];
    if (T[n * W + j] !== 1 || S[n * W + j] === 0) continue; // must end on a real match
    if (here <= 0) continue;
    let i = n, k = j, matched = 0, exact = 0, a = j - 1;
    while (i > 0) {
      const t = T[i * W + k];
      if (t === 1) {
        if (S[i * W + k] > 0) { matched++; if (S[i * W + k] === 2) exact++; a = k - 1; }
        i--; k--;
      } else if (t === 2) i--;
      else k--;
    }
    out.push({ a, b: j - 1, matched, exact, score: here });
  }
  return out;
}

/** Quote tokens: every token of the source whose characters sit inside the verified span. */
function spanTokens(tokens: Token[], span: Span): { first: number; words: string[] } {
  const inside = tokens.map((t, i) => ({ t, i })).filter(({ t }) => t.start >= span.start && t.end <= span.end);
  return { first: inside.length ? inside[0].i : -1, words: inside.map(({ t }) => t.norm) };
}

/** Which occurrence (0-based) of this exact word sequence in the source is the verified one, and how many there are. */
function occurrence(tokens: Token[], first: number, words: string[]): { k: number; count: number } {
  let k = 0, count = 0;
  outer: for (let i = 0; i + words.length <= tokens.length; i++) {
    for (let w = 0; w < words.length; w++) if (tokens[i + w].norm !== words[w]) continue outer;
    if (i < first) k++;
    count++;
  }
  return { k, count };
}

function unionBoxesByLine(words: OcrWord[], first: number, last: number): Bbox[] {
  const byLine = new Map<number, Bbox>();
  for (let i = first; i <= last; i++) {
    const { line, bbox } = words[i];
    const b = byLine.get(line);
    byLine.set(line, b ? { x0: Math.min(b.x0, bbox.x0), y0: Math.min(b.y0, bbox.y0), x1: Math.max(b.x1, bbox.x1), y1: Math.max(b.y1, bbox.y1) } : { ...bbox });
  }
  return [...byLine.values()];
}

/** How many quote words must be found (exactly or as a close OCR misread). Short quotes need every word. */
export function needed(total: number): number {
  return total <= 4 ? total : Math.ceil(total * 0.8);
}

/**
 * Finds the verified span of `sourceText` among the OCR words of the photo.
 * `span` must be the verifier's own span for this step; the quote words are taken from it, not re-searched.
 */
export function matchOnPhoto(sourceText: string, span: Span | null, words: OcrWord[]): PaperMatch {
  if (!span || span.start < 0 || span.end > sourceText.length || span.end <= span.start) return { status: "not_found", reason: "weak" };
  const src = tokenize(sourceText);
  const { first, words: q } = spanTokens(src, span);
  if (q.length === 0) return { status: "not_found", reason: "weak" };
  const ot = ocrTokens(words);
  if (ot.length === 0) return { status: "not_found", reason: "no_words" };

  const need = needed(q.length);
  const maxRun = q.length + Math.max(2, Math.ceil(q.length * 0.25));
  const qDigits = q.filter((w) => /\p{N}/u.test(w));
  let cands = align(q, ot.map((t) => t.norm)).filter((c) => {
    if (c.matched < need || c.b - c.a + 1 > maxRun) return false;
    // Every number in the quote (a dose, a date, a phone number) must be on the photo inside this run.
    const run = ot.slice(c.a, c.b + 1).map((t) => t.norm);
    return qDigits.every((d) => run.includes(d));
  });
  // Overlapping runs describe the same place: keep the best of each.
  cands.sort((x, y) => y.score - x.score || x.a - y.a);
  const kept: Candidate[] = [];
  for (const c of cands) if (!kept.some((k) => c.a <= k.b && k.a <= c.b)) kept.push(c);
  cands = kept.sort((x, y) => x.a - y.a);
  if (cands.length === 0) return { status: "not_found", reason: "weak" };

  let pick: Candidate | null = null;
  if (cands.length === 1) pick = cands[0];
  else {
    // The same words appear more than once on the photo. If the paper text has the same number of copies, the
    // verified copy is the same one in order. Otherwise use the place in the page, and refuse if that is unclear.
    const occ = occurrence(src, first, q);
    if (occ.count === cands.length) pick = cands[occ.k];
    else {
      const want = first / Math.max(1, src.length);
      const byDist = cands.map((c) => ({ c, d: Math.abs(c.a / Math.max(1, ot.length) - want) })).sort((x, y) => x.d - y.d);
      if (byDist[0].d <= 0.1 && byDist[1].d - byDist[0].d >= 0.25) pick = byDist[0].c;
    }
  }
  if (!pick) return { status: "not_found", reason: "ambiguous" };
  const firstWord = ot[pick.a].first, lastWord = ot[pick.b].last;
  return { status: "found", first: firstWord, last: lastWord, boxes: unionBoxesByLine(words, firstWord, lastWord), matched: pick.matched, total: q.length };
}

// ---------- OCR language ----------

const ES = new Set(["el", "la", "los", "las", "de", "del", "que", "y", "en", "por", "para", "con", "una", "su", "sus", "se", "al", "es", "cada", "dia", "dias", "usted", "medico", "tome", "llame"]);
const EN = new Set(["the", "and", "to", "of", "a", "in", "for", "with", "your", "you", "is", "take", "call", "day", "days", "if", "or", "on", "by", "at"]);

/**
 * Which reading data to load for the photo: Spanish only when the text we already read from it is clearly Spanish.
 * One language is loaded at a time to keep the download small.
 */
export function guessOcrLang(text: string): "eng" | "spa" {
  let es = 0, en = 0;
  for (const t of tokenize(text)) { if (ES.has(t.norm)) es++; if (EN.has(t.norm)) en++; }
  return es >= 5 && es > en * 1.5 ? "spa" : "eng";
}
