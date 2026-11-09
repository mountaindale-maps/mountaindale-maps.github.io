import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import http from "node:http";
import { editorRoots, startEditorServer } from "../editor/server.mjs";
import { resolveAllowedDataDir, savePlan } from "../editor/store.mjs";
import { importCalibration } from "../network/js/lib/calibration.mjs";
import { createHistory, undo } from "../network/js/lib/history.mjs";
import { addLink, addPlannedDevice, importDocument, linksUnchanged, planFromPublic, setSegmentExtra, ungroupDevice, validateImport } from "../network/js/lib/plan.mjs";
import { buildPublicSnapshot, scanPublicTree } from "../network/js/lib/sanitize.mjs";
import { readFileSync } from "node:fs";

const asbuilt = JSON.parse(readFileSync(new URL("../network/data/asbuilt_public.json", import.meta.url)));
const metadata = JSON.parse(readFileSync(new URL("../network/data/metadata.json", import.meta.url)));
const forbidden = [path.resolve("network"), path.resolve("dist"), path.resolve("editor/static")];

function selection(deviceIds, extra = {}) {
  return { confirmed: true, deviceIds, includeGroups: false, includeConnectivity: false, ...extra };
}

test("nested private fields and disguised secrets do not publish", () => {
  const plan = planFromPublic(asbuilt, metadata);
  const device = plan.asbuilt.devices.find((item) => item.id === "045-UAP-U7O");
  device.ports = { serialNumber: "ABC12345", count: 2 };
  device.data_quality = [...device.data_quality, { code: "note", severity: "info", message: "Checked on site", assetTag: "AT-7781" }];
  device.service_area_tag = { ...device.service_area_tag, household: "Smith" };
  const group = plan.asbuilt.location_groups.find((item) => item.id === "site-45");
  group.device_ids = [...group.device_ids, "PLAN-SHED-AP"];
  const clean = buildPublicSnapshot(asbuilt, plan, selection(["045-UAP-U7O"], { includeGroups: true }));
  const text = JSON.stringify(clean.snapshot);
  for (const secret of ["ABC12345", "AT-7781", "PLAN-SHED-AP", "Smith", "serialNumber", "assetTag"]) {
    assert.equal(text.includes(secret), false, secret);
  }
  const published = clean.snapshot.devices.find((item) => item.id === "045-UAP-U7O");
  assert.equal(published.ports, null);
  assert.equal(published.service_area_tag.group, "propane-shed");
  assert.equal(published.service_area_tag.household, undefined);
  assert.equal(published.data_quality.some((item) => item.assetTag), false);
  assert.equal(published.data_quality.some((item) => item.message === "Checked on site"), true);
  assert.equal(clean.snapshot.location_groups.find((item) => item.id === "site-45").device_ids.includes("PLAN-SHED-AP"), false);
  assert.equal(clean.snapshot.location_groups.find((item) => item.id === "site-45").device_ids.includes("045-UAP-U7O"), true);

  device.public_summary = "radio 0011.2233.4455";
  assert.throws(() => buildPublicSnapshot(asbuilt, plan, selection(["045-UAP-U7O"])), /sanitizer/i);
  device.public_summary = "pass\u200dword in the note";
  assert.throws(() => buildPublicSnapshot(asbuilt, plan, selection(["045-UAP-U7O"])), /sanitizer/i);
  device.public_summary = "gateway \uFF11\uFF10\uFF0E\uFF11\uFF0E\uFF12\uFF0E\uFF13";
  assert.throws(() => buildPublicSnapshot(asbuilt, plan, selection(["045-UAP-U7O"])), /sanitizer/i);
});

