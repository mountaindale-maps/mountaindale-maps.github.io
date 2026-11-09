import { evaluateCalibration } from "./lib/calibration.mjs";
import { measureRoute } from "./lib/distance.mjs";
import { JPEG_CANDIDATE_GEOTRANSFORM, lonLatToImage } from "./lib/projection.mjs";
import { tileUrl } from "./lib/tiles.mjs";
import {
  applyFocus,
  defaultExpandedKeys,
  highlightForDevice,
  highlightForGroup,
} from "./lib/topology-model.mjs";
import { fillDistanceList } from "./format-distance.js";
import { createMap, insetsAround } from "./map.js";
import { mountTopology } from "./topology-view.js";

const detail = document.querySelector("#detail");
const results = document.querySelector("#results");
const query = document.querySelector("#q");
const calib = document.querySelector("#calib");
const legend = document.querySelector("#legend");
const topoSection = document.querySelector("#topology");
const topoBody = document.querySelector("#topo-body");

const [asbuilt, hierarchy, metadata] = await Promise.all([
  fetch("data/asbuilt_public.json").then((response) => response.json()),
  fetch("data/topology_hierarchy.json").then((response) => response.json()),
  fetch("data/metadata.json").then((response) => response.json()),
]);

if (asbuilt.schema_version.split(".")[0] !== "1") {
  detail.textContent = "This page does not understand that data schema.";
  throw new Error("schema");
}

const claim = evaluateCalibration(metadata);
calib.textContent = claim.banner;
const geotransform = metadata?.candidate_georeferencing?.gdal_geotransform || JPEG_CANDIDATE_GEOTRANSFORM;
const image = metadata.imagery;
const devices = asbuilt.devices;
const byId = new Map(devices.map((device) => [device.id, device]));
const groups = new Map(asbuilt.location_groups.map((group) => [group.id, group]));
const links = asbuilt.links;

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
  map.setPolylines(links.flatMap((link) => {
    const a = pixelOf(endpoint(link.parent));
    const b = pixelOf(endpoint(link.child));
    if (!a || !b) return [];
    return [{ id: link.id, medium: link.medium, hot: hotLinks.has(link.id), points: [a, b] }];
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

function pathMetrics(device) {
  if (!device || device.status === "inactive") return [];
  return (hierarchy.path_links[device.id] || []).flatMap((linkId) => {
    const link = links.find((item) => item.id === linkId);
    if (!link) return [];
    const a = endpoint(link.parent);
    const b = endpoint(link.child);
    if (!a || !b) return [];
    const metrics = measureRoute(
      [{ lon: a.lon, lat: a.lat }, { lon: b.lon, lat: b.lat }],
      [{ vertical_rise_m: 0, slack_m: 0, service_loop_m: 0 }],
      claim,
    );
    return [{ link, metrics }];
  });
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
    el("p", "kicker", "Location"),
    title(group.label || group.id),
    el("p", null, "These devices share a place. A location group is not a connection."),
  );
  const list = el("ul", "group-members");
  const ids = group.device_ids || [];
  if (!ids.length) list.append(el("li", null, "No equipment is assigned here."));
  for (const id of ids) {
    const item = byId.get(id);
    if (!item) continue;
    const row = document.createElement("li");
    const button = el("button", "result", id);
    button.type = "button";
    button.addEventListener("click", () => selectDevice(id));
    row.append(button, document.createTextNode(` ${item.role} · ${item.model}`));
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
      el("p", null, "The image alignment was checked on the full frame. This is not a survey."),
      el("p", "muted", "Live Earth has not been re-exported. Site 96 placement is still unresolved. One inactive AP has no uplink."),
    );
    const about = document.createElement("details");
    about.id = "about";
    about.className = "about";
    const summary = document.createElement("summary");
    summary.textContent = "About and data quality";
    about.appendChild(summary);
    about.appendChild(el("p", null, "Source notes from the equipment export. Image alignment has since been checked. Ground accuracy is still unverified. These notes do not change the drawn links."));
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
  const point = pixelOf(device.coords);
  detail.append(
    el("p", "kicker", selectedId === device.id ? "Selected" : "Highlighted"),
    title(device.id),
    el("p", null, `${device.role} · ${device.model} · ${device.status}`),
    el("p", null, `Group ${groups.get(device.location_group)?.label || device.location_group}. Grouping is not a connection.`),
  );
  const facts = el("dl", "facts");
  addFact(facts, "Ports", device.ports || "Not stated");
  addFact(facts, "Labelled mount height", device.mount_height || "No labelled height in the source");
  addFact(facts, "Raw KML altitude", device.coords.alt_m == null ? "None in the source. Not filled in." : `${device.coords.alt_m} m, unvalidated, not a mount height`);
  addFact(facts, "Longitude, latitude", `${device.coords.lon}, ${device.coords.lat}`);
  addFact(facts, "Image pixel", `${point.u.toFixed(1)}, ${point.v.toFixed(1)}`);
  detail.appendChild(facts);
  if (device.public_summary) detail.appendChild(el("p", null, device.public_summary));
  if (device.service_area_tag?.tentative) {
    detail.appendChild(el("p", "flag-note", `Tentative service area from ${device.service_area_tag.group}. Not a shared mounting.`));
  }
  for (const flag of device.data_quality || []) {
    const note = el("p", `flag-note severity-${flag.severity || "info"}`, flag.message);
    detail.appendChild(note);
  }
  if (device.status === "inactive") {
    detail.appendChild(el("p", "flag-note", "Inactive AP with no uplink. No path is drawn and no route length is invented."));
    return;
  }
  const block = el("div", "distances");
  const pieces = pathMetrics(device);
  if (!pieces.length) {
    block.appendChild(el("p", null, "No mapped path."));
  } else {
    pieces.forEach(({ link, metrics }) => {
      const wrap = el("section", "hop");
      wrap.appendChild(el("h3", null, `${link.parent} → ${link.child}`));
      wrap.appendChild(el("p", "muted", link.medium));
      const list = el("div", null);
      fillDistanceList(list, metrics, "Segment");
      wrap.appendChild(list);
      block.appendChild(wrap);
    });
    const sum = pieces.reduce((total, piece) => total + piece.metrics.totals.horizontal_ellipsoidal_m, 0);
    block.appendChild(el("p", "distance-total", `Path horizontal sum ${sum.toFixed(2)} m · ${(sum / 0.3048).toFixed(2)} ft. ${claim.distanceLabel}.`));
  }
  detail.appendChild(block);
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
    return [device.id, device.model, device.role, group, device.public_summary].join(" ").toLowerCase().includes(text);
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
