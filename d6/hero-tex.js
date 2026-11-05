// D6 hero texture streamer. Tileable PBR sets (WebP) + night sky HDR from ./assets/tex/ (see assets/tex/CREDITS.md).
// Never blocks: images decode off-thread, one GPU upload per frame, roles publish as they land, failures resolve null.
// Per role set: { map, normalMap, roughnessMap, aoMap, metalnessMap, texScale } where the last three share one ORM
// texture (R = ao, G = roughness, B = metalness, three.js convention). Special roles:
//   glass_smudge      { roughnessMap, dirtMap }  same texture: R = dirt mask, G = roughness
//   tyre_track_decal  { map (RGBA, alpha = decal mask; use transparent + depthWrite false), normalMap }, v = travel direction
//   dirt_tracks       { map, normalMap } rutted, tracked mud in the dirt_ground palette, ruts run along v (texScale 3: dozer-scale ruts).
//                     The terrain blends it over worked ground; high tier only.
//   night_sky_hdr     { map: equirect (HDR on high, LDR on low), envMap: PMREM of it, intensity } for scene.environment
// texScale = metres covered by one UV repeat (number, or [u, v]).
// A set only carries the maps its materials sample (rusty_metal, brushed_metal: normal + ORM; excavator_paint: colour),
// so no bytes go to maps nobody binds.

export const TEX_ROLES = [
  'concrete_floor', 'desk_laminate', 'black_plastic', 'brushed_metal', 'ceiling_panel', 'carpet', 'fabric_chair', 'glass_smudge',
  'night_sky_hdr', 'dirt_ground', 'dirt_tracks', 'gravel', 'excavator_paint', 'tyre_track_decal', 'rock_ridge', 'rubber_track', 'rusty_metal',
];

// [texScale, high set, low set | null]; set = colour / normal / orm dirs ('1k' | '512' | '256')
const P = (c, n, o) => ({ c, n, o });
const M = {
  concrete_floor: [2, P('1k', '1k', '512'), P('512', '512', '256')],
  dirt_ground: [4, P('1k', '1k', '512'), P('512', '512', '256')],
  dirt_tracks: [3, P('512', '512', null), null],
  gravel: [1.5, P('1k', '1k', '512'), P('512', null, '256')],
  excavator_paint: [2, P('1k', null, null), P('512', null, null)],
  rock_ridge: [6, P('512', '512', null), null],
  rusty_metal: [2, P(null, '1k', '512'), null],
  desk_laminate: [1, P('1k', '1k', '512'), P('512', '512', '256')],
  black_plastic: [0.25, P('512', '512', '256'), P('512', '512', '256')],
  brushed_metal: [0.5, P(null, '512', '256'), null],
  ceiling_panel: [1.2, P('512', '512', '512'), null],
  carpet: [1, P('512', '512', '512'), null],
  fabric_chair: [0.12, P('512', '512', '512'), null],
  rubber_track: [[0.5, 1], P('512', '512', '512'), null],
  glass_smudge: [1.5, P(null, null, '512'), null],
  tyre_track_decal: [[0.6, 1.2], P('256', '256', null), P('256', '256', null)],
};
const SKY = { hdr: 'night_sky.hdr', ldr: '512/night_sky_ldr.webp', ldrScale: 0.5 }; // LDR stores linear * 2

export function texFiles(quality = 'high') {
  const lo = quality === 'low', out = [];
  for (const r of TEX_ROLES) {
    if (r === 'night_sky_hdr') { out.push(lo ? SKY.ldr : SKY.hdr); continue; }
    const s = M[r][lo ? 2 : 1]; if (!s) continue;
    if (s.c) out.push(`${s.c}/${r}_c.webp`); if (s.n) out.push(`${s.n}/${r}_n.webp`); if (s.o) out.push(`${s.o}/${r}_orm.webp`);
  }
  return out;
}

