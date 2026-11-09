/**
 * Public snapshot allowlist. Anything not listed here stays off the public file.
 * Planned records, notes, and private fields are dropped even if selected.
 */

export const DEVICE_PUBLIC_KEYS = Object.freeze([
  "id",
  "role",
  "model",
  "location_group",
  "coords",
  "status",
  "ports",
  "mount_height",
  "service_area_tag",
  "data_quality",
  "public_summary",
]);

export const COORDS_PUBLIC_KEYS = Object.freeze(["lon", "lat", "alt_m", "alt_source"]);

export const LINK_PUBLIC_KEYS = Object.freeze(["id", "parent", "child", "medium", "wan_role"]);

export const GROUP_PUBLIC_KEYS = Object.freeze([
  "id",
  "label",
  "anchor_landmark",
  "anchor_coords",
  "centroid",
  "device_ids",
]);

export const WAN_PUBLIC_KEYS = Object.freeze(["id", "wan_role", "label", "public_summary", "map_pin"]);

export const TOP_PUBLIC_KEYS = Object.freeze([
  "schema",
  "schema_version",
  "generated",
  "title",
  "scope",
  "source",
  "provenance",
  "coordinate_note",
  "altitude_note",
  "display_rule",
  "pending_review",
  "wan",
  "devices",
  "links",
  "location_groups",
  "landmarks",
]);

const FORBIDDEN_KEYS = new Set([
  "management_ip",
  "mgmt_ip",
  "ip",
  "ip_address",
  "mac",
  "mac_address",
  "serial",
  "serial_number",
  "password",
  "passwd",
  "secret",
  "token",
  "ssid",
  "psk",
  "passphrase",
  "credential",
  "credentials",
  "power",
  "power_supply",
  "poe",
  "poe_injector",
  "conduit",
  "wiring",
  "voltage",
  "ups",
  "notes",
  "private_notes",
  "local_private",
  "private",
  "planned_devices",
  "planned_routes",
  "cable_paths",
  "price",
  "cost",
  "contract",
  "household",
]);

const STRING_RULES = [
  ["ipv4", /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d?\d)\b/],
  ["ipv6", /\b(?:[0-9a-f]{1,4}:){2,7}[0-9a-f]{1,4}\b/i],
  ["mac", /\b(?:[0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/i],
  ["mac12", /\b[0-9a-f]{12}\b/i],
  ["email", /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/i],
  ["phone", /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/],
  ["url", /\b(?:https?:\/\/|www\.)\S+/i],
  ["price", /\$\s?\d/],
  ["secret-word", /\b(?:password|passwd|passphrase|credential|api[_-]?key|private[_-]?key|secret|token)\b/i],
  ["serial", /\b(?:serial(?:\s*number)?|s\/n)\b/i],
  ["power-wiring", /\b(?:power\s*supply|poe\s*injector|extension\s*cord|conduit|voltage|ethernet\s*wiring)\b/i],
  ["provider-terms", /\b(?:per\s+month|service\s+agreement|land[- ]use|monthly\s+fee)\b/i],
  ["household", /\b(?:household|spouse|bedroom|wife|husband)\b/i],
];

function familyViolation(text) {
  if (!/family/i.test(text)) return false;
  const stripped = text
    .replaceAll("Private family network (not part of guest service).", "")
    .replaceAll("Private family network", "");
  return /family/i.test(stripped);
}

function plannedViolation(text) {
  if (!/\b(?:planned|future)\b/i.test(text)) return false;
  const stripped = text.replaceAll("No planned or future gear/routes.", "");
  return /\b(?:planned|future)\b/i.test(stripped);
}

const MAC_DOTTED = /\b[0-9a-f]{4}[.\uFF0E][0-9a-f]{4}[.\uFF0E][0-9a-f]{4}\b/i;

export function canonicalizePublicText(text) {
  return String(text)
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF\u2060\u180E]/g, "");
}

