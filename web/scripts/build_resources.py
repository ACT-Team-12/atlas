#!/usr/bin/env python3
"""Build ATLAS's verified local resource dataset (src/data/resources.json).

Every record comes from a public source fetched at build time:
  1. HRSA Health Center Service Delivery and Look-Alike Sites (CSV), filtered to
     Georgia, DeKalb + Fulton counties, active, permanent/seasonal service sites.
  2. MARTA GTFS static feed: nearest heavy-rail stop and nearest bus stop to each
     clinic (straight-line haversine distance, metres).
  3. A hand-curated list of non-clinic programs. Each carries the official URL and
     a verbatim sentence copied from that page. At build time the script re-fetches
     each page and checks that the sentence is still present; the result is written
     to `quote_verified_live` (true / false / null when the fetch itself failed).

Run (from atlas/web):
    ~/.claude/venvs/sci/bin/python scripts/build_resources.py

Needs pandas. Uses urllib only (no curl). Network required.
"""
from __future__ import annotations

import csv
import html
import io
import json
import math
import re
import sys
import urllib.request
import zipfile
from pathlib import Path

import pandas as pd

RETRIEVED = "2026-10-01"
OUT = Path(__file__).resolve().parent.parent / "src" / "data" / "resources.json"

HRSA_DOWNLOAD_PAGE = "https://data.hrsa.gov/data/download"
HRSA_SITES_CSV = (
    "https://data.hrsa.gov/DataDownload/DD_Files/"
    "Health_Center_Service_Delivery_and_LookAlike_Sites.csv"
)
HRSA_WHAT_IS_HC = "https://bphc.hrsa.gov/about-health-center-program/what-health-center"
HRSA_SFDP_CH9 = "https://bphc.hrsa.gov/compliance/compliance-manual/chapter9"
MARTA_DEV_PAGE = "https://itsmarta.com/app-developer-resources.aspx"
MARTA_GTFS_ZIP = "https://itsmarta.com/google_transit_feed/google_transit.zip"

COUNTIES = {"DeKalb", "Fulton"}
KEEP_LOCATION_TYPES = {"Permanent", "Seasonal"}  # Mobile Van has no fixed address
DROP_SITE_TYPES = {"Administrative"}  # admin-only sites deliver no care

UA = {
    "User-Agent": "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/124 Safari/537.36"
}


def fetch(url: str, timeout: int = 120) -> bytes:
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def page_text(raw: bytes) -> str:
    t = raw.decode("utf8", "ignore")
    t = re.sub(r"(?s)<(script|style)[^>]*>.*?</\1>", " ", t)
    t = re.sub(r"<[^>]+>", " ", t)
    return norm(html.unescape(t))


def norm(s: str) -> str:
    s = s.replace("’", "'").replace("‘", "'")
    s = s.replace("“", '"').replace("”", '"').replace(" ", " ")
    return re.sub(r"\s+", " ", s).strip()


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    r = 6371008.8
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def nearest(lat, lon, stops: pd.DataFrame) -> dict:
    best = None
    for s in stops.itertuples(index=False):
        d = haversine_m(lat, lon, s.stop_lat, s.stop_lon)
        if best is None or d < best[0]:
            best = (d, s)
    d, s = best
    return {"name": s.stop_name.title(), "stop_id": s.stop_id, "meters": round(d)}


def clean_phone(p) -> str:
    digits = re.sub(r"\D", "", str(p or ""))
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) != 10:
        return ""
    return f"{digits[:3]}-{digits[3:6]}-{digits[6:]}"


def clean_url(u) -> str:
    u = str(u or "").strip()
    if not u or u.lower() in {"nan", "none"}:
        return ""
    if not re.match(r"^https?://", u, re.I):
        u = "https://" + u.lstrip("/")
    return u


