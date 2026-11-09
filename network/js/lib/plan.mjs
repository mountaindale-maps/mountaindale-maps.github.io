/**
 * Local planning state. Grouping, marker positions, and cable geometry never
 * rewrite link endpoints by accident. Connectivity changes are explicit.
 */

import { lonLatToImage, imageToLonLat, JPEG_CANDIDATE_GEOTRANSFORM } from "./projection.mjs";
import { measureRoute } from "./distance.mjs";
import { rebuildHierarchy } from "./topology-model.mjs";

const ROLES = new Set(["router", "switch", "ap", "radio"]);
const MEDIA = new Set(["wired-ethernet", "airmax-ptp", "airmax-ptmp", "wan"]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function major(version) {
  return String(version ?? "").split(".")[0];
}

export function planFromPublic(asbuilt, metadata) {
  if (asbuilt?.schema !== "mountaindale.asbuilt_public" || major(asbuilt.schema_version) !== "1") {
    const error = new Error("Unsupported public baseline schema");
    error.code = "SCHEMA";
    throw error;
  }
  return {
    schema: "mountaindale.local_plan",
    schema_version: "1.0.0",
    baseline_generated: asbuilt.generated,
    asbuilt: {
      devices: clone(asbuilt.devices),
      links: clone(asbuilt.links),
      location_groups: clone(asbuilt.location_groups),
      landmarks: clone(asbuilt.landmarks),
      wan: clone(asbuilt.wan),
    },
    planned_devices: [],
    planned_routes: [],
    cable_paths: {},
    notes: [],
    calibration: metadata ? clone(metadata) : null,
  };
}

export function deviceById(plan, id) {
  return plan.asbuilt.devices.find((device) => device.id === id)
    || plan.planned_devices.find((device) => device.id === id)
    || null;
}

export function coordOf(plan, id) {
  const device = deviceById(plan, id);
  if (device?.coords && Number.isFinite(device.coords.lon) && Number.isFinite(device.coords.lat)) {
    return { lon: device.coords.lon, lat: device.coords.lat };
  }
  const wan = (plan.asbuilt.wan || []).find((entry) => entry.id === id);
  const pin = wan?.map_pin?.coords;
  if (pin && Number.isFinite(pin.lon) && Number.isFinite(pin.lat)) return { lon: pin.lon, lat: pin.lat };
  return null;
}

export function ungroupDevice(plan, deviceId) {
  const next = clone(plan);
  const device = next.asbuilt.devices.find((item) => item.id === deviceId);
  if (!device) throw new Error(`Unknown device ${deviceId}`);
  for (const item of next.asbuilt.location_groups) {
    item.device_ids = (item.device_ids || []).filter((id) => id !== deviceId);
  }
  device.location_group = null;
  return next;
}

export function assignGroup(plan, deviceId, groupId) {
  const next = clone(plan);
  const device = next.asbuilt.devices.find((item) => item.id === deviceId);
  if (!device) throw new Error(`Unknown device ${deviceId}`);
  const group = next.asbuilt.location_groups.find((item) => item.id === groupId);
  if (!group) throw new Error(`Unknown group ${groupId}`);
  for (const item of next.asbuilt.location_groups) {
    item.device_ids = (item.device_ids || []).filter((id) => id !== deviceId);
  }
  if (!group.device_ids.includes(deviceId)) group.device_ids.push(deviceId);
  device.location_group = groupId;
  return next;
}

export function createGroup(plan, id, label) {
  const next = clone(plan);
  if (next.asbuilt.location_groups.some((group) => group.id === id)) throw new Error(`Group ${id} exists`);
  next.asbuilt.location_groups.push({
    id,
    label: label || id,
    anchor_landmark: null,
    anchor_coords: null,
    centroid: { lon: 0, lat: 0 },
    device_ids: [],
  });
  return next;
}

export function moveDevice(plan, deviceId, coords, geotransform = JPEG_CANDIDATE_GEOTRANSFORM) {
  const next = clone(plan);
  const device = next.asbuilt.devices.find((item) => item.id === deviceId)
    || next.planned_devices.find((item) => item.id === deviceId);
  if (!device) throw new Error(`Unknown device ${deviceId}`);
  if (!Number.isFinite(coords.lon) || !Number.isFinite(coords.lat)) throw new Error("Coordinates must be finite");
  if (!device.baseline_coords) device.baseline_coords = clone(device.coords);
  device.coords = {
    ...device.coords,
    lon: coords.lon,
    lat: coords.lat,
    alt_m: device.coords?.alt_m ?? null,
    alt_source: device.coords?.alt_source ?? null,
  };
  const [u, v] = lonLatToImage(coords.lon, coords.lat, geotransform);
  device.editor_image = { u, v, unverified: true };
  return next;
}

export function moveDeviceToImagePixel(plan, deviceId, u, v, geotransform = JPEG_CANDIDATE_GEOTRANSFORM) {
  const [lon, lat] = imageToLonLat(u, v, geotransform);
  return moveDevice(plan, deviceId, { lon, lat }, geotransform);
}

export function restoreBaselineCoords(plan, deviceId) {
  const next = clone(plan);
  const device = next.asbuilt.devices.find((item) => item.id === deviceId);
  if (!device?.baseline_coords) return next;
  device.coords = { ...device.coords, ...device.baseline_coords };
  delete device.editor_image;
  return next;
}

function assertSingleLanParent(links, child, parent) {
  const existing = links.filter((link) => link.child === child && link.medium !== "wan" && link.parent !== parent);
  if (existing.length) {
    const error = new Error(`DUAL UPLINK ${child}`);
    error.code = "DUAL_UPLINK";
    throw error;
  }
}

export function addLink(plan, link, { replaceParent = false } = {}) {
  if (!MEDIA.has(link.medium)) throw new Error("Unknown medium");
  const next = clone(plan);
  const id = link.id || `lnk:${link.parent}>${link.child}`;
  if (next.asbuilt.links.some((item) => item.id === id)) throw new Error(`Link ${id} exists`);
  const plannedIds = new Set(next.planned_devices.map((device) => device.id));
  const known = new Set([
    ...next.asbuilt.devices.map((device) => device.id),
    ...next.asbuilt.wan.map((entry) => entry.id),
    ...plannedIds,
  ]);
  if (!known.has(link.parent) || !known.has(link.child)) throw new Error("Link endpoint is missing");
  const touchesPlan = plannedIds.has(link.parent) || plannedIds.has(link.child);
  if (link.medium !== "wan" && !replaceParent) assertSingleLanParent(next.asbuilt.links, link.child, link.parent);
  if (link.medium !== "wan" && replaceParent) {
    next.asbuilt.links = next.asbuilt.links.filter((item) => !(item.child === link.child && item.medium !== "wan"));
  }
  next.asbuilt.links.push({
    id,
    parent: link.parent,
    child: link.child,
    medium: link.medium,
    wan_role: link.wan_role ?? null,
    ...(touchesPlan ? { planned: true, record_class: "planned" } : {}),
  });
  return next;
}

export function removeLink(plan, linkId) {
  const next = clone(plan);
  const before = next.asbuilt.links.length;
  next.asbuilt.links = next.asbuilt.links.filter((link) => link.id !== linkId);
  if (next.asbuilt.links.length === before) throw new Error(`Unknown link ${linkId}`);
  delete next.cable_paths[linkId];
  return next;
}

export function addPlannedDevice(plan, device) {
  if (!device?.id || !ROLES.has(device.role)) throw new Error("Planned device needs an id and role");
  const next = clone(plan);
  if (deviceById(next, device.id)) throw new Error(`Id ${device.id} is already used`);
  next.planned_devices.push({
    id: device.id,
    role: device.role,
    model: device.model || "",
    location_group: device.location_group || null,
    coords: {
      lon: device.coords.lon,
      lat: device.coords.lat,
      alt_m: null,
      alt_source: null,
    },
    status: "planned",
    record_class: "planned",
    ports: device.ports ?? null,
    mount_height: null,
    public_summary: "",
  });
  return next;
}

export function addPlannedRoute(plan, route) {
  const next = clone(plan);
  const id = route.id || `plan:${route.from}>${route.to}:${next.planned_routes.length + 1}`;
  if (next.planned_routes.some((item) => item.id === id)) throw new Error(`Route ${id} exists`);
  const vertices = route.vertices?.length
    ? route.vertices.map((vertex) => ({ lon: vertex.lon, lat: vertex.lat }))
    : [coordOf(next, route.from), coordOf(next, route.to)].filter(Boolean);
  if (vertices.length < 2) throw new Error("Planned route needs two vertices");
  next.planned_routes.push({
    id,
    from: route.from || null,
    to: route.to || null,
    medium: route.medium || "wired-ethernet",
    label: route.label || "Planned route",
    vertices,
    segments: (route.segments || []).map(cleanExtra),
    record_class: "planned",
  });
  return next;
}

export function removePlanned(plan, id) {
  const next = clone(plan);
  next.planned_devices = next.planned_devices.filter((device) => device.id !== id);
  next.planned_routes = next.planned_routes.filter((route) => route.id !== id);
  return next;
}

function allowance(value, name) {
  if (value == null || value === "") return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    const error = new Error(`${name} must be zero or positive`);
    error.code = "SEGMENT";
    throw error;
  }
  return number;
}

