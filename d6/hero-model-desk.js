// D6 hero: operator desk, monitor bodies and the foreground chair. Real-world sizes in metres.
// Static parts are merged per material into the room group; monitor bodies are rebuilt when the centre width changes.
import { mergeAll, boxUV, rrect, extrude, splitGroups, sweep } from './hero-model-kit.js';

// ------------------------------------------------------------------ monitor body (screen centred at the origin, facing +z)
// returns { shell, metal } geometries; shell = bezel lip, panel, back housing, VESA, cables; metal = hinge, neck, base
export function monitorGeo(THREE, w, h, { BZ = 0.014, deskDy = -0.385, cables = true } = {}) {
  const Wo = w + 2 * BZ, Ho = h + 2 * BZ + 0.006, cy = -0.003, r = 0.007, shell = [], metal = [];
  // panel slab: the 14 mm edge of a thin display, front face 0.5 mm behind the screen plane
  shell.push(extrude(THREE, rrect(THREE, Wo - 0.002, Ho - 0.002, r, 0, cy), 0.012, 0.001, 1, 3).translate(0, 0, -0.0075));
  // bezel lip: raised 1 mm ahead of the screen, bevelled, hole 1.5 mm larger than the active area
  { const s = rrect(THREE, Wo, Ho, r, 0, cy); s.holes.push(rrect(THREE, w + 0.003, h + 0.003, 0.0015));
    shell.push(extrude(THREE, s, 0.0016, 0.0006, 1, 3).translate(0, 0, 0.0004)); }
  // back housing: pillowed, slightly low on the panel
  shell.push(extrude(THREE, rrect(THREE, w * 0.7, h * 0.64, 0.05, 0, -0.03), 0.016, 0.013, 3, 5).translate(0, 0, -0.036));
  shell.push(new THREE.BoxGeometry(0.12, 0.12, 0.008).translate(0, -0.03, -0.062));                     // VESA plate
  for (let i = 0; i < 6; i++) shell.push(new THREE.BoxGeometry(w * 0.42, 0.004, 0.003).translate(0, 0.07 + i * 0.012, -0.0575)); // vent slots
  // hinge, neck (leans back a touch), base plate with a soft bevel
  metal.push(new THREE.CylinderGeometry(0.019, 0.019, 0.1, 14).rotateZ(Math.PI / 2).translate(0, -0.03, -0.078));
  metal.push(extrude(THREE, rrect(THREE, 0.085, 0.07, 0.012), 0.03, 0.004, 1, 3).translate(0, -0.03, -0.085));
  metal.push(sweep(THREE, rrect(THREE, 0.07, 0.024, 0.009), [0, -0.035, -0.096], [0, deskDy + 0.012, -0.125], [0, 0, 1]));
  metal.push(extrude(THREE, rrect(THREE, 0.3, 0.21, 0.06), 0.007, 0.0035, 2, 5).rotateX(-Math.PI / 2).translate(0, deskDy + 0.007, -0.1));
  if (cables) { // two leads from the back housing down behind the neck and off the back of the base
    for (const [x, rr] of [[0.035, 0.0035], [0.05, 0.003]]) {
      const c = new THREE.CatmullRomCurve3([[x, -0.12, -0.058], [x + 0.005, -0.2, -0.085], [x * 0.6, deskDy + 0.06, -0.13], [x * 0.5, deskDy + 0.004, -0.21], [x * 0.8, deskDy + 0.004, -0.34]].map(p => new THREE.Vector3(...p)));
      shell.push(new THREE.TubeGeometry(c, 18, rr, 5, false));
    }
  }
  return { shell: boxUV(THREE, mergeAll(THREE, shell), 0.4), metal: boxUV(THREE, mergeAll(THREE, metal), 0.3) };
}

