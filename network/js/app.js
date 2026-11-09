import { evaluateCalibration } from "./lib/calibration.mjs";
import { JPEG_CANDIDATE_GEOTRANSFORM, lonLatToImage } from "./lib/projection.mjs";
import { tileUrl } from "./lib/tiles.mjs";
import {
  applyFocus,
  defaultExpandedKeys,
  highlightForDevice,
  highlightForGroup,
} from "./lib/topology-model.mjs";
import { shownOnMap } from "./lib/map-links.mjs";
import { classifyWirelessHops } from "./lib/wireless-hops.mjs";
import { linksWithCoords, renderDeviceStory } from "./lib/render-card.mjs";
import { createMap, insetsAround } from "./map.js";
import { mountTopology } from "./topology-view.js";

const detail = document.querySelector("#detail");
const results = document.querySelector("#results");
const query = document.querySelector("#q");
const calib = document.querySelector("#calib");
const legend = document.querySelector("#legend");
const topoSection = document.querySelector("#topology");
const topoBody = document.querySelector("#topo-body");

const [asbuilt, hierarchy, metadata, friendly] = await Promise.all([
  fetch("data/asbuilt_public.json").then((response) => response.json()),
  fetch("data/topology_hierarchy.json").then((response) => response.json()),
  fetch("data/metadata.json").then((response) => response.json()),
  fetch("data/public_friendly_device_details.json").then((response) => response.json()),
]);

if (asbuilt.schema_version.split(".")[0] !== "1") {
  detail.textContent = "This page does not understand that data schema.";
  throw new Error("schema");
}

const claim = evaluateCalibration(metadata);
calib.textContent = claim.distanceLabel;
const geotransform = metadata?.candidate_georeferencing?.gdal_geotransform || JPEG_CANDIDATE_GEOTRANSFORM;
const image = metadata.imagery;
const devices = asbuilt.devices;
const byId = new Map(devices.map((device) => [device.id, device]));
const groups = new Map(asbuilt.location_groups.map((group) => [group.id, group]));
const links = asbuilt.links;
const friendlyById = friendly?.schema === "mountaindale-public-friendly-device-details"
  ? friendly.devices_by_id || {}
  : {};

let expanded = defaultExpandedKeys(hierarchy.root);
let hoverId = null;
let selectedId = null;
let groupHover = null;
let touchArmed = null;
let lastTouch = -1;

const map = createMap(document.querySelector("#map"), {
  imageWidth: image.width,
  imageHeight: image.height,
  tileUrl: (z, x, y) => tileUrl(z, x, y),
});

const topology = mountTopology(topoBody, {
  hierarchy,
  devices,
  handlers: {
    onToggle(key) {
      if (expanded.has(key)) expanded.delete(key);
      else expanded.add(key);
      paint();
    },
    onSelectDevice(id) { selectDevice(id); },
    onSelectBranch(node) {
      expanded = applyFocus(expanded, hierarchy, null);
      expanded.add(node.key);
      const points = (node.device_ids || []).map((id) => pixelOf(byId.get(id)?.coords)).filter(Boolean);
      if (points.length) map.fitToPoints(points);
      paint();
    },
  },
});

const NEAR_EDGE = new Set(metadata.near_edge_device_ids || []);

function canvasPlace(device) {
  const point = pixelOf(device?.coords);
  if (!point) return "unprojected";
  if (point.u < 0 || point.v < 0 || point.u > image.width || point.v > image.height) return "outside";
  if (NEAR_EDGE.has(device.id)) return "near-edge";
  return "inside";
}

function outsideSummary() {
  const outside = devices.filter((device) => canvasPlace(device) === "outside");
  const near = devices.filter((device) => canvasPlace(device) === "near-edge");
  const outsideText = outside.length
    ? `Outside the crop canvas, still at source coordinates: ${outside.map((device) => device.id).join(", ")}.`
    : "No equipment is outside the crop canvas.";
  const nearText = near.length
    ? `${near.length} devices are near the crop edge and stay at their source coordinates.`
    : "";
  return `${outsideText} ${nearText} Live Earth has not been re-exported. Site 96 placement is still unresolved. One inactive AP has no uplink.`.trim();
}

