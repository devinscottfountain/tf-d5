// D6.1 adaptive quality governor, shared by hero, Mars (D5) and footer. One instance per page (window.__perf).
// Each 3D layer is a "layer" with its own level (their costs differ ~3x); Mars has two segments (space, colony).
// Inputs: the page's own rAF interval while a layer is the active renderer, a GPU tier guess, and a short idle-time bench
// (render + 1 px readback, so vsync does not hide the headroom). Output: a level 0..4 per layer, read as a quality object
// { pr, post, shadow, particles }. Levels step one at a time with hysteresis, and only while the scroll is idle or the
// layer is off screen (an emergency drop may land mid-scroll). Layers apply levels through adapters (bottom of file).
// Also: an idle warm-up queue (one job per idle slot, never while a heavy layer is in a critical stretch) and a turn
// gate so two heavy contexts never both draw full rate in the same frame.
// Contract: perf.level, perf.onChange(fn), perf.frame(dt). QA: ?perf=log logs every change, ?perf=4 pins a level.

// level ladder: pr = min(layer max, device ratio, pr, sqrt(px / css pixels)); post = GRADE post quality 0..3
export const LEVELS = [
  { pr: 0.75, px: 1.0e6, post: 0, shadow: 0.5, particles: 0.4 },
  { pr: 1.0, px: 1.6e6, post: 1, shadow: 0.5, particles: 0.6 },
  { pr: 1.0, px: 2.4e6, post: 2, shadow: 1, particles: 0.8 },
  { pr: 1.25, px: 3.0e6, post: 3, shadow: 1, particles: 1 },
  { pr: 1.5, px: 3.7e6, post: 3, shadow: 1, particles: 1 },
];
const TOP = LEVELS.length - 1;
const MISS = 20, HITCH = 250;        // ms: a frame over MISS missed 60 fps; over HITCH it is a one-off (compile, GC), not throughput
const BUDGET = 14;                   // ms of bench cost (CPU + GPU serialized; live frames overlap them) that still holds 60 fps
const WIN = 45, COOL = 1500, UP_HOLD = 3000, PROBATION = 20000, APPLY_WAIT = 2500, WARMUP = 600;

const now = () => performance.now();
const ric = typeof requestIdleCallback === 'function' ? (f, o) => requestIdleCallback(f, o) : f => setTimeout(() => f({ timeRemaining: () => 8, didTimeout: false }), 60);
const qs = typeof location !== 'undefined' ? new URLSearchParams(location.search) : new URLSearchParams();
const LOG = qs.get('perf') === 'log', PIN = /^[0-4]$/.test(qs.get('perf') || '') ? +qs.get('perf') : null;

// GPU tier guess from the unmasked renderer string: start level before anything is measured
export function guessTier(gl, quality) {
  if (quality === 'low') return 1;
  let s = '';
  try { const e = gl && gl.getExtension('WEBGL_debug_renderer_info'); s = String(gl ? gl.getParameter(e ? e.UNMASKED_RENDERER_WEBGL : gl.RENDERER) : ''); } catch (_) { /* unknown */ }
  if (/swiftshader|llvmpipe|softpipe|software/i.test(s)) return 0;
  if (/apple m\d+ (pro|max|ultra)|nvidia|geforce|rtx|radeon (rx|pro)|amd radeon/i.test(s)) return 4;
  if (/apple m\d/i.test(s)) return 3;                       // base M1/M2/M3 (Airs): bench decides 2 or 3
  if (/intel.*(iris|arc)|radeon/i.test(s)) return 2;
  if (/intel/i.test(s)) return 1;                           // UHD and older
  if (/apple gpu/i.test(s)) return 3;                       // Safari hides the model
  if (/adreno|mali|powervr/i.test(s)) return 1;
  return 3;
}

function stats(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), at = p => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, p50: at(0.5), p90: at(0.9), p95: at(0.95), worst: s[s.length - 1] };
}

