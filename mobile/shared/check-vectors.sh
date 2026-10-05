#!/usr/bin/env bash
# Regenerates mobile/shared/safety-vectors.json and mobile/shared/missed-lines-vectors.json from the current web reference
# (web/src/lib/warningPin.ts and stepsView.ts; web/src/lib/missedLines.ts) and fails when either differs from the
# committed file, so the phone apps' replay tests can never pass against a stale copy of the website's answer.
#
# Needs the web dependencies installed (pnpm install in web/). Run from anywhere.
#
# For the missed-lines file: the web reference (missedLinesPayload) arrives with PR 66. On a branch that does not have it
# yet, the check cannot run: it FAILS when ENFORCE=true (CI sets this on main and on pull requests
# into main) and otherwise prints a warning and exits 0, so the Android branch can be reviewed
# before PR 66 lands. Once both are on main it always runs.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
web="$root/web"
committed="$root/mobile/shared/missed-lines-vectors.json"

# Safety vectors (warning pins, by-when groups, stop-now; mobile/shared/safety-vectors.json). Their web reference is on
# every branch that has them, so this check always runs and is never only a warning.
safety_gen="$web/src/lib/genSafetyVectors.test.ts"
safety_out="$(mktemp "${TMPDIR:-/tmp}/safety-vectors.XXXXXX")"
cp "$root/mobile/shared/genSafetyVectors.test.ts" "$safety_gen"
(cd "$web" && VECTORS_OUT="$safety_out" pnpm exec vitest run src/lib/genSafetyVectors.test.ts) || { rm -f "$safety_gen" "$safety_out"; exit 1; }
rm -f "$safety_gen"
if [ ! -s "$safety_out" ]; then
  echo "::error::the safety generator wrote no vectors"
  rm -f "$safety_out"
  exit 1
fi
if ! cmp -s "$safety_out" "$root/mobile/shared/safety-vectors.json"; then
  echo "::error::mobile/shared/safety-vectors.json is out of date with the web rules (warningPin.ts, stepsView.ts). Regenerate it (mobile/shared/README.md) and commit the result."
  rm -f "$safety_out"
  exit 1
fi
echo "safety vectors match the web reference ($(wc -c < "$safety_out") bytes)"
rm -f "$safety_out"

# Medicine-changes vectors (the "Your medicine changes" card: which row each medicine line goes in, and when an old and
# new dose may be shown; mobile/shared/medicine-changes-vectors.json). Hand-written cases with the expected answer; the
# web suite replays them against web/src/lib/medicineChanges.ts, so the web answer and the committed file can't drift.
med_vectors="$root/mobile/shared/medicine-changes-vectors.json"
if [ ! -s "$med_vectors" ]; then
  echo "::error::mobile/shared/medicine-changes-vectors.json is missing or empty"
  exit 1
fi
(cd "$web" && pnpm exec vitest run src/lib/medicineChanges.vectors.test.ts) || { echo "::error::the web classifier (medicineChanges.ts) disagrees with mobile/shared/medicine-changes-vectors.json"; exit 1; }
echo "medicine-changes vectors match the web reference ($(wc -c < "$med_vectors") bytes)"

# Pip vectors (where the "you are here" marker goes and what he says; mobile/shared/pip-vectors.json). The web reference,
# web/src/lib/pip.ts, arrives with PR 82. Without it the check cannot run: it FAILS when ENFORCE=true (main and pull
# requests into main) and otherwise warns, so the phone port can be reviewed before PR 82 lands.
if [ -f "$web/src/lib/pip.ts" ]; then
  pip_gen="$web/src/lib/genPipVectors.test.ts"
  pip_out="$(mktemp "${TMPDIR:-/tmp}/pip-vectors.XXXXXX")"
  cp "$root/mobile/shared/genPipVectors.test.ts" "$pip_gen"
  (cd "$web" && VECTORS_OUT="$pip_out" pnpm exec vitest run src/lib/genPipVectors.test.ts) || { rm -f "$pip_gen" "$pip_out"; exit 1; }
  rm -f "$pip_gen"
  if [ ! -s "$pip_out" ]; then
    echo "::error::the Pip generator wrote no vectors"
    rm -f "$pip_out"
    exit 1
  fi
  if ! cmp -s "$pip_out" "$root/mobile/shared/pip-vectors.json"; then
    echo "::error::mobile/shared/pip-vectors.json is out of date with web/src/lib/pip.ts. Regenerate it (mobile/shared/README.md) and commit the result."
    rm -f "$pip_out"
    exit 1
  fi
  echo "pip vectors match the web reference ($(wc -c < "$pip_out") bytes)"
  rm -f "$pip_out"
else
  msg="web/src/lib/pip.ts is not on this branch (PR 82), so the Pip vectors cannot be regenerated here."
  if [ "${ENFORCE:-true}" = "true" ]; then
    echo "::error::$msg"
    exit 1
  fi
  echo "::warning::$msg Not enforced on this branch; enforced on main and on pull requests into main."
fi

if ! grep -q "export function missedLinesPayload" "$web/src/lib/missedLines.ts"; then
  msg="web/src/lib/missedLines.ts has no missedLinesPayload (PR 66), so the missed-lines vectors cannot be regenerated here."
  if [ "${ENFORCE:-true}" = "true" ]; then
    echo "::error::$msg"
    exit 1
  fi
  echo "::warning::$msg Not enforced on this branch; enforced on main and on pull requests into main."
  exit 0
fi

gen="$web/src/lib/genMissedLinesVectors.test.ts"
out="$(mktemp "${TMPDIR:-/tmp}/missed-lines-vectors.XXXXXX")"
cp "$root/mobile/shared/genMissedLinesVectors.test.ts" "$gen"
trap 'rm -f "$gen" "$out"' EXIT

(cd "$web" && VECTORS_OUT="$out" pnpm exec vitest run src/lib/genMissedLinesVectors.test.ts)

# A generator that wrote nothing must not read as "no drift".
if [ ! -s "$out" ]; then
  echo "::error::the generator wrote no vectors"
  exit 1
fi

if ! cmp -s "$out" "$committed"; then
  echo "::error::mobile/shared/missed-lines-vectors.json is out of date with web/src/lib/missedLines.ts. Regenerate it (mobile/shared/README.md) and commit the result."
  exit 1
fi
echo "missed-lines vectors match the web reference ($(wc -c < "$out") bytes)"
