import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { loadPlan, savePlan } from "../editor/store.mjs";
import { ellipsoidalDistanceM, formatFeet, metersToFeet } from "../network/js/lib/distance.mjs";
import { measureLink, planFromPublic, resetCablePath, setCablePath, verticesForLink } from "../network/js/lib/plan.mjs";
import { pathRows, verifiedRoute } from "../network/js/lib/plain-path.mjs";
import { buildPublicSnapshot, sanitizeVertices } from "../network/js/lib/sanitize.mjs";

const asbuilt = JSON.parse(readFileSync(new URL("../network/data/asbuilt_public.json", import.meta.url)));
const metadata = JSON.parse(readFileSync(new URL("../network/data/metadata.json", import.meta.url)));
const friendly = JSON.parse(readFileSync(new URL("../network/data/public_friendly_device_details.json", import.meta.url)));
const forbidden = [path.resolve("network"), path.resolve("dist"), path.resolve("editor")];

function ethernet(plan) {
  return plan.asbuilt.links.find((link) => link.medium === "wired-ethernet");
}

test("a bent cable is the sum of its geodesic pieces, shown in whole feet", () => {
  const plan = planFromPublic(asbuilt, metadata);
  const link = ethernet(plan);
  const [start, end] = verticesForLink(plan, link);
  const bend = { lon: (start.lon + end.lon) / 2 + 0.002, lat: (start.lat + end.lat) / 2 + 0.002 };
  const bent = setCablePath(plan, link.id, [bend], [{ slope_rise_m: 3, vertical_drop_m: 2, slack_m: 1, service_loop_m: 0.5 }]);
  const metrics = measureLink(bent, link, metadata);
  const straight = ellipsoidalDistanceM(start.lon, start.lat, end.lon, end.lat);
  const via = ellipsoidalDistanceM(start.lon, start.lat, bend.lon, bend.lat) + ellipsoidalDistanceM(bend.lon, bend.lat, end.lon, end.lat);
  assert.ok(via > straight);
  assert.ok(Math.abs(metrics.totals.horizontal_ellipsoidal_m - via) < 1e-6);
  assert.equal(metrics.segment_count, 2);
  const sloped = Math.hypot(ellipsoidalDistanceM(start.lon, start.lat, bend.lon, bend.lat), 3);
  assert.ok(Math.abs(metrics.segments[0].terrain_slope_m - sloped) < 1e-6);
  assert.equal(formatFeet(metrics.totals.physical_cable_m), `${Math.round(metersToFeet(metrics.totals.physical_cable_m))} ft`);
  assert.match(formatFeet(30.48), /^100 ft$/);
  const wireless = plan.asbuilt.links.find((item) => item.medium === "airmax-ptp");
  assert.throws(() => setCablePath(plan, wireless.id, [bend], []), /Ethernet cable/);
});

test("reset removes bends and keeps the summed allowances", () => {
  const plan = planFromPublic(asbuilt, metadata);
  const link = ethernet(plan);
  const [start, end] = verticesForLink(plan, link);
  const bend = { lon: start.lon + 0.001, lat: start.lat + 0.001 };
  const bent = setCablePath(plan, link.id, [bend], [
    { slack_m: 1, vertical_drop_m: 2, slope_rise_m: 0, service_loop_m: 0 },
    { slack_m: 0.5, vertical_drop_m: 0, slope_rise_m: 4, service_loop_m: 0.25 },
  ]);
  const straight = resetCablePath(bent, link.id);
  assert.equal(straight.cable_paths[link.id].intermediates.length, 0);
  assert.equal(straight.cable_paths[link.id].segments[0].slack_m, 1.5);
  assert.equal(straight.cable_paths[link.id].segments[0].vertical_drop_m, 2);
  assert.equal(straight.cable_paths[link.id].segments[0].slope_rise_m, 4);
  assert.equal(verticesForLink(straight, link).length, 2);
  assert.deepEqual(verticesForLink(straight, link)[0], { lon: start.lon, lat: start.lat });
  assert.deepEqual(verticesForLink(straight, link)[1], { lon: end.lon, lat: end.lat });
});

test("published bends are longitude and latitude only, and junk is refused", () => {
  const plan = planFromPublic(asbuilt, metadata);
  const link = ethernet(plan);
  const bend = { lon: -104.9486, lat: 38.5869 };
  const bent = setCablePath(plan, link.id, [bend], [{ slack_m: 2 }]);
  const exported = buildPublicSnapshot(asbuilt, bent, {
    confirmed: true,
    deviceIds: [link.child],
    includeConnectivity: true,
    includeGroups: false,
  });
  const snapshot = exported.snapshot;
  const published = snapshot.links.find((item) => item.id === link.id);
  assert.deepEqual(published.vertices, [bend]);
  assert.equal(published.slack_m, undefined);
  assert.equal(snapshot.cable_paths, undefined);
  const restored = planFromPublic(snapshot, metadata);
  assert.deepEqual(restored.cable_paths[link.id].intermediates, [bend]);
  assert.equal(restored.asbuilt.links.find((item) => item.id === link.id).vertices, undefined);
  assert.throws(() => sanitizeVertices([{ lon: 1, lat: 2, note: "secret" }]), /longitude and latitude/);
  assert.throws(() => sanitizeVertices([{ lon: "north", lat: 1 }]), /geographic range|longitude/);
  assert.throws(() => sanitizeVertices(Array.from({ length: 25 }, () => ({ lon: 0, lat: 0 }))), /Too many/);
  const rows = pathRows(verifiedRoute(friendly.devices_by_id["000-USW-24-PoE"], asbuilt.links));
  assert.equal(rows[1].via, "Ethernet cable");
  assert.equal(rows[1].extra, "SFP+ port");
});

test("cable bends survive the safe save and reload", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "md-bend-"));
  try {
    const plan = planFromPublic(asbuilt, metadata);
    const link = ethernet(plan);
    const bend = { lon: -104.9482, lat: 38.5871 };
    const bent = setCablePath(plan, link.id, [bend], []);
    await savePlan(dir, bent, forbidden);
    const loaded = await loadPlan(dir);
    assert.deepEqual(loaded.cable_paths[link.id].intermediates, [bend]);
    assert.equal(JSON.stringify(loaded).includes("secret"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
