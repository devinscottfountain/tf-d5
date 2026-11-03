// TerraFirma D6 hero in three.js: a remote-operations room at night, three monitors in front of a glass wall,
// a night dig outside. Scroll progress dollies the camera into the centre monitor, whose cab feed dips to black and
// gives way to the Series B still; at p=1 the screen covers the target rect exactly (solved camera), so the DOM card can take over.
// Shot like a film frame: monitor spill + moonlit window fill, haze and light-tower cones outside, dust in the screen
// light, a mirrored window (planar reflection, smudges, second-pane ghost), slider move with operator wobble, rack focus
// with shaped bokeh, lens breathing, anamorphic streaks, halation, grade and grain.
// Post: D5 stack (AO, motion blur, DOF, bloom, tone map, SMAA, lens) with hero passes spliced in:
//   scene -> HDR FX -> [atmosphere] -> DOF (half-res shaped bokeh) -> [streak extract] -> bloom -> ACES -> SMAA -> film lens/grade -> hand-off
// Boot: every program is compiled async against the target it really draws into (HDR targets, the cab target, the
// canvas), ready = first lean frame (no mirror, streaks or dust); enhance() then compiles those, warms frames at
// p 0.5 and 1 offscreen and fades them in. Textures stream in after ready as plain texture swaps (placeholders are bound
// from the start), so nothing compiles mid-scroll. The canvas runs at device pixel ratio (crisp hand-off still), the
// post chain at its own, lower ratio.
import { createPost } from '../d5/post.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import * as RoomMod from './hero-room.js';
import * as OutMod from './hero-outside.js';
import { createScreens } from './hero-screens.js';
import { createCab } from './hero-cab.js';
import { sstep, noise1, NOISE3, rng, createAtmosphere, upgradeDOF, createStreaks, filmLens, createMirror, NOISE } from './hero-glsl.js';

export const SERIES_B = 'https://cdn.prod.website-files.com/6ae4c2b96de64cf78d486e72/6ae8ed33c51d167d8d66b21b_d6-seriesb.webp';

const FOV0 = 36, FOV1 = 30;                         // lens at p=0 and at the hand-off
const POS0 = [0, 1.64, 2.7], LOOK0 = [0, 1.58, -3];
const FEED_DIP = [0.56, 0.62, 0.67];                // cab feed dips to ~10 %, then to black (a channel change, not a dissolve)
const STILL_IN = [0.66, 0.78];                      // then the Series B still comes up on the 3D screen
const HAND_IN = [0.86, 0.97];                       // tone-mapped screen -> exact sRGB still (hand-off pass)
const MIRROR_OFF = [0.6, 0.7];                      // window reflection fades out (the glass is deep in bokeh), then is skipped
const GLARE_COV = [0.42, 0.6];                      // screen coverage over which bloom / halation / streaks / dust leave the screen
const RACK = [0.1, 0.56];                           // focus pull: site -> centre screen
const SITE_FOCUS = 46;                              // m, the excavator / dozer line outside
const REFL_LAYER = 1;                               // objects only the window reflection sees
const FADE_MS = 500;                                // enhance fade-in
const LAMP_K = 1;                                   // tower lamp glow (atmosphere + beams)
// texture roles the hero's materials actually bind (night_sky_hdr, rock_ridge, rubber_track, tyre_track_decal are not used)
const HERO_ROLES = ['concrete_floor', 'desk_laminate', 'black_plastic', 'brushed_metal', 'ceiling_panel', 'carpet', 'fabric_chair', 'glass_smudge', 'dirt_ground', 'gravel', 'excavator_paint', 'rusty_metal'];

const coarsePointer = () => {
  try { return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)); } catch (_) { return false; }
};
const yieldTask = () => new Promise(r => setTimeout(r, 0));
const idle = fn => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 300));

// options: enhance 'auto' (default, runs on idle after ready) | 'manual' (page calls hero.enhance());
// lite: no mirror / streaks / dust, cab without MSAA (default: coarse pointer, i.e. tablets)
export function createHero({ THREE, host, quality = 'high', still = SERIES_B, canvas: cvIn, fadeOutside = true, enhance: enhanceMode = 'auto', lite } = {}) {
  const canvas = cvIn || document.createElement('canvas');
  if (!cvIn) { canvas.className = 'd6-hero-canvas'; Object.assign(canvas.style, { position: 'absolute', left: 0, top: 0, width: '100%', height: '100%', display: 'block' }); host.appendChild(canvas); }
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
  try {
    return build({ THREE, host, quality, still, canvas, cvIn, fadeOutside, enhanceMode, lite, renderer });
  } catch (e) { // half-built: drop the context so nothing leaks, the page falls back to the poster
    try { renderer.dispose(); renderer.forceContextLoss?.(); } catch (_) { /* gone */ }
    if (!cvIn) canvas.remove();
    throw e;
  }
}

