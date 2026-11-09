/**
 * Image pixels, EPSG:32613, and EPSG:4326.
 *
 * JPEG pixel (u, v) uses the outer-corner origin: upper left is (0, 0),
 * u increases right, v increases down, and pixel centers are (i+0.5, j+0.5).
 * Geographic pairs are always [longitude, latitude].
 *
 * The JPEG affine is the deterministic full-frame resize. Sampled registration
 * supports that image transform. It is not a surveyed ground calibration.
 * Callers must not treat a roundtrip or a correlation residual as
 * safe_for_authoritative_measurement.
 */

export const IMAGE_WIDTH = 8000;
export const IMAGE_HEIGHT = 10592;
export const ORIGINAL_WIDTH = 16623;
export const ORIGINAL_HEIGHT = 22008;

/** GDAL geotransform for the original GeoTIFF, read from its header. */
export const ORIGINAL_GEOTRANSFORM = Object.freeze([
  504080.16032596945,
  0.03999779337797848,
  0,
  4271568.686183937,
  0,
  -0.039999547268190196,
]);

/**
 * Candidate GDAL geotransform for the 8000×10592 JPEG.
 * Deterministic full-frame resize. Sampled image-transform validated; not a survey.
 */
export const JPEG_CANDIDATE_GEOTRANSFORM = Object.freeze([
  504080.16032596945,
  0.08311041491526702,
  0,
  4271568.686183937,
  0,
  -0.08311084179364896,
]);

const A = 6378137;
const F = 1 / 298.257223563;
const B = A * (1 - F);
const E2 = (A * A - B * B) / (A * A);
const EP2 = (A * A - B * B) / (B * B);
const K0 = 0.9996;
const LON0 = (-105 * Math.PI) / 180;
const FALSE_EASTING = 500000;
const FALSE_NORTHING = 0;

function meridianArc(lat) {
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  return A * (
    (1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256) * lat
    - ((3 * E2) / 8 + (3 * e4) / 32 + (45 * e6) / 1024) * Math.sin(2 * lat)
    + ((15 * e4) / 256 + (45 * e6) / 1024) * Math.sin(4 * lat)
    - ((35 * e6) / 3072) * Math.sin(6 * lat)
  );
}

/** [longitude, latitude] degrees → [easting, northing] metres, UTM zone 13N. */
export function lonLatToUtm13n(lonDeg, latDeg) {
  const lat = (latDeg * Math.PI) / 180;
  const lon = (lonDeg * Math.PI) / 180;
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const tanLat = Math.tan(lat);
  const n = A / Math.sqrt(1 - E2 * sinLat * sinLat);
  const t = tanLat * tanLat;
  const c = EP2 * cosLat * cosLat;
  const a = (lon - LON0) * cosLat;
  const m = meridianArc(lat);
  const easting = FALSE_EASTING + K0 * n * (
    a
    + ((1 - t + c) * a ** 3) / 6
    + ((5 - 18 * t + t * t + 72 * c - 58 * EP2) * a ** 5) / 120
  );
  const northing = FALSE_NORTHING + K0 * (
    m + n * tanLat * (
      (a * a) / 2
      + ((5 - t + 9 * c + 4 * c * c) * a ** 4) / 24
      + ((61 - 58 * t + t * t + 600 * c - 330 * EP2) * a ** 6) / 720
    )
  );
  return [easting, northing];
}

/** [easting, northing] metres, UTM zone 13N → [longitude, latitude] degrees. */
export function utm13nToLonLat(easting, northing) {
  const e4 = E2 * E2;
  const e6 = e4 * E2;
  const e1 = (1 - Math.sqrt(1 - E2)) / (1 + Math.sqrt(1 - E2));
  const x = easting - FALSE_EASTING;
  const y = northing - FALSE_NORTHING;
  const m = y / K0;
  const mu = m / (A * (1 - E2 / 4 - (3 * e4) / 64 - (5 * e6) / 256));
  const lat1 = mu
    + ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu)
    + ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu)
    + ((151 * e1 ** 3) / 96) * Math.sin(6 * mu)
    + ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const sin1 = Math.sin(lat1);
  const cos1 = Math.cos(lat1);
  const tan1 = Math.tan(lat1);
  const n1 = A / Math.sqrt(1 - E2 * sin1 * sin1);
  const t1 = tan1 * tan1;
  const c1 = EP2 * cos1 * cos1;
  const r1 = (A * (1 - E2)) / (1 - E2 * sin1 * sin1) ** 1.5;
  const d = x / (n1 * K0);
  const lat = lat1 - ((n1 * tan1) / r1) * (
    (d * d) / 2
    - ((5 + 3 * t1 + 10 * c1 - 4 * c1 * c1 - 9 * EP2) * d ** 4) / 24
    + ((61 + 90 * t1 + 298 * c1 + 45 * t1 * t1 - 252 * EP2 - 3 * c1 * c1) * d ** 6) / 720
  );
  const lon = LON0 + (
    d
    - ((1 + 2 * t1 + c1) * d ** 3) / 6
    + ((5 - 2 * c1 + 28 * t1 - 3 * c1 * c1 + 8 * EP2 + 24 * t1 * t1) * d ** 5) / 120
  ) / cos1;
  return [(lon * 180) / Math.PI, (lat * 180) / Math.PI];
}

/** Outer-corner pixel → UTM. Rotation terms are honored. */
export function imageToUtm(u, v, geotransform = JPEG_CANDIDATE_GEOTRANSFORM) {
  const gt = geotransform;
  return [
    gt[0] + u * gt[1] + v * gt[2],
    gt[3] + u * gt[4] + v * gt[5],
  ];
}

/** UTM → outer-corner pixel. Requires a non-zero axis-aligned scale. */
export function utmToImage(easting, northing, geotransform = JPEG_CANDIDATE_GEOTRANSFORM) {
  const gt = geotransform;
  if (gt[2] !== 0 || gt[4] !== 0) {
    throw new Error("Rotated geotransforms are not inverted by this viewer");
  }
  return [(easting - gt[0]) / gt[1], (northing - gt[3]) / gt[5]];
}

/** Image pixel → [longitude, latitude]. */
export function imageToLonLat(u, v, geotransform = JPEG_CANDIDATE_GEOTRANSFORM) {
  const [easting, northing] = imageToUtm(u, v, geotransform);
  return utm13nToLonLat(easting, northing);
}

/** [longitude, latitude] → image pixel. */
export function lonLatToImage(lon, lat, geotransform = JPEG_CANDIDATE_GEOTRANSFORM) {
  const [easting, northing] = lonLatToUtm13n(lon, lat);
  return utmToImage(easting, northing, geotransform);
}

/**
 * Web-Mercator slippy indices. Present only so tests can prove the viewer
 * does not use them. Do not request imagery with this function.
 */
export function webMercatorTileIndex(lon, lat, zoom) {
  const latRad = (lat * Math.PI) / 180;
  const n = 2 ** zoom;
  const x = Math.floor(((lon + 180) / 360) * n);
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { z: zoom, x, y, scheme: "EPSG:3857" };
}
