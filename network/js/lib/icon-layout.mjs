/** Screen size for a Google Earth icon. Stays readable when zoomed out and a little larger when zoomed in. */
export function iconPixels(iconScale = 1, viewScale = 0.1) {
  const scale = Number(iconScale) > 0 ? Number(iconScale) : 1;
  const view = Number(viewScale) > 0 ? Number(viewScale) : 0.1;
  const t = Math.min(1, Math.max(0, (Math.log(view) - Math.log(0.05)) / (Math.log(1) - Math.log(0.05))));
  return Math.max(20, Math.min(36, (20 + t * 16) * scale));
}

/**
 * Place a hit target so the icon hotSpot sits on the map point.
 * KML y is measured from the bottom. Missing hotSpot uses the center.
 */
export function placeIcon(x, y, iconScale, viewScale, hotspot) {
  const size = iconPixels(iconScale, viewScale);
  const hit = Math.max(32, Math.ceil(size));
  const pad = (hit - size) / 2;
  const hx = hotspotX(size, hotspot);
  const hy = hotspotY(size, hotspot);
  return {
    size,
    hit,
    left: x - (pad + hx),
    top: y - (pad + hy),
    imageLeft: pad,
    imageTop: pad,
  };
}

function axis(size, value, units, fromEnd) {
  const n = Number(value);
  const amount = Number.isFinite(n) ? n : 0.5;
  if (units === "pixels") return fromEnd ? size - amount : amount;
  if (units === "insetPixels") return fromEnd ? amount : size - amount;
  const fraction = Number.isFinite(n) ? n : 0.5;
  return fromEnd ? size * (1 - fraction) : size * fraction;
}

function hotspotX(size, hotspot) {
  if (!hotspot) return size / 2;
  return axis(size, hotspot.x, hotspot.xunits || "fraction", false);
}

function hotspotY(size, hotspot) {
  if (!hotspot) return size / 2;
  return axis(size, hotspot.y, hotspot.yunits || "fraction", true);
}