test("legitimate public fields round-trip through the allowlist", () => {
  const plan = planFromPublic(asbuilt, metadata);
  const clean = buildPublicSnapshot(asbuilt, plan, selection(["045-UAP-U7O", "096-USW-Flex-East"]));
  const site = clean.snapshot.devices.find((item) => item.id === "045-UAP-U7O");
  const source = asbuilt.devices.find((item) => item.id === "045-UAP-U7O");
  assert.equal(site.ports, source.ports);
  assert.equal(site.mount_height, source.mount_height);
  assert.equal(site.service_area_tag.group, source.service_area_tag.group);
  assert.equal(site.service_area_tag.tentative, true);
  assert.equal(site.data_quality[0].code, source.data_quality[0].code);
  assert.equal(site.data_quality[0].message, source.data_quality[0].message);
  const flex = clean.snapshot.devices.find((item) => item.id === "096-USW-Flex-East");
  assert.equal(flex.ports, 5);
  assert.equal(flex.data_quality[0].separation_m["NSL5AC-AP-57-75-98"], 19.725);
  assert.deepEqual(scanPublicTree(clean.snapshot), []);
  assert.equal(asbuilt.provenance.atlas_review.image_transform_validated, true);
  assert.equal(asbuilt.provenance.atlas_review.survey_accuracy_validated, false);
  assert.equal(asbuilt.provenance.atlas_review.disputed_pins_moved, false);
  assert.equal(JSON.stringify(asbuilt.pending_review).includes("gate is false"), false);
});

test("invalid topology is rejected before a plan replaces the current one", () => {
  const devices = [
    { id: "A", role: "router", coords: { lon: -104.95, lat: 38.58 } },
    { id: "B", role: "ap", coords: { lon: -104.95, lat: 38.58 } },
    { id: "C", role: "switch", coords: { lon: -104.94, lat: 38.58 } },
  ];
  const current = planFromPublic(asbuilt, metadata);
  assert.throws(() => importDocument({
    devices,
    links: [
      { id: "1", parent: "A", child: "B", medium: "wired-ethernet" },
      { id: "2", parent: "C", child: "B", medium: "wired-ethernet" },
    ],
  }, metadata), /DUAL UPLINK/);
  assert.throws(() => importDocument({
    devices,
    links: [{ id: "1", parent: "A", child: "NOPE", medium: "wired-ethernet" }],
  }, metadata), /endpoint is missing/);
  assert.throws(() => importDocument({
    devices: [devices[0], devices[0]],
    links: [],
  }, metadata), /Duplicate/);
  assert.throws(() => importDocument({
    devices,
    links: [
      { id: "1", parent: "A", child: "B", medium: "wired-ethernet" },
      { id: "2", parent: "B", child: "A", medium: "wired-ethernet" },
    ],
  }, metadata), /CYCLE/);
  assert.equal(current.asbuilt.devices.length, 70);
  assert.doesNotThrow(() => validateImport(asbuilt));
});

test("ungroup removes the device from every group and keeps links", () => {
  const plan = planFromPublic(asbuilt, metadata);
  const next = ungroupDevice(plan, "045-UAP-U7O");
  assert.equal(linksUnchanged(plan, next), true);
  assert.equal(next.asbuilt.devices.find((item) => item.id === "045-UAP-U7O").location_group, null);
  assert.equal(next.asbuilt.location_groups.some((group) => group.device_ids.includes("045-UAP-U7O")), false);
  const history = undo({ past: [plan], present: next, future: [] });
  assert.equal(history.present.asbuilt.devices.find((item) => item.id === "045-UAP-U7O").location_group, "site-45");
});

