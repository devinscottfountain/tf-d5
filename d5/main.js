// TerraFirma D5: scroll cinematic. Hosted on jsDelivr; the Webflow page only loads this file.
import * as THREE from 'three';
import { createPost } from './post.js';
import { createSky } from './sky.js';
import { createPlanets } from './planets.js';
import { createSaturn } from './saturn.js';
import { createBelt } from './belt.js';
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
const SPREAD = { moon: 1.7, mars: 1.9, belt: 1.9, saturn: 1.8 };
const MOON0 = new THREE.Vector3(26, 6, -42), MARS0 = new THREE.Vector3(-36, -4, -300), SATURN0 = new THREE.Vector3(72, -14, -1160);
const EARTH = new THREE.Vector3(0, 0, 0), MOON = MOON0.clone().multiplyScalar(SPREAD.moon), MARS = MARS0.clone().multiplyScalar(SPREAD.mars), SATURN = SATURN0.clone().multiplyScalar(SPREAD.saturn);
const dMoon = MOON.clone().sub(MOON0), dMars = MARS.clone().sub(MARS0), dSat = SATURN.clone().sub(SATURN0);
// Earth/Moon/Mars: user color maps + NASA night lights, clouds w/ shadows, ocean glint, relief, single-scatter atmospheres
const planets = createPlanets({ THREE, scene, renderer, toSun, EARTH, MOON, MARS, assetBase: ASSETS });
const { earth, moon, mars } = planets;
planets.moon.material.uniforms.uRelief.value = 0.35; planets.mars.material.uniforms.uRelief.value = 0.4; // relief is synthesized, keep it a whisper so the real maps lead
// Saturn: real map, ring strip, ring shadow on the planet + planet shadow on the rings
const saturnMod = createSaturn({ THREE, scene, toSun, SATURN, assetBase: ASSETS });

// sky: real HYG star catalog (12.5k stars, true colors) + Gaia Milky Way, drawn at infinity
let sky = null;
createSky({ THREE, scene, assetBase: ASSETS, milkyWayIntensity: 0.14 }).then(s => (sky = s)).catch(() => {});

// the belt: instanced lumpy rocks the camera threads through
const sunLight = new THREE.DirectionalLight(0xfff1dc, 2.4); sunLight.position.copy(toSun).multiplyScalar(100); scene.add(sunLight, sunLight.target, new THREE.AmbientLight(0x223044, 0.35));
// belt: displaced, triplanar-textured rock variants tumbling in the vertex shader
const belt = createBelt({ THREE, scene, SPREAD }), rocks = belt.rocks;

// ---------- Jezero Base: close-up construction timelapse on the Mars surface ----------
// lives far below the solar system inside its own sky dome; the camera cuts to it behind an entry flash
const COL = new THREE.Vector3(0, -6000, 0);
const colony = new THREE.Group(); colony.position.copy(COL); colony.visible = false; scene.add(colony);
const hemi = new THREE.HemisphereLight(0xffc896, 0x5a2a14, 1.4); colony.add(hemi); // dusty sky bounce so facades aren't black
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

