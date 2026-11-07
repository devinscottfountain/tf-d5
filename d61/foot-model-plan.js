// D6.1 footer: the Jezero timelapse city, placed in the footer frame so the footer shows the same colony from ground level.
// Source: colonyLayout() from d5/habitat.js (COLONY's layout API: the exact lots main.js builds). Namespace import, so a
// build without that export still links; then a local mirror of the same plan (own seed for the hab lots) stands in.
// footerPlan() -> everything in footer space (eye at the origin, looking down -z), culled to what the lens can see.
import * as HAB from '../d5/habitat.js';
import { rng } from './foot-model-kit.js';

// where the colony sits in the footer frame: hub left of centre ~430 m out, the plan mirrored and turned so the near outer
// dome sits between the hub and the pad, the pad ship stands clear and the two parked ships fall right of it
export const PLACE = { x: -82, z: -420, rot: 75 * Math.PI / 180, mirror: -1 };

export function toFooter(x, z) {
  const c = Math.cos(PLACE.rot), s = Math.sin(PLACE.rot); x *= PLACE.mirror;
  return [PLACE.x + x * c - z * s, PLACE.z + x * s + z * c];
}

const angD = (a, b) => Math.abs(((a - b) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);

// fallback: the timelapse plan rebuilt locally (same constants and packing rule as d5/main.js), colonyLayout's shape
function mirrorLayout(high) {
  const r = rng(238), RINGS = [62, 132, 204], AVE = 8, land = [[55, -150], [15, -168]], build = [-25, -100];
  const domes = [{ x: 0, z: 0, r: 20, kind: 'hub' }], tubes = [];
  for (let k = 0; k < 4; k++) { const a = Math.PI / 8 + k * Math.PI / 2; domes.push({ x: Math.cos(a) * 96, z: Math.sin(a) * 96, r: 15, kind: 'outer' }); tubes.push({ a, r0: 19, len: 62, y: 2.6, radius: 2.4 }); }
  const habs = [], fabs = [];
  for (let rr = 34; rr < 238; rr += 14) {
    let a = rr * 0.11;
    while (a < rr * 0.11 + Math.PI * 2 - 0.05) {
      const rd = Math.min(6.6, 2.6 + r() * 3.2 + 5 * Math.exp(-rr / 70)), x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const clear = !([...Array(AVE)].some((_, k) => angD(a, k * Math.PI / 4) * rr < rd + 4) || (rr < 86 && tubes.some(t => angD(a, t.a) * rr < rd + 3.5))
        || RINGS.some(R => Math.abs(rr - R) < rd + 3.5) || domes.some(d => Math.hypot(x - d.x, z - d.z) < d.r + rd + 3)
        || land.some(([cx, cz]) => Math.hypot(x - cx, z - cz) < rd + 16) || Math.hypot(x - build[0], z - build[1]) < rd + 30);
      const keep = r() > 0.1, fab = rr > 175 && r() < 0.28, ys = 0.72 + r() * 0.35, rot = r() * 6.28, seed = r() * 50;
      if (clear && keep) { if (fab) fabs.push({ x, z, w: 8 + seed / 12, d: 5, h: 2.5 + ys * 2, rot: a }); else habs.push({ x, z, r: rd, ys, rot, seed, type: Math.floor(seed * 7.7) % 4 }); }
      a += (2 * rd + 2.6) / rr;
    }
  }
  return { rings: RINGS.map(r => ({ r })), avenues: [...Array(AVE)].map((_, k) => ({ a: k * Math.PI / 4, r0: 20, r1: 250 })), domes, tubes,
    habs: high ? habs : habs.filter((_, i) => i % 2 === 0), fabs, ships: land.map(([x, z]) => ({ x, z })), buildPad: { x: build[0], z: build[1], r: 16.5 } };
}

export function footerPlan({ high = true } = {}) {
  let L = null;
  try { L = HAB.colonyLayout?.({ high, rockets: true }) || null; } catch (_) { L = null; }
  const src = L ? 'colonyLayout' : 'mirror';
  L = L || mirrorLayout(high);
  const T = toFooter;
  const near = 232, view = 0.72;    // keep: further than this (the outer ring road runs ~225 m out, in front of the city), within this half-angle (rad)
  const seen = (x, z, pad = 0, nr = near) => -z > nr - pad && Math.abs(Math.atan2(x, -z)) < view;
  const domes = L.domes.map(d => { const [x, z] = T(d.x, d.z); return { x, z, R: d.r, hub: d.kind === 'hub', cx: d.x, cz: d.z }; });
  const habs = [], fabs = [];
  for (const h of L.habs) { const [x, z] = T(h.x, h.z); if (seen(x, z, h.r)) habs.push({ x, z, r: h.r, ys: h.ys, ry: h.rot, seed: (h.seed % 1 + h.seed / 50) % 1, type: h.type ?? 0 }); }
  for (const f of L.fabs) { const [x, z] = T(f.x, f.z); if (seen(x, z, f.w) && Math.hypot(x, z) > 300) fabs.push({ x, z, w: f.w, d: f.d, h: f.h, ry: Math.PI / 2 - Math.atan2(z - PLACE.z, x - PLACE.x) }); }

  // streetlights: both kerbs of every ring and avenue (timelapse spacing, a little sparser at ground level)
  const street = [], rings = L.rings.map(r => r.r);
  for (const R of rings) for (let i = 0; i < 260; i++) { const a = i / 260 * Math.PI * 2; for (const o of [-2.6, 2.6]) { const [x, z] = T(Math.cos(a) * (R + o), Math.sin(a) * (R + o)); if (seen(x, z, 0, 180)) street.push([x, z]); } }
  for (const av of L.avenues) { const a = av.a; for (let rr = av.r0 + 4; rr < av.r1; rr += 6) for (const o of [-3, 3]) {
    const cx = Math.cos(a) * rr + Math.cos(a + 1.5708) * o, cz = Math.sin(a) * rr + Math.sin(a + 1.5708) * o, [x, z] = T(cx, cz);
    if (seen(x, z, 0, 180) && !domes.some(d => Math.hypot(cx - d.cx, cz - d.cz) < d.R + 1)) street.push([x, z]); } }

  const tubes = L.tubes.map(t => ({ from: T(Math.cos(t.a) * t.r0, Math.sin(t.a) * t.r0), to: T(Math.cos(t.a) * (t.r0 + t.len), Math.sin(t.a) * (t.r0 + t.len)) }));
  const tube0 = L.tubes[0] || { radius: 2.4, y: 2.6 }, build = T(L.buildPad.x, L.buildPad.z);
  return {
    src, center: T(0, 0), rings, tubeR: tube0.radius, tubeY: tube0.y,
    domes, tubes, habs, fabs, street,
    land: L.ships.map(s => T(s.x, s.z)), build, padR: L.buildPad.r,
    tower: [build[0] - 17, build[1] - 4],     // beside the pad on the lens's left (the timelapse offset would stand it in front of the ship)
    ring: (R, a) => T(Math.cos(a) * R, Math.sin(a) * R),   // a point on a ring road (colony angle), footer space
  };
}