# --------------------------------------------------------------------------- #
# Non-clinic programs. Quotes are copied verbatim from the page at `url`.
# --------------------------------------------------------------------------- #
PROGRAMS = [
    {
        "id": "united-way-211",
        "name": "United Way of Greater Atlanta 211",
        "barriers": ["housing", "food"],
        "access": {"phone": "211", "text": "Text your ZIP Code and need to 898211",
                   "url": "https://unitedwayatlanta.org/about-211/"},
        "languages": [],
        "language_note": "Page says specialists are bilingual but does not name the languages.",
        "hours_note": "Dial 211 Monday–Friday from 8:00 a.m. to 5:00 p.m. to speak with our team.",
        "evidence_quote": "Connect to 211 through your text, chat, email, online or via phone and you will reach trained, bilingual Community Connection Specialists who provide information on services and referrals to programs that meet your specific needs.",
        "source_url": "https://unitedwayatlanta.org/about-211/",
        "extra_evidence": [{
            "quote": "Needs vary widely, ranging from rental assistance and housing resources, utilities help, food pantries, holiday gifts, or even asking about ways to volunteer and give back.",
            "url": "https://unitedwayatlanta.org/211-since-1997-help-is-just-three-digits-away/",
        }],
    },
    {
        "id": "marta-mobility",
        "name": "MARTA Mobility (ADA paratransit)",
        "barriers": ["transport"],
        "access": {"phone": "404-848-5389", "url": "https://itsmarta.com/MARTA-Mobility.aspx"},
        "languages": [],
        "evidence_quote": "MARTA Mobility is our service that provides ADA Complementary Paratransit service to anyone unable to ride or disembark from our regular MARTA transit services.",
        "source_url": "https://itsmarta.com/MARTA-Mobility.aspx",
        "extra_evidence": [
            {"quote": "To become eligible to ride MARTA Mobility, you must complete an application and an in-person interview and assessment.",
             "url": "https://itsmarta.com/MARTA-Mobility.aspx"},
            {"quote": "Download the application (click on the link below), or contact the Mobility Eligibility office at 404-848-5389 to request an application for Mobility Services.",
             "url": "https://itsmarta.com/MARTA-Mobility.aspx"},
        ],
    },
    {
        "id": "marta-language-line",
        "name": "MARTA information in another language or accessible format",
        "barriers": ["language", "transport"],
        "access": {"phone": "404-848-4037", "url": "https://itsmarta.com/MARTA-Mobility.aspx"},
        "languages": [],
        "language_note": "Page offers 'another language' without naming which.",
        "evidence_quote": "To request information in another language or an accessible format, please call 404-848-4037.",
        "source_url": "https://itsmarta.com/MARTA-Mobility.aspx",
        "extra_evidence": [],
    },
    {
        "id": "marta-reduced-fare",
        "name": "MARTA Reduced Fare Program",
        "barriers": ["transport", "cost"],
        "access": {"phone": "", "url": "https://itsmarta.com/reduced-fare-program.aspx"},
        "languages": [],
        "evidence_quote": "We offer Reduced Fare Breeze Cards to eligible senior citizens, people with disabilities and Medicare cardholders.",
        "source_url": "https://itsmarta.com/reduced-fare-program.aspx",
        "extra_evidence": [
            {"quote": "Fare is unchanged; Reduced Fare rides are still $1.00.",
             "url": "https://itsmarta.com/reduced-fare-program.aspx"},
            {"quote": "The initial card is free, and your first replacement is only $2.",
             "url": "https://itsmarta.com/reduced-fare-program.aspx"},
        ],
    },
    {
        "id": "georgia-gateway",
        "name": "Georgia Gateway (apply for Medicaid, SNAP, WIC, TANF)",
        "barriers": ["insurance", "cost", "food", "language"],
        "access": {"phone": "", "url": "https://gateway.ga.gov/access/"},
        "languages": ["Arabic", "Bosnian", "Burmese", "Gujarati", "Hindi", "Japanese",
                      "Chinese (Simplified)", "Farsi", "French", "Korean", "Nepali",
                      "Portuguese", "Russian", "Spanish", "Vietnamese"],
        "language_note": "Languages listed on the page for SNAP, TANF, MA, Refugee Cash Assistance, or WIC applications.",
        "evidence_quote": "To apply for Food Stamps (SNAP), Temporary Assistance For Needy Families (TANF), Medical Assistance (MA), Child Care and Parent Services (CAPS), or Women, Infants and Children (WIC), please select the 'Apply for Benefits' button.",
        "source_url": "https://gateway.ga.gov/access/",
        "extra_evidence": [
            {"quote": "To access a SNAP, TANF, MA, Refugee Cash Assistance, or WIC application in another language, please select the appropriate language.",
             "url": "https://gateway.ga.gov/access/"},
            {"quote": "Further information on PeachCare for Kids® can be found at https://dch.georgia.gov/peachcare-kids .",
             "url": "https://gateway.ga.gov/access/"},
        ],
    },
    {
        "id": "georgia-medicaid-apply",
        "name": "Georgia Medicaid: how to apply",
        "barriers": ["insurance", "cost"],
        "access": {"phone": "", "url": "https://medicaid.georgia.gov/how-apply"},
        "languages": [],
        "evidence_quote": "If you or someone in your family needs health care, you should apply for Medicaid even if you are not sure whether you qualify or if you have been turned down in the past.",
        "source_url": "https://medicaid.georgia.gov/how-apply",
        "extra_evidence": [
            {"quote": "To apply for Medicaid please visit the Georgia Gateway Customer Portal .",
             "url": "https://medicaid.georgia.gov/how-apply"},
        ],
    },
    {
        "id": "grady-financial-assistance",
        "name": "Grady Health System Financial Assistance Program",
        "barriers": ["cost", "insurance"],
        "access": {"phone": "404-616-6920", "url": "https://www.gradyhealth.org/financial-assistance-program/"},
        "languages": ["English", "Spanish"],
        "language_note": "Page content is published in English and Spanish.",
        "evidence_quote": "Grady offers discounted care under a Financial Assistance Program to qualified individuals for emergency and medically necessary services.",
        "source_url": "https://www.gradyhealth.org/financial-assistance-program/",
        "extra_evidence": [
            {"quote": "If you live in Fulton or DeKalb County Your information can be evaluated for financial assistance through our Financial Assistance Program.",
             "url": "https://www.gradyhealth.org/financial-assistance-program/"},
            {"quote": "Call us at (404) 616-6920 to schedule a time to meet with a Financial Counselor at Grady.",
             "url": "https://www.gradyhealth.org/financial-assistance-program/"},
            {"quote": "Si necesita información sobre ayuda financiera o un formulario de solicitud",
             "url": "https://www.gradyhealth.org/financial-assistance-program/"},
        ],
    },
    {
        "id": "acfb-food-map",
        "name": "Atlanta Community Food Bank food pantry map and Text for Help",
        "barriers": ["food"],
        "access": {"phone": "888-976-2232", "text": "Text FINDFOOD (or COMIDA) to 888-976-2232",
                   "url": "https://www.acfb.org/get-help/food-map/"},
        "languages": ["English", "Spanish"],
        "evidence_quote": "Text \" FINDFOOD \" or \" COMIDA \" to 888-976-2232",
        "source_url": "https://www.acfb.org/get-help/",
        "extra_evidence": [
            {"quote": "Simply enter your address for a list of pantries and their operating days and times.",
             "url": "https://www.acfb.org/get-help/food-map/"},
            {"quote": "Please visit our Food Map page OR text 'FINDFOOD' (COMIDA for Spanish) to 888-976-2232 to find a food pantry near you.",
             "url": "https://www.acfb.org/community-food-center/"},
        ],
    },
    {
        "id": "acfb-benefits-help",
        "name": "Atlanta Community Food Bank help applying for SNAP and Medicaid",
        "barriers": ["food", "insurance"],
        "access": {"phone": "", "url": "https://www.acfb.org/get-help/"},
        "languages": [],
        "evidence_quote": "Atlanta Community Food Bank staff are available to help you apply for government assistance programs.",
        "source_url": "https://www.acfb.org/get-help/",
        "extra_evidence": [],
    },
    {
        "id": "lifeline",
        "name": "Lifeline phone and internet discount (federal, USAC/FCC)",
        "barriers": ["tech", "cost"],
        "access": {"phone": "800-234-9473", "url": "https://www.lifelinesupport.org/"},
        "languages": [],
        "evidence_quote": "If you qualify, you can get a monthly discount of up to $9.25 on phone, internet, or bundled service.",
        "source_url": "https://www.lifelinesupport.org/",
        "extra_evidence": [
            {"quote": "If you, or your child or dependent participate in programs like the Supplemental Nutrition Assistance Program (SNAP), Medicaid, certain other programs, or earn a certain income, you qualify for Lifeline.",
             "url": "https://www.lifelinesupport.org/"},
        ],
    },
]

