// D6 hero: the three monitor feeds.
// Left: Mission Planner map (static canvas + a phase canvas that drives pulses along the haul routes).
// Centre: dozer cab camera (render target from hero-cab.js) + UI overlay, crossfading to the Series B still.
// Right: lidar heat map, procedural point cloud under a UI overlay.
// All screens invert the ACES tone map so the pixels land on the display as authored.
// Media hooks: setScreenMedia(i, el) puts real footage (<video>, <img>, <canvas>) on screen 0/1/2 (left/centre/right),
// cover-fit; textures stay raw sRGB bytes and are decoded in the shader (as the browser draws them, so the hand-off matches).
// Close up, an RGB stripe subpixel mask fades in (uSub), aliasing into a faint moire, then fades out before the hand-off.
import { NOISE, INV_ACES, acesInverseUniforms, rng } from './hero-glsl.js';

const MONO = '"IBM Plex Mono", ui-monospace, Menlo, monospace';
const SANS = 'Geist, Inter, system-ui, sans-serif';
const VS = `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.); }`;
// per-screen media + panel pixel mask (linear HDR in, linear HDR out)
const PANEL = /* glsl */ `
uniform sampler2D tMedia; uniform float uMedia, uSub; uniform vec4 uMCover; uniform vec2 uNpx;
vec3 media(){ return texture2D(tMedia, vUv*uMCover.xy+uMCover.zw).rgb; }
vec3 panel(vec3 lin){
  if(uSub<=0.) return lin;
  vec2 q=vUv*uNpx; float fw=max(fwidth(q.x),fwidth(q.y)), a=uSub*(1.-smoothstep(.3,.95,fw));
  if(a<=0.) return lin;
  float x=fract(q.x), y=fract(q.y), e=clamp(fw*.5,.02,.12);
  vec3 m=vec3(smoothstep(.15+e,.15-e,abs(x-.1667)), smoothstep(.15+e,.15-e,abs(x-.5)), smoothstep(.15+e,.15-e,abs(x-.8333)));
  float g=smoothstep(0.,.1+e,y)*smoothstep(1.,.9-e,y);
  return lin*mix(vec3(1.), m*g*3.6, a); }
`;

