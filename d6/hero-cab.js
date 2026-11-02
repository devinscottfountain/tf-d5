// D6 hero: the dozer cab camera feed on the centre monitor. A small daylight scene (dirt with track furrows,
// tree line, hazy sky, cab pillars, seat, joysticks, side display, yellow blade arms) rendered into a target.
import { NOISE } from './hero-glsl.js';

export function createCab({ THREE, high }) {
  const W = high ? 1024 : 640, H = Math.round(W / 1.8);
  const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: high ? 4 : 0 });
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
        vec3 c=mix(vec3(2.1,2.15,2.2), vec3(.75,1.05,1.65), smoothstep(.0,.35,e));
        c+=vec3(.5,.45,.35)*exp(-abs(e)*18.);
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
        vec3 dirt=mix(vec3(.62,.44,.27), vec3(.78,.6,.4), n1);
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
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.2); sun.position.set(-30, 50, -40); scene.add(sun);
  scene.add(new THREE.HemisphereLight(0xcfe0ff, 0x9a7650, 1.3));

  // cab interior + machine parts (static relative to the camera)
  const S = (c, r = 0.7, m = 0) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
  const frame = S(0x2a2c2f, 0.6), seat = S(0x45484c, 0.9), black = S(0x0d0e10, 0.5), yellow = S(0xe0a412, 0.45), trim = S(0x5a5d61, 0.55);
  const box = (m, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.rotation.set(rx, ry, rz); scene.add(o); return o; };
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
  { const g = new THREE.Group(); g.position.set(0, 1.45, 0.12); scene.add(g);
    const sh = new THREE.Shape(); sh.moveTo(-0.3, -0.4); sh.lineTo(0.3, -0.4); sh.quadraticCurveTo(0.34, 0.25, 0.22, 0.42); sh.lineTo(-0.22, 0.42); sh.quadraticCurveTo(-0.34, 0.25, -0.3, -0.4);
    const back = new THREE.Mesh(new THREE.ExtrudeGeometry(sh, { depth: 0.16, bevelEnabled: true, bevelSize: 0.04, bevelThickness: 0.04, bevelSegments: 2 }), seat); back.position.z = -0.08; g.add(back);
    const hr = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.14), seat); hr.position.set(0, 0.6, 0); g.add(hr);
    const logo = new THREE.Mesh(new THREE.CircleGeometry(0.06, 16), trim); logo.position.set(0, 0.2, -0.14); logo.rotation.y = Math.PI; g.add(logo); }
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
  // machine outside: hood, blade lift arms, blade
  box(yellow, 0.95, 0.5, 2.3, 0, 1.15, -2.4);
  for (const s of [-1, 1]) {
    const a = new THREE.Vector3(s * 0.62, 1.55, -1.9), b = new THREE.Vector3(s * 0.85, 0.65, -3.75), m = a.clone().add(b).multiplyScalar(0.5);
    const cy = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, a.distanceTo(b), 12), yellow); cy.position.copy(m); cy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); scene.add(cy);
    box(yellow, 0.12, 0.18, 2.4, s * 1.25, 0.55, -2.6);                                     // push arms
  }
  box(yellow, 3.3, 1.0, 0.18, 0, 0.6, -3.95, -0.15, 0, 0);                                 // blade
  box(S(0x8a6a40, 1), 3.2, 0.5, 0.9, 0, 0.18, -4.4);                                       // dirt rolling off the blade

  function update(t) { U.time.value = t; U.drive.value = t * 0.9; cam.position.y = 2.42 + Math.sin(t * 7.1) * 0.004 + Math.sin(t * 2.3) * 0.006; }
  function render(renderer) {
    const old = renderer.getRenderTarget(); renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, cam); renderer.setRenderTarget(old);
  }
  return { scene, cam, rt, texture: rt.texture, update, render, dispose() { rt.dispose(); scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); dispTex.dispose(); } };
}
