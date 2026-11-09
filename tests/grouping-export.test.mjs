import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clusterByScreen, spiderfyOffsets } from "../network/js/lib/cluster.mjs";
import { evaluateCalibration, proposeCalibration } from "../network/js/lib/calibration.mjs";
import { createHistory, redo, undo } from "../network/js/lib/history.mjs";
import {
  addLink,
  addNote,
  addPlannedDevice,
  assignGroup,
  linksUnchanged,
  measureLink,
  planFromPublic,
  setSegmentExtra,
} from "../network/js/lib/plan.mjs";
import { buildPublicSnapshot, describePublicEdits, scanPublicTree } from "../network/js/lib/sanitize.mjs";
import { highlightForDevice, highlightForGroup } from "../network/js/lib/topology-model.mjs";

const asbuilt = JSON.parse(readFileSync(new URL("../network/data/asbuilt_public.json", import.meta.url)));
const hierarchy = JSON.parse(readFileSync(new URL("../network/data/topology_hierarchy.json", import.meta.url)));
const metadata = JSON.parse(readFileSync(new URL("../network/data/metadata.json", import.meta.url)));
const baselineHash = createHash("sha256").update(readFileSync(new URL("../network/data/asbuilt_public.json", import.meta.url))).digest("hex");

test("shipped public files pass the sanitizer and keep the family-network label", () => {
  assert.deepEqual(scanPublicTree(asbuilt), []);
  assert.equal(asbuilt.devices.length, 70);
  assert.equal(asbuilt.devices.filter((device) => device.status === "active").length, 69);
  assert.equal(asbuilt.devices.find((device) => device.id === "088-UAP-M").status, "inactive");
  assert.equal(asbuilt.location_groups.length, 22);
  const families = asbuilt.wan.filter((entry) => entry.wan_role === "segregated");
  assert.equal(families.length, 2);
  for (const entry of families) {
    assert.equal(entry.label, "Private family network");
    assert.match(entry.public_summary, /Private family network/);
  }
  assert.equal(asbuilt.devices.find((device) => device.id === "049-USW-Flex").coords.alt_m, null);
  const nano = asbuilt.links.filter((link) => link.parent === "NanoSwitch").map((link) => link.child).sort();
  assert.deepEqual(nano, ["098-UAP-M", "098-UAP-M-Hideaway"]);
  assert.equal(asbuilt.links.some((link) => link.parent === "099-USW-Flex" && link.child.startsWith("098-UAP")), false);
});

test("moving a device between groups does not change links or path indexes", () => {
  const plan = planFromPublic(asbuilt, metadata);
  const next = assignGroup(plan, "045-UAP-U7O", "propane-shed");
  assert.equal(linksUnchanged(plan, next), true);
  assert.equal(next.asbuilt.devices.find((device) => device.id === "045-UAP-U7O").location_group, "propane-shed");
  assert.equal(next.asbuilt.location_groups.find((group) => group.id === "site-45").device_ids.includes("045-UAP-U7O"), false);
  assert.equal(next.asbuilt.location_groups.find((group) => group.id === "propane-shed").device_ids.includes("045-UAP-U7O"), true);
  assert.deepEqual(hierarchy.path_links["045-UAP-U7O"], hierarchy.path_links["045-UAP-U7O"]);
  assert.deepEqual(JSON.parse(JSON.stringify(plan.asbuilt.links)), JSON.parse(JSON.stringify(next.asbuilt.links)));
  const groupHover = highlightForGroup(next.asbuilt.location_groups.find((group) => group.id === "propane-shed"));
  assert.deepEqual(groupHover.linkIds, []);
  assert.ok(groupHover.deviceIds.includes("045-UAP-U7O"));
});

