"""Renders each sample lab report in src/data/eval/labs.json to a PNG, like a screenshot of a patient-portal page.

Usage: python3 scripts/render_lab_photos.py
Writes data-raw/lab-photos/<id>.png. These are clean images drawn from the sample text (written by Team ATLAS,
not a real patient). They are not camera photos, so they test reading a screenshot, not a blurry or tilted photo.
"""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WEB = Path(__file__).resolve().parent.parent
OUT = WEB / "data-raw" / "lab-photos"
OUT.mkdir(parents=True, exist_ok=True)
font = ImageFont.truetype("/System/Library/Fonts/Menlo.ttc", 26)

for rep in json.loads((WEB / "src/data/eval/labs.json").read_text())["reports"]:
    lines = rep["text"].rstrip("\n").split("\n")
    w = max(int(font.getlength(l)) for l in lines) + 80
    h = 34 * len(lines) + 80
    img = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(img)
    for i, line in enumerate(lines):
        d.text((40, 40 + 34 * i), line, fill=(20, 20, 20), font=font)
    img.save(OUT / f"{rep['id']}.png")
    print(rep["id"], img.size)
