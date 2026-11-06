// D6 hero: the night site through the glass. Displaced dirt terrain with berms and spoil piles, ridgelines,
// blue-hour sky dome, the hero machines (excavator, dozer, haul truck, loader, light towers) under warm work lights.
// The room floor sits 1 m above the site; the camera looks along -z.
// Terrain is a non-uniform grid: 0.6 m cells over the worked yard (the stepped dig, ruts, spoil, berm read as real
// relief), opening out to 6 m toward the hills.
import { buildMachines, bakeStatic, attachShroud } from './hero-model-machines.js';
import { NOISE, rng, sstep } from './hero-glsl.js';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { texBinder, placeholders } from './hero-model-kit.js';
import { buildSite } from './hero-model-site.js';

export const G0 = -1.0;
const TEX_DIRT = 4; // metres per dirt_ground tile
const RIDGE_TEX = 36; // metres per rock_ridge tile on the far ridges (strata read at 500-900 m)
const RIDGE_MEAN = [0.212, 0.092, 0.034]; // linear mean of rock_ridge_c (cliff_side), divided out of the ridge tint

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
  const ridged = (x, z, cx, cz, rx, rz, h) => { const d = Math.sqrt(((x - cx) / rx) ** 2 + ((z - cz) / rz) ** 2); return d >= 1 ? 0 : h * Math.pow(1 - d * d, 1.4); }; // berm: flat-topped, steep-sided
  const fine = makeNoise(53);
  // the dig: an elliptical pit cut in three benches (0.7 m lifts, battered walls), rubble on the floor and benches
  const DIG = [0, -47.5, 10, 6.5];
  const dig = (x, z) => { const d = Math.hypot((x - DIG[0]) / DIG[2], (z - DIG[1]) / DIG[3]); if (d > 1.2) return 0;
    const lv = Math.max(0, (1.2 - d) / 1.2) * 3.4, k = Math.floor(lv), f = lv - k, depth = Math.min(3, k + sstep(0.6, 0.95, f)) * 0.7;
    return -depth + (fine(x * 0.45, z * 0.45, 2) - 0.5) * 0.2 * Math.min(1, lv) - (d < 0.35 ? 0.15 : 0); };
  // haul-road ruts: twin tyre grooves with squeezed-up shoulders (same centreline the shader's road mask uses)
  const ruts = (x, z) => { if (z > -33 || z < -98) return 0; const c = -6 + 0.2 * (z + 44) + 3 * Math.sin(z * 0.08), e = Math.abs(x - c); if (e > 3) return 0;
    const g = q => Math.exp(-(q * q)); let y = 0; for (const o of [-1.15, 1.15]) { const q = (x - c - o) / 0.28; y += -0.14 * g(q) + 0.05 * g((x - c - o) / 0.5 - Math.sign(q) * 1.1); }
    return y * sstep(-33, -38, z); };
  // stockpiles: smooth cones at the angle of repose with slumped lobes, a soft crest, a rolled toe and erosion runnels down the
  // flanks; one is cut flat on top where the loader has been working it. [x, z, R, h, flatTop 0..1, seed]
  const PILES = [[23, -58.5, 7.5, 2.9, 0, 1], [30, -66, 5.5, 2.0, 0, 2], [-31, -61, 7, 2.6, 0.5, 3], [-2, -78, 5, 2.0, 0, 4]];
  const pile = (x, z, [cx, cz, R, h, flat, sd]) => {
    const dx = x - cx, dz = z - cz, a = Math.atan2(dz, dx), r0 = Math.hypot(dx, dz) / R;
    if (r0 > 1.35) return 0;
    const lobe = 1 + 0.07 * Math.sin(3 * a + sd * 1.7) + 0.04 * Math.sin(5 * a + sd * 2.9) + 0.025 * Math.sin(9 * a + sd);
    const d = r0 / lobe, crest = 0.14 + 0.4 * flat;
    let y = d < crest ? 1 : Math.max(0, (1 - d) / (1 - crest));
    y = y * y * (3 - 2 * y) * 0.35 + y * 0.65;                                             // soft crest, straight repose flank, rolled toe
    if (d > 0.98) y = 0.05 * sstep(1.3, 0.98, d);                                          // slumped apron
    let ru = 0; for (let k = 0; k < 7; k++) { const ak = sd * 2.3 + k * 0.9 + 0.25 * Math.sin(k * 3.1 + sd), w = Math.abs(Math.atan2(Math.sin(a - ak - 0.15 * d), Math.cos(a - ak - 0.15 * d))) * d * R;
      ru += Math.exp(-((w / 0.32) ** 2)) * (0.6 + 0.4 * Math.sin(k + sd)); }               // runnels, deepest mid-flank
    y = y * h * (1 - 0.18 * flat) - ru * 0.16 * sstep(crest, 0.45, d) * sstep(1.0, 0.7, d);
    if (flat) y += (fine(x * 0.5, z * 0.5, 2) - 0.5) * 0.06 * sstep(crest + 0.1, crest - 0.05, d);  // bucket-scraped top
    return y;
  };
  // tyre / track marks: twin grooves with squeezed-up lips, from a to b; they run up the berms and over a stockpile
  const MARKS = [[-30, -68, -27, -82, 1.0], [-12, -69, -10, -84, 0.94], [5, -74, 7, -88, 1.0], [-44, -64, -48, -79, 0.94], [16, -55, 21, -58.5, 0.94], [-24, -54, -29, -60, 1.0]];
  const marks = (x, z) => { let y = 0;
    for (const [ax, az, bx, bz, half] of MARKS) { const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz, t = ((x - ax) * vx + (z - az) * vz) / L2;
      if (t < -0.05 || t > 1.05) continue; const e = ((x - ax) * vz - (z - az) * vx) / Math.sqrt(L2), fade = sstep(-0.05, 0.1, t) * sstep(1.05, 0.85, t);
      for (const o of [-half, half]) { const q = (e - o) / 0.32; y += fade * (-0.09 * Math.exp(-q * q) + 0.035 * Math.exp(-((Math.abs(q) - 1.6) ** 2) * 2)); } }
    return y; };
  const raw = (x, z) => {
    let y = (fbm(x * 0.04, z * 0.04) - 0.5) * 0.8;
    y += ridged(x, z, -22, -76, 30, 5.5, 2.6) + ridged(x, z, -50, -72, 18, 6, 3.2) + ridged(x, z, 6, -83, 20, 4.5, 1.9);  // long berm behind the pad
    for (const P of PILES) y += pile(x, z, P);
    y += dig(x, z) + ruts(x, z) + marks(x, z);
    y += bump(x, z, 30, -40, 12, 4, 0.9) + bump(x, z, -14, -36, 10, 3, 0.7);                                      // foreground windrows
    y += (fine(x * 0.35, z * 0.35, 2) - 0.5) * 0.06 * sstep(-28, -40, z) * sstep(-110, -90, z);                     // gentle yard undulation
    const far = Math.max(0, -z - 90); y += far * 0.06 + (fbm(x * 0.012 + 3, z * 0.012) - 0.4) * far * 0.12;        // land rises toward the hills
    return y * (0.85 + 0.3 * fbm(x * 0.2, z * 0.2, 2));
  };
  // level pads under the machines so the tracks sit flat
  const pads = [[10.5, -50, 6], [-8, -54, 5.5], [-24, -70, 6], [-20, -60, 4.5]].map(([x, z, r]) => [x, z, r, raw(x, z)]);
  const hgt = (x, z) => { let y = raw(x, z); for (const [px, pz, r, py] of pads) { const d = Math.hypot(x - px, z - pz); if (d < r) y += (py - y) * sstep(r, r * 0.55, d); } return y; };

  // terrain: non-uniform grid, dense over the yard
  const axis = (a0, a1, segs) => { const v = [a0]; for (const [end, step] of segs) { const n = Math.max(1, Math.round((end - v[v.length - 1]) / step)), s0 = v[v.length - 1]; for (let i = 1; i <= n; i++) v.push(s0 + (end - s0) * i / n); } return v; };
  const fineStep = high ? 0.7 : 1.4;
  const XS = axis(-210, 210, [[-75, 6], [-55, 2], [55, fineStep], [75, 2], [210, 6]]);
  const ZS = axis(-425, -5, [[-260, 6], [-150, 3], [-108, 2], [-32, fineStep], [-5, high ? 1.2 : 2]]);
  // stones and clods are merged into the terrain mesh itself (same dirt material and texture roles, no extra draw):
  // angular convex stones half-buried with a contact darkening baked into the ground, broken clods along the dig lip.
  // aGd = (occlusion multiplier, stone 0..1) per vertex; the ground also gets crevice darkening from its own curvature.
  const rr = rng(97), V = THREE.Vector3;
  const proto = (n, sx, sy, sz) => { const pts = []; for (let i = 0; i < n; i++) { const u = rr() * 2 - 1, a = rr() * Math.PI * 2, q = Math.sqrt(1 - u * u), k = 0.85 + rr() * 0.2; pts.push(new V(q * Math.cos(a) * sx * k, u * sy * k, q * Math.sin(a) * sz * k)); }
    const g = new ConvexGeometry(pts); return g.index ? g.toNonIndexed() : g; };
  const stones = [proto(18, 1, 0.72, 0.85), proto(16, 1, 0.65, 0.8), proto(20, 0.9, 0.8, 0.9), proto(15, 1, 0.6, 0.85), proto(17, 1, 0.7, 0.95)]; // chunky, angular, never slivers
  const clodP = [proto(12, 1, 0.75, 0.9), proto(11, 1, 0.7, 0.85), proto(13, 0.9, 0.8, 1)];
  const bits = []; // [x, z, size, stone(0/1), protoIndex]
  { const D = DIG, nS = high ? 46 : 26, nC = high ? 170 : 70, clear = (x, z) => Math.hypot(x - 10.5, z + 50) > 5.5 && Math.hypot(x + 8, z + 54) > 4.2 && Math.hypot(x + 20, z + 60) > 4.5;
    for (let i = 0, tries = 0; i < nS && tries < 800; tries++) {                                  // stones: dig floor + benches, pile toes, berm toe
      const t = rr(); let x, z, sz;
      if (t < 0.45) { const a = rr() * Math.PI * 2, d = Math.pow(rr(), 0.7) * 1.05; x = D[0] + Math.cos(a) * d * D[2]; z = D[1] + Math.sin(a) * d * D[3]; sz = 0.25 + Math.pow(rr(), 2) * 0.75; }
      else if (t < 0.8) { const P = PILES[Math.floor(rr() * PILES.length)], a = rr() * Math.PI * 2, d = (0.95 + rr() * 0.3) * P[2]; x = P[0] + Math.cos(a) * d; z = P[1] + Math.sin(a) * d; sz = 0.2 + Math.pow(rr(), 2) * 0.6; }
      else { x = -40 + rr() * 56; z = -69 - rr() * 3; sz = 0.25 + Math.pow(rr(), 2) * 0.7; }
      if (!clear(x, z)) continue; bits.push([x, z, sz, 1, Math.floor(rr() * stones.length)]); i++; }
    for (let i = 0, tries = 0; i < nC && tries < 1500; tries++) {                                // clods: broken soil along the dig lip, a few on the haul road shoulders
      let x, z; if (rr() < 0.82) { const a = rr() * Math.PI * 2, d = 1.0 + (rr() - 0.3) * 0.28; x = D[0] + Math.cos(a) * d * D[2]; z = D[1] + Math.sin(a) * d * D[3]; }
      else { z = -36 - rr() * 40; x = -6 + 0.2 * (z + 44) + 3 * Math.sin(z * 0.08) + (rr() < 0.5 ? -1 : 1) * (1.9 + rr() * 0.8); }
      if (!clear(x, z)) continue; bits.push([x, z, 0.07 + Math.pow(rr(), 2.5) * 0.28, 0, Math.floor(rr() * clodP.length)]); i++; }
  }
  const tg = new THREE.BufferGeometry();
  { const nx = XS.length, nz = ZS.length, NV = nx * nz, P = [], UV = [], N = [], GD = [], I = [];
    const H = new Float32Array(NV);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const v = j * nx + i, x = XS[i], z = ZS[j]; H[v] = G0 + hgt(x, z); P.push(x, H[v], z); UV.push(x / TEX_DIRT, -z / TEX_DIRT); }
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) { const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1; I.push(a, c, b, b, c, d); }
    const grid = new THREE.BufferGeometry(); grid.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); grid.setIndex(I); grid.computeVertexNormals();
    for (const v of grid.attributes.normal.array) N.push(v); grid.dispose();
    // ground occlusion: crevices (positive laplacian of the height grid) + soft contact shadow around every stone / clod
    const occ = new Float32Array(NV).fill(1);
    for (let j = 1; j < nz - 1; j++) for (let i = 1; i < nx - 1; i++) { const v = j * nx + i, hx = (XS[i + 1] - XS[i - 1]) / 2, hz = (ZS[j + 1] - ZS[j - 1]) / 2;
      const lap = (H[v - 1] + H[v + 1] - 2 * H[v]) / (hx * hx) + (H[v - nx] + H[v + nx] - 2 * H[v]) / (hz * hz); if (hx < 1.5) occ[v] = 1 - 0.28 * sstep(0.05, 0.6, lap); }
    const lb = (A, x) => { let lo = 0, hi = A.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (A[m] < x) lo = m + 1; else hi = m; } return lo; };
    for (const [x, z, sz] of bits) { const R = sz * 2.2; for (let j = Math.max(0, lb(ZS, z - R) - 1); j < nz && ZS[j] <= z + R; j++) for (let i = Math.max(0, lb(XS, x - R) - 1); i < nx && XS[i] <= x + R; i++) {
      const d = Math.hypot(XS[i] - x, ZS[j] - z) / (sz * 1.25); occ[j * nx + i] *= 1 - 0.5 * Math.exp(-d * d); } }
    for (let v = 0; v < NV; v++) GD.push(occ[v], 0);
    // append the stones / clods (flat-shaded, world box UVs in the dirt tile frame), half-buried, darker toward the ground
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new V(), tp = new V(), nm = new THREE.Matrix3();
    for (const [x, z, sz, stone, k] of bits) {
      const src = (stone ? stones : clodP)[k], gy = G0 + hgt(x, z), bury = stone ? 0.3 + rr() * 0.2 : 0.2 + rr() * 0.25;
      q.setFromEuler(e.set((rr() - 0.5) * (stone ? 0.5 : 1.2), rr() * 6.28, (rr() - 0.5) * (stone ? 0.5 : 1.2)));
      m.compose(tp.set(x, gy + 0.72 * sz * (1 - 2 * bury), z), q, sc.set(sz * (0.85 + rr() * 0.4), sz, sz * (0.85 + rr() * 0.4))); nm.getNormalMatrix(m);
      const sp = src.attributes.position, sn = src.attributes.normal, base = P.length / 3;
      for (let t = 0; t < sp.count; t += 3) {
        const fn = new V(sn.getX(t), sn.getY(t), sn.getZ(t)).applyMatrix3(nm).normalize(), ax = Math.abs(fn.x), ay = Math.abs(fn.y), az = Math.abs(fn.z);
        for (let c = t; c < t + 3; c++) { const w = new V(sp.getX(c), sp.getY(c), sp.getZ(c)).applyMatrix4(m);
          P.push(w.x, w.y, w.z); N.push(fn.x, fn.y, fn.z);
          const [u, vv] = ay >= ax && ay >= az ? [w.x, -w.z] : ax >= az ? [w.z, w.y] : [w.x, w.y]; UV.push(u / TEX_DIRT, vv / TEX_DIRT);
          GD.push(0.5 + 0.5 * sstep(gy - 0.02, gy + sz * 0.45, w.y), stone ? 0.75 + rr() * 0.25 : 0.12); }
      }
      for (let c = 0; c < sp.count; c++) I.push(base + c);
    }
    tg.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); tg.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    tg.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); tg.setAttribute('aGd', new THREE.Float32BufferAttribute(GD, 2)); tg.setIndex(I);
    stones.concat(clodP).forEach(g => g.dispose()); }
  tg.userData.texScale = TEX_DIRT;
  const tm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.96 });
  const terrK = { value: 0 }; // 0 until dirt_ground lands (a white placeholder is bound until then)
  // dirt_tracks (rutted, tracked mud) over the worked ground: placeholders bound now so the program is final, trkK flips on landing
  const PHT = placeholders(THREE), trkU = { tTrkC: { value: PHT.map }, tTrkN: { value: PHT.normalMap }, trkK: { value: 0 } };
  tm.onBeforeCompile = sh => {
    sh.uniforms.terrK = terrK; Object.assign(sh.uniforms, trkU);
    sh.vertexShader = 'attribute vec2 aGd; varying vec2 vGd; varying vec3 vW;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW=(modelMatrix*vec4(transformed,1.)).xyz; vGd=aGd;');
    sh.fragmentShader = 'uniform float terrK, trkK; uniform sampler2D tTrkC, tTrkN; varying vec3 vW; varying vec2 vGd;\n' + NOISE + `
      float trkMask(vec2 p){                                                              // where machines have worked the ground
        float pad=1.-smoothstep(.6,1.,length((p-vec2(4.,-42.))/vec2(56.,26.)));          // the worked yard: foreground to the berm
        float road=(1.-smoothstep(2.5,5.5,abs(p.x-(-6.+.2*(p.y+44.)+3.*sin(p.y*.08)))))*smoothstep(-33.,-40.,p.y)*smoothstep(-96.,-76.,p.y); // haul road to the berm
        return clamp(max(pad,road)*(.5+.7*fbm2(p*.09+5.)),0.,1.); }
` + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 tcol=diffuseColor.rgb;
        vec2 tuv=vec2(vW.x+1.6*sin(vW.z*.045), -vW.z)/3.;                                // ruts run along z (toward the dig), gently snaking
        float wk=trkMask(vW.xz)*trkK*(1.-vGd.y);
        tcol=mix(tcol, texture2D(tTrkC,tuv).rgb, wk);
        float n1=fbm2(vW.xz*.18), n2=vn2(vW.xz*2.3+7.), n3=vn2(vW.xz*11.), tr=.5+.5*sin(vW.x*3.2+n1*4.);
        vec3 dirt=mix(vec3(.26,.19,.14), vec3(.4,.31,.23), n1);
        dirt*=.78+.3*n2+.12*(n3-.5);
        dirt=mix(dirt, vec3(.14,.11,.09), smoothstep(.55,.85,fbm2(vW.xz*.06+3.))*.6);   // wet / dark patches
        diffuseColor.rgb=dirt;
        #ifdef USE_MAP
        diffuseColor.rgb*=mix(vec3(1.), tcol*2.2, .75*terrK);
        #endif
        { float lum=dot(diffuseColor.rgb,vec3(.3,.59,.11));                              // stones: greyer, a touch lighter than the soil they sit in
          diffuseColor.rgb=mix(diffuseColor.rgb, vec3(lum)*vec3(1.08,1.02,.94)*(1.25+.3*(n2-.5)), vGd.y);
          diffuseColor.rgb*=vGd.x; }                                                      // crevices + contact shadow
        float wash=smoothstep(-34.,-50.,vW.z)*smoothstep(-110.,-70.,vW.z)*smoothstep(95.,30.,abs(vW.x))*(.55+.6*fbm2(vW.xz*.05+9.));
        float bh=(n2*.35+n3*.1)*(1.-.45*terrK)+tr*.08*smoothstep(-20.,-60.,vW.z)*(1.-wk); // once the scans land their normals carry the grain (screen-space bump blocks up at grazing angles)`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        #ifdef USE_NORMALMAP_TANGENTSPACE
        { vec3 tn=texture2D(tTrkN,tuv).xyz*2.-1.; normal=normalize(normal+tbn*vec3(tn.xy*1.2*wk,0.)); } // tuv shares the dirt uv frame (u = x, v = -z)
        #endif
        { vec3 sp=-vViewPosition, sx=dFdx(sp), sy=dFdy(sp), r1=cross(sy,normal), r2=cross(normal,sx); float det=dot(sx,r1);
          vec2 dh=vec2(dFdx(bh),dFdy(bh)); normal=normalize(abs(det)*normal-sign(det)*(dh.x*r1+dh.y*r2)); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        { vec3 wn=inverseTransformDirection(normal, viewMatrix); float face=clamp(.35+wn.z*1.6+wn.y*.25,0.,1.); // dirt facing the building
          totalEmissiveRadiance+=diffuseColor.rgb*vec3(1.,.72,.45)*wash*face*.55; }`);
  };
  tm.customProgramCacheKey = () => 'd6hero-terrain';
  const terrain = new THREE.Mesh(tg, tm); terrain.receiveShadow = true; group.add(terrain);
  tb.bind(tm, 'dirt_ground', { maps: ['map', 'normalMap', 'aoMap'], normalScale: 0.35, ao: 0.6, onApply: set => { if (set.map) terrK.value = 1; } }); // no roughness map: moonlit glints alias at distance
  tb.bind(null, 'dirt_tracks', { custom: set => { if (!set.map || trkU.tTrkC.value === set.map) return; trkU.tTrkC.value = set.map; if (set.normalMap) trkU.tTrkN.value = set.normalMap; trkU.trkK.value = 1; } }); // ref swap only

  // ridgelines: two strips of silhouette hills, far
  const ridge = (R, a0, a1, base, amp, seed, col) => {
    const n = 220, f = makeNoise(seed), P = [], I = [], UV = [], top = [], S = RIDGE_TEX;
    for (let i = 0; i <= n; i++) {
      const a = a0 + (a1 - a0) * i / n, x = Math.sin(a) * R, z = -Math.cos(a) * R;
      const h = base + amp * (f(i * 0.035, seed) * 1.2 + 0.25 * f(i * 0.2, 7)) + amp * 0.9 * Math.exp(-(((a + 0.55) / 0.22) ** 2));
      P.push(x, -40, z, x, G0 + h * 0.55, z, x, G0 + h, z); top.push([x, G0 + h, z, a]);
      const u = a * R / S; UV.push(u, -40 / S, u, (G0 + h * 0.55) / S, u, (G0 + h) / S); // rock_ridge strata: u along the arc, v up, in metres / S
      if (i < n) { const k = i * 3; I.push(k, k + 3, k + 1, k + 1, k + 3, k + 4, k + 1, k + 4, k + 2, k + 2, k + 4, k + 5); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2)); g.setIndex(I); g.computeVertexNormals();
    g.userData.texScale = S;
    const mat = new THREE.MeshStandardMaterial({ color: col, roughness: 1 });
    // the scan's mean colour is divided out, so the ridge keeps its blue-hour tone and only gains the strata / ledges
    const c = new THREE.Color(col); tb.bind(mat, 'rock_ridge', { maps: ['map', 'normalMap'], color: new THREE.Color(c.r / RIDGE_MEAN[0], c.g / RIDGE_MEAN[1], c.b / RIDGE_MEAN[2]), normalScale: 1.2 });
    const m = new THREE.Mesh(g, mat); m.userData.top = top; group.add(m); return m;
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

  // machines (hero-model-machines): built straight into the group, materials night-graded below
  const yard = buildMachines({ THREE, high });
  const night = (() => { // dark blue-hour env for paint / steel / glass
    const c = document.createElement('canvas'); c.width = 128; c.height = 64; const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 0, 64);
    g.addColorStop(0, '#020308'); g.addColorStop(0.4, '#0b1a3a'); g.addColorStop(0.5, '#1d3466'); g.addColorStop(0.52, '#1a1410'); g.addColorStop(1, '#050404');
    x.fillStyle = g; x.fillRect(0, 0, 128, 64); for (const u of [30, 70, 100]) { x.fillStyle = '#ffd9a0'; x.fillRect(u, 30, 3, 2); }
    const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const MAT = yard.materials;
  for (const k of ['paint', 'metal', 'glass']) { MAT[k].envMap = night; }
  MAT.paint.envMapIntensity = 0.5; MAT.metal.envMapIntensity = 0.9; MAT.glass.envMapIntensity = 1.4;
  MAT.glow.color.setRGB(4, 4, 4); MAT.glass.color.setScalar(0.5); // cab glass reads dark at night, the env does the rest
  const paintU = { value: placeholders(THREE).map }, paintK = { value: 0 }; // excavator_paint, triplanar in object space (machine geometry carries no UVs)
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
  // excavator pulled left of the lead copy (72-95 vw) and out of the right tower's beam (aimed past it, see spots): a dark
  // silhouette under the copy as in Tim's frame, not a lit house; its stick stays clear of the H1 at full parallax
  const EX_X = 10.5;
  place(exA.g, EX_X, -50, Math.PI * 0.95); exA.g.scale.setScalar(1.55);
  place(dozer, -8, -54, 0.3); dozer.scale.setScalar(1.2);
  const keep = [exA.g, dozer];
  if (high) { place(yard.truck, -24, -70, -2.6); keep.push(yard.truck); }
  place(yard.loader, -20, -60, 2.2); keep.push(yard.loader);
  // light towers: the lamp lens meshes' parents are the tower groups
  // towers framed off the copy (H1 left, lead right): one behind the excavator, one high on the right, both >= 120 px from text at 1280-1920 incl. parallax
  const towerSpots = [[8, -64, -0.6], [16, -40, 2.6]];
  // one visible lamp (right): tower 0 still lights the dig but its heads face away from the room (dark lens backs, no glow)
  const LAMP_ON = new THREE.Color(1.4, 1.3, 1.15);
  yard.towers[1].material = yard.towers[1].material.clone(); yard.towers[1].material.color.copy(LAMP_ON);
  yard.towers[0].material = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.018, 0.018, 0.02), side: THREE.DoubleSide });
  const lampHead = yard.towers[1];
  const towers = towerSpots.map(([x, z, ry], i) => { const t = yard.towers[i].parent; place(t, x, z, ry); keep.push(t); return t; });
  group.traverse(o => { if (o.isMesh) o.castShadow = o.receiveShadow = false; });
  for (const k of keep) k.traverse(o => { if (o.isMesh) { o.castShadow = high && !o.isInstancedMesh && o.material !== MAT.glow; o.receiveShadow = high; } });
  terrain.receiveShadow = high;
  terrain.castShadow = false; // stones carry baked contact shadows; LIGHT: flip castShadow for self-shadowed mounds in raking light if the bias holds
  // everything that never moves (truck, loader, tower bodies, the excavator undercarriage) baked to one mesh per material
  const baked = bakeStatic(THREE, group, [...(high ? [{ root: yard.truck, deep: true }] : []), { root: yard.loader, deep: true }, ...towers.map(t => ({ root: t, deep: true })), { root: exA.g, deep: false }], { shadow: high });

  // lights: blue-hour sky fill, a cool rim from behind the site, warm work lights from the tower heads
  const hemi = new THREE.HemisphereLight(0x223660, 0x140e09, 0.2); group.add(hemi);
  const moon = new THREE.DirectionalLight(0x6f8cd0, 0.45); moon.position.set(-60, 45, -160); moon.target.position.set(0, 0, -40); group.add(moon, moon.target);
  const spots = towers.map((t, i) => {
    const s = new THREE.SpotLight(0xffcf98, [1000, 1000][i], 0, [0.85, 0.75][i], 0.95, 2);
    const head = new THREE.Vector3(-0.45, 9.6, 0).applyMatrix4(t.matrix.compose(t.position, t.quaternion, t.scale));
    s.target.position.copy([new THREE.Vector3(2, G0, -44), new THREE.Vector3(24, G0, -58), new THREE.Vector3(-36, G0, -90)][i]);
    s.position.copy(head).addScaledVector(s.target.position.clone().sub(head).normalize(), 0.6);   // just in front of the lens faces: the housings never catch their own lamp
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
    e.rig();
  };
  const dz0 = dozer.position.clone();
  function update(t) {
    skyU.time.value = t;
    exPose(exA, t, 1);
    const s = Math.sin(t * 0.13); dozer.position.set(dz0.x + s * 2.4 * Math.cos(0.35), dz0.y, dz0.z - s * 2.4 * Math.sin(0.35));
  }
  // TerraFirma Cyber Shroud on the excavator cab: fetched once the first frame has drawn (never delays ready), high tier only
  let shroud = null, dead = false;
  if (high) { let armed = false;
    terrain.onBeforeRender = () => { if (armed) return; armed = true; terrain.onBeforeRender = () => {};
      const go = () => attachShroud({ THREE, exA, MAT, url: new URL('./assets/models/cyber-shroud.glb', import.meta.url).href })
        .then(g => { if (dead) { exA.up.remove(g); g.traverse(o => o.geometry?.dispose()); } else shroud = g; }).catch(e => console.warn('cyber-shroud', e));
      (typeof requestIdleCallback === 'function' ? requestIdleCallback(go, { timeout: 2000 }) : setTimeout(go, 500)); }; }
  update(0);
  const api = {
    group, update, spots, lampHead, LAMP_ON, hemi, moon, skyU, hgt, site, cones: site.cones, city,
    applyHeroTextures: tex => tb.apply(tex),
    get shroud() { return shroud; },
    dispose() { dead = true; live.delete(api); site.dispose(); group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); tm.dispose(); sky.material.dispose(); night.dispose(); city.material.dispose(); Object.values(MAT).forEach(m => m.dispose()); yard.towers[0].material.dispose(); yard.towers[1].material.dispose(); yard.dispose(); }
  };
  live.add(api);
  return api;
}
