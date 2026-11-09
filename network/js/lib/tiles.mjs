/** Image-local tile pyramid. These indices are not EPSG:3857 XYZ tiles. */

export const TILE_SIZE = 256;
export const NATIVE_ZOOM = 5;
export const MIN_ZOOM = 0;

export function sourcePixelsPerTilePixel(zoom) {
  return 2 ** (NATIVE_ZOOM - zoom);
}

export function tileSpanSourcePixels(zoom) {
  return TILE_SIZE * sourcePixelsPerTilePixel(zoom);
}

/** Source pixel (u, v) → image-local tile index at zoom. */
export function imageTileIndex(u, v, zoom) {
  const span = tileSpanSourcePixels(zoom);
  return {
    z: zoom,
    x: Math.floor(u / span),
    y: Math.floor(v / span),
    scheme: "IMAGE_LOCAL_NOT_GEOGRAPHIC_XYZ",
  };
}

export function tileUrl(zoom, x, y) {
  return `tiles/${zoom}/${x}/${y}.jpg`;
}

/** Screen pixels per source pixel → pyramid level whose tile pixels match the screen. */
export function zoomForScale(scale, devicePixelRatio = 1) {
  const effective = Math.max(scale, 1e-9) * Math.max(devicePixelRatio, 1);
  const zoom = Math.round(NATIVE_ZOOM + Math.log2(effective));
  return Math.max(MIN_ZOOM, Math.min(NATIVE_ZOOM, zoom));
}

export function visibleTileRange(view, zoom, width, height, buffer = 1) {
  const halfW = width / 2 / view.scale;
  const halfH = height / 2 / view.scale;
  const u0 = view.u - halfW;
  const v0 = view.v - halfH;
  const u1 = view.u + halfW;
  const v1 = view.v + halfH;
  const span = tileSpanSourcePixels(zoom);
  const scale = sourcePixelsPerTilePixel(zoom);
  const maxX = Math.ceil(widthLimit(view) / scale / TILE_SIZE) - 1;
  const maxY = Math.ceil(heightLimit(view) / scale / TILE_SIZE) - 1;
  return {
    z: zoom,
    x0: Math.max(0, Math.floor(u0 / span) - buffer),
    y0: Math.max(0, Math.floor(v0 / span) - buffer),
    x1: Math.min(maxX, Math.floor(u1 / span) + buffer),
    y1: Math.min(maxY, Math.floor(v1 / span) + buffer),
  };
}

function widthLimit(view) {
  return view.imageWidth || 5980;
}

function heightLimit(view) {
  return view.imageHeight || 8062;
}

export function projectToScreen(u, v, view) {
  return {
    x: (u - view.u) * view.scale + view.width / 2,
    y: (v - view.v) * view.scale + view.height / 2,
  };
}

export function screenToSource(x, y, view) {
  return {
    u: (x - view.width / 2) / view.scale + view.u,
    v: (y - view.height / 2) / view.scale + view.v,
  };
}
