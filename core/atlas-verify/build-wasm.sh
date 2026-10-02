#!/usr/bin/env bash
# Builds the WebAssembly package into pkg/: atlas_verify.wasm plus the hand-written loader.
# Needs only the wasm32-unknown-unknown target (rustup target add wasm32-unknown-unknown); no wasm-bindgen.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cargo build --release --lib --target wasm32-unknown-unknown -j "${CARGO_JOBS:-2}" --manifest-path "$here/Cargo.toml"
mkdir -p "$here/pkg"
cp "$here/target/wasm32-unknown-unknown/release/atlas_verify.wasm" "$here/pkg/atlas_verify.wasm"
cp "$here/js/atlas_verify.mjs" "$here/pkg/atlas_verify.mjs"
wc -c "$here/pkg/atlas_verify.wasm" "$here/pkg/atlas_verify.mjs"