# Dataset-level fact for every clinic. bphc.hrsa.gov returns 403 to urllib, so the
# live check is expected to be null there; these quotes were read via an EXA page
# fetch on 2026-10-01.
SLIDING_FEE_FACT = {
    "statement": "Every HRSA-funded health center must adjust fees based on income and family size and serve everyone, even if they cannot pay.",
    "evidence": [
        {"quote": "Adjust their fees based on income and family size", "url": HRSA_WHAT_IS_HC},
        {"quote": "Serve everyone, even if they cannot pay", "url": HRSA_WHAT_IS_HC},
        {"quote": "A health center's sliding fee discount program consists of the schedule of discounts that is applied to the fee schedule and adjusts fees based on the patient's ability to pay.",
         "url": HRSA_SFDP_CH9},
    ],
    "scope_note": "Stated by HRSA for Health Center Program health centers; not a per-site claim. Look-alike sites are flagged in health_center_type.",
}

BARRIERS = {"transport", "cost", "insurance", "language", "schedule", "tech",
            "referrals", "food", "housing"}


def verify_quotes(items: list[dict], cache: dict) -> None:
    for it in items:
        url = it["url"]
        if url not in cache:
            try:
                cache[url] = page_text(fetch(url, timeout=40))
            except Exception as e:  # record, never silently pass
                cache[url] = None
                print(f"  fetch failed {url}: {e}", file=sys.stderr)
        text = cache[url]
        it["quote_verified_live"] = None if text is None else (norm(it["quote"]) in text)