export function createPerf() {
  const layers = new Map(), subs = new Set();
  let tier = 3, vsync = 16.7, lastRaf = 0, active = null, scrollT = 0, frameN = 0;
  const vs = [];                                            // idle rAF intervals, to find the display refresh
  const hist = new Map();                                   // full-run frame log per layer:segment (QA, capped)

  function layer(name) {
    let L = layers.get(name);
    if (!L) {
      L = { name, seg: 'main', segs: new Map(), prMax: 1.5, apply: null, on: false, since: 0, want: 0, wantT: 0, adapter: null };
      layers.set(name, L);
    }
    return L;
  }
  function segOf(L, seg = L.seg) {
    let S = L.segs.get(seg);
    if (!S) {
      S = { level: PIN ?? tier, applied: -1, dts: [], cool: 0, upT: 0, ceil: TOP, drops: {}, probe: 0, bench: null, benching: false, refine: 0 };
      L.segs.set(seg, S);
      const k = L.segCost?.[seg], sib = k && [...L.segs.values()].find(x => x.bench && !x.bench.est);
      if (sib) { S.bench = { ms: sib.bench.ms * k, pr: sib.bench.pr, est: true }; fromBench(L, S); } // e.g. colony ~1.8x space until it is benched
    }
    return S;
  }
  const quality = (L, lv) => {
    const d = LEVELS[lv], css = (typeof innerWidth === 'number' ? innerWidth * innerHeight : 1.3e6) || 1.3e6, dpr = typeof devicePixelRatio === 'number' ? devicePixelRatio : 1;
    const pr = Math.max(0.5, Math.floor(Math.min(L.prMax, dpr, d.pr, Math.sqrt(d.px / css)) * 20) / 20);
    return { level: lv, pr, post: d.post, shadow: d.shadow, particles: d.particles };
  };
  const scrolling = () => {
    const l = (typeof lenis !== 'undefined' ? lenis : window.lenis) || null;
    if (l && Math.abs(l.velocity || 0) > 0.05) scrollT = now();
    return now() - scrollT < 220;
  };
  if (typeof addEventListener === 'function') { addEventListener('scroll', () => (scrollT = now()), { passive: true }); addEventListener('wheel', () => (scrollT = now()), { passive: true }); }

  // push a segment's level into the layer when it is safe (scroll idle or layer off screen) or overdue
  function settle(L, force) {
    const S = segOf(L);
    if (S.level === S.applied || !L.apply) return;
    const t = now();
    if (!force && L.on && scrolling() && t - (L.wantT || t) < APPLY_WAIT) { if (!L.wantT) L.wantT = t; return; }
    L.wantT = 0; S.applied = S.level; S.dts.length = 0; S.cool = Math.max(S.cool, now() + WARMUP); // the window measured the old level
    if (S.byBench && S.refine < 1 && quality(L, S.level).pr !== S.bench?.pr) { S.refine++; S.bench = null; } // one re-bench at the new ratio (the cost model is rough)
    S.byBench = false;
    const q = quality(L, S.level);
    try { L.apply(q); } catch (e) { console.warn('perf apply ' + L.name, e); }
    if (LOG) console.log('[perf]', L.name, L.seg, 'level', S.level, q);
    for (const f of subs) { try { f(S.level, q, L.name, L.seg); } catch (_) { /* listener gone */ } }
  }
  function step(L, S, d, why) {
    if (PIN != null) return;
    const lv = Math.max(0, Math.min(S.ceil, S.level + d));
    if (lv === S.level) return;
    if (d < 0) { S.drops[S.level] = (S.drops[S.level] || 0) + 1; if (S.drops[S.level] >= 2) S.ceil = Math.min(S.ceil, lv); S.probe = now() + PROBATION; }
    S.level = lv; S.cool = now() + COOL; S.upT = 0; S.dts.length = 0; S.byBench = false; S.refine = 9; // live evidence rules from here
    if (LOG) console.log('[perf]', L.name, L.seg, d < 0 ? 'down' : 'up', why);
  }
  // pick a level from a bench (ms at the applied pr): cost ~ 25% fixed + 75% pixels
  function fromBench(L, S) {
    const b = S.bench; if (!b) return;
    const px = q => q.pr * q.pr, base = px({ pr: b.pr });
    let best = 0;
    for (let lv = 0; lv <= S.ceil; lv++) { const q = quality(L, lv), est = b.ms * (0.25 + 0.75 * px(q) / base); if (est <= BUDGET) best = lv; }
    best = Math.max(S.level - 2, Math.min(S.level + 1, best)); // a bench moves at most 2 down / 1 up; live frames do the rest
    if (PIN == null && best !== S.level) { if (LOG) console.log('[perf]', L.name, L.seg, 'bench', b, '->', best); S.level = best; S.cool = now() + COOL; S.byBench = true; }
  }

  // one sample per page frame, attributed to the active layer (perf.frame may also be called by a layer loop)
  function sample(dt, name) {
    const L = name ? layer(name) : active; if (!L || !L.on) return;
    const S = segOf(L), t = now();
    const k = L.name + ':' + L.seg; let h = hist.get(k); if (!h) hist.set(k, (h = [])); if (h.length < 20000) h.push(dt);
    if (t - L.since < WARMUP || dt > HITCH) return;          // arrival frames and one-off hitches say nothing about throughput
    S.dts.push(dt); if (S.dts.length > WIN) S.dts.shift();
    if (S.dts.length < WIN || t < S.cool) return;
    const st = stats(S.dts), miss = S.dts.filter(x => x > MISS).length;
    const recent = S.dts.slice(-10).filter(x => x > 33).length;
    if (recent >= 6 && S.level > 0) { step(L, S, -1, 'emergency p90 ' + st.p90.toFixed(1)); settle(L, true); return; }
    if (miss > WIN * 0.12 || st.p90 > MISS) { step(L, S, -1, 'p90 ' + st.p90.toFixed(1) + ' miss ' + miss); return; }
    // headroom is only visible above 60 Hz: holding 120 fps means at least 2x spare
    const fast = vsync < 12 && st.p90 < vsync * 1.25;
    if (fast && S.level < S.ceil && t > S.probe) { if (!S.upT) S.upT = t; else if (t - S.upT > UP_HOLD) step(L, S, +1, 'headroom p90 ' + st.p90.toFixed(1)); }
    else S.upT = 0;
  }

  function raf(t) {
    requestAnimationFrame(raf);
    const dt = lastRaf ? t - lastRaf : 0; lastRaf = t; frameN++;
    if (!dt) return;
    if (dt < 40) { vs.push(dt); if (vs.length > 240) vs.shift(); if (vs.length >= 60 && frameN % 30 === 0) { const s = [...vs].sort((a, b) => a - b); vsync = s[Math.floor(s.length * 0.1)]; } } // refresh = the short end of all intervals
    if (active && active.on && !active.selfTimed) sample(dt);
    for (const L of layers.values()) settle(L);
  }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(raf);

  // idle warm-up queue: one job per idle slot, serialized; a job may return a promise (the next waits for it)
  const jobs = []; let jobRun = false, hold = null;
  function pumpJobs() {
    if (jobRun || !jobs.length) return; jobRun = true;
    ric(async dl => {
      const j = jobs[0];
      const blocked = (hold && hold()) || (dl && dl.timeRemaining && dl.timeRemaining() < (j.need || 6) && !dl.didTimeout);
      if (blocked) { jobRun = false; setTimeout(pumpJobs, 80); return; }
      jobs.shift();
      try { await j.fn(); } catch (e) { console.warn('perf job ' + (j.name || ''), e); }
      jobRun = false; pumpJobs();
    }, { timeout: 2000 });
  }

  const api = {
    LEVELS,
    get tier() { return tier; }, get vsync() { return vsync; },
    // contract: level of the active layer (or the tier guess before any layer runs)
    get level() { return active ? segOf(active).level : tier; },
    get quality() { return active ? quality(active, segOf(active).level) : quality(layer('_'), tier); },
    onChange(fn) { subs.add(fn); return () => subs.delete(fn); },
    frame(dt, name) { const L = name ? layer(name) : active; if (L) { L.selfTimed = true; sample(dt, L.name); } },
    setTier(gl, q) { tier = PIN ?? guessTier(gl, q); return tier; },
    // register a layer: apply(q) pushes a quality object into it; prMax caps its pixel ratio (its own top)
    register(name, { apply, prMax = 1.5, gl, quality: qy, segCost, prNow } = {}) {
      const L = layer(name); L.apply = apply; L.prMax = prMax; L.segCost = segCost; L.prNow = prNow; for (const S of L.segs.values()) S.applied = -1; // a rebuilt layer takes the level again
      if (gl && !layers.__tiered) { layers.__tiered = true; api.setTier(gl, qy); for (const x of layers.values()) for (const S of x.segs.values()) if (S.applied < 0) S.level = Math.min(S.ceil, PIN ?? tier); }
      settle(L, true); return L;
    },
    // the page says which layer is drawing this frame, and which segment (e.g. mars 'space' / 'colony')
    active(name, on, seg) {
      const L = layer(name), was = L.on;
      if (seg && seg !== L.seg) { L.seg = seg; segOf(L); L.since = now(); settle(L, true); } // segment switch: its own level, applied at once (callers switch under a cover)
      L.on = !!on; if (on && !was) { L.since = now(); segOf(L).dts.length = 0; settle(L, true); }
      if (on) active = L; else if (active === L) active = [...layers.values()].find(x => x.on) || null;
    },
    // one-off bench of a layer's frame in idle time: fn renders once; gl is read back 1 px so the GPU cost counts
    bench(name, fn, gl, { n = 4, seg, force } = {}) { // force: the caller knows the layer is warm (e.g. the loader, before the reveal)
      const L = layer(name), S = segOf(L, seg || L.seg);
      if (S.benching || (S.bench && !S.bench.est)) return Promise.resolve(S.bench);
      if (!force && (!L.on || now() - L.since < 2000 || L.seg !== (seg || L.seg))) return Promise.resolve(null); // warm and settled first (compiles, uploads)
      S.benching = true; const ms = [], px = new Uint8Array(4), t00 = now();
      const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      return new Promise(res => {
        const one = dl => {
          if (!L.on && !force) { S.benching = false; return res(null); }
          if (scrolling() && now() - t00 < 4000) { ric(one, { timeout: 1500 }); return; } // a re-queued rIC restarts its timeout, so cap the wait here
          let t0; try { sync(); t0 = now(); fn(); sync(); } catch (_) { S.benching = false; return res(null); } // drain the live frames queued on the GPU first
          ms.push(now() - t0);
          if (ms.length < n) { ric(one, { timeout: 1500 }); return; }
          ms.sort((a, b) => a - b); S.bench = { ms: ms[ms.length >> 1], pr: (L.prNow && +L.prNow()) || quality(L, S.applied < 0 ? S.level : S.applied).pr }; // the ratio really drawn S.benching = false;
          fromBench(L, S); res(S.bench);
        };
        ric(one, { timeout: 1500 });
      });
    },
    // idle warm-up queue; need = ms of idle time the job wants per slot. hold(fn): jobs wait while fn() is true
    idle(fn, { name, need } = {}) { return new Promise(res => { jobs.push({ fn: async () => res(await fn()), name, need }); pumpJobs(); }); },
    holdIdle(fn) { hold = fn; },
    // turn gate: another heavy layer is drawing (solo false), so this one should hold its loop and draw 1 frame in n
    solo(name) { for (const L of layers.values()) if (L.on && L.name !== name && L.heavy !== false) return false; return true; },
    turn(n = 3) { return frameN % n === 0; },
    // per-frame wiring from d61/main.js: registers layers as they appear, flags which one is drawing, benches in idle time
    page(s) { pageTick(api, s); },
    stats() {
      const out = {};
      for (const [k, a] of hist) { const s = stats(a); out[k] = s && { n: s.n, p50: +s.p50.toFixed(1), p95: +s.p95.toFixed(1), worst: +s.worst.toFixed(1) }; }
      for (const L of layers.values()) for (const [seg, S] of L.segs) (out[L.name + ':' + seg] || (out[L.name + ':' + seg] = {})).level = S.level, out[L.name + ':' + seg].bench = S.bench;
      return { tier, vsync: +vsync.toFixed(2), active: active && active.name, layers: out };
    },
    reset() { hist.clear(); },
  };
  return api;
}

