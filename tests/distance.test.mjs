import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateCalibration } from "../network/js/lib/calibration.mjs";
import {
  INTERNATIONAL_FOOT_M,
  composeSegment,
  ellipsoidalDistanceM,
  gridDistanceM,
  measureRoute,
  metersToFeet,
} from "../network/js/lib/distance.mjs";

const golden = JSON.parse(readFileSync(new URL("./fixtures/geodesy_golden.json", import.meta.url)));
const asbuilt = JSON.parse(readFileSync(new URL("../network/data/asbuilt_public.json", import.meta.url)));
const metadata = JSON.parse(readFileSync(new URL("../network/data/metadata.json", import.meta.url)));
const claim = evaluateCalibration(metadata);

test("international foot is exactly 0.3048 metres", () => {
  assert.equal(INTERNATIONAL_FOOT_M, 0.3048);
  assert.equal(metersToFeet(0.3048), 1);
  assert.equal(metersToFeet(1), 1 / 0.3048);
});

function segmentLabel(metres, grid) {
  return `ellipsoidal ${metres} m; grid ${grid} m`;
}

test("published site separations match ellipsoidal segment lengths", () => {
  for (const pair of golden.pairs) {
    const metres = ellipsoidalDistanceM(pair.a_lon, pair.a_lat, pair.b_lon, pair.b_lat);
    const grid = gridDistanceM(pair.a_lon, pair.a_lat, pair.b_lon, pair.b_lat);
    assert.ok(Math.abs(metres - pair.ellipsoidal_m) < 0.002, `${pair.a} ${metres}`);
    assert.ok(Math.abs(metres - pair.published_m) < 0.01);
    assert.ok(Math.abs(grid - pair.grid_utm_m) < 0.002);
    assert.match(segmentLabel(metres, grid), /ellipsoidal/);
    assert.match(segmentLabel(metres, grid), /grid/);
    if (pair.published_m > 10) assert.ok(Math.abs(metres - grid) > 0.001);
  }
});

test("a bent route sums every segment and does not collapse to the chord", () => {
  const route = measureRoute(golden.bend_route.vertices, [], claim);
  assert.equal(route.segment_count, 2);
  assert.equal(route.segments.length, golden.bend_route.vertices.length - 1);
  route.segments.forEach((segment, index) => {
    assert.ok(Math.abs(segment.horizontal_ellipsoidal_m - golden.bend_route.segment_ellipsoidal_m[index]) < 0.002);
    assert.ok(Math.abs(segment.horizontal_grid_utm_m - golden.bend_route.segment_grid_utm_m[index]) < 0.002);
    assert.equal(segment.horizontal_ellipsoidal_ft, segment.horizontal_ellipsoidal_m / 0.3048);
    assert.equal(segment.physical_cable_ft, segment.physical_cable_m / 0.3048);
  });
  assert.ok(Math.abs(route.totals.horizontal_ellipsoidal_m - golden.bend_route.sum_ellipsoidal_m) < 0.002);
  assert.ok(Math.abs(route.chord_ellipsoidal_m - golden.bend_route.chord_ellipsoidal_m) < 0.002);
  assert.ok(route.totals.horizontal_ellipsoidal_m - route.chord_ellipsoidal_m > 50);
  assert.equal(route.safe_for_authoritative_measurement, false);
  assert.equal(route.label, "Approximate horizontal distance; ground accuracy unverified");
});

test("vertical rise, slack, and service loop stay distinct from horizontal distance", () => {
  const segment = composeSegment({
    horizontal_ellipsoidal_m: 4,
    horizontal_grid_utm_m: 4,
    vertical_rise_m: 3,
    slack_m: 1,
    service_loop_m: 0.5,
  });
  assert.equal(segment.horizontal_ellipsoidal_m, 4);
  assert.equal(segment.terrain_slope_m, 4);
  assert.equal(segment.vertical_drop_m, 3);
  assert.equal(segment.physical_cable_m, 8.5);
  assert.equal(segment.physical_cable_ft, 8.5 / 0.3048);
  const sloped = composeSegment({
    horizontal_ellipsoidal_m: 4,
    horizontal_grid_utm_m: 4,
    slope_rise_m: 3,
  });
  assert.equal(sloped.terrain_slope_m, 5);
  assert.equal(sloped.physical_cable_m, 5);
  assert.throws(() => composeSegment({ horizontal_ellipsoidal_m: 4, vertical_rise_m: -3 }), /Vertical drop/);
  const angle = golden.right_angle_grid;
  const route = measureRoute([
    angle.p0,
    angle.p1,
    { ...angle.p1, lat: angle.p2.lat, lon: angle.p1.lon },
  ], [
    { vertical_rise_m: 0, slack_m: 0, service_loop_m: 0 },
    { vertical_rise_m: 3, slack_m: 1, service_loop_m: 0.5 },
  ], claim);
  assert.equal(route.segments.length, 2);
  assert.ok(Math.abs(route.segments[0].horizontal_ellipsoidal_m - angle.seg_ellipsoidal_m[0]) < 0.01);
  assert.equal(route.segments[1].terrain_slope_m, route.segments[1].horizontal_ellipsoidal_m);
  assert.ok(Math.abs(route.segments[1].physical_cable_m - (route.segments[1].horizontal_ellipsoidal_m + 4.5)) < 1e-6);
  const slopedRoute = measureRoute([angle.p0, angle.p1], [{ slope_rise_m: 3, vertical_drop_m: 2, slack_m: 1, service_loop_m: 0.5 }], claim);
  const span = slopedRoute.segments[0];
  assert.ok(Math.abs(span.terrain_slope_m - Math.hypot(span.horizontal_ellipsoidal_m, 3)) < 1e-6);
  assert.ok(Math.abs(span.physical_cable_m - (span.terrain_slope_m + 2 + 1 + 0.5)) < 1e-6);
  assert.throws(() => measureRoute([angle.p0, angle.p1], [{ slope_rise_m: -1 }], claim), /Slope rise/);
});

test("every measurable as-built link has a finite segment in feet and metres", () => {
  const byId = new Map(asbuilt.devices.map((device) => [device.id, device]));
  const secom = asbuilt.wan.find((entry) => entry.id === "SECOM").map_pin.coords;
  let measured = 0;
  for (const link of asbuilt.links) {
    const a = link.parent === "SECOM" ? secom : byId.get(link.parent)?.coords;
    const b = byId.get(link.child)?.coords;
    if (!a || !b) {
      assert.equal(link.medium, "wan");
      assert.notEqual(link.parent, "SECOM");
      continue;
    }
    const route = measureRoute([
      { lon: a.lon, lat: a.lat },
      { lon: b.lon, lat: b.lat },
    ], [{ vertical_rise_m: 0, slack_m: 0, service_loop_m: 0 }], claim);
    assert.equal(route.segments.length, 1);
    const segment = route.segments[0];
    assert.equal(Number.isFinite(segment.horizontal_ellipsoidal_m), true);
    assert.ok(segment.horizontal_ellipsoidal_m >= 0);
    assert.equal(segment.horizontal_ellipsoidal_ft, segment.horizontal_ellipsoidal_m / 0.3048);
    assert.equal(segment.horizontal_grid_utm_ft, segment.horizontal_grid_utm_m / 0.3048);
    assert.equal(segment.terrain_slope_m, segment.horizontal_ellipsoidal_m);
    assert.equal(segment.physical_cable_m, segment.horizontal_ellipsoidal_m);
    measured += 1;
  }
  assert.equal(measured, 69);
  assert.equal(asbuilt.links.length, 72);
});
