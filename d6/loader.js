// D6 loader: extruded TerraFirma mark spinning inside the HUD ring, dot lines run out from the centre, then it all dissolves.
// The static ring, grid, flat mark and label are in the Webflow markup so they paint before any script arrives.
import { SVGLoader } from 'three/addons/loaders/SVGLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const MARK = 'M49.499 20C49.827 21.6155 50 23.2876 50 25C50 38.8071 38.8034 50 24.9922 50C11.46 50 0.439992 39.2541 0 25.833H3.89258C4.09805 31.1592 6.26829 36.1375 10.0596 39.9277C14.0481 43.9151 19.3516 46.1113 24.9922 46.1113C30.6328 46.1113 35.9363 43.9151 39.9248 39.9277C43.9132 35.9404 46.1094 30.6389 46.1094 25C46.1094 23.2932 45.9069 21.6178 45.5156 20H49.499ZM36.1064 23.8887H30.4971C29.9076 23.8887 29.3426 24.1233 28.9258 24.54L24.6709 28.7939C24.2541 29.2107 24.0195 29.7759 24.0195 30.3652V41.1113H20.1299V28.0557L28.1875 20H36.1064V23.8887ZM36.1074 29.7217H30.9668C30.353 29.7217 29.8555 30.2194 29.8555 30.833V41.1104H25.9648V31.1982C25.9648 30.6089 26.1994 30.0437 26.6162 29.627L29.7598 26.4834C30.1767 26.0669 30.7427 25.833 31.332 25.833H36.1074V29.7217ZM25.9648 20L22.0742 23.8887H0.0107422C0.0688231 22.5632 0.228624 21.2641 0.485352 20H25.9648ZM24.9922 0C34.133 6.27584e-06 42.1271 4.90405 46.4893 12.2227H41.8047C41.231 11.4714 40.6048 10.7519 39.9248 10.0723C35.9363 6.08491 30.6328 3.88868 24.9922 3.88867C19.3516 3.88867 14.0481 6.0849 10.0596 10.0723C7.76969 12.3615 6.07198 15.0849 5.04004 18.0557H0.962891C3.97323 7.62733 13.5914 0 24.9922 0ZM47.5361 14.167C48.1346 15.4094 48.6329 16.7095 49.0215 18.0557H14.5723V14.167H47.5361Z';

