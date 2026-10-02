#!/usr/bin/env python3
"""Draw the app icon and a picture of the sample paper (for OCR testing in the Simulator).

Run:  python3 mobile/ios/scripts/make_images.py      (needs Pillow)
- ATLAS/Resources/Assets.xcassets/AppIcon.appiconset/AppIcon-1024.png
  The ATLAS mark from web/src/ui/Mark.tsx: teal square, folded paper, check. Full-bleed
  (iOS rounds the corners itself), no transparency.
- scripts/out/sample-paper.png
  The labeled sample after-visit summary from web/src/lib/sample.ts rendered as a page,
  so `xcrun simctl addmedia` can put it in the Simulator's photo library.
"""
import os
import re

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
IOS = os.path.dirname(HERE)
ROOT = os.path.dirname(os.path.dirname(IOS))

TEAL = (11, 122, 117)
PAPER = (251, 248, 243)
MINT = (191, 233, 220)
INK = (16, 42, 67)


def icon(path: str) -> None:
    n = 1024
    s = n / 52.0  # the mark's paper spans x 17..46, y 14..53 in a 64 box; zoom so it fills the icon nicely
    ox, oy = -5.5 * s, -7.5 * s

    def p(x: float, y: float):
        return (ox + x * s, oy + y * s)

    img = Image.new("RGB", (n, n), TEAL)
    d = ImageDraw.Draw(img)
    r = 3 * s
    # Paper body with rounded bottom corners and a folded top-right corner.
    d.polygon([p(20, 14), p(37, 14), p(46, 23), p(46, 50), p(43, 53), p(20, 53), p(17, 50), p(17, 17)], fill=PAPER)
    d.rounded_rectangle([p(17, 30), p(46, 53)], radius=r, fill=PAPER)
    d.rounded_rectangle([p(17, 14), p(30, 30)], radius=r, fill=PAPER)
    d.polygon([p(37, 14), p(37, 23), p(46, 23)], fill=MINT)
    w = int(4.5 * s)
    pts = [p(23.5, 37.5), p(29, 43), p(40, 31)]
    d.line(pts, fill=TEAL, width=w, joint="curve")
    for x, y in (pts[0], pts[2]):
        d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=TEAL)
    img.save(path)
    print("wrote", path)


def find_font(size: int):
    for f in ("/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc",
              "/Library/Fonts/Arial.ttf"):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    raise SystemExit("no TrueType font found")


def sample_paper(path: str) -> None:
    src = open(os.path.join(ROOT, "web", "src", "lib", "sample.ts"), encoding="utf-8").read()
    text = re.search(r"SAMPLE_AVS = `(.*?)`;", src, re.S).group(1)
    font = find_font(30)
    width, margin, line_h = 1700, 80, 44
    # Wrap long lines to the page width.
    d0 = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    lines: list[str] = []
    for raw in text.split("\n"):
        words, cur = raw.split(" "), ""
        for w in words:
            trial = (cur + " " + w) if cur else w
            if d0.textlength(trial, font=font) > width - 2 * margin and cur:
                lines.append(cur)
                cur = w
            else:
                cur = trial
        lines.append(cur)
    height = margin * 2 + line_h * len(lines)
    img = Image.new("RGB", (width, height), (255, 255, 255))
    d = ImageDraw.Draw(img)
    y = margin
    for line in lines:
        d.text((margin, y), line, fill=(20, 20, 20), font=font)
        y += line_h
    img.save(path)
    print("wrote", path, img.size)


if __name__ == "__main__":
    icon(os.path.join(IOS, "ATLAS", "Resources", "Assets.xcassets", "AppIcon.appiconset", "AppIcon-1024.png"))
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    sample_paper(os.path.join(HERE, "out", "sample-paper.png"))
