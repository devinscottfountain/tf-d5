// D6 hero: the night site through the glass. Displaced dirt terrain with berms and spoil piles, ridgelines,
// blue-hour sky dome, D5 machines (excavators, dozer, truck, light towers) under warm work lights.
// The room floor sits 1 m above the site; the camera looks along -z.
import { createMachines } from '../d5/machines.js';
import { NOISE, rng } from './hero-glsl.js';
import { texBinder, placeholders } from './hero-model-kit.js';
import { buildSite } from './hero-model-site.js';

export const G0 = -1.0;
const TEX_DIRT = 4; // metres per dirt_ground tile

const live = new Set();
// assign streamed textures by role to every live outside (no-op for roles not loaded yet)
export function applyHeroTextures(tex) { for (const o of live) o.applyHeroTextures(tex); }

// JS value noise matching nothing in GLSL (terrain shape only)
function makeNoise(seed) {
  const r = rng(seed), P = new Float32Array(512); for (let i = 0; i < 512; i++) P[i] = r();
  const h = (i, j) => P[((i * 73856093) ^ (j * 19349663)) & 511];
  const n = (x, y) => { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v; };
  return (x, y, o = 4) => { let s = 0, a = 0.5, f = 1; for (let k = 0; k < o; k++) { s += a * n(x * f, y * f); f *= 2.03; a *= 0.5; } return s; };
}