function build({ THREE, host, quality, still, canvas, cvIn, fadeOutside, enhanceMode, lite, renderer }) {
  const HIGH = quality !== 'low';
  const COARSE = lite ?? coarsePointer();
  const RICH = HIGH && !COARSE;                      // mirror, streaks, dust, cab MSAA
  const DEBUG = typeof location !== 'undefined' && /[?&]debug(=|&|$)/.test(location.search);
  const V3 = THREE.Vector3, Q = THREE.Quaternion;
  const GLASS_Z = RoomMod.GLASS_Z ?? -2.2, G0 = OutMod.G0 ?? -1;
  renderer.debug.checkShaderErrors = DEBUG;
  // canvas at device ratio (the hand-off still lands crisp), post chain at its own ratio (adaptive, high only)
  const DPR = Math.min(typeof devicePixelRatio === 'number' && devicePixelRatio > 0 ? devicePixelRatio : 1, 2);
  const prMax = HIGH ? Math.min(DPR, COARSE ? 1.25 : 1.5) : 1;
  let pr = prMax;
  renderer.setPixelRatio(DPR);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;   // ACES: the screens invert exactly this curve
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = HIGH; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.info.autoReset = false;
  let W = Math.max(1, host.clientWidth), H = Math.max(1, host.clientHeight);
  renderer.setSize(W, H, false);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x0a1430, HIGH ? 0.0004 : 0.0011);   // high: the atmosphere pass does the real haze
  const cam = new THREE.PerspectiveCamera(FOV0, W / H, 0.05, 2500);

  const room = RoomMod.buildRoom({ THREE, scene, high: HIGH, quality: HIGH ? 'high' : 'low' });
  const outside = OutMod.buildOutside({ THREE, scene, high: HIGH, quality: HIGH ? 'high' : 'low' });
  const cab = createCab({ THREE, high: HIGH, samples: RICH ? 4 : 0 });
  const screens = createScreens({ THREE, renderer, high: HIGH, stillUrl: still, cab });
  const mons = room.makeMonitors(screens);
  const time = screens.time;
  const monList = [mons.left, mons.centre, mons.right];

  // ---------------------------------------------------------------- light: moon through the glass (one-sided area light, so the site is untouched)
  const moonFill = new THREE.RectAreaLight(0x5b74b8, HIGH ? 0.55 : 0.4, 14, 3.4);
  moonFill.position.set(0, 1.75, GLASS_Z + 0.03); moonFill.lookAt(0, 1.2, 6); scene.add(moonFill);
  const spill = { left: new THREE.Color(0.5, 0.62, 0.9), right: new THREE.Color(0.42, 0.74, 1.0), cab: new THREE.Color(1.0, 0.84, 0.66), still: new THREE.Color(0.78, 0.74, 0.7) };

  // ---------------------------------------------------------------- light-tower beams: additive cones, soft edges, drifting dust noise
  const coneU = { time, uG: { value: G0 } };
  const cones = new THREE.Group(); scene.add(cones);
  const spots = outside.spots || [];
  if (HIGH) for (const s of spots) {
    s.updateMatrixWorld(); s.target.updateMatrixWorld();
    const a = s.getWorldPosition(new V3()), b = s.target.getWorldPosition(new V3()), len = a.distanceTo(b) * 1.12, ang = Math.min(0.6, (s.angle || 0.7) * 0.62);
    const g = new THREE.ConeGeometry(len * Math.tan(ang), len, 40, 1, true).translate(0, -len / 2, 0);
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { ...coneU, uCol: { value: new THREE.Color(1.0, 0.7, 0.4).multiplyScalar(0.05) } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, fog: false, toneMapped: true,
      vertexShader: `varying vec3 vW, vN; varying float vA; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; vN=normalize(mat3(modelMatrix)*normal); vA=1.-uv.y; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `${NOISE3} uniform vec3 uCol; uniform float time, uG; varying vec3 vW, vN; varying float vA;
        void main(){ vec3 V=normalize(cameraPosition-vW); float e=abs(dot(normalize(vN),V));
          float fall=pow(1.-vA,1.3)*smoothstep(0.,.05,vA)/(.15+vA*vA*3.);
          float n=(.45+.9*vn3(vW*.3+vec3(0.,-time*.22,time*.07)))*(.7+.6*vn3(vW*1.1+vec3(time*.09,time*.05,0.)));
          float gr=smoothstep(uG+.2,uG+2.8,vW.y);
          gl_FragColor=vec4(uCol*pow(e,1.6)*fall*n*gr,1.); }`
    }));
    m.position.copy(a); m.quaternion.setFromUnitVectors(new V3(0, -1, 0), b.clone().sub(a).normalize()); m.renderOrder = 1; m.frustumCulled = false;
    cones.add(m);
  }

  // ---------------------------------------------------------------- dust in the screen light: points with their own CoC (scatter bokeh)
  const dustU = { time, focus: { value: 3 }, cocK: { value: 0 }, maxC: { value: 16 }, pxScale: { value: 500 }, lightP: { value: new V3(0, 1.13, 0.05) }, lightC: { value: new THREE.Color(0.7, 0.78, 0.95) }, amt: { value: 1 } };
  let dust = null;
  if (RICH) {
    const N = 520, r = rng(77), P = new Float32Array(N * 3), S = new Float32Array(N);
    for (let i = 0; i < N; i++) { P[i * 3] = (r() - 0.5) * 3.4; P[i * 3 + 1] = 0.8 + r() * 1.5; P[i * 3 + 2] = -0.15 + r() * 2.6; S[i] = r(); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('seed', new THREE.BufferAttribute(S, 1));
    dust = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: dustU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      vertexShader: `attribute float seed; uniform float time, focus, cocK, maxC, pxScale, amt; uniform vec3 lightP, lightC; varying vec3 vC;
        void main(){ vec3 p=position;
          p.y=.8+mod(p.y-.8-time*.008*(.4+seed),1.5);
          p.x+=.07*sin(time*.11+seed*40.); p.z+=.05*sin(time*.08+seed*17.); p.y+=.02*sin(time*.3+seed*9.);
          vec4 mv=modelViewMatrix*vec4(p,1.); float z=max(-mv.z,.05);
          float coc=min(abs(cocK*(1./focus-1./z)),maxC);
          float sz=max(pxScale*.0014/z,1.), d=max(sz,coc*2.);
          vec3 q=p-lightP; float front=smoothstep(-.05,.25,q.z)*smoothstep(1.9,.0,abs(q.x))*smoothstep(1.1,.0,abs(q.y));
          float tw=.25+.75*pow(.5+.5*sin(time*(.7+seed*2.3)+seed*61.),8.);
          vC=lightC*front*tw*amt*2.2*(sz*sz)/(d*d)/(.3+q.z*q.z*2.);
          gl_PointSize=d; gl_Position=projectionMatrix*mv; }`,
      fragmentShader: `varying vec3 vC; void main(){ float r=length(gl_PointCoord-.5)*2.; float a=smoothstep(1.,.78,r)*(.85+.3*smoothstep(.5,.95,r)); if(a<=0.) discard; gl_FragColor=vec4(vC*a,1.); }`
    }));
    dust.frustumCulled = false; dust.renderOrder = 3; dust.visible = false; scene.add(dust);   // enhance-only
  }

  // ---------------------------------------------------------------- the room behind the camera, seen only in the window (mirror only)
  const backRoom = new THREE.Group(); scene.add(backRoom);
  if (RICH) {
    const dark = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.85 });
    const add = (geo, mat, x, y, z, ry = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.y = ry; backRoom.add(m); return m; };
    add(new THREE.PlaneGeometry(14, 3.5), dark, 0, 1.75, 6.8, Math.PI);
    for (const s of [-1, 1]) add(new THREE.PlaneGeometry(9, 3.5), dark, s * 5.2, 1.75, 2.3, -s * Math.PI / 2);
    const strip = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.12, 0.135, 0.16) }), frameM = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.05, 0.055, 0.065) });
    for (const [x, z] of [[-2.6, 1.5], [2.6, 1.5], [-2.6, 4.6], [2.6, 4.6]]) add(new THREE.BoxGeometry(0.12, 0.02, 1.4), strip, x, 3.47, z);
    add(new THREE.PlaneGeometry(1.0, 2.1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.07, 0.045) }), 3.6, 1.05, 6.78, Math.PI); // door glow
    for (let i = 0; i < 7; i++) for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.03, 3.3, 0.03), frameM, s * 5.17, 1.75, -1.6 + i * 1.3);     // side window frames
    backRoom.traverse(o => o.layers.set(REFL_LAYER));
  }

  // ---------------------------------------------------------------- window: planar reflection (half res, mip-blurred by smudge roughness), second-pane ghost
  // uReflK: 0 = painted env only (lean boot, glass out of the shot, mirror not rendered yet), 1 = live mirror
  const mirror = RICH && room.glass ? createMirror({ THREE, z: GLASS_Z, layer: REFL_LAYER }) : null;
  const glassU = {
    time, tRefl: { value: mirror?.texture ?? null }, texM: { value: mirror?.texM ?? new THREE.Matrix4() }, tEnv: { value: room.env ?? null }, tSmudge: { value: null }, hasSm: { value: 0 }, uReflK: { value: 0 },
    uRefl: { value: 0.75 }, uEnv: { value: 0.35 }, uTint: room.glassU?.uTint ?? { value: 0.32 }, uTintC: room.glassU?.uTintC ?? { value: new THREE.Color(0x010304) },
    uGhost: { value: new THREE.Vector2(0.0045, -0.003) }, uSmear: { value: 0.035 }
  };
  if (room.glass) {
    const old = room.glass.material;
    room.glass.material = new THREE.ShaderMaterial({
      uniforms: glassU, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      vertexShader: `uniform mat4 texM; varying vec3 vW; varying vec4 vR; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; vR=texM*w; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `${NOISE} uniform sampler2D tRefl, tEnv, tSmudge; uniform float uRefl, uEnv, uTint, hasSm, uReflK, uSmear, time; uniform vec3 uTintC; uniform vec2 uGhost; varying vec3 vW; varying vec4 vR;
        void main(){ vec3 V=normalize(vW-cameraPosition), N=vec3(0.,0.,1.), R=reflect(V,N);
          float ct=abs(dot(V,N)), F=.04+.96*pow(1.-ct,5.), F2=2.*F/(1.+F);                 // two panes
          float sm=hasSm>.5 ? texture2D(tSmudge,vW.xy*vec2(.42,.42)+vec2(.13,.4)).r : fbm2(vW.xy*vec2(2.5,1.2)+4.);
          float sm2=fbm2(vW.xy*vec2(.7,.35)+11.);                                            // big wipes
          float rough=clamp(.25+1.6*sm*sm2,0.,2.6);
          vec2 e=vec2(atan(R.z,R.x)/6.2832+.5, asin(clamp(R.y,-1.,1.))/3.1416+.5);
          vec3 env=texture2D(tEnv,e).rgb*uEnv;
          vec3 refl=env;
          if(uReflK>0.){ vec2 uv=vR.xy/max(vR.w,1e-4);
            vec3 a=texture2D(tRefl,uv,rough+1.).rgb, b=texture2D(tRefl,uv+uGhost*(1.4-ct),rough+2.).rgb;   // second pane: offset, softer
            vec3 m=(a+.55*b)*uRefl+env*.35;
            if(!(m.r+m.g+m.b<1e4)) m=env;                                                    // never let a bad sample black out a pane
            refl=mix(env,m,uReflK); }
          vec3 c=refl*F2*(.75+.6*sm)+uTintC*uTint;
          c+=refl*uSmear*sm*sm2*4.;                                                           // smudges catch the room light
          gl_FragColor=vec4(c, uTint*(.88+.25*sm)); }`
    });
    room.glass.material.toneMapped = true; old?.dispose?.();
  }
  const reflHide = [outside.group, room.glass, cones, dust].filter(Boolean);

  // ---------------------------------------------------------------- post (internal ratio pr; the canvas stays at DPR)
  const post = createPost({ THREE, renderer, scene, cam });
  post.composer.setPixelRatio(pr);
  const P = post.composer.passes, scenePass = P[0], mbPass = P[1];
  const depthTex = () => scenePass.rt.depthTexture;
  post.auto.enabled = false;                              // exposure is authored per p (scrubbing must be deterministic)
  post.ao.enabled = HIGH; post.ao.radius = 0.04; post.ao.intensity = 0.9;
  post.motion.shutter = 0.5; post.motion.maxLen = 0.02;
  let atmoRan = false, atmo = null, streak = null;
  if (HIGH) {
    atmo = createAtmosphere({ THREE, cam, depth: depthTex, src: read => (mbPass.enabled ? read.texture : scenePass.useRT ? scenePass.rt.texture : null) });
    const ar = atmo.render; atmo.render = (r, w, rd) => { ar(r, w, rd); atmoRan = atmo.needsSwap; };
    atmo.uniforms.glassZ.value = GLASS_Z; atmo.uniforms.hazeY0.value = G0;
    P.splice(P.indexOf(post.dof), 0, atmo);
    upgradeDOF({ THREE, dof: post.dof, cam, depth: depthTex, src: read => (atmoRan || mbPass.enabled ? read.texture : scenePass.rt.texture), taps: 48 });
  }
  if (RICH) {
    streak = createStreaks({ THREE, cam, depth: depthTex, src: read => read.texture });
    streak.enabled = false;                               // enhance-only
    P.splice(P.indexOf(post.bloom), 0, streak);
  }
  const lensU = filmLens(THREE, post.lens);
  if (streak) lensU.tStreak.value = streak.texture;
  lensU.tHal.value = post.bloom.renderTargetsVertical?.[1]?.texture ?? null;
  // hand-off: inside the projected screen rect, blend to the still exactly as the browser draws it (sRGB, object-fit cover, rounded)
  const hand = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, tStill: { value: screens.still }, amt: { value: 0 }, rect: { value: new THREE.Vector4(0, 0, 1, 1) }, res: { value: new THREE.Vector2(1, 1) }, rad: { value: 0 }, outFade: { value: 0 }, cover: { value: new THREE.Vector4(1, 1, 0, 0) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform sampler2D tDiffuse, tStill; uniform float amt, rad, outFade; uniform vec4 rect, cover; uniform vec2 res; varying vec2 vUv;
      void main(){ vec4 c=texture2D(tDiffuse,vUv); if(amt<=0.){ gl_FragColor=c; return; }
        vec2 p=vUv*res, a=rect.xy*res, b=rect.zw*res, h=(b-a)*.5, q=abs(p-(a+b)*.5)-h+rad;
        float d=length(max(q,0.))+min(max(q.x,q.y),0.)-rad, inside=clamp(.5-d,0.,1.);
        vec2 r=(vUv-rect.xy)/(rect.zw-rect.xy); r.y=1.-r.y;                       // DOM orientation (y down)
        vec3 s=texture2D(tStill, vec2(r.x*cover.x+cover.z, 1.-(r.y*cover.y+cover.w)), -1.).rgb;   // bias: stay on the sharp mip like the browser
        gl_FragColor=vec4(mix(c.rgb*(1.-outFade*(1.-inside)),s,amt*inside),1.); }`
  });
  hand.material.toneMapped = false;
  post.composer.addPass(hand);
  // tone pass: set its defines now (it would on its first render) so the async compile below builds the final program
  const tonePass = P.find(x => x.mTone);
  if (tonePass) {
    const d = {}, tm = { [THREE.LinearToneMapping]: 'LINEAR_TONE_MAPPING', [THREE.ReinhardToneMapping]: 'REINHARD_TONE_MAPPING', [THREE.CineonToneMapping]: 'CINEON_TONE_MAPPING', [THREE.ACESFilmicToneMapping]: 'ACES_FILMIC_TONE_MAPPING', [THREE.AgXToneMapping]: 'AGX_TONE_MAPPING' }[renderer.toneMapping];
    if (THREE.ColorManagement.getTransfer(renderer.outputColorSpace) === THREE.SRGBTransfer) d.SRGB_TRANSFER = '';
    if (tm) d[tm] = '';
    tonePass.mTone.defines = d; tonePass.mTone.needsUpdate = true; tonePass._cs = renderer.outputColorSpace; tonePass._tm = renderer.toneMapping;
  }

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
    monList.forEach((m, i) => { const w = m.w ?? 0.8, h = m.h ?? room.centreH; screens.setScreen?.(i, w / h, i === 1 ? 1920 * w / 0.8 : 1920); });
  }
  screens.onAspect = () => { if (!dead) solve(); };

  // ---------------------------------------------------------------- camera: slider dolly + gimbal, operator wobble, rack focus, breathing
  let prog = 0, ptrX = 0, ptrY = 0, sx = 0, sy = 0, clock = 0;
  const c1 = new V3(), c2 = new V3(), D1 = new V3(0, -0.05, -0.55), D2 = new V3(0, 0.07, 0.75), dq = new Q(), eu = new THREE.Euler(), tv = new V3(), fwd = new V3();
  const nP = noise1(3), nY = noise1(5), nR = noise1(8), nX = noise1(13), nZ = noise1(21);
  const bez = (a, b, c, d, t, out) => { const u = 1 - t; return out.set(0, 0, 0).addScaledVector(a, u * u * u).addScaledVector(b, 3 * u * u * t).addScaledVector(c, 3 * u * t * t).addScaledVector(d, t * t * t); };
  let focusDist = SITE_FOCUS, rackT = 0;
  function pose(p, t) {
    const s = p * p * p * (p * (p * 6 - 15) + 10);            // smootherstep: accelerates in, settles exactly on the end pose
    c1.copy(p0).add(D1); c2.copy(pEnd).add(D2);   // a slight crane dip, then rise onto the screen
    bez(p0, c1, c2, pEnd, s, cam.position);
    cam.quaternion.slerpQuaternions(q0, qEnd, sstep(0, 1, Math.min(1, s * 1.08)));   // the gimbal leads the slider a touch
    // operator: 1/f wobble (breathing, hand) + pointer, all gone before the hand-off
    const k = 1 - sstep(0.7, 0.96, p);
    sx += (ptrX - sx) * 0.06; sy += (ptrY - sy) * 0.06;
    eu.set(k * (0.0019 * nP(t * 0.45) - sy * 0.012), k * (0.0024 * nY(t * 0.38) - sx * 0.02), k * 0.0009 * nR(t * 0.3));
    cam.quaternion.multiply(dq.setFromEuler(eu));
    cam.position.x += k * (sx * 0.07 + 0.004 * nX(t * 0.5)); cam.position.y += k * (sy * 0.035 + 0.0035 * nZ(t * 0.62)); cam.position.z += k * 0.003 * nX(t * 0.33 + 9);
    // focus: dioptre-linear pull from the site to the centre screen
    tv.setFromMatrixPosition(mons.centre.screen.matrixWorld).sub(cam.position);
    const scrD = Math.max(0.2, Math.abs(tv.dot(fwd.set(0, 0, -1).applyQuaternion(cam.quaternion))));
    rackT = sstep(RACK[0], RACK[1], p);
    focusDist = 1 / ((1 - rackT) / SITE_FOCUS + rackT / scrD);
    // lens: FOV ramps to the solved one; breathing narrows it ~1.4% as focus comes close, released before the hand-off
    const a = W / H, f0 = a >= 1.2 ? FOV0 : Math.min(62, Math.max(FOV0, 2 * Math.atan(0.3 / a) * 180 / Math.PI)); // portrait: keep the desk in frame
    const breathe = 1 - 0.014 * rackT * (1 - sstep(0.72, 0.95, p));
    cam.fov = (f0 + (FOV1 - f0) * s) * breathe; cam.aspect = W / H; cam.updateProjectionMatrix();
    const sq = 1 + (squeeze - 1) * s; if (sq !== 1) { cam.projectionMatrix.elements[0] *= sq; cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert(); }
    cam.updateMatrixWorld();
    return s;
  }

  // ---------------------------------------------------------------- per frame (no allocations)
  const corners = [new V3(-0.5, -0.5, 0), new V3(0.5, -0.5, 0), new V3(0.5, 0.5, 0), new V3(-0.5, 0.5, 0)], cv = new V3();
  function screenRect(out = { x: 0, y: 0, w: 0, h: 0 }) {
    const m = mons.centre.screen.matrixWorld; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const c of corners) { cv.copy(c).applyMatrix4(m).project(cam); const x = (cv.x * 0.5 + 0.5) * W, y = (0.5 - cv.y * 0.5) * H; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    out.x = x0; out.y = y0; out.w = x1 - x0; out.h = y1 - y0; return out;
  }
  const sr = { x: 0, y: 0, w: 0, h: 0 };
  const coverage = r => Math.max(0, Math.min(W, r.x + r.w) - Math.max(0, r.x)) * Math.max(0, Math.min(H, r.y + r.h) - Math.max(0, r.y)) / (W * H);
  const lampCol = new THREE.Color(1.0, 0.68, 0.38), tmpC = new THREE.Color();
  const pu = { dt: 0, t: 0, focus: 0, aperture: 0, maxblur: 0, ca: 0 };
  let lastT = 0, cabAcc = 0, frames = 0, ftAcc = 0, ftN = 0, reflW = 0, reflH = 0, cov = 0;
  let enh = 0, enhT0 = 0, moveT = 0, prWant = pr;
  function frame(now) {
    const t = now / 1000, dt = lastT ? Math.min(0.1, t - lastT) : 1 / 60; lastT = t; clock += dt;
    renderer.info.reset();
    if (enhT0) enh = Math.min(1, (now - enhT0) / FADE_MS);
    const p = prog, s = pose(p, clock);
    outside.update(clock); time.value = clock; screens.tick();
    cov = coverage(screenRect(sr));
    const glare = 1 - sstep(GLARE_COV[0], GLARE_COV[1], cov);   // 1 while the room is the picture, 0 once the screen is

    // centre feed: the cab view dips to black, then the Series B still comes up (never both visible); cab at 30 Hz on low
    const cu = screens.centre.uniforms, live = screens.cabLive !== false;
    const feed = (1 - 0.9 * sstep(FEED_DIP[0], FEED_DIP[1], p)) * (1 - sstep(FEED_DIP[1], FEED_DIP[2], p)), mix = sstep(STILL_IN[0], STILL_IN[1], p);
    cu.uFeed.value = feed; cu.uMix.value = mix;
    if (live) cu.uUI.value = 1 - sstep(FEED_DIP[0] - 0.04, FEED_DIP[1], p);
    cabAcc += dt;
    if (mix < 0.98 && live && (HIGH || cabAcc > 1 / 30)) { cabAcc = 0; cab.update(clock); cab.render(renderer); }
    const near = sstep(0.0, 0.7, p), end = sstep(0.86, 0.97, p);

    // exposure ride: open a touch on the wide (the site), close as the screen fills frame, back to 1 for the hand-off.
    // the screens are compensated progressively so their pixels land as authored by the time they are the picture.
    const ex = 1.06 - 0.13 * sstep(0.2, 0.68, p) + 0.07 * sstep(0.72, 0.93, p);
    renderer.toneMappingExposure = ex; screens.setExposure(1 + (ex - 1) * sstep(0.45, 0.88, p));
    screens.setLevels?.(0.86, 0.95, 0.86);
    screens.setSubpixel?.(0.55 * sstep(0.5, 0.74, p) * glare);

    // monitor spill: colour follows each feed, softens as we close in (the frame is the screen then); the centre dims with the dip
    const glow = 1 - 0.35 * near, lit = Math.max(feed * (1 - mix), mix);
    if (mons.left?.light) { mons.left.light.color.copy(spill.left); mons.left.light.intensity = 2.3 * glow; }
    if (mons.right?.light) { mons.right.light.color.copy(spill.right); mons.right.light.intensity = 2.3 * glow; }
    if (mons.centre?.light) { mons.centre.light.color.copy(spill.cab).lerp(spill.still, mix); mons.centre.light.intensity = 2.8 * glow * (0.2 + 0.8 * lit); }
    moonFill.intensity = (HIGH ? 0.55 : 0.4) * (1 - 0.4 * near);

    // atmosphere + beams + dust
    const lampK = (1 - 0.5 * end) * LAMP_K;
    if (atmo) {
      const au = atmo.uniforms; au.time.value = clock;
      for (let i = 0; i < spots.length && i < 4; i++) { spots[i].getWorldPosition(cv); au.lampP.value[i].set(cv.x, cv.y, cv.z, 0.1 * lampK); au.lampC.value[i].copy(lampCol); }
      tmpC.copy(mons.centre?.light?.color ?? spill.cab).lerp(spill.left, 0.4); au.roomC.value.copy(tmpC).multiplyScalar(0.0022 * (1 - sstep(0.4, 0.62, p)) * glare * lit); // screen-light haze: follows what the screen shows, gone before it is the picture
      mons.centre.screen.getWorldPosition(au.roomP.value); au.roomP.value.z += 0.35;
    }
    for (const c of cones.children) c.material.uniforms.uCol.value.setRGB(1.0, 0.7, 0.4).multiplyScalar(0.04 * lampK);

    // lens: rack focus with shaped bokeh, fully sharp for the hand-off
    const dofK = HIGH ? 1 - sstep(0.88, 0.98, p) : 0;
    const aperture = (3.2 + 6 * near) * dofK, maxblur = 16 / 1600 * dofK;      // CoC px per dioptre and max CoC radius, at 1600 px wide
    if (dust) {
      const da = enh * (1 - sstep(0.7, 0.9, p)) * glare; dust.visible = da > 0.001;
      const bw = W * pr; dustU.focus.value = focusDist; dustU.cocK.value = aperture * bw / 1600; dustU.maxC.value = maxblur * bw;
      dustU.pxScale.value = H * pr * cam.projectionMatrix.elements[5] * 0.5; dustU.amt.value = da;
      mons.centre.screen.getWorldPosition(dustU.lightP.value); dustU.lightC.value.copy(mons.centre.light?.color ?? spill.cab).lerp(spill.right, 0.35);
    }
    post.bloom.strength = (0.66 - 0.42 * sstep(0.55, 1, p)) * (0.3 + 0.7 * glare); post.bloom.radius = 0.55; post.bloom.threshold = 0.8;
    lensU.barrel.value = 0.035 * (1 - s); lensU.vig.value = 0.6 - 0.32 * s; lensU.grain.value = 0.032 - 0.016 * s;
    lensU.grade.value = 1 - end; lensU.hal.value = 0.12 * (1 - end) * glare; lensU.streak.value = 0.6 * (1 - end) * enh * glare;
    if (streak) { streak.enabled = lensU.streak.value > 0.002; streak.uniforms.minZ.value = Math.max(0.5, cam.position.z - GLASS_Z + 0.3); streak.uniforms.thr.value = 2.2; }
    pu.dt = dt; pu.t = clock; pu.focus = focusDist; pu.aperture = aperture; pu.maxblur = maxblur; pu.ca = 0.022 * (1 - s) + 0.004;
    post.update(pu);

    // window reflection: half res, every frame while the glass is in the shot (skipped, no mips, once it is not)
    const reflK = mirror ? enh * (1 - sstep(MIRROR_OFF[0], MIRROR_OFF[1], p)) : 0;
    let ok = false;
    if (reflK > 0.001) {
      const rw = Math.max(1, Math.round(W * pr / 2)), rh = Math.max(1, Math.round(H * pr / 2));
      if (rw !== reflW || rh !== reflH) { reflW = rw; reflH = rh; mirror.setSize(rw, rh); }
      ok = mirror.render(renderer, scene, cam, reflHide);
    }
    glassU.uReflK.value = ok ? reflK : 0;

    // hand-off pass follows the projected screen (canvas pixels: the canvas runs at DPR)
    const hu = hand.uniforms, ha = sstep(HAND_IN[0], HAND_IN[1], p); hu.amt.value = ha; hu.outFade.value = fadeOutside ? sstep(HAND_IN[0], 1, p) : 0;
    if (ha > 0) { const r = p >= 1 ? target : sr; hu.rect.value.set(r.x / W, 1 - (r.y + r.h) / H, (r.x + r.w) / W, 1 - r.y / H); hu.res.value.set(W * DPR, H * DPR); hu.rad.value = targetRad * DPR * sstep(HAND_IN[0], 1, p); }
    atmoRan = false;
    post.render();
    // adaptive resolution (high only): sustained slow frames lower the post ratio a notch, applied only while the scroll is idle
    if (HIGH && running) { ftAcc += dt; ftN++; if (ftN >= 90) { const avg = ftAcc / ftN; ftAcc = ftN = 0; if (avg > 1 / 45 && prWant > 1) prWant = Math.max(1, prWant - 0.25); } }
    if (prWant !== pr && now - moveT > 400) setPR(prWant);
    frames++;
  }
  function setPR(v) { pr = prWant = v; post.composer.setPixelRatio(pr); post.resetMotion(); }

  // ---------------------------------------------------------------- async compile against the real targets
  // three picks tone mapping / output colour space from the bound target, so each compile binds the target it draws into.
  const tmpRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const fsGeo = new THREE.PlaneGeometry(2, 2), fsCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  let depthMats = null;
  function compileTo(target, obj, camera, targetScene = null) {
    const old = renderer.getRenderTarget(); renderer.setRenderTarget(target);
    try { return renderer.compileAsync(obj, camera, targetScene); } finally { renderer.setRenderTarget(old); }
  }
  function detached(objs, fn) { // compile without these (their materials and lights), restoring the exact child order
    const saved = [];
    for (const o of objs) { if (!o?.parent) continue; const par = o.parent, i = par.children.indexOf(o); par.children.splice(i, 1); saved.push([par, i, o]); }
    try { return fn(); } finally { for (let k = saved.length - 1; k >= 0; k--) { const [par, i, o] = saved[k]; par.children.splice(i, 0, o); } }
  }
  function compileFS(mats, target) {
    if (!mats.length) return Promise.resolve();
    const sc = new THREE.Scene(); for (const m of mats) sc.add(new THREE.Mesh(fsGeo, m));
    return compileTo(target, sc, fsCam);
  }
  function compileDepth(targetScene, camera) { // shadow-map depth programs (they take the scene's light state)
    if (!renderer.shadowMap.enabled) return Promise.resolve();
    depthMats ||= [THREE.BackSide, THREE.DoubleSide, THREE.FrontSide].map(side => new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side }));
    const g = new THREE.Group(); for (const m of depthMats) g.add(new THREE.Mesh(fsGeo, m));
    return compileTo(tmpRT, g, camera, targetScene);
  }
  function postMats(skip) { // every full-screen material the chain draws (minus the ones it never uses here)
    const out = new Set(), add = m => { if (m?.isShaderMaterial && !skip.includes(m)) out.add(m); };
    for (const pass of P) {
      if (pass === hand) continue;
      pass.materials?.forEach(add);
      for (const k of Object.keys(pass)) { const v = pass[k]; if (v?.isShaderMaterial) add(v); else if (Array.isArray(v)) v.forEach(add); }
    }
    return [...out];
  }
  const unused = [post.dof.materialBokeh, mbPass.mTrail].filter(Boolean);
  function compileLean() {
    const jobs = [];
    detached([dust, backRoom], () => jobs.push(compileTo(scenePass.rt, scene, cam)));   // HDR target: linear, no tone map
    jobs.push(compileTo(cab.rt, cab.scene, cab.cam));
    jobs.push(compileFS(postMats([...unused, ...(streak?.materials ?? [])]), tmpRT));
    jobs.push(compileFS([hand.material], null));                                        // the canvas: sRGB out
    jobs.push(compileDepth(scene, cam), compileDepth(cab.scene, cab.cam));
    return Promise.all(jobs);
  }
  function compileRich() {
    const jobs = [];
    if (dust) jobs.push(compileTo(scenePass.rt, dust, cam, scene));
    if (streak) jobs.push(compileFS(streak.materials, tmpRT));
    if (mirror) {
      reflW = Math.max(1, Math.round(W * pr / 2)); reflH = Math.max(1, Math.round(H * pr / 2)); mirror.setSize(reflW, reflH);
      // the mirror pass sees the room only (outside, glass, beams, dust hidden): its own light state, so its own programs;
      // the shadow pass that follows it in a frame inherits that light state too
      detached([outside.group, cones, dust, room.glass], () => jobs.push(compileTo(mirror.raw, scene, mirror.vcam), compileDepth(scene, cam)));
      jobs.push(compileFS(mirror.materials, mirror.rt));
    }
    return Promise.all(jobs);
  }

  // ---------------------------------------------------------------- textures stream in after ready (never block it)
  let texApi = null, glassTex = null, texQueued = false;
  function applyTextures() { // roles land one by one: coalesce into one apply per burst (only ref swaps: placeholders are bound)
    if (texQueued) return; texQueued = true; setTimeout(applyNow, 30);
  }
  function applyNow() {
    texQueued = false; if (dead || !texApi) return;
    for (const [inst, mod] of [[room, RoomMod], [outside, OutMod]]) {
      const fn = inst.applyHeroTextures ? inst.applyHeroTextures.bind(inst) : mod.applyHeroTextures;
      try { fn?.(texApi, inst); } catch (e) { console.warn('d6 hero textures:', e); }
    }
    const g = texApi.get?.('glass_smudge'), m = g && (g.roughnessMap || g.dirtMap || g.map);
    if (m && m !== glassTex) { glassTex = m; glassU.tSmudge.value = m; glassU.hasSm.value = 1; }
  }
  function startTextures() {
    import('./hero-tex.js').then(mod => {
      if (dead || !mod.loadHeroTextures) return;
      texApi = mod.loadHeroTextures({ THREE, renderer, quality: HIGH ? 'high' : 'low', base: new URL('./assets/tex/', import.meta.url).href, roles: HERO_ROLES });
      if (texApi?.onReady) texApi.onReady(applyTextures); else texApi?.ready?.then(applyTextures);
    }).catch(() => { /* textures are optional: flat materials stay */ });
  }

  // ---------------------------------------------------------------- loop + api
  let running = false, raf = 0, dead = false, stage = 0;   // stage: 0 booting, 1 lean (ready), 2 enhancing, 3 enhanced
  const loop = now => { if (!running) return; raf = requestAnimationFrame(loop); frame(now); };
  function resize() {
    W = Math.max(1, host.clientWidth); H = Math.max(1, host.clientHeight);
    post.setSize(W, H); canvas.style.width = canvas.style.height = '100%';
    solve(); post.resetMotion();
  }
  solve();
  post.setSize(W, H); canvas.style.width = canvas.style.height = '100%';

  const ready = (async () => {
    // neither the Series B still (seen from p ~0.64) nor the textures gate the boot: they swap in when they land
    screens.stillReady.then(ok => { if (!ok || dead) return; solve(); idle(() => { if (!dead) renderer.initTexture(screens.still); }); }); // upload off the scroll path
    pose(0, 0); outside.update(0); cab.update(0);
    try { await compileLean(); } catch (e) { if (DEBUG) console.warn('d6 hero compile:', e); }
    if (dead) return false;
    await yieldTask(); if (dead) return false;
    cab.render(renderer);
    await yieldTask(); if (dead) return false;
    if (post.ao.enabled) { mbPass.blur = true; mbPass.alloc(); mbPass.blur = false; if (mbPass.tmp) { renderer.setRenderTarget(mbPass.tmp); renderer.setRenderTarget(null); } } // motion-blur scratch target
    frame(performance.now());
    stage = 1;
    startTextures();
    if (enhanceMode !== 'manual') idle(() => { if (!dead) enhance(); });
    return true;
  })();

  // after ready: compile the rich layers, warm frames at p 0.5 and 1 in one task (the canvas only shows the last one), fade in
  let enhP = null;
  function enhance() {
    return enhP ||= (async () => {
      if (!(await ready) || dead) return false;
      stage = 2;
      if (RICH) {
        try { await compileRich(); } catch (e) { if (DEBUG) console.warn('d6 hero compile:', e); }
        if (dead) return false;
        await yieldTask(); if (dead) return false;
        const keep = prog, now = performance.now();
        enh = 1;
        for (const v of [0.5, 1, 0]) { prog = v; frame(now); }
        prog = keep; enh = 0; enhT0 = now; frame(now); post.resetMotion();
      } else enhT0 = performance.now();
      stage = 3;
      await new Promise(r => setTimeout(r, FADE_MS));
      return !dead;
    })();
  }

  return {
    ready, renderer, scene, camera: cam, post,
    fx: { atmo, streak, mirror, lens: lensU, glass: glassU, dust: dustU, cones, moonFill },   // look tunables (QA)
    enhance,                                                                       // mirror, streaks, dust (auto after ready unless enhance: 'manual')
    setProgress(p) { const v = Math.min(1, Math.max(0, +p || 0)); if (v !== prog) { prog = v; moveT = performance.now(); } },
    setTarget(rect, radius) { if (!rect) { autoTarget = true; } else { target = { x: rect.x ?? rect.left, y: rect.y ?? rect.top, w: rect.w ?? rect.width, h: rect.h ?? rect.height }; autoTarget = false; } if (radius !== undefined) targetRad = radius; solve(); },
    screenRect() { pose(prog, clock); return screenRect(); },
    setPointer(x, y) { ptrX = Math.max(-1, Math.min(1, x)); ptrY = Math.max(-1, Math.min(1, y)); },
    // centre end frame (Series B): the 3D screen and the hand-off composite both use it
    setMedia(el) { const t = screens.setMedia(el); hand.uniforms.tStill.value = t; solve(); return t; },
    // live feed on screen i (0 left, 1 centre cab feed, 2 right); null restores the procedural feed
    setScreenMedia(i, el, opts) { return screens.setScreenMedia(i, el, opts); },
    start() { if (running || dead) return; running = true; lastT = 0; post.resetMotion(); raf = requestAnimationFrame(loop); },
    stop() { running = false; cancelAnimationFrame(raf); },
    renderOnce() { if (!dead) frame(performance.now()); },
    resize,
    stats() { const i = renderer.info; return { calls: i.render.calls, triangles: i.render.triangles, pixelRatio: pr, dpr: DPR, frames, programs: i.programs?.length, stage, enh, coverage: cov, rich: RICH }; },
    dispose() {
      if (dead) return;
      running = false; dead = true; cancelAnimationFrame(raf);
      try { texApi?.dispose?.(); } catch (_) { /* best effort */ }
      room.dispose(); outside.dispose(); cab.dispose(); screens.dispose(); mirror?.dispose(); atmo?.dispose(); streak?.dispose(); post.dof.dispose?.();
      for (const o of [...cones.children, dust, ...backRoom.children].filter(Boolean)) { o.geometry?.dispose(); o.material?.dispose(); }
      room.glass?.material?.dispose?.();
      // passes: their own dispose where they have one, plus every target / material they hold (D5 passes miss some)
      for (const pass of post.composer.passes) {
        try { pass.dispose?.(); } catch (_) { /* already gone */ }
        for (const k of Object.keys(pass)) { const v = pass[k]; for (const x of Array.isArray(v) ? v : [v]) if (x?.isWebGLRenderTarget || x?.isMaterial) x.dispose(); }
      }
      post.composer.dispose?.();
      tmpRT.dispose(); fsGeo.dispose(); depthMats?.forEach(m => m.dispose());
      renderer.dispose(); if (!cvIn) canvas.remove();
    }
  };
}
