// TerraFirma D5: scroll cinematic. Hosted on jsDelivr; the Webflow page only loads this file.
import * as THREE from 'three';
import { createPost } from './post.js';
import { createSky } from './sky.js';
import { createPlanets } from './planets.js';
import { createSite, AUSTIN, SITE_ROT } from './site.js';
const ASSETS = new URL('./assets', import.meta.url).href; // textures + star catalog live next to this file

const q = (s, r = document) => r.querySelector(s), qa = (s, r = document) => [...r.querySelectorAll(s)];
const host = q('.d5-canvas');

// ---------- renderer + bloom (the Expanse look is mostly glow against black) ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false; // shadows render only when the loop sets shadowMap.needsUpdate (colony segment); zero cost in space
host.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x010103);
const cam = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.1, 9000);
// post: motion blur -> DOF -> bloom -> auto exposure + ACES -> SMAA -> lens (CA, grain, vignette)
const post = createPost({ THREE, renderer, scene, cam }), { dof, lens, bloom } = post;
window.__d5 = { renderer, post, dof, lens };
addEventListener('resize', () => post.setSize(innerWidth, innerHeight));

// the sun sits far off to the left and behind, so every planet shows a lit crescent and a night side
const toSun = new THREE.Vector3(-1, 0.22, -0.55).normalize();

// ---------- shared GLSL: cheap value noise + fbm, enough for planets at this scale ----------
const NOISE = `
float h3(vec3 p){p=fract(p*0.3183099+.1);p*=17.0;return fract(p.x*p.y*p.z*(p.x+p.y+p.z));}
float n3(vec3 x){vec3 i=floor(x);vec3 f=fract(x);f=f*f*(3.0-2.0*f);
return mix(mix(mix(h3(i),h3(i+vec3(1,0,0)),f.x),mix(h3(i+vec3(0,1,0)),h3(i+vec3(1,1,0)),f.x),f.y),
mix(mix(h3(i+vec3(0,0,1)),h3(i+vec3(1,0,1)),f.x),mix(h3(i+vec3(0,1,1)),h3(i+vec3(1,1,1)),f.x),f.y),f.z);}
float fbm(vec3 p){float v=0.,a=.5;for(int i=0;i<5;i++){v+=a*n3(p);p*=2.03;a*=.5;}return v;}`;

// ---------- the solar system, laid out along -z so the camera can fly "outward" ----------
// spacing: each body's distance from Earth scales out by its factor; sizes stay, so the gaps read as real travel
const SPREAD = { moon: 1.7, mars: 1.9 };
const MOON0 = new THREE.Vector3(26, 6, -42), MARS0 = new THREE.Vector3(-36, -4, -300);
const EARTH = new THREE.Vector3(0, 0, 0), MOON = MOON0.clone().multiplyScalar(SPREAD.moon), MARS = MARS0.clone().multiplyScalar(SPREAD.mars);
// Earth/Moon/Mars: user color maps + NASA night lights, clouds w/ shadows, ocean glint, relief, single-scatter atmospheres
const planets = createPlanets({ THREE, scene, renderer, toSun, EARTH, MOON, MARS, assetBase: ASSETS });
const { earth, moon, mars } = planets;
planets.moon.material.uniforms.uRelief.value = 0.35; planets.mars.material.uniforms.uRelief.value = 0.4; // relief is synthesized, keep it a whisper so the real maps lead

// sky: real HYG star catalog (12.5k stars, true colors) + Gaia Milky Way, drawn at infinity
let sky = null;
createSky({ THREE, scene, assetBase: ASSETS, milkyWayIntensity: 0.14 }).then(s => (sky = s)).catch(() => {});

const sunLight = new THREE.DirectionalLight(0xfff1dc, 2.4); sunLight.position.copy(toSun).multiplyScalar(100); scene.add(sunLight, sunLight.target, new THREE.AmbientLight(0x223044, 0.35));

// ---------- Jezero Base: close-up construction timelapse on the Mars surface ----------
// lives far below the solar system inside its own sky dome; the camera cuts to it behind an entry flash
const COL = new THREE.Vector3(0, -6000, 0);
const colony = new THREE.Group(); colony.position.copy(COL); colony.visible = false; scene.add(colony);
const hemi = new THREE.HemisphereLight(0xffc896, 0x5a2a14, 1.4); scene.add(hemi); hemi.intensity = 0; // sky bounce, shared by the Austin site and the colony (one light, so materials never recompile)
// sun shadow: orthographic box fitted around the colony (radius ~350 plus the solar farm). The map is wider than tall because a low sun
// squashes the ground disc along the light's up axis; buildColony() resizes the vertical extent with the sun elevation every frame.
// castShadow stays true all the time so lit materials never recompile when the colony toggles; the map itself only renders when the loop requests it.
sunLight.castShadow = true;
{ const sh = sunLight.shadow, c = sh.camera; sh.mapSize.set(4096, 2048); sh.bias = -0.0005; sh.normalBias = 0.35; sh.radius = 2; c.left = -390; c.right = 390; c.near = 60; c.far = 1300; }
scene.fog = new THREE.Fog(0x000000, 1e8, 1e9); // parked far away outside the colony so nothing recompiles
const ambient = scene.children.find(o => o.isAmbientLight);
const rnd = (() => { let a = 7; return () => ((a = (a * 16807) % 2147483647) / 2147483647); })(); // seeded so the city is identical every load
const hash2 = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const vn = (x, y) => { const i = Math.floor(x), j = Math.floor(y), f = x - i, g = y - j, u = f * f * (3 - 2 * f), v = g * g * (3 - 2 * g); return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash2(i, j), hash2(i + 1, j), u), THREE.MathUtils.lerp(hash2(i, j + 1), hash2(i + 1, j + 1), u), v); };
const fbm2 = (x, y) => { let s = 0, a = 0.5; for (let o = 0; o < 5; o++) { s += a * vn(x, y); x *= 2.03; y *= 2.03; a *= 0.5; } return s; };
const sstep = THREE.MathUtils.smoothstep, clamp01 = v => Math.min(1, Math.max(0, v)), easeOut = v => 1 - Math.pow(1 - clamp01(v), 3);
const radialTex = (stops) => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64); stops.forEach(([o, s]) => g.addColorStop(o, s)); x.fillStyle = g; x.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); };

// terrain: flat pad for the city + solar farm, rolling dunes, crater rim ridges out at the horizon
{
  const g = new THREE.PlaneGeometry(3200, 3200, 240, 240); g.rotateX(-Math.PI / 2);
  const a = g.attributes.position, col = new Float32Array(a.count * 3), c = new THREE.Color();
  for (let i = 0; i < a.count; i++) {
    const x = a.getX(i), z = a.getZ(i), d = Math.hypot(x, z);
    let h = (fbm2(x * 0.004, z * 0.004) - 0.45) * 70 + fbm2(x * 0.03, z * 0.03) * 6;
    h *= sstep(d, 350, 580); h += sstep(d, 900, 1250) * (1 - sstep(d, 1250, 1500)) * 120 * fbm2(x * 0.002 + 5, z * 0.002);
    a.setY(i, h);
    // graded pad inside the city reads paler, like compacted regolith
    const n = fbm2(x * 0.01 + 9, z * 0.01), pad = 1 - sstep(d, 230, 260); c.setRGB(0.42 + n * 0.22 + pad * 0.05, 0.18 + n * 0.1 + pad * 0.04, 0.09 + n * 0.04 + pad * 0.03); col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.computeVertexNormals();
  const terrain = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }));
  terrain.receiveShadow = true; colony.add(terrain); // receives only: inside r<350 it is graded flat, so it has nothing to cast and no self-shadow acne
}

