// sol-game.js: the Direction 3 "little game" for D6 Mission Control. Click the lidar terrain to drop zone
// vertices (drag a handle to move it), click the first point or double-click to close; the excavator turns,
// drives into reach and digs: zone points sink, the spoil pile grows where it dumps. Runs a demo dig on its
// own until someone plays. Pointer input is only live while `active` (control mode); wheel is never captured.

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const io2 = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const in2 = t => t * t, out2 = t => 1 - (1 - t) * (1 - t);
const io3 = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const MAXV = 16, SEG = 20;

export function createGame({ THREE, scene, canvas, camera, exc, grid, hField, MSCALE, zoneLineMat, zoneFillMat, handleMat }) {
  const { NX, NZ, SP, X0, Z0, gx, gz, aCut, aZone, cutAttr, zoneAttr } = grid;
  const HOME = { x: -4, z: 4 };
  const pos = { x: HOME.x, z: HOME.z }; let yaw = 0.35;
  const ARM = { a1: 0.55, a2: -1.5, a3: -0.6, sw: 0 }, REST = { a1: 0.55, a2: -1.5, a3: -0.6, sw: 0 };
  const DIG = { a1: -0.12, a2: -1.0, a3: 0.25 };
  let amp = 1, speed = 0, state = 'IDLE', active = false, vis = 0;
  const focus = new THREE.Vector3(HOME.x + 5, 0, HOME.z - 1), focusGoal = focus.clone();

  // reach: distance from machine origin to the teeth in dig pose
  exc.setArm(DIG.a1, DIG.a2, DIG.a3, 0); exc.root.position.set(0, 0, 0); exc.root.rotation.set(0, 0, 0); exc.root.updateMatrixWorld(true);
  const tv = new THREE.Vector3(); exc.tip.getWorldPosition(tv); const REACH = tv.x;
  exc.setArm(REST.a1, REST.a2, REST.a3, 0);

  // bucket load: a few dirt points that ride in the bucket
  const lp = new Float32Array(120 * 3); for (let k = 0; k < 120; k++) { lp[k * 3] = 0.45 + Math.random() * 0.8; lp[k * 3 + 1] = -0.7 + Math.random() * 0.75; lp[k * 3 + 2] = (Math.random() - 0.5) * 1.0; }
  const loadGeo = new THREE.BufferGeometry(); loadGeo.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  const loadMat = new THREE.PointsMaterial({ size: 0.12, color: 0xd9f2ff, transparent: true, opacity: 0, depthWrite: false });
  const load = new THREE.Points(loadGeo, loadMat); load.renderOrder = 3; exc.bucket.add(load);

  // ------------------------------------------------------------------ zone visuals (preallocated)
  const vx = new Float32Array(MAXV), vz = new Float32Array(MAXV); let nv = 0, closed = false;
  const zl = new Float32Array((MAXV * SEG + 1) * 3), zlGeo = new THREE.BufferGeometry();
  zlGeo.setAttribute('position', new THREE.BufferAttribute(zl, 3).setUsage(THREE.DynamicDrawUsage)); zlGeo.setDrawRange(0, 0);
  const zLine = new THREE.Line(zlGeo, zoneLineMat); zLine.frustumCulled = false; zLine.renderOrder = 5;
  const hp = new Float32Array(MAXV * 3), hGeo = new THREE.BufferGeometry();
  hGeo.setAttribute('position', new THREE.BufferAttribute(hp, 3).setUsage(THREE.DynamicDrawUsage)); hGeo.setDrawRange(0, 0);
  const handles = new THREE.Points(hGeo, handleMat); handles.frustumCulled = false; handles.renderOrder = 6;
  let fill = null;
  const grp = new THREE.Group(); grp.add(zLine, handles); scene.add(grp);
  const api = { focus, zoneVis: 0, fillVis: 0 };
  let fillA = 0, fillTarget = 0;

  const writeZone = () => {
    let o = 0;
    const segs = closed ? nv : nv - 1;
    for (let s = 0; s < segs; s++) {
      const a = s, b = (s + 1) % nv;
      for (let k = 0; k < SEG; k++) { const f = k / SEG, x = vx[a] + (vx[b] - vx[a]) * f, z = vz[a] + (vz[b] - vz[a]) * f; zl[o++] = x; zl[o++] = hField(x, z) * amp + 0.18; zl[o++] = z; }
    }
    if (nv) { const e = closed ? 0 : nv - 1; zl[o++] = vx[e]; zl[o++] = hField(vx[e], vz[e]) * amp + 0.18; zl[o++] = vz[e]; }
    zlGeo.setDrawRange(0, nv > 1 ? o / 3 : 0); zlGeo.attributes.position.needsUpdate = true;
    for (let i = 0; i < nv; i++) { hp[i * 3] = vx[i]; hp[i * 3 + 1] = hField(vx[i], vz[i]) * amp + 0.18; hp[i * 3 + 2] = vz[i]; }
    hGeo.setDrawRange(0, nv); hGeo.attributes.position.needsUpdate = true;
  };

  const inPoly = (x, z) => { let c = false; for (let i = 0, j = nv - 1; i < nv; j = i++) { if ((vz[i] > z) !== (vz[j] > z) && x < ((vx[j] - vx[i]) * (z - vz[i])) / (vz[j] - vz[i]) + vx[i]) c = !c; } return c; };
  let zoneIdx = new Int32Array(0);
  const touched = new Uint8Array(grid.N); let touchedList = [];
  const touch = i => { if (!touched[i]) { touched[i] = 1; touchedList.push(i); } };

  const closeZone = () => {
    if (nv < 3 || closed) return closed;
    closed = true; writeZone();
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (let i = 0; i < nv; i++) { x0 = Math.min(x0, vx[i]); x1 = Math.max(x1, vx[i]); z0 = Math.min(z0, vz[i]); z1 = Math.max(z1, vz[i]); }
    const i0 = Math.max(0, Math.floor((x0 - X0) / SP)), i1 = Math.min(NX - 1, Math.ceil((x1 - X0) / SP)), j0 = Math.max(0, Math.floor((z0 - Z0) / SP)), j1 = Math.min(NZ - 1, Math.ceil((z1 - Z0) / SP));
    const idx = [], inside = new Uint8Array((i1 - i0 + 1) * (j1 - j0 + 1)), W = j1 - j0 + 1;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const k = i * NZ + j; if (inPoly(gx[k], gz[k])) { idx.push(k); aZone[k * 2 + 1] = 1; inside[(i - i0) * W + (j - j0)] = 1; } }
    zoneIdx = Int32Array.from(idx); zoneAttr.needsUpdate = true;
    // draped fill from the lattice cells fully inside the zone
    const fp = [];
    for (let i = i0; i < i1; i++) for (let j = j0; j < j1; j++) {
      const a = (i - i0) * W + (j - j0); if (!(inside[a] && inside[a + 1] && inside[a + W] && inside[a + W + 1])) continue;
      const P = (ii, jj) => { const x = X0 + ii * SP, z = Z0 + jj * SP; return [x, hField(x, z), z]; };
      const p00 = P(i, j), p01 = P(i, j + 1), p10 = P(i + 1, j), p11 = P(i + 1, j + 1);
      fp.push(...p00, ...p01, ...p10, ...p10, ...p01, ...p11);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    fill = new THREE.Mesh(g, zoneFillMat); fill.renderOrder = 4; fill.position.y = 0.08; fill.frustumCulled = false; grp.add(fill);
    fillA = 0; fillTarget = 1; flash = 0.5;
    return true;
  };
  const clearZone = () => {
    for (let k = 0; k < zoneIdx.length; k++) aZone[zoneIdx[k] * 2 + 1] = 0;
    zoneIdx = new Int32Array(0); zoneAttr.needsUpdate = true;
    nv = 0; closed = false; writeZone();
    if (fill) { grp.remove(fill); fill.geometry.dispose(); fill = null; }
    fillA = fillTarget = 0;
    // ease every changed point back to ground
    if (touchedList.length) {
      const idx = Int32Array.from(touchedList), delta = new Float32Array(idx.length);
      for (let k = 0; k < idx.length; k++) { delta[k] = -aCut[idx[k]]; touched[idx[k]] = 0; }
      touchedList = []; shape(idx, delta, 0.9);
    }
  };
  const addVert = (x, z) => {
    if (nv >= MAXV) return;
    if (nv && Math.hypot(x - vx[nv - 1], z - vz[nv - 1]) < 1.2) return;
    vx[nv] = x; vz[nv] = z; nv++; writeZone(); flash = 0.25;
  };

  // ------------------------------------------------------------------ point height tweens (batched)
  const batches = [];
  function shape(idx, delta, dur) {
    const from = new Float32Array(idx.length); for (let k = 0; k < idx.length; k++) { from[k] = aCut[idx[k]]; touch(idx[k]); }
    batches.push({ idx, from, delta, t: 0, d: dur });
  }
  const runBatches = dt => {
    if (!batches.length) return;
    for (let b = batches.length - 1; b >= 0; b--) {
      const B = batches[b]; B.t = Math.min(B.d, B.t + dt); const k = out2(B.t / B.d);
      for (let i = 0; i < B.idx.length; i++) aCut[B.idx[i]] = B.from[i] + B.delta[i] * k;
      if (B.t >= B.d) batches.splice(b, 1);
    }
    cutAttr.needsUpdate = true;
  };
  const wp = new THREE.Vector3();
  function carve(depth) {
    exc.tip.getWorldPosition(wp); const R = 7, idx = [], delta = [];
    for (let k = 0; k < zoneIdx.length; k++) {
      const i = zoneIdx[k], d = Math.hypot(gx[i] - wp.x, gz[i] - wp.z), f = Math.max(0, 1 - d / R);
      const add = depth * f * f * 1.6 + depth * 0.18;
      if (aCut[i] < 2.8) { idx.push(i); delta.push(Math.min(add, 2.8 - aCut[i])); }
    }
    shape(Int32Array.from(idx), Float32Array.from(delta), 0.7);
  }
  function dump() {
    exc.tip.getWorldPosition(wp); const R = 5.5, idx = [], delta = [];
    const i0 = Math.max(0, Math.floor((wp.x - R - X0) / SP)), i1 = Math.min(NX - 1, Math.ceil((wp.x + R - X0) / SP));
    const j0 = Math.max(0, Math.floor((wp.z - R - Z0) / SP)), j1 = Math.min(NZ - 1, Math.ceil((wp.z + R - Z0) / SP));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
      const k = i * NZ + j; if (aZone[k * 2 + 1]) continue;
      const d = Math.hypot(gx[k] - wp.x, gz[k] - wp.z); if (d > R) continue;
      idx.push(k); delta.push(-(Math.cos((d / R) * Math.PI) + 1) * 0.45);
    }
    shape(Int32Array.from(idx), Float32Array.from(delta), 0.9);
  }

  // ------------------------------------------------------------------ job runner (sequential steps)
  let steps = null, si = 0, st = 0, started = false, onDone = null, flash = 0, jobOn = false;
  const run = (list, done, job = true) => { steps = list; si = 0; st = 0; started = false; onDone = done; jobOn = job; };
  const armTo = (to, d, ease = io2) => { const from = {}; return { d, s() { for (const k in to) from[k] = ARM[k]; }, u(k) { const e = ease(k); for (const k2 in to) ARM[k2] = from[k2] + ((typeof to[k2] === 'function' ? to[k2]() : to[k2]) - from[k2]) * e; } }; };
  const call = fn => ({ d: 0, s: fn });
  const tickJob = dt => {
    while (steps && si < steps.length) {
      const S = steps[si];
      if (!started) { started = true; S.s && S.s(); }
      st += dt; dt = 0;
      const k = S.d > 0 ? Math.min(1, st / S.d) : 1;
      S.u && S.u(k);
      if (k < 1) return;
      S.e && S.e(); si++; st = 0; started = false;
    }
    if (steps) { steps = null; jobOn = false; const d = onDone; onDone = null; d && d(); }
  };
  const busy = () => jobOn;
  const stopJob = () => { steps = null; onDone = null; speed = 0; run([armTo({ ...REST }, 0.8)], null, false); loadMat.opacity = 0; load.position.y = 0; state = 'IDLE'; };

  let DUMP = 1.55;
  function runJob() {
    if (busy() || !zoneIdx.length) return;
    let cx = 0, cz = 0; for (let i = 0; i < nv; i++) { cx += vx[i]; cz += vz[i]; } cx /= nv; cz /= nv;
    const dx = cx - pos.x, dz = cz - pos.z, dist = Math.hypot(dx, dz) || 1;
    const ty = Math.atan2(-dz, dx), dYaw = Math.atan2(Math.sin(ty - yaw), Math.cos(ty - yaw)), y0 = yaw;
    const tx = cx - (dx / dist) * REACH, tz = cz - (dz / dist) * REACH;
    const sx = pos.x, sz = pos.z, travel = Math.hypot(tx - sx, tz - sz);
    // dump toward the camera side so the pile shows
    const cdx = camera.position.x - cx, cdz = camera.position.z - cz;
    DUMP = (Math.cos(ty + 1.55) * cdx - Math.sin(ty + 1.55) * cdz) > 0 ? 1.55 : -1.55;
    focusGoal.set((cx + tx) / 2, 0, (cz + tz) / 2);
    state = 'EN ROUTE';
    const list = [
      { d: Math.max(0.8, 0.4 + Math.abs(dYaw) * 0.5), s() { const f = {}; for (const k of ['a1', 'a2']) f[k] = ARM[k]; this.f = f; }, u(k) { const e = io2(k); yaw = y0 + dYaw * e; ARM.a1 = this.f.a1 + (0.75 - this.f.a1) * e; ARM.a2 = this.f.a2 + (-1.7 - this.f.a2) * e; exc.drive(Math.abs(dYaw) * 0.02); } },
      { d: Math.max(0.6, travel / 6), u(k) { const e = io2(k); const nx = sx + (tx - sx) * e, nz = sz + (tz - sz) * e; const m = Math.hypot(nx - pos.x, nz - pos.z); pos.x = nx; pos.z = nz; exc.drive(m / MSCALE); speed = travel > 0.5 ? 1 + Math.sin(k * Math.PI) * 4 : 0; } },
      call(() => { speed = 0; state = 'DIGGING'; fillTarget = 0; }),
    ];
    [0, -0.2, 0.2, -0.1, 0.12].forEach((sw, k) => list.push(
      armTo({ a1: DIG.a1 - k * 0.04, a2: DIG.a2, a3: DIG.a3, sw }, 0.9),
      call(() => carve(0.55 + k * 0.08)),
      armTo({ a3: -1.3, a2: -1.25 }, 0.5, in2),
      { d: 0.2, u(q) { loadMat.opacity = q; } },
      armTo({ a1: 0.65, a2: -1.45 }, 0.7, out2),
      armTo({ sw: () => DUMP }, 0.8),
      armTo({ a3: 0.7 }, 0.35, out2),
      call(dump),
      { d: 0.45, u(q) { load.position.y = -3 * in2(q); loadMat.opacity = 1 - q; }, e() { load.position.y = 0; } },
      armTo({ sw: 0, a3: -0.6 }, 0.75),
    ));
    run(list, () => { speed = 0; state = 'IDLE'; idleT = 0; });
  }

  // demo zones relative to the machine's home; cycles until someone plays
  const DEMOS = [[[5, -2], [13, -6], [16, 2], [8, 5]], [[-2, -9], [6, -12], [8, -5], [0, -3]], [[2, 7], [10, 6], [12, 13], [3, 14]]];
  let user = false, demoK = 0, idleT = 0, ctrlT = 0;
  const demo = () => { clearZone(); for (const [x, z] of DEMOS[demoK++ % DEMOS.length]) addVert(HOME.x + x, HOME.z + z); closeZone(); runJob(); };

  // ------------------------------------------------------------------ picking + pointer
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit = new THREE.Vector3(), sp = new THREE.Vector3();
  const pick = e => {
    const r = canvas.getBoundingClientRect(); ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); ray.setFromCamera(ndc, camera);
    plane.constant = 0;
    for (let k = 0; k < 5; k++) { if (!ray.ray.intersectPlane(plane, hit)) return null; plane.constant = -hField(hit.x, hit.z) * amp; }
    return Math.abs(hit.x) < -X0 - 3 && Math.abs(hit.z) < -Z0 - 3 ? hit : null;
  };
  const screenOf = (x, z, e) => { const r = canvas.getBoundingClientRect(); sp.set(x, hField(x, z) * amp + 0.18, z).project(camera); return Math.hypot((sp.x + 1) / 2 * r.width + r.left - e.clientX, (1 - sp.y) / 2 * r.height + r.top - e.clientY); };
  let drag = -1, downX = 0, downY = 0, moved = false;
  const onDown = e => {
    if (!active) return; downX = e.clientX; downY = e.clientY; moved = false; drag = -1;
    if (!closed && !busy()) for (let i = 0; i < nv; i++) if (screenOf(vx[i], vz[i], e) < 14) { drag = i; canvas.setPointerCapture && canvas.setPointerCapture(e.pointerId); break; }
  };
  const onMoveC = e => {
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 5) moved = true;
    if (drag >= 0 && active) { const p = pick(e); if (p) { vx[drag] = p.x; vz[drag] = p.z; writeZone(); } }
  };
  const onUp = () => { drag = -1; }; // a press on a handle without movement still counts as a click
  const onClick = e => {
    if (!active || moved) return;
    user = true; const p = pick(e); if (!p) return;
    if (busy() || closed) { stopJob(); clearZone(); }
    if (nv >= 3 && (screenOf(vx[0], vz[0], e) < 22 || Math.hypot(p.x - vx[0], p.z - vz[0]) < 2.5)) { if (closeZone()) runJob(); return; }
    addVert(p.x, p.z);
  };
  const onDbl = () => { if (!active) return; user = true; if (!busy() && closeZone()) runJob(); };
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMoveC); canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('click', onClick); canvas.addEventListener('dblclick', onDbl);

  // ------------------------------------------------------------------ per frame
  api.update = (dt, o) => {
    const wasActive = active; active = o.active; vis = o.vis;
    if (active !== wasActive) { canvas.style.pointerEvents = active ? 'auto' : 'none'; canvas.style.cursor = active ? 'crosshair' : ''; }
    const ampChanged = Math.abs(o.amp - amp) > 1e-4; amp = o.amp;
    grp.visible = vis > 0.004; exc.setOpacity(vis);
    if (vis <= 0.004) { ctrlT = 0; return; }
    ctrlT += dt;
    tickJob(dt); runBatches(dt);
    if (ampChanged && nv) writeZone();
    if (fill) { fillA += (fillTarget - fillA) * (1 - Math.exp(-dt * 3)); api.fillVis = fillA; fill.scale.y = amp; } else api.fillVis = 0;
    flash = Math.max(0, flash - dt);
    api.zoneVis = nv ? (flash > 0 ? (Math.sin(flash * 40) > 0 ? 1 : 0.3) : 1) : 0;
    // demo when nobody has played
    if (active && !user && !busy()) { idleT += dt; if ((!closed && ctrlT > 1.2 && demoK === 0) || (closed && idleT > 5)) demo(); }
    // machine on the ground
    const h = hField(pos.x, pos.z) * amp, e = 1.6;
    const dx = (hField(pos.x + e, pos.z) - hField(pos.x - e, pos.z)) * amp / (2 * e), dz = (hField(pos.x, pos.z + e) - hField(pos.x, pos.z - e)) * amp / (2 * e);
    const fx = Math.cos(yaw), fz = -Math.sin(yaw);
    const pitch = Math.atan(dx * fx + dz * fz) * 0.8, roll = Math.atan(dx * -fz + dz * fx) * 0.8;
    const r = exc.root; r.position.set(pos.x, h - 0.15, pos.z); r.rotation.y = yaw; r.rotation.z = pitch + (speed > 0 ? Math.sin(performance.now() / 90) * 0.01 : 0); r.rotation.x = -roll;
    api.roll = roll; api.pitch = pitch;
    exc.setArm(ARM.a1, ARM.a2, ARM.a3, ARM.sw);
    if (!busy() && closed === false && nv === 0) focusGoal.set(pos.x + 5, 0, pos.z - 1);
    if (!(nv > 0 && !closed)) focus.lerp(focusGoal, 1 - Math.exp(-dt * 1.2)); // hold the view while placing points
  };
  api.telemetry = out => {
    const R2D = 180 / Math.PI, yd = Math.atan2(Math.sin(yaw), Math.cos(yaw)) * R2D, rd = (api.roll || 0) * R2D + (speed > 0 ? Math.sin(performance.now() / 120) * 0.4 : 0);
    let dug = 0; for (let k = 0; k < zoneIdx.length; k += 7) dug = Math.max(dug, aCut[zoneIdx[k]]);
    out.height = +(412 + (hField(pos.x, pos.z) * amp - dug) * 3.28).toFixed(2);
    out.yaw = +yd.toFixed(2); out.roll = +rd.toFixed(2); out.body = +(ARM.sw * R2D).toFixed(2);
    out.speed = +speed.toFixed(1); out.state = state; out.blade = Math.max(-1, Math.min(1, rd / 12));
    return out;
  };
  Object.defineProperty(api, 'drawing', { get: () => nv > 0 && !closed });
  api.debug = () => ({ nv, closed, jobOn, user, active, state, demoK });
  api.demo = demo; api.clear = () => { stopJob(); clearZone(); };
  api.dispose = () => {
    canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMoveC); canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('click', onClick); canvas.removeEventListener('dblclick', onDbl);
    loadGeo.dispose(); loadMat.dispose(); zlGeo.dispose(); hGeo.dispose(); if (fill) fill.geometry.dispose();
  };
  return api;
}
