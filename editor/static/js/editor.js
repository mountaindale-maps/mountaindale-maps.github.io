import { evaluateCalibration, importCalibration, proposeCalibration } from "/js/lib/calibration.mjs";
import { imageToLonLat, lonLatToImage, JPEG_CANDIDATE_GEOTRANSFORM } from "/js/lib/projection.mjs";
import { tileUrl } from "/js/lib/tiles.mjs";
import { commit, createHistory, redo, undo } from "/js/lib/history.mjs";
import {
  addLink,
  addNote,
  addPlannedDevice,
  addPlannedRoute,
  assignGroup,
  createGroup,
  ungroupDevice,
  deviceById,
  hierarchyForPlan,
  importDocument,
  measureLink,
  moveDevice,
  moveDeviceToImagePixel,
  planFromPublic,
  removeLink,
  removePlanned,
  restoreBaselineCoords,
  setCablePath,
  setPublicProfile,
  setSegmentExtra,
  verticesForLink,
} from "/js/lib/plan.mjs";
import { shownOnMap } from "/js/lib/map-links.mjs";
import { classifyWirelessHops } from "/js/lib/wireless-hops.mjs";
import { linksWithCoords, renderDeviceStory } from "/js/lib/render-card.mjs";
import { buildPublicSnapshot, describePublicEdits } from "/js/lib/sanitize.mjs";
import { applyFocus, defaultExpandedKeys, highlightForDevice } from "/js/lib/topology-model.mjs";
import { fillDistanceList } from "/js/format-distance.js";
import { createMap, insetsAround } from "/js/map.js";
import { mountTopology } from "/js/topology-view.js";

const detail = document.querySelector("#detail");
const calib = document.querySelector("#calib");
const saveState = document.querySelector("#save-state");
const topoBody = document.querySelector("#topo-body");

const [baseline, baselineHierarchy, metadata, health, stateResponse, friendlyDoc] = await Promise.all([
  fetch("/api/baseline").then((response) => response.json()),
  fetch("/api/topology").then((response) => response.json()),
  fetch("/api/metadata").then((response) => response.json()),
  fetch("/api/health").then((response) => response.json()),
  fetch("/api/state"),
  fetch("/api/friendly").then((response) => response.json()),
]);
const saved = await stateResponse.json();

document.querySelector("#local-banner").textContent = `Local planning editor on ${health.host}:${health.port}. Loopback only. Saves stay in ${health.dataDir}. Nothing is published.`;

const baselineLinkJson = JSON.stringify(baseline.links);
const friendlyById = friendlyDoc?.devices_by_id || {};
let history = createHistory(saved.plan || planFromPublic(baseline, metadata));
if (saved.code === "PLAN_CORRUPT") {
  const names = (saved.backups || []).join(", ") || "none";
  queueMicrotask(() => setStatus(`${saved.error} Backups left untouched: ${names}`));
}
let mode = "inspect";
let selectedId = null;
let selectedLinkId = null;
let hoverId = null;
let expanded = defaultExpandedKeys(baselineHierarchy.root);
let topoApi = null;
let topoSource = null;
let dragOrigin = null;
let exportReady = false;
let exportGeneration = 0;

const map = createMap(document.querySelector("#map"), {
  imageWidth: metadata.imagery.width,
  imageHeight: metadata.imagery.height,
  tileUrl: (z, x, y) => tileUrl(z, x, y).replace("tiles/", "/tiles/"),
});

function present() { return history.present; }
function gt() {
  return present().calibration?.candidate_georeferencing?.gdal_geotransform || JPEG_CANDIDATE_GEOTRANSFORM;
}
function claim() { return evaluateCalibration(present().calibration || metadata); }
function setStatus(text) { saveState.textContent = text; }
function update(next) { history = commit(history, next); render(); }
function tryUpdate(builder) {
  try {
    update(builder(present()));
    setStatus("Edited locally. Not saved until you press Save.");
  } catch (error) {
    setStatus(error.message);
  }
}

