# atlas-verify

ATLAS reads a patient's after-visit paper with AI, and then our own code checks that every step's quote is really
in the paper. That check is `findSpan` in `web/src/lib/verify.ts`. This crate is the same checker in Rust, so one
implementation can run on the server, in the browser (WebAssembly) and, next, inside the iOS and Android apps.

**Status:** parity proven, not wired in. The TypeScript checker is still the one production uses.

## What is in here

| Path | What it is |
|---|---|
| `src/lib.rs` | `normalize`, `find_span`, `verify_quotes`: a line-for-line port of `verify.ts` |
| `src/fakes.rs` | `fakes_for`, `run_checker_test`: the pure planted-fake checker from `checkerTest.ts` |
| `src/wasm.rs` | Plain C-ABI exports for `wasm32-unknown-unknown` (no wasm-bindgen, no imports) |
| `js/atlas_verify.mjs` | Hand-written loader for Node and the browser (about 75 lines) |
| `pkg/` | Built package: `atlas_verify.wasm` (about 109 KB) plus the loader. Committed; CI rebuilds it with the pinned toolchain and fails unless the bytes match |
| `tests/` | The TS unit tests ported 1:1, plus JS-compatibility checks |
| `parity/` | Parity test: the real TS files against the WebAssembly build |
| `parity.json` | The last parity result (deterministic, CI fails if it is stale) |

## Matching JavaScript exactly

The port copies JS behaviour, including the parts that look odd:

- Offsets are UTF-16 code units (JS string indices), not bytes or `char`s. An emoji counts as 2.
- Whitespace is the JS `\s` set: it includes U+FEFF and excludes U+0085, unlike Rust's `char::is_whitespace`.
- The source is normalized one code point at a time (as `normalizeWithMap` does) while the quote is lower-cased
  as a whole string. Rust's `to_lowercase` and V8's `toLowerCase` both apply full Unicode mapping and the
  Final_Sigma rule. They only agree when they use the same Unicode version, because each new version adds case
  pairs: U+A7CE/U+A7CF became one in 17.0, so `"Dose ꟎ daily"` vs `"꟏ daily"` is refused by Node 22.14 (Unicode
  16) and accepted by Rust 1.99 (Unicode 17). **Pinned:** Rust 1.99.0 and Node 22.23.2, both Unicode 17.0, in
  `rust-ci.yml`. `parity.sh` exits 1 before comparing anything if Node's `process.versions.unicode` differs from the
  WebAssembly build's (`atlas_unicode_version`), and a Rust test asserts `char::UNICODE_VERSION == (17, 0, 0)`.
  This guarantee covers the two pinned runtimes only. Whatever Node the web app is deployed on, and whatever JS
  engine a browser has, carries its own Unicode version, so before the Rust build replaces the TS checker anywhere,
  pin that runtime too or do the comparison on the same side.
- The planted-fake regexes are matched by hand with JS rules (ASCII `\b` and `\d`, ASCII-only `/i`, regex
  backtracking), and `String(Number(x) * 10)` follows ECMAScript Number::toString, including its tie rule: when two
  shortest digit strings are equally close, JS takes the even one (`991294491764.48132665` times 10 prints
  `9912944917644.812`), where Rust's own `{}` rounds up (`...813`).

### TS checker bugs the parity test found, now fixed in both

1. **Wrong highlight offsets after U+0130 (capital I with dot, as in Turkish "İlaç").** It lower-cases to two
   UTF-16 units but the map had one entry per source unit, so every later offset was off by one, and a match at the
   very end came back as `{ start: undefined, end: NaN }`. Now every normalized unit records the [start, end) of the
   source character it came from. `"İ take 1 tablet daily with food"` / `"take 1 tablet"` gives `[2, 15]`.
2. **Greek capital words ending in sigma never matched.** The quote lower-cased to final `ς`, the letter-by-letter
   source to `σ`. `normalize` now folds `ς` to `σ` on both sides.
3. **Capital letters outside the Basic Multilingual Plane were not lower-cased in the source** (it was walked one
   UTF-16 unit at a time, so each surrogate was lower-cased alone). It is now walked one code point at a time.

None of these could make the checker accept a quote that is not in the paper. They refused or mis-highlighted
quotes that are.

4. **Matches could begin or end inside one character's case expansion** (found by review after fix 1). Every unit
   of `"İ"`'s two-unit expansion maps to the same source character, so `"Dose İ 5 mg"` accepted the quote
   `"̇ 5 mg"` (a quote that is not in the paper) and highlighted `"İ 5 mg"`, and `"Dose i"` was accepted as
   `"Dose İ"`. The mapper now records where each source character's output begins, and a fragment is accepted only
   when it starts and ends on such a boundary; the search continues past unaligned occurrences. An oracle test
   (TS and Rust) checks that every highlighted slice normalizes to exactly the fragment it matched.
