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
import { sstep, noise1, NOISE3, rng, createAtmosphere, upgradeDOF, createStreaks, filmLens, createMirror, NOISE, FIN } from './hero-glsl.js';

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
const LAMP_COPY = 0.3;                              // lamp glow / head / beam held down this much while the hero copy is up
const COPY_OUT = 0.42 / 0.85;                       // hero p where main.js has faded the copy out (page p 0.42 / P_CARD 0.85)
const LEAD_DARK = 0.34;                             // in-frame falloff behind the lead copy (tone-mapped, scaled by copy opacity)
// texture roles the hero's materials actually bind (night_sky_hdr, rubber_track, tyre_track_decal are not used)
// order = stream order: what fills the first frame (ground, ridge, machine, desk) before the room detail
const HERO_ROLES = ['dirt_ground', 'dirt_tracks', 'desk_laminate', 'excavator_paint', 'rock_ridge', 'glass_smudge', 'black_plastic', 'brushed_metal', 'concrete_floor', 'gravel', 'rusty_metal', 'fabric_chair', 'carpet', 'ceiling_panel'];

const coarsePointer = () => {
  try { return matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent)); } catch (_) { return false; }
};
const yieldTask = () => new Promise(r => setTimeout(r, 0));
const idle = fn => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 1500 }) : setTimeout(fn, 300));

