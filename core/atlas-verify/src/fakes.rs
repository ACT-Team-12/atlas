//! Port of the pure planted-fake checker in `web/src/lib/checkerTest.ts`.
//!
//! The TS uses three regular expressions. They are matched here by hand, with the same JS semantics: `\b` and `\d`
//! are ASCII-only (no `u` flag), `/i` folds ASCII case only, `\s` is the JS whitespace set. Positions are byte
//! offsets into the UTF-8 string; every boundary these patterns can match sits next to an ASCII character, so slicing
//! there cuts the same characters JS slices by UTF-16 index.

use crate::{find_span, is_js_whitespace, normalize};
use std::collections::BTreeMap;

const SWAPS: [(&str, &str); 6] = [
    ("morning", "evening"),
    ("daily", "weekly"),
    ("days", "weeks"),
    ("week", "month"),
    ("once", "twice"),
    ("before", "after"),
];

/// The invented instructions planted into every paper.
pub const INVENTED: [&str; 4] = [
    "Take warfarin 5 mg by mouth every night",
    "Double your dose if you feel worse",
    "Stop all of your medicines before the lab",
    "Take 2 aspirin every 4 hours",
];

/// Units allowed after a dose or interval number. `units?` etc. are listed as both spellings.
const UNITS: [&str; 23] = [
    "mg", "mcg", "ml", "units", "unit", "tablets", "tablet", "capsules", "capsule", "puffs", "puff", "drops", "drop",
    "times", "time", "hours", "hour", "days", "day", "weeks", "week", "months", "month",
];
const UNITS_YEARS: [&str; 2] = ["years", "year"];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Fake {
    pub kind: &'static str,
    pub text: String,
}

