// machines.js: procedural construction equipment for the Austin lot in site.js, built to read as real kit from a
// high oblique 130-400 m up. Real proportions (CAT 336, tri-axle dump, D6, 4-axle boom pump, tri-axle mixer,
// flat-top tower crane), colour breakup in vertex colours, and one shared "grime" shader that adds height-based
// dust, mottled dirt and rust in object space so it never crawls when a machine moves.
// Everything is merged per material per moving part, so the whole yard is a few dozen draw calls.
// Units are metres; forward of every vehicle is +x, right is +z, up is +y.
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const NOISE = /* glsl */ `
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

export function createMachines({ THREE, group, D = 4 }) {
  const V3 = THREE.Vector3, Q = THREE.Quaternion;
  let seed = 1337;
  const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  let TRIS = 0;

  // ------------------------------------------------------------ materials
  const env = (() => { // equirect sky for glass + steel: blue zenith, bright hazy horizon, warm dirt below
    const c = document.createElement('canvas'); c.width = 256; c.height = 128; const x = c.getContext('2d');
    const gr = x.createLinearGradient(0, 0, 0, 128);
    gr.addColorStop(0, '#3d6db5'); gr.addColorStop(0.3, '#7aa2d6'); gr.addColorStop(0.47, '#dfe8ef'); gr.addColorStop(0.5, '#f4f2ea');
    gr.addColorStop(0.52, '#8c7e69'); gr.addColorStop(1, '#3b332a'); x.fillStyle = gr; x.fillRect(0, 0, 256, 128);
    for (let i = 0; i < 24; i++) { const cx = rnd() * 256, cy = 18 + rnd() * 38, r = 6 + rnd() * 16, g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, 'rgba(255,255,255,0.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(cx - r, cy - r, 2 * r, 2 * r); }
    const t = new THREE.CanvasTexture(c); t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  const dustC = new THREE.Color(0xa58f70), rustC = new THREE.Color(0x6a3418);
  const grime = (m, key) => {
    m.onBeforeCompile = sh => {
      sh.uniforms.uDust = { value: dustC }; sh.uniforms.uRust = { value: rustC };
      sh.vertexShader = 'attribute vec3 aG; varying vec3 vMG, vMObj, vMN;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        '#include <begin_vertex>\nvMG = aG; vMN = normal; vMObj = position * vec3(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz), length(modelMatrix[2].xyz));');
      sh.fragmentShader = 'uniform vec3 uDust, uRust; varying vec3 vMG, vMObj, vMN;\n' + NOISE + sh.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\n' + GRIME)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + mDust*.4 + mRust*.3 + mGr*.1, 0., 1.);')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor *= 1. - max(mDust, mRust);');
    };
    m.customProgramCacheKey = () => 'tfmach-' + key; return m;
  };
  const S = o => new THREE.MeshStandardMaterial({ vertexColors: true, ...o });
  const MAT = {
    paint: grime(S({ roughness: 0.46, metalness: 0, envMap: env, envMapIntensity: 0.35 }), 'paint'),
    rough: grime(S({ roughness: 0.93, metalness: 0 }), 'rough'),
    metal: grime(S({ roughness: 0.34, metalness: 0.85, envMap: env, envMapIntensity: 1 }), 'metal'),
    glass: S({ roughness: 0.06, metalness: 0.82, envMap: env, envMapIntensity: 1.25 }),
    glow: new THREE.MeshBasicMaterial({ vertexColors: true }),
  };

  // ------------------------------------------------------------ geometry kit: collect parts per material, bake colour + grime data, merge
  const T = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(new V3(x, y, z), new Q().setFromEuler(new THREE.Euler(rx, ry, rz)), typeof s === 'number' ? new V3(s, s, s) : new V3(...s));
  const tc = new THREE.Color(), YA = new V3(0, 1, 0);
  const Kit = (h0 = 0, dirt0 = 0.5) => {
    const L = {};
    const k = {
      add(kind, color, geo, m, o = {}) {
        const g = geo.index ? geo.toNonIndexed() : geo.clone(); if (m) g.applyMatrix4(m);
        for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal') g.deleteAttribute(a);
        const p = g.attributes.position, n = p.count, cA = new Float32Array(n * 3), gA = new Float32Array(n * 3);
        const base = new THREE.Color(color), j = 1 + (rnd() - 0.5) * 2 * (o.jit ?? 0.035), h = o.h ?? h0, dirt = o.dirt ?? dirt0, rust = o.rust ?? 0;
        for (let i = 0; i < n; i += 3) {
          let c = base;
          if (o.cf) { const r = o.cf((p.getX(i) + p.getX(i + 1) + p.getX(i + 2)) / 3, (p.getY(i) + p.getY(i + 1) + p.getY(i + 2)) / 3, (p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2)) / 3); c = r.isColor ? r : tc.set(r); }
          for (let v = i; v < i + 3; v++) {
            let cc = c; if (o.vf) { const r = o.vf(p.getX(v), p.getY(v), p.getZ(v)); cc = r.isColor ? r : tc.set(r); }
            cA[v * 3] = cc.r * j; cA[v * 3 + 1] = cc.g * j; cA[v * 3 + 2] = cc.b * j;
            gA[v * 3] = p.getY(v) + h; gA[v * 3 + 1] = dirt; gA[v * 3 + 2] = rust;
          }
        }
        g.setAttribute('color', new THREE.BufferAttribute(cA, 3)); g.setAttribute('aG', new THREE.BufferAttribute(gA, 3));
        (L[kind] ||= []).push(g); return k;
      },
      B(kind, color, x0, y0, z0, x1, y1, z1, o) { return k.add(kind, color, new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)), T((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), o); },
      // cylinder between two points
      rod(kind, color, a, b, r, seg = 8, o, r2) {
        const A = new V3(...a), Bv = new V3(...b), d = Bv.clone().sub(A), len = d.length();
        const m = new THREE.Matrix4().compose(A.clone().add(Bv).multiplyScalar(0.5), new Q().setFromUnitVectors(YA, d.normalize()), new V3(1, 1, 1));
        return k.add(kind, color, new THREE.CylinderGeometry(r2 ?? r, r, len, seg), m, o);
      },
      // square bar between two points
      bar(kind, color, a, b, t, o) {
        const A = new V3(...a), Bv = new V3(...b), d = Bv.clone().sub(A), len = d.length();
        const m = new THREE.Matrix4().compose(A.clone().add(Bv).multiplyScalar(0.5), new Q().setFromUnitVectors(YA, d.normalize()), new V3(1, 1, 1));
        return k.add(kind, color, new THREE.BoxGeometry(t, len, t), m, o);
      },
      geo(kind) { const g = mergeGeometries(L[kind]); TRIS += g.attributes.position.count / 3; return g; },
      build(parent) {
        const out = {};
        for (const kind in L) {
          const mesh = new THREE.Mesh(k.geo(kind), MAT[kind]);
          mesh.castShadow = kind !== 'glow'; mesh.receiveShadow = true; parent.add(mesh); out[kind] = mesh;
        }
        return out;
      },
    };
    return k;
  };
  const shapeOf = pts => new THREE.Shape(pts.map(p => new THREE.Vector2(p[0], p[1])));
  const extrude = (shape, depth, bevel = 0, curve = 6) => new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: curve }).translate(0, 0, -depth / 2);
  const stadium = (len, r) => { const s = new THREE.Shape(), a = len / 2 - r; s.moveTo(-a, 0); s.lineTo(a, 0); s.absarc(a, r, r, -Math.PI / 2, Math.PI / 2, false); s.lineTo(-a, 2 * r); s.absarc(-a, r, r, Math.PI / 2, Math.PI * 1.5, false); return s; };
  const wheel = (k, x, y, z, r, w, rim = 0x8a8984, o = {}) => { // tyre + rim, axis along z, rim faces outward
    const s = Math.sign(z) || 1;
    k.rod('rough', 0x161514, [x, y, z - w / 2], [x, y, z + w / 2], r, 16, { dirt: 1, h: 0, ...o });
    k.rod('metal', rim, [x, y, z + s * (w / 2 - 0.02)], [x, y, z + s * (w / 2 + 0.012)], r * 0.6, 12, { dirt: 0.9, h: 0, rust: 0.3 });
    k.rod('metal', 0x3a3936, [x, y, z + s * (w / 2)], [x, y, z + s * (w / 2 + 0.05)], r * 0.22, 8, { dirt: 0.9, h: 0 });
  };

  // palette
  const CAT = 0xe2a50f, CATd = 0xc98f0c, BLK = 0x1d1d1c, DKG = 0x2b2b29, STEEL = 0x77746e, CHROME = 0xd2d2cf, GLS = 0x4a5a66, AMBER = 0xffa21a, RED = 0xff2a14;

  // ------------------------------------------------------------ CAT 336 excavator (11 m shipping length, 2.6 m gauge, 3.5 m tail swing)
  const excavator = () => {
    const g = new THREE.Group(); group.add(g);
    const ku = Kit(0, 1);
    for (const s of [-1, 1]) {
      const zc = s * 1.3;
      ku.add('rough', 0x232120, extrude(stadium(4.86, 0.49), 0.6, 0, 7), T(0, 0, zc), { dirt: 1, rust: 0.15 });
      for (let i = 0; i < 18; i++) { const x = -1.94 + i * 0.228; ku.B('rough', 0x3d3935, x - 0.035, 0.975, zc - 0.3, x + 0.035, 1.035, zc + 0.3, { dirt: 0.9, rust: 0.4 }); }
      for (const x of [-1.95, 1.95]) ku.rod('metal', 0x4b4843, [x, 0.49, zc + s * 0.29], [x, 0.49, zc + s * 0.34], 0.36, 12, { dirt: 1, rust: 0.4 });
      ku.B('rough', 0x2a2826, -1.5, 0.28, zc - s * 0.34, 1.5, 0.72, zc - s * 0.29, { dirt: 1 }); // inner track frame face
    }
    ku.B('rough', BLK, -1.15, 0.45, -1.0, 1.15, 1.0, 1.0, { dirt: 0.95 });
    ku.rod('metal', 0x2d2c2a, [0, 0.98, 0], [0, 1.1, 0], 1.02, 18, { dirt: 0.8 });
    ku.build(g);

    const up = new THREE.Group(); up.position.y = 1.1; g.add(up);
    const k = Kit(1.1, 0.55);
    k.B('rough', 0x222221, -2.45, 0, -1.49, 1.55, 0.26, 1.49, { dirt: 0.8 });
    // counterweight: black, rounded to the 3.45 m tail swing radius
    { const R = 3.45, pts = [[-2.42, -1.49]]; for (let i = 0; i <= 10; i++) { const z = -1.49 + i * 0.298; pts.push([-Math.sqrt(R * R - z * z), z]); } pts.push([-2.42, 1.49]);
      k.add('paint', 0x1b1b1a, extrude(shapeOf(pts), 1.12, 0.05).rotateX(-Math.PI / 2).translate(0, 0.25, 0), null, { dirt: 0.55, rust: 0.12 }); }
    // engine hood and pump compartment
    k.B('paint', CAT, -2.42, 0.26, -1.49, -0.36, 1.24, 1.49, { dirt: 0.5, rust: 0.05 });
    k.B('rough', 0x121212, -2.2, 1.24, 0.08, -1.2, 1.265, 1.32, { dirt: 0.4 }); // radiator grille
    k.B('rough', 0x121212, -1.05, 1.24, -1.32, -0.55, 1.265, -0.6, { dirt: 0.4 });
    for (let i = 0; i < 6; i++) k.B('paint', CATd, -2.2 + i * 0.18, 1.265, 0.1, -2.2 + i * 0.18 + 0.03, 1.275, 1.3); // grille slats
    k.rod('metal', 0x2a2826, [-1.7, 1.2, 0.6], [-1.7, 1.78, 0.6], 0.075, 8, { rust: 0.7, dirt: 0.3 }); // exhaust stack
    k.rod('paint', 0x151515, [-0.78, 1.2, 1.18], [-0.78, 1.55, 1.18], 0.11, 8);
    // handrails along both hood edges
    for (const z of [1.43, -1.43]) { const x0 = -2.3, x1 = z > 0 ? -0.45 : -0.55;
      k.bar('paint', CAT, [x0, 1.72, z], [x1, 1.72, z], 0.045);
      for (const x of [x0, (x0 + x1) / 2, x1]) k.bar('paint', CAT, [x, 1.24, z], [x, 1.74, z], 0.045); }
    // right front: tool box / fuel tank, anti-slip top, rail
    k.B('paint', CAT, -0.36, 0.26, 0.86, 1.55, 1.1, 1.49);
    k.B('rough', 0x30302e, -0.3, 1.1, 0.9, 1.5, 1.118, 1.45, { dirt: 0.8 });
    k.bar('paint', CAT, [-0.3, 1.58, 1.46], [1.5, 1.58, 1.46], 0.04); k.bar('paint', CAT, [1.5, 1.1, 1.46], [1.5, 1.6, 1.46], 0.04); k.bar('paint', CAT, [0.6, 1.1, 1.46], [0.6, 1.6, 1.46], 0.04);
    // boom foot bracket
    k.B('paint', CAT, 0.25, 0.26, 0.06, 1.55, 1.3, 0.18); k.B('paint', CAT, 0.25, 0.26, 0.72, 1.55, 1.3, 0.84);
    k.B('rough', 0x232323, 0.15, 0.26, 0.18, 1.55, 0.62, 0.72);
    // cab (left front): black frame, big glass, skylight, beacon
    k.B('paint', 0x1e1e1d, -0.36, 0.26, -1.49, 1.5, 0.86, -0.52, { dirt: 0.6 });
    k.B('glass', GLS, -0.33, 0.86, -1.47, 1.47, 1.96, -0.54);
    for (const x of [-0.31, 0.62, 1.45]) for (const z of [-1.445, -0.565]) k.B('paint', 0x1e1e1d, x - 0.045, 0.86, z - 0.045, x + 0.045, 1.96, z + 0.045);
    k.B('paint', 0x2c2c2a, -0.4, 1.96, -1.52, 1.53, 2.07, -0.49, { dirt: 0.35 });
    k.B('glass', GLS, 0.2, 2.07, -1.3, 1.25, 2.085, -0.71);
    k.rod('glow', AMBER, [-0.22, 2.07, -0.66], [-0.22, 2.21, -0.66], 0.07, 8);
    // mirrors on stalks
    k.bar('metal', 0x222222, [1.45, 1.1, 1.47], [1.62, 1.85, 1.62], 0.03); k.B('glass', 0x6f7f8a, 1.57, 1.72, 1.52, 1.64, 2.02, 1.78);
    k.bar('metal', 0x222222, [1.48, 1.4, -1.5], [1.66, 1.95, -1.64], 0.03); k.B('glass', 0x6f7f8a, 1.6, 1.85, -1.75, 1.67, 2.12, -1.52);
    k.build(up);

    // boom: banana profile, pivot at (1.1, 1.0, 0.45) in up space, tip pin at (6.4, 0, 0)
    const boom = new THREE.Group(); boom.position.set(1.1, 1.0, 0.45); up.add(boom);
    const kb = Kit(2.1, 0.45);
    kb.add('paint', CAT, extrude(shapeOf([[-0.42, -0.3], [-0.42, 0.28], [0.6, 0.64], [2.9, 1.4], [5.6, 0.52], [6.62, 0.26], [6.62, -0.26], [5.6, -0.2], [2.9, 0.56], [0.6, -0.24]]), 0.6, 0.035), null, { rust: 0.05 });
    kb.rod('metal', 0x3a3a38, [6.4, 0, -0.42], [6.4, 0, 0.42], 0.13, 10); kb.rod('metal', 0x3a3a38, [0, 0, -0.4], [0, 0, 0.4], 0.16, 10);
    for (const s of [-1, 1]) { // twin boom cylinders
      kb.rod('paint', 0x2a2a28, [0.12, -0.78, s * 0.42], [1.7, -0.07, s * 0.42], 0.12, 10);
      kb.rod('metal', CHROME, [1.7, -0.07, s * 0.42], [2.6, 0.4, s * 0.42], 0.065, 8, { dirt: 0.2 });
    }
    kb.rod('paint', 0x2a2a28, [2.4, 1.48, 0], [5.1, 1.07, 0], 0.12, 10); // stick cylinder
    kb.rod('metal', CHROME, [5.1, 1.07, 0], [6.8, 0.8, 0], 0.07, 8, { dirt: 0.2 });
    kb.B('paint', CAT, 2.25, 1.2, -0.16, 2.6, 1.6, 0.16);
    kb.bar('rough', 0x111111, [0.7, 0.72, 0.2], [2.8, 1.47, 0.2], 0.05); kb.bar('rough', 0x111111, [2.8, 1.47, 0.2], [6.0, 0.48, 0.2], 0.05); // hydraulic lines
    kb.build(boom);

    // stick (3.2 m) and bucket
    const stick = new THREE.Group(); stick.position.set(6.4, 0, 0); boom.add(stick);
    const ks = Kit(1.2, 0.8);
    ks.add('paint', CAT, extrude(shapeOf([[-0.88, 0.14], [-0.88, 0.56], [-0.2, 0.5], [3.32, 0.2], [3.32, -0.2], [0, -0.38]]), 0.46, 0.02), null, { rust: 0.1 });
    ks.rod('paint', 0x2a2a28, [-0.05, 0.64, 0], [1.75, 0.53, 0], 0.1, 10); ks.rod('metal', CHROME, [1.75, 0.53, 0], [2.85, 0.46, 0], 0.06, 8, { dirt: 0.3 });
    ks.B('rough', 0x2a2826, 2.75, 0.18, -0.22, 3.3, 0.52, 0.22, { rust: 0.4 });
    ks.rod('metal', 0x3a3a38, [3.2, 0, -0.32], [3.2, 0, 0.32], 0.1, 8, { rust: 0.4 });
    ks.build(stick);
    const bucket = new THREE.Group(); bucket.position.set(3.2, 0, 0); stick.add(bucket);
    const kk = Kit(0.9, 0.9);
    kk.add('paint', 0x2b2925, extrude(shapeOf([[-0.15, 0.25], [0.45, 0.42], [1.05, 0.3], [1.48, 0.0], [1.7, -0.45], [1.62, -0.62], [1.2, -0.55], [0.55, -0.34], [0.05, -0.1]]), 1.4, 0.02), null, { rust: 0.55 });
    kk.B('rough', 0x6a5640, 0.5, -0.4, -0.66, 1.5, -0.3, 0.66, { dirt: 1 }); // packed dirt in the mouth
    for (let i = 0; i < 5; i++) { const z = -0.56 + i * 0.28; kk.bar('metal', 0x8b857a, [1.62, -0.6, z], [1.84, -0.82, z], 0.1, { rust: 0.3 }); }
    kk.build(bucket);
    return { g, up, boom, stick, bucket };
  };

  // ------------------------------------------------------------ tri-axle dump truck (9.6 m), forward +x
  const TRUCK = [
    { cab: 0xe8e6e1, bed: 0x80868b, load: 0x6e5641 }, { cab: 0x8a1d18, bed: 0xb38a22, load: 0xa08b6c },
    { cab: 0x1d3557, bed: 0x2c2e31, load: 0x7a6248 }, { cab: 0xe8e6e1, bed: 0x93332a, load: 0x8f7a5c },
  ];
  const truck = i => {
    const P = TRUCK[i], g = new THREE.Group(); group.add(g);
    const k = Kit(0, 0.55);
    // chassis
    for (const z of [-0.45, 0.45]) k.B('rough', 0x161616, -4.65, 0.72, z - 0.06, 4.7, 1.0, z + 0.06, { dirt: 0.9 });
    k.B('metal', 0x1a1a1a, 4.7, 0.55, -1.24, 4.95, 0.95, 1.24, { dirt: 0.8 }); // bumper
    // hood (tapered) + grille + fenders
    k.add('paint', P.cab, extrude(shapeOf([[3.0, 1.0], [4.75, 1.0], [4.75, 1.92], [3.0, 2.12]]), 1.12, 0.04), null);
    k.B('metal', 0x2a2a2a, 4.74, 1.0, -0.52, 4.8, 1.9, 0.52); for (let j = 0; j < 7; j++) k.B('metal', 0xbcbcb8, 4.8, 1.05 + j * 0.12, -0.5, 4.82, 1.09 + j * 0.12, 0.5, { dirt: 0.3 });
    for (const z of [-1, 1]) { k.B('paint', 0x1d1d1c, 2.75, 1.0, z * 0.62, 4.15, 1.12, z * 1.26, { dirt: 0.8 }); k.B('glow', 0xfff4dc, 4.76, 1.2, z * 0.62 - 0.12, 4.78, 1.35, z * 0.62 + 0.12); }
    // cab
    k.B('paint', P.cab, 1.65, 1.0, -1.15, 3.02, 3.05, 1.15);
    k.B('glass', GLS, 3.0, 2.2, -1.0, 3.05, 2.85, 1.0); for (const z of [-1, 1]) k.B('glass', GLS, 1.95, 2.2, z * 1.15 - 0.03, 2.85, 2.85, z * 1.15 + 0.03);
    k.B('paint', P.cab, 1.6, 3.05, -1.12, 2.98, 3.12, 1.12); k.B('paint', 0x262626, 2.85, 2.86, -1.05, 3.12, 2.92, 1.05); // roof, visor
    for (let j = 0; j < 5; j++) k.B('glow', AMBER, 3.04, 2.93, -0.6 + j * 0.3 - 0.04, 3.1, 2.98, -0.6 + j * 0.3 + 0.04);
    for (const z of [-1, 1]) { // mirrors, stacks, fuel tanks, steps
      k.bar('metal', 0x333333, [2.95, 2.0, z * 1.15], [3.1, 2.4, z * 1.4], 0.03); k.B('glass', 0x6f7f8a, 3.0, 2.2, z * 1.38 - 0.05, 3.12, 2.65, z * 1.38 + 0.05);
      k.rod('metal', CHROME, [1.5, 1.1, z * 0.98], [1.5, 3.55, z * 0.98], 0.085, 10, { dirt: 0.15 });
      k.rod('metal', 0xb9bcbd, [1.4, 0.78, z * 0.95], [2.55, 0.78, z * 0.95], 0.31, 14, { dirt: 0.5 });
      k.B('metal', 0x5e5e5c, 2.6, 0.4, z * 0.98 - 0.15, 3.0, 1.0, z * 0.98 + 0.15);
    }
    // dump body: worn outside, filthy inside
    const x0 = -4.72, x1 = 1.45, y0 = 1.22, y1 = 2.72, W = 1.22, OUT = { rust: 0.6, dirt: 0.75 }, IN = 0x584a3b;
    k.B('rough', 0x1a1a1a, x0 + 0.2, 1.0, -0.55, x1, y0, 0.55, { dirt: 0.9 }); // subframe + hoist
    k.B('paint', P.bed, x0, y0, -W, x1, y0 + 0.1, W, OUT);
    k.B('rough', IN, x0 + 0.1, y0 + 0.1, -W + 0.08, x1 - 0.1, y0 + 0.13, W - 0.08, { dirt: 1, rust: 0.8 });
    for (const z of [-1, 1]) {
      k.B('paint', P.bed, x0, y0, z * W - 0.04, x1, y1, z * W + 0.04, OUT);
      k.B('rough', IN, x0 + 0.1, y0 + 0.1, z * (W - 0.06) - 0.02, x1 - 0.1, y1 - 0.05, z * (W - 0.06) + 0.02, { dirt: 1, rust: 0.8, h: -0.6 });
      k.B('paint', P.bed, x0, y1 - 0.02, z * W - 0.09, x1, y1 + 0.12, z * W + 0.09, OUT); // top rail
      for (let j = 0; j < 6; j++) { const x = x0 + 0.5 + j * 1.0; k.B('paint', P.bed, x - 0.05, y0 - 0.1, z * W - (z > 0 ? 0 : 0.08), x + 0.05, y1, z * W + (z > 0 ? 0.08 : 0), OUT); }
    }
    k.B('paint', P.bed, x1 - 0.08, y0, -W, x1, 3.05, W, OUT); k.B('rough', IN, x1 - 0.12, y0 + 0.1, -W + 0.08, x1 - 0.08, 2.95, W - 0.08, { dirt: 1, rust: 0.7, h: -0.6 });
    k.B('paint', P.bed, x1, 2.95, -W, 2.1, 3.04, W, OUT); // cab protector
    k.rod('rough', 0x1e2a1e, [x1 - 0.2, 3.02, -W], [x1 - 0.2, 3.02, W], 0.1, 8); // tarp roll
    k.B('paint', P.bed, x0 - 0.1, y0, -W - 0.05, x0, y1 + 0.18, W + 0.05, OUT); // tailgate
    k.B('rough', IN, x0, y0 + 0.1, -W + 0.08, x0 + 0.03, y1, W - 0.08, { dirt: 1, rust: 0.8, h: -0.6 });
    for (const z of [-1, 1]) { k.B('glow', RED, x0 - 0.12, 1.05, z * 1.0 - 0.1, x0 - 0.1, 1.15, z * 1.0 + 0.1); k.B('rough', 0x101010, -4.4, 0.25, z * 0.95 - 0.35, -4.36, 0.95, z * 0.95 + 0.35, { dirt: 1 }); } // tail lights, mud flaps
    // fenders over the tandem
    for (const z of [-1, 1]) k.B('paint', 0x1c1c1c, -4.3, 1.08, z * 0.62, -1.75, 1.15, z * 1.28, { dirt: 0.9 });
    // wheels: steer, lifted pusher, tandem duals
    for (const z of [-1, 1]) {
      wheel(k, 3.55, 0.53, z * 1.06, 0.53, 0.3);
      wheel(k, -0.6, 0.66, z * 1.0, 0.5, 0.28);
      for (const x of [-2.4, -3.75]) { wheel(k, x, 0.53, z * 1.1, 0.53, 0.28); k.rod('rough', 0x161514, [x, 0.53, z * 0.68], [x, 0.53, z * 0.94], 0.53, 16, { dirt: 1, h: 0 }); }
    }
    k.build(g);
    // load: heaped dirt, rough clods, top lighter where it dried
    const kl = Kit(0, 1), lg = new THREE.PlaneGeometry(5.9, 2.3, 22, 9).rotateX(-Math.PI / 2), lp = lg.attributes.position, cl = new THREE.Color(P.load), cd = cl.clone().multiplyScalar(0.62), tmp = new THREE.Color();
    const hgt = (x, z) => { const u = (x - (x0 + x1) / 2) / 2.95, w = z / 1.15, hump = Math.max(0, 1 - u * u * 0.85) * Math.max(0, 1 - w * w * 0.9); return 1.42 + 0.95 * hump + (Math.sin(x * 7.1 + z * 3.3) * Math.sin(z * 9.7 - x * 2.1)) * 0.07 + (rnd() - 0.5) * 0.06; };
    for (let j = 0; j < lp.count; j++) lp.setY(j, hgt(lp.getX(j) + (x0 + x1) / 2, lp.getZ(j)));
    lg.translate((x0 + x1) / 2, 0, 0); lg.computeVertexNormals();
    kl.add('rough', P.load, lg, null, { dirt: 0.25, cf: (x, y, z) => tmp.copy(cd).lerp(cl, Math.min(1, Math.max(0, (y - 1.5) / 0.9)) * (0.75 + rnd() * 0.25)) });
    for (let j = 0; j < 9; j++) { const x = x0 + 0.8 + rnd() * 4.6, z = (rnd() - 0.5) * 1.8; kl.add('rough', P.load, new THREE.IcosahedronGeometry(0.12 + rnd() * 0.12, 0), T(x, hgt(x, z), z, rnd(), rnd(), rnd()), { dirt: 0.3 }); }
    const lm = kl.build(g).rough;
    return { g, load: lm };
  };

  // ------------------------------------------------------------ CAT D6 dozer (5.3 m with blade, 3.4 m blade, 1.88 m gauge)
  const makeDozer = () => {
    const g = new THREE.Group(); group.add(g);
    const k = Kit(0, 0.6);
    for (const s of [-1, 1]) {
      const zc = s * 0.94;
      k.add('rough', 0x22201e, extrude(stadium(3.35, 0.45), 0.56, 0, 7), T(-0.2, 0, zc), { dirt: 1, rust: 0.15 });
      for (let i = 0; i < 12; i++) { const x = -1.42 + i * 0.22; k.B('rough', 0x3d3935, x - 0.035, 0.885, zc - 0.28, x + 0.035, 0.945, zc + 0.28, { dirt: 0.9, rust: 0.4 }); }
      k.rod('metal', 0x47443f, [-1.45, 0.62, zc + s * 0.27], [-1.45, 0.62, zc + s * 0.33], 0.42, 12, { dirt: 1, rust: 0.4 }); // sprocket
      k.B('paint', CAT, -1.75, 1.0, zc - 0.33 * s, 1.55, 1.07, zc + 0.3 * s, { dirt: 0.8 }); // fender
      k.B('rough', 0x2c2c2a, -1.6, 1.07, zc - 0.25, 1.4, 1.08, zc + 0.25, { dirt: 0.9 });
      k.bar('paint', CAT, [-0.15, 0.48, s * 1.28], [2.55, 0.42, s * 1.28], 0.2, { dirt: 0.9 }); // push arm
      k.rod('paint', CATd, [1.55, 1.65, s * 0.58], [2.15, 1.25, s * 0.6], 0.1, 8); k.rod('metal', CHROME, [2.15, 1.25, s * 0.6], [2.58, 0.98, s * 0.62], 0.055, 8, { dirt: 0.3 }); // lift cylinders
    }
    k.B('rough', 0x1a1a1a, -1.3, 0.35, -0.65, 1.6, 1.0, 0.65, { dirt: 1 });
    // engine hood and grille
    k.add('paint', CAT, extrude(shapeOf([[0.15, 0.95], [2.05, 0.95], [2.05, 1.95], [0.15, 2.12]]), 1.24, 0.03), null);
    k.B('rough', 0x111111, 2.06, 1.0, -0.5, 2.1, 1.9, 0.5, { dirt: 0.6 });
    for (const z of [-1, 1]) k.B('rough', 0x161616, 0.5, 1.25, z * 0.63 - 0.02, 1.6, 1.8, z * 0.63 + 0.02, { dirt: 0.5 });
    k.rod('metal', 0x2a2826, [1.25, 1.95, -0.32], [1.25, 2.62, -0.32], 0.07, 8, { rust: 0.7, dirt: 0.3 });
    k.rod('paint', 0x151515, [0.6, 2.0, 0.34], [0.6, 2.35, 0.34], 0.1, 8);
    // cab with ROPS
    k.B('paint', CAT, -1.55, 1.07, -0.82, 0.22, 1.85, 0.82);
    k.B('glass', GLS, -1.5, 1.85, -0.78, 0.18, 2.94, 0.78);
    for (const x of [-1.52, 0.18]) for (const z of [-0.79, 0.79]) k.B('paint', CAT, x - 0.05, 1.85, z - 0.05, x + 0.05, 2.95, z + 0.05);
    k.B('paint', CAT, -1.62, 2.94, -0.88, 0.3, 3.1, 0.88, { dirt: 0.4 });
    k.rod('glow', AMBER, [-1.35, 3.1, 0.62], [-1.35, 3.24, 0.62], 0.065, 8);
    for (const z of [-1, 1]) { k.bar('metal', 0x222222, [0.2, 2.3, z * 0.82], [0.35, 2.55, z * 0.98], 0.03); k.B('glass', 0x6f7f8a, 0.3, 2.45, z * 0.98 - 0.08, 0.38, 2.75, z * 0.98 + 0.08); }
    k.B('paint', CAT, -1.9, 1.0, -0.62, -1.55, 1.85, 0.62); // fuel tank
    // ripper
    k.B('paint', CATd, -2.45, 0.75, -0.75, -2.15, 1.0, 0.75, { dirt: 0.9 }); k.bar('paint', CATd, [-1.9, 0.6, 0], [-2.3, 0.85, 0], 0.18, { dirt: 0.9 });
    k.bar('metal', 0x3a3633, [-2.3, 0.85, 0], [-2.38, 0.05, 0], 0.12, { dirt: 1, rust: 0.6 });
    // blade: curved moldboard, worn cutting edge, end bits
    { const pts = [], n = 8; for (let i = 0; i <= n; i++) { const a = i / n, y = 0.05 + a * 1.3; pts.push([2.85 - Math.sin(a * Math.PI) * 0.28 - a * 0.05, y]); }
      for (let i = n; i >= 0; i--) { const [x, y] = pts[i]; pts.push([x - 0.12, y]); }
      k.add('paint', CAT, extrude(shapeOf(pts), 3.4, 0.02), null, { dirt: 0.95, rust: 0.2 }); }
    k.B('metal', 0x8d877c, 2.75, 0.02, -1.72, 2.92, 0.18, 1.72, { dirt: 0.9, rust: 0.35 });
    for (const z of [-1, 1]) k.B('paint', CATd, 2.45, 0.25, z * 1.7 - 0.06, 2.75, 1.25, z * 1.7 + 0.06, { dirt: 0.9 });
    k.build(g);
    return g;
  };

  // ------------------------------------------------------------ 4-axle boom pump (Putzmeister-ish 38 m), turret at the origin
  const makePump = () => {
    const g = new THREE.Group(); group.add(g);
    const k = Kit(0, 0.55), WH = 0xe9e7e2, PG = 0xd5d7d4;
    for (const z of [-0.45, 0.45]) k.B('rough', 0x161616, -6.0, 0.72, z - 0.07, 6.2, 1.02, z + 0.07, { dirt: 0.9 });
    // cab-over cab
    k.B('paint', WH, 4.15, 1.0, -1.24, 6.3, 3.3, 1.24);
    k.B('glass', GLS, 6.28, 2.15, -1.1, 6.34, 3.05, 1.1); for (const z of [-1, 1]) k.B('glass', GLS, 5.2, 2.15, z * 1.24 - 0.03, 6.15, 2.95, z * 1.24 + 0.03);
    k.B('metal', 0x2a2a2a, 6.3, 0.55, -1.24, 6.5, 1.0, 1.24); k.B('paint', 0x2a2a2a, 6.29, 1.1, -0.9, 6.33, 1.9, 0.9);
    for (let j = 0; j < 4; j++) k.B('glow', AMBER, 6.2, 3.3, -0.45 + j * 0.3 - 0.05, 6.3, 3.36, -0.45 + j * 0.3 + 0.05);
    for (const z of [-1, 1]) { k.bar('metal', 0x333333, [6.25, 2.3, z * 1.24], [6.45, 2.5, z * 1.45], 0.03); k.B('glass', 0x6f7f8a, 6.38, 2.25, z * 1.45 - 0.05, 6.5, 2.75, z * 1.45 + 0.05); }
    // turret pedestal + slew gear
    k.B('paint', PG, -1.1, 1.02, -1.2, 1.1, 2.0, 1.2, { dirt: 0.5 });
    k.rod('paint', PG, [0, 2.0, 0], [0, 2.9, 0], 0.62, 16); k.rod('metal', 0x555555, [0, 2.9, 0], [0, 3.05, 0], 0.68, 18);
    k.B('paint', PG, -0.55, 3.0, -0.5, 0.55, 3.45, 0.5);
    // pump unit, water tank, pipe racks, hopper
    k.B('paint', WH, -4.9, 1.02, -1.15, -1.25, 2.15, 1.15, { dirt: 0.55 });
    k.B('rough', 0x2f2f2f, -4.7, 2.15, -0.9, -1.5, 2.18, 0.9, { dirt: 0.8 });
    for (const z of [-1, 1]) for (let j = 0; j < 3; j++) k.rod('metal', 0x60605c, [-4.9, 1.4 + j * 0.16, z * 1.2], [0.9, 1.4 + j * 0.16, z * 1.2], 0.065, 8, { rust: 0.5 });
    k.add('paint', 0x9e9b94, extrude(shapeOf([[-6.2, 0.85], [-5.0, 0.85], [-4.9, 1.85], [-6.35, 1.85]]), 1.9, 0.03), null, { dirt: 0.9 });
    k.B('rough', 0x6a6762, -6.2, 1.85, -0.8, -5.0, 1.88, 0.8, { dirt: 0.6 }); // wet concrete in the hopper
    k.B('metal', 0x666660, -6.0, 1.88, -0.85, -5.05, 1.92, 0.85, { rust: 0.4 }); // grate
    // outriggers deployed on cribbing: front X-legs swing forward, rear swing out
    for (const z of [-1, 1]) {
      for (const [a, b] of [[[1.3, 1.45, z * 0.9], [3.9, 1.0, z * 4.3]], [[-3.1, 1.35, z * 0.9], [-4.3, 1.0, z * 4.4]]]) {
        k.bar('paint', WH, a, b, 0.32, { dirt: 0.5 });
        const L = Math.hypot(b[0] - a[0], b[2] - a[2]), dx = (b[0] - a[0]) / L, dz = (b[2] - a[2]) / L;
        for (let j = 0; j < 4; j++) { const t = 0.55 + j * 0.1; k.bar('paint', j % 2 ? WH : 0xc41f16, [a[0] + dx * L * t, a[1] + (b[1] - a[1]) * t + 0.17, a[2] + dz * L * t], [a[0] + dx * L * (t + 0.1), a[1] + (b[1] - a[1]) * (t + 0.1) + 0.17, a[2] + dz * L * (t + 0.1)], 0.04); }
        k.rod('paint', PG, [b[0], 1.05, b[2]], [b[0], 0.45, b[2]], 0.13, 8); k.rod('metal', CHROME, [b[0], 0.45, b[2]], [b[0], 0.32, b[2]], 0.08, 8);
        k.B('metal', 0x3a3a38, b[0] - 0.35, 0.29, b[2] - 0.35, b[0] + 0.35, 0.33, b[2] + 0.35, { dirt: 1 });
        for (let c = 0; c < 2; c++) for (let j = 0; j < 4; j++) { const o = (j - 1.5) * 0.24; c ? k.B('rough', 0x9a7a52, b[0] - 0.5, 0.15, b[2] + o - 0.1, b[0] + 0.5, 0.29, b[2] + o + 0.1, { dirt: 0.9 }) : k.B('rough', 0x8a6c48, b[0] + o - 0.1, 0, b[2] - 0.5, b[0] + o + 0.1, 0.15, b[2] + 0.5, { dirt: 1 }); }
      }
    }
    for (const z of [-1, 1]) {
      for (const x of [4.75, 3.25]) wheel(k, x, 0.53, z * 1.06, 0.53, 0.3);
      for (const x of [-2.9, -4.25]) { wheel(k, x, 0.53, z * 1.1, 0.53, 0.28); k.rod('rough', 0x161514, [x, 0.53, z * 0.68], [x, 0.53, z * 0.94], 0.53, 16, { dirt: 1, h: 0 }); }
      k.B('paint', 0x1c1c1c, -4.85, 1.08, z * 0.62, -2.3, 1.14, z * 1.28, { dirt: 0.9 });
      k.B('glow', RED, -6.08, 1.05, z * 1.0 - 0.1, -6.04, 1.15, z * 1.0 + 0.1);
    }
    k.build(g);
    // boom segments: unit length along +x, centred. site.js stretches x to the segment length
    const seg = (h0, h1, w0, w1, joints, tipElbow) => {
      const kk = Kit(14, 0.25), N = 6;
      for (let i = 0; i < N; i++) { const a = i / N, b = (i + 1) / N, h = h0 + (h1 - h0) * (a + b) / 2, w = w0 + (w1 - w0) * (a + b) / 2;
        kk.B('paint', 0xe4e3de, -0.5 + a, -h / 2, -w / 2, -0.5 + b, h / 2, w / 2); }
      kk.rod('paint', 0x2a2a2a, [-0.5, h0 / 2 + 0.09, w0 / 2 - 0.02], [0.5, h1 / 2 + 0.09, w1 / 2 - 0.02], 0.075, 8, { dirt: 0.6 }); // delivery line
      for (let j = 0; j < 8; j++) { const x = -0.45 + j * 0.125, h = h0 + (h1 - h0) * (x + 0.5); kk.B('paint', 0x3a3a3a, x - 0.004, -h / 2, -0.02, x + 0.004, h / 2 + 0.17, w0 / 2 + 0.05); }
      kk.rod('paint', 0x8f918d, [-0.47, -h0 / 2 - 0.12, 0], [-0.05, -h0 / 2 - 0.08, 0], 0.11, 8); kk.rod('metal', CHROME, [-0.05, -h0 / 2 - 0.08, 0], [0.2, -h0 / 2 - 0.02, 0], 0.06, 8);
      for (const x of joints) { const h = h0 + (h1 - h0) * (x + 0.5); kk.B('paint', 0x5b5d5a, x - 0.016, -h / 2 - 0.12, -w0 / 2 - 0.06, x + 0.016, h / 2 + 0.12, w0 / 2 + 0.06); }
      if (tipElbow) kk.B('paint', 0x2a2a2a, 0.47, -h1 / 2 - 0.2, -0.15, 0.5, h1 / 2, 0.15);
      const m = new THREE.Mesh(kk.geo('paint'), MAT.paint); m.castShadow = m.receiveShadow = true; group.add(m); return m;
    };
    const s1 = seg(0.78, 0.62, 0.52, 0.46, [-0.49, 0.49], false);
    const s2 = seg(0.6, 0.32, 0.44, 0.28, [-0.49, -0.16, 0.18], true);
    const kh = Kit(5, 0.6); kh.rod('rough', 0x121212, [-0.5, 0, 0], [0.5, 0, 0], 0.085, 8);
    const hose = new THREE.Mesh(kh.geo('rough'), MAT.rough); hose.castShadow = hose.receiveShadow = true; group.add(hose);
    return { g, s1, s2, hose };
  };

  // ------------------------------------------------------------ tri-axle drum mixer (10 m)
  const MIX = [{ cab: 0xe8e6e1, a: 0xe8e6e1, b: 0xb3261e }, { cab: 0xd7d3c6, a: 0xdedbd2, b: 0x1d4d8c }];
  const mixer = i => {
    const P = MIX[i], g = new THREE.Group(); group.add(g);
    const k = Kit(0, 0.55);
    for (const z of [-0.45, 0.45]) k.B('rough', 0x161616, -4.8, 0.72, z - 0.07, 4.85, 1.0, z + 0.07, { dirt: 0.9 });
    k.B('metal', 0x1a1a1a, 4.85, 0.55, -1.24, 5.05, 0.95, 1.24);
    k.add('paint', P.cab, extrude(shapeOf([[3.4, 1.0], [4.88, 1.0], [4.88, 1.9], [3.4, 2.1]]), 1.1, 0.04), null);
    k.B('metal', 0xbcbcb8, 4.88, 1.05, -0.5, 4.92, 1.85, 0.5, { dirt: 0.3 });
    k.B('paint', P.cab, 2.0, 1.0, -1.15, 3.42, 3.0, 1.15); k.B('paint', P.cab, 1.95, 3.0, -1.12, 3.4, 3.08, 1.12);
    k.B('glass', GLS, 3.4, 2.15, -1.0, 3.45, 2.8, 1.0); for (const z of [-1, 1]) k.B('glass', GLS, 2.3, 2.15, z * 1.15 - 0.03, 3.25, 2.8, z * 1.15 + 0.03);
    for (let j = 0; j < 5; j++) k.B('glow', AMBER, 3.38, 3.08, -0.6 + j * 0.3 - 0.04, 3.44, 3.13, -0.6 + j * 0.3 + 0.04);
    for (const z of [-1, 1]) {
      k.B('paint', 0x1d1d1c, 3.05, 1.0, z * 0.6, 4.35, 1.12, z * 1.26, { dirt: 0.8 });
      k.bar('metal', 0x333333, [3.35, 2.0, z * 1.15], [3.5, 2.4, z * 1.4], 0.03); k.B('glass', 0x6f7f8a, 3.4, 2.2, z * 1.38 - 0.05, 3.52, 2.65, z * 1.38 + 0.05);
      k.rod('metal', 0xb9bcbd, [1.75, 0.78, z * 0.95], [2.85, 0.78, z * 0.95], 0.3, 14, { dirt: 0.5 });
    }
    k.rod('metal', CHROME, [1.85, 1.1, 0.95], [1.85, 3.5, 0.95], 0.085, 10, { dirt: 0.15 });
    k.rod('paint', 0xdedcd6, [1.6, 1.05, -0.35], [1.6, 2.4, -0.35], 0.42, 14); // water tank
    // drum pedestals, rear stand, hopper, chute, ladder
    k.B('paint', 0x8c8e8b, 0.95, 1.0, -0.5, 1.25, 2.25, 0.5, { dirt: 0.7 });
    for (const z of [-0.75, 0.75]) k.bar('paint', 0x8c8e8b, [-3.65, 1.0, z], [-3.75, 2.75, z * 0.9], 0.16, { dirt: 0.8 });
    k.B('paint', 0x8c8e8b, -3.85, 2.6, -0.8, -3.6, 2.78, 0.8, { dirt: 0.8 });
    k.add('paint', 0x8e8b84, new THREE.CylinderGeometry(0.55, 0.28, 0.6, 10, 1, true), T(-4.05, 3.55, 0, 0, 0, 0.3), { dirt: 0.9, rust: 0.3 }); // charge hopper
    k.add('paint', 0x7f7c75, new THREE.BoxGeometry(1.3, 0.12, 0.45), T(-4.45, 2.35, 0, 0, 0, 0.55), { dirt: 1, rust: 0.4 }); // discharge chute
    for (const z of [0.35, 0.75]) k.add('paint', 0x7f7c75, new THREE.BoxGeometry(1.4, 0.12, 0.36), T(-4.6, 1.75, z, 0, 0, 1.1), { dirt: 1, rust: 0.4 }); // stowed chutes
    for (const z of [-0.85, -0.45]) k.bar('metal', 0x666660, [-4.85, 0.9, z], [-4.35, 3.9, z], 0.04);
    for (let j = 0; j < 7; j++) { const t = j / 6; k.bar('metal', 0x666660, [-4.85 + t * 0.5, 0.9 + t * 3.0, -0.85], [-4.85 + t * 0.5, 0.9 + t * 3.0, -0.45], 0.03); }
    for (const z of [-1, 1]) {
      wheel(k, 4.15, 0.53, z * 1.06, 0.53, 0.3);
      for (const x of [0.6, -0.4]) wheel(k, x, 0.53, z * 1.04, 0.5, 0.28);
      for (const x of [-2.55, -3.9]) { wheel(k, x, 0.53, z * 1.1, 0.53, 0.28); k.rod('rough', 0x161514, [x, 0.53, z * 0.68], [x, 0.53, z * 0.94], 0.53, 16, { dirt: 1, h: 0 }); }
      k.B('paint', 0x1c1c1c, -4.5, 1.08, z * 0.62, -1.95, 1.14, z * 1.28, { dirt: 0.9 });
      k.B('glow', RED, -4.85, 1.05, z * 1.0 - 0.1, -4.82, 1.15, z * 1.0 + 0.1);
    }
    k.build(g);
    // drum: lathe with a two-start helix painted on it so the spin reads; tilted rear-up inside a fixed group
    const tilt = new THREE.Group(); tilt.position.set(-1.25, 2.62, 0); tilt.rotation.z = -0.2; g.add(tilt);
    const d = new THREE.Group(); tilt.add(d);
    const kd = Kit(2.6, 0.45), prof = [[0.0, 2.5], [0.45, 2.48], [0.62, 2.3], [1.14, 1.25], [1.2, 0.9], [1.2, -0.25], [1.15, -0.6], [0.72, -1.95], [0.46, -2.42], [0.0, -2.44]], pts = [];
    for (let i = 0; i < prof.length - 1; i++) { const n = i === 0 || i === prof.length - 2 ? 1 : 5; for (let j = 0; j < n; j++) { const t = j / n; pts.push(new THREE.Vector2(prof[i][0] + (prof[i + 1][0] - prof[i][0]) * t, prof[i][1] + (prof[i + 1][1] - prof[i][1]) * t)); } }
    pts.push(new THREE.Vector2(...prof[prof.length - 1]));
    const lathe = new THREE.LatheGeometry(pts.reverse(), 56).rotateZ(-Math.PI / 2); // profile must run -y to +y for outward faces
    const ca = new THREE.Color(P.a), cb = new THREE.Color(P.b), cm = new THREE.Color();
    kd.add('paint', P.a, lathe, null, { vf: (x, y, z) => { const a = Math.atan2(z, y) / (Math.PI * 2), s = ((a * 2 + x * 0.32) % 1 + 1) % 1, e = Math.min(1, Math.max(0, (Math.min(s, 0.32 - s) + 0.02) / 0.04)); return cm.copy(ca).lerp(cb, s < 0.34 ? e : 0); }, rust: 0.05, jit: 0 });
    kd.add('rough', 0x8d8a83, new THREE.CylinderGeometry(0.47, 0.47, 0.05, 20).rotateZ(Math.PI / 2), T(-2.43, 0, 0), { dirt: 1 }); // crusted mouth
    kd.rod('metal', 0x55534f, [-0.52, 0, 0], [-0.4, 0, 0], 1.2, 32, { rust: 0.4 }); // roller ring
    for (let j = 0; j < 6; j++) { const a = j / 6 * Math.PI * 2; kd.bar('rough', 0x9b978f, [-2.0, Math.cos(a) * 0.86, Math.sin(a) * 0.86], [-1.2, Math.cos(a + 0.5) * 1.17, Math.sin(a + 0.5) * 1.17], 0.08, { dirt: 1 }); } // concrete drips
    kd.build(d);
    return { g, d };
  };

  // ------------------------------------------------------------ flat-top tower crane: lattice mast (shader), strut jib 52 m, counter-jib 15 m
  const makeCrane = () => {
    const g = new THREE.Group(); g.position.set(-4, -D, 4); group.add(g);
    const CY = 0xe8ae12;
    const kf = Kit(0, 0.8); kf.B('rough', 0x9b968c, -3, -0.4, -3, 3, 0.04, 3, { dirt: 0.8 }); for (const x of [-0.8, 0.8]) for (const z of [-0.8, 0.8]) kf.B('metal', 0x555552, x - 0.2, 0.04, z - 0.2, x + 0.2, 0.12, z + 0.2, { rust: 0.6 }); kf.build(g);
    // mast: 1 m tall unit (chords + panels), scaled on y by site.js. Panels draw their lattice from metres = local y * scale
    const km = Kit(12, 0.15); const HW = 0.8;
    for (const x of [-HW, HW]) for (const z of [-HW, HW]) km.B('paint', CY, x - 0.08, 0, z - 0.08, x + 0.08, 1, z + 0.08);
    const mast = new THREE.Mesh(km.geo('paint'), MAT.paint); mast.castShadow = mast.receiveShadow = true; g.add(mast);
    {
      const pos = [], nor = [], au = [], quad = (pa, pb, pc, pd, n, ua, ub) => { for (const [p, u] of [[pa, ua], [pb, ub], [pc, ub], [pa, ua], [pc, ub], [pd, ua]]) { pos.push(...p); nor.push(...n); au.push(u); } };
      quad([-HW, 0, HW], [HW, 0, HW], [HW, 1, HW], [-HW, 1, HW], [0, 0, 1], -HW, HW);
      quad([HW, 0, -HW], [-HW, 0, -HW], [-HW, 1, -HW], [HW, 1, -HW], [0, 0, -1], HW, -HW);
      quad([HW, 0, HW], [HW, 0, -HW], [HW, 1, -HW], [HW, 1, HW], [1, 0, 0], HW, -HW);
      quad([-HW, 0, -HW], [-HW, 0, HW], [-HW, 1, HW], [-HW, 1, -HW], [-1, 0, 0], -HW, HW);
      const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); pg.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); pg.setAttribute('aU', new THREE.Float32BufferAttribute(au, 1));
      TRIS += 8;
      const LAT = `float tfLat(vec2 q){ float Hb=1.9, W=${(2 * HW).toFixed(2)}; float y=mod(q.y,Hb), k=floor(q.y/Hb), s=mod(k,2.)<1.?1.:-1.;
        float ud=s*(-W*.5+W*y/Hb), dd=abs(q.x-ud)*Hb/length(vec2(W,Hb)), dh=min(y,Hb-y); float hw=max(.05, fwidth(q.y)*.6); return min(dd,dh)-hw; }`;
      const vs = sh => { sh.vertexShader = 'attribute float aU; varying vec2 vLat;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvLat = vec2(aU, position.y * length(modelMatrix[1].xyz));');
        sh.fragmentShader = 'varying vec2 vLat;\n' + LAT + '\n' + sh.fragmentShader.replace('void main() {', 'void main() {\n if (tfLat(vLat) > 0.) discard;'); };
      const pm = new THREE.MeshStandardMaterial({ color: CY, roughness: 0.5, side: THREE.DoubleSide }); pm.onBeforeCompile = vs; pm.customProgramCacheKey = () => 'tfmach-lat';
      const dm = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide }); dm.onBeforeCompile = vs; dm.customProgramCacheKey = () => 'tfmach-latd';
      const panels = new THREE.Mesh(pg, pm); panels.customDepthMaterial = dm; panels.castShadow = panels.receiveShadow = true; mast.add(panels);
    }
    const top = new THREE.Group(); g.add(top);
    const k = Kit(40, 0.12);
    k.rod('metal', 0x333333, [0, 0, 0], [0, 0.45, 0], 1.15, 20);
    k.B('paint', CY, -1.2, 0.45, -1.2, 1.2, 1.05, 1.2);
    // cab on the right side, glass front
    k.B('paint', 0xe9e8e3, 0.1, 0.3, -2.45, 2.2, 2.3, -1.25); k.B('glass', GLS, 2.2, 0.6, -2.38, 2.25, 2.1, -1.32); k.B('glass', GLS, 0.4, 0.6, -2.47, 2.0, 2.0, -2.43);
    // jib: triangular warren lattice, bottom chords z=+-0.75 at y=1.05, apex at y=2.65
    const J0 = 1.2, J1 = 53.4, yb = 1.05, yt = 2.65, zw = 0.75, bay = 2.05;
    for (const z of [-zw, zw]) k.B('paint', CY, J0, yb - 0.09, z - 0.09, J1, yb + 0.09, z + 0.09);
    k.B('paint', CY, J0, yt - 0.08, -0.08, J1 - 0.6, yt + 0.08, 0.08);
    const nb = Math.round((J1 - J0) / bay);
    for (let i = 0; i < nb; i++) {
      const xa = J0 + i * bay, xb = xa + bay, xm = xa + bay / 2;
      for (const z of [-zw, zw]) { k.bar('paint', CY, [xa, yb, z], [xm, yt, 0], 0.07); k.bar('paint', CY, [xm, yt, 0], [xb, yb, z], 0.07); }
      k.bar('paint', CY, [xa, yb, -zw], [xm, yb, zw], 0.06); k.bar('paint', CY, [xm, yb, zw], [xb, yb, -zw], 0.06);
    }
    k.B('paint', CY, J1 - 0.1, yb - 0.1, -zw - 0.1, J1 + 0.1, yb + 0.5, zw + 0.1); // tip frame
    k.B('glow', RED, J1 + 0.1, yb + 0.5, -0.08, J1 + 0.25, yb + 0.65, 0.08);
    // counter-jib: twin girders, walkway, winch, ballast slabs
    const C0 = -1.2, C1 = -15.2;
    for (const z of [-0.95, 0.95]) { k.B('paint', CY, C1, yb - 0.25, z - 0.12, C0, yb + 0.25, z + 0.12); k.bar('paint', CY, [C1 + 0.4, yb + 1.1, z], [C0, yb + 1.1, z], 0.04); for (let x = C1 + 0.4; x < C0; x += 2.5) k.bar('paint', CY, [x, yb + 0.25, z], [x, yb + 1.12, z], 0.04); }
    for (let x = C1 + 0.5; x < C0; x += 2) k.B('paint', CY, x - 0.08, yb - 0.15, -0.95, x + 0.08, yb + 0.1, 0.95);
    k.B('rough', 0x59605a, C1 + 0.4, yb + 0.25, -0.8, C0 - 0.2, yb + 0.29, 0.8, { dirt: 0.4 });
    k.B('paint', 0x5d6266, -7.8, yb + 0.29, -0.7, -5.6, yb + 1.3, 0.7, { dirt: 0.3 }); k.rod('metal', 0x8a8a86, [-6.7, yb + 0.8, -0.72], [-6.7, yb + 0.8, 0.72], 0.4, 14); // hoist winch
    k.B('paint', 0xdedcd5, -4.6, yb + 0.29, -0.6, -3.6, yb + 1.5, 0.6); // electrics
    for (let j = 0; j < 4; j++) { const x = C1 + 0.6 + j * 0.62; k.B('rough', 0xaaa59b, x - 0.27, yb - 2.6, -1.25, x + 0.27, yb + 0.25, 1.25, { dirt: 0.3, h: 30 }); }
    k.build(top);
    const trolley = new THREE.Group(); trolley.position.y = yb; top.add(trolley);
    const kt = Kit(40, 0.2);
    kt.B('paint', CY, -0.7, -0.35, -0.95, 0.7, -0.1, 0.95); for (const x of [-0.45, 0.45]) kt.rod('metal', 0x444444, [x, -0.6, -0.2], [x, -0.6, 0.2], 0.22, 10);
    kt.build(trolley); trolley.position.x = 20;
    const kln = Kit(20, 0); for (const x of [-0.12, 0.12]) kln.B('metal', 0x2d2d2d, x - 0.016, -0.5, -0.016, x + 0.016, 0.5, 0.016);
    const line = new THREE.Mesh(kln.geo('metal'), MAT.metal); line.castShadow = true; line.receiveShadow = true; trolley.add(line);
    const hook = new THREE.Group(); trolley.add(hook);
    const kh = Kit(10, 0.2);
    kh.B('paint', 0xf2b40f, -0.32, -0.45, -0.18, 0.32, 0.3, 0.18); for (let j = 0; j < 3; j++) kh.B('paint', 0x151515, -0.33, -0.4 + j * 0.25, -0.19, 0.33, -0.3 + j * 0.25, 0.19);
    kh.add('metal', 0x2e2e2e, new THREE.TorusGeometry(0.17, 0.05, 6, 10, Math.PI * 1.5), T(0, -0.7, 0, 0, 0, Math.PI * 0.25));
    kh.build(hook);
    line.scale.y = 10; line.position.y = -0.8 - 5; hook.position.y = -1.2 - 10;
    return { g, mast, top, trolley, line, hook };
  };

  // ------------------------------------------------------------ crew: 44 instances, hi-vis vest = instance colour, the rest from a per-instance hash
  const makeCrew = () => {
    const NW = 44, parts = [];
    const add = (geo, m, part) => { const g = (geo.index ? geo.toNonIndexed() : geo); if (m) g.applyMatrix4(m); for (const a of Object.keys(g.attributes)) if (a !== 'position' && a !== 'normal') g.deleteAttribute(a); g.setAttribute('aPart', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count).fill(part), 1)); parts.push(g); };
    const bx = (x0, y0, z0, x1, y1, z1, p, rz = 0) => add(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), T((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, 0, 0, rz), p);
    for (const s of [-1, 1]) { bx(-0.1, 0, s * 0.1 - 0.06, 0.17, 0.1, s * 0.1 + 0.06, 0); bx(-0.08, 0.1, s * 0.1 - 0.075, 0.08, 0.86, s * 0.1 + 0.075, 1); bx(-0.06, 0.86, s * 0.27 - 0.055, 0.06, 1.42, s * 0.27 + 0.055, 2, s * 0.08); }
    bx(-0.12, 0.84, -0.21, 0.12, 1.43, 0.21, 2); bx(-0.135, 0.9, -0.225, 0.135, 1.44, 0.225, 3);
    bx(-0.09, 1.44, -0.08, 0.1, 1.64, 0.08, 4);
    add(new THREE.SphereGeometry(0.135, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2), T(0.005, 1.615, 0), 5);
    add(new THREE.CylinderGeometry(0.16, 0.16, 0.025, 8), T(0.03, 1.61, 0), 5);
    const geo = mergeGeometries(parts); TRIS += (geo.attributes.position.count / 3) * NW;
    const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 });
    mat.onBeforeCompile = sh => {
      sh.vertexShader = 'attribute float aPart; varying float vVest;\n' + sh.vertexShader.replace('#include <color_vertex>', `
        float ih = fract(sin(float(gl_InstanceID) * 12.9898 + 1.7) * 43758.5453), ih2 = fract(ih * 91.7 + .3), ih3 = fract(ih * 53.1 + .7);
        vec3 c; vVest = 0.;
        if (aPart < .5) c = vec3(.045, .03, .02);
        else if (aPart < 1.5) c = ih2 < .5 ? vec3(.05, .07, .13) : ih2 < .8 ? vec3(.26, .2, .12) : vec3(.04);
        else if (aPart < 2.5) c = ih3 < .35 ? vec3(.45) : ih3 < .65 ? vec3(.06, .1, .22) : ih3 < .85 ? vec3(.7, .3, .03) : vec3(.6, .8, .05);
        else if (aPart < 3.5) { c = instanceColor; vVest = 1.; }
        else if (aPart < 4.5) c = mix(vec3(.55, .34, .22), vec3(.16, .09, .05), ih2);
        else c = ih < .55 ? vec3(.92, .92, .9) : ih < .8 ? vec3(.95, .72, .02) : ih < .92 ? vec3(1., .3, .02) : vec3(.04, .18, .55);
        vColor = c;`);
      sh.fragmentShader = 'varying float vVest;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor * vVest * .3;');
    };
    mat.customProgramCacheKey = () => 'tfmach-crew';
    const crew = new THREE.InstancedMesh(geo, mat, NW);
    const vest = [0xff5a00, 0xc8ff1a, 0xff7a00, 0xd6ff2a];
    const m = new THREE.Matrix4();
    for (let i = 0; i < NW; i++) { crew.setColorAt(i, new THREE.Color(vest[i % 4])); crew.setMatrixAt(i, m.makeTranslation((i % 11) * 2 - 10, 0, Math.floor(i / 11) * 2)); }
    crew.castShadow = crew.receiveShadow = true; group.add(crew);
    return crew;
  };

  // ------------------------------------------------------------ light towers: towable generator, telescoping mast, 4 heads aimed at the lot
  const lampMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 2.45, 2.2), side: THREE.DoubleSide });
  const tower = (x, z) => {
    const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = Math.atan2(-(0 - z), 0 - x); group.add(g); // +x faces the lot centre
    const k = Kit(0, 0.6);
    k.add('paint', 0xe6a614, extrude(shapeOf([[-1.1, 0.45], [1.0, 0.45], [1.0, 1.55], [0.75, 1.75], [-1.1, 1.75]]), 1.3, 0.03), null);
    k.B('rough', 0x1a1a1a, -0.6, 1.2, -0.66, 0.4, 1.6, -0.64); k.B('rough', 0x1a1a1a, -0.6, 1.2, 0.64, 0.4, 1.6, 0.66);
    k.bar('paint', 0x2a2a2a, [1.0, 0.55, 0], [2.3, 0.4, 0], 0.1); k.B('metal', 0x333333, 2.25, 0.25, -0.08, 2.4, 0.45, 0.08);
    for (const s of [-1, 1]) { wheel(k, -0.1, 0.3, s * 0.78, 0.3, 0.18); for (const xx of [-1.0, 0.9]) { k.bar('paint', 0x2a2a2a, [xx, 0.6, s * 0.6], [xx, 0.6, s * 1.5], 0.08); k.bar('paint', 0x2a2a2a, [xx, 0.6, s * 1.5], [xx, 0.05, s * 1.5], 0.07); } }
    k.rod('glow', AMBER, [-0.9, 1.75, 0.5], [-0.9, 1.85, 0.5], 0.05, 6);
    k.B('metal', 0x9a9c9c, -0.75, 1.75, -0.1, -0.55, 4.5, 0.1, { dirt: 0.3 }); k.B('metal', 0xa6a8a8, -0.72, 4.5, -0.075, -0.58, 7.2, 0.075, { dirt: 0.2 }); k.B('metal', 0xb2b4b4, -0.7, 7.2, -0.05, -0.6, 9.4, 0.05, { dirt: 0.1 });
    k.B('metal', 0x555555, -0.7, 9.35, -0.85, -0.6, 9.45, 0.85);
    const kl = Kit(9, 0), heads = [];
    for (const [dy, dz] of [[0, -0.42], [0, 0.42], [0.55, -0.42], [0.55, 0.42]]) {
      const m = T(-0.45, 9.25 + dy, dz, 0, 0, -0.5);
      kl.add('paint', 0x2c2c2c, new THREE.BoxGeometry(0.22, 0.48, 0.38), m); heads.push(m);
    }
    kl.build(g); k.build(g);
    const lg = mergeGeometries(heads.map(m => new THREE.BoxGeometry(0.05, 0.5, 0.4).translate(0.11, 0, 0).applyMatrix4(m))); TRIS += lg.attributes.position.count / 3;
    const head = new THREE.Mesh(lg, lampMat); head.castShadow = false; g.add(head);
    return head;
  };

  // ------------------------------------------------------------ static furniture: office trailer, toilets, dumpster, rebar, form stock
  const furniture = () => {
    const k = Kit(0, 0.45);
    { // 60x12 ft office trailer at (52,-45), doors + stairs facing the lot (+z)
      const X = 52, Z = -45, L = 18.3, W = 3.66;
      k.B('rough', 0x55565a, X - L / 2 + 0.1, 0, Z - W / 2 + 0.05, X + L / 2 - 0.1, 0.62, Z + W / 2 - 0.05, { dirt: 0.9 });
      k.B('paint', 0xd9d5c8, X - L / 2, 0.62, Z - W / 2, X + L / 2, 3.3, Z + W / 2, { dirt: 0.6, rust: 0.05 });
      for (let i = 0; i < 15; i++) { const x = X - L / 2 + 0.6 + i * 1.22; k.B('paint', 0xe6e3da, x - 0.6, 3.3, Z - W / 2 - 0.06, x + 0.58, 3.4, Z + W / 2 + 0.06, { dirt: 0.35, jit: 0.06 }); k.B('paint', 0xc4c1b8, x + 0.58, 3.31, Z - W / 2, x + 0.61, 3.415, Z + W / 2, { dirt: 0.3 }); }
      for (const s of [-1, 1]) for (let i = 0; i < 6; i++) { const x = X - L / 2 + 1.6 + i * 3.0; k.B('paint', 0xf2f2ef, x - 0.68, 1.62, Z + s * W / 2 - 0.04, x + 0.68, 2.62, Z + s * W / 2 + 0.04); k.B('glass', GLS, x - 0.6, 1.7, Z + s * W / 2 - 0.06, x + 0.6, 2.55, Z + s * W / 2 + 0.06); }
      for (const dx of [-4.2, 5.4]) {
        const x = X + dx; k.B('paint', 0xb8b4aa, x - 0.48, 0.65, Z + W / 2, x + 0.48, 2.7, Z + W / 2 + 0.05);
        k.B('rough', 0x9c7d55, x - 0.9, 0.55, Z + W / 2 + 0.05, x + 0.9, 0.62, Z + W / 2 + 1.55, { dirt: 0.9 });
        for (let j = 0; j < 3; j++) k.B('rough', 0x9c7d55, x - 0.5, 0.14 + j * 0.15, Z + W / 2 + 1.55 + (2 - j) * 0.28, x + 0.5, 0.18 + j * 0.15, Z + W / 2 + 1.85 + (2 - j) * 0.28, { dirt: 0.9 });
        for (const s of [-1, 1]) k.bar('metal', 0x8a8a86, [x + s * 0.88, 1.6, Z + W / 2 + 0.1], [x + s * 0.88, 1.6, Z + W / 2 + 1.5], 0.04);
      }
      for (const s of [-1, 1]) k.B('paint', 0xcfc9b8, X + s * (L / 2 + 0.25), 1.6, Z - 0.5, X + s * (L / 2 + 0.01), 2.5, Z + 0.4); // wall AC units
      k.add('metal', 0x2a2a2a, extrude(shapeOf([[0, -0.9], [1.6, 0], [0, 0.9]]), 0.12, 0), T(X + L / 2, 0.45, Z, -Math.PI / 2, 0, 0)); // hitch
    }
    // porta-johns
    [0x1f4f9c, 0x1f4f9c, 0x2f6b40].forEach((c, i) => {
      const x = 66 + i * 1.5, z = -46;
      k.B('paint', c, x - 0.56, 0.05, z - 0.58, x + 0.56, 2.22, z + 0.58, { dirt: 0.55 }); k.B('rough', 0x1d1d1d, x - 0.6, 0, z - 0.62, x + 0.6, 0.08, z + 0.62);
      k.add('paint', 0xdedfd8, new THREE.CylinderGeometry(0.5, 0.78, 0.22, 4, 1).rotateY(Math.PI / 4), T(x, 2.32, z), { dirt: 0.4 });
      k.rod('rough', 0x161616, [x - 0.4, 2.0, z - 0.4], [x - 0.4, 2.6, z - 0.4], 0.04, 6);
      k.B('paint', 0xd5d5cf, x - 0.4, 0.15, z + 0.58, x + 0.4, 2.0, z + 0.6);
    });
    { // 30 yd roll-off dumpster at (62,44) with debris
      const X = 62, Z = 44, L = 6.2, W = 2.4, H = 1.75, DC = 0x3a5873, O = { rust: 0.85, dirt: 0.7 };
      k.B('paint', DC, X - L / 2, 0.15, Z - W / 2, X + L / 2, 0.3, Z + W / 2, O);
      for (const s of [-1, 1]) { k.B('paint', DC, X - L / 2, 0.15, Z + s * W / 2 - 0.05, X + L / 2, H, Z + s * W / 2 + 0.05, O); k.B('paint', DC, X + s * L / 2 - 0.05, 0.15, Z - W / 2, X + s * L / 2 + 0.05, H, Z + W / 2, O);
        k.B('paint', DC, X - L / 2, H - 0.06, Z + s * W / 2 - 0.1, X + L / 2, H + 0.06, Z + s * W / 2 + 0.1, O);
        for (let i = 0; i < 7; i++) { const x = X - L / 2 + 0.4 + i * 0.9; k.B('paint', DC, x - 0.06, 0.2, Z + s * (W / 2 + 0.04) - 0.05, x + 0.06, H, Z + s * (W / 2 + 0.04) + 0.05, O); }
        k.B('metal', 0x333333, X - L / 2, 0, Z + s * 0.55 - 0.1, X + L / 2 + 0.3, 0.16, Z + s * 0.55 + 0.1, { rust: 0.8, dirt: 1 }); }
      const deb = [0xc19a62, 0x8a6a40, 0x2a2a2a, 0x9a958c, 0xb5a585, 0x5a4a38, 0xd8d0be, 0x3d5a7a];
      for (let i = 0; i < 34; i++) { const w = 0.3 + rnd() * 1.3, d = 0.1 + rnd() * 0.6, h = 0.03 + rnd() * 0.2;
        k.add('rough', deb[Math.floor(rnd() * deb.length)], new THREE.BoxGeometry(w, h, d), T(X + (rnd() - 0.5) * (L - 1.2), 0.5 + rnd() * 0.95, Z + (rnd() - 0.5) * (W - 0.6), (rnd() - 0.5) * 0.8, rnd() * 3, (rnd() - 0.5) * 0.8), { dirt: 0.6 }); }
    }
    { // rebar: six 12 m bundles of #6/#8 bar on dunnage, rusty, colour-coded ends
      const tags = [0xd8d02a, 0xc23a2a, 0x2a7ad8, 0xd8d02a, 0x2aa04a, 0xc23a2a];
      for (const x of [-63, -59.5, -56, -52.5]) k.B('rough', 0x7a6044, x - 0.08, 0, 33.2, x + 0.08, 0.14, 43.2, { dirt: 0.9 });
      for (let i = 0; i < 6; i++) {
        const zc = 34 + i * 1.6, y0 = 0.14 + (i % 2) * 0.02;
        for (let l = 0; l < 3; l++) for (let b = 0; b < 17 - l * 2; b++) {
          const z = zc - 0.46 + b * 0.056 + l * 0.056, y = y0 + 0.028 + l * 0.048, sh = (rnd() - 0.5) * 0.4;
          k.add('rough', [0x7a3e1d, 0x6a3418, 0x8a4b26, 0x5e3a24][Math.floor(rnd() * 4)], new THREE.CylinderGeometry(0.028, 0.028, 12, 4, 1).rotateZ(Math.PI / 2), T(-58 + sh, y, z), { dirt: 0.5, rust: 0.6 });
        }
        k.B('paint', tags[i], -64.05, y0, zc - 0.55, -63.85, y0 + 0.11, zc + 0.55, { dirt: 0.3 });
        for (const x of [-61, -55]) k.B('metal', 0x444444, x - 0.03, y0, zc - 0.56, x + 0.03, y0 + 0.13, zc + 0.56, { rust: 0.6 });
      }
    }
    { // form stock: two plywood stacks, aluminium wall forms, a lumber bundle, each on dunnage
      for (let i = 0; i < 4; i++) {
        const x = -44 + i * 3, z = 44;
        for (const dz of [-0.9, 0.9]) k.B('rough', 0x6e5a40, x - 1.25, 0, z + dz - 0.08, x + 1.25, 0.12, z + dz + 0.08, { dirt: 0.9 });
        if (i < 2) {
          for (let j = 0; j < 8; j++) { const ox = (rnd() - 0.5) * 0.08, oz = (rnd() - 0.5) * 0.08, c = rnd() < 0.35 ? 0x9b958a : [0xb98a55, 0xae7f4b, 0xa47a4c][j % 3];
            for (const dx of [-0.62, 0.62]) k.B('rough', c, x + dx - 0.6 + ox, 0.12 + j * 0.115, z - 1.22 + oz, x + dx + 0.6 + ox, 0.12 + (j + 1) * 0.115, z + 1.22 + oz, { dirt: 0.5, jit: 0.08 }); }
          for (const dz of [-0.7, 0.7]) k.B('metal', 0x2a2a2a, x - 1.26, 0.12, z + dz - 0.02, x + 1.26, 1.06, z + dz + 0.02);
        } else if (i === 2) {
          for (let j = 0; j < 9; j++) { k.B('metal', 0xa9adb0, x - 1.2, 0.12 + j * 0.1, z - 1.0, x + 1.2, 0.2 + j * 0.1, z + 1.0, { dirt: 0.6, rust: 0.1 }); k.B('rough', 0x8d8a83, x - 1.12, 0.2 + j * 0.1, z - 0.92, x + 1.12, 0.21 + j * 0.1, z + 0.92, { dirt: 0.8 }); }
        } else {
          for (let j = 0; j < 6; j++) for (let b = 0; b < 12; b++) k.B('rough', [0xd2b07a, 0xc9a46a, 0xbf9a60][(j + b) % 3], x - 1.22, 0.12 + j * 0.09, z - 1.1 + b * 0.185, x + 1.22, 0.2 + j * 0.09, z - 1.1 + b * 0.185 + 0.17, { dirt: 0.4, jit: 0.05 });
          for (const dx of [-0.8, 0.8]) k.B('metal', 0x2a2a2a, x + dx - 0.02, 0.12, z - 1.13, x + dx + 0.02, 0.68, z + 1.13);
        }
      }
    }
    k.build(group);
  };

  const exA = excavator(), exB = excavator();
  exA.g.position.set(-20, 0, -13); exB.g.position.set(-10, 0, 13);
  const trucks = [0, 1, 2, 3].map(truck);
  const dozer = makeDozer();
  const pump = makePump();
  const mixers = [0, 1].map(mixer);
  const crane = makeCrane();
  const crew = makeCrew();
  const towers = [[-60, -42], [60, -42], [-60, 42], [20, 30]].map(([x, z]) => tower(x, z));
  furniture();
  return { exA, exB, trucks, dozer, pump, mixers, crane, crew, towers, tris: TRIS, materials: MAT };
}
