/**
 * Route lengths. Every consecutive segment is measured. Endpoint-only chords
 * are reported separately and are never substituted for the segment sum.
 *
 * Horizontal ellipsoidal metres use the WGS84 inverse. Grid metres are the
 * straight UTM zone 13N length of the same segment and are labelled as grid,
 * not ground. A vertical pole drop is added to the horizontal length. An explicit
 * slope rise is the only allowance combined as a hypotenuse. Slack and a service
 * loop are added after that. None of these numbers become surveyed just because
 * they are numerically consistent.
 */

import { lonLatToUtm13n } from "./projection.mjs";

export const INTERNATIONAL_FOOT_M = 0.3048;

export function metersToFeet(meters) {
  return meters / INTERNATIONAL_FOOT_M;
}

export function feetToMeters(feet) {
  return feet * INTERNATIONAL_FOOT_M;
}

/** WGS84 Vincenty inverse distance in metres. */
export function ellipsoidalDistanceM(lon1, lat1, lon2, lat2) {
  if (lon1 === lon2 && lat1 === lat2) return 0;
  const f = 1 / 298.257223563;
  const a = 6378137;
  const b = a * (1 - f);
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const L = ((lon2 - lon1) * Math.PI) / 180;
  const u1 = Math.atan((1 - f) * Math.tan(phi1));
  const u2 = Math.atan((1 - f) * Math.tan(phi2));
  const sinU1 = Math.sin(u1);
  const cosU1 = Math.cos(u1);
  const sinU2 = Math.sin(u2);
  const cosU2 = Math.cos(u2);
  let lambda = L;
  let sinSigma = 0;
  let cosSigma = 0;
  let sigma = 0;
  let sinAlpha = 0;
  let cos2Alpha = 0;
  let cos2SigmaM = 0;
  for (let i = 0; i < 120; i += 1) {
    const sinLambda = Math.sin(lambda);
    const cosLambda = Math.cos(lambda);
    sinSigma = Math.hypot(
      cosU2 * sinLambda,
      cosU1 * sinU2 - sinU1 * cosU2 * cosLambda,
    );
    if (sinSigma === 0) return 0;
    cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda;
    sigma = Math.atan2(sinSigma, cosSigma);
    sinAlpha = (cosU1 * cosU2 * sinLambda) / sinSigma;
    cos2Alpha = 1 - sinAlpha * sinAlpha;
    cos2SigmaM = cos2Alpha === 0 ? 0 : cosSigma - (2 * sinU1 * sinU2) / cos2Alpha;
    const C = (f / 16) * cos2Alpha * (2 + f * (4 - 3 * cos2Alpha));
    const next = L + (1 - C) * f * sinAlpha * (
      sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM))
    );
    if (Math.abs(next - lambda) < 1e-12) {
      lambda = next;
      break;
    }
    lambda = next;
  }
  const uSq = cos2Alpha * ((a * a - b * b) / (b * b));
  const capA = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
  const capB = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));
  const deltaSigma = capB * sinSigma * (
    cos2SigmaM + (capB / 4) * (
      cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)
      - (capB / 6) * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (-3 + 4 * cos2SigmaM * cos2SigmaM)
    )
  );
  return b * capA * (sigma - deltaSigma);
}

export function gridDistanceM(lon1, lat1, lon2, lat2) {
  const [e1, n1] = lonLatToUtm13n(lon1, lat1);
  const [e2, n2] = lonLatToUtm13n(lon2, lat2);
  return Math.hypot(e2 - e1, n2 - n1);
}

function given(value) {
  return !(value == null || value === "");
}

function allowance(value, name) {
  if (!given(value)) return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    const error = new Error(`${name} must be zero or positive`);
    error.code = "SEGMENT";
    throw error;
  }
  return number;
}

/**
 * Horizontal length stays the mapped geodesic. A vertical pole drop, slack,
 * and a service loop are added afterwards. Only an explicit slope rise is
 * combined with the horizontal length as a hypotenuse.
 */
