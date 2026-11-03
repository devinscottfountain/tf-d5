// solutions.js: D6 mission + solutions WebGL layer. The topographic map draws in as fine contour lines behind the
// mission copy, its vertices snap onto a dot lattice, then the solutions dot grid takes over below the tab cards
// with three modes: Planning (top-down grid, machines with zones), Mission Control (3/4 view, rolling lidar
// terrain, the D3 dig game) and Accelerated Operations (flat grid, three machines drive in). One transparent
// canvas fills `host`; the page drives it with setScene() from scroll.
import { createMachineKit } from './sol-machines.js';
import { createGame } from './sol-game.js';

// terrain height field, shared by the vertex shader and the CPU (picking, machines). Keep both in sync.
export const H_GLSL = /* glsl */ `
float hF(vec2 p){
  float x = p.x, z = p.y;
  float h = 2.2*sin(x*.08)*cos(z*.11) + 1.2*sin(x*.21 + z*.13) + .6*sin(z*.35 - x*.05);
  float far = 1. + max(0., -z - 6.) / 16.;
  float hill = 6.5*exp(-((x + 26.)*(x + 26.) + (z + 32.)*(z + 32.)) / 260.);
  return h*far + hill;
}`;
export const hField = (x, z) => {
  const h = 2.2 * Math.sin(x * 0.08) * Math.cos(z * 0.11) + 1.2 * Math.sin(x * 0.21 + z * 0.13) + 0.6 * Math.sin(z * 0.35 - x * 0.05);
  const far = 1 + Math.max(0, -z - 6) / 16;
  const hill = 6.5 * Math.exp(-((x + 26) * (x + 26) + (z + 32) * (z + 32)) / 260);
  return h * far + hill;
};

