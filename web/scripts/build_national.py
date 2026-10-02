"""Nationwide fallback data: every active HRSA health center site with a fixed address, plus every ZIP (ZCTA) centroid.

Metro Atlanta keeps its richer records (src/data/resources.json: checked hours, MARTA stops, local programs).
Everywhere else, ATLAS points to the nearest federally funded health centers from the same HRSA file.

Run: python scripts/build_national.py   (writes src/data/national-clinics.json and src/data/national-zips.json)
"""
import csv, io, json, re, urllib.request, zipfile
from collections import Counter

HRSA = "https://data.hrsa.gov/DataDownload/DD_Files/Health_Center_Service_Delivery_and_LookAlike_Sites.csv"
ZCTA = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_zcta_national.zip"
RETRIEVED = "2026-10-02"
KEEP_LOCATION = {"Permanent", "Seasonal"}  # Mobile Van has no fixed address
# Settings HRSA does not describe as open to the public (students, residents, inmates, shelter residents).
SPECIALTY = re.compile(
    r"\b(pharmacy|pharmacies|rx|vision|eye|optometr\w*|ophthalm\w*|behavioral|mental|psychiatr\w*|counsel\w*|recovery|"
    r"substance|addiction|detox|women'?s|obstetric\w*|ob/?gyn|gyn\w*|maternity|prenatal|pediatric\w*|children'?s|kids|"
    r"teen|youth|adolescent|laborator\w*|lab|wic|podiatr\w*|chiropract\w*|hearing|audiolog\w*|physical therapy|"
    r"radiology|imaging|x-ray|mammograph\w*|dialysis|hiv|aids|hospice|college|university|student)\b", re.I)
DROP_SETTINGS = {"School", "Nursing Home", "Correctional Facility", "Transitional Care in Carceral Setting", "Domestic Violence"}


def get(url: str) -> bytes:
    return urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "atlas-team12"}), timeout=300).read()


def phone(p: str) -> str:
    d = re.sub(r"\D", "", p or "")
    if len(d) == 11 and d.startswith("1"): d = d[1:]
    return f"{d[:3]}-{d[3:6]}-{d[6:]}" if len(d) == 10 else ""


def url(u: str) -> str:
    u = (u or "").strip()
    if not u or u.lower() in {"nan", "none"}: return ""
    return u if re.match(r"^https?://", u, re.I) else "https://" + u.lstrip("/")


def main() -> None:
    atl = json.load(open("src/data/resources.json"))
    atl_ids = {c["bphc_site_id"] for c in atl["clinics"]}

    raw = get(HRSA)
    assert raw[:20].startswith(b"Health Center Type"), "HRSA download is not the CSV"
    rows = list(csv.DictReader(io.StringIO(raw.decode("utf-8-sig", "replace"))))
    stats = Counter(rows=len(rows))
    seen, out = set(), []
    for r in sorted(rows, key=lambda r: r["Site Added to Scope this Date"], reverse=True):
        if r["Site Status Description"] != "Active": stats["not_active"] += 1; continue
        if r["Health Center Location Type Description"] not in KEEP_LOCATION: stats["no_fixed_address"] += 1; continue
        if r["Health Center Type Description"] == "Administrative": stats["admin_only"] += 1; continue
        if r["Health Center Service Delivery Site Location Setting Description"] in DROP_SETTINGS: stats["not_public_setting"] += 1; continue
        if re.search(r"\bdental\b", r["Site Name"], re.I): stats["dental_only"] += 1; continue
        # Sites inside a shelter serve its residents; HRSA does not say they take walk-in patients from the public.
        if re.search(r"\b(shelter|homeless)\b", r["Site Name"], re.I): stats["shelter_site"] += 1; continue
        # The HRSA file has no service-type field, so specialty-only sites are recognized by name: a pharmacy, eye or
        # vision center, behavioral or mental health office, women's or OB/GYN clinic, children's clinic, lab, WIC office, college or student health center
        # and the like cannot take a general medical follow-up.
        if SPECIALTY.search(r["Site Name"]): stats["specialty_only_by_name"] += 1; continue
        if r["BPHC Assigned Number"] in atl_ids: stats["kept_in_atlanta_records"] += 1; continue
        try:
            lat, lng = float(r["Geocoding Artifact Address Primary Y Coordinate"]), float(r["Geocoding Artifact Address Primary X Coordinate"])
        except ValueError:
            stats["no_coordinates"] += 1; continue
        zip5 = r["Site Postal Code"][:5]
        key = (r["Site Name"].strip().lower(), zip5)
        if key in seen: stats["duplicate_listing"] += 1; continue
        seen.add(key)
        out.append([
            "hrsa-" + r["BPHC Assigned Number"], r["Site Name"].strip(), r["Health Center Name"].strip(), r["Site Address"].strip(),
            r["Site City"].strip(), r["Site State Abbreviation"], zip5, phone(r["Site Telephone Number"]), url(r["Site Web Address"]),
            round(lat, 5), round(lng, 5), float(r["Operating Hours per Week"] or 0) or None,
            "look-alike" if "Look-Alike" in r["Health Center Type"] else "fqhc",
        ])
    stats["kept"] = len(out)
    json.dump({
        "source": HRSA, "retrieved": RETRIEVED,
        "filter": "Active; Permanent or Seasonal; not Administrative-only; not School, Nursing Home, Correctional, Carceral or Domestic Violence settings; not dental-only or shelter sites by name; DeKalb/Fulton sites kept in resources.json instead; one row per site name and ZIP.",
        "stats": dict(stats),
        "cols": ["id", "name", "org", "address", "city", "state", "zip", "phone", "website", "lat", "lng", "hours_per_week", "type"],
        "rows": out,
    }, open("src/data/national-clinics.json", "w"), separators=(",", ":"))
    print("clinics", dict(stats))

    z = zipfile.ZipFile(io.BytesIO(get(ZCTA)))
    rd = csv.reader(io.TextIOWrapper(z.open(z.namelist()[0]), encoding="utf-8"), delimiter="\t")
    head = [h.strip() for h in next(rd)]
    i_z, i_la, i_lo = head.index("GEOID"), head.index("INTPTLAT"), head.index("INTPTLONG")
    zips = {r[i_z].strip(): [round(float(r[i_la]), 4), round(float(r[i_lo]), 4)] for r in rd}
    json.dump({"source": ZCTA, "retrieved": RETRIEVED, "note": "ZCTA internal points, every US ZIP Code Tabulation Area", "zips": zips},
              open("src/data/national-zips.json", "w"), separators=(",", ":"))
    print("zips", len(zips))


if __name__ == "__main__":
    main()
