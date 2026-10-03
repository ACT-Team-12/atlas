//! ATLAS quote checker, shared core.
//!
//! A line-for-line port of `web/src/lib/verify.ts` (`normalize`, `findSpan`, `verifyItems`) and of the pure
//! planted-fake builder in `web/src/lib/checkerTest.ts` (`fakesFor`, `runCheckerTest`). The TypeScript stays the
//! production checker; this crate exists so the exact same rule can run in WebAssembly and, next, in the phone apps.
//!
//! Behaviour is matched to JavaScript, not to "what a Rust programmer would expect":
//! - every offset is a UTF-16 code unit index (a JS string index), never a byte or `char` index;
//! - "whitespace" is the JS `\s` set (it includes U+FEFF and excludes U+0085, unlike `char::is_whitespace`);
//! - the source is normalized one code point at a time, as `normalizeWithMap` does, with a [start, end) entry per
//!   normalized UTF-16 unit, while the quote is lower-cased as a whole string; final sigma is folded to plain sigma
//!   on both sides so the two agree.
//!
//! Inputs are `&str`, so a string containing a lone surrogate cannot be passed in. JS strings can hold one; across
//! the WebAssembly boundary `TextEncoder` turns it into U+FFFD. That is the one known input class where the two
//! implementations are not comparable.

mod fakes;
#[cfg(target_arch = "wasm32")]
mod wasm;

pub use fakes::{fakes_for, run_checker_test, CheckerReport, Fake, KindCount, Paper, Slipped};

/// Result of a successful [`find_span`]: where the quote sits in the ORIGINAL source, in UTF-16 code units
/// (`source.slice(start, end)` in JS).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span {
    pub start: usize,
    pub end: usize,
}

impl Span {
    pub fn range(&self) -> std::ops::Range<usize> {
        self.start..self.end
    }
}

/// The JS `\s` class (ECMAScript WhiteSpace plus LineTerminator).
pub fn is_js_whitespace(c: char) -> bool {
    matches!(
        c,
        '\u{0009}'
            | '\u{000A}'
            | '\u{000B}'
            | '\u{000C}'
            | '\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'
            ..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}'
    )
}

/// The character folds `normalize` applies after lower-casing: final sigma, quote marks, dashes, bullets.
fn fold(c: char) -> char {
    match c {
        // "ΟΔΟΣ" lower-cases to "οδος" as a word but "οδοσ" letter by letter (how the source is mapped).
        '\u{03C2}' => '\u{03C3}',
        '\u{2018}' | '\u{2019}' | '\u{201B}' | '\u{2032}' => '\'',
        '\u{201C}' | '\u{201D}' | '\u{2033}' => '"',
        '\u{2010}'..='\u{2015}' | '\u{2212}' => '-',
        '\u{2022}' | '\u{25CF}' | '\u{25AA}' | '\u{00B7}' => ' ',
        other => other,
    }
}

/// `normalize` from verify.ts: lower-case, fold quotes/dashes/bullets, collapse whitespace runs to one space, trim.
pub fn normalize(s: &str) -> String {
    // `str::to_lowercase` applies the full Unicode mapping including the Final_Sigma context rule, as
    // `String.prototype.toLowerCase` does.
    let lower = s.to_lowercase();
    let mut out = String::with_capacity(lower.len());
    let mut in_space = false;
    for c in lower.chars().map(fold) {
        if is_js_whitespace(c) {
            if !in_space {
                out.push(' ');
                in_space = true;
            }
        } else {
            out.push(c);
            in_space = false;
        }
    }
    // Only plain spaces can remain as whitespace, so trimming them is the JS `trim()`.
    out.trim_matches(' ').to_string()
}

const SPACE: u16 = 0x20;

