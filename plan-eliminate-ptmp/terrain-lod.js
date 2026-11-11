import * as THREE from './libs/three/three.module.js';
// Bounded, on-demand detail. The base terrain never leaves memory; only a few original
// source tiles are promoted, and replaced tiles are disposed before new ones load.
export async function initTerrainLOD({modelRoot, camera, controls, renderer}) {
  const touch = navigator.maxTouchPoints > 0 || matchMedia('(pointer: coarse)').matches || /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  const tablet = touch && Math.min(screen.width || innerWidth, screen.height || innerHeight) >= 600;
  const lowMemory = navigator.deviceMemory && navigator.deviceMemory <= 2;
  const slots = lowMemory ? 1 : touch ? (tablet ? 4 : 2) : 6;
  const deviceClass = lowMemory ? 'low-memory' : touch ? (tablet ? 'tablet' : 'phone') : 'desktop';
  const maxSize = Math.min(2048, renderer.capabilities.maxTextureSize);
  const metadata = await fetch('mesh/lod/manifest.json').then(r => {if (!r.ok) throw Error('detail manifest unavailable'); return r.json();});
  const byName = new Map(metadata.map(x => [x.material, x]));
  const entries = new Map(), active = new Map(), failures = new Set();
  let wanted = [], busy = false, timer = null, disposed = false;
  modelRoot.updateMatrixWorld(true);
  modelRoot.traverse(mesh => {
    if (!mesh.isMesh || !mesh.material) return;
    for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const data = byName.get(m.name); if (!data || !m.map) continue;
      let e = entries.get(m.name);
      if (!e) {e = {data, base: m.map, mats: new Set(), box: new THREE.Box3()}; entries.set(m.name, e);}
      e.mats.add(m); e.box.union(new THREE.Box3().setFromObject(mesh));
    }
  });
  function state() {
    return {deviceClass, slots, maxSize, busy, active: [...active].map(([name,t]) => ({name,width:t.image.width,height:t.image.height})), wanted: [...wanted], failures: [...failures], baseTerrainMiB: 74.7,
      worstCaseDetailMiB: +(slots * maxSize * maxSize * 4 * 4/3 / 1048576).toFixed(1)};
  }
  window.__terrainLOD = Object.freeze({getState:state, refresh:choose});
  function drop(name) {
    const tex = active.get(name); if (!tex) return;
    const e = entries.get(name); for (const m of e.mats) {m.map = e.base; m.needsUpdate = true;}
    active.delete(name); tex.dispose();
    if (tex.image && typeof tex.image.close === 'function') tex.image.close();
    tex.image = null;
  }
  async function pump() {
    if (busy || disposed) return; busy = true;
    try {
      for (;;) {
        for (const name of active.keys()) if (!wanted.includes(name)) drop(name);
        const name = wanted.find(n => !active.has(n) && !failures.has(n));
        if (!name) break;
        // Serial decoding plus pre-eviction keeps active+in-flight textures within slots.
        if (active.size >= slots) drop([...active.keys()][0]);
        const e = entries.get(name);
        let tex;
        try {tex = await new THREE.TextureLoader().loadAsync(e.data.url);}
        catch (_) {failures.add(name); continue;}
        if (!wanted.includes(name) || disposed) {tex.dispose(); tex.image = null; continue;}
        const image = tex.image;
        if (Math.max(image.width,image.height) > maxSize) {
          const scale=maxSize/Math.max(image.width,image.height),c=document.createElement('canvas');
          c.width=Math.floor(image.width*scale);c.height=Math.floor(image.height*scale);c.getContext('2d').drawImage(image,0,0,c.width,c.height);tex.image=c;
        }
        tex.flipY=e.base.flipY;tex.colorSpace=e.base.colorSpace;tex.wrapS=e.base.wrapS;tex.wrapT=e.base.wrapT;
        tex.magFilter=e.base.magFilter;tex.minFilter=e.base.minFilter;tex.anisotropy=Math.min(4,renderer.capabilities.getMaxAnisotropy());tex.needsUpdate=true;
        active.set(name,tex);for(const m of e.mats){m.map=tex;m.needsUpdate=true;}
      }
    } finally {busy=false;}
  }
  function choose() {
    if (disposed) return;
    if (camera.position.distanceTo(controls.target) > 45) {wanted=[];pump();return;}
    const preferred=[],ray=new THREE.Raycaster();
    // Give visible tiles priority, with the view center first, then nearest-to-target tiles.
    for (const [x,y] of [[0,0],[-.45,-.35],[.45,-.35],[-.45,.35],[.45,.35]]) {
      ray.setFromCamera(new THREE.Vector2(x,y),camera);
      const hit=ray.intersectObject(modelRoot,true)[0];
      if(hit){const m=Array.isArray(hit.object.material)?hit.object.material[hit.face.materialIndex]:hit.object.material;
        if(m&&entries.has(m.name)&&!preferred.includes(m.name))preferred.push(m.name);}
    }
    for(const [name] of [...entries].sort((a,b)=>a[1].box.distanceToPoint(controls.target)-b[1].box.distanceToPoint(controls.target)))if(!preferred.includes(name))preferred.push(name);
    wanted=preferred.slice(0,slots);pump();
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(choose,550);}
  controls.addEventListener('change',schedule);
  controls.addEventListener('end',schedule);
  renderer.domElement.addEventListener('webglcontextrestored',schedule);
  addEventListener('pagehide',()=>{disposed=true;clearTimeout(timer);for(const name of [...active.keys()])drop(name);});
  addEventListener('pageshow',e=>{if(e.persisted){disposed=false;schedule();}});
  choose();
  return window.__terrainLOD;
}
