//! Port of web/src/lib/verify.test.ts (the `findSpan` and `verifyItems` blocks; `dedupe` lives in extract.ts and is
//! not part of the checker).

mod common;

use atlas_verify::{find_span, normalize, verify_quotes, Span};

/// `SAMPLE_AVS.slice(start, end)` with UTF-16 offsets.
fn slice16(s: &str, span: Span) -> String {
    let units: Vec<u16> = s.encode_utf16().collect();
    let r = span.range().expect("usable offsets");
    String::from_utf16(&units[r]).expect("valid slice")
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
    // Final sigma applies to the whole quote, as String.prototype.toLowerCase does.
    assert_eq!(normalize("ΟΔΟΣ"), "οδος");
}

#[test]
fn offsets_are_utf16_code_units() {
    // The emoji is two UTF-16 units, so "dose" starts at 3, not 2 (chars) or 5 (bytes).
    let s = "\u{1F48A} dose 5 mg";
    let span = find_span(s, "dose 5 mg").expect("found");
    assert_eq!(
        span,
        Span {
            start: Some(3),
            end: Some(12)
        }
    );
}

#[test]
fn capital_i_with_dot_reproduces_the_ts_map_shift() {
    // "İ" lower-cases to two units but gets one map entry in the TS, so offsets after it shift by one and a match
    // that ends at the very end reads past the map. JS returns { start: 2, end: NaN } here (the true start is 1); we mirror it.
    let span = find_span("\u{0130}abc", "abc").expect("found");
    assert_eq!(
        span,
        Span {
            start: Some(2),
            end: None
        }
    );
}
