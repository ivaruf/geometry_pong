#!/usr/bin/env python3
"""Generate the Geometry Pong icon set.

    python3 tools/make-icons.py

Writes icons/icon-192.png, icon-512.png, icon-180.png and
icon-maskable-512.png. Requires Pillow; no network, no fonts, no external
assets. The script is the source of truth, not the PNGs (hub CLAUDE.md §4):
change the motif here and re-run, never touch the images.

THE MOTIF: the board from above. A hexagon of six thin edges in the six
player colours, each with its glowing paddle a little inside it, and the
white ball just off centre with a short trail in the colour of whoever hit it
last. It is the game's first frame reduced to the parts that read at 24 px:
the ring of colour says "many sides", the one white dot says "ball".

Every icon is opaque to its corners (iOS paints transparent pixels black and
a maskable icon must fill its frame), on the board's own black. The maskable
copy draws the same picture inside its 80% safe zone.

Rendered 4x and downsampled with LANCZOS. Glow is a blurred copy of the
lines composited under the sharp ones.
"""

import math
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "icons")

VOID = (6, 7, 12)
COLORS = ["#3be8ff", "#ff4fd8", "#ffd23f", "#7dff6a", "#ff8a3d", "#a98bff"]
SS = 4


def rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i : i + 2], 16) for i in (0, 2, 4))


def motif(size, safe):
    """Draw the board at size*SS, the hexagon filling `safe` of the frame."""
    S = size * SS
    lines = Image.new("RGB", (S, S), (0, 0, 0))
    d = ImageDraw.Draw(lines)
    c = S / 2
    R = S * safe / 2 * 0.86  # circumradius of the hexagon
    n = 6
    w_edge = max(2, int(S * 0.012))
    w_pad = max(3, int(S * 0.034))
    for i in range(n):
        th = math.pi / 2 + 2 * math.pi * i / n
        ux, uy = math.cos(th), math.sin(th)
        tx, ty = -uy, ux
        a = R * math.cos(math.pi / n)
        half = R * math.sin(math.pi / n)
        col = rgb(COLORS[i])
        mx, my = c + ux * a, c + uy * a
        d.line([(mx - tx * half, my - ty * half), (mx + tx * half, my + ty * half)], fill=tuple(v // 2 for v in col), width=w_edge)
        # Paddles sit at varied places along their sides, as in a rally.
        off = [0.0, 0.35, -0.3, 0.2, -0.4, 0.3][i] * half * 0.5
        hl = half * 0.34
        pa = a - S * 0.03
        px, py = c + ux * pa + tx * off, c + uy * pa + ty * off
        d.line([(px - tx * hl, py - ty * hl), (px + tx * hl, py + ty * hl)], fill=col, width=w_pad)
    # The ball, with a trail in the colour of its last hitter (side 1, pink).
    bx, by = c + R * 0.16, c - R * 0.12
    trail = rgb(COLORS[1])
    for k in range(10):
        f = k / 10
        tx_, ty_ = bx - R * 0.42 * (1 - f), by + R * 0.3 * (1 - f)
        r = S * 0.012 * (0.4 + f)
        d.ellipse([tx_ - r, ty_ - r, tx_ + r, ty_ + r], fill=tuple(int(v * (0.3 + 0.7 * f)) for v in trail))
    br = S * 0.035
    d.ellipse([bx - br, by - br, bx + br, by + br], fill=(255, 255, 255))

    glow = lines.filter(ImageFilter.GaussianBlur(S * 0.02))
    base = Image.new("RGB", (S, S), VOID)
    from PIL import ImageChops

    img = ImageChops.add(base, glow)
    img = ImageChops.add(img, glow)
    img = ImageChops.lighter(img, lines)
    return img.resize((size, size), Image.LANCZOS)


def main():
    os.makedirs(OUT, exist_ok=True)
    for size, name, safe in [
        (192, "icon-192.png", 0.92),
        (512, "icon-512.png", 0.92),
        (180, "icon-180.png", 0.92),
        (512, "icon-maskable-512.png", 0.74),
    ]:
        motif(size, safe).save(os.path.join(OUT, name), optimize=True)
        print("wrote", name)


if __name__ == "__main__":
    main()
