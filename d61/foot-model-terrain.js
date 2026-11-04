// D6.1 footer terrain: one frustum-shaped ground grid (dense at the feet, coarse at the ridge 2 km out), instanced
// scattered rocks (3 shapes) and a few hand-placed foreground boulders. Dark and calm near camera by design.
import { TS, rng, fbm, height, smoothstep, boxUV, mergeAll, smoothNormals } from './foot-model-kit.js';

export function buildTerrain({ THREE, group, M, high }) {
  const r = rng(61);

  // ---------------------------------------------------------------- ground grid: rows spaced exponentially in distance
  const NZ = high ? 220 : 110, NX = high ? 200 : 100, K = 5.2, D0 = -16, D1 = 3400, A = (D1 - D0) / (Math.exp(K) - 1);
  const n = (NX + 1) * (NZ + 1), P = new Float32Array(n * 3), UV = new Float32Array(n * 2), C = new Float32Array(n * 3);
  for (let j = 0, v = 0; j <= NZ; j++) {
    const d = D0 + A * (Math.exp(K * j / NZ) - 1), W = 46 + Math.max(d, 0) * 1.12, z = -d;
    for (let i = 0; i <= NX; i++, v++) {
      const x = -W + 2 * W * i / NX, y = height(x, z);
      P.set([x, y, z], v * 3); UV.set([x / TS.regolith, -z / TS.regolith], v * 2);
      // albedo variation: dusty lighter drifts, darker basalt patches, slightly redder far plain
      const k = 0.86 + 0.16 * fbm(x / 23, z / 23, 3) + 0.08 * fbm(x / 4, z / 4, 2) + 0.1 * smoothstep(300, 1500, d);
      C.set([k * 1.04, k * 0.98, k * 0.94], v * 3);
    }
  }
  const idx = new (n > 65535 ? Uint32Array : Uint16Array)(NX * NZ * 6);
  for (let j = 0, o = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1; idx.set([a, b, c, b, d, c], o); o += 6; }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('uv', new THREE.BufferAttribute(UV, 2)); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1)); g.computeVertexNormals(); g.computeBoundingSphere(); g.userData.texScale = TS.regolith;
  const ground = new THREE.Mesh(g, M.regolith); ground.userData.part = 'ground'; ground.userData.texScale = TS.regolith; group.add(ground);

  // ---------------------------------------------------------------- rock shapes: displaced icospheres, flat-ish bottoms
  const rockGeo = (seed, det, flat = 0.62) => {
    const f = rng(seed), o = [f() * 50, f() * 50, f() * 50], gg = new THREE.IcosahedronGeometry(1, det), p = gg.attributes.position;
    const cut = [new THREE.Vector3(f() - 0.5, f() * 0.6, f() - 0.5).normalize(), new THREE.Vector3(f() - 0.5, f() * 0.4, f() - 0.5).normalize()];
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(p, i);
      let k = 1 + 0.28 * fbm(v.x * 1.3 + o[0], v.y * 1.3 + v.z * 0.7 + o[1], 3) + 0.08 * fbm(v.z * 4 + o[2], v.x * 4, 2);
      for (const c of cut) { const dd = v.dot(c); if (dd > 0.55) k *= 0.55 / dd + (1 - 0.55 / dd) * 0.15; } // fracture planes
      v.multiplyScalar(k); v.y = v.y * flat; if (v.y < -0.18) v.y = -0.18 + (v.y + 0.18) * 0.25;
      p.setXYZ(i, v.x, v.y, v.z);
    }
    smoothNormals(gg); return boxUV(THREE, gg, TS.mars_rock);
  };
  const shapes = [rockGeo(3, 1), rockGeo(9, 1, 0.5), rockGeo(17, 1, 0.75)];

  // scatter: sparse near camera (calm under the type), denser mid-ground, clear of the settlement pad
  const N = high ? 620 : 230, lists = [[], [], []];
  for (let t = 0, placed = 0; t < N * 4 && placed < N; t++) {
    const d = 22 + Math.pow(r(), 1.5) * 520, x = (r() * 2 - 1) * (d * 1.15 + 20), z = -d;
    if (d > 235 && d < 480 && x > -190 && x < 215) continue;
    const big = r() < 0.04, s = big ? 1.4 + r() * 1.8 : 0.12 + Math.pow(r(), 3) * 1.1;
    const y = height(x, z) - s * 0.22;
    lists[placed % 3].push([x, y, z, s, r() * 6.28, (r() - 0.5) * 0.3]); placed++;
  }
  const rocks = lists.map((L, k) => {
    const im = new THREE.InstancedMesh(shapes[k], M.rock, L.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    L.forEach(([x, y, z, s, ry, tl], i) => { q.setFromEuler(e.set(tl, ry, tl * 0.6)); im.setMatrixAt(i, m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(s * (0.8 + r() * 0.5), s, s * (0.8 + r() * 0.5)))); });
    im.computeBoundingSphere(); im.userData.part = 'rocks'; im.userData.texScale = TS.mars_rock; group.add(im); return im;
  });

  // ---------------------------------------------------------------- foreground boulders (Figma: big one bottom right, flat one mid left)
  const bould = [];
  const place = (x, z, sx, sy, sz, ry, seed, det) => {
    const b = rockGeo(seed, det, 0.7); b.scale(sx, sy, sz); b.rotateY(ry); b.translate(x, height(x, z) - sy * 0.15, z);
    bould.push(boxUV(THREE, b, TS.mars_rock));
  };
  // tops kept well under the eye line so nothing breaks the horizon
  place(2.4, -6.6, 2.7, 0.7, 2.2, 0.6, 31, high ? 3 : 2);        // bottom right, half out of frame
  place(4.6, -5.2, 1.2, 0.35, 1.0, 1.9, 37, 2);
  place(-2.4, -11, 1.7, 0.36, 1.15, -0.3, 43, 2);                // mid left
  place(-7, -19, 1.4, 0.3, 1.0, 0.9, 47, 1);
  const boulders = new THREE.Mesh(mergeAll(THREE, bould), M.rock); boulders.userData.part = 'boulders'; boulders.userData.texScale = TS.mars_rock; group.add(boulders);

  // ---------------------------------------------------------------- extra stones: mid boulders, fist-to-knee stones, pebble clusters
  // Bedded on the local slope and sunk 25..45% so nothing floats. The band under the logotype and links (about 5.5..24 m
  // out at 1440x900, 45..85% of frame height) only gets small, darkened stones: texture without highlights behind the type.
  const calm = d => smoothstep(4.5, 6.5, d) * (1 - smoothstep(20, 28, d));
  const pad = (x, d) => d > 235 && d < 480 && x > -190 && x < 215;
  const up = new THREE.Vector3(0, 1, 0), nrm = new THREE.Vector3(), qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), mtx = new THREE.Matrix4(), col = new THREE.Color();
  const bed = (im, i, x, z, sx, sy, sz, bury, tone) => {
    const e = 0.4, hx = height(x + e, z) - height(x - e, z), hz = height(x, z + e) - height(x, z - e);
    nrm.set(-hx / (2 * e), 1, -hz / (2 * e)).normalize();
    qa.setFromUnitVectors(up, nrm); qb.setFromAxisAngle(up, r() * 6.283); qa.multiply(qb);
    im.setMatrixAt(i, mtx.compose(new THREE.Vector3(x, height(x, z) - sy * bury, z), qa, new THREE.Vector3(sx, sy, sz)));
    im.setColorAt(i, col.setScalar(tone));
  };
  const scatter = (geo, n, fn) => {
    const L = []; for (let t = 0; t < n * 6 && L.length < n; t++) { const o = fn(); if (o) L.push(o); }
    const im = new THREE.InstancedMesh(geo, M.rock, L.length);
    L.forEach((o, i) => bed(im, i, ...o)); im.instanceMatrix.needsUpdate = true; im.instanceColor.needsUpdate = true;
    im.computeBoundingSphere(); im.userData.part = 'stones'; im.userData.texScale = TS.mars_rock; group.add(im); return im;
  };
  // per-area uniform in the ground plane within the frustum wedge: x spread grows with distance
  const spot = (d0, d1, k = 1.25) => { const d = Math.sqrt(d0 * d0 + r() * (d1 * d1 - d0 * d0)), x = (r() * 2 - 1) * (d * k + 4); return [x, -d, d]; };

  // mid boulders, 30..170 m: breaks up the plain before the settlement
  const midGeo = rockGeo(71, 2, 0.6);
  const mids = scatter(midGeo, high ? 14 : 7, () => { const [x, z, d] = spot(30, 170, 1.05); if (pad(x, d)) return null;
    const s = 0.9 + r() * 1.4; return [x, z, s * (1 + r() * 0.5), s * (0.45 + r() * 0.3), s * (0.8 + r() * 0.4), 0.3 + r() * 0.15, 0.75 + r() * 0.3]; });

  // fist- to knee-size stones, 2.5..90 m, thinner and smaller (and darker) in the calm band
  const stoneGeo = (() => { const f = rng(83), gg = new THREE.DodecahedronGeometry(1, 0), p = gg.attributes.position;   // 36 tris, faceted like broken basalt
    for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(p, i), k = 1 + 0.18 * fbm(v.x * 2 + 3, v.y * 2 + v.z, 2); p.setXYZ(i, v.x * k, Math.max(v.y * k * 0.65, -0.3), v.z * k); }
    gg.computeVertexNormals(); return boxUV(THREE, gg, TS.mars_rock); })();
  const stones = scatter(stoneGeo, high ? 900 : 260, () => { const [x, z, d] = spot(2.5, 90); const c = calm(d);
    if (r() < c * 0.7) return null;
    const s = (0.06 + Math.pow(r(), 2.2) * 0.42) * (1 - 0.6 * c);
    return [x, z, s * (0.9 + r() * 0.5), s * (0.55 + r() * 0.4), s * (0.8 + r() * 0.5), 0.25 + r() * 0.2, (0.7 + r() * 0.4) * (1 - 0.35 * c)]; });

  // pebble clusters: tight groups of 5..12 near the feet and in shallow hollows mid-ground
  const pebGeo = (() => { const gg = new THREE.IcosahedronGeometry(1, 0), p = gg.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, p.getY(i) * 0.6); gg.computeVertexNormals(); return boxUV(THREE, gg, TS.mars_rock); })();
  const peb = []; for (let c = 0, nc = high ? 70 : 18; c < nc; c++) {
    const [cx, cz, d] = spot(2.5, 45); const k = calm(d), n = 5 + Math.floor(r() * 8), rad = 0.25 + r() * 0.5;
    for (let j = 0; j < n; j++) { const a = r() * 6.283, rr = Math.sqrt(r()) * rad, s = 0.025 + r() * 0.05;
      peb.push([cx + Math.cos(a) * rr, cz + Math.sin(a) * rr, s * (1 + r() * 0.4), s, s * (0.8 + r() * 0.4), 0.3, (0.75 + r() * 0.35) * (1 - 0.3 * k)]); }
  }
  let pi = 0; const pebbles = scatter(pebGeo, peb.length, () => peb[pi++]);

  const extra = [mids, stones, pebbles];
  return { ground, rocks, boulders, extra, meshes: [ground, ...rocks, boulders, ...extra], dispose() { g.dispose(); shapes.forEach(s => s.dispose()); [midGeo, stoneGeo, pebGeo].forEach(x => x.dispose()); boulders.geometry.dispose(); } };
}