test("a backups symlink cannot receive a saved plan outside the allowed directory", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "md-root-"));
  const outside = await mkdtemp(path.join(tmpdir(), "md-outside-"));
  const plan = planFromPublic(asbuilt, metadata);
  try {
    await savePlan(dir, plan, forbidden);
    await rm(path.join(dir, "backups"), { recursive: true, force: true });
    await symlink(outside, path.join(dir, "backups"));
    await assert.rejects(() => savePlan(dir, plan, forbidden), (error) => error.code === "DATA_DIR");
    assert.equal((await readFile(path.join(dir, "current.json"), "utf8")).includes("mountaindale.local_plan"), true);
    const leaked = await readFile(path.join(outside, "current.json"), "utf8").then(() => true, () => false);
    assert.equal(leaked, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test("a corrupt plan is reported with its backups and is not overwritten", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "md-corrupt-"));
  const plan = planFromPublic(asbuilt, metadata);
  const started = await startEditorServer({ port: 0, dataDir: dir, roots: { kind: "repo", publicDir: null, baselineDir: path.resolve("network/data"), forbidden } });
  try {
    await savePlan(dir, plan, forbidden);
    plan.notes.push({ id: "n", kind: "change-request", text: "keep", created: "2026-11-09T00:00:00Z", device_ids: [] });
    await savePlan(dir, plan, forbidden);
    const current = path.join(dir, "current.json");
    await writeFile(current, "{not json");
    const response = await fetch(`http://127.0.0.1:${started.port}/api/state`);
    const body = await response.json();
    assert.equal(response.status, 409);
    assert.equal(body.code, "PLAN_CORRUPT");
    assert.ok(body.backups.length >= 1);
    assert.equal(await readFile(current, "utf8"), "{not json");
    assert.equal(JSON.stringify(body).includes(dir), false);
  } finally {
    await new Promise((resolve) => started.server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

test("a symlink ancestor cannot redirect saves into the public tree", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "md-link-"));
  const plan = planFromPublic(asbuilt, metadata);
  try {
    await symlink(path.resolve("network"), path.join(parent, "via"));
    await assert.rejects(() => savePlan(path.join(parent, "via", "plans"), plan, forbidden), (error) => error.code === "DATA_DIR");
    assert.equal(existsSync(path.resolve("network/plans")), false);
    assert.equal(existsSync(path.resolve("network/current.json")), false);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("backup names are portable and errors do not reveal the data directory", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "md-backup-"));
  const started = await startEditorServer({ port: 0, dataDir: dir, roots: { kind: "repo", publicDir: null, baselineDir: path.resolve("network/data"), forbidden } });
  try {
    const response = await fetch(`http://127.0.0.1:${started.port}/api/restore`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "foo\\bar.json" }),
    });
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.error, "Unknown backup");
    assert.equal(JSON.stringify(body).includes(dir), false);
  } finally {
    await new Promise((resolve) => started.server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});

function piece(...parts) {
  return parts.join("");
}

test("calibration import scrubs private paths from nested notes", () => {
  const home = piece("/home/", "dh", "enken");
  const imported = importCalibration(metadata, {
    blockers: [`see ${home}/secret/odm_ortho${"photo.tif"}`, "one rejected patch remains"],
    accuracy: { notes: `log ${home}/terminals/${piece("127", "707")}.txt and a rejected patch`, rmse: 0.05 },
    image_transform_validated: true,
    horizontal_estimates_ready: true,
  });
  const text = JSON.stringify(imported);
  assert.equal(text.includes(home), false);
  assert.equal(text.includes(piece("127", "707", ".txt")), false);
  assert.match(text, /one rejected patch remains/);
  assert.equal(imported.safe_for_authoritative_measurement, false);
});

