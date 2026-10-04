#!/usr/bin/env bash
# Tests scripts/deploy-prod.sh against a fake `vercel` in a throwaway repo. Never deploys anything.
#   bash scripts/deploy-prod.test.sh
set -uo pipefail

script="$(cd "$(dirname "$0")" && pwd)/deploy-prod.sh"
tmp=$(mktemp -d "${TMPDIR:-/tmp}/deploy-prod-test.XXXXXX")
trap 'rm -rf "$tmp"' EXIT
fails=0
check() { if [ "$1" = ok ]; then echo "ok: $2"; else echo "FAIL: $2"; fails=$((fails + 1)); fi; }

# A throwaway origin and clone with web/ and core/, linked to atlas-team12.
git init -q --bare "$tmp/origin.git"
git init -q -b main "$tmp/repo"
cd "$tmp/repo"
git config user.email test@example.com
git config user.name test
mkdir -p web/.vercel core
echo hi > web/a.txt
echo hi > core/b.txt
git add web/a.txt core/b.txt
git commit -q -m init
git remote add origin "$tmp/origin.git"
git push -q origin main
printf '{"projectName":"atlas-team12"}' > web/.vercel/project.json

# 1. vercel fails: the CLI's error, a FAIL line naming its exit code, and a non-zero exit.
mkdir -p "$tmp/bin-fail"
cat > "$tmp/bin-fail/vercel" <<'FAKE'
#!/usr/bin/env bash
echo "Error: fake CLI could not deploy" >&2
exit 3
FAKE
chmod +x "$tmp/bin-fail/vercel"
PATH="$tmp/bin-fail:$PATH" bash "$script" --preview >"$tmp/out1" 2>"$tmp/err1"
code=$?
[ "$code" -eq 3 ] && check ok "exits with vercel's code (3)" || check fail "exit code was $code, want 3"
grep -q "Error: fake CLI could not deploy" "$tmp/err1" && check ok "prints the CLI's error" || check fail "CLI error missing"
grep -q "FAIL: vercel deploy exited 3" "$tmp/err1" && check ok "prints FAIL with the exit code" || check fail "FAIL line missing"
grep -q "deployed:" "$tmp/out1" && check fail "claimed a deploy" || check ok "does not claim a deploy"

# 2. vercel succeeds: the URL is reported and the script exits 0 (preview: no live health check).
mkdir -p "$tmp/bin-ok"
cat > "$tmp/bin-ok/vercel" <<'FAKE'
#!/usr/bin/env bash
echo "Uploading" >&2
echo '{"url":"https://atlas-team12-abc123.vercel.app"}'
FAKE
chmod +x "$tmp/bin-ok/vercel"
PATH="$tmp/bin-ok:$PATH" bash "$script" --preview >"$tmp/out2" 2>"$tmp/err2"
code=$?
[ "$code" -eq 0 ] && check ok "success exits 0" || check fail "success exit code was $code"
grep -q "deployed: https://atlas-team12-abc123.vercel.app" "$tmp/out2" && check ok "reports the URL" || check fail "URL missing"

# The checks above must have run: 6 lines of ok or FAIL.
echo "failures: $fails"
[ "$fails" -eq 0 ]
