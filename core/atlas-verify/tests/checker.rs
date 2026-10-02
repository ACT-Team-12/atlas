//! Port of web/src/lib/checkerTest.test.ts.

mod common;

use atlas_verify::{fakes_for, find_span, run_checker_test, Paper};

#[test]
fn every_expected_instruction_and_distractor_really_appears_in_its_paper() {
    for (p, distractors) in common::papers() {
        for e in &p.expected {
            assert!(find_span(&p.text, e).is_some(), "{}: {}", p.id, e);
        }
        for d in &distractors {
            assert!(find_span(&p.text, d).is_some(), "{}: {}", p.id, d);
        }
    }
}

#[test]
fn accepts_every_real_instruction_and_catches_every_planted_fake() {
    let papers: Vec<Paper> = common::papers().into_iter().map(|(p, _)| p).collect();
    let r = run_checker_test(&papers);
    assert_eq!(r.papers, 6);
    assert_eq!(r.real_accepted, r.real_total);
    assert!(r.fakes_total > 50);
    assert!(r.fakes_slipped.is_empty(), "{:?}", r.fakes_slipped);
    assert_eq!(r.fakes_caught, r.fakes_total);
}

fn changed(real: &str) -> Option<String> {
    fakes_for(real)
        .into_iter()
        .find(|f| f.kind == "changed number")
        .map(|f| f.text)
}

#[test]
fn changes_the_dose_or_interval_never_a_digit_inside_a_word() {
    assert_eq!(
        changed("Hemoglobin A1c - due in 3 months").as_deref(),
        Some("Hemoglobin A1c - due in 30 months")
    );
    assert_eq!(
        changed("START metformin 500 mg tablet.").as_deref(),
        Some("START metformin 5000 mg tablet.")
    );
    assert_eq!(
        changed("Take 1 tablet by mouth 2 times a day with meals.").as_deref(),
        Some("Take 10 tablet by mouth 2 times a day with meals.")
    );
}

#[test]
fn falls_back_to_a_standalone_number_and_makes_no_number_fake_when_there_is_none() {
    assert_eq!(
        changed("Call the office if your blood sugar is above 300").as_deref(),
        Some("Call the office if your blood sugar is above 3000")
    );
    assert_eq!(changed("Hemoglobin A1c today"), None);
}

// Rust-only: JS number formatting and regex-backtracking edge cases the hand matcher must reproduce.

#[test]
fn number_formatting_follows_js() {
    // Values checked against Node 22: String(Number("1.005") * 10) and String(Number("0.07") * 10).
    assert_eq!(changed("take 1.005 mg").as_deref(), Some("take 10.049999999999999 mg"));
    assert_eq!(changed("take 0.07 mg").as_deref(), Some("take 0.7000000000000001 mg"));
    assert_eq!(changed("take 0.5 mg").as_deref(), Some("take 5 mg"));
    assert_eq!(changed("take 007 mg").as_deref(), Some("take 70 mg"));
    assert_eq!(changed("code 100000000000000000000000").as_deref(), Some("code 1e+24"));
}

#[test]
fn standalone_number_backtracks_out_of_the_fraction() {
    // `\b\d+(?:\.\d+)?\b` on "1.5a": the fraction cannot end at a boundary, so JS matches "1".
    assert_eq!(changed("x 1.5a").as_deref(), Some("x 10.5a"));
}
