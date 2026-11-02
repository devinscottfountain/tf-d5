// TerraFirma D6 hero in three.js: a remote-operations room at night, three monitors in front of a glass wall,
// a night dig outside. Scroll progress dollies the camera into the centre monitor, whose cab feed crossfades to
// the Series B still; at p=1 the screen covers the target rect exactly (solved camera), so the DOM card can take over.
// Post: D5 stack (AO, motion blur, bokeh DOF, bloom, tone map, SMAA, lens) + a final hand-off pass.
import { createPost } from '../d5/post.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { buildRoom } from './hero-room.js';
import { buildOutside } from './hero-outside.js';
import { createScreens } from './hero-screens.js';
import { createCab } from './hero-cab.js';
import { sstep } from './hero-glsl.js';

export const SERIES_B = 'https://cdn.prod.website-files.com/6ae4c2b96de64cf78d486e72/6ae8ed33c51d167d8d66b21b_d6-seriesb.webp';

const FOV0 = 40, FOV1 = 30;                         // lens at p=0 and at the hand-off
const POS0 = [0.04, 1.62, 2.65], LOOK0 = [0, 1.36, -3];
const STILL_IN = [0.68, 0.86];                      // cab feed -> Series B still, on the 3D screen
const HAND_IN = [0.9, 0.985];                       // tone-mapped screen -> exact sRGB still (hand-off pass)

