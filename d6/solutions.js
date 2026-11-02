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
  const gPos = new Float32Array(N * 3), aSrc = new Float32Array(N * 2), aSeed = new Float32Array(N * 4), aDep = new Float32Array(N);
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
  pGeo.setAttribute('aDep', new THREE.BufferAttribute(aDep, 1));
  const cutAttr = new THREE.BufferAttribute(aCut, 1).setUsage(THREE.DynamicDrawUsage); pGeo.setAttribute('aCut', cutAttr);
  const zoneAttr = new THREE.BufferAttribute(aZone, 2).setUsage(THREE.DynamicDrawUsage); pGeo.setAttribute('aZone', zoneAttr);
  pGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  grid.cutAttr = cutAttr; grid.zoneAttr = zoneAttr;

  // morph timeline (morph 0..1): contours break into dots in sequence (BRK), each dot holds, then slides onto the lattice
  const BRK = 0.38, HOLD = 0.03, TRAV = 0.3, BRK_R = 0.62;
  const MAPFADE = /* glsl */ `
  float mapA(vec2 m){ float ax = clamp((m.x - 420.) / 1250., 0., 1.); float ay = smoothstep(0., 560., m.y); return ax * (.25 + .75*ax) * ay; }`;
  const U = {
    uMorph: { value: 0 }, uOff: { value: new THREE.Vector2() }, uMS: { value: MAP_SCALE }, uAmp: { value: 0 }, uLift: { value: 6 },
    uPlanZ: { value: 0 }, uGameZ: { value: 0 }, uS2: { value: 1 }, uS4: { value: 0 }, uSize: { value: 0.12 }, uPx: { value: 1000 },
    uTopY: { value: 2 }, uFadeW: { value: 0.14 }, uCamB: { value: 0 }, uAlpha: { value: 1 }, uFar: { value: 1e4 }, uCtrl: { value: 0 }, uHalf: { value: new THREE.Vector2(GW / 2, GD / 2) }, uPR: { value: 1 },
  };
  const pMat = new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false,
    vertexShader: /* glsl */ `
      attribute vec2 aSrc; attribute vec4 aSeed; attribute float aCut; attribute vec2 aZone; attribute float aDep;
      uniform float uMorph, uMS, uAmp, uLift, uPlanZ, uGameZ, uS2, uS4, uSize, uPx, uFar, uCtrl, uPR, uTopY, uFadeW, uCamB;
      uniform vec2 uOff, uHalf;
      varying vec3 vCol; varying float vA;
      ${H_GLSL}
      ${MAPFADE}
      void main(){
        // this dot's spot on its contour is erased at tD; it pops, holds, then slides to its lattice point
        float tD = aDep*${BRK.toFixed(3)} + aSeed.y*.012;
        float pop = smoothstep(tD - .012, tD + .004, uMorph);
        float k = clamp((uMorph - tD - ${HOLD.toFixed(3)}) / ${TRAV.toFixed(3)}, 0., 1.); k = k*k*(3. - 2.*k);
        float trav = sin(k*3.14159);
        float h = hF(position.xz)*uAmp - aCut;
        vec3 g = vec3(position.x, h, position.z);
        vec3 s = vec3(uOff.x + aSrc.x*uMS, 0., uOff.y + aSrc.y*uMS);
        vec3 p = mix(s, g, k);
        p.y += trav*uLift*(.3 + aSeed.z);
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
        float vis = 1. - uS2*uCamB*(1. - step(.5, aSeed.w)) - uS4*(1. - step(1.5, aSeed.w));
        float edge = smoothstep(uHalf.x, uHalf.x - 7., abs(position.x))*smoothstep(uHalf.y, uHalf.y - 6., abs(position.z));
        float far = smoothstep(uFar, uFar*.55, -mv.z);
        float ny = gl_Position.y / gl_Position.w;
        float ga = smoothstep(uTopY, uTopY - uFadeW, ny)*(.45 + .55*aSeed.x)*clamp(vis, 0., 1.)*edge*far*(1. + zt*.6);
        // on the contour: bright as it breaks off, a touch dimmer while it holds
        float sa = (.2 + .8*mapA(aSrc))*pop*(1. + .5*(1. - smoothstep(0., ${HOLD.toFixed(3)}, uMorph - tD)));
        vCol = mix(mix(vec3(1.), vec3(.8, .95, 1.), trav), gc, k*k);
        vA = mix(sa, ga, k) + trav*.6*(.5 + .5*aSeed.x);
        // only the major lattice dots (every 4th) make the trip visibly, so the grid reads as it forms;
        // the rest fade as they leave and come back as the camera dives in
        float major = step(1.5, aSeed.w);
        vA *= mix(max(max(1. - smoothstep(0., .3, k), .12), smoothstep(.45, .9, uCamB)), 1. + trav*.8 + k*(1. - uCamB)*.7, major);
        float ps = uSize*(.75 + .5*aSeed.z)*(1. + zt*.25)*uPx / max(.1, -mv.z);
        ps = mix(max(ps, 1.5*uPR), ps, k)*(1. + (.45 + .6*major)*trav);
        ps = max(ps, major*(1. - uCamB)*smoothstep(0., .2, k)*2.2*uPR); // the forming lattice reads from the map view
        if (ps < 1.3*uPR) { vA *= mix(1., ps / (1.3*uPR), uCamB); ps = 1.3*uPR; }
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
  const LU = { uTopo: { value: 0 }, uOff: U.uOff, uMS: U.uMS, uLineA: { value: 1 }, uBreak: { value: 0 } };
  const lMat = new THREE.ShaderMaterial({
    uniforms: LU, transparent: true, depthWrite: false, depthTest: false,
    vertexShader: /* glsl */ `
      attribute float aD; uniform vec2 uOff; uniform float uMS;
      varying float vAl, vD; varying vec2 vM;
      void main(){ vAl = position.z; vD = aD; vM = position.xy;
        gl_Position = projectionMatrix*modelViewMatrix*vec4(uOff.x + position.x*uMS, 0., uOff.y + position.y*uMS, 1.); }`,
    fragmentShader: /* glsl */ `
      uniform float uTopo, uLineA, uBreak; varying float vAl, vD; varying vec2 vM;
      ${MAPFADE}
      void main(){
        float pr = clamp((uTopo*1.08 - vD*.55) / .45, 0., 1.);
        if (vAl > pr) discard;
        // break: the line is eaten from its start, in the order its dots leave
        float br = clamp((uBreak - vD*${BRK_R.toFixed(3)}) / ${(1 - BRK_R).toFixed(3)}, 0., 1.);
        if (uBreak > 0. && vAl < br + .002) discard;
        float head = (1. - step(1., pr))*smoothstep(pr - .04, pr, vAl);
        float edge = uBreak > 0. ? (1. - step(1., br))*(1. - smoothstep(br, br + .05, vAl)) : 0.;
        float a = (mapA(vM)*.62 + head*.35 + edge*.4)*uLineA;
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
  // tx, tz: look target; w: visible width (world) at the target; pitch, yaw (rad); fov; ox, oy: NDC offset of the target.
  // Mode states are base poses: w, ox, oy are refitted so the content sits in the band below the page's tabs.
  const C_MAP = { tx: 0, tz: 0, w: 160, pitch: 89.9 * DEG, yaw: 0, fov: 12, ox: 0, oy: 0 };
  const C_PLAN = { tx: 0, tz: 3, w: 90, pitch: 66 * DEG, yaw: 0, fov: 30, ox: 0, oy: -0.32 };
  const C_CTRL = { tx: 0, tz: 0, w: 60, pitch: 27 * DEG, yaw: -0.42, fov: 32, ox: 0, oy: -0.45 };
  const C_EXEC = { tx: -2.1, tz: 3.9, w: 44, pitch: 35 * DEG, yaw: 0.62, fov: 30, ox: 0, oy: -0.38 };
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
  // Each mode's key points (machine boxes, zones) are fitted into the band below groundTop; control also keeps
  // clear of the HUD cards. Fits are recomputed on change and eased in.
  const FR = { gt: null, hud: [], key: '', snap: true };
  const fitCam = new THREE.PerspectiveCamera(30, 1, 0.5, 4000), fv = new THREE.Vector3(), bx = new THREE.Box3();
  const F = { plan: { ...C_PLAN }, ctrl: { ...C_CTRL }, exec: { ...C_EXEC } }, Fg = { plan: null, ctrl: null, exec: null };
  const KP = { plan: [], ctrl: [], exec: [] };
  if (window.__d6) window.__d6.fits = Fg; // QA: current fitted states
  // world corners of a machine's box at a pose (box measured once at the origin, then rotated about y)
  function boxPts(m, arm, x, z, yaw, out) {
    const r = m.root; r.position.set(0, 0, 0); r.rotation.set(0, 0, 0); if (arm) m.setArm(arm[0], arm[1], arm[2], arm[3] || 0);
    r.updateMatrixWorld(true); bx.setFromObject(r, true);
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const X of [bx.min.x, bx.max.x]) for (const Y of [bx.min.y, bx.max.y]) for (const Z of [bx.min.z, bx.max.z])
      out.push(new THREE.Vector3(x + X * c + Z * s, Y, z - X * s + Z * c));
  }
  const rect = (out, x0, x1, z0, z1, y = 0) => { for (const X of [x0, x1]) for (const Z of [z0, z1]) out.push(new THREE.Vector3(X, y, Z)); };
  // yaws: alternative headings (first = the designed one); a turned view wins only if it frames clearly larger
  function fitOne(base, pts, bands, yaws = [base.yaw]) {
    let best = null;
    for (const yaw of yaws) for (const b of bands) {
      const c = { ...base, yaw, ox: 0, oy: 0 }; let x0, x1, y0, y1;
      const meas = () => { x0 = y0 = 1e9; x1 = y1 = -1e9; aim(fitCam, c); for (const p of pts) { fv.copy(p).project(fitCam); x0 = Math.min(x0, fv.x); x1 = Math.max(x1, fv.x); y0 = Math.min(y0, fv.y); y1 = Math.max(y1, fv.y); } };
      for (let it = 0; it < 6; it++) {
        meas();
        const k = Math.max((y1 - y0) / Math.max(0.05, b.y1 - b.y0), (x1 - x0) / Math.max(0.05, b.x1 - b.x0));
        c.w = Math.min(base.w * 4, Math.max(base.w * b.minW, c.w * k));
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
    const top = ny(FR.gt + mt), bot = ny(ch - mb);
    const full = { x0: nx(mx), x1: nx(cw - mx), y0: bot, y1: top, minW: 0.8 };
    Fg.plan = fitOne(C_PLAN, KP.plan, [full], [C_PLAN.yaw, 0.3, 0.6]);
    Fg.exec = fitOne(C_EXEC, KP.exec, [full], [C_EXEC.yaw, 0.4]);
    // control: either between the HUD cards, or above them
    const bands = [full];
    const hud = FR.hud.filter(r => r && r.r - r.l > 2 && r.b - r.t > 2);
    if (hud.length) {
      const m = Math.max(12, cw * 0.012);
      let l = mx, r = cw - mx, hTop = ch;
      for (const h of hud) { if ((h.l + h.r) / 2 < cw / 2) l = Math.max(l, h.r + m); else r = Math.min(r, h.l - m); hTop = Math.min(hTop, h.t - m); }
      bands.length = 0;
      if (r - l > cw * 0.25) bands.push({ ...full, x0: nx(l), x1: nx(r) });
      if (hTop - (FR.gt + mt) > ch * 0.15) bands.push({ ...full, y0: ny(hTop) });
      if (!bands.length) bands.push(full);
    }
    Fg.ctrl = fitOne(C_CTRL, KP.ctrl, bands);
    if (FR.snap) { Object.assign(F.plan, Fg.plan); Object.assign(F.ctrl, Fg.ctrl); Object.assign(F.exec, Fg.exec); FR.snap = false; }
  }
  function easeFits(dt) {
    const k = 1 - Math.exp(-dt * 5);
    for (const n of ['plan', 'ctrl', 'exec']) { const g = Fg[n]; if (!g) continue; const f = F[n]; f.w += (g.w - f.w) * k; f.ox += (g.ox - f.ox) * k; f.oy += (g.oy - f.oy) * k; f.yaw += (g.yaw - f.yaw) * k; }
  }

  // framing key points: plan + exec in world space, control relative to the game's focus (machine sits 5 back, 1 right)
  for (const P of PLAN) { boxPts(P.m, P.arm, P.x, P.z, P.yaw, KP.plan); for (const [x, z] of P.zone) KP.plan.push(new THREE.Vector3(x, 0, z)); }
  for (const E of EXEC) boxPts(E.m, E.arm, E.x, E.z, E.yaw, KP.exec);
  boxPts(gameExc, [0.55, -1.5, -0.6, 0], -5, 1, 0.35, KP.ctrl); rect(KP.ctrl, -8, 9, -6, 6);

  function refitMaybe() {
    if (FR.gt == null) return;
    const key = cw + 'x' + ch + '|' + Math.round(FR.gt / 2) + '|' + FR.hud.map(r => r ? [r.l, r.t, r.r, r.b].map(v => Math.round(v / 2)).join(',') : '').join(';');
    if (key !== FR.key) { FR.key = key; refit(); }
  }

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
    dirty = true; FR.key = ''; FR.snap = true; refitMaybe();
  }
  let dirty = true, onScreen = true, running = false, raf = 0, last = 0, t = 0;
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(resize) : null; if (ro) ro.observe(host); else window.addEventListener('resize', resize);
  const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; }, { rootMargin: '100px' }) : null; if (io) io.observe(host);
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
    // segments with arc position, per polyline delay
    let segs = 0; for (let i = 0; i < n; i++) segs += Math.max(0, lens[i] - 1);
    const lp = new Float32Array(segs * 6), ld = new Float32Array(segs * 2);
    let s = 0, b = 0, totLen = 0;
    const plD = new Float32Array(n), plL = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const L = lens[i]; if (L < 2) { b += L; continue; }
      let len = 0, cx = 0, cy = 0; for (let k = 1; k < L; k++) len += Math.hypot(px[b + k] - px[b + k - 1], py[b + k] - py[b + k - 1]);
      for (let k = 0; k < L; k++) { cx += px[b + k]; cy += py[b + k]; } cx /= L; cy /= L; totLen += len;
      const d = clamp01(0.45 * rnd() + 0.42 * (1 - cx / MAP_W) + 0.13 * (cy / MAP_H) + (len < 120 ? 0.1 : 0));
      plD[i] = d; plL[i] = len;
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
    // sd: when the dot leaves (break clock), matching the line erase order: contour delay, then arc position
    const sx = new Float32Array(N), sy = new Float32Array(N), sd = new Float32Array(N), step = totLen / N;
    let si = 0, carry = 0; b = 0;
    for (let i = 0; i < n && si < N; i++) {
      const L = lens[i]; let arc = 0;
      for (let k = 1; k < L && si < N; k++) {
        const a = b + k - 1, c = b + k, sl = Math.hypot(px[c] - px[a], py[c] - py[a]);
        let u = carry; while (u < sl && si < N) {
          const f = u / sl; sx[si] = px[a] + (px[c] - px[a]) * f; sy[si] = py[a] + (py[c] - py[a]) * f;
          sd[si] = plD[i] * BRK_R + (plL[i] > 0 ? clamp01((arc + u) / plL[i]) : 0) * (1 - BRK_R); si++; u += step;
        }
        carry = u - sl; arc += sl;
      }
      b += L;
    }
    for (; si < N; si++) { const r = (rnd() * total) | 0; sx[si] = px[r]; sy[si] = py[r]; sd[si] = rnd(); }
    const ord = new Uint32Array(N); for (let i = 0; i < N; i++) ord[i] = i;
    const sorted = Array.from(ord).sort((p, q) => sx[p] - sx[q]);
    const BAND = 8; let used = 0;
    for (let c0 = 0; c0 < NX; c0 += BAND) {
      const c1 = Math.min(NX, c0 + BAND), cnt = (c1 - c0) * NZ;
      const src = sorted.slice(used, used + cnt).sort((p, q) => sy[p] - sy[q]); used += cnt;
      const dst = []; for (let j = 0; j < NZ; j++) for (let i = c0; i < c1; i++) dst.push(i * NZ + j);
      for (let k = 0; k < cnt; k++) { const g = dst[k], q = src[k]; aSrc[g * 2] = sx[q]; aSrc[g * 2 + 1] = sy[q]; aDep[g] = sd[q]; }
    }
    pGeo.attributes.aSrc.needsUpdate = true; pGeo.attributes.aDep.needsUpdate = true;
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
    LU.uTopo.value = topo; LU.uBreak.value = morph / BRK; LU.uLineA.value = 1 - sm((morph - BRK) / 0.08);
    if (lines) lines.visible = LU.uLineA.value > 0.003 && topo > 0.001;

    // points
    U.uMorph.value = morph; U.uAmp.value = amp; U.uCtrl.value = toCtrl * (1 - clamp01(effFlat));
    U.uS4.value = toExec; U.uS2.value = Math.max(1 - toCtrl, toExec);
    U.uPlanZ.value = wP * mApp; U.uGameZ.value = wC * mApp;
    U.uSize.value = lerp(lerp(0.17, 0.11, toCtrl), 0.2, toExec);
    U.uFar.value = lerp(1e4, lerp(150, 120, toExec), toCtrl);
    U.uLift.value = 5;
    // dot field fades out above the tab cards once the grid has landed (control lets the waves reach up to them)
    if (FR.gt != null) {
      const gN = 1 - (FR.gt / ch) * 2, fw = lerp(0.16, 0.09, wC);
      U.uTopY.value = lerp(1.5, gN - 0.01, sm((morph - 0.7) / 0.3)); U.uFadeW.value = fw;
    } else { U.uTopY.value = (mF <= 1 ? lerp(0.3, 0.42, sm(mF)) : lerp(0.42, 0.24, sm(mF - 1))) + 0.14; U.uFadeW.value = 0.18; }
    points.visible = morph > 0.001 && !!lines;

    // camera
    easeFits(dt);
    if (mF <= 1) blendC(cm, F.plan, F.ctrl, sm(mF)); else blendC(cm, F.ctrl, F.exec, sm(mF - 1));
    // control target follows the game, drift with the pointer
    const hold = game.drawing ? 0 : 1; // no drift while a zone is being placed
    smx += (mx * hold - smx) * (1 - Math.exp(-dt * 3)); smy += (my * hold - smy) * (1 - Math.exp(-dt * 3));
    cm.tx += (game.focus.x - C_CTRL.tx) * wC; cm.tz += (game.focus.z - C_CTRL.tz) * wC;
    cm.yaw += smx * 0.12 * wC + (effT - 0.5) * 0.08 * wP + (effT - 0.5) * 0.12 * wC;
    cm.pitch += -smy * 0.05 * wC;
    if (FR.gt == null && cw / ch < 1) cm.w *= Math.max(0.55, cw / ch);
    // the dive starts late and gently so the dots are seen leaving the contours from above first
    const cb = clamp01((morph - 0.4) / 0.6), camB = cb < 0.5 ? 8 * cb ** 4 : 1 - Math.pow(-2 * cb + 2, 4) / 2; U.uCamB.value = camB;
    blendC(cs, C_MAP, cm, camB);
    // control: aim at the terrain under the focus so the machine keeps its place in the band
    const dist = aim(camera, cs, hField(cs.tx, cs.tz) * amp * wC * camB);
    U.uFar.value *= Math.max(1, dist / 80); // tall viewports frame from further back: keep the terrain
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
      if (o.groundTop != null || o.hud) { if (FR.gt == null) FR.snap = true; if (o.groundTop != null) FR.gt = o.groundTop; if (o.hud) FR.hud = o.hud; refitMaybe(); }
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
    get stats() { let lv = 0; scene.traverse(o => { if (o.isLineSegments || o.isLine) lv += o.geometry.attributes.position.count; }); return { lineVerts: lv, points: N, calls: renderer.info.render.calls }; },
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
