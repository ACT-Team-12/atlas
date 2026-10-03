#!/usr/bin/env bash
# Deploy one exact commit of ATLAS to Vercel from a clean export, and prove the live site serves it.
#
#   scripts/deploy-prod.sh            # production, current origin/main
#   scripts/deploy-prod.sh <sha>      # production, a commit that is on origin/main
#   scripts/deploy-prod.sh --preview  # preview deploy of the current HEAD (any branch)
#
# Why not plain `vercel deploy` from web/:
#   1. The CLI uploads only the folder it runs in, and web/ imports ../core (the Rust/WASM quote checker), so the
#      type check fails on Vercel. The project's Root Directory is `web`, and this script uploads web/ AND core/.
#   2. Vercel refuses a CLI deploy whose git commit author is not on our Vercel team ("Not authorized"), which is
#      every merge Akhil makes on GitHub. `git archive` exports the files without git metadata, so that check is
#      skipped, and ATLAS_COMMIT carries the commit to /api/health instead.
#
# Needs: the Vercel CLI logged in, and the project link at web/.vercel/project.json (run `vercel link` in web/ once).
set -euo pipefail

repo=$(git rev-parse --show-toplevel)
cd "$repo"

mode=prod
ref=""
case "${1:-}" in
  --preview) mode=preview ;;
  "") ;;
  *) ref=$1 ;;
esac

git fetch -q origin main
if [ "$mode" = prod ]; then
  sha=$(git rev-parse "${ref:-origin/main}^{commit}")
  if ! git merge-base --is-ancestor "$sha" origin/main; then
    echo "refusing: $sha is not on origin/main (use --preview for branches)" >&2
    exit 1
  fi
else
  sha=$(git rev-parse HEAD)
  if [ -n "$(git status --porcelain -- web core)" ]; then
    echo "note: uncommitted changes in web/ or core/ are NOT deployed; only commit $sha is" >&2
  fi
fi

link="$repo/web/.vercel/project.json"
if [ ! -s "$link" ]; then
  echo "missing $link: run 'vercel link --project atlas-team12' in web/ first" >&2
  exit 1
fi
if ! grep -q '"projectName":"atlas-team12"' "$link"; then
  echo "refusing: $link is not linked to atlas-team12" >&2
  exit 1
fi

out=$(mktemp -d "${TMPDIR:-/tmp}/atlas-deploy.XXXXXX")
trap 'rm -rf "$out"' EXIT
git archive "$sha" web core | tar -x -C "$out"
mkdir -p "$out/.vercel"
cp "$link" "$out/.vercel/project.json"

echo "deploying $sha ($mode) from a clean export"
args=(deploy --yes --env "ATLAS_COMMIT=$sha")
[ "$mode" = prod ] && args+=(--prod)
# Outside a terminal the CLI prints a JSON summary; keep the whole thing for the log and pull out the URL.
summary=$(cd "$out" && vercel "${args[@]}")
url=$(printf '%s' "$summary" | grep -o 'https://[a-z0-9-]*\.vercel\.app' | head -1 || true)
if [ -z "$url" ]; then
  printf '%s\n' "$summary" >&2
  echo "FAIL: no deployment URL in the Vercel output above" >&2
  exit 1
fi
echo "deployed: $url"
if [ "$mode" = preview ]; then
  echo "check it (previews sit behind Vercel login): (cd web && vercel curl /api/health --deployment $url)"
fi

if [ "$mode" = prod ]; then
  health=https://atlas-team12.vercel.app/api/health
  served=$(python3 -c 'import json,sys,urllib.request; print(json.load(urllib.request.urlopen(sys.argv[1], timeout=30))["commit"])' "$health")
  if [ "$served" != "$sha" ]; then
    echo "FAIL: $health reports commit '$served', expected $sha" >&2
    exit 1
  fi
  echo "ok: $health serves $sha"
fi