// sky: butterscotch by day, Mars' blue halo around the sun at dusk, stars at night
const skyU = { sunDir: { value: new THREE.Vector3() }, night: { value: 0 } };
colony.add(new THREE.Mesh(new THREE.SphereGeometry(2400, 48, 24), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false, uniforms: skyU,
  vertexShader: `varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
  fragmentShader: `uniform vec3 sunDir; uniform float night; varying vec3 vD; ${NOISE}
  void main(){ float e=clamp(vD.y,0.,1.), sd=max(dot(vD,sunDir),0.);
    vec3 dayC=mix(vec3(0.78,0.54,0.36),vec3(0.36,0.22,0.15),pow(e,0.6));
    vec3 duskC=mix(vec3(0.2,0.14,0.13),vec3(0.015,0.015,0.03),pow(e,0.45));
    vec3 c=mix(dayC,duskC,night)+vec3(0.3,0.5,0.9)*pow(sd,22.)*(0.2+night*0.55)+vec3(0.5,0.6,0.8)*pow(sd,160.)*0.6;
    c+=vec3(0.9)*step(0.9975,h3(floor(vD*500.)))*smoothstep(0.5,1.,night)*smoothstep(0.05,0.3,e);
    gl_FragColor=vec4(c,1.); }`
})));

// city plan: ring roads + 8 avenues + glass corridors from the hub dome to 4 outer domes
const RINGS = [62, 132, 204], AVE = 8, DOMES = [[0, 0, 20, 0.02]], TUBES = [];
for (let k = 0; k < 4; k++) { const a = Math.PI / 8 + k * Math.PI / 2; DOMES.push([Math.cos(a) * 96, Math.sin(a) * 96, 15, 0.26 + k * 0.08]); TUBES.push(a); }
const angD = (a, b) => Math.abs(((a - b) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);
const habs = [], fabs = [];
for (let r = 34; r < 238; r += 14) {
  let a = r * 0.11;
  while (a < r * 0.11 + Math.PI * 2 - 0.05) {
    const rd = Math.min(6.6, 2.6 + rnd() * 3.2 + 5 * Math.exp(-r / 70)), x = Math.cos(a) * r, z = Math.sin(a) * r;
    const nearAve = [...Array(AVE)].some((_, k) => angD(a, k * Math.PI / 4) * r < rd + 4);
    const nearTube = r < 86 && TUBES.some(t => angD(a, t) * r < rd + 3.5);
    const clear = !(nearAve || nearTube || RINGS.some(R => Math.abs(r - R) < rd + 3.5) || DOMES.some(([dx, dz, dr]) => Math.hypot(x - dx, z - dz) < dr + rd + 3));
    if (clear && rnd() > 0.1) {
      const bt = 0.06 + (r / 238) * 0.58 + rnd() * 0.08;
      if (r > 175 && rnd() < 0.28) fabs.push({ x, z, w: 8 + rnd() * 4, d: 5, h: 2.5 + rnd() * 2.5, rot: a, bt }); // low fab sheds on the industrial ring
      else habs.push({ x, z, r: rd, ys: 0.72 + rnd() * 0.35, rot: rnd() * 6.28, bt, seed: rnd() * 50 });
    }
    a += (2 * rd + 2.6) / r;
  }
}

// geodesic hemisphere: frequency-2 icosphere cut at the equator, so the struts read as a real geodesic frame
const habG = (() => {
  const g = new THREE.IcosahedronGeometry(1, 2).toNonIndexed(), p = g.attributes.position, keep = [];
  for (let i = 0; i < p.count; i += 3) { const cy = (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3; if (cy > -0.05) for (let k = 0; k < 3; k++) keep.push(p.getX(i + k), Math.max(0, p.getY(i + k)), p.getZ(i + k)); }
  const o = new THREE.BufferGeometry(); o.setAttribute('position', new THREE.Float32BufferAttribute(keep, 3)); o.computeVertexNormals(); return o;
})();
// dome skin: pale panels with ~30% glass facets; glass reads dark by day and glows warm at night
const winU = { night: { value: 0 } };
const habMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5, metalness: 0.25, flatShading: true });
habMat.onBeforeCompile = sh => {
  sh.uniforms.night = winU.night;
  sh.vertexShader = 'varying vec3 vLP; varying float vSeed;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    vLP=position; vSeed=instanceMatrix[3].x*0.13+instanceMatrix[3].z*0.71;`);
  sh.fragmentShader = 'uniform float night; varying vec3 vLP; varying float vSeed;\nfloat wh(vec3 p){return fract(sin(dot(p,vec3(41.3,289.1,97.7)))*43758.5);}\n' + sh.fragmentShader
    .replace('#include <color_fragment>', `#include <color_fragment>
    float glass=step(0.68,wh(floor(vLP*3.2)+vSeed))*step(0.08,vLP.y);
    float lit=step(0.35,wh(floor(vLP*3.2)+vSeed+7.));
    diffuseColor.rgb*=mix(1.,0.28,glass);`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    totalEmissiveRadiance+=vec3(1.,0.62,0.3)*glass*lit*night*(0.7+fract(vSeed)*0.6);`);
};
// fab sheds keep the box window shader
const bldMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, metalness: 0.2, flatShading: true });
bldMat.onBeforeCompile = sh => {
  sh.uniforms.night = winU.night;
  sh.vertexShader = 'varying vec3 vIP; varying vec3 vWN;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    vIP=(instanceMatrix*vec4(position,1.)).xyz; vWN=normalize(mat3(instanceMatrix)*normal);`);
  sh.fragmentShader = 'uniform float night; varying vec3 vIP; varying vec3 vWN;\n' + sh.fragmentShader
    .replace('#include <color_fragment>', `#include <color_fragment>
    float u=dot(vIP.xz,normalize(vec2(-vWN.z,vWN.x)+1e-4)); float band=step(0.5,fract(u/2.))*step(0.9,vIP.y)*step(vIP.y,1.5)*(1.-step(0.5,abs(vWN.y)));`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    totalEmissiveRadiance+=vec3(1.,0.7,0.4)*band*night*0.8;`);
};
const boxG = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
const shell = new THREE.InstancedMesh(habG, habMat, habs.length);
const frame = new THREE.InstancedMesh(habG, new THREE.MeshBasicMaterial({ color: 0xf0a35a, wireframe: true, transparent: true, opacity: 0.5 }), habs.length);
const ringPad = new THREE.InstancedMesh(new THREE.CylinderGeometry(1.12, 1.18, 0.5, 28).translate(0, 0.25, 0), new THREE.MeshStandardMaterial({ color: 0x8c7e70, roughness: 0.9 }), habs.length);
const sheds = new THREE.InstancedMesh(boxG, bldMat, fabs.length);
habs.forEach((l, i) => shell.setColorAt(i, new THREE.Color().setHSL(0.08, 0.06 + rnd() * 0.06, 0.72 + rnd() * 0.16)));
fabs.forEach((l, i) => sheds.setColorAt(i, new THREE.Color().setHSL(0.07, 0.08, 0.55 + rnd() * 0.15)));
colony.add(shell, frame, ringPad, sheds);
// shadows: shell/ringPad/sheds cast + receive. Their onBeforeCompile only touches colors/emissive/varyings (never vertex positions),
// so three's stock instanced MeshDepthMaterial matches their silhouettes and no customDepthMaterial is needed. The wireframe frame must NOT cast
// (a depth material ignores wireframe and would stamp a solid dome). Instances hidden with scale 0.0001 cast nothing visible.
shell.castShadow = shell.receiveShadow = ringPad.castShadow = ringPad.receiveShadow = sheds.castShadow = sheds.receiveShadow = true;

// streetlights crawl outward along every road; red beacons blink on the crowns of the big domes
const lp = [], lb = [];
const roadLines = [];
RINGS.forEach(R => { const pts = []; for (let i = 0; i <= 200; i++) { const a = i / 200 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * R, 0.4, Math.sin(a) * R)); if (i % 2 === 0) for (const o of [-2.6, 2.6]) { lp.push(Math.cos(a) * (R + o), 1.6, Math.sin(a) * (R + o)); lb.push(0.04 + R / 236 * 0.55 + (i / 200) * 0.08); } } roadLines.push([pts, 0.02 + R / 236 * 0.55]); });
for (let k = 0; k < AVE; k++) { const a = k * Math.PI / 4, pts = [new THREE.Vector3(Math.cos(a) * 20, 0.4, Math.sin(a) * 20), new THREE.Vector3(Math.cos(a) * 250, 0.4, Math.sin(a) * 250)]; roadLines.push([pts, 0.0]); for (let r = 24; r < 250; r += 4) for (const o of [-3, 3]) { lp.push(Math.cos(a) * r + Math.cos(a + 1.5708) * o, 1.6, Math.sin(a) * r + Math.sin(a + 1.5708) * o); lb.push(0.02 + (r / 250) * 0.62); } }
const roads = roadLines.map(([pts, bt]) => { const m = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xffb070, transparent: true, opacity: 0 })); m.userData.bt = bt; colony.add(m); return m; });
const lightU = { g: { value: 0 }, night: { value: 0 }, t: { value: 0 } };
const ptsMat = (vs, fs) => new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, uniforms: lightU, vertexShader: vs, fragmentShader: fs });
const DOT = `varying vec3 vC; varying float vA; void main(){ float d=length(gl_PointCoord-.5); gl_FragColor=vec4(vC*vA*smoothstep(.5,.05,d)*2.4,1.); }`;
{
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3)); g.setAttribute('bt', new THREE.Float32BufferAttribute(lb, 1));
  colony.add(new THREE.Points(g, ptsMat(`attribute float bt; uniform float g; uniform float night; varying vec3 vC; varying float vA; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); vC=vec3(1.,0.66,0.3); vA=smoothstep(bt,bt+0.025,g)*(0.15+0.85*night); gl_PointSize=clamp(520./-mv.z,1.2,6.); gl_Position=projectionMatrix*mv; }`, DOT)));
}
{
  const p = [], s = []; habs.filter(l => l.r > 5).forEach(l => { p.push(l.x, l.r * l.ys + 0.6, l.z); s.push(l.bt + 0.16, rnd()); });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('bs', new THREE.Float32BufferAttribute(s, 2));
  colony.add(new THREE.Points(g, ptsMat(`attribute vec2 bs; uniform float g; uniform float t; uniform float night; varying vec3 vC; varying float vA; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); vC=vec3(1.,0.12,0.06); vA=step(bs.x,g)*step(0.55,fract(t*0.7+bs.y))*(0.3+0.7*night)*1.6; gl_PointSize=clamp(900./-mv.z,2.,9.); gl_Position=projectionMatrix*mv; }`, DOT)));
}
// rover traffic: headlights one way, tail lights the other, looping rings and avenues; scroll speeds time up
{
  const N = 520, c = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) { const ring = rnd() < 0.6; c.set(ring ? [0, RINGS[Math.floor(rnd() * 3)] + (rnd() < 0.5 ? -1.2 : 1.2), rnd() * 6.283, (rnd() < 0.5 ? -1 : 1) * (8 + rnd() * 8)] : [1, Math.floor(rnd() * AVE) * Math.PI / 4, rnd() * 230, (rnd() < 0.5 ? -1 : 1) * (8 + rnd() * 8)], i * 4); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(N * 3), 3)); g.setAttribute('car', new THREE.BufferAttribute(c, 4));
  const pts = new THREE.Points(g, ptsMat(`attribute vec4 car; uniform float g; uniform float t; uniform float night; varying vec3 vC; varying float vA;
    void main(){ float T=t+g*90.; vec3 p; float on;
      if(car.x<0.5){ float a=car.z+T*car.w/car.y; p=vec3(cos(a)*car.y,1.,sin(a)*car.y); on=smoothstep(0.1+car.y/236.*0.55,0.16+car.y/236.*0.55,g); }
      else { float r=20.+mod(car.z+T*car.w,230.); float o=car.w>0.?1.3:-1.3; p=vec3(cos(car.y)*r-sin(car.y)*o,1.,sin(car.y)*r+cos(car.y)*o); on=smoothstep(0.12+r/250.*0.62,0.16+r/250.*0.62,g); }
      vec4 mv=modelViewMatrix*vec4(p,1.); vC=car.w>0.?vec3(1.,0.95,0.85):vec3(1.,0.18,0.1); vA=on*(0.25+0.75*night)*1.3; gl_PointSize=clamp(700./-mv.z,1.4,6.); gl_Position=projectionMatrix*mv; }`, DOT));
  pts.frustumCulled = false; colony.add(pts);
}

// domes: amber lattice rises first, then the glass skins over and glows warm from inside at night
const domeG = new THREE.SphereGeometry(1, 32, 14, 0, Math.PI * 2, 0, Math.PI / 2);
const domes = DOMES.map(([x, z, r, bt]) => {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(r);
  const lattice = new THREE.Mesh(domeG, new THREE.MeshBasicMaterial({ color: 0xf0a35a, wireframe: true, transparent: true, opacity: 0.7 }));
  const glass = new THREE.Mesh(domeG, new THREE.MeshStandardMaterial({ color: 0xcfe0ee, roughness: 0.12, metalness: 0.4, transparent: true, opacity: 0, depthWrite: false }));
  const glow = new THREE.Mesh(domeG, new THREE.MeshBasicMaterial({ color: 0xff9a50, transparent: true, opacity: 0, side: THREE.BackSide, blending: THREE.AdditiveBlending, depthWrite: false }));
  // big domes: the animated lattice mesh casts through a hashed-alpha depth material, so the shadow is a soft partial one
  // (glass is mostly transparent) and it grows with the lattice scale. Opacity is raised once the glass skins over (see buildColony).
  lattice.castShadow = true; lattice.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaHash: true, opacity: 0.2, side: THREE.DoubleSide });
  glass.receiveShadow = true;
  g.add(lattice, glass, glow); colony.add(g); return { g, lattice, glass, glow, bt };
});
// pressurized corridors: glass tubes that extrude out from the hub to each dome
const tubeG = new THREE.CylinderGeometry(2.4, 2.4, 1, 14, 1, true).rotateZ(Math.PI / 2).translate(0.5, 0, 0);
const tubeMat = new THREE.MeshStandardMaterial({ color: 0xd6e2ea, roughness: 0.15, metalness: 0.5, transparent: true, opacity: 0.6, emissive: 0xff9a50, emissiveIntensity: 0 });
const ribMat = new THREE.MeshBasicMaterial({ color: 0xf0a35a, wireframe: true, transparent: true, opacity: 0.5 });
const tubes = TUBES.map((a, i) => { const g = new THREE.Group(); g.position.set(Math.cos(a) * 19, 2.6, Math.sin(a) * 19); g.rotation.y = -a; g.add(new THREE.Mesh(tubeG, tubeMat), new THREE.Mesh(tubeG, ribMat)); colony.add(g); return { g, bt: 0.12 + i * 0.07 }; });

// solar farm: rows of tilted panels tiling in on the west flats
const panels = [];
for (let r = 262; r < 345; r += 4.2) for (let a = 0.25; a < 1.35; a += 3.2 / r) panels.push({ x: Math.cos(a) * r, z: Math.sin(a) * r, bt: 0.22 + (r - 262) / 83 * 0.22 + (a - 0.25) * 0.12 });
const panel = new THREE.InstancedMesh(new THREE.BoxGeometry(3, 0.1, 2.2).translate(0, 1.2, 0), new THREE.MeshStandardMaterial({ color: 0x16243c, metalness: 0.85, roughness: 0.22, emissive: 0x050a14 }), panels.length);
panel.castShadow = panel.receiveShadow = true; colony.add(panel);

// landing pad + a lander that keeps touching down and lifting off through the timelapse
const PAD = new THREE.Vector3(Math.cos(-0.55) * 300, 0, Math.sin(-0.55) * 300);
{
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(24, 26, 0.6, 48), new THREE.MeshStandardMaterial({ color: 0x5c524a, roughness: 0.9 })); pad.position.copy(PAD); pad.castShadow = pad.receiveShadow = true; colony.add(pad);
  const p = [], b = []; for (let i = 0; i < 32; i++) { const a = i / 32 * Math.PI * 2; p.push(PAD.x + Math.cos(a) * 22, 0.8, PAD.z + Math.sin(a) * 22); b.push(0.3); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setAttribute('bt', new THREE.Float32BufferAttribute(b, 1));
  colony.add(new THREE.Points(g, ptsMat(`attribute float bt; uniform float g; uniform float t; uniform float night; varying vec3 vC; varying float vA; void main(){ vec4 mv=modelViewMatrix*vec4(position,1.); vC=vec3(0.5,0.85,1.); vA=step(bt,g)*(0.3+0.7*night)*(0.6+0.4*sin(t*4.+position.x)); gl_PointSize=clamp(600./-mv.z,1.5,6.); gl_Position=projectionMatrix*mv; }`, DOT)));
}
const lander = new THREE.Group(); colony.add(lander);
{
  const m = new THREE.MeshStandardMaterial({ color: 0xd9d4cc, metalness: 0.6, roughness: 0.35 });
  lander.add(new THREE.Mesh(new THREE.CylinderGeometry(3, 3.6, 16, 20).translate(0, 10, 0), m), new THREE.Mesh(new THREE.ConeGeometry(3, 7, 20).translate(0, 21.5, 0), m));
  for (let k = 0; k < 4; k++) { const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 6, 0.5), m); leg.position.set(Math.cos(k * 1.5708) * 4, 2.5, Math.sin(k * 1.5708) * 4); leg.rotation.set(Math.sin(k * 1.5708) * 0.35, 0, -Math.cos(k * 1.5708) * 0.35); lander.add(leg); }
  lander.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
}
const plume = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex([[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(255,200,140,0.8)'], [1, 'rgba(0,0,0,0)']]), color: 0xffb070, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
colony.add(plume);

// tower cranes: show up just ahead of the build front, swing like a timelapse, then pack up
const craneMat = new THREE.MeshStandardMaterial({ color: 0xf0a35a, emissive: 0x3a1a00, roughness: 0.6 });
const craneLots = habs.filter(l => l.r > 4.2);
const cranes = craneLots.filter((l, i) => i % Math.max(1, Math.floor(craneLots.length / 20)) === 3).slice(0, 20).map((l, i) => {
  const g = new THREE.Group(); g.position.set(l.x + l.r + 2, 0, l.z + 2); const H = Math.max(22, l.r * l.ys + 16);
  const mast = new THREE.Mesh(new THREE.BoxGeometry(1, H, 1).translate(0, H / 2, 0), craneMat);
  const jib = new THREE.Group(); jib.position.y = H;
  jib.add(new THREE.Mesh(new THREE.BoxGeometry(30, 0.8, 0.8).translate(8, 0, 0), craneMat), new THREE.Mesh(new THREE.BoxGeometry(3, 2.2, 2).translate(-6, -0.8, 0), craneMat), new THREE.Mesh(new THREE.BoxGeometry(0.08, 10, 0.08).translate(18, -5, 0), craneMat));
  g.add(mast, jib); g.traverse(o => { if (o.isMesh) o.castShadow = true; }); colony.add(g); return { g, jib, bt: l.bt, ph: i * 1.7 };
});

let lastG = -1;
const mtx = new THREE.Matrix4(), q4 = new THREE.Quaternion(), yAx = new THREE.Vector3(0, 1, 0), v3 = new THREE.Vector3(), s3 = new THREE.Vector3(), q0 = new THREE.Quaternion();
const colSun = new THREE.Vector3(), skyCol = new THREE.Color(), dayH = new THREE.Color(0.78, 0.54, 0.36), duskH = new THREE.Color(0.2, 0.14, 0.13);
const HIDE = new THREE.Vector3(0.0001, 0.0001, 0.0001), qPanel = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, 0.5)); // panels tilt toward the low western sun
function buildColony(g, t) {
  const night = sstep(g, 0.35, 0.95), el = THREE.MathUtils.lerp(0.34, -0.05, sstep(g, 0.05, 1));
  colSun.set(-Math.cos(el), Math.sin(el), -Math.cos(el) * 0.22).normalize();
  // shadow camera: sit 600 units out along the sun, look at the colony centre; vertical half-extent = projected ground disc + tallest caster (cranes, domes)
  { const c = sunLight.shadow.camera, V = 390 * Math.max(colSun.y, 0.06) + 80; sunLight.target.position.copy(COL); sunLight.position.copy(COL).addScaledVector(colSun, 600);
    if (c.top !== V) { c.top = V; c.bottom = -V; c.updateProjectionMatrix(); } }
  skyU.sunDir.value.copy(colSun); skyU.night.value = night; lightU.g.value = g; lightU.night.value = night; lightU.t.value = t; winU.night.value = night;
  scene.fog.color.copy(skyCol.copy(dayH).lerp(duskH, night)); scene.fog.near = 260; scene.fog.far = 1650;
  sunLight.intensity = THREE.MathUtils.lerp(2.2, 0.1, night); ambient.intensity = THREE.MathUtils.lerp(0.5, 0.1, night); hemi.intensity = THREE.MathUtils.lerp(1.5, 0.12, night);
  hemi.color.copy(skyCol); tubeMat.emissiveIntensity = night * 0.35;
  // lander cycle: descend on a burn, sit, lift off; repeats a few times across the scroll
  const lc = (g * 5) % 1, flying = g > 0.3; let ly = 0, burn = 0;
  if (lc < 0.35) { ly = Math.pow(1 - lc / 0.35, 2) * 320; burn = 1; } else if (lc > 0.65) { ly = Math.pow((lc - 0.65) / 0.35, 2) * 360; burn = 1; }
  lander.visible = plume.visible = flying; lander.position.set(PAD.x, ly + 0.3, PAD.z);
  plume.position.set(PAD.x, ly - 2, PAD.z); plume.scale.setScalar(burn * (18 + Math.sin(t * 40) * 2)); plume.material.opacity = burn * (0.6 + 0.4 * (1 - Math.min(1, ly / 60)));
  cranes.forEach(c => { c.jib.rotation.y = c.ph + g * 46 + t * 0.15; });
  if (Math.abs(g - lastG) < 1e-4) return; lastG = g;
  habs.forEach((l, i) => {
    // pad pours, struts rise, panels skin up from the base
    const k0 = easeOut((g - l.bt) / 0.03), s = easeOut((g - l.bt - 0.02) / 0.06), f = easeOut((g - l.bt - 0.07) / 0.08);
    q4.setFromAxisAngle(yAx, l.rot);
    mtx.compose(v3.set(l.x, 0, l.z), q4, k0 > 0 ? s3.set(l.r, k0, l.r) : HIDE); ringPad.setMatrixAt(i, mtx);
    mtx.compose(v3.set(l.x, 0.45, l.z), q4, s > 0 ? s3.set(l.r * 1.015, l.r * l.ys * s * 1.015, l.r * 1.015) : HIDE); frame.setMatrixAt(i, mtx);
    mtx.compose(v3.set(l.x, 0.45, l.z), q4, f > 0 ? s3.set(l.r, l.r * l.ys * f, l.r) : HIDE); shell.setMatrixAt(i, mtx);
  });
  fabs.forEach((l, i) => { const f = easeOut((g - l.bt - 0.04) / 0.07); q4.setFromAxisAngle(yAx, -l.rot); mtx.compose(v3.set(l.x, 0, l.z), q4, f > 0 ? s3.set(l.w, l.h * f, l.d) : HIDE); sheds.setMatrixAt(i, mtx); });
  shell.instanceMatrix.needsUpdate = frame.instanceMatrix.needsUpdate = ringPad.instanceMatrix.needsUpdate = sheds.instanceMatrix.needsUpdate = true;
  panels.forEach((p, i) => { const k = easeOut((g - p.bt) / 0.04); mtx.compose(v3.set(p.x, 0, p.z), qPanel, k > 0 ? s3.set(1, k, 1) : HIDE); panel.setMatrixAt(i, mtx); });
  panel.instanceMatrix.needsUpdate = true;
  roads.forEach(m => (m.material.opacity = sstep(g, m.userData.bt, m.userData.bt + 0.06) * (0.15 + 0.85 * night)));
  domes.forEach(d => {
    const s = easeOut((g - d.bt) / 0.1), gl = sstep(g, d.bt + 0.1, d.bt + 0.18);
    d.lattice.scale.set(1, Math.max(0.001, s), 1); d.lattice.material.opacity = 0.75 * (1 - gl * 0.6);
    d.glass.material.opacity = gl * 0.28; d.glow.material.opacity = gl * night * 0.28;
    d.lattice.customDepthMaterial.opacity = 0.18 + 0.32 * gl; // dome shadow darkens as the glass skins over
  });
  tubes.forEach(tb => { const k = easeOut((g - tb.bt) / 0.08); tb.g.scale.set(Math.max(0.001, k * 62), 1, 1); tb.g.visible = k > 0; });
  cranes.forEach(c => { const v = Math.min(easeOut((g - c.bt + 0.08) / 0.04), 1 - easeOut((g - c.bt - 0.2) / 0.04)); c.g.scale.set(1, Math.max(0.001, v), 1); c.g.visible = v > 0.01; });
}
const cPos = new THREE.CatmullRomCurve3([[150, 430, 170], [175, 240, 130], [195, 115, 45], [175, 36, -55]].map(p => new THREE.Vector3(...p).add(COL)), false, 'centripetal');
const cLook = new THREE.CatmullRomCurve3([[0, 0, 0], [0, 0, 0], [-20, 8, -8], [-210, 28, -40]].map(p => new THREE.Vector3(...p).add(COL)), false, 'centripetal');

// sun + anamorphic flare: two additive sprites, the streak is what sells the Expanse feel
const glowTex = (w, h, stops) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); const g = x.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2); stops.forEach(([o, s]) => g.addColorStop(o, s)); x.fillStyle = g; x.fillRect(0, 0, w, h); return new THREE.CanvasTexture(c); };
const spriteMat = (tex, col) => new THREE.SpriteMaterial({ map: tex, color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false });
const sunCore = new THREE.Sprite(spriteMat(glowTex(256, 256, [[0, 'rgba(255,255,255,1)'], [0.12, 'rgba(255,236,200,0.9)'], [0.35, 'rgba(255,170,80,0.25)'], [1, 'rgba(0,0,0,0)']]), 0xffffff));
const streak = new THREE.Sprite(spriteMat(glowTex(512, 512, [[0, 'rgba(255,255,255,1)'], [0.2, 'rgba(140,190,255,0.5)'], [1, 'rgba(0,0,0,0)']]), 0x9fc8ff));
scene.add(sunCore, streak);

// ---------- space dust: wraps around the lens; streaks along the camera's velocity, floats when still ----------
const DCFG = Object.assign({ shutter: 0.025, maxStreak: 0.4, base: 0.16, gain: 0.5 }, window.D5_DUST || {}); // dust tuning; override from page head
const DUST = 1800, BOX = 36, dustU = { cp: { value: new THREE.Vector3() }, vel: { value: new THREE.Vector3() }, t: { value: 0 }, amt: { value: 1 }, spd: { value: 0 } };
const dustVS = `attribute vec3 seed; attribute float tip; uniform vec3 cp; uniform vec3 vel; uniform float t; varying float vA;
  void main(){
    vec3 p=seed*${BOX}.+vec3(t*0.35,t*0.12,-t*0.22)+seed.yzx*sin(t*0.3+seed.x*6.)*0.6; // slow tumble
    vec3 rel=mod(p-cp,${BOX}.)-${BOX}.*0.5;                                         // wrap into a box around the camera
    vec3 w=cp+rel-vel*tip;                                                           // tail trails behind the motion
    float d=length(rel)/(${BOX}.*0.5);
    vA=(1.-smoothstep(0.5,1.,d))*smoothstep(0.04,0.14,d);                            // fade at the box edge and right at the lens
    gl_PointSize=1.6; gl_Position=projectionMatrix*viewMatrix*vec4(w,1.); }`;
const dustFS = `uniform float amt; uniform float spd; varying float vA; void main(){ gl_FragColor=vec4(vec3(0.75,0.85,1.)*vA*amt*(${DCFG.base}+${DCFG.gain}*spd),1.); }`;
const dustMat = new THREE.ShaderMaterial({ uniforms: dustU, vertexShader: dustVS, fragmentShader: dustFS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
const dust = new THREE.Group(); scene.add(dust);
{
  const sd = new Float32Array(DUST * 6), tp = new Float32Array(DUST * 2), hd = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) { const x = Math.random(), y = Math.random(), z = Math.random(); sd.set([x, y, z, x, y, z], i * 6); tp.set([0, 1], i * 2); hd.set([x, y, z], i * 3); }
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST * 6), 3)); lg.setAttribute('seed', new THREE.BufferAttribute(sd, 3)); lg.setAttribute('tip', new THREE.BufferAttribute(tp, 1));
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DUST * 3), 3)); pg.setAttribute('seed', new THREE.BufferAttribute(hd, 3)); pg.setAttribute('tip', new THREE.BufferAttribute(new Float32Array(DUST), 1));
  const lines = new THREE.LineSegments(lg, dustMat), heads = new THREE.Points(pg, dustMat);
  lines.frustumCulled = heads.frustumCulled = false; dust.add(lines, heads);
}
const lastPos = new THREE.Vector3(), camVel = new THREE.Vector3(), velTmp = new THREE.Vector3(); let hasLast = false;

// ---------- opening frame in space: Earth's night side, sun about to crest the limb ----------
const upP = new THREE.Vector3(0, 1, 0).addScaledVector(toSun, -toSun.y).normalize();
const C0 = EARTH.clone().addScaledVector(toSun, -23).addScaledVector(upP, 10.4);
const L0 = C0.clone().addScaledVector(toSun, 60).addScaledVector(upP, -9);
const DIVE = MARS.clone().addScaledVector(new THREE.Vector3(15, 4, 35).normalize(), 7.4); // dive line ~ the approach line, so Mars doesn't slew across frame on arrival
const V = a => (a.isVector3 ? a.clone() : new THREE.Vector3(...a));
const M3 = (b, o) => b.clone().add(new THREE.Vector3(...o));

const smoother = x => x * x * x * (x * (x * 6 - 15) + 10);
// monotone cubic (Fritsch-Carlson). Velocity stays continuous through every key and never overshoots,
// so the camera can't stop dead on a key, fire off again, or swing past a framing and come back.
function pchip(xs, ys, m0, mN) {
  const n = xs.length, h = [], d = [], m = new Array(n);
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
  for (let i = 1; i < n - 1; i++) { if (d[i - 1] * d[i] <= 0) m[i] = 0; else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); } }
  const end = (h0, h1, d0, d1) => { let v = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1); if (Math.sign(v) !== Math.sign(d0)) v = 0; else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(v) > 3 * Math.abs(d0)) v = 3 * d0; return v; };
  m[0] = m0 !== undefined ? m0 * d[0] : end(h[0], h[1], d[0], d[1]);
  m[n - 1] = mN !== undefined ? mN * d[n - 2] : end(h[n - 2], h[n - 3], d[n - 2], d[n - 3]);
  return x => {
    if (x <= xs[0]) return ys[0] + m[0] * (x - xs[0]); if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const t = (x - xs[i]) / h[i], t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h[i] * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h[i] * m[i + 1];
  };
}

// ---------- camera: one continuous flight, Earth -> Moon -> Mars -> dive ----------
// Each shot is [scroll, position, look target, lens]. Position rides a centripetal spline; scroll maps to distance
// along it through a monotone curve, so it slows near each planet (the copy reads) and runs between them without
// ever stopping. The look direction is its own monotone curve over the same scroll, so turns are gentle and never reverse.
const CA = 0.58; // the entry flash: everything after this is the Jezero timelapse
const SHOTS = [
  [0.00, C0, L0, 38],                                              // sunrise over the night side (where the opening lands)
  [0.11, [6, 9, 36], [0, 1.5, 0], 34],                             // pull back and up: the whole Earth, long lens
  [0.20, [-6.5, 12.5, 11], MOON, 30],                               // drop behind the curve of the Earth: the Moon rising over the limb, long lens
  [0.30, M3(MOON, [-5, 5, 13]), M3(MOON, [0.5, 0, 0]), 44],        // close on the Moon's terminator
  [0.37, M3(MOON, [2, 5.5, -7.5]), MARS, 48],                      // crest over its north limb, Mars dead ahead
  [0.47, M3(MARS, [15.5, 4, 36]), M3(MARS, [-1, 0, 0]), 36],         // arrive at Mars: the mission copy reads here
  [0.53, M3(MARS, [10, 2.7, 23]), MARS, 40],                         // slow push
  [CA, DIVE, MARS, 52]                                             // dive into the entry flash
].map(([p, pos, look, fov]) => ({ p, pos: V(pos), look: V(look), fov }));
const posC = new THREE.CatmullRomCurve3(SHOTS.map(k => k.pos), false, 'centripetal'); posC.arcLengthDivisions = 4000;
const NK = SHOTS.length, PX = SHOTS.map(k => k.p), arcLens = posC.getLengths();
const arcAt = t => { const f = t * (arcLens.length - 1), i = Math.floor(f); return i >= arcLens.length - 1 ? arcLens[arcLens.length - 1] : arcLens[i] + (arcLens[i + 1] - arcLens[i]) * (f - i); };
const arcP = pchip(PX, SHOTS.map((k, i) => arcAt(i / (NK - 1))), 0.6, 2.2); // ease off the opening frame; accelerate into the dive
// look: each shot names a subject. Between two shots the camera aims at both from where it is right now and slerps
// from one to the other, so a held subject stays locked in frame however fast the camera moves, and subject changes
// are one smooth pan. The pan rate rides a monotone curve over the shot index, so it never pauses on a key.
const idxP = pchip(PX, SHOTS.map((k, i) => i)), fovP = pchip(PX, SHOTS.map(k => k.fov));
const dA = new THREE.Vector3(), dB = new THREE.Vector3(), qL = new THREE.Quaternion(), qL0 = new THREE.Quaternion();
const spaceCam = (p, outPos, outLook) => {
  const q = Math.min(p, CA), u = posC.getUtoTmapping(0, Math.max(0, arcP(q)));
  posC.getPoint(u, outPos);
  const f = THREE.MathUtils.clamp(idxP(q), 0, NK - 1.0001), i = Math.floor(f), t = f - i;
  dA.copy(SHOTS[i].look).sub(outPos); dB.copy(SHOTS[i + 1].look).sub(outPos);
  const fa = dA.length(), fb = dB.length(); dA.normalize(); dB.normalize();
  qL.setFromUnitVectors(dA, dB); qL0.identity().slerp(qL, smoother(t)); // eased per pan: it settles onto each subject instead of snapping
  outLook.copy(dA).applyQuaternion(qL0).multiplyScalar(fa + (fb - fa) * t).add(outPos);
  return fovP(q);
};
window.__d5.path = p => { const a = new THREE.Vector3(), b = new THREE.Vector3(), f = spaceCam(p, a, b); return [...a.toArray(), ...b.toArray(), f]; }; // QA hook

// ---------- the opening: Austin lot timelapse, then a powers-of-ten pull out to the shot above ----------
const SITE0 = new THREE.Vector3(0, 40000, 0);
const site = createSite({ THREE, scene, sunLight, hemi, ORIGIN: SITE0, earthU: earth.material.uniforms, orthoUrl: window.D5_ORTHO || 'https://cdn.prod.website-files.com/6ae4c2b96de64cf78d486e72/6ae5f95dd2740562ba491292_austin-site-ortho.jpg' }); // TxGIO StratMap 2019 6in orthophoto, 800 m square, hosted in Webflow assets
const EARTH_SPIN = 0.012, U_PER_M = 10 / 6371000; // Earth radius is 10 units
const latR = THREE.MathUtils.degToRad(AUSTIN.lat), lonU = (AUSTIN.lon + 180) / 360;
const austinLocal = new THREE.Vector3(-Math.cos(2 * Math.PI * lonU) * Math.cos(latR), Math.sin(latR), Math.sin(2 * Math.PI * lonU) * Math.cos(latR));
// park Austin on the night side right under the opening frame: same azimuth as C0, so the pull out lands with the city just below centre
const SPIN_LAND = Math.atan2(austinLocal.z, austinLocal.x) - Math.atan2(C0.z, C0.x);
const AUS = austinLocal.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), SPIN_LAND).multiplyScalar(10), AUSn = AUS.clone().normalize();
const LAM0 = Math.log(400), LAMH = Math.log(650e3), LAM1 = Math.log(C0.distanceTo(AUS) / U_PER_M); // ln(distance in metres): site, hand-off, landing
const backEnd = C0.clone().sub(AUS).normalize(), lookEnd = L0.clone().sub(C0).normalize(), negN = AUSn.clone().negate();
const qT = new THREE.Quaternion(), qI = new THREE.Quaternion();
const slerpV = (a, b, k, out) => { qT.setFromUnitVectors(a, b); qI.identity().slerp(qT, k); return out.copy(a).applyQuaternion(qI); };
// timelapse framing: creep out, snap out, creep out, snap out, then the long pull. Distances in metres, eased in log space.
const BEATS = [[0, 0.44, 130, 150, 0], [0.44, 0.52, 150, 235, 1], [0.52, 0.9, 235, 262, 0], [0.9, 1, 262, 400, 1]];
const expoIO = x => (x <= 0 ? 0 : x >= 1 ? 1 : x < 0.5 ? Math.pow(2, 20 * x - 10) / 2 : 1 - Math.pow(2, -20 * x + 10) / 2);
const lapseDist = g => { for (const [a, b, d0, d1, snap] of BEATS) if (g <= b) { const x = (g - a) / (b - a), e = snap ? expoIO(x) : x; return Math.exp(Math.log(d0) + (Math.log(d1) - Math.log(d0)) * e); } return 400; };
const TL = 0.51; // share of the intro that is timelapse; the rest is the pull out
const intro = { s: 0 };
let spinOff = SPIN_LAND, siteInfo = null;

// ---------- satellite: skims past the lens on the Earth to Moon leg ----------
const sat = new THREE.Group(); scene.add(sat);
{
  const foil = new THREE.MeshStandardMaterial({ color: 0x8f6624, metalness: 0.75, roughness: 0.5, flatShading: true });
  const white = new THREE.MeshStandardMaterial({ color: 0xb8b5b0, metalness: 0.2, roughness: 0.6 });
  const truss = new THREE.MeshStandardMaterial({ color: 0x9a9a9a, metalness: 0.9, roughness: 0.3 });
  // solar cells: dark blue grid on a canvas so the wings catch a cell pattern and specular sweep
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128; const x = cv.getContext('2d');
  x.fillStyle = '#0b1a33'; x.fillRect(0, 0, 256, 128); x.strokeStyle = '#3a5a8c'; x.lineWidth = 2;
  for (let i = 0; i <= 256; i += 16) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 128); x.stroke(); } for (let j = 0; j <= 128; j += 16) { x.beginPath(); x.moveTo(0, j); x.lineTo(256, j); x.stroke(); }
  const cells = new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(cv), metalness: 0.5, roughness: 0.4, color: 0xb8c4d8 });
  // crumpled MLI: jitter a subdivided box so the gold foil breaks up the highlights
  const bus = new THREE.BoxGeometry(0.7, 0.9, 0.7, 4, 5, 4); { const p = bus.attributes.position; for (let i = 0; i < p.count; i++) p.setXYZ(i, p.getX(i) * (1 + (Math.random() - 0.5) * 0.05), p.getY(i), p.getZ(i) * (1 + (Math.random() - 0.5) * 0.05)); bus.computeVertexNormals(); }
  sat.add(new THREE.Mesh(bus, foil));
  sat.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 3.6, 6).rotateZ(Math.PI / 2), truss));
  for (const sx of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.03, 0.85), cells); w.position.x = sx * 1.55; w.rotation.x = 0.35; sat.add(w); }
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.42, 24, 8, 0, Math.PI * 2, 0, 1.0), white); dish.material.side = THREE.DoubleSide; dish.rotation.x = Math.PI; dish.position.y = 0.95; sat.add(dish);
  sat.add(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 6).translate(0, 0.72, 0), truss), new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 1.1, 4).translate(0.25, -0.9, 0.2), truss));
}
const satBlink = new THREE.Sprite(new THREE.SpriteMaterial({ map: radialTex([[0, 'rgba(255,255,255,1)'], [1, 'rgba(0,0,0,0)']]), color: 0xff4030, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
satBlink.scale.setScalar(0.25); satBlink.position.set(0.36, 0.46, 0.36); sat.add(satBlink);
const SATP = 0.405; // scroll point where it passes the lens: early in the Moon to Mars run
const satA = new THREE.Vector3(), satB = new THREE.Vector3(), satL = new THREE.Vector3();
spaceCam(SATP + 0.002, satA, satL); spaceCam(SATP - 0.002, satB, satL);
const satT = satA.clone().sub(satB).normalize(), satR = new THREE.Vector3().crossVectors(satT, new THREE.Vector3(0, 1, 0)).normalize();
const SATV = satA.distanceTo(satB) / 0.004 * 0.9; // it cruises the same way at 90% of the camera's speed, so we overtake it slowly
spaceCam(SATP, satA, satL); const SAT0 = satA.clone().addScaledVector(satR, 2.8).add(new THREE.Vector3(0, -0.9, 0));

// ---------- scroll + overlays ----------
let prog = 0, sm = 0, smV = 0;
window.__d5.seek = p => { sm = p; smV = 0; }; // QA hook: jump the eased scroll straight to a progress value
window.__d5.intro = intro;
const track = q('.d5-track'), after = q('.d5-after');
ScrollTrigger.create({ trigger: track, start: 'top top', end: 'bottom bottom', onUpdate: s => (prog = s.progress) });
// each overlay owns a scroll window [a, b]; it rises in, holds, then drifts out. Sections in the plain page below are left alone.
const ovs = qa('[data-w]').filter(el => !el.closest('.d5-after')).map(el => { const [a, b] = el.dataset.w.split(',').map(Number); return { el, a, b }; });
const WIN = { 'd5-hero': [-1, 0.06], 'd5-mission': [0.43, 0.55], 'd5-belt': [0.8, 9] };
ovs.forEach(o => { const w = WIN[o.el.classList[0]]; if (w) [o.a, o.b] = w; });
const win = (p, a, b, f = 0.035) => Math.min(THREE.MathUtils.smoothstep(p, a - f, a + f), 1 - THREE.MathUtils.smoothstep(p, b - f, b + f));
const ZONES = [[0, 'Sol · Earth', 1.0], [0.22, 'Earth · Luna', 1.003], [0.38, 'Sol · Mars', 1.52], [CA, 'Mars · Jezero Base', 1.52, 1]];
const veil = q('.d5-veil'), loc = q('.d5-loc'), au = q('.d5-au'), fill = q('.d5-rail-fill'), fadeEls = qa('.d5-hud, .d5-rail');
let zone = -1;

// ---------- load: veil lifts on the lot, the timelapse runs, the camera pulls off to orbit, then the title tracks in ----------
const h1 = new SplitText('.d5-h1', { type: 'chars,words' });
const LAPSE = 3.0, PULL = 2.9;
let introDone = false, introOver = false;
const lockScroll = on => { document.documentElement.style.overflow = on ? 'hidden' : ''; if (window.lenis) on ? lenis.stop() : lenis.start(); };
const endIntro = () => { if (introOver) return; introOver = true; lockScroll(false); post.resetMotion(); };
const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' }, onComplete: endIntro }); window.__d5.tl = tl;
tl.to('.d5-veil', { opacity: 0, duration: 1.6, ease: 'power2.inOut', onComplete: () => (introDone = true) }, 0)
  .to(intro, { s: TL, duration: LAPSE, ease: 'none' }, 0.2)
  .to(intro, { s: 1, duration: PULL, ease: 'none' }, 0.2 + LAPSE)
  .from(h1.chars, { opacity: 0, filter: 'blur(14px)', x: (i, el, arr) => (i - arr.length / 2) * 6, duration: 2.2, stagger: { each: 0.035, from: 'center' } }, 0.2 + LAPSE + PULL - 0.8)
  .fromTo('.d5-h1', { letterSpacing: '0.5em' }, { letterSpacing: '0.14em', duration: 3.4, ease: 'expo.out' }, 0.2 + LAPSE + PULL - 0.8)
  .from('.d5-kicker, .d5-lead, .d5-btn', { opacity: 0, y: 16, stagger: 0.15, duration: 1.2 }, 0.2 + LAPSE + PULL + 0.4)
  .from('.d5-nav > *, .d5-hud, .d5-rail', { opacity: 0, duration: 1.4, stagger: 0.1 }, 0.8);
// arriving mid-page (reload, back button) skips straight to orbit
const skip = scrollY > 40;
if (!skip) lockScroll(true);
(window.tfReady || (f => f()))(() => { if (skip) { tl.progress(1); introDone = true; } else tl.play(); });
// any scroll intent during the opening fast-forwards it instead of being swallowed
const hurry = () => { if (!introOver && tl.isActive()) tl.timeScale(4); };
addEventListener('wheel', hurry, { passive: true }); addEventListener('touchmove', hurry, { passive: true }); addEventListener('keydown', hurry);

// cursor: tiny camera drift, like a handheld long lens
const mouse = { x: 0, y: 0 }, ms = { x: 0, y: 0 };
addEventListener('mousemove', e => { mouse.x = e.clientX / innerWidth - 0.5; mouse.y = e.clientY / innerHeight - 0.5; });

const step01 = v => (v > 0.6 ? 1 : 0), tmp2 = new THREE.Vector3(), tmp3 = new THREE.Vector3(), siteT = new THREE.Vector3(), siteDir = new THREE.Vector3();
const pos = new THREE.Vector3(), look = new THREE.Vector3(), tmp = new THREE.Vector3(), clock = new THREE.Clock();
const camUp = new THREE.Vector3(0, 1, 0), NORTH = new THREE.Vector3(0, 0, -1), fwd = new THREE.Vector3();
const spaceMeshes = [planets.earth, planets.clouds, planets.moon, planets.mars, planets.earthAtmo, planets.marsAtmo];
const COLOR_SPACE_SUN = new THREE.Color(0xfff1dc);
let lastMode = '', lastCover = 0, introEndT = -1, visible = true; document.addEventListener('visibilitychange', () => (visible = !document.hidden));
const setClip = (n, f) => { if (cam.near !== n || cam.far !== f) { cam.near = n; cam.far = f; cam.updateProjectionMatrix(); } };
const fmtH = h => { const hh = Math.floor(h), mm = Math.floor((h - hh) * 60); return String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0'); };
renderer.setAnimationLoop(() => {
  if (!visible) return;
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  // the plain page below covers the canvas; once it does, stop drawing
  const cover = after ? clamp01(1 - after.getBoundingClientRect().top / innerHeight) : 0;
  host.style.opacity = (1 - 0.6 * cover).toFixed(3); if (cover > 0 || lastCover > 0) fadeEls.forEach(el => (el.style.opacity = (1 - cover).toFixed(3))); lastCover = cover;
  if (cover >= 0.999) return;
  { const W = 3.6; smV += (W * W * (prog - sm) - 2 * W * smV) * dt; sm += smV * dt; } // critically damped scroll: flicks ramp up and settle, never snap
  ms.x += (mouse.x - ms.x) * dt * 2; ms.y += (mouse.y - ms.y) * dt * 2;
  const introOn = intro.s < 1 && !introOver;
  if (introOn && window.lenis && !lenis.isStopped) lenis.stop();
  if (!introOn && introEndT < 0) introEndT = t;
  const live = introOn ? 0 : sstep(t - introEndT, 0, 2.5); // mouse drift + handheld fade in after the opening lands
  const s = intro.s, zPull = clamp01((s - TL) / (1 - TL)), lam = LAM0 + (LAM1 - LAM0) * smoother(Math.pow(zPull, 0.85));
  const mode = introOn ? (lam < LAMH ? 'site' : 'globe') : (sm >= CA ? 'colony' : 'space');
  const inCol = mode === 'colony', inSite = mode === 'site';
  let fov = 46, focus = 30;
  camUp.set(0, 1, 0);
  if (inSite) {
    // satellite-ish oblique over the lot; drifts a few degrees during the timelapse, then rises and tips straight down for the pull out
    const g = s < TL ? (s / TL) * 0.86 : 0.86 + 0.14 * zPull, up = // the timelapse keeps running while the camera pulls away
      sstep(lam, LAM0, LAM0 + (LAMH - LAM0) * 0.55);
    const a = THREE.MathUtils.lerp(window.__d5.siteYaw ?? (-0.06 + 0.12 * g), SITE_ROT, up), // ends on true north so the globe hand-off keeps its heading
      pitch = THREE.MathUtils.degToRad((window.__d5.sitePitch ?? 58) * (1 - up) + 90 * up) - 0.0001;
    const dist = s < TL ? lapseDist(g) : Math.exp(lam);
    siteT.set(0, -1, 3 * (1 - up));
    siteDir.set(Math.sin(a) * Math.cos(pitch), Math.sin(pitch), Math.cos(a) * Math.cos(pitch));
    tmp.copy(siteT).addScaledVector(siteDir, dist); tmp.x += ms.x * 3 * (1 - up); tmp.z += ms.y * 2 * (1 - up);
    pos.copy(tmp).add(SITE0); look.copy(siteT).add(SITE0);
    camUp.set(-Math.sin(a), 0, -Math.cos(a));                   // screen-up = north, so the hand-off to the globe keeps its heading
    fov = 38; focus = dist;
    setClip(Math.max(0.3, dist * 0.004), dist * 8 + 3000);
    siteInfo = site.update({ g, t }); site.follow(tmp, dist); scene.fog.near = 1e8; scene.fog.far = 1e9;
  } else if (mode === 'globe') {
    // straight up off Austin, then curve round onto the opening frame (C0). Distances stay logarithmic the whole way.
    const D = Math.exp(lam) * U_PER_M, f2 = clamp01((lam - LAMH) / (LAM1 - LAMH)), e = smoother(f2);
    slerpV(AUSn, backEnd, e, tmp); pos.copy(AUS).addScaledVector(tmp, D);
    slerpV(negN, lookEnd, smoother(Math.min(1, f2 * 1.1)), tmp2); look.copy(pos).addScaledVector(tmp2, D);
    fov = THREE.MathUtils.lerp(38, 38, e); focus = D;
    setClip(Math.min(0.1, Math.max(0.0005, D * 0.04)), 9000);
  } else if (inCol) {
    const cg = clamp01((sm - CA) / (1 - CA)), u = cg * (1.5 - 0.5 * cg); // launches out of the flash, settles on the last frame
    cPos.getPoint(u, pos); cLook.getPoint(u, look); pos.x += ms.x * 8; pos.y -= ms.y * 5; fov = 44; focus = pos.distanceTo(look);
    setClip(0.1, 9000);
  } else {
    fov = spaceCam(sm, pos, look); focus = pos.distanceTo(look);
    pos.x += ms.x * 2.2 * live; pos.y -= ms.y * 1.4 * live;
    setClip(0.1, 9000);
  }
  // exposure ride on the pull out: a real camera would stop down while a whole lit city fills the frame, then open back up for orbit
  post.auto.min = introOn ? 0.12 : 0.55; // let the exposure ride below the normal floor during the pull out
  renderer.toneMappingExposure = introOn && zPull > 0 ? 1.05 * (1 - 0.72 * sstep(lam, Math.log(2e3), Math.log(4e4)) * (1 - sstep(lam, Math.log(8e5), Math.log(5e6)))) : 1.05;
  // per-set switches: what is in the world, which light rig, shadow box
  if (mode !== lastMode) {
    const c = sunLight.shadow.camera;
    site.group.visible = inSite; colony.visible = inCol;
    spaceMeshes.forEach(m => (m.visible = !inSite && !inCol));
    if (inSite) { c.left = -160; c.right = 160; c.top = 80; c.bottom = -80; c.near = 50; c.far = 900; ambient.intensity = 0.03; }
    else { c.left = -390; c.right = 390; c.near = 60; c.far = 1300; sunLight.color.copy(COLOR_SPACE_SUN); }
    c.updateProjectionMatrix();
    post.motion.cutDist = mode === 'site' || mode === 'globe' ? 1e12 : 400; // the pull out is one long zoom: keep the blur on through it
    if ((lastMode === 'site' && mode === 'globe') || lastMode === '') post.resetMotion();
    lastMode = mode;
  }
  const sunDir = inCol ? colSun : toSun;
  if (inCol) buildColony(clamp01((sm - CA) / (1 - CA)), t);
  else if (!inSite) { scene.fog.near = 1e8; scene.fog.far = 1e9; sunLight.intensity = 2.4; ambient.intensity = 0.35; hemi.intensity = 0; }
  if (inCol || inSite) renderer.shadowMap.needsUpdate = true;
  else { sunLight.target.position.set(0, 0, 0); sunLight.position.copy(sunDir).multiplyScalar(100); }
  // the one cut left: a warm atmospheric-entry flash into Jezero
  const hIn = sstep(sm, CA - 0.022, CA) * (1 - sstep(sm, CA, CA + 0.026));
  if (introDone) { veil.style.opacity = hIn.toFixed(3); veil.style.background = 'radial-gradient(circle at 50% 55%, #fff4e6 0%, #ffb27a 45%, #c8582a 100%)'; }
  // operator layer: only a faint handheld drift; no springs, no banking, no roll. The curves above are already smooth.
  const dist = pos.distanceTo(look);
  if (!introOn) pos.add(tmp.set(Math.sin(t * 0.21) * 0.6 + Math.sin(t * 0.53 + 1.3) * 0.25, Math.sin(t * 0.17 + 2.1) * 0.5 + Math.sin(t * 0.41) * 0.2, Math.sin(t * 0.13 + 4) * 0.4).multiplyScalar(dist * 0.002 * live));
  cam.up.copy(camUp);
  if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  cam.position.copy(pos); cam.lookAt(look);
  // dust: smoothed camera velocity drives streak length (a short virtual shutter)
  if (hasLast && dt > 0) { velTmp.copy(pos).sub(lastPos).divideScalar(dt); if (velTmp.length() > 4000) velTmp.set(0, 0, 0); camVel.lerp(velTmp, Math.min(1, dt * 6)); }
  lastPos.copy(pos); hasLast = true;
  const shutter = camVel.clone().multiplyScalar(DCFG.shutter).clampLength(0, BOX * DCFG.maxStreak);
  dustU.cp.value.copy(pos); dustU.vel.value.copy(shutter); dustU.t.value = t; dustU.spd.value = Math.min(1, shutter.length() / 6);
  dust.visible = mode === 'space'; dustU.amt.value = 1 - hIn;

  // Earth holds Austin under the opening frame until the pull out lands, then spins on from there
  if (introOn) spinOff = SPIN_LAND - t * EARTH_SPIN;
  planets.update({ t, intro: 1, camPos: pos, spin: spinOff, hole: AUSn });
  if (sky) { sky.update(pos); sky.group.visible = !inCol && !inSite; }

  // sun + streak: off on the ground, cresting the limb as the pull out lands
  const f2 = mode === 'globe' ? clamp01((lam - LAMH) / (LAM1 - LAMH)) : 1;
  sunCore.visible = streak.visible = !inSite;
  sunCore.position.copy(pos).addScaledVector(sunDir, 1600); streak.position.copy(sunCore.position);
  const facing = Math.max(0, tmp.copy(look).sub(pos).normalize().dot(sunDir));
  const flare = sstep(f2, 0.55, 1) * (0.25 + facing * 0.9) * (inCol ? 0.22 * (1 - sstep(colSun.y, 0.02, -0.04)) : 1);
  sunCore.scale.setScalar(260 * flare + 40); streak.scale.set(2600 * flare, 26 * flare, 1);
  streak.material.opacity = 0.55 * flare; sunCore.material.opacity = Math.min(1, flare * 1.3);
  bloom.strength = 0.6 + flare * 0.3;

  // satellite + focus: rack to the look target; deep focus everywhere except the colony
  const sp = sm - SATP; sat.visible = mode === 'space' && Math.abs(sp) < 0.06;
  sat.position.copy(SAT0).addScaledVector(satT, sp * SATV); sat.rotation.set(0.4 + t * 0.05, t * 0.12, 0.25); satBlink.material.opacity = step01(Math.sin(t * 5));
  let fd = focus;
  if (sat.visible) { const sd = pos.distanceTo(sat.position), inFront = tmp.copy(sat.position).sub(pos).normalize().dot(tmp2.copy(look).sub(pos).normalize()); if (sd < 14 && inFront > 0.55) fd = THREE.MathUtils.lerp(fd, sd, sstep(sd, 14, 6)); }
  const deep = inSite || mode === 'globe';
  post.update({ dt, t, focus: fd, aperture: (deep ? 0.0004 : inCol ? 0.006 : fd < 12 ? 0.02 : 0.003) / fd, maxblur: deep ? 0.0008 : inCol ? 0.0042 : fd < 12 ? 0.005 : 0.0018, ca: 0.012 + hIn * 0.06 });

  // overlays
  ovs.forEach(o => { const v = win(sm, o.a, o.b) * (1 - cover); o.el.style.opacity = v.toFixed(3); o.el.style.visibility = v > 0.01 ? 'visible' : 'hidden'; o.el.style.transform = `translate3d(0,${(1 - win(sm, o.a, o.b)) * (sm < o.a ? 30 : -30)}px,0)`; });
  // HUD: on the lot it is a site clock, on the way up an altimeter, in space the zone + AU readout
  if (introOn) {
    if (zone !== -2) { zone = -2; gsap.to(loc, { duration: 0.8, scrambleText: { text: 'Austin · Texas', chars: 'upperCase', speed: 0.6 } }); }
    if (inSite && s < TL && siteInfo) au.textContent = 'DAY ' + String(siteInfo.day).padStart(2, '0') + ' · ' + fmtH(siteInfo.hd);
    else { const km = Math.exp(lam) / 1000; au.textContent = 'ALT ' + (km < 10 ? km.toFixed(1) : Math.round(km).toLocaleString('en-US')) + ' KM'; }
  } else {
    let z = 0; ZONES.forEach((zz, i) => { if (sm >= zz[0]) z = i; });
    if (z !== zone) { zone = z; gsap.to(loc, { duration: 0.8, scrambleText: { text: ZONES[z][1], chars: 'upperCase', speed: 0.6 } }); }
    const a = ZONES[z], b = ZONES[Math.min(z + 1, ZONES.length - 1)], span = (b[0] - a[0]) || 1, cg = clamp01((sm - CA) / (1 - CA));
    // on the surface the readout becomes a sol counter, so the timelapse reads as months of work
    au.textContent = a[3] ? 'SOL ' + String(1 + Math.floor(cg * 667)).padStart(4, '0') : (a[2] + (b[2] - a[2]) * THREE.MathUtils.clamp((sm - a[0]) / span, 0, 1)).toFixed(2) + ' AU';
  }
  fill.style.transform = `scaleY(${sm})`;
  post.render();
});

// rail dots sit at their scroll position and jump there on click
const STOPS = [['Earth', 0], ['Luna', 0.3], ['Mars', 0.47], ['Jezero', 0.72]];
qa('.d5-stop').forEach((s, i) => { if (STOPS[i]) { s.textContent = STOPS[i][0]; s.dataset.p = STOPS[i][1]; } else s.remove(); });
qa('.d5-stop').forEach(s => (s.style.top = (+s.dataset.p * 100) + '%'));
qa('.d5-stop').forEach(s => s.addEventListener('click', e => { e.preventDefault(); const p = +s.dataset.p, y = track.offsetTop + p * (track.offsetHeight - innerHeight); window.lenis ? lenis.scrollTo(y, { duration: 2.4 }) : scrollTo(0, y); }));
