// Asteroid belt for the TerraFirma D5 scroll cinematic.
// createBelt({ THREE, scene, SPREAD }) -> { rocks (Group of InstancedMesh), update({ t }) }
// 6 procedural rock geometries (subdivided icosphere + layered noise), one shared material,
// 1600 instances. Tumble runs in the vertex shader (zero CPU cost per frame).
// Scene lights are owned by the caller (the page already has a sun DirectionalLight + ambient).

const ROCKS = 1600;

// ---------- deterministic helpers ----------
function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

// 3D value noise on an integer lattice hash (seeded per rock variant)
function makeNoise(seed) {
  const hash = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; };
  const sm = t => t * t * (3 - 2 * t);
  return (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = sm(x - xi), fy = sm(y - yi), fz = sm(z - zi);
    const l = (a, b, t) => a + (b - a) * t;
    return l(l(l(hash(xi, yi, zi), hash(xi + 1, yi, zi), fx), l(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), fx), fy),
             l(l(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), fx), l(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), fx), fy), fz) * 2 - 1;
  };
}

// Variant recipes: icosphere detail, stretch (elongation), lump (low freq), crag (ridged mid freq), grit (high freq), craters, bend
const VARIANTS = [
  { detail: 4, stretch: [1.00, 0.85, 0.95], lump: 0.30, crag: 0.10, grit: 0.035, craters: 3, bend: 0 },    // lumpy potato
  { detail: 4, stretch: [1.05, 0.90, 1.00], lump: 0.18, crag: 0.26, grit: 0.050, craters: 2, bend: 0 },    // angular, craggy
  { detail: 4, stretch: [2.00, 0.75, 0.80], lump: 0.22, crag: 0.12, grit: 0.040, craters: 2, bend: 0.10 }, // long shard
  { detail: 4, stretch: [1.35, 0.55, 1.05], lump: 0.20, crag: 0.18, grit: 0.040, craters: 4, bend: 0 },    // flat slab
  { detail: 6, stretch: [1.00, 0.92, 0.96], lump: 0.16, crag: 0.14, grit: 0.040, craters: 6, bend: 0 },    // hero: cratered
  { detail: 6, stretch: [1.65, 0.80, 0.78], lump: 0.26, crag: 0.20, grit: 0.045, craters: 3, bend: 0.18 }  // hero: elongated, twisted
];

function buildRockGeometry(THREE, v, idx) {
  const rnd = mulberry32(1000 + idx * 77), noise = makeNoise(11 + idx * 13);
  const g = new THREE.IcosahedronGeometry(1, v.detail);   // non-indexed; displacement is a pure function of position so no cracks
  const pos = g.attributes.position, n = pos.count, ao = new Float32Array(n);
  // crater list: direction, angular radius, depth
  const craters = [];
  for (let i = 0; i < v.craters; i++) { const d = new THREE.Vector3(rnd() - .5, rnd() - .5, rnd() - .5).normalize(); craters.push({ d, r: 0.25 + rnd() * 0.35, depth: 0.06 + rnd() * 0.10 }); }
  const p = new THREE.Vector3(), f = 1.1 + idx * 0.07;
  let maxR = 0;
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(pos, i).normalize();
    const x = p.x, y = p.y, z = p.z;
    // layered displacement along the radial direction
    let h = noise(x * 1.2 * f + 5, y * 1.2 * f, z * 1.2 * f) * v.lump * 1.4;               // big lumps
    h += (1 - Math.abs(noise(x * 3.1 * f, y * 3.1 * f + 9, z * 3.1 * f))) * v.crag - v.crag * 0.5; // ridged: sharp creases
    h += noise(x * 7.7, y * 7.7, z * 7.7 + 3) * v.grit;                                     // grit
    if (v.detail > 6) h += noise(x * 17, y * 17 + 2, z * 17) * v.grit * 0.45; // only where the mesh can resolve it
    // impact craters: dished bowl with a raised rim
    let cr = 0;
    for (const c of craters) { const a = Math.acos(Math.min(1, p.dot(c.d))) / c.r; if (a < 1.25) { const bowl = a < 1 ? -(1 - a * a) : 0, rim = Math.exp(-Math.pow((a - 1.05) * 5, 2)) * 0.35; cr += (bowl + rim) * c.depth; } }
    h += cr;
    let r = 1 + h;
    // sheared bend for the twisted shapes
    let X = x * r * v.stretch[0], Y = y * r * v.stretch[1], Z = z * r * v.stretch[2];
    if (v.bend) Y += v.bend * X * X * 0.6 - v.bend * 0.3;
    pos.setXYZ(i, X, Y, Z);
    ao[i] = Math.max(0.35, Math.min(1, 0.72 + h * 1.6)); // low spots (crater floors, creases) read darker
    maxR = Math.max(maxR, Math.hypot(X, Y, Z));
  }
  // normalise so the farthest vertex sits at radius 1 (keeps instance scale meaningful)
  for (let i = 0; i < n; i++) pos.setXYZ(i, pos.getX(i) / maxR, pos.getY(i) / maxR, pos.getZ(i) / maxR);
  g.setAttribute('aAo', new THREE.BufferAttribute(ao, 1));
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}