function cv(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function rr(x, X, Y, w, h, r) { x.beginPath(); x.roundRect ? x.roundRect(X, Y, w, h, r) : x.rect(X, Y, w, h); }
function panel(x, X, Y, w, h, o = {}) {
  rr(x, X, Y, w, h, o.r ?? 4); x.fillStyle = o.fill ?? 'rgba(14,18,25,0.94)'; x.fill();
  x.lineWidth = 1.5; x.strokeStyle = o.stroke ?? 'rgba(120,140,165,0.35)'; x.stroke();
}
function txt(x, s, X, Y, o = {}) { x.font = `${o.w ?? 500} ${o.s ?? 13}px ${o.f ?? MONO}`; x.fillStyle = o.c ?? '#b9c3cf'; x.textAlign = o.a ?? 'left'; x.textBaseline = 'middle'; x.fillText(s, X, Y); }
function rows(x, r, X, Y, w, n, step = 26) { // list rows: icon, label, coloured status chips
  const names = ['EX-01  Excavator', 'DZ-02  Dozer D6', 'DZ-03  Dozer 700', 'TR-04  Haul truck', 'RL-05  Roller', 'EX-06  Excavator', 'LD-07  Loader', 'TR-08  Haul truck', 'GR-09  Grader'];
  for (let i = 0; i < n; i++) {
    const y = Y + i * step;
    x.fillStyle = ['#2f7dff', '#25c3ff', '#7a5cff'][i % 3]; x.fillRect(X, y - 6, 12, 12);
    txt(x, names[i % names.length], X + 20, y, { s: 12, c: '#c9d2dc' });
    for (let k = 0; k < 2; k++) { x.fillStyle = r() < 0.7 ? '#2fd36b' : '#ff4a3a'; x.fillRect(X + w - 40 + k * 18, y - 6, 12, 12); }
  }
}
function toolbar(x, W, X0, accent = '#3aa0ff') {
  x.fillStyle = '#0c1118'; x.fillRect(X0, 0, W - X0, 44);
  for (let i = 0; i < 6; i++) { rr(x, X0 + 12 + i * 42, 9, 34, 26, 4); x.fillStyle = i === 0 ? accent : '#1a2330'; x.fill(); }
  rr(x, X0 + 300, 11, 260, 22, 3); x.fillStyle = '#e9eef3'; x.fill();
  txt(x, 'Site plan  /  Phase 2 grading', X0 + 312, 22, { s: 12, c: '#1a2028' });
  rr(x, W - 210, 8, 196, 28, 4); x.fillStyle = '#121a24'; x.fill(); x.strokeStyle = '#2f3b4a'; x.stroke();
  txt(x, 'MISSION PLANNER', W - 200, 22, { s: 11, c: '#8fc6ff' });
}

// ---------------------------------------------------------------- left: mission planner
function plannerCanvases(W, H) {
  const r = rng(11), [c, x] = cv(W, H), [cf, f] = cv(W, H);
  x.fillStyle = '#06080c'; x.fillRect(0, 0, W, H); f.fillStyle = '#000'; f.fillRect(0, 0, W, H);
  const sb = Math.round(W * 0.17);
  // sidebar
  panel(x, 8, 8, sb - 12, H * 0.34); txt(x, 'MISSION', 20, 26, { s: 11, c: '#7f8a96' });
  for (let i = 0; i < 4; i++) { txt(x, ['Zone A cut', 'Zone B fill', 'Haul loop 2', 'Pad 7 finish'][i], 20, 56 + i * 28, { s: 12, c: '#c9d2dc' }); x.fillStyle = '#1d2a3a'; x.fillRect(sb - 80, 47 + i * 28, 60, 16); txt(x, ['74%', '41%', 'LIVE', '12%'][i], sb - 50, 56 + i * 28, { s: 10, c: '#8fd0ff', a: 'center' }); }
  panel(x, 8, H * 0.34 + 6, sb - 12, H * 0.42); txt(x, 'ASSETS', 20, H * 0.34 + 24, { s: 11, c: '#7f8a96' });
  rows(x, r, 20, H * 0.34 + 52, sb - 32, 9, 27);
  panel(x, 8, H * 0.76 + 10, sb - 12, H * 0.24 - 18); txt(x, 'VOLUMES', 20, H * 0.76 + 28, { s: 11, c: '#7f8a96' });
  for (let i = 0; i < 4; i++) { const w = (sb - 60) * (0.3 + r() * 0.65); x.fillStyle = ['#e8c400', '#ff4a3a', '#2fd36b', '#5fe0ff'][i]; x.fillRect(20, H * 0.76 + 46 + i * 22, w, 8); }
  toolbar(x, W, sb);
  // map
  const mx0 = sb + 4, my0 = 48, mx1 = W - 4, my1 = H - 4;
  x.save(); x.beginPath(); x.rect(mx0, my0, mx1 - mx0, my1 - my0); x.clip();
  x.fillStyle = '#0a0e15'; x.fillRect(mx0, my0, mx1 - mx0, my1 - my0);
  for (let i = 0; i < 260; i++) { const X = mx0 + r() * (mx1 - mx0), Y = my0 + r() * (my1 - my0), rad = 20 + r() * 90, g = x.createRadialGradient(X, Y, 0, X, Y, rad);
    g.addColorStop(0, `rgba(${30 + r() * 20},${38 + r() * 20},${55 + r() * 30},0.22)`); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(X - rad, Y - rad, rad * 2, rad * 2); }
  x.lineWidth = 1; // faint contours
  for (let i = 0; i < 46; i++) { x.strokeStyle = `rgba(110,130,160,${0.05 + r() * 0.06})`; x.beginPath(); let X = mx0 + r() * (mx1 - mx0), Y = my0 + r() * (my1 - my0), a = r() * 6.28;
    x.moveTo(X, Y); for (let k = 0; k < 40; k++) { a += (r() - 0.5) * 0.5; X += Math.cos(a) * 14; Y += Math.sin(a) * 14; x.lineTo(X, Y); } x.stroke(); }
  // yellow fill zones (left), speckled
  const blob = (X, Y, R, n = 14) => { x.beginPath(); for (let k = 0; k < n; k++) { const a = k / n * 6.283, rr2 = R * (0.55 + r() * 0.6); x[k ? 'lineTo' : 'moveTo'](X + Math.cos(a) * rr2 * 1.5, Y + Math.sin(a) * rr2); } x.closePath(); };
  for (const [X, Y, R] of [[mx0 + 170, my0 + 250, 70], [mx0 + 110, my0 + 330, 55], [mx0 + 260, my0 + 300, 40], [mx0 + 520, my0 + 560, 46], [mx0 + 600, my0 + 640, 38], [mx0 + 360, my0 + 210, 30]]) {
    blob(X, Y, R); x.fillStyle = '#d9b800'; x.fill();
    for (let k = 0; k < 120; k++) { x.fillStyle = r() < 0.5 ? 'rgba(10,12,16,0.55)' : 'rgba(255,230,60,0.6)'; x.fillRect(X + (r() - 0.5) * R * 3, Y + (r() - 0.5) * R * 2, 2 + r() * 4, 2 + r() * 3); }
  }
  // haul routes: random walks with long straights, drawn as double lanes; phase canvas gets cos/sin of distance along the route
  const cols = ['#ffd400', '#ffd400', '#ff3b30', '#ff3b30', '#2bd46a', '#2bd46a', '#c04cff', '#8f7bff', '#ff8a1f', '#ffd400', '#2bd46a', '#ff3b30', '#5fe0ff', '#ffd400'];
  cols.forEach((col, i) => {
    const pts = []; let X = mx0 + 80 + r() * (mx1 - mx0 - 160), Y = my0 + 60 + r() * (my1 - my0 - 120), a = r() * 6.283;
    for (let k = 0; k < 26; k++) { pts.push([X, Y]); a += (r() < 0.3 ? (r() - 0.5) * 1.6 : (r() - 0.5) * 0.25); const L = 20 + r() * 40; X += Math.cos(a) * L; Y += Math.sin(a) * L * 0.8;
      if (X < mx0 + 30 || X > mx1 - 30) a = Math.PI - a; if (Y < my0 + 30 || Y > my1 - 30) a = -a; X = Math.min(mx1 - 20, Math.max(mx0 + 20, X)); Y = Math.min(my1 - 20, Math.max(my0 + 20, Y)); }
    const lw = i < 2 ? 5 : 2.5 + r() * 1.5;
    for (const off of [0, lw + 2.5]) { x.strokeStyle = col; x.globalAlpha = off ? 0.55 : 1; x.lineWidth = lw; x.lineJoin = x.lineCap = 'round'; x.beginPath(); pts.forEach(([px, py], k) => x[k ? 'lineTo' : 'moveTo'](px + off, py + off * 0.6)); x.stroke(); }
    x.globalAlpha = 1;
    // phase strokes, 6 px pieces
    let d = 0; const per = 160, sp = 0.3 + r() * 0.7; f.lineWidth = lw + 3; f.lineCap = 'round';
    for (let k = 0; k < pts.length - 1; k++) {
      const [ax, ay] = pts[k], [bx, by] = pts[k + 1], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(L / 6));
      for (let j = 0; j < n; j++) { const ph = (d + (j + 0.5) * L / n) / per * 6.2832;
        f.strokeStyle = `rgb(${Math.round(127.5 + 127.5 * Math.cos(ph))},${Math.round(127.5 + 127.5 * Math.sin(ph))},${Math.round(80 + 175 * sp)})`;
        f.beginPath(); f.moveTo(ax + (bx - ax) * j / n, ay + (by - ay) * j / n); f.lineTo(ax + (bx - ax) * (j + 1) / n, ay + (by - ay) * (j + 1) / n); f.stroke(); }
      d += L;
    }
  });
  // cyan zones with corner handles
  for (let i = 0; i < 5; i++) {
    const X = mx0 + 120 + r() * (mx1 - mx0 - 240), Y = my0 + 80 + r() * (my1 - my0 - 160), n = 4 + Math.floor(r() * 3), pts = [];
    for (let k = 0; k < n; k++) { const a = k / n * 6.283 + r() * 0.5, R = 30 + r() * 50; pts.push([X + Math.cos(a) * R * 1.4, Y + Math.sin(a) * R]); }
    x.beginPath(); pts.forEach(([px, py], k) => x[k ? 'lineTo' : 'moveTo'](px, py)); x.closePath();
    x.fillStyle = 'rgba(70,200,255,0.22)'; x.fill(); x.strokeStyle = '#5fe0ff'; x.lineWidth = 2; x.stroke();
    f.beginPath(); pts.forEach(([px, py], k) => f[k ? 'lineTo' : 'moveTo'](px, py)); f.closePath(); f.fillStyle = 'rgb(128,128,40)'; f.fill(); // B=40: zone marker
    for (const [px, py] of pts) { x.fillStyle = '#e9fbff'; x.fillRect(px - 4, py - 4, 8, 8); }
  }
  // asset tags
  for (let i = 0; i < 9; i++) { const X = mx0 + 60 + r() * (mx1 - mx0 - 160), Y = my0 + 40 + r() * (my1 - my0 - 80);
    x.fillStyle = '#2f7dff'; x.fillRect(X, Y, 16, 16); x.fillStyle = '#d7e9ff'; x.fillRect(X + 4, Y + 4, 8, 8);
    if (r() < 0.6) { panel(x, X + 22, Y - 2, 88, 20, { r: 3, fill: 'rgba(10,14,20,0.9)' }); txt(x, ['EX-01', 'DZ-02', 'TR-04', 'RL-05', 'PAD 7'][i % 5] + ' ' + (r() * 99).toFixed(0), X + 30, Y + 8, { s: 11, c: '#dfe7ef' }); } }
  // mini panel bottom left of map + top right card
  panel(x, mx0 + 12, my1 - 120, 230, 108); txt(x, 'ROUTE  HAUL LOOP 2', mx0 + 24, my1 - 102, { s: 11, c: '#8fa0b2' });
  for (let i = 0; i < 3; i++) { txt(x, ['Cycle  04:12', 'Trucks  3', 'Load  86%'][i], mx0 + 24, my1 - 76 + i * 22, { s: 12, c: '#dfe7ef' }); }
  panel(x, mx1 - 190, my0 + 10, 178, 64); txt(x, 'Grading 2B', mx1 - 178, my0 + 28, { s: 12, c: '#dfe7ef' }); x.fillStyle = '#2fd36b'; x.fillRect(mx1 - 178, my0 + 46, 120, 10); x.fillStyle = '#1b2633'; x.fillRect(mx1 - 58, my0 + 46, 34, 10);
  x.restore();
  return { base: c, flow: cf };
}

