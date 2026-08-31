#!/usr/bin/env python3
"""
Renders the Habba mark to the PNGs the app ships.

The mark is vector in the design (`Habba Logo.dc.html`), but react-native-svg
is not a dependency here and adding it means a native rebuild for what is a
handful of static images. So the paths live in this script and the raster
output is committed — regenerate with:

    python3 apps/customer/scripts/generate-logo-assets.py

Kept as a script rather than hand-exported images so the geometry has a single
source of truth: if the mark changes, this changes, and every size follows.

The two strokes are the gust the name means — هبّة is both a gust of wind and
rushing to someone's aid (CLAUDE.md §0). They are never redrawn by hand.
"""

from __future__ import annotations

import re
from pathlib import Path

from PIL import Image, ImageDraw

# --- brand -----------------------------------------------------------------
PETROL = (18, 81, 79)      # #12514F
SAND = (232, 163, 61)      # #E8A33D
CREAM = (246, 243, 237)    # #F6F3ED

# Paths from the design file, in its 200x200 viewBox. Two strokes: the leading
# gust and the shorter one trailing it.
PRIMARY = "M180 106 C 132 40, 64 20, 4 26 C 70 74, 142 116, 162 150 C 182 154, 194 124, 180 106 Z"
SECONDARY = "M130 162 C 98 122, 62 106, 28 108 C 66 140, 96 156, 112 180 C 130 186, 142 178, 130 162 Z"

VIEWBOX = 200.0
# 4x then downsample: PIL has no antialiased polygon fill, and the mark is all
# long curved edges, which alias badly at icon sizes.
SUPERSAMPLE = 4

NUMBER = re.compile(r"-?\d+\.?\d*")


def _cubic(p0, p1, p2, p3, steps=64):
    """Flatten one cubic segment. 64 steps is well past visible at 1024px."""
    out = []
    for i in range(steps + 1):
        t = i / steps
        u = 1 - t
        x = u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0]
        y = u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]
        out.append((x, y))
    return out


def flatten(path: str) -> list[tuple[float, float]]:
    """`M x y (C x1 y1 x2 y2 x y)+ Z` to a polygon. Only the forms used above."""
    nums = [float(n) for n in NUMBER.findall(path)]
    start = (nums[0], nums[1])
    points = [start]
    cursor = start
    rest = nums[2:]

    for i in range(0, len(rest) - 5, 6):
        c1 = (rest[i], rest[i + 1])
        c2 = (rest[i + 2], rest[i + 3])
        end = (rest[i + 4], rest[i + 5])
        points.extend(_cubic(cursor, c1, c2, end)[1:])
        cursor = end

    return points


def draw_mark(size: int, primary_fill, secondary_fill, scale: float, background=None):
    """The mark centred on a square canvas, at `scale` of its width."""
    ss = size * SUPERSAMPLE
    image = Image.new("RGBA", (ss, ss), background if background else (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    span = ss * scale
    offset = (ss - span) / 2
    unit = span / VIEWBOX

    for path, fill in ((PRIMARY, primary_fill), (SECONDARY, secondary_fill)):
        draw.polygon(
            [(offset + x * unit, offset + y * unit) for x, y in flatten(path)],
            fill=fill,
        )

    return image.resize((size, size), Image.LANCZOS)


def main() -> None:
    app = Path(__file__).resolve().parent.parent
    assets = app / "assets"
    assets.mkdir(exist_ok=True)

    # The in-app mark belongs to the design system, not to one app — the
    # provider app needs the same image. Launcher icons stay app-owned because
    # each app ships its own.
    shared = app.parent.parent / "packages" / "ui" / "assets"
    shared.mkdir(parents=True, exist_ok=True)

    # iOS app icon. Full-bleed petrol; iOS applies its own corner mask, so
    # rounding it here would show as a dark ring inside the real corners.
    # 0.788 is the mark-to-tile ratio the design's own app-icon lockup uses.
    launcher = draw_mark(1024, CREAM, SAND, 0.788, background=(*PETROL, 255))
    launcher.save(assets / "icon.png")

    # ⚠️ This project has a committed `ios/` directory (bare workflow), so
    # `expo run:ios` never regenerates native assets from app.json — that only
    # happens on `expo prebuild`. The asset catalog is what actually ships, and
    # writing app.json alone leaves the default blank tile on the springboard.
    #
    # Flattened to RGB: the App Store rejects an icon with an alpha channel,
    # and the simulator renders one with a black background.
    icon_set = app / "ios" / "hbh" / "Images.xcassets" / "AppIcon.appiconset"
    if icon_set.is_dir():
        launcher.convert("RGB").save(icon_set / "App-Icon-1024x1024@1x.png")
        print(f"wrote iOS asset catalog icon to {icon_set}")

    # Android adaptive foreground: transparent, and smaller because the
    # launcher crops to a shape that can be as tight as a circle.
    draw_mark(1024, CREAM, SAND, 0.52).save(assets / "adaptive-icon.png")

    # Splash: the mark alone. The background colour is set in app.json so the
    # splash and the app's first screen match exactly.
    draw_mark(512, CREAM, SAND, 0.80).save(assets / "splash-icon.png")

    # Favicon for the web build.
    draw_mark(48, CREAM, SAND, 0.80, background=(*PETROL, 255)).save(assets / "favicon.png")

    # In-app marks. Two colourways rather than one tinted image: the mark is
    # two-tone by design and Image tintColor would flatten it to a silhouette.
    for name, primary, secondary in (
        ("mark-on-light", PETROL, SAND),
        ("mark-on-dark", CREAM, SAND),
    ):
        for suffix, factor in (("", 1), ("@2x", 2), ("@3x", 3)):
            draw_mark(96 * factor, primary, secondary, 1.0).save(shared / f"{name}{suffix}.png")

    print(f"wrote launcher icons to {assets}")
    print(f"wrote shared marks to {shared}")


if __name__ == "__main__":
    main()