function pixelOf(coords) {
  if (!coords || !Number.isFinite(coords.lon)) return null;
  const [u, v] = lonLatToImage(coords.lon, coords.lat, gt());
  return { u, v };
}
function syncTopology() {
  const next = hierarchyForPlan(present(), baselineHierarchy, baselineLinkJson);
  if (next !== topoSource) {
    topoSource = next;
    topoBody.replaceChildren();
    topoApi = mountTopology(topoBody, {
      hierarchy: next,
      devices: present().asbuilt.devices,
      handlers: {
        onToggle(key) {
          if (expanded.has(key)) expanded.delete(key);
          else expanded.add(key);
          render();
        },
        onSelectDevice(id) { selectDevice(id); },
        onSelectBranch(node) {
          expanded.add(node.key);
          const points = (node.device_ids || []).map((id) => pixelOf(deviceById(present(), id)?.coords)).filter(Boolean);
          if (points.length) map.fitToPoints(points);
          render();
        },
      },
    });
  }
  return next;
}

function selectDevice(id) {
  selectedId = id;
  hoverId = id;
  const hier = hierarchyForPlan(present(), baselineHierarchy, baselineLinkJson);
  expanded = applyFocus(expanded, hier, id);
  const point = pixelOf(deviceById(present(), id)?.coords);
  if (point) map.zoomToNative(point.u, point.v);
  render();
}

function render() {
  const plan = present();
  const hier = syncTopology();
  const active = deviceById(plan, hoverId || selectedId);
  const highlight = highlightForDevice(hier, active && active.status !== "planned" ? active : null);
  const hot = new Set(highlight.linkIds);
  const wirelessHop = classifyWirelessHops([
    ...plan.asbuilt.links,
    ...plan.planned_routes.map((route) => ({ id: route.id, parent: route.from, child: route.to, medium: route.medium })),
  ]).hop;
  const lines = [];
  for (const link of plan.asbuilt.links.filter(shownOnMap)) {
    const vertices = verticesForLink(plan, link);
    if (!vertices) continue;
    lines.push({
      id: link.id,
      medium: link.medium,
      hop: wirelessHop.get(link.id) || "",
      hot: hot.has(link.id) || link.id === selectedLinkId,
      editable: mode === "path" && link.id === selectedLinkId,
      points: vertices.map((vertex) => pixelOf(vertex)).filter(Boolean),
    });
  }
  for (const route of plan.planned_routes) {
    lines.push({
      id: route.id,
      medium: route.medium,
      hop: wirelessHop.get(route.id) || "",
      planned: true,
      points: (route.vertices || []).map((vertex) => pixelOf(vertex)).filter(Boolean),
    });
  }
  map.setPolylines(lines);
  const markers = [
    ...plan.asbuilt.devices.map((device) => ({
      id: device.id,
      ...pixelOf(device.coords),
      role: device.role,
      status: device.status,
      hot: device.id === selectedId,
      draggable: mode === "move",
      flag: (device.data_quality || []).some((item) => item.severity === "warning") ? "warning" : (device.data_quality || []).length ? "info" : "",
      caption: device.id,
    })),
    ...plan.planned_devices.map((device) => ({
      id: device.id,
      ...pixelOf(device.coords),
      role: device.role,
      status: "planned",
      planned: true,
      hot: device.id === selectedId,
      draggable: mode === "move" || mode === "plan",
      caption: `${device.id} planned`,
    })),
  ];
  map.setMarkers(markers);
  map.setLabels(plan.asbuilt.location_groups.flatMap((group) => {
    const point = pixelOf(group.anchor_coords || group.centroid);
    return point ? [{ id: group.id, groupId: group.id, kind: "group", text: group.label, ...point }] : [];
  }));
  topoApi.update({
    expanded,
    hotDeviceId: active?.status === "planned" ? null : active?.id || null,
    hotNodeIds: new Set(highlight.nodeIds || []),
    hotLinkIds: hot,
    ancestorKeys: new Set(active ? hier.ancestors?.[active.id] || [] : []),
  });
  calib.textContent = claim().banner;
  document.querySelector("#undo").disabled = history.past.length === 0;
  document.querySelector("#redo").disabled = history.future.length === 0;
  for (const button of document.querySelectorAll("#modes button")) {
    button.classList.toggle("is-on", button.dataset.mode === mode);
  }
  renderDetail(plan, hier);
}