// ---------- camera path: [scroll progress, position, look target] ----------
// opening shot: camera on Earth's night side, looking toward the sun, raised just enough that
// the sun sits right behind the top limb. upP = "up" with the sun direction removed.
const upP = new THREE.Vector3(0, 1, 0).addScaledVector(toSun, -toSun.y).normalize();
const C0 = EARTH.clone().addScaledVector(toSun, -23).addScaledVector(upP, 10.4);
const L0 = C0.clone().addScaledVector(toSun, 60).addScaledVector(upP, -9);
const sh = (p, d, k = 1) => [p[0] + d.x * k, p[1] + d.y * k, p[2] + d.z * k]; // shift a key along with its planet
const DIVE = MARS.clone().addScaledVector(new THREE.Vector3(22, 6, 32).normalize(), 7.4);
const K = [
  [0.00, C0.toArray(), L0.toArray()],       // night side, city lights below, sun cresting the limb
  [0.10, [5, 9.5, 36], [0, 1.5, 0]],
  [0.20, [-14, 14, 62], sh([8, 0, -14], dMoon, 0.5)], // Earth + Moon together
  [0.30, sh([17, 9, -16], dMoon), sh([26, 6, -42], dMoon)], // Moon flyby
  [0.42, sh([-14, 2, -268], dMars), sh([-36, -4, -300], dMars)], // Mars
  [0.46, DIVE.toArray(), MARS.toArray()],   // diving at the surface, entry flash hides the cut to Jezero
  [0.64, [-4, 3, -430 * SPREAD.belt], [6, 0, -600 * SPREAD.belt]], // back in space at the belt edge (cut through black)
  [0.72, [8, 2, -620 * SPREAD.belt], [14, 0, -760 * SPREAD.belt]],  // threading the belt
  [0.80, sh([-30, 20, -880], dSat), sh([8, -14, -1184], dSat)], // Saturn reveal, planet pushed right of the type
  [0.90, sh([-20, 34, -975], dSat), sh([24, -18, -1186], dSat)],
  [1.00, sh([-180, 120, -820], dSat), sh([60, 66, -1160], dSat)] // wide pull-out, Saturn drops below the CTA
];
const posC = new THREE.CatmullRomCurve3(K.map(k => new THREE.Vector3(...k[1])), false, 'centripetal');
const lookC = new THREE.CatmullRomCurve3(K.map(k => new THREE.Vector3(...k[2])), false, 'centripetal');
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
const SATP = 0.252; // scroll point where it passes the lens
const toU = p => { for (let i = 0; i < K.length - 1; i++) if (p <= K[i + 1][0]) return (i + (p - K[i][0]) / (K[i + 1][0] - K[i][0])) / (K.length - 1); return 1; };
// anchor: just right of and below the lens path at SATP; it drifts along the path slower than the camera so the pass lasts
const satT = posC.getTangent(toU(SATP)).normalize(), satR = new THREE.Vector3().crossVectors(satT, new THREE.Vector3(0, 1, 0)).normalize();
const SAT0 = posC.getPoint(toU(SATP)).addScaledVector(satR, 2.8).add(new THREE.Vector3(0, -0.9, 0));

// ---------- scroll + overlays ----------
let prog = 0, sm = 0;
window.__d5.seek = p => (sm = p); // QA hook: jump the eased scroll straight to a progress value
const track = q('.d5-track');
ScrollTrigger.create({ trigger: track, start: 'top top', end: 'bottom bottom', onUpdate: s => (prog = s.progress) });
// each overlay owns a scroll window [a, b]; it rises in, holds, then drifts out
const ovs = qa('[data-w]').map(el => { const [a, b] = el.dataset.w.split(',').map(Number); return { el, a, b}; });
// scroll windows live here (not in the markup) so pacing can be tuned in one place
const WIN = { 'd5-mission': [0.34, 0.445], 'd5-belt': [0.515, 0.62], 'd5-sol': [0.79, 0.965] };
ovs.forEach(o => { const w = WIN[o.el.classList[0]]; if (w) [o.a, o.b] = w; });
const CA = 0.46, CB = 0.64; // colony segment
const win = (p, a, b, f = 0.035) => Math.min(THREE.MathUtils.smoothstep(p, a - f, a + f), 1 - THREE.MathUtils.smoothstep(p, b - f, b + f));
const ZONES = [[0, 'Sol · Earth', 1.0], [0.25, 'Earth · Luna', 1.003], [0.36, 'Sol · Mars', 1.52], [CA, 'Mars · Jezero Base', 1.52, 1], [CB, 'The Belt', 2.77], [0.75, 'Sol · Saturn', 9.54]];
const veil = q('.d5-veil'), loc = q('.d5-loc'), au = q('.d5-au'), fill = q('.d5-rail-fill');
let zone = -1;

// ---------- load: black veil lifts, title tracks in from wide spacing, sun crests ----------
const intro = { t: 0 };
// runs once fonts are in (site-wide gate), so the split measures the real typeface
const h1 = new SplitText('.d5-h1', { type: 'chars,words' });
const tl = gsap.timeline({ paused: true, defaults: { ease: 'power3.out' } });
(window.tfReady || (f => f()))(() => tl.play());
let introDone = false;
tl.to('.d5-veil', { opacity: 0, duration: 2.2, ease: 'power2.inOut', onComplete: () => (introDone = true) })
  .to(intro, { t: 1, duration: 4.2, ease: 'power2.out' }, 0)
  .from(h1.chars, { opacity: 0, filter: 'blur(14px)', x: (i, el, arr) => (i - arr.length / 2) * 6, duration: 2.2, stagger: { each: 0.035, from: 'center' } }, 1.0)
  .fromTo('.d5-h1', { letterSpacing: '0.5em' }, { letterSpacing: '0.14em', duration: 3.4, ease: 'expo.out' }, 1.0)
  .from('.d5-kicker, .d5-lead, .d5-btn', { opacity: 0, y: 16, stagger: 0.15, duration: 1.2 }, 2.2)
  .from('.d5-nav > *, .d5-hud, .d5-rail', { opacity: 0, duration: 1.4, stagger: 0.1 }, 2.6);