// small tileable fbm noise texture, sampled triplanar in the fragment shader (r: coarse, g: medium, b: fine, a: height)
function buildNoiseTexture(THREE, N = 128) {
  const data = new Uint8Array(N * N * 4), rnd = mulberry32(4242);
  const lat = (period, seed) => { const g = new Float32Array(period * period); const r = mulberry32(seed); for (let i = 0; i < g.length; i++) g[i] = r(); return (x, y) => { // tileable value noise
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = g[((yi % period + period) % period) * period + ((xi % period + period) % period)], b = g[((yi % period + period) % period) * period + (((xi + 1) % period + period) % period)];
    const c = g[(((yi + 1) % period + period) % period) * period + ((xi % period + period) % period)], d = g[(((yi + 1) % period + period) % period) * period + (((xi + 1) % period + period) % period)];
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy; }; };
  const n4 = lat(4, 1), n8 = lat(8, 2), n16 = lat(16, 3), n32 = lat(32, 4), n64 = lat(64, 5);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = x / N, v = y / N, i = (y * N + x) * 4;
    const coarse = n4(u * 4, v * 4) * 0.6 + n8(u * 8, v * 8) * 0.4;
    const mid = n16(u * 16, v * 16) * 0.6 + n32(u * 32, v * 32) * 0.4;
    const fine = n32(u * 32, v * 32) * 0.5 + n64(u * 64, v * 64) * 0.5;
    const height = (coarse * 0.3 + mid * 0.4 + fine * 0.3);
    data[i] = coarse * 255; data[i + 1] = mid * 255; data[i + 2] = fine * 255; data[i + 3] = Math.min(255, height * 255);
  }
  void rnd;
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.needsUpdate = true; return t;
}

