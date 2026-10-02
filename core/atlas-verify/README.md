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

Known input class the two cannot be compared on: a JS string with a lone surrogate. Rust `&str` cannot hold one and
`TextEncoder` turns it into U+FFFD at the WebAssembly boundary. The parity corpus does not include them.

## Run it

Needs Rust **1.99.0** with `rustup target add wasm32-unknown-unknown` (`build-wasm.sh` refuses another rustc so the
committed `pkg/` stays reproducible; `ATLAS_ANY_RUSTC=1` overrides it for experiments), and Node 22.23.2 or any Node
whose `process.versions.unicode` is 17.0 (`parity.sh` checks).
No `pnpm install` is needed: the parity script imports the web app's TypeScript directly through small Node hooks.

```sh
cd core/atlas-verify
cargo test                 # unit tests (19), reading the web app's own fixtures
./build-wasm.sh            # builds pkg/atlas_verify.wasm
./parity.sh                # TS vs WebAssembly on the full corpus, writes parity.json, exits 1 on any mismatch
node js/demo.mjs           # loads the package in Node and checks one real quote and one planted fake
```

## Measured numbers (this branch)

From `parity.json`, produced by `./parity.sh` on Node 22.23.2 and Rust 1.99.0:

| | |
|---|---|
| `findSpan` cases compared | 1,204 (853 found, 351 refused) |
| Corpus | the 10 quotes in `verify.test.ts`, every line of both sample papers (against itself and the other), the 6 eval papers' answer keys on the original and on two harder copies (a prefix of `İ`, an emoji and Amharic; every space as a no-break space), distractors, all 77 TS-generated planted fakes, 4 invented instructions, cross-paper quotes, 179 lab-report quotes, 71 hand-written adversarial cases, 600 seeded fuzz cases (seed 20261002) |
| `normalize` compared | 1,083 distinct strings |
| `fakesFor` compared | 1,083 distinct strings, plus 3,012 seeded high-precision decimals as `take <x> mg` |
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