test("planned references in quality notes do not publish, and look-alike secrets are refused", () => {
  const plan = planFromPublic(asbuilt, metadata);
  const device = plan.asbuilt.devices.find((item) => item.id === "096-USW-Flex-East");
  device.data_quality = [{
    code: "site96-placement-unresolved",
    severity: "warning",
    related: ["NB5AC-STA-96", "PLAN-SHED-AP"],
    separation_m: { "NB5AC-STA-96": 37.512, "PLAN-SHED-AP": 4, radio_to_radio: 17.933 },
    message: "Placement unresolved.",
  }];
  device.public_summary = `gate p${"\u0430"}ssword`;
  assert.throws(() => buildPublicSnapshot(asbuilt, plan, selection([device.id])), /sanitizer/i);
  device.public_summary = asbuilt.devices.find((item) => item.id === device.id).public_summary;
  const clean = buildPublicSnapshot(asbuilt, plan, selection([device.id]));
  const published = clean.snapshot.devices.find((item) => item.id === device.id);
  assert.deepEqual(published.data_quality[0].related, ["NB5AC-STA-96"]);
  assert.equal(published.data_quality[0].separation_m["PLAN-SHED-AP"], undefined);
  assert.equal(published.data_quality[0].separation_m.radio_to_radio, 17.933);
  assert.equal(JSON.stringify(published).includes("PLAN-SHED-AP"), false);
});

test("a link to planned equipment is marked planned and cannot be published", () => {
  let plan = planFromPublic(asbuilt, metadata);
  plan = addPlannedDevice(plan, { id: "PLAN-AP-X", role: "ap", model: "Test AP", coords: { lon: -104.95, lat: 38.58 } });
  plan = addLink(plan, { parent: "0000-MD-UDM-Pro-2", child: "PLAN-AP-X", medium: "wired-ethernet" });
  const created = plan.asbuilt.links.find((link) => link.child === "PLAN-AP-X");
  assert.equal(created.planned, true);
  assert.equal(created.record_class, "planned");
  plan.asbuilt.links.push({ id: "lnk:QA>PLAN-AP-X", parent: "QA", child: "PLAN-AP-X", medium: "wired-ethernet" });
  const exported = buildPublicSnapshot(asbuilt, plan, {
    confirmed: true,
    deviceIds: [],
    includeGroups: false,
    includeConnectivity: true,
  });
  const text = JSON.stringify(exported.snapshot);
  assert.equal(text.includes("PLAN-AP-X"), false);
  assert.equal(text.includes("lnk:QA>PLAN-AP-X"), false);
  assert.equal(exported.snapshot.links.length, asbuilt.links.length);
  assert.ok(exported.excluded.planned_links.includes("lnk:QA>PLAN-AP-X"));
});

test("negative rise and slack are refused", () => {
  const plan = planFromPublic(asbuilt, metadata);
  const linkId = plan.asbuilt.links.find((link) => link.medium !== "wan").id;
  assert.throws(() => setSegmentExtra(plan, linkId, 0, { slack_m: -1 }), /Slack/);
  assert.throws(() => setSegmentExtra(plan, linkId, 0, { vertical_rise_m: -0.2 }), /Rise/);
  const kept = setSegmentExtra(plan, linkId, 0, { slack_m: 1.5, vertical_rise_m: 0 });
  assert.equal(kept.cable_paths[linkId].segments[0].slack_m, 1.5);
});

test("repo mode refuses a data directory inside the working tree", async () => {
  const roots = editorRoots();
  assert.equal(roots.kind, "repo");
  assert.ok(roots.forbidden.map((root) => path.resolve(root)).includes(path.resolve(".")));
  await assert.rejects(() => resolveAllowedDataDir(path.resolve("editor"), roots.forbidden), (error) => error.code === "DATA_DIR");
});

test("a foreign Host header cannot read the local plan", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "md-host-"));
  const started = await startEditorServer({ port: 0, dataDir: dir, roots: { kind: "repo", publicDir: null, baselineDir: path.resolve("network/data"), forbidden } });
  try {
    const status = await new Promise((resolve, reject) => {
      const request = http.request({
        hostname: "127.0.0.1",
        port: started.port,
        path: "/api/state",
        method: "GET",
        headers: { host: "evil.example" },
      }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      request.on("error", reject);
      request.end();
    });
    assert.equal(status, 403);
    const health = await fetch(`http://127.0.0.1:${started.port}/api/health`);
    assert.equal(health.status, 200);
  } finally {
    await new Promise((resolve) => started.server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