function cleanExtra(extra = {}) {
  const dropGiven = !(extra.vertical_drop_m == null || extra.vertical_drop_m === "");
  const riseGiven = !(extra.vertical_rise_m == null || extra.vertical_rise_m === "");
  const drop = allowance(dropGiven ? extra.vertical_drop_m : extra.vertical_rise_m, "Vertical drop");
  if (dropGiven && riseGiven && allowance(extra.vertical_rise_m, "Vertical drop") !== drop) {
    const error = new Error("Vertical drop and vertical rise disagree");
    error.code = "SEGMENT";
    throw error;
  }
  return {
    vertical_drop_m: drop,
    slope_rise_m: allowance(extra.slope_rise_m, "Slope rise"),
    slack_m: allowance(extra.slack_m, "Slack"),
    service_loop_m: allowance(extra.service_loop_m, "Service loop"),
  };
}

export function verticesForLink(plan, link) {
  const start = coordOf(plan, link.parent);
  const end = coordOf(plan, link.child);
  if (!start || !end) return null;
  const mid = plan.cable_paths?.[link.id]?.intermediates || [];
  return [start, ...mid, end];
}

export function setCablePath(plan, linkId, intermediates, segments) {
  const next = clone(plan);
  const link = next.asbuilt.links.find((item) => item.id === linkId);
  if (!link) throw new Error(`Unknown link ${linkId}`);
  const mids = (intermediates || []).map((vertex) => ({ lon: vertex.lon, lat: vertex.lat }));
  const count = mids.length + 1;
  const extras = Array.from({ length: count }, (_, index) => cleanExtra((segments || [])[index]));
  next.cable_paths[linkId] = { intermediates: mids, segments: extras };
  return next;
}

