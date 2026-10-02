#!/usr/bin/env bash
# Builds the WebAssembly package into pkg/: atlas_verify.wasm plus the hand-written loader.
# Needs only the wasm32-unknown-unknown target (rustup target add wasm32-unknown-unknown); no wasm-bindgen.
#
# The committed pkg/ must be reproducible from source: CI rebuilds it with the same pinned toolchain and fails on
# any byte difference. So this script refuses any other rustc unless ATLAS_ANY_RUSTC=1 (for local experiments).
set -euo pipefail
PINNED_RUSTC="1.99.0"
here="$(cd "$(dirname "$0")" && pwd)"
have="$(rustc --version | cut -d' ' -f2)"
if [ "$have" != "$PINNED_RUSTC" ] && [ "${ATLAS_ANY_RUSTC:-0}" != "1" ]; then
  echo "build-wasm.sh: rustc $have, but pkg/ is pinned to $PINNED_RUSTC (rust-ci.yml). Install it, or set ATLAS_ANY_RUSTC=1." >&2
  exit 1
fi
cargo build --release --lib --target wasm32-unknown-unknown -j "${CARGO_JOBS:-2}" --manifest-path "$here/Cargo.toml"
mkdir -p "$here/pkg"
cp "$here/target/wasm32-unknown-unknown/release/atlas_verify.wasm" "$here/pkg/atlas_verify.wasm"
cp "$here/js/atlas_verify.mjs" "$here/pkg/atlas_verify.mjs"
wc -c "$here/pkg/atlas_verify.wasm" "$here/pkg/atlas_verify.mjs"
