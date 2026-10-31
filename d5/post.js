// TerraFirma D5 post stack.
// Chain: ScenePass(+depth) -> MotionBlur -> Bokeh DOF -> Bloom -> AutoExposure+ToneMap -> SMAA -> Lens (CA, vignette, grain, barrel)
// All look parameters (bloom, bokeh, lens) match d5.current.js.
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const FS_VERT = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }`;

export function createPost({ THREE, renderer, scene, cam }) {
  const pr = renderer.getPixelRatio(), size = renderer.getSize(new THREE.Vector2());
  const W = Math.max(1, Math.floor(size.x * pr)), H = Math.max(1, Math.floor(size.y * pr));

  // ---------------------------------------------------------------- tunables (live objects, change any time)
  const motion = {
    enabled: true,
    shutter: 0.6,     // fraction of the 60fps frame the virtual shutter stays open (0.5 = 180 degree shutter)
    maxLen: 0.035,    // max blur length, as a fraction of screen height
    minPx: 0.35,      // below this estimated on-screen motion (px/frame) the pass switches off entirely
    cutDist: 400,     // camera jump (world units) or
    cutAngle: 0.7,    // rotation jump (rad) in one frame counts as a cut: no blur that frame
    active: false     // read only: was blur applied this frame
  };
  const auto = {
    enabled: true,
    min: 0.55, max: 1.35,
    ref: -2.4,        // ln of the average luminance that maps to the base exposure (renderer.toneMappingExposure)
    strength: 0.5,    // 0 = fixed exposure, 1 = full inverse-luminance. 0.5 is a gentle "eye" response
    rateToBright: 2.4,// 1/s, exposure falling because the view got brighter (pupil closes quickly)
    rateToDark: 0.7,  // 1/s, exposure rising because the view got darker (slow dark adaptation)
    linear: 1,        // metering blend: 0 = geometric mean (ignores small highlights), 1 = RMS luminance (bright areas weigh more, so a sun in frame pulls exposure down)
    lumMin: 0.03,     // per-sample floor: black space reads as one steady value instead of dragging the mean to -inf
    lumMax: 24        // per-sample luminance clamp so a blown-out sun core cannot dominate the mean
  };

  // ---------------------------------------------------------------- composer
  const composer = new EffectComposer(renderer);

  // 1. scene pass. Renders into a private HDR target that owns a depth texture when motion blur is active,
  //    otherwise straight into the composer buffer (no extra copy, no extra memory traffic).
  class ScenePass extends Pass {
    constructor() {
      super(); this.needsSwap = false; this.useRT = false;
      this.rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthTexture: new THREE.DepthTexture(W, H) });
    }
    render(r, write, read) {
      const old = r.autoClear; r.autoClear = false;
      r.setRenderTarget(this.useRT ? this.rt : read);
      r.clear(true, true, true);
      r.render(scene, cam);
      r.autoClear = old;
    }
    setSize(w, h) { this.rt.setSize(w, h); this.rt.depthTexture.image.width = w; this.rt.depthTexture.image.height = h; }
  }
  const scenePass = new ScenePass();
  composer.addPass(scenePass);

  // 2. camera motion blur: reconstruct world position from depth, reproject with last frame's view-projection,
  //    blur along the screen-space delta. Static scene assumed (only the camera moves), which is true here.
  class MotionBlurPass extends Pass {
    constructor() {
      super();
      this.u = { tColor: { value: null }, tDepth: { value: null }, invVP: { value: new THREE.Matrix4() }, prevVP: { value: new THREE.Matrix4() },
        scale: { value: 0.5 }, maxLen: { value: 0.035 }, res: { value: new THREE.Vector2(W, H) } };
      this.mat = new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: FS_VERT, depthTest: false, depthWrite: false, fragmentShader: `
        uniform sampler2D tColor; uniform sampler2D tDepth; uniform mat4 invVP; uniform mat4 prevVP; uniform float scale; uniform float maxLen; uniform vec2 res; varying vec2 vUv;
        float ign(vec2 p){ return fract(52.9829189*fract(dot(p,vec2(0.06711056,0.00583715)))); } // interleaved gradient noise: breaks tap banding
        void main(){
          vec4 c0=texture2D(tColor,vUv);
          float d=texture2D(tDepth,vUv).x;
          vec4 w=invVP*vec4(vUv*2.-1.,d*2.-1.,1.); w/=w.w;      // world position of this pixel
          vec4 pc=prevVP*w;                                       // where it was last frame
          if(pc.w<=1e-4){ gl_FragColor=c0; return; }
          vec2 v=(vUv-pc.xy/pc.w*.5-.5)*scale;                    // uv delta over the shutter interval
          vec2 vp=v*res; float lp=length(vp), cap=maxLen*res.y;
          if(lp>cap){ v*=cap/lp; lp=cap; }
          if(lp<0.6){ gl_FragColor=c0; return; }                  // sub-pixel: pass through
          float j=ign(gl_FragCoord.xy);
          vec3 acc=vec3(0.);
          for(int i=0;i<12;i++){ float tt=(float(i)+j)/12.-.5; acc+=texture2D(tColor,vUv+v*tt).rgb; }
          gl_FragColor=vec4(acc/12.,c0.a); }` });
      this.fsQuad = new FullScreenQuad(this.mat);
    }
    render(r, write) {
      this.u.tColor.value = scenePass.rt.texture; this.u.tDepth.value = scenePass.rt.depthTexture;
      r.setRenderTarget(write); this.fsQuad.render(r);
    }
    setSize(w, h) { this.u.res.value.set(w, h); }
  }
  const mbPass = new MotionBlurPass(); mbPass.enabled = false;
  composer.addPass(mbPass);

  // 3. DOF + bloom, parameters unchanged from d5.current.js
  const dof = new BokehPass(scene, cam, { focus: 30, aperture: 0.0001, maxblur: 0.002 });
  composer.addPass(dof);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.8, 0.5, 0.72);
  composer.addPass(bloom);

  // 4. auto exposure + tone map, entirely on the GPU (no readback, no stall).
  //    HDR frame -> 64x64 weighted log-luminance -> 8x8 -> 1x1 mean -> adapt (ping-pong 1x1 float state) -> tone map reads the state texture.
  class ExposureTonePass extends Pass {
    constructor() {
      super();
      const rt = (w, type) => new THREE.WebGLRenderTarget(w, w, { type, depthBuffer: false, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter });
      this.t64 = rt(64, THREE.HalfFloatType); this.t8 = rt(8, THREE.HalfFloatType); this.t1 = rt(1, THREE.HalfFloatType);
      this.sA = rt(1, THREE.FloatType); this.sB = rt(1, THREE.FloatType); // exposure state, float so slow drifts do not stall on half precision
      this.first = true; this.snap = true;
      this.mDown = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null }, lumMax: { value: 24 }, lumMin: { value: 0.03 } }, vertexShader: FS_VERT, depthTest: false, fragmentShader: `
        uniform sampler2D tSrc; uniform float lumMax; uniform float lumMin; varying vec2 vUv;
        void main(){ vec2 base=floor(gl_FragCoord.xy)/64.; vec3 acc=vec3(0.);
          for(int y=0;y<4;y++) for(int x=0;x<4;x++){
            vec2 uv=base+(vec2(float(x),float(y))+.5)/256.;
            vec3 c=texture2D(tSrc,uv).rgb; float l=clamp(dot(c,vec3(.2126,.7152,.0722)),lumMin,lumMax);
            float k=length(uv-.5)*2.; float wt=mix(1.,.35,smoothstep(.2,1.1,k)); // centre-weighted metering
            acc+=vec3(log(l)*wt,wt,l*l*wt); }
          gl_FragColor=vec4(acc/16.,1.); }` });
      this.mReduce = new THREE.ShaderMaterial({ uniforms: { tSrc: { value: null } }, vertexShader: FS_VERT, depthTest: false, fragmentShader: `
        uniform sampler2D tSrc; varying vec2 vUv;
        void main(){ ivec2 b=ivec2(gl_FragCoord.xy)*8; vec3 acc=vec3(0.);
          for(int y=0;y<8;y++) for(int x=0;x<8;x++) acc+=texelFetch(tSrc,b+ivec2(x,y),0).rgb;
          gl_FragColor=vec4(acc/64.,1.); }` });
      this.mAdapt = new THREE.ShaderMaterial({ uniforms: { tAvg: { value: null }, tPrev: { value: null }, dt: { value: 0.016 }, base: { value: 1.05 }, ref: { value: -3.2 }, strength: { value: 0.5 },
        eMin: { value: 0.55 }, eMax: { value: 1.35 }, up: { value: 2.4 }, down: { value: 0.7 }, snap: { value: 1 }, on: { value: 1 }, lin: { value: 1 } }, vertexShader: FS_VERT, depthTest: false, fragmentShader: `
        uniform sampler2D tAvg; uniform sampler2D tPrev; uniform float dt, base, ref, strength, eMin, eMax, up, down, snap, on, lin; varying vec2 vUv;
        void main(){ vec3 m=texelFetch(tAvg,ivec2(0),0).rgb; float lnL=mix(m.x/max(m.y,1e-4),0.5*log(max(m.z/max(m.y,1e-4),1e-6)),lin);
          float target=on>.5 ? clamp(base*exp(-(lnL-ref)*strength),eMin,eMax) : base;
          float prev=texelFetch(tPrev,ivec2(0),0).r; float lp=log(max(prev,1e-3)), lt=log(target);
          float rate=lt<lp ? up : down;                                  // brighter view: fast, darker view: slow
          float e=snap>.5 ? target : exp(mix(lp,lt,1.-exp(-dt*rate)));
          gl_FragColor=vec4(e,lnL,0.,1.); }` });
      // tone map: OutputPass equivalent, but exposure comes from the state texture instead of a uniform
      this.mTone = new THREE.RawShaderMaterial({ uniforms: { tDiffuse: { value: null }, tExp: { value: null }, toneMappingExposure: { value: 1 } },
        vertexShader: `precision highp float; uniform mat4 modelViewMatrix; uniform mat4 projectionMatrix; attribute vec3 position; attribute vec2 uv; varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
        fragmentShader: `precision highp float; uniform sampler2D tDiffuse; uniform sampler2D tExp;
        #include <tonemapping_pars_fragment>
        #include <colorspace_pars_fragment>
        varying vec2 vUv;
        void main(){ gl_FragColor=texture2D(tDiffuse,vUv);
          gl_FragColor.rgb*=texture2D(tExp,vec2(.5)).r;  // auto exposure (toneMappingExposure uniform stays 1)
          #ifdef LINEAR_TONE_MAPPING
            gl_FragColor.rgb=LinearToneMapping(gl_FragColor.rgb);
          #elif defined(REINHARD_TONE_MAPPING)
            gl_FragColor.rgb=ReinhardToneMapping(gl_FragColor.rgb);
          #elif defined(CINEON_TONE_MAPPING)
            gl_FragColor.rgb=OptimizedCineonToneMapping(gl_FragColor.rgb);
          #elif defined(ACES_FILMIC_TONE_MAPPING)
            gl_FragColor.rgb=ACESFilmicToneMapping(gl_FragColor.rgb);
          #elif defined(AGX_TONE_MAPPING)
            gl_FragColor.rgb=AgXToneMapping(gl_FragColor.rgb);
          #endif
          #ifdef SRGB_TRANSFER
            gl_FragColor=sRGBTransferOETF(gl_FragColor);
          #endif
        }` });
      this.fsQuad = new FullScreenQuad(this.mDown); this.dt = 1 / 60; this._cs = null; this._tm = null;
    }
    pass(r, mat, target) { this.fsQuad.material = mat; r.setRenderTarget(target); this.fsQuad.render(r); }
    render(r, write, read) {
      // keep tone-map defines in sync with the renderer, like OutputPass does
      if (this._cs !== r.outputColorSpace || this._tm !== r.toneMapping) {
        this._cs = r.outputColorSpace; this._tm = r.toneMapping; const d = {};
        if (THREE.ColorManagement.getTransfer(this._cs) === THREE.SRGBTransfer) d.SRGB_TRANSFER = '';
        const k = { [THREE.LinearToneMapping]: 'LINEAR_TONE_MAPPING', [THREE.ReinhardToneMapping]: 'REINHARD_TONE_MAPPING', [THREE.CineonToneMapping]: 'CINEON_TONE_MAPPING', [THREE.ACESFilmicToneMapping]: 'ACES_FILMIC_TONE_MAPPING', [THREE.AgXToneMapping]: 'AGX_TONE_MAPPING' }[this._tm];
        if (k) d[k] = ''; this.mTone.defines = d; this.mTone.needsUpdate = true;
      }
      if (auto.enabled) { // measure + adapt (about 0.1ms: 64x64 + 8x8 + 1x1 draws)
        this.mDown.uniforms.tSrc.value = read.texture; this.mDown.uniforms.lumMax.value = auto.lumMax; this.mDown.uniforms.lumMin.value = auto.lumMin;
        this.pass(r, this.mDown, this.t64);
        this.mReduce.uniforms.tSrc.value = this.t64.texture; this.pass(r, this.mReduce, this.t8);
        this.mReduce.uniforms.tSrc.value = this.t8.texture; this.pass(r, this.mReduce, this.t1);
      }
      const u = this.mAdapt.uniforms;
      u.tAvg.value = this.t1.texture; u.tPrev.value = this.sA.texture; u.dt.value = Math.min(this.dt, 0.1); u.base.value = r.toneMappingExposure;
      u.ref.value = auto.ref; u.strength.value = auto.strength; u.eMin.value = auto.min; u.eMax.value = auto.max; u.up.value = auto.rateToBright; u.down.value = auto.rateToDark;
      u.lin.value = auto.linear; u.snap.value = this.snap ? 1 : 0; u.on.value = auto.enabled ? 1 : 0; this.snap = false;
      this.pass(r, this.mAdapt, this.sB); const s = this.sA; this.sA = this.sB; this.sB = s;
      this.mTone.uniforms.tDiffuse.value = read.texture; this.mTone.uniforms.tExp.value = this.sA.texture;
      this.pass(r, this.mTone, this.renderToScreen ? null : write);
    }
  }
  const tonePass = new ExposureTonePass();
  composer.addPass(tonePass);

  // 5. SMAA on the tone-mapped LDR image (edge detection needs display-referred values), before grain so the grain stays crisp
  const smaa = new SMAAPass(W, H);
  composer.addPass(smaa);

  // 6. lens: identical to d5.current.js
  const lens = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, ca: { value: 0.012 }, time: { value: 0 }, grain: { value: 0.045 }, res: { value: new THREE.Vector2(size.x, size.y) } },
    vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `uniform sampler2D tDiffuse; uniform float ca; uniform float time; uniform float grain; uniform vec2 res; varying vec2 vUv;
    void main(){
      vec2 c=vUv-.5; float r2=dot(c,c);
      vec2 uv=.5+c*(1.-0.035*r2);              // barrel, pulls the corners in a touch
      vec2 o=c*r2*ca;                           // fringing grows toward the edges, zero at center
      vec3 col=vec3(texture2D(tDiffuse,uv+o).r, texture2D(tDiffuse,uv).g, texture2D(tDiffuse,uv-o).b);
      col*=mix(1.,smoothstep(0.75,0.12,r2*1.6),0.55); // vignette
      float n=fract(sin(dot(floor(vUv*res)+fract(time*7.31)*91.7,vec2(12.9898,78.233)))*43758.5453);
      col+=(n-.5)*grain*(1.-dot(col,vec3(.33))*0.6); // grain sits mostly in the shadows, like film
      gl_FragColor=vec4(col,1.); }`
  });
  composer.addPass(lens);

  // ---------------------------------------------------------------- per-frame state (no allocations)
  const curVP = new THREE.Matrix4(), prevVP = new THREE.Matrix4(), lastPos = new THREE.Vector3(), lastQuat = new THREE.Quaternion();
  let have = false, lastDt = 1 / 60, resetNext = false;

  function setSize(w, h) {
    renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix();
    composer.setSize(w, h); lens.uniforms.res.value.set(w, h); resetNext = true;
  }

  function update({ dt = 1 / 60, t = 0, ca, focus, aperture, maxblur } = {}) {
    lastDt = Math.max(dt, 1e-4); tonePass.dt = lastDt;
    if (focus !== undefined) dof.uniforms.focus.value = focus;
    if (aperture !== undefined) dof.uniforms.aperture.value = aperture;
    if (maxblur !== undefined) dof.uniforms.maxblur.value = maxblur;
    if (ca !== undefined) lens.uniforms.ca.value = ca;
    lens.uniforms.time.value = t;

    // camera motion estimate -> decide whether blur runs this frame
    cam.updateMatrixWorld(); curVP.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    let on = false;
    if (have && !resetNext && motion.enabled) {
      const dp = cam.position.distanceTo(lastPos), ang = lastQuat.angleTo(cam.quaternion);
      const f = Math.min(Math.max(focus === undefined ? dof.uniforms.focus.value : focus, 3), 60); // near-field parallax proxy
      const fovR = cam.fov * Math.PI / 180, px = (ang + dp / f) / fovR * H;
      const scale = THREE.MathUtils.clamp(motion.shutter * (1 / 60) / lastDt, 0.15, 2);
      if (dp < motion.cutDist && ang < motion.cutAngle && px * scale > motion.minPx) {
        on = true; const u = mbPass.u; u.prevVP.value.copy(prevVP); u.invVP.value.copy(curVP).invert(); u.scale.value = scale; u.maxLen.value = motion.maxLen;
      }
    }
    motion.active = on; mbPass.enabled = on; scenePass.useRT = on;
    prevVP.copy(curVP); lastPos.copy(cam.position); lastQuat.copy(cam.quaternion); have = true; resetNext = false;
  }

  function render() { composer.render(lastDt); }

  // debug / QA: synchronous readback (stalls the GPU, never call in production)
  const _px = new Float32Array(4);
  function getExposure() { renderer.readRenderTargetPixels(tonePass.sA, 0, 0, 1, 1, _px); return { exposure: _px[0], lnLum: _px[1] }; }

  return {
    composer, dof, lens, bloom, smaa, setSize, update, render,
    motion, auto,
    resetMotion() { resetNext = true; },          // call on hard cuts if you know about them (big jumps are also auto-detected)
    snapExposure() { tonePass.snap = true; },     // jump exposure to target next frame (no adaptation)
    getExposure
  };
}
