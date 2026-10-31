// sky.js: real star catalog (HYG v4.1, mag <= 6.8) + Gaia Milky Way panorama, drawn at "infinity".
// Usage: const sky = await createSky({ THREE, scene, assetBase }); each frame: sky.update(camera.position)
//
// Frame conventions: stars.bin holds equatorial unit vectors stored in three.js axes
// (+Y = north celestial pole, +X = RA 0h, -Z = RA 6h). The Milky Way panorama is in galactic
// coordinates (l = 0 at image centre, l increasing to the left, b = +90 at the top); the shader
// converts a direction in the equatorial frame to (l, b). The whole sky is then rotated by
// `rotation` so the band lands where the shot wants it.

const R_SKY = 7000;

// Direction of the sun used by the opening shot (must match toSun in d5.current.js).
const TO_SUN = [-1, 0.22, -0.55];

// J2000 galactic frame expressed in the equatorial three.js axes (x, z, -y of the usual equatorial xyz).
function eq(raDeg, decDeg, V) {
  const ra = (raDeg * Math.PI) / 180, de = (decDeg * Math.PI) / 180;
  return new V(Math.cos(de) * Math.cos(ra), Math.sin(de), -Math.cos(de) * Math.sin(ra));
}

// Build the quaternion that carries the galactic frame onto a chosen world frame.
// gc: world direction of the galactic centre, n: world direction of the north galactic pole.
export function skyQuaternion(THREE, gc, n) {
  const V = THREE.Vector3;
  const Gc = eq(266.40499, -28.93617, V), Ngp = eq(192.85948, 27.12825, V);
  const Gy = new V().crossVectors(Ngp, Gc); // completes the right-handed (Gc, Gy, Ngp) triad
  const gcW = gc.clone().normalize(), nW = n.clone().sub(gcW.clone().multiplyScalar(n.dot(gcW))).normalize();
  const yW = new V().crossVectors(nW, gcW);
  const E = new THREE.Matrix4().makeBasis(Gc, Gy, Ngp), W = new THREE.Matrix4().makeBasis(gcW, yW, nW);
  const Rm = W.multiply(E.transpose()); // R = W * E^T
  return new THREE.Quaternion().setFromRotationMatrix(Rm);
}

// Default orientation for the opening shot: camera looks along toSun with the "up" of the d5 path.
// The galactic plane is tilted 30 degrees on screen and the bright core sits right of centre.
function defaultQuaternion(THREE) {
  const V = THREE.Vector3;
  const f = new V(...TO_SUN).normalize();
  const up = new V(0, 1, 0).addScaledVector(f, -f.y).normalize();
  const r = new V().crossVectors(f, up).normalize();
  const tilt = (30 * Math.PI) / 180, core = (72 * Math.PI) / 180;
  const t = r.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(up, Math.sin(tilt)); // band direction on screen
  const nrm = new V().crossVectors(f, t).normalize(); // plane normal (pole side)
  const gc = f.clone().multiplyScalar(Math.cos(core)).addScaledVector(t, Math.sin(core));
  return skyQuaternion(THREE, gc, nrm);
}

