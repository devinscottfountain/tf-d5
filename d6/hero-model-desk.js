// D6 hero: operator desk, monitor bodies and the foreground chair. Real-world sizes in metres.
// Static parts are merged per material into the room group; monitor bodies are rebuilt when the centre width changes.
import { mergeAll, boxUV, rrect, extrude, splitGroups, sweep } from './hero-model-kit.js';

// ------------------------------------------------------------------ monitor body (screen centred at the origin, facing +z)
// returns { shell, metal } geometries; shell = the black front glass (+ cable), metal = anodised enclosure, hinge, flat arm, foot.
// Uniform 14 mm black glass border, one slab whose flat front sits 0.4 mm behind the screen plane; aluminium enclosure behind.
export function monitorGeo(THREE, w, h, { BZ = 0.014, deskDy = -0.385, cables = true } = {}) {
  const Wo = w + 2 * BZ, Ho = h + 2 * BZ, r = 0.008, shell = [], metal = [];
  shell.push(extrude(THREE, rrect(THREE, Wo, Ho, r), 0.002, 0.0005, 2, 8).translate(0, 0, -0.0011));                // glass: z -0.0026 .. +0.0004
  metal.push(extrude(THREE, rrect(THREE, Wo - 0.0006, Ho - 0.0006, r), 0.016, 0.0015, 2, 8).translate(0, 0, -0.0122)); // enclosure: z -0.0217 .. -0.0027
  metal.push(extrude(THREE, rrect(THREE, 0.15, 0.05, 0.012), 0.012, 0.0015, 2, 6).translate(0, -0.03, -0.0285));         // hinge block
  // arm: one flat 140 x 12 mm aluminium blade from the hinge down and back to the foot; foot: 6 mm plate, small radius, eased edges
  metal.push(sweep(THREE, rrect(THREE, 0.14, 0.012, 0.004), [0, -0.012, -0.036], [0, deskDy + 0.006, -0.13], [0, 0, 1], 6));
  metal.push(extrude(THREE, rrect(THREE, 0.22, 0.2, 0.03), 0.006, 0.0012, 2, 8).rotateX(-Math.PI / 2).translate(0, deskDy + 0.0042, -0.12));
  if (cables) { // one lead out of the enclosure, down behind the arm and off the back of the foot
    const c = new THREE.CatmullRomCurve3([[0.04, -0.06, -0.021], [0.042, -0.12, -0.05], [0.03, deskDy + 0.07, -0.12], [0.02, deskDy + 0.004, -0.24], [0.03, deskDy + 0.004, -0.36]].map(p => new THREE.Vector3(...p)));
    shell.push(new THREE.TubeGeometry(c, 24, 0.0032, 8, false));
  }
  return { shell: boxUV(THREE, mergeAll(THREE, shell), 0.25), metal: boxUV(THREE, mergeAll(THREE, metal), 0.5) };
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

  // keyboard: low-profile 75%, one chamfered aluminium case, instanced caps (one gently dished, bevelled shape; modifiers a shade lighter)
  const KZ = 0.44, KT = 0.06, U = 0.0185, rows = [
    [[1, 1], [1], [1], [1], [1], [1], [1], [1], [1], [1], [1], [1], [1], [1, 1], [1, 1], [1, 1]],
    [[1], [1], [1], [1], [1], [1], [1], [1], [1], [1], [1], [1], [1], [2, 1], [1, 1]],
    [[1.5, 1], [1], [1], [1], [1], [1], [1], [1], [1], [1], [1], [1], [1], [1.5, 1], [1, 1]],
    [[1.75, 1], [1], [1], [1], [1], [1], [1], [1], [1], [1], [1], [1], [2.25, 1], [1, 1]],
    [[2.25, 1], [1], [1], [1], [1], [1], [1], [1], [1], [1], [1], [1.75, 1], [1, 1], [1, 0]],
    [[1.25, 1], [1.25, 1], [1.25, 1], [6.25], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1], [1, 1]]];
  const CW = 16 * U + 0.018, CD = 6 * U + 0.02, kbx = 0, keys = [];
  rows.forEach((row, ri) => { let u = 0; const z = (ri - 2.5) * U + (ri === 0 ? -0.004 : 0);
    for (const [wd, mod] of row) { if (mod !== 0) keys.push([u + wd / 2, z, wd, mod === 1]); u += wd; } });
  const kbTilt = new THREE.Matrix4().makeRotationX(KT).setPosition(kbx, DESK_Y, KZ);
  { const cs = extrude(THREE, rrect(THREE, CW, CD, 0.006), 0.011, 0.0015, 1, 6).rotateX(-Math.PI / 2).translate(0, 0.0075, 0); // chamfered case
    P('keycase', cs.applyMatrix4(kbTilt));
    P('keycase', new THREE.BoxGeometry(CW - 0.012, 0.001, CD - 0.012).translate(0, 0.0156, 0).applyMatrix4(kbTilt)); }              // plate seen between caps
  const capGeo = (() => { // 1u cap: bevelled body + a cylindrically dished top (6 x 6 grid), smooth normals, ~140 tris
    const body = extrude(THREE, rrect(THREE, 0.0168, 0.0168, 0.0022), 0.0042, 0.0006, 1, 3).rotateX(-Math.PI / 2).translate(0, 0.0022, 0);
    const top = new THREE.PlaneGeometry(0.0152, 0.0152, 6, 6).rotateX(-Math.PI / 2), tp = top.attributes.position;
    for (let i = 0; i < tp.count; i++) { const x = tp.getX(i) / 0.0076; tp.setY(i, 0.005 - 0.0003 * (1 - x * x)); }
    top.computeVertexNormals();
    return mergeAll(THREE, [body.toNonIndexed(), top.toNonIndexed()]); })();
  const caps = new THREE.InstancedMesh(capGeo, M.keycap, keys.length);
  { const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), cA = new THREE.Color(0x25262a), cM = new THREE.Color(0x4a4d53);
    keys.forEach(([u, z, wd, mod], i) => { p.set((u - 8) * U, 0.0158, z); s.set((wd * U - 0.0017) / 0.0168, 1, 1); m.compose(p, q, s).premultiply(kbTilt); caps.setMatrixAt(i, m); caps.setColorAt(i, c.copy(mod ? cM : cA)); }); }
  caps.userData.part = 'keycaps'; group.add(caps);
  // desk pad: dark felt, soft rounded rectangle, 3 mm with an eased edge, flat
  P('pad', extrude(THREE, rrect(THREE, 0.3, 0.24, 0.02), 0.002, 0.0006, 2, 8).rotateX(-Math.PI / 2).translate(0.34, DESK_Y + 0.0016, 0.45));
  // mouse: sculpted right-hand body (deformed sphere, smooth normals), split line + wheel recess in vertex colour, metal wheel, thumb wheel + button
  const mouse = buildMouse(THREE, M);
  mouse.position.set(0.34, DESK_Y + 0.0032, 0.46); mouse.rotation.y = -0.12; group.add(mouse);

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
  const chair = new THREE.Group(); chair.position.set(-0.8, 0, 1.75); chair.rotation.y = 0.3; group.add(chair);
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
  const scale = { keycase: 0.25, pad: 0.25, desk: 1, edge: 0.5, metal: 0.5, plastic: 0.25, fabric: 0.12, rubber: 0.25, ceramic: 0.25, paper: 0.25, accent: 0.25, accentY: 0.25, led: 1 }; // match hero-tex texScale per role
  const meshes = {};
  for (const k in parts) {
    const g = boxUV(THREE, mergeAll(THREE, parts[k]), scale[k] || 0.5), m = new THREE.Mesh(g, M[k] || M.plastic);
    m.userData.texScale = scale[k] || 0.5; m.userData.part = 'desk-' + k; group.add(m); meshes[k] = m;
  }
  return { meshes, caps, mouse };
}