export function setSegmentExtra(plan, linkId, index, patch) {
  const next = clone(plan);
  const link = next.asbuilt.links.find((item) => item.id === linkId);
  if (!link) throw new Error(`Unknown link ${linkId}`);
  const current = next.cable_paths[linkId] || { intermediates: [], segments: [] };
  const count = current.intermediates.length + 1;
  const segments = Array.from({ length: count }, (_, segmentIndex) => cleanExtra(current.segments[segmentIndex]));
  if (index < 0 || index >= segments.length) throw new Error("Segment index out of range");
  const merged = { ...segments[index], ...patch };
  if (Object.prototype.hasOwnProperty.call(patch, "vertical_rise_m") && !Object.prototype.hasOwnProperty.call(patch, "vertical_drop_m")) {
    delete merged.vertical_drop_m;
  }
  if (Object.prototype.hasOwnProperty.call(patch, "vertical_drop_m")) delete merged.vertical_rise_m;
  segments[index] = cleanExtra(merged);
  next.cable_paths[linkId] = { intermediates: current.intermediates, segments };
  return next;
}

export function measureLink(plan, link, claim) {
  const vertices = verticesForLink(plan, link);
  if (!vertices) return null;
  const extras = plan.cable_paths?.[link.id]?.segments || [];
  return measureRoute(vertices, extras, claim);
}

export function addNote(plan, note) {
  const next = clone(plan);
  next.notes.push({
    id: note.id || `note-${next.notes.length + 1}-${Date.now()}`,
    created: note.created || new Date().toISOString(),
    text: String(note.text || "").trim(),
    device_ids: note.device_ids || [],
    kind: "change-request",
  });
  if (!next.notes.at(-1).text) throw new Error("Note text is required");
  return next;
}

export function linksUnchanged(before, after) {
  return JSON.stringify(before.asbuilt.links) === JSON.stringify(after.asbuilt.links);
}

export function localHierarchy(plan) {
  try {
    return rebuildHierarchy(plan.asbuilt.devices, plan.asbuilt.links, plan.asbuilt.wan);
  } catch (error) {
    error.message = `Connectivity is inconsistent: ${error.message}`;
    throw error;
  }
}

