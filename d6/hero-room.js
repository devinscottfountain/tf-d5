// D6 hero: the operations room. Operator desk with three thin-bezel monitors in a shallow arc, floor-to-ceiling glass
// on slim T-mullions, acoustic ceiling with dead linear lights, carpet floor, chair in the foreground.
// Monitor glow comes from rect area lights; the glass is a custom premultiplied shader (tint + Fresnel reflection of a
// painted room environment). Static geometry is merged per material; textures arrive later via applyHeroTextures.
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { NOISE, rng } from './hero-glsl.js';
import { mergeAll, boxUV, rrect, sweep, texBinder } from './hero-model-kit.js';
import { monitorGeo, buildDesk } from './hero-model-desk.js';

export const GLASS_Z = -2.2;
const SH = 0.444, SW = 0.8, BZ = 0.014, DESK_Y = 0.745, SCREEN_Y = 1.13, CEIL = 3.5, PITCH = 1.8;

const live = new Set();
// assign streamed textures by role to every live room (no-op for roles not loaded yet)
export function applyHeroTextures(tex) { for (const r of live) r.applyHeroTextures(tex); }

function roomEnv(THREE) { // equirect of the room behind the camera, for the glass and the mullions
  const W = 512, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d'), r = rng(3);
  const g = x.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#0b0c10'); g.addColorStop(0.45, '#08090c'); g.addColorStop(0.55, '#050506'); g.addColorStop(1, '#020203');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  const glow = (u, v, rx, ry, col) => { x.save(); x.translate(u * W, (1 - v) * H); x.scale(rx, ry); const q = x.createRadialGradient(0, 0, 0, 0, 0, 1); q.addColorStop(0, col); q.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = q; x.fillRect(-1, -1, 2, 2); x.restore(); };
  // u: atan(z,x)/2pi+.5, so +z (behind the camera, what the glass mirrors) sits at u=.75
  glow(0.75, 0.46, 120, 26, 'rgba(70,110,170,0.75)');   // monitor light on the operator area / back wall
  glow(0.72, 0.5, 60, 18, 'rgba(190,150,100,0.45)');
  glow(0.80, 0.49, 50, 16, 'rgba(80,170,230,0.5)');
  glow(0.75, 0.40, 160, 14, 'rgba(40,60,90,0.6)');       // desk top catching the screens
  for (let i = 0; i < 14; i++) { const u = 0.52 + i * 0.034 + (r() - 0.5) * 0.01; x.fillStyle = `rgba(150,165,190,${0.04 + r() * 0.06})`; x.fillRect(u * W, H * 0.18, 1, H * 0.38); } // frames of the back wall
  x.fillStyle = 'rgba(160,175,200,0.18)'; x.fillRect(0.55 * W, H * 0.2, 0.42 * W, 2); x.fillRect(0.55 * W, H * 0.55, 0.42 * W, 2);
  for (const u of [0.62, 0.75, 0.88]) glow(u, 0.86, 22, 3, 'rgba(120,130,150,0.35)'); // dead ceiling strips
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.mapping = THREE.EquirectangularReflectionMapping; return t;
}

