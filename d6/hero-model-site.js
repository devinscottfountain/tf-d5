// D6 hero: site dressing outside the glass. Jersey barriers and fence (instanced), aggregate stockpiles, a parked pickup,
// a site office trailer with a lit window, light cones under the tower heads (geometry only, userData.role 'lightCone'),
// and work lights on the machines. Everything static is merged per material; sizes are real, units metres.
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
  const jg = boxUV(THREE, mergeAll(THREE, [extrude(THREE, jersey, 2.96, 0.012, 1).rotateY(Math.PI / 2)]), 1.5);
  const jPos = [];
  for (let i = 0; i < 7; i++) jPos.push([-15 + i * 3.02, -31.5 + i * 0.12, 0.04 + (r() - 0.5) * 0.05]);       // run in front of the dozer
  for (let i = 0; i < 4; i++) jPos.push([10 + i * 3.02, -33.2 - i * 0.35, 0.115 + (r() - 0.5) * 0.04]);         // offset run, right
  jPos.push([24.5, -35.6, 0.9]);
  const barriers = new THREE.InstancedMesh(jg, M.concrete, jPos.length);
  { const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
    jPos.forEach(([x, z, ry], i) => { q.setFromEuler(e.set(0, ry, (r() - 0.5) * 0.02)); barriers.setMatrixAt(i, m.compose(new THREE.Vector3(x, Y(x, z) - 0.03, z), q, new THREE.Vector3(1, 1, 1))); }); }
  barriers.userData.part = 'jersey'; barriers.userData.texScale = 1.5; group.add(barriers);

  // ---------------------------------------------------------------- temporary fence: posts in feet (instanced), top rail, chain-link mesh
  const fenceRun = [[-46, -40], [-20, -36.5]], fN = 9;
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
    x.strokeStyle = '#fff'; x.lineWidth = 3; x.beginPath(); x.moveTo(0, 32); x.lineTo(32, 0); x.lineTo(64, 32); x.lineTo(32, 64); x.closePath(); x.stroke();
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; })();
  const fenceMesh = new THREE.Mesh(mergeAll(THREE, meshPanels), new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.6, roughness: 0.5, alphaMap: link, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
  { const uv = fenceMesh.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * Math.hypot(fenceRun[1][0] - fenceRun[0][0], fenceRun[1][1] - fenceRun[0][1]) / fN / 0.06, uv.getY(i) * 1.85 / 0.06); }
  fenceMesh.userData.part = 'fence-mesh'; fenceMesh.renderOrder = 1; group.add(fenceMesh);

  // ---------------------------------------------------------------- aggregate stockpiles: lumpy cones at the angle of repose
  const pile = (x, z, R, h, seed) => {
    const f = rng(seed), g = new THREE.ConeGeometry(R, h, high ? 40 : 24, high ? 10 : 6, true), p = g.attributes.position, ph = [f() * 6, f() * 6, f() * 6];
    for (let i = 0; i < p.count; i++) { const px = p.getX(i), pz = p.getZ(i), py = p.getY(i), a = Math.atan2(pz, px), t = (py + h / 2) / h;
      const k = 1 + 0.08 * Math.sin(a * 3 + ph[0]) + 0.05 * Math.sin(a * 7 + ph[1]) + 0.03 * Math.sin(a * 13 + ph[2]) * (1 - t);
      p.setXYZ(i, px * k, py * (1 + 0.06 * Math.sin(a * 5 + ph[1])) - 0.12 * (1 - t) * (1 - t), pz * k); }
    g.computeVertexNormals(); g.translate(x, Y(x, z) + h / 2 - 0.3, z); P(M.gravel, boxUV(THREE, g, 2));
  };
  pile(42, -66, 7, 3.6, 3); pile(-38, -84, 8, 4.2, 5); pile(49, -60, 4.5, 2.2, 8);

  // ---------------------------------------------------------------- site office trailer (12 x 3.6 m), lit window, door light, stairs
  { const X = -46, Z = -58, ry = 0.18, L = 12, W = 3.6, H = 2.7, y = Y(X, Z), tr = new THREE.Matrix4().makeRotationY(ry).setPosition(X, y, Z);
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
  { const X = -33, Z = -50.5, ry = -0.35, y = Y(X, Z), tr = new THREE.Matrix4().makeRotationY(ry).setPosition(X, y, Z), T = g => g.applyMatrix4(tr);
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

  // ---------------------------------------------------------------- light cones under the tower heads (faint, additive; compositing may replace)
  const coneMat = new THREE.ShaderMaterial({
    uniforms: { uCol: { value: new THREE.Color(1.0, 0.8, 0.55) }, uAmt: { value: high ? 0.05 : 0.035 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    vertexShader: `varying float vT; varying vec3 vN, vV; void main(){ vT=uv.y; vec4 w=modelMatrix*vec4(position,1.); vN=normalize(mat3(modelMatrix)*normal); vV=normalize(cameraPosition-w.xyz); gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform vec3 uCol; uniform float uAmt; varying float vT; varying vec3 vN, vV;
      void main(){ float edge=pow(abs(dot(normalize(vN),normalize(vV))),1.5); float a=uAmt*edge*pow(vT,1.6)*smoothstep(0.,.08,vT); gl_FragColor=vec4(uCol*a,1.); }`
  });
  const cones = spots.map(s => {
    const a = s.position, b = s.target.position, len = a.distanceTo(b), rad = len * Math.tan(s.angle * 0.55);
    const g = new THREE.ConeGeometry(rad, len, 24, 1, true).translate(0, -len / 2, 0); // apex at the origin, uv.y 1 at apex
    const c = new THREE.Mesh(g, coneMat); c.position.copy(a); c.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), b.clone().sub(a).normalize());
    c.userData.role = 'lightCone'; c.renderOrder = 3; group.add(c); return c;
  });

  // merge per material
  const meshes = [];
  for (const [m, gs] of parts) { const mesh = new THREE.Mesh(mergeAll(THREE, gs), m); mesh.userData.part = 'site'; group.add(mesh); meshes.push(mesh); }

  return {
    M, cones, coneMat, barriers, posts, fenceMesh, meshes,
    bind(tb) { tb.bind(M.concrete, 'concrete_floor', { color: 0xb0aca4 }); tb.bind(M.gravel, 'gravel', { color: 0xa0968a }); tb.bind(M.steel, 'rusty_metal', { maps: ['normalMap', 'roughnessMap'] }); tb.bind(M.galv, 'brushed_metal', { maps: ['normalMap', 'roughnessMap'] }); },
    dispose() { for (const o of [...meshes, barriers, posts, fenceMesh, ...cones]) o.geometry.dispose(); Object.values(M).forEach(m => m.dispose()); coneMat.dispose(); link.dispose(); }
  };
}
