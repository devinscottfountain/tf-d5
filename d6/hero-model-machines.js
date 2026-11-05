// D6 hero: the yard machines, modelled for a 40-90 m night read through the glass. CAT 336-class excavator (track chain
// with shoes, grousers and links over idler, sprocket, rollers; box-section boom and stick with flanges and bosses; live
// hydraulic rams between their pins; fabricated bucket with teeth), D6-class high-drive dozer (elevated sprocket, curved
// moldboard with ribs, C-frame push arms, lift and tilt rams, parallelogram ripper), a rigid haul truck and towable light
// towers. Vertex colours + one object-space grime shader (dust low down, mottled dirt, rust), everything merged per
// material per moving part. Units metres; forward of every machine is +x, right is +z, up is +y.
// Rig names match the D5 machines (exA.{g,up,boom,stick,bucket}, towers[i] = lamp lens mesh) so poses and lights carry over.

const MNOISE = /* glsl */ `
float mh3(vec3 p){ p=fract(p*.3183099+.1); p*=17.; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float mn3(vec3 x){ vec3 i=floor(x),f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(mh3(i),mh3(i+vec3(1,0,0)),f.x),mix(mh3(i+vec3(0,1,0)),mh3(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(mh3(i+vec3(0,0,1)),mh3(i+vec3(1,0,1)),f.x),mix(mh3(i+vec3(0,1,1)),mh3(i+vec3(1,1,1)),f.x),f.y),f.z); }
float mf3(vec3 p){ return .5*mn3(p)+.25*mn3(p*2.07+3.1)+.125*mn3(p*4.13+7.7)+.125*mn3(p*8.31+1.3); }
`;
// aG = (height above the machine's ground at rest, dirtiness 0..1, rust 0..1)
const GRIME = /* glsl */ `
  vec3 gq = vMObj;
  float gn1 = mf3(gq*1.35), gn2 = mn3(gq*vec3(5.,.9,5.)+2.3);
  float mDust = clamp(1. - vMG.x/1.5 + (gn1-.5)*1.1, 0., 1.);
  mDust = mDust*mDust*(3.-2.*mDust) * (.15 + .6*vMG.y);
  mDust = clamp(mDust + max(vMN.y,0.)*.28*vMG.y*smoothstep(.35,.7,gn1), 0., 1.);
  float mGr = smoothstep(.48,.86, mf3(gq*3.2+5.)) * (.2 + .8*vMG.y);
  float mRust = smoothstep(.58,.78, mf3(gq*4.6+11.)) * vMG.z;
  diffuseColor.rgb *= 1. - mGr*.5 - (gn2-.5)*.22*vMG.y;
  diffuseColor.rgb = mix(diffuseColor.rgb, uRust*(.65+.7*gn2), mRust);
  diffuseColor.rgb = mix(diffuseColor.rgb, uDust*(.7+.5*gn1), mDust*.8);
`;

