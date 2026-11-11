import * as THREE from './libs/three/three.module.js';
import { initSiteWorks } from './site-works.js?v=public-20261111-xb3';
import { layout } from './layout.js?v=public-20261111-xb3';
const FT=3.280839895, DEPTH=0.4572;
export async function initPathTool(ctx) {
  const {scene,camera,renderer,controls,modelRoot}=ctx;
  const hm=await loadHeightmap(); if(!hm)throw Error('Ground elevation model unavailable');
  const utmToWorld=(u,v,z)=>new THREE.Vector3(u-hm.offX,z,-(v-hm.offY));
  const worldToUtm=w=>({x:w.x+hm.offX,y:-w.z+hm.offY,z:w.y});
  const sampleDTM=(u,v)=>hm.sample(u,v);
  const pathGroup=new THREE.Group();pathGroup.name='path-layers';scene.add(pathGroup);
  const paths=layout.features.filter(f=>f.geometry.type==='LineString'&&!f.properties.kind).map(f=>{
    const p=f.properties, points=f.geometry.coordinates.map(c=>({x:c[0],y:c[1],z:sampleDTM(c[0],c[1])??c[2]}));
    const profile=[];
    for(let i=1;i<points.length;i++) {
      const a=points[i-1],b=points[i],n=Math.max(1,Math.ceil(Math.hypot(b.x-a.x,b.y-a.y)/0.25));
      for(let k=i===1?0:1;k<=n;k++){const t=k/n,x=a.x+(b.x-a.x)*t,y=a.y+(b.y-a.y)*t;
        profile.push({x,y,z:sampleDTM(x,y)??(a.z+(b.z-a.z)*t)});}
    }
    // Display offset only: original coordinates and saved length values never change.
    const world=profile.map(q=>utmToWorld(q.x,q.y,q.z-DEPTH));
    const positions=[],indices=[];
    for(let i=0;i<world.length;i++) {
      const before=world[Math.max(0,i-1)],after=world[Math.min(world.length-1,i+1)];
      const dir=new THREE.Vector3().subVectors(after,before);dir.y=0;dir.normalize();
      const side=new THREE.Vector3(-dir.z,0,dir.x).multiplyScalar(0.13);
      const a=world[i].clone().add(side),b=world[i].clone().sub(side);positions.push(a.x,a.y,a.z,b.x,b.y,b.z);
      if(i){const o=(i-1)*2;indices.push(o,o+1,o+2,o+1,o+3,o+2);}
    }
    const geo=new THREE.BufferGeometry();geo.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geo.setIndex(indices);
    const material=new THREE.MeshBasicMaterial({color:p.color,side:THREE.DoubleSide,depthTest:false,depthWrite:false,transparent:true,opacity:.95});
    const mesh=new THREE.Mesh(geo,material);mesh.name=p.name;mesh.renderOrder=12;mesh.frustumCulled=false;
    mesh.userData={kind:'trench',name:p.name,displayDepthIn:18,lengthFt:p.length_3d_ft};
    pathGroup.add(mesh);
    return {id:p.id,name:p.name,color:p.color,visible:p.visible!==false,points,mesh,lengthFt:p.length_3d_ft,horizontalFt:p.length_horizontal_ft};
  });
  const site=initSiteWorks({...ctx,utmToWorld,worldToUtm,sampleDTM,getPaths:()=>paths,requestSave:()=>{},
    getMode:()=> 'idle',leavePathModes:()=>{},isPathBusy:()=>false,toast:()=>{}});
  site.importFeatures(layout);site.onPathsChanged();
  const panel=document.getElementById('pathPanel');
  document.getElementById('pathsToggle').onclick=()=>panel.classList.toggle('show');
  document.getElementById('closePanel').onclick=()=>panel.classList.remove('show');
  document.getElementById('showPaths').onchange=e=>pathGroup.visible=e.target.checked;
  document.getElementById('showModel').onchange=e=>modelRoot.visible=e.target.checked;
  const ul=document.getElementById('pathList');
  function showPath(p) {
    document.getElementById('vbPanel').classList.remove('show');
    document.getElementById('infoTitle').textContent=p.name;
    const body=document.getElementById('infoBody');body.replaceChildren();
    for(const text of ['Trench display: 18 in below grade (X-ray visible through terrain)',
      'Original ground length: '+p.lengthFt+' ft · Horizontal: '+p.horizontalFt+' ft',
      'Depth is a display offset only. Saved path coordinates and lengths are unchanged.']){
      const node=document.createElement('p');node.textContent=text;body.append(node);}
    document.getElementById('infoPanel').classList.add('show');
  }
  for(const p of paths){const li=document.createElement('li'),label=document.createElement('label'),input=document.createElement('input'),b=document.createElement('button');
    input.type='checkbox';input.checked=true;input.onchange=()=>p.mesh.visible=input.checked;
    label.style.color=p.color;label.append(input,document.createTextNode(p.name+' · '+p.lengthFt+' ft'));
    b.textContent='Info';b.onclick=()=>showPath(p);li.append(label,b);ul.append(li);}
  const boxes=document.getElementById('boxList');
  for(const vb of site.getSummary().valveBoxes){const b=document.createElement('button');b.textContent=vb.id;b.onclick=()=>site.openValveBox(vb.id);boxes.append(b);}
  // Ground-plane path picking remains informational, never starts drawing or editing.
  const ray=new THREE.Raycaster(),pointer={};
  renderer.domElement.addEventListener('pointerdown',e=>{pointer.x=e.clientX;pointer.y=e.clientY;pointer.id=e.pointerId;pointer.moved=!e.isPrimary;});
  renderer.domElement.addEventListener('pointermove',e=>{if(Math.hypot(e.clientX-pointer.x,e.clientY-pointer.y)>10)pointer.moved=true;});
  renderer.domElement.addEventListener('pointerup',e=>{
    if(e.pointerId!==pointer.id||pointer.moved||!pathGroup.visible)return;
    const rect=renderer.domElement.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);
    const hit=ray.intersectObjects(paths.filter(p=>p.mesh.visible).map(p=>p.mesh),false)[0];
    if(hit){const p=paths.find(p=>p.mesh===hit.object);showPath(p);}
  });
  const box=new THREE.Box3();paths.forEach(p=>p.points.forEach(q=>box.expandByPoint(utmToWorld(q.x,q.y,q.z))));
  const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3()),span=Math.max(size.x,size.z);
  controls.target.copy(center);camera.position.set(center.x+span*.32,center.y+span*.85,center.z+span*.7);controls.update();
  window.__publicView=Object.freeze({ready:true,version:'20261111-xb3 / read-only public',
    getSummary:()=>({paths:paths.map(p=>({id:p.id,name:p.name,lengthFt:p.lengthFt,depthIn:18})),...site.getSummary(),siteNumbers:[],readOnly:true})});
}
async function loadHeightmap() {
  try {
    const res = await fetch('dtm/heightmap.json', { cache: 'no-cache' });
    if (!res.ok) return null;
    const meta = await res.json();
    const bin = await fetch('dtm/' + (meta.data || 'heightmap.u16'), { cache: 'no-cache' });
    if (!bin.ok) return null;
    const buf = await bin.arrayBuffer();
    const data = new Uint16Array(buf);
    if (data.length !== meta.width * meta.height) {
      console.warn('heightmap size mismatch', data.length, meta.width, meta.height);
      return null;
    }
    const nodata = meta.nodata;
    const z0 = meta.z_offset;
    const zs = meta.z_scale;
    const offX = meta.utm_offset[0];
    const offY = meta.utm_offset[1];
    const gt = meta.geotransform;
    function sample(u, v) {
      const col = (u - gt[0]) / gt[1] - 0.5;
      const row = (v - gt[3]) / gt[5] - 0.5;
      const c0 = Math.floor(col), r0 = Math.floor(row);
      const c1 = c0 + 1, r1 = r0 + 1;
      if (c0 < -1 || r0 < -1 || c1 > meta.width || r1 > meta.height) return null;
      const fx = col - c0, fy = row - r0;
      let wsum = 0, zsum = 0, ok = 0;
      const parts = [
        [c0, r0, (1 - fx) * (1 - fy)],
        [c1, r0, fx * (1 - fy)],
        [c0, r1, (1 - fx) * fy],
        [c1, r1, fx * fy],
      ];
      for (const [c, r, w] of parts) {
        if (c < 0 || r < 0 || c >= meta.width || r >= meta.height) continue;
        const q = data[r * meta.width + c];
        if (q === nodata) continue;
        zsum += (z0 + q * zs) * w;
        wsum += w;
        ok++;
      }
      if (!ok || wsum < 0.2) return null;
      return zsum / wsum;
    }
    return { meta, sample, offX, offY, data };
  } catch (e) {
    console.warn('heightmap load failed', e);
    return null;
  }
}