function renderDetail(plan, hier) {
  detail.replaceChildren();
  detail.append(toolPanel(plan, hier), deviceCard(plan, hier));
}

function toolPanel(plan) {
  const wrap = el("div", "tool-block");
  wrap.append(el("p", "kicker", modeLabel(mode)));
  if (mode === "move") wrap.append(moveTools(plan));
  if (mode === "path") wrap.append(pathTools(plan));
  if (mode === "group") wrap.append(groupTools(plan));
  if (mode === "connect") wrap.append(connectTools(plan));
  if (mode === "plan") wrap.append(planTools(plan));
  if (mode === "notes") wrap.append(noteTools(plan));
  if (mode === "inspect") wrap.append(calibrationTools(plan), el("p", null, "Inspect does not change the as-built record. Use Move, Paths, Groups, or Connections when you mean to edit."));
  return wrap;
}

function moveTools(plan) {
  const device = deviceById(plan, selectedId);
  const box = el("div", null);
  if (!device || device.status === "planned" && !plan.planned_devices.includes(device) && !plan.asbuilt.devices.includes(device)) {
    box.append(el("p", null, "Select a device, then drag it or type coordinates. Stored longitude and latitude change. Links do not."));
    return box;
  }
  const point = pixelOf(device.coords);
  box.append(el("p", null, "Dragging updates the pin only. Connections stay attached to the device id."));
  const lon = numberField("Longitude", device.coords.lon, "lon-input");
  const lat = numberField("Latitude", device.coords.lat, "lat-input");
  const u = numberField("Image u", point.u, "u-input");
  const v = numberField("Image v", point.v, "v-input");
  const apply = el("button", null, "Apply coordinates");
  apply.type = "button";
  apply.id = "apply-coords";
  apply.addEventListener("click", () => {
    tryUpdate((current) => moveDevice(current, device.id, { lon: readNum(lon), lat: readNum(lat) }, gt()));
  });
  const applyPixel = el("button", null, "Apply image pixel");
  applyPixel.type = "button";
  applyPixel.addEventListener("click", () => tryUpdate((current) => moveDeviceToImagePixel(current, device.id, readNum(u), readNum(v), gt())));
  const nudge = el("button", null, "Nudge 1 px east");
  nudge.type = "button";
  nudge.addEventListener("click", () => tryUpdate((current) => moveDeviceToImagePixel(current, device.id, point.u + 1, point.v, gt())));
  const reset = el("button", null, "Reset to baseline pin");
  reset.type = "button";
  reset.addEventListener("click", () => tryUpdate((current) => restoreBaselineCoords(current, device.id)));
  const actions = el("div", "row-actions");
  actions.append(apply, applyPixel, nudge, reset);
  box.append(lon.label, lat.label, u.label, v.label, actions);
  return box;
}

function pathTools(plan) {
  const box = el("div", null);
  const device = deviceById(plan, selectedId);
  box.append(el("p", null, "Cable vertices are geometry. They do not add or remove network links. Click the map to add a vertex on the selected link."));
  if (!device) return box;
  const related = plan.asbuilt.links.filter((link) => link.parent === device.id || link.child === device.id);
  for (const link of related) {
    const button = el("button", null, link.id);
    button.type = "button";
    button.addEventListener("click", () => { selectedLinkId = link.id; render(); });
    box.append(button);
  }
  if (!selectedLinkId) return box;
  const link = plan.asbuilt.links.find((item) => item.id === selectedLinkId);
  if (!link) return box;
  const path = plan.cable_paths[link.id] || { intermediates: [], segments: [] };
  path.intermediates.forEach((vertex, index) => {
    const row = el("div", "row-actions");
    row.append(el("span", null, `Vertex ${index + 1}: ${vertex.lon.toFixed(6)}, ${vertex.lat.toFixed(6)}`));
    const remove = el("button", null, "Delete vertex");
    remove.type = "button";
    remove.addEventListener("click", () => {
      const next = path.intermediates.filter((_, item) => item !== index);
      tryUpdate((current) => setCablePath(current, link.id, next, path.segments));
    });
    row.append(remove);
    box.append(row);
  });
  const metrics = measureLink(plan, link, claim());
  if (metrics) {
    metrics.segments.forEach((segment, index) => {
      const rise = numberField(`Segment ${index + 1} vertical drop m, added`, segment.vertical_drop_m ?? segment.vertical_rise_m, index === 0 ? "segment-rise-0" : "");
      const slope = numberField(`Segment ${index + 1} slope rise m, hypotenuse`, segment.slope_rise_m, index === 0 ? "segment-slope-0" : "");
      const slack = numberField("Slack m", segment.slack_m, "");
      const loop = numberField("Service loop m", segment.service_loop_m, "");
      const apply = el("button", null, "Apply allowances");
      apply.type = "button";
      apply.addEventListener("click", () => tryUpdate((current) => setSegmentExtra(current, link.id, index, {
        vertical_drop_m: readNum(rise),
        slope_rise_m: readNum(slope),
        slack_m: readNum(slack),
        service_loop_m: readNum(loop),
      })));
      box.append(rise.label, slope.label, slack.label, loop.label, apply);
    });
    const list = el("div", "distances");
    fillDistanceList(list, metrics, link.id);
    box.append(list);
  }
  return box;
}