/// `normalizeWithMap` from verify.ts: the normalized source as UTF-16 units, plus for each unit the original
/// [start, end) in UTF-16 units. Walked one code point at a time, so a letter outside the BMP is lower-cased, and a
/// letter that lower-cases to two units (U+0130 becomes `i` + U+0307) gets an entry for each. `boundary[k]` is true
/// when normalized position k is where one source character's output begins (or the end), so a match can be required
/// to start and end between source characters, never inside one character's expansion.
struct Mapped {
    norm: Vec<u16>,
    starts: Vec<usize>,
    ends: Vec<usize>,
    boundary: Vec<bool>,
}

fn normalize_with_map(src: &str) -> Mapped {
    let mut norm: Vec<u16> = Vec::with_capacity(src.len());
    let mut starts: Vec<usize> = Vec::with_capacity(src.len());
    let mut ends: Vec<usize> = Vec::with_capacity(src.len());
    let mut boundary: Vec<bool> = Vec::with_capacity(src.len() + 1);
    let mut last_space = true;
    let mut buf = [0u8; 4];
    let mut i = 0;
    for ch in src.chars() {
        let next = i + ch.len_utf16();
        // `normalize(ch) || " "`, where ch is ONE code point.
        let c: Vec<u16> = if ch.is_ascii() {
            if is_js_whitespace(ch) {
                vec![SPACE]
            } else {
                vec![u16::from(ch.to_ascii_lowercase() as u8)]
            }
        } else {
            let n = normalize(ch.encode_utf8(&mut buf));
            if n.is_empty() {
                vec![SPACE]
            } else {
                n.encode_utf16().collect()
            }
        };
        if c == [SPACE] {
            if !last_space {
                mark(&mut boundary, norm.len());
                norm.push(SPACE);
                starts.push(i);
                ends.push(next);
                last_space = true;
            }
        } else {
            mark(&mut boundary, norm.len());
            for &u in &c {
                norm.push(u);
                starts.push(i);
                ends.push(next);
            }
            last_space = false;
        }
        i = next;
    }
    // `trimEnd()`: the only whitespace unit that can be in `norm` is a plain space.
    while norm.last() == Some(&SPACE) {
        norm.pop();
    }
    mark(&mut boundary, norm.len());
    Mapped {
        norm,
        starts,
        ends,
        boundary,
    }
}

fn mark(boundary: &mut Vec<bool>, at: usize) {
    if boundary.len() <= at {
        boundary.resize(at + 1, false);
    }
    boundary[at] = true;
}

fn trim_quote_marks(f: &str) -> &str {
    // `f.replace(/^["'\s]+|["'\s]+$/g, "").trim()`
    f.trim_matches(|c: char| c == '"' || c == '\'' || is_js_whitespace(c))
}

/// `fragments` from verify.ts: split the normalized quote on "..." or "…", trim quote marks, drop only EMPTY
/// fragments (a leading or trailing ellipsis). If any remaining fragment is shorter than 3 UTF-16 units the quote is
/// refused (empty result), so "Take ... 5 ... mg" cannot ground on "Take a seat." with the dose never checked.
/// Returned as UTF-16 so lengths and searches are in JS units.
fn fragments(quote: &str) -> Vec<Vec<u16>> {
    let n = normalize(quote);
    let mut parts: Vec<&str> = Vec::new();
    let mut start = 0;
    let mut i = 0;
    let bytes = n.as_bytes();
    while i < n.len() {
        if n[i..].starts_with("...") {
            parts.push(&n[start..i]);
            i += 3;
            start = i;
        } else if n[i..].starts_with('\u{2026}') {
            parts.push(&n[start..i]);
            i += '\u{2026}'.len_utf8();
            start = i;
        } else {
            // Advance one whole UTF-8 sequence.
            i += utf8_len(bytes[i]);
        }
    }
    parts.push(&n[start..]);
    let frags: Vec<Vec<u16>> = parts
        .into_iter()
        .map(|p| trim_quote_marks(p).encode_utf16().collect::<Vec<u16>>())
        .filter(|f| !f.is_empty())
        .collect();
    if frags.iter().any(|f| f.len() < 3) {
        Vec::new()
    } else {
        frags
    }
}

