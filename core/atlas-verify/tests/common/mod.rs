#![allow(dead_code)]
//! Fixtures read straight from the web app, so the Rust tests run on the same text as the TS tests.

use atlas_verify::Paper;
use std::path::PathBuf;

pub fn web(rel: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web").join(rel)
}

/// `SAMPLE_AVS` from web/src/lib/sample.ts (a template literal with no `${}` or escapes, checked here).
pub fn sample_avs() -> String {
    let src = std::fs::read_to_string(web("src/lib/sample.ts")).expect("read sample.ts");
    let start = src.find("SAMPLE_AVS = `").expect("SAMPLE_AVS in sample.ts") + "SAMPLE_AVS = `".len();
    let len = src[start..].find('`').expect("closing backtick");
    let text = &src[start..start + len];
    assert!(
        !text.contains("${") && !text.contains('\\'),
        "sample.ts template needs real parsing now"
    );
    text.to_string()
}

/// The six eval papers from web/src/data/eval/papers.json.
pub fn papers() -> Vec<(Paper, Vec<String>)> {
    let raw = std::fs::read_to_string(web("src/data/eval/papers.json")).expect("read papers.json");
    let v: serde_json::Value = serde_json::from_str(&raw).expect("papers.json is JSON");
    let strings = |x: &serde_json::Value| -> Vec<String> {
        x.as_array()
            .expect("array")
            .iter()
            .map(|s| s.as_str().expect("string").to_string())
            .collect()
    };
    v["papers"]
        .as_array()
        .expect("papers array")
        .iter()
        .map(|p| {
            (
                Paper {
                    id: p["id"].as_str().expect("id").to_string(),
                    text: p["text"].as_str().expect("text").to_string(),
                    expected: strings(&p["expected"]),
                },
                strings(&p["distractors"]),
            )
        })
        .collect()
}
