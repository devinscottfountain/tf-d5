// D6 hero: a live miniature of the Solutions "control" mode for the right monitor. Non-interactive auto demo:
// a dig zone is plotted point by point and closed, the wireframe excavator swings onto it and digs, the cyan dot
// terrain dips inside the zone, then everything resets with a new zone shape (~9 s a loop).
// Renders its own small scene into a WebGLRenderTarget with the hero's renderer (no second context). The target holds
// display-referred (sRGB) values: the right screen's shader decodes media() as sRGB bytes, so every material here
// writes final colours (ShaderMaterials, plus the white / black line kit from sol-machines). A small 2D HUD card is
// composited on top in the same target.
import { createMachineKit } from './sol-machines.js';

// the Solutions control heightfield (solutions.js H_GLSL / hField), copied so the hero never loads solutions.js
const H_GLSL = /* glsl */ `
float hF(vec2 p){
  float x = p.x, z = p.y;
  float h = 2.2*sin(x*.08)*cos(z*.11) + 1.2*sin(x*.21 + z*.13) + .6*sin(z*.35 - x*.05);
  float far = 1. + max(0., -z - 6.) / 16.;
  return h*far;
}`;
const hField = (x, z) => (2.2 * Math.sin(x * 0.08) * Math.cos(z * 0.11) + 1.2 * Math.sin(x * 0.21 + z * 0.13) + 0.6 * Math.sin(z * 0.35 - x * 0.05)) * (1 + Math.max(0, -z - 6) / 16);
const AMP = 0.45, MAXV = 8, MONO = '"IBM Plex Mono", ui-monospace, monospace';
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const io = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export function createMiniControl({ THREE, renderer, width, height, quality = 'high' }) {
  const high = quality !== 'low';
  const W = width ?? (high ? 512 : 384), H = height ?? (high ? 320 : 240);
  const rt = new THREE.WebGLRenderTarget(W, H, { samples: high ? 4 : 0, depthBuffer: true });
  rt.texture.colorSpace = THREE.NoColorSpace; rt.texture.generateMipmaps = false; rt.texture.minFilter = THREE.LinearFilter;
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(36, W / H, 0.5, 200);
  cam.position.set(-10.5, 10.5, 14.5); cam.lookAt(4.2, -0.4, -1.4);
  const ground = (x, z) => hField(x, z) * AMP;
  const Y0 = ground(0, 0);

  // ---------------------------------------------------------------- dot terrain: control colour ramp, travelling waves, the dig dips inside the zone
  const NX = high ? 120 : 84, NZ = high ? 84 : 60, SX = 44, SZ = 32;
  const P = new Float32Array(NX * NZ * 3), SD = new Float32Array(NX * NZ);
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let j = 0, k = 0; j < NZ; j++) for (let i = 0; i < NX; i++, k++) {
    P[k * 3] = -14 + (i + (rnd() - 0.5) * 0.5) / (NX - 1) * SX; P[k * 3 + 1] = 0; P[k * 3 + 2] = -SZ * 0.62 + (j + (rnd() - 0.5) * 0.5) / (NZ - 1) * SZ; SD[k] = rnd(); }
  const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(P, 3)); pg.setAttribute('aSeed', new THREE.BufferAttribute(SD, 1));
  const polyU = Array.from({ length: MAXV }, () => new THREE.Vector2());
  const U = { uT: { value: 0 }, uDig: { value: 0 }, uZone: { value: 0 }, uN: { value: 0 }, uPoly: { value: polyU }, uPx: { value: H }, uAmp: { value: AMP }, uY0: { value: Y0 } };
  const pts = new THREE.Points(pg, new THREE.ShaderMaterial({
    uniforms: U, transparent: true, depthWrite: false,
    vertexShader: /* glsl */ `
      attribute float aSeed; uniform float uT, uDig, uZone, uPx, uAmp, uY0; uniform int uN; uniform vec2 uPoly[${MAXV}];
      varying vec3 vC; varying float vA;
      ${H_GLSL}
      void main(){
        vec2 p = position.xz; float r = length(p);
        float h = hF(p)*uAmp;
        h += (.28*sin(p.x*.32 + p.y*.18 - uT*1.1) + .16*sin(p.y*.55 - p.x*.12 + uT*.7)) * smoothstep(5.5, 11., r); // waves, calm round the machine
        // zone: inside test + distance to the edge
        bool inside = false; float de = 1e3;
        for (int i = 0; i < ${MAXV}; i++) { if (i >= uN) break; int j = i == 0 ? uN - 1 : i - 1;
          vec2 a = uPoly[i], b = uPoly[j];
          if (((a.y > p.y) != (b.y > p.y)) && (p.x < (b.x - a.x)*(p.y - a.y)/(b.y - a.y) + a.x)) inside = !inside;
          vec2 e = b - a; float t = clamp(dot(p - a, e)/dot(e, e), 0., 1.); de = min(de, length(p - a - e*t)); }
        float zin = inside ? 1. : 0.;
        float cut = uDig * zin * smoothstep(0., 1.3, de);
        h -= cut;
        vec4 mv = modelViewMatrix*vec4(p.x, h, p.y, 1.);
        gl_Position = projectionMatrix*mv;
        gl_PointSize = clamp(.11*uPx/-mv.z*(.8 + .5*aSeed), 1.4, 3.6);
        float hn = clamp((h - uY0 + 1.6)/3.4, 0., 1.);
        vec3 c = mix(vec3(.16, .42, .6), vec3(.6, .92, 1.), hn);
        c = mix(c, vec3(.86, .95, 1.), step(.9, aSeed)*.55);
        c = mix(c, vec3(.45, .95, 1.), zin*uZone*.6);                          // the plotted zone glows
        c = mix(c, vec3(1., .78, .35), clamp(cut/1.2, 0., 1.)*.8);             // dug points warm up with depth
        vC = c; vA = (.7 + .3*aSeed) * smoothstep(-24., -13., position.z) * smoothstep(30., 22., position.x);
      }`,
    fragmentShader: /* glsl */ `varying vec3 vC; varying float vA;
      void main(){ vec2 q = gl_PointCoord - .5; float d = length(q); if (d > .5) discard; gl_FragColor = vec4(vC, vA*smoothstep(.5, .25, d)); }`,
  }));
  pts.frustumCulled = false; scene.add(pts);

  // ---------------------------------------------------------------- zone outline + corner handles (cyan, as the page's dig zones)
  const SEG = 12, lpos = new Float32Array((MAXV * SEG + 2) * 3);
  const lg = new THREE.BufferGeometry(); lg.setAttribute('position', new THREE.BufferAttribute(lpos, 3)); lg.setDrawRange(0, 0);
  const lineMat = new THREE.ShaderMaterial({ uniforms: { uA: { value: 1 } }, transparent: true, depthTest: false,
    vertexShader: 'void main(){ gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }',
    fragmentShader: 'uniform float uA; void main(){ gl_FragColor=vec4(.59,.87,.98,uA); }' });
  const zoneLine = new THREE.Line(lg, lineMat); zoneLine.frustumCulled = false; zoneLine.renderOrder = 5; scene.add(zoneLine);
  const hpos = new Float32Array(MAXV * 3), hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.BufferAttribute(hpos, 3)); hg.setDrawRange(0, 0);
  const handles = new THREE.Points(hg, new THREE.ShaderMaterial({ uniforms: { uA: lineMat.uniforms.uA, uS: { value: high ? 7 : 5.5 } }, transparent: true, depthTest: false,
    vertexShader: 'uniform float uS; void main(){ gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); gl_PointSize=uS; }',
    fragmentShader: 'uniform float uA; void main(){ vec2 q=abs(gl_PointCoord-.5); float e=max(q.x,q.y); if(e>.5) discard; gl_FragColor=vec4(mix(vec3(.42,.75,.9),vec3(.02,.03,.05),step(e,.26)),uA); }' }));
  handles.frustumCulled = false; handles.renderOrder = 6; scene.add(handles);

  // ---------------------------------------------------------------- the wireframe excavator (Solutions kit)
  const kit = createMachineKit(THREE), exc = kit.excavator();
  exc.root.position.set(0, Y0, 0); exc.setOpacity(1); scene.add(exc.root);
  const REST = { a1: 0.22, a2: -1.5, a3: -0.35 }, DIG = { a1: -0.12, a2: -1.0, a3: 0.25 }, LIFT = { a1: 0.5, a2: -1.75, a3: -0.9 };
  exc.setArm(DIG.a1, DIG.a2, DIG.a3, 0); exc.root.updateMatrixWorld(true);
  const tv = new THREE.Vector3(); exc.tip.getWorldPosition(tv); const REACH = Math.max(5, Math.hypot(tv.x, tv.z));
  exc.setArm(REST.a1, REST.a2, REST.a3, 0);

  // ---------------------------------------------------------------- HUD card (canvas -> quad over the scene)
  const hc = document.createElement('canvas'); hc.width = W; hc.height = H; const hx = hc.getContext('2d');
  const hudTex = new THREE.CanvasTexture(hc); hudTex.colorSpace = THREE.NoColorSpace; hudTex.generateMipmaps = false; hudTex.minFilter = THREE.LinearFilter;
  const hudScene = new THREE.Scene(), hudCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  hudScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({ uniforms: { t: { value: hudTex } }, transparent: true, depthTest: false, depthWrite: false,
    vertexShader: 'varying vec2 v; void main(){ v=uv; gl_Position=vec4(position.xy,0.,1.); }',
    fragmentShader: 'uniform sampler2D t; varying vec2 v; void main(){ gl_FragColor=texture2D(t,v); }' })));
  const k = H / 320;
  function drawHud(st, depth, vol, cyc) {
    hx.clearRect(0, 0, W, H);
    const x0 = 14 * k, y0 = 14 * k, w = 196 * k, h = 74 * k;
    hx.fillStyle = 'rgba(6,9,13,.78)'; hx.strokeStyle = 'rgba(151,221,251,.35)'; hx.lineWidth = 1;
    hx.beginPath(); hx.roundRect ? hx.roundRect(x0, y0, w, h, 4 * k) : hx.rect(x0, y0, w, h); hx.fill(); hx.stroke();
    hx.textBaseline = 'middle';
    hx.font = `500 ${10 * k}px ${MONO}`; hx.fillStyle = '#e8eef4'; hx.fillText('EXCAVATOR SN-20', x0 + 10 * k, y0 + 14 * k);
    const live = st === 'DIGGING';
    hx.fillStyle = live ? '#3dd68c' : '#97ddfb'; hx.beginPath(); hx.arc(x0 + 13 * k, y0 + 31 * k, 3 * k, 0, 7); hx.fill();
    hx.font = `600 ${9.5 * k}px ${MONO}`; hx.fillText(st, x0 + 22 * k, y0 + 31.5 * k);
    hx.font = `400 ${8.5 * k}px ${MONO}`; hx.fillStyle = '#8b98a6';
    const rows = [['DEPTH', depth.toFixed(2) + ' m'], ['VOLUME', vol.toFixed(1) + ' m3'], ['CYCLE', cyc]];
    rows.forEach(([a, b], i) => { const yy = y0 + (46 + i * 10.5) * k; hx.fillStyle = '#8b98a6'; hx.fillText(a, x0 + 10 * k, yy); hx.fillStyle = '#d6e2ec'; hx.textAlign = 'right'; hx.fillText(b, x0 + w - 10 * k, yy); hx.textAlign = 'left'; });
    // corner tag, bottom right: the page hint
    hx.font = `500 ${8 * k}px ${MONO}`; hx.fillStyle = 'rgba(151,221,251,.75)'; hx.textAlign = 'right'; hx.fillText('MISSION CONTROL  /  LIVE', W - 12 * k, H - 12 * k); hx.textAlign = 'left';
    hudTex.needsUpdate = true;
  }

  // ---------------------------------------------------------------- demo loop
  const LOOP = 9.2;
  let zone = [], cen = [0, 0], sw = 0, loopN = -1, lastHud = -1, hudKey = '';
  function newZone(n) {
    seed = 1000 + n * 977; const nv = 5 + Math.floor(rnd() * 3);
    sw = (rnd() - 0.5) * 1.1; const R = REACH * (0.88 + rnd() * 0.12);
    cen = [Math.cos(sw) * R, -Math.sin(sw) * R];
    const base = 1.6 + rnd() * 0.6, rot = rnd() * 6.28, el = 0.75 + rnd() * 0.4;
    zone = []; for (let i = 0; i < nv; i++) { const a = rot + i / nv * Math.PI * 2 + (rnd() - 0.5) * 0.5, r = base * (0.75 + rnd() * 0.45);
      zone.push([cen[0] + Math.cos(a) * r, cen[1] + Math.sin(a) * r * el]); }
    zone.forEach((p, i) => polyU[i].set(p[0], p[1]));
  }
  const yAt = (x, z) => ground(x, z) + 0.06;
  function setOutline(nShown, grow, closed) { // nShown corners placed; the edge to the next one grows (0..1)
    let v = 0; const put = (x, z) => { lpos[v * 3] = x; lpos[v * 3 + 1] = yAt(x, z); lpos[v * 3 + 2] = z; v++; };
    const nv = zone.length, edges = closed ? nv : Math.max(0, nShown - 1) + (grow > 0 && nShown < nv + 1 ? 1 : 0);
    if (nShown > 0) put(zone[0][0], zone[0][1]);
    for (let e = 0; e < edges; e++) { const a = zone[e % nv], b = zone[(e + 1) % nv], f = e === edges - 1 && !closed && grow > 0 ? grow : 1;
      for (let s = 1; s <= SEG; s++) { const t = s / SEG * f; put(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t); } }
    lg.attributes.position.needsUpdate = true; lg.setDrawRange(0, v);
    const nh = Math.min(nv, nShown); for (let i = 0; i < nh; i++) { hpos[i * 3] = zone[i][0]; hpos[i * 3 + 1] = yAt(zone[i][0], zone[i][1]); hpos[i * 3 + 2] = zone[i][1]; }
    hg.attributes.position.needsUpdate = true; hg.setDrawRange(0, nh);
  }
  const lerpPose = (A, B, t, s) => exc.setArm(A.a1 + (B.a1 - A.a1) * t, A.a2 + (B.a2 - A.a2) * t, A.a3 + (B.a3 - A.a3) * t, s);
  function step(t) {
    const n = Math.floor(t / LOOP), u = t - n * LOOP;
    if (n !== loopN) { loopN = n; newZone(n); }
    const nv = zone.length, plotT = 2.8;
    // plot (0 .. 2.8), close (2.8 .. 3.2)
    let state = 'PLANNING', closed = u > 3.2, depth = 0;
    if (u < plotT) { const f = u / plotT * nv; setOutline(Math.floor(f) + 1, f % 1 > 0.55 ? (f % 1 - 0.55) / 0.45 : 0, false); }
    else setOutline(nv, closed ? 1 : (u - plotT) / 0.4, closed);
    U.uN.value = closed ? nv : 0; U.uZone.value = closed ? sm(3.2, 3.6, u) * (1 - sm(8.4, 9.1, u)) : 0;
    lineMat.uniforms.uA.value = 1 - sm(8.4, 9.1, u);
    // swing onto the zone (3.2 .. 4.2), dig cycles (4.2 .. 8.2), back to rest (8.2 .. 9.0)
    const swNow = sw * io(sm(3.2, 4.2, u)) * (1 - io(sm(8.2, 9.0, u)));
    if (u < 4.2) lerpPose(REST, REST, 0, swNow);
    else if (u < 8.2) { const c = (u - 4.2) / 2, ph = c % 1, s2 = swNow + (ph > 0.55 && ph < 0.9 ? -0.55 * Math.sin((ph - 0.55) / 0.35 * Math.PI) : 0);
      if (ph < 0.3) lerpPose(REST, DIG, io(ph / 0.3), s2); else if (ph < 0.55) lerpPose(DIG, LIFT, io((ph - 0.3) / 0.25), s2); else lerpPose(LIFT, REST, io((ph - 0.55) / 0.45), s2);
      state = 'DIGGING'; }
    else { lerpPose(REST, REST, 0, swNow); state = u < 8.6 ? 'DIGGING' : 'RESETTING'; }
    if (u > 3.2 && u < 4.2) state = 'POSITIONING';
    depth = 1.15 * sm(4.4, 8.2, u) * (1 - sm(8.6, 9.2, u));
    U.uDig.value = depth;
    // HUD at ~6 Hz, only when the text changes
    const area = (() => { let a = 0; for (let i = 0; i < nv; i++) { const p = zone[i], q = zone[(i + 1) % nv]; a += p[0] * q[1] - q[0] * p[1]; } return Math.abs(a) / 2; })();
    const vol = closed ? area * depth * 0.55 : 0, cyc = '00:' + String(Math.floor(u)).padStart(2, '0');
    const key = state + depth.toFixed(2) + vol.toFixed(1) + cyc;
    if (key !== hudKey && t - lastHud > 0.16) { hudKey = key; lastHud = t; drawHud(state, depth, vol, cyc); }
  }

  const bg = new THREE.Color(0.02, 0.026, 0.036), oldC = new THREE.Color();
  function render() {
    const old = renderer.getRenderTarget(), oldA = renderer.getClearAlpha(), oldAuto = renderer.autoClear; renderer.getClearColor(oldC);
    renderer.setRenderTarget(rt); renderer.setClearColor(bg, 1); renderer.clear();
    renderer.render(scene, cam); renderer.autoClear = false; renderer.render(hudScene, hudCam);
    renderer.autoClear = oldAuto; renderer.setClearColor(oldC, oldA); renderer.setRenderTarget(old);
  }
  step(0); drawHud('PLANNING', 0, 0, '00:00');
  let acc = 1;
  return {
    texture: rt.texture, aspect: W / H, scene, camera: cam,
    // compile everything into the hero's renderer before the texture is shown (no mid-scroll compiles)
    async warm() { if (renderer.compileAsync) { await renderer.compileAsync(scene, cam); await renderer.compileAsync(hudScene, hudCam); } render(); },
    update(dt, t) { acc += dt; if (acc < 1 / 30) return false; acc = 0; step(t); render(); return true; }, // 30 fps cap
    dispose() { rt.dispose(); pg.dispose(); pts.material.dispose(); lg.dispose(); lineMat.dispose(); hg.dispose(); handles.material.dispose(); hudTex.dispose();
      hudScene.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); }); exc.dispose(); kit.disposeAll?.(); },
  };
}
