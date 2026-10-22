#!/usr/bin/env python3
"""Makes static/img/moon.webp from NASA's full-moon image.

Source: assets/nasa-full-moon.webp — the full Moon from NASA's "Moon Phases"
page (https://science.nasa.gov/moon/moon-phases/), image credit NASA.
This cuts the disc out on a transparent background and sizes it for the
dashboard, which then shades it to the day's phase.

    python3 tools/make_moon.py          (needs numpy and Pillow)
"""

from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "nasa-full-moon.webp"
OUT = ROOT / "static" / "img" / "moon.webp"
SIZE = 360  # shown at up to ~120 px; sharp on Retina screens

im = Image.open(SRC).convert("RGB")
rgb = np.asarray(im).astype(np.float64)
lit = rgb.mean(axis=2) > 40
ys, xs = np.nonzero(lit)
cx = (xs.min() + xs.max()) / 2
cy = (ys.min() + ys.max()) / 2
r = ((xs.max() - xs.min()) + (ys.max() - ys.min())) / 4

# square crop around the disc, then an anti-aliased circular alpha mask
pad = 1
box = (int(round(cx - r - pad)), int(round(cy - r - pad)), int(round(cx + r + pad)), int(round(cy + r + pad)))
crop = im.crop(box).resize((SIZE * 2, SIZE * 2), Image.LANCZOS)
n = SIZE * 2
yy, xx = np.mgrid[0:n, 0:n]
rr = n / 2 - 1.5
dist = np.sqrt((xx - n / 2 + 0.5) ** 2 + (yy - n / 2 + 0.5) ** 2)
alpha = np.clip(rr - dist + 0.5, 0, 1) * 255
rgba = np.dstack([np.asarray(crop), alpha]).astype(np.uint8)
out = Image.fromarray(rgba, "RGBA").resize((SIZE, SIZE), Image.LANCZOS)
OUT.parent.mkdir(parents=True, exist_ok=True)
out.save(OUT, "WEBP", quality=88, method=6)
print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB), disc centre ({cx:.0f},{cy:.0f}) r={r:.0f}")