5. **Fix 4's search was quadratic on adversarial input** (found by review of fix 4). Re-running the search from each
   unaligned occurrence re-compared the whole quote every time: a 20,000 `"İ"` source against a 600-unit
   `"̇i̇i…"` quote has an unaligned occurrence at every odd position, so 40 such items cost seconds. The search is now
   one Knuth-Morris-Pratt pass that enumerates every occurrence and returns the first aligned one (same answer,
   O(source + quote)). A source is mapped once per batch of quotes and held only by the caller for that batch
   (`mapSource` + `findSpanIn` in TS, `find_spans` in Rust; no module state keeps a paper). The browser uses the
   `atlas_find_spans` export, one call per care plan, so 40 items map the paper once. Tests count matcher steps (at
   most 2 per source and quote unit, about 4x the steps for 4x the input) instead of timing; absolute latency is in
   `cargo run --release --example bench_limits` and `web/scripts/bench-checker.mjs`. Parity checks `findSpans` on
   every case.

### The paper does not stay in WebAssembly memory

The browser keeps one instance for the page, so a freed block that still held the paper (or a quote, or their
normalized copies) would stay readable after the check and after "Clear it from this device". The wasm build installs
a global allocator that zeroes every block before freeing it (volatile writes; reallocation frees the old block the
same way), the JS loaders zero the input buffers they wrote before `atlas_free` and call `atlas_clear_out` once a
result is read, and Clear drops the cached instance. `web/src/lib/deviceChecker.test.ts` runs the real
`public/atlas_verify.wasm` on a 10 KB marker and scans linear memory for its raw UTF-8, normalized UTF-8 and UTF-16
forms after `findSpans`, after `findSpan` and after Clear: none may be found. The loaders free the source copy even
when copying the quotes fails (fault-injection tests make the second allocation, or its write, throw), and a Clear
while the checker is still loading makes that load reject instead of handing a fresh instance to the cleared screen.

Known input class the two cannot be compared on: a JS string with a lone surrogate. Rust `&str` cannot hold one and
`TextEncoder` turns it into U+FFFD at the WebAssembly boundary. The parity corpus does not include them.

## Run it

Needs Rust **1.99.0** with `rustup target add wasm32-unknown-unknown` (`build-wasm.sh` refuses another rustc so the
committed `pkg/` stays reproducible; `ATLAS_ANY_RUSTC=1` overrides it for experiments), and Node 22.23.2 or any Node
whose `process.versions.unicode` is 17.0 (`parity.sh` checks).
No `pnpm install` is needed: the parity script imports the web app's TypeScript directly through small Node hooks.

```sh
cd core/atlas-verify
cargo test                 # unit tests (22), reading the web app's own fixtures
./build-wasm.sh            # builds pkg/atlas_verify.wasm
./parity.sh                # TS vs WebAssembly on the full corpus, writes parity.json, exits 1 on any mismatch
node js/demo.mjs           # loads the package in Node and checks one real quote and one planted fake
```

## Measured numbers (this branch)

From `parity.json`, produced by `./parity.sh` on Node 22.23.2 and Rust 1.99.0:

| | |
|---|---|
| `findSpan` cases compared | 1,209 (855 found, 354 refused) |
| Corpus | the 10 quotes in `verify.test.ts`, every line of both sample papers (against itself and the other), the 6 eval papers' answer keys on the original and on two harder copies (a prefix of `İ`, an emoji and Amharic; every space as a no-break space), distractors, all 77 TS-generated planted fakes, 4 invented instructions, cross-paper quotes, 179 lab-report quotes, 76 hand-written adversarial cases, 600 seeded fuzz cases (seed 20261002) |
| `normalize` compared | 1,090 distinct strings |
| `fakesFor` compared | 1,090 distinct strings, plus 3,012 seeded high-precision decimals as `take <x> mg` |
| Mismatches | **0** |
| Full checker report (`runCheckerTest`) | identical: 6 papers, 38 of 38 real instructions accepted, 101 of 101 planted fakes caught, 0 slipped |
| Cases with a non-numeric offset | 0 (was 2 before the U+0130 fix) |

The comparison is not vacuous: removing the U+2212 minus-sign fold from the Rust build made the parity script
report 4 mismatches and exit 1. The number differential failed the previous (round-half-up) formatter on 7 of
3,012 inputs. Faking Node's Unicode version as 16.0 makes `parity.sh` exit 1 before comparing.

An ellipsis fix landed in both checkers after the first port: a quote like `"Take ... 5 ... mg"` used to ground on
`"Take a seat."` because fragments under 3 characters were dropped silently. Now only empty fragments are dropped
and any other fragment under 3 characters refuses the quote. That moved 14 fuzz cases from found to refused.

## Next step: the phone apps (not done)

The plan is [UniFFI](https://mozilla.github.io/uniffi-rs/): add a thin `uniffi` wrapper exposing `find_span` and
`normalize`, build static libraries for `aarch64-apple-ios` / `aarch64-apple-ios-sim` (an XCFramework for the iOS
app) and for the Android ABIs via `cargo-ndk` (a `.so` per ABI plus generated Kotlin bindings), so each app can
re-run the same quote check on the device. Today neither app has its own port of `findSpan` (there is none under
`mobile/`). The crate has no dependencies and no I/O, which keeps that wrapper small. None of
this is built yet.
