// D6 hero: shared GLSL snippets, a seeded RNG, camera noise, and the compositing passes the hero adds to the D5 post chain
// (atmosphere, shaped-bokeh DOF, anamorphic streaks, film grade/lens) plus the planar mirror for the window.
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export const NOISE = /* glsl */ `
float hh21(vec2 p){ p=fract(p*vec2(443.897,441.423)); p+=dot(p,p.yx+19.19); return fract((p.x+p.y)*p.x); }
float vn2(vec2 x){ vec2 i=floor(x),f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(hh21(i),hh21(i+vec2(1,0)),f.x),mix(hh21(i+vec2(0,1)),hh21(i+vec2(1,1)),f.x),f.y); }
float fbm2(vec2 p){ float v=0.,a=.5; for(int i=0;i<5;i++){ v+=a*vn2(p); p=p*2.03+vec2(1.7,9.2); a*=.5; } return v; }
`;

export const NOISE3 = /* glsl */ `
float hh31(vec3 p){ p=fract(p*.1031); p+=dot(p,p.zyx+31.32); return fract((p.x+p.y)*p.z); }
float vn3(vec3 x){ vec3 i=floor(x),f=fract(x); f=f*f*(3.-2.*f);
  return mix(mix(mix(hh31(i),hh31(i+vec3(1,0,0)),f.x),mix(hh31(i+vec3(0,1,0)),hh31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hh31(i+vec3(0,0,1)),hh31(i+vec3(1,0,1)),f.x),mix(hh31(i+vec3(0,1,1)),hh31(i+vec3(1,1,1)),f.x),f.y),f.z); }
`;

export const IGN = /* glsl */ `float ign(vec2 p){ return fract(52.9829189*fract(dot(p,vec2(0.06711056,0.00583715)))); }`;

// screen colours are authored in sRGB; these invert the ACES fit three.js tone maps with, so a screen shows its pixels as drawn
export const INV_ACES = /* glsl */ `
uniform mat3 uInvOut; uniform mat3 uInvIn; uniform float uExp;
vec3 srgbDec(vec3 c){ return mix(c/12.92, pow((c+.055)/1.055, vec3(2.4)), step(.04045, c)); }
vec3 rrtInv(vec3 y){ vec3 a=1.-.983729*y, b=.0245786-.432951*y, c=-(.000090537+.238081*y); return (-b+sqrt(max(b*b-4.*a*c,0.)))/(2.*a); }
vec3 invACES(vec3 lin){ vec3 y=clamp(uInvOut*clamp(lin,0.,1.),0.,.985); return max(uInvIn*rrtInv(y),0.)*.6/uExp; }
`;

export function acesInverseUniforms(THREE) {
  const iIn = new THREE.Matrix3().set(0.59719, 0.35458, 0.04823, 0.07600, 0.90834, 0.01566, 0.02840, 0.13383, 0.83777).invert();
  const iOut = new THREE.Matrix3().set(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602).invert();
  return { uInvIn: { value: iIn }, uInvOut: { value: iOut }, uExp: { value: 1 } };
}

export function rng(seed = 7) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// smooth 1D fractal noise in [-1, 1] (camera operator wobble: no visible period, unlike summed sines)
export function noise1(seed = 1) {
  const r = rng(seed), T = new Float32Array(256); for (let i = 0; i < 256; i++) T[i] = r() * 2 - 1;
  const n = x => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return T[i & 255] * (1 - u) + T[(i + 1) & 255] * u; };
  return t => 0.6 * n(t) + 0.28 * n(t * 2.13 + 17) + 0.12 * n(t * 4.7 + 41);
}