// cursor: tiny camera drift, like a handheld long lens
const mouse = { x: 0, y: 0 }, ms = { x: 0, y: 0 };
addEventListener('mousemove', e => { mouse.x = e.clientX / innerWidth - 0.5; mouse.y = e.clientY / innerHeight - 0.5; });

const step01 = v => (v > 0.6 ? 1 : 0), tmp2 = new THREE.Vector3();
const pos = new THREE.Vector3(), look = new THREE.Vector3(), tmp = new THREE.Vector3(), clock = new THREE.Clock();
let visible = true; document.addEventListener('visibilitychange', () => (visible = !document.hidden));
renderer.setAnimationLoop(() => {
  if (!visible) return;
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  sm += (prog - sm) * Math.min(1, dt * 3.2);                 // eased scroll so the dolly feels heavy
  ms.x += (mouse.x - ms.x) * dt * 2; ms.y += (mouse.y - ms.y) * dt * 2;
  const inCol = sm >= CA && sm < CB, cg = clamp01((sm - CA) / (CB - CA));
  if (inCol) { cPos.getPoint(cg, pos); cLook.getPoint(cg, look); pos.x += ms.x * 8; pos.y -= ms.y * 5; }
  else {
    const u = toU(sm);
    posC.getPoint(u, pos); lookC.getPoint(u, look);
    // intro: camera starts a touch lower (sun hidden behind Earth) and rises so the sun crests the limb
    const ip = 1 - intro.t; pos.addScaledVector(upP, -ip * 1.6).addScaledVector(toSun, -ip * 4);
    pos.x += ms.x * 2.2; pos.y -= ms.y * 1.4;
  }
  colony.visible = inCol;
  const sunDir = inCol ? colSun : toSun;
  if (inCol) buildColony(cg, t);
  else { scene.fog.near = 1e8; scene.fog.far = 1e9; sunLight.intensity = 2.4; ambient.intensity = 0.35; }
  // shadows: the colony set owns its own sun placement (buildColony); in space keep the original far-sun placement and render no shadow map at all
  if (inCol) renderer.shadowMap.needsUpdate = true;
  else { sunLight.target.position.set(0, 0, 0); sunLight.position.copy(sunDir).multiplyScalar(100); }
  // cuts: warm atmospheric-entry flash going down, hard black going back out to space
  const hIn = sstep(sm, CA - 0.022, CA) * (1 - sstep(sm, CA, CA + 0.026)), hOut = sstep(sm, CB - 0.016, CB) * (1 - sstep(sm, CB, CB + 0.02));
  if (introDone) { veil.style.opacity = Math.max(hIn, hOut).toFixed(3); veil.style.background = hIn > hOut ? 'radial-gradient(circle at 50% 55%, #fff4e6 0%, #ffb27a 45%, #c8582a 100%)' : '#000'; }
  cam.position.copy(pos); cam.lookAt(look);
  // dust: smoothed camera velocity drives streak length (a short virtual shutter); cuts reset it so nothing smears across them
  if (hasLast && dt > 0) { velTmp.copy(pos).sub(lastPos).divideScalar(dt); if (velTmp.length() > 4000) velTmp.set(0, 0, 0); camVel.lerp(velTmp, Math.min(1, dt * 6)); }
  lastPos.copy(pos); hasLast = true;
  const shutter = camVel.clone().multiplyScalar(DCFG.shutter).clampLength(0, BOX * DCFG.maxStreak);
  dustU.cp.value.copy(pos); dustU.vel.value.copy(shutter); dustU.t.value = t; dustU.spd.value = Math.min(1, shutter.length() / 6);
  dust.visible = !inCol; dustU.amt.value = 1 - Math.max(hIn, hOut);

  planets.update({ t, intro: intro.t, camPos: pos }); saturnMod.update({ t }); belt.update({ t }); // spins, clouds, city lights spreading on load
  rocks.rotation.z = Math.sin(t * 0.05) * 0.02;
  if (sky) { sky.update(pos); sky.group.visible = !inCol; }

  // sun always sits far along toSun from the camera; the streak stays horizontal and grows on load
  sunCore.position.copy(pos).addScaledVector(sunDir, 1600); streak.position.copy(sunCore.position);
  const facing = Math.max(0, tmp.copy(look).sub(pos).normalize().dot(sunDir));
  const flare = (0.35 + 0.65 * intro.t) * (0.25 + facing * 0.9) * (inCol ? 0.22 * (1 - sstep(colSun.y, 0.02, -0.04)) : 1);
  sunCore.scale.setScalar(260 * flare + 40); streak.scale.set(2600 * flare, 26 * flare, 1);
  streak.material.opacity = 0.55 * flare; sunCore.material.opacity = Math.min(1, flare * 1.3);
  bloom.strength = 0.6 + flare * 0.3;

  // camera: rack focus to the look target; shallower depth on the surface, deep focus in space so stars survive
  const sp = sm - SATP; sat.visible = !inCol && Math.abs(sp) < 0.06;
  sat.position.copy(SAT0).addScaledVector(satT, sp * 420); sat.rotation.set(0.4 + t * 0.05, t * 0.12, 0.25); satBlink.material.opacity = step01(Math.sin(t * 5));
  let fd = pos.distanceTo(look);
  // focus puller grabs the satellite while it is close and in front of the lens
  if (sat.visible) { const sd = pos.distanceTo(sat.position), inFront = tmp.copy(sat.position).sub(pos).normalize().dot(tmp2.copy(look).sub(pos).normalize()); if (sd < 14 && inFront > 0.55) fd = THREE.MathUtils.lerp(fd, sd, sstep(sd, 14, 6)); }
  post.update({ dt, t, focus: fd, aperture: (inCol ? 0.006 : fd < 12 ? 0.02 : 0.003) / fd, maxblur: inCol ? 0.0042 : fd < 12 ? 0.005 : 0.0018,
    ca: 0.012 + Math.max(hIn, hOut) * 0.06 }); // fringing blows out through the cuts

  // overlays
  ovs.forEach(o => { const v = win(sm, o.a, o.b); o.el.style.opacity = v.toFixed(3); o.el.style.visibility = v > 0.01 ? 'visible' : 'hidden'; o.el.style.transform = `translate3d(0,${(1 - v) * (sm < o.a ? 30 : -30)}px,0)`; });
  // HUD: location rescrambles per zone, AU counter tracks the flight
  let z = 0; ZONES.forEach((zz, i) => { if (sm >= zz[0]) z = i; });
  if (z !== zone) { zone = z; gsap.to(loc, { duration: 0.8, scrambleText: { text: ZONES[z][1], chars: 'upperCase', speed: 0.6 } }); }
  const a = ZONES[z], b = ZONES[Math.min(z + 1, ZONES.length - 1)], span = (b[0] - a[0]) || 1;
  // on the surface the readout becomes a sol counter, so the timelapse reads as months of work
  au.textContent = a[3] ? 'SOL ' + String(1 + Math.floor(cg * 667)).padStart(4, '0') : (a[2] + (b[2] - a[2]) * THREE.MathUtils.clamp((sm - a[0]) / span, 0, 1)).toFixed(2) + ' AU';
  fill.style.transform = `scaleY(${sm})`;
  post.render();
});

// rail dots sit at their scroll position and jump there on click
{ const st = qa('.d5-stop')[2]; if (st) { st.textContent = 'Jezero'; st.dataset.p = '0.55'; } }
qa('.d5-stop').forEach(s => (s.style.top = (+s.dataset.p * 100) + '%'));
qa('.d5-stop').forEach(s => s.addEventListener('click', e => { e.preventDefault(); const p = +s.dataset.p, y = track.offsetTop + p * (track.offsetHeight - innerHeight); window.lenis ? lenis.scrollTo(y, { duration: 2.4 }) : scrollTo(0, y); }));