def build_clinics() -> tuple[list[dict], dict]:
    print("Downloading HRSA sites CSV ...")
    raw = fetch(HRSA_SITES_CSV, timeout=300)
    if not raw.startswith(b"Health Center Type"):
        sys.exit("HRSA download did not return the expected CSV header")
    df = pd.read_csv(io.BytesIO(raw), dtype=str)
    snapshot = sorted(df["Data Warehouse Record Create Date"].dropna().unique().tolist())
    ga = df[(df["Site State Abbreviation"] == "GA")
            & (df["County Equivalent Name"].isin(COUNTIES))]
    stats = {"ga_dekalb_fulton_rows": len(ga)}
    ga = ga[ga["Site Status Description"] == "Active"]
    stats["active"] = len(ga)
    stats["dropped_mobile_van"] = int((ga["Health Center Location Type Description"] == "Mobile Van").sum())
    stats["dropped_admin_only"] = int(ga["Health Center Type Description"].isin(DROP_SITE_TYPES).sum())
    ga = ga[ga["Health Center Location Type Description"].isin(KEEP_LOCATION_TYPES)
            & ~ga["Health Center Type Description"].isin(DROP_SITE_TYPES)]
    before = len(ga)
    # Some sites appear twice: once under a look-alike designation (BPS-LAL-*) and
    # again under a later FQHC grant (BPS-H80-*), with cosmetic address differences.
    # Keep the record most recently added to scope for each (site name, ZIP5).
    ga = ga.assign(_zip5=ga["Site Postal Code"].str[:5],
                   _added=pd.to_datetime(ga["Site Added to Scope this Date"], format="%m/%d/%Y", errors="coerce"))
    ga = ga.sort_values("_added", ascending=False).drop_duplicates(subset=["Site Name", "_zip5"])
    stats["dropped_duplicate_site_listings"] = before - len(ga)
    stats["snapshot_dates"] = snapshot

    print("Downloading MARTA GTFS ...")
    z = zipfile.ZipFile(io.BytesIO(fetch(MARTA_GTFS_ZIP, timeout=300)))
    stops = pd.read_csv(z.open("stops.txt"), dtype={"stop_id": str})
    routes = pd.read_csv(z.open("routes.txt"), dtype=str, usecols=["route_id", "route_type"])
    trips = pd.read_csv(z.open("trips.txt"), dtype=str, usecols=["route_id", "trip_id"])
    st = pd.read_csv(z.open("stop_times.txt"), dtype=str, usecols=["trip_id", "stop_id"])
    cal = pd.read_csv(z.open("calendar.txt"), dtype=str)
    rt = trips.merge(routes, on="route_id")[["trip_id", "route_type"]]
    served = st.drop_duplicates().merge(rt, on="trip_id")[["stop_id", "route_type"]].drop_duplicates()
    rail_ids = set(served.loc[served.route_type == "1", "stop_id"])
    bus_ids = set(served.loc[served.route_type == "3", "stop_id"])
    rail = stops[stops.stop_id.isin(rail_ids)]
    bus = stops[stops.stop_id.isin(bus_ids)]
    feed = {"start_date": cal["start_date"].min(), "end_date": cal["end_date"].max(),
            "rail_stops": len(rail), "bus_stops": len(bus)}
    print(f"  rail stops {len(rail)}, bus stops {len(bus)}, service {feed}")

    clinics = []
    for row in ga.to_dict(orient="records"):
        lat = float(row["Geocoding Artifact Address Primary Y Coordinate"])
        lng = float(row["Geocoding Artifact Address Primary X Coordinate"])
        if not (33.0 < lat < 34.5 and -85.0 < lng < -83.8):
            print(f"  WARN coordinates out of metro range for {row['Site Name']}", file=sys.stderr)
        slug = re.sub(r"[^a-z0-9]+", "-", f"{row['Site Name']} {row['Site Postal Code'][:5]}".lower()).strip("-")
        hours = row.get("Operating Hours per Week")
        clinics.append({
            "id": f"hrsa-{slug}",
            "name": row["Site Name"].strip(),
            "org": row["Health Center Name"].strip(),
            "address": row["Site Address"].strip(),
            "city": row["Site City"].strip(),
            "zip": str(row["Site Postal Code"])[:5],
            "county": row["County Equivalent Name"],
            "phone": clean_phone(row["Site Telephone Number"]),
            "website": clean_url(row["Site Web Address"]),
            "lat": round(lat, 6),
            "lng": round(lng, 6),
            "hours_per_week": float(hours) if hours and str(hours) != "nan" else None,
            "location_type": row["Health Center Location Type Description"],
            "site_type": row["Health Center Type Description"],
            "setting": row["Health Center Service Delivery Site Location Setting Description"],
            "health_center_type": row["Health Center Type"],
            "bphc_site_id": row["BPHC Assigned Number"],
            "nearest_rail": nearest(lat, lng, rail),
            "nearest_bus": nearest(lat, lng, bus),
            "barriers": ["cost", "insurance"],
            "source_id": "hrsa-sites",
        })
    clinics.sort(key=lambda c: (c["county"], c["name"]))
    ids = [c["id"] for c in clinics]
    assert len(ids) == len(set(ids)), "duplicate clinic ids"
    return clinics, {"hrsa": stats, "gtfs": feed}


