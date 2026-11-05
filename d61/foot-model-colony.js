// D6.1 footer colony: geodesic glass domes with lush planted interiors (canopy blobs, trees, grow lamps), small
// opaque hab domes, the long row of pressurised cylinders + boxy units with lit windows, masts, end-on tank farm,
// solar arrays and a pressurised rover. All merged per material through the bucket B.
import { TS, rng, fbm, height, geodesic, soup, boxUV, rrect, extrude, smoothNormals } from './foot-model-kit.js';

export function buildColony({ THREE, B, M, high }) {
  const r = rng(77), V3 = THREE.Vector3;
  const gy = (x, z) => height(x, z);
  const geoCache = new Map(); const geo = f => geoCache.get(f) || geoCache.set(f, geodesic(THREE, f)).get(f);
  const domes = [];

  // ---------------------------------------------------------------- geodesic dome: struts, inset panels, base ring, vestibule
  function dome(cx, cz, R, freq, { glass = true, green = glass, ry = 0, vest = true } = {}) {
    const { faces, verts, edges } = geo(freq), y0 = gy(cx, cz) - 0.15, w = Math.max(0.12, R * 0.012), dep = w * 1.3;
    const tr = new THREE.Matrix4().makeRotationY(ry).setPosition(cx, y0 + 0.9, cz);
    // struts: 4-sided prisms along each chord
    const S = [];
    const a = new V3(), b = new V3(), n = new V3(), sd = new V3(), t = new V3();
    const quad = (p0, p1, p2, p3) => { for (const q of [p0, p1, p2, p0, p2, p3]) S.push(q.x, q.y, q.z); };
    for (const [i, j] of edges) {
      a.copy(verts[i]).multiplyScalar(R); b.copy(verts[j]).multiplyScalar(R);
      n.copy(a).add(b).normalize(); t.subVectors(b, a); sd.crossVectors(t, n).normalize().multiplyScalar(w / 2);
      const o = n.clone().multiplyScalar(dep * 0.35), ii = n.clone().multiplyScalar(-dep * 0.65);
      const A0 = a.clone().add(sd).add(o), A1 = a.clone().sub(sd).add(o), B0 = b.clone().add(sd).add(o), B1 = b.clone().sub(sd).add(o);
      const A2 = a.clone().sub(sd).add(ii), A3 = a.clone().add(sd).add(ii), B2 = b.clone().sub(sd).add(ii), B3 = b.clone().add(sd).add(ii);
      quad(A0, B0, B1, A1); quad(A1, B1, B2, A2); quad(A3, B3, B0, A0); if (high) quad(A2, B2, B3, A3);
    }
    const sg = soup(THREE, S); sg.applyMatrix4(tr); B.P(M.frame, boxUV(THREE, sg, TS.dome_frame));
    // hubs (high only)
    if (high && R > 8) for (const v of verts) { if (v.y < -1e-3) continue; B.P(M.frame, boxUV(THREE, new THREE.OctahedronGeometry(w * 1.1).translate(v.x * R, v.y * R, v.z * R).applyMatrix4(tr), TS.dome_frame)); }
    // panels: each face inset toward its centroid, sitting just inside the strut faces
    const G = [], O = [];
    for (const f of faces) {
      const c = f.c.clone().multiplyScalar(R), L = f.v[0].distanceTo(f.v[1]) * R, k = 1 - 1.6 * w / L;
      const P = f.v.map(v => c.clone().add(v.clone().multiplyScalar(R).sub(c).multiplyScalar(k)).multiplyScalar(0.997));
      const isGlass = glass && !(f.c.y < 0.12 && r() < 0.5);
      for (const p of P) (isGlass ? G : O).push(p.x, p.y, p.z);
    }
    if (G.length) { const g = soup(THREE, G); g.applyMatrix4(tr); B.P(M.glass, boxUV(THREE, g, TS.dome_glass)); }
    if (O.length) { const g = soup(THREE, O); g.applyMatrix4(tr); B.P(M.hab, boxUV(THREE, g, TS.habitat_panel)); }
    // base ring wall + vestibule toward camera
    const segs = high ? 48 : 24;
    B.P(M.hab, boxUV(THREE, new THREE.CylinderGeometry(R * 1.01, R * 1.03, 1.1, segs, 1, true).translate(0, -0.45, 0).applyMatrix4(tr), TS.habitat_panel));
    if (vest) {
      const vw = Math.min(4, R * 0.28), vh = Math.min(3.2, R * 0.24), vl = Math.min(6, R * 0.35);
      const vs = new THREE.Shape(); vs.moveTo(-vw / 2, 0); vs.lineTo(vw / 2, 0); vs.lineTo(vw / 2, vh * 0.6); vs.quadraticCurveTo(vw / 2, vh, 0, vh); vs.quadraticCurveTo(-vw / 2, vh, -vw / 2, vh * 0.6); vs.closePath();
      const vg = extrude(THREE, vs, vl, 0, 1, 4).translate(0, -0.9, R * 0.98 + vl / 2 - 1.2).applyMatrix4(tr);
      B.P(M.hab, boxUV(THREE, vg, TS.habitat_panel));
      B.P(M.window, new THREE.BoxGeometry(vw * 0.42, vh * 0.55, 0.4).translate(0, vh * 0.3 - 0.9, R * 0.98 + vl - 1.2 + 0.08).applyMatrix4(tr));   // stands 0.28 m proud: no z-fight at 300 m
    }
    if (green) planting(cx, y0 + 0.9, cz, R);
    domes.push({ x: cx, y: y0, z: cz, R });
  }

  // ---------------------------------------------------------------- planted interior
  const blob = (det, seed) => { const g = new THREE.IcosahedronGeometry(1, det), p = g.attributes.position, f = rng(seed), o = f() * 40;
    for (let i = 0; i < p.count; i++) { const v = new V3().fromBufferAttribute(p, i), k = 1 + 0.22 * fbm(v.x * 1.6 + o, v.y * 1.6 + v.z * 1.1, 3); p.setXYZ(i, v.x * k, v.y * k, v.z * k); }
    return smoothNormals(g); };
  const blobs = [blob(high ? 2 : 1, 1), blob(high ? 2 : 1, 2), blob(1, 3)];
  const TINT = [[1, 1, 1], [1.12, 1.08, 0.62], [0.78, 0.95, 0.9], [0.66, 0.78, 0.6], [1.15, 0.95, 0.55], [0.9, 1.05, 0.8]];
  const tinted = (g, c) => { const n = g.attributes.position.count, C = new Float32Array(n * 3); for (let i = 0; i < n; i++) C.set(c, i * 3); g.setAttribute('color', new THREE.BufferAttribute(C, 3)); return g; };
  function planting(cx, y0, cz, R) {
    B.P(M.soil, new THREE.CircleGeometry(R * 0.98, high ? 40 : 20).rotateX(-Math.PI / 2).translate(cx, y0 + 0.25, cz));
    const roof = rr => Math.sqrt(Math.max(0, R * R - rr * rr)) * 0.9;
    const N = Math.round((high ? 3.2 : 1.5) * R);
    for (let i = 0; i < N; i++) {
      const a = r() * Math.PI * 2, rr = Math.sqrt(r()) * R * 0.86, x = Math.cos(a) * rr, z = Math.sin(a) * rr, top = roof(rr);
      const tint = TINT[Math.floor(r() * TINT.length)].map(c => c * (0.85 + r() * 0.3)), tree = r() < 0.32 && top > 6;
      if (tree) { // trunk + crown(s)
        const cr = 1.6 + r() * Math.min(3.2, R * 0.12), h = Math.min(top - cr * 0.8, 4 + r() * R * 0.55);
        B.P(M.soil, new THREE.CylinderGeometry(0.12, 0.22, h, 5, 1, true).translate(cx + x, y0 + h / 2, cz + z));
        for (let k = 0; k < (high ? 3 : 2); k++) {
          const s = cr * (1 - k * 0.22), g = blobs[(i + k) % 3].clone().scale(s * 1.15, s * 0.8, s * 1.15).translate(cx + x + (r() - 0.5) * cr, y0 + h - k * cr * 0.5, cz + z + (r() - 0.5) * cr);
          B.P(M.foliage, boxUV(THREE, tinted(g, tint), TS.foliage));
        }
      } else { // shrub mound / bed
        const s = 0.9 + r() * Math.min(3, R * 0.1);
        const g = blobs[i % 3].clone().scale(s * (1 + r() * 0.6), s * (0.55 + r() * 0.5), s * (1 + r() * 0.6)).translate(cx + x, y0 + s * 0.3, cz + z);
        B.P(M.foliage, boxUV(THREE, tinted(g, tint), TS.foliage));
      }
    }
    // grow lamps: warm clusters hung under the frame
    const nl = Math.max(2, Math.round(R / 5));
    for (let i = 0; i < nl; i++) { const a = r() * Math.PI * 2, rr = r() * R * 0.55, h = roof(rr) * (0.7 + r() * 0.15);
      B.P(M.lamp, new THREE.SphereGeometry(0.22 + R * 0.008, 6, 4).translate(cx + Math.cos(a) * rr, y0 + h, cz + Math.sin(a) * rr)); }
  }

  // ---------------------------------------------------------------- pressurised cylinder along x, on saddles, ribs, window band
  const cylSeg = high ? 28 : 14;
  function cyl(x0, x1, z, R = 2.5, { win = 4, lift = 0.9 } = {}) {
    const L = x1 - x0, cx = (x0 + x1) / 2, y = Math.min(gy(x0, z), gy(x1, z), gy(cx, z)) + lift + R;
    B.P(M.hab, boxUV(THREE, new THREE.CylinderGeometry(R, R, L, cylSeg, 1, true).rotateZ(Math.PI / 2).translate(cx, y, z), TS.habitat_panel));
    for (const s of [-1, 1]) B.P(M.hab, boxUV(THREE, new THREE.SphereGeometry(R, cylSeg, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.42, 1).rotateZ(-s * Math.PI / 2).translate(cx + s * L / 2, y, z), TS.habitat_panel));
    const nr = Math.max(2, Math.round(L / 4));
    for (let i = 0; i <= nr; i++) B.P(M.frame, boxUV(THREE, new THREE.CylinderGeometry(R + 0.2, R + 0.2, 0.3, cylSeg, 1, true).rotateZ(Math.PI / 2).translate(x0 + 0.4 + (L - 0.8) * i / nr, y, z), TS.dome_frame));
    for (const s of [-1, 1]) B.P(M.frame, boxUV(THREE, new THREE.BoxGeometry(0.5, lift + R * 0.6, R * 1.5).translate(cx + s * L * 0.3, y - R * 0.7 - lift / 2, z), TS.dome_frame));
    for (let i = 0; i < win; i++) { const wx = x0 + L * (i + 0.5) / win + (r() - 0.5) * 0.6, lit = r() < 0.7;
      B.P(lit ? M.window : M.dark, new THREE.BoxGeometry(0.9, 0.45, 0.5).translate(wx, y + 0.25, z + R)); }   // half sunk, 0.25 m proud
    return y;
  }
  // end-on tank (axis along z) for the farm on the right
  function tank(x, z, R, L) {
    const y = gy(x, z) + 0.8 + R;
    B.P(M.stainless, boxUV(THREE, new THREE.CylinderGeometry(R, R, L, cylSeg, 1, true).rotateX(Math.PI / 2).translate(x, y, z), TS.stainless));
    for (const s of [-1, 1]) B.P(M.stainless, boxUV(THREE, new THREE.SphereGeometry(R, cylSeg, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.38, 1).rotateX(s * Math.PI / 2).translate(x, y, z + s * L / 2), TS.stainless));
    for (const s of [-1, 1]) B.P(M.frame, boxUV(THREE, new THREE.BoxGeometry(R * 1.6, 0.8 + R * 0.5, 0.4).translate(x, y - R * 0.75 - 0.4, z + s * L * 0.3), TS.dome_frame));
  }
  // boxy unit with rounded vertical edges, roof kit, window band
  function unit(cx, cz, w, h, d, { win = 5, ry = 0 } = {}) {
    const y = Math.min(gy(cx - w / 2, cz), gy(cx + w / 2, cz)) + 0.5, tr = new THREE.Matrix4().makeRotationY(ry).setPosition(cx, y, cz), T = g => g.applyMatrix4(tr);
    B.P(M.hab, boxUV(THREE, T(extrude(THREE, rrect(THREE, w, d, Math.min(1.4, d * 0.25)), h, 0, 1, 3).rotateX(-Math.PI / 2).translate(0, h / 2, 0)), TS.habitat_panel));
    B.P(M.frame, boxUV(THREE, T(new THREE.BoxGeometry(w - 0.6, 0.5, d - 0.6).translate(0, -0.25, 0)), TS.dome_frame));
    B.P(M.dark, T(new THREE.BoxGeometry(w + 0.3, 0.14, d + 0.3).translate(0, h * 0.62, 0)));             // seam band, 0.15 m proud
    for (let i = 0; i < 3; i++) B.P(M.frame, boxUV(THREE, T(new THREE.BoxGeometry(1 + r() * 1.6, 0.6 + r() * 0.8, 1 + r()).translate((r() - 0.5) * (w - 3), h + 0.4, (r() - 0.5) * (d - 3))), TS.dome_frame));
    for (let i = 0; i < win; i++) { const wx = -w / 2 + w * (i + 0.5) / win, lit = r() < 0.65;
      B.P(lit ? M.window : M.dark, T(new THREE.BoxGeometry(1.1, 0.6, 0.5).translate(wx, h * 0.45, d / 2))); }   // half sunk, 0.25 m proud
  }
  const tube = (x0, x1, z, y, R = 1.1) => B.P(M.hab, boxUV(THREE, new THREE.CylinderGeometry(R, R, x1 - x0, 12, 1, true).rotateZ(Math.PI / 2).translate((x0 + x1) / 2, y, z), TS.habitat_panel));
  function mast(x, z, h) {
    const y = gy(x, z);
    B.P(M.frame, boxUV(THREE, new THREE.CylinderGeometry(0.12, 0.2, h, 6, 1, true).translate(x, y + h / 2, z), TS.dome_frame));
    B.P(M.frame, boxUV(THREE, new THREE.CylinderGeometry(0.9, 0.2, 0.4, 10).rotateZ(0.6).translate(x + 0.4, y + h * 0.82, z), TS.dome_frame));
    B.P(M.beacon, new THREE.SphereGeometry(0.22, 6, 4).translate(x, y + h + 0.2, z));
  }
  function solar(x0, z0, nx, nz) {
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) { const x = x0 + i * 7.2, z = z0 - j * 5, y = gy(x, z);
      B.P(M.solar, new THREE.BoxGeometry(6.6, 0.08, 3.2).rotateX(-0.55).translate(x, y + 1.5, z));
      B.P(M.frame, new THREE.BoxGeometry(0.15, 1.4, 0.15).translate(x, y + 0.7, z)); }
  }

  // ---------------------------------------------------------------- layout (Figma 22951:8878, camera at the origin looking -z)
  // (compositor lens: eye 1.7 m, vfov 30, horizon 30% from top; pad sits ~8.5 m below the eye)
  dome(-41, -282, 18, high ? 6 : 4);                      // the big glass dome, left of centre
  dome(-101, -336, 9, high ? 4 : 2);                      // small glass dome, far left
  dome(70, -318, 9.2, high ? 4 : 2, { ry: -0.3 });        // small glass dome by the near Starship
  dome(-76, -372, 6.5, 2, { vest: false });               // tucked behind, mostly hidden
  // the hab row
  const Z = -300;
  unit(-18, Z, 8.5, 4.6, 7, { win: 4 });
  const yc = cyl(-12.5, -1, Z - 2, 2.3, { win: 4 }); tube(-14.5, -12, Z - 2, yc - 0.6, 0.9);
  dome(3.2, Z - 3, 3.6, 2, { glass: false, vest: false });
  cyl(7.5, 17.5, Z - 1, 2.2, { win: 3 }); tube(5.5, 8, Z - 1, yc - 0.6, 0.9);
  dome(21.5, Z - 4, 3.4, 2, { glass: false, vest: false });
  cyl(25.5, 35.5, Z - 2, 2.1, { win: 3 });
  dome(39.5, Z - 3, 3.5, 2, { glass: false, vest: false });
  unit(49, Z - 3, 10, 5.4, 7.5, { win: 5 });
  unit(63, Z + 8, 11, 4, 8, { win: 5, ry: 0.04 });
  // second rank, half hidden: depth behind the row
  cyl(-30, -14, Z - 22, 2.6, { win: 3 }); cyl(8, 30, Z - 26, 2.7, { win: 3 }); unit(36, Z - 30, 10, 6.5, 8, { win: 3 });
  // tank farm on the right, end-on
  for (let i = 0; i < (high ? 9 : 5); i++) tank(88 + i * 7.4 * (high ? 1 : 1.6), -352 - (i % 2) * 5, 2.2, 8);
  // masts and arrays
  mast(-29, Z + 6, 14); mast(-25.5, Z + 10, 10); mast(56, Z - 12, 12);
  if (high) solar(-160, -352, 4, 2);

  // ---------------------------------------------------------------- pressurised rover, mid-ground, heading left across the frame
  const rover = { x: 9, z: -250, ry: 0.35 };
  { const y = gy(rover.x, rover.z), tr = new THREE.Matrix4().makeRotationY(rover.ry).setPosition(rover.x, y, rover.z), T = g => g.applyMatrix4(tr), V2 = THREE.Vector2;
    const side = new THREE.Shape([[-2.8, 0.75], [2.4, 0.75], [2.95, 1.05], [3.0, 1.6], [2.55, 2.35], [-2.5, 2.45], [-2.85, 2.2]].map(p => new V2(...p)));
    B.P(M.rover, boxUV(THREE, T(extrude(THREE, side, 2.3, high ? 0.08 : 0, 1)), TS.rover_paint));
    B.P(M.dark, T(extrude(THREE, new THREE.Shape([[2.48, 1.6], [2.9, 1.62], [2.5, 2.3], [1.4, 2.36], [1.4, 1.6]].map(p => new V2(...p))), 2.7, 0)));   // canopy glass, clears the body bevel
    B.P(M.dark, T(new THREE.BoxGeometry(5.2, 0.3, 2.2).translate(-0.1, 0.62, 0)));                               // chassis
    for (const wx of [-2, 0, 2]) for (const s of [-1, 1]) B.P(M.dark, T(new THREE.CylinderGeometry(0.58, 0.58, 0.45, 12).rotateX(Math.PI / 2).translate(wx, 0.58, s * 1.32)));
    B.P(M.solar, T(new THREE.BoxGeometry(3.4, 0.06, 2.0).translate(-0.9, 2.55, 0)));
    B.P(M.frame, T(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 5).translate(-2.2, 3.0, 0.7)));
    B.P(M.frame, T(new THREE.BoxGeometry(0.3, 0.22, 0.3).translate(-2.2, 3.65, 0.7)));
    for (const s of [-1, 1]) B.P(M.lamp, T(new THREE.BoxGeometry(0.06, 0.12, 0.3).translate(3.0, 1.25, s * 0.85)));
    B.P(M.beacon, T(new THREE.SphereGeometry(0.1, 6, 4).translate(-2.2, 3.85, 0.7)));
  }

  blobs.forEach(g => g.dispose());
  return { domes, rover, big: domes[0] };
}