// ------------------------------------------------------------------ desk, props, chair (world space, static)
export function buildDesk({ THREE, group, M, DESK_Y, high, bind }) {
  const parts = {}; const P = (k, g) => (parts[k] ||= []).push(g);
  const T = (g, x, y, z, ry = 0, rx = 0) => g.rotateX(rx).rotateY(ry).translate(x, y, z);
  const tube = (w, h, a, b, up = [0, 1, 0], r = 0.006) => sweep(THREE, rrect(THREE, w, h, r), a, b, up);

  // top: 3.8 x 1.05, 38 mm with 5 mm radiused arris; caps -> laminate, sides -> edge band
  { const [caps, sides] = splitGroups(THREE, extrude(THREE, rrect(THREE, 3.8, 1.05, 0.05, 0, -0.15), 0.028, 0.005, 2, 6).rotateX(-Math.PI / 2).translate(0, DESK_Y - 0.019, 0));
    P('desk', caps); P('edge', sides); }
  // C-frame legs, back beam, modesty panel, cable tray with a few leads
  for (const x of [-1.72, 1.72]) {
    P('metal', tube(0.08, 0.05, [x, 0.0, -0.22], [x, DESK_Y - 0.06, -0.22], [0, 0, 1]));
    P('metal', tube(0.07, 0.035, [x, 0.0175, -0.36], [x, 0.0175, 0.58], [0, 1, 0], 0.008));
    P('metal', tube(0.06, 0.03, [x, DESK_Y - 0.053, -0.34], [x, DESK_Y - 0.053, 0.56], [0, 1, 0]));
    for (const z of [-0.36, 0.58]) P('plastic', new THREE.CylinderGeometry(0.02, 0.022, 0.012, 10).translate(x, 0.006, z)); // levelling feet
  }
  P('metal', tube(0.05, 0.08, [-1.69, DESK_Y - 0.08, -0.22], [1.69, DESK_Y - 0.08, -0.22]));
  P('desk', new THREE.BoxGeometry(3.3, 0.4, 0.014).translate(0, DESK_Y - 0.29, -0.33));
  { const u = new THREE.Shape([[-0.09, 0], [0.09, 0], [0.09, 0.075], [0.086, 0.075], [0.086, 0.004], [-0.086, 0.004], [-0.086, 0.075], [-0.09, 0.075]].map(p => new THREE.Vector2(...p)));
    P('metal', sweep(THREE, u, [-1.5, DESK_Y - 0.2, -0.24], [1.5, DESK_Y - 0.2, -0.24], [0, 1, 0]));
    for (let i = 0; i < 4; i++) { const zz = -0.27 + i * 0.016, yy = DESK_Y - 0.19 + (i % 2) * 0.008;
      P('plastic', new THREE.CylinderGeometry(0.005, 0.005, 2.9, 5).rotateZ(Math.PI / 2).translate(0.05 * i, yy, zz + 0.03)); }
    P('plastic', new THREE.CylinderGeometry(0.03, 0.03, DESK_Y - 0.2, 8).translate(0.9, (DESK_Y - 0.2) / 2, -0.26)); // cable spine to the floor box
    for (const x of [-0.9, 0, 0.9]) P('plastic', new THREE.CylinderGeometry(0.03, 0.03, 0.004, 14).translate(x, DESK_Y + 0.001, -0.29)); // grommets
  }

  // keyboard (TKL) with instanced caps, mouse + pad
  const KZ = 0.44, KT = 0.07, U = 0.019;
  P('plastic', T(extrude(THREE, rrect(THREE, 0.365, 0.128, 0.01), 0.01, 0.002, 1, 3), 0, DESK_Y + 0.008, KZ, 0, -Math.PI / 2 + KT));
  const keys = [];
  { const rows = [[1, 0, 1, 1, 1, 1, 0.5, 1, 1, 1, 1, 0.5, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2], [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5],
      [1.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.25], [2.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.75], [1.25, 1.25, 1.25, 6.25, 1.25, 1.25, 1.25, 1.25]];
    const nav = [[1, 1, 1], [1, 1, 1], [1, 1, 1], [0, 0, 0], [0, 1, 0], [1, 1, 1]];
    rows.forEach((row, ri) => { let u = 0; const z = -0.05 + ri * U + (ri ? 0.006 : 0);
      for (const wd of row) { if (wd >= 1) keys.push([u + wd / 2, z, wd]); u += wd; }
      nav[ri].forEach((on, i) => { if (on) keys.push([15.4 + i + 0.5, z, 1]); }); });
  }
  const capGeo = extrude(THREE, rrect(THREE, 0.0158, 0.0158, 0.0028), 0.004, 0.0016, 1, 2).rotateX(-Math.PI / 2);
  const caps = new THREE.InstancedMesh(capGeo, M.keys, keys.length);
  { const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(KT, 0, 0)), s = new THREE.Vector3(), p = new THREE.Vector3();
    keys.forEach(([u, z, wd], i) => { const x = (u - 9.2) * U; p.set(x, DESK_Y + 0.019 + Math.sin(KT) * -z, KZ + z); s.set((wd * U - 0.003) / 0.0158, 1, 1); caps.setMatrixAt(i, m.compose(p, q, s)); }); }
  caps.userData.part = 'keycaps'; group.add(caps);
  P('fabric', T(extrude(THREE, rrect(THREE, 0.27, 0.22, 0.012), 0.002, 0.0008, 1, 3), 0.33, DESK_Y + 0.0015, 0.45, 0, -Math.PI / 2));
  P('plastic', new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.031, 0.02, 0.058).translate(0.33, DESK_Y + 0.003, 0.46));

  // joystick consoles either side: sloped wedge, gaiter, grip, buttons; the right one carries the e-stop
  for (const s of [-1, 1]) {
    const cx = s * 0.66, cz = 0.42, sl = Math.atan2(0.035, 0.24);
    P('plastic', T(extrude(THREE, new THREE.Shape([[0.12, 0], [-0.12, 0], [-0.12, 0.072], [-0.1, 0.075], [0.12, 0.04], [0.125, 0.02]].map(p => new THREE.Vector2(...p))), 0.22, 0.004, 1), 0, 0, 0, -Math.PI / 2).translate(cx, DESK_Y, cz));
    const top = (dz, h = 0) => new THREE.Vector3(cx, DESK_Y + 0.0575 - dz * Math.tan(sl) + h, cz + dz);
    const jp = top(-0.01);
    P('rubber', new THREE.CylinderGeometry(0.018, 0.034, 0.03, 12).rotateX(sl).translate(jp.x, jp.y + 0.012, jp.z));
    P('metal', new THREE.CylinderGeometry(0.007, 0.007, 0.05, 8).translate(jp.x, jp.y + 0.045, jp.z));
    P('plastic', new THREE.CapsuleGeometry(0.019, 0.065, 4, 10).rotateX(-0.12).rotateZ(s * 0.06).translate(jp.x, jp.y + 0.11, jp.z - 0.005));
    P('accent', new THREE.CylinderGeometry(0.006, 0.006, 0.008, 8).translate(jp.x, jp.y + 0.155, jp.z - 0.012));
    for (let i = 0; i < 4; i++) { const bp = top(0.085, 0.002); P('plastic', new THREE.CylinderGeometry(0.0075, 0.0075, 0.007, 10).rotateX(sl).translate(cx - 0.06 + i * 0.04, bp.y, bp.z)); }
    for (let i = 0; i < 3; i++) { const lp = top(-0.09, 0.0015); P('led', new THREE.BoxGeometry(0.006, 0.002, 0.004).translate(cx - 0.05 + i * 0.016, lp.y, lp.z)); }
    if (s > 0) { const ep = top(0.04); P('accentY', new THREE.CylinderGeometry(0.026, 0.026, 0.012, 16).translate(cx + 0.07, ep.y + 0.004, ep.z)); P('accent', new THREE.CylinderGeometry(0.019, 0.016, 0.016, 16).translate(cx + 0.07, ep.y + 0.018, ep.z)); }
  }

  // mug, notepad + pen, desk lamp (off)
  { const pts = [[0, 0], [0.038, 0], [0.041, 0.004], [0.042, 0.096], [0.0385, 0.097], [0.0375, 0.01], [0, 0.01]].map(p => new THREE.Vector2(...p));
    P('ceramic', new THREE.LatheGeometry(pts, 20).translate(-1.06, DESK_Y, 0.34));
    P('ceramic', new THREE.TorusGeometry(0.026, 0.0065, 6, 10, Math.PI).rotateZ(-Math.PI / 2).translate(-1.06 + 0.041, DESK_Y + 0.05, 0.34));
    P('plastic', new THREE.CircleGeometry(0.0376, 18).rotateX(-Math.PI / 2).translate(-1.06, DESK_Y + 0.078, 0.34)); }
  { const g = new THREE.BoxGeometry(0.15, 0.009, 0.21); P('paper', T(g, 1.06, DESK_Y + 0.0045, 0.4, 0.18));
    P('plastic', T(new THREE.BoxGeometry(0.15, 0.004, 0.012), 1.06, DESK_Y + 0.011, 0.4 - 0.1, 0.18));        // binding strip
    P('metal', T(new THREE.CylinderGeometry(0.0045, 0.0045, 0.14, 8).rotateZ(Math.PI / 2), 1.08, DESK_Y + 0.0135, 0.42, 0.9)); }
  { const bx = 1.5, bz = -0.02, b = [bx, DESK_Y, bz], e = [bx - 0.02, DESK_Y + 0.36, bz - 0.05], hd = [bx - 0.2, DESK_Y + 0.43, bz + 0.12];
    P('metal', new THREE.CylinderGeometry(0.075, 0.08, 0.016, 20).translate(bx, DESK_Y + 0.008, bz));
    P('metal', new THREE.CylinderGeometry(0.008, 0.008, 1, 8).applyMatrix4(seg(THREE, b, e)));
    P('metal', new THREE.CylinderGeometry(0.007, 0.007, 1, 8).applyMatrix4(seg(THREE, e, hd)));
    P('metal', new THREE.SphereGeometry(0.014, 10, 6).translate(...e));
    P('plastic', new THREE.CylinderGeometry(0.03, 0.065, 0.11, 18, 1, true).rotateZ(0.45).translate(hd[0] - 0.02, hd[1] - 0.05, hd[2])); }

  // chair: high-back operator chair seen from behind, low in the foreground
  const chair = new THREE.Group(); chair.position.set(-0.62, 0, 1.38); chair.rotation.y = 0.22; group.add(chair);
  const cp = {}; const C = (k, g) => (cp[k] ||= []).push(g);
  { const bend = (g, k) => { const p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + k * p.getX(i) ** 2); g.computeVertexNormals(); return g; };
    C('fabric', bend(extrude(THREE, rrect(THREE, 0.5, 0.64, 0.14), 0.045, 0.022, 2, 5), -0.6).rotateX(0.12).translate(0, 0.84, 0.06));
    C('fabric', bend(extrude(THREE, rrect(THREE, 0.3, 0.14, 0.06), 0.04, 0.016, 2, 4), -0.8).rotateX(0.2).translate(0, 1.27, 0.11));
    C('plastic', bend(extrude(THREE, rrect(THREE, 0.46, 0.6, 0.13), 0.01, 0.004, 1, 5), -0.6).rotateX(0.12).translate(0, 0.84, 0.105)); // back shell
    C('plastic', tube(0.05, 0.02, [0, 1.12, 0.14], [0, 1.2, 0.14], [0, 0, 1]));
    C('fabric', extrude(THREE, rrect(THREE, 0.5, 0.48, 0.08), 0.05, 0.02, 2, 4).rotateX(-Math.PI / 2).translate(0, 0.49, -0.18));
    C('plastic', tube(0.07, 0.025, [0, 0.47, 0.06], [0, 0.6, 0.11], [0, 0, 1]));
    C('plastic', new THREE.BoxGeometry(0.2, 0.06, 0.24).translate(0, 0.43, -0.16));
    for (const s of [-1, 1]) { C('plastic', tube(0.03, 0.02, [s * 0.27, 0.45, -0.1], [s * 0.27, 0.62, -0.1], [0, 0, 1])); C('plastic', extrude(THREE, rrect(THREE, 0.08, 0.26, 0.03), 0.02, 0.006, 1, 3).rotateX(-Math.PI / 2).translate(s * 0.27, 0.635, -0.14)); }
    C('metal', new THREE.CylinderGeometry(0.025, 0.025, 0.3, 12).translate(0, 0.27, -0.16));
    for (let i = 0; i < 5; i++) { const a = i * Math.PI * 2 / 5 + 0.3, x = Math.sin(a) * 0.33, z = -0.16 + Math.cos(a) * 0.33;
      C('plastic', tube(0.045, 0.03, [0, 0.11, -0.16], [x, 0.07, z], [0, 1, 0], 0.01)); C('plastic', new THREE.SphereGeometry(0.03, 8, 6).translate(x, 0.03, z)); }
  }
  chair.updateMatrix(); for (const k in cp) for (const g of cp[k]) P(k, g.applyMatrix4(chair.matrix)); group.remove(chair);

  // merge per material, world-scale UVs
  const scale = { desk: 0.6, edge: 0.3, metal: 0.4, plastic: 0.3, fabric: 0.3, rubber: 0.2, ceramic: 0.2, paper: 0.25, accent: 0.2, accentY: 0.2, led: 1 };
  const meshes = {};
  for (const k in parts) {
    const g = boxUV(THREE, mergeAll(THREE, parts[k]), scale[k] || 0.5), m = new THREE.Mesh(g, M[k] || M.plastic);
    m.userData.texScale = scale[k] || 0.5; m.userData.part = 'desk-' + k; group.add(m); meshes[k] = m;
  }
  return { meshes, caps };
}

function seg(THREE, a, b) { // unit-height cylinder (y) placed between two points
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A);
  return new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()), new THREE.Vector3(1, d.length(), 1));
}
