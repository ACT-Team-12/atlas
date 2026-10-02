//! Port of web/src/lib/verify.test.ts (the `findSpan` and `verifyItems` blocks; `dedupe` lives in extract.ts and is
//! not part of the checker).

mod common;

use atlas_verify::{find_span, normalize, verify_quotes, Span};

/// `SAMPLE_AVS.slice(start, end)` with UTF-16 offsets.
fn slice16(s: &str, span: Span) -> String {
    let units: Vec<u16> = s.encode_utf16().collect();
    String::from_utf16(&units[span.range()]).expect("valid slice")
}

#[test]
fn finds_an_exact_quote_and_returns_original_offsets() {
    let avs = common::sample_avs();
    let q = "Take 1 tablet by mouth 2 times a day with meals.";
    let span = find_span(&avs, q).expect("found");
    assert_eq!(slice16(&avs, span), q);
}

#[test]
fn tolerates_case_extra_whitespace_curly_quotes_and_line_breaks() {
    assert!(find_span(
        "Call the office if your\n  blood sugar is above 300",
        "call the office if your blood sugar is above 300"
    )
    .is_some());
    assert!(find_span("Patient\u{2019}s log", "patient's log").is_some());
}

#[test]
fn accepts_ellipsis_fragments_only_when_they_appear_in_order() {
    let avs = common::sample_avs();
    assert!(find_span(&avs, "Hemoglobin A1c ... due in 3 months").is_some());
    assert!(find_span(&avs, "due in 3 months ... Hemoglobin A1c").is_none());
}

#[test]
fn refuses_a_quote_whose_ellipsis_fragments_are_too_short_to_check() {
    assert!(find_span("Take a seat.", "Take ... 5 ... mg").is_none());
    assert!(find_span("Take 1 tablet by mouth daily.", "Take 1 tablet ... daily").is_some());
    // A leading or trailing ellipsis is only an empty fragment, which is dropped.
    assert!(find_span("Take 1 tablet by mouth daily.", "... Take 1 tablet ...").is_some());
}

#[test]
fn refuses_a_quote_that_is_not_in_the_document() {
    let avs = common::sample_avs();
    assert!(find_span(&avs, "Take aspirin 81 mg daily").is_none());
    assert!(find_span(&avs, "").is_none());
    assert!(find_span(&avs, "..").is_none());
}

#[test]
fn verify_items_splits_grounded_items_from_refused_ones() {
    let avs = common::sample_avs();
    let (kept, refused) = verify_quotes(
        &avs,
        &["metformin (GLUCOPHAGE) 500 mg tablet", "Increase insulin to 20 units"],
    );
    assert_eq!(kept.len(), 1);
    assert_eq!(kept[0].id, "item-0");
    assert!(kept[0].span.is_some());
    assert_eq!(refused.len(), 1);
    assert!(!refused[0].grounded);
    assert_eq!(refused[0].id, "item-1");
}

// Rust-only checks on the JS-compatibility rules the port depends on.

#[test]
fn unicode_version_is_the_pinned_one() {
    // Case mapping only matches JS toLowerCase when both use the same Unicode version. The pin is Rust 1.99.0 and
    // Node 22.23.2, both on Unicode 17.0 (rust-ci.yml); parity.sh also refuses to run on a skew. Moving either side
    // means moving both and updating this line.
    assert_eq!(char::UNICODE_VERSION, (17, 0, 0));
    // U+A7CE/U+A7CF became a case pair in Unicode 17.0; an older Unicode refuses this quote.
    assert!(find_span("Dose \u{A7CE} daily", "\u{A7CF} daily").is_some());
}

#[test]
fn normalize_matches_the_ts_rules() {
    assert_eq!(
        normalize("  A\u{00A0}\u{2014}B \u{2022} \u{201C}x\u{201D}\t"),
        "a -b \"x\""
    );
    // U+0085 is not JS whitespace; U+FEFF is.
    assert_eq!(normalize("a\u{0085}b"), "a\u{0085}b");
    assert_eq!(normalize("a\u{FEFF}b"), "a b");
    // Final sigma is folded to plain sigma, so a word and its letters normalize the same.
    assert_eq!(normalize("ΟΔΟΣ"), "οδοσ");
}

#[test]
fn offsets_are_utf16_code_units() {
    // The emoji is two UTF-16 units, so "dose" starts at 3, not 2 (chars) or 5 (bytes).
    let s = "\u{1F48A} dose 5 mg";
    let span = find_span(s, "dose 5 mg").expect("found");
    assert_eq!(span, Span { start: 3, end: 12 });
}

// Port of the Unicode tests in verify.test.ts.

fn span(s: usize, e: usize) -> Option<Span> {
    Some(Span { start: s, end: e })
}