function groupTools(plan) {
  const box = el("div", null);
  box.append(el("p", null, "Location groups only change which pins hover together. They never change connections."));
  const select = document.createElement("select");
  select.id = "group-select";
  for (const group of plan.asbuilt.location_groups) {
    const option = document.createElement("option");
    option.value = group.id;
    option.textContent = group.label;
    select.append(option);
  }
  const assign = el("button", null, "Assign selected device");
  assign.type = "button";
  assign.id = "assign-group";
  assign.addEventListener("click", () => {
    if (!selectedId) return setStatus("Select a device first.");
    tryUpdate((current) => assignGroup(current, selectedId, select.value));
  });
  const clear = el("button", null, "Remove from all groups");
  clear.type = "button";
  clear.id = "ungroup-device";
  clear.addEventListener("click", () => {
    if (!selectedId) return setStatus("Select a device first.");
    tryUpdate((current) => ungroupDevice(current, selectedId));
  });
  const id = textField("New group id", "new-group-id");
  const label = textField("New group label", "new-group-label");
  const create = el("button", null, "Create group and assign");
  create.type = "button";
  create.addEventListener("click", () => {
    if (!selectedId) return setStatus("Select a device first.");
    tryUpdate((current) => assignGroup(createGroup(current, id.input.value.trim(), label.input.value.trim()), selectedId, id.input.value.trim()));
  });
  box.append(select, assign, clear, id.label, label.label, create);
  return box;
}