export function hierarchyForPlan(plan, baselineHierarchy, baselineLinkJson) {
  if (JSON.stringify(plan.asbuilt.links) === baselineLinkJson) return baselineHierarchy;
  return localHierarchy(plan);
}

const PRIVATE_DEVICE_KEYS = new Set(DEVICE_KEEP());

function DEVICE_KEEP() {
  return new Set([
    "id", "role", "model", "location_group", "coords", "status", "ports",
    "mount_height", "service_area_tag", "data_quality", "public_summary", "baseline_coords",
  ]);
}

function splitDevice(raw) {
  const localPrivate = {};
  const device = {};
  for (const [key, value] of Object.entries(raw || {})) {
    if (key === "local_private" && value && typeof value === "object") {
      Object.assign(localPrivate, value);
      continue;
    }
    if (PRIVATE_DEVICE_KEYS.has(key)) device[key] = value;
    else localPrivate[key] = value;
  }
  if (Object.keys(localPrivate).length) device.local_private = localPrivate;
  return device;
}

export function validateImport(doc) {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    const error = new Error("Import must be a JSON object");
    error.code = "IMPORT";
    throw error;
  }
  if (Object.prototype.hasOwnProperty.call(doc, "__proto__") || Object.prototype.hasOwnProperty.call(doc, "constructor")) {
    const error = new Error("Import rejected");
    error.code = "IMPORT";
    throw error;
  }
  const version = doc.schema_version || "1.0.0";
  if (major(version) !== "1") {
    const error = new Error(`Unsupported schema major version ${version}`);
    error.code = "SCHEMA";
    throw error;
  }
  if (doc.schema === "mountaindale.local_plan") {
    if (!Array.isArray(doc.asbuilt?.devices) || !Array.isArray(doc.asbuilt?.links)) failImport("Local plan is missing as-built records");
    assertDevices(doc.asbuilt.devices);
    assertLinks(doc.asbuilt.links, endpointIds(doc));
    for (const cable of Object.values(doc.cable_paths || {})) assertSegmentExtras(cable?.segments);
    for (const route of doc.planned_routes || []) assertSegmentExtras(route?.segments);
    return doc;
  }
  if (doc.schema === "mountaindale.asbuilt_public") {
    if (!Array.isArray(doc.devices) || !Array.isArray(doc.links)) failImport("Public import is missing devices or links");
    assertDevices(doc.devices);
    assertLinks(doc.links, new Set([...doc.devices.map((device) => device.id), ...(doc.wan || []).map((entry) => entry.id)]));
    return doc;
  }
  if (!Array.isArray(doc.devices)) failImport("Import has no devices array");
  const devices = doc.devices.map(splitDevice);
  assertDevices(devices);
  const links = Array.isArray(doc.links) ? doc.links : [];
  const known = new Set([
    ...devices.map((device) => device.id),
    ...(Array.isArray(doc.wan) ? doc.wan.map((entry) => entry.id) : []),
  ]);
  assertLinks(links, known);
  return doc;
}

function endpointIds(plan) {
  return new Set([
    ...(plan.asbuilt?.devices || []).map((device) => device.id),
    ...(plan.asbuilt?.wan || []).map((entry) => entry.id),
    ...(plan.planned_devices || []).map((device) => device.id),
    ...(plan.devices || []).map((device) => device.id),
    ...(plan.wan || []).map((entry) => entry.id),
  ]);
}

function assertAllowance(value, name) {
  if (value == null || value === "") return;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) failImport(`${name} must be zero or positive`, "SEGMENT");
}

function assertSegmentExtras(segments) {
  if (segments == null) return;
  if (!Array.isArray(segments)) failImport("Segment allowances must be an array", "SEGMENT");
  for (const extra of segments) {
    if (!extra || typeof extra !== "object" || Array.isArray(extra)) failImport("Segment allowance must be an object", "SEGMENT");
    assertAllowance(extra.vertical_drop_m, "Vertical drop");
    assertAllowance(extra.vertical_rise_m, "Vertical drop");
    assertAllowance(extra.slope_rise_m, "Slope rise");
    assertAllowance(extra.slack_m, "Slack");
    assertAllowance(extra.service_loop_m, "Service loop");
    const dropGiven = !(extra.vertical_drop_m == null || extra.vertical_drop_m === "");
    const riseGiven = !(extra.vertical_rise_m == null || extra.vertical_rise_m === "");
    if (dropGiven && riseGiven && Number(extra.vertical_drop_m) !== Number(extra.vertical_rise_m)) {
      failImport("Vertical drop and vertical rise disagree", "SEGMENT");
    }
  }
}

