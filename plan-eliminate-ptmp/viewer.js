import * as THREE from './libs/three/three.module.js';
import { OrbitControls } from './libs/three/addons/controls/OrbitControls.js';
import { GLTFLoader } from './libs/three/addons/loaders/GLTFLoader.js';
import { initTerrainLOD } from './terrain-lod.js?v=public-20261111-xb3';
import { initPathTool } from './path-tool.js?v=public-20261111-xb3';

const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const touchDevice = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
const MODELS = { mobile: 'mesh/flight_mobile.glb', '1k': 'mesh/flight_1k.glb', '2k': 'mesh/flight_2k.glb' };
// All phones/tablets stay on a bounded-memory terrain, including old bookmarked ?q=2k URLs.
const quality = touchDevice ? 'mobile' : (MODELS[params.get('q')] ? params.get('q') : 'mobile');
document.querySelectorAll('#quality a').forEach(a => {
  a.classList.toggle('on', a.dataset.q === quality);
  if (a.dataset.q === quality) a.setAttribute('aria-current', 'true');
});
if (touchDevice) $('quality').hidden = true;
function showError(text, retry) {
  const el = $('error'); el.replaceChildren();
  const p = document.createElement('p'); p.textContent = text; el.appendChild(p);
  if (retry) { const b = document.createElement('button'); b.textContent = 'Reload lighter view'; b.onclick = () => { location.href = location.pathname; }; el.appendChild(b); }
  el.style.display = 'block'; $('loading').style.display = 'none';
}

async function start() {
  const canvas = document.createElement('canvas');
  let context;
  try { context = canvas.getContext('webgl2', { antialias: !touchDevice, powerPreference: 'low-power', preserveDrawingBuffer: params.has('shot') || params.has('test') }); } catch (_) {}
  if (!context) {
    showError('3D is not available. This view needs WebGL 2. Enable hardware acceleration, update your browser, or try another device.', false);
    window.__viewerUnavailable = true; return;
  }
  let renderer;
  try { renderer = new THREE.WebGLRenderer({canvas, context, antialias: !touchDevice, powerPreference: 'low-power'}); }
  catch (_) { showError('The 3D view could not start. Please try another browser or device.', true); return; }
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  canvas.setAttribute('aria-label', 'Interactive 3D map. One finger orbits; two fingers zoom and pan. Use Layers and items for item details.');
  document.body.appendChild(canvas);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0x1d2b33);
  const camera = new THREE.PerspectiveCamera(50, 1, 1, 20000);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true; controls.dampingFactor = 0.1;
  controls.screenSpacePanning = false; controls.maxPolarAngle = Math.PI * 0.98;
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
  let savedView = null, modelRoot = null, lost = false, lastFrame = 0;
  function resize() {
    const w = document.documentElement.clientWidth, h = innerHeight;
    // 2x maximum, with a 4-megapixel drawing-buffer ceiling on high-DPI tablets.
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2, Math.sqrt(4000000 / (w * h))));
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  resize(); addEventListener('resize', resize);
  if (window.visualViewport) visualViewport.addEventListener('resize', resize);
  addEventListener('orientationchange', () => requestAnimationFrame(resize));
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault(); lost = true; controls.enabled = false;
    showError('The 3D view paused because graphics memory was unavailable. Waiting for the browser to restore it. You can also reload the lighter view.', true);
  });
  canvas.addEventListener('webglcontextrestored', () => {
    lost = false; controls.enabled = true; $('error').style.display = 'none'; resize();
    window.__contextRestored = (window.__contextRestored || 0) + 1;
  });
  $('reset').onclick = () => { if (!savedView) return; const damping=controls.enableDamping; controls.enableDamping=false; controls.update(); camera.position.copy(savedView.p); controls.target.copy(savedView.t); controls.update(); controls.enableDamping=damping; };
  renderer.setAnimationLoop(time => {
    if (lost || document.hidden || time - lastFrame < 30) return;
    lastFrame = time;
    if (typeof window.__tickSite === 'function') window.__tickSite();
    if (!window.__holdControls) controls.update(); else camera.lookAt(controls.target);
    renderer.render(scene, camera);
  });
  const loader = new GLTFLoader();
  if (quality !== 'mobile') { const {MeshoptDecoder} = await import('./libs/three/addons/libs/meshopt_decoder.module.js'); loader.setMeshoptDecoder(MeshoptDecoder); }
  try {
    const gltf = await loader.loadAsync(MODELS[quality], ev => {
      const mb = (ev.loaded / 1048576).toFixed(1);
      $('pct').textContent = ev.total && ev.loaded >= ev.total ? 'Preparing terrain…' : 'Downloading terrain… ' + mb + ' MB';
      if (ev.total) $('bar').style.width = (ev.loaded / ev.total * 100).toFixed(0) + '%';
    });
    modelRoot = gltf.scene;
    // Defense in depth if future terrain assets arrive larger than iOS-safe limits.
    const maxSize = Math.min(4096, renderer.capabilities.maxTextureSize);
    modelRoot.traverse(o => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => { if (!m || !m.map || !m.map.image) return; const image = m.map.image;
        if (Math.max(image.width, image.height) <= maxSize) return;
        const scale = maxSize / Math.max(image.width, image.height), c = document.createElement('canvas');
        c.width = Math.max(1, Math.floor(image.width * scale)); c.height = Math.max(1, Math.floor(image.height * scale));
        c.getContext('2d').drawImage(image, 0, 0, c.width, c.height); m.map.image = c; m.map.needsUpdate = true;
      });
    });
    scene.add(modelRoot);
    const box = new THREE.Box3().setFromObject(modelRoot), center = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.z, 1); controls.target.copy(center);
    camera.position.set(center.x + span * .35, center.y + span * .75, center.z + span * .75);
    controls.maxDistance = span * 4; controls.minDistance = 5; camera.far = span * 10; camera.updateProjectionMatrix(); controls.update();
    window.__three = { scene, camera, controls, renderer, model: modelRoot };
    await initPathTool({scene, camera, renderer, controls, modelRoot});
    if (quality === 'mobile') await initTerrainLOD({modelRoot,camera,controls,renderer});
    savedView = {p: camera.position.clone(), t: controls.target.clone()};
    $('loading').style.display = 'none'; window.__loaded = true;
    window.__viewerQuality = quality;
  } catch (_) { showError('The terrain or layout could not load. Check your connection and try again.', true); }
}
start().catch(() => showError('The 3D view could not start. Please reload or try another browser.', true));