// ---------------------------------------------------------------- right: lidar UI chrome (map area left transparent)
function lidarUI(W, H) {
  const r = rng(23), [c, x] = cv(W, H), sb = Math.round(W * 0.2);
  x.fillStyle = '#06080c'; x.fillRect(0, 0, sb, H);
  panel(x, 8, 8, sb - 12, H * 0.42); txt(x, 'SCANS', 20, 26, { s: 11, c: '#7f8a96' }); rows(x, r, 20, 54, sb - 32, 8, 28);
  panel(x, 8, H * 0.42 + 6, sb - 12, H * 0.3); txt(x, 'LAYER', 20, H * 0.42 + 24, { s: 11, c: '#7f8a96' });
  for (let i = 0; i < 3; i++) { rr(x, 20, H * 0.42 + 42 + i * 34, sb - 40, 26, 3); x.fillStyle = i === 0 ? '#1d6fd6' : '#141c27'; x.fill(); txt(x, ['Elevation', 'Cut / fill', 'Density'][i], 30, H * 0.42 + 55 + i * 34, { s: 12, c: '#e5edf5' }); }
  panel(x, 8, H * 0.72 + 12, sb - 12, H * 0.28 - 20); txt(x, 'ELEVATION  M', 20, H * 0.72 + 30, { s: 11, c: '#7f8a96' });
  const g = x.createLinearGradient(20, 0, sb - 20, 0);
  ['#0a1aa0', '#1e5aff', '#20e0ff', '#40ff60', '#ffe020', '#ff2a10'].forEach((cc, i) => g.addColorStop(i / 5, cc));
  x.fillStyle = g; x.fillRect(20, H * 0.72 + 48, sb - 40, 16);
  ['412', '418', '424', '430'].forEach((s, i) => txt(x, s, 20 + i * (sb - 52) / 3, H * 0.72 + 78, { s: 10, c: '#8fa0b2' }));
  toolbar(x, W, sb, '#1d6fd6');
  x.clearRect(sb, 44, W - sb, H - 44);
  // floating labels over the cloud
  for (const [u, v, s] of [[0.35, 0.3, 'STOCKPILE 3'], [0.62, 0.22, 'CUT 2.4 M'], [0.48, 0.55, 'HAUL RD'], [0.78, 0.48, 'POND'], [0.3, 0.7, 'PAD 7'], [0.7, 0.75, 'FILL 1.1 M']]) {
    const X = sb + u * (W - sb), Y = 44 + v * (H - 44);
    panel(x, X, Y, 14 + s.length * 8.2, 22, { r: 3, fill: 'rgba(240,244,248,0.92)', stroke: 'rgba(0,0,0,0.4)' }); txt(x, s, X + 7, Y + 11, { s: 11, c: '#0d1218' });
    x.strokeStyle = 'rgba(240,244,248,0.8)'; x.lineWidth = 1.5; x.beginPath(); x.moveTo(X + 8, Y + 22); x.lineTo(X + 8, Y + 40); x.stroke();
  }
  panel(x, W - 230, 56, 218, 70); txt(x, 'Survey  03:14 AM', W - 218, 76, { s: 12, c: '#dfe7ef' }); txt(x, '1.82M pts  |  0.04 m', W - 218, 102, { s: 11, c: '#8fa0b2' });
  return c;
}

