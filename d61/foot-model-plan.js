// D6.1 footer: the Jezero timelapse city plan (d5/main.js populateColony + ROCK_SITES), mirrored so the footer shows the
// same colony from ground level. Colony space: hub at the origin, metres, angles atan2(z, x). Mirrored, not imported:
// main.js builds it inline. If the colony plan changes there, update the constants here (CINEMA-NOTES, Footer).
// footerPlan() -> everything in footer space (eye at the origin, looking down -z), culled to what the lens can see.
import { rng } from './foot-model-kit.js';

// ---------------------------------------------------------------- the timelapse plan (colony space)
export const PLAN = {
  rings: [62, 132, 204], avenues: 8, hub: 20, outer: { r: 96, R: 15, a0: Math.PI / 8 }, tubeR: 2.4, tubeY: 2.6,
  land: [[55, -150], [15, -168]], build: [-25, -100], tower: [-12, 10], habR: [34, 238, 14],
};
// where the colony sits in the footer frame: hub left of centre ~400 m out, the plan mirrored and turned so the near outer
// dome sits between the hub and the pad, the pad ship stands clear and the two parked ships fall right of it
export const PLACE = { x: -82, z: -420, rot: 75 * Math.PI / 180, mirror: -1 };

export function toFooter(x, z) {
  const c = Math.cos(PLACE.rot), s = Math.sin(PLACE.rot); x *= PLACE.mirror;
  return [PLACE.x + x * c - z * s, PLACE.z + x * s + z * c];
}

const angD = (a, b) => Math.abs(((a - b) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI);

export function footerPlan({ high = true } = {}) {
  const r = rng(238), P = PLAN, T = toFooter;
  const near = 232, view = 0.72;                       // keep: further than this (the outer ring road runs ~225 m out, in front of the city), within this half-angle (rad)
  const seen = (x, z, pad = 0, nr = near) => -z > nr - pad && Math.abs(Math.atan2(x, -z)) < view;
  const outerA = [0, 1, 2, 3].map(k => P.outer.a0 + k * Math.PI / 2);
  const domes = [{ x: 0, z: 0, R: P.hub, hub: true }, ...outerA.map(a => ({ x: Math.cos(a) * P.outer.r, z: Math.sin(a) * P.outer.r, R: P.outer.R }))];
  const clearOf = [...P.land.map(([x, z]) => [x, z, 16]), [P.build[0], P.build[1], 30], [P.build[0] + P.tower[0], P.build[1] + P.tower[1], 8]];

  // small hab domes along the rings, same packing rule as the timelapse (own seed: its rnd stream is not reproducible here)
  const habs = [], fabs = [];
  for (let rr = P.habR[0]; rr < P.habR[1]; rr += P.habR[2]) {
    let a = rr * 0.11;
    while (a < rr * 0.11 + Math.PI * 2 - 0.05) {
      const rd = Math.min(6.6, 2.6 + r() * 3.2 + 5 * Math.exp(-rr / 70)), x = Math.cos(a) * rr, z = Math.sin(a) * rr;
      const nearAve = [...Array(P.avenues)].some((_, k) => angD(a, k * Math.PI / 4) * rr < rd + 4);
      const nearTube = rr < 86 && outerA.some(t => angD(a, t) * rr < rd + 3.5);
      const clear = !(nearAve || nearTube || P.rings.some(R => Math.abs(rr - R) < rd + 3.5) || domes.some(d => Math.hypot(x - d.x, z - d.z) < d.R + rd + 3)
        || clearOf.some(([cx, cz, cr]) => Math.hypot(x - cx, z - cz) < cr + rd));
      const keep = r() > 0.1, fab = rr > 175 && r() < 0.28, ys = 0.72 + r() * 0.35, ry = r() * 6.28, seed = r();
      if (clear && keep) {
        const [fx, fz] = T(x, z);
        if (seen(fx, fz, rd) && !(fab && Math.hypot(fx, fz) < 300)) (fab ? fabs : habs).push(fab ? { x: fx, z: fz, w: 8 + seed * 4, d: 5, h: 2.5 + ys * 2, ry: Math.PI / 2 - Math.atan2(fz - PLACE.z, fx - PLACE.x) } : { x: fx, z: fz, r: rd, ys, ry, seed });
      }
      a += (2 * rd + 2.6) / rr;
    }
  }
  const habsOut = high ? habs : habs.filter((_, i) => i % 2 === 0);

  // streetlights: both kerbs of every ring and avenue (timelapse spacing, a little sparser at ground level)
  const street = [];
  for (const R of P.rings) for (let i = 0; i < 260; i++) { const a = i / 260 * Math.PI * 2; for (const o of [-2.6, 2.6]) { const [x, z] = T(Math.cos(a) * (R + o), Math.sin(a) * (R + o)); if (seen(x, z, 0, 180)) street.push([x, z]); } }
  for (let k = 0; k < P.avenues; k++) { const a = k * Math.PI / 4; for (let rr = 24; rr < 250; rr += 6) for (const o of [-3, 3]) {
    const [x, z] = T(Math.cos(a) * rr + Math.cos(a + 1.5708) * o, Math.sin(a) * rr + Math.sin(a + 1.5708) * o); if (seen(x, z, 0, 180) && !domes.some(d => Math.hypot(Math.cos(a) * rr - d.x, Math.sin(a) * rr - d.z) < d.R + 1)) street.push([x, z]); } }

  const tubes = outerA.map(a => ({ from: T(Math.cos(a) * (P.hub - 1), Math.sin(a) * (P.hub - 1)), to: T(Math.cos(a) * (P.outer.r - P.outer.R + 1), Math.sin(a) * (P.outer.r - P.outer.R + 1)) }));
  return {
    center: T(0, 0), rings: P.rings, tubeR: P.tubeR, tubeY: P.tubeY,
    domes: domes.map(d => { const [x, z] = T(d.x, d.z); return { ...d, x, z }; }),
    tubes, habs: habsOut, fabs, street,
    land: P.land.map(([x, z]) => T(x, z)), build: T(...P.build),
    tower: (([x, z]) => [x - 17, z - 4])(T(...P.build)),     // beside the pad on the lens's left (the timelapse offset would stand it in front of the ship)
    ring: (R, a) => T(Math.cos(a) * R, Math.sin(a) * R),   // a point on a ring road (colony angle), footer space
  };
}
