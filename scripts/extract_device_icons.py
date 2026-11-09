#!/usr/bin/env python3
"""Read a Google Earth KML for icon images and placemark style only.

The KML itself is not copied. Descriptions, notes, and other placemark text
are ignored. Output is deduplicated WebP icons plus a device-id map.
"""
import hashlib
import json
import sys
import urllib.request
import xml.etree.ElementTree as ET
from io import BytesIO
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
CANDIDATES = [
    Path("/home/ubuntu/.cursor/projects/workspace/uploads/Mountaindale_Network_2026-11-06.kml"),
    ROOT / "uploads" / "Mountaindale_Network_2026-11-06.kml",
    Path("uploads/Mountaindale_Network_2026-11-06.kml"),
]
DEVICES = ROOT / "network" / "data" / "asbuilt_public.json"
OUT_DIR = ROOT / "network" / "icons"
OUT_JSON = ROOT / "network" / "data" / "device_icons.json"


def local(tag):
    return tag.rsplit("}", 1)[-1]


def child_text(node, name):
    for child in list(node):
        if local(child.tag) == name and child.text:
            return child.text.strip()
    return None


def parse_icon_style(style):
    icon_style = next((child for child in list(style) if local(child.tag) == "IconStyle"), None)
    if icon_style is None:
        return None
    href = None
    for node in icon_style.iter():
        if local(node.tag) == "href" and node.text:
            href = node.text.strip()
            break
    if not href:
        return None
    scale_text = child_text(icon_style, "scale")
    try:
        scale = float(scale_text) if scale_text else 1.0
    except ValueError:
        scale = 1.0
    hotspot = None
    for child in list(icon_style):
        if local(child.tag) == "hotSpot":
            hotspot = {
                "x": float(child.get("x", "0.5")),
                "y": float(child.get("y", "0.5")),
                "xunits": child.get("xunits") or "fraction",
                "yunits": child.get("yunits") or "fraction",
            }
            break
    return {
        "href": href,
        "scale": scale,
        "color": child_text(icon_style, "color"),
        "hotspot": hotspot or {"x": 0.5, "y": 0.5, "xunits": "fraction", "yunits": "fraction"},
    }


def kml_color(value):
    if not value or len(value) != 8:
        return None
    try:
        alpha = int(value[0:2], 16)
        blue = int(value[2:4], 16)
        green = int(value[4:6], 16)
        red = int(value[6:8], 16)
    except ValueError:
        return None
    if (red, green, blue, alpha) == (255, 255, 255, 255):
        return None
    return red, green, blue, alpha


def load_bytes(href, failures):
    if href.startswith("data:image/"):
        try:
            payload = href.split(",", 1)[1]
            return base64_bytes(payload)
        except Exception:
            failures.append(href[:48])
            return None
    if href.startswith("https://earth.google.com/") or href.startswith("http://earth.google.com/"):
        try:
            request = urllib.request.Request(href, headers={"User-Agent": "MountaindaleIconFetch/1.0"})
            with urllib.request.urlopen(request, timeout=30) as response:
                data = response.read()
            if not data:
                raise ValueError("empty")
            return data
        except Exception as error:
            failures.append(f"{href} ({error.__class__.__name__})")
            return None
    failures.append(href[:80])
    return None


def base64_bytes(payload):
    import base64
    compact = "".join(payload.split())
    return base64.b64decode(compact)


def to_webp(raw, tint):
    image = Image.open(BytesIO(raw)).convert("RGBA")
    if max(image.size) > 512:
        image.thumbnail((256, 256))
    if tint:
        red, green, blue, alpha = tint
        pixels = image.load()
        for y in range(image.size[1]):
            for x in range(image.size[0]):
                pr, pg, pb, pa = pixels[x, y]
                pixels[x, y] = (
                    pr * red // 255,
                    pg * green // 255,
                    pb * blue // 255,
                    pa * alpha // 255,
                )
    buffer = BytesIO()
    image.save(buffer, format="WEBP", lossless=True, exact=True)
    return buffer.getvalue()


def main():
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else next((path for path in CANDIDATES if path.is_file()), None)
    if source is None or not source.is_file():
        print("KML not found. Looked in:")
        for path in CANDIDATES:
            print(f"  {path}")
        return 2
    devices = json.loads(DEVICES.read_text())["devices"]
    device_ids = [device["id"] for device in devices]
    root = ET.parse(source).getroot()
    styles = {}
    maps = {}
    for node in root.iter():
        name = local(node.tag)
        ident = node.get("id")
        if name == "Style" and ident:
            parsed = parse_icon_style(node)
            if parsed:
                styles[ident] = parsed
        elif name == "StyleMap" and ident:
            normal = None
            for pair in list(node):
                if local(pair.tag) != "Pair":
                    continue
                if child_text(pair, "key") == "normal":
                    normal = child_text(pair, "styleUrl")
            if normal:
                maps[ident] = normal

    def resolve(url, depth=0):
        if not url or depth > 6:
            return None
        frag = url.split("#")[-1]
        if frag in maps:
            return resolve(maps[frag], depth + 1)
        return styles.get(frag)

    records = []
    for node in root.iter():
        if local(node.tag) != "Placemark":
            continue
        placemark_name = child_text(node, "name")
        if not placemark_name:
            continue
        inline = next((child for child in list(node) if local(child.tag) == "Style"), None)
        icon = parse_icon_style(inline) if inline is not None else None
        if icon is None:
            icon = resolve(child_text(node, "styleUrl"))
        if icon:
            records.append((placemark_name, icon))

    by_name = {}
    ambiguous = []
    for placemark_name, icon in records:
        if placemark_name not in device_ids:
            continue
        previous = by_name.get(placemark_name)
        if previous is None:
            by_name[placemark_name] = icon
            continue
        same = previous["href"] == icon["href"] and previous.get("color") == icon.get("color")
        if not same:
            ambiguous.append(placemark_name)
            by_name[placemark_name] = None

    failures = []
    files = {}
    icons = {}
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for device_id in device_ids:
        icon = by_name.get(device_id)
        if icon is None:
            continue
        remote = icon["href"].startswith("http://") or icon["href"].startswith("https://")
        raw = load_bytes(icon["href"], failures)
        if raw is None:
            continue
        tint = None if remote else kml_color(icon.get("color"))
        tint_key = "" if tint is None else ",".join(str(part) for part in tint)
        digest = hashlib.sha256(raw + tint_key.encode()).hexdigest()[:16]
        filename = f"{digest}.webp"
        if filename not in files:
            files[filename] = to_webp(raw, tint)
            (OUT_DIR / filename).write_bytes(files[filename])
        icons[device_id] = {
            "file": filename,
            "scale": icon["scale"],
            "hotspot": icon["hotspot"],
        }

    unassigned = [device_id for device_id in device_ids if device_id not in icons]
    document = {
        "schema": "mountaindale.device_icons",
        "schema_version": "1.0.0",
        "icons": icons,
        "unassigned": unassigned,
        "ambiguous": sorted(set(ambiguous)),
    }
    OUT_JSON.write_text(json.dumps(document, indent=2) + "\n")
    print(f"devices {len(device_ids)}")
    print(f"with_icons {len(icons)}")
    print(f"without_icons {len(unassigned)}")
    print(f"ambiguous {sorted(set(ambiguous))}")
    print(f"unassigned {unassigned}")
    print(f"icon_files {len(files)}")
    print(f"fetch_failures {len(failures)}")
    for failure in failures:
        print(f"FAILED {failure}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
