import { clusterByScreen, spiderfyOffsets } from "./lib/cluster.mjs";
import { placeIcon } from "./lib/icon-layout.mjs";
import {
  NATIVE_ZOOM,
  imageTileIndex,
  projectToScreen,
  screenToSource,
  tileSpanSourcePixels,
  visibleTileRange,
  zoomForScale,
} from "./lib/tiles.mjs";

const CLUSTER_RADIUS = 18;

/** Keep the aerial inside the part of the map that floating panels do not cover. */
export function insetsAround(mapRect, panels) {
  const inset = { left: 20, right: 20, top: 20, bottom: 20 };
  for (const panel of panels) {
    if (!panel || panel.width < 2 || panel.height < 2) continue;
    const overlapW = Math.min(panel.right, mapRect.right) - Math.max(panel.left, mapRect.left);
    const overlapH = Math.min(panel.bottom, mapRect.bottom) - Math.max(panel.top, mapRect.top);
    if (overlapW <= 0 || overlapH <= 0) continue;
    const onRight = panel.left > mapRect.left + mapRect.width * 0.45;
    const onBottom = panel.top > mapRect.top + mapRect.height * 0.4;
    if (onRight && overlapW < mapRect.width * 0.55) inset.right = Math.max(inset.right, overlapW + 18);
    else if (!onRight && panel.right < mapRect.left + mapRect.width * 0.55) inset.left = Math.max(inset.left, overlapW + 18);
    else if (onBottom) inset.bottom = Math.max(inset.bottom, overlapH + 18);
    else inset.top = Math.max(inset.top, overlapH + 18);
  }
  return inset;
}

