#!/usr/bin/env python3
"""Draws static/img/moon.png: a realistic full-moon disc, as seen from Earth.

The dark "seas" (maria) and bright craters sit at their real lunar
coordinates (orthographic projection, north up), with fractal noise for
texture, crater rays from Tycho, Copernicus and Kepler, and gentle limb
darkening. The page then shades it to the day's phase.

    python3 tools/make_moon.py          (needs numpy and Pillow)
"""

import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

SIZE = 320                      # output pixels (shown at ~84 px, sharp on Retina)
OUT = Path(__file__).resolve().parent.parent / "static" / "img" / "moon.png"
rng = np.random.default_rng(7)

# -------------------------------------------------------------- geometry
n = SIZE * 2                    # draw at 2x, then downsample for smooth edges
r = n / 2 - 2
ys, xs = np.mgrid[0:n, 0:n].astype(np.float64)
x = (xs - n / 2 + 0.5) / r
y = -(ys - n / 2 + 0.5) / r     # +y = north
rho2 = x * x + y * y
inside = rho2 <= 1.0
z = np.sqrt(np.clip(1 - rho2, 0, 1))
lat = np.degrees(np.arcsin(np.clip(y, -1, 1)))
lon = np.degrees(np.arctan2(x, z))  # +lon = east (right, as seen from Earth)


def ang_dist(lat0, lon0):
    """Great-circle distance in degrees from (lat0, lon0) to every pixel."""
    p1, p2 = np.radians(lat0), np.radians(lat)
    dl = np.radians(lon - lon0)
    c = np.sin(p1) * np.sin(p2) + np.cos(p1) * np.cos(p2) * np.cos(dl)
    return np.degrees(np.arccos(np.clip(c, -1, 1)))


def fractal_noise(octaves=6, base=4):
    """Smooth value noise, summed over octaves (0..1)."""
    total = np.zeros((n, n))
    amp, norm = 1.0, 0.0
    for o in range(octaves):
        cells = base * 2 ** o
        grid = rng.random((cells + 1, cells + 1))
        img = Image.fromarray((grid * 255).astype(np.uint8)).resize((n, n), Image.BICUBIC)
        total += amp * (np.asarray(img, dtype=np.float64) / 255.0)
        norm += amp
        amp *= 0.55
    return total / norm


noise = fractal_noise()
fine = fractal_noise(octaves=4, base=32)

# -------------------------------------------------------------- albedo
albedo = 0.78 + 0.14 * (noise - 0.5) + 0.08 * (fine - 0.5)   # mottled highlands

# southern highlands are a little brighter than the north
albedo += 0.04 * np.clip(-y, 0, 1)

# Real maria: (name, lat, lon, radius in degrees, darkness 0..1)
MARIA = [   # radii from the maria's real diameters (1° ≈ 30 km)
    ("Oceanus Procellarum N", 28, -52, 17, 0.80),
    ("Oceanus Procellarum C", 12, -55, 18, 0.80),
    ("Oceanus Procellarum S", -5, -45, 14, 0.75),
    ("Mare Imbrium", 33, -16, 18, 0.95),
    ("Mare Serenitatis", 28, 17, 11.5, 0.92),
    ("Mare Tranquillitatis", 8.5, 31, 13, 0.88),
    ("Mare Crisium", 17, 59, 9, 0.95),
    ("Mare Fecunditatis", -7.8, 51, 12, 0.80),
    ("Mare Nectaris", -15, 35, 5.5, 0.85),
    ("Mare Nubium", -21, -17, 11, 0.72),
    ("Mare Humorum", -24, -39, 6.5, 0.88),
    ("Mare Cognitum", -10, -23, 6, 0.70),
    ("Mare Insularum", 7.5, -31, 9, 0.72),
    ("Mare Vaporum", 13, 4, 5, 0.78),
    ("Sinus Medii", 2, 1, 4, 0.55),
    ("Sinus Aestuum", 11, -9, 4, 0.65),
    ("Mare Frigoris W", 56, -20, 7, 0.72),
    ("Mare Frigoris C", 58, 0, 7, 0.72),
    ("Mare Frigoris E", 56, 20, 7, 0.72),
    ("Lacus Somniorum", 38, 30, 5, 0.55),
    ("Palus Putredinis", 26, 1, 4, 0.60),
    ("Mare Smythii", -1, 87, 6, 0.70),
    ("Mare Marginis", 13, 86, 5, 0.60),
    ("Mare Australe", -46, 85, 8, 0.45),
]
mare = np.zeros((n, n))
shape = fractal_noise(octaves=3, base=3)
wobble = (shape - 0.5) * 16 + (noise - 0.5) * 5 + (fine - 0.5) * 1.2   # irregular shorelines
for _, la, lo, rad, dark in MARIA:
    d = ang_dist(la, lo) + wobble
    cover = dark * np.clip((rad - d) / (rad * 0.45), 0, 1)
    mare = 1 - (1 - mare) * (1 - cover)           # neighbouring seas blend into one
