// D6 hero: site dressing outside the glass. Jersey barriers and fence (instanced), aggregate stockpiles, a parked pickup,
// a site office trailer with a lit window and work lights on the machines (beams under the towers live in hero3d). Everything static is merged per material; sizes are real, units metres.
import { mergeAll, boxUV, rrect, extrude } from './hero-model-kit.js';
import { rng } from './hero-glsl.js';

export function buildSite({ THREE, group, hgt, G0, high, spots = [], machines = {} }) {
  const r = rng(41), Y = (x, z) => G0 + hgt(x, z);
  const S = o => new THREE.MeshStandardMaterial(o);
  const M = {
    concrete: S({ color: 0x8a8780, roughness: 0.92 }),
    steel: S({ color: 0x6d6f72, roughness: 0.5, metalness: 0.7 }),
    galv: S({ color: 0x8e9296, roughness: 0.45, metalness: 0.8 }),
    gravel: S({ color: 0x6f665c, roughness: 1 }),
    white: S({ color: 0xc9c6bd, roughness: 0.6 }),
    dark: S({ color: 0x141518, roughness: 0.7 }),
    tyre: S({ color: 0x111111, roughness: 0.95 }),
    glass: S({ color: 0x0b0f14, roughness: 0.08, metalness: 0.9 }),
    glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 2.2, 1.2) }),
    amber: new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 1.4, 0.2) }),
    window: new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.05, 0.62) }),
  };
  const parts = new Map(); const P = (m, g) => (parts.get(m) || parts.set(m, []).get(m)).push(g);
  const at = (g, x, z, ry = 0, dy = 0) => g.rotateY(ry).translate(x, Y(x, z) + dy, z);

  // ---------------------------------------------------------------- jersey barriers (New Jersey profile, 3 m units), instanced
  const jersey = new THREE.Shape([[-0.305, 0], [0.305, 0], [0.305, 0.076], [0.23, 0.33], [0.075, 0.81], [-0.075, 0.81], [-0.23, 0.33], [-0.305, 0.076]].map(p => new THREE.Vector2(...p)));
  const jg = boxUV(THREE, mergeAll(THREE, [extrude(THREE, jersey, 2.96, 0.012, 1).rotateY(Math.PI / 2)]), 2);
  const jPos = [];
  for (let i = 0; i < 4; i++) jPos.push([-24 + i * 3.02, -43 + i * 0.4, -0.13 + (r() - 0.5) * 0.05]);        // short run, left of the dozer
  jPos.push([-10.6, -42.4, 0.5]);                                                                              // one pulled out of line
  for (let i = 0; i < 3; i++) jPos.push([22 + i * 3.02, -47 - i * 0.5, 0.16 + (r() - 0.5) * 0.04]);           // by the stockpile, right
  const barriers = new THREE.InstancedMesh(jg, M.concrete, jPos.length);
  { const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    jPos.forEach(([x, z, ry], i) => { q.setFromEuler(e.set(0, ry, (r() - 0.5) * 0.02)); barriers.setMatrixAt(i, m.compose(new THREE.Vector3(x, Y(x, z) - 0.03, z), q, new THREE.Vector3(1, 1, 1))); }); }
  barriers.userData.part = 'jersey'; barriers.userData.texScale = 2; group.add(barriers);

  // ---------------------------------------------------------------- temporary fence: posts in feet (instanced), top rail, chain-link mesh
  const fenceRun = [[-40, -52], [-22, -47]], fN = 6;
  const posts = new THREE.InstancedMesh(mergeAll(THREE, [new THREE.CylinderGeometry(0.024, 0.024, 2.0, 6).translate(0, 1.0, 0), new THREE.BoxGeometry(0.6, 0.12, 0.22).translate(0, 0.06, 0)]), M.galv, fN + 1);
  const meshPanels = [];
  { const m = new THREE.Matrix4(), [a, b] = fenceRun, q = new THREE.Quaternion();
    const dx = (b[0] - a[0]) / fN, dz = (b[1] - a[1]) / fN, ry = -Math.atan2(dz, dx); q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry);
    for (let i = 0; i <= fN; i++) { const x = a[0] + dx * i, z = a[1] + dz * i; posts.setMatrixAt(i, m.compose(new THREE.Vector3(x, Y(x, z), z), q, new THREE.Vector3(1, 1, 1))); }
    const len = Math.hypot(dx, dz);
    for (let i = 0; i < fN; i++) { const x = a[0] + dx * (i + 0.5), z = a[1] + dz * (i + 0.5), y0 = (Y(a[0] + dx * i, a[1] + dz * i) + Y(a[0] + dx * (i + 1), a[1] + dz * (i + 1))) / 2;
      meshPanels.push(new THREE.PlaneGeometry(len, 1.85).translate(0, 0.98, 0).rotateY(ry).translate(x, y0, z));
      P(M.galv, new THREE.CylinderGeometry(0.019, 0.019, len, 6).rotateZ(Math.PI / 2).rotateY(ry).translate(x, y0 + 1.95, z)); }
  }
  posts.userData.part = 'fence-posts'; group.add(posts);
  const link = (() => { // chain-link diamond, alpha in the red channel
    const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, 64, 64);
    x.strokeStyle = '#fff'; x.lineWidth = 7; x.beginPath(); x.moveTo(0, 32); x.lineTo(32, 0); x.lineTo(64, 32); x.lineTo(32, 64); x.closePath(); x.stroke();
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; })();
  const fenceMesh = new THREE.Mesh(mergeAll(THREE, meshPanels), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.5, alphaMap: link, transparent: true, opacity: 1, depthWrite: false, side: THREE.DoubleSide }));
  { const uv = fenceMesh.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.hypot(fenceRun[1][0] - fenceRun[0][0], fenceRun[1][1] - fenceRun[0][1]) / fN / 0.06, uv.getY(i) * 1.85 / 0.06); }
  fenceMesh.userData.part = 'fence-mesh'; fenceMesh.renderOrder = 1; group.add(fenceMesh);

  // ---------------------------------------------------------------- aggregate stockpiles: lumpy cones at the angle of repose
  const pile = (x, z, R, h, seed) => {
    const f = rng(seed), g = new THREE.ConeGeometry(R, h, high ? 40 : 24, high ? 10 : 6, true), p = g.attributes.position, ph = [f() * 6, f() * 6, f() * 6];
    for (let i = 0; i < p.count; i++) { const px = p.getX(i), pz = p.getZ(i), py = p.getY(i), a = Math.atan2(pz, px), t = (py + h / 2) / h;
      const k = 1 + 0.08 * Math.sin(a * 3 + ph[0]) + 0.05 * Math.sin(a * 7 + ph[1]) + 0.03 * Math.sin(a * 13 + ph[2]) * (1 - t);
      p.setXYZ(i, px * k, py * (1 + 0.06 * Math.sin(a * 5 + ph[1])) - 0.12 * (1 - t) * (1 - t), pz * k); }
    g.computeVertexNormals(); g.translate(x, Y(x, z) + h / 2 - 0.3, z); P(M.gravel, boxUV(THREE, g, 1.5));
  };
  pile(42, -66, 7, 3.6, 3); pile(-38, -84, 8, 4.2, 5); pile(49, -60, 4.5, 2.2, 8);

  // ---------------------------------------------------------------- site office trailer (12 x 3.6 m), lit window, door light, stairs
  { const X = -33, Z = -84, ry = 0.25, L = 12, W = 3.6, H = 2.7, y = Y(X, Z), tr = new THREE.Matrix4().makeRotationY(ry).setPosition(X, y, Z);
    const T = g => g.applyMatrix4(tr);
    P(M.white, T(boxUV(THREE, new THREE.BoxGeometry(L, H, W).translate(0, 0.65 + H / 2, 0), 1)));
    P(M.dark, T(new THREE.BoxGeometry(L - 0.2, 0.65, W - 0.2).translate(0, 0.325, 0)));                       // skirting
    for (let i = 0; i < 14; i++) P(M.white, T(new THREE.BoxGeometry(0.03, H, 0.02).translate(-L / 2 + 0.4 + i * 0.86, 0.65 + H / 2, W / 2 + 0.01))); // panel seams
    const win = [-4.2, -1.6, 2.6, 4.6];
    win.forEach((wx, i) => { P(M.dark, T(new THREE.BoxGeometry(1.3, 0.95, 0.04).translate(wx, 2.05, W / 2 + 0.01)));
      P(i === 1 ? M.window : M.glass, T(new THREE.PlaneGeometry(1.18, 0.83).translate(wx, 2.05, W / 2 + 0.035))); });
    P(M.dark, T(new THREE.BoxGeometry(0.95, 2.05, 0.04).translate(0.6, 0.65 + 1.03, W / 2 + 0.01)));             // door
    P(M.glow, T(new THREE.BoxGeometry(0.16, 0.1, 0.06).translate(0.6, 0.65 + 2.25, W / 2 + 0.05)));             // door light
    for (let s = 0; s < 4; s++) P(M.steel, T(new THREE.BoxGeometry(1.1, 0.04, 0.28).translate(0.6, 0.16 + s * 0.17, W / 2 + 0.2 + (3 - s) * 0.26)));
    P(M.steel, T(new THREE.BoxGeometry(1.2, 0.04, 1.0).translate(0.6, 0.68, W / 2 + 0.5)));
    P(M.steel, T(new THREE.BoxGeometry(0.8, 0.5, 0.45).translate(-2.9, 1.0, -W / 2 - 0.25)));                    // AC unit, back
    const wl = new THREE.Vector3(-1.6, 2.05, W / 2 + 0.6).applyMatrix4(tr);
    if (high) { const pl = new THREE.PointLight(0xffc488, 6, 9, 2); pl.position.copy(wl); group.add(pl); }                    // spill from the lit window
  }

  // ---------------------------------------------------------------- pickup (crew cab, white), parked by the trailer, amber light bar
  { const X = -38, Z = -74, ry = -0.45, y = Y(X, Z), tr = new THREE.Matrix4().makeRotationY(ry).setPosition(X, y, Z), T = g => g.applyMatrix4(tr);
    const side = new THREE.Shape([[-2.9, 0.5], [2.6, 0.5], [2.75, 0.75], [2.7, 1.05], [1.4, 1.15], [0.85, 1.85], [-0.75, 1.88], [-0.9, 1.15], [-2.95, 1.15]].map(p => new THREE.Vector2(...p)));
    P(M.white, T(boxUV(THREE, extrude(THREE, side, 1.86, 0.04, 1), 1)));
    P(M.glass, T(extrude(THREE, new THREE.Shape([[1.32, 1.18], [0.82, 1.8], [-0.7, 1.82], [-0.7, 1.18]].map(p => new THREE.Vector2(...p))), 1.97, 0)));
    P(M.dark, T(new THREE.BoxGeometry(2.0, 0.1, 1.8).translate(-1.95, 1.12, 0)));                               // bed void
    P(M.dark, T(new THREE.BoxGeometry(0.12, 0.35, 1.7).translate(2.78, 0.75, 0)));                              // grille
    for (const [wx, wz] of [[1.75, 0.86], [1.75, -0.86], [-1.95, 0.86], [-1.95, -0.86]]) P(M.tyre, T(new THREE.CylinderGeometry(0.4, 0.4, 0.28, 14).rotateX(Math.PI / 2).translate(wx, 0.4, wz)));
    P(M.amber, T(new THREE.BoxGeometry(0.16, 0.07, 1.2).translate(-0.1, 1.95, 0)));
    for (const s of [-1, 1]) P(M.amber, T(new THREE.BoxGeometry(0.04, 0.06, 0.2).translate(2.78, 0.95, s * 0.75)));
  }

  // ---------------------------------------------------------------- machine work lights (parented so they follow the idle animation)
  const glowBox = (parent, x, y, z, sx, sy, sz, m = M.glow) => { const o = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); o.position.set(x, y, z); parent.add(o); return o; };
  if (machines.exA) { const e = machines.exA;
    glowBox(e.up, 1.56, 2.1, -1.3, 0.06, 0.08, 0.16); glowBox(e.up, 1.56, 2.1, -0.7, 0.06, 0.08, 0.16);   // cab roof lights
    glowBox(e.boom, 2.5, 1.5, 0.32, 0.12, 0.1, 0.06);                                                       // boom light
  }

  // ---------------------------------------------------------------- rubble: instanced broken rock on the dig benches, its rim and round the spoil
  const rockGeo = (() => { const g = new THREE.DodecahedronGeometry(1, 0), p = g.attributes.position, f = rng(12);
    for (let i = 0; i < p.count; i++) { const k = 0.75 + f() * 0.5; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k); }
    g.computeVertexNormals(); return boxUV(THREE, g, 1); })();
  M.rock = S({ color: 0x6a5f55, roughness: 1, flatShading: true });
  const rocks = [];
  { const D = [0, -47.5, 10, 6.5], n = high ? 340 : 140;
    for (let i = 0; i < n; i++) {
      let x, z, s; const t = r();
      if (t < 0.55) { const a = r() * Math.PI * 2, d = Math.pow(r(), 0.6) * 1.25; x = D[0] + Math.cos(a) * d * D[2]; z = D[1] + Math.sin(a) * d * D[3]; s = 0.08 + Math.pow(r(), 3) * 0.55; }  // in and round the dig
      else if (t < 0.85) { const P = [[22, -58, 7], [28, -64, 5], [-34, -50, 7], [-12, -46, 4]][Math.floor(r() * 4)], a = r() * Math.PI * 2, d = (0.7 + r() * 0.5) * P[2]; x = P[0] + Math.cos(a) * d; z = P[1] + Math.sin(a) * d * 0.75; s = 0.07 + Math.pow(r(), 3) * 0.4; } // spoil toes
      else { x = -40 + r() * 80; z = -36 - r() * 40; s = 0.05 + Math.pow(r(), 4) * 0.25; }                                                    // stray clods over the yard
      if (Math.hypot(x - 10.5, z + 50) < 4.5 || Math.hypot(x + 8, z + 54) < 4) continue;                                                 // not under the tracks
      rocks.push([x, z, s]);
    } }
  const rubble = new THREE.InstancedMesh(rockGeo, M.rock, rocks.length);
  { const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3();
    rocks.forEach(([x, z, s], i) => { q.setFromEuler(e.set(r() * 0.6, r() * 6.3, r() * 0.6)); rubble.setMatrixAt(i, m.compose(v.set(x, Y(x, z) + s * 0.25, z), q, new THREE.Vector3(s * (0.8 + r() * 0.6), s, s * (0.8 + r() * 0.6)))); }); }
  rubble.userData.part = 'rubble'; rubble.userData.texScale = 1; group.add(rubble);

  // ---------------------------------------------------------------- traffic cones (orange, reflective collar) along the haul road edge and the dig
  const coneGeo = (() => {
    const body = new THREE.LatheGeometry([[0.0001, 0.71], [0.028, 0.7], [0.15, 0.04], [0.0001, 0.04]].map(p => new THREE.Vector2(p[0], p[1])), 12);
    const base = new THREE.BoxGeometry(0.38, 0.035, 0.38).translate(0, 0.0175, 0), g = mergeAll(THREE, [body.toNonIndexed(), base]), p = g.attributes.position, C = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) { const y = p.getY(i), band = y > 0.3 && y < 0.48; C.set(y < 0.036 ? [0.05, 0.05, 0.05] : band ? [0.85, 0.85, 0.82] : [0.95, 0.28, 0.04], i * 3); }
    g.setAttribute('color', new THREE.BufferAttribute(C, 3)); return g; })();
  M.cone = S({ vertexColors: true, roughness: 0.6 });
  const cPos = []; for (let i = 0; i < 7; i++) { const z = -36 - i * 4.2, c = -6 + 0.2 * (z + 44) + 3 * Math.sin(z * 0.08); cPos.push([c + 3.6, z]); }
  for (let i = 0; i < 6; i++) { const a = -0.4 + i * 0.32; cPos.push([Math.cos(a + Math.PI) * 13.5, -47.5 + Math.sin(a + Math.PI) * 8.5]); }
  const trafficCones = new THREE.InstancedMesh(coneGeo, M.cone, cPos.length);
  { const m = new THREE.Matrix4(), q = new THREE.Quaternion(), v = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
    cPos.forEach(([x, z], i) => { q.setFromAxisAngle(v.set(0, 1, 0), r() * 3); trafficCones.setMatrixAt(i, m.compose(v.clone().set(x, Y(x, z) - 0.02, z), q, one)); }); }
  trafficCones.userData.part = 'traffic-cones'; group.add(trafficCones);

  // light cones: hero3d (compositing) builds the beams from outside.spots, so none here
  const cones = [];

  // merge per material
  const meshes = [];
  for (const [m, gs] of parts) { const mesh = new THREE.Mesh(mergeAll(THREE, gs), m); mesh.userData.part = 'site'; group.add(mesh); meshes.push(mesh); }

  return {
    M, cones, barriers, posts, fenceMesh, meshes, rubble, trafficCones,
    bind(tb) { tb.bind(M.concrete, 'concrete_floor', { color: 0xe8e4dc, maps: ['map', 'normalMap', 'aoMap'], normalScale: 0.5 }); tb.bind(M.gravel, 'gravel', { color: 0xa0968a, maps: ['map', 'normalMap', 'aoMap'], normalScale: 0.35 }); tb.bind(M.rock, 'gravel', { color: 0x9a9088, maps: ['map', 'normalMap'], normalScale: 0.6 }); tb.bind(M.steel, 'rusty_metal', { maps: ['normalMap', 'roughnessMap'] }); tb.bind(M.galv, 'brushed_metal', { maps: ['normalMap', 'roughnessMap'] }); },
    dispose() { for (const o of [...meshes, barriers, posts, fenceMesh, rubble, trafficCones, ...cones]) o.geometry.dispose(); Object.values(M).forEach(m => m.dispose()); link.dispose(); }
  };
}