function element(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export function createMap(container, options) {
  const imageWidth = options.imageWidth;
  const imageHeight = options.imageHeight;
  const tileUrl = options.tileUrl;
  container.classList.add("map-root");
  const world = element("div", "map-world");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("map-links");
  const overlay = element("div", "map-overlay");
  container.append(world, svg, overlay);

  const view = {
    u: imageWidth / 2,
    v: imageHeight / 2,
    scale: 0.05,
    width: 1,
    height: 1,
    imageWidth,
    imageHeight,
  };
  const listeners = new Map();
  const tileNodes = new Map();
  const overlayButtons = new Map();
  let markers = [];
  let polylines = [];
  let labels = [];
  let spider = new Set();
  let fitted = false;
  let drag = null;
  let insets = { left: 28, right: 28, top: 28, bottom: 28 };

  function placeInClear(u, v, scale) {
    const availW = Math.max(80, view.width - insets.left - insets.right);
    const availH = Math.max(80, view.height - insets.top - insets.bottom);
    const cx = insets.left + availW / 2;
    const cy = insets.top + availH / 2;
    view.scale = scale;
    view.u = u - (cx - view.width / 2) / view.scale;
    view.v = v - (cy - view.height / 2) / view.scale;
  }

  function emit(type, detail) {
    for (const fn of listeners.get(type) || []) fn(detail);
  }

  function on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => listeners.get(type).delete(fn);
  }

  function measure() {
    const rect = container.getBoundingClientRect();
    view.width = Math.max(1, rect.width);
    view.height = Math.max(1, rect.height);
    return rect.width > 40 && rect.height > 40;
  }

  function clampScale(scale) {
    const min = Math.min(view.width / imageWidth, view.height / imageHeight) * 0.35;
    return Math.max(min, Math.min(8, scale));
  }

  function renderTiles() {
    const dpr = window.devicePixelRatio || 1;
    const zoom = zoomForScale(view.scale, dpr);
    container.dataset.tileZoom = String(zoom);
    const wanted = new Map();
    const collect = (level) => {
      const range = visibleTileRange(view, level, view.width, view.height, 1);
      for (let x = range.x0; x <= range.x1; x += 1) {
        for (let y = range.y0; y <= range.y1; y += 1) {
          wanted.set(`${level}/${x}/${y}`, { z: level, x, y });
        }
      }
    };
    collect(0);
    collect(zoom);
    if (zoom > 1) collect(zoom - 1);
    for (const [key, node] of tileNodes) {
      if (!wanted.has(key)) {
        node.remove();
        tileNodes.delete(key);
      }
    }
    for (const [key, tile] of wanted) {
      if (tileNodes.has(key)) continue;
      const img = element("img", "tile");
      img.alt = "";
      img.dataset.z = String(tile.z);
      img.dataset.x = String(tile.x);
      img.dataset.y = String(tile.y);
      img.draggable = false;
      const span = tileSpanSourcePixels(tile.z);
      img.style.left = `${tile.x * span}px`;
      img.style.top = `${tile.y * span}px`;
      img.style.width = `${span}px`;
      img.style.height = `${span}px`;
      img.style.zIndex = String(tile.z);
      img.src = tileUrl(tile.z, tile.x, tile.y);
      img.addEventListener("load", () => img.classList.add("loaded"));
      world.appendChild(img);
      tileNodes.set(key, img);
    }
    const tx = view.width / 2 - view.u * view.scale;
    const ty = view.height / 2 - view.v * view.scale;
    world.style.transform = `translate(${tx}px, ${ty}px) scale(${view.scale})`;
  }

  function screenPoint(u, v) {
    return projectToScreen(u, v, view);
  }

  function renderOverlays() {
    svg.setAttribute("viewBox", `0 0 ${view.width} ${view.height}`);
    svg.replaceChildren();
    const screenMarkers = markers.map((marker) => {
      const point = screenPoint(marker.u, marker.v);
      return { ...marker, x: point.x, y: point.y, trueX: point.x, trueY: point.y };
    });
    const clusters = clusterByScreen(screenMarkers, CLUSTER_RADIUS);
    const visual = [];
    for (const cluster of clusters) {
      if (cluster.clustered && spider.has(cluster.id)) {
        const offsets = spiderfyOffsets(cluster.members.length, 84);
        cluster.members.forEach((member, index) => {
          visual.push({
            ...member,
            x: cluster.x + offsets[index].x,
            y: cluster.y + offsets[index].y,
            spread: true,
            leaderX: member.trueX,
            leaderY: member.trueY,
          });
        });
      } else if (cluster.clustered) {
        visual.push({
          id: cluster.id,
          kind: "cluster",
          x: cluster.x,
          y: cluster.y,
          count: cluster.members.length,
          memberIds: cluster.members.map((member) => member.id),
          members: cluster.members,
        });
      } else {
        visual.push(cluster.members[0]);
      }
    }
    for (const item of visual) {
      if (!item.spread) continue;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", item.leaderX);
      line.setAttribute("y1", item.leaderY);
      line.setAttribute("x2", item.x);
      line.setAttribute("y2", item.y);
      line.setAttribute("class", "leader");
      svg.appendChild(line);
    }
    for (const line of polylines) {
      const points = line.points.map((point) => screenPoint(point.u, point.v));
      if (points.length < 2) continue;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      path.setAttribute("points", points.map((point) => `${point.x},${point.y}`).join(" "));
      path.setAttribute("class", `link medium-${line.medium || "wired"}${line.hop === "secondary" ? " is-relay" : ""}${line.hot ? " is-hot" : ""}${line.planned ? " is-planned" : ""}`);
      path.dataset.linkId = line.id || "";
      if (line.hop) path.dataset.hop = line.hop;
      svg.appendChild(path);
      if (line.editable) {
        for (let index = 0; index < points.length - 1; index += 1) {
          const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          handle.setAttribute("cx", (points[index].x + points[index + 1].x) / 2);
          handle.setAttribute("cy", (points[index].y + points[index + 1].y) / 2);
          handle.setAttribute("r", 16);
          handle.setAttribute("class", "midpoint");
          handle.dataset.linkId = line.id;
          handle.dataset.insertAt = String(index);
          svg.appendChild(handle);
        }
        points.forEach((point, index) => {
          if (index === 0 || index === points.length - 1) return;
          const handle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
          handle.setAttribute("cx", point.x);
          handle.setAttribute("cy", point.y);
          handle.setAttribute("r", 16);
          handle.setAttribute("class", "vertex");
          handle.dataset.linkId = line.id;
          handle.dataset.vertex = String(index - 1);
          svg.appendChild(handle);
        });
      }
    }
    const seen = new Set();
    const detailed = view.scale >= 0.22;
    const named = new Set();
    const placed = new Set();
    const occupied = [];
    const ranked = [...labels].sort((a, b) => Number(Boolean(b.priority)) - Number(Boolean(a.priority)));
    for (const label of ranked) {
      const point = screenPoint(label.u, label.v);
      if (label.kind === "landmark" && !detailed) continue;
      const namedBox = { x: point.x - Math.min(190, 14 + String(label.text).length * 6.4) / 2, y: point.y + 16, w: Math.min(190, 14 + String(label.text).length * 6.4), h: 22 };
      const quietBox = { x: point.x - 8, y: point.y + 18, w: 16, h: 16 };
      const showName = Boolean(label.priority) || detailed;
      const box = showName ? namedBox : quietBox;
      const collides = occupied.some((other) => box.x < other.x + other.w && box.x + box.w > other.x && box.y < other.y + other.h && box.y + box.h > other.y);
      if (!label.priority && collides) continue;
      if (label.kind === "landmark" && !detailed) continue;
      occupied.push(box);
      if (showName && (label.priority || detailed)) named.add(`${label.kind}:${label.id}`);
      placed.add(`${label.kind}:${label.id}`);
    }
    for (const label of labels) {
      if (!placed.has(`${label.kind}:${label.id}`)) continue;
      const point = screenPoint(label.u, label.v);
      const key = `label:${label.kind}:${label.id}`;
      if (point.x < -80 || point.y < -40 || point.x > view.width + 80 || point.y > view.height + 40) continue;
      seen.add(key);
      let button = overlayButtons.get(key);
      if (!button) {
        button = element("button", `map-label kind-${label.kind}`);
        button.type = "button";
        if (label.groupId) button.dataset.groupId = label.groupId;
        button.addEventListener("pointerenter", () => emit("labelenter", label));
        button.addEventListener("pointerleave", () => emit("labelleave", label));
        button.addEventListener("click", (event) => {
          event.stopPropagation();
          emit("labelclick", label);
        });
        button.addEventListener("touchend", (event) => {
          event.preventDefault();
          emit("labeltouch", label);
        });
        overlayButtons.set(key, button);
        overlay.appendChild(button);
      }
      const isNamed = named.has(`${label.kind}:${label.id}`);
      button.textContent = label.text;
      button.setAttribute("aria-label", label.text);
      button.classList.toggle("is-named", isNamed);
      button.style.zIndex = isNamed ? "8" : "3";
      button.style.transform = `translate(${point.x}px, ${point.y}px) translate(-50%, 18px)`;
    }
    for (const item of visual) {
      if (item.x < -80 || item.y < -80 || item.x > view.width + 80 || item.y > view.height + 80) continue;
      const key = item.kind === "cluster" ? `cluster:${item.id}` : `device:${item.id}`;
      seen.add(key);
      let button = overlayButtons.get(key);
      if (!button) {
        button = element("button", item.kind === "cluster" ? "cluster" : `marker role-${item.role || "device"} status-${item.status || "active"}`);
        button.type = "button";
        if (item.kind === "cluster") {
          button.dataset.clusterId = item.id;
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            spider.add(item.id);
            emit("clusterclick", item);
            renderOverlays();
          });
        } else {
          button.dataset.deviceId = item.id;
          button.append(element("span", "glyph"), element("span", "marker-caption"));
          let touchStart = null;
          button.addEventListener("pointerenter", () => emit("markerenter", item));
          button.addEventListener("pointerleave", () => emit("markerleave", item));
          button.addEventListener("pointerdown", (event) => {
            if (event.pointerType === "touch") touchStart = { x: event.clientX, y: event.clientY, moved: false };
            const current = markers.find((marker) => marker.id === item.id);
            if (current?.draggable) startMarkerDrag(event, current);
          });
          button.addEventListener("pointermove", (event) => {
            if (!touchStart || event.pointerType !== "touch") return;
            if (Math.hypot(event.clientX - touchStart.x, event.clientY - touchStart.y) > 10) touchStart.moved = true;
          });
          button.addEventListener("pointerup", (event) => {
            if (event.pointerType !== "touch") {
              emit("markerpointerup", { id: item.id, pointerType: event.pointerType });
              return;
            }
            const start = touchStart;
            touchStart = null;
            if (!start || start.moved || multiTouch) return;
            emit("markerpointerup", { id: item.id, pointerType: "touch" });
          });
          button.addEventListener("touchend", (event) => {
            if (event.cancelable) event.preventDefault();
          });
          button.addEventListener("click", (event) => {
            event.stopPropagation();
            emit("markerclick", { id: item.id, pointerType: event.pointerType });
          });
        }
        overlayButtons.set(key, button);
        overlay.appendChild(button);
      }
      button.style.zIndex = item.kind === "cluster" ? "6" : "4";
      if (item.kind !== "cluster" && item.icon) {
        const placed = placeIcon(item.x, item.y, item.iconScale, view.scale, item.hotspot);
        button.style.width = `${placed.hit}px`;
        button.style.height = `${placed.hit}px`;
        button.style.transform = `translate(${placed.left}px, ${placed.top}px)`;
      } else {
        button.style.width = "32px";
        button.style.height = "32px";
        button.style.transform = `translate(${item.x}px, ${item.y}px) translate(-50%, -50%)`;
      }
      if (item.kind === "cluster") {
        button.textContent = String(item.count);
        button.dataset.members = item.memberIds.join(",");
        button.setAttribute("aria-label", `${item.count} devices at this view`);
      } else {
        button.className = `marker role-${item.role || "device"} status-${item.status || "active"}`;
        button.classList.toggle("is-hot", Boolean(item.hot));
        button.classList.toggle("is-member", Boolean(item.member));
        button.classList.toggle("is-spread", Boolean(item.spread));
        button.classList.toggle("is-planned", Boolean(item.planned));
        button.classList.toggle("has-icon", Boolean(item.icon));
        let icon = button.querySelector(".device-icon");
        let glyph = button.querySelector(".glyph");
        if (item.icon) {
          if (!icon) {
            icon = document.createElement("img");
            icon.className = "device-icon";
            icon.alt = "";
            button.prepend(icon);
          }
          if (icon.getAttribute("src") !== item.icon) icon.src = item.icon;
          const placed = placeIcon(item.x, item.y, item.iconScale, view.scale, item.hotspot);
          icon.style.width = `${placed.size}px`;
          icon.style.height = `${placed.size}px`;
          icon.style.left = `${placed.imageLeft}px`;
          icon.style.top = `${placed.imageTop}px`;
          if (glyph) glyph.remove();
        } else if (icon) {
          icon.remove();
          if (!glyph) button.prepend(element("span", "glyph"));
        }
        button.querySelector(".marker-caption").textContent = item.caption || item.id;
        button.setAttribute("aria-label", item.caption || item.id);
        let flag = button.querySelector(".flag");
        if (item.flag) {
          if (!flag) {
            flag = element("span", "flag");
            flag.textContent = "!";
            button.appendChild(flag);
          }
          flag.className = `flag severity-${item.flag}`;
        } else if (flag) flag.remove();
      }
    }
    for (const [key, button] of overlayButtons) {
      if (!seen.has(key)) {
        button.remove();
        overlayButtons.delete(key);
      }
    }
  }

  function render() {
    measure();
    container.dataset.scale = String(view.scale);
    container.dataset.viewU = String(view.u);
    container.dataset.viewV = String(view.v);
    renderTiles();
    renderOverlays();
    emit("viewchange", { ...view });
  }

  function sourceFromEvent(event) {
    const rect = container.getBoundingClientRect();
    return screenToSource(event.clientX - rect.left, event.clientY - rect.top, view);
  }

  function startMarkerDrag(event, item) {
    event.stopPropagation();
    event.preventDefault();
    drag = { kind: "marker", id: item.id, pointer: event.pointerId };
    emit("markerdragstart", { id: item.id });
  }

  const pointers = new Map();
  let pinch = null;
  let multiTouch = false;
  function touchPoints() {
    return [...pointers.values()].filter((point) => point.type === "touch");
  }
  function syncPinch(reset) {
    const points = touchPoints();
    if (points.length < 2) {
      pinch = null;
      return;
    }
    const distance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) || 1;
    const midX = (points[0].x + points[1].x) / 2;
    const midY = (points[0].y + points[1].y) / 2;
    if (reset || !pinch) {
      pinch = { dist: distance, scale: view.scale };
      return;
    }
    const target = clampScale(pinch.scale * (distance / pinch.dist));
    const factor = target / view.scale;
    if (Math.abs(factor - 1) > 0.001) zoomAt(factor, midX, midY);
  }
  container.addEventListener("pointerdown", (event) => {
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY, type: event.pointerType });
    if (touchPoints().length >= 2) {
      multiTouch = true;
      drag = null;
      syncPinch(true);
      return;
    }
    const vertex = event.target.closest?.(".vertex");
    const midpoint = event.target.closest?.(".midpoint");
    if (vertex || midpoint) {
      event.preventDefault();
      event.stopPropagation();
      drag = vertex
        ? {
          kind: "vertex",
          linkId: vertex.dataset.linkId,
          index: Number(vertex.dataset.vertex),
          pointer: event.pointerId,
          moved: false,
          x: event.clientX,
          y: event.clientY,
        }
        : {
          kind: "midpoint",
          linkId: midpoint.dataset.linkId,
          index: Number(midpoint.dataset.insertAt),
          pointer: event.pointerId,
          moved: false,
          x: event.clientX,
          y: event.clientY,
        };
      if (vertex) emit("vertexdragstart", { linkId: drag.linkId, index: drag.index });
      return;
    }
    if (event.target.closest?.(".marker, .cluster, .map-label")) return;
    drag = { kind: "pan", x: event.clientX, y: event.clientY, u: view.u, v: view.v, moved: false, pointer: event.pointerId };
  });
  container.addEventListener("touchmove", (event) => {
    if (event.touches.length >= 2) event.preventDefault();
  }, { passive: false });
  container.addEventListener("gesturestart", (event) => event.preventDefault());
  container.addEventListener("gesturechange", (event) => event.preventDefault());
  window.addEventListener("pointermove", (event) => {
    if (pointers.has(event.pointerId)) {
      const current = pointers.get(event.pointerId);
      pointers.set(event.pointerId, { ...current, x: event.clientX, y: event.clientY });
    }
    if (touchPoints().length >= 2) {
      multiTouch = true;
      drag = null;
      syncPinch(false);
      return;
    }
    if (!drag || event.pointerId !== drag.pointer) return;
    if (drag.kind === "marker") {
      emit("markerdrag", { id: drag.id, ...sourceFromEvent(event) });
      return;
    }
    if (drag.kind === "vertex" || drag.kind === "midpoint") {
      if (Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 4) drag.moved = true;
      if (!drag.moved) return;
      const source = sourceFromEvent(event);
      if (drag.kind === "midpoint") emit("benddrag", { linkId: drag.linkId, index: drag.index, ...source });
      else emit("vertexdrag", { linkId: drag.linkId, index: drag.index, ...source });
      return;
    }
    if (drag.kind === "pan") {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) > 4) drag.moved = true;
      view.u = drag.u - dx / view.scale;
      view.v = drag.v - dy / view.scale;
      render();
    }
  });
  function endPointer(event) {
    pointers.delete(event.pointerId);
    if (touchPoints().length < 2) pinch = null;
    if (touchPoints().length === 0) multiTouch = false;
    if (!drag || event.pointerId !== drag.pointer) return false;
    const finished = drag;
    drag = null;
    if (finished.kind === "marker") emit("markerdragend", { id: finished.id });
    if (finished.kind === "vertex" || finished.kind === "midpoint") {
      emit("vertexdragend", { linkId: finished.linkId, index: finished.index, moved: finished.moved, inserted: finished.kind === "midpoint" && finished.moved });
    }
    return finished;
  }
  let lastVertexTap = null;
  container.addEventListener("contextmenu", (event) => {
    const vertex = event.target.closest?.(".vertex");
    if (!vertex) return;
    event.preventDefault();
    emit("vertexremove", { linkId: vertex.dataset.linkId, index: Number(vertex.dataset.vertex) });
  });
  window.addEventListener("pointerup", (event) => {
    const finished = endPointer(event);
    if (finished?.kind === "vertex" && !finished.moved) {
      const now = performance.now();
      if (lastVertexTap && lastVertexTap.linkId === finished.linkId && lastVertexTap.index === finished.index && now - lastVertexTap.time < 450) {
        emit("vertexremove", { linkId: finished.linkId, index: finished.index });
        lastVertexTap = null;
      } else {
        lastVertexTap = { linkId: finished.linkId, index: finished.index, time: now };
      }
    }
    if (!finished || finished.kind !== "pan" || finished.moved) return;
    if (event.target.closest?.(".marker, .cluster, .map-label, .vertex, .midpoint")) return;
    const source = sourceFromEvent(event);
    if (source.u >= 0 && source.v >= 0 && source.u <= imageWidth && source.v <= imageHeight) emit("mapclick", source);
  });
  window.addEventListener("pointercancel", endPointer);
  container.addEventListener("wheel", (event) => {
    event.preventDefault();
    const factor = event.deltaY > 0 ? 0.85 : 1.18;
    zoomAt(factor, event.clientX, event.clientY);
  }, { passive: false });

  function zoomAt(factor, clientX, clientY) {
    const rect = container.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const source = screenToSource(sx, sy, view);
    view.scale = clampScale(view.scale * factor);
    view.u = source.u - (sx - view.width / 2) / view.scale;
    view.v = source.v - (sy - view.height / 2) / view.scale;
    render();
  }

  function fit(nextInsets) {
    if (nextInsets && typeof nextInsets === "object") insets = nextInsets;
    measure();
    const availW = Math.max(80, view.width - insets.left - insets.right);
    const availH = Math.max(80, view.height - insets.top - insets.bottom);
    placeInClear(imageWidth / 2, imageHeight / 2, clampScale(Math.min(availW / imageWidth, availH / imageHeight)));
    fitted = true;
    render();
  }

  function zoomToNative(u, v) {
    measure();
    placeInClear(u, v, clampScale(1));
    render();
  }

  function fitToPoints(points, padding = 72) {
    if (!points.length) return;
    measure();
    let u0 = Infinity;
    let v0 = Infinity;
    let u1 = -Infinity;
    let v1 = -Infinity;
    for (const point of points) {
      u0 = Math.min(u0, point.u);
      v0 = Math.min(v0, point.v);
      u1 = Math.max(u1, point.u);
      v1 = Math.max(v1, point.v);
    }
    const du = Math.max(u1 - u0, 40);
    const dv = Math.max(v1 - v0, 40);
    const availW = Math.max(80, view.width - insets.left - insets.right - padding);
    const availH = Math.max(80, view.height - insets.top - insets.bottom - padding);
    placeInClear((u0 + u1) / 2, (v0 + v1) / 2, clampScale(Math.min(availW / du, availH / dv)));
    render();
  }

  new ResizeObserver(() => {
    const ready = measure();
    if (!ready) return;
    if (!fitted) fit();
    else render();
  }).observe(container);

  return {
    on,
    fit,
    fitToPoints,
    zoomToNative,
    zoomBy(factor) { zoomAt(factor, container.getBoundingClientRect().left + view.width / 2, container.getBoundingClientRect().top + view.height / 2); },
    getView: () => ({ ...view }),
    getScale: () => view.scale,
    imageTileFor(u, v) { return imageTileIndex(u, v, NATIVE_ZOOM); },
    setMarkers(next) { markers = next; renderOverlays(); },
    setPolylines(next) { polylines = next; renderOverlays(); },
    setLabels(next) { labels = next; renderOverlays(); },
    clearSpider() { spider = new Set(); renderOverlays(); },
    sourceFromClient(clientX, clientY) {
      const rect = container.getBoundingClientRect();
      return screenToSource(clientX - rect.left, clientY - rect.top, view);
    },
  };
}
