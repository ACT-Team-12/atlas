#!/usr/bin/env python3
"""Capture real responses from the live ATLAS API as test fixtures.

Run from the repo root:  python3 mobile/ios/scripts/capture_fixtures.py
Uses the labeled sample paper from web/src/lib/sample.ts (written by Team ATLAS,
not a real patient). Saves exactly what the server returned, byte for byte.
"""
import json
import os
import re
import time
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
BASE = "https://atlas-team12.vercel.app"
OUT = os.path.join(ROOT, "mobile", "ios", "ATLASTests", "Fixtures")


def sample_text() -> str:
    src = open(os.path.join(ROOT, "web", "src", "lib", "sample.ts"), encoding="utf-8").read()
    return re.search(r"SAMPLE_AVS = `(.*?)`;", src, re.S).group(1)


def post(path: str, body: dict) -> bytes:
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    t = time.time()
    with urllib.request.urlopen(req, timeout=90) as r:
        raw = r.read()
        print(path, r.status, len(raw), "bytes", round(time.time() - t, 1), "s")
    return raw


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    raw = post("/api/extract", {"text": sample_text(), "reading_level": "simple", "language": "English"})
    open(os.path.join(OUT, "extract_sample_live.json"), "wb").write(raw)
    care = json.loads(raw)
    print("items", len(care["items"]), "refused", len(care["refused"]), care["stats"])

    body = {
        "care": [{k: i[k] for k in ("id", "kind", "title", "plain_language", "when", "source_quote")} for i in care["items"]],
        "barriers": ["transport", "cost"],
        "zip": "30303",
        "language": "English",
        "note": "",
    }
    raw2 = post("/api/plan", body)
    open(os.path.join(OUT, "plan_sample_30303_live.json"), "wb").write(raw2)
    p = json.loads(raw2)
    print("steps", len(p["steps"]), "resources", len(p["resources"]), p["located"], p["stats"])


if __name__ == "__main__":
    main()