// ---------------------------------------------------------------- centre: cab feed UI
function cabUI(W, H) {
  const [c, x] = cv(W, H), r = rng(5);
  const cw = W * 0.17;
  for (let i = 0; i < 5; i++) {
    const y = 16 + i * H * 0.12, h = H * 0.105; panel(x, 14, y, cw, h, { fill: 'rgba(12,16,22,0.9)' });
    txt(x, ['AUTONOMY', 'TASK  GRADE 2B', 'BLADE', 'TRACKS', 'LINK'][i], 26, y + 16, { s: 11, c: '#9fb0c2' });
    if (i === 0) { rr(x, 26, y + 30, cw * 0.55, 26, 3); x.fillStyle = '#26a3e8'; x.fill(); txt(x, 'ENGAGED', 36, y + 43, { s: 11, c: '#03121c' }); }
    else for (let k = 0; k < 2; k++) txt(x, ['Pitch  -1.2', 'Lift  0.42 m', 'Speed  3.1 km/h', 'RTT  84 ms'][(i + k) % 4], 26, y + 38 + k * 18, { s: 11, c: '#dfe7ef' });
  }
  const y5 = 16 + 5 * H * 0.12; panel(x, 14, y5, cw, H * 0.16, { fill: 'rgba(12,16,22,0.9)' });
  for (let k = 0; k < 2; k++) { rr(x, 24 + k * cw * 0.48, y5 + 14, cw * 0.44, 30, 3); x.fillStyle = ['#4fb6ef', '#3dd68c'][k]; x.fill(); }
  for (let k = 0; k < 2; k++) { rr(x, 24 + k * cw * 0.48, y5 + 52, cw * 0.44, 30, 3); x.fillStyle = ['#2b84c4', '#2fae74'][k]; x.fill(); }
  // compass gauge
  const gx = W * 0.3, gy = H * 0.72; panel(x, gx, gy, W * 0.13, H * 0.25, { fill: 'rgba(12,16,22,0.92)' });
  const cx = gx + W * 0.065, cy = gy + H * 0.13, R = H * 0.085;
  x.strokeStyle = '#4fb6ef'; x.lineWidth = 3; x.beginPath(); x.arc(cx, cy, R, 0, 6.283); x.stroke();
  for (let k = 0; k < 36; k++) { const a = k / 36 * 6.283; x.lineWidth = 1.5; x.strokeStyle = 'rgba(200,220,240,0.6)'; x.beginPath(); x.moveTo(cx + Math.cos(a) * R * 0.82, cy + Math.sin(a) * R * 0.82); x.lineTo(cx + Math.cos(a) * R * 0.92, cy + Math.sin(a) * R * 0.92); x.stroke(); }
  txt(x, '274', cx, cy, { s: 18, c: '#e9f3ff', a: 'center' }); txt(x, 'HEADING', cx, gy + 16, { s: 10, c: '#9fb0c2', a: 'center' });
  // right table
  const tx = W * 0.79, ty = H * 0.7; panel(x, tx, ty, W * 0.19, H * 0.27, { fill: 'rgba(12,16,22,0.92)' });
  for (let k = 0; k < 6; k++) { txt(x, ['Engine', 'Hydraulic', 'Fuel', 'Coolant', 'Track L', 'Track R'][k], tx + 12, ty + 20 + k * 24, { s: 11, c: '#b9c6d3' }); txt(x, ['OK', '2810 psi', '64%', '88 C', 'OK', 'OK'][k], tx + W * 0.18, ty + 20 + k * 24, { s: 11, c: k === 2 ? '#ffd166' : '#3dd68c', a: 'right' }); }
  // top status strip
  panel(x, W * 0.4, 10, W * 0.2, 30, { fill: 'rgba(12,16,22,0.85)' }); txt(x, 'DZ-03  LIVE  1080p', W * 0.5, 25, { s: 11, c: '#e5edf5', a: 'center' }); x.fillStyle = '#ff3b30'; x.beginPath(); x.arc(W * 0.41 + 8, 25, 5, 0, 6.283); x.fill();
  void r; return c;
}