function pixelOf(coords) {
  if (!coords || !Number.isFinite(coords.lon) || !Number.isFinite(coords.lat)) return null;
  const [u, v] = lonLatToImage(coords.lon, coords.lat, geotransform);
  return { u, v };
}

function endpoint(id) {
  if (byId.has(id)) return byId.get(id).coords;
  const wan = asbuilt.wan.find((entry) => entry.id === id);
  return wan?.map_pin?.coords || null;
}

function flagOf(device) {
  const codes = device.data_quality || [];
  if (codes.some((item) => item.severity === "warning")) return "warning";
  if (codes.length || device.service_area_tag?.tentative) return "info";
  return "";
}

function activeHighlight() {
  const id = hoverId || selectedId;
  const device = id ? byId.get(id) : null;
  if (groupHover && !hoverId) return { device: null, highlight: { linkIds: [], nodeIds: [] }, members: highlightForGroup(groupHover).deviceIds };
  if (!device) return { device: null, highlight: { linkIds: [], nodeIds: [] }, members: [] };
  return { device, highlight: highlightForDevice(hierarchy, device), members: [] };
}

function paint() {
  const { device, highlight, members } = activeHighlight();
  const memberSet = new Set(members);
  const hotLinks = new Set(highlight.linkIds);
  const wirelessHop = classifyWirelessHops(links).hop;
  map.setPolylines(links.filter(shownOnMap).flatMap((link) => {
    const a = pixelOf(endpoint(link.parent));
    const b = pixelOf(endpoint(link.child));
    if (!a || !b) return [];
    return [{ id: link.id, medium: link.medium, hop: wirelessHop.get(link.id) || "", hot: hotLinks.has(link.id), points: [a, b] }];
  }));
  map.setMarkers(devices.map((item) => {
    const point = pixelOf(item.coords);
    return {
      id: item.id,
      u: point.u,
      v: point.v,
      role: item.role,
      status: item.status,
      flag: flagOf(item),
      hot: item.id === (hoverId || selectedId),
      member: memberSet.has(item.id),
      caption: item.id,
    };
  }));
  const focusGroup = groupHover?.id || device?.location_group || null;
  const labels = [];
  for (const group of asbuilt.location_groups) {
    const anchor = group.anchor_coords || group.centroid;
    const point = pixelOf(anchor);
    if (!point) continue;
    labels.push({
      id: group.id,
      groupId: group.id,
      kind: "group",
      text: group.label,
      u: point.u,
      v: point.v,
      priority: group.id === focusGroup,
    });
  }
  for (const landmark of asbuilt.landmarks) {
    const point = pixelOf(landmark.coords);
    if (!point) continue;
    labels.push({ id: landmark.id, kind: "landmark", text: landmark.id, u: point.u, v: point.v, priority: false });
  }
  map.setLabels(labels);
  const hotNodeIds = new Set([...(highlight.nodeIds || []), ...members]);
  const ancestorKeys = new Set(device ? hierarchy.ancestors[device.id] || [] : []);
  topology.update({
    expanded,
    hotDeviceId: device?.id || null,
    hotNodeIds,
    hotLinkIds: hotLinks,
    ancestorKeys,
  });
  renderDetail(device, highlight);
}

function showHover(id) {
  if (hoverId === id) return;
  hoverId = id;
  groupHover = null;
  if (id) expanded = applyFocus(expanded, hierarchy, id);
  paint();
}

function selectDevice(id) {
  selectedId = id;
  hoverId = id;
  touchArmed = null;
  groupHover = null;
  const device = byId.get(id);
  if (!device) return;
  expanded = applyFocus(expanded, hierarchy, id);
  const point = pixelOf(device.coords);
  map.zoomToNative(point.u, point.v);
  paint();
  detail.querySelector("h2")?.focus?.();
}

function armTouch(id) {
  touchArmed = id;
  showHover(id);
}

