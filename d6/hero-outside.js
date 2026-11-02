// D6 hero: the night site through the glass. Displaced dirt terrain with berms and spoil piles, ridgelines,
// blue-hour sky dome, D5 machines (excavators, dozer, truck, light towers) under warm work lights.
// The room floor sits 1 m above the site; the camera looks along -z.
import { createMachines } from '../d5/machines.js';
import { NOISE, rng } from './hero-glsl.js';

export const G0 = -1.0;

// JS value noise matching nothing in GLSL (terrain shape only)
function makeNoise(seed) {
  const r = rng(seed), P = new Float32Array(512); for (let i = 0; i < 512; i++) P[i] = r();
  const h = (i, j) => P[((i * 73856093) ^ (j * 19349663)) & 511];
  const n = (x, y) => { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
    return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v; };
  return (x, y, o = 4) => { let s = 0, a = 0.5, f = 1; for (let k = 0; k < o; k++) { s += a * n(x * f, y * f); f *= 2.03; a *= 0.5; } return s; };
}

export function buildOutside({ THREE, scene, high }) {
  const group = new THREE.Group(); scene.add(group);
  const fbm = makeNoise(19);
  const bump = (x, z, cx, cz, rx, rz, h) => { const d = ((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2; return h * Math.exp(-d * 2.2); };
  const hgt = (x, z) => {
    let y = (fbm(x * 0.04, z * 0.04) - 0.5) * 0.8;
    y += bump(x, z, -22, -64, 26, 5, 2.4) + bump(x, z, -48, -60, 16, 6, 3.0) + bump(x, z, 2, -70, 18, 4, 1.6);   // long berm behind the pad
    y += bump(x, z, 22, -48, 6, 5, 2.2) + bump(x, z, 28, -54, 5, 4, 1.5) + bump(x, z, -34, -40, 7, 5, 1.4);       // spoil piles
    y -= bump(x, z, 4, -36, 10, 6, 1.2);                                                                           // the dig
    y += bump(x, z, 30, -32, 12, 4, 0.9) + bump(x, z, -14, -28, 10, 3, 0.7);                                      // foreground windrows
    const far = Math.max(0, -z - 90); y += far * 0.06 + (fbm(x * 0.012 + 3, z * 0.012) - 0.4) * far * 0.12;        // land rises toward the hills
    return y * (0.85 + 0.3 * fbm(x * 0.2, z * 0.2, 2));
  };

  // terrain
  const tg = new THREE.PlaneGeometry(420, 420, high ? 210 : 140, high ? 210 : 140).rotateX(-Math.PI / 2).translate(0, 0, -215);
  { const p = tg.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, G0 + hgt(p.getX(i), p.getZ(i))); tg.computeVertexNormals(); }
  const tm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96 });
  tm.onBeforeCompile = sh => {
    sh.vertexShader = 'varying vec3 vW;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW=(modelMatrix*vec4(transformed,1.)).xyz;');
    sh.fragmentShader = 'varying vec3 vW;\n' + NOISE + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float n1=fbm2(vW.xz*.18), n2=vn2(vW.xz*2.3+7.), n3=vn2(vW.xz*11.), tr=.5+.5*sin(vW.x*3.2+n1*4.);
        vec3 dirt=mix(vec3(.26,.19,.14), vec3(.4,.31,.23), n1);
        dirt*=.78+.3*n2+.12*(n3-.5);
        dirt=mix(dirt, vec3(.14,.11,.09), smoothstep(.55,.85,fbm2(vW.xz*.06+3.))*.6);   // wet / dark patches
        diffuseColor.rgb=dirt; float bh=n2*.35+n3*.1+tr*.08*smoothstep(-20.,-60.,vW.z);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec3 sp=-vViewPosition, sx=dFdx(sp), sy=dFdy(sp), r1=cross(sy,normal), r2=cross(normal,sx); float det=dot(sx,r1);
          vec2 dh=vec2(dFdx(bh),dFdy(bh)); normal=normalize(abs(det)*normal-sign(det)*(dh.x*r1+dh.y*r2)); }`);
  };
  tm.customProgramCacheKey = () => 'd6hero-terrain';
  const terrain = new THREE.Mesh(tg, tm); terrain.receiveShadow = true; group.add(terrain);

  // ridgelines: two strips of silhouette hills, far
  const ridge = (R, a0, a1, base, amp, seed, col) => {
    const n = 220, f = makeNoise(seed), P = [], I = [];
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n, x = Math.sin(a) * R, z = -Math.cos(a) * R;
      const h = base + amp * (f(i * 0.035, seed) * 1.2 + 0.25 * f(i * 0.2, 7)) + amp * 0.9 * Math.exp(-((a + 0.55) / 0.22) ** 2);
      P.push(x, -40, z, x, G0 + h * 0.55, z, x, G0 + h, z);
      if (i < n) { const k = i * 3; I.push(k, k + 3, k + 1, k + 1, k + 3, k + 4, k + 1, k + 4, k + 2, k + 2, k + 4, k + 5); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(I); g.computeVertexNormals();
    const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: col, roughness: 1 })); group.add(m); return m;
  };
  ridge(520, -1.3, 1.3, 14, 26, 4, 0x1a1d26);
  ridge(900, -1.25, 1.25, 30, 55, 9, 0x141822);

  // sky dome: blue hour, near black overhead, a few stars
  const skyU = { cHor: { value: new THREE.Color(0.05, 0.16, 0.42) }, cMid: { value: new THREE.Color(0.012, 0.035, 0.12) }, cTop: { value: new THREE.Color(0.002, 0.003, 0.008) }, time: { value: 0 } };
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1600, 48, 24), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
    vertexShader: `varying vec3 vD; void main(){ vD=normalize(position); vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position=p.xyww; }`,
    fragmentShader: `${NOISE} uniform vec3 cHor, cMid, cTop; uniform float time; varying vec3 vD;
      void main(){ float e=vD.y, az=atan(vD.x,-vD.z);
        vec3 c=mix(cHor, cMid, smoothstep(.0,.16,e)); c=mix(c, cTop, smoothstep(.12,.42,e));
        c*=1.+.25*exp(-pow(az+.15,2.)*1.5)*smoothstep(.25,0.,e);                   // last light, a touch left of centre
        c+=vec3(.06,.04,.03)*exp(-max(e,0.)*40.)*.4;                                 // sodium haze on the horizon
        vec2 sc=vec2(az*90.,e*90.); vec2 id=floor(sc); float s=hh21(id);
        float st=step(.985,s)*smoothstep(.35,.0,length(fract(sc)-.5))*smoothstep(.08,.3,e)*(.6+.4*sin(time*2.+s*90.));
        c+=vec3(.5,.55,.7)*st*.25;
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
  const place = (o, x, z, ry) => { o.position.set(x, G0 + hgt(x, z) - 0.05, z); o.rotation.y = ry; group.add(o); return o; };
  const exA = yard.exA, exB = yard.exB, dozer = yard.dozer;
  place(exA.g, 13, -40, Math.PI * 0.92);
  place(dozer, -9, -47, 0.35);
  const keep = [exA.g, dozer];
  if (high) { place(exB.g, -36, -88, 0.9); place(yard.trucks[0].g, 30, -78, -2.3); keep.push(exB.g, yard.trucks[0].g); }
  // light towers: the head meshes' parents are the tower groups
  const towerSpots = high ? [[-20, -33, -0.6], [36, -58, 2.6], [-52, -80, 0.4]] : [[-20, -33, -0.6], [36, -58, 2.6]];
  const towers = towerSpots.map(([x, z, ry], i) => { const t = yard.towers[i].parent; place(t, x, z, ry); keep.push(t); return t; });
  scratch.traverse(o => { if (o.isMesh && !keep.some(k => isIn(o, k))) o.geometry.dispose(); });
  group.traverse(o => { if (o.isMesh && o !== terrain) { o.castShadow = high; o.receiveShadow = high; } });
  function isIn(o, root) { for (let p = o; p; p = p.parent) if (p === root) return true; return false; }

  // lights: blue-hour sky fill, a cool rim from behind the site, warm work lights from the tower heads
  const hemi = new THREE.HemisphereLight(0x2a3f6e, 0x1a120c, 0.55); group.add(hemi);
  const moon = new THREE.DirectionalLight(0x6f8cd0, 0.55); moon.position.set(-60, 45, -160); moon.target.position.set(0, 0, -40); group.add(moon, moon.target);
  const spots = towers.map((t, i) => {
    const s = new THREE.SpotLight(0xffd6a0, [2600, 2200, 1800][i], 0, [0.62, 0.55, 0.5][i], 0.65, 2);
    const head = new THREE.Vector3(-0.45, 9.6, 0).applyMatrix4(t.matrix.compose(t.position, t.quaternion, t.scale));
    s.position.copy(head); s.target.position.copy([new THREE.Vector3(2, G0, -44), new THREE.Vector3(12, G0, -46), new THREE.Vector3(-34, G0, -82)][i]);
    if (i === 0 && high) { s.castShadow = true; s.shadow.mapSize.set(1024, 1024); s.shadow.camera.near = 2; s.shadow.camera.far = 80; s.shadow.bias = -0.0008; s.shadow.normalBias = 0.04; s.shadow.radius = 3; }
    group.add(s, s.target); return s;
  });

  // idle animation: the excavator works slowly, the dozer creeps
  const exPose = (e, t, k) => {
    const c = t * 0.42 * k;
    e.up.rotation.y = 0.35 * Math.sin(c * 0.5) - 0.1;
    e.boom.rotation.z = 0.62 + 0.12 * Math.sin(c);
    e.stick.rotation.z = -1.55 - 0.25 * Math.sin(c + 0.8);
    e.bucket.rotation.z = -0.8 - 0.35 * Math.sin(c + 1.6);
  };
  const dz0 = dozer.position.clone();
  function update(t) {
    skyU.time.value = t;
    exPose(exA, t, 1); if (high) exPose(exB, t + 9, 0.8);
    const s = Math.sin(t * 0.13); dozer.position.set(dz0.x + s * 2.4 * Math.cos(0.35), dz0.y, dz0.z - s * 2.4 * Math.sin(0.35));
  }
  update(0);
  return {
    group, update, spots, hemi, moon, skyU, hgt,
    dispose() { group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); tm.dispose(); sky.material.dispose(); night.dispose(); Object.values(MAT).forEach(m => m.dispose()); }
  };
}
