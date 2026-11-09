import { formatFeet, measureRoute } from "./distance.mjs";
import { lonLatToImage } from "./projection.mjs";
import { pathRows, publicCard, verifiedRoute } from "./plain-path.mjs";
import { fillDistanceList } from "../format-distance.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function addFact(list, item) {
  const dt = document.createElement("dt");
  dt.textContent = item.mark ? `${item.label} · ${item.mark}` : item.label;
  const dd = document.createElement("dd");
  dd.dataset.field = item.label.toLowerCase();
  dd.textContent = item.text;
  list.append(dt, dd);
}

/**
 * The public card and the editor preview both use this tree.
 * Collapsed notes hold source caveats. The visible card states each fact once.
 */
export function renderDeviceStory(container, {
  device,
  detail,
  links,
  groupLabel,
  claim,
  geotransform,
  image,
  nearEdgeIds,
}) {
  container.replaceChildren();
  const story = el("article", "device-story");
  story.append(
    el("h2", null, device.id),
    el("p", null, `${device.model || "Model not recorded"} · ${device.status === "inactive" ? "Inactive" : "In service"}`),
    el("p", null, `Place group ${groupLabel || "not recorded"}. A place group is not a connection.`),
  );
  const card = publicCard(device, detail, device.public_profile);
  const route = verifiedRoute(detail, links);
  const facts = el("dl", "facts");
  for (const item of [card.purpose, card.location, card.mounting, card.height, card.power]) addFact(facts, item);
  story.appendChild(facts);
  if (card.connection) story.appendChild(el("p", null, card.connection));
  if (device.status === "inactive") {
    story.appendChild(el("p", "flag-note", "Inactive, no uplink is recorded, and no path is drawn."));
  }
  story.appendChild(renderRoute(route, links, claim));
  story.appendChild(renderDetails({ device, card, route, claim, links, geotransform, image, nearEdgeIds }));
  container.appendChild(story);
  return story;
}

function renderRoute(route, links, claim) {
  const block = el("section", "route-block");
  block.appendChild(el("h3", null, "Path back to the main router"));
  if (!route.reachesRouter) {
    block.appendChild(el("p", "flag-note", route.text || "No recorded path to the main router."));
    return block;
  }
  if (route.reason === "router") {
    block.appendChild(el("p", null, route.text));
    block.appendChild(el("p", null, "Private family networks connect separately and are not part of the equipment path."));
    return block;
  }
  const lines = routeLines(route, links, claim);
  if (lines.some((line) => line.feet)) {
    block.appendChild(el("p", null, "Each length is one Ethernet cable, from one piece of equipment to the next."));
  }
  const list = el("ol", "route");
  list.id = "device-path";
  for (const line of lines) {
    const item = document.createElement("li");
    item.append(el("span", "via", line.via), document.createTextNode(line.rest));
    list.appendChild(item);
  }
  block.appendChild(list);
  return block;
}

/** One visible path row. Ethernet runs carry that cable's own length. Wireless runs do not. */
export function routeLines(route, links, claim) {
  return pathRows(route).map((row, index) => {
    const hop = index === 0 ? null : route.hops[index - 1];
    const feet = hop && hop.connection !== "wireless" ? ethernetRunFeet(hop, links, claim) : null;
    const name = row.extra ? `${row.id}. ${row.extra}.` : row.id;
    const rest = feet ? `, ${feet}. ${name}` : ` ${name}`;
    return { via: row.via, rest, feet, text: `${row.via}${rest}`, hop };
  });
}

export function ethernetRunFeet(hop, links, claim) {
  if (!hop || hop.connection === "wireless") return null;
  const metrics = measureHop(hop, links, claim);
  if (!metrics) return null;
  return formatFeet(metrics.totals.physical_cable_m);
}

