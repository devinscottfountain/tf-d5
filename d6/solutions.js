// solutions.js: D6 mission + solutions WebGL layer. Topographic map draws in, its contours turn into the
// solutions dot grid, then three modes: Planning (top-down grid, machines with zones), Mission Control
// (3/4 view, rolling lidar terrain, the D3 dig game) and Accelerated Operations (flat grid, three machines
// drive in). One transparent canvas fills `host`; the page drives it with setScene() from scroll.
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
const easeOut = t => 1 - Math.pow(1 - clamp01(t), 3);
const DEG = Math.PI / 180;

// design frame: 1600 px wide; the Figma map is 1774.5 x 1195.6 at x = -312
const MAP_W = 1774.5, MAP_H = 1195.6, MAP_X = -312, MAP_SCALE = 0.1; // world units per design px in the map view
const MSCALE = 1.4; // machine scale (model metres -> world)

export function createSolutions({ THREE, host, topoUrl, quality = 'high' }) {
  const LOW = quality === 'low';
  const renderer = new THREE.WebGLRenderer({ antialias: !LOW, alpha: true, powerPreference: 'high-performance' });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(LOW ? 1 : Math.min(window.devicePixelRatio || 1, 2));
  const canvas = renderer.domElement;
  canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;pointer-events:none;touch-action:pan-y;-webkit-tap-highlight-color:transparent';
  if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
  host.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 4000);
  let cw = 1, ch = 1;

  // ------------------------------------------------------------------ dot grid
  const SP = LOW ? 0.5 : 0.4, GW = 120, GD = 100;
  const NX = Math.round(GW / SP) + 1, NZ = Math.round(GD / SP) + 1, N = NX * NZ;
  const X0 = -GW / 2, Z0 = -GD / 2;
  const gx = new Float32Array(N), gz = new Float32Array(N);
  const gPos = new Float32Array(N * 3), aSrc = new Float32Array(N * 2), aSeed = new Float32Array(N * 4);
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
  pGeo.setAttribute('aSrc', new THREE.BufferAttribute(aSrc, 2));
  pGeo.setAttribute('aSeed', new THREE.BufferAttribute(aSeed, 4));
  const cutAttr = new THREE.BufferAttribute(aCut, 1).setUsage(THREE.DynamicDrawUsage); pGeo.setAttribute('aCut', cutAttr);
  const zoneAttr = new THREE.BufferAttribute(aZone, 2).setUsage(THREE.DynamicDrawUsage); pGeo.setAttribute('aZone', zoneAttr);
  pGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  grid.cutAttr = cutAttr; grid.zoneAttr = zoneAttr;

  const MAPFADE = /* glsl */ `
  float mapA(vec2 m){ float ax = clamp((m.x - 420.) / 1250., 0., 1.); float ay = smoothstep(80., 760., m.y); return ax * (.25 + .75*ax) * ay; }`;
  const U = {
    uMorph: { value: 0 }, uOff: { value: new THREE.Vector2() }, uMS: { value: MAP_SCALE }, uAmp: { value: 0 }, uLift: { value: 6 },
    uPlanZ: { value: 0 }, uGameZ: { value: 0 }, uS2: { value: 1 }, uS4: { value: 0 }, uSize: { value: 0.12 }, uPx: { value: 1000 },
    uTopY: { value: 2 }, uAlpha: { value: 1 }, uFar: { value: 1e4 }, uCtrl: { value: 0 }, uHalf: { value: new THREE.Vector2(GW / 2, GD / 2) }, uPR: { value: 1 },
  };
  const pMat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec2 aSrc; attribute vec4 aSeed; attribute float aCut; attribute vec2 aZone;
      uniform float uMorph, uMS, uAmp, uLift, uPlanZ, uGameZ, uS2, uS4, uSize, uPx, uFar, uCtrl, uPR, uTopY;
      uniform vec2 uOff, uHalf;
      varying vec3 vCol; varying float vA;
      ${H_GLSL}
      ${MAPFADE}
      void main(){
        float k = clamp((uMorph - aSeed.y*.5) / .5, 0., 1.); k = k*k*(3. - 2.*k);
        float h = hF(position.xz)*uAmp - aCut;
        vec3 g = vec3(position.x, h, position.z);
        vec3 s = vec3(uOff.x + aSrc.x*uMS, 0., uOff.y + aSrc.y*uMS);
        vec3 p = mix(s, g, k);
        p.y += sin(k*3.14159)*uLift*(.3 + aSeed.z);
        vec4 mv = modelViewMatrix*vec4(p, 1.);
        gl_Position = projectionMatrix*mv;
        // grid colour: cyan to white in plan, height ramp in control
        float hn = clamp((h + 2.5) / 9., 0., 1.);
        vec3 cHi = vec3(.42, .75, .9), cW = vec3(.86, .95, 1.);
        vec3 plan = mix(cHi, cW, aSeed.x*aSeed.x);
        vec3 ctrl = mix(vec3(.1, .3, .44), vec3(.55, .88, 1.), hn);
        ctrl = mix(ctrl, cW, step(.9, aSeed.x)*.55);
        vec3 gc = mix(plan, ctrl, uCtrl);
        float zt = clamp(aZone.x*uPlanZ + aZone.y*uGameZ, 0., 1.);
        gc = mix(gc, vec3(.62, .88, 1.), zt);
        gc = mix(gc, vec3(1.), clamp(aCut / 1.4, 0., 1.)*aZone.y);
        gc = mix(gc, cW, clamp(-aCut / 1.2, 0., 1.));
        float vis = 1. - uS2*(1. - step(.5, aSeed.w)) - uS4*(1. - step(1.5, aSeed.w));
        float edge = smoothstep(uHalf.x, uHalf.x - 7., abs(position.x))*smoothstep(uHalf.y, uHalf.y - 6., abs(position.z));
        float far = smoothstep(uFar, uFar*.55, -mv.z);
        float ny = gl_Position.y / gl_Position.w;
        float ga = smoothstep(uTopY + .14, uTopY - .04, ny)*(.45 + .55*aSeed.x)*clamp(vis, 0., 1.)*edge*far*(1. + zt*.6);
        float sa = mapA(aSrc)*.9*smoothstep(0., .05, uMorph);
        vCol = mix(vec3(1.), gc, k);
        vA = mix(sa, ga, k) + sin(k*3.14159)*.45*smoothstep(0., .1, uMorph);
        float ps = uSize*(.75 + .5*aSeed.z)*(1. + zt*.25)*uPx / max(.1, -mv.z);
        ps = mix(max(ps, 1.2*uPR), ps, k);
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

  // ------------------------------------------------------------------ topo contour lines (built when the data loads)
  const LU = { uTopo: { value: 0 }, uOff: U.uOff, uMS: U.uMS, uLineA: { value: 1 } };
  const lMat = new THREE.ShaderMaterial({
    uniforms: LU, transparent: true, depthWrite: false, depthTest: false,
    vertexShader: /* glsl */ `
      attribute float aD; uniform vec2 uOff; uniform float uMS;
      varying float vAl, vD; varying vec2 vM;
      void main(){ vAl = position.z; vD = aD; vM = position.xy;
        gl_Position = projectionMatrix*modelViewMatrix*vec4(uOff.x + position.x*uMS, 0., uOff.y + position.y*uMS, 1.); }`,
    fragmentShader: /* glsl */ `
      uniform float uTopo, uLineA; varying float vAl, vD; varying vec2 vM;
      ${MAPFADE}
      void main(){
        float pr = clamp((uTopo*1.08 - vD*.55) / .45, 0., 1.);
        if (vAl > pr) discard;
        float head = (1. - step(1., pr))*smoothstep(pr - .04, pr, vAl);
        float a = (mapA(vM)*.62 + head*.35)*uLineA;
        if (a < .003) discard;
        gl_FragColor = vec4(1., 1., 1., a);
      }`,
  });
  let lines = null;

  // ------------------------------------------------------------------ machines
  const kit = createMachineKit(THREE);
  const mk = (fn) => { const m = fn(); m.root.scale.setScalar(MSCALE); m.root.rotation.order = 'YXZ'; scene.add(m.root); m.setOpacity(0); return m; };
  const planExc = mk(kit.excavator), planBh = mk(kit.backhoe);
  const gameExc = mk(kit.excavator);
  const exE = mk(kit.excavator), exB = mk(kit.backhoe), exR = mk(kit.roller);

  // plan layout (world xz), zones are polygons around each machine
  const PLAN = [
    { m: planExc, x: 10, z: -6, yaw: 2.2, arm: [0.2, -1.1, -0.4, 0], zone: [[4.5, -9.5], [10.5, -13.0], [17.5, -8.5], [14.5, -2.5], [6.5, -2.0]] },
    { m: planBh, x: -15, z: 12, yaw: -0.65, arm: [0.9, -1.9, -1.0, 0], zone: [[-10.5, 2.5], [-3.5, 1.0], [2.0, 9.0], [-6.0, 21.0], [-14.0, 12.0]] },
  ];
  const zoneLineMat = new THREE.LineBasicMaterial({ color: 0x97ddfb, transparent: true, opacity: 0, depthTest: false });
  const zoneFillMat = new THREE.MeshBasicMaterial({ color: 0x6cc0e6, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
  const handleMat = new THREE.PointsMaterial({ color: 0x6cc0e6, size: 7, sizeAttenuation: false, transparent: true, opacity: 0, depthTest: false });
  const planZones = new THREE.Group(); scene.add(planZones);
  const inPoly = (poly, x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
  for (const P of PLAN) {
    const pts = P.zone.map(([x, z]) => new THREE.Vector3(x, 0.06, z));
    const ln = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), zoneLineMat); ln.renderOrder = 5;
    const sh = new THREE.Shape(P.zone.map(([x, z]) => new THREE.Vector2(x, -z)));
    const fill = new THREE.Mesh(new THREE.ShapeGeometry(sh).rotateX(-Math.PI / 2), zoneFillMat); fill.position.y = 0.04; fill.renderOrder = 4;
    const hd = new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts), handleMat); hd.renderOrder = 6;
    planZones.add(fill, ln, hd);
    let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9; for (const [x, z] of P.zone) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let i = Math.max(0, Math.floor((x0 - X0) / SP)); i <= Math.min(NX - 1, Math.ceil((x1 - X0) / SP)); i++)
      for (let j = Math.max(0, Math.floor((z0 - Z0) / SP)); j <= Math.min(NZ - 1, Math.ceil((z1 - Z0) / SP)); j++) { const k = i * NZ + j; if (inPoly(P.zone, gx[k], gz[k])) aZone[k * 2] = 1; }
  }

  // exec arrangement: final poses, all facing the same way, drive in along their heading
  const EXEC = [
    { m: exE, x: -9.0, z: 4.6, yaw: 3.4, arm: [0.25, -1.25, -0.9, 0], delay: 0, back: 34 },
    { m: exB, x: 0, z: 0, yaw: 3.4, arm: [0.95, -1.9, -1.0, 0], delay: 0.14, back: 38 },
    { m: exR, x: 12.5, z: 2.1, yaw: 3.4, arm: null, delay: 0.28, back: 42 },
  ];

  // ------------------------------------------------------------------ control game
  const game = createGame({ THREE, scene, canvas, camera, exc: gameExc, grid, hField, MSCALE, zoneLineMat, zoneFillMat, handleMat });

  // ------------------------------------------------------------------ camera states
  // tx, tz: look target; w: visible width (world) at the target; pitch, yaw (rad); fov; oy: NDC y of the target
  const C_MAP = { tx: 0, tz: 0, w: 160, pitch: 89.9 * DEG, yaw: 0, fov: 12, oy: 0 };
  const C_PLAN = { tx: 0, tz: 3, w: 90, pitch: 66 * DEG, yaw: 0, fov: 30, oy: -0.32 };
  const C_CTRL = { tx: 0, tz: 0, w: 60, pitch: 27 * DEG, yaw: -0.42, fov: 32, oy: -0.45 };
  const C_EXEC = { tx: -2.1, tz: 3.9, w: 44, pitch: 35 * DEG, yaw: 0.62, fov: 30, oy: -0.46 };
  const cs = { tx: 0, tz: 0, w: 0, pitch: 0, yaw: 0, fov: 0, oy: 0 }, cm = { ...cs };
  const blendC = (o, a, b, t) => { for (const k in o) o[k] = lerp(a[k], b[k], t); return o; };
  const tgt = new THREE.Vector3();

  // ------------------------------------------------------------------ inputs
  const S = { topo: 0, morph: 0, mode: 0, modeT: 0, flatten: 0, mapY: null };
  let ov = null; // click override: { mode, t0, fromT, fromF }
  let mF = 0, effT = 0, effFlat = 0, mx = 0, my = 0, smx = 0, smy = 0;
  const onMove = e => { const r = host.getBoundingClientRect(); mx = (e.clientX - r.left) / Math.max(1, r.width) - 0.5; my = (e.clientY - r.top) / Math.max(1, r.height) - 0.5; };
  window.addEventListener('pointermove', onMove, { passive: true });

  // ------------------------------------------------------------------ telemetry
  const telFns = []; let telAcc = 0;
  const tel = { height: 0, yaw: 0, roll: 0, body: 0, speed: 0, state: 'IDLE', blade: 0 };

  // ------------------------------------------------------------------ size / visibility
  function resize() {
    cw = Math.max(1, host.clientWidth); ch = Math.max(1, host.clientHeight);
    renderer.setSize(cw, ch, false); camera.aspect = cw / ch;
    U.uPR.value = renderer.getPixelRatio();
    handleMat.size = 7 * renderer.getPixelRatio();
    dirty = true;
  }
  let dirty = true, onScreen = true, running = false, raf = 0, last = 0, t = 0;
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null; if (ro) ro.observe(host); else window.addEventListener('resize', resize);
  const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; }, { rootMargin: '100px' }) : null; if (io) io.observe(host);
  resize();

  // ------------------------------------------------------------------ data
  const ready = (async () => {
    const buf = await (await fetch(topoUrl)).arrayBuffer();
    const dv = new DataView(buf), n = dv.getUint32(0, true);
    const lens = new Uint32Array(n); let o = 4, total = 0;
    for (let i = 0; i < n; i++) { lens[i] = dv.getUint32(o, true); o += 4; total += lens[i]; }
    const px = new Float32Array(total), py = new Float32Array(total);
    for (let i = 0; i < total; i++) { px[i] = dv.getInt16(o, true) / 10; py[i] = dv.getInt16(o + 2, true) / 10; o += 4; }
    // segments with arc position, per polyline delay
    let segs = 0; for (let i = 0; i < n; i++) segs += Math.max(0, lens[i] - 1);
    const lp = new Float32Array(segs * 6), ld = new Float32Array(segs * 2);
    let s = 0, b = 0, totLen = 0;
    for (let i = 0; i < n; i++) {
      const L = lens[i]; if (L < 2) { b += L; continue; }
      let len = 0, cx = 0, cy = 0; for (let k = 1; k < L; k++) len += Math.hypot(px[b + k] - px[b + k - 1], py[b + k] - py[b + k - 1]);
      for (let k = 0; k < L; k++) { cx += px[b + k]; cy += py[b + k]; } cx /= L; cy /= L; totLen += len;
      const d = clamp01(0.45 * rnd() + 0.42 * (1 - cx / MAP_W) + 0.13 * (cy / MAP_H) + (len < 120 ? 0.1 : 0));
      let acc = 0;
      for (let k = 1; k < L; k++) {
        const a = b + k - 1, c = b + k, sl = Math.hypot(px[c] - px[a], py[c] - py[a]);
        lp[s * 6] = px[a]; lp[s * 6 + 1] = py[a]; lp[s * 6 + 2] = len > 0 ? acc / len : 0;
        acc += sl;
        lp[s * 6 + 3] = px[c]; lp[s * 6 + 4] = py[c]; lp[s * 6 + 5] = len > 0 ? acc / len : 1;
        ld[s * 2] = d; ld[s * 2 + 1] = d; s++;
      }
      b += L;
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute('position', new THREE.BufferAttribute(lp, 3)); lg.setAttribute('aD', new THREE.BufferAttribute(ld, 1));
    lg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    lines = new THREE.LineSegments(lg, lMat); lines.frustumCulled = false; lines.renderOrder = 0; scene.add(lines);

    // sample N points evenly along the contours, then pair them with grid points band by band (left maps to left)
    const sx = new Float32Array(N), sy = new Float32Array(N), step = totLen / N;
    let si = 0, carry = 0; b = 0;
    for (let i = 0; i < n && si < N; i++) {
      const L = lens[i];
      for (let k = 1; k < L && si < N; k++) {
        const a = b + k - 1, c = b + k, sl = Math.hypot(px[c] - px[a], py[c] - py[a]);
        let u = carry; while (u < sl && si < N) { const f = u / sl; sx[si] = px[a] + (px[c] - px[a]) * f; sy[si] = py[a] + (py[c] - py[a]) * f; si++; u += step; }
        carry = u - sl;
      }
      b += L;
    }
    for (; si < N; si++) { const r = (rnd() * total) | 0; sx[si] = px[r]; sy[si] = py[r]; }
    const ord = new Uint32Array(N); for (let i = 0; i < N; i++) ord[i] = i;
    const sorted = Array.from(ord).sort((p, q) => sx[p] - sx[q]);
    const BAND = 8; let used = 0;
    for (let c0 = 0; c0 < NX; c0 += BAND) {
      const c1 = Math.min(NX, c0 + BAND), cnt = (c1 - c0) * NZ;
      const src = sorted.slice(used, used + cnt).sort((p, q) => sy[p] - sy[q]); used += cnt;
      const dst = []; for (let j = 0; j < NZ; j++) for (let i = c0; i < c1; i++) dst.push(i * NZ + j);
      for (let k = 0; k < cnt; k++) { const g = dst[k], q = src[k]; aSrc[g * 2] = sx[q]; aSrc[g * 2 + 1] = sy[q]; }
    }
    pGeo.attributes.aSrc.needsUpdate = true;
    points.visible = true; dirty = true;
  })();

  // ------------------------------------------------------------------ per frame
  const wv = new THREE.Vector3();
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
    const amp = toCtrl * (1 - clamp01(effFlat)) * mApp;

    // map placement
    const Hd = 1600 * ch / cw;
    const mapYd = S.mapY != null ? S.mapY * 1600 / cw : lerp(Hd * 0.6, -470, sm(topo));
    U.uOff.value.set((MAP_X - 800) * MAP_SCALE, (mapYd - Hd / 2) * MAP_SCALE);
    LU.uTopo.value = topo; LU.uLineA.value = 1 - sm(morph / 0.4);
    if (lines) lines.visible = LU.uLineA.value > 0.003 && topo > 0.001;

    // points
    U.uMorph.value = morph; U.uAmp.value = amp; U.uCtrl.value = toCtrl * (1 - clamp01(effFlat));
    U.uS4.value = toExec; U.uS2.value = Math.max(1 - toCtrl, toExec);
    U.uPlanZ.value = wP * mApp; U.uGameZ.value = wC * mApp;
    U.uSize.value = lerp(lerp(0.17, 0.11, toCtrl), 0.2, toExec);
    U.uFar.value = lerp(1e4, lerp(150, 120, toExec), toCtrl);
    U.uLift.value = 5;
    U.uTopY.value = mF <= 1 ? lerp(0.3, 0.42, sm(mF)) : lerp(0.42, 0.24, sm(mF - 1));
    points.visible = morph > 0.001 && !!lines;

    // camera
    if (mF <= 1) blendC(cm, C_PLAN, C_CTRL, sm(mF)); else blendC(cm, C_CTRL, C_EXEC, sm(mF - 1));
    // control target follows the game, drift with the pointer
    smx += (mx - smx) * (1 - Math.exp(-dt * 3)); smy += (my - smy) * (1 - Math.exp(-dt * 3));
    cm.tx += (game.focus.x - C_CTRL.tx) * wC; cm.tz += (game.focus.z - C_CTRL.tz) * wC;
    cm.yaw += smx * 0.12 * wC + (effT - 0.5) * 0.08 * wP + (effT - 0.5) * 0.12 * wC;
    cm.pitch += -smy * 0.05 * wC;
    if (cw / ch < 1) cm.w *= Math.max(0.55, cw / ch);
    blendC(cs, C_MAP, cm, easeIO(morph));
    camera.fov = cs.fov;
    const asp = cw / ch, dist = cs.w / (2 * Math.tan(cs.fov * DEG / 2) * asp);
    tgt.set(cs.tx, 0, cs.tz);
    camera.position.set(tgt.x + dist * Math.cos(cs.pitch) * Math.sin(cs.yaw), dist * Math.sin(cs.pitch), tgt.z + dist * Math.cos(cs.pitch) * Math.cos(cs.yaw));
    camera.near = Math.max(0.5, dist * 0.05); camera.far = dist * 6 + 400;
    camera.updateProjectionMatrix();
    camera.projectionMatrix.elements[9] = -cs.oy; camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    camera.lookAt(tgt); camera.updateMatrixWorld();
    U.uPx.value = ch * renderer.getPixelRatio() / (2 * Math.tan(cs.fov * DEG / 2));

    // plan machines + zones
    const pa = wP * mApp;
    for (const P of PLAN) {
      placeMachine(P.m, P.x, P.z, P.yaw, amp, pa);
      if (pa > 0.004) { const a = P.arm, s = Math.sin(t * 0.6 + P.x) * 0.06; P.m.setArm(a[0] + s, a[1] - s, a[2], a[3] + Math.sin(t * 0.35 + P.z) * 0.25); }
    }
    planZones.visible = pa > 0.004;
    // zone materials are shared with the game; plan and game weights never overlap much
    const za = Math.max(pa, game.zoneVis * wC * mApp);
    zoneLineMat.opacity = za; handleMat.opacity = za; zoneFillMat.opacity = 0.26 * Math.max(pa, game.fillVis * wC * mApp);

    // game
    game.update(dt, { active: wC > 0.85 && mApp > 0.99, vis: wC * mApp, amp });

    // exec machines drive in
    const arrive = clamp01(effT / 0.7);
    for (const E of EXEC) {
      const p = easeOut(clamp01((arrive - E.delay) / (1 - E.delay)));
      const back = (1 - p) * E.back, fx = Math.cos(E.yaw), fz = -Math.sin(E.yaw);
      placeMachine(E.m, E.x - fx * back, E.z - fz * back, E.yaw, amp, wE * sm(p * 6));
      if (wE > 0.004) {
        E.m.setDrive(-back / MSCALE);
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

  function loop(ts) {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, last ? (ts - last) / 1000 : 0.016); last = ts;
    if (!onScreen) return;
    frame(dt);
    renderer.render(scene, camera);
  }

  const near = (a, b) => Math.abs((a || 0) - (b || 0)) < 1e-4;
  return {
    ready,
    setScene(o = {}) {
      const changed = (o.topo != null && !near(o.topo, S.topo)) || (o.morph != null && !near(o.morph, S.morph)) || (o.mode != null && o.mode !== S.mode) || (o.modeT != null && !near(o.modeT, S.modeT)) || (o.flatten != null && !near(o.flatten, S.flatten));
      if (o.topo != null) S.topo = o.topo; if (o.morph != null) S.morph = o.morph; if (o.mode != null) S.mode = o.mode | 0;
      if (o.modeT != null) S.modeT = o.modeT; if (o.flatten != null) S.flatten = o.flatten; if ('mapY' in o) S.mapY = o.mapY;
      if (changed && ov) ov = null;
    },
    setMode(i) { i = Math.max(0, Math.min(2, i | 0)); ov = { mode: i, t0: t, fromT: i === Math.round(mF) ? effT : 0, fromF: effFlat }; },
    onTelemetry(fn) { telFns.push(fn); return () => { const k = telFns.indexOf(fn); if (k >= 0) telFns.splice(k, 1); }; },
    resize,
    start() { if (running) return; running = true; last = 0; raf = requestAnimationFrame(loop); },
    stop() { running = false; cancelAnimationFrame(raf); },
    // test hook: render one frame now (headless screenshots)
    renderNow(dt = 0.016, n = 1) { for (let i = 0; i < n; i++) frame(dt); renderer.render(scene, camera); },
    get game() { return game; },
    dispose() {
      this.stop(); window.removeEventListener('pointermove', onMove); if (ro) ro.disconnect(); else window.removeEventListener('resize', resize); if (io) io.disconnect();
      game.dispose();
      scene.traverse(o => { if (o.geometry) o.geometry.dispose(); });
      for (const m of [planExc, planBh, gameExc, exE, exB, exR]) m.dispose();
      kit.disposeAll();
      for (const m of [pMat, lMat, zoneLineMat, zoneFillMat, handleMat]) m.dispose();
      renderer.dispose(); canvas.remove();
    },
  };
}
