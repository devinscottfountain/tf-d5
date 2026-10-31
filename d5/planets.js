// planets.js: physically motivated Earth / Moon / Mars for the TerraFirma D5 intro.
// createPlanets({ THREE, scene, renderer, toSun, EARTH, MOON, MARS, assetBase })
//   -> { earth, moon, mars, clouds, earthAtmo, marsAtmo, ready, update({ t, intro, camPos }) }
// All shaders output LINEAR HDR (the composer's OutputPass does ACES + sRGB). Colour maps are sRGB textures,
// so the GPU decodes them to linear on sampling. No per-frame allocations.

// ---------------------------------------------------------------------------------------------
// shared GLSL
// ---------------------------------------------------------------------------------------------
const GLSL_COMMON = /* glsl */ `
const float PI = 3.14159265;
float hash12(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
float hash13(vec3 p){ p = fract(p * 0.3183099 + .1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash13(i), hash13(i + vec3(1,0,0)), f.x), mix(hash13(i + vec3(0,1,0)), hash13(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash13(i + vec3(0,0,1)), hash13(i + vec3(1,0,1)), f.x), mix(hash13(i + vec3(0,1,1)), hash13(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm3(vec3 p){ float v = 0., a = .5; for(int i = 0; i < 3; i++){ v += a * vnoise(p); p *= 2.07; a *= .5; } return v; }
// direction on the unit sphere -> three.js SphereGeometry uv
vec2 dirToUv(vec3 p){ return vec2(fract(atan(p.z, -p.x) / (2. * PI)), 0.5 + asin(clamp(p.y, -1., 1.)) / PI); }
// tangent frame on the sphere in object space (east = +u, north = +v)
void sphFrame(vec3 p, out vec3 e, out vec3 n){ vec3 c = cross(vec3(0,1,0), p); e = length(c) < 1e-4 ? vec3(0,0,1) : normalize(c); n = cross(p, e); }
// apply a tangent-space (OpenGL style) normal sample to the sphere normal p
vec3 perturb(vec3 p, vec3 nt, float k){ vec3 e, n; sphFrame(p, e, n); nt.xy *= k; return normalize(e * nt.x + n * nt.y + p * max(nt.z, 0.05)); }
// sunlight colour after the air column at sun cosine mu (Kasten-Young airmass), tau = zenith optical depth per channel
vec3 sunTrans(float mu, vec3 tau){ float el = degrees(asin(clamp(mu, -1., 1.))); el = max(el, 0.3);
  float am = 1. / (sin(radians(el)) + 0.50572 * pow(el + 6.07995, -1.6364)); return exp(-tau * am); }
`;

