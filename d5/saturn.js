// Saturn + rings for the TerraFirma D5 scroll cinematic.
// createSaturn({ THREE, scene, toSun, SATURN, assetBase }) -> { saturn, ring, update({ t }), loaded }
// Planet radius 40, rings 52..98, tilt identical to the original single-file version.
// Shadows are analytic: the planet's shadow falls on the rings (ray-sphere) and the rings' shadow
// falls on the planet as bands (ray-plane, sampling the ring alpha strip). Sun is at infinity along toSun.

const R_PLANET = 40, R_IN = 52, R_OUT = 98;

// shared GLSL: ring strip lookup + ring-plane shadow helpers
const COMMON = /* glsl */`
uniform vec3 uSun;        // unit vector toward the sun (world)
uniform vec3 uCenter;     // Saturn centre (world)
uniform vec3 uRingN;      // ring plane normal (world, unit)
uniform sampler2D uRing;  // 915x64 strip: rgb colour, a opacity (inner -> outer along x)
uniform float uRingOn;    // 0 until the strip texture has loaded
const float R_PL=${R_PLANET.toFixed(1)}, R_IN=${R_IN.toFixed(1)}, R_OUT=${R_OUT.toFixed(1)};
float ringU(float r){ return (r-R_IN)/(R_OUT-R_IN); }
// cheap 1D value noise for fine ringlets on top of the strip
float h1(float x){ return fract(sin(x*127.1)*43758.5453); }
float n1(float x){ float i=floor(x), f=fract(x); f=f*f*(3.-2.*f); return mix(h1(i),h1(i+1.),f); }
// ring opacity at radius r (strip alpha with a little procedural ringlet detail)
float ringAlpha(float r){
  float u=ringU(r);
  if(u<=0.||u>=1.) return 0.;
  float a=texture2D(uRing,vec2(u,0.5)).a;
  float fine=0.82+0.36*n1(r*9.)*n1(r*2.3+7.);
  return clamp(a*fine,0.,1.)*uRingOn;
}
`;

const PLANET_VERT = /* glsl */`
varying vec3 vN; varying vec3 vW; varying vec2 vUv;
void main(){
  vUv=uv; vN=normalize(mat3(modelMatrix)*normal);
  vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz;
  gl_Position=projectionMatrix*viewMatrix*w;
}`;

const PLANET_FRAG = /* glsl */`
${COMMON}
uniform sampler2D uMap; uniform float uHasMap; uniform float uTime;
varying vec3 vN; varying vec3 vW; varying vec2 vUv;
void main(){
  vec3 N=normalize(vN), V=normalize(cameraPosition-vW);
  float mu=max(dot(N,V),0.);
  vec3 alb=mix(vec3(0.55,0.42,0.27), texture2D(uMap, vec2(vUv.x+uTime*0.0004, vUv.y)).rgb, uHasMap);
  alb=pow(alb,vec3(1.05))*1.05;
  // diffuse with a soft terminator
  float d=dot(N,uSun);
  float lit=smoothstep(-0.10,0.32,d);
  // rings' shadow: march from this surface point toward the sun to the ring plane
  float shadow=1.;
  float dn=dot(uSun,uRingN);
  if(abs(dn)>1e-3 && d>-0.2){
    float tHit=dot(uCenter-vW,uRingN)/dn;
    if(tHit>0.){
      vec3 q=vW+uSun*tHit;
      float r=length(q-uCenter);
      float a=ringAlpha(r);
      // slant path through the ring: low sun angle means more material along the ray
      float path=1./max(abs(dn),0.12);
      float opac=1.-pow(1.-min(a,0.985),path*0.9);
      shadow=1.-opac*0.93;
    }
  }
  // limb darkening (linear law, u~0.6) so the disc reads as a gas ball
  float limb=1.-0.62*(1.-mu);
  vec3 col=alb*lit*shadow*limb*0.78;
  // faint night-side fill plus a warm haze on the lit limb
  col+=alb*0.012;
  float rim=pow(1.-mu,3.);
  col+=vec3(1.,0.78,0.5)*rim*smoothstep(-0.1,0.5,d)*0.10*shadow;
  // backlit: thin atmosphere forward-scatters sunlight into a bright limb crescent when viewed toward the sun
  float fwdv=pow(max(-dot(V,uSun),0.),6.);
  col+=vec3(1.,0.72,0.42)*pow(1.-mu,5.)*smoothstep(-0.35,0.05,d)*(1.-smoothstep(0.15,0.6,d))*fwdv*0.9*shadow;
  gl_FragColor=vec4(col,1.);
}`;

const RING_VERT = /* glsl */`
varying vec3 vW;
void main(){ vec4 w=modelMatrix*vec4(position,1.); vW=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`;

