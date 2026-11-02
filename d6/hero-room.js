// D6 hero: the operations room. Desk with three monitors in a shallow arc, floor-to-ceiling glass with thin
// mullions, dark ceiling and floor. Monitor glow comes from rect area lights; the glass is a custom
// premultiplied shader (tint + Fresnel reflection of a painted room environment).
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { NOISE, rng } from './hero-glsl.js';

export const GLASS_Z = -2.2;
const SH = 0.4, SW = 0.72, BZ = 0.014, DESK_Y = 0.745, SCREEN_Y = 1.1;

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
  for (let i = 0; i < 14; i++) { const u = 0.52 + i * 0.034 + (r() - 0.5) * 0.01; x.fillStyle = `rgba(150,165,190,${0.08 + r() * 0.12})`; x.fillRect(u * W, H * 0.18, 2, H * 0.38); } // frames of the back wall
  x.fillStyle = 'rgba(160,175,200,0.18)'; x.fillRect(0.55 * W, H * 0.2, 0.42 * W, 2); x.fillRect(0.55 * W, H * 0.55, 0.42 * W, 2);
  for (const u of [0.62, 0.75, 0.88]) glow(u, 0.86, 22, 3, 'rgba(120,130,150,0.35)'); // dead ceiling strips
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.mapping = THREE.EquirectangularReflectionMapping; return t;
}