export function buildRoom({ THREE, scene, high, quality }) {
  if (high === undefined) high = quality !== 'low';
  RectAreaLightUniformsLib.init();
  const group = new THREE.Group(); group.name = 'hero-room'; scene.add(group);
  const env = roomEnv(THREE);
  const S = o => new THREE.MeshStandardMaterial(o);
  const M = {
    bezel: S({ color: 0x0c0c0e, roughness: 0.38, metalness: 0.2, envMap: env, envMapIntensity: 0.6 }),
    stand: S({ color: 0x1a1b1d, roughness: 0.3, metalness: 0.85, envMap: env, envMapIntensity: 0.8 }),
    desk: S({ color: 0x0a0a0c, roughness: 0.42, metalness: 0.0, envMap: env, envMapIntensity: 0.3 }),
    edge: S({ color: 0x1c1d20, roughness: 0.3, metalness: 0.6, envMap: env, envMapIntensity: 0.9 }),
    dark: S({ color: 0x07070a, roughness: 0.85 }),
    frame: S({ color: 0x15161a, roughness: 0.32, metalness: 0.75, envMap: env, envMapIntensity: 0.9 }),
    keys: S({ color: 0x1c1d20, roughness: 0.6 }),
    mull: S({ color: 0x55585f, roughness: 0.4, metalness: 0.6, envMap: env, envMapIntensity: 1.5, emissive: 0x16181d }),
    metal: S({ color: 0x2a2b2e, roughness: 0.35, metalness: 0.8, envMap: env, envMapIntensity: 0.8 }),
    plastic: S({ color: 0x111214, roughness: 0.55, metalness: 0.05, envMap: env, envMapIntensity: 0.4 }),
    rubber: S({ color: 0x0b0b0c, roughness: 0.9 }),
    fabric: S({ color: 0x15161a, roughness: 0.95 }),
    ceramic: S({ color: 0xbdbab3, roughness: 0.3, envMap: env, envMapIntensity: 0.5 }),
    paper: S({ color: 0xb8b3a8, roughness: 0.9 }),
    accent: S({ color: 0x8a1410, roughness: 0.4 }),
    accentY: S({ color: 0xb08a10, roughness: 0.45 }),
    led: new THREE.MeshBasicMaterial({ color: new THREE.Color(0.25, 1.6, 0.6) }),
    carpet: S({ color: 0x0c0d10, roughness: 1 }),
    ceil: S({ color: 0x101114, roughness: 0.95 }),
    grid: S({ color: 0x1b1c20, roughness: 0.5, metalness: 0.4 }),
    strip: S({ color: 0x1a1b1e, roughness: 0.3, emissive: 0x0d0e10 }),
    sill: S({ color: 0x1b1c1f, roughness: 0.5, envMap: env, envMapIntensity: 0.6 }),
  };
  const tb = texBinder();
  tb.bind(M.desk, 'desk_laminate', { color: 0x1a1a1d }); tb.bind(M.edge, 'brushed_metal', { maps: ['normalMap', 'roughnessMap'] });
  tb.bind(M.stand, 'brushed_metal', { maps: ['normalMap', 'roughnessMap'] }); tb.bind(M.metal, 'brushed_metal', { maps: ['normalMap', 'roughnessMap'] });
  tb.bind(M.mull, 'brushed_metal', { maps: ['normalMap', 'roughnessMap'], normalScale: 0.4 }); tb.bind(M.frame, 'brushed_metal', { maps: ['normalMap', 'roughnessMap'] });
  for (const k of ['bezel', 'plastic', 'keys']) tb.bind(M[k], 'black_plastic', { maps: ['normalMap', 'roughnessMap'] });
  tb.bind(M.fabric, 'fabric_chair', { color: 0x1a1b20 }); // tan leather scan, tinted near black tb.bind(M.carpet, 'carpet', { color: 0x202228 });
  tb.bind(M.ceil, 'ceiling_panel', { color: 0x2a2b30 }); tb.bind(M.sill, 'concrete_floor', { color: 0x3a3b3f });

  const add = (geo, mat, x = 0, y = 0, z = 0, parent = group) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };
  const parts = new Map(); const P = (mat, g) => (parts.get(mat) || parts.set(mat, []).get(mat)).push(g);
  const ZB = 7.4, ZF = GLASS_Z + 0.42; // back wall, inner face of the head soffit

  // floor: carpet tiles, 0.5 m world UVs
  P(M.carpet, boxUV(THREE, new THREE.PlaneGeometry(14, ZB - GLASS_Z).rotateX(-Math.PI / 2).translate(0, 0, (ZB + GLASS_Z) / 2), 1));
  // ceiling: slab, 1200 x 600 acoustic tiles in a T-grid, three dead linear lights running along the glass
  P(M.dark, new THREE.PlaneGeometry(14, ZB - GLASS_Z).rotateX(Math.PI / 2).translate(0, CEIL + 0.02, (ZB + GLASS_Z) / 2));
  { const lightsZ = [-0.9, 1.5, 3.9];
    for (let x = -7; x < 7 - 1e-6; x += 1.2) for (let z = ZF; z < ZB - 1e-6; z += 0.6) {
      if (lightsZ.some(lz => Math.abs(z + 0.3 - lz) < 0.31)) continue;
      P(M.ceil, new THREE.BoxGeometry(1.188, 0.016, 0.588).translate(x + 0.6, CEIL - 0.012, z + 0.3));
    }
    if (high) { for (let x = -7; x <= 7 + 1e-6; x += 1.2) P(M.grid, new THREE.BoxGeometry(0.024, 0.012, ZB - ZF).translate(x, CEIL - 0.024, (ZB + ZF) / 2));
      for (let z = ZF; z <= ZB + 1e-6; z += 0.6) P(M.grid, new THREE.BoxGeometry(14, 0.012, 0.024).translate(0, CEIL - 0.024, z)); }
    for (const lz of lightsZ) { P(M.grid, new THREE.BoxGeometry(12, 0.06, 0.1).translate(0, CEIL - 0.0, lz)); P(M.strip, new THREE.BoxGeometry(11.9, 0.004, 0.07).translate(0, CEIL - 0.03, lz)); }
  }
  // side and back walls with fabric acoustic panels (seen in pans and reflections)
  for (const s of [-1, 1]) {
    P(M.dark, new THREE.PlaneGeometry(ZB - GLASS_Z, CEIL).rotateY(-s * Math.PI / 2).translate(s * 7, CEIL / 2, (ZB + GLASS_Z) / 2));
    for (let i = 0; i < 6; i++) P(M.fabric, new THREE.BoxGeometry(0.04, 1.6, 1.15).translate(s * 6.97, 1.55, -1.2 + i * 1.3));
  }
  P(M.dark, new THREE.PlaneGeometry(14, CEIL).rotateY(Math.PI).translate(0, CEIL / 2, ZB));

  // curtain wall: slim T-mullions (16 mm face, 117 mm deep into the room) with glazing clamps and an exterior cap
  { const prof = [rrect(THREE, 0.016, 0.012, 0.003, 0, 0.111), rrect(THREE, 0.009, 0.112, 0.002, 0, 0.056), rrect(THREE, 0.026, 0.02, 0.003, 0, 0), rrect(THREE, 0.03, 0.016, 0.004, 0, -0.022)];
    const mul = []; for (let i = -4; i < 4; i++) { const x = PITCH * i + PITCH / 2; for (const s of prof) mul.push(sweep(THREE, s, [x, 0.1, GLASS_Z], [x, CEIL - 0.3, GLASS_Z], [0, 0, 1])); }
    P(M.mull, boxUV(THREE, mergeAll(THREE, mul), 0.5));
    // sill: stone ledge with a radiused nose + base track; head: soffit with a shadow gap + head track
    const sill = new THREE.Shape([[-0.32, 0], [0.03, 0], [0.03, 0.07], [-0.3, 0.07]].map(p => new THREE.Vector2(...p))); sill.quadraticCurveTo(-0.32, 0.07, -0.32, 0.05);
    P(M.sill, boxUV(THREE, sweep(THREE, sill, [-7, 0, GLASS_Z], [7, 0, GLASS_Z], [0, 1, 0]), 2));
    P(M.frame, sweep(THREE, rrect(THREE, 0.05, 0.04, 0.004, 0, 0.088), [-7, 0, GLASS_Z], [7, 0, GLASS_Z], [0, 1, 0]));
    P(M.frame, sweep(THREE, rrect(THREE, 0.05, 0.05, 0.004, 0, CEIL - 0.325), [-7, 0, GLASS_Z], [7, 0, GLASS_Z], [0, 1, 0]));
    P(M.frame, sweep(THREE, new THREE.Shape([[-0.42, CEIL - 0.3], [0.06, CEIL - 0.3], [0.06, CEIL], [-0.42, CEIL]].map(p => new THREE.Vector2(...p))), [-7, 0, GLASS_Z], [7, 0, GLASS_Z], [0, 1, 0]));
    P(M.dark, new THREE.BoxGeometry(14, 0.03, 0.02).translate(0, CEIL - 0.3 + 0.015, ZF + 0.01)); // shadow gap
  }

  // bake the static shell into one mesh per material
  for (const [m, gs] of parts) { const mesh = add(mergeAll(THREE, gs), m); mesh.userData.part = 'shell'; mesh.userData.texScale = gs[0].userData.texScale || 1; }

  // desk, props, chair (merged per material inside)
  const desk = buildDesk({ THREE, group, M, DESK_Y, high });

  // glass: tint + Fresnel reflection; glass_smudge modulates it once loaded
  const smDummy = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); smDummy.needsUpdate = true;
  const glassU = { tEnv: { value: env }, uRefl: { value: 2.6 }, uTint: { value: 0.32 }, uTintC: { value: new THREE.Color(0x010304) }, tSm: { value: smDummy }, uSm: { value: 0 } };
  const glass = add(new THREE.PlaneGeometry(14, CEIL), new THREE.ShaderMaterial({
    uniforms: glassU, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `${NOISE} uniform sampler2D tEnv, tSm; uniform float uRefl, uTint, uSm; uniform vec3 uTintC; varying vec3 vW;
      void main(){ vec3 V=normalize(vW-cameraPosition), N=vec3(0.,0.,1.), R=reflect(V,N);
        float F=.04+.96*pow(1.-abs(dot(V,N)),5.);
        vec2 e=vec2(atan(R.z,R.x)/6.2832+.5, asin(clamp(R.y,-1.,1.))/3.1416+.5);
        vec3 env=texture2D(tEnv,e).rgb;
        float sm=fbm2(vW.xy*vec2(2.5,1.2)+4.);                                  // faint smudges
        sm=mix(sm, texture2D(tSm, vW.xy/1.5).r, uSm*.7);
        vec3 c=env*uRefl*(F*3.+.05)*(.75+.5*sm) + uTintC*uTint;
        gl_FragColor=vec4(c, uTint*(.9+.2*sm)); }`
  }), 0, CEIL / 2, GLASS_Z);
  glass.renderOrder = 2; glass.userData.part = 'glass';
  tb.bind(null, 'glass_smudge', { custom: set => { const t = set.roughnessMap || set.map; if (t && glassU.tSm.value !== t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; glassU.tSm.value = t; glassU.uSm.value = 1; } } });

  // monitors: screen plane (unit quad scaled to w x SH at z=+0.8 mm) inside a rebuilt-per-width body
  const unitPlane = new THREE.PlaneGeometry(1, 1), deskDy = DESK_Y - SCREEN_Y;
  const monitor = (mat, glow, name) => {
    const g = new THREE.Group(); g.name = 'monitor-' + name; group.add(g);
    const body = new THREE.Mesh(new THREE.BufferGeometry(), M.bezel), back = new THREE.Mesh(new THREE.BufferGeometry(), M.stand);
    body.userData.part = 'monitor-shell'; back.userData.part = 'monitor-stand'; g.add(body, back);
    const screen = new THREE.Mesh(unitPlane, mat); screen.position.z = 0.0008; screen.name = 'screen-' + name; g.add(screen);
    const light = new THREE.RectAreaLight(glow, 5, SW, SH); light.position.z = 0.002; light.rotation.y = Math.PI; g.add(light); // emits along its -z, i.e. out of the screen
    const m = { g, body, back, screen, light, w: SW, h: SH, _bw: 0 };
    m.size = w => {
      m.w = w; screen.scale.set(w, SH, 1); light.width = w; light.height = SH;
      if (Math.abs(m._bw - w) > 1e-4) { m._bw = w; const gg = monitorGeo(THREE, w, SH, { BZ, deskDy, cables: high }); body.geometry.dispose(); back.geometry.dispose(); body.geometry = gg.shell; back.geometry = gg.metal; }
    };
    m.size(SW); return m;
  };
  const mons = { left: null, centre: null, right: null };
  function layout(wc) { // centre width wc, side monitors hinge off its edges, turned in
    const a = 0.36, gap = 0.012, half = (SW + 2 * BZ) / 2;
    mons.centre.size(wc); mons.centre.g.position.set(0, SCREEN_Y, 0); mons.centre.g.rotation.set(0, 0, 0);
    for (const s of [-1, 1]) {
      const m = s < 0 ? mons.left : mons.right, ex = s * (wc / 2 + BZ + gap);
      m.g.position.set(ex + s * Math.cos(a) * half, SCREEN_Y, Math.sin(a) * half); m.g.rotation.set(0, -s * a, 0);
    }
  }
  const api = {
    group, env, glass, glassU, M, desk,
    makeMonitors({ left, centre, right }) {
      mons.left = monitor(left, new THREE.Color(0.5, 0.6, 0.85), 'left'); mons.centre = monitor(centre, new THREE.Color(1.0, 0.82, 0.62), 'centre'); mons.right = monitor(right, new THREE.Color(0.4, 0.75, 1.0), 'right');
      layout(SW); return mons;
    },
    setCentreAspect(a) { layout(SH * a); },
    get centreW() { return mons.centre.w; }, centreH: SH, SCREEN_Y,
    setGlow(k) { for (const m of [mons.left, mons.centre, mons.right]) m.light.intensity = 1.6 * k; },
    applyHeroTextures: tex => tb.apply(tex),
    dispose() { live.delete(api); group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); Object.values(M).forEach(m => m.dispose()); glass.material.dispose(); env.dispose(); smDummy.dispose(); }
  };
  live.add(api);
  return api;
}
