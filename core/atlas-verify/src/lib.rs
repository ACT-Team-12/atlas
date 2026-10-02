//! ATLAS quote checker, shared core.
//!
//! A line-for-line port of `web/src/lib/verify.ts` (`normalize`, `findSpan`, `verifyItems`) and of the pure
//! planted-fake builder in `web/src/lib/checkerTest.ts` (`fakesFor`, `runCheckerTest`). The TypeScript stays the
//! production checker; this crate exists so the exact same rule can run in WebAssembly and, next, in the phone apps.
//!
//! Behaviour is matched to JavaScript, not to "what a Rust programmer would expect":
//! - every offset is a UTF-16 code unit index (a JS string index), never a byte or `char` index;
//! - "whitespace" is the JS `\s` set (it includes U+FEFF and excludes U+0085, unlike `char::is_whitespace`);
//! - the source is normalized one UTF-16 code unit at a time, exactly as `normalizeWithMap` does, so a surrogate
//!   pair is two separate units and is never lower-cased, while the quote is lower-cased as a whole string;
//! - `findSpan` can, like the TS, return a span whose offsets are not usable numbers (see [`Span`]).
//!
//! Inputs are `&str`, so a string containing a lone surrogate cannot be passed in. JS strings can hold one; across
//! the WebAssembly boundary `TextEncoder` turns it into U+FFFD. That is the one known input class where the two
//! implementations are not comparable.

mod fakes;
#[cfg(target_arch = "wasm32")]
mod wasm;

pub use fakes::{fakes_for, run_checker_test, CheckerReport, Fake, KindCount, Paper, Slipped};

/// Result of a successful [`find_span`]: where the quote sits in the ORIGINAL source, in UTF-16 code units.
///
/// Both fields are `Some` for every input we have seen in practice. They mirror JS exactly: `normalizeWithMap`
/// pushes one map entry per source unit even when lower-casing that unit produces two units (U+0130, capital I with
/// dot above, becomes `i` + U+0307). After such a character the TS map is shorter than the normalized text, so a
/// late match reads past the end of the map: JS then returns `{ start: undefined, end: NaN }`, which is still a
/// truthy "found". `start: None` stands for that `undefined`, `end: None` for that `NaN`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Span {
    pub start: Option<usize>,
    pub end: Option<usize>,
}

impl Span {
    /// The span as a range, when both ends are real offsets.
    pub fn range(&self) -> Option<std::ops::Range<usize>> {
        match (self.start, self.end) {
            (Some(s), Some(e)) => Some(s..e),
            _ => None,
        }
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

/// The character folds `normalize` applies after lower-casing: quote marks, dashes, bullets.
fn fold(c: char) -> char {
    match c {
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

fn is_surrogate(u: u16) -> bool {
    (0xD800..=0xDFFF).contains(&u)
}

/// `normalizeWithMap` from verify.ts: the normalized source as UTF-16 units, plus one map entry per kept source unit.
fn normalize_with_map(src: &str) -> (Vec<u16>, Vec<usize>) {
    let units: Vec<u16> = src.encode_utf16().collect();
    let mut norm: Vec<u16> = Vec::with_capacity(units.len());
    let mut map: Vec<usize> = Vec::with_capacity(units.len());
    let mut last_space = true;
    let mut buf = [0u8; 4];
    for (i, &u) in units.iter().enumerate() {
        // `normalize(src[i]) || " "`, where src[i] is ONE code unit.
        let c: Vec<u16> = if is_surrogate(u) {
            // A lone surrogate is untouched by toLowerCase, the folds and \s.
            vec![u]
        } else {
            let ch = char::from_u32(u32::from(u)).expect("non-surrogate BMP unit is a char");
            if ch.is_ascii() {
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
            }
        };
        if c == [SPACE] {
            if last_space {
                continue;
            }
            norm.push(SPACE);
            map.push(i);
            last_space = true;
        } else {
            norm.extend_from_slice(&c);
            map.push(i);
            last_space = false;
        }
    }
    // `trimEnd()`: the only whitespace unit that can be in `norm` is a plain space.
    while norm.last() == Some(&SPACE) {
        norm.pop();
    }
    (norm, map)
}

fn trim_quote_marks(f: &str) -> &str {
    // `f.replace(/^["'\s]+|["'\s]+$/g, "").trim()`
    f.trim_matches(|c: char| c == '"' || c == '\'' || is_js_whitespace(c))
}

/// `fragments` from verify.ts: split the normalized quote on "..." or "…", trim quote marks, keep fragments of
/// at least 3 UTF-16 units. Returned as UTF-16 so lengths and searches are in JS units.
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
    parts
        .into_iter()
        .map(|p| trim_quote_marks(p).encode_utf16().collect::<Vec<u16>>())
        .filter(|f| f.len() >= 3)
        .collect()
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
    let (norm, map) = normalize_with_map(source);
    let mut cursor = 0;
    let mut first: Option<usize> = None;
    let mut last_end = 0;
    for f in &frags {
        let at = index_of(&norm, f, cursor)?;
        if first.is_none() {
            first = Some(at);
        }
        last_end = at + f.len();
        cursor = last_end;
    }
    let first = first.expect("at least one fragment matched");
    Some(Span {
        start: map.get(first).copied(),
        end: map.get(last_end - 1).map(|v| v + 1),
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