#[test]
fn keeps_offsets_right_after_a_letter_that_lower_cases_to_two_units() {
    let src = "\u{0130}la\u{00E7} g\u{00FC}nde iki kez";
    assert_eq!(find_span(src, "g\u{00FC}nde iki kez"), span(5, 18));
    let early = "\u{0130} take 1 tablet daily with food";
    assert_eq!(
        slice16(early, find_span(early, "take 1 tablet").expect("found")),
        "take 1 tablet"
    );
    // Used to come back as { start: undefined, end: NaN } in the TS.
    assert_eq!(find_span("\u{0130}\u{0130}\u{0130} abc", "abc"), span(4, 7));
    assert_eq!(
        find_span("\u{0130}la\u{00E7} g\u{00FC}nde", "\u{0130}LA\u{00C7}"),
        span(0, 4)
    );
}

#[test]
fn matches_a_greek_word_ending_in_capital_sigma_on_both_sides() {
    let src = "\u{039F}\u{0394}\u{039F}\u{03A3} \u{039A}\u{0391}\u{0399}";
    assert_eq!(find_span(src, "\u{039F}\u{0394}\u{039F}\u{03A3}"), span(0, 4));
    assert_eq!(find_span(src, "\u{03BF}\u{03B4}\u{03BF}\u{03C2}"), span(0, 4));
}

#[test]
fn lower_cases_capital_letters_outside_the_bmp_in_the_source_too() {
    assert_eq!(
        find_span("\u{10400}\u{10401} dose", "\u{10400}\u{10401} dose"),
        span(0, 9)
    );
    assert_eq!(
        find_span("\u{10400}\u{10401} dose", "\u{10428}\u{10429} dose"),
        span(0, 9)
    );
}

#[test]
fn never_starts_or_ends_a_match_inside_one_characters_case_expansion() {
    // U+0130 lower-cases to "i" + U+0307: no match may begin at the U+0307 half or end at the "i" half.
    assert_eq!(find_span("Dose \u{0130} 5 mg", "\u{0307} 5 mg"), None);
    assert_eq!(find_span("\u{0130}la\u{00E7}", "\u{0307}la\u{00E7}"), None);
    assert_eq!(find_span("Dose \u{0130} 5 mg", "Dose i"), None);
    assert_eq!(find_span("Dose \u{0130} 5 mg", "dose \u{0130} 5 mg"), span(0, 11));
    assert_eq!(find_span("Dose \u{0130} 5 mg", "\u{0130} 5 mg"), span(5, 11));
}

#[test]
fn keeps_searching_past_an_unaligned_occurrence_to_a_later_aligned_one() {
    let src = "\u{0130} 5 mg, then \u{0307} 5 mg";
    assert_eq!(find_span(src, "\u{0307} 5 mg"), span(13, 19));
}

/// The fragment a single-fragment quote must match, by the checker's own rules.
fn fragment_of(q: &str) -> String {
    normalize(q)
        .trim_matches(|c: char| c == '"' || c == '\'' || c == ' ')
        .to_string()
}

#[test]
fn oracle_every_highlighted_slice_normalizes_to_the_fragment_it_matched() {
    let mut cases: Vec<(String, String)> = Vec::new();
    for (p, distractors) in common::papers() {
        for e in p.expected.iter().chain(distractors.iter()) {
            cases.push((p.text.clone(), e.clone()));
        }
        for e in &p.expected {
            for f in atlas_verify::fakes_for(e) {
                cases.push((p.text.clone(), f.text));
            }
        }
    }
    for src in [
        "\u{0130}la\u{00E7} g\u{00FC}nde \u{0130}ki kez \u{039F}\u{0394}\u{039F}\u{03A3} \u{10400}\u{10401} \u{1F48A} dose 5 mg",
        "Dose \u{0130} 5 mg, then \u{0307} 5 mg",
    ] {
        let cps: Vec<char> = src.chars().collect();
        for a in 0..cps.len() {
            for b in a + 1..=cps.len() {
                let q: String = cps[a..b].iter().collect();
                cases.push((src.to_string(), q.to_uppercase()));
                cases.push((src.to_string(), q));
            }
        }
    }
    let mut found = 0;
    let mut bad = Vec::new();
    for (src, q) in &cases {
        if q.contains("...") || q.contains('\u{2026}') {
            continue;
        }
        if let Some(s) = find_span(src, q) {
            found += 1;
            let slice = slice16(src, s);
            if normalize(&slice) != fragment_of(q) {
                bad.push((q.clone(), slice));
            }
        }
    }
    assert!(found > 500, "found {found}");
    assert!(bad.is_empty(), "{bad:?}");
}