export function scanPublicValue(text, path) {
  const findings = [];
  if (typeof text !== "string" || !text) return findings;
  const canonical = canonicalizePublicText(text);
  if (MAC_DOTTED.test(canonical)) findings.push({ code: "mac-dotted", path, sample: canonical.slice(0, 80) });
  for (const [code, re] of STRING_RULES) {
    if (re.test(canonical)) findings.push({ code, path, sample: canonical.slice(0, 80) });
  }
  if (familyViolation(canonical)) findings.push({ code: "family", path, sample: canonical.slice(0, 80) });
  if (plannedViolation(canonical)) findings.push({ code: "planned-or-future", path, sample: canonical.slice(0, 80) });
  return findings;
}

export function scanPublicTree(value, path = "$") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findings.push(...scanPublicTree(entry, `${path}[${index}]`)));
    return findings;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (FORBIDDEN_KEYS.has(key.toLowerCase())) {
        findings.push({ code: "forbidden-key", path: `${path}.${key}`, sample: key });
      }
      findings.push(...scanPublicTree(entry, `${path}.${key}`));
    }
    return findings;
  }
  if (typeof value === "string") findings.push(...scanPublicValue(value, path));
  return findings;
}

function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function publicText(value, max) {
  if (typeof value !== "string") return null;
  const text = canonicalizePublicText(value).trim();
  if (!text) return null;
  return text.slice(0, max);
}

export function sanitizeCoords(coords) {
  if (!coords || typeof coords !== "object" || Array.isArray(coords)) return null;
  if (!finiteNumber(coords.lon) || !finiteNumber(coords.lat)) return null;
  if (coords.lon < -180 || coords.lon > 180 || coords.lat < -90 || coords.lat > 90) return null;
  const out = { lon: coords.lon, lat: coords.lat };
  if (coords.alt_m == null) out.alt_m = null;
  else if (finiteNumber(coords.alt_m)) out.alt_m = coords.alt_m;
  if (coords.alt_source == null) out.alt_source = null;
  else {
    const source = publicText(coords.alt_source, 80);
    if (source) out.alt_source = source;
  }
  return out;
}

function sanitizePorts(value) {
  if (value == null) return null;
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 128) return value;
  return null;
}

function sanitizeRelated(value) {
  if (typeof value === "string") return publicText(value, 80);
  if (!Array.isArray(value)) return null;
  const items = value.filter((item) => typeof item === "string").map((item) => publicText(item, 80)).filter(Boolean);
  return items.length ? items.slice(0, 12) : null;
}

function sanitizeSeparation(value) {
  if (finiteNumber(value)) return value;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(key) || !finiteNumber(entry)) continue;
    out[key] = entry;
  }
  return Object.keys(out).length ? out : null;
}

function sanitizeQualityItem(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const out = {};
  const code = publicText(item.code, 80);
  if (code && /^[a-z0-9-]{1,80}$/.test(code)) out.code = code;
  if (item.severity === "info" || item.severity === "warning" || item.severity === "error") out.severity = item.severity;
  const related = sanitizeRelated(item.related);
  if (related) out.related = related;
  const message = publicText(item.message, 600);
  if (message) out.message = message;
  const by = publicText(item.by, 120);
  if (by) out.by = by;
  const separation = sanitizeSeparation(item.separation_m);
  if (separation != null) out.separation_m = separation;
  if (!out.code && !out.message) return null;
  return out;
}

function sanitizeServiceTag(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  const group = publicText(value.group, 80);
  const basis = publicText(value.basis, 160);
  if (group) out.group = group;
  if (basis) out.basis = basis;
  if (typeof value.tentative === "boolean") out.tentative = value.tentative;
  return Object.keys(out).length ? out : null;
}