// three.js mark in el; returns { spin(), exit(tl, at), dispose() } or null when WebGL is unavailable
function createMark3D(THREE, el) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' }); } catch (e) { return null; }
  const size = () => [el.clientWidth || 160, el.clientHeight || 160];
  const [w, h] = size();
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(w, h, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer), envRT = pmrem.fromScene(new RoomEnvironment(renderer), 0.04);
  scene.environment = envRT.texture;
  // world units = CSS px of the host: the 50 unit mark renders at 50 px
  const cam = new THREE.PerspectiveCamera(30, w / h, 10, 1000);
  cam.position.z = (h / 2) / Math.tan(THREE.MathUtils.degToRad(15));
  const shapes = new SVGLoader().parse(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><path d="${MARK}"/></svg>`).paths.flatMap(p => SVGLoader.createShapes(p));
  const geo = new THREE.ExtrudeGeometry(shapes, { depth: 5, bevelEnabled: true, bevelThickness: 0.9, bevelSize: 0.45, bevelSegments: 3, curveSegments: 28 });
  geo.translate(-25, -25, -2.5);
  const mat = new THREE.MeshStandardMaterial({ color: 0xf4f6fa, metalness: 0.55, roughness: 0.26, envMapIntensity: 1.1 });
  const mesh = new THREE.Mesh(geo, mat); mesh.scale.y = -1; // SVG is y down
  const pivot = new THREE.Group(); pivot.add(mesh); scene.add(pivot);
  const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(0.4, 0.6, 1); scene.add(key);
  const rim = new THREE.DirectionalLight(0x9fe3ff, 5); rim.position.set(-1.2, 0.4, -0.9); scene.add(rim);
  const rim2 = new THREE.DirectionalLight(0xffffff, 3); rim2.position.set(1.3, -0.2, -0.7); scene.add(rim2);
  const draw = () => renderer.render(scene, cam);
  let raf = 0, live = true;
  const loop = () => { if (!live) return; draw(); raf = requestAnimationFrame(loop); };
  renderer.compile(scene, cam); draw(); loop();
  return {
    pivot,
    dispose() {
      live = false; cancelAnimationFrame(raf);
      geo.dispose(); mat.dispose(); envRT.dispose(); pmrem.dispose();
      renderer.dispose(); renderer.forceContextLoss?.(); renderer.domElement.remove();
    },
  };
}

// el: .d6-loader. Returns { gate(promise), done: Promise } ; done resolves once the loader has dissolved and been removed.
export function runLoader({ THREE, el, reduced = false, minMs = 1200, maxMs = 2000, onExit }) {
  const gsap = window.gsap;
  const t0 = performance.now(); // module arrival; navigation start is 0
  el.style.animation = 'none'; // cancel the CSS failsafe, JS owns the exit now
  const q = s => el.querySelector(s);
  const ring = q('.d6-ld-ring'), flat = q('.d6-ld-mark'), host = q('.d6-ld-3d'), label = q('.d6-ld-text');
  const lines = [...el.querySelectorAll('.d6-ld-line')], caps = [...el.querySelectorAll('.d6-ld-cap')];
  const dotsL = q('.d6-ld-line-l .d6-ld-dots'), dotsR = q('.d6-ld-line-r .d6-ld-dots');
  let mark = null;
  if (!reduced && THREE) { mark = createMark3D(THREE, host); if (mark) flat.style.opacity = '0'; }

  const intro = gsap.timeline();
  if (!reduced) {
    // dots run out from the ring; ring ticks turn in; mark does one fast spin and settles
    intro.fromTo(dotsL, { clipPath: 'inset(0 0 0 100%)' }, { clipPath: 'inset(0 0 0 0%)', duration: 0.9, ease: 'power3.out' }, 0.05)
      .fromTo(dotsR, { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: 0.9, ease: 'power3.out' }, 0.05)
      .from(caps, { opacity: 0, duration: 0.3 }, 0.6)
      .from(ring, { rotate: -50, scale: 0.86, opacity: 0, duration: 0.9, ease: 'expo.out' }, 0)
      .from(label, { opacity: 0, duration: 0.3 }, 0.1)
      .to(label, { opacity: 0.35, duration: 0.25, repeat: -1, yoyo: true, ease: 'steps(1)' }, 0.5);
    if (mark) intro.fromTo(mark.pivot.rotation, { y: -Math.PI * 2 - 0.5, x: 0.25 }, { y: 0, x: 0, duration: 1.15, ease: 'expo.out' }, 0)
      .fromTo(mark.pivot.scale, { x: 0.7, y: 0.7, z: 0.7 }, { x: 1, y: 1, z: 1, duration: 0.8, ease: 'back.out(1.6)' }, 0);
    else intro.from(flat, { rotateY: -360, duration: 1.1, ease: 'expo.out' }, 0);
  }
  // deadlines resolve from a timer, from rAF, or from a check() after any gate settles: a long sync task (hero build) can
  // starve setTimeout, so the cap is also judged right after the gates and on every frame
  const checks = [];
  const deadline = at => new Promise(r => {
    let done = false, raf = 0;
    const hit = () => { if (done || performance.now() < at) return false; done = true; cancelAnimationFrame(raf); r(); return true; };
    const tick = () => { if (!hit()) raf = requestAnimationFrame(tick); };
    setTimeout(hit, Math.max(0, at - performance.now())); raf = requestAnimationFrame(tick); checks.push(hit);
  });
  const check = () => checks.forEach(f => f());
  // the minimum also leaves the spin time to land when the script arrives late
  const minP = deadline(Math.max(minMs, reduced ? 0 : t0 + 900));
  const maxP = deadline(Math.max(maxMs, t0 + (reduced ? 300 : 1100)));
  let gates = [];
  const done = new Promise(resolve => {
    // gate() promises are collected before the next microtask settles; give callers one tick to add them
    Promise.resolve().then(() => Promise.race([Promise.all([minP, ...gates]), maxP])).then(() => {
      // the mark's WebGL context goes as soon as it has faded, so it never overlaps the hero renderer for long
      const killMark = () => { if (mark) { mark.dispose(); mark = null; } };
      const out = gsap.timeline({ onComplete: () => { intro.kill(); killMark(); el.remove(); resolve(); } });
      if (reduced) out.to(el, { opacity: 0, duration: 0.35 });
      else {
        out.to(label, { opacity: 0, duration: 0.2 }, 0)
          .to(dotsL, { clipPath: 'inset(0 0 0 100%)', duration: 0.55, ease: 'power3.in' }, 0)
          .to(dotsR, { clipPath: 'inset(0 100% 0 0)', duration: 0.55, ease: 'power3.in' }, 0)
          .to(caps, { opacity: 0, duration: 0.3 }, 0.1)
          .to(ring, { scale: 1.6, rotate: 30, opacity: 0, duration: 0.8, ease: 'power3.in' }, 0.05)
          .to(mark ? host : flat, { scale: 0.4, opacity: 0, duration: 0.55, ease: 'power3.in' }, 0.25)
          .to(el, { opacity: 0, duration: 0.6, ease: 'power2.inOut' }, 0.5);
        if (mark) out.to(mark.pivot.rotation, { y: Math.PI * 0.9, duration: 0.8, ease: 'power3.in' }, 0.05).call(killMark, null, 0.86);
      }
      onExit?.(out);
    });
  });
  return { gate: p => gates.push(p.catch(() => {}).then(v => { check(); return v; })), done };
}