fn utf8_len(first: u8) -> usize {
    match first {
        0x00..=0x7F => 1,
        0xC0..=0xDF => 2,
        0xE0..=0xEF => 3,
        _ => 4,
    }
}

/// `indexOfAligned` from verify.ts: the first occurrence of `needle` in `hay` at or after `from` that starts AND ends
/// on a boundary and that `accept` allows. Same answer as re-running `indexOf` from each rejected occurrence, but
/// Knuth-Morris-Pratt over UTF-16 units enumerates every occurrence (overlapping ones included, in start order) in one
/// O(hay + needle) pass, where re-running a search re-compares the whole needle at every rejected occurrence:
/// O(hay * needle) on a run of U+0130 against a "U+0307 i" quote. `needle` is never empty here. `steps` counts loop steps, so tests can assert
/// linear work without timing anything.
fn index_of_aligned(
    hay: &[u16],
    needle: &[u16],
    from: usize,
    aligned: impl Fn(usize) -> bool,
    // Word and number edges (`on_boundary`), checked inside this one pass so the search stays linear: re-running it
    // after each rejected occurrence would be O(hay * needle) on a paper like "aaaa...".
    accept: impl Fn(usize) -> bool,
    steps: &mut usize,
) -> Option<usize> {
    let m = needle.len();
    if m == 0 {
        return None;
    }
    // pi[k]: length of the longest proper prefix of needle[..=k] that is also its suffix.
    let mut pi = vec![0usize; m];
    let mut j = 0;
    for k in 1..m {
        *steps += 1;
        while j > 0 && needle[k] != needle[j] {
            j = pi[j - 1];
            *steps += 1;
        }
        if needle[k] == needle[j] {
            j += 1;
        }
        pi[k] = j;
    }
    j = 0;
    for (i, &c) in hay.iter().enumerate().skip(from) {
        *steps += 1;
        while j > 0 && c != needle[j] {
            j = pi[j - 1];
            *steps += 1;
        }
        if c == needle[j] {
            j += 1;
        }
        if j == m {
            let at = i + 1 - m;
            if aligned(at) && aligned(i + 1) && accept(at) {
                return Some(at);
            }
            j = pi[j - 1];
        }
    }
    None
}

/// `WORD_CHAR` from verify.ts, on one UTF-16 unit: the same plain ranges (Latin, Greek, Cyrillic, Armenian, Hebrew,
/// Arabic, Devanagari, Georgian, Ethiopic, fullwidth). Chinese, Japanese, Korean and Thai never count.
fn is_word_unit(u: u16) -> bool {
    matches!(
        u,
        0x41..=0x5A
            | 0x61..=0x7A
            | 0x30..=0x39
            | 0x00AA
            | 0x00B2
            | 0x00B3
            | 0x00B5
            | 0x00B9
            | 0x00BA
            | 0x00BC..=0x00BE
            | 0x00C0..=0x00D6
            | 0x00D8..=0x00F6
            | 0x00F8..=0x02FF
            | 0x0300..=0x036F
            | 0x0370..=0x03FF
            | 0x0400..=0x052F
            | 0x0530..=0x058F
            | 0x0590..=0x05FF
            | 0x0600..=0x06FF
            | 0x0900..=0x097F
            | 0x10A0..=0x10FF
            | 0x1200..=0x139F
            | 0x1E00..=0x1FFF
            | 0x2070..=0x209F
            | 0x2150..=0x218F
            | 0xFF10..=0xFF19
            | 0xFF21..=0xFF3A
            | 0xFF41..=0xFF5A
    )
}

/// `DIGIT` from verify.ts.
fn is_digit_unit(u: u16) -> bool {
    matches!(u, 0x30..=0x39 | 0x0660..=0x0669 | 0x06F0..=0x06F9 | 0x0966..=0x096F | 0xFF10..=0xFF19)
}