function connectTools(plan) {
  const box = el("div", null);
  box.append(el("p", null, "Adding a LAN link is refused when the child already has a parent, unless you explicitly replace that parent. This does not invent a second uplink. A link that touches planned equipment is marked planned and is left out of the public snapshot."));
  const parent = textField("Parent id", "link-parent");
  const child = textField("Child id", "link-child");
  const medium = document.createElement("select");
  medium.id = "link-medium";
  for (const value of ["wired-ethernet", "airmax-ptp", "airmax-ptmp", "wan"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    medium.append(option);
  }
  const replace = document.createElement("input");
  replace.type = "checkbox";
  replace.id = "replace-parent";
  const replaceLabel = el("label", "check", "");
  replaceLabel.append(replace, document.createTextNode("Replace the existing LAN parent on purpose"));
  const add = el("button", null, "Add link");
  add.type = "button";
  add.id = "add-link";
  add.addEventListener("click", () => tryUpdate((current) => addLink(current, {
    parent: parent.input.value.trim(),
    child: child.input.value.trim(),
    medium: medium.value,
  }, { replaceParent: replace.checked })));
  const remove = el("button", null, "Remove selected link");
  remove.type = "button";
  remove.id = "remove-link";
  let armed = false;
  remove.addEventListener("click", () => {
    if (!selectedLinkId) return setStatus("Select a link in Paths first.");
    if (!armed) {
      armed = true;
      remove.textContent = `Confirm removal of ${selectedLinkId}`;
      return;
    }
    tryUpdate((current) => removeLink(current, selectedLinkId));
  });
  box.append(parent.label, child.label, medium, replaceLabel, add, remove);
  if (plan) box.append(el("p", "muted", `${plan.asbuilt.links.length} as-built links`));
  return box;
}

function planTools(plan) {
  const box = el("div", null);
  box.append(el("p", null, "Planned equipment and routes are drawn separately and are excluded from every public snapshot."));
  const id = textField("Planned id", "planned-id");
  const role = document.createElement("select");
  role.id = "planned-role";
  for (const value of ["ap", "switch", "radio", "router"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    role.append(option);
  }
  const model = textField("Model", "planned-model");
  const lon = numberField("Longitude", -104.949, "planned-lon");
  const lat = numberField("Latitude", 38.588, "planned-lat");
  const add = el("button", null, "Add planned device");
  add.type = "button";
  add.id = "add-planned";
  add.addEventListener("click", () => tryUpdate((current) => addPlannedDevice(current, {
    id: id.input.value.trim(),
    role: role.value,
    model: model.input.value.trim(),
    coords: { lon: readNum(lon), lat: readNum(lat) },
  })));
  const from = textField("Route from id", "route-from");
  const to = textField("Route to id", "route-to");
  const route = el("button", null, "Add planned route");
  route.type = "button";
  route.id = "add-route";
  route.addEventListener("click", () => tryUpdate((current) => addPlannedRoute(current, {
    from: from.input.value.trim(),
    to: to.input.value.trim(),
    label: "Planned route",
  })));
  box.append(id.label, role, model.label, lon.label, lat.label, add, from.label, to.label, route);
  for (const device of plan.planned_devices) {
    const row = el("div", "planned-item");
    row.textContent = `${device.id} (${device.role})`;
    const remove = el("button", null, "Remove");
    remove.type = "button";
    remove.addEventListener("click", () => tryUpdate((current) => removePlanned(current, device.id)));
    row.append(remove);
    box.append(row);
  }
  for (const item of plan.planned_routes) {
    const row = el("div", "planned-item");
    row.textContent = item.id;
    box.append(row);
  }
  return box;
}

function noteTools(plan) {
  const box = el("div", null);
  const area = document.createElement("textarea");
  area.id = "note-text";
  area.rows = 4;
  area.placeholder = "Change request. Stays on this computer.";
  const add = el("button", null, "Add change-request note");
  add.type = "button";
  add.id = "add-note";
  add.addEventListener("click", () => tryUpdate((current) => addNote(current, {
    text: area.value,
    device_ids: selectedId ? [selectedId] : [],
  })));
  box.append(area, add);
  for (const note of plan.notes) {
    const row = el("article", "note-item");
    row.append(el("p", null, note.text), el("p", "muted", note.created));
    box.append(row);
  }
  return box;
}

function calibrationTools(plan) {
  const box = el("div", null);
  box.append(el("p", null, "The sampled image transform is validated for approximate horizontal distances. Ground accuracy is still unverified. Importing an affine uses it immediately and does not publish it. A correlation residual or a roundtrip does not open the survey gate."));
  const file = document.createElement("input");
  file.type = "file";
  file.id = "import-calibration";
  file.accept = "application/json,.json";
  file.addEventListener("change", async () => {
    const picked = file.files?.[0];
    if (!picked) return;
    try {
      const doc = JSON.parse(await picked.text());
      tryUpdate((current) => ({
        ...current,
        calibration: importCalibration(current.calibration || metadata, doc),
      }));
    } catch (error) {
      setStatus(error.message);
    }
  });
  const method = textField("Ground-survey method", "cal-method");
  const who = textField("Approved by", "cal-by");
  const explicit = document.createElement("input");
  explicit.type = "checkbox";
  explicit.id = "cal-explicit";
  const label = el("label", "check", "");
  label.append(explicit, document.createTextNode("This is an explicit ground survey, not an image-correlation residual."));
  const save = el("button", null, "Record survey calibration locally");
  save.type = "button";
  save.addEventListener("click", () => tryUpdate((current) => ({
    ...current,
    calibration: proposeCalibration(current.calibration || metadata, {
      validated_calibration: {
        explicitly_validated: explicit.checked,
        survey_accuracy_validated: explicit.checked,
        method: method.input.value,
        approved_by: who.input.value,
      },
    }),
  })));
  box.append(el("label", null, "Import calibration JSON"), file, method.label, who.label, label, save);
  if (plan.calibration?.calibration_status) box.append(el("p", "muted", plan.calibration.calibration_status));
  return box;
}

function deviceCard(plan, hier) {
  const device = deviceById(plan, selectedId);
  const card = el("div", null);
  if (!device) {
    card.append(el("h2", null, "No device selected"), el("p", null, `${plan.asbuilt.devices.length} as-built devices in the working copy. Original baseline is unchanged until you export a reviewed snapshot.`));
    return card;
  }
  card.append(el("h2", null, device.id), el("p", null, `${device.role} · ${device.model || "model unset"} · ${device.status}`));
  if (device.local_private) card.append(el("p", "flag-note", "Private fields stay on this computer and are not part of the public description."));
  card.append(el("p", null, "Private notes stay under Change requests. They are not published with these details."));
  const preview = el("div", "public-preview");
  preview.id = "public-preview";
  renderDeviceStory(preview, {
    device,
    detail: friendlyById[device.id] || null,
    links: linksWithCoords(plan.asbuilt.links, plan.asbuilt.devices, plan.asbuilt.wan),
    groupLabel: plan.asbuilt.location_groups.find((group) => group.id === device.location_group)?.label || device.location_group,
    claim: claim(),
    geotransform: gt(),
    image: metadata.imagery,
    nearEdgeIds: metadata.near_edge_device_ids || [],
  });
  card.append(el("h3", null, "Public preview"), preview);
  const profile = device.public_profile || {};
  const purpose = textField("What it does, public wording", "purpose-input");
  purpose.input.value = profile.purpose || "";
  const location = textField("Exact location, public wording", "location-input");
  location.input.value = profile.exact_location || "";
  const mounting = textField("Mounting, public wording", "mounting-input");
  mounting.input.value = profile.mounting || "";
  const power = textField("Power source, public wording", "power-input");
  power.input.value = profile.supply?.description || "";
  const supplyDevice = textField("Supplying device id, if recorded", "supply-device-input");
  supplyDevice.input.value = profile.supply?.device_id || "";
  const outlet = textField("Outlet, if recorded", "outlet-input");
  outlet.input.value = profile.supply?.outlet || "";
  const connection = textField("Connection note, public wording", "connection-input");
  connection.input.value = profile.connection || "";
  const saveDetails = el("button", null, "Save public details");
  saveDetails.type = "button";
  saveDetails.id = "save-public-details";
  saveDetails.addEventListener("click", () => tryUpdate((current) => setPublicProfile(current, device.id, {
    purpose: purpose.input.value,
    exact_location: location.input.value,
    mounting: mounting.input.value,
    connection: connection.input.value,
    supply: {
      description: power.input.value,
      device_id: supplyDevice.input.value,
      outlet: outlet.input.value,
    },
  })));
  const clearDetails = el("button", null, "Clear public wording");
  clearDetails.type = "button";
  clearDetails.id = "clear-public-details";
  clearDetails.addEventListener("click", () => tryUpdate((current) => setPublicProfile(current, device.id, {
    purpose: "",
    exact_location: "",
    mounting: "",
    connection: "",
    supply: { description: "", device_id: "", outlet: "" },
  })));
  card.append(purpose.label, location.label, mounting.label, power.label, supplyDevice.label, outlet.label, connection.label, saveDetails, clearDetails);
  return card;
}

function numberField(label, value, id) {
  const input = document.createElement("input");
  input.type = "number";
  input.step = "any";
  input.value = value ?? "";
  if (id) input.id = id;
  const wrap = el("label", null, label);
  wrap.append(input);
  return { label: wrap, input };
}
function textField(label, id) {
  const input = document.createElement("input");
  input.type = "text";
  input.id = id;
  const wrap = el("label", null, label);
  wrap.append(input);
  return { label: wrap, input };
}
function readNum(field) { return Number(field.input.value); }
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}
function modeLabel(value) {
  return { inspect: "Inspect", move: "Move markers", path: "Cable paths", group: "Location groups", connect: "Connections", plan: "Planned work", notes: "Change requests" }[value];
}

function openMarker(id) {
  selectedId = id;
  render();
}
map.on("markerpointerup", (item) => {
  if (item.pointerType === "touch") openMarker(item.id);
});
map.on("markerclick", (item) => {
  if (item.pointerType === "touch") return;
  openMarker(item.id);
});
map.on("markerdragstart", () => { dragOrigin = present(); });
map.on("markerdrag", ({ id, u, v }) => {
  if (!dragOrigin) return;
  history = { ...history, present: moveDeviceToImagePixel(dragOrigin, id, u, v, gt()) };
  render();
});
map.on("markerdragend", () => {
  if (!dragOrigin) return;
  const dragged = present();
  history = commit({ past: history.past, present: dragOrigin, future: [] }, dragged);
  dragOrigin = null;
  setStatus("Pin moved locally. Not saved until you press Save.");
  render();
});
map.on("vertexdragstart", () => { dragOrigin = present(); });
map.on("vertexdrag", ({ linkId, index, u, v }) => {
  if (!dragOrigin) dragOrigin = present();
  const [lon, lat] = imageToLonLat(u, v, gt());
  const path = dragOrigin.cable_paths[linkId] || { intermediates: [], segments: [] };
  const intermediates = path.intermediates.map((vertex, item) => item === index ? { lon, lat } : vertex);
  history = { ...history, present: setCablePath(dragOrigin, linkId, intermediates, path.segments) };
  render();
});
map.on("vertexdragend", () => {
  if (!dragOrigin) return;
  const dragged = present();
  history = commit({ past: history.past, present: dragOrigin, future: [] }, dragged);
  dragOrigin = null;
});
map.on("mapclick", ({ u, v }) => {
  if (mode !== "path" || !selectedLinkId) return;
  const [lon, lat] = imageToLonLat(u, v, gt());
  const path = present().cable_paths[selectedLinkId] || { intermediates: [], segments: [] };
  tryUpdate((current) => setCablePath(current, selectedLinkId, [...path.intermediates, { lon, lat }], path.segments));
});

document.querySelector("#modes").addEventListener("click", (event) => {
  const button = event.target.closest("[data-mode]");
  if (!button) return;
  mode = button.dataset.mode;
  render();
});
document.querySelector("#undo").addEventListener("click", () => { history = undo(history); render(); });
document.querySelector("#redo").addEventListener("click", () => { history = redo(history); render(); });
document.querySelector("#save").addEventListener("click", async () => {
  const response = await fetch("/api/state", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(present()) });
  const body = await response.json();
  setStatus(response.ok ? "Saved locally. Not published." : body.error);
});
document.querySelector("#reload").addEventListener("click", async () => {
  const body = await fetch("/api/state").then((response) => response.json());
  if (!body.plan) return setStatus("No local save yet.");
  history = commit(history, body.plan);
  setStatus("Reloaded the local save.");
  render();
});
document.querySelector("#backups").addEventListener("click", async () => {
  const body = await fetch("/api/backups").then((response) => response.json());
  const list = document.querySelector("#backup-list");
  list.replaceChildren();
  if (!body.backups.length) list.append(el("p", null, "No backups yet. The second save creates the first backup."));
  for (const name of body.backups) {
    const button = el("button", null, `Restore ${name}`);
    button.type = "button";
    button.addEventListener("click", async () => {
      const restored = await fetch("/api/restore", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) }).then((response) => response.json());
      history = commit(history, restored.plan);
      document.querySelector("#backup-dialog").close();
      render();
    });
    list.append(button);
  }
  document.querySelector("#backup-dialog").showModal();
});
document.querySelector("#import-btn").addEventListener("click", () => document.querySelector("#import-file").click());
document.querySelector("#import-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const documentJson = JSON.parse(await file.text());
    const response = await fetch("/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ document: documentJson }) });
    const body = await response.json();
    if (!response.ok) return setStatus(body.error || "Import was rejected. The current plan was not changed.");
    history = commit(history, body.plan);
    setStatus("Imported into the local editor. It is not saved or published until you say so.");
    render();
  } catch {
    setStatus("Import was rejected. The current plan was not changed.");
  }
});

