#!/usr/bin/env bash
# Runs the TS vs Rust (WebAssembly) parity test. Extra arguments go to parity/parity.mjs (e.g. --wasm <path>).
# NODE overrides the node binary (Node 22+, for --experimental-strip-types).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here"
exec "${NODE:-node}" --experimental-strip-types --no-warnings --import ./parity/register.mjs parity/parity.mjs "$@"