// ---------------------------------------------------------------- site lighting pass (texture read at grazing angles)
// The site is seen almost edge-on at night, so surface detail only reads where light rakes across it. On top of the
// modeller's rig (hero-outside.js) this: drives the two towers harder, adds an off-frame raking flood from low on the left
// (no fixture, no cone, no glow: the one visible lamp stays the right tower) that throws long relief shadows across the
// yard, lifts sky fill, turns the moon into a cool back/rim light on the machines, and gives the terrain a roughness
// breakup (wet / compacted dirt glints, matte at distance so nothing aliases) plus a rotated detail-normal layer that kills
// the 4 m tile near the dig. Everything is a shader injection chained after the modeller's onBeforeCompile, guarded by
// anchors: if they rename things the terrain keeps its own look.
const RAKE = { pos: [-58, 13, -18], at: [18, -1, -56], col: 0xe4ebff, I: 6500, angle: 0.45 };   // cool LED flood vs the sodium towers
function lightSite({ THREE, outside, high, G0 }) {
  const g = outside.group; if (!g) return {};
  for (const s of outside.spots || []) s.intensity *= 1.7;
  if (outside.spots?.[0]) outside.spots[0].distance = 64;   // tower 0 faces the building: stop it at the near yard (no glare under the glass)
  // sky fill: a soft, range-cut cone straight down over the yard (the hemi reaches the room and washed the monitors)
  const sky = new THREE.SpotLight(0x5a74b8, high ? 0.5 : 0.4, 120, 0.68, 1, 0); sky.position.set(0, G0 + 70, -64); sky.target.position.set(0, G0, -64); g.add(sky, sky.target);
  if (outside.moon) { outside.moon.intensity = 0.45; outside.moon.color.setRGB(0.5, 0.62, 0.95); }   // directional: it reaches the room too, so kept low
  // raking flood: low, long throw, shadowed (high) so windrows / spoil / machines lay long shadows across the tracks
  const rake = new THREE.SpotLight(RAKE.col, RAKE.I, 0, RAKE.angle, 0.7, 2);
  rake.position.set(RAKE.pos[0], G0 + RAKE.pos[1], RAKE.pos[2]); rake.target.position.set(RAKE.at[0], G0 + RAKE.at[1] + 1, RAKE.at[2]);
  if (high) { rake.castShadow = true; rake.shadow.mapSize.set(2048, 2048); rake.shadow.camera.near = 8; rake.shadow.camera.far = 160; rake.shadow.bias = -0.0004; rake.shadow.normalBias = 0.05; rake.shadow.radius = 2; }
  g.add(rake, rake.target);
  // rims: spots from behind the machines with a hard range cut, so they can never reach the room (a directional this
  // strong glared on the monitors): a cool moon kicker from behind left, a warm one from behind right
  const rims = [[[-26, 16, -112], [6, 1, -50], 0x8fa8ff, 2600], [[44, 12, -100], [4, 1, -52], 0xffb070, 2200]].map(([p, t, c, I]) => {
    const s = new THREE.SpotLight(c, high ? I : I * 0.7, 95, 0.6, 0.8, 2); s.position.set(p[0], G0 + p[1], p[2]); s.target.position.set(t[0], G0 + t[1], t[2]); g.add(s, s.target); return s; });
  const rim = rims[1];
  // machine paint / metal: a bit glossier so the rim and floods break up on them
  g.traverse(o => {
    const m = o.material; if (!m || !m.isMeshStandardMaterial) return;
    const k = m.customProgramCacheKey?.call(m);
    if (k === 'd6night-paint') { m.roughness = Math.min(m.roughness, 0.42); m.envMapIntensity = 0.9; }
    else if (k === 'd6night-metal') { m.roughness = Math.min(m.roughness, 0.35); m.envMapIntensity = 1.3; }
    else if (k === 'd6hero-terrain') patchTerrain(THREE, m);
  });
  return { rake, rim, rims, sky };
}
function patchTerrain(THREE, m) {
  const prev = m.onBeforeCompile, key = m.customProgramCacheKey;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    let f = sh.fragmentShader;
    if (!/varying vec3 vW/.test(f) || !/terrK/.test(f) || !/fbm2/.test(f)) return;   // modeller changed the terrain: keep theirs
    f = f.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      float tDist=length(vW-cameraPosition);
      { float ormR=.9;
        #ifdef USE_AOMAP
        ormR=texture2D(aoMap,vAoMapUv).g;                                   // dirt_ground ORM: G = roughness
        #endif
        float wet=smoothstep(.5,.85,fbm2(vW.xz*.06+3.));                    // the dark wet patches the colour pass lays down
        float pack=smoothstep(.35,.75,fbm2(vW.xz*.21+17.));                 // compacted, polished by tracks
        float rr=mix(.97, mix(.84,.98,ormR), terrK);
        rr=mix(rr,.6,wet*.7); rr=mix(rr,.72,pack*.35*terrK);
        roughnessFactor=mix(rr,.97,clamp(smoothstep(40.,95.,tDist)+1.-smoothstep(9.,16.,tDist),0.,1.)); }   // far and under the window: matte`);
    // the modeller's screen-space bump (dFdx of value noise at 9 cm / 43 cm, quad-coarse, never filtered) sparkles as the camera
    // floats: it was half the frame-to-frame ground flicker. Each octave fades before it drops under 2 px per period, and the
    // noise octaves go entirely once the scans land (their mipped normals carry the grain stably).
    f = f.replace(/float bh=\(n2\*\.35\+n3\*\.1\)\*\(1\.-\.45\*terrK\)\+tr\*\.08\*/, 'float fpw=length(fwidth(vW.xz)); float bh=(n2*.35*(1.-smoothstep(.09,.2,fpw))+n3*.1*(1.-smoothstep(.02,.045,fpw)))*(1.-terrK)+(1.-smoothstep(.15,.4,fpw))*tr*.08*');   // scans landed: their (mipped) normals carry the grain
    f = f.replace('#include <emissivemap_fragment>', `
      if(!(dot(nonPerturbedNormal,nonPerturbedNormal)>1e-6)) nonPerturbedNormal=normalize((viewMatrix*vec4(0.,1.,0.,0.)).xyz);
      if(!(dot(normal,normal)>1e-6)) normal=nonPerturbedNormal;             // degenerate screen-space bump (det = 0 on edge-on quads): never NaN
      #ifdef USE_NORMALMAP_TANGENTSPACE
      { float near=(1.-smoothstep(14.,70.,tDist))*(1.-smoothstep(.03,.08,length(fwidth(vW.xz))));  // rotated 1.3 m detail layer, footprint-faded
        vec2 du=mat2(.8,-.6,.6,.8)*vW.xz/1.3+vec2(.37,.11);
        vec3 dn=texture2D(normalMap,du).xyz*2.-1.;
        vec3 nn=normal+tbn*vec3(dn.xy*.32*near*terrK,0.);
        if(dot(nn,nn)>1e-6) normal=normalize(nn); }
      #endif
      { vec3 nx=dFdx(normal), ny=dFdy(normal);                                // specular AA (Kaplanyan / Tokuyoshi): normal variance -> roughness
        float a=roughnessFactor*roughnessFactor, k2=min(.5*(dot(nx,nx)+dot(ny,ny)),.18);
        roughnessFactor=max(sqrt(sqrt(clamp(a*a+k2,0.,1.))),.5); }
      #include <emissivemap_fragment>`);
    sh.fragmentShader = f;
  };
  m.customProgramCacheKey = () => (key ? key.call(m) : '') + '-lit';
  m.needsUpdate = true;
}

// The room has a roof and walls the site lights do not see, and three has no per-object light masks: the floods (all the
// scene's spot lights live outside) and the moon (directional) reached the desk through it. Tower 0 aims at the room, so its
// specular on the desk blew out right of the keyboard, and the floods / moon left a cool sheen on the left desk end that
// bloomed over the left monitor. Room materials drop spot + directional light (hemi stays as ambient; monitor spill and
// the moon fill are rect area lights). Chained after any onBeforeCompile the room already has (the glazing's noFlood).
const SPOT_CALL = 'getSpotLightInfo( spotLight, geometryPosition, directLight );', DIR_CALL = 'getDirectionalLightInfo( directionalLight, directLight );';
function roomOffSite(THREE, root) {
  if (!root) return;
  const done = new Set();
  root.traverse(o => {
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || done.has(m) || !(m.isMeshStandardMaterial || m.isMeshPhongMaterial || m.isMeshLambertMaterial)) continue;
      done.add(m);
      const prev = m.onBeforeCompile, key = m.customProgramCacheKey;
      m.onBeforeCompile = (sh, r) => {
        prev?.call(m, sh, r);
        let f = sh.fragmentShader;
        if (f.includes('#include <lights_fragment_begin>')) f = f.replace('#include <lights_fragment_begin>', THREE.ShaderChunk.lights_fragment_begin);
        for (const c of [SPOT_CALL, DIR_CALL]) f = f.split(c).join(c + ' directLight.color = vec3( 0.0 );');
        sh.fragmentShader = f;
      };
      m.customProgramCacheKey = () => (key ? key.call(m) : '') + '-nosite';
      m.needsUpdate = true;
    }
  });
}

