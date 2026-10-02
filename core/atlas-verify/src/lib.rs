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

/// `String.prototype.indexOf(needle, from)` over UTF-16 units. `needle` is never empty here.
fn index_of(hay: &[u16], needle: &[u16], from: usize) -> Option<usize> {
    if needle.is_empty() || from > hay.len() || needle.len() > hay.len() - from {
        return None;
    }
    (from..=hay.len() - needle.len()).find(|&i| &hay[i..i + needle.len()] == needle)
}

/// `findSpan` from verify.ts. `None` is the TS `null`: the quote is not in the paper and the step is refused.
pub fn find_span(source: &str, quote: &str) -> Option<Span> {
    let frags = fragments(quote);
    if frags.is_empty() {
        return None;
    }
    let Mapped {
        norm,
        starts,
        ends,
        boundary,
    } = normalize_with_map(source);
    let on_boundary = |k: usize| boundary.get(k).copied().unwrap_or(false);
    let mut cursor = 0;
    let mut first: Option<usize> = None;
    let mut last_end = 0;
    for f in &frags {
        // The first occurrence that starts AND ends between source characters; one inside a case expansion is
        // skipped and the search goes on past it.
        let mut at = index_of(&norm, f, cursor)?;
        while !(on_boundary(at) && on_boundary(at + f.len())) {
            at = index_of(&norm, f, at + 1)?;
        }
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
    for (i, q) in quotes.iter().enumerate() {
        let span = find_span(source, q);
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
