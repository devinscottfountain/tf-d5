// TerraFirma D6 page layer: loader, nav + rail, hero zoom into the Series B card, mission, solutions driver, lazy D5 Mars.
// Hosted on jsDelivr next to solutions.js and ../d5; the Webflow page only loads this file (importmap for three in the head).
import * as THREE from 'three';
import { runLoader } from './loader.js';

const q = (s, r = document) => r.querySelector(s), qa = (s, r = document) => [...r.querySelectorAll(s)];
const page = q('.d6-page');
const gsap = window.gsap, ST = window.ScrollTrigger, Split = window.SplitText;
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const mobile = () => innerWidth < 768;
const smooth = () => (typeof lenis !== 'undefined' ? lenis : window.lenis) || null; // the site head declares a global lenis
const clamp01 = v => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2); // cubic in-out
const sstep = (a, b, v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
// DOM writes only on change
const css = (el, k, v) => { const c = el._d6 || (el._d6 = {}); if (c[k] !== v) { c[k] = v; el.style[k] = v; } };
const txt = (el, v) => { if (el._d6t !== v) { el._d6t = v; el.textContent = v; } };
const QUALITY = (() => {
  const o = new URLSearchParams(location.search).get('q'); if (o === 'low' || o === 'high') return o;
  const coarse = matchMedia('(pointer: coarse)').matches;
  return (coarse && Math.min(screen.width, screen.height) < 820) || (navigator.hardwareConcurrency || 8) <= 2 ? 'low' : 'high';
})();
const D6 = (window.__d6 = { quality: QUALITY, reduced: RM });

if (page && gsap && ST) init();

function init() {
  const stage = q('.d6-stage'), intro = q('.d6-intro'), media = q('.d6-hero-media'), heroImg = q('.d6-hero-img');
  const kbHero = q('.d6-hero-media .d6-kb'), kbSb = q('.d6-sb .d6-kb');
  const sb = q('.d6-sb'), sbUi = q('.d6-sb-ui'), sbTarget = q('.d6-sb-target'), dim = q('.d6-hero-dim'), copy = q('.d6-hero-copy');
  const mission = q('.d6-mission'), missionIn = q('.d6-mission-in'), sol = q('.d6-sol'), tabs = qa('.d6-tab'), hud = q('.d6-hud');
  const solHost = q('.d6-sol-canvas'), marsLayer = q('.d6-mars-layer'), marsTrack = q('.d6-mars-track');
  const railLine = q('.d6-rail-line'), railInd = q('.d6-rail-ind'), railMars = q('.d6-rail-mars');
  const loaderEl = q('.d6-loader');
  const focus = (media.dataset.focus || '0.384,0.641,0.622,0.879').split(',').map(Number); // centre monitor screen, 0..1 of the photo

  // ---------- scroll lock while the loader is up ----------
  const lock = on => { document.documentElement.style.overflow = on ? 'hidden' : ''; const l = smooth(); if (l) on ? l.stop() : l.start(); };
  const skipLoader = scrollY > 40 || !loaderEl;
  if (!skipLoader) lock(true);

  // ---------- hero: initial states, text split once fonts are in ----------
  const fontsP = new Promise(r => (window.tfReady || (f => f()))(r));
  const heroImgP = heroImg.complete ? Promise.resolve() : new Promise(r => { heroImg.addEventListener('load', r, { once: true }); heroImg.addEventListener('error', r, { once: true }); });
  const decodeP = heroImgP.then(() => heroImg.decode?.().catch(() => {}));
  let h1Split = null;
  const heroIntro = { k: skipLoader ? 1 : 0 };
  gsap.set('.d6-nav, .d6-rail', { opacity: skipLoader ? 1 : 0 });
  let revealed = skipLoader;
  const splitHero = () => {
    if (RM || !Split || revealed) return; // the 2 s cap can beat the fonts: then the H1 just shows unsplit
    h1Split = new Split('.d6-h1', { type: 'lines', linesClass: 'split-line', mask: 'lines' });
    if (!skipLoader) { gsap.set(h1Split.lines, { yPercent: 105 }); gsap.set('.d6-lead', { opacity: 0, y: 14 }); }
  };
  const heroReveal = (tl, at) => {
    revealed = true;
    tl.to(heroIntro, { k: 1, duration: 1.8, ease: 'power3.out' }, at - 0.2)
      .to('.d6-nav, .d6-rail', { opacity: 1, duration: 1, ease: 'power2.out' }, at + 0.2);
    if (h1Split) tl.to(h1Split.lines, { yPercent: 0, duration: 1.15, stagger: 0.09, ease: 'expo.out', onComplete: () => { h1Split.revert(); h1Split = null; } }, at);
    tl.to('.d6-lead', { opacity: 1, y: 0, duration: 1, ease: 'power3.out' }, at + 0.35);
  };

  // ---------- loader ----------
  const fontsGate = fontsP.then(splitHero);
  if (!skipLoader) {
    const ld = runLoader({
      THREE, el: loaderEl, reduced: RM,
      onExit: tl => { lock(false); heroReveal(tl, RM ? 0.1 : 0.45); },
    });
    ld.gate(fontsGate); ld.gate(decodeP);
    D6.loader = ld.done;
    ld.done.then(afterLoader);
  } else { loaderEl?.remove(); fontsGate.then(() => { if (h1Split) { h1Split.revert(); h1Split = null; } }); afterLoader(); }

  // ---------- Ken Burns drift on the stills (the video slot replaces them when a source is set) ----------
  if (!RM) {
    gsap.fromTo(kbHero, { scale: 1.0, xPercent: 0.6, yPercent: 0.3 }, { scale: 1.045, xPercent: -0.8, yPercent: -0.5, duration: 18, ease: 'sine.inOut', yoyo: true, repeat: -1 });
    gsap.fromTo(kbSb, { scale: 1.03, xPercent: -0.8 }, { scale: 1.09, xPercent: 0.8, yPercent: -0.8, duration: 14, ease: 'sine.inOut', yoyo: true, repeat: -1 });
  }
  // videos: set data-src in Webflow (custom attribute) and the clip fades in over its poster once it plays
  const vids = qa('.d6-video').filter(v => v.dataset.src);
  const vidOn = (v, on) => {
    if (on && !v.src) { v.src = v.dataset.src; v.addEventListener('playing', () => v.classList.add('is-on'), { once: true }); }
    if (!v.src) return; if (on && v.paused) v.play().catch(() => {}); else if (!on && !v.paused) v.pause();
  };

  // ---------- hero -> Series B ----------
  let cardR = { x: 0, y: 0, w: 1, h: 1 }, cardRad = 6;
  const measure = () => {
    const s = stage.getBoundingClientRect(), t = sbTarget.getBoundingClientRect();
    cardR = { x: t.left - s.left, y: t.top - s.top, w: t.width, h: t.height };
    cardRad = parseFloat(getComputedStyle(sb).borderTopLeftRadius) || 6;
  };
  const heroST = ST.create({ trigger: intro, start: 'top top', end: 'bottom bottom' });
  let rmCard = -1;
  function heroFrame(p) {
    const W = stage.clientWidth, H = stage.clientHeight, mob = mobile();
    const iw = heroImg.naturalWidth || 1920, ih = heroImg.naturalHeight || 1080;
    const c = Math.max(W / iw, H / ih), dw = iw * c, dh = ih * c, ox = (W - dw) / 2, oy = (H - dh) / 2;
    // the monitor rect as drawn: cover fit, then the Ken Burns layer (scale about the centre + percent shift)
    const kS = gsap.getProperty(kbHero, 'scale'), kX = gsap.getProperty(kbHero, 'xPercent') / 100 * W, kY = gsap.getProperty(kbHero, 'yPercent') / 100 * H;
    const kx = x => W / 2 + kS * (x - W / 2) + kX, ky = y => H / 2 + kS * (y - H / 2) + kY;
    const x0 = kx(ox + focus[0] * dw), y0 = ky(oy + focus[1] * dh), x1 = kx(ox + focus[2] * dw), y1 = ky(oy + focus[3] * dh);
    const px = (x0 + x1) / 2, py = (y0 + y1) / 2;
    const zA = RM ? 0 : ease(clamp01(p / 0.55)), zB = RM ? 0 : ease(clamp01((p - 0.38) / 0.47));
    const s = (1 + ((mob ? 1.3 : 1.85) - 1) * zA) * (1 + (mob ? 0.25 : 0.5) * zB) * (1 + 0.1 * (1 - heroIntro.k));
    const shift = (mob ? 0.15 : 0.32) * zA, tx = (W / 2 - px) * shift, ty = (H / 2 - py) * shift;
    css(media, 'transformOrigin', `${px.toFixed(1)}px ${py.toFixed(1)}px`);
    css(media, 'transform', `translate3d(${tx.toFixed(2)}px,${ty.toFixed(2)}px,0) scale(${s.toFixed(4)})`);
    css(media, 'opacity', (1 - sstep(0.5, 0.8, p)).toFixed(3));
    css(dim, 'opacity', (0.5 * zA).toFixed(3));
    // copy fades and blurs out as we push in (frame 2)
    const f = clamp01(p / 0.42);
    css(copy, 'opacity', (1 - f).toFixed(3));
    css(copy, 'filter', f > 0.001 ? `blur(${(12 * f).toFixed(2)}px)` : 'none');
    css(copy, 'visibility', f >= 1 ? 'hidden' : 'visible');
    if (RM) {
      // no scrubbed zoom: the card simply crossfades in at its final size
      const on = p > 0.45 ? 1 : 0;
      if (on !== rmCard) { rmCard = on; gsap.to([sb, sbUi], { opacity: on, duration: 0.45, overwrite: true }); gsap.to(media, { opacity: 1 - on, duration: 0.45 }); }
      css(sb, 'left', cardR.x + 'px'); css(sb, 'top', cardR.y + 'px'); css(sb, 'width', cardR.w + 'px'); css(sb, 'height', cardR.h + 'px');
      return;
    }
    // the monitor screen grows into the Series B card
    const sx = v => px + tx + s * (v - px), sy = v => py + ty + s * (v - py);
    const r = { x: lerp(sx(x0), cardR.x, zB), y: lerp(sy(y0), cardR.y, zB) };
    r.w = lerp(sx(x1) - sx(x0), cardR.w, zB); r.h = lerp(sy(y1) - sy(y0), cardR.h, zB);
    css(sb, 'left', r.x.toFixed(1) + 'px'); css(sb, 'top', r.y.toFixed(1) + 'px');
    css(sb, 'width', r.w.toFixed(1) + 'px'); css(sb, 'height', r.h.toFixed(1) + 'px');
    css(sb, 'borderRadius', (cardRad * zB).toFixed(2) + 'px');
    css(sb, 'opacity', sstep(0.36, 0.5, p).toFixed(3));
    css(sbUi, 'opacity', sstep(0.84, 0.95, p).toFixed(3));
  }

  // ---------- mission + solutions ----------
  const missionST = ST.create({ trigger: mission, start: 'top bottom', end: 'top 12%' });
  const enterST = ST.create({ trigger: sol, start: 'top bottom', end: 'top top' });
  const solST = ST.create({ trigger: sol, start: 'top top', end: 'bottom bottom' });
  const outST = ST.create({ trigger: sol, start: 'bottom bottom', end: 'bottom 35%' });
  const marsST = ST.create({ trigger: marsTrack, start: 'top bottom', end: 'top top' });

  let solApi = null, solRunning = false, solStarting = null;
  const loadSolutions = () => solStarting || (solStarting = import('./solutions.js').then(m => {
    if (!m?.createSolutions) return;
    solApi = m.createSolutions({ THREE, host: solHost, topoUrl: new URL('./assets/topo.bin', import.meta.url).href, quality: QUALITY });
    D6.solutions = solApi;
    solApi.onTelemetry?.(onTele);
    return solApi.ready;
  }).catch(e => console.warn('d6 solutions:', e)));

  // telemetry HUD (control mode only)
  const tv = Object.fromEntries(qa('.d6-tele-v').map(el => [el.dataset.k, el])), teleState = q('.d6-tele-state'), blade = q('.d6-gauge-blade');
  const fmtA = v => (+v).toFixed(2) + '°';
  function onTele(d) {
    if (!hudOn) return;
    if (d.height != null) txt(tv.height, (+d.height).toFixed(2) + ' FT');
    if (d.yaw != null) txt(tv.yaw, fmtA(d.yaw)); if (d.roll != null) txt(tv.roll, fmtA(d.roll)); if (d.body != null) txt(tv.body, fmtA(d.body));
    if (d.speed != null) txt(tv.speed, (+d.speed).toFixed(1));
    if (d.state) txt(teleState, String(d.state));
    if (d.blade != null) css(blade, 'transform', `translateY(${(-6 * Math.max(-1, Math.min(1, d.blade))).toFixed(2)}px) rotate(${(8 * Math.max(-1, Math.min(1, d.blade))).toFixed(2)}deg)`);
  }

  // tabs: click animates the scene and scrolls to that mode's stretch of the pin
  let curMode = 0, hudOn = false, clickLock = null;
  const setActive = i => { if (i === curMode) return; curMode = i; tabs.forEach((t, k) => t.classList.toggle('is-active', k === i)); };
  const modeY = i => solST.start + ((i + 0.06) / 3) * (solST.end - solST.start);
  tabs.forEach((t, i) => t.addEventListener('click', e => {
    e.preventDefault();
    const y = modeY(i), dist = Math.abs(y - scrollY), dur = Math.min(1.8, 0.6 + dist / 2500);
    clickLock = { mode: i, until: performance.now() + dur * 1000 + 150 };
    setActive(i); solApi?.setMode?.(i);
    const l = smooth(); l ? l.scrollTo(y, { duration: dur }) : scrollTo({ top: y, behavior: RM ? 'auto' : 'smooth' });
  }));

  const scene = { topo: 0, morph: 0, mode: 0, modeT: 0, flatten: 0 }, last = {};
  function solFrame() {
    const topo = clamp01(missionST.progress), morph = clamp01(enterST.progress), sp = solST.progress;
    let modeF = Math.min(sp * 3, 2.9999), mode = Math.floor(modeF), modeT = mode === 2 ? clamp01(sp * 3 - 2) : modeF - mode;
    if (clickLock) { if (performance.now() > clickLock.until) clickLock = null; else { mode = clickLock.mode; modeT = 0.06; } }
    scene.topo = topo; scene.morph = morph; scene.mode = mode; scene.modeT = modeT; scene.flatten = mode === 2 ? sstep(0, 0.55, modeT) : 0;
    setActive(mode);
    const on = mode === 1 && morph >= 0.999;
    if (on !== hudOn) { hudOn = on; hud.classList.toggle('is-on', on); }
    css(missionIn, 'opacity', (1 - 0.85 * morph).toFixed(3));
    // the WebGL layer: in with the mission, out as the solutions pin releases
    const op = Math.min(sstep(0, 0.35, topo), 1 - sstep(0, 1, outST.progress));
    css(solHost, 'opacity', op.toFixed(3)); css(solHost, 'visibility', op > 0 ? 'visible' : 'hidden');
    if (op > 0 && !solStarting) loadSolutions();
    if (solApi) {
      if (op > 0 && !solRunning) { solRunning = true; solApi.start?.(); }
      else if (op <= 0 && solRunning) { solRunning = false; solApi.stop?.(); }
      if (solRunning && (last.topo !== scene.topo || last.morph !== scene.morph || last.mode !== scene.mode || last.modeT !== scene.modeT)) {
        Object.assign(last, scene); solApi.setScene(scene);
      }
    }
    D6.scene = scene;
  }

  // ---------- Mars: D5 in mars mode, imported when its track is ~1.5 viewports away ----------
  let marsP = null;
  const loadMars = () => marsP || (marsP = (window.D5_CFG = Object.assign({ ahead: 1 }, window.D5_CFG, { mode: 'mars' }),
    import(new URL('../d5/main.js', import.meta.url).href).catch(e => console.warn('d6 mars:', e))));
  D6.loadMars = loadMars;
  function marsFrame() {
    const r = marsTrack.getBoundingClientRect();
    if (!marsP && r.top < innerHeight * 2.5) loadMars();
    const op = sstep(0, 0.25, marsST.progress); // D5 keeps its own canvas dark until the track is near; this only gates its HUD/overlays
    css(marsLayer, 'opacity', op.toFixed(3)); css(marsLayer, 'visibility', op > 0 ? 'visible' : 'hidden');
  }

  // ---------- right rail: Earth stretch until the Mars track, Mars stretch after ----------
  let railGeo = null;
  const measureRail = () => {
    const L = railLine.offsetHeight, mY = railMars.offsetTop + railMars.offsetHeight / 2 - railLine.offsetTop;
    railGeo = { L, mY, ind: railInd.offsetHeight, marsAt: marsTrack.getBoundingClientRect().top + scrollY };
  };
  function railFrame() {
    if (!railGeo) return;
    const { L, mY, ind, marsAt } = railGeo, max = document.documentElement.scrollHeight - innerHeight, y = scrollY;
    // past the Mars track top the Mars stretch follows D5's eased progress when it is running
    const mp = window.__d5?.mars?.p, after = mp != null ? clamp01(mp) : clamp01((y - marsAt) / Math.max(1, max - marsAt));
    const v = y < marsAt ? lerp(0, mY - ind - 14, clamp01(y / marsAt)) : lerp(mY + 14, L - ind, after);
    css(railInd, 'transform', `translate3d(0,${v.toFixed(1)}px,0)`);
  }
  qa('.d6-rail-planet').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    const y = a.dataset.to === 'mars' ? railGeo?.marsAt ?? 0 : 0, l = smooth();
    l ? l.scrollTo(y, { duration: 2.2 }) : scrollTo({ top: y, behavior: 'smooth' });
  }));

  // ---------- reveals (fonts must be in for SplitText) ----------
  fontsP.then(() => {
    const reveal = (trigger, els, extra) => {
      const tl = gsap.timeline({ paused: true });
      if (!RM && Split) {
        const sp = els.map(el => new Split(el, { type: 'lines', linesClass: 'split-line', mask: 'lines' }));
        tl.from(sp.flatMap(s => s.lines), { yPercent: 110, duration: 1.1, stagger: 0.06, ease: 'expo.out', onComplete: () => sp.forEach(s => s.revert()) }, 0);
      } else tl.from(els, { opacity: 0, duration: 0.8 }, 0);
      extra?.(tl);
      ST.create({ trigger, start: 'top 82%', once: true, onEnter: () => tl.play() });
    };
    reveal(missionIn, qa('.d6-mission-h, .d6-p', missionIn), tl => tl.from(qa('.d6-mission-label, .d6-cta, .d6-br', missionIn), { opacity: 0, duration: 0.8, stagger: 0.08 }, 0.15));
    reveal(sol, [q('.d6-sol-h')], tl => tl.from(q('.d6-sol-head .d6-label'), { opacity: 0, duration: 0.8 }, 0).from(tabs, { opacity: 0, y: RM ? 0 : 24, duration: 0.9, stagger: 0.08, ease: 'power3.out' }, 0.25));
    ST.refresh();
  });

  // ---------- frame ----------
  measure(); measureRail();
  let lastP = -1;
  function frame() {
    const p = heroST.progress, sr = stage.getBoundingClientRect();
    if (sr.bottom > 0) { heroFrame(p); lastP = p; }
    for (const v of vids) vidOn(v, v.classList.contains('d6-hero-video') ? sr.bottom > 0 && p < 0.8 : sr.bottom > 0 && p > 0.3);
    solFrame(); marsFrame(); railFrame();
  }
  gsap.ticker.add(frame);
  let rz = 0;
  addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => { measure(); measureRail(); solApi?.resize?.(); }); });
  ST.addEventListener('refresh', () => { measure(); measureRail(); });
  D6.hero = p => heroFrame(p); // QA hooks
  D6.st = { heroST, missionST, enterST, solST, outST, marsST };

  function afterLoader() {
    // warm the solutions scene early (topo fetch + geometry) without competing with the loader
    (window.requestIdleCallback || (f => setTimeout(f, 300)))(() => loadSolutions(), { timeout: 1500 });
  }
}