// ------------------------------------------------------------------ mouse (local: origin on the desk, length along z, front toward -z)
function buildMouse(THREE, M) {
  const L = 0.124, W = 0.082, H = 0.044, g = new THREE.SphereGeometry(1, 80, 56), p = g.attributes.position, C = new Float32Array(p.count * 3);
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const top = t => H * (0.4 + 0.6 * Math.exp(-(((t - 0.64) / 0.34) ** 2)));                      // low nose, raised back peaking behind the middle
  const half = t => W / 2 * (0.8 + 0.2 * sm(0.1, 0.8, t));                                       // wider at the palm
  const sp = (c, e) => Math.sign(c) * Math.pow(Math.abs(c), e);
  for (let i = 0; i < p.count; i++) {
    const sx = p.getX(i), sy = p.getY(i), sz = p.getZ(i), rh = Math.sqrt(Math.max(0, 1 - sy * sy)), n = Math.hypot(sx, sz) || 1;
    const cx = sp(sx / n, 0.62), cz = sp(sz / n, 0.62), t = (rh * cz + 1) / 2;                    // squarish planform (superellipse)
    let x = rh * cx * half(t), z = rh * cz * L / 2, y;
    if (sy >= 0) { y = 0.005 + (top(t) - 0.005) * Math.pow(sy, 0.5) * (1 - 0.14 * Math.max(0, cx) * sy); } // full shoulders, right flank a touch lower
    else y = 0.005 * (1 - Math.pow(-sy, 0.3));                                                     // flat sole, rounded lower edge
    if (cx < 0) { const w = -cx; x -= 0.008 * Math.exp(-(((sy - 0.1) / 0.16) ** 2)) * sm(0.25, 0.65, t) * w;   // thumb shelf, lower left
      x += 0.004 * Math.exp(-(((sy - 0.42) / 0.14) ** 2)) * sm(0.25, 0.6, t) * w; }                            // thumb scoop above it
    p.setXYZ(i, x, y, z);
    // colour: graphite, a fine split between the buttons, a soft line where the buttons meet the shell, the wheel recess
    let k = 1; if (sy > 0.25 && t < 0.5) { k *= 1 - 0.7 * Math.exp(-((x / 0.0010) ** 2)); k *= 1 - 0.5 * Math.exp(-(((t - 0.5) / 0.01) ** 2)) * sm(0.25, 0.55, sy); }
    if (sy > 0.4 && Math.abs(x) < 0.006 && t > 0.14 && t < 0.33) k *= 0.3;
    C.set([k, k, k], i * 3);
  }
  g.computeVertexNormals(); g.setAttribute('color', new THREE.BufferAttribute(C, 3));
  const o = new THREE.Group(); o.userData.part = 'mouse';
  const body = new THREE.Mesh(g, M.mouse); o.add(body);
  // seat the details on the actual surface: ray hits on the body
  const rc = new THREE.Raycaster(), V = (...a) => new THREE.Vector3(...a);
  const hit = (from, dir) => { rc.set(from, dir.normalize()); const h = rc.intersectObject(body)[0]; return h ? h.point : from; };
  const wz = -L / 2 + 0.235 * L, wp = hit(V(0, 0.2, wz), V(0, -1, 0));
  const wheel = new THREE.CylinderGeometry(0.0105, 0.0105, 0.0065, 32, 1).rotateZ(Math.PI / 2).translate(0, wp.y - 0.0072, wz);
  const tp = hit(V(-0.2, 0.025, -L / 2 + 0.48 * L), V(1, 0, 0));
  const tw = new THREE.CylinderGeometry(0.008, 0.008, 0.004, 24, 1).rotateZ(Math.PI / 2).translate(tp.x + 0.0012, tp.y, tp.z);
  const bp = hit(V(-0.2, 0.023, -L / 2 + 0.66 * L), V(1, 0, 0));
  const btn = new THREE.CapsuleGeometry(0.003, 0.011, 4, 10).rotateX(Math.PI / 2).translate(bp.x + 0.0013, bp.y, bp.z);
  o.add(new THREE.Mesh(mergeAll(THREE, [wheel, tw]), M.stand), new THREE.Mesh(btn, M.mouseBtn));
  return o;
}

function seg(THREE, a, b) { // unit-height cylinder (y) placed between two points
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b), d = B.clone().sub(A);
  return new THREE.Matrix4().compose(A.clone().add(B).multiplyScalar(0.5), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize()), new THREE.Vector3(1, d.length(), 1));
}