fn is_word(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

/// JS `\b` at byte position `p` (non-ASCII bytes are never word characters).
fn boundary(s: &[u8], p: usize) -> bool {
    let before = p > 0 && is_word(s[p - 1]);
    let after = p < s.len() && is_word(s[p]);
    before != after
}

/// Greedy `\d+(?:\.\d+)?` from `p`: returns (end without fraction, end with fraction if there is one).
fn number_ends(s: &[u8], p: usize) -> Option<(usize, Option<usize>)> {
    let mut q = p;
    while q < s.len() && s[q].is_ascii_digit() {
        q += 1;
    }
    if q == p {
        return None;
    }
    let mut frac = None;
    if q + 1 < s.len() && s[q] == b'.' && s[q + 1].is_ascii_digit() {
        let mut r = q + 1;
        while r < s.len() && s[r].is_ascii_digit() {
            r += 1;
        }
        frac = Some(r);
    }
    Some((q, frac))
}

/// The lookahead `(?=\s*(?:mg|...|years?)\b)` at byte position `e`, case-insensitive.
fn unit_follows(text: &str, e: usize) -> bool {
    let rest = text[e..].trim_start_matches(is_js_whitespace);
    let r = rest.as_bytes();
    UNITS.iter().chain(UNITS_YEARS.iter()).any(|u| {
        r.len() >= u.len()
            && r[..u.len()].eq_ignore_ascii_case(u.as_bytes())
            && (r.len() == u.len() || !is_word(r[u.len()]))
    })
}

/// `DOSE_OR_INTERVAL.exec(real)`: a number followed by a unit. Returns the byte range of the number.
fn dose_or_interval(text: &str) -> Option<(usize, usize)> {
    let s = text.as_bytes();
    for p in 0..s.len() {
        if !boundary(s, p) {
            continue;
        }
        let Some((q, frac)) = number_ends(s, p) else { continue };
        // Backtracking order: with the fraction first, then without it.
        for end in frac.into_iter().chain(std::iter::once(q)) {
            if unit_follows(text, end) {
                return Some((p, end));
            }
        }
    }
    None
}

/// `STANDALONE_NUMBER.exec(real)`: `\b\d+(?:\.\d+)?\b`.
fn standalone_number(text: &str) -> Option<(usize, usize)> {
    let s = text.as_bytes();
    for p in 0..s.len() {
        if !boundary(s, p) {
            continue;
        }
        let Some((q, frac)) = number_ends(s, p) else { continue };
        for end in frac.into_iter().chain(std::iter::once(q)) {
            if boundary(s, end) {
                return Some((p, end));
            }
        }
    }
    None
}

/// `\bword\b` with `/i`: the first ASCII-case-insensitive whole-word match.
fn find_word(text: &str, word: &str) -> Option<usize> {
    let s = text.as_bytes();
    let w = word.as_bytes();
    if w.len() > s.len() {
        return None;
    }
    (0..=s.len() - w.len())
        .find(|&p| boundary(s, p) && s[p..p + w.len()].eq_ignore_ascii_case(w) && boundary(s, p + w.len()))
}

/// JS `Number.prototype.toString()` for the values `Number(x) * 10` can produce.
fn js_number_to_string(v: f64) -> String {
    if v.is_nan() {
        return "NaN".into();
    }
    if v.is_infinite() {
        return if v > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    if v == 0.0 {
        return "0".into();
    }
    let a = v.abs();
    if (1e-6..1e21).contains(&a) {
        // Rust's Display prints the shortest round-tripping digits without an exponent, as JS does in this range.
        format!("{v}")
    } else {
        // JS: shortest digits, then "e+N" / "e-N".
        let s = format!("{v:e}");
        match s.split_once('e') {
            Some((m, e)) if !e.starts_with('-') => format!("{m}e+{e}"),
            _ => s,
        }
    }
}

/// `fakesFor` from checkerTest.ts: the planted fakes built from one real instruction.
pub fn fakes_for(real: &str) -> Vec<Fake> {
    let mut out = Vec::new();
    if let Some((a, b)) = dose_or_interval(real).or_else(|| standalone_number(real)) {
        // `String(Number(num[0]) * 10)`; num[0] is ASCII digits with at most one '.', so it always parses.
        let n: f64 = real[a..b].parse().unwrap_or(f64::NAN);
        let changed = js_number_to_string(n * 10.0);
        out.push(Fake {
            kind: "changed number",
            text: format!("{}{}{}", &real[..a], changed, &real[b..]),
        });
    }
    for (a, b) in SWAPS {
        if let Some(p) = find_word(real, a) {
            out.push(Fake {
                kind: "swapped word",
                text: format!("{}{}{}", &real[..p], b, &real[p + a.len()..]),
            });
            break;
        }
    }
    // `real.charAt(0).toLowerCase() + real.slice(1)`: charAt(0) is one UTF-16 unit, so a character outside the BMP
    // is split into a lone surrogate that toLowerCase leaves alone, and the pair is rejoined unchanged.
    let mut chars = real.chars();
    let flipped = match chars.next() {
        None => String::new(),
        Some(c) if (c as u32) > 0xFFFF => real.to_string(),
        Some(c) => {
            let mut buf = [0u8; 4];
            format!("{}{}", c.encode_utf8(&mut buf).to_lowercase(), chars.as_str())
        }
    };
    out.push(Fake {
        kind: "flipped meaning",
        text: format!("Do not {flipped}"),
    });
    out
}

/// One sample paper, the fields `runCheckerTest` reads.
#[derive(Debug, Clone)]
pub struct Paper {
    pub id: String,
    pub text: String,
    pub expected: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct KindCount {
    pub total: usize,
    pub caught: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Slipped {
    pub paper: String,
    pub kind: String,
    pub text: String,
}

/// `CheckerReport` from checkerTest.ts.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CheckerReport {
    pub papers: usize,
    pub real_total: usize,
    pub real_accepted: usize,
    pub real_misses: Vec<String>,
    pub fakes_total: usize,
    pub fakes_caught: usize,
    pub fakes_slipped: Vec<Slipped>,
    pub by_kind: BTreeMap<String, KindCount>,
    pub skipped: usize,
}

/// `runCheckerTest` from checkerTest.ts, over papers passed in rather than imported.
pub fn run_checker_test(papers: &[Paper]) -> CheckerReport {
    let mut r = CheckerReport {
        papers: papers.len(),
        ..Default::default()
    };
    for p in papers {
        let norm = normalize(&p.text);
        let mut fakes: Vec<Fake> = Vec::new();
        for real in &p.expected {
            r.real_total += 1;
            if find_span(&p.text, real).is_some() {
                r.real_accepted += 1;
            } else {
                r.real_misses.push(format!("{}: {}", p.id, real));
            }
            fakes.extend(fakes_for(real));
        }
        fakes.extend(INVENTED.iter().map(|t| Fake {
            kind: "invented instruction",
            text: (*t).to_string(),
        }));
        for f in fakes {
            // A "fake" that happens to appear in the paper is not a fake; skip it rather than count it either way.
            if norm.contains(&normalize(&f.text)) {
                r.skipped += 1;
                continue;
            }
            let k = r.by_kind.entry(f.kind.to_string()).or_default();
            r.fakes_total += 1;
            k.total += 1;
            if find_span(&p.text, &f.text).is_none() {
                r.fakes_caught += 1;
                k.caught += 1;
            } else {
                r.fakes_slipped.push(Slipped {
                    paper: p.id.clone(),
                    kind: f.kind.to_string(),
                    text: f.text,
                });
            }
        }
    }
    r
}