// Blackbody colour from B-V (Ballesteros 2012) then Tanner Helland's Planckian approximation, all in GLSL.
const STAR_VERT = /* glsl */ `
attribute float aMag; attribute float aBV;
uniform float uPx; uniform float uGain;
varying vec3 vCol; varying float vI;
vec3 bb(float T){ // T in kelvin, returns sRGB 0..1
  float t = clamp(T, 1500., 15000.) / 100.;
  float r = t <= 66. ? 1. : clamp(1.292936 * pow(t - 60., -0.1332047), 0., 1.);
  float g = t <= 66. ? clamp(0.390082 * log(t) - 0.631841, 0., 1.) : clamp(1.129891 * pow(t - 60., -0.0755148), 0., 1.);
  float b = t >= 66. ? 1. : (t <= 19. ? 0. : clamp(0.543207 * log(t - 10.) - 1.196254, 0., 1.));
  return vec3(r, g, b);
}
void main(){
  float bv = clamp(aBV, -0.4, 2.0);
  float T = 4600. * (1. / (0.92 * bv + 1.7) + 1. / (0.92 * bv + 0.62));
  vec3 c = bb(T);
  c = mix(vec3(dot(c, vec3(0.299, 0.587, 0.114))), c, 0.72); // subtle saturation, like a real exposure
  c = pow(c, vec3(2.2));                                    // to linear
  c /= max(max(c.r, max(c.g, c.b)), 1e-3);
  // brightness: compressed magnitude scale so faint stars stay dim but visible, bright ones bloom
  float I = 0.42 * pow(10., -0.4 * 0.62 * (aMag - 6.8));
  vI = clamp(I, 0., 5.);
  vCol = c;
  // size: faint = 1px, brightest few hundred (mag < ~3.5) clearly bigger
  float s = 1. + 4.2 * pow(clamp((5.2 - aMag) / 6.6, 0., 1.), 1.5);
  gl_PointSize = s * uPx;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
}`;
const STAR_FRAG = /* glsl */ `
uniform float uGain; varying vec3 vCol; varying float vI;
void main(){
  float d = length(gl_PointCoord - 0.5) * 2.;
  float core = smoothstep(1., 0., d);
  float a = core * core;                       // soft round falloff
  if (a < 0.003) discard;
  gl_FragColor = vec4(vCol * vI * a * uGain, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const MW_VERT = /* glsl */ `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const MW_FRAG = /* glsl */ `
uniform sampler2D map; uniform vec3 gc; uniform vec3 gy; uniform vec3 ngp; uniform float uInt; uniform float uSat; uniform vec2 uTexel;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);                         // equatorial direction (sphere is in sky-local space)
  float l = atan(dot(d, gy), dot(d, gc));            // galactic longitude
  float b = asin(clamp(dot(d, ngp), -1., 1.));       // galactic latitude
  vec2 uv = vec2(0.5 - l / 6.28318530718, 0.5 + b / 3.14159265359);
  // 5-tap soften (the panorama is magnified ~2x at 1440px wide); sampler decodes sRGB to linear
  vec2 e = uTexel * 1.2;
  vec3 c = (texture2D(map, uv).rgb * 2. + texture2D(map, uv + vec2(e.x, 0.)).rgb + texture2D(map, uv - vec2(e.x, 0.)).rgb
          + texture2D(map, uv + vec2(0., e.y)).rgb + texture2D(map, uv - vec2(0., e.y)).rgb) / 6.;
  float y = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(y), c, uSat);                         // slightly desaturated
  c = pow(c, vec3(1.15)) * uInt;                     // gentle toe so the dark sky stays dark
  gl_FragColor = vec4(c, 1.);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export async function createSky({
  THREE, scene, assetBase = '.',
  rotation = null,          // THREE.Quaternion, THREE.Euler, or [x, y, z] radians; null = opening-shot default
  milkyWay = true,          // set false to skip the panorama
  milkyWayIntensity = 0.30, // linear gain on the panorama
  starGain = 1.0,           // global star brightness
  pixelRatio = null,        // defaults to min(devicePixelRatio, 2)
} = {}) {
  const V = THREE.Vector3;
  const group = new THREE.Group(); group.name = 'sky'; group.frustumCulled = false;
  if (rotation && rotation.isQuaternion) group.quaternion.copy(rotation);
  else if (rotation && rotation.isEuler) group.setRotationFromEuler(rotation);
  else if (Array.isArray(rotation)) group.rotation.set(rotation[0], rotation[1], rotation[2]);
  else group.quaternion.copy(defaultQuaternion(THREE));

  // ---- stars ----
  const buf = await (await fetch(`${assetBase}/stars.bin`)).arrayBuffer();
  const f = new Float32Array(buf), n = f.length / 5;
  const pos = new Float32Array(n * 3), mag = new Float32Array(n), bv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pos[i * 3] = f[i * 5] * R_SKY; pos[i * 3 + 1] = f[i * 5 + 1] * R_SKY; pos[i * 3 + 2] = f[i * 5 + 2] * R_SKY;
    mag[i] = f[i * 5 + 3]; bv[i] = f[i * 5 + 4];
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aMag', new THREE.BufferAttribute(mag, 1));
  g.setAttribute('aBV', new THREE.BufferAttribute(bv, 1));
  const starMat = new THREE.ShaderMaterial({
    vertexShader: STAR_VERT, fragmentShader: STAR_FRAG,
    uniforms: { uPx: { value: pixelRatio || Math.min(window.devicePixelRatio || 1, 2) }, uGain: { value: starGain } },
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: true, fog: false,
  });
  const stars = new THREE.Points(g, starMat);
  stars.frustumCulled = false; stars.renderOrder = -9; stars.name = 'sky-stars';
  group.add(stars);

  // ---- Milky Way ----
  let mw = null;
  if (milkyWay) {
    const tex = await new Promise((res, rej) => new THREE.TextureLoader().load(`${assetBase}/milkyway.webp`, res, undefined, rej)).catch(() => null);
    if (tex) {
      tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; tex.wrapS = THREE.RepeatWrapping;
      const Ngp = eq(192.85948, 27.12825, V), Gc = eq(266.40499, -28.93617, V), Gy = new V().crossVectors(Ngp, Gc);
      const mat = new THREE.ShaderMaterial({
        vertexShader: MW_VERT, fragmentShader: MW_FRAG, side: THREE.BackSide,
        uniforms: { map: { value: tex }, gc: { value: Gc }, gy: { value: Gy }, ngp: { value: Ngp }, uInt: { value: milkyWayIntensity }, uSat: { value: 0.8 }, uTexel: { value: new THREE.Vector2(1 / tex.image.width, 1 / tex.image.height) } },
        depthWrite: false, depthTest: false, fog: false,
      });
      mw = new THREE.Mesh(new THREE.SphereGeometry(R_SKY * 0.99, 64, 32), mat);
      mw.frustumCulled = false; mw.renderOrder = -10; mw.name = 'sky-milkyway';
      group.add(mw);
    }
  }

  scene.add(group);
  // the group rides the camera so everything stays at infinity
  const update = (camPos) => { group.position.copy(camPos); };
  return { group, stars, milkyWay: mw, update, starCount: n, starMaterial: starMat };
}