export function buildRoom({ THREE, scene, high }) {
  RectAreaLightUniformsLib.init();
  const group = new THREE.Group(); scene.add(group);
  const env = roomEnv(THREE);
  const M = {
    bezel: new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.38, metalness: 0.2, envMap: env, envMapIntensity: 0.6 }),
    stand: new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.3, metalness: 0.85, envMap: env, envMapIntensity: 0.8 }),
    desk: new THREE.MeshStandardMaterial({ color: 0x101012, roughness: 0.3, metalness: 0.0, envMap: env, envMapIntensity: 0.35 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x07070a, roughness: 0.85 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x15161a, roughness: 0.32, metalness: 0.75, envMap: env, envMapIntensity: 0.9 }),
    keys: new THREE.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.6 }),
  };
  const add = (geo, mat, x = 0, y = 0, z = 0, parent = group) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m; };

  // floor, ceiling, desk
  add(new THREE.PlaneGeometry(14, 10).rotateX(-Math.PI / 2), M.dark, 0, 0, 2.6);
  add(new THREE.PlaneGeometry(14, 10).rotateX(Math.PI / 2), M.dark, 0, 2.9, 2.6);
  add(new THREE.BoxGeometry(14, 0.32, 0.4), M.frame, 0, 2.76, GLASS_Z + 0.1);                // header
  add(new THREE.BoxGeometry(3.8, 0.04, 1.05), M.desk, 0, DESK_Y - 0.02, 0.15);
  add(new THREE.BoxGeometry(3.8, 0.7, 0.04), M.dark, 0, 0.38, -0.35);                          // modesty panel
  { const g = new THREE.BoxGeometry(0.44, 0.018, 0.14).translate(0, DESK_Y + 0.009, 0.42); // keyboard + mouse + a puck
    const m2 = new THREE.BoxGeometry(0.06, 0.02, 0.1).translate(0.32, DESK_Y + 0.01, 0.43), m3 = new THREE.CylinderGeometry(0.05, 0.05, 0.02, 20).translate(-0.48, DESK_Y + 0.01, 0.38);
    const k2 = new THREE.BoxGeometry(0.3, 0.018, 0.12).translate(-1.05, DESK_Y + 0.009, 0.45).rotateY(0.25);
    add(mergeAll(THREE, [g, m2, m3, k2]), M.keys); }

  // glass + mullions
  const glassU = { tEnv: { value: env }, uRefl: { value: 1.0 }, uTint: { value: 0.32 }, uTintC: { value: new THREE.Color(0x010304) } };
  const glass = add(new THREE.PlaneGeometry(14, 2.9), new THREE.ShaderMaterial({
    uniforms: glassU, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    vertexShader: `varying vec3 vW; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `${NOISE} uniform sampler2D tEnv; uniform float uRefl, uTint; uniform vec3 uTintC; varying vec3 vW;
      void main(){ vec3 V=normalize(vW-cameraPosition), N=vec3(0.,0.,1.), R=reflect(V,N);
        float F=.04+.96*pow(1.-abs(dot(V,N)),5.);
        vec2 e=vec2(atan(R.z,R.x)/6.2832+.5, asin(clamp(R.y,-1.,1.))/3.1416+.5);
        vec3 env=texture2D(tEnv,e).rgb;
        float sm=fbm2(vW.xy*vec2(2.5,1.2)+4.);                                  // faint smudges
        vec3 c=env*uRefl*(F*3.+.05)*(.75+.5*sm) + uTintC*uTint;
        gl_FragColor=vec4(c, uTint*(.9+.2*sm)); }`
  }), 0, 1.45, GLASS_Z);
  glass.renderOrder = 2;
  { const parts = [];
    for (let i = -4; i < 4; i++) parts.push(new THREE.BoxGeometry(0.05, 2.9, 0.12).translate(1.8 * i + 0.9, 1.45, GLASS_Z - 0.03));
    parts.push(new THREE.BoxGeometry(14, 0.08, 0.14).translate(0, 0.04, GLASS_Z - 0.02));        // sill
    add(mergeAll(THREE, parts), M.frame); }

  // monitors
  const unitBox = new THREE.BoxGeometry(1, 1, 1), unitPlane = new THREE.PlaneGeometry(1, 1);
  const monitor = (mat, glow) => {
    const g = new THREE.Group(); group.add(g);
    const body = new THREE.Mesh(unitBox, M.bezel); body.position.z = -0.018; g.add(body);
    const back = new THREE.Mesh(unitBox, M.bezel); back.position.set(0, -0.02, -0.05); g.add(back);
    const screen = new THREE.Mesh(unitPlane, mat); screen.position.z = 0.0008; g.add(screen);
    const stand = new THREE.Mesh(mergeAll(THREE, [new THREE.BoxGeometry(0.06, 0.32, 0.025).translate(0, -SH / 2 - 0.12, -0.085), new THREE.BoxGeometry(0.26, 0.012, 0.2).translate(0, DESK_Y - SCREEN_Y + 0.006, -0.06)]), M.stand); g.add(stand);
    const light = new THREE.RectAreaLight(glow, 5, SW, SH); light.position.z = 0.002; light.rotation.y = Math.PI; g.add(light); // emits along its -z, i.e. out of the screen
    const m = { g, body, back, screen, light, w: SW, h: SH };
    m.size = w => { m.w = w; screen.scale.set(w, SH, 1); body.scale.set(w + 2 * BZ, SH + 2 * BZ + 0.006, 0.03); body.position.y = -0.003; back.scale.set(w * 0.62, SH * 0.6, 0.05); light.width = w; light.height = SH; };
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
  return {
    group, env, glass, glassU, M,
    makeMonitors({ left, centre, right }) {
      mons.left = monitor(left, new THREE.Color(0.5, 0.6, 0.85)); mons.centre = monitor(centre, new THREE.Color(1.0, 0.82, 0.62)); mons.right = monitor(right, new THREE.Color(0.4, 0.75, 1.0));
      layout(SW); return mons;
    },
    setCentreAspect(a) { layout(SH * a); },
    get centreW() { return mons.centre.w; }, centreH: SH, SCREEN_Y,
    setGlow(k) { for (const m of [mons.left, mons.centre, mons.right]) m.light.intensity = 5 * k; },
    dispose() { group.traverse(o => { if (o.geometry) o.geometry.dispose(); }); Object.values(M).forEach(m => m.dispose()); glass.material.dispose(); env.dispose(); }
  };
}

function mergeAll(THREE, geos) { // tiny merge for non-indexed + indexed boxes (position/normal/uv only)
  const flat = geos.map(g => g.index ? g.toNonIndexed() : g);
  const n = flat.reduce((s, g) => s + g.attributes.position.count, 0), P = new Float32Array(n * 3), N = new Float32Array(n * 3), UV = new Float32Array(n * 2);
  let o = 0; for (const g of flat) { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); if (g.attributes.uv) UV.set(g.attributes.uv.array, o * 2); o += g.attributes.position.count; }
  const out = new THREE.BufferGeometry(); out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3)); out.setAttribute('uv', new THREE.BufferAttribute(UV, 2)); return out;
}