def main() -> None:
    clinics, meta = build_clinics()
    cache: dict = {}
    print("Verifying program quotes against live pages ...")
    for p in PROGRAMS:
        assert set(p["barriers"]) <= BARRIERS, p["id"]
        items = [{"quote": p["evidence_quote"], "url": p["source_url"]}] + p["extra_evidence"]
        verify_quotes(items, cache)
        p["quote_verified_live"] = items[0]["quote_verified_live"]
        p["extra_evidence"] = items[1:]
        p["source_id"] = p["id"]
        p["retrieved"] = RETRIEVED
    verify_quotes(SLIDING_FEE_FACT["evidence"], cache)

    sources = [
        {"id": "hrsa-sites", "name": "HRSA Health Center Service Delivery and Look-Alike Sites (CSV)",
         "url": HRSA_SITES_CSV, "retrieved": RETRIEVED,
         "notes": (f"Listed on {HRSA_DOWNLOAD_PAGE}. Snapshot date(s) in file: {meta['hrsa']['snapshot_dates']}. "
                   f"Filter: GA, county in DeKalb/Fulton, Active, Permanent or Seasonal, not Administrative-only. "
                   f"Counts: {json.dumps({k: v for k, v in meta['hrsa'].items() if k != 'snapshot_dates'})}.")},
        {"id": "hrsa-sliding-fee", "name": "HRSA: What is a Health Center? / Compliance Manual Ch. 9 Sliding Fee Discount Program",
         "url": HRSA_WHAT_IS_HC, "retrieved": RETRIEVED,
         "notes": "Dataset-level fact backing the cost/insurance barrier tags on every clinic. See sliding_fee_fact."},
        {"id": "marta-gtfs", "name": "MARTA GTFS static feed (google_transit.zip)",
         "url": MARTA_GTFS_ZIP, "retrieved": RETRIEVED,
         "notes": (f"Linked from {MARTA_DEV_PAGE} (page states Effective Date 8/22/2026). calendar.txt service "
                   f"{meta['gtfs']['start_date']} to {meta['gtfs']['end_date']}. Rail = stops served by route_type 1 "
                   f"({meta['gtfs']['rail_stops']} platform stops); bus = route_type 3 ({meta['gtfs']['bus_stops']}). "
                   f"Distances are straight-line haversine metres, not walking distance.")},
    ] + [{"id": p["id"], "name": p["name"], "url": p["source_url"], "retrieved": RETRIEVED,
          "notes": "Official page; verbatim quote in programs[]."} for p in PROGRAMS]

    out = {
        "generated_at": RETRIEVED,
        "area": "DeKalb and Fulton counties, Georgia",
        "sliding_fee_fact": SLIDING_FEE_FACT,
        "sources": sources,
        "clinics": clinics,
        "programs": PROGRAMS,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    bad = [p["id"] for p in PROGRAMS if p["quote_verified_live"] is False]
    bad += [e["url"] for p in PROGRAMS for e in p["extra_evidence"] if e["quote_verified_live"] is False]
    print(f"Wrote {OUT} : {len(clinics)} clinics, {len(PROGRAMS)} programs")
    if bad:
        sys.exit(f"QUOTE NOT FOUND on live page: {bad}")


if __name__ == "__main__":
    main()