// roles: subset to stream (default all); the hero passes only the roles its materials bind
export function loadHeroTextures({ THREE, renderer, quality = 'high', base, roles = TEX_ROLES } = {}) {
  const lo = quality === 'low';
  const want = [...new Set(roles)].filter(r => TEX_ROLES.includes(r)); // caller's order is the stream order
  let root = String(base || new URL('./assets/tex/', import.meta.url)); if (!root.endsWith('/')) root += '/';
  const sets = new Map(), listeners = new Set(), owned = [];
  let disposed = false;
  const maxAniso = renderer?.capabilities?.getMaxAnisotropy?.() || 1;
  const aniso = Math.min(lo ? 4 : 16, maxAniso);   // the site is seen near edge-on: max anisotropy keeps ground grain past 20 m

  // one upload (or PMREM build) per frame; falls back to a timer when rAF is throttled (hidden tab)
  const queue = []; let pumping = false;
  const nextFrame = () => new Promise(res => { let done = false; const go = () => { if (!done) { done = true; res(); } };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(go); setTimeout(go, 100); });
  function upload(job) { return new Promise((res, rej) => { queue.push({ job, res, rej }); pump(); }); }
  async function pump() {
    if (pumping) return; pumping = true;
    while (queue.length) {
      await nextFrame();
      const q = queue.shift();
      if (disposed) { q.res(null); continue; }
      try { q.res(q.job()); } catch (e) { q.rej(e); }
    }
    pumping = false;
  }

  // bounded parallel fetch + decode
  let active = 0; const waiting = [];
  const slot = () => active < 4 ? (active++, Promise.resolve()) : new Promise(r => waiting.push(r));
  const release = () => { const n = waiting.shift(); if (n) n(); else active--; };
  const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');

  async function loadImageTex(file, srgb) {
    await slot();
    let tex;
    try {
      tex = await new Promise((res, rej) => loader.load(root + file, res, undefined, () => rej(new Error('tex 404 ' + file))));
      if (tex.image?.decode) await tex.image.decode().catch(() => {});
    } finally { release(); }
    if (disposed) { tex.dispose(); return null; }
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.anisotropy = aniso;
    tex.generateMipmaps = true; tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.name = file; tex.needsUpdate = true;
    return upload(() => { renderer?.initTexture?.(tex); owned.push(tex); return tex; });
  }

  function publish(role, set) {
    sets.set(role, set);
    for (const fn of listeners) { try { fn(role, set); } catch (e) { console.warn('hero-tex listener', e); } }
  }

  async function loadRole(role) {
    const def = M[role], s = def[lo ? 2 : 1];
    if (!s) return null;
    const [c, n, o] = await Promise.all([
      s.c ? loadImageTex(`${s.c}/${role}_c.webp`, true).catch(warn) : null,
      s.n ? loadImageTex(`${s.n}/${role}_n.webp`, false).catch(warn) : null,
      s.o ? loadImageTex(`${s.o}/${role}_orm.webp`, false).catch(warn) : null,
    ]);
    if (!c && !n && !o) return null;
    let set;
    if (role === 'glass_smudge') set = { roughnessMap: o, dirtMap: o };
    else if (role === 'tyre_track_decal') set = { map: c, normalMap: n };
    else set = { map: c, normalMap: n, roughnessMap: o, aoMap: o, metalnessMap: o };
    for (const k in set) if (!set[k]) delete set[k];
    set.texScale = def[0];
    return set;
  }

  async function loadSky() {
    let tex = null, intensity = 1;
    if (!lo) {
      try {
        await slot();
        try {
          const { RGBELoader } = await import('three/addons/loaders/RGBELoader.js');
          tex = await new RGBELoader().setDataType(THREE.HalfFloatType).loadAsync(root + SKY.hdr);
        } finally { release(); }
      } catch (e) { warn(e); }
    }
    if (!tex) { tex = await loadImageTex(SKY.ldr, true).catch(warn); intensity = SKY.ldrScale; }
    if (!tex || disposed) return null;
    tex.mapping = THREE.EquirectangularReflectionMapping; // mapping is a shader define, no re-upload needed
    if (!owned.includes(tex)) owned.push(tex);
    const envMap = renderer ? await upload(() => {
      const g = new THREE.PMREMGenerator(renderer); const rt = g.fromEquirectangular(tex); g.dispose(); owned.push(rt); return rt.texture;
    }).catch(warn) : null;
    const set = { map: tex, intensity, texScale: 1 }; if (envMap) set.envMap = envMap;
    return set;
  }

  function warn(e) { if (!disposed) console.warn('hero-tex:', e?.message || e); return null; }

  const jobs = want.map(role => (role === 'night_sky_hdr' ? loadSky() : loadRole(role))
    .catch(warn).then(set => { if (set && !disposed) publish(role, set); return set; }));
  const inTier = role => role === 'night_sky_hdr' || !!M[role][lo ? 2 : 1];
  const ready = Promise.all(jobs).then(r => ({
    loaded: want.filter((_, i) => r[i]),
    failed: want.filter((role, i) => !r[i] && inTier(role)),
    skipped: TEX_ROLES.filter(role => !want.includes(role) || !inTier(role)), // not shipped on this tier (low): materials keep their flat look
  }));

  return {
    ready,
    roles: want,
    get: role => sets.get(role) || null,
    // fn(role, set) runs as each role lands (and once now if some already have); safe to reapply idempotently
    onReady(fn) {
      listeners.add(fn);
      if (sets.size) queueMicrotask(() => { for (const [r, s] of sets) if (listeners.has(fn)) fn(r, s); });
      return () => listeners.delete(fn);
    },
    files: () => texFiles(quality),
    dispose() { disposed = true; listeners.clear(); for (const t of owned) t.dispose?.(); owned.length = 0; sets.clear(); },
  };
}