export function sanitizeDevice(device) {
  if (device?.status === "planned" || device?.record_class === "planned") {
    const error = new Error(`Planned device ${device?.id || ""} cannot be published`);
    error.code = "PLANNED_EXCLUDED";
    throw error;
  }
  const id = publicText(device?.id, 80);
  if (!id) return null;
  const out = { id };
  if (typeof device.role === "string" && ["router", "switch", "ap", "radio"].includes(device.role)) out.role = device.role;
  const model = publicText(device.model, 120);
  if (model) out.model = model;
  if (device.location_group == null || device.location_group === "") out.location_group = null;
  else {
    const group = publicText(device.location_group, 80);
    if (group) out.location_group = group;
  }
  const coords = sanitizeCoords(device.coords);
  if (coords) out.coords = coords;
  if (device.status === "active" || device.status === "inactive") out.status = device.status;
  out.ports = sanitizePorts(device.ports);
  if (device.mount_height == null) out.mount_height = null;
  else {
    const height = publicText(device.mount_height, 40);
    out.mount_height = height;
  }
  out.service_area_tag = sanitizeServiceTag(device.service_area_tag);
  out.data_quality = Array.isArray(device.data_quality)
    ? device.data_quality.map(sanitizeQualityItem).filter(Boolean).slice(0, 12)
    : [];
  const summary = publicText(device.public_summary, 600);
  if (summary) out.public_summary = summary;
  return out;
}

export function sanitizeGroup(group, allowedIds) {
  const id = publicText(group?.id, 80);
  if (!id) return null;
  const label = publicText(group.label, 120) || id;
  const anchor = group.anchor_landmark == null ? null : publicText(group.anchor_landmark, 80);
  const ids = Array.isArray(group.device_ids)
    ? group.device_ids.filter((item) => typeof item === "string" && allowedIds.has(item))
    : [];
  return {
    id,
    label,
    anchor_landmark: anchor,
    anchor_coords: sanitizeCoords(group.anchor_coords),
    centroid: sanitizeCoords(group.centroid) ? { lon: group.centroid.lon, lat: group.centroid.lat } : null,
    device_ids: ids,
  };
}

export function sanitizeLink(link) {
  if (link?.record_class === "planned" || link?.planned === true) {
    const error = new Error(`Planned link ${link.id} cannot be published`);
    error.code = "PLANNED_EXCLUDED";
    throw error;
  }
  const id = publicText(link?.id, 120);
  const parent = publicText(link?.parent, 80);
  const child = publicText(link?.child, 80);
  if (!id || !parent || !child) return null;
  if (!["wired-ethernet", "airmax-ptp", "airmax-ptmp", "wan"].includes(link.medium)) return null;
  const out = { id, parent, child, medium: link.medium };
  if (typeof link.wan_role === "string") {
    const role = publicText(link.wan_role, 40);
    if (role) out.wan_role = role;
  }
  return out;
}

function sanitizeWan(entry) {
  const id = publicText(entry?.id, 80);
  if (!id) return null;
  const out = { id };
  const role = publicText(entry.wan_role, 40);
  const label = publicText(entry.label, 120);
  const summary = publicText(entry.public_summary, 600);
  if (role) out.wan_role = role;
  if (label) out.label = label;
  if (summary) out.public_summary = summary;
  if (entry.map_pin && typeof entry.map_pin === "object") {
    const pinId = publicText(entry.map_pin.id, 80);
    const coords = sanitizeCoords(entry.map_pin.coords);
    if (pinId && coords) out.map_pin = { id: pinId, coords };
  }
  return out;
}