export function machineMaterials(THREE) {
  const dustC = new THREE.Color(0xa58f70), rustC = new THREE.Color(0x6a3418);
  const grime = (m, key) => {
    m.onBeforeCompile = sh => {
      sh.uniforms.uDust = { value: dustC }; sh.uniforms.uRust = { value: rustC };
      sh.vertexShader = 'attribute vec3 aG; varying vec3 vMG, vMObj, vMN;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvMG = aG; vMN = normal; vMObj = position * vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));');
      sh.fragmentShader = 'uniform vec3 uDust, uRust; varying vec3 vMG, vMObj, vMN;\n' + MNOISE + sh.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + GRIME)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + mDust*.4 + mRust*.3 + mGr*.1, 0., 1.);')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1. - max(mDust, mRust);');
    };
    m.customProgramCacheKey = () => 'hmach-' + key; return m;
  };
  const S = o => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
  return {
    paint: grime(S({ roughness: 0.46, metalness: 0 }), 'paint'),
    rough: grime(S({ roughness: 0.93, metalness: 0 }), 'rough'),
    metal: grime(S({ roughness: 0.34, metalness: 0.85 }), 'metal'),
    glass: S({ roughness: 0.06, metalness: 0.82 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
  };
}

// bake static machine parts into world space, one mesh per material (grime noise then runs in world space: they never move)
export function bakeStatic(THREE, parent, roots, { shadow = true } = {}) {
  parent.updateMatrixWorld(true);
  const by = new Map(), drop = [];
  for (const { root, deep } of roots) {
    const visit = o => { if (o.isMesh && o.geometry.attributes.aG) { const g = o.geometry.clone().applyMatrix4(o.matrixWorld); (by.get(o.material) || by.set(o.material, []).get(o.material)).push(g); drop.push(o); } if (deep || o === root) o.children.forEach(visit); };
    visit(root);
  }
  for (const o of drop) { o.parent.remove(o); o.geometry.dispose(); }
  const out = [];
  for (const [m, gs] of by) {
    const n = gs.reduce((s, g) => s + g.attributes.position.count, 0), geo = new THREE.BufferGeometry();
    for (const a of ['position', 'normal', 'color', 'aG']) { const A = new Float32Array(n * 3); let o = 0; for (const g of gs) { A.set(g.attributes[a].array, o); o += g.attributes[a].array.length; } geo.setAttribute(a, new THREE.BufferAttribute(A, 3)); }
    gs.forEach(g => g.dispose());
    const mesh = new THREE.Mesh(geo, m); mesh.castShadow = shadow && m.isMeshStandardMaterial && m.roughness > 0.1; mesh.receiveShadow = true; mesh.userData.part = 'machines-static'; parent.add(mesh); out.push(mesh);
  }
  return out;
}

export function buildMachines({ THREE, high = true, MAT = machineMaterials(THREE) }) {
  const V3 = THREE.Vector3, Q = THREE.Quaternion, YA = new V3(0, 1, 0);
  let seed = 9001;
  const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const T = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(new V3(x, y, z), new Q().setFromEuler(new THREE.Euler(rx, ry, rz)), typeof s === 'number' ? new V3(s, s, s) : new V3(...s));
  const tc = new THREE.Color();
  const disposables = [];

  // ------------------------------------------------------------ kit: parts per material with colour + grime data, merged on build
  const Kit = (h0 = 0, dirt0 = 0.5, remap = null) => { // remap: fold kinds together on moving parts (fewer draws)
    const L = {};
    const k = {
      add(kind, color, geo, m, o = {}) {
        if (remap && remap[kind]) kind = remap[kind];
        const g = geo.index ? geo.toNonIndexed() : geo; if (m) g.applyMatrix4(m);
        for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal') g.deleteAttribute(a);
        if (!g.attributes.normal) g.computeVertexNormals();
        const p = g.attributes.position, n = p.count, cA = new Float32Array(n * 3), gA = new Float32Array(n * 3);
        const base = new THREE.Color(color), j = 1 + (rnd() - 0.5) * 2 * (o.jit ?? 0.035), h = o.h ?? h0, dirt = o.dirt ?? dirt0, rust = o.rust ?? 0;
        for (let v = 0; v < n; v++) {
          let c = base; if (o.vf) { const r = o.vf(p.getX(v), p.getY(v), p.getZ(v)); c = r.isColor ? r : tc.set(r); }
          cA[v * 3] = c.r * j; cA[v * 3 + 1] = c.g * j; cA[v * 3 + 2] = c.b * j;
          gA[v * 3] = p.getY(v) + h; gA[v * 3 + 1] = dirt; gA[v * 3 + 2] = rust;
        }
        g.setAttribute('color', new THREE.BufferAttribute(cA, 3)); g.setAttribute('aG', new THREE.BufferAttribute(gA, 3));
        (L[kind] ||= []).push(g); return k;
      },
      B(kind, color, x0, y0, z0, x1, y1, z1, o) { return k.add(kind, color, new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)), T((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), o); },
      rod(kind, color, a, b, r, seg = 8, o, r2) { // cylinder between two points
        const A = new V3(...a), Bv = new V3(...b), d = Bv.clone().sub(A), len = d.length();
        return k.add(kind, color, new THREE.CylinderGeometry(r2 ?? r, r, len, seg), new THREE.Matrix4().compose(A.clone().add(Bv).multiplyScalar(0.5), new Q().setFromUnitVectors(YA, d.normalize()), new V3(1, 1, 1)), o);
      },
      bar(kind, color, a, b, t, o, t2 = t) { // rectangular bar between two points (t across, t2 deep in z when the bar lies in xy)
        const A = new V3(...a), Bv = new V3(...b), d = Bv.clone().sub(A), len = d.length();
        return k.add(kind, color, new THREE.BoxGeometry(t, len, t2), new THREE.Matrix4().compose(A.clone().add(Bv).multiplyScalar(0.5), new Q().setFromUnitVectors(YA, d.normalize()), new V3(1, 1, 1)), o);
      },
      // side-profile polygon [x,y] extruded across z (centred on zc)
      ext(kind, color, pts, depth, zc = 0, bevel = 0, o) { return k.add(kind, color, extrude(shapeOf(pts), depth, bevel), T(0, 0, zc), o); },
      // cross-section polygon [z,y] extruded along x from x0 to x1
      extX(kind, color, pts, x0, x1, bevel = 0, o) { return k.add(kind, color, extrude(shapeOf(pts.map(([z, y]) => [-z, y])), x1 - x0, bevel).rotateY(Math.PI / 2).translate((x0 + x1) / 2, 0, 0), null, o); },
      // plate following a polyline in xy (thickness t normal to it, width w across z)
      strip(kind, color, pts, t, w, zc = 0, o) { for (let i = 0; i < pts.length - 1; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1], len = Math.hypot(bx - ax, by - ay);
        k.add(kind, color, new THREE.BoxGeometry(len + t * 0.6, t, w), T((ax + bx) / 2, (ay + by) / 2, zc, 0, 0, Math.atan2(by - ay, bx - ax)), o); } return k; },
      build(parent, shadow = true) {
        const out = {};
        for (const kind in L) {
          const g = merge(L[kind]); disposables.push(g);
          const mesh = new THREE.Mesh(g, MAT[kind]); mesh.castShadow = shadow && kind !== 'glow' && kind !== 'glass'; mesh.receiveShadow = true; parent.add(mesh); out[kind] = mesh;
        }
        return out;
      },
    };
    return k;
  };
  function merge(gs) { // position, normal, color, aG (all non-indexed)
    const n = gs.reduce((s, g) => s + g.attributes.position.count, 0), out = new THREE.BufferGeometry();
    for (const [a, w] of [['position', 3], ['normal', 3], ['color', 3], ['aG', 3]]) { const A = new Float32Array(n * w); let o = 0; for (const g of gs) { A.set(g.attributes[a].array, o); o += g.attributes[a].array.length; } out.setAttribute(a, new THREE.BufferAttribute(A, w)); }
    gs.forEach(g => g.dispose()); return out;
  }
  const shapeOf = pts => new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
  const extrude = (shape, depth, bevel = 0, curve = 6) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: curve }).translate(0, 0, -depth / 2);

  // ------------------------------------------------------------ track chain: shoes with grousers + link rails around the hull of the wheels
  // wheels [[x,y,r]] (r = the radius the inside of the chain wraps), chain shoes t thick, w wide, pitch p
  function hull(pts) { // monotone chain, CCW
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), lo = [], up = [];
    for (const p of pts) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    lo.pop(); up.pop(); return lo.concat(up);
  }
  function track(k, wheels, zc, { t = 0.06, w = 0.6, p = 0.2, grouser = 0.05, links = true, color = 0x26231f } = {}) {
    const pts = []; for (const [x, y, r] of wheels) for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; pts.push([x + Math.cos(a) * r, y + Math.sin(a) * r]); }
    const H = hull(pts), seg = [], cum = [0];
    for (let i = 0; i < H.length; i++) { const a = H[i], b = H[(i + 1) % H.length], l = Math.hypot(b[0] - a[0], b[1] - a[1]); seg.push([a, b, l]); cum.push(cum[i] + l); }
    const per = cum[cum.length - 1], N = Math.round(per / p), pp = per / N;
    let si = 0;
    for (let i = 0; i < N; i++) {
      const s = i * pp; while (cum[si + 1] < s) si++;
      const [a, b, l] = seg[si], f = (s - cum[si]) / l, x = a[0] + (b[0] - a[0]) * f, y = a[1] + (b[1] - a[1]) * f;
      const tx = (b[0] - a[0]) / l, ty = (b[1] - a[1]) / l, nx = ty, ny = -tx, ang = Math.atan2(ty, tx); // CCW hull: outward normal = tangent turned -90
      k.add('rough', color, new THREE.BoxGeometry(pp * 0.9, t, w), T(x + nx * t / 2, y + ny * t / 2, zc, 0, 0, ang), { dirt: 1, rust: 0.2, h: 0 });
      if (grouser) k.add('rough', 0x3a3631, new THREE.BoxGeometry(0.035, grouser, w), T(x + nx * (t + grouser / 2) + tx * pp * 0.18, y + ny * (t + grouser / 2) + ty * pp * 0.18, zc, 0, 0, ang), { dirt: 0.95, rust: 0.45, h: 0 });
      if (links) for (const s2 of [-1, 1]) k.add('metal', 0x403b35, new THREE.BoxGeometry(pp * 0.98, 0.09, 0.07), T(x - nx * 0.045, y - ny * 0.045, zc + s2 * (w / 2 - 0.16), 0, 0, ang), { dirt: 1, rust: 0.55, h: 0 });
    }
  }
  const sprocket = (k, x, y, zc, r, n, wdt = 0.18) => {
    k.rod('metal', 0x4b4843, [x, y, zc - wdt / 2], [x, y, zc + wdt / 2], r * 0.82, 16, { dirt: 1, rust: 0.4, h: 0 });
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; k.add('metal', 0x4b4843, new THREE.BoxGeometry(0.1, r * 0.3, wdt * 0.7), T(x + Math.cos(a) * r * 0.88, y + Math.sin(a) * r * 0.88, zc, 0, 0, a - Math.PI / 2), { dirt: 1, rust: 0.5, h: 0 }); }
    k.rod('metal', 0x2d2b28, [x, y, zc - wdt], [x, y, zc + wdt], r * 0.36, 12, { dirt: 0.9, rust: 0.3, h: 0 });
  };
  const roller = (k, x, y, zc, r, wd) => { k.rod('metal', 0x3c3934, [x, y, zc - wd / 2], [x, y, zc + wd / 2], r, 10, { dirt: 1, rust: 0.4, h: 0 }); k.rod('metal', 0x2a2825, [x, y, zc - wd / 2 - 0.03], [x, y, zc + wd / 2 + 0.03], r * 0.45, 8, { dirt: 1, h: 0 }); };
  // tyre: lathe cross-section with rounded shoulders, tread lugs, rim + hub; axis along z
  const tyre = (k, x, y, z, R, W, { lugs = 18, rim = 0x8a8984, inner = 0.55 } = {}) => {
    const pr = [[R * inner, -W / 2], [R * 0.93, -W / 2], [R, -W * 0.36], [R, W * 0.36], [R * 0.93, W / 2], [R * inner, W / 2]].map(p => new THREE.Vector2(p[0], p[1]));
    k.add('rough', 0x151413, new THREE.LatheGeometry(pr, high ? 22 : 14).rotateX(Math.PI / 2), T(x, y, z), { dirt: 1, h: 0 });
    for (let i = 0; i < lugs; i++) { const a = i / lugs * Math.PI * 2, s = i % 2 ? 1 : -1;
      k.add('rough', 0x1a1918, new THREE.BoxGeometry(0.06 * R, W * 0.42, R * 0.24), T(x + Math.cos(a) * R * 1.0, y + Math.sin(a) * R * 1.0, z + s * W * 0.2, Math.PI / 2, 0, a + s * 0.25).multiply(T(0, 0, 0, 0, 0, 0)), { dirt: 1, h: 0 }); }
    const sd = Math.sign(z) || 1;
    k.rod('metal', rim, [x, y, z + sd * (W / 2 - 0.06)], [x, y, z + sd * (W / 2 - 0.01)], R * inner * 0.98, 16, { dirt: 0.9, rust: 0.3, h: 0 });
    k.rod('metal', 0x3a3936, [x, y, z + sd * (W / 2 - 0.02)], [x, y, z + sd * (W / 2 + 0.05)], R * 0.2, 10, { dirt: 0.9, h: 0 });
  };

  // ------------------------------------------------------------ live hydraulic ram between two pins in a parent's xy plane
  // barrel (paint) hinges at A, rod (chrome) hinges at B; both stay on the A-B line as the rig moves
  const rams = [];
  // hoisted: FOLD is defined below with the palette
  function ram(parent, zs, r, Lb, Lr, col = 0x262624) {
    const kb = Kit(2, 0.4, FOLD), kr = Kit(2, 0.15);
    for (const z of zs) {
      kb.rod('paint', col, [0, 0, z], [0, Lb, z], r, 12, { rust: 0.08 });
      kb.rod('paint', col, [0, Lb - 0.06, z], [0, Lb, z], r * 1.18, 12);                        // gland
      kb.rod('paint', col, [0, 0, z - r * 0.9], [0, 0, z + r * 0.9], r * 0.95, 10);            // base eye
      kb.rod('metal', 0x2a2826, [r * 0.9, r * 1.4, z], [r * 0.9, Lb * 0.8, z], 0.022, 5, { rust: 0.3 }); // hose run on the barrel
      kr.rod('metal', 0xd4d4d1, [0, 0, z], [0, Lr, z], r * 0.55, 10, { dirt: 0.1 });
      kr.rod('metal', 0x3a3a38, [0, 0, z - r * 0.8], [0, 0, z + r * 0.8], r * 0.75, 10);        // rod eye
    }
    const gb = new THREE.Group(), gr = new THREE.Group(); parent.add(gb, gr); kb.build(gb); kr.build(gr);
    const o = { gb, gr, A: [0, 0], B: [0, 0], set(A, B) { const dx = B[0] - A[0], dy = B[1] - A[1], a = Math.atan2(dy, dx) - Math.PI / 2;
      gb.position.set(A[0], A[1], 0); gb.rotation.z = a; gr.position.set(B[0], B[1], 0); gr.rotation.z = a + Math.PI; } };
    rams.push(o); return o;
  }
  const rot = (p, a, o = [0, 0]) => [o[0] + p[0] * Math.cos(a) - p[1] * Math.sin(a), o[1] + p[0] * Math.sin(a) + p[1] * Math.cos(a)];

  const CAT = 0xe2a50f, CATd = 0xc08a0c, BLK = 0x1d1d1c, GLS = 0x4a5a66, AMBER = 0xffa21a, RED = 0xff2a14;
  const LOD = high ? 1 : 0;
  const FOLD = { rough: 'paint', metal: 'paint' }, FOLDR = { rough: 'paint' };

  // ============================================================ CAT 336-class excavator
  function excavator() {
    const g = new THREE.Group();
    const ku = Kit(0, 1);
    for (const s of [-1, 1]) {
      const zc = s * 1.3;
      const wheels = [[1.94, 0.49, 0.43], [-1.94, 0.49, 0.43]]; for (let i = 0; i < 7; i++) wheels.push([-1.38 + i * 0.46, 0.16, 0.1]);
      track(ku, wheels, zc, { t: 0.06, w: 0.6, p: 0.205, grouser: LOD ? 0.045 : 0, links: !!LOD });
      ku.rod('metal', 0x47443e, [1.94, 0.49, zc - 0.13], [1.94, 0.49, zc + 0.13], 0.4, 18, { dirt: 1, rust: 0.3 });         // front idler
      ku.rod('metal', 0x2e2c29, [1.94, 0.49, zc - 0.2], [1.94, 0.49, zc + 0.2], 0.12, 10, { dirt: 1 });
      sprocket(ku, -1.94, 0.49, zc, 0.43, 11);
      ku.rod('metal', 0x35332f, [-1.94, 0.49, zc - s * 0.1], [-1.94, 0.49, zc - s * 0.42], 0.3, 14, { dirt: 1, rust: 0.2 });   // final drive
      for (let i = 0; i < 7; i++) roller(ku, -1.38 + i * 0.46, 0.16, zc, 0.1, 0.36);
      for (const x of [-0.75, 0.75]) roller(ku, x, 0.84, zc, 0.075, 0.24);
      // track frame: tapered box between the runs, roller guard below, frame top plate sloping toward the carbody
      ku.ext('rough', 0x24221f, [[-1.7, 0.3], [1.65, 0.3], [1.75, 0.5], [1.55, 0.72], [-1.6, 0.72], [-1.75, 0.5]], 0.4, zc, 0.02, { dirt: 1, rust: 0.15 });
      ku.B('rough', 0x2a2724, -1.55, 0.22, zc + s * 0.18, 1.55, 0.3, zc + s * 0.24, { dirt: 1, rust: 0.3 });
      ku.B('rough', 0x2a2724, -1.45, 0.72, zc - 0.15, 1.45, 0.76, zc + 0.15, { dirt: 1 });
      ku.B('rough', 0x2a2724, -0.6, 0.45, zc - s * 0.2, 0.6, 0.85, zc - s * 0.75, { dirt: 1 }); // carbody leg
      // track step + spring recoil housing
      ku.B('metal', 0x2a2826, 0.9, 0.6, zc + s * 0.2, 1.4, 0.64, zc + s * 0.32, { dirt: 1, rust: 0.4 });
    }
    ku.ext('rough', BLK, [[-1.1, 0.5], [1.1, 0.5], [1.2, 0.8], [1.0, 1.0], [-1.0, 1.0], [-1.2, 0.8]], 1.8, 0, 0.03, { dirt: 0.95 });
    ku.rod('metal', 0x2d2c2a, [0, 0.98, 0], [0, 1.1, 0], 1.04, 28, { dirt: 0.8 });   // swing bearing
    ku.rod('metal', 0x3a3834, [0, 1.0, 0], [0, 1.06, 0], 1.1, 28, { dirt: 0.8, rust: 0.3 });
    ku.build(g);

    // ---------------------------------------------------------- upper structure (swing at y=1.1)
    const up = new THREE.Group(); up.position.y = 1.1; g.add(up);
    const k = Kit(1.1, 0.55);
    k.B('rough', 0x222221, -2.45, 0, -1.49, 1.55, 0.26, 1.49, { dirt: 0.8 });
    // counterweight: plan rounded to the 3.45 m tail swing, rounded top edge, lower chamfer, rear lamp + lifting eyes
    { const R = 3.45, pl = [[-2.42, -1.49]]; for (let i = 0; i <= 16; i++) { const z = -1.49 + i * 2.98 / 16; pl.push([-Math.sqrt(R * R - z * z), z]); } pl.push([-2.42, 1.49]);
      k.add('paint', 0x1c1c1b, extrude(shapeOf(pl), 0.86, 0.08, 4).rotateX(-Math.PI / 2).translate(0, 0.55, 0), null, { dirt: 0.55, rust: 0.12 });
      const pl2 = pl.map(([x, z]) => [x + 0.12 * Math.sign(x + 2.9), z * 0.97]);
      k.add('paint', 0x161615, extrude(shapeOf(pl2), 0.3, 0.02, 4).rotateX(-Math.PI / 2).translate(0, 0.17, 0), null, { dirt: 0.8, rust: 0.2 });
      for (const z of [-0.8, 0.8]) k.rod('metal', 0x2a2826, [-2.85, 1.0, z], [-2.85, 1.08, z], 0.09, 8, { rust: 0.6 });
      for (const z of [-1.1, 1.1]) k.B('glow', RED, -3.36 + Math.abs(z) * 0.0, 0.8, z - 0.08, -3.3, 0.88, z + 0.08); }
    // engine hood: cross-section with rounded shoulders, access door seams, louvre panels, top screens
    k.extX('paint', CAT, [[-1.49, 0.26], [1.49, 0.26], [1.49, 1.12], [1.38, 1.24], [-1.38, 1.24], [-1.49, 1.12]], -2.42, -0.36, 0, { dirt: 0.5, rust: 0.05 });
    for (const x of [-2.0, -1.4, -0.8]) for (const z of [-1.495, 1.495]) k.B('rough', 0x2a2410, x - 0.012, 0.32, z - 0.006, x + 0.012, 1.1, z + 0.006, { dirt: 0.5 }); // door seams
    for (let i = 0; i < 7; i++) k.B('rough', 0x2a2410, -1.95, 0.5 + i * 0.07, 1.492, -1.45, 0.53 + i * 0.07, 1.505, { dirt: 0.4 });        // louvres (right side)
    for (let i = 0; i < 7; i++) k.B('rough', 0x2a2410, -1.35, 0.5 + i * 0.07, -1.505, -0.85, 0.53 + i * 0.07, -1.492, { dirt: 0.4 });
    k.B('rough', 0x121212, -2.2, 1.24, 0.08, -1.2, 1.262, 1.32, { dirt: 0.4 }); // radiator screen
    for (let i = 0; i < 9; i++) k.B('paint', CATd, -2.18 + i * 0.12, 1.262, 0.1, -2.15 + i * 0.12, 1.278, 1.3);
    k.B('rough', 0x121212, -1.05, 1.24, -1.32, -0.55, 1.262, -0.6, { dirt: 0.4 });
    // exhaust with rain cap, precleaner bowl, air intake
    k.rod('metal', 0x2a2826, [-1.7, 1.2, 0.6], [-1.7, 1.86, 0.6], 0.075, 10, { rust: 0.7, dirt: 0.3 });
    k.add('metal', 0x2a2826, new THREE.CylinderGeometry(0.1, 0.09, 0.04, 10), T(-1.67, 1.89, 0.6, 0, 0, 0.35), { rust: 0.6 });
    k.rod('paint', 0x151515, [-0.78, 1.2, 1.18], [-0.78, 1.5, 1.18], 0.11, 10); k.rod('paint', 0x1d1d1d, [-0.78, 1.5, 1.18], [-0.78, 1.6, 1.18], 0.14, 10, {}, 0.11);
    // handrails along the hood edges: posts, top rail, knee rail
    for (const z of [1.43, -1.43]) { const x0 = -2.3, x1 = z > 0 ? -0.45 : -0.55;
      k.bar('paint', CAT, [x0, 1.82, z], [x1, 1.82, z], 0.045); k.bar('paint', CAT, [x0, 1.52, z], [x1, 1.52, z], 0.035);
      for (const x of [x0, (x0 + x1) / 2, x1]) k.bar('paint', CAT, [x, 1.24, z], [x, 1.84, z], 0.045); }
    // right front: tool box / fuel tank with tread-plate top, rail, filler cap, steps down to the track
    k.B('paint', CAT, -0.36, 0.26, 0.86, 1.55, 1.1, 1.49);
    k.B('rough', 0x30302e, -0.3, 1.1, 0.9, 1.5, 1.118, 1.45, { dirt: 0.8 });
    for (let i = 0; i < 12; i++) k.B('rough', 0x3c3c39, -0.25 + i * 0.145, 1.118, 0.92, -0.2 + i * 0.145, 1.13, 1.43, { dirt: 0.9 });
    k.bar('paint', CAT, [-0.3, 1.62, 1.46], [1.5, 1.62, 1.46], 0.04); for (const x of [-0.3, 0.6, 1.5]) k.bar('paint', CAT, [x, 1.1, 1.46], [x, 1.64, 1.46], 0.04);
    k.rod('metal', 0x333333, [0.3, 1.12, 1.2], [0.3, 1.17, 1.2], 0.07, 10);
    for (let i = 0; i < 2; i++) k.B('metal', 0x333230, 1.25, -0.25 - i * 0.32, 1.5, 1.55, -0.21 - i * 0.32, 1.72, { dirt: 1, rust: 0.4 });
    // boom foot: twin bosses on the upper frame
    for (const z of [0.12, 0.78]) k.ext('paint', CAT, [[0.2, 0.26], [1.55, 0.26], [1.5, 0.75], [1.25, 1.25], [0.9, 1.3], [0.55, 0.9]], 0.12, z, 0.02);
    k.B('rough', 0x232323, 0.15, 0.26, 0.18, 1.55, 0.62, 0.72);
    k.rod('metal', 0x3a3a38, [1.1, 1.0, 0.0], [1.1, 1.0, 0.9], 0.16, 12);
    k.B('paint', CAT, 1.4, 0.26, 0.25, 1.75, 0.55, 0.65); // boom ram base lugs
    // cab: frame with pillars, glass inset, door, roof with FOPS bars, wiper, sun visor, beacon, mirrors
    { const z0 = -1.49, z1 = -0.52, x0 = -0.36, x1 = 1.5, yb = 0.86, yt = 2.0;
      k.B('paint', 0x1e1e1d, x0, 0.26, z0, x1, yb, z1, { dirt: 0.6 });
      k.ext('glass', GLS, [[x0 + 0.03, yb], [x1 - 0.03, yb], [x1 + 0.03, yt - 0.05], [x0 + 0.03, yt - 0.05]], z1 - z0 - 0.05, (z0 + z1) / 2);
      for (const z of [z0 + 0.045, z1 - 0.045]) for (const [xa, xb] of [[x0, x0], [x1, x1 + 0.06], [0.6, 0.6]]) k.bar('paint', 0x1e1e1d, [xa, yb, z], [xb, yt, z], 0.08);
      for (const x of [x0, x1 + 0.06]) k.bar('paint', 0x1e1e1d, [x, yt, z0], [x, yt, z1], 0.08);
      k.bar('paint', 0x1e1e1d, [x1 + 0.02, 1.25, z0], [x1 + 0.02, 1.25, z1], 0.06);                                          // front glass split
      k.B('paint', 0x2c2c2a, x0 - 0.05, yt, z0 - 0.04, x1 + 0.1, yt + 0.1, z1 + 0.04, { dirt: 0.35 });
      for (let i = 0; i < 4; i++) k.bar('metal', 0x2a2a28, [x0 + 0.2 + i * 0.4, yt + 0.16, z0], [x0 + 0.2 + i * 0.4, yt + 0.16, z1], 0.04);
      for (const z of [z0 + 0.02, z1 - 0.02]) k.bar('metal', 0x2a2a28, [x0 + 0.1, yt + 0.16, z], [x1, yt + 0.16, z], 0.05);
      for (const x of [x0 + 0.1, x1]) for (const z of [z0 + 0.02, z1 - 0.02]) k.bar('metal', 0x2a2a28, [x, yt + 0.1, z], [x, yt + 0.18, z], 0.04);
      k.bar('metal', 0x111111, [x1 + 0.05, 1.3, -1.25], [x1 + 0.08, 1.8, -1.05], 0.02);                                      // wiper
      k.B('paint', 0x1e1e1d, 0.0, 0.92, z0 - 0.01, 0.58, 1.95, z0 - 0.005);                                                 // door frame shadow
      k.bar('metal', 0x9a9a96, [0.5, 1.2, z0 - 0.04], [0.5, 1.6, z0 - 0.04], 0.025);                                         // grab handle
      k.rod('glow', AMBER, [-0.22, yt + 0.1, -0.66], [-0.22, yt + 0.24, -0.66], 0.07, 10);
    }
    k.bar('metal', 0x222222, [1.45, 1.1, 1.47], [1.62, 1.85, 1.62], 0.03); k.B('glass', 0x6f7f8a, 1.57, 1.72, 1.52, 1.64, 2.02, 1.78);
    k.bar('metal', 0x222222, [1.48, 1.4, -1.5], [1.66, 1.95, -1.64], 0.03); k.B('glass', 0x6f7f8a, 1.6, 1.85, -1.75, 1.67, 2.12, -1.52);
    k.build(up);

    // ---------------------------------------------------------- boom: welded box section, flanges, bosses, lines (pivot (1.1,1.0,0.45) in up space, tip pin (6.4,0))
    const boom = new THREE.Group(); boom.position.set(1.1, 1.0, 0.45); up.add(boom);
    const kb = Kit(2.1, 0.45, FOLDR);
    const bTop = [[-0.42, 0.28], [0.6, 0.64], [2.9, 1.4], [5.6, 0.52], [6.62, 0.26]], bBot = [[6.62, -0.26], [5.6, -0.2], [2.9, 0.56], [0.6, -0.24], [-0.42, -0.3]];
    kb.ext('paint', CAT, [...bTop, ...bBot], 0.56, 0, 0.02, { rust: 0.05 });
    kb.strip('paint', CAT, bTop, 0.035, 0.64, 0, { rust: 0.05 }); kb.strip('paint', CAT, bBot.slice().reverse(), 0.035, 0.64, 0, { rust: 0.08 });
    for (const [x, y0, y1] of [[1.6, 0.06, 0.84], [3.9, 0.36, 1.08], [5.0, 0.0, 0.68]]) for (const z of [-0.29, 0.29]) kb.B('paint', CATd, x - 0.04, y0, z - 0.012, x + 0.04, y1, z + 0.012); // side stiffeners
    kb.rod('paint', CAT, [0, 0, -0.42], [0, 0, 0.42], 0.24, 16); kb.rod('metal', 0x3a3a38, [0, 0, -0.46], [0, 0, 0.46], 0.12, 10);   // foot boss + pin
    kb.rod('paint', CAT, [6.4, 0, -0.36], [6.4, 0, 0.36], 0.22, 16); kb.rod('metal', 0x3a3a38, [6.4, 0, -0.4], [6.4, 0, 0.4], 0.1, 10);   // tip boss + pin
    kb.ext('paint', CAT, [[2.15, 1.18], [2.75, 1.32], [2.65, 1.66], [2.35, 1.66]], 0.36, 0, 0.015);                             // stick ram base bracket
    for (const z of [-0.42, 0.42]) kb.ext('paint', CAT, [[2.0, 0.42], [2.6, 0.58], [2.45, 0.12], [2.25, 0.12]], 0.07, z * 0.92, 0.01); // boom ram rod lugs
    kb.rod('metal', 0x3a3a38, [2.35, 0.2, -0.5], [2.35, 0.2, 0.5], 0.07, 8);
    for (const z of [-0.2, -0.1, 0.1, 0.2]) kb.strip('rough', 0x121212, [[0.5, 0.74], [2.8, 1.5], [5.5, 0.62], [6.3, 0.4]].map(([x, y]) => [x, y + 0.03]), 0.035, 0.035, z);   // hydraulic lines
    for (const x of [1.3, 3.4, 4.6]) kb.B('metal', 0x2a2826, x - 0.04, 1.0 + (x < 2.9 ? (x - 0.6) * 0.33 : (5.6 - x) * 0.33) - 0.4, -0.25, x + 0.04, 1.0 + (x < 2.9 ? (x - 0.6) * 0.33 : (5.6 - x) * 0.33) - 0.33, 0.25, { rust: 0.4 });
    kb.build(boom);

    // ---------------------------------------------------------- stick (3.2 m) with the bucket linkage
    const stick = new THREE.Group(); stick.position.set(6.4, 0, 0); boom.add(stick);
    const ks = Kit(1.2, 0.8, FOLDR);
    const sTop = [[-0.9, 0.56], [-0.2, 0.5], [3.32, 0.2]], sBot = [[3.32, -0.2], [0, -0.38], [-0.9, 0.14]];
    ks.ext('paint', CAT, [...sTop, ...sBot], 0.44, 0, 0.015, { rust: 0.1 });
    ks.strip('paint', CAT, sTop, 0.03, 0.5, 0, { rust: 0.1 }); ks.strip('paint', CAT, sBot.slice().reverse(), 0.03, 0.5, 0, { rust: 0.12 });
    ks.rod('paint', CAT, [0, 0, -0.32], [0, 0, 0.32], 0.2, 14); ks.rod('metal', 0x3a3a38, [0, 0, -0.36], [0, 0, 0.36], 0.09, 10);
    ks.ext('paint', CAT, [[-0.95, 0.4], [-0.6, 0.52], [-0.7, 0.8], [-0.95, 0.78]], 0.3, 0, 0.01);                                 // tail lug (stick ram)
    ks.ext('paint', CAT, [[-0.25, 0.5], [0.15, 0.48], [0.05, 0.78], [-0.2, 0.78]], 0.3, 0, 0.01);                                // bucket ram base lug
    ks.B('rough', 0x2a2826, 2.75, 0.18, -0.22, 3.3, 0.5, 0.22, { rust: 0.4 });
    ks.rod('metal', 0x3a3a38, [3.2, 0, -0.32], [3.2, 0, 0.32], 0.11, 10, { rust: 0.4 });
    ks.rod('metal', 0x3a3a38, [2.95, 0.32, -0.3], [2.95, 0.32, 0.3], 0.08, 8, { rust: 0.4 });
    for (const z of [-0.12, 0.12]) ks.strip('rough', 0x121212, [[-0.6, 0.6], [2.6, 0.36]], 0.035, 0.035, z);
    ks.build(stick);
    // side links: pin (2.95,0.32) on the stick to the rod-end pin (moving)
    const kl = Kit(0.8, 0.8); for (const z of [-0.26, 0.26]) kl.add('paint', 0x2b2925, new THREE.BoxGeometry(0.12, 1, 0.05), T(0, 0.5, z), { rust: 0.3 });
    const link = new THREE.Group(); stick.add(link); kl.build(link);

    // ---------------------------------------------------------- bucket: side plates, wrapped shell, lip, adapters + teeth, wear strips, ears
    const bucket = new THREE.Group(); bucket.position.set(3.2, 0, 0); stick.add(bucket);
    const kk = Kit(0.9, 0.9, FOLDR), BW = 1.4;
    const shell = [[-0.15, 0.25], [0.45, 0.42], [1.05, 0.3], [1.48, 0.0], [1.7, -0.45], [1.66, -0.62]];
    const side = [...shell, [1.2, -0.55], [0.55, -0.34], [0.05, -0.1]];
    for (const s of [-1, 1]) { kk.ext('paint', 0x2b2925, side, 0.035, s * (BW / 2 - 0.0175), 0.006, { rust: 0.55 });
      kk.strip('metal', 0x5a544b, [[1.66, -0.62], [1.2, -0.55], [0.55, -0.34]], 0.03, 0.06, s * (BW / 2 + 0.02), { rust: 0.5 }); }     // side cutters
    kk.strip('paint', 0x2b2925, shell, 0.05, BW, 0, { rust: 0.6 });
    for (const z of [-0.45, 0, 0.45]) kk.strip('metal', 0x3a3631, shell.slice(2), 0.03, 0.06, z, { rust: 0.6 });                             // wear strips
    kk.strip('rough', 0x5d4b37, [[1.55, -0.52], [1.1, -0.42], [0.55, -0.25]], 0.18, BW - 0.1, 0, { dirt: 1 });                              // packed dirt
    kk.B('metal', 0x77706a, 1.55, -0.68, -BW / 2, 1.75, -0.6, BW / 2, { rust: 0.4 });                                                       // lip
    const toothS = shapeOf([[0, -0.08], [0.32, -0.03], [0.34, 0.0], [0, 0.07]]);
    for (let i = 0; i < 5; i++) { const z = -0.56 + i * 0.28;
      kk.add('metal', 0x8b857a, extrude(toothS, 0.12, 0.01).rotateZ(-0.95), T(1.68, -0.65, z), { rust: 0.3, dirt: 1 });
      kk.add('metal', 0x5e5850, new THREE.BoxGeometry(0.2, 0.14, 0.16), T(1.66, -0.62, z, 0, 0, -0.95), { rust: 0.5 }); }
    for (const z of [-0.3, 0.3]) kk.ext('paint', 0x2b2925, [[-0.25, -0.12], [0.2, -0.05], [0.25, 0.62], [-0.3, 0.6]], 0.06, z, 0.01, { rust: 0.4 }); // ears
    kk.rod('metal', 0x3a3a38, [-0.2, 0.55, -0.36], [-0.2, 0.55, 0.36], 0.08, 8);
    kk.build(bucket);

    // rams: twin boom rams (up space), stick ram (boom space), bucket ram (stick space)
    const rBoom = ram(up, [0.03, 0.87], 0.12, 1.55, 1.6), rStick = ram(boom, [0], 0.12, 2.9, 2.9), rBkt = ram(stick, [0], 0.1, 1.9, 1.95);
    const BA = [1.62, 0.42], SA = [2.5, 1.5], KA = [-0.05, 0.66], LP = [2.95, 0.32];
    function rig() {
      rBoom.set(BA, rot([2.35, 0.2], boom.rotation.z, [boom.position.x, boom.position.y]));
      rStick.set(SA, rot([-0.82, 0.68], stick.rotation.z, [stick.position.x, stick.position.y]));
      const KB = rot([-0.2, 0.55], bucket.rotation.z, [bucket.position.x, bucket.position.y]);
      rBkt.set(KA, KB);
      link.position.set(LP[0], LP[1], 0); link.rotation.z = Math.atan2(KB[1] - LP[1], KB[0] - LP[0]) - Math.PI / 2; link.scale.y = Math.hypot(KB[0] - LP[0], KB[1] - LP[1]);
    }
    return { g, up, boom, stick, bucket, rig };
  }

  // ============================================================ D6-class high-drive dozer (blade 3.4 m, gauge 1.88 m)
  function dozer() {
    const g = new THREE.Group();
    const k = Kit(0, 0.6);
    for (const s of [-1, 1]) {
      const zc = s * 0.94, wheels = [[1.38, 0.39, 0.33], [-1.5, 0.39, 0.33], [-0.95, 1.08, 0.4]];
      for (let i = 0; i < 6; i++) wheels.push([-1.1 + i * 0.44, 0.16, 0.1]);
      track(k, wheels, zc, { t: 0.055, w: 0.56, p: 0.19, grouser: LOD ? 0.055 : 0, links: !!LOD });
      for (const x of [1.38, -1.5]) { k.rod('metal', 0x47443e, [x, 0.39, zc - 0.12], [x, 0.39, zc + 0.12], 0.3, 16, { dirt: 1, rust: 0.3 }); k.rod('metal', 0x2e2c29, [x, 0.39, zc - 0.18], [x, 0.39, zc + 0.18], 0.1, 10, { dirt: 1 }); }
      sprocket(k, -0.95, 1.08, zc, 0.4, 13, 0.16);
      k.rod('paint', CATd, [-0.95, 1.08, zc - s * 0.1], [-0.95, 1.08, zc - s * 0.38], 0.32, 14, { dirt: 0.9 }); // final drive
      for (let i = 0; i < 6; i++) roller(k, -1.1 + i * 0.44, 0.16, zc, 0.1, 0.34);
      k.ext('paint', CATd, [[-1.35, 0.26], [1.3, 0.26], [1.4, 0.48], [1.1, 0.62], [-0.55, 0.62], [-1.25, 0.5]], 0.36, zc, 0.02, { dirt: 1 }); // roller frame
      // fender + tread plate over the track
      k.B('paint', CAT, 0.1, 1.25, zc - 0.33 * s, 1.55, 1.31, zc + 0.32 * s, { dirt: 0.8 }); k.B('rough', 0x2c2c2a, 0.15, 1.31, zc - 0.26, 1.5, 1.32, zc + 0.26, { dirt: 0.9 });
      k.B('paint', CAT, 1.5, 0.8, zc - 0.28, 1.56, 1.3, zc + 0.28, { dirt: 0.9 });
      // C-frame push arm (outside the track) + trunnion, lift ram (hood side to blade top), tilt brace
      k.bar('paint', CAT, [-0.25, 0.52, s * 1.32], [2.42, 0.5, s * 1.32], 0.22, { dirt: 0.9 }, 0.12);
      k.rod('metal', 0x3a3a38, [-0.25, 0.52, s * 1.22], [-0.25, 0.52, s * 1.42], 0.11, 10);
      k.rod('paint', 0x262624, [1.55, 1.72, s * 0.66], [2.18, 1.28, s * 0.68], 0.09, 10); k.rod('metal', 0xd4d4d1, [2.18, 1.28, s * 0.68], [2.58, 1.0, s * 0.7], 0.05, 8, { dirt: 0.3 });
      k.bar('paint', CATd, [2.2, 0.62, s * 1.1], [2.45, 1.25, s * 0.4], 0.1);
    }
    k.ext('rough', 0x1a1a1a, [[-1.3, 0.38], [1.6, 0.38], [1.6, 1.0], [-1.3, 1.0]], 1.3, 0, 0, { dirt: 1 });
    // engine hood, sloping forward; grille with bars; louvred side panels; exhaust + precleaner
    k.ext('paint', CAT, [[0.15, 0.98], [2.05, 0.98], [2.08, 1.9], [1.95, 1.96], [0.15, 2.12]], 1.24, 0, 0.03);
    k.B('rough', 0x111111, 2.07, 1.02, -0.52, 2.12, 1.86, 0.52, { dirt: 0.6 }); for (let i = 0; i < 7; i++) k.B('paint', CATd, 2.12, 1.06 + i * 0.12, -0.54, 2.15, 1.1 + i * 0.12, 0.54, { dirt: 0.7 });
    for (const z of [-1, 1]) { for (let i = 0; i < 6; i++) k.B('rough', 0x161616, 0.55, 1.25 + i * 0.08, z * 0.645 - 0.008, 1.55, 1.28 + i * 0.08, z * 0.645 + 0.008, { dirt: 0.5 }); }
    k.rod('metal', 0x2a2826, [1.3, 1.95, -0.32], [1.3, 2.7, -0.32], 0.07, 10, { rust: 0.7, dirt: 0.3 }); k.add('metal', 0x2a2826, new THREE.CylinderGeometry(0.095, 0.085, 0.04, 10), T(1.33, 2.72, -0.32, 0, 0, -0.35), { rust: 0.6 });
    k.rod('paint', 0x151515, [0.7, 2.0, 0.34], [0.7, 2.3, 0.34], 0.1, 10); k.rod('glass', 0x5a6670, [0.7, 2.3, 0.34], [0.7, 2.45, 0.34], 0.12, 10);
    // cab: ROPS posts, big glass, door frame, roof, beacon, mirrors, handrails
    { const x0 = -1.55, x1 = 0.22, yb = 1.18, yt = 2.95;
      k.B('paint', CAT, x0, yb, -0.62, x1, 1.82, 0.62); k.B('paint', CAT, x0, 1.7, -0.84, x1, 1.86, 0.84);
      k.ext('glass', GLS, [[x0 + 0.04, 1.82], [x1 - 0.02, 1.82], [x1 - 0.06, yt - 0.02], [x0 + 0.06, yt - 0.02]], 1.6, 0);
      for (const [xa, xb] of [[x0, x0 + 0.03], [x1, x1 - 0.05], [-0.62, -0.62]]) for (const z of [-0.8, 0.8]) k.bar('paint', CAT, [xa, 1.82, z], [xb, yt, z], 0.09);
      k.ext('paint', CAT, [[x0 - 0.08, yt], [x1 + 0.1, yt], [x1 + 0.06, yt + 0.16], [x0 - 0.04, yt + 0.16]], 1.78, 0, 0.02, { dirt: 0.4 });
      k.rod('glow', AMBER, [-1.35, yt + 0.16, 0.62], [-1.35, yt + 0.3, 0.62], 0.065, 10);
      for (const z of [-0.6, 0.6]) k.B('glow', 0xfff1d8, x1 + 0.08, yt + 0.02, z - 0.08, x1 + 0.12, yt + 0.1, z + 0.08);
      for (const z of [-1, 1]) { k.bar('metal', 0x222222, [x1, 2.3, z * 0.82], [x1 + 0.15, 2.55, z * 0.98], 0.03); k.B('glass', 0x6f7f8a, x1 + 0.1, 2.45, z * 0.98 - 0.08, x1 + 0.18, 2.75, z * 0.98 + 0.08);
        k.bar('paint', 0x1d1d1c, [-1.3, 1.9, z * 0.88], [-0.7, 1.9, z * 0.88], 0.035); }
    }
    k.B('paint', CAT, -1.95, 0.98, -0.62, -1.55, 1.85, 0.62); // fuel tank
    // ripper: parallelogram (two link pairs), beam, shank + tip, ram
    k.ext('paint', CATd, [[-1.95, 0.55], [-1.55, 0.55], [-1.55, 1.15], [-1.95, 1.0]], 1.4, 0, 0.02, { dirt: 0.9 });
    for (const z of [-0.45, 0.45]) { k.bar('paint', CATd, [-1.9, 0.62, z], [-2.55, 0.68, z], 0.1, { dirt: 0.9 }, 0.08); k.bar('paint', CATd, [-1.85, 0.98, z], [-2.5, 1.02, z], 0.1, { dirt: 0.9 }, 0.08);
      k.rod('paint', 0x262624, [-1.7, 1.3, z * 0.8], [-2.25, 1.05, z * 0.8], 0.07, 8); k.rod('metal', 0xd4d4d1, [-2.25, 1.05, z * 0.8], [-2.5, 0.9, z * 0.8], 0.04, 8, { dirt: 0.3 }); }
    k.B('paint', CATd, -2.7, 0.6, -0.6, -2.45, 1.08, 0.6, { dirt: 0.9 });
    k.ext('metal', 0x3a3633, [[-2.66, 0.95], [-2.5, 0.95], [-2.52, 0.2], [-2.62, 0.02], [-2.75, 0.04], [-2.7, 0.3]], 0.1, 0, 0, { dirt: 1, rust: 0.6 });
    // blade: curved moldboard (ribbon), back ribs, top spill plate, cutting edge, end bits
    { const n = 9, BW = 3.4, arc = []; for (let i = 0; i <= n; i++) { const a = i / n; arc.push([2.86 - Math.sin(a * Math.PI) * 0.26 - a * 0.06, 0.06 + a * 1.32]); }
      k.strip('paint', CAT, arc, 0.05, BW, 0, { dirt: 0.95, rust: 0.2 });
      for (const z of [-1.3, -0.65, 0, 0.65, 1.3]) k.ext('paint', CATd, [[arc[1][0] + 0.02, 0.15], [2.55, 0.25], [2.5, 1.2], [arc[n - 1][0] + 0.02, 1.3]], 0.05, z, 0, { dirt: 0.9 });
      k.B('paint', CATd, 2.45, 0.3, -1.6, 2.6, 1.3, 1.6, { dirt: 0.8 });
      k.B('paint', CAT, 2.72, 1.36, -BW / 2, 2.86, 1.44, BW / 2, { dirt: 0.8 });
      k.B('metal', 0x8d877c, 2.8, 0.0, -BW / 2 + 0.25, 2.95, 0.16, BW / 2 - 0.25, { dirt: 0.9, rust: 0.35 });
      for (const z of [-1, 1]) { k.B('metal', 0x77716a, 2.78, 0.0, z * (BW / 2 - 0.125) - 0.125, 2.95, 0.22, z * (BW / 2 - 0.125) + 0.125, { dirt: 1, rust: 0.4 });
        k.ext('paint', CAT, [[2.4, 0.15], [2.95, 0.05], [2.85, 1.4], [2.6, 1.35]], 0.06, z * 1.7, 0, { dirt: 0.9 }); }
      k.rod('paint', 0x262624, [1.9, 2.0, 0.3], [2.45, 1.25, 0.9], 0.07, 8); }
    k.build(g);
    return g;
  }

  // ============================================================ rigid haul truck (CAT 770-ish), loaded
  function haulTruck() {
    const g = new THREE.Group();
    const k = Kit(0, 0.6), Y = 0xd99c12;
    for (const z of [-0.55, 0.55]) k.B('paint', 0x1a1a1a, -3.6, 0.9, z - 0.12, 3.9, 1.45, z + 0.12, { dirt: 0.9 });
    // front: bumper deck, radiator, engine hood, full-width upper deck with rails, diagonal access ladder, cab left, lights
    k.B('paint', 0x1d1d1c, 3.6, 1.0, -1.7, 4.15, 1.45, 1.7, { dirt: 0.9 });
    k.B('paint', Y, 2.6, 1.45, -0.9, 4.05, 2.85, 0.9); k.B('rough', 0x101010, 4.05, 1.55, -0.75, 4.1, 2.75, 0.75);
    for (let i = 0; i < 9; i++) k.B('metal', 0x5a5a56, 4.1, 1.62 + i * 0.12, -0.72, 4.13, 1.66 + i * 0.12, 0.72, { dirt: 0.6 });
    k.B('paint', Y, 1.8, 2.85, -2.2, 4.25, 2.95, 2.2, { dirt: 0.7 });
    for (const z of [-2.15, 2.15]) { k.bar('paint', Y, [2.0, 3.85, z], [4.2, 3.85, z], 0.05); for (const x of [2.0, 3.1, 4.2]) k.bar('paint', Y, [x, 2.95, z], [x, 3.87, z], 0.05); }
    k.bar('paint', Y, [4.2, 3.85, -2.15], [4.2, 3.85, 0.6], 0.05);
    for (let i = 0; i < 8; i++) { const t = i / 7; k.B('metal', 0x3a3a38, 4.25 - t * 0.1 - 0.05, 1.0 + t * 1.85, 0.75 + t * 1.2, 4.3 - t * 0.1, 1.03 + t * 1.85, 1.05 + t * 1.2, { dirt: 0.8 }); }
    k.bar('paint', Y, [4.3, 1.2, 0.7], [4.2, 3.2, 1.9], 0.05); k.bar('paint', Y, [4.3, 1.2, 1.1], [4.2, 3.2, 2.3], 0.05);
    { const x0 = 2.1, x1 = 3.7, z0 = -2.05, z1 = -0.7; k.B('paint', Y, x0, 2.95, z0, x1, 3.5, z1); k.ext('glass', GLS, [[x0 + 0.05, 3.5], [x1, 3.5], [x1 - 0.1, 4.45], [x0 + 0.05, 4.45]], z1 - z0 - 0.1, (z0 + z1) / 2);
      for (const [xa, xb] of [[x0, x0], [x1, x1 - 0.1]]) for (const z of [z0 + 0.05, z1 - 0.05]) k.bar('paint', Y, [xa, 3.5, z], [xb, 4.45, z], 0.08);
      k.B('paint', Y, x0 - 0.05, 4.45, z0 - 0.05, x1 + 0.05, 4.6, z1 + 0.05); }
    for (const z of [-1.4, 1.4]) { k.B('glow', 0xfff4dc, 4.16, 2.0, z - 0.2, 4.2, 2.25, z + 0.2); k.B('glow', AMBER, 4.16, 2.4, z - 0.08, 4.2, 2.5, z + 0.08); }
    k.rod('metal', 0x2a2826, [2.4, 2.95, 1.6], [2.4, 4.2, 1.6], 0.09, 10, { rust: 0.7 });
    // dump body: V floor rising to a spill lip, ribbed sides, canopy over the cab, rock ejector bars
    const side = [[-4.4, 2.75], [-3.4, 1.85], [2.05, 1.85], [2.2, 3.9], [4.35, 4.85], [4.35, 5.05], [1.8, 4.6], [-4.4, 3.7]];
    k.ext('paint', Y, side, 0.08, -2.05, 0.02, { dirt: 0.7, rust: 0.2 }); k.ext('paint', Y, side, 0.08, 2.05, 0.02, { dirt: 0.7, rust: 0.2 });
    k.strip('paint', 0xc28a10, [[-4.4, 2.75], [-3.4, 1.85], [2.05, 1.85], [2.2, 3.9], [4.35, 4.85]], 0.08, 4.1, 0, { dirt: 0.8, rust: 0.3 });
    for (const z of [-2.12, 2.12]) { for (const x of [-3.0, -1.6, -0.2, 1.2]) k.B('paint', 0xc28a10, x - 0.07, 1.85 + (x < -3.4 ? 0.5 : 0), z - 0.05, x + 0.07, 3.75, z + 0.05, { dirt: 0.7 });
      k.B('paint', 0xc28a10, -4.4, 3.62, z - 0.09, 1.9, 3.78, z + 0.09, { dirt: 0.6 }); }
    k.rod('paint', 0x1d1d1c, [-2.6, 1.5, -0.6], [-0.9, 1.9, -0.6], 0.14, 10); k.rod('paint', 0x1d1d1c, [-2.6, 1.5, 0.6], [-0.9, 1.9, 0.6], 0.14, 10); // hoist
    // load heap (dirt), lumpy
    { const lg = new THREE.PlaneGeometry(5.6, 3.9, high ? 24 : 12, high ? 14 : 8).rotateX(-Math.PI / 2), lp = lg.attributes.position;
      for (let i = 0; i < lp.count; i++) { const x = lp.getX(i), z = lp.getZ(i), u = x / 2.8, w = z / 1.95; lp.setY(i, 3.4 + 1.0 * Math.max(0, 1 - u * u) * Math.max(0, 1 - w * w) + 0.08 * Math.sin(x * 5 + z * 3) * Math.sin(z * 7 - x * 2) + (rnd() - 0.5) * 0.08); }
      lg.translate(-1.2, 0, 0); k.add('rough', 0x6e5641, lg, null, { dirt: 0.4 }); }
    for (const z of [-1, 1]) { k.B('glow', RED, -4.0, 1.5, z * 1.0 - 0.12, -3.97, 1.62, z * 1.0 + 0.12); k.B('paint', 0x1c1c1c, -3.4, 2.0, z * 1.25, -1.3, 2.08, z * 2.3, { dirt: 0.9 }); }
    // wheels: front singles, rear duals
    for (const z of [-1, 1]) { tyre(k, 2.9, 0.95, z * 1.65, 0.95, 0.62); tyre(k, -1.9, 0.95, z * 1.95, 0.95, 0.62); tyre(k, -1.9, 0.95, z * 1.3, 0.95, 0.62, { lugs: 0 }); }
    k.build(g);
    return g;
  }

  // ============================================================ wheel loader (CAT 950-ish), bucket low
  function loader() {
    const g = new THREE.Group();
    const k = Kit(0, 0.6), Y = CAT;
    k.ext('paint', Y, [[-3.2, 0.9], [-0.2, 0.9], [-0.2, 1.75], [-1.6, 1.8], [-3.0, 1.7], [-3.25, 1.4]], 1.7, 0, 0.04, { dirt: 0.6 });  // rear engine frame + hood
    k.B('rough', 0x111111, -3.27, 1.0, -0.6, -3.22, 1.6, 0.6); for (let i = 0; i < 5; i++) k.B('paint', CATd, -3.3, 1.05 + i * 0.12, -0.62, -3.26, 1.09 + i * 0.12, 0.62);
    k.B('paint', 0x1d1d1c, -3.5, 0.6, -1.15, -3.15, 1.0, 1.15, { dirt: 0.8 });                                                            // counterweight bumper
    k.ext('paint', Y, [[-0.1, 0.8], [1.5, 0.8], [1.6, 1.45], [-0.1, 1.45]], 1.2, 0, 0.03);                                             // front frame
    { const x0 = -1.0, x1 = 0.25, yb = 1.75, yt = 3.25; k.B('paint', Y, x0, 0.9, -0.85, x1, yb, 0.85);
      k.ext('glass', GLS, [[x0 + 0.04, yb], [x1, yb], [x1 + 0.08, yt - 0.03], [x0 + 0.04, yt - 0.03]], 1.6, 0);
      for (const [xa, xb] of [[x0, x0], [x1, x1 + 0.08]]) for (const z of [-0.8, 0.8]) k.bar('paint', 0x1d1d1c, [xa, yb, z], [xb, yt, z], 0.08);
      k.B('paint', Y, x0 - 0.1, yt, -0.9, x1 + 0.2, yt + 0.12, 0.9); k.rod('glow', AMBER, [-0.8, yt + 0.12, -0.6], [-0.8, yt + 0.26, -0.6], 0.06, 8);
      for (const z of [-0.6, 0.6]) k.B('glow', 0xfff1d8, x1 + 0.18, yt - 0.05, z - 0.07, x1 + 0.22, yt + 0.05, z + 0.07); }
    k.rod('metal', 0x2a2826, [-2.4, 1.7, 0.35], [-2.4, 2.4, 0.35], 0.06, 8, { rust: 0.7 });
    for (const z of [-1, 1]) { tyre(k, -1.9, 0.78, z * 1.0, 0.78, 0.55); tyre(k, 1.1, 0.78, z * 1.0, 0.78, 0.55);
      k.B('paint', 0x1d1d1c, -2.6, 1.6, z * 0.75, -1.2, 1.66, z * 1.3, { dirt: 0.9 }); }
    // lift arms, tilt linkage, bucket on the ground
    for (const z of [-0.55, 0.55]) { k.bar('paint', Y, [1.0, 1.9, z], [3.0, 0.75, z], 0.22, {}, 0.12); k.rod('paint', 0x262624, [1.3, 1.0, z * 1.25], [2.3, 1.15, z * 1.25], 0.08, 8); }
    k.bar('paint', Y, [1.3, 2.1, 0], [2.4, 1.5, 0], 0.18, {}, 0.12); k.rod('paint', 0x262624, [0.9, 1.6, 0], [1.6, 2.2, 0], 0.09, 8);
    { const BW = 2.7, sh = [[2.75, 1.25], [2.6, 0.75], [2.7, 0.2], [3.0, 0.05], [3.9, 0.04]]; k.strip('paint', 0x2b2925, sh, 0.05, BW, 0, { dirt: 1, rust: 0.4 });
      for (const z of [-1, 1]) k.ext('paint', 0x2b2925, [[2.75, 1.25], [3.25, 1.2], [3.95, 0.12], [3.9, 0.04], [3.0, 0.05], [2.6, 0.75]], 0.04, z * BW / 2, 0, { dirt: 1, rust: 0.4 });
      k.B('metal', 0x8b857a, 3.85, 0.0, -BW / 2, 4.05, 0.06, BW / 2, { rust: 0.3 }); k.strip('rough', 0x5d4b37, [[2.9, 0.4], [3.3, 0.35], [3.7, 0.2]], 0.3, BW - 0.1, 0, { dirt: 1 }); }
    k.build(g);
    return g;
  }

  // ============================================================ towable light tower: generator trailer, outriggers, 3-stage mast, 4 heads
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.45, 2.2), side: THREE.DoubleSide }); disposables.push(lampMat);
  function tower() {
    const g = new THREE.Group();
    const k = Kit(0, 0.6), Y = 0xe6a614;
    k.extX('paint', Y, [[-0.62, 0.45], [0.62, 0.45], [0.62, 1.5], [0.5, 1.72], [-0.5, 1.72], [-0.62, 1.5]], -1.15, 1.0, 0.02);
    for (const z of [-0.625, 0.625]) { for (let i = 0; i < 6; i++) k.B('rough', 0x1a1a1a, -0.9 + i * 0.08, 0.75, z - 0.006, -0.87 + i * 0.08, 1.35, z + 0.006); k.B('rough', 0x2a2a28, 0.1, 0.6, z - 0.006, 0.12, 1.6, z + 0.006); }
    k.bar('paint', 0x2a2a2a, [1.0, 0.55, 0], [2.3, 0.42, 0], 0.1); k.B('metal', 0x333333, 2.25, 0.25, -0.08, 2.4, 0.45, 0.08); k.rod('metal', 0x333333, [2.0, 0.1, 0], [2.0, 0.5, 0], 0.04, 6);
    for (const s of [-1, 1]) { tyre(k, -0.1, 0.3, s * 0.74, 0.3, 0.18, { lugs: 0 }); k.B('paint', 0x1d1d1d, -0.45, 0.55, s * 0.63, 0.25, 0.6, s * 0.85);
      for (const xx of [-1.0, 0.9]) { k.bar('paint', 0x2a2a2a, [xx, 0.6, s * 0.6], [xx, 0.6, s * 1.6], 0.08); k.bar('paint', 0x2a2a2a, [xx, 0.6, s * 1.58], [xx, 0.08, s * 1.58], 0.07); k.B('metal', 0x333333, xx - 0.12, 0.0, s * 1.58 - 0.12, xx + 0.12, 0.04, s * 1.58 + 0.12); } }
    k.rod('glow', AMBER, [-0.9, 1.72, 0.45], [-0.9, 1.82, 0.45], 0.05, 6);
    k.rod('metal', 0x2a2826, [0.6, 1.72, -0.3], [0.6, 2.0, -0.3], 0.04, 6, { rust: 0.6 });
    // mast: three nested square sections, collars, pivot bracket, winch, coiled cable
    k.B('metal', 0x8a8c8c, -0.75, 1.72, -0.1, -0.55, 4.5, 0.1, { dirt: 0.3 }); k.B('metal', 0x969898, -0.72, 4.5, -0.075, -0.58, 7.2, 0.075, { dirt: 0.2 }); k.B('metal', 0xa2a4a4, -0.7, 7.2, -0.05, -0.6, 9.4, 0.05, { dirt: 0.1 });
    for (const [y, w] of [[4.45, 0.12], [7.15, 0.09]]) k.B('metal', 0x5a5c5c, -0.65 - w, y, -w, -0.65 + w, y + 0.1, w);
    k.B('metal', 0x444444, -0.82, 1.72, -0.16, -0.48, 2.1, 0.16); k.rod('metal', 0x222222, [-0.5, 2.3, 0.14], [-0.5, 2.3, 0.26], 0.09, 10);
    k.rod('rough', 0x111111, [-0.6, 2.35, 0.12], [-0.6, 9.3, 0.07], 0.012, 4);
    // lamp bar + heads (housing, visor) at the D5 head layout so spot positions carry over
    k.B('metal', 0x555555, -0.7, 9.35, -0.85, -0.6, 9.45, 0.85); k.B('metal', 0x555555, -0.7, 9.9, -0.85, -0.6, 10.0, 0.85);
    const heads = [];
    for (const [dy, dz] of [[0, -0.42], [0, 0.42], [0.55, -0.42], [0.55, 0.42]]) {
      const m = T(-0.45, 9.25 + dy, dz, 0, 0, -0.5); heads.push(m);
      k.add('paint', 0x2c2c2c, new THREE.BoxGeometry(0.2, 0.48, 0.38), m.clone(), { dirt: 0.1, h: 0 });
      k.add('paint', 0x222222, new THREE.BoxGeometry(0.16, 0.03, 0.4), m.clone().multiply(T(0.12, 0.26, 0, 0, 0, -0.3)), { dirt: 0.1, h: 0 });
      for (let f = 0; f < 4; f++) k.add('paint', 0x262626, new THREE.BoxGeometry(0.06, 0.42, 0.012), m.clone().multiply(T(-0.12, 0, -0.15 + f * 0.1)), { dirt: 0.1, h: 0 }); // fins
    }
    k.build(g);
    const lg = mergeLens(heads.map(m => new THREE.BoxGeometry(0.04, 0.44, 0.34).translate(0.105, 0, 0).applyMatrix4(m))); disposables.push(lg);
    const head = new THREE.Mesh(lg, lampMat); head.castShadow = false; g.add(head);
    return head;
  }
  function mergeLens(gs) { const ps = gs.map(g => g.toNonIndexed()), n = ps.reduce((s, g) => s + g.attributes.position.count, 0), P = new Float32Array(n * 3), N = new Float32Array(n * 3); let o = 0;
    for (const g of ps) { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); o += g.attributes.position.count; }
    const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); return out; }

  const exA = excavator();
  const dz = dozer();
  const truck = haulTruck();
  const wl = loader();
  const towers = [tower(), tower()];
  return {
    exA, dozer: dz, truck, loader: wl, towers, materials: MAT,
    rig() { exA.rig(); },
    dispose() { for (const g of disposables) g.dispose(); rams.length = 0; },
  };
}
