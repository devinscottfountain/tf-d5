// TerraFirma D5 post stack.
// Chain: ScenePass(+depth) -> HDR FX [contact AO -> long-exposure trails -> camera motion blur] -> Bokeh DOF -> Bloom -> AutoExposure+ToneMap -> SMAA -> Lens (CA, vignette, grain, barrel)
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
  const trails = {    // long-exposure object trails: HDR history, reprojected by camera motion through depth
    enabled: false,
    amount: 0.65,     // history weight per 60fps frame (time-constant corrected for other frame rates). 0 = off, 0.9 = very long smears
    clamp: 0.15,      // neighbourhood clamp strength while the camera is still (rises to 1 during fast camera moves). 1 = TAA-strict, kills trails
    depthTol: 0.06,   // log2 depth mismatch (~4%) above which history counts as disoccluded, when the camera itself moved
    cutAngle: 0.5,    // camera rotation (rad) in one frame that resets the history; resetMotion() and motion.cutDist also reset it
    active: false     // read only
  };
  const ao = {        // contact AO, half-res SAO from depth, applied to HDR colour before DOF/bloom
    enabled: false,
    radius: 0.03,     // sample radius as a fraction of view distance (0.03 = 9 m at 300 m, 4.5 m at 150 m), i.e. a constant screen size at any scale
    intensity: 1.0,   // 0 = none, 1 = default, 2 = heavy
    bias: 0.12,       // cosine bias: ignores near-coplanar samples (keeps flat terrain clean)
    maxPx: 48,        // cap on the screen-space radius in full-res pixels (cost/cache guard)
    debug: false,     // true shows the AO term alone (grey) instead of the lit frame
    active: false     // read only
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

  // 2. HDR FX on the scene colour + depth, in this order, each stage optional:
  //    a. contact AO (half-res SAO from depth, bilateral blur, depth-aware upsample, multiplies HDR colour)
  //    b. temporal trails (long-exposure accumulation, history reprojected by camera motion through depth)
  //    c. camera motion blur (depth reprojection with last frame's view-projection, blur along the screen delta)
  //    The whole pass, and the scene pass's private depth target, switch off when none of them is active.
  const DEPTH_GLSL = `
    uniform float near; uniform float far;
    float viewZ(float d){ return (near*far)/((far-near)*d-far); } // perspective depth -> view z (negative)`;
  const IGN = `float ign(vec2 p){ return fract(52.9829189*fract(dot(p,vec2(0.06711056,0.00583715)))); }`; // interleaved gradient noise
  class HDRFXPass extends Pass {
    constructor() {
      super();
      this.blur = false; this.histOk = false; this.histVP = new THREE.Matrix4(); this.histRel = new THREE.Matrix4(); this.invVP = new THREE.Matrix4();
      this.w = W; this.h = H; this.hist = null; this.tmp = null; this.aoA = null; this.aoB = null;
      const mat = (uniforms, fs) => new THREE.ShaderMaterial({ uniforms, vertexShader: FS_VERT, depthTest: false, depthWrite: false, fragmentShader: fs });
      // c. camera motion blur (unchanged maths; colour input is whatever the earlier stages produced)
      this.u = { tColor: { value: null }, tDepth: { value: null }, invVP: { value: new THREE.Matrix4() }, prevVP: { value: new THREE.Matrix4() },
        scale: { value: 0.5 }, maxLen: { value: 0.035 }, res: { value: new THREE.Vector2(W, H) } };
      this.mBlur = mat(this.u, `
        uniform sampler2D tColor; uniform sampler2D tDepth; uniform mat4 invVP; uniform mat4 prevVP; uniform float scale; uniform float maxLen; uniform vec2 res; varying vec2 vUv;
        ${IGN}
        void main(){
          vec4 c0=texture2D(tColor,vUv);
          float d=texture2D(tDepth,vUv).x;
          vec4 w=invVP*vec4(vUv*2.-1.,d*2.-1.,1.); w/=w.w;      // world position of this pixel
          vec4 pc=prevVP*w;                                       // where it was last frame
          if(pc.w<=1e-4){ gl_FragColor=vec4(c0.rgb,1.); return; }
          vec2 v=(vUv-pc.xy/pc.w*.5-.5)*scale;                    // uv delta over the shutter interval
          vec2 vp=v*res; float lp=length(vp), cap=maxLen*res.y;
          if(lp>cap){ v*=cap/lp; lp=cap; }
          if(lp<0.6){ gl_FragColor=vec4(c0.rgb,1.); return; }     // sub-pixel: pass through
          float j=ign(gl_FragCoord.xy);
          float n=clamp(ceil(lp*.5),12.,32.);                     // taps grow with blur length (~2 px apart) so long swells stay smooth
          vec3 acc=vec3(0.);
          for(int i=0;i<32;i++){ if(float(i)>=n) break; float tt=(float(i)+j)/n-.5; acc+=texture2D(tColor,vUv+v*tt).rgb; }
          gl_FragColor=vec4(acc/n,1.); }`);
      this.mCopy = mat({ tColor: { value: null } }, `uniform sampler2D tColor; varying vec2 vUv; void main(){ gl_FragColor=vec4(texture2D(tColor,vUv).rgb,1.); }`);

      // b. trails: out = mix(current, reprojected history, w). History alpha holds log2(view distance) of the frame that wrote it,
      //    so a disocclusion test is possible without a second depth target.
      this.uT = { tColor: { value: null }, tDepth: { value: null }, tHist: { value: null }, invVP: { value: null }, histVP: { value: null },
        res: { value: new THREE.Vector2(W, H) }, near: { value: 1 }, far: { value: 1000 }, w: { value: 0.65 }, clampK: { value: 0.15 }, tol: { value: 0.06 }, valid: { value: 0 } };
      this.mTrail = mat(this.uT, `
        uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tHist; uniform mat4 invVP; uniform mat4 histVP; uniform vec2 res;
        uniform float w, clampK, tol, valid; varying vec2 vUv;
        ${DEPTH_GLSL}
        vec3 histCR(vec2 uv){ // 5-tap Catmull-Rom: resampling the history every frame with bilinear would soften static detail while the camera creeps
          vec2 sp=uv*res, tp=floor(sp-.5)+.5, f=sp-tp;
          vec2 w0=f*(-.5+f*(1.-.5*f)), w1=1.+f*f*(-2.5+1.5*f), w2=f*(.5+f*(2.-1.5*f)), w3=f*f*(-.5+.5*f);
          vec2 w12=w1+w2, t12=(tp+w2/w12)/res, t0=(tp-1.)/res, t3=(tp+2.)/res;
          vec3 s=texture2D(tHist,vec2(t12.x,t0.y)).rgb*(w12.x*w0.y)+texture2D(tHist,vec2(t0.x,t12.y)).rgb*(w0.x*w12.y)+texture2D(tHist,t12).rgb*(w12.x*w12.y)
                +texture2D(tHist,vec2(t3.x,t12.y)).rgb*(w3.x*w12.y)+texture2D(tHist,vec2(t12.x,t3.y)).rgb*(w12.x*w3.y);
          return max(s/(w12.x*w0.y+w0.x*w12.y+w12.x*w12.y+w3.x*w12.y+w12.x*w3.y),vec3(0.)); }
        void main(){
          vec3 c=texture2D(tColor,vUv).rgb;
          float d=texture2D(tDepth,vUv).x;
          float zl=log2(max(-viewZ(d),1e-4));
          vec4 wp=invVP*vec4(vUv*2.-1.,d*2.-1.,1.); wp/=wp.w;     // world position of this pixel
          vec4 pc=histVP*wp;                                      // where the history camera saw it
          vec2 puv=pc.xy/max(pc.w,1e-6)*.5+.5;
          if(valid<.5 || pc.w<=1e-4 || any(lessThan(puv,vec2(0.))) || any(greaterThan(puv,vec2(1.)))){ gl_FragColor=vec4(c,zl); return; } // off-screen / reset
          vec3 h=histCR(puv);
          float hz=texelFetch(tHist,ivec2(clamp(puv*res,vec2(0.),res-1.)),0).a;  // log2 distance stored with the history
          float dz=abs(hz-log2(pc.w));                                           // vs where this surface should have been
          float mpx=length((vUv-puv)*res);                                       // camera-induced motion, px
          float camMove=smoothstep(.75,4.,mpx);
          // a depth mismatch with a still camera is a moving object (keep it: that is the trail); with a moving camera it is a disocclusion (drop it)
          float disocc=smoothstep(tol,tol*4.,dz)*camMove;
          // lenient neighbourhood clamp: a widened min/max box, applied only partly while the camera creeps, fully during fast camera moves
          vec2 t=1./res;
          vec3 a1=texture2D(tColor,vUv+vec2(t.x,0.)).rgb, a2=texture2D(tColor,vUv-vec2(t.x,0.)).rgb, a3=texture2D(tColor,vUv+vec2(0.,t.y)).rgb, a4=texture2D(tColor,vUv-vec2(0.,t.y)).rgb;
          vec3 mn=min(c,min(min(a1,a2),min(a3,a4))), mx=max(c,max(max(a1,a2),max(a3,a4)));
          vec3 ext=(mx-mn)*.5+.03*max(dot(mx,vec3(.2126,.7152,.0722)),.02);
          h=mix(h,clamp(h,mn-ext,mx+ext),mix(clampK,1.,camMove));
          gl_FragColor=vec4(mix(c,h,w*(1.-disocc)),zl); }`);

      // a. contact AO. Raw pass runs at half res and reads full-res depth with texelFetch; .x = AO, .y = view distance for the bilateral steps.
      this.uAO = { tDepth: { value: null }, res: { value: new THREE.Vector2(W, H) }, near: { value: 1 }, far: { value: 1000 }, pInv: { value: new THREE.Vector2(1, 1) },
        projScale: { value: 500 }, radius: { value: 0.02 }, intensity: { value: 1 }, bias: { value: 0.12 }, maxPx: { value: 48 } };
      this.mAO = mat(this.uAO, `
        uniform sampler2D tDepth; uniform vec2 res; uniform vec2 pInv; uniform float projScale, radius, intensity, bias, maxPx; varying vec2 vUv;
        ${DEPTH_GLSL}
        ${IGN}
        vec3 vpos(ivec2 p){ p=clamp(p,ivec2(0),ivec2(res)-1); float z=viewZ(texelFetch(tDepth,p,0).x); return vec3(((vec2(p)+.5)/res*2.-1.)*pInv*(-z),z); }
        void main(){
          ivec2 ip=ivec2(gl_FragCoord.xy)*2;
          float d=texelFetch(tDepth,ip,0).x;
          if(d>=.999999){ gl_FragColor=vec4(1.,6e4,0.,1.); return; }          // sky / cleared
          vec3 P=vpos(ip);
          vec3 x1=vpos(ip+ivec2(1,0))-P, x0=P-vpos(ip-ivec2(1,0)), y1=vpos(ip+ivec2(0,1))-P, y0=P-vpos(ip-ivec2(0,1));
          vec3 N=normalize(cross(abs(x1.z)<abs(x0.z)?x1:x0, abs(y1.z)<abs(y0.z)?y1:y0)); // normal from the smoother side: no halos at silhouettes
          float rPx=min(radius*projScale,maxPx);                // radius is a fraction of view distance, so its screen size is constant
          float R=rPx/projScale*(-P.z), R2=R*R;
          if(rPx<1.){ gl_FragColor=vec4(1.,-P.z,0.,1.); return; }
          float j=ign(gl_FragCoord.xy)*6.2831853, occ=0.;
          for(int i=0;i<12;i++){
            float a=(float(i)+.5)/12., ang=a*7.*6.2831853+j;   // 7-turn spiral, per-pixel rotation
            vec3 v=vpos(ip+ivec2(vec2(cos(ang),sin(ang))*a*rPx))-P;
            float vv=dot(v,v);
            occ+=max(0.,1.-vv/R2)*max(0.,dot(v,N)*inversesqrt(vv+1e-4*R2)-bias); }
          gl_FragColor=vec4(clamp(1.-intensity*occ/3.,0.,1.),-P.z,0.,1.); }`);
      this.uAOB = { tAO: { value: null }, dir: { value: new THREE.Vector2(1, 0) }, hres: { value: new THREE.Vector2(W >> 1, H >> 1) } };
      this.mAOBlur = mat(this.uAOB, `
        uniform sampler2D tAO; uniform vec2 dir; uniform vec2 hres; varying vec2 vUv;
        void main(){
          ivec2 p=ivec2(gl_FragCoord.xy), mx=ivec2(hres)-1; vec2 c=texelFetch(tAO,p,0).xy; float s=c.x, ws=1., k=1./(.03*c.y);
          for(int i=-4;i<=4;i++){ if(i==0) continue;
            vec2 t=texelFetch(tAO,clamp(p+ivec2(dir)*i,ivec2(0),mx),0).xy;
            float wt=exp(-float(i*i)*.125)*max(0.,1.-abs(t.y-c.y)*k); s+=t.x*wt; ws+=wt; }
          gl_FragColor=vec4(s/ws,c.y,0.,1.); }`);
      this.uAOC = { tColor: { value: null }, tDepth: { value: null }, tAO: { value: null }, hres: { value: new THREE.Vector2(W >> 1, H >> 1) }, near: { value: 1 }, far: { value: 1000 }, dbg: { value: 0 } };
      this.mAOComp = mat(this.uAOC, `
        uniform sampler2D tColor; uniform sampler2D tDepth; uniform sampler2D tAO; uniform vec2 hres; uniform float dbg; varying vec2 vUv;
        ${DEPTH_GLSL}
        void main(){
          vec4 c=texture2D(tColor,vUv); float d=texture2D(tDepth,vUv).x;
          if(d>=.999999){ gl_FragColor=vec4(c.rgb,1.); return; }
          float z=-viewZ(d), k=1./(.03*z);
          vec2 hp=vUv*hres-.5, f=fract(hp); ivec2 b=ivec2(floor(hp)), mx=ivec2(hres)-1;
          float s=0., ws=1e-4;                                    // joint bilateral upsample: bilinear weights x depth similarity
          for(int y=0;y<2;y++) for(int x=0;x<2;x++){
            vec2 t=texelFetch(tAO,clamp(b+ivec2(x,y),ivec2(0),mx),0).xy;
            float wt=(x==0?1.-f.x:f.x)*(y==0?1.-f.y:f.y)*max(1e-3,1.-abs(t.y-z)*k); s+=t.x*wt; ws+=wt; }
          gl_FragColor=vec4(dbg>.5 ? vec3(.6*s/ws) : c.rgb*(s/ws),1.); }`);
      this.fsQuad = new FullScreenQuad(this.mCopy);
    }
    draw(r, m, target) { this.fsQuad.material = m; r.setRenderTarget(target); this.fsQuad.render(r); }
    alloc() {
      const mk = (w, h, filt) => new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: filt, magFilter: filt });
      const hw = Math.max(1, this.w >> 1), hh = Math.max(1, this.h >> 1);
      if (trails.enabled && !this.hist) { this.hist = [mk(this.w, this.h, THREE.LinearFilter), mk(this.w, this.h, THREE.LinearFilter)]; this.histOk = false; }
      if (ao.enabled && !this.aoA) { this.aoA = mk(hw, hh, THREE.NearestFilter); this.aoB = mk(hw, hh, THREE.NearestFilter); }
      if (ao.enabled && (trails.enabled || this.blur) && !this.tmp) this.tmp = mk(this.w, this.h, THREE.LinearFilter);
    }
    render(r, write) {
      this.alloc();
      const depth = scenePass.rt.depthTexture; let src = scenePass.rt.texture, done = false;
      const near = cam.near, far = cam.far, last = !trails.enabled && !this.blur;
      if (ao.enabled) {
        const P = cam.projectionMatrix.elements;
        this.uAO.tDepth.value = depth; this.uAO.near.value = near; this.uAO.far.value = far;
        this.uAO.pInv.value.set(1 / P[0], 1 / P[5]); this.uAO.projScale.value = 0.5 * this.h * P[5];
        this.uAO.radius.value = ao.radius; this.uAO.intensity.value = ao.intensity; this.uAO.bias.value = ao.bias; this.uAO.maxPx.value = ao.maxPx;
        this.draw(r, this.mAO, this.aoA);
        this.uAOB.tAO.value = this.aoA.texture; this.uAOB.dir.value.set(1, 0); this.draw(r, this.mAOBlur, this.aoB);
        this.uAOB.tAO.value = this.aoB.texture; this.uAOB.dir.value.set(0, 1); this.draw(r, this.mAOBlur, this.aoA);
        const c = this.uAOC; c.tColor.value = src; c.tDepth.value = depth; c.tAO.value = this.aoA.texture; c.near.value = near; c.far.value = far; c.dbg.value = ao.debug ? 1 : 0;
        this.draw(r, this.mAOComp, last ? write : this.tmp);
        if (last) done = true; else src = this.tmp.texture;
      }
      if (trails.enabled) {
        const u = this.uT, h0 = this.hist[0], h1 = this.hist[1];
        u.tColor.value = src; u.tDepth.value = depth; u.tHist.value = h0.texture; u.invVP.value = this.invVP; u.histVP.value = this.histRel;
        u.near.value = near; u.far.value = far; u.valid.value = this.histOk ? 1 : 0;
        u.w.value = Math.pow(THREE.MathUtils.clamp(trails.amount, 0, 0.98), THREE.MathUtils.clamp(lastDt * 60, 0.25, 4)); // same time constant at any frame rate
        u.clampK.value = trails.clamp; u.tol.value = trails.depthTol;
        this.draw(r, this.mTrail, h1);
        this.hist[0] = h1; this.hist[1] = h0; this.histVP.copy(curVP); this.histOk = true;
        src = h1.texture;
      }
      if (this.blur) { this.u.tColor.value = src; this.u.tDepth.value = depth; this.draw(r, this.mBlur, write); }
      else if (!done) { this.mCopy.uniforms.tColor.value = src; this.draw(r, this.mCopy, write); }
    }
    setSize(w, h) {
      this.w = w; this.h = h; this.u.res.value.set(w, h); this.uT.res.value.set(w, h); this.uAO.res.value.set(w, h);
      const hw = Math.max(1, w >> 1), hh = Math.max(1, h >> 1); this.uAOB.hres.value.set(hw, hh); this.uAOC.hres.value.set(hw, hh);
      for (const t of [this.tmp, ...(this.hist || [])]) t && t.setSize(w, h);
      for (const t of [this.aoA, this.aoB]) t && t.setSize(hw, hh);
      this.histOk = false;
    }
    dispose() { for (const t of [this.tmp, this.aoA, this.aoB, ...(this.hist || [])]) t && t.dispose(); this.hist = this.tmp = this.aoA = this.aoB = null; }
  }
  const mbPass = new HDRFXPass(); mbPass.enabled = false;
  composer.addPass(mbPass);

  // 3. DOF + bloom, parameters unchanged from d5.current.js
  //    DOF reads the scene pass's own depth texture instead of re-rendering the scene with a depth override
  //    (that doubled the draw cost and missed vertex displacement on the terrain and habs).
  const dof = new BokehPass(scene, cam, { focus: 30, aperture: 0.0001, maxblur: 0.002 });
  dof.materialBokeh.defines.DEPTH_PACKING = 0; dof.materialBokeh.needsUpdate = true; // raw depth texture, not RGBA-packed
  dof.renderTargetDepth.dispose();
  dof.render = function (r, write, read) {
    const u = this.uniforms;
    u.tColor.value = mbPass.enabled ? read.texture : scenePass.rt.texture; // FX pass off: scene colour is still in the private RT
    u.tDepth.value = scenePass.rt.depthTexture; u.nearClip.value = cam.near; u.farClip.value = cam.far;
    r.setRenderTarget(this.renderToScreen ? null : write); this.fsQuad.render(r);
  };
  dof.setSize = function (w, h) { this.uniforms.aspect.value = w / h; };
  composer.addPass(dof);
  // composer.addPass/setSize hand every pass drawing-buffer pixels, so bloom has always run at device size; keep that look
  const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.8, 0.5, 0.72);
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
    uniforms: { tDiffuse: { value: null }, ca: { value: 0.012 }, time: { value: 0 }, grain: { value: 0.045 }, res: { value: new THREE.Vector2(W, H) } }, // grain cells = drawing-buffer pixels
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
  const curVP = new THREE.Matrix4(), prevVP = new THREE.Matrix4(), invRel = new THREE.Matrix4(), toCam = new THREE.Matrix4(), _t = new THREE.Matrix4(), _o = new THREE.Vector3(), lastPos = new THREE.Vector3(), lastQuat = new THREE.Quaternion();
  let have = false, lastDt = 1 / 60, resetNext = false, bufW = W;

  function setSize(w, h) {
    renderer.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix();
    const p = renderer.getPixelRatio(); bufW = Math.max(1, Math.floor(w * p));
    composer.setSize(w, h); lens.uniforms.res.value.set(bufW, Math.max(1, Math.floor(h * p))); resetNext = true;
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
    // camera-relative reprojection: the site sits ~40 km from the origin, so absolute world matrices in float32 smear static detail.
    // invRel: NDC -> (world - camPos); X * toCam: (world - camPos) -> X's clip space. Built in JS doubles.
    _o.setFromMatrixPosition(cam.matrixWorld); toCam.makeTranslation(_o.x, _o.y, _o.z);
    invRel.copy(curVP).invert().premultiply(_t.makeTranslation(-_o.x, -_o.y, -_o.z));
    let on = false;
    const dp = have ? cam.position.distanceTo(lastPos) : 0, ang = have ? lastQuat.angleTo(cam.quaternion) : 0;
    if (have && !resetNext && motion.enabled) {
      const f = Math.min(Math.max(focus === undefined ? dof.uniforms.focus.value : focus, 3), 60); // near-field parallax proxy
      const fovR = cam.fov * Math.PI / 180, px = (ang + dp / f) / fovR * H;
      const scale = THREE.MathUtils.clamp(motion.shutter * (1 / 60) / lastDt, 0.15, 2);
      if (dp < motion.cutDist && ang < motion.cutAngle && px * scale > motion.minPx) {
        on = true; const u = mbPass.u; u.prevVP.value.multiplyMatrices(prevVP, toCam); u.invVP.value.copy(invRel); u.scale.value = scale; u.maxLen.value = motion.maxLen;
      }
    }
    // trails: history is invalid after a reset, a detected cut, a resize, or while the feature is off
    if (!trails.enabled || !have || resetNext || dp >= motion.cutDist || ang >= Math.min(motion.cutAngle, trails.cutAngle)) mbPass.histOk = false;
    if (trails.enabled) { mbPass.invVP.copy(invRel); mbPass.histRel.multiplyMatrices(mbPass.histVP, toCam); }
    else if (mbPass.hist) { mbPass.hist.forEach(t => t.dispose()); mbPass.hist = null; } // free ~2 full-res HDR buffers while off
    if (!ao.enabled && mbPass.aoA) { mbPass.aoA.dispose(); mbPass.aoB.dispose(); mbPass.aoA = mbPass.aoB = null; }
    if (!ao.enabled && mbPass.tmp) { mbPass.tmp.dispose(); mbPass.tmp = null; }
    mbPass.blur = on;
    const fx = on || trails.enabled || ao.enabled;   // depth target + FX pass only when something needs them
    motion.active = on; trails.active = trails.enabled; ao.active = ao.enabled;
    // DOF taps reach 0.4 * maxblur of the width; under half a pixel the pass is invisible, so skip it
    const dofOn = 0.4 * dof.uniforms.maxblur.value * bufW >= 0.5;
    mbPass.enabled = fx; dof.enabled = dofOn; scenePass.useRT = fx || dofOn;
    prevVP.copy(curVP); lastPos.copy(cam.position); lastQuat.copy(cam.quaternion); have = true; resetNext = false;
  }

  function render() { composer.render(lastDt); }

  // debug / QA: synchronous readback (stalls the GPU, never call in production)
  const _px = new Float32Array(4);
  function getExposure() { renderer.readRenderTargetPixels(tonePass.sA, 0, 0, 1, 1, _px); return { exposure: _px[0], lnLum: _px[1] }; }

  return {
    composer, dof, lens, bloom, smaa, setSize, update, render,
    motion, auto, trails, ao,
    resetMotion() { resetNext = true; },          // call on hard cuts if you know about them (big jumps are also auto-detected)
    snapExposure() { tonePass.snap = true; },     // jump exposure to target next frame (no adaptation)
    getExposure
  };
}
