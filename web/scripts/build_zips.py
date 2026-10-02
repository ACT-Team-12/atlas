"""ZIP (ZCTA) centroids for metro Atlanta from the US Census Gazetteer. Run: python scripts/build_zips.py"""
import csv, io, json, math, urllib.request, zipfile
URL = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_zcta_national.zip"
ATL = (33.749, -84.388)
def km(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (*a, *b))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 12742 * math.asin(math.sqrt(h))
raw = urllib.request.urlopen(urllib.request.Request(URL, headers={"User-Agent": "atlas-team12"}), timeout=60).read()
z = zipfile.ZipFile(io.BytesIO(raw)); name = z.namelist()[0]
rows = csv.reader(io.TextIOWrapper(z.open(name), encoding="utf-8"), delimiter="\t")
head = [h.strip() for h in next(rows)]
i_z, i_la, i_lo = head.index("GEOID"), head.index("INTPTLAT"), head.index("INTPTLONG")
out = {}
for r in rows:
    zc = r[i_z].strip()
    if not zc.startswith("30"): continue
    p = (float(r[i_la]), float(r[i_lo]))
    if km(p, ATL) <= 60: out[zc] = [round(p[0], 5), round(p[1], 5)]
json.dump({"source": URL, "retrieved": "2026-10-01", "note": "ZCTA internal points within 60 km of downtown Atlanta", "zips": out},
          open("src/data/zips.json", "w"), separators=(",", ":"))
print(len(out), "zips")