function showGroup(label) {
  if (!label?.groupId) return;
  groupHover = groups.get(label.groupId) || null;
  hoverId = null;
  if (groupHover) {
    for (const id of groupHover.device_ids || []) expanded = applyFocus(expanded, hierarchy, id);
  }
  paint();
}

function renderGroupDetail(group) {
  detail.append(
    el("p", "kicker", "Place"),
    title(group.label || group.id),
    el("p", null, "These devices are recorded at this place. Being in the same place is not a connection."),
  );
  const list = el("ul", "group-members");
  const ids = group.device_ids || [];
  if (!ids.length) list.append(el("li", null, "No equipment is assigned here."));
  for (const id of ids) {
    const item = byId.get(id);
    if (!item) continue;
    const row = document.createElement("li");
    const button = el("button", "result", `${id}`);
    button.type = "button";
    button.addEventListener("click", () => selectDevice(id));
    const word = item.role === "ap" ? "access point" : item.role === "radio" ? "radio" : item.role === "switch" ? "switch" : item.role === "router" ? "router" : "equipment";
    row.append(button, document.createTextNode(` ${word}. ${item.model}`));
    list.append(row);
  }
  detail.append(list);
}

function renderDetail(device) {
  detail.replaceChildren();
  if (!device && groupHover) {
    renderGroupDetail(groupHover);
    return;
  }
  if (!device) {
    const active = devices.filter((item) => item.status === "active").length;
    detail.append(
      el("p", "kicker", "As-built public view"),
      el("h2", null, asbuilt.title),
      el("p", null, `${devices.length} devices, ${active} active, ${links.length} links.`),
      el("p", "status-line", claim.distanceLabel),
      el("p", null, "Select a place or a piece of equipment to see what it is and how it connects back to the main router."),
    );
    const about = document.createElement("details");
    about.id = "about";
    about.className = "about";
    const summary = document.createElement("summary");
    summary.textContent = "About and data quality";
    about.appendChild(summary);
    about.appendChild(el("p", null, "The background is the registered crop of the Oct 31 aerial, not the full frame. Horizontal distance is the geodesic on the original longitude and latitude. The sampled image transform is validated. This is not a survey. The white margin is not a property boundary, and bright pixels are not used to hide equipment."));
    about.appendChild(el("p", "muted", outsideSummary()));
    const list = el("ul", "review");
    for (const item of asbuilt.pending_review) {
      const li = document.createElement("li");
      li.textContent = item.item;
      list.appendChild(li);
    }
    about.append(el("h3", null, "Source notes"), list);
    const limits = el("ul", "review");
    for (const item of metadata.blockers || []) {
      const li = document.createElement("li");
      li.textContent = item;
      limits.appendChild(li);
    }
    about.append(el("h3", null, "Registration limits"), limits);
    detail.appendChild(about);
    return;
  }
  detail.append(el("p", "kicker", selectedId === device.id ? "Selected" : "Highlighted"));
  const story = el("div");
  renderDeviceStory(story, {
    device,
    detail: friendlyById[device.id] || null,
    links: linksWithCoords(links, devices, asbuilt.wan),
    groupLabel: groups.get(device.location_group)?.label || device.location_group,
    claim,
    geotransform,
    image,
    nearEdgeIds: NEAR_EDGE,
  });
  detail.append(story);
}