const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const sm = v => { v = clamp01(v); return v * v * (3 - 2 * v); };
const lerp = (a, b, t) => a + (b - a) * t;
const easeIO = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const io2 = t => { t = clamp01(t); return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
const DEG = Math.PI / 180;

// Figma map: 1774.5 x 1195.6 design px. Placed right and low so its bright side sits clear of the copy (Tim's frame 3):
// left edge at x = -120 of the 1600 frame, its top ~46 px above the mission copy
const MAP_W = 1774.5, MAP_X = -120, MAP_ABOVE = 46, MAP_SNAP = 16;
// the mission copy (H2, CTA, both paragraphs) in map units on desktop: the map stays at <= 0.15 under it
const MAP_CAP = [200 + 172 - MAP_X - 20, MAP_ABOVE - 10, 200 + 1197 - MAP_X + 20, MAP_ABOVE + 300]; // x0, y0, x1, y1
const AMP_C = 1.5; // control terrain wave amplitude (frame 5)
const MSCALE = 1.4; // machine scale (model metres -> world)
const PLAN_S = 1.3; // planning machines read larger (frame 4)
const PR_MAX = 1.5;

// ------------------------------------------------------------------ screen-space lines + handles (shared)
// Quads per segment, widened in screen space so thin strokes stay continuous (GL lines alias to dashes).
// aSE: x = side (-1, 1), y = which end (0 start, 1 end); the quad is pushed out half a stroke past each end.
const LINE_VS = /* glsl */ `
  vec2 lineOff(vec2 ps, vec2 qs, vec2 se, float w, out float vD){
    vec2 d = se.y > .5 ? ps - qs : qs - ps; float L = length(d); d = L > 1e-5 ? d / L : vec2(1., 0.);
    float hw = w*.5 + 1.; vD = se.x*hw;
    return vec2(-d.y, d.x)*se.x*hw + d*(se.y > .5 ? 1. : -1.)*w*.5;
  }`;
function segBuffers(THREE, maxSeg, dim) {
  const pos = new Float32Array(maxSeg * 4 * 3), oth = new Float32Array(maxSeg * 4 * dim), se = new Float32Array(maxSeg * 8);
  const idx = new Uint32Array(maxSeg * 6);
  for (let i = 0; i < maxSeg; i++) { const v = i * 4; se.set([-1, 0, 1, 0, -1, 1, 1, 1], v * 2); idx.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i * 6); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aOther', new THREE.BufferAttribute(oth, dim));
  geo.setAttribute('aSE', new THREE.BufferAttribute(se, 2)); geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  return { geo, pos, oth };
}

export function createSolutions({ THREE, host, topoUrl, quality = 'high' }) {
  const LOW = quality === 'low';
  const renderer = new THREE.WebGLRenderer({ antialias: !LOW, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0); renderer.autoClear = false;
  renderer.setPixelRatio(LOW ? 1 : Math.min(window.devicePixelRatio || 1, PR_MAX));
  renderer.setSize(1, 1, false); // the drawing buffer is allocated on start(), freed a moment after stop()
  const canvas = renderer.domElement;
  canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;pointer-events:none;touch-action:pan-y;-webkit-tap-highlight-color:transparent';
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.appendChild(canvas);

  const scene = new THREE.Scene(), mapScene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 4000);
  let cw = 1, ch = 1;
  const RES = { value: new THREE.Vector2(1, 1) }, PRU = { value: 1 };

  // world-space line material (zones, game edges): width in CSS px
  function mkLine(color, width = 1, depthTest = true) {
    return new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color().setHex(color, THREE.LinearSRGBColorSpace) }, uW: { value: width }, uOpacity: { value: 0 }, uRes: RES, uPR: PRU },
      transparent: true, depthWrite: false, depthTest, side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
        attribute vec3 aOther; attribute vec2 aSE; uniform vec2 uRes; uniform float uW, uPR; varying float vD;
        ${LINE_VS}
        void main(){
          vec4 p = projectionMatrix*modelViewMatrix*vec4(position, 1.), q = projectionMatrix*modelViewMatrix*vec4(aOther, 1.);
          vec2 h = uRes*.5; float d;
          vec2 o = lineOff(p.xy / p.w*h, q.xy / q.w*h, aSE, uW*uPR, d); vD = d;
          p.xy += o / h*p.w; gl_Position = p;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uW, uPR, uOpacity; varying float vD;
        void main(){ float a = clamp(uW*uPR*.5 + .5 - abs(vD), 0., 1.)*uOpacity; if (a < .004) discard; gl_FragColor = vec4(uColor, a); }`,
    });
  }
  // zone handles: round or square dots in CSS px; aKind 1 = snap ring
  function mkHandles(color, size, { round = true, ring = 14, depthTest = true } = {}) {
    return new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color().setHex(color, THREE.LinearSRGBColorSpace) }, uSize: { value: size }, uRing: { value: ring }, uRound: { value: round ? 1 : 0 }, uOpacity: { value: 0 }, uPR: PRU },
      transparent: true, depthWrite: false, depthTest,
      vertexShader: /* glsl */ `
        attribute float aKind; uniform float uSize, uRing, uPR; varying float vK, vS;
        void main(){ gl_Position = projectionMatrix*modelViewMatrix*vec4(position, 1.); vK = aKind; vS = (aKind > .5 ? uRing + 2. : uSize)*uPR + 2.; gl_PointSize = vS; }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; uniform float uSize, uRing, uRound, uPR, uOpacity; varying float vK, vS;
        void main(){
          vec2 c = (gl_PointCoord - .5)*vS; float a;
          if (vK > .5) a = clamp(.5*uPR + .5 - abs(length(c) - uRing*.5*uPR), 0., 1.)*.9;
          else { float d = uRound > .5 ? length(c) : max(abs(c.x), abs(c.y)); a = clamp(uSize*uPR*.5 + .5 - d, 0., 1.); }
          a *= uOpacity; if (a < .004) discard; gl_FragColor = vec4(uColor, a);
        }`,
    });
  }

  // ------------------------------------------------------------------ dot grid
  const SP = LOW ? 0.5 : 0.4, GW = 120, GD = 100;
  const NX = Math.round(GW / SP) + 1, NZ = Math.round(GD / SP) + 1, N = NX * NZ;
  const X0 = -GW / 2, Z0 = -GD / 2;
  const gx = new Float32Array(N), gz = new Float32Array(N);
  const gPos = new Float32Array(N * 3), aSeed = new Float32Array(N * 4);
  const aCut = new Float32Array(N), aZone = new Float32Array(N * 2);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < NX; i++) for (let j = 0; j < NZ; j++) {
    const k = i * NZ + j, x = X0 + i * SP + (rnd() - 0.5) * SP * 0.08, z = Z0 + j * SP + (rnd() - 0.5) * SP * 0.08;
    gx[k] = x; gz[k] = z; gPos[k * 3] = x; gPos[k * 3 + 2] = z;
    const lvl = i % 4 === 0 && j % 4 === 0 ? 2 : i % 2 === 0 && j % 2 === 0 ? 1 : 0;
    aSeed[k * 4] = rnd(); aSeed[k * 4 + 1] = rnd(); aSeed[k * 4 + 2] = rnd(); aSeed[k * 4 + 3] = lvl;
  }
  const grid = { NX, NZ, N, SP, X0, Z0, gx, gz, aCut, aZone };
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3));
  pGeo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 4));
  const cutAttr = new THREE.BufferAttribute(aCut, 1).setUsage(THREE.DynamicDrawUsage); pGeo.setAttribute('aCut', cutAttr);
  const zoneAttr = new THREE.BufferAttribute(aZone, 2).setUsage(THREE.DynamicDrawUsage); pGeo.setAttribute('aZone', zoneAttr);
  pGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  grid.cutAttr = cutAttr; grid.zoneAttr = zoneAttr;

  const U = {
    uApp: { value: 0 }, uAmp: { value: 0 }, uCutK: { value: 1 }, uPlanZ: { value: 0 }, uGameZ: { value: 0 }, uS2: { value: 1 }, uS4: { value: 0 }, uSize: { value: 0.12 }, uPx: { value: 1000 },
    uTopY: { value: 2 }, uFadeW: { value: 0.14 }, uFar: { value: 1e4 }, uCtrl: { value: 0 }, uHalf: { value: new THREE.Vector2(GW / 2, GD / 2) }, uPR: PRU,
  };
  const pMat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec4 aSeed; attribute float aCut; attribute vec2 aZone;
      uniform float uApp, uAmp, uCutK, uPlanZ, uGameZ, uS2, uS4, uSize, uPx, uFar, uCtrl, uPR, uTopY, uFadeW;
      uniform vec2 uHalf;
      varying vec3 vCol; varying float vA;
      ${H_GLSL}
      void main(){
        float h = hF(position.xz)*uAmp - aCut*uCutK;
        vec4 mv = modelViewMatrix*vec4(position.x, h, position.z, 1.);
        gl_Position = projectionMatrix*mv;
        // colour: cyan to white in plan, height ramp in control
        float hn = clamp((h + 3.5) / 13., 0., 1.);
        vec3 cHi = vec3(.42, .75, .9), cW = vec3(.86, .95, 1.);
        vec3 plan = mix(vec3(.4, .7, .86), vec3(.72, .89, .98), aSeed.x*aSeed.x); // faint cyan, as frame 4
        vec3 ctrl = mix(vec3(.1, .3, .44), vec3(.55, .88, 1.), hn);
        ctrl = mix(ctrl, cW, step(.9, aSeed.x)*.55);
        vec3 gc = mix(plan, ctrl, uCtrl);
        float zt = clamp(aZone.x*uPlanZ + aZone.y*uGameZ, 0., 1.);
        gc = mix(gc, vec3(.62, .88, 1.), zt);
        gc = mix(gc, vec3(1.), clamp(aCut / 1.4, 0., 1.)*aZone.y);
        gc = mix(gc, cW, clamp(-aCut / 1.2, 0., 1.));
        vCol = gc;
        float vis = 1. - uS2*(1. - step(.5, aSeed.w)) - uS4*(1. - step(1.5, aSeed.w));
        float edge = smoothstep(uHalf.x, uHalf.x - 7., abs(position.x))*smoothstep(uHalf.y, uHalf.y - 6., abs(position.z));
        float far = smoothstep(uFar, uFar*.55, -mv.z);
        // the lattice fades in left to right as the tab cards arrive; never above the tab cards (uTopY)
        float app = clamp(uApp*1.5 - (position.x / uHalf.x*.5 + .5)*.5, 0., 1.); app = app*app*(3. - 2.*app);
        float ny = gl_Position.y / gl_Position.w;
        vA = smoothstep(uTopY, uTopY - uFadeW, ny)*(.45 + .55*aSeed.x)*clamp(vis, 0., 1.)*edge*far*(1. + zt*.6)*app;
        float ps = uSize*(.75 + .5*aSeed.z)*(1. + zt*.25)*uPx / max(.1, -mv.z);
        if (ps < 1.3*uPR) { vA *= ps / (1.3*uPR); ps = 1.3*uPR; }
        gl_PointSize = vA < .004 ? 0. : ps;
      }`,
    fragmentShader: /* glsl */ `
      varying vec3 vCol; varying float vA;
      void main(){
        float d = length(gl_PointCoord - .5);
        float a = vA*smoothstep(.5, .12, d);
        if (a < .004) discard;
        gl_FragColor = vec4(vCol, a);
      }`,
  });
  const points = new THREE.Points(pGeo, pMat); points.frustumCulled = false; points.renderOrder = 3; points.visible = false;
  scene.add(points);

  // ------------------------------------------------------------------ topo map (2D, locked to the mission copy)
  // Drawn in screen space from design px: uMapO = map origin (CSS px), uMapK = CSS px per design px.
  // Fades as in Figma: ~0.6 white strokes, transparent at x 583 -> opaque at x 1774, black fade up from the bottom.
  // Morph: each contour vertex lifts off as a dot and eases (power2.inOut, staggered by x) onto its nearest
  // lattice node (16 design px); the line it came from dims to a ghost, then both fade as the grid takes over.
  const MU = { uCap: { value: 1 }, uMapO: { value: new THREE.Vector2() }, uMapK: { value: 1 }, uRes: RES, uPR: PRU, uTopo: { value: 0 }, uMorph: { value: 0 }, uW: { value: 0.75 }, uLineA: { value: 1 }, uGhost: { value: 0.32 }, uDotA: { value: 1 }, uDot: { value: 1.7 } };
  const MAP_GLSL = /* glsl */ `
    uniform vec2 uMapO, uRes; uniform float uMapK, uPR, uMorph, uCap;
    vec2 scr(vec2 m){ return (uMapO + m*uMapK)*uPR; }
    vec4 clip(vec2 s){ return vec4(s.x / uRes.x*2. - 1., 1. - s.y / uRes.y*2., 0., 1.); }
    // left fade: 0 at x <= 583, full by ~1100; capped to .25 (x .6 stroke = .15) under the copy box
    float mapA(vec2 m){
      float ax = smoothstep(583., 1100., m.x)*smoothstep(0., 280., m.y)*(1. - smoothstep(660., 940., m.y));
      float box = smoothstep(${MAP_CAP[0].toFixed(1)} - 60., ${MAP_CAP[0].toFixed(1)}, m.x)*(1. - smoothstep(${MAP_CAP[2].toFixed(1)}, ${MAP_CAP[2].toFixed(1)} + 60., m.x))
        *smoothstep(${MAP_CAP[1].toFixed(1)} - 50., ${MAP_CAP[1].toFixed(1)}, m.y)*(1. - smoothstep(${MAP_CAP[3].toFixed(1)}, ${MAP_CAP[3].toFixed(1)} + 70., m.y));
      return min(ax, mix(1., .25, box*uCap));
    }
    float mU(float x, float j){ return clamp((uMorph - (.02 + .2*(x / ${MAP_W.toFixed(1)}) + .03*j)) / .14, 0., 1.); }
    float io2(float u){ return u < .5 ? 2.*u*u : 1. - (-2.*u + 2.)*(-2.*u + 2.)*.5; }`;
  const lMat = new THREE.ShaderMaterial({
    uniforms: MU, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide,
    // max blending: overlapping quads at the joints never double up into beads
    blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendEquationAlpha: THREE.MaxEquation,
    vertexShader: /* glsl */ `
      attribute vec2 aOther; attribute vec2 aSE; attribute float aDel; uniform float uW;
      varying float vD, vArc, vDel; varying vec2 vM;
      ${MAP_GLSL}
      ${LINE_VS}
      void main(){ float d; vec2 s = scr(position.xy);
        s += lineOff(s, scr(aOther), aSE, uW*uPR, d); vD = d; vArc = position.z; vDel = aDel; vM = position.xy; gl_Position = clip(s); }`,
    fragmentShader: /* glsl */ `
      uniform float uTopo, uW, uLineA, uGhost; varying float vD, vArc, vDel; varying vec2 vM;
      ${MAP_GLSL}
      void main(){
        float pr = clamp((uTopo*1.12 - vDel*.6) / .52, 0., 1.);
        if (pr < 1. && vArc > pr) discard;
        float cov = clamp(uW*uPR*.5 + .5 - abs(vD), 0., 1.);
        float a = cov*.6*mapA(vM)*mix(1., uGhost, io2(mU(vM.x, .5)))*uLineA;
        if (a < .003) discard;
        gl_FragColor = vec4(vec3(a), a);
      }`,
  });
  const dMat = new THREE.ShaderMaterial({
    uniforms: MU, transparent: true, depthWrite: false, depthTest: false,
    // max blending too: the many vertices that snap onto one lattice node never stack up into a bright block
    blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendEquationAlpha: THREE.MaxEquation,
    vertexShader: /* glsl */ `
      uniform float uDotA, uDot; varying float vA;
      ${MAP_GLSL}
      void main(){
        vec2 m = position.xy; float u = mU(m.x, position.z), e = io2(u);
        vec2 g = (floor(m / ${MAP_SNAP.toFixed(1)}) + .5)*${MAP_SNAP.toFixed(1)};
        gl_Position = clip(scr(mix(m, g, e)));
        vA = smoothstep(0., .1, u)*mapA(m)*.75*uDotA;
        gl_PointSize = vA < .004 ? 0. : uDot*uPR + 1.;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uDot, uPR; varying float vA;
      void main(){ float r = length(gl_PointCoord - .5)*(uDot*uPR + 1.); float a = vA*clamp(uDot*uPR*.5 + .5 - r, 0., 1.); if (a < .004) discard; gl_FragColor = vec4(vec3(.88, .96, 1.)*a, a); }`,
  });
  let lines = null, mdots = null;

  // ------------------------------------------------------------------ machines
  const kit = createMachineKit(THREE);
  const mk = (fn, s = 1) => { const m = fn(); m.root.scale.setScalar(MSCALE * s); m.root.rotation.order = 'YXZ'; scene.add(m.root); m.setOpacity(0); return m; };
  const planExc = mk(kit.excavator, PLAN_S), planBh = mk(kit.backhoe, PLAN_S);
  const gameExc = mk(kit.excavator);
  const EXS = 1.25; // execution machines: bigger, overlapping in depth
  const exE = mk(kit.excavator, EXS), exB = mk(kit.backhoe, EXS), exR = mk(kit.roller, EXS);

  // plan layout (world xz), zones are polygons near each machine; zones sit under the machines (depth tested)
  const PLAN = [
    { m: planExc, x: 10, z: -6, yaw: 2.2, arm: [0.2, -1.1, -0.4, 0], zone: [[4.0, -10.0], [10.5, -14.0], [18.5, -8.5], [15.0, -1.5], [6.0, -1.0]] },
    { m: planBh, x: -15, z: 12, yaw: -0.65, arm: [0.9, -1.9, -1.0, 0], zone: [[-10.5, 2.0], [-3.0, 0.5], [3.0, 9.0], [-6.0, 22.0], [-15.0, 12.0]] },
  ];
  const pzLine = mkLine(0x97ddfb, 1), pzHandle = mkHandles(0x6cc0e6, 6.5, { round: false });
  const pzFill = new THREE.MeshBasicMaterial({ color: 0x6cc0e6, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const planZones = new THREE.Group(); scene.add(planZones);
  const inPoly = (poly, x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  {
    const nseg = PLAN.reduce((s, P) => s + P.zone.length, 0), L = segBuffers(THREE, nseg, 3); let s = 0;
    const hp = [];
    for (const P of PLAN) {
      const n = P.zone.length;
      for (let i = 0; i < n; i++) {
        const [ax, az] = P.zone[i], [bx, bz] = P.zone[(i + 1) % n], v = s * 12;
        for (let k = 0; k < 4; k++) { const e = k >> 1; L.pos.set(e ? [bx, 0.06, bz] : [ax, 0.06, az], v + k * 3); L.oth.set(e ? [ax, 0.06, az] : [bx, 0.06, bz], v + k * 3); }
        s++; hp.push(ax, 0.07, az);
      }
      const sh = new THREE.Shape(P.zone.map(([x, z]) => new THREE.Vector2(x, -z)));
      const fill = new THREE.Mesh(new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2), pzFill); fill.position.y = 0.04; fill.renderOrder = 0;
      planZones.add(fill);
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of P.zone) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      for (let i = Math.max(0, Math.floor((x0 - X0) / SP)); i <= Math.min(NX - 1, Math.ceil((x1 - X0) / SP)); i++)
        for (let j = Math.max(0, Math.floor((z0 - Z0) / SP)); j <= Math.min(NZ - 1, Math.ceil((z1 - Z0) / SP)); j++) { const k = i * NZ + j; if (inPoly(P.zone, gx[k], gz[k])) aZone[k * 2] = 1; }
    }
    const ln = new THREE.Mesh(L.geo, pzLine); ln.frustumCulled = false; ln.renderOrder = 4;
    const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3)); hg.setAttribute('aKind', new THREE.Float32BufferAttribute(new Float32Array(hp.length / 3), 1));
    const hd = new THREE.Points(hg, pzHandle); hd.frustumCulled = false; hd.renderOrder = 5;
    planZones.add(ln, hd);
  }

  // exec arrangement (frame 6): excavator back-left, backhoe middle, roller front-right, all facing screen-left.
  // They drive in along their heading; s = start (share of the mode), back = how far behind they start.
  const EXEC = [
    { m: exE, x: -12, z: -1.4, yaw: -2.45, arm: [0.3, -1.2, -0.9, 0], s: 0, back: 11 },
    { m: exB, x: 0.3, z: 0.2, yaw: -2.45, arm: [0.95, -1.9, -1.0, 0], s: 0.04, back: 12 },
    { m: exR, x: 11.8, z: 1.4, yaw: -2.45, arm: null, s: 0.08, back: 12 },
  ];

  // ------------------------------------------------------------------ control game
  const game = createGame({ THREE, scene, canvas, camera, exc: gameExc, grid, hField, MSCALE, mkLine, mkHandles, segBuffers });
  // clicks never land under the HUD cards (canvas px = viewport px: the canvas fills its fixed host)
  game.blocked = (x, y) => {
    const r = canvas.getBoundingClientRect(), px = x - r.left, py = y - r.top, m = 14;
    return FR.hud.some(h => h && px > h.l - m && px < h.r + m && py > h.t - m && py < h.b + m) || (FR.gt != null && py < FR.gt + 8);
  };
  let gOut = 0, gReset = true, tyS = 0; const mK = [0, 0, 0]; // control rig presence (tweens out when control is left), eased camera height

  // ------------------------------------------------------------------ camera states
  // tx, tz: look target; w: visible width (world) at the target; pitch, yaw (rad); fov; ox, oy: NDC offset of the target.
  // Mode states are base poses: w, ox, oy are refitted so the content sits in the band below the page's tabs.
  const C_MAP = { tx: 0, tz: 0, w: 160, pitch: 89.9 * DEG, yaw: 0, fov: 12, ox: 0, oy: 0 };
  const C_PLAN = { tx: 0, tz: 3, w: 90, pitch: 66 * DEG, yaw: 0, fov: 30, ox: 0, oy: -0.32 };
  const C_CTRL = { tx: 0, tz: 0, w: 42, pitch: 27 * DEG, yaw: -0.42, fov: 32, ox: 0, oy: -0.3 };
  const C_EXEC = { tx: 0, tz: 0, w: 40, pitch: 26 * DEG, yaw: 0.55, fov: 30, ox: 0, oy: -0.3 };
  const cs = { tx: 0, tz: 0, w: 0, pitch: 0, yaw: 0, fov: 0, ox: 0, oy: 0 }, cm = { ...cs };
  const blendC = (o, a, b, t) => { for (const k in o) o[k] = lerp(a[k], b[k], t); return o; };
  const tgt = new THREE.Vector3();
  function aim(cam, c, ty = 0) {
    const asp = cw / ch, dist = c.w / (2 * Math.tan(c.fov * DEG / 2) * asp);
    cam.fov = c.fov; cam.aspect = asp;
    tgt.set(c.tx, ty, c.tz);
    cam.position.set(tgt.x + dist * Math.cos(c.pitch) * Math.sin(c.yaw), ty + dist * Math.sin(c.pitch), tgt.z + dist * Math.cos(c.pitch) * Math.cos(c.yaw));
    cam.near = Math.max(0.5, dist * 0.05); cam.far = dist * 6 + 400;
    cam.updateProjectionMatrix();
    cam.projectionMatrix.elements[8] = -c.ox; cam.projectionMatrix.elements[9] = -c.oy; cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    cam.lookAt(tgt); cam.updateMatrixWorld();
    return dist;
  }

  // ------------------------------------------------------------------ adaptive framing
  // The page passes groundTop (px from the canvas top to the bottom of its tab cards) and the HUD card rects.
  // Plan and exec fit their key points into the band below groundTop; control frames the excavator around
  // 62-65% of the viewport height, between (or above) the HUD cards. Fits are recomputed on change and eased in.
  const FR = { gt: null, hud: [], key: '', snap: true };
  const fitCam = new THREE.PerspectiveCamera(30, 1, 0.5, 4000), fv = new THREE.Vector3(), bx = new THREE.Box3();
  const F = { plan: { ...C_PLAN }, ctrl: { ...C_CTRL }, exec: { ...C_EXEC } }, Fg = { plan: null, ctrl: null, exec: null };
  const KP = { plan: [], ctrl: [], exec: [] };
  if (window.__d6) window.__d6.fits = Fg; // QA: current fitted states
  // a sample of a machine's real line-art vertices at a pose (tighter than its box once projected)
  function boxPts(m, arm, x, z, yaw, out, n = 600) {
    const r = m.root; r.position.set(x, 0, z); r.rotation.set(0, yaw, 0); if (arm) m.setArm(arm[0], arm[1], arm[2], arm[3] || 0);
    r.updateMatrixWorld(true);
    const all = []; r.traverse(o => { if (o.isLineSegments) all.push(o); });
    let tot = 0; for (const o of all) tot += o.geometry.attributes.position.count;
    const step = Math.max(1, Math.floor(tot / n));
    for (const o of all) { const p = o.geometry.attributes.position; for (let i = 0; i < p.count; i += step) out.push(new THREE.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld)); }
  }
  // yaws: alternative headings (first = the designed one); a turned view wins only if it frames clearly larger
  function fitOne(base, pts, bands, yaws = [base.yaw]) {
    let best = null;
    for (const yaw of yaws) for (const b of bands) {
      const c = { ...base, yaw, ox: 0, oy: 0 }; let x0, x1, y0, y1;
      const meas = () => { x0 = y0 = 1e9; x1 = y1 = -1e9; aim(fitCam, c); for (const p of pts) { fv.copy(p).project(fitCam); x0 = Math.min(x0, fv.x); x1 = Math.max(x1, fv.x); y0 = Math.min(y0, fv.y); y1 = Math.max(y1, fv.y); } };
      for (let it = 0; it < 6; it++) {
        meas();
        const k = Math.max((y1 - y0) / Math.max(0.05, b.y1 - b.y0), (x1 - x0) / Math.max(0.05, b.x1 - b.x0));
        c.w = Math.min(base.w * 4, Math.max(base.w * (b.minW || 0.3), c.w * k));
      }
      meas();
      c.ox = (b.x0 + b.x1) / 2 - (x0 + x1) / 2; c.oy = (b.y0 + b.y1) / 2 - (y0 + y1) / 2;
      c.score = c.w * (yaw === base.yaw ? 1 : 1.12);
      if (!best || c.score < best.score) best = c;
    }
    return best;
  }
  function refit() {
    if (FR.gt == null || !KP.plan.length) return;
    const nx = px => (px / cw) * 2 - 1, ny = px => 1 - (px / ch) * 2;
    const mt = Math.max(16, ch * 0.035), mb = Math.max(14, ch * 0.035), mx = Math.max(16, cw * 0.05);
    const full = { x0: nx(mx), x1: nx(cw - mx), y0: ny(ch - mb), y1: ny(FR.gt + mt) };
    Fg.plan = fitOne(C_PLAN, KP.plan, [{ ...full, minW: 0.8 }], [C_PLAN.yaw, 0.3, 0.6]);
    Fg.exec = fitOne(C_EXEC, KP.exec, [{ ...full, y0: ny(ch - Math.max(22, ch * 0.03)), x0: nx(Math.max(12, cw * 0.03)), x1: nx(cw - Math.max(12, cw * 0.03)), y1: ny(FR.gt - 16) }]);
    // control: the excavator centred near 63.5% vh, as large as the room between the tabs and the HUD allows
    const hud = FR.hud.filter(r => r && r.r - r.l > 2 && r.b - r.t > 2);
    // top: clear of the page's control hint (one mono line just under the tabs, right aligned) on desktop
    const m = Math.max(12, cw * 0.012), top = cw >= 768 ? FR.gt + Math.max(36, cw * 0.034) : FR.gt - 24;
    let l = mx, r = cw - mx, hTop = ch - mb, hBot = Math.min(ch - mb, ch * 0.88);
    for (const h of hud) { if ((h.l + h.r) / 2 < cw / 2) l = Math.max(l, h.r + m); else r = Math.min(r, h.l - m); hTop = Math.min(hTop, h.t - m); hBot = Math.max(Math.min(hBot, h.b), FR.gt + ch * 0.2); }
    const band = (x0, x1, y0, y1) => { const h = Math.min(y1 - y0, ch * 0.34), yc = Math.min(Math.max(ch * 0.635, y0 + h / 2), y1 - h / 2); return { x0: nx(x0), x1: nx(x1), y0: ny(yc + h / 2), y1: ny(yc - h / 2), minW: 0.3 }; };
    const bands = [];
    if (r - l > cw * 0.22) bands.push(band(l, r, top, hBot));
    if (hud.length && hTop - top > ch * 0.16) bands.push(band(mx, cw - mx, top, hTop));
    if (!bands.length) bands.push(band(mx, cw - mx, top, ch - mb));
    Fg.ctrl = fitOne(C_CTRL, KP.ctrl, bands);
    if (FR.snap) { Object.assign(F.plan, Fg.plan); Object.assign(F.ctrl, Fg.ctrl); Object.assign(F.exec, Fg.exec); FR.snap = false; }
  }
  function easeFits(dt) {
    const k = 1 - Math.exp(-dt * 5);
    for (const n of ['plan', 'ctrl', 'exec']) { const g = Fg[n]; if (!g) continue; const f = F[n]; f.w += (g.w - f.w) * k; f.ox += (g.ox - f.ox) * k; f.oy += (g.oy - f.oy) * k; f.yaw += (g.yaw - f.yaw) * k; }
  }

  // framing key points: plan + exec in world space, control = the excavator relative to the game's focus (5 back, 1 right)
  for (const P of PLAN) { boxPts(P.m, P.arm, P.x, P.z, P.yaw, KP.plan); for (const [x, z] of P.zone) KP.plan.push(new THREE.Vector3(x, 0, z)); }
  for (const E of EXEC) boxPts(E.m, E.arm, E.x, E.z, E.yaw, KP.exec, 3000);
  boxPts(gameExc, [0.22, -1.5, -0.35, 0], -5, 1, 0.35, KP.ctrl);

  function refitMaybe() {
    if (FR.gt == null) return;
    const key = cw + 'x' + ch + '|' + Math.round(FR.gt / 2) + '|' + FR.hud.map(r => r ? [r.l, r.t, r.r, r.b].map(v => Math.round(v / 2)).join(',') : '').join(';');
    if (key !== FR.key) { FR.key = key; refit(); }
  }

  // ------------------------------------------------------------------ inputs
  // missionTop: top of .d6-mission-in in canvas px (preferred); mapY: top of the map itself in canvas px
  const S = { topo: 0, morph: 0, mode: 0, modeT: 0, flatten: 0, mapY: null, missionTop: null };
  let ov = null; // click override: { mode, t0, fromT, fromF }
  let mF = 0, effT = 0, effFlat = 0, mx = 0, my = 0, smx = 0, smy = 0;
  const onMove = e => { const r = host.getBoundingClientRect(); mx = (e.clientX - r.left) / Math.max(1, r.width) - 0.5; my = (e.clientY - r.top) / Math.max(1, r.height) - 0.5; };
  window.addEventListener('pointermove', onMove, { passive: true });

  // ------------------------------------------------------------------ telemetry
  const telFns = []; let telAcc = 0;
  const tel = { height: 0, yaw: 0, roll: 0, body: 0, speed: 0, state: 'IDLE', blade: 0 };

  // ------------------------------------------------------------------ size / visibility
  let alloc = false, freeT = 0;
  function setBuf() {
    if (alloc) renderer.setSize(cw, ch, false);
    const v = new THREE.Vector2(); renderer.getDrawingBufferSize(v); RES.value.copy(v);
    PRU.value = alloc ? v.x / cw : renderer.getPixelRatio();
  }
  function resize() {
    cw = Math.max(1, host.clientWidth); ch = Math.max(1, host.clientHeight);
    camera.aspect = cw / ch; setBuf();
    FR.key = ''; FR.snap = true; refitMaybe();
  }
  let running = false, raf = 0, last = 0, t = 0;
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null; if (ro) ro.observe(host); else window.addEventListener('resize', resize);
  resize();

  // ------------------------------------------------------------------ data
  const ready = (async () => {
    const res = await fetch(topoUrl);
    if (!res.ok) throw new Error('topo ' + res.status);
    const buf = await res.arrayBuffer();
    const dv = new DataView(buf), n = dv.getUint32(0, true);
    const lens = new Uint32Array(n); let o = 4, total = 0;
    for (let i = 0; i < n; i++) { lens[i] = dv.getUint32(o, true); o += 4; total += lens[i]; }
    const px = new Float32Array(total), py = new Float32Array(total);
    for (let i = 0; i < total; i++) { px[i] = dv.getInt16(o, true) / 10; py[i] = dv.getInt16(o + 2, true) / 10; o += 4; }
    const LONG = 200; // a stray closing segment in the export spans the map: skip anything this long
    let segs = 0; for (let i = 0, b = 0; i < n; b += lens[i++]) for (let k = 1; k < lens[i]; k++) if (Math.hypot(px[b + k] - px[b + k - 1], py[b + k] - py[b + k - 1]) < LONG) segs++;
    const L = segBuffers(THREE, segs, 2), del = new Float32Array(segs * 4);
    const dp = new Float32Array(total * 3); let nd = 0;
    let s = 0;
    for (let i = 0, b = 0; i < n; b += lens[i++]) {
      const C = lens[i]; if (C < 2) continue;
      let len = 0, cx = 0, cy = 0; for (let k = 1; k < C; k++) len += Math.hypot(px[b + k] - px[b + k - 1], py[b + k] - py[b + k - 1]);
      for (let k = 0; k < C; k++) { cx += px[b + k]; cy += py[b + k]; } cx /= C; cy /= C;
      const d = clamp01(0.45 * rnd() + 0.42 * (1 - cx / MAP_W) + 0.13 * (cy / 1195.6) + (len < 120 ? 0.1 : 0));
      const closed = Math.hypot(px[b] - px[b + C - 1], py[b] - py[b + C - 1]) < 0.5;
      for (let k = 0; k < (closed ? C - 1 : C); k++) { dp[nd * 3] = px[b + k]; dp[nd * 3 + 1] = py[b + k]; dp[nd * 3 + 2] = rnd(); nd++; }
      let acc = 0;
      for (let k = 1; k < C; k++) {
        const a = b + k - 1, c = b + k, sl = Math.hypot(px[c] - px[a], py[c] - py[a]);
        const u0 = len > 0 ? acc / len : 0; acc += sl; const u1 = len > 0 ? acc / len : 1;
        if (sl >= LONG) continue;
        for (let q = 0; q < 4; q++) {
          const e = q >> 1, v = s * 4 + q;
          L.pos.set(e ? [px[c], py[c], u1] : [px[a], py[a], u0], v * 3); L.oth.set(e ? [px[a], py[a]] : [px[c], py[c]], v * 2); del[v] = d;
        }
        s++;
      }
    }
    L.geo.setAttribute('aDel', new THREE.BufferAttribute(del, 1));
    lines = new THREE.Mesh(L.geo, lMat); lines.frustumCulled = false; lines.renderOrder = 0; lines.visible = false; mapScene.add(lines);
    const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.BufferAttribute(dp.slice(0, nd * 3), 3));
    dg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    mdots = new THREE.Points(dg, dMat); mdots.frustumCulled = false; mdots.renderOrder = 1; mdots.visible = false; mapScene.add(mdots);
    points.visible = true;
  })();

  // ------------------------------------------------------------------ per frame
  function placeMachine(m, x, z, yaw, amp, opacity) {
    m.setOpacity(opacity); if (opacity <= 0.004) return;
    const r = m.root; r.position.set(x, hField(x, z) * amp, z); r.rotation.y = yaw;
    if (amp > 0.001) {
      const e = 1.6, dx = (hField(x + e, z) - hField(x - e, z)) * amp / (2 * e), dz = (hField(x, z + e) - hField(x, z - e)) * amp / (2 * e);
      const fx = Math.cos(yaw), fz = -Math.sin(yaw);
      r.rotation.z = Math.atan(dx * fx + dz * fz) * 0.8; r.rotation.x = -Math.atan(dx * -fz + dz * fx) * 0.8;
      r.position.y -= 0.15;
    } else { r.rotation.z = 0; r.rotation.x = 0; }
  }

  // where the map sits: CSS px origin + scale. Desktop keeps the Figma frame (1600 wide); phones scale it up so
  // the bright right half stays on screen.
  function mapPlace(topo, morph) {
    const desk = cw >= 768, k = desk ? cw / 1600 : cw / 820;
    MU.uCap.value = desk ? 1 : 0;
    const ox = desk ? MAP_X * k : cw + 24 - MAP_W * k;
    let top;
    if (S.missionTop != null) top = S.missionTop - (desk ? MAP_ABOVE : 140) * k;
    else if (S.mapY != null) top = S.mapY;
    else {
      // no page input: follow the desktop layout from the scroll progress (mission ~820 design px tall,
      // topo runs while its top goes from the bottom to 12%, morph while the solutions top goes bottom to top)
      const Hd = 1600 * ch / cw, mt = morph > 0 ? Hd - 820 - morph * Hd : Hd * (1 - 0.88 * topo);
      top = (mt + 230 - MAP_ABOVE) * (cw / 1600);
    }
    MU.uMapO.value.set(ox, top); MU.uMapK.value = k;
  }

  function frame(dt) {
    t += dt;
    // inputs: a click override holds until the scroll inputs change
    const now = t;
    let mode = S.mode;
    if (ov) {
      mode = ov.mode; const k = easeIO(clamp01((now - ov.t0) / (ov.mode === 2 ? 4.5 : 1.6)));
      effT = lerp(ov.fromT, ov.mode === 2 ? 0.75 : 0.5, k);
      effFlat = lerp(ov.fromF, ov.mode === 2 ? 1 : 0, easeIO(clamp01((now - ov.t0) / 1.8)));
    } else { effT = S.modeT; effFlat = S.flatten; }
    const kM = 1 - Math.exp(-dt * 2.6);
    mF += (mode - mF) * kM; if (Math.abs(mode - mF) < 0.0005) mF = mode;
    const morph = clamp01(S.morph), topo = clamp01(S.topo);
    const wP = clamp01(1 - Math.abs(mF)), wC = clamp01(1 - Math.abs(mF - 1)), wE = clamp01(1 - Math.abs(mF - 2));
    const mApp = sm((morph - 0.72) / 0.28);
    const toCtrl = sm(Math.min(mF, 1)), toExec = sm(mF - 1);
    const amp = toCtrl * (1 - clamp01(effFlat)) * mApp * AMP_C;
    // control rig (dig game machine, zone, dug points): tweens out as soon as control is left, gone by modeT ~0.15
    // in exec, then resets so the next visit starts on a fresh demo
    if (mode === 1) { gOut = Math.min(1, gOut + dt / 0.5); gReset = false; }
    else { gOut = Math.max(0, gOut - dt / 0.18); if (mode === 2) gOut = Math.min(gOut, 1 - sm(effT / 0.15)); }
    if (gOut <= 0 && !gReset) { gReset = true; game.reset(); }
    // tab switch: the outgoing machines clear in 0.18 s instead of riding the slower camera ease
    for (let i = 0; i < 3; i++) mK[i] = i === mode ? Math.min(1, mK[i] + dt / 0.3) : Math.max(0, mK[i] - dt / 0.18);

    // map: lines draw in with topo; vertices snap to the lattice over morph 0..0.4
    mapPlace(topo, morph);
    MU.uTopo.value = topo; MU.uMorph.value = morph;
    const mapOut = 1 - sm((morph - 0.38) / 0.27); // gone by ~0.65, before the solutions heading settles
    MU.uLineA.value = mapOut; MU.uDotA.value = mapOut;
    if (lines) { lines.visible = topo > 0.001 && mapOut > 0.003; mdots.visible = morph > 0.02 && mapOut > 0.003; }

    // dot field
    U.uApp.value = sm((morph - 0.42) / 0.5); U.uAmp.value = amp; U.uCtrl.value = toCtrl * (1 - clamp01(effFlat)); U.uCutK.value = gOut;
    U.uS4.value = toExec; U.uS2.value = Math.max(1 - toCtrl, toExec);
    U.uPlanZ.value = wP * mApp * mK[0]; U.uGameZ.value = wC * mApp * gOut;
    U.uSize.value = lerp(lerp(0.17, 0.11, toCtrl), 0.2, toExec);
    U.uFar.value = lerp(1e4, lerp(150, 120, toExec), toCtrl);
    // mask: nothing above the tab cards (their bottom - 40 px, soft 70 px), following the stage as it scrolls in
    const scrollIn = (1 - morph) * ch, gt = FR.gt != null ? FR.gt : ch * 0.45;
    U.uTopY.value = 1 - ((gt - 40 + scrollIn) / ch) * 2; U.uFadeW.value = (70 / ch) * 2;
    // machines fade out above the same line (40 px soft): nothing shows through the tab cards
    kit.clip.value.set((ch - (gt - 40 + scrollIn) + 40) * PRU.value, 40 * PRU.value);
    points.visible = morph > 0.3 && !!lines;

    // camera
    easeFits(dt);
    if (mF <= 1) blendC(cm, F.plan, F.ctrl, sm(mF)); else blendC(cm, F.ctrl, F.exec, sm(mF - 1));
    // control: fixed framing on the game's home; a little pointer drift until someone plays, then it freezes where
    // it is so points never slide under the cursor
    if (!(game.user || game.drawing)) { smx += (mx - smx) * (1 - Math.exp(-dt * 3)); smy += (my - smy) * (1 - Math.exp(-dt * 3)); }
    cm.tx += (game.focus.x - C_CTRL.tx) * wC; cm.tz += (game.focus.z - C_CTRL.tz) * wC;
    cm.yaw += smx * 0.12 * wC + (effT - 0.5) * 0.08 * wP + (effT - 0.5) * 0.1 * wC;
    cm.pitch += -smy * 0.05 * wC;
    if (FR.gt == null && cw / ch < 1) cm.w *= Math.max(0.55, cw / ch);
    // dive from the map view into the plan, mostly hidden below the tab mask, done by morph ~0.85
    const cb = clamp01((morph - 0.3) / 0.55), camB = cb < 0.5 ? 8 * cb ** 4 : 1 - Math.pow(-2 * cb + 2, 4) / 2;
    blendC(cs, C_MAP, cm, camB);
    // control: aim at the terrain height under the machine's home so it keeps its place in the band over the hills
    tyS += (hField(game.home.x, game.home.z) * amp * wC * camB - tyS) * (1 - Math.exp(-dt * 6));
    const dist = aim(camera, cs, tyS);
    U.uFar.value *= Math.max(1, dist / 80); // tall viewports frame from further back: keep the terrain
    U.uPx.value = ch * PRU.value / (2 * Math.tan(cs.fov * DEG / 2));

    // plan machines + zones: short crossfades so the plan and control machines barely overlap
    const pa = sm((wP - 0.35) / 0.65) * mApp * mK[0];
    for (const P of PLAN) {
      placeMachine(P.m, P.x, P.z, P.yaw, amp, pa);
      if (pa > 0.004) { const a = P.arm, s = Math.sin(t * 0.6 + P.x) * 0.06; P.m.setArm(a[0] + s, a[1] - s, a[2], a[3] + Math.sin(t * 0.35 + P.z) * 0.25); }
    }
    planZones.visible = pa > 0.004;
    pzLine.uniforms.uOpacity.value = 0.9 * pa; pzHandle.uniforms.uOpacity.value = pa; pzFill.opacity = 0.3 * pa;

    // game
    // armed (pointer live) once control is the target; active once the tilt has landed (queued clicks replay then)
    game.update(dt, { armed: mode === 1 && mApp > 0.99, active: mode === 1 && wC > 0.97 && mApp > 0.99, vis: sm((wC - 0.35) / 0.65) * mApp * gOut, amp });

    // exec machines drive in: all on screen by 30% of the mode, parked by 70%, then hold
    for (const E of EXEC) {
      const p = 1 - Math.pow(1 - clamp01((effT - E.s) / (0.7 - E.s)), 2.5);
      const back = (1 - p) * E.back, fx = Math.cos(E.yaw), fz = -Math.sin(E.yaw);
      placeMachine(E.m, E.x - fx * back, E.z - fz * back, E.yaw, amp, wE * sm(effT * 8 - E.s * 8) * mK[2]);
      if (wE > 0.004) {
        E.m.setDrive(-back / (MSCALE * EXS));
        if (E.arm) { const s = Math.sin(t * 0.5 + E.x) * 0.08 * p; E.m.setArm(E.arm[0] + s, E.arm[1] - s * 1.2, E.arm[2] + s, E.arm[3]); }
      }
    }

    // telemetry
    telAcc += dt;
    if (telFns.length && wC > 0.5 && telAcc > 0.1) {
      telAcc = 0; game.telemetry(tel);
      for (const fn of telFns) fn(tel);
    }
  }

  function draw() {
    renderer.clear();
    if (lines && (lines.visible || mdots.visible)) renderer.render(mapScene, camera);
    renderer.render(scene, camera);
  }
  function loop(ts) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0.016); last = ts;
    frame(dt); draw();
  }
  function allocate() { clearTimeout(freeT); if (!alloc) { alloc = true; setBuf(); } }

  const near = (a, b) => Math.abs((a || 0) - (b || 0)) < 1e-4;
  return {
    ready,
    setScene(o = {}) {
      const changed = (o.topo != null && !near(o.topo, S.topo)) || (o.morph != null && !near(o.morph, S.morph)) || (o.mode != null && o.mode !== S.mode) || (o.modeT != null && !near(o.modeT, S.modeT)) || (o.flatten != null && !near(o.flatten, S.flatten));
      if (o.topo != null) S.topo = o.topo; if (o.morph != null) S.morph = o.morph; if (o.mode != null) S.mode = o.mode | 0;
      if (o.modeT != null) S.modeT = o.modeT; if (o.flatten != null) S.flatten = o.flatten;
      if ('mapY' in o) S.mapY = o.mapY; if ('missionTop' in o) S.missionTop = o.missionTop;
      if (o.groundTop != null || o.hud) { if (FR.gt == null) FR.snap = true; if (o.groundTop != null) FR.gt = o.groundTop; if (o.hud) FR.hud = o.hud; refitMaybe(); }
      if (changed && ov) ov = null;
    },
    setMode(i) { i = Math.max(0, Math.min(2, i | 0)); ov = { mode: i, t0: t, fromT: i === Math.round(mF) ? effT : 0, fromF: effFlat }; },
    onTelemetry(fn) { telFns.push(fn); return () => { const k = telFns.indexOf(fn); if (k >= 0) telFns.splice(k, 1); }; },
    // dig game events for the page hint: fn({ type: 'point' | 'close' | 'dig' | 'done', points }); user actions only
    onGame(fn) { return game.on(fn); },
    resize,
    start() { allocate(); if (running) return; running = true; last = 0; raf = requestAnimationFrame(loop); },
    stop() {
      running = false; cancelAnimationFrame(raf);
      clearTimeout(freeT); freeT = setTimeout(() => { if (!running && alloc) { alloc = false; renderer.setSize(1, 1, false); setBuf(); } }, 2500);
    },
    // test hook: render one frame now (headless screenshots)
    renderNow(dt = 0.016, n = 1) { allocate(); for (let i = 0; i < n; i++) frame(dt); draw(); },
    get game() { return game; },
    get stats() {
      const v = new THREE.Vector2(); renderer.getDrawingBufferSize(v);
      const box = m => { if (!m.root.visible) return null; bx.setFromObject(m.root, true); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9; for (const X of [bx.min.x, bx.max.x]) for (const Y of [bx.min.y, bx.max.y]) for (const Z of [bx.min.z, bx.max.z]) { fv.set(X, Y, Z).project(camera); x0 = Math.min(x0, fv.x); x1 = Math.max(x1, fv.x); y0 = Math.min(y0, fv.y); y1 = Math.max(y1, fv.y); } return [Math.round((x0 + 1) / 2 * cw), Math.round((1 - y1) / 2 * ch), Math.round((x1 + 1) / 2 * cw), Math.round((1 - y0) / 2 * ch)]; };
      return { buffer: [v.x, v.y], pr: PRU.value, calls: renderer.info.render.calls, game: box(gameExc), exec: [exE, exB, exR].map(box), plan: [planExc, planBh].map(box) };
    },
    dispose() {
      this.stop(); clearTimeout(freeT); window.removeEventListener('pointermove', onMove); if (ro) ro.disconnect(); else window.removeEventListener('resize', resize);
      game.dispose();
      for (const sc of [scene, mapScene]) sc.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      for (const m of [planExc, planBh, gameExc, exE, exB, exR]) m.dispose();
      kit.disposeAll();
      for (const m of [pMat, lMat, dMat, pzLine, pzHandle, pzFill]) m.dispose();
      renderer.dispose(); canvas.remove();
    },
  };
}