/// `onBoundary` from verify.ts: the fragment starts and ends on a word or number boundary, so "take it" is not in
/// "mistake it", "10 mg" is not in "110 mg", and "5 mg" is not in "2.5 mg".
fn on_boundary(norm: &[u16], f: &[u16], at: usize) -> bool {
    let end = at + f.len();
    let unit = |i: Option<usize>| i.and_then(|i| norm.get(i).copied());
    let before = unit(at.checked_sub(1));
    let before2 = unit(at.checked_sub(2));
    let after = unit(Some(end));
    let after2 = unit(Some(end + 1));
    let word = |u: Option<u16>| u.is_some_and(is_word_unit);
    let digit = |u: Option<u16>| u.is_some_and(is_digit_unit);
    // `NUMBER_JOIN` from verify.ts: . , / U+2044 U+2215 ' and a space.
    let sep = |u: Option<u16>| matches!(u, Some(0x2E | 0x2C | 0x2F | 0x2044 | 0x2215 | 0x27 | 0x20));
    let (first, last) = (f.first().copied(), f.last().copied());
    if word(first) && word(before) {
        return false;
    }
    if word(last) && word(after) {
        return false;
    }
    if digit(first) && sep(before) && digit(before2) {
        return false;
    }
    if digit(last) && sep(after) && digit(after2) {
        return false;
    }
    // A fraction slash with a space on either side ("1 / 2", "3 \u{2044} 4") still joins the two numbers.
    if digit(first) && at > 0 && spaced_slash(norm, at as isize - 1, -1) {
        return false;
    }
    if digit(last) && spaced_slash(norm, end as isize, 1) {
        return false;
    }
    true
}

/// `spacedSlash` from verify.ts: from `i` walking in `step` direction, an optional space, a fraction slash, an
/// optional space, then a digit.
fn spaced_slash(norm: &[u16], i: isize, step: isize) -> bool {
    let at = |j: isize| -> Option<u16> {
        if j < 0 {
            None
        } else {
            norm.get(j as usize).copied()
        }
    };
    let mut j = i;
    if at(j) == Some(0x20) {
        j += step;
    }
    if !matches!(at(j), Some(0x2F | 0x2044 | 0x2215)) {
        return false;
    }
    j += step;
    if at(j) == Some(0x20) {
        j += step;
    }
    at(j).is_some_and(is_digit_unit)
}

/// `findSpan` from verify.ts. `None` is the TS `null`: the quote is not in the paper and the step is refused.
pub fn find_span(source: &str, quote: &str) -> Option<Span> {
    find_span_in(&normalize_with_map(source), quote)
}

/// [`find_span`] for every quote against one source, mapped once (`mapSource` + `findSpanIn` in verify.ts). The
/// WebAssembly export the browser calls, so 40 items cost one mapping of the paper, not 40.
pub fn find_spans(source: &str, quotes: &[&str]) -> Vec<Option<Span>> {
    let mapped = normalize_with_map(source);
    quotes.iter().map(|q| find_span_in(&mapped, q)).collect()
}

/// [`find_span`] against an already mapped source (`findSpanIn` in verify.ts).
fn find_span_in(mapped: &Mapped, quote: &str) -> Option<Span> {
    let frags = fragments(quote);
    if frags.is_empty() {
        return None;
    }
    let Mapped {
        norm,
        starts,
        ends,
        boundary,
    } = mapped;
    let aligned = |k: usize| boundary.get(k).copied().unwrap_or(false);
    let mut cursor = 0;
    let mut first: Option<usize> = None;
    let mut last_end = 0;
    for f in &frags {
        // The first occurrence that starts AND ends between source characters (never inside one character's case
        // expansion) and on a word or number edge ("10 mg" is not in "110 mg"). Rejected occurrences are skipped and
        // the search goes on past them.
        let at = index_of_aligned(norm, f, cursor, aligned, |a| on_boundary(norm, f, a), &mut 0)?;
        if first.is_none() {
            first = Some(at);
        }
        last_end = at + f.len();
        cursor = last_end;
    }
    let first = first.expect("at least one fragment matched");
    Some(Span {
        start: starts[first],
        end: ends[last_end - 1],
    })
}

