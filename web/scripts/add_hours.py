"""Add listed opening hours to each clinic in src/data/resources.json.

Run after build_resources.py (which rebuilds the file and drops these fields):
    python3 scripts/add_hours.py

Input: data-raw/gmaps-hours-2026-10-02.json, a snapshot of Google Maps listings
(Apify compass/crawler-google-places, one search per clinic: "<HRSA name>, <HRSA address>").

A listing is used only when it is clearly the same clinic:
  1. its address starts with the same street number as the HRSA record, and
  2. its title names the same health center (MedCura, Mercy Care, Southside, ...), and
  3. it is not another business at that address (a school, a shelter, a partner org), and
  4. its hours are real hours (not "Open 24 hours", which no clinic here is).
Everything else keeps hours = null and the app says "hours not listed".
Hours are shown as LISTED hours with the source and date, never as verified.
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "src" / "data" / "resources.json"
RAW = ROOT / "data-raw" / "gmaps-hours-2026-10-02.json"
SOURCE_ID = "gmaps-hours"

IDENTITY = ["medcura", "mercy care", "southside medical", "ethne", "ethnē", "healing community", "recovery consultants",
            "family health center", "georgia center for women", "yourtown", "whitefoord health"]
NOT_A_CLINIC = re.compile(r"school|academy|elementary|salvation army|chris 180|avitacare|whitefoord, inc", re.I)
DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def to_24h(t: str) -> str:
    m = re.fullmatch(r"(\d{1,2})(?::(\d{2}))?\s*([AP])M", t.strip(), re.I)
    if not m:
        raise ValueError(f"unparsed time: {t!r}")
    h, mins, ap = int(m.group(1)), int(m.group(2) or 0), m.group(3).upper()
    h = h % 12 + (12 if ap == "P" else 0)
    return f"{h:02d}:{mins:02d}"


def parse_hours(rows: list[dict]) -> list[dict] | None:
    """[{day:'Monday', hours:'8 AM to 5 PM'}] -> [{day:0..6, open:'08:00', close:'17:00'}]; None if unusable."""
    if not rows or len(rows) != 7:
        return None
    out = []
    for r in rows:
        h = r["hours"].replace(" ", " ").replace("–", "to").strip()
        if re.search(r"24 hours", h, re.I):
            return None
        if h.lower() == "closed":
            continue
        for part in h.split(","):
            a, b = [x.strip() for x in part.split(" to ")]
            # "8 to 11 AM" style: borrow the meridiem from the end time
            if not re.search(r"[AP]M", a, re.I):
                a += " " + re.search(r"([AP]M)", b, re.I).group(1)
            out.append({"day": DAYS.index(r["day"]), "open": to_24h(a), "close": to_24h(b)})
    return out


def same_clinic(clinic: dict, item: dict) -> bool:
    num = clinic["address"].split()[0]
    if not (item.get("address") or "").startswith(num + " "):
        return False
    title = (item.get("title") or "").lower()
    if NOT_A_CLINIC.search(title):
        return False
    return any(k in title for k in IDENTITY)


def main() -> None:
    data = json.loads(DATA.read_text())
    raw = json.loads(RAW.read_text())
    by_search = {i["searchString"]: i for i in raw["items"]}
    used = 0
    for c in data["clinics"]:
        item = by_search.get(f"{c['name']}, {c['address']}, {c['city']}, GA {c['zip']}")
        hours = parse_hours(item.get("openingHours") or []) if item and same_clinic(c, item) else None
        c["hours"] = hours
        c["hours_source_id"] = SOURCE_ID if hours else None
        used += hours is not None
    data["sources"] = [s for s in data["sources"] if s["id"] != SOURCE_ID] + [{
        "id": SOURCE_ID,
        "name": "Google Maps listings (opening hours), matched to HRSA sites",
        "url": "https://www.google.com/maps",
        "retrieved": raw["retrieved"],
        "notes": f"{raw['source']}. Used for {used} of {len(data['clinics'])} clinics: only when the listing's street number and "
                 "health-center name match the HRSA site. Shown as listed hours to confirm by phone. Spot check: Southside Main "
                 "matched its own site exactly; Mercy Care Chamblee's site says 7am-5pm Mon-Fri while the listing shows Wednesday to 7pm.",
    }]
    DATA.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    print(f"hours added for {used}/{len(data['clinics'])} clinics")


if __name__ == "__main__":
    main()