const RING_FRAG = /* glsl */`
${COMMON}
varying vec3 vW;
// Henyey-Greenstein phase
float hg(float c,float g){ float g2=g*g; return (1.-g2)/(4.*3.14159265*pow(1.+g2-2.*g*c,1.5)); }
void main(){
  vec3 V=normalize(cameraPosition-vW);
  vec3 rel=vW-uCenter;
  float r=length(rel);
  float u=ringU(r);
  vec4 tex=texture2D(uRing,vec2(clamp(u,0.,1.),0.5));
  float a=ringAlpha(r);
  if(a<0.003) discard;
  vec3 alb=tex.rgb;
  // which faces see the sun: sunSide and camSide have the same sign when frontlit
  float sunSide=dot(uRingN,uSun), camSide=dot(uRingN,V);
  float front=step(0.,sunSide*camSide);          // 1 frontlit, 0 backlit (light passes through)
  float cosI=abs(sunSide);

  // planet's shadow on the ring: closest approach of the sunward ray to Saturn's centre
  float b=dot(rel,uSun);                          // negative when Saturn lies sunward of this point
  float dist=sqrt(max(dot(rel,rel)-b*b,0.));
  float behind=step(b,0.);
  // penumbra grows slowly with distance from the limb
  float pen=0.6+0.02*abs(b);
  float lit=1.-behind*(1.-smoothstep(R_PL-pen,R_PL+pen,dist));

  // phase angle: cos between the direction light travels (-sun) and the direction to the viewer
  float cph=dot(V,uSun);                          // +1 means camera and sun on the same side (backscatter)
  float fwd=hg(-cph,0.62);                         // forward lobe, strong when looking toward the sun
  float bck=0.35+0.9*pow(max(cph,0.),6.);          // opposition brightening when frontlit

  vec3 refl=alb*cosI*bck*lit*0.95*step(0.5,front);
  // backlit: dense ring blocks light, gaps and thin regions glow through (diffracted/forward-scattered dust)
  float thin=pow(1.-a,1.4);
  vec3 trans=alb*lit*(0.03*a*cosI + fwd*2.4*(0.22+1.6*thin*sqrt(a+0.05)))*(1.-front);
  // premultiplied output: reflected light weighted by opacity, transmitted dust glow added on top
  vec3 rgb=refl*a+trans*(0.35+0.65*a);
  // saturnshine: very faint fill so the shadowed ring is never pure black
  rgb+=alb*0.012*a;
  float outA=a*mix(1.,0.9,1.-front);
  gl_FragColor=vec4(rgb,outA);
}`;

export function createSaturn({ THREE, scene, toSun, SATURN, assetBase }) {
  const sun = toSun; // used by reference so a live toSun keeps working (expected unit length)
  const uCommon = {
    uSun: { value: sun },
    uCenter: { value: SATURN.clone() },
    uRingN: { value: new THREE.Vector3(0, 0, 1) },
    uRing: { value: null },
    uRingOn: { value: 0 },
  };

  const saturn = new THREE.Mesh(
    new THREE.SphereGeometry(R_PLANET, 128, 64),
    new THREE.ShaderMaterial({
      vertexShader: PLANET_VERT, fragmentShader: PLANET_FRAG,
      uniforms: { ...uCommon, uMap: { value: null }, uHasMap: { value: 0 }, uTime: { value: 0 } },
    })
  );
  saturn.position.copy(SATURN); saturn.rotation.z = 0.4; scene.add(saturn);

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(R_IN, R_OUT, 256, 1),
    new THREE.ShaderMaterial({
      vertexShader: RING_VERT, fragmentShader: RING_FRAG, uniforms: { ...uCommon },
      transparent: true, side: THREE.DoubleSide, depthWrite: false,
      // premultiplied alpha so backlit dust glow can exceed the strip's own opacity
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    })
  );
  ring.position.copy(SATURN); ring.rotation.set(Math.PI / 2 - 0.32, 0.12, 0.4); scene.add(ring);
  ring.updateMatrixWorld(true);
  // ring plane normal in world space (static, so computed once)
  uCommon.uRingN.value.set(0, 0, 1).transformDirection(ring.matrixWorld).normalize();

  // textures (equirect map + ring strip); shaders degrade gracefully until they arrive
  const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
  const load = url => new Promise(res => loader.load(url, res, undefined, () => res(null)));
  const loaded = Promise.all([load(`${assetBase}/saturn_map.jpg`), load(`${assetBase}/saturn_ring.png`)]).then(([map, strip]) => {
    if (map) {
      map.colorSpace = THREE.SRGBColorSpace; map.wrapS = THREE.RepeatWrapping; map.anisotropy = 8;
      saturn.material.uniforms.uMap.value = map; saturn.material.uniforms.uHasMap.value = 1;
    }
    if (strip) {
      // strip rgb is sRGB colour; alpha is linear opacity. Premultiplied-alpha textures off, so rgb is unmodified.
      strip.colorSpace = THREE.SRGBColorSpace; strip.generateMipmaps = true; strip.minFilter = THREE.LinearMipmapLinearFilter;
      strip.magFilter = THREE.LinearFilter; strip.wrapS = strip.wrapT = THREE.ClampToEdgeWrapping; strip.anisotropy = 4;
      uCommon.uRing.value = strip; uCommon.uRingOn.value = 1;
      // uniforms objects are spread-copied per material, so push to both
      saturn.material.uniforms.uRing.value = strip; saturn.material.uniforms.uRingOn.value = 1;
      ring.material.uniforms.uRing.value = strip; ring.material.uniforms.uRingOn.value = 1;
    }
    return { map, strip };
  });

  const um = saturn.material.uniforms;
  return {
    saturn, ring, loaded,
    update({ t }) { um.uTime.value = t; }
  };
}