/// Grounding result for one quote, the part of `verifyItem` that is not copying the item's other fields.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verified {
    /// `item-<index>`, the item's place in the model's full list.
    pub id: String,
    pub grounded: bool,
    pub span: Option<Span>,
}

/// `verifyItems` from verify.ts, over the items' `source_quote`s: grounded ones are kept, the rest refused.
pub fn verify_quotes(source: &str, quotes: &[&str]) -> (Vec<Verified>, Vec<Verified>) {
    let mut kept = Vec::new();
    let mut refused = Vec::new();
    for (i, span) in find_spans(source, quotes).into_iter().enumerate() {
        let v = Verified {
            id: format!("item-{i}"),
            grounded: span.is_some(),
            span,
        };
        if v.grounded {
            kept.push(v);
        } else {
            refused.push(v);
        }
    }
    (kept, refused)
}

/// Escapes a string as a JSON string literal (used by the WebAssembly exports, which return JSON text).
pub fn json_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 2);
    out.push('"');
    for c in s.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Steps the matcher takes for one search of `q` in `src`, with the normalized lengths.
    fn steps_for(src: &str, q: &str) -> (usize, usize, usize) {
        let m = normalize_with_map(src);
        let needle: Vec<u16> = normalize(q).encode_utf16().collect();
        let on_boundary = |k: usize| m.boundary.get(k).copied().unwrap_or(false);
        let mut steps = 0;
        assert_eq!(
            index_of_aligned(&m.norm, &needle, 0, on_boundary, |_| true, &mut steps),
            None
        );
        (steps, m.norm.len(), needle.len())
    }

    #[test]
    fn at_most_two_steps_per_source_and_quote_unit_at_the_request_limits() {
        // 20,000 U+0130 against 300 "U+0307 i": an unaligned occurrence at every odd position. Re-running the search
        // from each one is O(source * quote); this must stay O(source + quote).
        let (steps, hay, needle) = steps_for(&"\u{0130}".repeat(20000), &"\u{0307}i".repeat(300));
        assert_eq!((hay, needle), (40000, 600));
        assert!(steps <= 2 * (hay + needle), "{steps} steps");
    }

    #[test]
    fn word_edges_are_checked_in_the_same_linear_pass() {
        // 20,000 "a" against 300 "a": every position is an aligned occurrence, and only the first sits on a word edge
        // at its start while none ends on one. Checking the word edge by re-running the search would be quadratic.
        let src = "a".repeat(20000);
        let m = normalize_with_map(&src);
        let needle: Vec<u16> = "a".repeat(300).encode_utf16().collect();
        let aligned = |k: usize| m.boundary.get(k).copied().unwrap_or(false);
        let mut steps = 0;
        let found = index_of_aligned(
            &m.norm,
            &needle,
            0,
            aligned,
            |a| on_boundary(&m.norm, &needle, a),
            &mut steps,
        );
        assert_eq!(found, None);
        assert!(steps <= 2 * (20000 + 300), "{steps} steps");
    }

    #[test]
    fn four_times_the_input_costs_about_four_times_the_steps_not_sixteen() {
        let (small, _, _) = steps_for(&"\u{0130}".repeat(5000), &"\u{0307}i".repeat(75));
        let (big, _, _) = steps_for(&"\u{0130}".repeat(20000), &"\u{0307}i".repeat(300));
        assert!(big as f64 / small as f64 <= 4.5, "{small} -> {big}");
    }
}