function assertDevices(devices) {
  if (!Array.isArray(devices)) failImport("Devices must be an array");
  const seen = new Set();
  for (const device of devices) {
    if (!device || typeof device !== "object" || Array.isArray(device)) failImport("Device must be an object");
    if (!device.id || typeof device.id !== "string") failImport("Device is missing an id");
    if (seen.has(device.id)) failImport(`Duplicate device id ${device.id}`);
    seen.add(device.id);
    const lon = device.coords?.lon;
    const lat = device.coords?.lat;
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) {
      failImport(`Device ${device.id} has coordinates outside the geographic range`);
    }
  }
}

function failImport(message, code = "IMPORT") {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function assertLinks(links, known) {
  const parents = new Map();
  const seen = new Set();
  for (const link of links || []) {
    if (!link || typeof link !== "object" || Array.isArray(link)) failImport("Link must be an object");
    if (typeof link.id !== "string" || typeof link.parent !== "string" || typeof link.child !== "string") {
      failImport("Link is missing id, parent, or child");
    }
    if (seen.has(link.id)) failImport(`Duplicate link id ${link.id}`);
    seen.add(link.id);
    if (!MEDIA.has(link.medium)) failImport(`Link ${link.id} has an unknown medium`);
    if (!known.has(link.parent) || !known.has(link.child)) failImport(`Link ${link.id} endpoint is missing`);
    if (link.parent === link.child) failImport(`Link ${link.id} endpoint is missing`);
    if (link.medium === "wan") continue;
    if (parents.has(link.child) && parents.get(link.child) !== link.parent) {
      failImport(`DUAL UPLINK ${link.child}`, "DUAL_UPLINK");
    }
    parents.set(link.child, link.parent);
  }
  const children = new Map();
  for (const link of links || []) {
    if (link.medium === "wan") continue;
    if (!children.has(link.parent)) children.set(link.parent, []);
    children.get(link.parent).push(link.child);
  }
  const color = new Map();
  const visit = (id) => {
    const state = color.get(id) || 0;
    if (state === 1) failImport(`CYCLE ${id}`, "CYCLE");
    if (state === 2) return;
    color.set(id, 1);
    for (const child of children.get(id) || []) visit(child);
    color.set(id, 2);
  };
  for (const id of children.keys()) visit(id);
}

export function importDocument(doc, metadata) {
  const checked = validateImport(doc);
  const graphDevices = checked.schema === "mountaindale.local_plan" ? checked.asbuilt.devices : checked.devices;
  const graphLinks = checked.schema === "mountaindale.local_plan" ? checked.asbuilt.links : (checked.links || []);
  assertLinks(graphLinks, new Set([
    ...(graphDevices || []).map((device) => device.id),
    ...((checked.asbuilt?.wan || checked.wan || []).map((entry) => entry.id)),
    ...((checked.planned_devices || []).map((device) => device.id)),
  ]));
  if (checked.schema === "mountaindale.local_plan") return clone(checked);
  if (checked.schema === "mountaindale.asbuilt_public") return planFromPublic(checked, metadata);
  const devices = checked.devices.map(splitDevice);
  const plan = {
    schema: "mountaindale.local_plan",
    schema_version: "1.0.0",
    baseline_generated: null,
    asbuilt: {
      devices,
      links: clone(checked.links || []),
      location_groups: clone(checked.location_groups || []),
      landmarks: clone(checked.landmarks || []),
      wan: clone(checked.wan || []),
    },
    planned_devices: clone(checked.planned_devices || []),
    planned_routes: clone(checked.planned_routes || []),
    cable_paths: {},
    notes: Array.isArray(checked.notes) ? clone(checked.notes) : [],
    calibration: metadata ? clone(metadata) : null,
    private_bucket: {},
  };
  for (const key of Object.keys(checked)) {
    if (["schema", "schema_version", "devices", "links", "location_groups", "landmarks", "wan", "notes", "planned_devices", "planned_routes"].includes(key)) continue;
    plan.private_bucket[key] = clone(checked[key]);
  }
  return plan;
}

export { rebuildHierarchy };