export function composeSegment(input) {
  const horizontal = allowance(input.horizontal_ellipsoidal_m, "Horizontal");
  const grid = allowance(input.horizontal_grid_utm_m, "Grid");
  const drop = allowance(given(input.vertical_drop_m) ? input.vertical_drop_m : input.vertical_rise_m, "Vertical drop");
  if (given(input.vertical_drop_m) && given(input.vertical_rise_m) && allowance(input.vertical_rise_m, "Vertical drop") !== drop) {
    const error = new Error("Vertical drop and vertical rise disagree");
    error.code = "SEGMENT";
    throw error;
  }
  const slope = allowance(input.slope_rise_m, "Slope rise");
  const slack = allowance(input.slack_m, "Slack");
  const loop = allowance(input.service_loop_m, "Service loop");
  const sloped = slope > 0 ? Math.hypot(horizontal, slope) : horizontal;
  const physical = sloped + drop + slack + loop;
  return {
    horizontal_ellipsoidal_m: horizontal,
    horizontal_ellipsoidal_ft: metersToFeet(horizontal),
    horizontal_grid_utm_m: grid,
    horizontal_grid_utm_ft: metersToFeet(grid),
    vertical_drop_m: drop,
    vertical_drop_ft: metersToFeet(drop),
    vertical_rise_m: drop,
    vertical_rise_ft: metersToFeet(drop),
    slope_rise_m: slope,
    slope_rise_ft: metersToFeet(slope),
    terrain_slope_m: sloped,
    terrain_slope_ft: metersToFeet(sloped),
    slack_m: slack,
    slack_ft: metersToFeet(slack),
    service_loop_m: loop,
    service_loop_ft: metersToFeet(loop),
    physical_cable_m: physical,
    physical_cable_ft: metersToFeet(physical),
  };
}

function addInto(total, segment) {
  for (const key of Object.keys(segment)) {
    total[key] = (total[key] || 0) + segment[key];
  }
  return total;
}

/**
 * Measure a polyline. vertices are {lon, lat} in order.
 * extras[i] applies to the segment from vertices[i] to vertices[i+1].
 */
export function measureRoute(vertices, extras = [], claim = null) {
  if (!Array.isArray(vertices) || vertices.length < 2) {
    throw new Error("A route needs at least two vertices");
  }
  const segments = [];
  for (let i = 0; i < vertices.length - 1; i += 1) {
    const a = vertices[i];
    const b = vertices[i + 1];
    const extra = extras[i] || {};
    segments.push(composeSegment({
      horizontal_ellipsoidal_m: ellipsoidalDistanceM(a.lon, a.lat, b.lon, b.lat),
      horizontal_grid_utm_m: gridDistanceM(a.lon, a.lat, b.lon, b.lat),
      vertical_drop_m: extra.vertical_drop_m,
      vertical_rise_m: extra.vertical_rise_m,
      slope_rise_m: extra.slope_rise_m,
      slack_m: extra.slack_m,
      service_loop_m: extra.service_loop_m,
    }));
  }
  const totals = segments.reduce((total, segment) => addInto(total, segment), {});
  const chord = ellipsoidalDistanceM(
    vertices[0].lon,
    vertices[0].lat,
    vertices[vertices.length - 1].lon,
    vertices[vertices.length - 1].lat,
  );
  const authoritative = claim?.safe_for_authoritative_measurement === true && claim?.status === "validated";
  return {
    segments,
    totals,
    segment_count: segments.length,
    chord_ellipsoidal_m: chord,
    chord_ellipsoidal_ft: metersToFeet(chord),
    summed_not_chord: true,
    safe_for_authoritative_measurement: authoritative,
    label: claim?.distanceLabel || "Approximate horizontal distance; ground accuracy unverified",
  };
}

export function formatMetersFeet(meters) {
  if (!Number.isFinite(meters)) return "—";
  const feet = metersToFeet(meters);
  const digits = Math.abs(meters) >= 100 ? 1 : 2;
  return `${meters.toFixed(digits)} m · ${feet.toFixed(digits)} ft`;
}
