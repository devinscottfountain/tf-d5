// D6.1 footer terrain: one frustum-shaped ground grid (dense at the feet, coarse at the ridge 2 km out), instanced
// scattered rocks (3 shapes) and a few hand-placed foreground boulders. Dark and calm near camera by design.
import { TS, rng, fbm, height, smoothstep, boxUV, mergeAll } from './foot-model-kit.js';

export function buildTerrain({ THREE, group, M, high }) {
  const r = rng(61);

  // ---------------------------------------------------------------- ground grid: rows spaced exponentially in distance
  const NZ = high ? 220 : 110, NX = high ? 240 : 110, K = 5.2, D0 = -16, D1 = 3400, A = (D1 - D0) / (Math.exp(K) - 1);
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
  for (let j = 0, o = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const a = j * (NX + 1) + i, b = a + 1, c = a + NX + 1, d = c + 1; idx.set([a, c, b, b, c, d], o); o += 6; }
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
    gg.computeVertexNormals(); return boxUV(THREE, gg.toNonIndexed(), TS.mars_rock);
  };
  const shapes = [rockGeo(3, high ? 2 : 1), rockGeo(9, high ? 2 : 1, 0.5), rockGeo(17, 1, 0.75)];

  // scatter: sparse near camera (calm under the type), denser mid-ground, clear of the settlement pad
  const N = high ? 520 : 200, lists = [[], [], []];
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
  place(9.5, -15, 4.2, 2.6, 3.6, 0.6, 31, high ? 3 : 2);
  place(13.5, -12, 2.0, 1.2, 1.7, 1.9, 37, high ? 2 : 1);
  place(-12, -40, 4.6, 1.3, 2.8, -0.3, 43, high ? 3 : 2);
  place(-24, -64, 2.6, 1.0, 2.0, 0.9, 47, 2);
  place(30, -78, 3.4, 1.5, 2.6, 0.2, 53, 2);
  const boulders = new THREE.Mesh(mergeAll(THREE, bould), M.rock); boulders.userData.part = 'boulders'; boulders.userData.texScale = TS.mars_rock; group.add(boulders);

  return { ground, rocks, boulders, meshes: [ground, ...rocks, boulders], dispose() { g.dispose(); shapes.forEach(s => s.dispose()); boulders.geometry.dispose(); } };
}
