// rockets.js: Starships for the Jezero timelapse (D5_CFG.rockets). Two ships land early (plume, dust, engine cut) and stay parked;
// later a third is stacked on a pad beside a crane tower: rings, nose, flaps, scaffold drops away. Hull geometry comes from the
// D6.1 footer's buildStarships (unchanged), collected into ship-local parts. Everything is driven by the build progress g.
// createRockets({ THREE, foot, colony, envMap, high, sites }) -> { update(g, t, night), group }
//   foot: { buildStarships, mergeAll } from d61/foot-model-starship.js + d61/foot-model-kit.js; sites: { land: [[x, z], ...], build: [x, z] } in colony space (metres)

const sst = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const cl01 = x => Math.min(1, Math.max(0, x)), eo = x => 1 - Math.pow(1 - cl01(x), 3);
// arrival: [start, touchdown] per ship; build: hull bands (m from the feet) and when each one is lifted into place
const LAND = [[0.012, 0.07], [0.04, 0.1]], DROP = 520;
const BANDS = [0, 10.2, 18.9, 27.5, 34.7, 52.2], LIFT_AT = [0.44, 0.5, 0.56, 0.62, 0.68], LIFT_LEN = 0.05;
const PAD0 = 0.34, TOWER = [0.36, 0.44], FLAPS = [0.75, 0.81], SCAF_DROP = [0.83, 0.89];