export function createBelt({ THREE, scene, SPREAD }) {
  const rnd = mulberry32(90210);
  const geos = VARIANTS.map((v, i) => buildRockGeometry(THREE, v, i));
  const uniforms = { uTime: { value: 0 }, uNoise: { value: buildNoiseTexture(THREE) } };

  // one shared material: standard PBR + triplanar noise albedo/bump + vertex-shader tumble
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, flatShading: true });
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec4 aSpin; attribute float aAo; // aSpin: axis.xyz (unit) + angular speed rad/s
        uniform float uTime; varying vec3 vRock; varying float vAo; varying float vSeed;
        vec3 rotAxis(vec3 v, vec3 k, float a){ float c=cos(a), s=sin(a); return v*c + cross(k,v)*s + k*dot(k,v)*(1.-c); }`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vRock = position; vAo = aAo; vSeed = fract(aSpin.x*91.7 + aSpin.y*37.3 + aSpin.w*511.);   // object space, spins with the rock
        transformed = rotAxis(transformed, aSpin.xyz, aSpin.w*uTime);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D uNoise; varying vec3 vRock; varying float vAo; varying float vSeed;
        // triplanar sample; weights come from the radial direction so they vary smoothly across faces
        vec4 tri(vec3 p, vec3 w){ return texture2D(uNoise,p.yz)*w.x + texture2D(uNoise,p.zx)*w.y + texture2D(uNoise,p.xy)*w.z; }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 on=normalize(vRock); vec3 tw=pow(abs(on),vec3(3.)); tw/=tw.x+tw.y+tw.z;
        vec3 tp=vRock*0.9+vSeed*7.;
        vec4 tA=tri(tp,tw), tB=tri(tp*3.1,tw);
        float vary=0.55+0.9*tA.r;                       // broad albedo patches
        vary*=0.8+0.4*tB.g;                             // mottling
        // dark/brownish vs lighter greyish patches
        vec3 tint=mix(vec3(0.90,0.82,0.74), vec3(1.08,1.04,1.0), smoothstep(0.35,0.7,tA.g));
        diffuseColor.rgb*=vary*tint*vAo;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { // micro relief: bump from triplanar height via screen-space derivatives (perturbNormalArb)
          float hgt=(tri(tp*5.7,tw).a*0.65+tri(tp*17.,tw).b*0.35)*0.045;
          vec3 sx=dFdx(-vViewPosition), sy=dFdy(-vViewPosition);
          float dBx=dFdx(hgt), dBy=dFdy(hgt);
          vec3 r1=cross(sy,normal), r2=cross(normal,sx); float det=dot(sx,r1);
          vec3 grad=sign(det)*(dBx*r1+dBy*r2);
          normal=normalize(abs(det)*normal-grad);
        }`);
  };
  mat.customProgramCacheKey = () => 'd5-belt-rock-v1';

  // ---------- instance placement: same distribution as the original ----------
  // assign each rock a variant; big rocks get the high-detail "hero" variants
  const lists = geos.map(() => []);
  const rows = [];
  for (let i = 0; i < ROCKS; i++) {
    const z = (-440 - rnd() * 300) * SPREAD.belt, side = rnd() < 0.5 ? -1 : 1, off = 9 + Math.pow(rnd(), 1.3) * 130;
    const x = side * off + 6, y = (rnd() - 0.5) * 50 * rnd();   // corridor stays clear around x ~ 6
    const s = 0.2 + Math.pow(rnd(), 4) * 5 * Math.min(1, off / 40);
    const vi = s > 1.4 ? 4 + Math.floor(rnd() * 2) : Math.floor(rnd() * 4);
    rows.push({ x, y, z, s, vi }); lists[vi].push(rows.length - 1);
  }

  const group = new THREE.Group(); group.name = 'asteroid-belt';
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), P = new THREE.Vector3(), S = new THREE.Vector3(), col = new THREE.Color();
  geos.forEach((geo, vi) => {
    const ids = lists[vi], count = Math.max(1, ids.length);
    const mesh = new THREE.InstancedMesh(geo, mat, count); mesh.count = ids.length;
    const spin = new Float32Array(count * 4);
    ids.forEach((id, k) => {
      const r = rows[id];
      e.set(rnd() * 6.283, rnd() * 6.283, rnd() * 6.283); q.setFromEuler(e);
      // mild non-uniform squash per instance so repeated variants differ
      S.set(r.s * (0.85 + rnd() * 0.3), r.s * (0.85 + rnd() * 0.3), r.s * (0.85 + rnd() * 0.3));
      m4.compose(P.set(r.x, r.y, r.z), q, S); mesh.setMatrixAt(k, m4);
      // warm-grey palette with per-rock value variation
      const l = 0.30 + rnd() * 0.22, warm = rnd(); col.setRGB(l * (0.95 + warm * 0.18), l * (0.88 + warm * 0.05), l * (0.78 - warm * 0.06)); mesh.setColorAt(k, col);
      // slow tumble: unit axis + speed (rad/s), small rocks spin faster
      const ax = new THREE.Vector3(rnd() - .5, rnd() - .5, rnd() - .5).normalize(), sp = (0.02 + rnd() * 0.10) / Math.sqrt(Math.max(0.3, r.s)) * (rnd() < 0.5 ? -1 : 1);
      spin.set([ax.x, ax.y, ax.z, sp], k * 4);
    });
    geo.setAttribute('aSpin', new THREE.InstancedBufferAttribute(spin, 4));
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere(); mesh.name = 'rocks-v' + vi;
    group.add(mesh);
  });
  scene.add(group);

  return { rocks: group, update({ t }) { uniforms.uTime.value = t; } };
}