// Every lit material in the scene writes a finite, bounded HDR value: a near-mirror specular (cab glass, polished metal
// swinging through a flood's reflection) can pass 65504 and become inf in the half-float target, and a NaN / inf texel
// spreads through bloom into a one-frame black block. Chained after any onBeforeCompile already there.
function guardOutput(THREE, root) {
  const done = new Set(), geos = new Set();
  root.traverse(o => {
    // zero-area triangles carry zero-length vertex normals (two on the mouse, three on a site prop): normalize(0) is NaN on
    // real GPUs, and those slivers only rasterise on the odd frame as the camera floats. Give them a unit normal.
    const n = o.geometry?.attributes?.normal;
    if (n && !geos.has(o.geometry)) { geos.add(o.geometry); let fixed = 0;
      for (let i = 0; i < n.count; i++) { const x = n.getX(i), y = n.getY(i), z = n.getZ(i), l = x * x + y * y + z * z; if (!(l > 1e-8) || !Number.isFinite(l)) { n.setXYZ(i, 0, 1, 0); fixed++; } }
      if (fixed) n.needsUpdate = true; }
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (!m || done.has(m) || m.isShaderMaterial || !(m.isMeshStandardMaterial || m.isMeshPhongMaterial || m.isMeshLambertMaterial || m.isMeshBasicMaterial)) continue;
      done.add(m);
      const prev = m.onBeforeCompile, key = m.customProgramCacheKey;
      m.onBeforeCompile = (sh, r) => {
        prev?.call(m, sh, r);
        if (!sh.fragmentShader.includes('#include <dithering_fragment>')) return;
        sh.fragmentShader = sh.fragmentShader.replace('void main()', FIN + '\nvoid main()')
          .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n\tgl_FragColor.rgb = fin( gl_FragColor.rgb );');
      };
      m.customProgramCacheKey = () => (key ? key.call(m) : '') + '-fin';
      m.needsUpdate = true;
    }
  });
}