mare_albedo = 0.36 + 0.08 * (fine - 0.5) + 0.08 * (noise - 0.5)
albedo = albedo * (1 - mare) + mare_albedo * mare

# Bright craters: (lat, lon, radius, brightness, ray length or 0)
CRATERS = [
    (-43.3, -11.4, 1.6, 0.30, 75),   # Tycho
    (9.6, -20.1, 1.4, 0.22, 22),     # Copernicus
    (8.1, -38.0, 0.9, 0.20, 14),     # Kepler
    (23.7, -47.4, 0.8, 0.35, 8),     # Aristarchus
    (-8.9, 61.1, 0.8, 0.18, 10),     # Langrenus
    (-21.0, -29.0, 0.5, 0.12, 0),    # Bullialdus
    (-3.3, -17.7, 0.6, 0.10, 0),     # Lalande
    (-29.9, 39.1, 0.7, 0.14, 8),     # Stevinus area
]
for la, lo, rad, b, rays in CRATERS:
    d = ang_dist(la, lo)
    albedo += b * np.clip((rad * 1.6 - d) / rad, 0, 1)
    if rays:
        # bright streaks radiating outwards, fading with distance
        bearing = np.degrees(np.arctan2(lon - lo, lat - la))
        streak = np.zeros((n, n))
        for k in range(22):
            angle = rng.uniform(0, 360)
            width = rng.uniform(4.0, 9.0)
            diff = np.abs(((bearing - angle + 180) % 360) - 180)
            length = rays * rng.uniform(0.4, 1.0)
            streak = np.maximum(streak, np.clip(1 - diff / width, 0, 1) ** 2 * np.clip(1 - d / length, 0, 1))
        halo = np.clip(1 - d / (rays * 0.25), 0, 1)
        albedo += (0.05 * streak + 0.07 * halo) * np.clip(d / (rad * 2), 0, 1)

# Plato: a dark-floored crater in the north
albedo -= 0.25 * np.clip((1.2 - ang_dist(51.6, -9.3)) / 0.6, 0, 1)

# Small craters scattered over the highlands
for _ in range(260):
    la, lo = rng.uniform(-80, 80), rng.uniform(-88, 88)
    rad = rng.uniform(0.4, 2.2)
    d = ang_dist(la, lo)
    rim = np.clip(1 - np.abs(d - rad) / (rad * 0.35), 0, 1)
    floor = np.clip((rad - d) / rad, 0, 1)
    albedo += 0.018 * rim - 0.02 * floor * (1 - mare)

# -------------------------------------------------------------- shading + colour
limb = 0.72 + 0.28 * np.sqrt(z)                  # full moon looks almost flat; gentle edge falloff
val = np.clip(albedo * limb, 0, 1)
rgb = np.stack([val * 1.00, val * 0.975, val * 0.93], axis=-1)   # faint warm-grey
alpha = np.clip((1.0 - np.sqrt(rho2)) * r, 0, 1)                 # anti-aliased edge
img = np.dstack([np.clip(rgb, 0, 1) * 255, alpha * 255]).astype(np.uint8)
img[~inside & (alpha == 0)] = 0

out = Image.fromarray(img, "RGBA").filter(ImageFilter.GaussianBlur(1.5)).resize((SIZE, SIZE), Image.LANCZOS)
OUT.parent.mkdir(parents=True, exist_ok=True)
out.save(OUT, optimize=True)
print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB)")
