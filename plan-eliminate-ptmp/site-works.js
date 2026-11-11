import * as THREE from './libs/three/three.module.js';

const IN = 0.0254;
const FT = 3.280839895;
const DEPTH_M = 18 * IN;          // 0.4572 m
const MAIN_RADIUS = 0.75 * IN;    // 1.5 in conduit, true scale
const LT_RADIUS = 0.675 * IN;     // ~1 in LT PVC outside diameter / 2
const SIZE_MULT = { true: 1, enlarged: 4 };
const DENSIFY_M = 0.2;
const BEND_R = 6 * IN;            // still used for the 1 in LT rise at a post
const ENTRY_DEPTH_M = 7 * IN;     // side knockout, mid of the 6–8 in range (0.1778 m)
const RAMP_LEN = 3.5 * 12 * IN;   // last 3.5 ft: gentle rise from 18 in to the side entry
const ABS_L = 11 * IN;            // TICONN IP67 11 x 7.5 x 5.5 in
const ABS_W_BOX = 7.5 * IN;
const ABS_H_BOX = 5.5 * IN;
const SNAP_M = 1.0;
const BOX_LONG = 19 * IN;
const BOX_SHORT = 14 * IN;
const BOX_H = 12 * IN;
const LID_T = 0.5 * IN;
const WALL_T = 0.35 * IN;
const POST_W = 5.5 * IN;
const POST_BELOW = 32 * IN;
const POST_ABOVE = 64 * IN;
const FLEX_H = 0.249;             // official USW-Flex-Utility 249 x 218 x 60 mm
const FLEX_W = 0.218;
const FLEX_D = 0.060;
const FLEX_BOTTOM = 48 * IN;      // ~4 ft above grade, bottom of either enclosure
const OUTLET_W = 4.5 * IN;
const OUTLET_H = 6.5 * IN;
const OUTLET_D = 3.2 * IN;

// Official sizes from Ubiquiti tech specs. Cable entries on the bottom.
// USW-Flex-Utility: 249 × 218 × 60 mm, portrait (218 mm wide, 249 mm tall).
// UACC-Flex-Utility-Pro: 350 × 220 × 89 mm, mounted landscape (350 mm wide, 220 mm tall, 89 mm out); overhangs the 5.5 in post on both sides, centered.
const ENCLOSURES = {
  'flex-utility': {
    id: 'flex-utility',
    name: 'Flex Utility',
    sku: 'USW-Flex-Utility',
    w: 0.218, h: 0.249, d: 0.060, // H×W×D 249×218×60 mm, entry at bottom
    color: 0xc0c4c8,
    switchModel: 'USW-Flex',
    panelLabel: 'Flex Utility with USW-Flex 5-port switch',
    listLabel: 'Flex Utility · USW-Flex 5-port',
  },
  'flex-utility-pro': {
    id: 'flex-utility-pro',
    name: 'Flex Utility Pro',
    sku: 'UACC-Flex-Utility-Pro',
    w: 0.350, h: 0.220, d: 0.089, // landscape on the post: 350 mm horizontal, 220 mm vertical, 89 mm out from the face
    color: 0xf7f8fa,
    switchModel: 'USW-Flex-2.5G-8-PoE',
    panelLabel: 'Flex Utility Pro with Flex 2.5G PoE switch',
    listLabel: 'Flex Utility Pro · Flex 2.5G PoE',
  },
};

function normalizeEnclosure(v) {
  const s = String(v || '').toLowerCase().replace(/_/g, '-');
  if (s === 'flex-utility-pro' || s === 'uacc-flex-utility-pro' || s === 'pro') return 'flex-utility-pro';
  return 'flex-utility';
}
function enclosureInfo(enc) {
  return ENCLOSURES[normalizeEnclosure(enc)] || ENCLOSURES['flex-utility'];
}
function switchModelFor(enc) {
  return enclosureInfo(enc).switchModel;
}
function applyEnclosure(post, enc) {
  post.enclosure = normalizeEnclosure(enc);
  post.switchModel = switchModelFor(post.enclosure);
  return enclosureInfo(post.enclosure);
}
function legacyHasSwitch(p) {
  if (!p) return true;
  if (p.hasSwitch != null) return !!p.hasSwitch;
  if (p.has_switch != null) return !!p.has_switch;
  return true;
}
function readEnclosure(p) {
  if (!p) return 'flex-utility';
  if (p.enclosure) return normalizeEnclosure(p.enclosure);
  if (p.switchModel && /2\.5|pro/i.test(String(p.switchModel))) return 'flex-utility-pro';
  return 'flex-utility';
}
const MAST_SECTION_H = 10 * 12 * IN; // 10 ft threaded section, all above grade
const MAST_OD = 1.900 * IN;        // 1.5 in IPS steel pipe OD
const MAST_R = MAST_OD / 2;
const MAST_COUPLE_H = 2.5 * IN;    // approximate threaded coupling
const MAST_COUPLE_R = 1.25 * IN;
const MAST_BURY = 12 * IN;         // visual stub only; not counted in AGL
const ABS_W = 6 * IN;
const ABS_H = 4 * IN;
const LT_EXIT_DEPTH = 8 * IN;     // exit through VB side wall
const TAP_PX = 10;
const POST_HIT_PX = 36;
const DEFAULT_POLAR = Math.PI * 0.98;
// 3D conduit / VB-to-post link tubes are not drawn (straight air lines were confusing).
// Data is still built for the valve-box schematic and for save/export.
const SHOW_CONDUIT_MESH = false;
const PREFS_KEY = 'md_flight20261110_site_prefs';

function $(id) { return document.getElementById(id); }
function uuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 's-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}
function fmtFt(m) { return (m * FT).toFixed(1); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

function makeLidTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 378;
  const g = c.getContext('2d');
  g.fillStyle = '#1f5a26';
  g.fillRect(0, 0, 512, 378);
  g.fillStyle = '#2f7a38';
  g.fillRect(14, 14, 484, 350);
  g.fillStyle = '#3a8c43';
  g.fillRect(28, 28, 456, 322);
  g.fillStyle = '#163d1b';
  g.font = 'bold 36px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('IRRIGATION', 256, 155);
  g.fillText('CONTROL VALVE', 256, 210);
  g.font = '20px sans-serif';
  g.fillStyle = '#1a4a20';
  g.fillText('NDS 14 × 19', 256, 270);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function makeWoodTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#c4a574';
  g.fillRect(0, 0, 128, 512);
  for (let i = 0; i < 28; i++) {
    g.strokeStyle = `rgba(90,50,20,${0.08 + Math.random() * 0.12})`;
    g.lineWidth = 1 + Math.random() * 2;
    const x = Math.random() * 128;
    g.beginPath();
    g.moveTo(x, 0);
    g.bezierCurveTo(x + 4, 160, x - 5, 320, x + 2, 512);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeFlexTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#9aa1a8';
  g.fillRect(0, 0, 512, 512);
  g.fillStyle = '#b4bac0';
  g.fillRect(24, 24, 464, 464);
  g.fillStyle = '#4a5056';
  g.font = 'bold 36px sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('UniFi', 256, 220);
  g.font = '28px sans-serif';
  g.fillText('Flex Utility', 256, 270);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const lidTexture = makeLidTexture();
const woodTexture = makeWoodTexture();
const flexTexture = makeFlexTexture();

  function makeFlexProTexture() {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#f7f8fa';
    g.fillRect(0, 0, 512, 512);
    g.fillStyle = '#eceff3';
    g.fillRect(16, 16, 480, 480);
    g.fillStyle = '#4a90d9';
    g.beginPath(); g.arc(256, 140, 28, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#222';
    g.font = 'bold 42px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('UniFi', 256, 230);
    g.font = 'bold 32px sans-serif';
    g.fillText('Flex Utility Pro', 256, 290);
    g.font = '24px sans-serif';
    g.fillStyle = '#444';
    g.fillText('USW-Flex-2.5G-8-PoE', 256, 340);
    g.fillText('IPX6', 256, 380);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const flexProTexture = makeFlexProTexture();

function makeGalvTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 64, 0);
  grd.addColorStop(0, '#8e959b');
  grd.addColorStop(0.25, '#c5cdd3');
  grd.addColorStop(0.5, '#a8b0b6');
  grd.addColorStop(0.78, '#d4dbe0');
  grd.addColorStop(1, '#8a9096');
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 36; i++) {
    const x = Math.random() * 64;
    g.strokeStyle = `rgba(255,255,255,${0.05 + Math.random() * 0.12})`;
    g.lineWidth = 0.6 + Math.random();
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + (Math.random() - 0.5) * 3, 256);
    g.stroke();
  }
  for (let i = 0; i < 18; i++) {
    const y = Math.random() * 256;
    g.fillStyle = `rgba(70,78,84,${0.04 + Math.random() * 0.08})`;
    g.fillRect(0, y, 64, 1 + Math.random() * 5);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}
const galvTexture = makeGalvTexture();

function tubeFromPoints(points, radius, color, { xray = false, renderOrder = 20 } = {}) {
  if (!points || points.length < 2) return null;
  const pts = points.map((p) => p.clone());
  if (pts.length === 2 || pts[0].distanceTo(pts[1]) < 1e-5) {
    pts.splice(1, 0, pts[0].clone().lerp(pts[pts.length - 1], 0.5));
  }
  const curve = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.02);
  const segs = Math.max(24, (pts.length - 1) * 4);
  const geo = new THREE.TubeGeometry(curve, segs, Math.max(radius, 0.004), 8, false);
  const mat = new THREE.MeshBasicMaterial({
    color,
    depthTest: !xray,
    depthWrite: false,
    transparent: true,
    opacity: xray ? 0.42 : 0.98,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = xray ? renderOrder + 1 : renderOrder;
  mesh.frustumCulled = false;
  mesh.userData.ignorePick = true;
  return mesh;
}

function addTubePair(group, points, radius, color) {
  const solid = tubeFromPoints(points, radius, color, { xray: false, renderOrder: 18 });
  const ghost = tubeFromPoints(points, radius, color, { xray: true, renderOrder: 22 });
  if (solid) group.add(solid);
  if (ghost) group.add(ghost);
}

function lengthOf(points) {
  let n = 0;
  for (let i = 1; i < points.length; i++) n += points[i].distanceTo(points[i - 1]);
  return n;
}

function densifyUtm(points, sampleDTM) {
  if (!points.length) return [];
  const out = [{ ...points[0] }];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    const dx = b.x - a.x, dy = b.y - a.y;
    const horiz = Math.hypot(dx, dy);
    const n = Math.max(1, Math.ceil(horiz / DENSIFY_M));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const x = a.x + dx * t;
      const y = a.y + dy * t;
      const z = sampleDTM(x, y);
      out.push({ x, y, z: z == null ? a.z * (1 - t) + b.z * t : z });
    }
  }
  return out;
}

function horizDist(a, b) {
  return Math.hypot((b.x - a.x), (b.y - a.y));
}

function unitHoriz(from, to) {
  const dx = to.x - from.x, dy = to.y - from.y;
  const L = Math.hypot(dx, dy) || 1;
  return { x: dx / L, y: dy / L };
}

