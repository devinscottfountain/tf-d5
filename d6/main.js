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
// three.js hero: desktop and tablets (quality follows the tier), poster photo below 768 px, on phones and with reduced
// motion (the phone layout crossfades into a 4:5 card the 16:9 screen cannot become). ?hero=3d / ?hero=0 force it for QA.
const HERO3D = (() => {
  const o = new URLSearchParams(location.search).get('hero'); if (o === '3d') return true; if (o === '0') return false;
  return !RM && innerWidth >= 768 && !(matchMedia('(pointer: coarse)').matches && innerWidth < 820);
})();
const P_CARD = 0.85;   // hero progress at which the 3D screen has become the Series B card
const D6 = (window.__d6 = { quality: QUALITY, reduced: RM, hero3d: HERO3D, t: {} });
const stamp = k => (D6.t[k] = Math.round(performance.now())); // QA timeline

if (page && gsap && ST) init();

function init() {
  const stage = q('.d6-stage'), intro = q('.d6-intro'), media = q('.d6-hero-media'), heroImg = q('.d6-hero-img');
  const kbHero = q('.d6-hero-media .d6-kb'), kbSb = q('.d6-sb .d6-kb');
  const sb = q('.d6-sb'), sbUi = q('.d6-sb-ui'), sbTarget = q('.d6-sb-target'), dim = q('.d6-hero-dim'), copy = q('.d6-hero-copy');
  const shade = q('.d6-hero-shade'), sbImg = q('.d6-sb-img'), sbVid = q('.d6-sb-video');
  const mission = q('.d6-mission'), missionIn = q('.d6-mission-in'), sol = q('.d6-sol'), tabs = qa('.d6-tab'), hud = q('.d6-hud');
  const solStage = q('.d6-sol-stage'), tabsEl = q('.d6-tabs'), hudCards = [q('.d6-tele'), q('.d6-blade')];
  const solHost = q('.d6-sol-canvas'), marsLayer = q('.d6-mars-layer'), marsTrack = q('.d6-mars-track');
  const railLine = q('.d6-rail-line'), railInd = q('.d6-rail-ind'), railMars = q('.d6-rail-mars');
  const loaderEl = q('.d6-loader');
  const focus = (media.dataset.focus || '0.384,0.641,0.622,0.879').split(',').map(Number); // centre monitor screen, 0..1 of the photo

  // ---------- scroll lock while the loader is up ----------
  const lock = on => { document.documentElement.style.overflow = on ? 'hidden' : ''; const l = smooth(); if (l) on ? l.stop() : l.start(); };
  // modules arriving after the 6 s CSS failsafe has started (or finished) must not bring the loader back
  const skipLoader = scrollY > 40 || !loaderEl || performance.now() > 5900 || getComputedStyle(loaderEl).visibility === 'hidden';
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

  // ---------- 3D hero: built now, in parallel with the loader; the photo stays as poster until it is ready ----------
  // hero: the API once built; heroOn: the canvas is the visible hero; heroLive: the loader is leaving (rendering allowed)
  // It is released when Mars loads (GPU memory: it would coexist with solutions + D5) and rebuilt when the stage comes
  // back within ~1.5 viewports; the photo path covers the gap and the canvas crossfades over it once its first frame is in.
  let hero = null, heroOn = false, heroLive = skipLoader, heroRun = false, heroKey = '', heroGen = 0, heroBuilding = null, heroHost = null;
  const heroFade = { v: 0 };
  let fontsIn = null;
  function buildHero(again) {
    if (!HERO3D) return Promise.resolve(false);
    if (heroBuilding) return heroBuilding;
    const gen = ++heroGen, host = heroHost = document.createElement('div');
    host.className = 'd6-hero-3d'; media.after(host); heroFade.v = 0;
    // screen UI text is drawn into canvases at construction: the fonts must be in first (capped)
    fontsIn = fontsIn || Promise.race([
      Promise.all(['500 13px "IBM Plex Mono"', '500 13px Geist', '400 13px Geist'].map(f => document.fonts?.load(f).catch(() => {}))).then(() => document.fonts?.ready),
      new Promise(r => setTimeout(r, 1800)),
    ]);
    const p = Promise.all([import('./hero3d.js'), fontsIn]).then(([m]) => {
      if (gen !== heroGen) return false;
      measure(); stamp(again ? 'heroRebuild' : 'heroBuild');
      hero = m.createHero({ THREE, host, quality: QUALITY, still: sbImg.currentSrc || sbImg.src });
      D6.heroApi = hero; copyOpLast = -1; // a rebuilt hero gets the copy opacity again
      hero.setTarget(cardR, cardRad); heroKey = rectKey(); stamp(again ? 'heroRebuilt' : 'heroBuilt');
      if (sbVid?.classList.contains('is-on')) hero.setMedia(sbVid);
      return hero.ready;
    }).then(ok => { if (ok === false || gen !== heroGen) return false; swapIn(again); return true; }).catch(e => {
      console.warn('d6 hero:', e);
      if (gen === heroGen) { try { hero?.dispose(); } catch (_) { /* already gone */ } hero = null; D6.heroApi = null; }
      host.remove(); return false;
    }).finally(() => { if (gen === heroGen) heroBuilding = null; });
    return (heroBuilding = p);
  }
  const heroReady = buildHero(false);
  D6.heroReady = heroReady;
  function releaseHero() {
    if (!HERO3D || (!hero && !heroBuilding)) return;
    heroGen++; heroBuilding = null; stamp('heroRelease');
    if (hero) { const r = hero.renderer; try { hero.stop(); hero.dispose(); r?.forceContextLoss?.(); } catch (_) { /* already gone */ } }
    hero = null; heroOn = false; heroRun = false; D6.heroApi = null; D6.heroOn = false; D6.heroRun = false;
    gsap.killTweensOf(heroFade); heroFade.v = 0; heroHost?.remove(); heroHost = null;
    css(media, 'visibility', 'visible'); css(media, 'opacity', '1'); css(shade, 'opacity', '1'); kbOn = null; // Ken Burns resumes with the stage
  }
  function swapIn(again) {
    heroOn = true; D6.heroOn = true; stamp(again ? 'heroSwapBack' : heroLive ? 'heroSwapLate' : 'heroSwap');
    gsap.killTweensOf(heroFade);
    const sr = stage.getBoundingClientRect(), seen = sr.bottom > 0 && sr.top < innerHeight;
    if (!heroLive || (again && !seen)) heroFade.v = 1; // behind the loader or off screen: instant
    else {
      // the first 3D frame is drawn before the crossfade starts, so the poster never shows through a blank canvas
      hero.setProgress(clamp01(heroST.progress / P_CARD)); hero.renderOnce();
      gsap.to(heroFade, { v: 1, duration: again ? 0.4 : 0.9, ease: 'power2.inOut' });
    }
    kbHeroTw?.pause();
  }

  // ---------- loader ----------
  const fontsGate = fontsP.then(splitHero);
  if (!skipLoader) {
    const ld = runLoader({
      THREE, el: loaderEl, reduced: RM, maxMs: HERO3D ? 2200 : 2000, // holds for the hero's boot, capped at 2.2 s (later: poster first, canvas crossfades in)
      onExit: tl => { stamp('loaderExit'); lock(false); heroLive = true; heroReveal(tl, RM ? 0.1 : 0.45); },
    });
    ld.gate(fontsGate); ld.gate(decodeP); ld.gate(heroReady);
    D6.loader = ld.done;
    ld.done.then(afterLoader);
  } else { loaderEl?.remove(); fontsGate.then(() => { if (h1Split) { h1Split.revert(); h1Split = null; } }); afterLoader(); }

  // ---------- Ken Burns drift on the stills (the video slot replaces them when a source is set) ----------
  // the Series B drift runs on a proxy: with the 3D hero it is weighted in only after the card has taken over, so the
  // card matches the canvas exactly at the swap in both scroll directions
  let kbHeroTw = null, kbSbTw = null, kbOn = null; const kbS = { scale: 1, xPercent: 0, yPercent: 0 };
  if (!RM) {
    kbHeroTw = gsap.fromTo(kbHero, { scale: 1.0, xPercent: 0.6, yPercent: 0.3 }, { scale: 1.045, xPercent: -0.8, yPercent: -0.5, duration: 18, ease: 'sine.inOut', yoyo: true, repeat: -1 });
    kbSbTw = gsap.fromTo(kbS, { scale: 1.03, xPercent: -0.8, yPercent: 0 }, { scale: 1.09, xPercent: 0.8, yPercent: -0.8, duration: 14, ease: 'sine.inOut', yoyo: true, repeat: -1 });
  }
  // both drifts pause while the stage is off screen (the hero one stays paused under the 3D canvas)
  const kbFrame = vis => {
    if (vis === kbOn) return; kbOn = vis;
    if (kbSbTw) vis ? kbSbTw.resume() : kbSbTw.pause();
    if (kbHeroTw) vis && !heroOn ? kbHeroTw.resume() : kbHeroTw.pause();
  };
  const kbSbFrame = w => {
    const s = 1 + (kbS.scale - 1) * w, x = kbS.xPercent * w, y = kbS.yPercent * w;
    css(kbSb, 'transform', w <= 0 ? 'none' : `translate3d(${x.toFixed(3)}%,${y.toFixed(3)}%,0) scale(${s.toFixed(4)})`);
  };
  // videos: set data-src in Webflow (custom attribute) and the clip fades in over its poster once it plays
  const vids = qa('.d6-video').filter(v => v.dataset.src);
  const vidOn = (v, on) => {
    if (on && !v.src) {
      if (HERO3D && v === sbVid) v.crossOrigin = 'anonymous'; // the hero samples the same video on its screen
      v.src = v.dataset.src;
      v.addEventListener('playing', () => { v.classList.add('is-on'); if (v === sbVid) hero?.setMedia(v); }, { once: true });
    }
    if (!v.src) return;
    if (on && v.paused && !v._d6busy && !v._d6blocked) { v._d6busy = true; v.play().then(() => { v._d6busy = false; }, () => { v._d6busy = false; v._d6blocked = true; }); } // autoplay refused: stay on the poster
    else if (!on && !v.paused) v.pause();
  };

  // ---------- hero -> Series B ----------
  let cardR = { x: 0, y: 0, w: 1, h: 1 }, cardRad = 6;
  const rectKey = () => [cardR.x, cardR.y, cardR.w, cardR.h, cardRad].map(v => v.toFixed(2)).join(',');
  function measure() {
    const s = stage.getBoundingClientRect(), t = sbTarget.getBoundingClientRect();
    cardR = { x: t.left - s.left, y: t.top - s.top, w: t.width, h: t.height };
    cardRad = parseFloat(getComputedStyle(sb).borderTopLeftRadius) || 6;
    // the hero solves its end pose so the screen corners land exactly on the card rect
    if (hero) { const k = rectKey(); if (k !== heroKey) { heroKey = k; hero.setTarget(cardR, cardRad); } }
  }
  const heroST = ST.create({ trigger: intro, start: 'top top', end: 'bottom bottom' });
  let rmCard = -1;
  // 3D path: the canvas dollies into the centre monitor; the DOM card sits fixed on the card rect and takes over at hp ~1
  function hero3dFrame(p) {
    const hp = clamp01(p / P_CARD);
    copyFrame(p);
    css(dim, 'opacity', '0');
    css(shade, 'opacity', (1 - sstep(0.12, 0.6, hp)).toFixed(3)); // gone well before the hand-off (it would tint the canvas, not the card)
    // canvas: intro push like the photo had, visible until the card has fully taken over
    const fv = heroFade.v, k = heroIntro.k;
    css(heroHost, 'opacity', fv.toFixed(3)); css(heroHost, 'visibility', fv > 0 && hp < 1 ? 'visible' : 'hidden');
    css(heroHost, 'transform', k < 1 ? `scale(${(1 + 0.1 * (1 - k)).toFixed(4)})` : 'none');
    css(media, 'visibility', fv >= 1 ? 'hidden' : 'visible');
    hero.setProgress(hp);
    css(sb, 'left', cardR.x.toFixed(2) + 'px'); css(sb, 'top', cardR.y.toFixed(2) + 'px');
    css(sb, 'width', cardR.w.toFixed(2) + 'px'); css(sb, 'height', cardR.h.toFixed(2) + 'px');
    css(sb, 'borderRadius', cardRad + 'px');
    css(sb, 'opacity', hp >= 0.995 ? '1' : '0');
    sbUiFrame(hp >= 0.995);
    kbSbFrame(RM ? 0 : sstep(P_CARD + 0.01, 1, p));
  }
  // run the renderer only while the stage is on screen, the loader is leaving and the canvas is the visible layer
  function heroRunFrame(p, sr) {
    if (!hero) return;
    const want = heroOn && heroLive && sr.bottom > 0 && sr.top < innerHeight && p < P_CARD;
    if (want && !heroRun) { heroRun = true; if (!D6.t.heroStart) stamp('heroStart'); hero.setProgress(clamp01(p / P_CARD)); hero.start(); hero.renderOnce(); }
    else if (!want && heroRun) { heroRun = false; hero.stop(); }
    D6.heroRun = heroRun;
  }

  let copyOpLast = -1;
  // hero copy leaves with opacity + a short lift (no blur: it smeared a ghost H1)
  function copyFrame(p) {
    const f = clamp01(p / 0.42);
    css(copy, 'opacity', (1 - f).toFixed(3));
    if (hero && typeof hero.setCopyOpacity === 'function' && f !== copyOpLast) { copyOpLast = f; hero.setCopyOpacity(1 - f); } // lamps etc. can follow the H1
    css(copy, 'transform', f > 0.001 ? `translate3d(0,${(-24 * ease(f)).toFixed(2)}px,0)` : 'none');
    css(copy, 'visibility', f >= 1 ? 'hidden' : 'visible');
  }
  // Series B card UI: comes in once the card has settled (play, title, scale, 300 ms apart), goes quietly on the way back
  const sbParts = [q('.d6-play'), q('.d6-sb-title'), q('.d6-sb-scale')].filter(Boolean);
  gsap.set(sbParts, { opacity: 0 });
  let sbUiOn = false;
  function sbUiFrame(on) {
    css(sbUi, 'opacity', '1');
    if (on === sbUiOn) return; sbUiOn = on;
    gsap.killTweensOf(sbParts);
    if (on) gsap.fromTo(sbParts, { opacity: 0, y: RM ? 0 : 10 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.3, ease: 'power3.out' });
    else gsap.to(sbParts, { opacity: 0, duration: 0.25, ease: 'power2.out' });
    css(sbUi, 'pointerEvents', on ? 'auto' : 'none');
    uiInert(!on);
  }
  // keyboard: the card UI is out of the tab order (and the a11y tree) until the card has settled
  const sbFocusables = qa('a, button, [tabindex]', sbUi);
  function uiInert(off) {
    sbUi.inert = off; if (off) sbUi.setAttribute('aria-hidden', 'true'); else sbUi.removeAttribute('aria-hidden');
    for (const el of sbFocusables) off ? el.setAttribute('tabindex', '-1') : el.removeAttribute('tabindex');
    if (off && sbUi.contains(document.activeElement)) document.activeElement.blur();
  }
  css(sbUi, 'pointerEvents', 'none'); uiInert(true);
  // phones: no zoom morph; the photo eases in a touch and the full-width 4:5 card crossfades over it on its own rect
  function mobileFrame(p) {
    const zA = RM ? 0 : ease(clamp01(p / 0.6));
    css(media, 'transformOrigin', '50% 55%'); css(media, 'transform', `scale(${(1 + 0.12 * zA + 0.1 * (1 - heroIntro.k)).toFixed(4)})`);
    css(dim, 'opacity', (0.35 * zA).toFixed(3));
    copyFrame(p);
    css(sb, 'left', cardR.x + 'px'); css(sb, 'top', cardR.y + 'px'); css(sb, 'width', cardR.w + 'px'); css(sb, 'height', cardR.h + 'px');
    css(sb, 'borderRadius', cardRad + 'px');
    if (RM) {
      const on = p > 0.45 ? 1 : 0;
      if (on !== rmCard) { rmCard = on; gsap.to(sb, { opacity: on, duration: 0.45, overwrite: true }); gsap.to(media, { opacity: 1 - on, duration: 0.45 }); }
    } else { css(sb, 'opacity', sstep(0.3, 0.55, p).toFixed(3)); css(media, 'opacity', (1 - sstep(0.45, 0.65, p)).toFixed(3)); }
    sbUiFrame(RM ? p > 0.45 : p >= 0.55);
    kbSbFrame(RM ? 0 : 1);
  }

  function heroFrame(p) {
    if (heroOn) return hero3dFrame(p);
    if (mobile()) return mobileFrame(p);
    const W = stage.clientWidth, H = stage.clientHeight;
    const iw = heroImg.naturalWidth || 1920, ih = heroImg.naturalHeight || 1080;
    const c = Math.max(W / iw, H / ih), dw = iw * c, dh = ih * c, ox = (W - dw) / 2, oy = (H - dh) / 2;
    // the monitor rect as drawn: cover fit, then the Ken Burns layer (scale about the centre + percent shift)
    const kS = gsap.getProperty(kbHero, 'scale'), kX = gsap.getProperty(kbHero, 'xPercent') / 100 * W, kY = gsap.getProperty(kbHero, 'yPercent') / 100 * H;
    const kx = x => W / 2 + kS * (x - W / 2) + kX, ky = y => H / 2 + kS * (y - H / 2) + kY;
    const x0 = kx(ox + focus[0] * dw), y0 = ky(oy + focus[1] * dh), x1 = kx(ox + focus[2] * dw), y1 = ky(oy + focus[3] * dh);
    const px = (x0 + x1) / 2, py = (y0 + y1) / 2;
    const zA = RM ? 0 : ease(clamp01(p / 0.55)), zB = RM ? 0 : ease(clamp01((p - 0.38) / 0.47));
    const s = (1 + 0.85 * zA) * (1 + 0.5 * zB) * (1 + 0.1 * (1 - heroIntro.k));
    const shift = 0.32 * zA, tx = (W / 2 - px) * shift, ty = (H / 2 - py) * shift;
    css(media, 'transformOrigin', `${px.toFixed(1)}px ${py.toFixed(1)}px`);
    css(media, 'transform', `translate3d(${tx.toFixed(2)}px,${ty.toFixed(2)}px,0) scale(${s.toFixed(4)})`);
    css(dim, 'opacity', (0.5 * zA).toFixed(3));
    copyFrame(p); // copy fades and lifts out as we push in (frame 2)
    if (RM) {
      // no scrubbed zoom: the card simply crossfades in at its final size
      const on = p > 0.45 ? 1 : 0;
      if (on !== rmCard) { rmCard = on; gsap.to(sb, { opacity: on, duration: 0.45, overwrite: true }); gsap.to(media, { opacity: 1 - on, duration: 0.45 }); }
      css(sb, 'left', cardR.x + 'px'); css(sb, 'top', cardR.y + 'px'); css(sb, 'width', cardR.w + 'px'); css(sb, 'height', cardR.h + 'px');
      css(sb, 'borderRadius', cardRad + 'px');
      sbUiFrame(on === 1);
      kbSbFrame(0);
      return;
    }
    css(media, 'opacity', (1 - sstep(0.5, 0.8, p)).toFixed(3)); // after the RM branch: there gsap owns the fade
    // the monitor screen grows into the Series B card
    const sx = v => px + tx + s * (v - px), sy = v => py + ty + s * (v - py);
    const r = { x: lerp(sx(x0), cardR.x, zB), y: lerp(sy(y0), cardR.y, zB) };
    r.w = lerp(sx(x1) - sx(x0), cardR.w, zB); r.h = lerp(sy(y1) - sy(y0), cardR.h, zB);
    css(sb, 'left', r.x.toFixed(1) + 'px'); css(sb, 'top', r.y.toFixed(1) + 'px');
    css(sb, 'width', r.w.toFixed(1) + 'px'); css(sb, 'height', r.h.toFixed(1) + 'px');
    css(sb, 'borderRadius', (cardRad * zB).toFixed(2) + 'px');
    css(sb, 'opacity', sstep(0.36, 0.5, p).toFixed(3));
    sbUiFrame(zB >= 0.995);
    kbSbFrame(RM ? 0 : 1);
  }

  // ---------- mission + solutions ----------
  // the map draws in with the copy (missionST), holds at rest with it for 0.6 viewport (the copy is sticky on desktop),
  // then turns into the dot grid while the copy fades (gone by morph 0.3); the morph ends where the solutions pin starts
  const docTop = el => el.getBoundingClientRect().top + scrollY;
  const missionRestY = () => docTop(mission) - 0.12 * innerHeight;
  const missionST = ST.create({ trigger: mission, start: 'top bottom', end: 'top 12%' });
  const enterST = ST.create({ trigger: sol, start: () => missionRestY() + 0.6 * innerHeight, end: 'top top' });
  const solST = ST.create({ trigger: sol, start: 'top top', end: 'bottom bottom' });
  const outST = ST.create({ trigger: sol, start: 'bottom bottom', end: 'bottom 35%' });
  const marsST = ST.create({ trigger: marsTrack, start: 'top bottom', end: 'top top' });

  let solApi = null, solRunning = false, solStarting = null;
  const loadSolutions = () => solStarting || (solStarting = import('./solutions.js').then(m => {
    if (!m?.createSolutions) return;
    solApi = m.createSolutions({ THREE, host: solHost, topoUrl: new URL('./assets/topo.bin', import.meta.url).href, quality: QUALITY });
    D6.solutions = solApi;
    solApi.onTelemetry?.(onTele);
    if (solApi.onGame) solApi.onGame(e => { if (!e || e.type === 'point') onGame(); }); else solHost.addEventListener('click', onGame);
    if (geo) solApi.setScene(geo);
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

  // control-mode hint: until the user's first ground point (solutions onGame 'point'; a canvas click is the fallback)
  const coarse = matchMedia('(pointer: coarse)').matches, hint = document.createElement('div');
  hint.className = 'd6-hint'; hint.setAttribute('aria-hidden', 'true');
  hint.textContent = coarse ? 'Tap ground to plot a dig zone · Tap first point to close' : 'Click ground to plot a dig zone · Click first point to close';
  tabsEl.appendChild(hint); // under the tabs, right aligned: clear of the ground band the machines use
  let hintDone = false;
  function onGame() { if (!hintDone && hudOn) { hintDone = true; hint.classList.remove('is-on'); } }

  // tabs: click animates the scene and scrolls to that mode's stretch of the pin
  let curMode = 0, hudOn = false, clickLock = null;
  const setActive = i => { if (i === curMode) return; curMode = i; tabs.forEach((t, k) => t.classList.toggle('is-active', k === i)); };
  const modeY = i => solST.start + ((i + 0.06) / 3) * (solST.end - solST.start);
  tabs.forEach((t, i) => t.addEventListener('click', e => {
    e.preventDefault();
    const y = modeY(i), dist = Math.abs(y - scrollY), dur = Math.min(1.8, 0.6 + dist / 2500);
    clickLock = { mode: i, until: performance.now() + dur * 1000 + 150 };
    setActive(i); // solFrame holds the clicked mode until the scroll lands on it (setMode's tween would be reset by the scroll inputs)
    const l = smooth(); l ? l.scrollTo(y, { duration: dur }) : scrollTo({ top: y, behavior: RM ? 'auto' : 'smooth' });
  }));

  const scene = { topo: 0, morph: 0, mode: 0, modeT: 0, flatten: 0, missionTop: null }, last = {};
  // map placement: solutions places the map from the mission copy top (canvas px); it rises with the copy and stays
  // where the copy came to rest when the copy moves on
  let restMission = 0;
  const measureMission = () => { restMission = 0.12 * innerHeight + (parseFloat(getComputedStyle(mission).paddingTop) || 0); };
  // framing inputs for the WebGL layer, in canvas px as they sit while the stage is pinned (stage and canvas share 0,0):
  // bottom of the tab cards (the scene keeps its machines below it) and the control HUD cards (kept clear in control)
  let geo = null, geoKey = '';
  function measureSolGeo() {
    const s = solStage.getBoundingClientRect(), t = tabsEl.getBoundingClientRect();
    const rr = el => { const r = el && el.getBoundingClientRect(); return r && r.width > 1 ? { l: r.left - s.left, t: r.top - s.top, r: r.right - s.left, b: r.bottom - s.top } : null; };
    const g = { groundTop: t.bottom - s.top, hud: hudCards.map(rr) };
    const key = Math.round(g.groundTop) + '|' + g.hud.map(r => (r ? Math.round(r.l) + ',' + Math.round(r.t) + ',' + Math.round(r.r) : '')).join(';');
    if (key !== geoKey) { geoKey = key; geo = g; if (solApi) solApi.setScene(g); D6.solGeo = g; }
  }
  function solFrame(missionTop, exitPx) {
    const topo = clamp01(missionST.progress), morph = clamp01(enterST.progress), sp = solST.progress;
    let modeF = Math.min(sp * 3, 2.9999), mode = Math.floor(modeF), modeT = mode === 2 ? clamp01(sp * 3 - 2) : modeF - mode;
    if (clickLock) { if (performance.now() > clickLock.until) clickLock = null; else { mode = clickLock.mode; modeT = 0.06; } }
    scene.topo = topo; scene.morph = morph; scene.mode = mode; scene.modeT = modeT; scene.flatten = mode === 2 ? sstep(0, 0.55, modeT) : 0;
    scene.missionTop = Math.round(Math.max(missionTop, restMission));
    setActive(mode);
    const on = mode === 1 && morph >= 0.999 && exitPx <= 0;
    if (on !== hudOn) { hudOn = on; hud.classList.toggle('is-on', on); hint.classList.toggle('is-on', on && !hintDone); }
    const mo = 1 - sstep(0, 0.3, morph);
    css(missionIn, 'opacity', mo.toFixed(3)); css(missionIn, 'visibility', mo > 0 ? 'visible' : 'hidden');
    // pin released: the copy and tabs lift out (0..0.28 vh), the canvas fades to 0 and stops by EXIT.sol, then a pure
    // black dead zone, then Mars fades in (marsFrame, from EXIT.mars)
    const H = innerHeight, cOut = exitPx > 0 ? sstep(0, 0.28 * H, exitPx) : 0;
    css(solStage, 'transform', exitPx > 0 ? `translate3d(0,${(exitPx - 24 * cOut).toFixed(1)}px,0)` : 'none');
    css(solStage, 'opacity', (1 - cOut).toFixed(3)); css(solStage, 'visibility', cOut >= 1 ? 'hidden' : 'visible');
    const op = Math.min(sstep(0, 0.35, topo), 1 - (exitPx > 0 ? sstep(0, EXIT.sol(), exitPx) : 0));
    css(solHost, 'opacity', op.toFixed(3)); css(solHost, 'visibility', op > 0 ? 'visible' : 'hidden');
    if (op > 0 && !solStarting) loadSolutions();
    if (solApi) {
      if (op > 0 && !solRunning) { solRunning = true; solApi.start?.(); }
      else if (op <= 0 && solRunning) { solRunning = false; solApi.stop?.(); }
      if (solRunning && (last.topo !== scene.topo || last.morph !== scene.morph || last.mode !== scene.mode || last.modeT !== scene.modeT || last.missionTop !== scene.missionTop)) {
        Object.assign(last, scene); solApi.setScene(scene);
      }
    }
    D6.scene = scene;
  }

  // solutions -> Mars hand-off, in px of scroll past the pin end: canvas 0 at sol, Mars from mars (>= 180 px of black between)
  const EXIT = { sol: () => 0.34 * innerHeight, mars: () => 0.34 * innerHeight + Math.max(180, 0.2 * innerHeight), len: () => 0.3 * innerHeight };
  D6.exit = EXIT;
  // ---------- Mars: D5 in mars mode, imported when its track is ~1.5 viewports away ----------
  let marsP = null; const endEl = q('.d6-end');
  const loadMars = () => marsP || (marsP = (window.D5_CFG = Object.assign({ ahead: 1 }, window.D5_CFG, { mode: 'mars' }),
    import(new URL('../d5/main.js', import.meta.url).href).catch(e => console.warn('d6 mars:', e))));
  D6.loadMars = loadMars;
  function marsFrame(top, exitPx, afterTop) {
    if (top < innerHeight * 2.5) { if (!marsP) loadMars(); releaseHero(); }
    // in after the solutions copy has gone (D5 keeps its own canvas dark until the track is near; this gates all of it);
    // hidden once the closing section covers the viewport (D5 stops drawing there too)
    const m0 = EXIT.mars(), op = afterTop <= 0 ? 0 : sstep(m0, m0 + EXIT.len(), exitPx);
    css(marsLayer, 'opacity', op.toFixed(3)); css(marsLayer, 'visibility', op > 0 ? 'visible' : 'hidden');
    // closing section: its top rule stays hidden while it rises over the fading Mars layer, drawn once it has landed
    if (endEl) css(endEl, 'borderTopColor', afterTop <= 0.5 ? '' : 'transparent'); // '' = the authored rgba(255,255,255,.1)
    return op;
  }

  // ---------- right rail: Earth stretch until the Mars track, Mars stretch after ----------
  let railGeo = null;
  const measureRail = () => {
    const L = railLine.offsetHeight, mY = railMars.offsetTop + railMars.offsetHeight / 2 - railLine.offsetTop;
    railGeo = { L, mY, ind: railInd.offsetHeight, marsAt: marsTrack.getBoundingClientRect().top + scrollY, max: document.documentElement.scrollHeight - innerHeight };
  };
  function railFrame() {
    if (!railGeo) return;
    const { L, mY, ind, marsAt, max } = railGeo, y = scrollY;
    // past the Mars track top the Mars stretch follows D5's eased progress when it is running
    const mp = window.__d5?.mars?.p, after = mp != null ? clamp01(mp) : clamp01((y - marsAt) / Math.max(1, max - marsAt));
    const v = y < marsAt ? lerp(0, mY - ind - 14, clamp01(y / marsAt)) : lerp(mY + 14, L - ind, after);
    css(railInd, 'transform', `translate3d(0,${v.toFixed(1)}px,0)`);
  }
  const goTo = (y, dur = 2.2) => { const l = smooth(); l ? l.scrollTo(y, { duration: dur }) : scrollTo({ top: y, behavior: RM ? 'auto' : 'smooth' }); };
  qa('.d6-rail-planet').forEach(a => a.addEventListener('click', e => {
    e.preventDefault(); goTo(a.dataset.to === 'mars' ? railGeo?.marsAt ?? 0 : 0);
  }));
  // footer: Mission and Solutions jump to their sections (the rest stay as authored)
  const footTo = [() => missionRestY() + 0.3 * innerHeight, () => solST.start];
  qa('.d6-foot-link').slice(0, 2).forEach((a, i) => {
    a.setAttribute('href', i ? '#solutions' : '#mission');
    a.addEventListener('click', e => { e.preventDefault(); goTo(footTo[i](), 2); });
  });

  // ---------- nav legibility: a short black fade behind it while it sits over the hero / Series B media ----------
  const navShade = document.createElement('div');
  navShade.className = 'd6-nav-shade'; navShade.setAttribute('aria-hidden', 'true');
  q('.d6-nav').before(navShade);
  let navShadeOn = false;
  const navShadeFrame = on => { if (on !== navShadeOn) { navShadeOn = on; navShade.classList.toggle('is-on', on); } };

  // ---------- clipping containers must never scroll (focusing a link inside used to shove the card up) ----------
  for (const el of [stage, sb, solStage, sbUi]) el?.addEventListener('scroll', () => { if (el.scrollTop || el.scrollLeft) { el.scrollTop = 0; el.scrollLeft = 0; } });

  // ---------- Series B play: stub dialog until the film is in ----------
  const play = q('.d6-play');
  let modal = null, modalBack = null;
  function closeModal() {
    if (!modal) return; const m = modal; modal = null;
    document.removeEventListener('keydown', modalKeys, true);
    gsap.to(m, { opacity: 0, duration: RM ? 0 : 0.3, onComplete: () => m.remove() });
    const l = smooth(); l?.start?.();
    modalBack?.focus({ preventScroll: true });
  }
  function modalKeys(e) {
    if (!modal) return;
    if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
    if (e.key === 'Tab') { // focus trap: the close button is the only stop
      const f = qa('button, [href], [tabindex]:not([tabindex="-1"])', modal);
      if (!f.length) return; const a = f[0], b = f[f.length - 1];
      if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); } else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
      else if (!modal.contains(document.activeElement)) { e.preventDefault(); a.focus(); }
    }
  }
  function openModal() {
    if (modal) return;
    modalBack = document.activeElement;
    modal = document.createElement('div');
    modal.className = 'd6-modal'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', 'Series B film');
    modal.innerHTML = '<div class="d6-modal-msg">Series B film coming soon</div><button class="d6-modal-x" type="button" aria-label="Close"><span></span><span></span></button>';
    modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('.d6-modal-x')) closeModal(); });
    page.appendChild(modal);
    document.addEventListener('keydown', modalKeys, true);
    const l = smooth(); l?.stop?.();
    gsap.fromTo(modal, { opacity: 0 }, { opacity: 1, duration: RM ? 0 : 0.35 });
    q('.d6-modal-x', modal).focus({ preventScroll: true });
  }
  play?.addEventListener('click', e => { e.preventDefault(); openModal(); });
  D6.openModal = openModal;

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
  const after = q('.d6-after');
  measure(); measureRail(); measureMission();
  let released = false;
  function frame() {
    // all layout reads first, then this frame's style writes (no forced layout mid-frame)
    if (solRunning || !geo) measureSolGeo();
    const p = heroST.progress, sr = stage.getBoundingClientRect(), marsTop = marsTrack.getBoundingClientRect().top;
    const introBottom = intro.getBoundingClientRect().bottom;
    const afterTop = after ? after.getBoundingClientRect().top : 1e9, exitPx = scrollY - solST.end;
    const mr = missionIn.getBoundingClientRect(), morphNow = enterST.progress; // the mission copy under the nav also gets the shade
    // 3D hero lifecycle: released while Mars is near, rebuilt as the stage comes back within ~1.5 viewports
    if (HERO3D && D6.t.heroRelease) released = true;
    if (HERO3D && released && !hero && !heroBuilding && marsTop > innerHeight * 2.5 && introBottom > -1.5 * innerHeight) buildHero(true);
    if (sr.bottom > 0) heroFrame(p);
    heroRunFrame(p, sr);
    kbFrame(sr.bottom > 0 && sr.top < innerHeight);
    for (const v of vids) vidOn(v, v.classList.contains('d6-hero-video') ? !heroOn && sr.bottom > 0 && p < 0.8 : sr.bottom > 0 && p > 0.3);
    solFrame(mr.top, exitPx); const marsOp = marsFrame(marsTop, exitPx, afterTop); railFrame();
    // nav shade: over the hero / Series B media, the mission copy passing under it, and the Mars layer (colony is bright)
    navShadeFrame((sr.bottom > innerHeight * 0.15 && p > 0.12) || (mr.top < innerHeight * 0.12 && mr.bottom > 0 && morphNow < 0.3) || (marsOp > 0 && afterTop > innerHeight * 0.15));
  }
  gsap.ticker.add(frame);
  let rz = 0;
  addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => {
    if (hero) { hero.resize(); heroKey = ''; } measure(); measureRail(); measureMission(); solApi?.resize?.();
  }); });
  addEventListener('pointermove', e => { if (hero && heroRun && e.pointerType === 'mouse') hero.setPointer(e.clientX / innerWidth * 2 - 1, e.clientY / innerHeight * 2 - 1); }, { passive: true });
  ST.addEventListener('refresh', () => { measure(); measureRail(); measureMission(); });
  D6.hero = p => heroFrame(p); // QA hooks
  D6.st = { heroST, missionST, enterST, solST, outST, marsST };

  function afterLoader() {
    // warm the solutions scene early (topo fetch + geometry) without competing with the loader
    (window.requestIdleCallback || (f => setTimeout(f, 300)))(() => loadSolutions(), { timeout: 1500 });
  }
}
