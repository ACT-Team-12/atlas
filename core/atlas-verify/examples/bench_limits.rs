//! Non-gating benchmark: prints how long the checker takes at the request limits (20,000-character source,
//! 600-character quotes, 40 items) on adversarial input. Tests assert step counts, not time; this is where absolute
//! latency is looked at.
//!
//!   cargo run --release --example bench_limits

use atlas_verify::{find_span, find_spans};
use std::time::Instant;

fn main() {
    let source = format!("{} \u{0307}{}", "\u{0130}".repeat(20000), "\u{0130}".repeat(299));
    let quotes: Vec<String> = (0..40)
        .map(|i| {
            if i % 2 == 1 {
                "\u{0307}i".repeat(300)
            } else {
                format!("{}\u{0307}", "\u{0307}i".repeat(299))
            }
        })
        .collect();
    let refs: Vec<&str> = quotes.iter().map(String::as_str).collect();
    for _ in 0..3 {
        let t = Instant::now();
        let batch = find_spans(&source, &refs);
        let batch_ms = t.elapsed().as_secs_f64() * 1e3;
        let t = Instant::now();
        let single: Vec<_> = refs.iter().map(|q| find_span(&source, q)).collect();
        let single_ms = t.elapsed().as_secs_f64() * 1e3;
        assert_eq!(batch, single);
        println!("40 items: find_spans {batch_ms:.1} ms, 40 x find_span {single_ms:.1} ms");
    }
}