function renderDetails({ device, card, route, claim, links, geotransform, image, nearEdgeIds }) {
  const technical = document.createElement("details");
  technical.className = "about";
  technical.id = "device-details";
  const summary = document.createElement("summary");
  summary.textContent = "Source notes and map position";
  technical.appendChild(summary);
  for (const item of [card.purpose, card.location, card.mounting, card.height, card.power]) {
    if (item.detail) technical.appendChild(el("p", null, `${item.label}: ${item.detail}`));
  }
  const wireless = route.hops.filter((hop) => hop.connection === "wireless");
  if (wireless.length) {
    technical.appendChild(el("p", null, "Wireless hops on this path are airMAX links, point-to-point or point-to-multipoint as recorded. They are not a coverage survey."));
  }
  const point = pixelOf(device.coords, geotransform);
  technical.appendChild(el("p", null, `Longitude ${device.coords.lon}, latitude ${device.coords.lat}.`));
  if (point) technical.appendChild(el("p", null, `On the photo: ${point.u.toFixed(1)}, ${point.v.toFixed(1)}.`));
  technical.appendChild(el("p", null, device.coords.alt_m == null
    ? "No height above sea level is recorded. That height is not how high the equipment is mounted."
    : `The photo lists a height above sea level of ${formatFeet(device.coords.alt_m)}. That figure was not checked, and it is not how high the equipment is mounted.`));
  const place = canvasPlace(device, point, image, nearEdgeIds);
  if (place === "outside") technical.appendChild(el("p", null, "Outside the aerial photo. The recorded position was not moved."));
  else if (place === "near-edge") technical.appendChild(el("p", null, "Near the edge of the aerial photo. Shown where it was recorded."));
  if (device.status !== "inactive" && route.reachesRouter && route.hops.length && claim) {
    const pieces = route.hops.flatMap((hop) => {
      if (hop.connection === "wireless") return [];
      const link = (links || []).find((item) => item.id === hop.linkId);
      if (!link) return [];
      const metrics = measureHop(hop, links, claim);
      return metrics ? [{ hop, metrics }] : [];
    });
    pieces.forEach(({ hop, metrics }) => {
      const list = el("div", null);
      fillDistanceList(list, metrics, `${hop.from} to ${hop.to}`, { plain: true });
      technical.appendChild(list);
    });
  }
  return technical;
}

function measureHop(hop, links, claim) {
  const link = (links || []).find((item) => item.id === hop.linkId);
  if (!link?.fromCoords || !link?.toCoords) return null;
  const bends = link.medium === "wired-ethernet" && Array.isArray(link.vertices) ? link.vertices : [];
  const extras = link.medium === "wired-ethernet" && Array.isArray(link.segments) ? link.segments : [];
  return measureRoute([link.toCoords, ...bends, link.fromCoords], extras, claim);
}

function pixelOf(coords, geotransform) {
  if (!coords || !geotransform || !Number.isFinite(coords.lon) || !Number.isFinite(coords.lat)) return null;
  const [u, v] = lonLatToImage(coords.lon, coords.lat, geotransform);
  return { u, v };
}

function canvasPlace(device, point, image, nearEdgeIds) {
  if (!point || !image) return "unprojected";
  if (point.u < 0 || point.v < 0 || point.u > image.width || point.v > image.height) return "outside";
  if (nearEdgeIds?.has?.(device.id) || (Array.isArray(nearEdgeIds) && nearEdgeIds.includes(device.id))) return "near-edge";
  return "inside";
}

export function linksWithCoords(links, devices, wan = [], cablePaths = null) {
  const coords = new Map();
  for (const device of devices || []) coords.set(device.id, device.coords);
  for (const entry of wan || []) {
    if (entry.map_pin?.coords) coords.set(entry.id, entry.map_pin.coords);
  }
  return (links || []).map((link) => {
    const path = cablePaths?.[link.id];
    const stored = Array.isArray(path?.intermediates) ? path.intermediates : [];
    const published = Array.isArray(link.vertices) ? link.vertices : [];
    return {
      ...link,
      vertices: stored.length ? stored : published,
      segments: Array.isArray(path?.segments) ? path.segments : [],
      fromCoords: coords.get(link.child) || null,
      toCoords: coords.get(link.parent) || null,
    };
  });
}
