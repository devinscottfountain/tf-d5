// D6.1 footer: SpaceX-style Starships standing on pads. 9 m stainless body, ogive nose, black heat-shield half,
// forward + aft flaps on the tile line, aerocovers, short legs, engine skirt, nose beacon. Real scale (50 m).
import { TS, height, cylUV, boxUV, extrude } from './foot-model-kit.js';

const R = 4.5;
// lathe profile (radius, y) from the aft skirt to the nose tip; y measured from the bottom of the tank skirt
const PROF = [[3.7, 0], [4.5, 0.7], [4.5, 33], [4.44, 35.5], [4.25, 38.5], [3.9, 41.5], [3.35, 44.3], [2.6, 46.6], [1.75, 48.4], [0.9, 49.6], [0.25, 50.25], [0, 50.4]];

export function buildStarships({ THREE, B, M, high, ships }) {
  const seg = high ? 44 : 22, V2 = THREE.Vector2, LIFT = 1.7;
  const pts = PROF.map(([r, y]) => new V2(r, y));

  // template parts in ship space (y up, tile half faces -z, flaps on +-x), cloned per ship
  const body = cylUV(new THREE.LatheGeometry(pts, seg), R, TS.stainless).toNonIndexed();
  const tilePts = PROF.filter(([, y]) => y < 48.6).map(([r, y]) => new V2(r * 1.008 + 0.02, y));
  const tiles = new THREE.LatheGeometry(tilePts, Math.round(seg / 2), Math.PI / 2, Math.PI).toNonIndexed();

  // flaps: trapezoids in the (radial, y) plane, extruded thin, root on the hull
  const rHull = y => { for (let i = 1; i < PROF.length; i++) { const [r0, y0] = PROF[i - 1], [r1, y1] = PROF[i]; if (y <= y1) return r0 + (r1 - r0) * (y - y0) / (y1 - y0); } return 0; };
  // flaps: trapezoids in the (radial, y) plane, root edge sunk into the hull line, extruded thin
  const flap = (y0, y1, ty0, ty1, span, th) => {
    const s = new THREE.Shape([new V2(rHull(y0) - 0.2, y0), new V2(rHull(y0) + span, ty0), new V2(rHull(y1) + span * 0.92, ty1), new V2(rHull(y1) - 0.2, y1)]);
    return extrude(THREE, s, th, high ? 0.06 : 0, 1);
  };
  const aft = flap(1.2, 12.5, 2.8, 9.4, 4.4, 0.42), fwd = flap(37.6, 45.8, 39.2, 44.8, 3.1, 0.36);
  const cover = (y0, y1, rr) => new THREE.BoxGeometry(0.9, y1 - y0, 1.5).translate(rr + 0.3, (y0 + y1) / 2, 0);
  const steelParts = [], darkParts = [];
  for (const s of [1, -1]) {
    const m = new THREE.Matrix4().makeRotationY(s > 0 ? 0 : Math.PI);
    steelParts.push(boxUV(THREE, aft.clone().applyMatrix4(m), TS.stainless), boxUV(THREE, fwd.clone().applyMatrix4(m), TS.stainless),
      boxUV(THREE, cover(0.8, 13, R - 0.2).applyMatrix4(m), TS.stainless), boxUV(THREE, cover(37.6, 45.2, rHull(41.5) - 0.35).applyMatrix4(m), TS.stainless));
  }
  // weld / ring frames and the header tank band
  for (const y of [8.5, 17.2, 25.8, 33]) steelParts.push(cylUV(new THREE.CylinderGeometry(R + 0.035, R + 0.035, 0.18, seg, 1, true).translate(0, y, 0), R, TS.stainless).toNonIndexed());
  darkParts.push(tiles, new THREE.CylinderGeometry(3.75, 4.0, 1.2, seg, 1, true).translate(0, -0.3, 0).toNonIndexed());
  // legs
  const legs = [];
  for (let k = 0; k < 6; k++) {
    const a = k / 6 * Math.PI * 2 + 0.26, c = Math.cos(a), sn = Math.sin(a);
    legs.push(new THREE.CylinderGeometry(0.22, 0.28, 2.2, 6).rotateZ(0.42).rotateY(-a).translate(c * 4.25, -0.75, sn * 4.25).toNonIndexed());
    legs.push(new THREE.BoxGeometry(1.1, 0.18, 1.1).rotateY(-a).translate(c * 4.7, -1.62, sn * 4.7).toNonIndexed());
  }

  const out = [];
  for (const s of ships) {
    const lod = s.lod ?? (high ? 1 : 0);
    // base: lowest ground under the footprint, pad slab fills the gap
    let gy = Infinity; for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; gy = Math.min(gy, height(s.x + Math.cos(a) * 12, s.z + Math.sin(a) * 12)); }
    gy = Math.min(gy, height(s.x, s.z));
    const tr = new THREE.Matrix4().makeRotationY(s.ry || 0).premultiply(new THREE.Matrix4().makeScale(s.k || 1, s.k || 1, s.k || 1)).setPosition(s.x, gy + 0.6 + LIFT, s.z);
    const T = g => g.clone().applyMatrix4(tr);
    B.P(M.stainless, T(body)); steelParts.forEach(g => B.P(M.stainless, T(g)));
    darkParts.forEach(g => B.P(M.dark, T(g))); if (lod) legs.forEach(g => B.P(M.stainless, T(g)));
    B.P(M.pad, boxUV(THREE, new THREE.CylinderGeometry(11, 12, 2.4, high ? 32 : 16).translate(s.x, gy - 0.6, s.z), TS.habitat_panel));
    B.P(M.beacon, new THREE.SphereGeometry(0.35, 8, 6).translate(0, 50.6, 0).applyMatrix4(tr));
    out.push({ x: s.x, z: s.z, y: gy + 0.6 + LIFT, top: gy + 0.6 + LIFT + 50.4 * (s.k || 1) });
  }
  [body, tiles, aft, fwd, ...steelParts, ...darkParts, ...legs].forEach(g => g.dispose());
  return out;
}
