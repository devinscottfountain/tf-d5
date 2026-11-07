// TerraFirma D6.1 page layer: D6 (loader, nav + rail, hero zoom into the Series B card, mission, solutions) plus the 6.1
// sections: solutions scene below the tab cards, benefits, tech carousel, D5 Mars beats + SOL counter, closing CTA, 3D footer.
// Reuses the D6 modules from ../d6 and D5 Mars from ../d5; the Webflow page only loads this file (importmap for three in the head).
import * as THREE from 'three';
import { runLoader, createProgress } from '../d6/loader.js';
import { perf, footerWarmWindow } from './perf.js'; // adaptive quality governor + idle warm queue (PERFORMANCE)

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
const D6 = (window.__d6 = window.__d61 = { quality: QUALITY, reduced: RM, hero3d: HERO3D, t: {}, v: '6.1' });
const stamp = k => (D6.t[k] = Math.round(performance.now())); // QA timeline

if (page && gsap && ST) init();

function init() {
  const stage = q('.d6-stage'), intro = q('.d6-intro'), media = q('.d6-hero-media'), heroImg = q('.d6-hero-img');
  const kbHero = q('.d6-hero-media .d6-kb'), kbSb = q('.d6-sb .d6-kb');
  const sb = q('.d6-sb'), dim = q('.d6-hero-dim'), copy = q('.d6-hero-copy');
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
  let hero = null, heroOn = false, heroLive = skipLoader, heroRun = false, heroGen = 0, heroBuilding = null, heroHost = null;
  const heroFade = { v: 0 };
  let fontsIn = null;
  // ---------- [LOADER] real boot progress (6.1): weighted stages fed by the actual work, never a timer ----------
  // page: fonts + poster decoded (half each). modules: hero module graph files arrived (of HERO_MODS, capped 0.95 until
  // the import resolves). build: createHero's sync scene build. compile: compileAsync jobs settled. tex: first-frame textures
  // on the GPU, by nominal texels. frame: a frame with them drawn and presented (hero.real). No 3D hero: page only.
  const HERO_MODS = 27; // static graph of d6/hero3d.js minus three itself (recount if the hero's imports change)
  const prog = createProgress(HERO3D ? { page: 5, modules: 25, build: 10, compile: 25, tex: 30, frame: 5 } : { page: 1 });
  D6.progress = prog;
  const pageDone = { fonts: 0, poster: 0 }, pageStep = k => { pageDone[k] = 0.5; prog.set('page', pageDone.fonts + pageDone.poster); };
  const bootEv = ev => {
    if (ev.stage === 'frame') prog.set('frame', 0.5); // the other half: governor bench + a frame at its ratio (heroBench)
    else if (ev.total > 0) prog.set(ev.stage, ev.done / ev.total);
    else if (ev.total === 0) prog.set(ev.stage, 1);
  };
  function watchModules(t) { // .js resources that finish after the import starts: the hero graph (other scripts only cap at 0.95)
    let n = 0, po = null;
    try {
      po = new PerformanceObserver(l => { for (const e of l.getEntries()) if (e.startTime >= t - 1 && /\.m?js(\?|$)/.test(e.name)) n++; prog.set('modules', Math.min(0.95, n / HERO_MODS)); });
      po.observe({ type: 'resource' });
    } catch (_) { /* no observer: the stage jumps at the import */ }
    return () => { po?.disconnect(); prog.set('modules', 1); };
  }
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
    const modsIn = again ? null : watchModules(performance.now());
    // [LOADER] the first-frame textures start downloading now, alongside the module graph (the hero picks the responses up)
    if (!again) import('../d6/hero-tex.js').then(m => m.preloadHeroTextures?.({ quality: QUALITY, base: new URL('../d6/assets/tex/', import.meta.url).href })).catch(() => {});
    const p = Promise.all([import('../d6/hero3d.js').then(m => (modsIn?.(), m)), fontsIn]).then(([m]) => {
      if (gen !== heroGen) return false;
      stamp(again ? 'heroRebuild' : 'heroBuild');
      // 6.1: exit 'under' (the camera sinks under the desk into black); no card target. An older hero ignores the option.
      // onBoot: progress events, textures start with the compile, hero.real = first frame with the first-frame textures
      hero = m.createHero({ THREE, host, quality: QUALITY, still: sbImg.currentSrc || sbImg.src, exit: 'under', onBoot: again ? () => {} : bootEv });
      D6.heroApi = hero; copyOpLast = -1; // a rebuilt hero gets the copy opacity again
      stamp(again ? 'heroRebuilt' : 'heroBuilt'); if (!again) prog.set('build', 1);
      if (sbVid?.classList.contains('is-on')) hero.setMedia(sbVid);
      hero.ready.then(ok => ok && stamp(again ? 'heroReady2' : 'heroReady'));
      return hero.real || hero.ready; // swap in only on a real frame (never flat placeholder materials)
    }).then(ok => (ok === false || gen !== heroGen || again ? ok : heroBench().then(() => ok)))
      .then(ok => { if (ok === false || gen !== heroGen) return false; swapIn(again); return true; }).catch(e => {
      console.warn('d6 hero:', e);
      if (gen === heroGen) { try { hero?.dispose(); } catch (_) { /* already gone */ } hero = null; D6.heroApi = null; }
      host.remove(); return false;
    }).finally(() => { if (gen === heroGen) heroBuilding = null; });
    return (heroBuilding = p);
  }
  // [LOADER] behind the loader: the governor benches the hero now (perf.js, force) so its level lands before the reveal, not
  // as a softness pop 2 s after it; then one frame at that ratio is drawn and presented. Capped at 1.5 s.
  function heroBench() {
    const h = hero, done = () => { prog.set('frame', 1); stamp('heroBench'); };
    if (!h || heroLive || !perf?.bench) { done(); return Promise.resolve(); }
    const shown = () => new Promise(r => { let k = 0; const go = () => { if (!k) { k = 1; r(); } }; requestAnimationFrame(go); setTimeout(go, 100); });
    return Promise.race([perf.bench('hero', () => h.renderOnce(), h.renderer.getContext(), { force: true }), new Promise(r => setTimeout(r, 1500))])
      .catch(() => {}).then(() => { if (hero === h) { h.renderOnce(); h.renderOnce(); } return shown(); }).then(done, done);
  }
  const heroReady = buildHero(false);
  D6.heroReady = heroReady;
  // no 3D hero after all (no WebGL, build error): nothing left to wait for, the poster is the hero
  heroReady.then(ok => { if (ok) stamp('heroReal'); else { stamp('heroNone'); for (const k of Object.keys(prog.weights)) if (k !== 'page') prog.set(k, 1); } });
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
      hero.setProgress(heroST.progress); hero.renderOnce();
      gsap.to(heroFade, { v: 1, duration: again ? 0.4 : 0.9, ease: 'power2.inOut' });
    }
    kbHeroTw?.pause();
  }

  // ---------- loader ----------
  const fontsGate = fontsP.then(splitHero);
  fontsGate.then(() => pageStep('fonts')); decodeP.then(() => pageStep('poster'));
  if (!skipLoader) {
    // [LOADER] leaves on real progress 1 (first real 3D frame presented), at least 1 s after it starts; at 6 s from navigation
    // the poster hero + copy are revealed instead and the live hero crossfades in once real (swapIn, heroSwapLate)
    const ld = runLoader({
      THREE, el: loaderEl, reduced: RM, progress: prog, minMs: 1000, fallbackMs: 6000,
      onExit: (tl, info) => { stamp('loaderExit'); if (info?.fallback) stamp('loaderFallback'); lock(false); heroLive = true; heroReveal(tl, RM ? 0.1 : 0.45); },
    });
    ld.gate(fontsGate); ld.gate(decodeP);
    D6.loader = ld.done; D6.loaderCurve = ld.curve;
    ld.done.then(afterLoader);
  } else { loaderEl?.remove(); fontsGate.then(() => { if (h1Split) { h1Split.revert(); h1Split = null; } }); afterLoader(); }
  // [LOADER] once the hero is live (loader gone, hero real or none), the Mars + footer module graphs stream into the HTTP
  // cache at low priority on idle (fetch only: nothing runs, no GPU). Their own build + warm-up (compile + hidden render)
  // stays where the owners trigger it as the sections near; their assets stay lazy (CINEMA budget).
  Promise.all([D6.loader, heroReady]).then(() => idleP(1500)).then(() => prefetchGraph([
    new URL('../d5/main.js', import.meta.url).href, new URL('./footer3d.js', import.meta.url).href, new URL('./foot-model.js', import.meta.url).href,
  ])).then(n => { D6.prefetched = n; stamp('prefetched'); }, () => {});
  function idleP(ms) { return new Promise(r => (window.requestIdleCallback || (f => setTimeout(f, 300)))(r, { timeout: ms })); }
  // fetch each module once, follow its literal imports (static and import('...')); bare specifiers through the importmap
  async function prefetchGraph(entries, cap = 80) {
    const c = navigator.connection; if (c?.saveData || /(^|-)2g$/.test(c?.effectiveType || '')) return 0;
    const had = new Set(performance.getEntriesByType('resource').map(e => e.name.split('#')[0]));
    const seen = new Set(), queue = [...entries]; let n = 0;
    const resolve = (spec, base) => { try { return /^[./]|^https?:/.test(spec) ? new URL(spec, base).href : import.meta.resolve?.(spec) || null; } catch (_) { return null; } };
    const one = async url => {
      if (seen.has(url) || seen.size >= cap) return; seen.add(url);
      if (had.has(url)) return; // already in the page (three, the hero graph): its imports are in too
      let src = '';
      try { const r = await fetch(url, { priority: 'low', credentials: 'same-origin' }); if (!r.ok) return; src = await r.text(); n++; } catch (_) { return; }
      for (const m of src.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"]([^'"\n]+\.js|three(?:\/[^'"\n]+)?)['"]/g)) { const u = resolve(m[1], url); if (u) queue.push(u); }
    };
    while (queue.length) { const batch = queue.splice(0, 2); await Promise.all(batch.map(one)); await idleP(500); }
    return n;
  }

  // ---------- Ken Burns drift on the stills (the video slot replaces them when a source is set) ----------
  // the Series B drift runs on a proxy written into the card's media layer while the card is on screen
  let kbHeroTw = null, kbSbTw = null, kbOn = null; const kbS = { scale: 1, xPercent: 0, yPercent: 0 };
  if (!RM) {
    kbHeroTw = gsap.fromTo(kbHero, { scale: 1.0, xPercent: 0.6, yPercent: 0.3 }, { scale: 1.045, xPercent: -0.8, yPercent: -0.5, duration: 18, ease: 'sine.inOut', yoyo: true, repeat: -1 });
    kbSbTw = gsap.fromTo(kbS, { scale: 1.03, xPercent: -0.8, yPercent: 0 }, { scale: 1.09, xPercent: 0.8, yPercent: -0.8, duration: 14, ease: 'sine.inOut', yoyo: true, repeat: -1 });
  }
  // both drifts pause while the stage is off screen (the hero one stays paused under the 3D canvas)
  const kbFrame = vis => {
    if (vis === kbOn) return; kbOn = vis;
    if (kbHeroTw) vis && !heroOn ? kbHeroTw.resume() : kbHeroTw.pause();
  };
  let kbSbOn = null;
  const kbFrameSb = vis => { if (vis !== kbSbOn) { kbSbOn = vis; if (kbSbTw) vis ? kbSbTw.resume() : kbSbTw.pause(); } };
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

  // ---------- hero: a short pin for the copy fade, then it scrolls off like a normal section (6.1: no hand-off) ----------
  // p runs 0..1 from the page top until the hero's bottom edge reaches the viewport top (the canvas keeps rendering while it
  // leaves, the camera pans down and the sunrise completes, createHero exit 'under'). Photo / phone path: slight parallax.
  const heroST = ST.create({ trigger: intro, start: 'top top', end: 'bottom top' });
  const pinFrac = () => Math.max(0.15, 1 - innerHeight / Math.max(1, intro.offsetHeight)); // share of p spent pinned
  function hero3dFrame(p) {
    copyFrame(p);
    css(dim, 'opacity', '0');
    css(shade, 'opacity', (1 - sstep(0.12, 0.6, p)).toFixed(3));
    const fv = heroFade.v, k = heroIntro.k;
    css(heroHost, 'opacity', fv.toFixed(3)); css(heroHost, 'visibility', fv > 0 ? 'visible' : 'hidden');
    css(heroHost, 'transform', k < 1 ? `scale(${(1 + 0.1 * (1 - k)).toFixed(4)})` : 'none');
    css(media, 'visibility', heroFade.v >= 1 ? 'hidden' : 'visible');
    hero.setProgress(p);
  }
  // run the renderer only while the stage is on screen, the loader is leaving and the canvas is still visible
  function heroRunFrame(p, sr) {
    if (!hero) return;
    const want = heroOn && heroLive && sr.bottom > 0 && sr.top < innerHeight && p < 1;
    if (want && !heroRun) { heroRun = true; if (!D6.t.heroStart) stamp('heroStart'); hero.setProgress(p); hero.start(); hero.renderOnce(); }
    else if (!want && heroRun) { heroRun = false; hero.stop(); }
    D6.heroRun = heroRun;
  }

  let copyOpLast = -1;
  // hero copy leaves with opacity + a short lift (no blur: it smeared a ghost H1)
  function copyFrame(p) {
    const f = clamp01(p / (0.9 * pinFrac())); // gone by the end of the pin
    css(copy, 'opacity', (1 - f).toFixed(3));
    if (hero && typeof hero.setCopyOpacity === 'function' && f !== copyOpLast) { copyOpLast = f; hero.setCopyOpacity(1 - f); } // lamps etc. can follow the H1
    css(copy, 'transform', f > 0.001 ? `translate3d(0,${(-24 * ease(f)).toFixed(2)}px,0)` : 'none');
    css(copy, 'visibility', f >= 1 ? 'hidden' : 'visible');
  }
  // photo hero (phones, reduced motion, no WebGL): a touch of push while pinned, then the still lags the page as it leaves
  function heroFrame(p) {
    if (heroOn) return hero3dFrame(p);
    const pf = pinFrac(), z = RM ? 0 : ease(clamp01(p / pf)), past = RM ? 0 : Math.max(0, -stage.getBoundingClientRect().top);
    css(media, 'transformOrigin', '50% 50%');
    css(media, 'transform', `translate3d(0,${(0.3 * past).toFixed(1)}px,0) scale(${(1 + 0.05 * z + 0.1 * (1 - heroIntro.k)).toFixed(4)})`);
    css(dim, 'opacity', '0'); css(media, 'opacity', '1');
    copyFrame(p);
  }

  // ---------- Series B: a plain section after the hero, revealed as it rises out of the black ----------
  const sbParts = [q('.d6-play'), q('.d6-sb-title'), q('.d6-sb-scale')].filter(Boolean);
  let sbUiOn = false;
  function sbUiFrame(on) {
    if (on === sbUiOn) return; sbUiOn = on;
    gsap.killTweensOf(sbParts);
    if (on) gsap.fromTo(sbParts, { opacity: 0, y: RM ? 0 : 10 }, { opacity: 1, y: 0, duration: 0.6, stagger: 0.2, ease: 'power3.out' });
  }
  gsap.set(sbParts, { opacity: 0 });
  // reveal: fade + a slight rise and scale, scrubbed while the card's top travels the lower part of the viewport
  function sbFrame(r) {
    if (!sb || !r) return;
    const H = innerHeight, k = RM ? (r.top < H * 0.9 ? 1 : 0) : sstep(H * 1.0, H * 0.35, r.top);
    css(sb, 'opacity', (RM ? k : 0.15 + 0.85 * k).toFixed(3));
    css(sb, 'transform', k >= 1 || RM ? 'none' : `translate3d(0,${((1 - k) * 60).toFixed(1)}px,0) scale(${(0.94 + 0.06 * k).toFixed(4)})`);
    if (k >= 0.85) sbUiFrame(true);
    kbSbFrame(RM ? 0 : 1);
    kbFrameSb(r.bottom > 0 && r.top < H);
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
  const loadSolutions = () => solStarting || (solStarting = import('../d6/solutions.js').then(m => {
    if (!m?.createSolutions) return;
    solApi = m.createSolutions({ THREE, host: solHost, topoUrl: new URL('../d6/assets/topo.bin', import.meta.url).href, quality: QUALITY });
    D6.solutions = solApi;
    solApi.onTelemetry?.(onTele);
    if (solApi.onGame) solApi.onGame(e => { if (!e || e.type === 'point') onGame(); }); else solHost.addEventListener('click', onGame);
    if (geo) solApi.setScene(geo);
    // dig game: no ground points in or just under the masked band (far ground near the horizon made zones that rose as walls)
    const g0 = solApi.game, blk0 = g0 && typeof g0.blocked === 'function' ? g0.blocked : null;
    if (g0) g0.blocked = (x, y) => (blk0 ? blk0(x, y) : false) || y - solHost.getBoundingClientRect().top < tabsBottom + Math.max(36, 0.07 * innerHeight) + 48;
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
  tabsEl.appendChild(hint); // under the tabs, left aligned: empty terrain there in every control frame
  let hintDone = false;
  function onGame() { if (!hintDone && hudOn) { hintDone = true; hint.classList.remove('is-on'); } }

  // tabs: click animates the scene and scrolls to that tab's stretch of the pin. 6.1 order: Orchestration, Planning,
  // Execution; each card's data-mode is the scene's mode id (0 plan, 1 control, 2 exec), so the tab index maps to a mode
  const TAB_MODE = tabs.map((t, i) => (t.dataset.mode != null && t.dataset.mode !== '' ? +t.dataset.mode : [1, 0, 2][i]));
  let curMode = -1, hudOn = false, clickLock = null; // curMode: active tab index
  const setActive = i => { if (i === curMode) return; curMode = i; tabs.forEach((t, k) => t.classList.toggle('is-active', k === i)); };
  setActive(0);
  const modeY = i => solST.start + ((i + 0.06) / 3) * (solST.end - solST.start);
  tabs.forEach((t, i) => t.addEventListener('click', e => {
    e.preventDefault();
    const y = modeY(i), dist = Math.abs(y - scrollY), dur = Math.min(1.8, 0.6 + dist / 2500);
    clickLock = { tab: i, until: performance.now() + dur * 1000 + 150 };
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
  let geo = null, geoKey = '', tabsBottom = 0, tabsTop = 0, geoT = 0;
  function measureSolGeo() {
    const s = solStage.getBoundingClientRect(), t = tabsEl.getBoundingClientRect();
    const rr = el => { const r = el && el.getBoundingClientRect(); return r && r.width > 1 ? { l: r.left - s.left, t: r.top - s.top, r: r.right - s.left, b: r.bottom - s.top } : null; };
    // 6.1: the scene is masked off above the cards (solMaskFrame), so its framing band starts a little lower than D6's
    // groundTop + 64: the execution fit reaches 16 px above it, so its machines keep 48 px of air below the cards (Figma ~46)
    tabsBottom = t.bottom - s.top; tabsTop = t.top - s.top;
    const mob = mobile(), hud = hudCards.map(rr);
    // phones: the telemetry card is treated as a full-width shelf, so control frames the machine above it, not squeezed beside it
    if (mob && hud[0]) { hud[0].l = 0; hud[0].r = s.width; }
    const g = { groundTop: tabsBottom + (mob ? 40 : 64), hud, fitPad: Math.round(Math.max(mob ? 24 : 28, (mob ? 0.035 : 0.05) * innerHeight)),
      dotTop: Math.max(0, (q('.d6-sol-head', solStage)?.offsetTop ?? 0) - 70) }; // lattice up behind the copy; d61.css feathers it
    const key = Math.round(g.groundTop) + '|' + g.hud.map(r => (r ? Math.round(r.l) + ',' + Math.round(r.t) + ',' + Math.round(r.r) : '')).join(';');
    // each change refits three camera solves: while the cards slide in or a card grows, push at most every 250 ms (the last value always lands)
    if (key !== geoKey) { const now = performance.now(); if (geo && solApi && now - geoT < 250) return; geoT = now; geoKey = key; geo = g; if (solApi) solApi.setScene(g); D6.solGeo = g; }
  }
  function solFrame(missionTop, exitPx) {
    const topo = clamp01(missionST.progress), morph = clamp01(enterST.progress), sp = solST.progress;
    const tabF = Math.min(sp * 3, 2.9999); let tab = Math.floor(tabF), modeT = tab === 2 ? clamp01(sp * 3 - 2) : tabF - tab;
    if (clickLock) { if (performance.now() > clickLock.until) clickLock = null; else { tab = clickLock.tab; modeT = 0.06; } }
    const mode = TAB_MODE[tab] ?? tab; // the scene eases between modes on its own clock (control -> overhead plan included)
    scene.topo = topo; scene.morph = morph; scene.mode = mode; scene.modeT = modeT; scene.flatten = mode === 2 ? sstep(0, 0.55, modeT) : 0;
    scene.missionTop = Math.round(Math.max(missionTop, restMission));
    setActive(tab);
    const on = mode === 1 && morph >= 0.999 && exitPx <= 0;
    if (on !== hudOn) { hudOn = on; hud.classList.toggle('is-on', on); hint.classList.toggle('is-on', on && !hintDone); }
    const mo = 1 - sstep(0, 0.3, morph);
    css(missionIn, 'opacity', mo.toFixed(3)); css(missionIn, 'visibility', mo > 0 ? 'visible' : 'hidden');
    // pin released: the copy and tabs lift out (0..0.28 vh) and the canvas fades to 0 and stops by EXIT.sol while the
    // benefits section rises over them
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
  let marsP = null;
  q('.d6-mline')?.remove(); // the D6 mission belt is not part of 6.1: gone before D5 collects its [data-w] overlays (CSS hides it too)
  const loadMars = () => marsP || (marsP = (window.D5_CFG = Object.assign({ ahead: 1 }, window.D5_CFG, { mode: 'mars', look: 'lit', beats: true, rockets: true, cine: true, onProgress: solcProgress }),
    import(new URL('../d5/main.js', import.meta.url).href).catch(e => console.warn('d6 mars:', e))));
  D6.loadMars = loadMars;
  // 6.1: benefits + the tech carousel sit between solutions and the track. They are opaque (z 2 over the fixed layer), so
  // the layer simply turns on once the track top is in the viewport and D5's own track fade reveals Mars under their
  // bottom edge; hidden once the closing section covers the viewport (D5 stops drawing there too)
  function marsFrame(top, exitPx, afterTop) {
    if (top < innerHeight * 2.5) { if (!marsP) loadMars(); releaseHero(); }
    const op = afterTop <= 0 || top >= innerHeight ? 0 : 1;
    css(marsLayer, 'opacity', op.toFixed(3)); css(marsLayer, 'visibility', op > 0 ? 'visible' : 'hidden');
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

  // ---------- nav legibility: a short black fade behind it while it sits over the hero / Series B media ----------
  const navShade = document.createElement('div');
  navShade.className = 'd6-nav-shade'; navShade.setAttribute('aria-hidden', 'true');
  q('.d6-nav').before(navShade);
  let navShadeOn = false, navFlow = false;
  // 6.1: over the plain scrolling sections (mission copy, benefits, tech, CTA) the shade turns into a solid scrim under the nav
  const navShadeFrame = (on, flow) => {
    if (flow !== navFlow) { navFlow = flow; navShade.classList.toggle('is-flow', flow); }
    on = on || flow; if (on !== navShadeOn) { navShadeOn = on; navShade.classList.toggle('is-on', on); }
  };
  // ---------- hero right monitor (index 2, live mini Mission Control) -> Solutions, Orchestration mode ----------
  // hit test from the hero (pickScreen, d6/hero-mini work); guarded until it lands. Same path as a tab click (Lenis aware).
  const MC_SCREEN = 2;
  const goMC = () => tabs[Math.max(0, TAB_MODE.indexOf(1))]?.click(); // the Mission Control tab (first in 6.1)
  const pickMC = e => !!(hero && heroRun && heroOn && typeof hero.pickScreen === 'function' && hero.pickScreen(e.clientX, e.clientY) === MC_SCREEN);
  let mcHover = false;
  addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse') return;
    const on = heroST.progress < 0.6 && !e.target.closest?.('a, button') && pickMC(e);
    if (on !== mcHover) { mcHover = on; stage.style.cursor = on ? 'pointer' : ''; }
  }, { passive: true });
  stage.addEventListener('click', e => { if (!e.target.closest('a, button') && heroST.progress < 0.6 && pickMC(e)) { e.preventDefault(); goMC(); } });
  // keyboard: a visually hidden button in the hero that does the same (shows itself on focus)
  const mcBtn = document.createElement('button');
  mcBtn.type = 'button'; mcBtn.className = 'd61-mc-btn'; mcBtn.textContent = 'Try Mission Control';
  mcBtn.addEventListener('click', goMC); copy.after(mcBtn);
  D6.goMC = goMC;

  const flowEls = [q('.d61-ben'), q('.d61-tech'), q('.d61-cta')].filter(Boolean);

  // ---------- clipping containers must never scroll (focusing a link inside used to shove the card up) ----------
  for (const el of [stage, sb, solStage, q('.d6-sb-ui')]) el?.addEventListener('scroll', () => { if (el.scrollTop || el.scrollLeft) { el.scrollTop = 0; el.scrollLeft = 0; } });

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
    // the message is authored in Webflow (.d61-sb-modal-msg, hidden in the card section)
    const msg = (q('.d61-sb-modal-msg')?.textContent || '').trim() || 'Series B film coming soon';
    modal.innerHTML = '<div class="d6-modal-msg"></div><button class="d6-modal-x" type="button" aria-label="Close"><span></span><span></span></button>';
    q('.d6-modal-msg', modal).textContent = msg;
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
    const reveal = (trigger, els, extra, start = 'top 82%') => {
      const tl = gsap.timeline({ paused: true });
      if (!RM && Split) {
        const sp = els.map(el => new Split(el, { type: 'lines', linesClass: 'split-line', mask: 'lines' }));
        tl.from(sp.flatMap(s => s.lines), { yPercent: 110, duration: 1.1, stagger: 0.06, ease: 'expo.out', onComplete: () => sp.forEach(s => s.revert()) }, 0);
      } else tl.from(els, { opacity: 0, duration: 0.8 }, 0);
      extra?.(tl);
      ST.create({ trigger, start, once: true, onEnter: () => tl.play() });
    };
    reveal(missionIn, qa('.d6-mission-h, .d6-p', missionIn), tl => tl.from(qa('.d6-mission-label, .d6-cta, .d6-br', missionIn), { opacity: 0, duration: 0.8, stagger: 0.08 }, 0.15), 'top 97%'); // 6.1: in as it clears the card, no black wait
    reveal(sol, [q('.d6-sol-h')], tl => tl.from(q('.d6-sol-head .d6-label'), { opacity: 0, duration: 0.8 }, 0).from(tabs, { opacity: 0, y: RM ? 0 : 24, duration: 0.9, stagger: 0.08, ease: 'power3.out' }, 0.25));
    ST.refresh();
  });


  // ================= 6.1 =================
  // ---------- solutions: the scene lives below the tab cards (canvas mask from the cards' bottom, eased in with the morph) ----------
  let cutLast = '';
  function solMaskFrame(morph) {
    const k = sstep(0.25, 0.9, morph);
    // feathered: the grid rises behind the label, H2 and cards (Figma 22920:11162), faint behind the copy (CSS ramp), full
    // at the cards' bottom
    const hd = q('.d6-sol-head', solStage), top = Math.max(0, hd ? hd.offsetTop : tabsTop - 0.2 * innerHeight), full = tabsBottom + 16; // from the label down
    const v = k <= 0 ? '0px' : Math.round(top * k) + 'px', f = k <= 0 ? '1px' : Math.round((full - top) * k + 1) + 'px';
    if (v + f !== cutLast) { cutLast = v + f; solHost.style.setProperty('--d61-cut', v); solHost.style.setProperty('--d61-fe', f); }
  }

  // ---------- SOL counter: D5 onProgress (p 0..1 over the Mars run) drives the number and the tick ----------
  const solc = q('.d61-solc'), solcN = q('.d61-solc-n'), solcInd = q('.d61-solc-ind');
  let solcP = 0, solcBeat = 1;
  function solcProgress(p, beat) { solcP = p; solcBeat = beat; D6.solc = { p, beat }; }
  function solcFrame(marsOp, afterTop, marsTop, solcW) {
    if (!solc) return;
    const m = window.__d5?.mars, on = marsOp > 0 && !!m?.on;
    const p = clamp01((m && m.p != null ? m.p : solcP) / 0.985); // the eased track progress tops out near 0.99: land on 0206
    const pr = m && m.p != null ? m.p : solcP, entry = sstep(0.40, 0.43, pr) * (1 - sstep(0.57, 0.61, pr)); // out through the atmospheric entry (D5 cine timeline)
    // in with the track, out under the closing section
    const op = on ? clamp01((innerHeight - marsTop) / (0.6 * innerHeight)) * sstep(innerHeight * 0.2, innerHeight * 0.85, afterTop) * (1 - entry) : 0;
    css(solc, 'opacity', op.toFixed(3)); css(solc, 'visibility', op > 0 ? 'visible' : 'hidden');
    if (op <= 0) return;
    txt(solcN, String(1 + Math.round(205 * p)).padStart(4, '0'));
    css(solcInd, 'transform', `translate3d(${(p * (solcW - 1)).toFixed(1)}px,0,0)`);
  }

  // ---------- tech carousel: arrows + drag/swipe, no autoplay; only the active card's video plays ----------
  const techEl = q('.d61-tech'), tvp = q('.d61-tech-vp'), ttrack = q('.d61-tech-track'), cards = qa('.d61-card');
  const tPrev = q('.d61-prev'), tNext = q('.d61-next');
  let tIdx = Math.max(0, cards.findIndex(c => c.classList.contains('is-active'))), tX = 0, tSeen = false; const tO = { x: 0 };
  // the active card aligns to the left content edge; clamped so the last card ends on the right content edge (no empty track)
  const tMax = () => { if (!cards.length) return 0; const last = cards[cards.length - 1], ml = parseFloat(getComputedStyle(tvp).marginLeft) || 0;
    return Math.max(0, last.offsetLeft + last.offsetWidth - cards[0].offsetLeft - (tvp.clientWidth - ml)); };
  const tTarget = i => (cards[i] ? -Math.min(cards[i].offsetLeft - cards[0].offsetLeft, tMax()) : 0);
  const tSet = x => { tX = tO.x = x; ttrack.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`; };
  function tGo(i, instant) {
    if (!cards.length) return;
    tIdx = Math.max(0, Math.min(cards.length - 1, i));
    cards.forEach((c, k) => { c.classList.toggle('is-active', k === tIdx); c.setAttribute('aria-hidden', k === tIdx ? 'false' : 'true'); });
    tPrev?.classList.toggle('is-off', tIdx === 0); tNext?.classList.toggle('is-off', tIdx === cards.length - 1);
    tPrev?.setAttribute('aria-disabled', String(tIdx === 0)); tNext?.setAttribute('aria-disabled', String(tIdx === cards.length - 1));
    const x = tTarget(tIdx);
    // cards pushed past the left content edge fade out instead of leaving a sliver cut by the clip
    cards.forEach(c => c.classList.toggle('is-out', c.offsetLeft - cards[0].offsetLeft + x < -2));
    gsap.killTweensOf(tO);
    if (instant || RM) tSet(x); else gsap.to(tO, { x, duration: 0.9, ease: 'expo.out', onUpdate: () => tSet(tO.x) });
    tVids();
  }
  // videos: set data-src on .d61-card-vid in Webflow; the clip fades in over the poster once it plays
  function tVids() {
    cards.forEach((c, k) => {
      const v = q('.d61-card-vid', c); if (!v || !v.dataset.src) return;
      const on = k === tIdx && tSeen && !RM; // reduced motion: the poster stays
      if (on && !v.src) { v.src = v.dataset.src; v.addEventListener('playing', () => v.classList.add('is-on'), { once: true }); }
      if (!v.src) return;
      if (on && v.paused && !v._d61busy) { v._d61busy = true; v.play().then(() => { v._d61busy = false; }, () => { v._d61busy = false; }); }
      else if (!on && !v.paused) v.pause();
    });
  }
  tPrev?.addEventListener('click', e => { e.preventDefault(); tGo(tIdx - 1); });
  tNext?.addEventListener('click', e => { e.preventDefault(); tGo(tIdx + 1); });
  for (const b of [tPrev, tNext]) b?.addEventListener('keydown', e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); b.click(); } });
  tvp?.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') tGo(tIdx - 1); else if (e.key === 'ArrowRight') tGo(tIdx + 1); });
  // drag: horizontal intent claims the gesture (vertical page scroll stays native through touch-action: pan-y)
  let drag = null;
  tvp?.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !cards.length || drag) return;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, base: tX, on: false, t: performance.now(), lx: e.clientX, v: 0 };
  });
  addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.id) return;
    if (e.pointerType === 'mouse' && !e.buttons) { dragEnd(e); return; } // released outside the window
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.on) {
      if (Math.abs(dx) < 8 || Math.abs(dx) < Math.abs(dy)) { if (Math.abs(dy) > 12) drag = null; return; }
      drag.on = true; tvp.classList.add('is-drag'); try { tvp.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
      gsap.killTweensOf(tO); drag.base = tX;
    }
    const now = performance.now(); drag.v = (e.clientX - drag.lx) / Math.max(1, now - drag.t); drag.lx = e.clientX; drag.t = now;
    const min = -tMax(), x = drag.base + dx, over = x > 0 ? x : x < min ? x - min : 0;
    tSet(x - over * 0.65); // rubber band past the ends
  }, { passive: true });
  const dragEnd = e => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag; drag = null; tvp.classList.remove('is-drag'); if (!d.on) return;
    const dx = e.clientX - d.x0, w = cards[0].offsetWidth, flick = Math.abs(d.v) > 0.45;
    let i = tIdx; if (dx < -w * 0.18 || (flick && d.v < 0)) i++; else if (dx > w * 0.18 || (flick && d.v > 0)) i--;
    tGo(i); // tweens on from the dragged position
  };
  addEventListener('pointerup', dragEnd); addEventListener('pointercancel', dragEnd);
  tvp?.addEventListener('dragstart', e => e.preventDefault());
  if (tvp) { tvp.setAttribute('tabindex', '0'); tvp.setAttribute('role', 'region'); tvp.setAttribute('aria-roledescription', 'carousel'); tvp.setAttribute('aria-label', 'Our tech in action'); }
  tGo(tIdx, true);
  function techFrame(r) {
    if (!r) return;
    const seen = r.bottom > 0 && r.top < innerHeight;
    if (seen !== tSeen) { tSeen = seen; tVids(); }
  }

  // ---------- 3D footer: lazy-imported as it nears, setProgress 0 (entering) -> 1 (at rest) ----------
  const footEl = q('.d61-foot'), footHost = q('.d61-foot-canvas');
  let foot = null, footP = null, footRun = false, footFail = false, footQ = null;
  const loadFooter = () => footP || (footP = import(new URL('./footer3d.js', import.meta.url).href).then(m => {
    if (!m?.createFooter) throw new Error('no createFooter');
    foot = m.createFooter({ THREE, host: footHost, quality: QUALITY, base: new URL('./', import.meta.url).href });
    D6.footer = foot; stamp('footBuilt');
    return foot.ready;
  }).then(() => { stamp('footReady'); footLogo(); }).catch(e => { footFail = true; try { foot?.dispose(); } catch (_) { /* gone */ } foot = null; console.warn('d61 footer:', e); }));
  D6.loadFooter = loadFooter;
  // the halo sits behind the logotype: its layout box (offsets, so the reveal transform does not skew it) in host px
  const footLogoEl = q('.d61-foot-logo');
  function footLogo() {
    if (!foot?.setLogoRect || !footLogoEl) return;
    let x = 0, y = 0, el = footLogoEl;
    while (el && el !== footEl) { x += el.offsetLeft; y += el.offsetTop; el = el.offsetParent; }
    try { foot.setLogoRect({ x: x - footHost.offsetLeft, y: y - footHost.offsetTop, w: footLogoEl.offsetWidth, h: footLogoEl.offsetHeight }); } catch (_) { /* footer gone */ }
  }
  let rmDrawn = -1, rmT = 0;
  function footFrame(r) {
    if (!r || footFail) return;
    const H = innerHeight;
    if (!footP && r.top < H * 2) loadFooter();
    else if (!footP && !footQ && footerWarmWindow()) footQ = perf.idle(loadFooter, { name: 'footer' }); // perf: build + compile while only the planet draws
    if (!foot) return;
    const vis = r.top < H && r.bottom > 0;
    // 0 as its top enters, 1 once it fills the viewport (or, when it is taller, once its bottom reaches the viewport)
    const p = clamp01((H - r.top) / Math.max(1, Math.min(r.height, H)));
    try {
      foot.setProgress(RM ? (p > 0.5 ? 1 : 0) : p);
      if (RM) { // reduced motion: no live loop (shimmer, dust, grain); a still on entry and on change, refreshed once a second for late textures
        const k = p > 0.5 ? 1 : 0, now = performance.now();
        if (!vis) rmDrawn = -1; else if (k !== rmDrawn || now - rmT > 1000) { rmDrawn = k; rmT = now; foot.renderOnce(); }
      } else {
        const solo = perf.solo('footer'), run = vis && solo; // perf: Mars still drawing, so hold the loop and draw 1 frame in 3
        if (run && !footRun) { footRun = true; foot.start(); } else if (!run && footRun) { footRun = false; foot.stop(); }
        if (vis && !solo && perf.turn(3)) foot.renderOnce();
      }
    } catch (e) { footFail = true; console.warn('d61 footer:', e); }
    D6.footP = p;
  }
  addEventListener('pointermove', e => { if (foot && footRun && e.pointerType === 'mouse') foot.setPointer?.(e.clientX / innerWidth * 2 - 1, e.clientY / innerHeight * 2 - 1); }, { passive: true });

  // ---------- 6.1 reveals ----------
  function reveals61() {
    if (RM) return;
    const once = (trigger, tl, start = 'top 80%') => ST.create({ trigger, start, once: true, onEnter: () => tl.play() });
    const lines = (els, tl, at) => {
      if (!Split) { tl.from(els, { opacity: 0, y: 16, duration: 0.9, ease: 'power3.out' }, at); return; }
      const sp = els.map(el => new Split(el, { type: 'lines', linesClass: 'split-line', mask: 'lines' }));
      tl.from(sp.flatMap(x => x.lines), { yPercent: 110, duration: 1.1, stagger: 0.06, ease: 'expo.out', onComplete: () => sp.forEach(x => x.revert()) }, at);
    };
    const ben = q('.d61-ben');
    if (ben) {
      const tl = gsap.timeline({ paused: true });
      lines([q('.d61-ben-h', ben)], tl, 0);
      tl.from(q('.d6-label', ben), { opacity: 0, duration: 0.8 }, 0)
        .from(qa('.d61-ben-row', ben).map(r => [q('.d61-ben-k', r), q('.d61-ben-p', r)]).flat(), { opacity: 0, y: 14, duration: 0.9, stagger: 0.07, ease: 'power3.out' }, 0.15)
        .from(qa('.d61-ben-rule, .d61-ben-sep', ben), { scaleX: 0, duration: 1.2, stagger: 0.08, ease: 'expo.out' }, 0.25)
        .from(qa('.d61-tick', ben), { opacity: 0, duration: 0.6, stagger: 0.03 }, 0.35);
      once(ben, tl);
    }
    if (techEl) {
      const tl = gsap.timeline({ paused: true });
      lines([q('.d61-tech-h', techEl)], tl, 0);
      tl.from(qa('.d61-tech-label, .d61-tech-nav, .d61-tech-head .d6-br', techEl), { opacity: 0, duration: 0.8, stagger: 0.08 }, 0.1)
        .from(cards, { x: 80, autoAlpha: 0, duration: 1.2, stagger: 0.1, ease: 'expo.out', clearProps: 'transform,visibility' }, 0.2);
      // cards keep their own active/dim opacity: the tween only owns visibility + transform, opacity is restored
      tl.eventCallback('onComplete', () => cards.forEach(c => (c.style.opacity = '')));
      once(techEl, tl);
    }
    const cta = q('.d61-cta');
    if (cta) {
      const tl = gsap.timeline({ paused: true });
      lines([q('.d61-cta-h', cta)], tl, 0);
      tl.from(qa('.d6-label, .d6-cta, .d6-br, .d61-dash', cta), { opacity: 0, duration: 0.8, stagger: 0.08 }, 0.15);
      once(cta, tl, 'top 95%');
    }
    if (footEl) {
      const tl = gsap.timeline({ paused: true });
      tl.from(q('.d61-foot-logo', footEl), { yPercent: 18, opacity: 0, duration: 1.6, ease: 'expo.out' }, 0)
        .from(qa('.d61-foot-row > *, .d61-foot-legal > *', footEl), { opacity: 0, y: 10, duration: 0.9, stagger: 0.06, ease: 'power3.out' }, 0.25);
      once(footEl, tl, 'top 55%');
    }
  }
  fontsP.then(() => { reveals61(); ST.refresh(); });

  // ---------- frame ----------
  const after = q('.d6-after');
  measureRail(); measureMission();
  let released = false;
  function frame() {
    // all layout reads first, then this frame's style writes (no forced layout mid-frame)
    if (solRunning || !geo) measureSolGeo();
    const p = heroST.progress, sr = stage.getBoundingClientRect(), marsTop = marsTrack.getBoundingClientRect().top;
    const introBottom = intro.getBoundingClientRect().bottom, sbR = sb?.getBoundingClientRect();
    const afterTop = after ? after.getBoundingClientRect().top : 1e9, exitPx = scrollY - solST.end;
    const mr = missionIn.getBoundingClientRect(), morphNow = enterST.progress; // the mission copy under the nav also gets the shade
    const flowRs = flowEls.map(el => el.getBoundingClientRect()), navB = innerHeight * 0.14;
    const techR = techEl?.getBoundingClientRect(), footR = footEl?.getBoundingClientRect(), solcW = solc ? solc.clientWidth : 0;
    // 3D hero lifecycle: released while Mars is near, rebuilt as the stage comes back within ~1.5 viewports
    if (HERO3D && D6.t.heroRelease) released = true;
    if (HERO3D && released && !hero && !heroBuilding && marsTop > innerHeight * 2.5 && introBottom > -1.5 * innerHeight) buildHero(true);
    if (sr.bottom > 0) heroFrame(p);
    sbFrame(sbR);
    heroRunFrame(p, sr);
    kbFrame(sr.bottom > 0 && sr.top < innerHeight);
    for (const v of vids) vidOn(v, v.classList.contains('d6-hero-video') ? !heroOn && sr.bottom > 0 && p < 0.8 : !!sbR && sbR.bottom > 0 && sbR.top < innerHeight);
    solFrame(mr.top, exitPx); solMaskFrame(morphNow); const marsOp = marsFrame(marsTop, exitPx, afterTop); railFrame();
    solcFrame(marsOp, afterTop, marsTop, solcW); techFrame(techR); footFrame(footR);
    // nav shade: over the hero / Series B media, the mission copy passing under it, and the Mars layer (colony is bright)
    const flow = flowRs.some(r => r.top < navB && r.bottom > 0) || (mr.top < navB && mr.bottom > 40 && morphNow < 0.3);
    navShadeFrame((sr.bottom > innerHeight * 0.15 && p > 0.12) || (!!sbR && sbR.top < innerHeight * 0.15 && sbR.bottom > innerHeight * 0.1) || (marsOp > 0 && afterTop > innerHeight * 0.15), flow);
  }
  gsap.ticker.add(frame);
  gsap.ticker.add(() => perf.page({ hero, heroRun, foot, footRun, quality: QUALITY })); // perf: layer flags, benches, levels
  let rz = 0;
  addEventListener('resize', () => { cancelAnimationFrame(rz); rz = requestAnimationFrame(() => {
    if (hero) hero.resize(); measureRail(); measureMission(); solApi?.resize?.();
    tGo(tIdx, true); try { foot?.resize?.(); } catch (_) { /* footer gone */ } footLogo();
  }); });
  addEventListener('pointermove', e => { if (hero && heroRun && e.pointerType === 'mouse') hero.setPointer(e.clientX / innerWidth * 2 - 1, e.clientY / innerHeight * 2 - 1); }, { passive: true });
  ST.addEventListener('refresh', () => { measureRail(); measureMission(); });
  D6.hero = p => heroFrame(p); // QA hooks
  D6.st = { heroST, missionST, enterST, solST, outST, marsST };

  function afterLoader() {
    // warm the solutions scene early (topo fetch + geometry) without competing with the loader
    (window.requestIdleCallback || (f => setTimeout(f, 300)))(() => loadSolutions(), { timeout: 1500 });
  }
}