const PLANET_VERT = /* glsl */ `
varying vec3 vP; varying vec2 vUv; varying vec3 vV;
void main(){
  vP = position; vUv = uv;
  mat3 M = mat3(modelMatrix); vec4 w = modelMatrix * vec4(position, 1.);
  vV = transpose(M) * (cameraPosition - w.xyz);           // view vector in object space (meshes only rotate)
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

// ---------------------------------------------------------------------------------------------
// Earth surface
// ---------------------------------------------------------------------------------------------
const EARTH_FRAG = /* glsl */ `
uniform sampler2D tMap, tSpec, tNorm, tLights, tClouds;
uniform vec3 uSun; uniform float uGrow, uCloudOff, uCloudH, uSunI;
varying vec3 vP; varying vec2 vUv; varying vec3 vV;
${GLSL_COMMON}
void main(){
  vec3 p = normalize(vP), V = normalize(vV), L = normalize(uSun);
  float mu = dot(p, L);
  vec3 alb = texture2D(tMap, vUv).rgb;
  float ocean = smoothstep(0.35, 0.7, texture2D(tSpec, vUv).r);
  // the source map paints the sea near-black; lift it to a physical deep blue, keep shallows/ice from the map
  vec3 seaAlb = max(alb, vec3(0.010, 0.036, 0.100)) + vec3(0.0, 0.01, 0.03) * smoothstep(0.0, 0.2, alb.b);
  vec3 base = mix(alb, seaAlb, ocean);

  // relief: normal map on land only, fades toward the poles' texture pinch
  vec3 nt = texture2D(tNorm, vUv).rgb * 2. - 1.;
  vec3 N = perturb(p, nt, 0.8 * (1. - ocean));

  // cloud cover straight above (dims night lights) and cloud shadow: sample the cloud map where the sun ray crosses the cloud deck
  float cover = texture2D(tClouds, vec2(fract(vUv.x + uCloudOff), vUv.y)).r;
  float mus = max(mu, 0.12);
  vec3 q = normalize(p + L * (uCloudH / mus));              // cloud deck point on the way to the sun (radii units)
  vec2 uq = dirToUv(q); uq.x = fract(uq.x + uCloudOff);
  float sh = textureLod(tClouds, uq, 2.2).r;                // lod keeps it soft and avoids the atan seam
  float shadow = 1. - 0.62 * smoothstep(0.15, 0.85, sh) * smoothstep(0.0, 0.25, mu + 0.05);

  // sunlight through the atmosphere: orange/red toward the terminator
  vec3 sunCol = sunTrans(mu, vec3(0.034, 0.075, 0.175));
  float NL = max(dot(N, L), 0.);
  NL *= smoothstep(-0.02, 0.07, mu);                       // geometric terminator so relief cannot leak light onto the night side
  vec3 col = base * sunCol * NL * uSunI * shadow;
  // blue Rayleigh sky fill on the day side, and the pink/orange twilight band at the terminator
  col += base * vec3(0.10, 0.17, 0.34) * 0.55 * smoothstep(-0.12, 0.6, mu);
  col += vec3(0.95, 0.42, 0.22) * 0.050 * exp(-pow((mu + 0.015) / 0.075, 2.)) * (0.35 + 0.65 * (1. - ocean * 0.5));

  // ocean: tight sun glint + broad sheen, plus Fresnel sky reflection toward the limb
  vec3 H = normalize(L + V); float nh = max(dot(normalize(p), H), 0.), vh = max(dot(V, H), 0.);
  float F = 0.02 + 0.98 * pow(1. - max(dot(p, V), 0.), 5.);
  float glint = pow(nh, 2400.) * 70. + pow(nh, 420.) * 6. + pow(nh, 90.) * 0.12;
  float lit = smoothstep(0.0, 0.12, mu);
  col += ocean * lit * (1. - smoothstep(0.1, 0.8, cover)) * vec3(1.0, 0.93, 0.82) * sunCol * glint * (0.35 + 1.6 * F);
  col += ocean * vec3(0.10, 0.20, 0.42) * F * 1.4 * smoothstep(-0.2, 0.5, mu);

  // night lights: real NASA map, warm sodium, switched on region by region as 'uGrow' rises
  float night = 1. - smoothstep(-0.14, 0.06, mu);
  float li = clamp((texture2D(tLights, vUv).r - 0.10) / 0.8, 0., 1.);   // the source map has a dim continental haze; keep only lamps
  float lg = max(textureLod(tLights, vUv, 3.0).r - 0.07, 0.);               // bleed for the glow around cities
  float dCell = hash12(floor(vUv * vec2(72., 36.)) + 3.1);  // ~5 degree regions pop on in random order
  float dTex = hash12(floor(vUv * vec2(2048., 1024.)));     // individual lamps trail behind their region
  float onAt = dCell * 0.72 + dTex * 0.28;
  float on = smoothstep(onAt, onAt + 0.06, uGrow * 1.08);
  vec3 sodium = vec3(1.0, 0.58, 0.24);
  vec3 lights = sodium * (pow(li, 1.35) * 2.6 + lg * lg * 0.9) * on;
  col += lights * night * (1. - 0.82 * smoothstep(0.1, 0.8, cover));

  gl_FragColor = vec4(col, 1.);
}`;

// ---------------------------------------------------------------------------------------------
// Earth cloud deck
// ---------------------------------------------------------------------------------------------
const CLOUD_FRAG = /* glsl */ `
uniform sampler2D tClouds; uniform vec3 uSun; uniform float uSunI; uniform sampler2D tLights;
varying vec3 vP; varying vec2 vUv; varying vec3 vV;
${GLSL_COMMON}
void main(){
  vec3 p = normalize(vP), V = normalize(vV), L = normalize(uSun);
  float mu = dot(p, L);
  vec2 px = vec2(1. / 2048., 1. / 1024.);
  float d0 = texture2D(tClouds, vUv).r;
  float dx = texture2D(tClouds, vUv + vec2(px.x, 0.)).r, dy = texture2D(tClouds, vUv + vec2(0., px.y)).r;
  // fine detail so the 2k map holds up in close shots; only inside existing cloud
  float nz = fbm3(p * 26.) - 0.5;
  float dens = clamp(d0 + nz * 0.55 * smoothstep(0.03, 0.4, d0) * (1.1 - d0), 0., 1.);
  dens = smoothstep(0.06, 0.78, dens);
  // puffiness: treat density as height, light the bumps
  vec3 e, n; sphFrame(p, e, n);
  vec3 N = normalize(p - (e * (dx - d0) + n * (dy - d0)) * 14.);
  float NL = max(dot(N, L), 0.) * smoothstep(-0.03, 0.1, mu);
  vec3 sunCol = sunTrans(mu, vec3(0.034, 0.075, 0.175));
  float NV = max(dot(p, V), 0.);
  // thick cloud: lit tops, shaded cores; thin cloud forward-scatters a little light past the terminator
  vec3 col = vec3(0.93, 0.95, 0.98) * sunCol * NL * uSunI * mix(1., 0.78, dens);
  col += vec3(0.10, 0.17, 0.34) * 0.55 * smoothstep(-0.12, 0.6, mu) * 0.9;
  col += vec3(0.95, 0.5, 0.3) * 0.05 * exp(-pow((mu + 0.01) / 0.08, 2.)) * dens;
  // faint city glow under the deck on the night side
  float night = 1. - smoothstep(-0.14, 0.06, mu);
  col += vec3(1.0, 0.58, 0.24) * max(textureLod(tLights, vUv, 3.0).r - 0.07, 0.) * 0.9 * night * dens;
  float a = dens * (1. + 0.5 * (1. - NV));
  gl_FragColor = vec4(col, clamp(a, 0., 1.) * 0.97);
}`;

// ---------------------------------------------------------------------------------------------
// Moon: albedo map, Lommel-Seeliger/Lambert mix, crater relief normal map
// ---------------------------------------------------------------------------------------------
const MOON_FRAG = /* glsl */ `
uniform sampler2D tMap, tNorm; uniform vec3 uSun; uniform float uSunI, uAlbedo, uRelief;
varying vec3 vP; varying vec2 vUv; varying vec3 vV;
${GLSL_COMMON}
void main(){
  vec3 p = normalize(vP), V = normalize(vV), L = normalize(uSun);
  float mu = dot(p, L);
  vec3 alb = texture2D(tMap, vUv).rgb;
  alb = pow(alb, vec3(1.25)) * uAlbedo;                      // the map is contrast-stretched; pull toward real lunar albedo
  vec3 N = perturb(p, texture2D(tNorm, vUv).rgb * 2. - 1., uRelief);
  float m0 = max(dot(N, L), 0.) * smoothstep(-0.04, 0.05, mu), m1 = max(dot(N, V), 0.04);
  float ls = 2. * m0 / (m0 + m1);                            // regolith is nearly flat-lit to the limb until the sun gets low
  float val = mix(m0, ls, 0.55);
  vec3 col = alb * val * uSunI;
  col += alb * vec3(0.35, 0.45, 0.7) * 0.004;               // earthshine
  gl_FragColor = vec4(col, 1.);
}`;

// ---------------------------------------------------------------------------------------------
// Mars surface
// ---------------------------------------------------------------------------------------------
const MARS_FRAG = /* glsl */ `
uniform sampler2D tMap, tNorm; uniform vec3 uSun; uniform float uSunI, uRelief, uDomes;
varying vec3 vP; varying vec2 vUv; varying vec3 vV;
${GLSL_COMMON}
void main(){
  vec3 p = normalize(vP), V = normalize(vV), L = normalize(uSun);
  float mu = dot(p, L);
  vec3 alb = texture2D(tMap, vUv).rgb;
  vec3 N = perturb(p, texture2D(tNorm, vUv).rgb * 2. - 1., uRelief);
  vec3 sunCol = sunTrans(mu, vec3(0.05, 0.085, 0.15));       // dusty sky: butterscotch light, reddening at low sun
  float NL = max(dot(N, L), 0.) * smoothstep(-0.03, 0.08, mu);
  vec3 col = alb * sunCol * NL * uSunI;
  col += alb * vec3(0.95, 0.60, 0.36) * 0.20 * smoothstep(-0.15, 0.6, mu);   // dust-scattered sky fill
  col += vec3(0.9, 0.5, 0.3) * 0.035 * exp(-pow((mu + 0.01) / 0.09, 2.));    // dusk glow at the terminator
  col += alb * vec3(0.5, 0.3, 0.25) * 0.012 * (1. - smoothstep(-0.2, 0.1, mu)); // faint dust-lit night so the dive reads
  // dome settlements glowing on the night side (carried over from the previous planet shader)
  float dome = smoothstep(0.9, 0.97, vnoise(p * 380.)) * smoothstep(0.62, 0.72, fbm3(p * 4.) * 1.35);
  col += vec3(1., 0.68, 0.3) * dome * (1. - smoothstep(-0.12, 0.05, mu)) * 2.4 * uDomes;
  gl_FragColor = vec4(col, 1.);
}`;

// ---------------------------------------------------------------------------------------------
// Atmosphere shell: single scattering (Rayleigh + Mie), analytic ray/sphere, 16 view samples x 3 light samples.
// Samples cluster around the ray's lowest point so a thin limb is resolved. Premultiplied output.
// ---------------------------------------------------------------------------------------------
const ATMO_VERT = /* glsl */ `
varying vec3 vW;
void main(){ vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;

const ATMO_FRAG = /* glsl */ `
uniform vec3 uCenter, uSun, uBetaR, uBetaM, uBetaMe, uG, uSunCol;
uniform float uRp, uRa, uHr, uHm, uK;
varying vec3 vW;
const float PI = 3.14159265;
float dens(float h, float H){ return exp(-max(h, 0.) / H); }
void main(){
  vec3 ro = cameraPosition - uCenter, rd = normalize(vW - cameraPosition);
  float b = dot(ro, rd), cA = dot(ro, ro) - uRa * uRa, dA = b * b - cA;
  if (dA <= 0.) discard;
  float sA = sqrt(dA), t0 = max(-b - sA, 0.), t1 = -b + sA;
  float cP = dot(ro, ro) - uRp * uRp, dP = b * b - cP;
  if (dP > 0.) { float th = -b - sqrt(dP); if (th > 0.) t1 = min(t1, th); }   // stop at the ground
  if (t1 <= t0) discard;
  float tmin = clamp(-b, t0, t1), LA = tmin - t0, LB = t1 - tmin;
  float mu = dot(rd, uSun);
  vec3 phR = vec3(3. / (16. * PI) * (1. + mu * mu));
  vec3 g = uG; vec3 phM = (1. - g * g) / (4. * PI * pow(1. + g * g - 2. * g * mu, vec3(1.5)));
  float jit = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  vec3 odV = vec3(0.), sR = vec3(0.), sM = vec3(0.);
  float dsh = 0.3 * uHr;
  for (int k = 0; k < 16; k++) {
    float ta, tb;
    if (k < 8) { int i = 7 - k; float s0 = float(i) / 8., s1 = float(i + 1) / 8.; ta = tmin - LA * s1 * s1 * s1; tb = tmin - LA * s0 * s0 * s0; }
    else       { int i = k - 8; float s0 = float(i) / 8., s1 = float(i + 1) / 8.; ta = tmin + LB * s0 * s0 * s0; tb = tmin + LB * s1 * s1 * s1; }
    float dt = tb - ta; if (dt <= 0.) continue;
    vec3 pos = ro + rd * (0.5 * (ta + tb) + (jit - 0.5) * 0.7 * dt);   // dither the sample inside its slot to hide banding
    float h = length(pos) - uRp;
    float dR = dens(h, uHr) * dt, dM = dens(h, uHm) * dt;
    odV += uBetaR * dR + uBetaMe * dM;
    // sunlight reaching this sample: shadow of the planet, then optical depth up to the top of the atmosphere
    float pl = dot(pos, uSun);
    float perp = length(pos - uSun * pl);
    float lit = pl > 0. ? 1. : smoothstep(uRp - dsh, uRp + dsh, perp);
    if (lit <= 0.) continue;
    float cL = dot(pos, pos) - uRa * uRa, tl = -pl + sqrt(max(pl * pl - cL, 0.));
    float stp = tl / 3.; vec3 odL = vec3(0.);
    for (int j = 0; j < 3; j++) { vec3 q = pos + uSun * (stp * (float(j) + .5)); float hq = length(q) - uRp;
      odL += uBetaR * dens(hq, uHr) * stp + uBetaMe * dens(hq, uHm) * stp; }
    vec3 att = exp(-(odV + odL)) * lit;
    sR += dR * att; sM += dM * att;
  }
  vec3 col = uSunCol * (sR * uBetaR * phR + sM * uBetaM * phM) * uK;
  float tr = dot(exp(-odV), vec3(0.3333));
  gl_FragColor = vec4(col, clamp(1. - tr, 0., 1.) * 0.85);   // premultiplied: also dims the ground seen through a long slant path
}`;

// ---------------------------------------------------------------------------------------------
export function createPlanets({ THREE, scene, renderer, toSun, EARTH, MOON, MARS, assetBase }) {
  const R_EARTH = 10, R_MOON = 2.7, R_MARS = 6;
  const anis = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
  const pending = [];
  // 1x1 fallbacks so shaders run before maps land
  const dot1 = (r, g, b, srgb) => { const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true; return t; };
  const U = (name, srgb, fb) => { // returns a uniform whose value is swapped when the file loads
    const u = { value: fb };
    pending.push(new Promise(res => loader.load(`${assetBase}/${name}`, t => {
      t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = anis; t.wrapS = THREE.RepeatWrapping; t.needsUpdate = true; u.value = t; res();
    }, undefined, () => res())));
    return u;
  };
  const sunVec = () => ({ value: new THREE.Vector3().copy(toSun) });

  // ---------- Earth ----------
  const earthU = {
    tMap: U('d5-earth.jpg', true, dot1(10, 30, 70, true)), tSpec: U('earth_spec.jpg', false, dot1(255, 255, 255)),
    tNorm: U('earth_normal.jpg', false, dot1(128, 128, 255)), tLights: U('earth_lights.jpg', false, dot1(0, 0, 0)),
    tClouds: U('earth_clouds.jpg', false, dot1(0, 0, 0)),
    uSun: sunVec(), uGrow: { value: 0.03 }, uCloudOff: { value: 0 }, uCloudH: { value: 0.0085 }, uSunI: { value: 3.3 }
  };
  const earth = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH, 192, 96),
    new THREE.ShaderMaterial({ vertexShader: PLANET_VERT, fragmentShader: EARTH_FRAG, uniforms: earthU }));
  earth.position.copy(EARTH); scene.add(earth);

  const cloudU = { tClouds: earthU.tClouds, tLights: earthU.tLights, uSun: sunVec(), uSunI: earthU.uSunI };
  const clouds = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH * 1.0085, 160, 80),
    new THREE.ShaderMaterial({ vertexShader: PLANET_VERT, fragmentShader: CLOUD_FRAG, uniforms: cloudU, transparent: true, depthWrite: false }));
  clouds.position.copy(EARTH); clouds.renderOrder = 1; scene.add(clouds);

  // ---------- Moon ----------
  const moonU = {
    tMap: U('d5-moon.jpg', true, dot1(150, 150, 150, true)), tNorm: U('moon_normal.jpg', false, dot1(128, 128, 255)),
    uSun: sunVec(), uSunI: { value: 3.3 }, uAlbedo: { value: 0.30 }, uRelief: { value: 1.35 }
  };
  const moon = new THREE.Mesh(new THREE.SphereGeometry(R_MOON, 128, 64),
    new THREE.ShaderMaterial({ vertexShader: PLANET_VERT, fragmentShader: MOON_FRAG, uniforms: moonU }));
  moon.position.copy(MOON); scene.add(moon);

  // ---------- Mars ----------
  const marsU = {
    tMap: U('d5-mars.jpg', true, dot1(150, 70, 40, true)), tNorm: U('mars_normal.jpg', false, dot1(128, 128, 255)),
    uSun: sunVec(), uSunI: { value: 2.2 }, uRelief: { value: 1.25 }, uDomes: { value: 1 }
  };
  const mars = new THREE.Mesh(new THREE.SphereGeometry(R_MARS, 192, 96),
    new THREE.ShaderMaterial({ vertexShader: PLANET_VERT, fragmentShader: MARS_FRAG, uniforms: marsU }));
  mars.position.copy(MARS); scene.add(mars);

  // ---------- atmospheres ----------
  // betas are per planet radius (physical Earth values: R 5.8/13.5/33.1e-6 per m * 6371 km); heights are fractions of the radius, stretched ~3x for the camera
  const atmo = (center, Rp, o) => {
    const u = {
      uCenter: { value: center.clone() }, uSun: { value: new THREE.Vector3().copy(toSun) }, uRp: { value: Rp }, uRa: { value: Rp * o.top },
      uBetaR: { value: new THREE.Vector3(...o.bR).divideScalar(Rp) }, uBetaM: { value: new THREE.Vector3(...o.bM).divideScalar(Rp) },
      uBetaMe: { value: new THREE.Vector3(...o.bMe).divideScalar(Rp) }, uG: { value: new THREE.Vector3(...o.g) },
      uSunCol: { value: new THREE.Vector3(...o.sun) }, uHr: { value: o.Hr * Rp }, uHm: { value: o.Hm * Rp }, uK: { value: o.k }
    };
    const m = new THREE.Mesh(new THREE.SphereGeometry(Rp * o.top, 128, 64), new THREE.ShaderMaterial({
      vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, uniforms: u, transparent: true, depthWrite: false,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor
    }));
    m.position.copy(center); m.renderOrder = 2; scene.add(m); return m;
  };
  const earthAtmo = atmo(EARTH, R_EARTH, {
    top: 1.10, Hr: 0.0085, Hm: 0.0034, bR: [8, 19, 48], bM: [24, 24, 24], bMe: [27, 27, 27], g: [0.80, 0.80, 0.80], sun: [1, 0.97, 0.92], k: 15
  });
  // Mars: dust-dominated. Scatter is butterscotch, extinction lets red through, and the forward lobe is tighter in blue (bluish glow around the sun).
  const marsAtmo = atmo(MARS, R_MARS, {
    top: 1.07, Hr: 0.0075, Hm: 0.0120, bR: [3, 7, 18], bM: [5.0, 3.4, 1.8], bMe: [6.0, 5.0, 4.4], g: [0.55, 0.72, 0.90], sun: [1, 0.95, 0.88], k: 12
  });
  const atmos = [earthAtmo, marsAtmo];

  // ---------- per-frame ----------
  const qi = new THREE.Quaternion(), tv = new THREE.Vector3();
  const sunInto = (mesh, uni) => { qi.copy(mesh.quaternion).invert(); uni.value.copy(toSun).applyQuaternion(qi); };
  const EARTH_SPIN = 0.012, CLOUD_SPIN = 0.0158;
  function update({ t = 0, intro = 1, camPos } = {}) {
    earth.rotation.y = t * EARTH_SPIN; clouds.rotation.y = t * CLOUD_SPIN; moon.rotation.y = t * 0.01; mars.rotation.y = t * 0.02;
    sunInto(earth, earthU.uSun); sunInto(clouds, cloudU.uSun); sunInto(moon, moonU.uSun); sunInto(mars, marsU.uSun);
    earthU.uCloudOff.value = (earth.rotation.y - clouds.rotation.y) / (2 * Math.PI);   // cloud deck slides over the ground
    earthU.uGrow.value = 0.03 + 0.97 * intro;                                          // city lights spread on load
    if (camPos) for (const a of atmos) { // flip to the inside face if the camera ever enters a shell
      const inside = tv.copy(camPos).sub(a.position).length() < a.material.uniforms.uRa.value * 1.002;
      const side = inside ? THREE.BackSide : THREE.FrontSide; if (a.material.side !== side) { a.material.side = side; a.material.needsUpdate = true; }
    }
  }
  return { earth, moon, mars, clouds, earthAtmo, marsAtmo, ready: Promise.all(pending), update };
}
