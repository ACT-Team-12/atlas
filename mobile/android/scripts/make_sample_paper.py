#!/usr/bin/env python3
"""Render the labeled sample paper (web/src/lib/sample.ts) as a page image for OCR testing.

Run:  python3 mobile/android/scripts/make_sample_paper.py      (needs Pillow)
Then push it into the emulator gallery:
  adb push mobile/android/scripts/out/sample-paper.png /sdcard/Pictures/sample-paper.png
  adb shell am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file:///sdcard/Pictures/sample-paper.png
Same rendering as mobile/ios/scripts/make_images.py.
"""
import os
import re

from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(HERE)))


def find_font(size: int):
    for f in ("/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc", "/Library/Fonts/Arial.ttf"):
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    raise SystemExit("no TrueType font found")


def main() -> None:
    src = open(os.path.join(ROOT, "web", "src", "lib", "sample.ts"), encoding="utf-8").read()
    text = re.search(r"SAMPLE_AVS = `(.*?)`;", src, re.S).group(1)
    font = find_font(30)
    width, margin, line_h = 1700, 80, 44
    d0 = ImageDraw.Draw(Image.new("RGB", (10, 10)))
    lines: list[str] = []
    for raw in text.split("\n"):
        cur = ""
        for w in raw.split(" "):
            trial = (cur + " " + w) if cur else w
            if d0.textlength(trial, font=font) > width - 2 * margin and cur:
                lines.append(cur)
                cur = w
            else:
                cur = trial
        lines.append(cur)
    img = Image.new("RGB", (width, margin * 2 + line_h * len(lines)), (255, 255, 255))
    d = ImageDraw.Draw(img)
    for i, line in enumerate(lines):
        d.text((margin, margin + i * line_h), line, fill=(20, 20, 20), font=font)
    os.makedirs(os.path.join(HERE, "out"), exist_ok=True)
    path = os.path.join(HERE, "out", "sample-paper.png")
    img.save(path)
    print("wrote", path, img.size)


if __name__ == "__main__":
    main()