export function createScreens({ THREE, renderer, high, stillUrl, cab }) {
  const panelU = () => ({ tMedia: { value: null }, uMedia: { value: 0 }, uSub: { value: 0 }, uMCover: { value: new THREE.Vector4(1, 1, 0, 0) }, uNpx: { value: new THREE.Vector2(1920, 1080) } });
  const SW = high ? 1600 : 1200, SH = Math.round(SW / 1.8);
  const tex = (c, srgb = true) => { const t = new THREE.CanvasTexture(c); t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; return t; };
  const aces = acesInverseUniforms(THREE);
  const time = { value: 0 };

  // left
  const pl = plannerCanvases(SW, SH);
  const left = new THREE.ShaderMaterial({
    uniforms: { ...aces, ...panelU(), time, tBase: { value: tex(pl.base) }, tFlow: { value: tex(pl.flow, false) }, uLevel: { value: 0.88 } },
    vertexShader: VS, fragmentShader: `${INV_ACES}
      uniform sampler2D tBase, tFlow; uniform float time, uLevel; varying vec2 vUv; ${PANEL}
      void main(){ vec3 c=texture2D(tBase,vUv).rgb; vec4 f=texture2D(tFlow,vUv);
        float ph=atan(f.y-.5,f.x-.5), spd=f.z;
        float route=step(.2,length(f.xy-.5))*step(.25,f.z);
        float pulse=pow(.5+.5*cos(ph-time*(1.5+3.*spd)),18.)*route;
        float zone=(1.-step(.2,length(f.xy-.5)))*step(.1,f.z)*(1.-step(.25,f.z));
        c=c*(1.+1.1*pulse)+pulse*.35+vec3(.05,.25,.35)*zone*(.5+.5*sin(time*1.7));
        c=mix(min(c,1.),media(),uMedia);
        gl_FragColor=vec4(panel(invACES(srgbDec(clamp(c,0.,1.))*uLevel)),1.); }`
  });

  // right
  const right = new THREE.ShaderMaterial({
    uniforms: { ...aces, ...panelU(), time, tUI: { value: tex(lidarUI(SW, SH)) }, uLevel: { value: 0.88 }, uMUI: { value: 0 } },
    vertexShader: VS, fragmentShader: `${INV_ACES}${NOISE}
      uniform sampler2D tUI; uniform float time, uLevel, uMUI; varying vec2 vUv; ${PANEL}
      vec3 ramp(float h){ h=clamp(h,0.,1.);
        vec3 a=vec3(.04,.1,.63), b=vec3(.12,.35,1.), c=vec3(.13,.88,1.), d=vec3(.25,1.,.38), e=vec3(1.,.88,.13), f=vec3(1.,.17,.06);
        return h<.2?mix(a,b,h/.2):h<.4?mix(b,c,(h-.2)/.2):h<.6?mix(c,d,(h-.4)/.2):h<.8?mix(d,e,(h-.6)/.2):mix(e,f,(h-.8)/.2); }
      float terr(vec2 g){ float h=fbm2(g*1.1+vec2(3.,7.))*1.25-.1;
        h+=.35*smoothstep(1.8,.0,g.y)*smoothstep(.4,.0,abs(g.x+.2)-.3);           // ridge near the top
        h-=.55*exp(-dot(g-vec2(.55,1.25),g-vec2(.55,1.25))*3.);                     // pond
        h-=.25*exp(-dot(g-vec2(-.5,1.6),g-vec2(-.5,1.6))*6.);
        return h; }
      void main(){
        vec4 ui=texture2D(tUI,vUv);
        vec2 a=vec2((vUv.x-.2)/.8, vUv.y/.95);
        vec3 col=vec3(.02,.025,.035);
        if(a.x>0. && a.y<1.){
          float dep=1./(.28+.72*a.y);                                   // oblique: top of the map is far away
          vec2 g=vec2((a.x-.5)*1.6*dep, dep*.9);
          float h=terr(g), hx=terr(g+vec2(.01,0.))-h, hy=terr(g+vec2(0.,.01))-h;
          float shade=clamp(.75-(hx*10.-hy*6.),.35,1.25);
          vec2 cell=g*70., id=floor(cell), j=vec2(hh21(id),hh21(id+5.3))*.6+.2;
          float d=length(fract(cell)-j), fw=fwidth(cell.x)*.8;
          float pt=1.-smoothstep(.28-fw,.28+fw,d);
          float scan=exp(-pow((g.y-mod(time*.35,3.)-.5)*5.,2.));
          vec3 pc=ramp(h)*shade*(1.+1.2*scan);
          col=mix(ramp(h)*.07, pc, pt*(.55+.45*hh21(id+1.7)));
          col*=smoothstep(0.,.08,a.x)*smoothstep(1.,.9,a.y);
        }
        col=mix(col, media(), uMedia);
        col=mix(col, ui.rgb, ui.a*(1.-uMedia*(1.-uMUI)));
        gl_FragColor=vec4(panel(invACES(srgbDec(clamp(col,0.,1.))*uLevel)),1.); }`
  });

  // centre: cab feed + UI, crossfading to the still. tStill is raw sRGB bytes (also used by the hand-off pass)
  const still = new THREE.Texture(); still.colorSpace = THREE.NoColorSpace; still.generateMipmaps = true; still.minFilter = THREE.LinearMipmapLinearFilter;
  const ui = tex(cabUI(SW, SH));
  const centre = new THREE.ShaderMaterial({
    uniforms: { ...aces, ...panelU(), time, tCab: { value: cab.texture }, tUI: { value: ui }, tStill: { value: still }, uMix: { value: 0 }, uUI: { value: 1 }, uLevel: { value: 0.95 },
      uCover: { value: new THREE.Vector4(1, 1, 0, 0) } },
    vertexShader: VS, fragmentShader: `${INV_ACES}
      uniform sampler2D tCab, tUI, tStill; uniform float time, uMix, uUI, uLevel; uniform vec4 uCover; varying vec2 vUv; ${PANEL}
      float hs(vec2 p){ return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
      void main(){
        vec3 cab=texture2D(tCab,vUv).rgb; cab=1.-exp(-cab*1.35);                        // the cab camera's own exposure
        cab=pow(cab,vec3(1./2.2));                                                      // to display (sRGB-ish) space
        vec2 q=vUv-.5; cab*=1.-.35*dot(q,q)*1.6;                                        // feed vignette
        cab+=(hs(floor(vUv*vec2(640.,360.))+fract(time*13.))-.5)*.025;                  // sensor noise
        cab=mix(cab, media(), uMedia);                                                  // real cab footage replaces the render
        vec4 ui=texture2D(tUI,vUv); vec3 feed=mix(cab, ui.rgb, ui.a*uUI);
        vec3 s=texture2D(tStill, vUv*uCover.xy+uCover.zw).rgb;
        vec3 c=mix(feed*uLevel, s, uMix);
        gl_FragColor=vec4(panel(invACES(srgbDec(clamp(c,0.,1.)))),1.); }`
  });
  [left, right, centre].forEach(m => { m.toneMapped = false; m.fog = false; });

  // still loading (Series B frame). Resolves even on error so the hero still boots.
  let stillAspect = 16 / 9;
  const loadStill = url => new Promise(res => {
    if (!url) { res(false); return; }
    const im = new Image(); im.crossOrigin = 'anonymous'; im.decoding = 'async';
    im.onload = () => { still.image = im; still.needsUpdate = true; stillAspect = im.naturalWidth / im.naturalHeight; res(true); };
    im.onerror = () => res(false); im.src = url;
  });
  const stillReady = loadStill(stillUrl);

  // cover fit of the still into a screen of aspect a (matches CSS object-fit: cover, centred)
  function cover(a, out, src = stillAspect) {
    if (a > src) out.set(1, src / a, 0, (1 - src / a) / 2); else out.set(a / src, 1, (1 - a / src) / 2, 0);
    return out;
  }
  const mats = [left, centre, right], aspects = [1.8, 1.8, 1.8], media = [null, null, null], owned = new Set();
  const elAspect = el => (el.videoWidth || el.naturalWidth || el.width || 16) / (el.videoHeight || el.naturalHeight || el.height || 9);
  function mediaTex(el) { // raw sRGB bytes (decoded in the shaders); video: no mipmaps
    const isV = el.tagName === 'VIDEO', t = isV ? new THREE.VideoTexture(el) : el.tagName === 'CANVAS' ? new THREE.CanvasTexture(el) : new THREE.Texture(el);
    t.colorSpace = THREE.NoColorSpace; t.generateMipmaps = !isV; t.minFilter = isV ? THREE.LinearFilter : THREE.LinearMipmapLinearFilter;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy()); t.needsUpdate = true; owned.add(t); return t;
  }
  const whenSized = (el, fn) => { if (el.tagName === 'VIDEO' && !el.videoWidth) el.addEventListener('loadedmetadata', fn, { once: true }); else if (el.tagName === 'IMG' && !el.naturalWidth) el.addEventListener('load', fn, { once: true }); };
  function fitMedia(i) { const m = media[i]; if (m) cover(aspects[i], mats[i].uniforms.uMCover.value, elAspect(m.el)); }
  // screen i (0 left, 1 centre cab feed, 2 right) shows el, cover-fit; null restores the procedural feed. opts.ui keeps the UI overlay on top.
  function setScreenMedia(i, el, opts = {}) {
    const m = mats[i]; if (!m) return null;
    const prev = media[i]; if (prev && prev.tex !== stillTexCur()) { prev.tex.dispose(); owned.delete(prev.tex); }
    if (!el) { media[i] = null; m.uniforms.uMedia.value = 0; m.uniforms.tMedia.value = null; return null; }
    const t = mediaTex(el); media[i] = { el, tex: t }; m.uniforms.tMedia.value = t; m.uniforms.uMedia.value = 1;
    if (i === 1) m.uniforms.uUI.value = opts.ui ? 1 : 0; if (i === 2) m.uniforms.uMUI.value = opts.ui ? 1 : 0;
    if (opts.level !== undefined) m.uniforms.uLevel.value = opts.level;
    fitMedia(i); whenSized(el, () => fitMedia(i)); return t;
  }
  const stillTexCur = () => centre.uniforms.tStill.value;
  function setMedia(el) { // swap the Series B still (centre, end of the move; also what the hand-off pass composites) for a <video> or image
    const old = stillTexCur(); const t = mediaTex(el); centre.uniforms.tStill.value = t;
    if (old !== still && owned.has(old)) { old.dispose(); owned.delete(old); }
    stillAspect = elAspect(el); whenSized(el, () => { stillAspect = elAspect(el); onAspect?.(); }); return t;
  }
  let onAspect = null;

  return {
    left, right, centre, still, time, stillReady, cover, setMedia, setScreenMedia, mats,
    get stillTex() { return centre.uniforms.tStill.value; }, get stillAspect() { return stillAspect; },
    get cabLive() { return !media[1]; },                                   // false once real footage replaces the cab render
    set onAspect(fn) { onAspect = fn; },
    // physical aspect (w/h) and panel resolution of each screen, for cover fit and the pixel mask
    setScreen(i, aspect, npx) { aspects[i] = aspect; if (npx) mats[i].uniforms.uNpx.value.set(npx, Math.round(npx / aspect)); fitMedia(i); },
    setSubpixel(v) { for (const m of mats) m.uniforms.uSub.value = v; },
    setLevels(l, c, r) { left.uniforms.uLevel.value = l; centre.uniforms.uLevel.value = c; right.uniforms.uLevel.value = r; },
    setExposure(e) { aces.uExp.value = e; },
    dispose() { owned.forEach(t => t.dispose()); [left, right, centre].forEach(m => { for (const k in m.uniforms) { const v = m.uniforms[k].value; if (v && v.isTexture && v !== cab.texture) v.dispose(); } m.dispose(); }); }
  };
}