function selectionFromDialog() {
  return {
    confirmed: document.querySelector("#confirm-review").checked,
    deviceIds: [...document.querySelectorAll("[data-export-device]:checked")].map((input) => input.value),
    includeGroups: document.querySelector("#export-groups")?.checked === true,
    includeConnectivity: document.querySelector("#export-links")?.checked === true,
  };
}
document.querySelector("#review-export").addEventListener("click", () => {
  const edits = describePublicEdits(baseline, present());
  const list = document.querySelector("#edit-list");
  list.replaceChildren();
  const addToggle = (id, label) => {
    const labelNode = el("label", "check", "");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.id = id;
    input.addEventListener("change", invalidateExport);
    labelNode.append(input, document.createTextNode(label));
    list.append(labelNode);
    return input;
  };
  if (!edits.coordinates.length && !edits.metadata.length && !edits.groups && !edits.connectivity) {
    list.append(el("p", null, "No as-built edits to publish. You can still validate a snapshot of the original public baseline."));
  }
  for (const id of new Set([...edits.coordinates, ...edits.metadata])) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.dataset.exportDevice = id;
    input.value = id;
    input.addEventListener("change", invalidateExport);
    const label = el("label", "check", "");
    label.append(input, document.createTextNode(`Include as-built edits for ${id}`));
    list.append(label);
  }
  if (edits.groups) addToggle("export-groups", "Include location-group edits");
  if (edits.connectivity) addToggle("export-links", "Include connectivity edits");
  const excluded = document.querySelector("#excluded-plans");
  const plan = present();
  const plannedIds = plan.planned_devices.map((device) => device.id).join(", ") || "none";
  const routeIds = plan.planned_routes.map((route) => route.id).join(", ") || "none";
  excluded.textContent = `Excluded planned devices: ${plannedIds}. Excluded planned routes: ${routeIds}. Notes excluded: ${plan.notes.length}. Private fields stay on this computer.`;
  document.querySelector("#export-result").textContent = "Validate, then check the review box. Download stays off until both are done.";
  document.querySelector("#confirm-review").checked = false;
  exportReady = false;
  syncDownload();
  document.querySelector("#export-dialog").showModal();
});
function syncDownload() {
  const button = document.querySelector("#download-snapshot");
  const ready = exportReady && document.querySelector("#confirm-review").checked;
  button.disabled = !ready;
  button.setAttribute("aria-disabled", ready ? "false" : "true");
}
function invalidateExport() {
  exportGeneration += 1;
  const hadSnapshot = exportReady || Boolean(document.querySelector("#download-snapshot")?.dataset.snapshot);
  exportReady = false;
  const button = document.querySelector("#download-snapshot");
  if (button) delete button.dataset.snapshot;
  syncDownload();
  if (hadSnapshot) document.querySelector("#export-result").textContent = "Selection changed. Validate again before download.";
}
document.querySelector("#validate-export").addEventListener("click", async () => {
  const generation = exportGeneration;
  const response = await fetch("/api/export", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ plan: present(), selection: selectionFromDialog() }),
  });
  if (generation !== exportGeneration) return;
  const body = await response.json();
  const result = document.querySelector("#export-result");
  if (!response.ok) {
    exportReady = false;
    syncDownload();
    result.textContent = body.error;
    return;
  }
  exportReady = true;
  result.textContent = `Valid public snapshot. Excluded plans: ${(body.excluded.planned_devices || []).join(", ") || "none"}. Download stays off until the review box is checked.`;
  document.querySelector("#download-snapshot").dataset.snapshot = JSON.stringify(body.snapshot);
  syncDownload();
});
document.querySelector("#confirm-review").addEventListener("change", () => {
  if (!document.querySelector("#confirm-review").checked) invalidateExport();
  else syncDownload();
});
document.querySelector("#download-snapshot").addEventListener("click", () => {
  if (!exportReady || !document.querySelector("#confirm-review").checked) return;
  const blob = new Blob([document.querySelector("#download-snapshot").dataset.snapshot], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "mountaindale-public-snapshot.json";
  link.click();
  setStatus("Snapshot downloaded. The public site was not changed.");
});

function refit() {
  const mapBox = document.querySelector("#map").getBoundingClientRect();
  const panels = [...document.querySelectorAll("#topology")].map((panel) => panel.getBoundingClientRect());
  map.fit(insetsAround(mapBox, panels));
}

render();
requestAnimationFrame(refit);
window.addEventListener("resize", refit);