test("a second LAN parent is refused and the NanoSwitch path stays single", () => {
  const plan = planFromPublic(asbuilt, metadata);
  assert.throws(() => addLink(plan, { parent: "099-USW-Flex", child: "098-UAP-M", medium: "wired-ethernet" }), /DUAL UPLINK/);
  assert.equal(plan.asbuilt.links.some((link) => link.parent === "099-USW-Flex" && link.child === "098-UAP-M"), false);
  const replaced = addLink(plan, { parent: "099-USW-Flex", child: "098-UAP-M", medium: "wired-ethernet" }, { replaceParent: true });
  const parents = replaced.asbuilt.links.filter((link) => link.child === "098-UAP-M" && link.medium !== "wan");
  assert.equal(parents.length, 1);
  assert.equal(parents[0].parent, "099-USW-Flex");
});

test("screen clustering never writes display offsets back onto coordinates", () => {
  const device = Object.freeze({ id: "A", coords: Object.freeze({ lon: -104.95, lat: 38.59 }) });
  const other = Object.freeze({ id: "B", coords: Object.freeze({ lon: -104.95, lat: 38.59 }) });
  const clusters = clusterByScreen([
    { id: device.id, x: 10, y: 10 },
    { id: other.id, x: 12, y: 11 },
    { id: "C", x: 80, y: 10 },
  ], 20);
  assert.equal(clusters.some((cluster) => cluster.members.some((member) => member.id === "C") && cluster.members.length === 1), true);
  assert.equal(clusters.filter((cluster) => cluster.clustered).length, 1);
  assert.equal(clusters.find((cluster) => cluster.clustered).members.length, 2);
  const offsets = spiderfyOffsets(clusters[0].members.length, 40);
  assert.equal(offsets.length, 2);
  assert.deepEqual(device.coords, { lon: -104.95, lat: 38.59 });
  assert.notDeepEqual(offsets[0], offsets[1]);
});

test("inactive 088 has no path highlight and a selected device exposes ancestors", () => {
  const inactive = highlightForDevice(hierarchy, asbuilt.devices.find((device) => device.id === "088-UAP-M"));
  assert.deepEqual(inactive.linkIds, []);
  const office = highlightForDevice(hierarchy, asbuilt.devices.find((device) => device.id === "000-UAP-IW"));
  assert.ok(office.ancestors.includes("branch:office"));
  assert.ok(office.linkIds.includes(hierarchy.primary_wan_link_id));
  assert.ok(office.linkIds.includes("lnk:000-USW-24-PoE>000-UAP-IW"));
});

test("public export drops plans, notes, secrets, and unselected edits", () => {
  let plan = planFromPublic(asbuilt, metadata);
  plan = addPlannedDevice(plan, {
    id: "PLAN-AP-1",
    role: "ap",
    model: "Future AP password secret 10.1.2.3 AA:BB:CC:DD:EE:FF",
    coords: { lon: -104.95, lat: 38.58 },
  });
  plan = addNote(plan, { text: "Call 555-014-2211 about conduit in the Smith household. $40 per month." });
  plan.asbuilt.devices.find((device) => device.id === "045-UAP-U7O").local_private = {
    management_ip: "10.9.9.9",
    mac: "00:11:22:33:44:55",
    serial: "S/N ABC123",
  };
  plan.asbuilt.devices.find((device) => device.id === "045-UAP-U7O").public_summary = "password hidden";
  const moved = plan.asbuilt.devices.find((device) => device.id === "046-UAP-M");
  moved.coords = { ...moved.coords, lon: moved.coords.lon + 0.0001 };
  assert.throws(() => buildPublicSnapshot(asbuilt, plan, { confirmed: false, deviceIds: ["046-UAP-M"] }), /explicit reviewed selection/);
  assert.throws(() => buildPublicSnapshot(asbuilt, plan, { confirmed: true, deviceIds: ["045-UAP-U7O"] }), /SANITIZER|sanitizer/i);
  const clean = buildPublicSnapshot(asbuilt, plan, { confirmed: true, deviceIds: ["046-UAP-M"], includeGroups: false, includeConnectivity: false });
  const text = JSON.stringify(clean.snapshot);
  for (const forbidden of ["PLAN-AP-1", "10.1.2.3", "10.9.9.9", "00:11:22:33:44:55", "AA:BB:CC:DD:EE:FF", "Smith", "conduit", "555-014-2211", "password", "$40"]) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
  assert.equal(clean.snapshot.devices.find((device) => device.id === "046-UAP-M").coords.lon, moved.coords.lon);
  assert.equal(clean.snapshot.devices.find((device) => device.id === "045-UAP-U7O").public_summary, asbuilt.devices.find((device) => device.id === "045-UAP-U7O").public_summary);
  assert.equal(clean.excluded.planned_devices[0], "PLAN-AP-1");
  assert.equal(clean.excluded.notes, 1);
  assert.deepEqual(scanPublicTree(clean.snapshot), []);
  assert.equal(createHash("sha256").update(readFileSync(new URL("../network/data/asbuilt_public.json", import.meta.url))).digest("hex"), baselineHash);
});