// ---------------------------------------------------------------- night to day across the scroll
// Keys on hero p: night (copy up) -> blue hour -> sunrise behind the ridge (warm, raking, long shadows) -> neutral morning
// daylight by the Series B hand-off (a daylight photo). Everything is uniforms / light values / one fixed-size PMREM target
// rebaked every ENV_STEP of p, so scrolling never compiles. The sun rises a touch right of centre, between the H1 and the lead.
const ENV_STEP = 0.03;
const C3 = (r, g, b) => [r, g, b];
const DAY_KEYS = [ // p, values (linear colours)
  [0, { mix: 0, zen: C3(.002, .004, .012), hor: C3(.05, .16, .44), glow: C3(0, 0, 0), el: -.2, az: .12, sunI: 0, sunC: C3(1, .4, .15), hemiI: .2, hemiS: C3(.016, .037, .117), hemiG: C3(.007, .0044, .0027),
    flood: 1, moon: 1, hazeC: C3(.014, .05, .17), hazeLow: C3(.05, .045, .05), hazeD: .0035, exp: 1, winI: 1, winC: C3(.36, .45, .72), envK: .6, mach: 0, scat: 0, city: 1 }],
  [0.14, {}],                                                                                     // hold the night while the copy is fully up
  [0.36, { mix: .5, zen: C3(.012, .03, .1), hor: C3(.3, .34, .55), glow: C3(.7, .3, .1), el: -.08, az: .14, hemiI: .3, hemiS: C3(.04, .06, .15), hemiG: C3(.015, .01, .007),
    flood: .75, moon: .5, hazeC: C3(.05, .07, .16), hazeLow: C3(.12, .08, .07), hazeD: .004, exp: 1.04, winI: 1.2, winC: C3(.45, .5, .75), envK: .7, mach: .15, scat: .35, city: .7 }],
  [0.5, { mix: .85, zen: C3(.05, .1, .26), hor: C3(1.1, .55, .25), glow: C3(1.2, .5, .16), el: .015, az: .18, sunI: .5, sunC: C3(1, .48, .2), hemiI: .5, hemiS: C3(.22, .22, .32), hemiG: C3(.12, .08, .05),
    flood: .3, moon: .15, hazeC: C3(.2, .13, .09), hazeLow: C3(.24, .15, .09), hazeD: .005, exp: .86, winI: 2, winC: C3(1, .7, .5), envK: 1, mach: .45, scat: 1, city: .3 }],
  [0.62, { mix: 1, zen: C3(.1, .2, .46), hor: C3(1.1, .75, .5), glow: C3(1.2, .65, .3), el: .11, az: .24, sunI: 2.2, sunC: C3(1, .64, .36), hemiI: .8, hemiS: C3(.35, .4, .55), hemiG: C3(.2, .15, .1),
    flood: 0, moon: 0, hazeC: C3(.4, .3, .24), hazeLow: C3(.45, .32, .22), hazeD: .0045, exp: .8, winI: 2.8, winC: C3(1, .82, .65), envK: 1.2, mach: .7, scat: .9, city: 0 }],
  [0.8, { zen: C3(.16, .32, .7), hor: C3(.85, .82, .8), glow: C3(1, .8, .55), el: .32, az: .34, sunI: 3, sunC: C3(1, .86, .7), hemiI: 1, hemiS: C3(.45, .55, .8), hemiG: C3(.25, .2, .15),
    hazeC: C3(.42, .4, .4), hazeLow: C3(.45, .4, .35), hazeD: .004, exp: .7, winI: 3.4, winC: C3(.97, .92, .86), envK: 1.4, mach: 1, scat: .6 }],
  [1, { zen: C3(.18, .36, .8), hor: C3(.8, .84, .9), glow: C3(.6, .55, .45), el: .6, az: .45, sunI: 3.4, sunC: C3(1, .96, .9), hemiI: 1.1, hemiS: C3(.45, .56, .85), hemiG: C3(.26, .21, .16),
    hazeC: C3(.45, .47, .52), hazeLow: C3(.45, .42, .4), hazeD: .0035, exp: .66, winI: 3.6, winC: C3(.95, .95, .95), envK: 1.5, scat: .5 }],
];
for (let i = 1; i < DAY_KEYS.length; i++) DAY_KEYS[i][1] = { ...DAY_KEYS[i - 1][1], ...DAY_KEYS[i][1] };   // each key inherits what it does not set
function dayKey(p, out) {
  let i = 0; while (i < DAY_KEYS.length - 2 && p > DAY_KEYS[i + 1][0]) i++;
  const [p0, a] = DAY_KEYS[i], [p1, b] = DAY_KEYS[i + 1], t0 = Math.min(1, Math.max(0, (p - p0) / (p1 - p0))), t = t0 * t0 * (3 - 2 * t0);
  for (const k in a) { const x = a[k], y = b[k]; if (Array.isArray(x)) { const o = out[k] ||= [0, 0, 0]; for (let j = 0; j < 3; j++) o[j] = x[j] + (y[j] - x[j]) * t; } else out[k] = x + (y - x) * t; }
  return out;
}
function createDaylight({ THREE, renderer, scene, outside, siteLight, high, G0 }) {
  const g = outside.group, K = dayKey(0, {}), V3 = THREE.Vector3;
  const sunDir = new V3(0, -1, 0), sunCol = new THREE.Color();
  // sun: warm, low and raking at first, neutral and higher by the hand-off; shadows from a static frustum over the yard
  // (only the direction moves, with p). The room ignores it (roomOffSite zeroes directional lights): the window fill does that.
  const sun = new THREE.DirectionalLight(0xffffff, 0); sun.target.position.set(0, G0, -55); g.add(sun, sun.target);
  if (high) { sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 10, far: 360 }); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.05; sun.shadow.autoUpdate = false; }
  // sky dome: blend the modeller's night sky (stars and all) into an analytic dawn / day sky with the sun disc and glow
  const skyD = { uZen: { value: new THREE.Color() }, uHor: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uSunC: { value: new THREE.Color() }, uSunDir: { value: sunDir }, uMix: { value: 0 } };
  g.traverse(o => { const m = o.material; if (!m?.isShaderMaterial || !m.uniforms?.cHor || m.userData.dayPatched) return;
    const f = m.fragmentShader, end = 'gl_FragColor=vec4(c,1.); }';
    if (!f.includes(end)) return;
    Object.assign(m.uniforms, skyD); m.userData.dayPatched = true;
    m.fragmentShader = 'uniform vec3 uZen, uHor, uGlow, uSunC, uSunDir; uniform float uMix;\n' + f.replace(end, `
        { vec3 d=normalize(vD); float mu=max(dot(d,uSunDir),0.), eh=max(e,0.);
          vec3 dsk=mix(uHor,uZen,pow(smoothstep(-.02,.55,e),.55));
          dsk+=uGlow*(pow(mu,5.)*.5+pow(mu,40.)*1.4)*exp(-eh*2.5);                         // dawn glow hugging the sun
          dsk+=uGlow*.22*exp(-eh*12.)*(.4+.6*mu);                                            // the band along the ridge
          dsk+=uSunC*smoothstep(.99955,.9998,mu);                                            // disc (HDR: blooms)
          c=mix(c,dsk,uMix); }
        gl_FragColor=vec4(c,1.); }`);
    m.needsUpdate = true; });
  // machines: lift the night grade (desaturated, x0.34) back to full CAT yellow by day
  const machU = { value: 0 };
  g.traverse(o => { const m = o.material; if (!m?.isMeshStandardMaterial || m.userData.dayPatched) return;
    const k = m.customProgramCacheKey?.call(m) || ''; if (!k.startsWith('d6night-')) return;
    m.userData.dayPatched = true; const prev = m.onBeforeCompile;
    m.onBeforeCompile = (sh, r) => { prev?.call(m, sh, r); const a = '.14) * .34;';
      if (!sh.fragmentShader.includes(a)) return;
      sh.uniforms.uMach = machU; sh.fragmentShader = 'uniform float uMach;\n' + sh.fragmentShader.replace(a, '.14+.86*uMach) * mix(.34,1.,uMach);'); };
  });
  // reflections: one fixed-size PMREM target, rebaked from a painted equirect as the sky changes (no recompile: same target)
  const cv = document.createElement('canvas'); cv.width = 128; cv.height = 64; const cx = cv.getContext('2d'), img = cx.createImageData(128, 64);
  const eq = new THREE.CanvasTexture(cv); eq.mapping = THREE.EquirectangularReflectionMapping; eq.colorSpace = THREE.SRGBColorSpace;
  const pmrem = new THREE.PMREMGenerator(renderer); let envRT = null, bakedP = -1;
  const enc = x => Math.round(255 * Math.pow(Math.min(1, Math.max(0, x)), 1 / 2.2));
  function paint() {
    const d = img.data;
    for (let y = 0; y < 64; y++) { const el = (0.5 - (y + 0.5) / 64) * Math.PI, e = Math.sin(el);
      for (let x = 0; x < 128; x++) { const az = ((x + 0.5) / 128 - 0.5) * 2 * Math.PI;   // three's equirect: u = atan(dir.z, dir.x)
        const dx = Math.cos(el) * Math.cos(az), dz = Math.cos(el) * Math.sin(az), mu = Math.max(0, dx * sunDir.x + e * sunDir.y + dz * sunDir.z);
        const i = (y * 128 + x) * 4, tH = Math.pow(Math.min(1, Math.max(0, (e + 0.02) / 0.57)), 0.55);
        for (let c = 0; c < 3; c++) {
          let v = e >= -0.02 ? K.hor[c] + (K.zen[c] - K.hor[c]) * tH + K.glow[c] * (Math.pow(mu, 5) * 0.5 + 0.22 * Math.exp(-Math.max(e, 0) * 12)) : K.hemiG[c] * K.hemiI * 0.5;
          if (e < 0.03 && e > -0.03 && K.flood > 0 && (x === 30 || x === 70 || x === 100)) v += [1, .75, .45][c] * 0.8 * K.flood;   // site lamps on the night horizon
          d[i + c] = enc(v * 0.8); }
        d[i + 3] = 255; } }
    cx.putImageData(img, 0, 0); eq.needsUpdate = true;
  }
  function bake() { paint(); envRT = pmrem.fromEquirectangular(eq, envRT); }
  bake();
  const envMats = [], nightEnv = (() => { let t = null; g.traverse(o => { const k = o.material?.customProgramCacheKey?.call(o.material); if (!t && k === 'd6night-paint') t = o.material.envMap; }); return t; })();
  if (nightEnv) g.traverse(o => { const m = o.material; if (m?.envMap === nightEnv && !envMats.some(e => e[0] === m)) { m.envMap = envRT.texture; envMats.push([m, m.envMapIntensity]); } });
  // light bases (after lightSite's tuning) so the day can scale them down to off
  const base = l => l && [l, l.intensity];
  const floods = [...(outside.spots || []), siteLight.rake, siteLight.sky, ...(siteLight.rims || [])].filter(Boolean).map(base);
  const moon = base(outside.moon), hemi = outside.hemi, city = outside.city?.material;
  const fog = scene.fog;
  function update(p, renderer) {
    dayKey(p, K);
    sunDir.set(Math.sin(K.az) * Math.cos(K.el), Math.sin(K.el), -Math.cos(K.az) * Math.cos(K.el));
    sunCol.setRGB(...K.sunC);
    const vis = Math.min(1, Math.max(0, (K.el + 0.02) / 0.1));                         // the ridge holds the direct sun until ~0.08 rad
    sun.color.copy(sunCol); sun.intensity = K.sunI * vis;
    sun.position.copy(sun.target.position).addScaledVector(sunDir, 160);
    if (high) { const on = sun.intensity > 0.001; if (on && sun.userData.p !== p) { sun.shadow.needsUpdate = true; sun.userData.p = p; } }
    skyD.uZen.value.setRGB(...K.zen); skyD.uHor.value.setRGB(...K.hor); skyD.uGlow.value.setRGB(...K.glow); skyD.uSunC.value.copy(sunCol).multiplyScalar(60 * vis); skyD.uMix.value = K.mix;
    machU.value = K.mach;
    for (const [l, i] of floods) l.intensity = i * K.flood;
    if (moon) moon[0].intensity = moon[1] * K.moon;
    if (hemi) { hemi.intensity = K.hemiI; hemi.color.setRGB(...K.hemiS); hemi.groundColor.setRGB(...K.hemiG); }
    if (city) city.opacity = K.city;
    if (fog) fog.color.setRGB(...K.hazeC).multiplyScalar(0.2 + 0.6 * K.mix);
    for (const [m, i] of envMats) m.envMapIntensity = i * K.envK;
    if (Math.abs(p - bakedP) >= ENV_STEP || (p !== bakedP && (p === 0 || p === 1))) { bakedP = p; bake(); }
    return K;
  }
  return { sun, sunDir, sunCol, K, update, dispose() { envRT?.dispose(); eq.dispose(); pmrem.dispose(); } };
}

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
  roomOffSite(THREE, room.group);

  // ---------------------------------------------------------------- light: moon through the glass (one-sided area light, so the site is untouched)
  const moonFill = new THREE.RectAreaLight(0x5b74b8, HIGH ? 0.55 : 0.4, 14, 3.4);
  moonFill.position.set(0, 1.75, GLASS_Z + 0.03); moonFill.lookAt(0, 1.2, 6); scene.add(moonFill);
  const spill = { left: new THREE.Color(0.5, 0.62, 0.9), right: new THREE.Color(0.42, 0.74, 1.0), cab: new THREE.Color(1.0, 0.84, 0.66), still: new THREE.Color(0.78, 0.74, 0.7) };
  const siteLight = lightSite({ THREE, outside, high: HIGH, G0 });
  const day = createDaylight({ THREE, renderer, scene, outside, siteLight, high: HIGH, G0 });
  guardOutput(THREE, scene);   // last: the other patches find materials by their original cache keys

  // ---------------------------------------------------------------- light-tower beams: additive cones, soft edges, drifting dust noise
  const coneU = { time, uG: { value: G0 } };
  const cones = new THREE.Group(); scene.add(cones);
  const spots = outside.spots || [];
  if (HIGH) for (const s of [...spots, siteLight.rake].filter(Boolean)) {
    s.updateMatrixWorld(); s.target.updateMatrixWorld();
    const a = s.getWorldPosition(new V3()), b = s.target.getWorldPosition(new V3()), len = a.distanceTo(b) * 1.12, ang = Math.min(0.6, (s.angle || 0.7) * 0.62);
    const g = new THREE.ConeGeometry(len * Math.tan(ang), len, 40, 1, true).translate(0, -len / 2, 0);
    const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: { ...coneU, uCol: { value: new THREE.Color(1.0, 0.7, 0.4).multiplyScalar(0.05) } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, fog: false, toneMapped: true,
      vertexShader: `varying vec3 vW, vN; varying float vA, vU; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; vN=normalize(mat3(modelMatrix)*normal); vA=1.-uv.y; vU=uv.x; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `${NOISE3} uniform vec3 uCol; uniform float time, uG; varying vec3 vW, vN; varying float vA, vU;
        void main(){ vec3 V=normalize(cameraPosition-vW); float e=abs(dot(normalize(vN),V));
          float fall=pow(1.-vA,1.3)*smoothstep(0.,.05,vA)/(.15+vA*vA*3.);
          float n=(.45+.9*vn3(vW*.3+vec3(0.,-time*.22,time*.07)))*(.7+.6*vn3(vW*1.1+vec3(time*.09,time*.05,0.)));
          float gr=smoothstep(uG+.2,uG+2.8,vW.y);
          float sh=.5+.8*vn3(vec3(vU*46.,vA*1.2,time*.03))*vn3(vec3(vU*13.+5.,vA*.6,time*.02));   // shafts: lens grid / dust striations along the beam
          gl_FragColor=vec4(uCol*pow(e,1.6)*fall*n*sh*gr,1.); }`
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
    uGhost: { value: new THREE.Vector2(0.0045, -0.003) }, uSmear: { value: 0.035 }, uSunDir: { value: day.sunDir }, uSunC: { value: new THREE.Color(0, 0, 0) }
  };
  if (room.glass) {
    const old = room.glass.material;
    room.glass.material = new THREE.ShaderMaterial({
      uniforms: glassU, transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      vertexShader: `uniform mat4 texM; varying vec3 vW; varying vec4 vR; void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; vR=texM*w; gl_Position=projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `${NOISE} uniform sampler2D tRefl, tEnv, tSmudge; uniform float uRefl, uEnv, uTint, hasSm, uReflK, uSmear, time; uniform vec3 uTintC, uSunDir, uSunC; uniform vec2 uGhost; varying vec3 vW; varying vec4 vR;
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
          { float fs=max(dot(V,uSunDir),0.);                                                  // low sun ahead: the dirt and wipe streaks light up
            c+=uSunC*(pow(fs,4.)*(.05+1.1*sm*sm2+.3*sm)+pow(fs,36.)*(.15+.8*sm)); }
          gl_FragColor=vec4(c, uTint*(.88+.25*sm)); }`
    });
    room.glass.material.toneMapped = true; old?.dispose?.();
  }
  const reflHide = [outside.group, room.glass, cones, dust].filter(Boolean);

  // ---------------------------------------------------------------- post (internal ratio pr; the canvas stays at DPR)
  const post = createPost({ THREE, renderer, scene, cam });
  { const hp = post.bloom.materialHighPassFilter;   // bloom bright pass: backstop sanitiser (NaN / inf -> 0, clamped)
    if (hp && hp.fragmentShader.includes('vec4 texel = texture2D( tDiffuse, vUv );')) {
      hp.fragmentShader = hp.fragmentShader.replace('void main()', FIN + '\nvoid main()').replace('vec4 texel = texture2D( tDiffuse, vUv );', 'vec4 texel = texture2D( tDiffuse, vUv ); texel = vec4( fin( texel.rgb ), 1.0 );');
      hp.needsUpdate = true;
    } }
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
    { const v = W / 100, x0 = 72.25 * v, y0 = 29.125 * v, x1 = 94.75 * v, y1 = y0 + 3.54 * v;   // .d6-lead box (3 lines), d6.css
      lensU.lead.value.set((x0 + x1) / 2 / W, 1 - (y0 + y1) / 2 / H, ((x1 - x0) / 2 + 3 * v) / W, ((y1 - y0) / 2 + 3.2 * v) / H); }
    screens.cover(room.centreW / room.centreH, screens.centre.uniforms.uCover.value);
    screens.cover(ta, hand.uniforms.cover.value);
    monList.forEach((m, i) => { const w = m.w ?? 0.8, h = m.h ?? room.centreH; screens.setScreen?.(i, w / h, i === 1 ? 1920 * w / 0.8 : 1920); });
  }
  screens.onAspect = () => { if (!dead) solve(); };

  // ---------------------------------------------------------------- camera: slider dolly + gimbal, operator wobble, rack focus, breathing
  let prog = 0, ptrX = 0, ptrY = 0, sx = 0, sy = 0, clock = 0, copyA = null;   // copyA: null = derived from p (main.js copyFrame)
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
  const siteGlow = ['glow', 'window', 'amber'].map(k => outside.site?.M?.[k]).filter(Boolean).map(m => [m, m.color.clone()]);   // trailer / pickup lights by the H1
  const pu = { dt: 0, t: 0, focus: 0, aperture: 0, maxblur: 0, ca: 0 };
  let lastT = 0, cabAcc = 0, frames = 0, ftAcc = 0, ftN = 0, reflW = 0, reflH = 0, cov = 0;
  let enh = 0, enhT0 = 0, moveT = 0, prWant = pr;
  function frame(now) {
    const t = now / 1000, dt = lastT ? Math.min(0.1, t - lastT) : 1 / 60; lastT = t; clock += dt;
    renderer.info.reset();
    if (enhT0) enh = Math.min(1, (now - enhT0) / FADE_MS);
    const p = prog, s = pose(p, clock);
    const D = day.update(p);
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
    const ex0 = 1.06 - 0.13 * sstep(0.2, 0.68, p) + 0.07 * sstep(0.72, 0.93, p), ex = ex0 * D.exp;   // D.exp: the day closes the lens
    renderer.toneMappingExposure = ex; screens.setExposure((1 + (ex0 - 1) * sstep(0.45, 0.88, p)) * D.exp);   // screens compensate the day fully: readable throughout
    screens.setLevels?.(0.86, 0.95, 0.86);
    screens.setSubpixel?.(0.55 * sstep(0.5, 0.74, p) * glare);

    // monitor spill: colour follows each feed, softens as we close in (the frame is the screen then); the centre dims with the dip
    const glow = 1 - 0.35 * near, lit = Math.max(feed * (1 - mix), mix);
    if (mons.left?.light) { mons.left.light.color.copy(spill.left); mons.left.light.intensity = 2.3 * glow; }
    if (mons.right?.light) { mons.right.light.color.copy(spill.right); mons.right.light.intensity = 2.3 * glow; }
    if (mons.centre?.light) { mons.centre.light.color.copy(spill.cab).lerp(spill.still, mix); mons.centre.light.intensity = 2.8 * glow * (0.2 + 0.8 * lit); }
    moonFill.intensity = (HIGH ? 0.55 : 0.4) * D.winI * (1 - 0.4 * near); moonFill.color.setRGB(...D.winC);   // window fill: moonlight -> dawn -> daylight

    // atmosphere + beams + dust
    const ca = copyA ?? Math.max(0, 1 - p / COPY_OUT), lampDn = 1 - LAMP_COPY * sstep(0, 0.3, ca);   // full hold-down until the copy is nearly gone
    const lampK = (1 - 0.5 * end) * LAMP_K * lampDn * D.flood;
    if (outside.lampHead) outside.lampHead.material.color.copy(outside.LAMP_ON).multiplyScalar(lampDn * Math.max(D.flood, 0.03));
    for (const [m, c] of siteGlow) m.color.copy(c).multiplyScalar(lampDn * Math.max(D.flood, 0.08));
    if (atmo) {
      const au = atmo.uniforms; au.time.value = clock;
      au.hazeC.value.setRGB(...D.hazeC); au.hazeLow.value.setRGB(...D.hazeLow); au.hazeD.value = D.hazeD;   // night blue -> warm dusty morning
      if (au.sunDir) { au.sunDir.value.copy(day.sunDir); au.sunC.value.copy(day.sunCol).multiplyScalar(D.scat * 0.3); }
      for (let i = 0; i < spots.length && i < 4; i++) { spots[i].getWorldPosition(cv); au.lampP.value[i].set(cv.x, cv.y, cv.z, i === 0 ? 0 : 0.1 * lampK); au.lampC.value[i].copy(lampCol); }   // tower 0: no visible source, so no glow (its light stays)
      tmpC.copy(mons.centre?.light?.color ?? spill.cab).lerp(spill.left, 0.4); au.roomC.value.copy(tmpC).multiplyScalar(0.0022 * (1 - sstep(0.4, 0.62, p)) * glare * lit); // screen-light haze: follows what the screen shows, gone before it is the picture
      mons.centre.screen.getWorldPosition(au.roomP.value); au.roomP.value.z += 0.35;
    }
    cones.children.forEach((c, i) => { const rk = i === cones.children.length - 1; c.material.uniforms.uCol.value.setRGB(...(rk ? [0.75, 0.82, 1.0] : [1.0, 0.7, 0.4])).multiplyScalar((i === 0 ? 0.45 : rk ? 0.35 : 1) * 0.05 * lampK); });   // tower 0 faint (dark heads), rake beam cool   // tower 0's beam faint: its heads are dark

    // lens: rack focus with shaped bokeh, fully sharp for the hand-off
    const dofK = HIGH ? 1 - sstep(0.88, 0.98, p) : 0;
    const aperture = (3.2 + 6 * near) * dofK, maxblur = 16 / 1600 * dofK;      // CoC px per dioptre and max CoC radius, at 1600 px wide
    if (dust) {
      const da = enh * (1 - sstep(0.7, 0.9, p)) * glare; dust.visible = da > 0.001;
      const bw = W * pr; dustU.focus.value = focusDist; dustU.cocK.value = aperture * bw / 1600; dustU.maxC.value = maxblur * bw;
      dustU.pxScale.value = H * pr * cam.projectionMatrix.elements[5] * 0.5; dustU.amt.value = da;
      mons.centre.screen.getWorldPosition(dustU.lightP.value); dustU.lightC.value.copy(mons.centre.light?.color ?? spill.cab).lerp(spill.right, 0.35);
    }
    post.bloom.strength = (0.66 - 0.42 * sstep(0.55, 1, p) + 0.15 * sstep(0.38, 0.5, p) * (1 - sstep(0.56, 0.7, p))) * (0.3 + 0.7 * glare);   // dawn: a gentle bloom bump post.bloom.radius = 0.55; post.bloom.threshold = 1.0;   // sources and screens only, not lit props
    lensU.barrel.value = 0.035 * (1 - s); lensU.vig.value = 0.6 - 0.32 * s; lensU.grain.value = 0.032 - 0.016 * s;
    lensU.leadK.value = W >= 768 ? LEAD_DARK * ca : 0;
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
    glassU.uSunC.value.copy(day.sunCol).multiplyScalar(0.025 * D.scat * Math.min(1, Math.max(0, (D.el + 0.12) / 0.15)));   // sun on the window grime

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
    fx: { atmo, streak, mirror, lens: lensU, glass: glassU, dust: dustU, cones, moonFill, site: siteLight },   // look tunables (QA)
    enhance,                                                                       // mirror, streaks, dust (auto after ready unless enhance: 'manual')
    setProgress(p) { const v = Math.min(1, Math.max(0, +p || 0)); if (v !== prog) { prog = v; moveT = performance.now(); } },
    setTarget(rect, radius) { if (!rect) { autoTarget = true; } else { target = { x: rect.x ?? rect.left, y: rect.y ?? rect.top, w: rect.w ?? rect.width, h: rect.h ?? rect.height }; autoTarget = false; } if (radius !== undefined) targetRad = radius; solve(); },
    screenRect() { pose(prog, clock); return screenRect(); },
    setPointer(x, y) { ptrX = Math.max(-1, Math.min(1, x)); ptrY = Math.max(-1, Math.min(1, y)); },
    // hero copy opacity 0..1 as the page draws it (lamp glow toned down and the lead falloff while it is up); null: derive from p
    setCopyOpacity(a) { copyA = a == null ? null : Math.min(1, Math.max(0, +a || 0)); },
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
      day.dispose(); room.dispose(); outside.dispose(); cab.dispose(); screens.dispose(); mirror?.dispose(); atmo?.dispose(); streak?.dispose(); post.dof.dispose?.();
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