function title(text) {
  const node = document.createElement("h2");
  node.tabIndex = -1;
  node.textContent = text;
  return node;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function addFact(list, name, value) {
  const dt = document.createElement("dt");
  dt.textContent = name;
  const dd = document.createElement("dd");
  dd.textContent = value;
  list.append(dt, dd);
}

function runSearch() {
  const text = query.value.trim().toLowerCase();
  results.replaceChildren();
  if (!text) {
    results.hidden = true;
    return;
  }
  const found = devices.filter((device) => {
    const group = groups.get(device.location_group)?.label || "";
    const friendlyText = friendlyById[device.id]?.purpose?.text || "";
    return [device.id, device.model, device.role, group, device.public_summary, friendlyText].join(" ").toLowerCase().includes(text);
  }).slice(0, 12);
  if (!found.length) {
    results.hidden = false;
    results.appendChild(el("p", "muted", "No matching equipment"));
    return;
  }
  for (const device of found) {
    const button = el("button", "result", device.id);
    button.type = "button";
    button.dataset.result = device.id;
    button.appendChild(el("span", "muted", ` ${device.role} · ${groups.get(device.location_group)?.label || ""}`));
    button.addEventListener("click", () => {
      results.hidden = true;
      selectDevice(device.id);
    });
    results.appendChild(button);
  }
  results.hidden = false;
}

map.on("markerenter", (item) => showHover(item.id));
map.on("markerleave", () => {
  if (selectedId) {
    hoverId = selectedId;
    paint();
    return;
  }
  if (touchArmed) return;
  showHover(null);
});
map.on("markerpointerup", (item) => {
  if (item.pointerType !== "touch") return;
  const now = performance.now();
  if (now - lastTouch < 40) return;
  lastTouch = now;
  if (touchArmed === item.id) selectDevice(item.id);
  else armTouch(item.id);
});
map.on("markerclick", (item) => {
  if (item.pointerType === "touch" || (lastTouch > 0 && performance.now() - lastTouch < 700)) return;
  selectDevice(item.id);
});
map.on("labelenter", (label) => showGroup(label));
map.on("labeltouch", (label) => {
  lastTouch = performance.now();
  showGroup(label);
});
map.on("labelleave", () => {
  if (performance.now() - lastTouch < 700) return;
  groupHover = null;
  if (selectedId) hoverId = selectedId;
  paint();
});
map.on("labelclick", (label) => {
  const group = groups.get(label.groupId);
  if (!group) return;
  const points = group.device_ids.map((id) => pixelOf(byId.get(id)?.coords)).filter(Boolean);
  map.fitToPoints(points);
});

document.querySelector("#zoom-in").addEventListener("click", () => map.zoomBy(1.3));
document.querySelector("#zoom-out").addEventListener("click", () => map.zoomBy(1 / 1.3));
document.querySelector("#fit").addEventListener("click", () => {
  selectedId = null;
  hoverId = null;
  groupHover = null;
  map.fit();
  paint();
});
document.querySelector("#legend-btn").addEventListener("click", () => {
  legend.hidden = !legend.hidden;
  document.querySelector("#legend-btn").setAttribute("aria-expanded", String(!legend.hidden));
});
document.querySelector("#legend-close").addEventListener("click", () => {
  legend.hidden = true;
  document.querySelector("#legend-btn").setAttribute("aria-expanded", "false");
});
document.querySelector("#show-network").addEventListener("click", () => {
  const section = document.querySelector("#topology");
  const button = document.querySelector("#show-network");
  const show = section.hidden;
  section.hidden = !show;
  button.textContent = show ? "Hide whole network" : "Show whole network";
  button.setAttribute("aria-expanded", String(show));
  refit();
});
document.querySelector("#topo-collapse").addEventListener("click", () => {
  const hidden = topoBody.hidden;
  topoBody.hidden = !hidden;
  document.querySelector("#topo-collapse").textContent = hidden ? "Hide" : "Show";
  document.querySelector("#topo-collapse").setAttribute("aria-expanded", String(hidden));
  topoSection.classList.toggle("is-collapsed", !hidden);
});
document.querySelector("#search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const first = results.querySelector("[data-result]");
  if (first) first.click();
});
query.addEventListener("input", runSearch);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    results.hidden = true;
    legend.hidden = true;
  }
  if (event.key === "/" && document.activeElement !== query) {
    event.preventDefault();
    query.focus();
  }
});

function refit() {
  const mapBox = document.querySelector("#map").getBoundingClientRect();
  const panels = [...document.querySelectorAll("#topology, #legend")].filter((panel) => !panel.hidden).map((panel) => panel.getBoundingClientRect());
  map.fit(insetsAround(mapBox, panels));
}

paint();
requestAnimationFrame(refit);
window.addEventListener("resize", refit);