export function initSiteWorks(ctx) {
  const {
    scene, camera, renderer, controls, modelRoot,
    utmToWorld, worldToUtm, sampleDTM, toast, getPaths, requestSave,
    getMode, leavePathModes, isPathBusy,
  } = ctx;

  const root = new THREE.Group();
  root.name = 'site-works';
  scene.add(root);
  const conduitGroup = new THREE.Group();
  conduitGroup.name = 'main-conduit';
  const boxGroup = new THREE.Group();
  boxGroup.name = 'valve-boxes';
  const postGroup = new THREE.Group();
  postGroup.name = 'posts';
  const apGroup = new THREE.Group();
  apGroup.name = 'aps';
  const mastGroup = new THREE.Group();
  mastGroup.name = 'masts';
  const ltAgGroup = new THREE.Group();
  ltAgGroup.name = 'lt-ag';
  root.add(conduitGroup, boxGroup, postGroup, apGroup, mastGroup, ltAgGroup);

  let posts = [];
  let nodes = [];
  let showConduit = true;
  let conduitSize = 'enlarged';
  let lookBelow = false;
  let postMode = 'idle'; // idle | place | edit
  let switchMode = 'idle'; // idle | place
  let pendingEnclosure = 'flex-utility';
  let selectedPost = null;
  let openVbId = null;
  let zoomAnim = null;
  let zoomTimer = null;
  let aps = [];
  let apMode = 'idle'; // idle | place | edit
  let selectedAp = null;
  let masts = [];
  let mastMode = 'idle'; // idle | place | edit
  let selectedMast = null;
  let ltRuns = [];
  let ltMode = 'idle';
  let ltDraft = null;
  let selectedLt = null;
  let pendingLtSize = '1';
  let pendingRouteDepthIn = 18;
  let selectedLtVert = -1;
  const pointer = { id: null, x: 0, y: 0, moved: false, count: 0 };
  const drag = { active: false, kind: null, pointerId: null, lastX: 0, lastY: 0 };
  const savedSides = [];
  let labelsNeedSync = false;

  const labelsRoot = $('siteLabels');
  const handlesRoot = $('handles');

  function loadPrefs() {}
  function savePrefs() {}
  loadPrefs();

  function radiusMain() { return MAIN_RADIUS * (SIZE_MULT[conduitSize] || 1); }
  function radiusLt() { return LT_RADIUS * (SIZE_MULT[conduitSize] || 1); }

  function worldAt(x, y, z) { return utmToWorld(x, y, z); }

  function clusterEndpoints(paths) {
    const pts = [];
    paths.forEach((p, pi) => {
      if (!p.points || p.points.length < 2) return;
      const a = p.points[0], b = p.points[p.points.length - 1];
      const dirStart = unitHoriz(a, p.points[Math.min(1, p.points.length - 1)]);
      const dirEnd = unitHoriz(p.points[Math.max(0, p.points.length - 2)], b);
      pts.push({ pi, end: 'start', x: a.x, y: a.y, z: a.z, dir: dirStart, path: p });
      pts.push({ pi, end: 'end', x: b.x, y: b.y, z: b.z, dir: dirEnd, path: p });
    });
    const used = new Array(pts.length).fill(false);
    const clusters = [];
    for (let i = 0; i < pts.length; i++) {
      if (used[i]) continue;
      const members = [pts[i]];
      used[i] = true;
      for (let j = i + 1; j < pts.length; j++) {
        if (used[j]) continue;
        if (horizDist(pts[i], pts[j]) <= SNAP_M) {
          members.push(pts[j]);
          used[j] = true;
        }
      }
      const x = members.reduce((s, m) => s + m.x, 0) / members.length;
      const y = members.reduce((s, m) => s + m.y, 0) / members.length;
      const z = sampleDTM(x, y);
      // Average direction: flip later dirs so they agree with the first
      let dx = 0, dy = 0;
      const first = members[0].dir;
      members.forEach((m) => {
        let d = m.dir;
        if (first.x * d.x + first.y * d.y < 0) d = { x: -d.x, y: -d.y };
        dx += d.x; dy += d.y;
      });
      const L = Math.hypot(dx, dy) || 1;
      clusters.push({
        x, y, z: z == null ? members[0].z : z,
        dir: { x: dx / L, y: dy / L },
        members,
        paths: [...new Set(members.map((m) => m.path))],
      });
    }
    return clusters;
  }

  function labelNodes(clusters, paths) {
    const named = [...paths].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), undefined, { numeric: true })
    );
    const remaining = new Set(clusters);
    const ordered = [];
    function clusterOf(path, end) {
      for (const c of remaining) {
        if (c.members.some((m) => m.path === path && m.end === end)) return c;
      }
      return null;
    }
    if (named.length) {
      let path = named[0];
      let comingFrom = 'start';
      const startC = clusterOf(path, 'start');
      if (startC) {
        ordered.push(startC);
        remaining.delete(startC);
      }
      let guard = 0;
      while (path && guard++ < 50) {
        const far = clusterOf(path, comingFrom === 'start' ? 'end' : 'start');
        if (!far || !remaining.has(far)) break;
        ordered.push(far);
        remaining.delete(far);
        const other = far.members.find((m) => m.path !== path);
        if (!other) break;
        path = other.path;
        comingFrom = other.end;
      }
    }
    for (const c of remaining) ordered.push(c);
    ordered.forEach((c, i) => {
      c.id = 'VB-' + (i + 1);
      c.label = c.id;
    });
    return ordered;
  }

  function pathsMeetLabel(node) {
    const names = node.paths.map((p) => p.name || 'Path').filter((v, i, a) => a.indexOf(v) === i);
    if (names.length === 0) return '';
    if (names.length === 1) {
      const m = node.members[0];
      return names[0] + (m && m.end === 'start' ? ' start' : ' end');
    }
    return names.join(' / ') + ' junction';
  }

  function snapPathPoints(path) {
    const pts = path.points.map((p) => ({ x: p.x, y: p.y, z: p.z }));
    if (!pts.length) return pts;
    for (const end of [0, pts.length - 1]) {
      let best = null, bestD = SNAP_M;
      for (const n of nodes) {
        const d = Math.hypot(pts[end].x - n.x, pts[end].y - n.y);
        if (d <= bestD) { best = n; bestD = d; }
      }
      if (best) {
        const z = sampleDTM(best.x, best.y);
        pts[end] = { x: best.x, y: best.y, z: z == null ? best.z : z };
      }
    }
    return pts;
  }

  function sideEntry(profile, node, atStart, path, record) {
    // Last few feet: gentle ramp from 18 in up to the side knockout (7 in),
    // then a short horizontal entry through the wall facing this run.
    const pts = atStart ? profile.slice().reverse() : profile.slice();
    if (pts.length < 2) return [];
    const zGrade = (sampleDTM(node.x, node.y) != null) ? sampleDTM(node.x, node.y) : node.z;
    let back = pts[0];
    let acc = 0;
    for (let i = pts.length - 1; i > 0; i--) {
      acc += horizDist(pts[i], pts[i - 1]);
      if (acc >= RAMP_LEN + 0.5) { back = pts[i - 1]; break; }
    }
    const hit = vbExitUtm(node, back);
    let rampLen = RAMP_LEN;
    const reach = horizDist(back, hit);
    if (reach < rampLen + 0.3) rampLen = Math.max(1.5 * 12 * IN, reach - 0.2);

    const kept = [];
    for (const p of pts) {
      const along = (p.x - hit.x) * hit.ux + (p.y - hit.y) * hit.uy;
      if (along > rampLen + 0.02) kept.push(p);
    }
    const world = kept.map((p) => {
      const zg = p.z != null ? p.z : (sampleDTM(p.x, p.y) ?? zGrade);
      return worldAt(p.x, p.y, zg - DEPTH_M);
    });

    const steps = Math.max(10, Math.ceil(rampLen / 0.12));
    for (let i = 0; i <= steps; i++) {
      const s = i / steps;
      const x = hit.x + hit.ux * (1 - s) * rampLen;
      const y = hit.y + hit.uy * (1 - s) * rampLen;
      const zg = sampleDTM(x, y) ?? zGrade;
      const ease = s * s * (3 - 2 * s);
      const depth = DEPTH_M + (ENTRY_DEPTH_M - DEPTH_M) * ease;
      world.push(worldAt(x, y, zg - depth));
    }
    const zgWall = sampleDTM(hit.x, hit.y) ?? zGrade;
    const zEntry = zgWall - ENTRY_DEPTH_M;
    const inward = 3 * IN;
    world.push(worldAt(hit.x - hit.ux * inward, hit.y - hit.uy * inward, zEntry));

    if (record) {
      node.entries = node.entries || [];
      node.entries.push({
        path: path ? (path.name || path.id) : null,
        x: hit.x, y: hit.y,
        z: zEntry,
        depth_m: ENTRY_DEPTH_M,
        depth_in: 7,
        ux: hit.ux, uy: hit.uy,
      });
    }
    return atStart ? world.reverse() : world;
  }

  function buildMainRun(path, record) {
    const snapped = snapPathPoints(path);
    const profile = densifyUtm(snapped, sampleDTM);
    if (profile.length < 2) return [];
    const startNode = nodes.find((n) => n.members.some((m) => m.path === path && m.end === 'start'));
    const endNode = nodes.find((n) => n.members.some((m) => m.path === path && m.end === 'end'));
    // Build from start bend through mid (depth 18") to end bend, without duplicating mid.
    // Strategy: cut mid section to points farther than BEND_R from both ends, then prepend/append bends.
    const startPts = startNode ? sideEntry(profile, startNode, true, path, record) : [];
    const endPts = endNode ? sideEntry(profile, endNode, false, path, record) : [];
    const midCut = RAMP_LEN + 0.35;
    const mid = [];
    for (const p of profile) {
      const d0 = startNode ? horizDist(p, startNode) : Infinity;
      const d1 = endNode ? horizDist(p, endNode) : Infinity;
      if (d0 > midCut && d1 > midCut) {
        const zg = p.z != null ? p.z : (sampleDTM(p.x, p.y) ?? p.z);
        mid.push(worldAt(p.x, p.y, zg - DEPTH_M));
      }
    }
    const pts = [];
    if (startPts.length) pts.push(...startPts);
    pts.push(...mid);
    if (endPts.length) pts.push(...endPts);
    return pts;
  }

  function makeValveBox(node) {
    const g = new THREE.Group();
    g.name = node.id;
    g.userData.node = node;
    const zGrade = node.z;
    const yaw = Math.atan2(node.dir.x, -node.dir.y); // world yaw: x east, z = -north
    const bodyMat = new THREE.MeshBasicMaterial({ color: 0x161616, side: THREE.DoubleSide });
    const bodyXray = new THREE.MeshBasicMaterial({
      color: 0x222222, transparent: true, opacity: 0.35,
      depthTest: false, depthWrite: false, side: THREE.DoubleSide,
    });
    const innerL = BOX_LONG - 2 * WALL_T;
    const innerS = BOX_SHORT - 2 * WALL_T;
    const wallH = BOX_H - LID_T;
    const wallY = zGrade - LID_T - wallH / 2;

    function tag(obj) {
      obj.userData.vbId = node.id;
      obj.userData.ignorePick = false;
    }
    function wall(w, d, x, z) {
      const geo = new THREE.BoxGeometry(w, wallH, d);
      const m = new THREE.Mesh(geo, bodyMat);
      m.position.set(x, wallY - zGrade, z);
      tag(m);
      const gx = new THREE.Mesh(geo, bodyXray);
      gx.position.copy(m.position);
      gx.renderOrder = 19;
      gx.userData.ignorePick = true;
      g.add(m, gx);
    }
    wall(BOX_LONG, WALL_T, 0, (BOX_SHORT - WALL_T) / 2);
    wall(BOX_LONG, WALL_T, 0, -(BOX_SHORT - WALL_T) / 2);
    wall(WALL_T, innerS, (BOX_LONG - WALL_T) / 2, 0);
    wall(WALL_T, innerS, -(BOX_LONG - WALL_T) / 2, 0);

    const lidGeo = new THREE.BoxGeometry(BOX_LONG + 0.3 * IN, LID_T, BOX_SHORT + 0.3 * IN);
    const lidMat = new THREE.MeshBasicMaterial({ map: lidTexture });
    const lid = new THREE.Mesh(lidGeo, lidMat);
    lid.position.set(0, -LID_T / 2 + 0.012, 0);
    lid.renderOrder = 16;
    tag(lid);
    g.add(lid);
    const lidGhost = new THREE.Mesh(
      lidGeo,
      new THREE.MeshBasicMaterial({
        color: 0x3a8c43, transparent: true, opacity: 0.3,
        depthTest: false, depthWrite: false,
      })
    );
    lidGhost.position.copy(lid.position);
    lidGhost.renderOrder = 21;
    lidGhost.userData.ignorePick = true;
    g.add(lidGhost);
    // Larger invisible lid hit target for iPad taps
    const hit = new THREE.Mesh(
      new THREE.BoxGeometry(BOX_LONG * 1.6, 0.08, BOX_SHORT * 1.6),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hit.position.set(0, 0.02, 0);
    tag(hit);
    g.add(hit);

    // TICONN IP67 ABS box, mounted high under the lid
    const absGeo = new THREE.BoxGeometry(ABS_L, ABS_H_BOX, ABS_W_BOX);
    const absMat = new THREE.MeshBasicMaterial({ color: 0x2a2c2e });
    const abs = new THREE.Mesh(absGeo, absMat);
    const absTop = -LID_T - 0.6 * IN;
    abs.position.set(0, absTop - ABS_H_BOX / 2, 0);
    abs.userData.ignorePick = true;
    abs.userData.role = 'abs';
    g.add(abs);

    // Side knockouts at each 1.5 in entry
    const knockR = Math.max(MAIN_RADIUS * (SIZE_MULT[conduitSize] || 1) * 1.15, 0.8 * IN);
    const knockMat = new THREE.MeshBasicMaterial({ color: 0x050505, side: THREE.DoubleSide });
    for (const ent of (node.entries || [])) {
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(knockR, knockR, WALL_T * 1.6, 16), knockMat);
      ring.rotation.x = Math.PI / 2;
      // World-to-local of the valve box: yaw around Y, origin at grade.
      // Local x is long axis (node.dir), local z is short (perp).
      const de = ent.x - node.x, dn = ent.y - node.y;
      const locX = de * node.dir.x + dn * node.dir.y;
      const locZ = de * (-node.dir.y) + dn * node.dir.x;
      ring.position.set(locX, -ENTRY_DEPTH_M, locZ);
      // Aim the cylinder axis through the wall (along the entry inward)
      const inwardX = -ent.ux * node.dir.x - ent.uy * node.dir.y;
      const inwardZ = -ent.ux * (-node.dir.y) - ent.uy * node.dir.x;
      ring.rotation.set(0, 0, 0);
      ring.rotation.z = Math.PI / 2;
      ring.rotation.y = Math.atan2(inwardX, inwardZ);
      ring.userData.ignorePick = true;
      g.add(ring);
    }

    g.position.copy(worldAt(node.x, node.y, zGrade));
    g.rotation.y = yaw;
    node.yaw = yaw;
    node.world = g.position.clone();
    return g;
  }

  function vbExitUtm(node, toward) {
    // Intersection of the ray from node to target with the oriented rectangle.
    const dx = toward.x - node.x;
    const dy = toward.y - node.y;
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    // Local axes: long along node.dir, short perpendicular
    const lx = node.dir.x, ly = node.dir.y;
    const sx = -ly, sy = lx;
    const halfL = BOX_LONG / 2, halfS = BOX_SHORT / 2;
    // Find t such that local coords hit the wall
    const locU = ux * lx + uy * ly;
    const locV = ux * sx + uy * sy;
    const tx = Math.abs(locU) < 1e-9 ? Infinity : halfL / Math.abs(locU);
    const tz = Math.abs(locV) < 1e-9 ? Infinity : halfS / Math.abs(locV);
    const t = Math.min(tx, tz);
    return {
      x: node.x + ux * t,
      y: node.y + uy * t,
      ux, uy,
      inside: { x: node.x + ux * Math.max(0, t - 2 * IN), y: node.y + uy * Math.max(0, t - 2 * IN) },
    };
  }

  function buildLtRun(post, node) {
    const zN = (sampleDTM(node.x, node.y) != null) ? sampleDTM(node.x, node.y) : node.z;
    const zP = (sampleDTM(post.x, post.y) != null) ? sampleDTM(post.x, post.y) : post.z;
    const exit = vbExitUtm(node, post);
    const rDown = Math.min(BEND_R, Math.max(3 * IN, horizDist(node, post) / 3));
    const ptsUnder = []; // world points of buried portion (start inside box to grade at post)
    const ptsUp = [];    // grade at post up to flex

    // Inside ABS to wall exit at LT_EXIT_DEPTH
    const zExit = zN - LT_EXIT_DEPTH;
    const zDeepN = zN - DEPTH_M;
    const zDeepP = zP - DEPTH_M;
    ptsUnder.push(worldAt(exit.inside.x, exit.inside.y, zExit));
    ptsUnder.push(worldAt(exit.x, exit.y, zExit));

    // Sweep down from exit depth to 18" along the direction toward the post
    const downSteps = 8;
    for (let i = 1; i <= downSteps; i++) {
      const t = (i / downSteps) * (Math.PI / 2);
      const horiz = rDown * Math.sin(t);
      const drop = (DEPTH_M - LT_EXIT_DEPTH) * (1 - Math.cos(t) < 0 ? 0 : (1 - Math.cos(t)));
      // Use a simple smoothstep drop over rDown
      const s = i / downSteps;
      const h = rDown * s;
      const z = zExit + (zDeepN - zExit) * (s * s * (3 - 2 * s));
      ptsUnder.push(worldAt(exit.x + exit.ux * h, exit.y + exit.uy * h, z));
    }
    const afterDown = {
      x: exit.x + exit.ux * rDown,
      y: exit.y + exit.uy * rDown,
    };

    // Mid run at 18", densified, following DTM
    const beforeUp = {
      x: post.x - exit.ux * rDown,
      y: post.y - exit.uy * rDown,
    };
    // If post is too close, skip mid and shrink
    const midHoriz = horizDist(afterDown, { x: post.x, y: post.y });
    if (midHoriz > rDown + 0.05) {
      const midProf = densifyUtm([
        { x: afterDown.x, y: afterDown.y, z: sampleDTM(afterDown.x, afterDown.y) ?? zN },
        { x: beforeUp.x, y: beforeUp.y, z: sampleDTM(beforeUp.x, beforeUp.y) ?? zP },
      ], sampleDTM);
      for (const p of midProf) {
        const zg = p.z != null ? p.z : (sampleDTM(p.x, p.y) ?? zP);
        ptsUnder.push(worldAt(p.x, p.y, zg - DEPTH_M));
      }
    }

    // Sweep up at the post to grade, arriving at the post face
    const face = postFaceOffset(post, node);
    const upSteps = 10;
    for (let i = 0; i <= upSteps; i++) {
      const s = i / upSteps;
      const h = rDown * (1 - s);
      const z = zDeepP + (zP - zDeepP) * (s * s * (3 - 2 * s));
      const x = face.x - exit.ux * h;
      const y = face.y - exit.uy * h;
      ptsUnder.push(worldAt(x, y, z));
    }
    // last under point is at grade at the face
    const gradeFace = worldAt(face.x, face.y, zP);
    if (ptsUnder.length) ptsUnder[ptsUnder.length - 1] = gradeFace;

    // Up the post face to the bottom of the Flex Utility
    const zFlexBot = zP + FLEX_BOTTOM;
    const upN = Math.max(4, Math.ceil((FLEX_BOTTOM) / 0.08));
    for (let i = 0; i <= upN; i++) {
      const z = zP + (zFlexBot - zP) * (i / upN);
      ptsUp.push(worldAt(face.x, face.y, z));
    }

    return { under: ptsUnder, up: ptsUp, underLen: lengthOf(ptsUnder), upLen: lengthOf(ptsUp) };
  }

  function postFaceOffset(post, node) {
    // Face toward the valve box (or along post.rotation if set, defaulting to facing the VB).
    const dx = node.x - post.x, dy = node.y - post.y;
    let yaw = post.rotation != null ? post.rotation : Math.atan2(dx, -dy);
    // Post face normal in UTM: from rotation (world yaw), outward toward VB if default.
    // world yaw: rotation.y, local +Z is -north when yaw=0? We'll store rotation as world yaw.
    // Face used for conduit: the face whose normal is closest to the VB.
    // Locals: +X (east when yaw=0), -X, +Z, -Z in post local after yaw.
    // Simpler: place conduit on the side toward the VB, at half-width + a bit, regardless of yaw,
    // and rotate the Flex with the post so the enclosure is on a chosen face.
    // The request says conduit runs along the post face. I'll put both the Flex and the
    // riser on the face nearest the VB, and set default post.rotation to face the VB.
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    const offset = POST_W / 2 + 0.4 * IN;
    return { x: post.x + ux * offset, y: post.y + uy * offset, ux, uy };
  }

  function defaultPostYaw(post, node) {
    if (!node) return post.rotation || 0;
    // Face +Z of the post toward the VB. yaw such that local +Z (forward) points to VB.
    // After rotation.y = yaw, local +Z maps to world (sin(yaw), 0, cos(yaw)).
    // world x = east = du, world z = -north = -dv. We want (sin y, cos y) = (ux_world, uz_world)
    // ux_world = ux_utm, uz_world = -uy_utm.
    const dx = node.x - post.x, dy = node.y - post.y;
    return Math.atan2(dx, -dy);
  }

  function makeOutletTexture() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#f5d000';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#111';
    g.fillRect(8, 8, 240, 240);
    g.fillStyle = '#f5d000';
    g.fillRect(16, 16, 224, 224);
    // Plug pictogram (two slots + ground) so the marker is readable without color.
    g.fillStyle = '#111';
    g.fillRect(86, 48, 22, 54);
    g.fillRect(148, 48, 22, 54);
    g.beginPath();
    g.lineWidth = 10;
    g.strokeStyle = '#111';
    g.arc(128, 130, 28, 0.15 * Math.PI, 0.85 * Math.PI, false);
    g.stroke();
    g.font = 'bold 44px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('OUTLET', 128, 198);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const outletTexture = makeOutletTexture();

  function addOutletToGroup(g, post) {
    const holder = new THREE.Group();
    holder.userData.postId = post.id;
    holder.userData.outlet = true;
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(OUTLET_W + 0.4 * IN, OUTLET_H + 0.4 * IN, 0.3 * IN),
      new THREE.MeshBasicMaterial({ color: 0x111111 })
    );
    plate.position.set(0, 0, -0.1 * IN);
    plate.userData.postId = post.id;
    plate.userData.outlet = true;
    const cover = new THREE.Mesh(
      new THREE.BoxGeometry(OUTLET_W, OUTLET_H, OUTLET_D),
      new THREE.MeshBasicMaterial({ map: outletTexture, color: 0xf5d000 })
    );
    cover.userData.postId = post.id;
    cover.userData.outlet = true;
    // Bubble lid (in-use weatherproof cover) — different silhouette from the Flex box.
    const bubble = new THREE.Mesh(
      new THREE.SphereGeometry(OUTLET_W * 0.42, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0xffe14a })
    );
    bubble.rotation.x = Math.PI / 2;
    bubble.position.set(0, OUTLET_H * 0.12, OUTLET_D / 2);
    bubble.userData.postId = post.id;
    bubble.userData.outlet = true;
    holder.add(plate, cover, bubble);
    // Switch box sits on local +Z (VB-facing once the post is yawed). Put the outlet
    // 180° around the post at the same height, cover facing outward, with the OUTLET
    // label. If the switch side later changes (post yaw / VB), both stay in this group
    // so the outlet remains opposite. No switch: use Flex Utility center height and
    // the post's default +Z as the implied switch face.
    const info = post.hasSwitch
      ? enclosureInfo(post.enclosure || post.switchModel)
      : enclosureInfo('flex-utility');
    const y = FLEX_BOTTOM + info.h / 2;
    holder.position.set(0, y, -(POST_W / 2 + OUTLET_D / 2));
    holder.rotation.y = Math.PI;
    g.add(holder);
    return holder;
  }

  let flexProFrontMap = null;
  function loadFlexProFrontTexture() {
    const url = 'assets/uacc-flex-utility-pro-front.png?v=20261111-1155lt';
    new THREE.TextureLoader().load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      tex.needsUpdate = true;
      flexProFrontMap = tex;
      if (typeof rebuildPosts === 'function') rebuildPosts();
    }, undefined, (err) => {
      console.warn('Flex Utility Pro front photo failed to load', url, err);
    });
  }
  function addFlexToGroup(g, post) {
    const info = enclosureInfo(post.enclosure || post.switchModel);
    let mat;
    if (info.id === 'flex-utility-pro') {
      // Front face (+Z) is the lid, away from the post. Sides stay plain; regular Flex Utility is unchanged.
      const side = new THREE.MeshBasicMaterial({ color: info.color });
      const front = new THREE.MeshBasicMaterial({
        map: flexProFrontMap || flexProTexture,
        color: 0xffffff,
      });
      mat = [side, side, side, side, front, side];
    } else {
      mat = new THREE.MeshBasicMaterial({ map: flexTexture, color: info.color });
    }
    const flex = new THREE.Mesh(new THREE.BoxGeometry(info.w, info.h, info.d), mat);
    flex.position.set(0, FLEX_BOTTOM + info.h / 2, POST_W / 2 + info.d / 2);
    flex.userData.postId = post.id;
    flex.userData.flex = true;
    flex.userData.enclosure = info.id;
    g.add(flex);
    return info;
  }

  function makePostMesh(post, node, lt) {
    const g = new THREE.Group();
    g.name = post.name || post.id;
    g.userData.postId = post.id;
    const zG = (sampleDTM(post.x, post.y) != null) ? sampleDTM(post.x, post.y) : post.z;
    const yaw = post.rotation != null ? post.rotation : defaultPostYaw(post, node);
    post.rotation = yaw;

    const woodMat = new THREE.MeshBasicMaterial({ map: woodTexture, color: 0xd2b48c });
    const woodDark = new THREE.MeshBasicMaterial({ color: 0x7a5230 });
    const woodXray = new THREE.MeshBasicMaterial({
      color: 0xc4a574, transparent: true, opacity: 0.35,
      depthTest: false, depthWrite: false,
    });

    const aboveGeo = new THREE.BoxGeometry(POST_W, POST_ABOVE, POST_W);
    const above = new THREE.Mesh(aboveGeo, woodMat);
    above.position.set(0, POST_ABOVE / 2, 0);
    above.userData.postId = post.id;
    g.add(above);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(POST_W + 0.1 * IN, 0.15 * IN, POST_W + 0.1 * IN), woodDark);
    cap.position.set(0, POST_ABOVE + 0.05 * IN, 0);
    cap.userData.ignorePick = true;
    g.add(cap);

    const belowGeo = new THREE.BoxGeometry(POST_W, POST_BELOW, POST_W);
    const below = new THREE.Mesh(belowGeo, woodDark);
    below.position.set(0, -POST_BELOW / 2, 0);
    below.userData.postId = post.id;
    g.add(below);
    const belowGhost = new THREE.Mesh(belowGeo, woodXray);
    belowGhost.position.copy(below.position);
    belowGhost.renderOrder = 20;
    belowGhost.userData.ignorePick = true;
    g.add(belowGhost);

    if (post.hasSwitch) addFlexToGroup(g, post);
    if (post.needsOutlet) addOutletToGroup(g, post);

    if (SHOW_CONDUIT_MESH && post.hasSwitch && lt && (lt.under.length >= 2 || lt.up.length >= 2)) {
      const ltColor = 0x8a93a0;
      if (lt.under.length >= 2) addTubePair(g, worldToLocal(g, lt.under), radiusLt(), ltColor);
      if (lt.up.length >= 2) addTubePair(g, worldToLocal(g, lt.up), radiusLt(), ltColor);
    }

    // If we add tubes in post-local space, we must set g position/rotation first.
    return { group: g, zG, yaw };
  }

  function worldToLocal(group, worldPts) {
    // Caller must set group matrix first. We'll instead add tubes to postGroup in world space.
    return worldPts;
  }

  function rebuildPosts() {
    postGroup.clear();
    for (const post of posts) {
      if (post.hasSwitch) applyEnclosure(post, post.enclosure || readEnclosure(post));
      const node = post.hasSwitch
        ? (nodes.find((n) => n.id === post.valveBoxId) || nearestNode(post))
        : null;
      if (post.hasSwitch && node && !post.valveBoxId) post.valveBoxId = node.id;
      if (post.hasSwitch && node && post.rotation == null) post.rotation = defaultPostYaw(post, node);
      const lt = (post.hasSwitch && node) ? buildLtRun(post, node) : { under: [], up: [], underLen: 0, upLen: 0 };
      post.underLen = lt.underLen;
      post.upLen = lt.upLen;
      post.z = sampleDTM(post.x, post.y) ?? post.z;

      const g = new THREE.Group();
      g.name = post.name || post.id;
      g.userData.postId = post.id;
      const zG = post.z;
      const yaw = post.rotation || 0;
      const woodMat = new THREE.MeshBasicMaterial({ map: woodTexture, color: 0xd2b48c });
      const woodDark = new THREE.MeshBasicMaterial({ color: 0x7a5230 });
      const woodXray = new THREE.MeshBasicMaterial({
        color: 0xc4a574, transparent: true, opacity: 0.35,
        depthTest: false, depthWrite: false,
      });
      const above = new THREE.Mesh(new THREE.BoxGeometry(POST_W, POST_ABOVE, POST_W), woodMat);
      above.position.set(0, POST_ABOVE / 2, 0);
      above.userData.postId = post.id;
      const cap = new THREE.Mesh(new THREE.BoxGeometry(POST_W + 0.1 * IN, 0.15 * IN, POST_W + 0.1 * IN), woodDark);
      cap.position.set(0, POST_ABOVE + 0.05 * IN, 0);
      cap.userData.ignorePick = true;
      const below = new THREE.Mesh(new THREE.BoxGeometry(POST_W, POST_BELOW, POST_W), woodDark);
      below.position.set(0, -POST_BELOW / 2, 0);
      below.userData.postId = post.id;
      const belowGhost = new THREE.Mesh(below.geometry, woodXray);
      belowGhost.position.copy(below.position);
      belowGhost.renderOrder = 20;
      belowGhost.userData.ignorePick = true;
      g.add(above, cap, below, belowGhost);
      if (post.hasSwitch) addFlexToGroup(g, post);
      if (post.needsOutlet) addOutletToGroup(g, post);
      g.position.copy(worldAt(post.x, post.y, zG));
      g.rotation.y = yaw;
      postGroup.add(g);

      if (SHOW_CONDUIT_MESH && showConduit && post.hasSwitch && node) {
        const ltColor = 0x8a93a0;
        const holder = new THREE.Group();
        holder.userData.ignorePick = true;
        if (lt.under.length >= 2) addTubePair(holder, lt.under, radiusLt(), ltColor);
        if (lt.up.length >= 2) addTubePair(holder, lt.up, radiusLt(), ltColor);
        postGroup.add(holder);
      }
      post._group = g;
    }
    postGroup.visible = true;
    renderPostList();
    if (selectedPost) fillPostPanel(selectedPost);
    labelsNeedSync = true;
    if (typeof rebuildLtAg === 'function') rebuildLtAg();
  }

  function nearestNode(pt) {
    if (!nodes.length) return null;
    let best = nodes[0], bestD = Infinity;
    for (const n of nodes) {
      const d = Math.hypot(n.x - pt.x, n.y - pt.y);
      if (d < bestD) { best = n; bestD = d; }
    }
    return best;
  }

  function rebuildAll() {
    const paths = (getPaths() || []).filter((p) => p.visible !== false && p.points && p.points.length >= 2);
    const clusters = clusterEndpoints(paths);
    nodes = labelNodes(clusters, paths);
    for (const n of nodes) n.entries = [];

    conduitGroup.clear();
    boxGroup.clear();
    if (showConduit) {
      const r = radiusMain();
      const color = 0xff8c2a;
      for (const p of paths) {
        const pts = buildMainRun(p, true);
        if (SHOW_CONDUIT_MESH && pts.length >= 2) addTubePair(conduitGroup, pts, r, color);
      }
      for (const n of nodes) boxGroup.add(makeValveBox(n));
    }
    conduitGroup.visible = showConduit && SHOW_CONDUIT_MESH;
    boxGroup.visible = showConduit;
    rebuildPosts();
    rebuildMasts();
    rebuildAps();
    if (typeof rebuildLtAg === 'function') rebuildLtAg();
    else syncLabels();
  }

  const publicLabels=new Map();let publicLabelView="";
  function publicLabel(kind,id,seen){const key=kind+':'+id;seen.add(key);let el=publicLabels.get(key);
    if(!el){el=document.createElement('button');el.type='button';publicLabels.set(key,el);labelsRoot.appendChild(el);}return el;
  }
  function syncLabels() {
    if (!labelsRoot || document.body.classList.contains('labels-off')) return;
    const signature=[...camera.position.toArray(),...camera.quaternion.toArray(),camera.aspect,showConduit,document.getElementById("showLt").checked,posts.length,aps.length,masts.length,nodes.length,innerWidth,innerHeight].map(v=>typeof v==='number'?v.toFixed(4):v).join(',');
    if(signature===publicLabelView)return;publicLabelView=signature;
    const seen=new Set(), occupied=[];
    const canvas = renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    function place(el, world, yOff) {
      const v = world.clone();
      v.y += yOff || 0;
      v.project(camera);
      if (Math.abs(v.x) > 1.3 || Math.abs(v.y) > 1.3 || v.z < -1 || v.z > 1) {
        el.style.display = 'none';if(el._leader)el._leader.style.display='none';
        return;
      }
      el.style.display = '';
      const ax=rect.left+(v.x+1)/2*rect.width, ay=rect.top+(1-v.y)/2*rect.height;
      const w=el._labelWidth||(el._labelWidth=Math.min(el.offsetWidth||120,240)),h=Math.max(44,el.offsetHeight||44);
      const top=document.getElementById('top').getBoundingClientRect().bottom+6;
      const clamp=(q,lo,hi)=>Math.max(lo,Math.min(hi,q));
      let chosen=null,score=Infinity;
      for(let row=-7;row<=7;row++)for(const dx of [0,-w-8,w+8,-(w+8)/2,(w+8)/2]){
        const x=clamp(ax-w/2+dx,6,rect.width-w-6),y=clamp(ay-h-6+row*(h+6),top,rect.height-h-36);
        if(occupied.some(b=>x<b.x+b.w+4&&x+w+4>b.x&&y<b.y+b.h+4&&y+h+4>b.y))continue;
        const cost=Math.hypot(x+w/2-ax,y+h/2-ay);
        if(cost<score){score=cost;chosen={x,y,w,h};}
      }
      if(!chosen)chosen={x:clamp(ax-w/2,6,rect.width-w-6),y:clamp(ay-h-6,top,rect.height-h-36),w,h};
      occupied.push(chosen);el.style.left=chosen.x+'px';el.style.top=chosen.y+'px';
      let line=el._leader;
      if(!line){line=document.createElement('div');line.className='label-leader';labelsRoot.insertBefore(line,labelsRoot.firstChild);el._leader=line;}
      const tx=chosen.x+w/2,ty=chosen.y+h/2,dist=Math.hypot(tx-ax,ty-ay);
      line.style.display=dist>h?'block':'none';line.style.left=ax+'px';line.style.top=ay+'px';
      line.style.width=dist+'px';line.style.transform='rotate('+Math.atan2(ty-ay,tx-ax)+'rad)';
    }
    if (showConduit) {
      for (const n of nodes) {
        const el = publicLabel('vb',n.id,seen);el.dataset.id=n.id;
        el.className = 'site-label vb';
        el.dataset.id = n.id;
        if(el.textContent!==n.id)el.textContent=n.id;
        const w = worldAt(n.x, n.y, n.z);
        place(el, w, 0.25);
      }
    }
    for (const post of posts) {
      const el = publicLabel('post',post.id,seen);el.dataset.id=post.id;
      el.className = 'site-label post' + (post.needsOutlet ? ' outlet' : '');
      {const text=(post.name || 'Post') + (post.needsOutlet ? ' · Outlet needed' : '');if(el.textContent!==text)el.textContent=text;}
      el.title = post.needsOutlet ? (post.name || 'Post') + ' — Outlet needed (outdoor-rated, on post)' : (post.name || 'Post');
      const z = post.z != null ? post.z : sampleDTM(post.x, post.y);
      place(el, worldAt(post.x, post.y, z || 0), POST_ABOVE + 0.15);
    }
    for (const ap of aps) {
      const el = publicLabel('ap',ap.id,seen);el.dataset.id=ap.id;
      el.className = 'site-label ap';
      {const text=ap.name || 'U7 Outdoor';if(el.textContent!==text)el.textContent=text;}
      const z = ap.z != null ? ap.z : sampleDTM(ap.x, ap.y);
      place(el, worldAt(ap.x, ap.y, z || 0), apHeightM(ap) + U7_H + 0.12);
    }
    for (const m of masts) {
      const el = publicLabel('mast',m.id,seen);el.dataset.id=m.id;
      el.className = 'site-label mast';
      {const text=m.name || 'Mast';if(el.textContent!==text)el.textContent=text;}
      const z = m.z != null ? m.z : sampleDTM(m.x, m.y);
      place(el, worldAt(m.x, m.y, z || 0), mastHeightM(m) + 0.12);
    }
    if (typeof appendLtLabels === 'function') appendLtLabels(place,seen);
    for(const [key,el] of publicLabels)if(!seen.has(key)){el.style.display='none';if(el._leader)el._leader.style.display='none';}
  }

  (function labelLoop() {
    if (typeof tickZoom === 'function') tickZoom();
    if (!document.hidden && (showConduit || posts.length || aps.length || masts.length || (typeof ltRuns !== "undefined" && ltRuns.length) || (typeof ltDraft !== "undefined" && ltDraft))) syncLabels();
    requestAnimationFrame(labelLoop);
  })();

  function applyLookBelow(on) {
    lookBelow = !!on;
    const box = $('lookBelow');
    if (box) box.checked = lookBelow;
    if (lookBelow) {
      controls.maxPolarAngle = Math.PI;
      if (!savedSides.length) {
        modelRoot.traverse((obj) => {
          if (!obj.isMesh || !obj.material) return;
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach((m) => {
            if (m.userData._origSide == null) {
              m.userData._origSide = m.side;
              savedSides.push(m);
            }
            m.side = THREE.DoubleSide;
            m.needsUpdate = true;
          });
        });
      }
    } else {
      controls.maxPolarAngle = DEFAULT_POLAR;
      if (controls.getPolarAngle && controls.getPolarAngle() > DEFAULT_POLAR) {
        // Pull the camera back above the horizon around the current target
        const t = controls.target;
        const p = camera.position;
        const dx = p.x - t.x, dy = p.y - t.y, dz = p.z - t.z;
        const horiz = Math.hypot(dx, dz) || 0.01;
        const dist = Math.hypot(dx, dy, dz);
        const ang = DEFAULT_POLAR - 0.02;
        const nh = Math.sin(ang) * dist;
        const nv = Math.cos(ang) * dist;
        const scale = nh / horiz;
        camera.position.set(t.x + dx * scale, t.y + nv, t.z + dz * scale);
        controls.update();
      }
      savedSides.forEach((m) => {
        if (m.userData._origSide != null) m.side = m.userData._origSide;
        m.needsUpdate = true;
      });
      savedSides.length = 0;
    }
  }

  function bindUi() {
    $('showConduit')?.addEventListener('change', e => { showConduit = e.target.checked; rebuildAll(); });
    $('showLt')?.addEventListener('change',e=>{ltAgGroup.visible=e.target.checked;syncLabels();});
    $('lookBelow')?.addEventListener('change', e => applyLookBelow(e.target.checked));
    $('closeVbPanel')?.addEventListener('click', closeVbPanel);
    $('closeInfo')?.addEventListener('click', () => $('infoPanel').classList.remove('show'));
    labelsRoot?.addEventListener('click', ev => {
      const el = ev.target.closest('.site-label'); if (!el) return;
      if (el.classList.contains('vb')) openVb(nodes.find(n=>n.id===el.dataset.id));
      else if (el.classList.contains('post')) selectPost(posts.find(n=>n.id===el.dataset.id));
      else if (el.classList.contains('mast')) selectMast(masts.find(n=>n.id===el.dataset.id));
      else if (el.classList.contains('ap')) selectAp(aps.find(n=>n.id===el.dataset.id));
      else if (el.classList.contains('lt')) selectLt(ltRuns.find(n=>n.id===el.dataset.id));
    });
  }
  bindUi();

  function enterPlaceMode() { return null; }

  function leavePlaceMode() {
    if (postMode !== 'place') return;
    postMode = selectedPost ? 'edit' : 'idle';
    $('placePostBtn')?.classList.remove('on');
    const outRow = $('placeOutletRow');
    if (outRow) outRow.hidden = true;
    if (!selectedPost) {
      $('drawBar')?.classList.remove('show', 'mode-place', 'mode-draw', 'mode-edit');
    }
    // restore cancel for path tool: path-tool already bound cancelBtn to leaveDraw.
    // Re-binding here would steal it. Use a flag and a capture listener instead.
  }

  function leavePostMode() {
    closeVbPanel();
    if (typeof leaveDrawLtMode === 'function') leaveDrawLtMode();
    if (apMode === 'place') leavePlaceApMode();
    if (mastMode === 'place') leavePlaceMastMode();
    if (switchMode === 'place') leavePlaceSwitchMode();
    if (selectedMast) selectMast(null);
    if (postMode === 'place') {
      postMode = 'idle';
      $('placePostBtn')?.classList.remove('on');
      $('drawBar')?.classList.remove('show', 'mode-place');
    }
    selectPost(null);
  }

  function showReadOnlyInfo(title, rows) {
    closeVbPanel();
    $('infoTitle').textContent=title;
    const body=$('infoBody'); body.replaceChildren();
    for(const [key,value] of rows) {
      const row=document.createElement('p'); const b=document.createElement('b');
      b.textContent=key+': '; row.append(b,document.createTextNode(String(value))); body.append(row);
    }
    $('infoPanel').classList.add('show');
  }
  function readOnlyList(id, list, select, details) {
    const ul=$(id); if(!ul)return;ul.replaceChildren();
    for(const item of list) {
      const li=document.createElement('li'), text=document.createElement('span'), button=document.createElement('button');
      text.textContent=item.name+' · '+details(item); button.textContent='Info';button.dataset.itemId=item.id;
      button.addEventListener('click',()=>select(item)); li.append(text,button); ul.append(li);
    }
  }
  function selectPost(post) {
    if(!post)return; const info=post.hasSwitch?enclosureInfo(post.enclosure):null;
    showReadOnlyInfo(post.name, [
      ['Post','6×6×8 ft (actual 5.5×5.5 in), buried 32 in, 64 in above grade'],
      ['Enclosure',info?info.name:'None — bare post'],
      ['Switch',info?post.switchModel:'None'],
      ['Entry',info?(info.id==='flex-utility-pro'?'Bottom punch-outs':'Back of box'):'None'],
      ['Needs power outlet',post.needsOutlet?'Yes — outdoor-rated on post':'No'],
      ['Linked valve box',post.valveBoxId||'None'],
      ['Masts',masts.filter(m=>m.mountId===post.id).map(m=>m.name).join(', ')||'None'],
      ['Legacy 1 in LT riser',post.hasSwitch?fmtFt(post.underLen||0)+' ft underground + '+fmtFt(post.upLen||0)+' ft up post':'None']
    ]);
  }

  function fillPostPanel(post) {
    const title = $('postPanelTitle');
    if (title) title.textContent = post.name || 'Post';
    const tog = $('toggleSwitchBtn');
    if (tog) tog.textContent = post.hasSwitch ? 'Remove switch' : 'Add switch';
    const vbRow = $('postVbRow');
    if (vbRow) vbRow.hidden = !post.hasSwitch;
    const encSel = $('postEnclosureSelect');
    const encRow = $('postEnclosureRow');
    if (encRow) encRow.hidden = false;
    const info = enclosureInfo(post.hasSwitch ? (post.enclosure || 'flex-utility') : (encSel?.value || pendingEnclosure));
    if (encSel) encSel.value = info.id;
    const outEl = $('postNeedsOutlet');
    if (outEl) outEl.checked = !!post.needsOutlet;
    const assumed = $('postSwitchAssumed');
    if (assumed) {
      assumed.textContent = post.hasSwitch
        ? info.panelLabel + ' (implied; changing the enclosure swaps the switch).'
        : 'Will add: ' + info.panelLabel + '. Pick an enclosure, then Add switch.';
    }
    const sel = $('postVbSelect');
    if (sel) {
      sel.innerHTML = nodes.length ? '' : '<option value="">No valve boxes (show conduit)</option>';
      for (const n of nodes) {
        const opt = document.createElement('option');
        opt.value = n.id;
        opt.textContent = n.id + ' — ' + pathsMeetLabel(n);
        if (n.id === post.valveBoxId) opt.selected = true;
        sel.appendChild(opt);
      }
      if (post.valveBoxId && !nodes.some((n) => n.id === post.valveBoxId)) {
        const opt = document.createElement('option');
        opt.value = post.valveBoxId;
        opt.textContent = post.valveBoxId + ' (missing)';
        opt.selected = true;
        sel.appendChild(opt);
      }
    }
    const len = $('postLen');
    if (len) {
      if (!post.hasSwitch) {
        len.innerHTML = 'Bare 6×6×8 post — no enclosure and no 1 in LT run. It can still hold a mast and APs. Use Add switch and choose an enclosure to mount a box about 4 ft up and link it to a valve box.';
      } else {
        const u = post.underLen || 0, up = post.upLen || 0;
        const box = enclosureInfo(post.enclosure).name;
        len.innerHTML = `Underground 1 in LT PVC: <b>${fmtFt(u)} ft</b><br>Up the post (to ${box}, ~4 ft): <b>${fmtFt(up)} ft</b><br>Total run: <b>${fmtFt(u + up)} ft</b>`;
      }
    }
    const dia = $('postDiagram');
    if (dia && !post.hasSwitch) {
      dia.innerHTML = `<svg viewBox="0 0 340 78" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="160" y="8" width="12" height="62" fill="#c4a574"/>
        <text x="166" y="4" fill="#ddd" font-size="7" text-anchor="middle">6×6×8</text>
        <text x="40" y="40" fill="#ddd" font-size="8">No switch · no 1 in LT riser</text>
        <text x="40" y="56" fill="#aaa" font-size="7">Mast and APs still mount here</text>
      </svg>`;
    } else if (dia) {
      const vb = post.valveBoxId || 'VB';
      const u = fmtFt(post.underLen || 0);
      const up = fmtFt(post.upLen || 0);
      const info = enclosureInfo(post.enclosure);
      dia.innerHTML = `<svg viewBox="0 0 340 78" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="6" y="22" width="54" height="36" rx="3" fill="#2a2c2e" stroke="#ccc" stroke-width="1"/>
        <text x="33" y="40" fill="#fff" font-size="8" text-anchor="middle">ABS box</text>
        <text x="33" y="50" fill="#bbb" font-size="7" text-anchor="middle">${vb}</text>
        <path d="M62 40 H150" stroke="#8a93a0" stroke-width="4" fill="none"/>
        <path d="M150 40 C170 40 170 16 190 16" stroke="#8a93a0" stroke-width="4" fill="none"/>
        <text x="118" y="32" fill="#ddd" font-size="7" text-anchor="middle">1 in LT PVC</text>
        <text x="118" y="70" fill="#ddd" font-size="7" text-anchor="middle">${u} ft underground</text>
        <path d="M190 16 V4" stroke="#8a93a0" stroke-width="4" fill="none"/>
        <rect x="176" y="8" width="10" height="62" fill="#c4a574"/>
        <path d="M190 16 V30" stroke="#8a93a0" stroke-width="4" fill="none"/>
        <rect x="194" y="22" width="36" height="28" rx="2" fill="#b4bac0" stroke="#555" stroke-width="1"/>
        <text x="212" y="36" fill="#222" font-size="6" text-anchor="middle">${info.id === 'flex-utility-pro' ? 'Pro' : 'Flex'}</text>
        <text x="212" y="45" fill="#222" font-size="5.5" text-anchor="middle">${info.id === 'flex-utility-pro' ? 'Utility' : 'Utility'}</text>
        <text x="250" y="70" fill="#ddd" font-size="7">${up} ft up post</text>
        <text x="300" y="36" fill="#aaa" font-size="6">${info.sku}</text>
        <text x="300" y="46" fill="#ddd" font-size="5.5">${info.panelLabel.replace(' with ', ' · ')}</text>
        <text x="300" y="56" fill="#888" font-size="5.5">${(info.h*1000).toFixed(0)}×${(info.w*1000).toFixed(0)}×${(info.d*1000).toFixed(0)} mm</text>
      </svg>`;
    }
  }

  function renderPostList() { readOnlyList('postList',posts,selectPost,p=>p.hasSwitch?enclosureInfo(p.enclosure).name+(p.needsOutlet?' · outlet needed':''):'Bare post'); }

  function clearPostHandles() {
    handlesRoot.querySelectorAll('.vtx-handle.post-h').forEach((el) => el.remove());
  }

  function clearPostHandles() {
    handlesRoot.querySelectorAll('.vtx-handle.post-h').forEach((el) => el.remove());
  }

  function projectWorld(vec) {
    const v = vec.clone().project(camera);
    const canvas = renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (v.x + 1) / 2 * rect.width,
      y: rect.top + (1 - v.y) / 2 * rect.height,
      visible: Math.abs(v.x) <= 1.2 && Math.abs(v.y) <= 1.2 && v.z >= -1 && v.z <= 1,
    };
  }

  function ensurePostHandles() { return null; }

  function syncPostHandles() { return null; }

  (function handleLoop() {
    if (selectedPost) syncPostHandles();
    if (selectedAp) syncApHandles();
    if (selectedMast) syncMastHandles();
    if (typeof selectedLt !== 'undefined' && selectedLt) syncLtHandles();
    requestAnimationFrame(handleLoop);
  })();

  function startPostDrag() { return null; }

  function endPostDrag() {
    if (!drag.active) return;
    drag.active = false;
    drag.kind = null;
    drag.pointerId = null;
    controls.enabled = true;
    if (selectedPost && typeof regenerateLtRisersForObject === 'function') regenerateLtRisersForObject(selectedPost);
    requestSave();
    rebuildPosts();
    rebuildMasts();
    rebuildAps();
  }

  function pickGround(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(modelRoot, true).filter((h) => !h.object.userData.ignorePick);
    return hits[0] || null;
  }

  function pickPost(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(postGroup, true);
    for (const h of hits) {
      const id = h.object.userData.postId || (h.object.parent && h.object.parent.userData.postId);
      if (id) return posts.find((p) => p.id === id) || null;
    }
    return null;
  }

  function pickVB(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(boxGroup, true);
    for (const h of hits) {
      let o = h.object;
      while (o) {
        if (o.userData && o.userData.vbId) {
          return nodes.find((n) => n.id === o.userData.vbId) || null;
        }
        o = o.parent;
      }
    }
    return null;
  }

  function cancelPublicFocus() {
    if (!zoomAnim) return;
    controls.enableDamping = zoomAnim.prevDamping;
    zoomAnim = null;
    if (zoomTimer) { clearInterval(zoomTimer); zoomTimer = null; }
    controls.enabled = true;
    window.__holdControls = false;
  }
  // Reset and new gestures must win over a still-running item-focus animation.
  $('reset').addEventListener('click', cancelPublicFocus, {capture: true});
  renderer.domElement.addEventListener('pointerdown', cancelPublicFocus, {capture: true});
  function tickZoom() {
    if (!zoomAnim) return;
    const u = Math.min(1, (performance.now() - zoomAnim.tStart) / zoomAnim.ms);
    const e = u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    camera.position.lerpVectors(zoomAnim.p0, zoomAnim.endPos, e);
    controls.target.lerpVectors(zoomAnim.t0, zoomAnim.endTarget, e);
    camera.lookAt(controls.target);
    if (u >= 1) {
      camera.position.copy(zoomAnim.endPos);
      controls.target.copy(zoomAnim.endTarget);
      camera.lookAt(controls.target);
      controls.enableDamping = zoomAnim.prevDamping;
      controls.enabled = true;
      window.__holdControls = false;
      zoomAnim = null;
      if (zoomTimer) { clearInterval(zoomTimer); zoomTimer = null; }
    }
  }
  function animateZoomTo(endPos, endTarget, ms) {
    cancelPublicFocus();
    zoomAnim = {
      p0: camera.position.clone(),
      t0: controls.target.clone(),
      endPos: endPos.clone(),
      endTarget: endTarget.clone(),
      tStart: performance.now(),
      ms: ms || 850,
      prevDamping: controls.enableDamping,
    };
    controls.enableDamping = false;
    controls.enabled = false;
    window.__holdControls = true;
    window.__tickSite = tickZoom;
    if (!zoomTimer) {
      zoomTimer = setInterval(() => {
        if (zoomAnim) tickZoom();
        else if (zoomTimer) { clearInterval(zoomTimer); zoomTimer = null; }
      }, 16);
    }
  }
  // Drive zoom from viewer.js's animation loop via __tickSite / __holdControls.
  // Do not call renderer.setAnimationLoop here: replacing that loop after
  // init can stall frames in this viewer, which leaves the camera stuck.
  window.__tickSite = tickZoom;

  function fillVbSchematic(node) {
    const title = $('vbPanelTitle');
    if (title) title.textContent = node.id + ' — ' + pathsMeetLabel(node);
    const nEntries = (node.entries || []).length;
    const entryNote = nEntries > 1
      ? nEntries + ' side entries (one from each run), both at 7 in below grade'
      : 'one side entry at 7 in below grade';
    const body = $('vbSchematic');
    if (!body) return;
    body.innerHTML = `
      <p class="vbLead">NDS 14 × 19 in valve box · 1.5 in conduit ${entryNote}.</p>
      <svg viewBox="0 0 360 170" xmlns="http://www.w3.org/2000/svg" class="vbCut" aria-hidden="true">
        <!-- Vertical scale: 6 px per inch. Grade at y=16. 7 in → y=58. Box 12 in → y=88. 18 in run → y=124. -->
        <text x="8" y="11" fill="#9bb" font-size="9" font-weight="700">grade</text>
        <line x1="8" y1="16" x2="352" y2="16" stroke="#6a7" stroke-width="2.5"/>

        <!-- 18 in depth dimension, left of the run -->
        <line x1="18" y1="16" x2="18" y2="124" stroke="#ddd" stroke-width="1.2"/>
        <line x1="13" y1="16" x2="23" y2="16" stroke="#ddd" stroke-width="1.2"/>
        <line x1="13" y1="124" x2="23" y2="124" stroke="#ddd" stroke-width="1.2"/>
        <text x="32" y="74" fill="#fff" font-size="8.5" font-weight="700" text-anchor="middle" transform="rotate(-90 32 74)">18 in below grade</text>

        <!-- 7 in entry dimension at the box wall -->
        <line x1="122" y1="16" x2="122" y2="58" stroke="#ffb56a" stroke-width="1.2"/>
        <line x1="117" y1="16" x2="127" y2="16" stroke="#ffb56a" stroke-width="1.2"/>
        <line x1="117" y1="58" x2="127" y2="58" stroke="#ffb56a" stroke-width="1.2"/>
        <text x="110" y="40" fill="#ffb56a" font-size="7" text-anchor="end">7 in</text>

        <!-- Valve box, lid at grade, 12 in deep -->
        <rect x="130" y="16" width="100" height="72" fill="none" stroke="#3a8c43" stroke-width="3"/>
        <text x="180" y="30" fill="#8c8" font-size="7" text-anchor="middle">green lid (flush with grade)</text>
        <rect x="148" y="26" width="64" height="30" fill="#2a2c2e" stroke="#aaa" stroke-width="1"/>
        <text x="180" y="40" fill="#eee" font-size="6.5" text-anchor="middle">ABS box high</text>
        <text x="180" y="50" fill="#bbb" font-size="5.5" text-anchor="middle">TICONN IP67</text>
        <line x1="130" y1="88" x2="230" y2="88" stroke="#666" stroke-dasharray="3 2"/>
        <text x="180" y="99" fill="#888" font-size="6" text-anchor="middle">open bottom · gravel</text>

        <!-- Mid-run 1.5 in conduit at 18 in, then ramp up to 7 in side entry -->
        <line x1="40" y1="124" x2="78" y2="124" stroke="#ff8c2a" stroke-width="5"/>
        <path d="M78 124 C 100 124, 116 58, 130 58" stroke="#ff8c2a" stroke-width="5" fill="none"/>
        <line x1="130" y1="58" x2="148" y2="58" stroke="#ff8c2a" stroke-width="5"/>
        <text x="58" y="138" fill="#ffb56a" font-size="7.5" text-anchor="middle">1.5 in conduit</text>
        <text x="58" y="148" fill="#ffb56a" font-size="7.5" text-anchor="middle">18 in below grade</text>
        <text x="100" y="90" fill="#ffb56a" font-size="6.5" text-anchor="middle">ramp</text>
        <text x="100" y="100" fill="#ffb56a" font-size="6.5" text-anchor="middle">last 3.5 ft</text>
        <text x="100" y="110" fill="#ffb56a" font-size="6.5" text-anchor="middle">18 in → 7 in</text>

        <!-- Right-hand run (junctions have two side entries) -->
        <line x1="230" y1="58" x2="248" y2="58" stroke="#ff8c2a" stroke-width="5"/>
        <path d="M248 58 C 262 58, 278 124, 300 124" stroke="#ff8c2a" stroke-width="5" fill="none"/>
        <line x1="300" y1="124" x2="352" y2="124" stroke="#ff8c2a" stroke-width="5"/>
        <text x="312" y="50" fill="#ffb56a" font-size="6.5" text-anchor="middle">side-wall entry</text>
        <text x="312" y="60" fill="#ffb56a" font-size="6.5" text-anchor="middle">7 in below grade</text>
        <text x="326" y="138" fill="#ffb56a" font-size="6.5" text-anchor="middle">1.5 in conduit</text>
        <text x="326" y="148" fill="#ffb56a" font-size="6.5" text-anchor="middle">18 in below grade</text>
      </svg>
      <ol class="vbFlow">
        <li>
          <b>1.5 in on-hand pipe</b>
          <span>42–43.5 mm OD. Enters horizontally through the side wall of the NDS box, 7 in (178 mm) below grade.</span>
        </li>
        <li>
          <b>Sealed transition</b>
          <span>Fernco P1056-125 rubber coupling + DURA 1-1/4 × 1 in Sch 40 reducer bushing, wrapped in Scotch 2228 / CANUSA CTB-15.</span>
        </li>
        <li>
          <b>1 in liquid-tight PVC conduit</b>
          <span>Never use flexible metallic conduit here. Liquid-tight PVC only.</span>
        </li>
        <li>
          <b>Liquid-tight connector into the waterproof ABS junction box</b>
          <span>TICONN IP67, 11 × 7.5 × 5.5 in. Alternates: YETLEBOX or HoHaing IP65.</span>
        </li>
        <li>
          <b>Inside the box</b>
          <span>Enmane keystone patch panel with Cat6a keystone jacks.</span>
        </li>
        <li>
          <b>Ethernet exit</b>
          <span>MAKERELE 3/8 in NPT IP68 cable glands, facing down.</span>
        </li>
      </ol>
      <div class="vbNotes">
        <h3>Water protection</h3>
        <ul>
          <li>Mount the enclosure high in the valve box.</li>
          <li>Gravel under the open bottom.</li>
          <li>Drip loops on the Ethernet.</li>
          <li>Glands facing down.</li>
          <li>Sealed conduit ends.</li>
        </ul>
      </div>`;
  }

  function closeVbPanel() {
    openVbId = null;
    $('vbPanel')?.classList.remove('show');
  }

  function openVb(node) {
    if (!node) return false;
    if (selectedPost) selectPost(null);
    if (selectedMast) selectMast(null);
    if (selectedAp) selectAp(null);
    $('pathPanel')?.classList.remove('show');
    $('infoPanel').classList.remove('show');
    openVbId = node.id;
    fillVbSchematic(node);
    $('vbPanel')?.classList.add('show');
    const z = (sampleDTM(node.x, node.y) != null) ? sampleDTM(node.x, node.y) : node.z;
    const target = worldAt(node.x, node.y, z);
    const look = target.clone();
    look.y += 0.08;
    // Stand close, slightly above, offset so both side entries can be seen
    const yaw = (node.yaw || 0) + 0.85;
    const endPos = new THREE.Vector3(
      target.x + Math.sin(yaw) * 5.2,
      target.y + 2.6,
      target.z + Math.cos(yaw) * 5.2
    );
    animateZoomTo(endPos, look, 850);
    return true;
  }

  function placeAtEvent(ev) {
    const hit = pickGround(ev);
    if (!hit) {
      toast('No ground there — try a point on the model.');
      return null;
    }
    const utm = worldToUtm(hit.point);
    const z = sampleDTM(utm.x, utm.y);
    if (z == null) {
      toast('No DTM data at that point. Try a spot farther from the edge.');
      return null;
    }
    const needsOutlet = !!$('placeNeedsOutlet')?.checked;
    const placed = placePostAt(utm.x, utm.y, { needsOutlet });
    return placed;
  }

  function payloadPost(post) {
    const info = post.hasSwitch ? enclosureInfo(post.enclosure) : null;
    return {
      id: post.id, name: post.name, x: post.x, y: post.y, z: post.z,
      rotation: post.rotation, valveBoxId: post.valveBoxId || null,
      hasSwitch: !!post.hasSwitch,
      enclosure: post.hasSwitch ? (info ? info.id : 'flex-utility') : null,
      switchModel: post.hasSwitch ? (info ? info.switchModel : 'USW-Flex') : null,
      enclosureLabel: info ? info.panelLabel : null,
      needsOutlet: !!post.needsOutlet,
      underLen: post.underLen, upLen: post.upLen,
      under_ft: Number(((post.underLen || 0) * 3.280839895).toFixed(1)),
      up_ft: Number(((post.upLen || 0) * 3.280839895).toFixed(1)),
    };
  }

  function setPostEnclosure() { return null; }

  function setPostNeedsOutlet() { return null; }

  function setPostHasSwitch() { return null; }

  function placeSwitchOnPost() { return null; }

  function showSwitchEnclosureRow(on) {
    const row = $('switchEnclosureRow');
    if (row) row.hidden = !on;
    const sel = $('placeSwitchEnclosure');
    if (sel && on) sel.value = pendingEnclosure || 'flex-utility';
  }

  function enterPlaceSwitchMode() { return null; }

  function leavePlaceSwitchMode() {
    if (switchMode !== 'place') return;
    switchMode = 'idle';
    showSwitchEnclosureRow(false);
    $('placeSwitchBtn')?.classList.remove('on');
    if (postMode !== 'place' && apMode !== 'place' && mastMode !== 'place' && !selectedPost && !selectedAp && !selectedMast) {
      $('drawBar')?.classList.remove('show', 'mode-place', 'mode-draw', 'mode-edit');
    }
  }

  function placeSwitchAtEvent(ev) {
    const post = pickPost(ev);
    if (!post) {
      toast('Tap a post to mount the enclosure you selected.');
      return null;
    }
    pendingEnclosure = normalizeEnclosure($('placeSwitchEnclosure')?.value || pendingEnclosure || 'flex-utility');
    return placeSwitchOnPost(post, pendingEnclosure);
  }

  function placePostAt() { return null; }

  function deletePost() { return null; }

  function onDown(ev) {
    if (drag.active) return;
    if (ev.target && ev.target.closest && ev.target.closest('.vtx-handle')) return;
    if (ev.isPrimary === false) {
      pointer.moved = true;
      pointer.count += 1;
      return;
    }
    if (getMode && (getMode() === 'draw' || getMode() === 'edit')) return;
    pointer.id = ev.pointerId;
    pointer.x = ev.clientX;
    pointer.y = ev.clientY;
    pointer.moved = false;
    pointer.count += 1;
    if (pointer.count > 1) pointer.moved = true;
  }
  function onMove(ev) {
    if (pointer.id !== ev.pointerId) return;
    const dx = ev.clientX - pointer.x, dy = ev.clientY - pointer.y;
    if (dx * dx + dy * dy > TAP_PX * TAP_PX) pointer.moved = true;
  }
  function onUp(ev) {
    if(ev.pointerId===pointer.id){
      if(!pointer.moved&&ev.button===0){
        const a=pickAp(ev),m=a?null:pickMast(ev),p=(a||m)?null:pickPost(ev),l=(a||m||p||!ltAgGroup.visible)?null:pickLtRun(ev),v=(a||m||p||l)?null:pickVB(ev);
        if(a)selectAp(a);else if(m)selectMast(m);else if(p)selectPost(p);else if(l)selectLt(l);else if(v)openVb(v);
      }
      pointer.id=null;
    }
    pointer.count=Math.max(0,pointer.count-1);
  }
  function onCancel(ev) {
    if (ev.pointerId === pointer.id) pointer.id = null;
    pointer.count = Math.max(0, pointer.count - 1);
  }

  const canvas = renderer.domElement;
  canvas.addEventListener('pointerdown', onDown, { capture: true });
  canvas.addEventListener('pointermove', onMove, { capture: true });
  canvas.addEventListener('pointerup', onUp, { capture: true });
  canvas.addEventListener('pointercancel', onCancel, { capture: true });

  // --- U7 Outdoor AP (official body 170 x 208 x 54.5 mm from ui.com) ---
  const U7_W = 0.170, U7_H = 0.208, U7_D = 0.0545;
  const U7_ANT_H = 0.12; // antenna length not listed; approximate
  const POLE_H = 6 * 12 * IN;
  const POLE_R = 0.95 * IN;
  const AP_MAST_MIN_H = 1 * 12 * IN; // ~1 ft AGL; clamp mast-mounted APs to [this, mast top]

  function mastBaseM(m) {
    // Mast always starts at grade (DTM), including post-mounted stacks
    // that run alongside a 6x6 rather than sitting on top of it.
    return 0;
  }

  function mastSideSign(m) {
    return (m && m.side === '-x') ? -1 : 1;
  }

  function mastSideLocalX(m) {
    return mastSideSign(m) * (POST_W / 2 + MAST_R);
  }

  function storedApMountHeightM(ap, m) {
    if (ap && ap.mountHeightM != null && Number.isFinite(Number(ap.mountHeightM))) return Number(ap.mountHeightM);
    return readMountHeightM(ap, m);
  }

  function apIsAboveMastTop(ap, m) {
    if (!ap || ap.mount !== 'mast' || !m) return false;
    return storedApMountHeightM(ap, m) > mastHeightM(m) + 1e-6;
  }

  function clampApMastHeight(h, m) {
    const top = mastHeightM(m);
    const lo = Math.max(AP_MAST_MIN_H, mastBaseM(m));
    const hi = Math.max(lo, top);
    const v = Number(h);
    if (!Number.isFinite(v)) return hi;
    return Math.min(hi, Math.max(lo, v));
  }

  function readMountHeightM(src, mast) {
    if (src && src.mountHeightM != null && Number.isFinite(Number(src.mountHeightM))) return Number(src.mountHeightM);
    if (src && src.mountHeightFt != null && Number.isFinite(Number(src.mountHeightFt))) return Number(src.mountHeightFt) / FT;
    if (src && src.mount_height_m != null && Number.isFinite(Number(src.mount_height_m))) return Number(src.mount_height_m);
    if (src && src.mount_height_ft != null && Number.isFinite(Number(src.mount_height_ft))) return Number(src.mount_height_ft) / FT;
    if (src && src.height_m != null && Number.isFinite(Number(src.height_m))) return Number(src.height_m);
    if (src && src.height_ft != null && Number.isFinite(Number(src.height_ft))) return Number(src.height_ft) / FT;
    return mast ? mastHeightM(mast) : POLE_H;
  }

  function pickMastHit(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(mastGroup, true);
    for (const h of hits) {
      let o = h.object;
      while (o) {
        if (o.userData && o.userData.mast) {
          return { mast: o.userData.mast, point: h.point, distance: h.distance };
        }
        o = o.parent;
      }
    }
    return null;
  }

  function heightOnMastFromWorld(mast, worldPoint) {
    const zG = mast.z != null ? mast.z : sampleDTM(mast.x, mast.y);
    const origin = worldAt(mast.x, mast.y, zG || 0);
    return worldPoint.y - origin.y;
  }

  function heightOnMastFromPointer(ev, mast) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const ray = raycaster.ray;
    const zG = mast.z != null ? mast.z : sampleDTM(mast.x, mast.y);
    const origin = worldAt(mast.x, mast.y, zG || 0);
    const axis = new THREE.Vector3(0, 1, 0);
    const w0 = ray.origin.clone().sub(origin);
    const a = ray.direction.dot(ray.direction);
    const b = ray.direction.dot(axis);
    const d = ray.direction.dot(w0);
    const e = axis.dot(w0);
    const denom = a - b * b;
    let s;
    if (Math.abs(denom) < 1e-10) {
      const side = new THREE.Vector3().crossVectors(axis, ray.direction).cross(axis);
      if (side.lengthSq() < 1e-12) return e;
      side.normalize();
      const denomN = ray.direction.dot(side);
      if (Math.abs(denomN) < 1e-10) return e;
      const tt = origin.clone().sub(ray.origin).dot(side) / denomN;
      s = ray.origin.y + ray.direction.y * tt - origin.y;
    } else {
      s = (a * e - b * d) / denom;
    }
    return s;
  }

  function makeApTexture() {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#f2f4f6';
    g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#e6e8eb';
    g.fillRect(16, 16, 224, 224);
    g.fillStyle = '#4a90d9';
    g.beginPath(); g.arc(128, 70, 16, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#333';
    g.font = 'bold 28px sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('UniFi', 128, 130);
    g.font = '22px sans-serif';
    g.fillText('U7 Outdoor', 128, 168);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const apTexture = makeApTexture();

  function getMasts() {
    return masts.map(payloadMast);
  }

  function mastHeightM(m) {
    if (!m) return MAST_SECTION_H;
    const n = Math.max(1, m.sections || 1);
    return n * MAST_SECTION_H; // sections × 10 ft from grade
  }

  function payloadMast(m) {
    const h = mastHeightM(m);
    return {
      id: m.id, name: m.name, kind: 'mast',
      x: m.x, y: m.y, z: m.z,
      sections: m.sections || 1,
      mount: m.mount || 'ground',
      mountId: m.mountId || null,
      height_m: h,
      topHeight: h,
      height_ft: Number((h * FT).toFixed(1)),
      pipe: '1.5 in galvanized steel',
      od_in: 1.9,
      section_ft: 10,
      side: m.mount === 'post' ? (m.side || '+x') : null,
      offset_m: m.mount === 'post' ? (POST_W / 2 + MAST_R) : 0,
    };
  }

  function syncMastToParent(m) {
    if (!m || m.mount !== 'post' || !m.mountId) return;
    const post = posts.find((p) => p.id === m.mountId);
    if (!post) {
      m.mount = 'ground';
      m.mountId = null;
      return;
    }
    const zG = post.z != null ? post.z : (sampleDTM(post.x, post.y) ?? m.z);
    const w = postLocalToWorld(post, mastSideLocalX(m), 0, 0);
    const utm = worldToUtm(w);
    m.x = utm.x;
    m.y = utm.y;
    m.z = zG;
    m.rotation = post.rotation || 0;
  }

  function applyMastGroupPose(m) {
    if (!m || !m._group) return;
    const zG = m.z != null ? m.z : (sampleDTM(m.x, m.y) ?? 0);
    m._group.position.copy(worldAt(m.x, m.y, zG));
    m._group.rotation.y = m.rotation || 0;
  }

  function syncMountedMastsToPost(post) {
    if (!post) return;
    for (const m of masts) {
      if (m.mount !== 'post' || m.mountId !== post.id) continue;
      syncMastToParent(m);
      applyMastGroupPose(m);
      for (const ap of aps) {
        if (ap.mount === 'mast' && ap.mountId === m.id) {
          ap.x = m.x; ap.y = m.y; ap.z = m.z;
          if (ap._group) ap._group.position.copy(worldAt(ap.x, ap.y, ap.z));
        }
      }
    }
  }

  function makeMastBracket() {
    const g = new THREE.Group();
    g.userData.role = 'bracket';
    const steel = new THREE.MeshBasicMaterial({ color: 0x4a5560 });
    const strap = new THREE.Mesh(
      new THREE.CylinderGeometry(MAST_R + 0.18 * IN, MAST_R + 0.18 * IN, 0.85 * IN, 20),
      steel
    );
    strap.userData.role = 'bracket';
    g.add(strap);
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.18 * IN, 1.4 * IN, 1.6 * IN), steel);
    plate.position.set(-MAST_R - 0.09 * IN, 0, 0);
    plate.userData.role = 'bracket';
    g.add(plate);
    const legR = 0.12 * IN;
    const legLen = MAST_R + 0.45 * IN;
    for (const sz of [-0.55 * IN, 0.55 * IN]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(legR, legR, legLen, 8), steel);
      leg.rotation.z = Math.PI / 2;
      leg.position.set(-legLen / 2, 0, sz);
      leg.userData.role = 'bracket';
      g.add(leg);
    }
    return g;
  }

  function makeMastMesh(m) {
    const g = new THREE.Group();
    g.name = m.name || m.id;
    g.userData.mast = m;
    g.userData.mastId = m.id;
    const zG = sampleDTM(m.x, m.y) ?? m.z;
    m.z = zG;
    const n = Math.max(1, m.sections || 1);
    const pipeMat = new THREE.MeshBasicMaterial({ map: galvTexture, color: 0xc8ced3 });
    const coupleMat = new THREE.MeshBasicMaterial({ map: galvTexture, color: 0x8e959c });
    const capMat = new THREE.MeshBasicMaterial({ color: 0x7a8086 });
    // Pipe starts at grade; coupler rings sit at each 10 ft section joint.
    for (let i = 0; i < n; i++) {
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(MAST_R, MAST_R, MAST_SECTION_H, 16), pipeMat);
      pipe.position.set(0, i * MAST_SECTION_H + MAST_SECTION_H / 2, 0);
      pipe.userData.mast = m;
      pipe.userData.mastId = m.id;
      pipe.userData.role = 'pipe';
      g.add(pipe);
      if (i > 0) {
        const couple = new THREE.Mesh(
          new THREE.CylinderGeometry(MAST_COUPLE_R, MAST_COUPLE_R, MAST_COUPLE_H, 16),
          coupleMat
        );
        couple.position.set(0, i * MAST_SECTION_H, 0);
        couple.userData.mast = m;
        couple.userData.mastId = m.id;
        couple.userData.role = 'coupler';
        g.add(couple);
      }
    }
    // Grade socket for ground-mounted stacks (not a counted section).
    if (m.mount !== 'post') {
      const socket = new THREE.Mesh(
        new THREE.CylinderGeometry(MAST_COUPLE_R * 1.15, MAST_COUPLE_R * 1.25, MAST_COUPLE_H, 16),
        coupleMat
      );
      socket.position.set(0, MAST_COUPLE_H / 2, 0);
      socket.userData.mast = m;
      socket.userData.role = 'socket';
      g.add(socket);
      const bury = new THREE.Mesh(
        new THREE.CylinderGeometry(MAST_R, MAST_R, MAST_BURY, 16),
        new THREE.MeshBasicMaterial({ color: 0x6a7076 })
      );
      bury.position.set(0, -MAST_BURY / 2, 0);
      bury.userData.mast = m;
      bury.userData.role = 'bury';
      const buryX = new THREE.Mesh(
        bury.geometry,
        new THREE.MeshBasicMaterial({ color: 0xb0b6bc, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false })
      );
      buryX.position.copy(bury.position);
      buryX.renderOrder = 20;
      buryX.userData.ignorePick = true;
      g.add(bury, buryX);
    } else {
      // U-bolt / pipe-strap brackets spread over the 64 in above-grade post.
      const bracketYs = [8 * IN, 32 * IN, 56 * IN];
      const side = mastSideSign(m);
      for (const y of bracketYs) {
        const br = makeMastBracket();
        br.position.set(0, y, 0);
        // Legs point toward the post (local −X when mast is on +X face).
        if (side < 0) br.rotation.y = Math.PI;
        br.userData.mast = m;
        br.userData.mastId = m.id;
        br.traverse((o) => { o.userData.mast = m; o.userData.mastId = m.id; o.userData.role = 'bracket'; });
        g.add(br);
      }
    }
    const top = n * MAST_SECTION_H;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(MAST_R + 0.04 * IN, MAST_R + 0.04 * IN, 0.2 * IN, 16), capMat);
    cap.position.set(0, top + 0.1 * IN, 0);
    cap.userData.mast = m;
    cap.userData.role = 'cap';
    g.add(cap);
    g.position.copy(worldAt(m.x, m.y, zG));
    g.rotation.y = m.rotation || 0;
    m._group = g;
    m.topHeight = mastHeightM(m);
    m.height_m = m.topHeight;
    return g;
  }

  function rebuildMasts() {
    mastGroup.clear();
    for (const m of masts) {
      syncMastToParent(m);
      mastGroup.add(makeMastMesh(m));
    }
    mastGroup.visible = true;
    renderMastList();
    if (selectedMast) fillMastPanel(selectedMast);
    labelsNeedSync = true;
    if (typeof regenerateLtRisersForObject === 'function') {
      for (const m of masts) regenerateLtRisersForObject(m);
    }
    if (typeof rebuildLtAg === 'function') rebuildLtAg();
  }

  function placeMastAt() { return null; }

  function stackMast() { return null; }

  function removeMastSection() { return null; }

  function deleteMast() { return null; }

  function enterPlaceMastMode() { return null; }

  function leavePlaceMastMode() {
    if (mastMode !== 'place') return;
    mastMode = selectedMast ? 'edit' : 'idle';
    $('placeMastBtn')?.classList.remove('on');
    if (!selectedMast && postMode !== 'place' && apMode !== 'place') {
      $('drawBar')?.classList.remove('show', 'mode-place', 'mode-draw', 'mode-edit');
    }
  }

  function selectMast(m) {
    if(!m)return;
    showReadOnlyInfo(m.name, [ ['Pipe','1.5 in galvanized steel (1.900 in OD)'],['Sections',(m.sections||1)+' × 10 ft'],
      ['Height above grade',fmtFt(mastHeightM(m))+' ft'],['Position','Ground-up alongside the post, with U-bolts and section couplers'],
      ['Mount',m.mount==='post'?(posts.find(p=>p.id===m.mountId)?.name||'Post'):'Ground'],
      ['Access points',aps.filter(a=>a.mountId===m.id).map(a=>a.name+' at '+fmtFt(apHeightM(a))+' ft').join(', ')||'None'] ]);
  }

  function fillMastPanel(m) {
    const title = $('mastPanelTitle');
    if (title) title.textContent = m.name || 'Mast';
    const n = m.sections || 1;
    const h = mastHeightM(m);
    const mountLabel = m.mount === 'post'
      ? ('Post: ' + ((posts.find((p) => p.id === m.mountId) || {}).name || m.mountId || '—'))
      : 'Ground';
    const body = $('mastInfo');
    if (body) {
      const sideNote = m.mount === 'post'
        ? 'Alongside post, from grade (free side face)'
        : 'Ground-mounted, from grade';
      body.innerHTML = `<div class="nums">
        <div><b>Pipe:</b> 1.5 in galvanized steel (1.900 in OD)</div>
        <div><b>Sections:</b> ${n} × 10 ft</div>
        <div><b>Height above grade:</b> ${fmtFt(h)} ft</div>
        <div><b>Mount:</b> ${mountLabel}</div>
        <div><b>Position:</b> ${sideNote}</div>
      </div>`;
    }
  }

  function renderMastList() { readOnlyList('mastList',masts,selectMast,m=>fmtFt(mastHeightM(m))+' ft AGL'); }

  function ensureMastHandles() { return null; }

  function syncMastHandles() { return null; }

  function startMastDrag() { return null; }

  function endMastDrag() {
    if (!drag.active) return;
    drag.active = false;
    drag.kind = null;
    drag.pointerId = null;
    controls.enabled = true;
    requestSave();
    rebuildMasts();
    rebuildAps();
  }

  function ensureMastHandles() { return null; }

  function syncMastHandles() { return null; }

  function startMastDrag() { return null; }

  function endMastDrag() {
    if (!drag.active) return;
    drag.active = false;
    drag.kind = null;
    drag.pointerId = null;
    controls.enabled = true;
    if (selectedMast && typeof regenerateLtRisersForObject === 'function') regenerateLtRisersForObject(selectedMast);
    requestSave();
    rebuildMasts();
    rebuildAps();
  }

  function placeMastAtEvent(ev) {
    const mast = pickMast(ev);
    if (mast) {
      const stacked = stackMast(mast);
      return stacked;
    }
    const post = pickPost(ev);
    if (post) {
      const placed = placeMastAt(post.x, post.y, { mount: 'post', mountId: post.id, prefer: 'post' });
      toast((placed.name || 'Mast') + ' placed on ' + (post.name || 'the post') + ' (' + placed.height_ft + ' ft AGL)');
      return placed;
    }
    const hit = pickGround(ev);
    if (!hit) {
      toast('No ground there — try a post, a mast, or a point on the model.');
      return null;
    }
    const utm = worldToUtm(hit.point);
    const z = sampleDTM(utm.x, utm.y);
    if (z == null) {
      toast('No DTM data at that point. Try a spot farther from the edge.');
      return null;
    }
    const placed = placeMastAt(utm.x, utm.y, { mount: 'ground', prefer: 'ground' });
    toast((placed.name || 'Mast') + ' placed · 10 ft AGL');
    return placed;
  }


  function apHeightM(ap) {
    if (ap.mount === 'ground') return POLE_H;
    if (ap.mount === 'post') return POST_ABOVE - 0.04;
    if (ap.mount === 'mast') {
      const m = masts.find((x) => x.id === ap.mountId);
      if (!m) return ap.mountHeightM || ap.height_m || POLE_H;
      const raw = ap.mountHeightM != null ? ap.mountHeightM : readMountHeightM(ap, m);
      return clampApMastHeight(raw, m);
    }
    return ap.height_m || POLE_H;
  }

  function parentMountOf(ap) {
    if (ap.mount === 'post') return posts.find((p) => p.id === ap.mountId) || null;
    if (ap.mount === 'mast') return masts.find((m) => m.id === ap.mountId) || null;
    return null;
  }

  function syncApToParent(ap) {
    const parent = parentMountOf(ap);
    if (!parent) return;
    ap.x = parent.x;
    ap.y = parent.y;
    ap.z = parent.z != null ? parent.z : (sampleDTM(parent.x, parent.y) ?? ap.z);
  }

  function makeApMesh(ap) {
    const g = new THREE.Group();
    g.name = ap.name || ap.id;
    g.userData.apId = ap.id;
    const zG = sampleDTM(ap.x, ap.y) ?? ap.z;
    ap.z = zG;
    const h = apHeightM(ap);
    ap.height_m = h;
    const yaw = ap.rotation || 0;

    if (ap.mount === 'ground') {
      const poleMat = new THREE.MeshBasicMaterial({ color: 0x8a9096 });
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(POLE_R, POLE_R, POLE_H, 12), poleMat);
      pole.position.set(0, POLE_H / 2, 0);
      pole.userData.apId = ap.id;
      const buryH = 1.5 * 12 * IN;
      const bury = new THREE.Mesh(
        new THREE.CylinderGeometry(POLE_R, POLE_R, buryH, 12),
        new THREE.MeshBasicMaterial({ color: 0x6a7076 })
      );
      bury.position.set(0, -buryH / 2, 0);
      bury.userData.apId = ap.id;
      const buryX = new THREE.Mesh(
        bury.geometry,
        new THREE.MeshBasicMaterial({ color: 0x8a9096, transparent: true, opacity: 0.35, depthTest: false, depthWrite: false })
      );
      buryX.position.copy(bury.position);
      buryX.renderOrder = 20;
      buryX.userData.ignorePick = true;
      g.add(pole, bury, buryX);
    }

    const bodyMat = new THREE.MeshBasicMaterial({ map: apTexture, color: 0xffffff });
    const sideMat = new THREE.MeshBasicMaterial({ color: 0xf3f5f7 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(U7_W, U7_H, U7_D), [
      sideMat, sideMat, sideMat, sideMat, bodyMat, sideMat,
    ]);
    // Sit on the mount: bottom of body at height h
    const standOff = ap.mount === 'post' ? (POST_W / 2 + U7_D / 2)
      : ap.mount === 'mast' ? (MAST_R + U7_D / 2) : 0;
    body.position.set(0, h + U7_H / 2, standOff);
    body.userData.apId = ap.id;
    g.add(body);

    const antMat = new THREE.MeshBasicMaterial({ color: 0xd8dce0 });
    const antR = 0.006;
    const antOff = U7_W * 0.22;
    for (const sx of [-1, 1]) {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(antR, antR, U7_ANT_H, 8), antMat);
      ant.position.set(sx * antOff, h + U7_H + U7_ANT_H / 2, body.position.z);
      ant.userData.apId = ap.id;
      g.add(ant);
    }
    g.position.copy(worldAt(ap.x, ap.y, zG));
    g.rotation.y = yaw;
    ap._group = g;
    return g;
  }

  function rebuildAps() {
    apGroup.clear();
    for (const ap of aps) {
      if (ap.mount === 'mast') {
        const m = masts.find((x) => x.id === ap.mountId);
        if (m && ap.mountHeightM == null) ap.mountHeightM = readMountHeightM(ap, m);
      }
      syncApToParent(ap);
      apGroup.add(makeApMesh(ap));
    }
    renderApList();
    if (selectedAp) fillApPanel(selectedAp);
    labelsNeedSync = true;
    if (typeof rebuildLtAg === 'function') rebuildLtAg();
  }

  function payloadAp(ap) {
    const h = apHeightM(ap);
    const m = ap.mount === 'mast' ? masts.find((x) => x.id === ap.mountId) : null;
    const stored = m ? storedApMountHeightM(ap, m) : null;
    const over = !!(m && stored != null && stored > mastHeightM(m) + 1e-6);
    return {
      id: ap.id, name: ap.name, kind: 'ap', model: 'U7 Outdoor',
      x: ap.x, y: ap.y, z: ap.z, rotation: ap.rotation || 0,
      mount: ap.mount, mountId: ap.mountId || null,
      height_m: h, height_ft: Number((h * FT).toFixed(1)),
      mountHeightM: ap.mount === 'mast' ? stored : null,
      mountHeightFt: ap.mount === 'mast' ? Number((stored * FT).toFixed(1)) : null,
      aboveMastTop: over,
    };
  }

  function placeApAt() { return null; }

  function deleteAp() { return null; }

  function enterPlaceApMode() { return null; }

  function leavePlaceApMode() {
    if (apMode !== 'place') return;
    apMode = selectedAp ? 'edit' : 'idle';
    $('placeApBtn')?.classList.remove('on');
    if (!selectedAp && postMode !== 'place' && mastMode !== 'place') {
      $('drawBar')?.classList.remove('show', 'mode-place', 'mode-draw', 'mode-edit');
    }
  }

  function selectAp(a) {
    if(!a)return;
    showReadOnlyInfo(a.name, [['Model','UniFi U7 Outdoor'],['Size','170 × 208 × 54.5 mm'],
      ['Mount',a.mount==='mast'?(masts.find(m=>m.id===a.mountId)?.name||'Mast'):a.mount==='post'?(posts.find(p=>p.id===a.mountId)?.name||'Post'):'Ground'],
      ['Height above grade',fmtFt(apHeightM(a))+' ft'],['Mounting','Mast mounting supports top or mid-mast heights; this snapshot is view-only'] ]);
  }

  function fillApPanel(ap) {
    const title = $('apPanelTitle');
    if (title) title.textContent = ap.name || 'U7 Outdoor';
    const h = apHeightM(ap);
    const mForAp = ap.mount === 'mast' ? masts.find((x) => x.id === ap.mountId) : null;
    const storedH = mForAp ? storedApMountHeightM(ap, mForAp) : h;
    const over = apIsAboveMastTop(ap, mForAp);
    const mountLabel = ap.mount === 'post' ? ('Post: ' + ((posts.find((p) => p.id === ap.mountId) || {}).name || ap.mountId || '—'))
      : ap.mount === 'mast' ? ('Mast: ' + ((mForAp || {}).name || ap.mountId || '—'))
      : 'Ground (6 ft pole)';
    const body = $('apInfo');
    if (body) {
      body.innerHTML = `<div class="nums">
        <div><b>Model:</b> UniFi U7 Outdoor (UAP-U7O)</div>
        <div><b>Size:</b> 170 × 208 × 54.5 mm (6.7 × 8.2 × 2.1 in)</div>
        <div><b>Mount:</b> ${mountLabel}</div>
        <div><b>Height above grade:</b> ${fmtFt(storedH)} ft</div>
        <div><b>Linked mount:</b> ${ap.mount === 'ground' ? 'none (own pole)' : (ap.mountId || '—')}</div>
      </div>`;
    }
    const row = $('apMastHeightRow');
    const htEl = $('apMastHeight');
    const warn = $('apMastHeightWarn');
    if (row) row.hidden = ap.mount !== 'mast';
    if (htEl && ap.mount === 'mast') {
      const topFt = mForAp ? Number((mastHeightM(mForAp) * FT).toFixed(1)) : 10;
      const storedFt = Number((storedH * FT).toFixed(1));
      htEl.min = '1';
      // Don't set max below the stored value or the input would visually clamp it.
      htEl.max = String(Math.max(topFt, storedFt));
      htEl.value = String(storedFt);
    }
    if (warn) {
      if (ap.mount === 'mast' && over) {
        warn.hidden = false;
        warn.textContent = 'above mast top — add a section or lower';
      } else {
        warn.hidden = true;
        warn.textContent = '';
      }
    }
    const sel = $('apMountSelect');
    if (sel) {
      sel.innerHTML = '';
      const add = (val, label, selected) => {
        const o = document.createElement('option');
        o.value = val; o.textContent = label; o.selected = !!selected;
        sel.appendChild(o);
      };
      add('ground', 'Ground — 6 ft pole', ap.mount === 'ground');
      posts.forEach((p) => add('post:' + p.id, 'Post — ' + (p.name || p.id), ap.mount === 'post' && ap.mountId === p.id));
      getMasts().forEach((m) => add('mast:' + m.id, 'Mast — ' + (m.name || m.id), ap.mount === 'mast' && ap.mountId === m.id));
    }
  }

  function renderApList() { readOnlyList('apList',aps,selectAp,a=>'U7 Outdoor · '+fmtFt(apHeightM(a))+' ft AGL'); }

  function ensureApHandles() { return null; }

  function syncApHandles() { return null; }

  function startApDrag() { return null; }

  function pickAp(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(apGroup, true);
    for (const h of hits) {
      let o = h.object;
      while (o) {
        if (o.userData && o.userData.apId) return aps.find((a) => a.id === o.userData.apId) || null;
        o = o.parent;
      }
    }
    return null;
  }

  function ensureApHandles() { return null; }

  function syncApHandles() { return null; }

  function startApDrag() { return null; }

  function pickAp(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(apGroup, true);
    for (const h of hits) {
      let o = h.object;
      while (o) {
        if (o.userData && o.userData.apId) return aps.find((a) => a.id === o.userData.apId) || null;
        o = o.parent;
      }
    }
    return null;
  }

  function pickMast(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(mastGroup, true);
    for (const h of hits) {
      let o = h.object;
      while (o) {
        if (o.userData && o.userData.mast) return o.userData.mast;
        o = o.parent;
      }
    }
    return null;
  }

  function placeApAtEvent(ev) {
    const mastHit = pickMastHit(ev);
    if (mastHit) {
      const mast = mastHit.mast;
      let h = heightOnMastFromWorld(mast, mastHit.point);
      if (h == null || !Number.isFinite(h)) h = heightOnMastFromPointer(ev, mast);
      h = clampApMastHeight(h, mast);
      const ap = placeApAt(mast.x, mast.y, { mount: 'mast', mountId: mast.id, prefer: 'mast', mountHeightM: h });
      toast((ap.name || 'AP') + ' mounted at ' + fmtFt(h) + ' ft AGL on the mast');
      return ap;
    }
    const post = pickPost(ev);
    if (post) {
      const ap = placeApAt(post.x, post.y, { mount: 'post', mountId: post.id, prefer: 'post' });
      toast((ap.name || 'AP') + ' mounted near the top of ' + (post.name || 'the post'));
      return ap;
    }
    const hit = pickGround(ev);
    if (!hit) {
      toast('No ground there — try a post, a mast, or a point on the model.');
      return null;
    }
    const utm = worldToUtm(hit.point);
    const z = sampleDTM(utm.x, utm.y);
    if (z == null) {
      toast('No DTM data at that point. Try a spot farther from the edge.');
      return null;
    }
    const ap = placeApAt(utm.x, utm.y, { mount: 'ground', prefer: 'ground' });
    toast((ap.name || 'AP') + ' placed on a 6 ft pole');
    return ap;
  }

  function applyApMountChoice(ap, value) {
    if (value === 'ground') {
      ap.mount = 'ground';
      ap.mountId = null;
    } else if (value.startsWith('post:')) {
      ap.mount = 'post';
      ap.mountId = value.slice(5);
      syncApToParent(ap);
    } else if (value.startsWith('mast:')) {
      ap.mount = 'mast';
      ap.mountId = value.slice(5);
      syncApToParent(ap);
      const m = masts.find((x) => x.id === ap.mountId);
      if (m) {
        if (ap.mountHeightM == null) ap.mountHeightM = mastHeightM(m);
        // Keep a saved height even if it is above the current mast top.
      }
    }
    requestSave();
    rebuildAps();
  }


  function setApMountHeightFt() { return null; }

  function getPostsForSave() {
    return posts.map((p) => ({
      id: p.id, name: p.name, x: p.x, y: p.y, z: p.z,
      rotation: p.rotation || 0, valveBoxId: p.valveBoxId || null, kind: 'post',
      hasSwitch: !!p.hasSwitch,
      enclosure: p.hasSwitch ? (p.enclosure || 'flex-utility') : null,
      switchModel: p.hasSwitch ? (p.switchModel || switchModelFor(p.enclosure)) : null,
      needsOutlet: !!p.needsOutlet,
    }));
  }
  function getMastsForSave() {
    return masts.map((m) => ({
      id: m.id, name: m.name, kind: 'mast',
      x: m.x, y: m.y, z: m.z,
      sections: m.sections || 1,
      mount: m.mount || 'ground',
      mountId: m.mountId || null,
      height_m: mastHeightM(m),
    }));
  }
  function getApsForSave() {
    return aps.map((a) => ({
      id: a.id, name: a.name, kind: 'ap', model: 'U7 Outdoor',
      x: a.x, y: a.y, z: a.z, rotation: a.rotation || 0,
      mount: a.mount, mountId: a.mountId || null, height_m: apHeightM(a),
      mountHeightM: a.mount === 'mast' ? apHeightM(a) : null,
      mountHeightFt: a.mount === 'mast' ? Number((apHeightM(a) * FT).toFixed(1)) : null,
    }));
  }

  function loadFromStorage(data) {
    if (!data) return;
    const list = data.posts || [];
    posts = list.filter((p) => p && p.x != null && p.y != null).map((p) => {
      const post = {
        id: p.id || uuid(),
        name: p.name || 'Post',
        x: p.x, y: p.y, z: p.z,
        rotation: p.rotation != null ? p.rotation : null,
        valveBoxId: p.valveBoxId || p.valve_box || null,
        kind: 'post',
        hasSwitch: legacyHasSwitch(p),
        needsOutlet: p.needsOutlet != null ? !!p.needsOutlet : (p.needs_outlet != null ? !!p.needs_outlet : false),
      };
      if (post.hasSwitch) applyEnclosure(post, p.enclosure || readEnclosure(p));
      return post;
    });
    const alist = data.aps || [];
    aps = alist.filter((a) => a && a.x != null && a.y != null).map((a) => ({
      id: a.id || uuid(),
      name: a.name || 'AP',
      kind: 'ap',
      model: a.model || 'U7 Outdoor',
      x: a.x, y: a.y, z: a.z,
      rotation: a.rotation != null ? a.rotation : 0,
      mount: a.mount || 'ground',
      mountId: a.mountId || a.mount_id || null,
      mountHeightM: (a.mount || 'ground') === 'mast' ? readMountHeightM(a, null) : null,
    }));
    const mlist = data.masts || [];
    masts = mlist.filter((m) => m && m.x != null && m.y != null).map((m) => ({
      id: m.id || uuid(),
      name: m.name || 'Mast',
      kind: 'mast',
      x: m.x, y: m.y, z: m.z,
      sections: Math.max(1, parseInt(m.sections, 10) || 1),
      mount: m.mount || 'ground',
      mountId: m.mountId || m.mount_id || null,
    }));
    if (typeof loadLtRunsFromList === 'function') loadLtRunsFromList(data.ltRuns || data.lt_runs || []);
  }

  function exportFeatures() {
    const postFeats = posts.map((p) => ({
      type: 'Feature',
      properties: {
        kind: 'post',
        id: p.id,
        name: p.name,
        valve_box: p.valveBoxId || null,
        hasSwitch: !!p.hasSwitch,
        enclosure: p.hasSwitch ? (p.enclosure || 'flex-utility') : null,
        switchModel: p.hasSwitch ? (p.switchModel || switchModelFor(p.enclosure)) : null,
        needsOutlet: !!p.needsOutlet,
        rotation_deg: Number((((p.rotation || 0) * 180 / Math.PI) % 360).toFixed(2)),
        conduit_underground_ft: Number(fmtFt(p.underLen || 0)),
        conduit_up_post_ft: Number(fmtFt(p.upLen || 0)),
        size: '6x6x8',
        actual_in: [5.5, 5.5, 96],
        bury_in: 32,
        above_grade_in: 64,
        enclosure_sku: p.hasSwitch ? enclosureInfo(p.enclosure).sku : null,
        enclosure_mm: p.hasSwitch ? [
          Math.round(enclosureInfo(p.enclosure).h * 1000),
          Math.round(enclosureInfo(p.enclosure).w * 1000),
          Math.round(enclosureInfo(p.enclosure).d * 1000),
        ] : null,
      },
      geometry: {
        type: 'Point',
        coordinates: [p.x, p.y, p.z],
      },
    }));
    const apFeats = aps.map((a) => ({
      type: 'Feature',
      properties: {
        kind: 'ap',
        model: 'U7 Outdoor',
        id: a.id,
        name: a.name,
        mount: a.mount,
        mount_id: a.mountId || null,
        height_ft: Number(fmtFt(apHeightM(a))),
        height_m: apHeightM(a),
        mountHeightFt: a.mount === 'mast' ? Number(fmtFt(apHeightM(a))) : null,
        mountHeightM: a.mount === 'mast' ? apHeightM(a) : null,
        rotation_deg: Number((((a.rotation || 0) * 180 / Math.PI) % 360).toFixed(2)),
        size_mm: [170, 208, 54.5],
      },
      geometry: {
        type: 'Point',
        coordinates: [a.x, a.y, a.z],
      },
    }));
    const mastFeats = masts.map((m) => ({
      type: 'Feature',
      properties: {
        kind: 'mast',
        id: m.id,
        name: m.name,
        sections: m.sections || 1,
        section_ft: 10,
        height_ft: Number(fmtFt(mastHeightM(m))),
        height_m: mastHeightM(m),
        mount: m.mount || 'ground',
        mount_id: m.mountId || null,
        pipe: '1.5 in galvanized steel',
        od_in: 1.9,
      },
      geometry: {
        type: 'Point',
        coordinates: [m.x, m.y, m.z],
      },
    }));
    const ltFeats = (typeof exportLtFeatures === 'function') ? exportLtFeatures() : [];
    return postFeats.concat(apFeats, mastFeats, ltFeats);
  }

  function importFeatures(fc) {
    const features = (fc && fc.features) || (fc && fc.type === 'Feature' ? [fc] : []);
    let n = 0;
    const pendingLt = [];
    for (const f of features) {
      if (!f || !f.geometry) continue;
      if ((f.properties && f.properties.kind === 'lt-run') || (f.geometry.type === 'LineString' && f.properties && f.properties.kind === 'lt-run')) {
        pendingLt.push(f);
        continue;
      }
      if (f.geometry.type !== 'Point') continue;
      const props = f.properties || {};
      const c = f.geometry.coordinates;
      const x = c[0], y = c[1];
      const z = sampleDTM(x, y);
      if (z == null) continue;
      if (props.kind === 'mast') {
        masts.push({
          id: props.id || uuid(),
          name: props.name || ('Mast ' + (masts.length + 1)),
          kind: 'mast',
          x, y, z,
          sections: Math.max(1, parseInt(props.sections, 10) || 1),
          mount: props.mount || 'ground',
          mountId: props.mount_id || props.mountId || null,
        });
        n++;
        continue;
      }
      if (props.kind === 'ap' || props.model === 'U7 Outdoor') {
        aps.push({
          id: props.id || uuid(),
          name: props.name || ('AP ' + (aps.length + 1)),
          kind: 'ap',
          model: 'U7 Outdoor',
          x, y, z,
          rotation: props.rotation_deg != null ? (props.rotation_deg * Math.PI / 180) : (props.rotation || 0),
          mount: props.mount || 'ground',
          mountId: props.mount_id || props.mountId || null,
          mountHeightM: (props.mount || 'ground') === 'mast' ? readMountHeightM(props, null) : null,
        });
        n++;
        continue;
      }
      const isPost = props.kind === 'post' || props.size === '6x6x8' || props.enclosure || props.valve_box || props.enclosure_sku;
      if (!isPost) continue;
      const post = {
        id: props.id || uuid(),
        name: props.name || ('Post ' + (posts.length + 1)),
        x, y, z,
        rotation: props.rotation_deg != null ? (props.rotation_deg * Math.PI / 180) : (props.rotation || null),
        valveBoxId: props.valve_box || props.valveBoxId || null,
        kind: 'post',
        hasSwitch: legacyHasSwitch(props),
        needsOutlet: props.needsOutlet != null ? !!props.needsOutlet : (props.needs_outlet != null ? !!props.needs_outlet : false),
      };
      if (post.hasSwitch) applyEnclosure(post, props.enclosure || props.enclosure_sku || readEnclosure(props));
      posts.push(post);
      n++;
    }
    for (const f of pendingLt) {
      if (typeof importLtFeature === 'function' && importLtFeature(f)) n++;
    }
    if (n) rebuildAll();
    return n;
  }

  function conduitSamples() {
    const out = [];
    const paths = (getPaths() || []).filter((p) => p.visible !== false && p.points && p.points.length >= 2);
    for (const p of paths) {
      const pts = buildMainRun(p);
      for (const w of pts) {
        const u = worldToUtm(w);
        const zg = sampleDTM(u.x, u.y);
        if (zg == null) continue;
        out.push({
          path: p.name || p.id,
          x: u.x, y: u.y, z: u.z,
          dtm: zg,
          depth_m: zg - u.z,
        });
      }
    }
    return out;
  }

  // --- Above-ground liquid-tight runs (separate from buried path conduit) ---
  const LT_AG_HALF_R = (0.84 * IN) / 2;
  const LT_AG_ONE_R = (1.35 * IN) / 2;
  const LT_AG_STANDOFF = 8 * IN;
  const LT_AG_VIS = 1.7;

  function readRouteDepthIn(v, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback != null ? fallback : 18;
    return Math.max(-240, Math.min(240, n));
  }
  function depthInOfVert(v) {
    if (!v) return 0;
    if (v.depthIn != null && Number.isFinite(Number(v.depthIn))) return Number(v.depthIn);
    const zg = sampleDTM(v.x, v.y);
    if (zg != null && v.z != null && Number.isFinite(v.z)) return (zg - v.z) / IN;
    return 0;
  }
  function vertToWorld(v) {
    const zg = sampleDTM(v.x, v.y) ?? (v.z != null ? v.z : 0);
    const d = depthInOfVert(v);
    return worldAt(v.x, v.y, zg - d * IN);
  }
  function worldToVert(w) {
    const u = worldToUtm(w);
    const zg = sampleDTM(u.x, u.y) ?? u.z;
    return { x: u.x, y: u.y, z: u.z, depthIn: Number(((zg - u.z) / IN).toFixed(2)) };
  }

  function bakeRunVerts(run) {
    const keep = run.verts;
    run.verts = null;
    const pts = buildLtWorldPoints(run);
    run.verts = keep;
    if (!pts || pts.length < 2) return run.verts || [];
    run.verts = pts.map(worldToVert);
    ensureRiserFlags(run);
    return run.verts;
  }


  function normalizeLtSize(v) {
    const s = String(v == null ? '' : v).replace(/\s+/g, '');
    if (s === '0.5' || s === '1/2' || s === '.5' || s === 'half' || s === '12') return '1/2';
    return '1';
  }
  function ltSizeLabel(size) {
    return normalizeLtSize(size) === '1/2' ? '1/2"' : '1"';
  }
  function ltRadiusOf(size) {
    return (normalizeLtSize(size) === '1/2' ? LT_AG_HALF_R : LT_AG_ONE_R) * LT_AG_VIS;
  }
  function ltColorOf(size) {
    return normalizeLtSize(size) === '1/2' ? 0xc5cbb0 : 0x8e96a0;
  }

  function postLocalToWorld(post, lx, ly, lz) {
    const zG = sampleDTM(post.x, post.y) ?? post.z ?? 0;
    const yaw = post.rotation || 0;
    const pos = worldAt(post.x, post.y, zG);
    return new THREE.Vector3(
      pos.x + lx * Math.cos(yaw) + lz * Math.sin(yaw),
      pos.y + ly,
      pos.z - lx * Math.sin(yaw) + lz * Math.cos(yaw)
    );
  }
  function yawLocalToWorld(x, y, zG, yaw, lx, ly, lz) {
    const pos = worldAt(x, y, zG);
    return new THREE.Vector3(
      pos.x + lx * Math.cos(yaw) + lz * Math.sin(yaw),
      pos.y + ly,
      pos.z - lx * Math.sin(yaw) + lz * Math.cos(yaw)
    );
  }

  function resolveLtEnd(ref) {
    if (!ref) return null;
    if (ref.type === 'vb') {
      const node = nodes.find((n) => n.id === ref.id);
      return node ? { type: 'vb', id: node.id, label: node.id, node } : null;
    }
    if (ref.type === 'switch' || ref.type === 'post' || ref.type === 'bare-post') {
      const post = posts.find((p) => p.id === ref.id);
      if (!post) return null;
      if (post.hasSwitch) return { type: 'switch', id: post.id, label: post.name || 'Switch', post };
      return { type: 'post', id: post.id, label: post.name || 'Post', post };
    }
    if (ref.type === 'ap') {
      const ap = aps.find((a) => a.id === ref.id);
      return ap ? { type: 'ap', id: ap.id, label: ap.name || 'AP', ap } : null;
    }
    if (ref.type === 'mast') {
      const mast = masts.find((m) => m.id === ref.id);
      return mast ? { type: 'mast', id: mast.id, label: mast.name || 'Mast', mast } : null;
    }
    return null;
  }

  function validLtPair(a, b) {
    if (!a || !b) return false;
    if (a.type === b.type && a.id === b.id) return false;
    const ok = { vb: 1, switch: 1, post: 1, ap: 1, mast: 1, 'bare-post': 1 };
    return !!(ok[a.type] && ok[b.type]);
  }

  function switchAttach(post, radius) {
    const info = enclosureInfo(post.enclosure || 'flex-utility');
    const isPro = info.id === 'flex-utility-pro';
    const zFace = POST_W / 2 + Math.max(radius, 0.35 * IN);
    if (isPro) {
      // Punch-outs run along the 350 mm bottom edge (landscape). Enter at the center.
      const glandZ = POST_W / 2 + info.d * 0.55;
      const below = FLEX_BOTTOM - 1.5 * IN;
      return {
        style: 'bottom',
        styleLabel: 'Enters the Flex Utility Pro from the bottom (punch-outs / glands along the 350 mm edge)',
        entry: postLocalToWorld(post, 0, FLEX_BOTTOM, glandZ),
        under: postLocalToWorld(post, 0, below, glandZ),
        climbAtBox: postLocalToWorld(post, 0, below, zFace),
        climbAtGrade: postLocalToWorld(post, 0, 0, zFace),
        entryHeightM: FLEX_BOTTOM,
      };
    }
    const xOff = info.w * 0.28;
    const yEnt = FLEX_BOTTOM + 1.5 * IN;
    const zEnt = POST_W / 2 + 0.35 * IN;
    return {
      style: 'back',
      styleLabel: 'Enters the Flex Utility from the back (90° connector, near the mounting bracket)',
      entry: postLocalToWorld(post, xOff, yEnt, zEnt),
      under: postLocalToWorld(post, xOff, yEnt, zFace),
      climbAtBox: postLocalToWorld(post, xOff, yEnt, zFace),
      climbAtGrade: postLocalToWorld(post, xOff, 0, zFace),
      entryHeightM: yEnt,
    };
  }

  function apAttach(ap, radius) {
    const zG = sampleDTM(ap.x, ap.y) ?? ap.z ?? 0;
    const h = apHeightM(ap);
    const yaw = ap.rotation || 0;
    const climbZ = (ap.mount === 'mast' ? MAST_R : ap.mount === 'post' ? POST_W / 2 : 0.4 * IN) + Math.max(radius, 0.3 * IN);
    const standOff = ap.mount === 'post' ? (POST_W / 2 + U7_D / 2)
      : ap.mount === 'mast' ? (MAST_R + U7_D / 2) : (0.4 * IN);
    const entry = yawLocalToWorld(ap.x, ap.y, zG, yaw, 0, h, standOff);
    const below = yawLocalToWorld(ap.x, ap.y, zG, yaw, 0, Math.max(0, h - 1.5 * IN), standOff);
    const climbAtAp = yawLocalToWorld(ap.x, ap.y, zG, yaw, 0, Math.max(0, h - 1.5 * IN), climbZ);
    let baseH = 0;
    if (ap.mount === 'mast') {
      const m = masts.find((x) => x.id === ap.mountId);
      baseH = mastBaseM(m);
    }
    const climbAtMastBase = yawLocalToWorld(ap.x, ap.y, zG, yaw, 0, baseH, climbZ);
    const climbAtGrade = yawLocalToWorld(ap.x, ap.y, zG, yaw, 0, 0, climbZ);
    return {
      style: 'ap-bottom', entry, under: below, climbAtBox: climbAtAp,
      climbAtMastBase, climbAtGrade, entryHeightM: h,
    };
  }

  function postBareAttach(post, radius) {
    const zFace = POST_W / 2 + Math.max(radius, 0.35 * IN);
    return {
      style: 'post-face',
      styleLabel: 'Meets the post face',
      entry: postLocalToWorld(post, 0, POST_ABOVE - 0.05, zFace),
      under: postLocalToWorld(post, 0, POST_ABOVE - 0.2, zFace),
      climbAtBox: postLocalToWorld(post, 0, POST_ABOVE - 0.2, zFace),
      climbAtGrade: postLocalToWorld(post, 0, 0, zFace),
      entryHeightM: POST_ABOVE,
    };
  }
  function mastAttach(mast, radius) {
    const zG = sampleDTM(mast.x, mast.y) ?? mast.z ?? 0;
    const top = mastHeightM(mast);
    const base = mastBaseM(mast);
    const climbZ = MAST_R + Math.max(radius, 0.3 * IN);
    return {
      style: 'mast-top',
      styleLabel: 'Meets the mast',
      entry: yawLocalToWorld(mast.x, mast.y, zG, 0, 0, top, climbZ),
      under: yawLocalToWorld(mast.x, mast.y, zG, 0, 0, Math.max(base, top - 0.15), climbZ),
      climbAtBox: yawLocalToWorld(mast.x, mast.y, zG, 0, 0, Math.max(base, top - 0.15), climbZ),
      climbAtMastBase: yawLocalToWorld(mast.x, mast.y, zG, 0, 0, base, climbZ),
      climbAtGrade: yawLocalToWorld(mast.x, mast.y, zG, 0, 0, 0, climbZ),
      entryHeightM: top,
    };
  }

  function vbAttach(node, toward) {
    const dest = toward || { x: node.x + 1, y: node.y };
    const exit = vbExitUtm(node, dest);
    const zG = sampleDTM(node.x, node.y) ?? node.z ?? 0;
    const entry = worldAt(exit.x, exit.y, zG);
    return { style: 'vb-grade', entry, under: entry, climbAtBox: entry, climbAtGrade: entry, entryHeightM: 0 };
  }

  function attachFor(end, radius, toward) {
    if (end.type === 'switch') return switchAttach(end.post, radius);
    if (end.type === 'post' || end.type === 'bare-post') return postBareAttach(end.post, radius);
    if (end.type === 'ap') return apAttach(end.ap, radius);
    if (end.type === 'mast') return mastAttach(end.mast, radius);
    if (end.type === 'vb') return vbAttach(end.node, toward);
    return null;
  }

  function towardUtmOf(end) {
    if (end.type === 'switch' || end.type === 'post' || end.type === 'bare-post') return { x: end.post.x, y: end.post.y };
    if (end.type === 'ap') return { x: end.ap.x, y: end.ap.y };
    if (end.type === 'mast') return { x: end.mast.x, y: end.mast.y };
    if (end.type === 'vb') return { x: end.node.x, y: end.node.y };
    return { x: 0, y: 0 };
  }

  function bendWorld(b) {
    return vertToWorld({ x: b.x, y: b.y, z: b.z, depthIn: depthInOfVert(b) });
  }

  function pushUnique(arr, pt, eps) {
    if (!pt) return;
    if (!arr.length || arr[arr.length - 1].distanceTo(pt) > (eps || 0.008)) arr.push(pt.clone());
  }

  function approachInto(att, fromGrade) {
    const pts = [];
    if (fromGrade && att.climbAtGrade) pushUnique(pts, att.climbAtGrade);
    if (fromGrade && att.climbAtMastBase) pushUnique(pts, att.climbAtMastBase);
    if (att.climbAtBox) pushUnique(pts, att.climbAtBox);
    if (att.under) pushUnique(pts, att.under);
    if (att.entry) pushUnique(pts, att.entry);
    return pts;
  }

  function buildLtWorldPoints(run) {
    if (run && Array.isArray(run.verts) && run.verts.length >= 2) {
      return run.verts.map(vertToWorld);
    }
    const a = resolveLtEnd(run.start);
    const b = resolveLtEnd(run.end);
    if (!a || !b || !validLtPair(a, b)) return [];
    const radius = ltRadiusOf(run.size);
    const attA = attachFor(a, radius, towardUtmOf(b));
    const attB = attachFor(b, radius, towardUtmOf(a));
    if (!attA || !attB) return [];
    const mid = (run.bends || []).map(bendWorld);
    const pts = [];
    const climbTypes = { switch: 1, post: 1, ap: 1, mast: 1, 'bare-post': 1 };
    const aIsClimbingEnd = !!climbTypes[a.type];
    const bIsClimbingEnd = !!climbTypes[b.type];

    if (!aIsClimbingEnd) {
      pushUnique(pts, attA.entry);
    } else {
      const into = approachInto(attA, !mid.length && !bIsClimbingEnd);
      for (let i = into.length - 1; i >= 0; i--) pushUnique(pts, into[i]);
    }
    for (const m of mid) pushUnique(pts, m, 0.02);

    if (!bIsClimbingEnd) {
      pushUnique(pts, attB.entry);
    } else if (aIsClimbingEnd && bIsClimbingEnd && nearSameStack(a, b)) {
      const intoB = approachInto(attB, false);
      for (const p of intoB) pushUnique(pts, p);
    } else {
      const intoB = approachInto(attB, true);
      for (const p of intoB) pushUnique(pts, p);
    }
    return pts;
  }


  function isLtAutoVert(v) {
    return !!(v && (v.auto === true || v.locked === true));
  }

  function dedupeLtVerts(verts) {
    const out = [];
    for (const v of verts) {
      const prev = out[out.length - 1];
      if (!prev || Math.hypot(v.x - prev.x, v.y - prev.y) > 0.04 || Math.abs(depthInOfVert(v) - depthInOfVert(prev)) > 0.4) {
        out.push(v);
      } else if (isLtAutoVert(v)) {
        prev.auto = true;
      }
    }
    return out;
  }

  function buildRiserVerts(endRef, towardRef, size, depthIn, side, bury) {
    const end = resolveLtEnd(endRef);
    if (!end) return [];
    const toward = resolveLtEnd(towardRef);
    const att = attachFor(end, ltRadiusOf(size), toward ? towardUtmOf(toward) : null);
    if (!att) return [];
    const verts = [];
    function addW(w) {
      if (!w) return;
      const v = worldToVert(w);
      v.auto = true;
      verts.push(v);
    }
    function addBuriedFrom(w) {
      if (!w) return;
      const u = worldToUtm(w);
      const zg = sampleDTM(u.x, u.y);
      if (zg == null) return;
      verts.push({ x: u.x, y: u.y, z: zg - depthIn * IN, depthIn, auto: true });
    }
    const climb = { switch: 1, post: 1, ap: 1, mast: 1, 'bare-post': 1 };
    const grade = att.climbAtGrade || att.entry;
    if (climb[end.type]) {
      const down = [att.entry, att.under, att.climbAtBox, att.climbAtMastBase, att.climbAtGrade].filter(Boolean);
      if (side === 'start') {
        down.forEach(addW);
        if (bury) addBuriedFrom(grade);
      } else {
        if (bury) addBuriedFrom(grade);
        down.slice().reverse().forEach(addW);
      }
    } else {
      if (side === 'start') {
        addW(att.entry);
        if (bury) addBuriedFrom(att.entry);
      } else {
        if (bury) addBuriedFrom(att.entry);
        addW(att.entry);
      }
    }
    return dedupeLtVerts(verts);
  }

  function buildGroundSpan(a, b, depth) {
    const mid = [];
    if (!a || !b) return mid;
    const horiz = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(horiz / 1.0));
    for (let i = 1; i < n; i++) {
      const tt = i / n;
      const x = a.x + (b.x - a.x) * tt;
      const y = a.y + (b.y - a.y) * tt;
      const zg = sampleDTM(x, y);
      if (zg == null) continue;
      mid.push({ x, y, z: zg - depth * IN, depthIn: depth, auto: false });
    }
    return mid;
  }

  function regenerateLtRisers(run) {
    if (!run || !run.start || !run.end) return run && run.verts;
    const bury = !!run.autoRoute;
    const depth = readRouteDepthIn(run.routeDepthIn, bury ? 18 : 0);
    const mid = (run.verts || []).filter((v) => !isLtAutoVert(v)).map((v) => ({
      x: v.x, y: v.y, z: v.z, depthIn: depthInOfVert(v), auto: false,
    }));
    const startRiser = buildRiserVerts(run.start, run.end, run.size, depth, 'start', bury);
    const endRiser = buildRiserVerts(run.end, run.start, run.size, depth, 'end', bury);
    let ground = mid;
    if (!ground.length && bury) {
      ground = buildGroundSpan(startRiser[startRiser.length - 1], endRiser[0], depth);
    }
    run.verts = dedupeLtVerts(startRiser.concat(ground).concat(endRiser));
    return run.verts;
  }

  function runTouchesId(run, id) {
    if (!run || !id) return false;
    for (const ref of [run.start, run.end]) {
      if (!ref) continue;
      if (ref.id === id) return true;
      const e = resolveLtEnd(ref);
      if (!e) continue;
      if (e.id === id) return true;
      if (e.post && e.post.id === id) return true;
      if (e.ap && (e.ap.id === id || e.ap.mountId === id)) return true;
      if (e.ap && e.ap.mount === 'mast') {
        const am = masts.find((x) => x.id === e.ap.mountId);
        if (am && (am.id === id || am.mountId === id)) return true;
      }
      if (e.mast && (e.mast.id === id || e.mast.mountId === id)) return true;
    }
    return false;
  }

  function regenerateLtRisersForObject(obj) {
    if (!obj) return 0;
    const id = obj.id || obj;
    let n = 0;
    for (const run of ltRuns) {
      if (runTouchesId(run, id)) {
        regenerateLtRisers(run);
        n++;
      }
    }
    return n;
  }

  function ensureRiserFlags(run) {
    if (!run || !run.verts || run.verts.length < 2) return;
    if (run.verts.some(isLtAutoVert)) return;
    const bury = !!run.autoRoute;
    const depth = readRouteDepthIn(run.routeDepthIn, bury ? 18 : 0);
    const sr = buildRiserVerts(run.start, run.end, run.size, depth, 'start', bury);
    const er = buildRiserVerts(run.end, run.start, run.size, depth, 'end', bury);
    const anchors = sr.concat(er);
    for (const v of run.verts) {
      if (anchors.some((r) => Math.hypot(r.x - v.x, r.y - v.y) < 0.15 && Math.abs(depthInOfVert(r) - depthInOfVert(v)) < 3)) {
        v.auto = true;
      }
    }
    if (bury && !run.verts.some(isLtAutoVert)) {
      const a = resolveLtEnd(run.start);
      const b = resolveLtEnd(run.end);
      const ax = a ? towardUtmOf(a) : null;
      const bx = b ? towardUtmOf(b) : null;
      for (const v of run.verts) {
        const nearA = ax && Math.hypot(v.x - ax.x, v.y - ax.y) < 0.6;
        const nearB = bx && Math.hypot(v.x - bx.x, v.y - bx.y) < 0.6;
        if (nearA || nearB) v.auto = true;
      }
    }
  }

  function buildAutoRouteVerts(startRef, endRef, depthIn, size) {
    const a = resolveLtEnd(startRef);
    const b = resolveLtEnd(endRef);
    if (!a || !b || !validLtPair(a, b)) return [];
    const depth = readRouteDepthIn(depthIn, 18);
    const startRiser = buildRiserVerts(startRef, endRef, size, depth, 'start', true);
    const endRiser = buildRiserVerts(endRef, startRef, size, depth, 'end', true);
    const mid = buildGroundSpan(startRiser[startRiser.length - 1], endRiser[0], depth);
    return dedupeLtVerts(startRiser.concat(mid).concat(endRiser));
  }

  function nearSameStack(a, b) {
    const pa = a.type === 'switch' ? a.post : (a.type === 'ap' ? a.ap : null);
    const pb = b.type === 'switch' ? b.post : (b.type === 'ap' ? b.ap : null);
    if (!pa || !pb) return false;
    if (a.type === 'ap' && a.ap.mount === 'mast') {
      const m = masts.find((x) => x.id === a.ap.mountId);
      if (m && b.type === 'switch' && m.mount === 'post' && m.mountId === b.post.id) return true;
      if (m && b.type === 'ap' && b.ap.mount === 'mast' && b.ap.mountId === m.id) return true;
    }
    if (b.type === 'ap' && b.ap.mount === 'mast') {
      const m = masts.find((x) => x.id === b.ap.mountId);
      if (m && a.type === 'switch' && m.mount === 'post' && m.mountId === a.post.id) return true;
    }
    if (a.type === 'ap' && a.ap.mount === 'post' && b.type === 'switch' && a.ap.mountId === b.post.id) return true;
    if (b.type === 'ap' && b.ap.mount === 'post' && a.type === 'switch' && b.ap.mountId === a.post.id) return true;
    const dx = (pa.x || 0) - (pb.x || 0);
    const dy = (pa.y || 0) - (pb.y || 0);
    return Math.hypot(dx, dy) < 0.35;
  }

  function switchStyleForRun(run) {
    const a = resolveLtEnd(run.start);
    const b = resolveLtEnd(run.end);
    const sw = (a && a.type === 'switch') ? a : (b && b.type === 'switch') ? b : null;
    if (!sw) return null;
    return switchAttach(sw.post, ltRadiusOf(run.size));
  }

  function sampleAlong(pts, spacing) {
    const out = [];
    if (!pts || pts.length < 2) return out;
    let acc = 0;
    let next = spacing;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const d = a.distanceTo(b);
      if (d < 1e-6) continue;
      const dir = b.clone().sub(a).normalize();
      while (acc + d >= next) {
        const t = (next - acc) / d;
        const p = a.clone().lerp(b, t);
        out.push({ p, dir: dir.clone() });
        next += spacing;
      }
      acc += d;
    }
    return out;
  }

  function addLtBands(group, pts, size, runId) {
    const half = normalizeLtSize(size) === '1/2';
    const r = ltRadiusOf(size);
    const spacing = half ? 0.26 : 0.58;
    const bandH = half ? Math.max(0.011, r * 0.5) : Math.max(0.02, r * 0.95);
    const bandR = r * 1.32;
    const mat = new THREE.MeshBasicMaterial({ color: 0x1a1d22 });
    const samples = sampleAlong(pts, spacing);
    const up = new THREE.Vector3(0, 1, 0);
    for (const { p, dir } of samples) {
      if (dir.lengthSq() < 1e-8) continue;
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(bandR, bandR, bandH, 10), mat);
      mesh.position.copy(p);
      mesh.quaternion.setFromUnitVectors(up, dir.clone().normalize());
      mesh.userData.ltId = runId;
      mesh.userData.ltBand = true;
      mesh.userData.ltSize = normalizeLtSize(size);
      group.add(mesh);
    }
  }

  function midpointOf(pts) {
    if (!pts.length) return null;
    let total = 0;
    for (let i = 1; i < pts.length; i++) total += pts[i].distanceTo(pts[i - 1]);
    if (total < 1e-6) return pts[0].clone();
    let acc = 0, half = total / 2;
    for (let i = 1; i < pts.length; i++) {
      const d = pts[i].distanceTo(pts[i - 1]);
      if (acc + d >= half) return pts[i - 1].clone().lerp(pts[i], (half - acc) / d);
      acc += d;
    }
    return pts[pts.length - 1].clone();
  }

  function payloadLt(run, pts) {
    const world = pts || buildLtWorldPoints(run);
    const len = lengthOf(world);
    const a = resolveLtEnd(run.start);
    const b = resolveLtEnd(run.end);
    const att = switchStyleForRun(run);
    const cables = Array.isArray(run.cables) ? run.cables.map((c) => ({
      id: c.id, kind: c.kind || 'other', label: c.label || 'Cable',
    })) : [];
    return {
      id: run.id,
      name: run.name,
      kind: 'lt-run',
      size: normalizeLtSize(run.size),
      sizeLabel: ltSizeLabel(run.size),
      start: run.start, end: run.end,
      startLabel: a ? a.label : (run.start && run.start.id),
      endLabel: b ? b.label : (run.end && run.end.id),
      bends: (run.bends || []).map((p) => ({ x: p.x, y: p.y, z: p.z, depthIn: depthInOfVert(p) })),
      verts: (run.verts || []).map((p) => ({ x: p.x, y: p.y, z: p.z, depthIn: depthInOfVert(p), auto: isLtAutoVert(p) })),
      routeDepthIn: run.routeDepthIn != null ? run.routeDepthIn : 18,
      autoRoute: !!run.autoRoute,
      cables,
      cableCount: cables.length,
      entryStyle: att ? att.style : null,
      entryLabel: att ? att.styleLabel : null,
      entry: att && att.entry ? { x: att.entry.x, y: att.entry.y, z: att.entry.z } : null,
      entryHeightM: att ? att.entryHeightM : null,
      length_m: len,
      length_ft: Number(fmtFt(len)),
      valid: !!(a && b && validLtPair(a, b)),
    };
  }

  function inspectLtRun(id) {
    const run = ltRuns.find((r) => r.id === id || (id && id.id === r.id));
    if (!run) return null;
    const pts = buildLtWorldPoints(run);
    const info = payloadLt(run, pts);
    info.pointCount = pts.length;
    info.first = pts[0] ? { x: pts[0].x, y: pts[0].y, z: pts[0].z } : null;
    info.last = pts.length ? { x: pts[pts.length - 1].x, y: pts[pts.length - 1].y, z: pts[pts.length - 1].z } : null;
    info.radius = ltRadiusOf(run.size);
    info.bandSpacing = normalizeLtSize(run.size) === '1/2' ? 0.26 : 0.58;
    let tubes = 0, bands = 0;
    ltAgGroup.traverse((o) => {
      if (o.userData && o.userData.ltId === run.id) {
        if (o.userData.ltBand) bands++;
        else if (o.geometry && o.geometry.type === 'TubeGeometry') tubes++;
      }
    });
    info.tubes = tubes;
    info.bands = bands;
    const vs = run.verts || [];
    info.autoCount = vs.filter(isLtAutoVert).length;
    info.groundCount = vs.length - info.autoCount;
    info.groundIndexes = vs.map((v, i) => (isLtAutoVert(v) ? -1 : i)).filter((i) => i >= 0);
    info.autoIndexes = vs.map((v, i) => (isLtAutoVert(v) ? i : -1)).filter((i) => i >= 0);
    return info;
  }

  function rebuildLtAg() {
    ltAgGroup.clear();
    const draftPts = ltDraft && ltDraft.start ? draftLtPoints() : null;
    if (draftPts && draftPts.length >= 2) {
      addLtVisual(null, draftPts, ltDraft.size || pendingLtSize, true);
    }
    for (const run of ltRuns) {
      if (resolveLtEnd(run.start) && resolveLtEnd(run.end)) {
        const pts = buildLtWorldPoints(run);
        if (pts.length >= 2) addLtVisual(run, pts, run.size, false);
      }
    }
    syncLabels();
    renderLtList();
    if (selectedLt) fillLtPanel(selectedLt);
  }

  function addLtVisual(run, pts, size, isDraft) {
    const id = run ? run.id : 'draft';
    const r = ltRadiusOf(size);
    const color = ltColorOf(size);
    const solid = tubeFromPoints(pts, r, color, { xray: false, renderOrder: 24 });
    const ghost = tubeFromPoints(pts, r, color, { xray: true, renderOrder: 26 });
    if (solid) {
      solid.userData.ignorePick = !!isDraft;
      solid.userData.ltId = id;
      solid.userData.ltRun = true;
      solid.material.opacity = isDraft ? 0.55 : 0.98;
      if (selectedLt && run && selectedLt.id === run.id) {
        solid.material.color.setHex(0xd8c25a);
      }
      ltAgGroup.add(solid);
    }
    if (ghost) {
      ghost.userData.ltId = id;
      ghost.userData.ignorePick = true;
      ltAgGroup.add(ghost);
    }
    if (!isDraft) addLtBands(ltAgGroup, pts, size, id);
  }

  function draftLtPoints() {
    if (!ltDraft || !ltDraft.start) return [];
    const start = resolveLtEnd(ltDraft.start);
    if (!start) return [];
    const radius = ltRadiusOf(ltDraft.size || pendingLtSize);
    const lastToward = (ltDraft.bends && ltDraft.bends.length)
      ? ltDraft.bends[ltDraft.bends.length - 1]
      : towardUtmOf(start);
    const att = attachFor(start, radius, lastToward);
    const pts = [];
    if (start.type === 'vb') pushUnique(pts, att.entry);
    else {
      const into = approachInto(att, true);
      for (let i = into.length - 1; i >= 0; i--) pushUnique(pts, into[i]);
    }
    for (const b of (ltDraft.bends || [])) pushUnique(pts, bendWorld(b), 0.02);
    return pts;
  }

  function showLtSizeRow(on) {
    const row = $('ltSizeRow');
    if (row) row.hidden = !on;
    const sel = $('placeLtSize');
    if (sel && on) sel.value = pendingLtSize || '1';
  }
  function showLtRouteDepthRow(on) {
    const row = $('ltRouteDepthRow');
    if (row) row.hidden = !on;
    const inp = $('placeLtRouteDepth');
    if (inp && on) inp.value = String(pendingRouteDepthIn);
  }

  function enterDrawLtMode() { return null; }

  function leaveDrawLtMode() {
    if (ltMode !== 'draw' && ltMode !== 'auto' && !ltDraft) return;
    ltMode = 'idle';
    ltDraft = null;
    showLtSizeRow(false);
    showLtRouteDepthRow(false);
    $('drawLtBtn')?.classList.remove('on');
    $('autoRouteBtn')?.classList.remove('on');
    const bar = $('drawBar');
    if (bar && postMode !== 'place' && apMode !== 'place' && mastMode !== 'place' && switchMode !== 'place') {
      bar.classList.remove('show', 'mode-lt', 'mode-draw', 'mode-place', 'mode-edit');
    } else if (bar) {
      bar.classList.remove('mode-lt');
    }
    rebuildLtAg();
  }

  function enterAutoRouteMode() { return null; }

  function onAutoRouteTap() { return null; }

  function undoLtDraft() { return null; }

  function pickLtEndpoint(ev) {
    const ap = pickAp(ev);
    if (ap) return { type: 'ap', id: ap.id, label: ap.name || 'AP', ap };
    const post = pickPost(ev);
    if (post) {
      if (post.hasSwitch) return { type: 'switch', id: post.id, label: post.name || 'Switch', post };
      return { type: 'bare-post', id: post.id, label: post.name || 'Post', post };
    }
    const mast = pickMast(ev);
    if (mast) return { type: 'mast', id: mast.id, label: mast.name || 'Mast', mast };
    const vb = pickVB(ev);
    if (vb) return { type: 'vb', id: vb.id, label: vb.id, node: vb };
    return null;
  }

  function onLtDrawTap() { return null; }

  function commitLtDraft() { return null; }

  function placeLtRun() { return null; }

  function autoRouteLt() { return null; }

  function setLtRouteDepth() { return null; }

  function setLtVertDepthIn() { return null; }

  function moveLtVert() { return null; }

  function insertLtVert() { return null; }

  function setLtSize() { return null; }

  function addLtCable() { return null; }

  function removeLtCable() { return null; }

  function deleteLtRun() { return null; }

  function pruneLtRuns() {
    const before = ltRuns.length;
    ltRuns = ltRuns.filter((r) => {
      const a = resolveLtEnd(r.start);
      const b = resolveLtEnd(r.end);
      return a && b && validLtPair(a, b);
    });
    if (selectedLt && !ltRuns.some((r) => r.id === selectedLt.id)) selectLt(null);
    if (ltRuns.length !== before) {
      rebuildLtAg();
      return true;
    }
    return false;
  }

  function clearLtRuns() {
    ltRuns = [];
    selectLt(null);
    ltDraft = null;
    rebuildLtAg();
    requestSave();
  }

  function getLtRuns() { return ltRuns.map((r) => payloadLt(r)); }
  function getLtRunsForSave() {
    return ltRuns.map((r) => ({
      id: r.id, name: r.name, kind: 'lt-run',
      size: normalizeLtSize(r.size),
      start: { type: r.start.type, id: r.start.id },
      end: { type: r.end.type, id: r.end.id },
      bends: (r.bends || []).map((p) => ({ x: p.x, y: p.y, z: p.z, depthIn: depthInOfVert(p) })),
      verts: (r.verts || []).map((p) => ({ x: p.x, y: p.y, z: p.z, depthIn: depthInOfVert(p), auto: isLtAutoVert(p) })),
      routeDepthIn: r.routeDepthIn != null ? r.routeDepthIn : 18,
      autoRoute: !!r.autoRoute,
      cables: (r.cables || []).map((c) => ({ id: c.id, kind: c.kind || 'other', label: c.label || 'Cable' })),
    }));
  }

  function loadLtRunsFromList(list) {
    ltRuns = (list || []).filter((r) => r && r.start && r.end).map((r) => ({
      id: r.id || uuid(),
      name: r.name || 'LT',
      kind: 'lt-run',
      size: normalizeLtSize(r.size),
      start: { type: r.start.type || r.start_type, id: r.start.id || r.start_id },
      end: { type: r.end.type || r.end_type, id: r.end.id || r.end_id },
      bends: Array.isArray(r.bends) ? r.bends.map((p) => ({ x: p.x, y: p.y, z: p.z, depthIn: depthInOfVert(p) })) : [],
      verts: Array.isArray(r.verts) ? r.verts.map((p) => ({ x: p.x, y: p.y, z: p.z, depthIn: depthInOfVert(p), auto: !!(p.auto || p.locked) })) : null,
      routeDepthIn: r.routeDepthIn != null ? readRouteDepthIn(r.routeDepthIn, 18) : 18,
      autoRoute: !!r.autoRoute,
      cables: Array.isArray(r.cables) ? r.cables.map((c) => ({
        id: c.id || uuid(), kind: c.kind || 'other', label: c.label || 'Cable',
      })) : [],
    }));
    for (const run of ltRuns) {
      if (!run.verts || run.verts.length < 2) bakeRunVerts(run);
      else ensureRiserFlags(run);
    }
  }

  function selectLt(run) {
    if(!run)return;const info=payloadLt(run);
    showReadOnlyInfo(run.name,[['Size',info.sizeLabel+' liquid-tight'],['Start',info.startLabel],['End',info.endLabel],
      ['3D length',info.length_ft+' ft'],['Cables',info.cableCount?info.cables.map(c=>c.label+' ('+c.kind+')').join(', '):'0 — no cables recorded'],
      ['Entry',info.entryLabel||info.entryStyle||'—'],['Risers','Locked; all points are view-only'],['Route depth',info.routeDepthIn+' in (individual heights preserved)']]);
  }

  function cableQuickPicks(run) {
    const a = resolveLtEnd(run.start);
    const b = resolveLtEnd(run.end);
    const names = [];
    const out = [];
    function add(kind, label) {
      if (!label || names.indexOf(label) >= 0) return;
      names.push(label);
      out.push({ kind, label });
    }
    add('ethernet', a ? ('Ethernet to ' + a.label) : 'Ethernet');
    add('ethernet', b ? ('Ethernet to ' + b.label) : null);
    add('poe', a ? ('PoE to ' + a.label) : 'PoE');
    add('poe', b ? ('PoE to ' + b.label) : null);
    add('power', 'Power cord');
    add('fiber', 'Fiber');
    add('other', 'Spare');
    return out;
  }


  function rerouteLtForPost(post) {
    if (!post) return;
    for (const run of ltRuns) {
      if (!runTouchesId(run, post.id)) continue;
      if (!run.verts || run.verts.length < 2) bakeRunVerts(run);
      else {
        ensureRiserFlags(run);
        regenerateLtRisers(run);
      }
    }
  }

  function projectLtWorld(w) {
    const v = w.clone().project(camera);
    const canvas = renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    return {
      x: rect.left + (v.x + 1) / 2 * rect.width,
      y: rect.top + (1 - v.y) / 2 * rect.height,
      visible: Math.abs(v.x) <= 1.2 && Math.abs(v.y) <= 1.2 && v.z >= -1 && v.z <= 1,
    };
  }

  function depthInFromPointer(ev, vert) {
    const zg = sampleDTM(vert.x, vert.y) ?? vert.z ?? 0;
    const w = worldAt(vert.x, vert.y, zg);
    const toCam = new THREE.Vector3(camera.position.x - w.x, 0, camera.position.z - w.z);
    if (toCam.lengthSq() < 1e-8) toCam.set(0, 0, 1);
    toCam.normalize();
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(toCam, w);
    const hit = new THREE.Vector3();
    if (!ray.ray.intersectPlane(plane, hit)) return null;
    return (zg - hit.y) / IN;
  }

  function startLtDrag() { return null; }

  function syncLtHandles() { return null; }

  function fillLtPanel(run) {
    const live = ltRuns.find((r) => r.id === run.id) || run;
    const info = payloadLt(live);
    if ($('ltPanelTitle')) $('ltPanelTitle').textContent = live.name || 'Liquid-tight';
    if ($('ltLength')) $('ltLength').textContent = info.length_ft + ' ft  3D';
    const box = $('ltInfo');
    if (box) {
      const badge = info.cableCount > 1 ? (' · x' + info.cableCount + ' cables') : (info.cableCount === 1 ? ' · 1 cable' : ' · no cables yet');
      box.innerHTML = '<div><b>' + (info.startLabel || '?') + '</b> → <b>' + (info.endLabel || '?') + '</b></div>'
        + '<div>' + info.sizeLabel + ' liquid-tight' + badge + (live.autoRoute ? ' · auto-routed' : '') + '</div>';
    }
    const rd = $('ltRouteDepth');
    if (rd) rd.value = String(info.routeDepthIn != null ? info.routeDepthIn : 18);
    const sel = $('ltSizeSelect');
    if (sel) sel.value = info.size;
    if ($('ltEntryNote')) $('ltEntryNote').textContent = info.entryLabel || '';
    const pick = $('ltCablePick');
    if (pick) {
      const opts = cableQuickPicks(live);
      pick.innerHTML = opts.map((o) => '<option value="' + o.label.replace(/"/g, '&quot;') + '" data-kind="' + o.kind + '">' + o.label + '</option>').join('');
    }
    const ul = $('ltCableList');
    if (ul) {
      ul.innerHTML = '';
      if (!info.cables.length) {
        ul.innerHTML = '<li style="display:block;opacity:.75;border:0">No cables listed yet.</li>';
      } else {
        for (const c of info.cables) {
          const li = document.createElement('li');
          const sp = document.createElement('span');
          sp.textContent = c.label + (c.kind && c.kind !== 'other' ? ' (' + c.kind + ')' : '');
          const rm = document.createElement('button');
          rm.type = 'button';
          rm.textContent = 'Remove';
          rm.addEventListener('click', () => removeLtCable(live.id, c.id));
          li.append(sp, rm);
          ul.append(li);
        }
      }
    }
    if ($('ltCableHint')) {
      $('ltCableHint').textContent = info.cableCount > 1
        ? ('This run carries ' + info.cableCount + ' cables — badge x' + info.cableCount + ' is on the tube and in the list.')
        : 'When a run carries more than one cable, a count badge such as x2 is shown on the tube and in this panel.';
    }
    const bl = $('ltBendList');
    if (bl) {
      bl.innerHTML = '';
      const verts = live.verts || [];
      const editable = [];
      verts.forEach((v, i) => { if (!isLtAutoVert(v)) editable.push([i, v]); });
      if (!editable.length) {
        bl.innerHTML = '<li style="display:block;opacity:.75;border:0">No editable ground points. Vertical risers along posts and masts are locked and update automatically.</li>';
      } else {
        editable.forEach((pair, n) => {
          const i = pair[0], v = pair[1];
          const li = document.createElement('li');
          if (i === selectedLtVert) li.className = 'sel';
          const lab = document.createElement('label');
          lab.textContent = 'Pt ' + (n + 1);
          const inp = document.createElement('input');
          inp.type = 'number';
          inp.step = '1';
          inp.min = '-240';
          inp.max = '240';
          inp.inputMode = 'decimal';
          inp.value = String(Number(depthInOfVert(v).toFixed(1)));
          inp.setAttribute('aria-label', 'Depth in inches for ground point ' + (n + 1) + ' (0 is grade, positive below)');
          inp.addEventListener('change', () => {
            selectedLtVert = i;
            setLtVertDepthIn(live, i, inp.value);
          });
          inp.addEventListener('focus', () => { selectedLtVert = i; syncLtHandles(); });
          const go = document.createElement('button');
          go.type = 'button';
          go.textContent = 'Select';
          go.addEventListener('click', () => { selectedLtVert = i; fillLtPanel(live); syncLtHandles(); });
          li.append(lab, inp, go);
          bl.append(li);
        });
      }
    }
    syncLtHandles();
  }

  function renderLtList() { readOnlyList('ltList',ltRuns,selectLt,r=>{const p=payloadLt(r);return p.sizeLabel+' · '+p.length_ft+' ft · '+p.cableCount+' cables';}); }

  function pickLtRun(ev) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObject(ltAgGroup, true);
    for (const h of hits) {
      let o = h.object;
      while (o) {
        if (o.userData && o.userData.ltId && o.userData.ltId !== 'draft') {
          return ltRuns.find((r) => r.id === o.userData.ltId) || null;
        }
        o = o.parent;
      }
    }
    return null;
  }

  function exportLtFeatures() {
    return ltRuns.map((run) => {
      const pts = buildLtWorldPoints(run);
      const info = payloadLt(run, pts);
      return {
        type: 'Feature',
        properties: {
          kind: 'lt-run',
          id: run.id,
          name: run.name,
          size: info.size,
          start_type: run.start && run.start.type,
          start_id: run.start && run.start.id,
          end_type: run.end && run.end.type,
          end_id: run.end && run.end.id,
          bends: info.bends,
          verts: info.verts,
          routeDepthIn: info.routeDepthIn,
          autoRoute: info.autoRoute,
          cables: info.cables,
          cable_count: info.cableCount,
          entry_style: info.entryStyle,
          length_ft: info.length_ft,
          length_m: info.length_m,
        },
        geometry: {
          type: 'LineString',
          coordinates: pts.map((p) => {
            const u = worldToUtm(p);
            return [u.x, u.y, u.z];
          }),
        },
      };
    });
  }

  function importLtFeature(f) {
    const props = (f && f.properties) || {};
    if (props.kind !== 'lt-run') return false;
    const start = {
      type: props.start_type || (props.start && props.start.type),
      id: props.start_id || (props.start && props.start.id),
    };
    const end = {
      type: props.end_type || (props.end && props.end.type),
      id: props.end_id || (props.end && props.end.id),
    };
    if (!start.type || !start.id || !end.type || !end.id) return false;
    ltRuns.push({
      id: props.id || uuid(),
      name: props.name || 'LT',
      kind: 'lt-run',
      size: normalizeLtSize(props.size),
      start, end,
      bends: Array.isArray(props.bends) ? props.bends.map((p) => ({ x: p.x, y: p.y, z: p.z, depthIn: depthInOfVert(p) })) : [],
      verts: Array.isArray(props.verts) ? props.verts.map((p) => ({ x: p.x, y: p.y, z: p.z, depthIn: depthInOfVert(p), auto: !!(p.auto || p.locked) })) : null,
      routeDepthIn: props.routeDepthIn != null ? readRouteDepthIn(props.routeDepthIn, 18) : 18,
      autoRoute: !!props.autoRoute,
      cables: Array.isArray(props.cables) ? props.cables.map((c) => ({
        id: c.id || uuid(), kind: c.kind || 'other', label: c.label || 'Cable',
      })) : [],
    });
    const last = ltRuns[ltRuns.length - 1];
    if (last && (!last.verts || last.verts.length < 2)) bakeRunVerts(last);
    else if (last) ensureRiserFlags(last);
    return true;
  }

  function appendLtLabels(place,seen) {
    if(!ltAgGroup.visible)return;
    for(const run of ltRuns){const pts=buildLtWorldPoints(run),mid=midpointOf(pts);if(!mid)continue;
      const el=publicLabel('lt',run.id,seen),p=payloadLt(run);el.className='site-label lt';el.dataset.id=run.id;
      el.replaceChildren(document.createTextNode(p.sizeLabel+' LT · '+p.length_ft+' ft'));
      if(p.cableCount>1){const b=document.createElement('span');b.className='badge';b.textContent=' ×'+p.cableCount;el.append(b);}
      el.title=run.name+' · '+p.cableCount+' cables';place(el,mid,0.08);
    }
  }

  loadFlexProFrontTexture();
  return Object.freeze({
    onPathsChanged:rebuildAll,importFeatures,
    openValveBox(id){return openVb(nodes.find(n=>n.id===id));},
    getSummary(){return JSON.parse(JSON.stringify({posts:posts.map(payloadPost),masts:masts.map(payloadMast),aps:aps.map(payloadAp),
      ltRuns:ltRuns.map(r=>payloadLt(r)),valveBoxes:nodes.map(n=>({id:n.id,x:n.x,y:n.y,z:n.z,meets:pathsMeetLabel(n)}))}));}
  });
}