test("segment allowances do not alter topology and undo restores the note", () => {
  let plan = planFromPublic(asbuilt, metadata);
  const linkId = "lnk:NanoSwitch>098-UAP-M";
  plan = setSegmentExtra(plan, linkId, 0, { vertical_rise_m: 3, slack_m: 1, service_loop_m: 0.5 });
  const metrics = measureLink(plan, plan.asbuilt.links.find((link) => link.id === linkId), evaluateCalibration(metadata));
  assert.equal(metrics.segments.length, 1);
  assert.equal(metrics.segments[0].terrain_slope_m, metrics.segments[0].horizontal_ellipsoidal_m);
  assert.ok(Math.abs(metrics.segments[0].physical_cable_m - (metrics.segments[0].horizontal_ellipsoidal_m + 4.5)) < 1e-6);
  assert.equal(linksUnchanged(planFromPublic(asbuilt, metadata), plan), true);
  plan = addNote(plan, { text: "Ask for a surveyed slack figure", id: "n1" });
  let history = createHistory(planFromPublic(asbuilt, metadata));
  history = { past: [history.present], present: plan, future: [] };
  history = undo(history);
  assert.equal(history.present.notes.length, 0);
  history = redo(history);
  assert.equal(history.present.notes[0].id, "n1");
  const described = describePublicEdits(asbuilt, plan);
  assert.equal(described.connectivity, false);
});

test("image-transform evidence does not open the survey gate", () => {
  const claim = evaluateCalibration(metadata);
  assert.equal(claim.safe_for_authoritative_measurement, false);
  assert.equal(claim.image_transform_validated, true);
  assert.equal(claim.horizontal_estimates_ready, true);
  assert.equal(claim.distanceLabel, "Approximate horizontal distance; ground accuracy unverified");
  const numeric = evaluateCalibration({
    ...metadata,
    safe_for_authoritative_measurement: true,
    numeric_roundtrip_ok: true,
    accuracy: { jpeg_to_geotiff_registration_residual_px: { rmse: 0.05 } },
  });
  assert.equal(numeric.safe_for_authoritative_measurement, false);
  assert.equal(numeric.downgraded, true);
  const imageOnly = proposeCalibration(metadata, {
    image_transform_validated: true,
    horizontal_estimates_ready: true,
    validated_calibration: {
      explicitly_validated: true,
      method: "Sampled JPEG correlation",
      approved_by: "Atlas",
      jpeg_to_geotiff_registration_residual_px: 0.05,
    },
  });
  assert.equal(imageOnly.safe_for_authoritative_measurement, false);
  assert.equal(imageOnly.survey_accuracy_validated, false);
  const surveyed = proposeCalibration(metadata, {
    validated_calibration: {
      explicitly_validated: true,
      survey_accuracy_validated: true,
      method: "Independent surveyed ground control, recorded separately from image correlation",
      approved_by: "Atlas",
    },
  });
  assert.equal(evaluateCalibration(surveyed).status, "validated");
  assert.equal(evaluateCalibration(surveyed).safe_for_authoritative_measurement, true);
});
