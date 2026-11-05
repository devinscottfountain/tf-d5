// D6 hero: the dozer cab camera feed on the centre monitor. A small daylight scene (dirt with track furrows,
// tree line, hazy sky, cab pillars, seat, joysticks, side display, yellow blade arms) rendered into a target.
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { NOISE } from './hero-glsl.js';

export function createCab({ THREE, high, samples = high ? 4 : 0 }) {
  const W = high ? 1024 : 640, H = Math.round(W / 1.8);
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples });
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(64, W / H, 0.05, 900);
  cam.position.set(0, 2.42, 0.95); cam.lookAt(0, 1.05, -6);
  const U = { time: { value: 0 }, drive: { value: 0 } };

  // sky + tree line in one backdrop sphere
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, uniforms: U,
    vertexShader: `varying vec3 vD; void main(){ vD=normalize(position); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `${NOISE} varying vec3 vD;
      void main(){ float e=vD.y, az=atan(vD.x,-vD.z);
        vec3 c=mix(vec3(1.25,1.3,1.38), vec3(.5,.72,1.2), smoothstep(.0,.35,e));
        c+=vec3(.25,.22,.17)*exp(-abs(e)*18.);
        float tree=.012+.028*fbm2(vec2(az*9.,1.))+.012*vn2(vec2(az*60.,3.));            // tree line silhouette
        float t=step(e,tree)*step(-.01,e);
        c=mix(c, vec3(.16,.2,.12)*(.7+.6*vn2(vec2(az*80.,e*200.))), t);
        gl_FragColor=vec4(c,1.); }`
  }));
  scene.add(sky);

  // ground: sunlit dirt with parallel furrows, scrolling under the dozer
  const gm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95 });
  gm.onBeforeCompile = sh => {
    sh.uniforms.drive = U.drive;
    sh.vertexShader = 'varying vec3 vW;\n' + sh.vertexShader.replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvW=(modelMatrix*vec4(transformed,1.)).xyz;');
    sh.fragmentShader = 'uniform float drive; varying vec3 vW;\n' + NOISE + sh.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 gp=vec2(vW.x, vW.z-drive);
        float fur=.5+.5*sin(gp.x*7.5+fbm2(gp*.4)*2.);                                 // track furrows along the travel
        float n1=fbm2(gp*.5), n2=vn2(gp*6.), n3=vn2(gp*22.);
        vec3 dirt=mix(vec3(.7,.47,.27), vec3(.84,.62,.4), n1);
        dirt*=.82+.25*fur+.12*(n2-.5)+.08*(n3-.5);
        dirt=mix(dirt, vec3(.45,.3,.18), smoothstep(.6,.85,fbm2(gp*.15+4.))*.5);
        diffuseColor.rgb=dirt; float bh=fur*.06+n2*.04+n3*.015;`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec3 sp=-vViewPosition, sx=dFdx(sp), sy=dFdy(sp), r1=cross(sy,normal), r2=cross(normal,sx); float det=dot(sx,r1);
          vec2 dh=vec2(dFdx(bh),dFdy(bh))*2.; normal=normalize(abs(det)*normal-sign(det)*(dh.x*r1+dh.y*r2)); }`);
  };
  gm.customProgramCacheKey = () => 'd6cab-ground';
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), gm); scene.add(ground);

  // light
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.2); sun.target.position.set(0, 1.5, -1); sun.position.set(-30, 50, -40).normalize().multiplyScalar(20).add(sun.target.position); scene.add(sun, sun.target);
  if (high) { sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024); Object.assign(sun.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 45 }); sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02; }
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x9a7650, 1.3));

  // cab interior + machine parts (static relative to the camera)
  const S = (c, r = 0.7, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const frame = S(0x2a2c2f, 0.6), seat = S(0x45484c, 0.9), black = S(0x0d0e10, 0.5), yellow = S(0xe0a412, 0.45), trim = S(0x5a5d61, 0.55);
  const box = (m, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(w, h, d) * 0.3), m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); scene.add(o); return o; };
  // window frame
  for (const s of [-1, 1]) {
    box(frame, 0.13, 2.4, 0.14, s * 0.92, 1.95, -0.95, 0, 0, s * 0.06);                 // A pillars
    box(frame, 0.1, 2.2, 0.1, s * 0.98, 1.9, 0.25);                                       // B pillars
    box(frame, 0.08, 0.06, 1.25, s * 0.97, 1.42, -0.35);                                  // door rail
  }
  box(frame, 2.2, 0.3, 1.5, 0, 3.0, -0.3);                                                 // roof
  box(trim, 1.1, 0.18, 0.3, 0, 2.78, -0.82);                                               // overhead console
  for (let i = 0; i < 4; i++) box(black, 0.16, 0.08, 0.02, -0.36 + i * 0.24, 2.79, -0.66);
  box(frame, 0.09, 1.35, 0.09, 0, 2.15, -1.02);                                            // centre mullion
  box(black, 0.34, 0.2, 0.1, 0, 2.55, -0.98);                                              // display at the mullion head
  box(frame, 2.0, 0.42, 0.5, 0, 1.08, -1.05);                                              // dash
  // seat, armrests, joysticks
  { const g = new THREE.Group(); g.position.set(0, 1.45, 0.12); scene.add(g); // seat: bolstered back, headrest, cushion
    const rb = (w, h, d, r, x, y, z, m = seat, rx = 0) => { const o = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, r), m); o.position.set(x, y, z); o.rotation.x = rx; g.add(o); return o; };
    rb(0.5, 0.78, 0.16, 0.07, 0, 0.02, 0, seat, -0.12);
    for (const s of [-1, 1]) rb(0.1, 0.62, 0.2, 0.045, s * 0.26, -0.02, -0.03, seat, -0.12);
    rb(0.36, 0.22, 0.14, 0.06, 0, 0.56, 0.05, seat, -0.1);
    rb(0.56, 0.12, 0.5, 0.05, 0, -0.42, -0.24);
    rb(0.08, 0.25, 0.04, 0.02, 0, 0.42, 0.06, trim);
    const logo = new THREE.Mesh(new THREE.CircleGeometry(0.055, 20), trim); logo.position.set(0, 0.18, -0.1); logo.rotation.set(-0.12, Math.PI, 0); g.add(logo); }
  for (const s of [-1, 1]) {
    box(black, 0.24, 0.12, 0.5, s * 0.5, 1.25, -0.05);
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.03, 0.22, 10), black); st.position.set(s * 0.5, 1.42, -0.18); st.rotation.x = -0.3; scene.add(st);
    const kn = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 8), black); kn.position.set(s * 0.5, 1.53, -0.22); kn.scale.set(1, 1.4, 1); scene.add(kn);
  }
  // side display on an arm
  const dispTex = (() => { const c = document.createElement('canvas'); c.width = 256; c.height = 192; const x = c.getContext('2d');
    x.fillStyle = '#0a1a2c'; x.fillRect(0, 0, 256, 192); x.fillStyle = '#2a8ef0'; x.fillRect(10, 10, 236, 26);
    for (let i = 0; i < 5; i++) { x.fillStyle = i % 2 ? '#1c3b5c' : '#15304d'; x.fillRect(10, 46 + i * 28, 150, 20); x.fillStyle = '#3dd68c'; x.fillRect(170, 46 + i * 28, 76, 20); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  box(black, 0.36, 0.28, 0.05, 0.66, 1.78, -0.62, 0, -0.55, 0);
  { const d = new THREE.Mesh(new THREE.PlaneGeometry(0.31, 0.23), new THREE.MeshBasicMaterial({ map: dispTex, color: new THREE.Color(1.6, 1.6, 1.6) }));
    d.position.set(0.66 + Math.sin(-0.55) * 0.027, 1.78, -0.62 + Math.cos(-0.55) * 0.027); d.rotation.y = -0.55; scene.add(d); }
  box(black, 0.05, 0.05, 0.4, 0.8, 1.7, -0.45);
  // machine outside: hood (grille, exhaust, precleaner), lift rams, push arms, curved blade with cutting edge, dirt windrow
  const chrome = S(0xd8d8d4, 0.18, 1), steel = S(0x6f6a62, 0.5, 0.7), dirtM = S(0x8a6a40, 1);
  const rod = (m, a, b, r, seg = 12) => { const A = new THREE.Vector3(...a), Bv = new THREE.Vector3(...b), o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, A.distanceTo(Bv), seg), m);
    o.position.copy(A).add(Bv).multiplyScalar(0.5); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), Bv.clone().sub(A).normalize()); scene.add(o); return o; };
  box(yellow, 0.95, 0.5, 2.3, 0, 1.15, -2.4);
  for (let i = 0; i < 6; i++) box(black, 0.7, 0.02, 0.05, 0, 1.405, -2.9 - i * 0.12);                                  // top grille slats
  rod(trim, [0.22, 1.35, -1.85], [0.22, 1.95, -1.85], 0.06); rod(black, [-0.25, 1.38, -2.05], [-0.25, 1.62, -2.05], 0.085); // exhaust, precleaner
  rod(S(0x9fb0b8, 0.15, 0.2), [-0.25, 1.62, -2.05], [-0.25, 1.74, -2.05], 0.1);
  for (const s of [-1, 1]) {
    rod(S(0x2a2a28, 0.5), [s * 0.62, 1.55, -1.9], [s * 0.74, 1.05, -2.95], 0.095);                                       // lift ram barrel
    rod(chrome, [s * 0.74, 1.05, -2.95], [s * 0.85, 0.62, -3.78], 0.055);                                              // rod
    box(yellow, 0.14, 0.2, 2.5, s * 1.25, 0.52, -2.65);                                                               // push arms
    box(steel, 0.12, 0.6, 0.2, s * 1.62, 0.42, -3.95);                                                                // end bits
  }
  { const n = 8, BW = 3.3; let prev = null;                                                                           // moldboard: curved strip, back ribs, cutting edge
    for (let i = 0; i <= n; i++) { const a = i / n, p = new THREE.Vector3(0, 0.12 + a * 1.0, -3.92 - Math.sin(a * Math.PI) * 0.16 + a * 0.12);
      if (prev) { const d = p.clone().sub(prev), seg = new THREE.Mesh(new THREE.BoxGeometry(BW, d.length() + 0.02, 0.05), yellow); seg.position.copy(p).add(prev).multiplyScalar(0.5); seg.rotation.x = Math.atan2(-d.z, d.y) * -1; scene.add(seg); }
      prev = p; }
    box(yellow, BW, 0.08, 0.16, 0, 1.15, -3.82);                                                                     // top spill lip
    for (const x of [-1.1, -0.35, 0.35, 1.1]) box(S(0xc08a0c, 0.5), 0.05, 0.9, 0.2, x, 0.6, -3.82);                  // ribs behind
    box(steel, BW - 0.3, 0.14, 0.08, 0, 0.1, -3.97); }
  { const g = new THREE.PlaneGeometry(3.6, 1.6, 36, 16).rotateX(-Math.PI / 2), p = g.attributes.position;              // windrow rolling off the blade
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), u = z / 0.8; p.setY(i, Math.max(0, 0.55 * (1 - u * u)) * (0.75 + 0.25 * Math.sin(x * 5.3) * Math.sin(z * 7.1 + x)) + 0.03 * Math.sin(x * 23 + z * 17)); }
    g.computeVertexNormals(); const m = new THREE.Mesh(g, dirtM); m.position.set(0, 0, -4.75); scene.add(m); }

  // bake the static cab into one mesh per material (about 6 draws instead of 45); only the frame casts the sun shadow
  { scene.updateMatrixWorld(true); const by = new Map(), drop = [];
    scene.traverse(o => { if (!o.isMesh || o === sky || o === ground || o.material.map) return;
      const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(o.matrixWorld);
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
      (by.get(o.material) || by.set(o.material, []).get(o.material)).push(g); drop.push(o); });
    drop.forEach(o => { o.parent.remove(o); o.geometry.dispose(); });
    for (const [m, gs] of by) { const mesh = new THREE.Mesh(mergeGeometries(gs), m); mesh.castShadow = high && m === frame; mesh.receiveShadow = high; scene.add(mesh); gs.forEach(g => g.dispose()); } }
  ground.receiveShadow = high;
  function update(t) { U.time.value = t; U.drive.value = t * 0.9; cam.position.y = 2.42 + Math.sin(t * 7.1) * 0.004 + Math.sin(t * 2.3) * 0.006; }
  function render(renderer) {
    const old = renderer.getRenderTarget(); renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam); renderer.setRenderTarget(old);
  }
  return { scene, cam, rt, texture: rt.texture, update, render, dispose() { rt.dispose(); scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); dispTex.dispose(); } };
}