export function createHero({ THREE, host, quality = 'high', still = SERIES_B, canvas: cvIn } = {}) {
  const HIGH = quality !== 'low';
  const V3 = THREE.Vector3, Q = THREE.Quaternion;
  const canvas = cvIn || document.createElement('canvas');
  if (!cvIn) { canvas.className = 'd6-hero-canvas'; Object.assign(canvas.style, { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', display: 'block' }); host.appendChild(canvas); }
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  let prMax = HIGH ? Math.min(devicePixelRatio || 1, 1.5) : 1, pr = prMax;
  renderer.setPixelRatio(pr);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = HIGH; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;
  let W = Math.max(1, host.clientWidth), H = Math.max(1, host.clientHeight);
  renderer.setSize(W, H, false);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a1430, 0.0011);
  const cam = new THREE.PerspectiveCamera(FOV0, W / H, 0.05, 2500);

  const room = buildRoom({ THREE, scene, high: HIGH });
  const outside = buildOutside({ THREE, scene, high: HIGH });
  const cab = createCab({ THREE, high: HIGH });
  const screens = createScreens({ THREE, renderer, high: HIGH, stillUrl: still, cab });
  const mons = room.makeMonitors(screens);

  // ---------------------------------------------------------------- post
  const post = createPost({ THREE, renderer, scene, cam });
  post.auto.enabled = false;                              // exposure is authored per p (scrubbing must be deterministic)
  post.ao.enabled = HIGH; post.ao.radius = 0.04; post.ao.intensity = 0.9;
  post.motion.shutter = 0.5; post.motion.maxLen = 0.02;
  // lens: barrel + vignette become uniforms so the last frames are distortion free
  const lens = post.lens;
  lens.uniforms.barrel = { value: 0.035 }; lens.uniforms.vig = { value: 0.55 };
  lens.material.fragmentShader = lens.material.fragmentShader
    .replace('uniform vec2 res;', 'uniform vec2 res; uniform float barrel; uniform float vig;')
    .replace('(1.-0.035*r2)', '(1.-barrel*r2)').replace('smoothstep(0.75,0.12,r2*1.6),0.55)', 'smoothstep(0.75,0.12,r2*1.6),vig)');
  lens.material.needsUpdate = true;
  // hand-off: inside the projected screen rect, blend to the still exactly as the browser draws it (sRGB, object-fit cover, rounded)
  const hand = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, tStill: { value: screens.still }, amt: { value: 0 }, rect: { value: new THREE.Vector4(0, 0, 1, 1) }, res: { value: new THREE.Vector2(1, 1) }, rad: { value: 0 }, cover: { value: new THREE.Vector4(1, 1, 0, 0) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform sampler2D tDiffuse, tStill; uniform float amt, rad; uniform vec4 rect, cover; uniform vec2 res; varying vec2 vUv;
      void main(){ vec4 c=texture2D(tDiffuse,vUv); if(amt<=0.){ gl_FragColor=c; return; }
        vec2 p=vUv*res, a=rect.xy*res, b=rect.zw*res, h=(b-a)*.5, q=abs(p-(a+b)*.5)-h+rad;
        float d=length(max(q,0.))+min(max(q.x,q.y),0.)-rad, inside=clamp(.5-d,0.,1.);
        vec2 r=(vUv-rect.xy)/(rect.zw-rect.xy); r.y=1.-r.y;                       // DOM orientation (y down)
        vec3 s=texture2D(tStill, vec2(r.x*cover.x+cover.z, 1.-(r.y*cover.y+cover.w))).rgb;
        gl_FragColor=vec4(mix(c.rgb,s,amt*inside),1.); }`
  });
  hand.material.toneMapped = false;
  post.composer.addPass(hand);

  // ---------------------------------------------------------------- layout: target rect and the solved end pose
  let target = null, targetRad = 0, autoTarget = true;
  const defaultTarget = () => { const k = W / 1600; return { x: 40 * k, y: 132 * k, w: 1520 * k, h: 839 * k }; };
  const pEnd = new V3(), qEnd = new Q(), p0 = new V3(...POS0), q0 = new Q(), m4 = new THREE.Matrix4();
  let squeeze = 1;                                       // anamorphic factor when the monitor could not take the card's aspect
  function solve() {
    if (autoTarget || !target) target = defaultTarget();
    const ta = target.w / target.h, a = Math.min(2.2, Math.max(1.4, ta));
    room.setCentreAspect(a); scene.updateMatrixWorld(true);
    squeeze = ta / a;                                    // >1 widens the screen in x at the end
    const c = mons.centre.screen, ctr = new V3().setFromMatrixPosition(c.matrixWorld);
    const R = new V3(1, 0, 0).applyQuaternion(c.getWorldQuaternion(new Q())), Up = new V3(0, 1, 0).applyQuaternion(c.getWorldQuaternion(new Q())), N = new V3().crossVectors(R, Up);
    const P11 = 1 / Math.tan(FOV1 * Math.PI / 360), P00 = P11 / (W / H) * squeeze;
    const d = P11 * (room.centreH / 2) / (target.h / H);
    const nx = (target.x + target.w / 2) / W * 2 - 1, ny = 1 - (target.y + target.h / 2) / H * 2;
    pEnd.copy(ctr).addScaledVector(N, d).addScaledVector(R, -nx * d / P00).addScaledVector(Up, -ny * d / P11);
    qEnd.setFromRotationMatrix(m4.makeBasis(R, Up, N));
    m4.lookAt(p0, new V3(...LOOK0), new V3(0, 1, 0)); q0.setFromRotationMatrix(m4);
    screens.cover(room.centreW / room.centreH, screens.centre.uniforms.uCover.value);
    screens.cover(ta, hand.uniforms.cover.value);
  }

  // ---------------------------------------------------------------- camera
  let prog = 0, ptrX = 0, ptrY = 0, sx = 0, sy = 0, time = 0;
  const c1 = new V3(), c2 = new V3(), tq = new Q(), dq = new Q(), eu = new THREE.Euler();
  const bez = (a, b, c, d, t, out) => { const u = 1 - t; return out.set(0, 0, 0).addScaledVector(a, u * u * u).addScaledVector(b, 3 * u * u * t).addScaledVector(c, 3 * u * t * t).addScaledVector(d, t * t * t); };
  function pose(p, t) {
    const s = p * p * p * (p * (p * 6 - 15) + 10);            // smootherstep: accelerates in, settles exactly on the end pose
    c1.copy(p0).add({ x: 0, y: -0.04, z: -0.55 }); c2.copy(pEnd).add({ x: 0, y: 0.06, z: 0.75 });
    bez(p0, c1, c2, pEnd, s, cam.position);
    cam.quaternion.slerpQuaternions(q0, qEnd, sstep(0, 1, Math.min(1, s * 1.08)));
    // handheld + pointer, both gone by the hand-off
    const k = 1 - sstep(0.72, 0.97, p);
    sx += (ptrX - sx) * 0.06; sy += (ptrY - sy) * 0.06;
    eu.set(k * (0.0016 * Math.sin(t * 0.53) + 0.0009 * Math.sin(t * 1.31 + 2) - sy * 0.012), k * (0.0022 * Math.sin(t * 0.37 + 1) + 0.0008 * Math.sin(t * 1.7) - sx * 0.02), k * 0.0007 * Math.sin(t * 0.61));
    cam.quaternion.multiply(dq.setFromEuler(eu));
    cam.position.x += k * (sx * 0.07 + 0.004 * Math.sin(t * 0.41)); cam.position.y += k * (sy * 0.035 + 0.003 * Math.sin(t * 0.67 + 1));
    cam.fov = FOV0 + (FOV1 - FOV0) * s; cam.aspect = W / H; cam.updateProjectionMatrix();
    const sq = 1 + (squeeze - 1) * s; if (sq !== 1) { cam.projectionMatrix.elements[0] *= sq; cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert(); }
    cam.updateMatrixWorld();
    return s;
  }

  // ---------------------------------------------------------------- per frame
  const corners = [new V3(-0.5, -0.5, 0), new V3(0.5, -0.5, 0), new V3(0.5, 0.5, 0), new V3(-0.5, 0.5, 0)], tv = new V3();
  function screenRect() {
    const m = mons.centre.screen.matrixWorld; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const c of corners) { tv.copy(c).applyMatrix4(m).project(cam); const x = (tv.x * 0.5 + 0.5) * W, y = (0.5 - tv.y * 0.5) * H; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  let lastT = 0, cabAcc = 0, frames = 0, ftAcc = 0, ftN = 0;
  function frame(now) {
    const t = now / 1000, dt = lastT ? Math.min(0.1, t - lastT) : 1 / 60; lastT = t; time += dt;
    const p = prog, s = pose(p, time);
    outside.update(time); screens.time.value = time;
    // centre feed: cab view until the still takes over, rendered at 30 Hz on low
    const mix = sstep(STILL_IN[0], STILL_IN[1], p); screens.centre.uniforms.uMix.value = mix; screens.centre.uniforms.uUI.value = 1 - sstep(0.6, 0.8, p);
    cabAcc += dt;
    if (mix < 1 && (HIGH || cabAcc > 1 / 30)) { cabAcc = 0; cab.update(time); cab.render(renderer); }
    // look
    const focus = Math.abs(tv.copy(mons.centre.screen.getWorldPosition(tv)).sub(cam.position).dot(c1.set(0, 0, -1).applyQuaternion(cam.quaternion)));
    const near = sstep(0.0, 0.7, p);
    renderer.toneMappingExposure = 1.0; screens.setExposure(1.0);
    post.bloom.strength = 0.62 - 0.4 * sstep(0.55, 1, p); post.bloom.radius = 0.55; post.bloom.threshold = 0.78;
    lens.uniforms.barrel.value = 0.035 * (1 - s); lens.uniforms.vig.value = 0.55 - 0.25 * s; lens.uniforms.grain.value = 0.04 - 0.02 * s;
    room.setGlow(1 - 0.3 * near);
    post.update({ dt, t: time, focus, aperture: HIGH ? (0.00012 + 0.0008 * near) * (1 - sstep(0.85, 1, p)) : 0, maxblur: HIGH ? (0.003 + 0.007 * near) * (1 - sstep(0.88, 1, p)) : 0, ca: 0.012 * (1 - s) });
    // hand-off pass follows the projected screen
    const hu = hand.uniforms, ha = sstep(HAND_IN[0], HAND_IN[1], p); hu.amt.value = ha;
    if (ha > 0) { const r = p >= 1 ? target : screenRect(); hu.rect.value.set(r.x / W, 1 - (r.y + r.h) / H, (r.x + r.w) / W, 1 - r.y / H); hu.res.value.set(W * pr, H * pr); hu.rad.value = targetRad * pr * sstep(HAND_IN[0], 1, p); }
    renderer.info.reset();
    post.render();
    // adaptive resolution (high only): sustained slow frames drop the pixel ratio a notch
    if (HIGH && running) { ftAcc += dt; ftN++; if (ftN >= 90) { const avg = ftAcc / ftN; ftAcc = ftN = 0; if (avg > 1 / 45 && pr > 1) setPR(Math.max(1, pr - 0.25)); } }
    frames++;
  }
  function setPR(v) { pr = v; renderer.setPixelRatio(pr); post.setSize(W, H); renderer.domElement.style.width = renderer.domElement.style.height = '100%'; }

  // ---------------------------------------------------------------- loop + api
  let running = false, raf = 0;
  const loop = now => { if (!running) return; raf = requestAnimationFrame(loop); frame(now); };
  function resize() {
    W = Math.max(1, host.clientWidth); H = Math.max(1, host.clientHeight);
    post.setSize(W, H); canvas.style.width = canvas.style.height = '100%';
    solve(); post.resetMotion();
  }
  solve();
  post.setSize(W, H); canvas.style.width = canvas.style.height = '100%';

  const ready = (async () => {
    await Promise.race([screens.stillReady, new Promise(r => setTimeout(r, 8000))]);
    screens.still.needsUpdate = !!screens.still.image;
    pose(0, 0); outside.update(0); cab.update(0);
    try { if (renderer.compileAsync) { await renderer.compileAsync(scene, cam); await renderer.compileAsync(cab.scene, cab.cam); } } catch (e) { /* compile on first frame instead */ }
    cab.render(renderer);
    post.warm({ fx: HIGH });
    frame(performance.now());
    return true;
  })();

  return {
    ready, renderer, scene, camera: cam, post,
    setProgress(p) { prog = Math.min(1, Math.max(0, +p || 0)); },
    setTarget(rect, radius) { if (!rect) { autoTarget = true; } else { target = { x: rect.x ?? rect.left, y: rect.y ?? rect.top, w: rect.w ?? rect.width, h: rect.h ?? rect.height }; autoTarget = false; } if (radius !== undefined) targetRad = radius; solve(); },
    screenRect() { pose(prog, time); return screenRect(); },
    setPointer(x, y) { ptrX = Math.max(-1, Math.min(1, x)); ptrY = Math.max(-1, Math.min(1, y)); },
    setMedia(el) { const t = screens.setMedia(el); hand.uniforms.tStill.value = t; solve(); },
    start() { if (running) return; running = true; lastT = 0; post.resetMotion(); raf = requestAnimationFrame(loop); },
    stop() { running = false; cancelAnimationFrame(raf); },
    renderOnce() { frame(performance.now()); },
    resize,
    stats() { const i = renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, pixelRatio: pr, frames, programs: i.programs?.length }; },
    dispose() {
      running = false; cancelAnimationFrame(raf);
      room.dispose(); outside.dispose(); cab.dispose(); screens.dispose(); post.composer.dispose?.();
      renderer.dispose(); if (!cvIn) canvas.remove();
    }
  };
}
