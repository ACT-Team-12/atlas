//! Prints the Rust `run_checker_test` report on web/src/data/eval/papers.json as JSON shaped like the TS
//! `CheckerReport`, so the parity script can deep-compare it with the TS `runCheckerTest()`.

use atlas_verify::{run_checker_test, Paper};
use serde_json::{json, Map, Value};
use std::path::PathBuf;

fn main() {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web/src/data/eval/papers.json");
    let raw = std::fs::read_to_string(&path).expect("read papers.json");
    let v: Value = serde_json::from_str(&raw).expect("papers.json is JSON");
    let papers: Vec<Paper> = v["papers"]
        .as_array()
        .expect("papers array")
        .iter()
        .map(|p| Paper {
            id: p["id"].as_str().expect("id").to_string(),
            text: p["text"].as_str().expect("text").to_string(),
            expected: p["expected"]
                .as_array()
                .expect("expected")
                .iter()
                .map(|s| s.as_str().expect("str").to_string())
                .collect(),
        })
        .collect();
    let r = run_checker_test(&papers);
    let mut by_kind = Map::new();
    for (k, c) in &r.by_kind {
        by_kind.insert(k.clone(), json!({ "total": c.total, "caught": c.caught }));
    }
    let out = json!({
        "papers": r.papers,
        "real": { "total": r.real_total, "accepted": r.real_accepted, "misses": r.real_misses },
        "fakes": {
            "total": r.fakes_total,
            "caught": r.fakes_caught,
            "slipped": r.fakes_slipped.iter().map(|s| json!({ "paper": s.paper, "kind": s.kind, "text": s.text })).collect::<Vec<_>>(),
            "byKind": by_kind,
        },
        "skipped": r.skipped,
    });
    println!("{out}");
}