export function createRockets({ THREE, foot, colony, envMap, high, sites }) {
  const group = new THREE.Group(); colony.add(group);
  // ---------- ship parts from the footer builder: one ship at the origin, sorted into hull / flaps / dark ----------
  const steelK = {}, darkK = {}, padK = {}, beaconK = {}, calls = [];
  const out = foot.buildStarships({ THREE, B: { P: (m, g) => calls.push([m, g]) }, M: { stainless: steelK, dark: darkK, pad: padK, beacon: beaconK }, high, ships: [{ x: 0, z: 0, lod: 1 }] });
  const base = out[0].y, hull = [], flaps = [], dark = [], bb = new THREE.Box3();
  for (const [m, g] of calls) {
    if (m === padK || m === beaconK) { g.dispose(); continue; }
    g.translate(0, -base, 0); g.computeBoundingBox(); bb.copy(g.boundingBox);
    if (m === darkK) { dark.push(g); continue; }
    const rad = Math.max(-bb.min.x, bb.max.x, -bb.min.z, bb.max.z), h = bb.max.y - bb.min.y;
    (rad > 4.8 && h > 1 && bb.max.y > 0.5 ? flaps : hull).push(g); // flaps + aerocovers stand proud of the 4.5 m hull; ring bands are thin
  }
  const merge = gs => { const g = foot.mergeAll(THREE, gs); let y0 = Infinity; const p = g.attributes.position; for (let i = 0; i < p.count; i++) y0 = Math.min(y0, p.getY(i)); g.userData.y0 = y0; return g; };
  const all = merge([...hull, ...flaps]), hullG = merge(hull), flapG = merge(flaps), darkG = merge(dark);
  const FEET = -Math.min(all.userData.y0, darkG.userData.y0); // lift so the leg pads touch y = 0
  [all, hullG, flapG, darkG].forEach(g => { g.translate(0, FEET, 0); g.computeBoundingSphere(); });
  [...hull, ...flaps, ...dark].forEach(g => g.dispose());

  const steel = new THREE.MeshStandardMaterial({ color: 0xc2c4c8, metalness: 0.85, roughness: 0.3, envMap });
  const tiles = new THREE.MeshStandardMaterial({ color: 0x18191c, metalness: 0.1, roughness: 0.75 });
  const orange = new THREE.MeshStandardMaterial({ color: 0xf0a35a, emissive: 0x3a1a00, roughness: 0.6 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x8a8078, roughness: 0.9 });

  // ---------- arrival: two parked ships, instanced ----------
  const landSteel = new THREE.InstancedMesh(all, steel, LAND.length), landDark = new THREE.InstancedMesh(darkG, tiles, LAND.length);
  [landSteel, landDark].forEach(m => { m.castShadow = m.receiveShadow = true; m.frustumCulled = false; group.add(m); });
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  const yaw = sites.land.map((s, i) => new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.6 + i * 1.9));
  // plume: open cone, hot core to orange tail, additive; plus a soft glow sprite at the nozzles
  const plumeMat = new THREE.ShaderMaterial({
    uniforms: { uI: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying float vY; varying vec3 vN, vV; void main(){ vY = -position.y; vec4 mv = modelViewMatrix * vec4(position, 1.); vN = normalMatrix * normal; vV = -mv.xyz; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform float uI; varying float vY; varying vec3 vN, vV; void main(){ float f = abs(dot(normalize(vN), normalize(vV)));'
      + ' vec3 c = mix(vec3(1., .95, .86), vec3(1., .45, .16), smoothstep(0., .7, vY)); gl_FragColor = vec4(c * pow(1. - vY, 1.6) * (0.35 + 0.65 * f) * uI * 2.2, 1.); }'
  });
  const cone = new THREE.ConeGeometry(1, 1, 18, 1, true).rotateX(Math.PI).translate(0, -0.5, 0); // base at y 0, tip at y -1
  const glowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,190,120,0.6)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const plumes = sites.land.map(() => {
    const m = new THREE.Mesh(cone, plumeMat.clone()), s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffc08a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    m.frustumCulled = false; group.add(m, s); return { m, s };
  });
  // dust: soft particles thrown out radially at touchdown, per ship phase
  const ND = high ? 110 : 50, dA = new Float32Array(ND * LAND.length * 4);
  for (let i = 0; i < ND * LAND.length; i++) { const h = k => { const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453; return s - Math.floor(s); }; dA.set([Math.floor(i / ND), h(1) * 6.2832, 0.35 + 0.65 * h(2), h(3)], i * 4); }
  const dG = new THREE.BufferGeometry(); dG.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(ND * LAND.length * 3), 3)); dG.setAttribute('d', new THREE.BufferAttribute(dA, 4));
  const dU = { uPh: { value: new THREE.Vector2() }, uC0: { value: new THREE.Vector3(sites.land[0][0], 0, sites.land[0][1]) }, uC1: { value: new THREE.Vector3(sites.land[1][0], 0, sites.land[1][1]) }, uNight: { value: 0 } };
  const dust = new THREE.Points(dG, new THREE.ShaderMaterial({
    uniforms: dU, transparent: true, depthWrite: false,
    vertexShader: `attribute vec4 d; uniform vec2 uPh; uniform vec3 uC0, uC1; varying float vA;
      void main(){ float ph = d.x < .5 ? uPh.x : uPh.y; vec3 c = d.x < .5 ? uC0 : uC1;
        float r = 5. + d.z * (8. + 62. * pow(ph, .55)), h = 1. + d.w * 16. * pow(ph, .7);
        vec4 mv = modelViewMatrix * vec4(c + vec3(cos(d.y) * r, h, sin(d.y) * r), 1.);
        vA = ph > 0. && ph < 1. ? 0.2 * smoothstep(0., .1, ph) * pow(1. - ph, 1.4) : 0.;
        gl_PointSize = vA > 0. ? clamp((16. + 34. * ph) * (0.7 + 0.6 * d.w) * 1100. / -mv.z, 1., 256.) : 0.; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float uNight; varying float vA; void main(){ float r = length(gl_PointCoord - .5); gl_FragColor = vec4(vec3(.74, .5, .35) * (1. - .8 * uNight), vA * pow(smoothstep(.5, 0., r), 1.5)); }`
  }));
  dust.frustumCulled = false; group.add(dust);

  // ---------- build site: pad, crane tower with a slewing jib, scaffold, the ship stacked band by band ----------
  const [bx, bz] = sites.build, B = new THREE.Vector3(bx, 0, bz);
  const clipU = () => ({ value: new THREE.Vector2(-1, -1) });
  const clipMat = (base, U, depth) => {
    const m = depth ? new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }) : base.clone();
    if (!depth) m.side = THREE.DoubleSide; // open band tops show the inside wall
    m.onBeforeCompile = s => { s.uniforms.uBand = U;
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying float vLY;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvLY = position.y;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec2 uBand; varying float vLY;').replace('void main() {', 'void main() {\nif (vLY < uBand.x || vLY > uBand.y) discard;'); };
    m.customProgramCacheKey = () => depth ? 'd5clip-d' : 'd5clip'; return m;
  };
  const band = (geo, mat) => { const U = clipU(), m = new THREE.Mesh(geo, clipMat(mat, U)); m.customDepthMaterial = clipMat(null, U, true); m.castShadow = m.receiveShadow = true; m.position.copy(B); m.userData.U = U; group.add(m); return m; };
  const stackS = band(hullG, steel), stackD = band(darkG, tiles), liftS = band(hullG, steel), liftD = band(darkG, tiles);
  const flapM = new THREE.Mesh(flapG, steel); flapM.position.copy(B); flapM.castShadow = flapM.receiveShadow = true; group.add(flapM);
  const pad = new THREE.Mesh(new THREE.CylinderGeometry(15, 16.5, 1.2, high ? 40 : 24).translate(0, 0.6, 0), concrete); pad.position.copy(B); pad.receiveShadow = pad.castShadow = true; group.add(pad);
  // tower: lattice of thin boxes, behind-left of the ship as the late camera sees it
  const box = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z), TH = 74;
  const tw = []; for (const sx of [-3, 3]) for (const sz of [-3, 3]) tw.push(box(0.7, TH, 0.7, sx, TH / 2, sz));
  for (let y = 4; y < TH; y += 6) { tw.push(box(6.7, 0.35, 0.35, 0, y, -3), box(6.7, 0.35, 0.35, 0, y, 3), box(0.35, 0.35, 6.7, -3, y, 0), box(0.35, 0.35, 6.7, 3, y, 0)); }
  const towerG = foot.mergeAll(THREE, tw); tw.forEach(g => g.dispose());
  const tower = new THREE.Mesh(towerG, orange); tower.castShadow = true; tower.position.set(bx - 12, 0, bz + 10); group.add(tower);
  const toShip = Math.atan2(-(bz - tower.position.z), bx - tower.position.x), reach = Math.hypot(bx - tower.position.x, bz - tower.position.z);
  const jib = new THREE.Group(); jib.position.set(tower.position.x, TH, tower.position.z); group.add(jib);
  const jibM = new THREE.Mesh(foot.mergeAll(THREE, [box(reach + 8, 1.2, 1.2, (reach + 8) / 2 - 2, 1, 0), box(5, 2.6, 2.4, -5, 0.6, 0), box(1.6, 3, 1.6, 0, 2.5, 0)]), orange); jibM.castShadow = true; jib.add(jibM);
  const cable = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1, 0.15).translate(0, -0.5, 0), orange); cable.position.set(reach, 0.5, 0); jib.add(cable);
  const sc = []; for (const sx of [-6.5, 6.5]) for (const sz of [-6.5, 6.5]) sc.push(box(0.3, 52, 0.3, sx, 26, sz));
  for (let y = 3; y < 52; y += 6.5) sc.push(box(13.3, 0.25, 0.25, 0, y, -6.5), box(13.3, 0.25, 0.25, 0, y, 6.5), box(0.25, 0.25, 13.3, -6.5, y, 0), box(0.25, 0.25, 13.3, 6.5, y, 0), box(13, 0.12, 2.2, 0, y - 0.1, -5.4));
  const scaf = new THREE.Mesh(foot.mergeAll(THREE, sc), orange); sc.forEach(g => g.dispose()); scaf.position.copy(B); scaf.castShadow = true; group.add(scaf);
  // work lights: warm points round the pad and up the tower, they carry the stack at night
  const lp = []; for (let i = 0; i < 8; i++) { const a = i / 8 * 6.2832; lp.push(bx + Math.cos(a) * 15.5, 1.6, bz + Math.sin(a) * 15.5); }
  for (let y = 12; y < TH; y += 15) lp.push(tower.position.x + 3.4, y, tower.position.z - 3.4);
  const lG = new THREE.BufferGeometry(); lG.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
  const lU = { uOn: { value: 0 } };
  const lights = new THREE.Points(lG, new THREE.ShaderMaterial({ uniforms: lU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'uniform float uOn; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.); vA = uOn; gl_PointSize = uOn > 0. ? clamp(2600. / -mv.z, 2., 9.) : 0.; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying float vA; void main(){ float d = length(gl_PointCoord - .5); gl_FragColor = vec4(vec3(1., .86, .66) * vA * smoothstep(.5, .05, d) * 2.2, 1.); }' }));
  lights.frustumCulled = false; group.add(lights);

  let lastG = -1;
  function update(g, t, night) {
    // arrival: tail-first descent on a burn that eases to the ground, dust at touchdown, engines cut a beat later
    sites.land.forEach(([x, z], i) => {
      const [g0, g1] = LAND[i], e = cl01((g - g0) / (g1 - g0)), y = DROP * Math.pow(1 - e, 2.2), here = g >= g0;
      mtx.compose(v.set(x, here ? y : -999, z), yaw[i], one); landSteel.setMatrixAt(i, mtx); landDark.setMatrixAt(i, mtx);
      const burn = here ? 1 - sst(g1, g1 + 0.012, g) : 0, flick = 0.9 + 0.1 * Math.sin(t * 47 + i * 3), P = plumes[i];
      const len = (14 + 26 * sst(0, 120, y) + 10 * (1 - sst(0, 6, y))) * burn * flick;
      P.m.visible = P.s.visible = burn > 0.01;
      P.m.position.set(x, y + 1.2, z); P.m.scale.set(3.6 + 2.2 * (1 - sst(0, 10, y)), Math.max(0.01, len), 3.6 + 2.2 * (1 - sst(0, 10, y))); P.m.material.uniforms.uI.value = burn;
      P.s.position.set(x, y + 0.5, z); P.s.scale.setScalar(26 * burn * flick); P.s.material.opacity = burn * 0.9;
      dU.uPh.value.setComponent(i, cl01((g - (g1 - 0.022)) / 0.07));
    });
    landSteel.instanceMatrix.needsUpdate = landDark.instanceMatrix.needsUpdate = true;
    dust.visible = dU.uPh.value.x > 0 && dU.uPh.value.x < 1 || dU.uPh.value.y > 0 && dU.uPh.value.y < 1; dU.uNight.value = night;
    // crane slews toward the hook while a band is in the air, drifts otherwise
    jib.rotation.y = toShip + 0.35 * Math.sin(g * 40 + t * 0.12) * (1 - sst(LIFT_AT[0] - 0.02, LIFT_AT[0], g) * (1 - sst(LIFT_AT[4] + LIFT_LEN, LIFT_AT[4] + LIFT_LEN + 0.03, g)));
    lU.uOn.value = sst(PAD0, PAD0 + 0.03, g) * (0.25 + 0.75 * night);
    if (Math.abs(g - lastG) < 1e-5) return; lastG = g;
    pad.scale.set(1, Math.max(0.001, eo((g - PAD0) / 0.03)), 1); pad.visible = g > PAD0;
    const tk = eo((g - TOWER[0]) / (TOWER[1] - TOWER[0])); tower.scale.set(1, Math.max(0.001, tk), 1); tower.visible = tk > 0; jib.visible = tk >= 1;
    // stack: bands up to the last landed one; the band in the air rides the hook down into place
    let top = BANDS[0], k = -1;
    for (let i = 0; i < LIFT_AT.length; i++) { if (g >= LIFT_AT[i] + LIFT_LEN) top = BANDS[i + 1]; else if (g >= LIFT_AT[i]) { k = i; break; } else break; }
    const cut = top + (top > 0 ? 0.001 : -10); // the first band includes the legs below y 0
    stackS.userData.U.value.set(-10, cut); stackD.userData.U.value.set(-10, cut); stackS.visible = stackD.visible = top > 0;
    if (k >= 0) {
      const off = 34 * (1 - eo((g - LIFT_AT[k]) / LIFT_LEN));
      for (const m of [liftS, liftD]) { m.userData.U.value.set(k ? BANDS[k] : -10, BANDS[k + 1]); m.position.set(bx, off, bz); }
      cable.visible = true; cable.scale.y = Math.max(0.1, TH + 1 - (BANDS[k + 1] + off) - 0.5);
    } else cable.visible = false;
    liftS.visible = liftD.visible = k >= 0;
    const fk = eo((g - FLAPS[0]) / (FLAPS[1] - FLAPS[0])); flapM.visible = fk > 0; flapM.scale.set(0.5 + 0.5 * fk, 1, 0.5 + 0.5 * fk);
    const drop = sst(SCAF_DROP[0], SCAF_DROP[1], g);
    scaf.visible = g > LIFT_AT[0] && drop < 1; scaf.scale.set(1, Math.max(0.001, Math.min(1, (top + 5) / 52) * (1 - drop)), 1);
  }
  return { update, group };
}