export function buildOutside({ THREE, scene, high, quality }) {
  if (high === undefined) high = quality !== 'low';
  const group = new THREE.Group(); group.name = 'hero-outside'; scene.add(group);
  const tb = texBinder(THREE);
  const fbm = makeNoise(19);
  const bump = (x, z, cx, cz, rx, rz, h) => { const d = ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2; return h * Math.exp(-d * 2.2); };
  const hgt = (x, z) => {
    let y = (fbm(x * 0.04, z * 0.04) - 0.5) * 0.8;
    y += bump(x, z, -22, -76, 26, 5, 2.4) + bump(x, z, -50, -72, 16, 6, 3.0) + bump(x, z, 4, -82, 18, 4, 1.6);   // long berm behind the pad
    y += bump(x, z, 26, -60, 6, 5, 2.4) + bump(x, z, 32, -66, 5, 4, 1.6) + bump(x, z, -36, -50, 7, 5, 1.4);       // spoil piles
    y -= bump(x, z, 2, -48, 10, 6, 1.2);                                                                           // the dig
    y += bump(x, z, 30, -40, 12, 4, 0.9) + bump(x, z, -14, -36, 10, 3, 0.7);                                      // foreground windrows
    const far = Math.max(0, -z - 90); y += far * 0.06 + (fbm(x * 0.012 + 3, z * 0.012) - 0.4) * far * 0.12;        // land rises toward the hills
    return y * (0.85 + 0.3 * fbm(x * 0.2, z * 0.2, 2));
  };

  // terrain
  const tg = new THREE.PlaneGeometry(420, 420, high ? 210 : 140, high ? 210 : 140).rotateX(-Math.PI / 2).translate(0, 0, -215);
  { const p = tg.attributes.position, uv = tg.attributes.uv; for (let i = 0; i < p.count; i++) { p.setY(i, G0 + hgt(p.getX(i), p.getZ(i))); uv.setXY(i, p.getX(i) / TEX_DIRT, -p.getZ(i) / TEX_DIRT); } tg.computeVertexNormals(); }
  tg.userData.texScale = TEX_DIRT;
  const tm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96 });
  const terrK = { value: 0 }; // 0 until dirt_ground lands (a white placeholder is bound until then)
  tm.onBeforeCompile = sh => {
    sh.uniforms.terrK = terrK;
    sh.vertexShader = 'varying vec3 vW;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW=(modelMatrix*vec4(transformed,1.)).xyz;');
    sh.fragmentShader = 'uniform float terrK; varying vec3 vW;\n' + NOISE + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 tcol=diffuseColor.rgb;
        float n1=fbm2(vW.xz*.18), n2=vn2(vW.xz*2.3+7.), n3=vn2(vW.xz*11.), tr=.5+.5*sin(vW.x*3.2+n1*4.);
        vec3 dirt=mix(vec3(.26,.19,.14), vec3(.4,.31,.23), n1);
        dirt*=.78+.3*n2+.12*(n3-.5);
        dirt=mix(dirt, vec3(.14,.11,.09), smoothstep(.55,.85,fbm2(vW.xz*.06+3.))*.6);   // wet / dark patches
        diffuseColor.rgb=dirt;
        #ifdef USE_MAP
        diffuseColor.rgb*=mix(vec3(1.), tcol*2.2, .75*terrK);
        #endif
        float wash=smoothstep(-34.,-50.,vW.z)*smoothstep(-110.,-70.,vW.z)*smoothstep(95.,30.,abs(vW.x))*(.55+.6*fbm2(vW.xz*.05+9.));
        float bh=n2*.35+n3*.1+tr*.08*smoothstep(-20.,-60.,vW.z);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec3 sp=-vViewPosition, sx=dFdx(sp), sy=dFdy(sp), r1=cross(sy,normal), r2=cross(normal,sx); float det=dot(sx,r1);
          vec2 dh=vec2(dFdx(bh),dFdy(bh)); normal=normalize(abs(det)*normal-sign(det)*(dh.x*r1+dh.y*r2)); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { vec3 wn=inverseTransformDirection(normal, viewMatrix); float face=clamp(.35+wn.z*1.6+wn.y*.25,0.,1.); // dirt facing the building
          totalEmissiveRadiance+=diffuseColor.rgb*vec3(1.,.72,.45)*wash*face*.55; }`);
  };
  tm.customProgramCacheKey = () => 'd6hero-terrain';
  const terrain = new THREE.Mesh(tg, tm); terrain.receiveShadow = true; group.add(terrain);
  tb.bind(tm, 'dirt_ground', { maps: ['map', 'normalMap', 'aoMap'], normalScale: 0.35, ao: 0.6, onApply: set => { if (set.map) terrK.value = 1; } }); // no roughness map: moonlit glints alias at distance

  // ridgelines: two strips of silhouette hills, far
  const ridge = (R, a0, a1, base, amp, seed, col) => {
    const n = 220, f = makeNoise(seed), P = [], I = [], top = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n, x = Math.sin(a) * R, z = -Math.cos(a) * R;
      const h = base + amp * (f(i * 0.035, seed) * 1.2 + 0.25 * f(i * 0.2, 7)) + amp * 0.9 * Math.exp(-(((a + 0.55) / 0.22) ** 2));
      P.push(x, -40, z, x, G0 + h * 0.55, z, x, G0 + h, z); top.push([x, G0 + h, z, a]);
      if (i < n) { const k = i * 3; I.push(k, k + 3, k + 1, k + 1, k + 3, k + 4, k + 1, k + 4, k + 2, k + 2, k + 4, k + 5); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col, roughness: 1 })); m.userData.top = top; group.add(m); return m;
  };
  ridge(520, -1.3, 1.3, 14, 26, 4, 0x1a1d26);
  const r2 = ridge(900, -1.25, 1.25, 30, 55, 9, 0x141822);
  // distant town over the far ridge: sparse sodium / white points on its flanks (the sky adds the glow dome)
  const city = (() => {
    const rr = rng(77), P = [], C = [], top = r2.userData.top, c = new THREE.Color();
    for (let i = 0; i < (high ? 260 : 140); i++) {
      const a = 0.35 + Math.pow(rr(), 0.7) * 0.6, k = Math.min(top.length - 2, Math.floor((a + 1.25) / 2.5 * (top.length - 1))), t = top[k];
      const d = 0.985 + rr() * 0.01, y = t[1] - 2 - Math.pow(rr(), 2) * 22;
      P.push(Math.sin(a) * 900 * d, y, -Math.cos(a) * 900 * d);
      c.setRGB(...(rr() < 0.7 ? [1.0, 0.62, 0.28] : [0.85, 0.9, 1.0])).multiplyScalar(0.6 + rr() * 0.9); C.push(c.r, c.g, c.b);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: high ? 1.6 : 1.3, sizeAttenuation: false, vertexColors: true, fog: false, transparent: true, depthWrite: false }));
    pts.userData.part = 'city-lights'; group.add(pts); return pts;
  })();

  // sky dome: blue hour, near black overhead, a few stars
  const skyU = { cHor: { value: new THREE.Color(0.05, 0.16, 0.44) }, cMid: { value: new THREE.Color(0.01, 0.03, 0.1) }, cTop: { value: new THREE.Color(0.001, 0.0015, 0.004) }, time: { value: 0 } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1600, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
    vertexShader: `varying vec3 vD; void main(){ vD=normalize(position); vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position=p.xyww; }`,
    fragmentShader: `${NOISE} uniform vec3 cHor, cMid, cTop; uniform float time; varying vec3 vD;
      void main(){ float e=vD.y, az=atan(vD.x,-vD.z);
        vec3 c=mix(cHor, cMid, smoothstep(.0,.12,e)); c=mix(c, cTop, smoothstep(.08,.3,e));
        c*=1.+.25*exp(-pow(az+.15,2.)*1.5)*smoothstep(.25,0.,e);                   // last light, a touch left of centre
        c+=vec3(.06,.04,.03)*exp(-max(e,0.)*40.)*.4;                                 // sodium haze on the horizon
        c+=vec3(.07,.04,.018)*exp(-pow((az-.62)/.22,2.))*exp(-max(e-.05,0.)*22.)*smoothstep(-.02,.06,e); // town glow over the far ridge
        vec2 sc=vec2(az*260.,e*260.); vec2 id=floor(sc); float s=hh21(id);
        float st=step(.992,s)*smoothstep(.22,.0,length(fract(sc)-.5))*smoothstep(.08,.3,e)*(.6+.4*sin(time*2.+s*90.));
        c+=vec3(.5,.55,.7)*st*.12;
        gl_FragColor=vec4(c,1.); }`
  }));
  sky.renderOrder = -1; sky.frustumCulled = false; group.add(sky);

  // machines from D5: build the yard into a scratch group, keep what reads at night, drop the rest
  const scratch = new THREE.Group();
  const yard = createMachines({ THREE, group: scratch, D: 4 });
  const night = (() => { // replace the daylight env with a dark blue-hour one
    const c = document.createElement('canvas'); c.width = 128; c.height = 64; const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, '#020308'); g.addColorStop(0.4, '#0b1a3a'); g.addColorStop(0.5, '#1d3466'); g.addColorStop(0.52, '#1a1410'); g.addColorStop(1, '#050404');
    x.fillStyle = g; x.fillRect(0, 0, 128, 64); for (const u of [30, 70, 100]) { x.fillStyle = '#ffd9a0'; x.fillRect(u, 30, 3, 2); }
    const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const MAT = yard.materials;
  for (const k of ['paint', 'metal', 'glass']) { MAT[k].envMap = night; }
  MAT.paint.envMapIntensity = 0.5; MAT.metal.envMapIntensity = 0.9; MAT.glass.envMapIntensity = 1.4;
  MAT.glow.color.setRGB(4, 4, 4);
  const paintU = { value: placeholders(THREE).map }, paintK = { value: 0 }; // excavator_paint, triplanar in object space (D5 machine geometry carries no UVs)
  for (const k of ['paint', 'rough', 'metal']) { // night read: mostly silhouettes, the CAT yellow only hinted
    const m = MAT[k], prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => { prev(sh, r); if (k === 'paint') { sh.uniforms.tPaint = paintU; sh.uniforms.paintK = paintK; }
      sh.fragmentShader = (k === 'paint' ? 'uniform sampler2D tPaint; uniform float paintK;\n' : '') + sh.fragmentShader.replace('#include <roughnessmap_fragment>',
      (k === 'paint' ? `{ vec3 an=abs(normalize(vMN)); an/=an.x+an.y+an.z+1e-4; vec3 q=vMObj*.5;
        vec3 tp=texture2D(tPaint,q.zy).rgb*an.x+texture2D(tPaint,q.xz).rgb*an.y+texture2D(tPaint,q.xy).rgb*an.z;
        diffuseColor.rgb*=mix(1., dot(tp,vec3(.3,.59,.11))*2.2, .7*paintK); }\n` : '') +
      'diffuseColor.rgb = mix(vec3(dot(diffuseColor.rgb, vec3(.3,.59,.11))), diffuseColor.rgb, .14) * .34;\n#include <roughnessmap_fragment>'); };
    m.customProgramCacheKey = () => 'd6night-' + k;
  }
  tb.bind(null, 'excavator_paint', { custom: set => { const t = set.map; if (!t || paintU.value === t) return; paintU.value = t; paintK.value = 1; } }); // ref swap only
  const place = (o, x, z, ry) => { o.position.set(x, G0 + hgt(x, z) - 0.05, z); o.rotation.y = ry; group.add(o); return o; };
  const exA = yard.exA, dozer = yard.dozer;
  place(exA.g, 12, -50, Math.PI * 0.95); exA.g.scale.setScalar(1.55);
  place(dozer, -8, -54, 0.3); dozer.scale.setScalar(1.2);
  const keep = [exA.g, dozer];
  if (high) { place(yard.trucks[0].g, -24, -70, -2.6); keep.push(yard.trucks[0].g); }
  // light towers: the head meshes' parents are the tower groups
  // towers framed off the copy (H1 left, lead right): one behind the excavator, one high on the right, both >= 120 px from text at 1280-1920 incl. parallax
  const towerSpots = [[8, -64, -0.6], [16, -40, 2.6]];
  yard.towers[0].material.color.setRGB(1.4, 1.3, 1.15);
  const towers = towerSpots.map(([x, z, ry], i) => { const t = yard.towers[i].parent; place(t, x, z, ry); keep.push(t); return t; });
  scratch.traverse(o => { if (o.isMesh && !keep.some(k => isIn(o, k))) o.geometry.dispose(); });
  group.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = false; });
  for (const k of keep) k.traverse(o => { if (o.isMesh) { o.castShadow = high && !o.isInstancedMesh; o.receiveShadow = high; } });
  terrain.receiveShadow = high;
  function isIn(o, root) { for (let p = o; p; p = p.parent) if (p === root) return true; return false; }

  // lights: blue-hour sky fill, a cool rim from behind the site, warm work lights from the tower heads
  const hemi = new THREE.HemisphereLight(0x223660, 0x140e09, 0.2); group.add(hemi);
  const moon = new THREE.DirectionalLight(0x6f8cd0, 0.45); moon.position.set(-60, 45, -160); moon.target.position.set(0, 0, -40); group.add(moon, moon.target);
  const spots = towers.map((t, i) => {
    const s = new THREE.SpotLight(0xffcf98, [1000, 1000][i], 0, [0.85, 0.75][i], 0.95, 2);
    const head = new THREE.Vector3(-0.45, 9.6, 0).applyMatrix4(t.matrix.compose(t.position, t.quaternion, t.scale));
    s.position.copy(head); s.target.position.copy([new THREE.Vector3(2, G0, -44), new THREE.Vector3(14, G0, -56), new THREE.Vector3(-36, G0, -90)][i]);
    if (i === 0 && high) { s.castShadow = true; s.shadow.mapSize.set(1024, 1024); s.shadow.camera.near = 2; s.shadow.camera.far = 110; s.shadow.bias = -0.0008; s.shadow.normalBias = 0.04; s.shadow.radius = 3; }
    group.add(s, s.target); return s;
  });

  // site dressing: barriers, fence, stockpiles, trailer, pickup, work lights, light cones
  const site = buildSite({ THREE, group, hgt, G0, high, spots, machines: { exA, dozer } });
  site.bind(tb);


  // idle animation: the excavator works slowly, the dozer creeps
  const exPose = (e, t, k) => {
    const c = t * 0.42 * k;
    e.up.rotation.y = 0.35 * Math.sin(c * 0.5) - 0.1;
    e.boom.rotation.z = 0.78 + 0.1 * Math.sin(c);
    e.stick.rotation.z = -2.2 - 0.18 * Math.sin(c + 0.8);
    e.bucket.rotation.z = -0.7 - 0.35 * Math.sin(c + 1.6);
  };
  const dz0 = dozer.position.clone();
  function update(t) {
    skyU.time.value = t;
    exPose(exA, t, 1);
    const s = Math.sin(t * 0.13); dozer.position.set(dz0.x + s * 2.4 * Math.cos(0.35), dz0.y, dz0.z - s * 2.4 * Math.sin(0.35));
  }
  update(0);
  const api = {
    group, update, spots, hemi, moon, skyU, hgt, site, cones: site.cones, city,
    applyHeroTextures: tex => tb.apply(tex),
    dispose() { live.delete(api); site.dispose(); group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); tm.dispose(); sky.material.dispose(); night.dispose(); city.material.dispose(); Object.values(MAT).forEach(m => m.dispose()); }
  };
  live.add(api);
  return api;
}