// ---------- page wiring (d61/main.js calls perf.page once per frame) ----------
const reg = { hero: null, d5: null, foot: null };
function pageTick(perf, { hero, heroRun, foot, footRun, quality } = {}) {
  if (hero && hero !== reg.hero && hero.renderer) { reg.hero = hero; perf.register('hero', { apply: capAdapter(hero), prMax: 1.5, gl: hero.renderer.getContext(), quality, prNow: () => hero.stats?.().pixelRatio }); }
  const heroOn = !!(hero && heroRun); perf.active('hero', heroOn);
  if (heroOn) perf.bench('hero', () => hero.renderOnce(), hero.renderer.getContext());
  if (foot && foot !== reg.foot && foot.renderer) { reg.foot = foot; perf.register('footer', { apply: capAdapter(foot), prMax: 1.5, gl: foot.renderer.getContext(), quality, prNow: () => foot.stats?.().pixelRatio }); }
  const footOn = !!(foot && footRun); perf.active('footer', footOn);
  if (footOn) perf.bench('footer', () => foot.renderOnce(), foot.renderer.getContext());
  const d5 = typeof window !== 'undefined' ? window.__d5 : null;
  if (d5 && d5.mars && d5.renderer && d5.post && d5 !== reg.d5) {
    reg.d5 = d5; perf.register('mars', { apply: d5Adapter(d5), prMax: d5.quality === 'low' ? 1 : 1.5, gl: d5.renderer.getContext(), quality, segCost: { colony: 1.8 }, prNow: () => d5.renderer.getPixelRatio() });
  }
  if (reg.d5) {
    const on = !!d5.mars.on, seg = d5.mars.beat === 3 ? 'colony' : 'space'; // beat 3 starts at the entry swap (CA), under the veil
    perf.active('mars', on, seg);
    if (on) perf.bench('mars', () => d5.post.render(), d5.renderer.getContext(), { seg });
  }
}
// footer warm-up: during Mars beats 1-2 only the planet draws (~4 ms), the cheapest stretch before the footer
export const footerWarmWindow = () => { const m = typeof window !== 'undefined' && window.__d5?.mars; return !!(m && m.on && m.p > -0.1 && m.p < 0.38); };

// ---------- adapters: how each layer takes a quality object ----------
// D5 (Mars): renderer pixel ratio + post resize, GRADE post quality, and the Choreographer's optional shadow/particle hook
export function d5Adapter(d5) {
  let pr = -1;
  return q => {
    if (q.pr !== pr) { pr = q.pr; d5.renderer.setPixelRatio(q.pr); d5.post.setSize(innerWidth, innerHeight); d5.post.resetMotion?.(); }
    d5.post.setQuality?.(q.post);
    d5.setQuality?.(q);                                     // shadows / particles: d5/main.js hook (CINEMA-NOTES)
  };
}
// footer / hero: their own loops already re-size on a quiet frame; we only move the cap
export const capAdapter = api => q => { api.setPixelRatio?.(q.pr); api.setPostQuality?.(q.post); };

export const perf = (typeof window !== 'undefined' && window.__perf) || createPerf();
if (typeof window !== 'undefined') window.__perf = perf;