const FS = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`;
const DEPTH = `uniform float near, far; float viewZ(float d){ return (near*far)/((far-near)*d-far); }`;
const fsMat = (THREE, uniforms, fs) => new THREE.ShaderMaterial({ uniforms, vertexShader: FS, fragmentShader: fs, depthTest: false, depthWrite: false });

// ---------------------------------------------------------------- atmosphere (HDR, full res, one pass)
// Per pixel, analytic along the camera ray up to the depth buffer:
//  - outside the glass: height fog (exponential in y, closed-form optical depth) + in-scatter from the light-tower heads
//    (closed-form point-light airlight integral, so the glow is occluded by whatever the ray hits first)
//  - inside the room: a whisper of screen light scattered by dust in the air
export function createAtmosphere({ THREE, src, depth, cam }) {
  const u = {
    tColor: { value: null }, tDepth: { value: null }, invProj: { value: new THREE.Matrix4() }, camWorld: { value: new THREE.Matrix4() }, camPos: { value: new THREE.Vector3() },
    near: { value: 0.05 }, far: { value: 2500 }, time: { value: 0 }, glassZ: { value: -2.2 }, glassT: { value: 0.68 },
    hazeD: { value: 0.0035 }, hazeH: { value: 0.09 }, hazeY0: { value: -1 }, hazeC: { value: new THREE.Color(0.014, 0.05, 0.17) }, hazeLow: { value: new THREE.Color(0.05, 0.045, 0.05) },
    lampP: { value: [0, 1, 2, 3].map(() => new THREE.Vector4(0, -999, 0, 0)) }, lampC: { value: [0, 1, 2, 3].map(() => new THREE.Color(0, 0, 0)) },
    roomP: { value: new THREE.Vector3(0, 1.13, 0.3) }, roomC: { value: new THREE.Color(0, 0, 0) }
  };
  const m = fsMat(THREE, u, `${NOISE3}${DEPTH}
    uniform sampler2D tColor, tDepth; uniform mat4 invProj, camWorld; uniform vec3 camPos, hazeC, hazeLow, roomC, roomP; uniform float time, glassZ, glassT, hazeD, hazeH, hazeY0;
    uniform vec4 lampP[4]; uniform vec3 lampC[4]; varying vec2 vUv;
    float air(vec3 o, vec3 dir, float t0, float t1, vec3 s){ vec3 so=s-o; float tc=dot(so,dir); float h=max(length(so-dir*tc),.04);
      return (atan((t1-tc)/h)-atan((t0-tc)/h))/h; }
    void main(){
      vec3 c=texture2D(tColor,vUv).rgb; float d=texture2D(tDepth,vUv).x;
      vec4 v=invProj*vec4(vUv*2.-1.,d*2.-1.,1.); v/=v.w;
      float L=d>=.999999 ? 1400. : length(v.xyz);
      vec3 dir=normalize((camWorld*vec4(normalize(v.xyz),0.)).xyz);
      float tg=dir.z<-1e-4 ? (glassZ-camPos.z)/dir.z : 1e9;
      vec3 add=vec3(0.); float T=1.;
      if(tg<L){
        float t0=tg, t1=min(L,d>=.999999 ? 260. : 1400.), y0=camPos.y+dir.y*t0, k=hazeH*dir.y, len=t1-t0;
        float base=hazeD*exp(-hazeH*(y0-hazeY0));
        float od=abs(k)>1e-5 ? base*(1.-exp(clamp(-k*len,-30.,30.)))/k : base*len;
        vec3 mid=camPos+dir*(t0+min(len,60.)*.5);
        od*=.75+.5*vn3(mid*vec3(.05,.12,.05)+vec3(time*.03,0.,time*.02));        // slow banks of haze
        T=exp(-min(od,6.));
        float low=exp(-max(y0-hazeY0,0.)*.25)*smoothstep(.25,-.05,dir.y);          // near the ground the haze picks up the work lights
        vec3 fogC=mix(hazeC,hazeLow,low);
        add+=fogC*(1.-T);
        for(int i=0;i<4;i++){ if(lampP[i].w<=0.) continue;
          vec3 s=lampP[i].xyz; float g=air(camPos,dir,t0,t1,s);
          float cosv=dot(dir,normalize(s-camPos)); float ph=.35+.65*pow(max(cosv,0.),24.);   // forward scatter: the glow hugs the lamp
          add+=lampC[i]*g*ph*lampP[i].w; }
        add*=glassT;
      }
      float ti=min(L,tg);
      add+=roomC*air(camPos,dir,0.,ti,roomP);
      gl_FragColor=vec4(c*T+add,1.); }`);
  const q = new FullScreenQuad(m);
  const pass = new Pass(); pass.needsSwap = true; pass.uniforms = u;
  pass.render = (r, write, read) => {
    const s = src(read); if (!s) { pass.needsSwap = false; return; }
    pass.needsSwap = true;
    u.tColor.value = s; u.tDepth.value = depth(); u.near.value = cam.near; u.far.value = cam.far;
    u.invProj.value.copy(cam.projectionMatrixInverse); u.camWorld.value.copy(cam.matrixWorld); u.camPos.value.setFromMatrixPosition(cam.matrixWorld);
    r.setRenderTarget(write); q.render(r);
  };
  pass.dispose = () => { m.dispose(); q.dispose(); };
  return pass;
}

// ---------------------------------------------------------------- DOF: thin-lens CoC, half-res shaped-bokeh gather
// prepass (half res: colour + signed CoC) -> gather (Vogel spiral warped to a 7-blade rounded aperture, cat's-eye
// clipping toward the frame edges, scatter-as-gather weights, highlight-weighted) -> full-res composite with the sharp frame.
// Driven through the BokehPass uniforms post.update already sets: focus (m), aperture (CoC px per dioptre at 1600 px wide),
// maxblur (max CoC radius as a fraction of the width).
export function upgradeDOF({ THREE, dof, src, depth, cam, taps = 48 }) {
  const U = dof.uniforms;
  const mk = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const A = mk(), B = mk();
  const res = new THREE.Vector2(1, 1), cocU = { value: 1 }, maxU = { value: 8 };
  const COC = `uniform float focus, cocK, maxC; float cocOf(float z){ return clamp(cocK*(1./focus-1./max(z,1e-3)),-maxC,maxC); }`; // signed: + behind focus
  const mPre = fsMat(THREE, { tColor: { value: null }, tDepth: { value: null }, near: { value: 1 }, far: { value: 10 }, focus: U.focus, cocK: cocU, maxC: maxU, res: { value: res } }, `${DEPTH}${COC}
    uniform sampler2D tColor, tDepth; uniform vec2 res; varying vec2 vUv;
    void main(){ vec2 t=.5/res; vec3 c=vec3(0.); float zc=1e9;
      for(int i=0;i<4;i++){ vec2 o=vec2(i==1||i==3?t.x:-t.x, i>1?t.y:-t.y)*.5; c+=texture2D(tColor,vUv+o).rgb; zc=min(zc,-viewZ(texture2D(tDepth,vUv+o).x)); }
      gl_FragColor=vec4(min(c*.25,vec3(64.)),cocOf(zc)*.5); }`);   // CoC stored in half-res pixels
  const mGather = fsMat(THREE, { tPre: { value: A.texture }, res: { value: res }, maxC: maxU }, `
    uniform sampler2D tPre; uniform vec2 res; uniform float maxC; varying vec2 vUv;
    const float GA=2.39996323;
    vec2 blade(float a){ const float n=7.; float s=6.2831853/n, k=mod(a+.25,s)-s*.5; return vec2(cos(a),sin(a))*mix(cos(s*.5)/cos(k),1.,.35); } // rounded heptagon
    void main(){
      vec4 c0=texture2D(tPre,vUv); float cc=c0.a, R=maxC*.5;
      if(R<.5){ gl_FragColor=vec4(c0.rgb,0.); return; }
      vec2 ce=(vUv-.5)*2.; float ev=dot(ce,ce);
      vec3 acc=c0.rgb; float ws=1., fg=0., fgw=0.;
      for(int i=0;i<${taps};i++){
        float f=sqrt((float(i)+.5)/${taps}.), a=float(i)*GA;
        vec2 o=blade(a)*f;                                                  // unit aperture sample
        if(length(o+ce*.42)>1.12) continue;                                 // optical vignetting: cat's eye toward the corners
        vec2 op=o*R; float l=length(op);
        vec4 s=texture2D(tPre,vUv+op/res); float cs=s.a;
        float w=clamp(abs(cs)-l+1.,0.,1.);                                  // the sample's own disc reaches this pixel
        if(cs>cc) w*=clamp(abs(cc)-l+1.,0.,1.);                             // farther stuff cannot spill over nearer pixels
        float lum=dot(s.rgb,vec3(.2126,.7152,.0722));
        w*=1.+2.5*smoothstep(1.,8.,lum);                                    // bright points read as discs
        acc+=s.rgb*w; ws+=w;
        float isf=step(cs,-.5)*clamp(-cs-l+1.,0.,1.); fg+=isf; fgw+=1.; }
      gl_FragColor=vec4(acc/ws, clamp(fg/max(fgw,1.)*2.5,0.,1.)); }`);
  const mComp = fsMat(THREE, { tColor: { value: null }, tDepth: { value: null }, tBlur: { value: B.texture }, near: { value: 1 }, far: { value: 10 }, focus: U.focus, cocK: cocU, maxC: maxU }, `${DEPTH}${COC}
    uniform sampler2D tColor, tDepth, tBlur; varying vec2 vUv;
    void main(){ vec3 c=texture2D(tColor,vUv).rgb; float z=-viewZ(texture2D(tDepth,vUv).x);
      vec4 b=texture2D(tBlur,vUv); float t=max(smoothstep(.5,1.8,abs(cocOf(z))),b.a);
      gl_FragColor=vec4(mix(c,b.rgb,t),1.); }`);
  const q = new FullScreenQuad(mPre);
  const draw = (r, m, t) => { q.material = m; r.setRenderTarget(t); q.render(r); };
  dof.render = function (r, write, read) {
    const s = src(read), dt = depth(), w = res.x * 2;
    cocU.value = U.aperture.value * w / 1600; maxU.value = U.maxblur.value * w; // full-res px
    for (const m of [mPre, mComp]) { m.uniforms.near.value = cam.near; m.uniforms.far.value = cam.far; m.uniforms.tColor.value = s; m.uniforms.tDepth.value = dt; }
    draw(r, mPre, A); draw(r, mGather, B);
    draw(r, mComp, this.renderToScreen ? null : write);
  };
  dof.setSize = function (w, h) { U.aspect.value = w / h; res.set(Math.max(1, w >> 1), Math.max(1, h >> 1)); A.setSize(res.x, res.y); B.setSize(res.x, res.y); };
  const old = dof.dispose?.bind(dof);
  dof.dispose = () => { A.dispose(); B.dispose(); [mPre, mGather, mComp].forEach(m => m.dispose()); q.dispose(); old?.(); };
  return { setTaps() {} };
}

// ---------------------------------------------------------------- anamorphic streaks (quarter res, outside-the-glass highlights only)
export function createStreaks({ THREE, src, depth, cam }) {
  const mk = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const A = mk(), B = mk(), res = new THREE.Vector2(1, 1);
  const u = { tColor: { value: null }, tDepth: { value: null }, near: { value: 1 }, far: { value: 10 }, thr: { value: 3 }, minZ: { value: 5 }, res: { value: res } };
  const mEx = fsMat(THREE, u, `${DEPTH} uniform sampler2D tColor, tDepth; uniform float thr, minZ; uniform vec2 res; varying vec2 vUv;
    void main(){ vec2 t=1./res; vec3 a=vec3(0.);
      for(int i=0;i<4;i++){ vec2 uv=vUv+vec2(i==1||i==3?.25:-.25, i>1?.25:-.25)*t;
        vec3 c=texture2D(tColor,uv).rgb; float z=-viewZ(texture2D(tDepth,uv).x), l=max(c.r,max(c.g,c.b));
        a+=c*smoothstep(thr,thr*2.5,l)/max(l,1e-3)*min(l-thr,40.)*step(minZ,z); }
      gl_FragColor=vec4(a*.25,1.); }`);
  const mBl = fsMat(THREE, { tSrc: { value: null }, step: { value: 1 }, res: { value: res } }, `uniform sampler2D tSrc; uniform float step; uniform vec2 res; varying vec2 vUv;
    void main(){ vec3 a=vec3(0.); float ws=0.;
      for(int i=-12;i<=12;i++){ float w=exp(-abs(float(i))*.22); a+=texture2D(tSrc,vUv+vec2(float(i)*step/res.x,0.)).rgb*w; ws+=w; }
      gl_FragColor=vec4(a/ws,1.); }`);
  const q = new FullScreenQuad(mEx);
  const pass = new Pass(); pass.needsSwap = false; pass.uniforms = u; pass.texture = A.texture;
  pass.render = (r, write, read) => {
    u.tColor.value = src(read); u.tDepth.value = depth(); u.near.value = cam.near; u.far.value = cam.far;
    q.material = mEx; r.setRenderTarget(A); q.render(r);
    q.material = mBl; mBl.uniforms.tSrc.value = A.texture; mBl.uniforms.step.value = 1; r.setRenderTarget(B); q.render(r);
    mBl.uniforms.tSrc.value = B.texture; mBl.uniforms.step.value = 6; r.setRenderTarget(A); q.render(r);
  };
  pass.setSize = (w, h) => { res.set(Math.max(1, w >> 2), Math.max(1, h >> 2)); A.setSize(res.x, res.y); B.setSize(res.x, res.y); };
  pass.dispose = () => { A.dispose(); B.dispose(); mEx.dispose(); mBl.dispose(); q.dispose(); };
  return pass;
}

// ---------------------------------------------------------------- film lens + grade (replaces the D5 lens shader; keeps its uniform names)
// display-referred input (after ACES + SMAA). Order: barrel + lateral CA -> streaks + halation -> grade (CDL-style
// offset/slope/power with teal shadows and warm highlights, contrast pivot, saturation) -> vignette -> luma-weighted grain.
export function filmLens(THREE, lens) {
  const u = lens.uniforms;
  Object.assign(u, {
    barrel: { value: 0.035 }, vig: { value: 0.55 }, grade: { value: 1 }, tStreak: { value: null }, streak: { value: 0 }, tHal: { value: null }, hal: { value: 0 },
    slope: { value: new THREE.Vector3(1.03, 1.0, 0.96) }, offset: { value: new THREE.Vector3(-0.003, 0.002, 0.007) }, power: { value: new THREE.Vector3(1.0, 1.0, 1.0) },
    warm: { value: new THREE.Vector3(1.0, 0.82, 0.62) }, contrast: { value: 0.3 }, sat: { value: 1.02 }
  });
  lens.material.fragmentShader = `uniform sampler2D tDiffuse, tStreak, tHal; uniform float ca, time, grain, barrel, vig, grade, streak, hal, contrast, sat;
    uniform vec3 slope, offset, power, warm; uniform vec2 res; varying vec2 vUv;
    float h12(vec2 p){ vec3 q=fract(vec3(p.xyx)*.1031); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
    void main(){
      vec2 c=vUv-.5; float r2=dot(c,c);
      vec2 uv=.5+c*(1.-barrel*r2);
      vec2 o=c*r2*ca;
      vec3 col=vec3(texture2D(tDiffuse,uv+o).r, texture2D(tDiffuse,uv+o*.5).g, texture2D(tDiffuse,uv-o*.3).b);
      col=mix(col, vec3(texture2D(tDiffuse,uv+o*1.6).r, col.g, texture2D(tDiffuse,uv-o*.9).b), .35);     // softer, wider fringe at the rim
      if(streak>0.){ vec3 s=texture2D(tStreak,uv).rgb; col+=(1.-exp(-s*streak))*vec3(.55,.75,1.); }          // anamorphic flare, cool
      if(hal>0.){ vec3 h=texture2D(tHal,uv).rgb; float hl=dot(h,vec3(.33)); col+=(1.-exp(-hl*hal))*vec3(1.,.32,.12)*(1.-dot(col,vec3(.33))*.6); } // halation: red bloom from the film base
      vec3 g=pow(max(col*slope+offset,0.),power);                                         // CDL: warm slope, teal offset into the blacks
      float l=dot(g,vec3(.2126,.7152,.0722));
      g+=warm*.06*smoothstep(.45,1.,l)-vec3(.0,.0,.02)*smoothstep(.45,1.,l);            // warm the highlights
      g=clamp(g,0.,1.); g=mix(g, g*g*(3.-2.*g), contrast);                                   // S-curve: deeper shadows, soft shoulder
      g=mix(vec3(dot(g,vec3(.2126,.7152,.0722))), g, sat);
      col=mix(col, clamp(g,0.,1.), grade);
      col*=mix(1., smoothstep(.8,.1,r2*1.55)*.85+.15*(1.-r2), vig);                     // vignette: soft cos^4-ish falloff
      vec2 fp=floor(vUv*res); float t=floor(time*24.);                                    // 24 fps grain
      float n=h12(fp+t*17.13)+h12(fp*.5+t*3.7)-1.;                                        // two grain sizes
      float ll=dot(col,vec3(.33)); col+=n*grain*(.35+1.6*ll*(1.-ll))*vec3(1.,.97,1.04);  // most visible in the mids
      col+=(h12(fp+91.7)-.5)/255.;
      gl_FragColor=vec4(col,1.); }`;
  lens.material.needsUpdate = true;
  return u;
}

// ---------------------------------------------------------------- planar mirror for a z = const window (Reflector maths, oblique near plane)
export function createMirror({ THREE, z, layer = 1 }) {
  const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  rt.texture.generateMipmaps = true; rt.texture.minFilter = THREE.LinearMipmapLinearFilter;
  const vcam = new THREE.PerspectiveCamera(); vcam.layers.enable(0); vcam.layers.enable(layer);
  const N = new THREE.Vector3(0, 0, 1), P = new THREE.Vector3(0, 0, z), cp = new THREE.Vector3(), view = new THREE.Vector3(), look = new THREE.Vector3(), tgt = new THREE.Vector3();
  const rot = new THREE.Matrix4(), plane = new THREE.Plane(), clip = new THREE.Vector4(), q = new THREE.Vector4();
  const texM = new THREE.Matrix4();
  function render(renderer, scene, cam, hide = []) {
    cp.setFromMatrixPosition(cam.matrixWorld); view.subVectors(P, cp);
    if (view.dot(N) > 0) return false;
    view.reflect(N).negate().add(P);
    rot.extractRotation(cam.matrixWorld); look.set(0, 0, -1).applyMatrix4(rot).add(cp);
    tgt.subVectors(P, look).reflect(N).negate().add(P);
    vcam.position.copy(view); vcam.up.set(0, 1, 0).applyMatrix4(rot).reflect(N); vcam.lookAt(tgt);
    vcam.far = cam.far; vcam.updateMatrixWorld(); vcam.projectionMatrix.copy(cam.projectionMatrix);
    texM.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1).multiply(vcam.projectionMatrix).multiply(vcam.matrixWorldInverse);
    plane.setFromNormalAndCoplanarPoint(N, P).applyMatrix4(vcam.matrixWorldInverse);
    clip.set(plane.normal.x, plane.normal.y, plane.normal.z, plane.constant);
    const pm = vcam.projectionMatrix.elements;
    q.x = (Math.sign(clip.x) + pm[8]) / pm[0]; q.y = (Math.sign(clip.y) + pm[9]) / pm[5]; q.z = -1; q.w = (1 + pm[10]) / pm[14];
    clip.multiplyScalar(2 / clip.dot(q));
    pm[2] = clip.x; pm[6] = clip.y; pm[10] = clip.z + 1; pm[14] = clip.w;
    vcam.projectionMatrixInverse.copy(vcam.projectionMatrix).invert();
    const vis = hide.map(o => o.visible); hide.forEach(o => { o.visible = false; });
    const sm = renderer.shadowMap.autoUpdate, old = renderer.getRenderTarget(), xr = renderer.xr.enabled;
    renderer.shadowMap.autoUpdate = false; renderer.xr.enabled = false;
    renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, vcam);
    renderer.setRenderTarget(old); renderer.shadowMap.autoUpdate = sm; renderer.xr.enabled = xr;
    hide.forEach((o, i) => { o.visible = vis[i]; });
    return true;
  }
  return { rt, texture: rt.texture, texM, vcam, render, setSize(w, h) { rt.setSize(Math.max(1, w), Math.max(1, h)); }, dispose() { rt.dispose(); } };
}