function sanitizeReview(item) {
  if (!item || typeof item !== "object") return null;
  const id = publicText(item.id, 80);
  const owner = publicText(item.owner, 80);
  const text = publicText(item.item, 800);
  if (!id || !text) return null;
  return { id, owner: owner || "", item: text };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * Build a sanitized public snapshot from the baseline plus an explicit selection.
 * selection.confirmed must be true. Planned devices, planned routes, notes,
 * cable allowances, and private fields are never copied.
 */
export function buildPublicSnapshot(baseline, plan, selection) {
  if (!selection || selection.confirmed !== true) {
    const error = new Error("Public export requires an explicit reviewed selection");
    error.code = "REVIEW_REQUIRED";
    throw error;
  }
  const selectedDevices = new Set(selection.deviceIds || []);
  const includeGroups = selection.includeGroups === true;
  const includeConnectivity = selection.includeConnectivity === true;
  const snapshot = cloneJson(baseline);
  const planDevices = new Map((plan?.asbuilt?.devices || []).map((device) => [device.id, device]));
  snapshot.devices = baseline.devices.map((device) => {
    const edited = selectedDevices.has(device.id) ? planDevices.get(device.id) : null;
    const source = edited || device;
    const sanitized = sanitizeDevice(source);
    if (!sanitized) return null;
    if (includeGroups && planDevices.has(device.id)) {
      const groupId = planDevices.get(device.id).location_group;
      sanitized.location_group = groupId == null || groupId === "" ? null : publicText(groupId, 80);
    }
    return sanitized;
  }).filter(Boolean);
  const allowedIds = new Set(snapshot.devices.map((device) => device.id));
  const sourceGroups = includeGroups ? (plan?.asbuilt?.location_groups || []) : baseline.location_groups;
  snapshot.location_groups = sourceGroups.map((group) => sanitizeGroup(group, allowedIds)).filter(Boolean);
  const groupIds = new Set(snapshot.location_groups.map((group) => group.id));
  for (const device of snapshot.devices) {
    if (device.location_group && !groupIds.has(device.location_group)) device.location_group = null;
  }
  const publicEndpoints = new Set([
    ...(baseline.devices || []).map((device) => device.id),
    ...(baseline.wan || []).map((entry) => entry.id),
  ]);
  const sourceLinks = includeConnectivity ? (plan?.asbuilt?.links || []) : baseline.links;
  const droppedLinks = [];
  snapshot.links = sourceLinks.flatMap((link) => {
    const publishable = link
      && link.planned !== true
      && link.record_class !== "planned"
      && publicEndpoints.has(link.parent)
      && publicEndpoints.has(link.child);
    if (!publishable) {
      if (link?.id) droppedLinks.push(link.id);
      return [];
    }
    const sanitized = sanitizeLink(link);
    return sanitized ? [sanitized] : [];
  });
  snapshot.wan = (baseline.wan || []).map((entry) => sanitizeWan(entry)).filter(Boolean);
  snapshot.pending_review = (baseline.pending_review || []).map((item) => sanitizeReview(item)).filter(Boolean);
  for (const key of Object.keys(snapshot)) {
    if (!TOP_PUBLIC_KEYS.includes(key)) delete snapshot[key];
  }
  delete snapshot.planned_devices;
  delete snapshot.planned_routes;
  delete snapshot.notes;
  delete snapshot.cable_paths;
  const findings = scanPublicTree(snapshot);
  if (findings.length) {
    const error = new Error(`Public export failed the sanitizer (${findings.map((item) => item.code).join(", ")})`);
    error.code = "SANITIZER";
    error.findings = findings;
    throw error;
  }
  const excluded = {
    planned_devices: (plan?.planned_devices || []).map((device) => device.id),
    planned_routes: (plan?.planned_routes || []).map((route) => route.id),
    planned_links: droppedLinks,
    notes: (plan?.notes || []).length,
    private_devices: (plan?.asbuilt?.devices || []).filter((device) => device.local_private).map((device) => device.id),
  };
  return { snapshot, excluded, findings };
}

export function describePublicEdits(baseline, plan) {
  const coordinates = [];
  const metadata = [];
  const planDevices = new Map(plan.asbuilt.devices.map((device) => [device.id, device]));
  for (const device of baseline.devices) {
    const edited = planDevices.get(device.id);
    if (!edited) continue;
    if (edited.coords.lon !== device.coords.lon || edited.coords.lat !== device.coords.lat) coordinates.push(device.id);
    if (edited.model !== device.model || edited.public_summary !== device.public_summary || edited.ports !== device.ports || edited.mount_height !== device.mount_height || edited.status !== device.status) {
      metadata.push(device.id);
    }
  }
  const groups = JSON.stringify(baseline.location_groups) !== JSON.stringify(plan.asbuilt.location_groups)
    || baseline.devices.some((device) => device.location_group !== planDevices.get(device.id)?.location_group);
  const connectivity = JSON.stringify(baseline.links) !== JSON.stringify(plan.asbuilt.links);
  return { coordinates, metadata, groups, connectivity };
}
