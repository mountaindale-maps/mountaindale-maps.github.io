#!/usr/bin/env python3
"""Build the image-local JPEG tile pyramid for the registered 5980x8062 crop.

Tiles are not geographic XYZ. Zoom 5 is native: one tile pixel is one crop pixel.
The committed tiles are the registered pyramid. Rebuild only from the crop JPEG.
"""
from __future__ import annotations

import math
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "network" / "imagery" / "oct31_gimp_crop.jpg"
OUT = ROOT / "network" / "tiles"
WIDTH, HEIGHT = 5980, 8062
NATIVE_ZOOM = 5
TILE = 256


def main() -> None:
    Image.MAX_IMAGE_PIXELS = None
    src = Image.open(SRC).convert("RGB")
    if src.size != (WIDTH, HEIGHT):
        raise SystemExit(f"expected {WIDTH}x{HEIGHT}, got {src.size}")
    levels = {NATIVE_ZOOM: src}
    for z in range(NATIVE_ZOOM - 1, -1, -1):
        scale = 2 ** (NATIVE_ZOOM - z)
        nw = math.ceil(WIDTH / scale)
        nh = math.ceil(HEIGHT / scale)
        levels[z] = levels[z + 1].resize((nw, nh), Image.Resampling.BOX)
    count = 0
    for z, image in levels.items():
        tw, th = image.size
        nx = math.ceil(tw / TILE)
        ny = math.ceil(th / TILE)
        quality = 84 if z >= 5 else 70
        for x in range(nx):
            for y in range(ny):
                dest = OUT / str(z) / str(x) / f"{y}.jpg"
                dest.parent.mkdir(parents=True, exist_ok=True)
                left, upper = x * TILE, y * TILE
                crop = image.crop((left, upper, min(tw, left + TILE), min(th, upper + TILE)))
                tile = Image.new("RGB", (TILE, TILE), (255, 255, 255))
                tile.paste(crop, (0, 0))
                tile.save(dest, format="JPEG", quality=quality, optimize=False)
                count += 1
        print(f"z={z} grid={nx}x{ny} size={tw}x{th}", flush=True)
    if count != 1801:
        raise SystemExit(f"expected 1801 tiles, wrote {count}")
    print(f"wrote {count} tiles", flush=True)


if __name__ == "__main__":
    main()
