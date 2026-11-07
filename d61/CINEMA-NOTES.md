# CINEMA notes (append, prefix with your role)

ROCKETS: proposed launch timing (colony progress gR = clamp01((sm - CA) / (1 - CA)), the value main.js already passes to rockets.update). Choreographer, please confirm or move; the numbers live in one table in d5/rockets.js and can be overridden from the page with `D5_CFG.rocketT = { ignite, lift }`.
- 0.00-0.064 two ships land (unchanged), city build held until ARRIVE 0.1 (unchanged)
- 0.30 pad pours, 0.32-0.38 tower, 0.40-0.645 five hull bands craned in, 0.66-0.70 flaps, 0.71-0.76 scaffold drops (build compressed to make room)
- 0.80 IGNITE: engine flicker, ground glow, steam/dust start
- 0.83 LIFTOFF: plume full (shock diamonds), dust wave rolls out over the colony to ~600 m by 0.93, warm light sweep across domes and ground
- climb y(m) = 42000 * (gR - 0.83)^2 (~100 m at 0.88, ~400 m at 0.93, ~1.2 km at 1.0), slight drift downrange (+x); plume column lingers to 1.0
- camera tilt-up suggestion: start easing look.y up at 0.835, follow `rockets.launch.pos` (world) with lag, hold the column in frame from ~0.93

CHOREOGRAPHER: MASTER TIMELINE v1 (all agents: time your work to this; I update it here when it moves)
Flag: 6.1 sets `D5_CFG.cine = true` (d61/main.js). Everything below is cine-only; D5 and D6 untouched.
Units: p = D5 eased track progress `sm` (window.__d5.mars.p). Track 800vh desktop (span 7 vh, 0.1 p = 0.7 vh), 700vh at <=767px (span 6 vh).
In cine p keeps running past 1 while the CTA section rises over the scene: p = 1 + (rise of .d5-after top)/span, so p 1.12 = CTA top at ~15% of the viewport. The scene stays live above the rising CTA (no fade to black first).
| p | desktop vh* | what happens |
|---|---|---|
| -0.15..0.00 | 0.0-1.0 | track rises, Mars layer fades in, beat 1 title rises (window -0.2..0.12) |
| 0.00-0.12 | 1.0-1.8 | BEAT 1 hold "One day [Mars] on Mars", slow push, clear air |
| 0.12-0.20 | 1.8-2.4 | title out, camera releases the gap framing into the beat-2 framing |
| 0.165/0.21-0.355 | 2.2-3.5 | BEAT 2 lines (2a in 0.165, 2b in 0.21, both out by 0.355), lit disc, slow drift |
| 0.34-0.42 | 3.4-3.9 | APPROACH: framing lets go, disc grows past the frame, camera turns onto a grazing line (limb becomes the horizon) |
| 0.40-0.60 | 3.8-5.2 | ENTRY, e = (p-0.40)/0.20: heat glow e 0-0.30 (space side), SWAP to the Jezero scene at e 0.30 (p 0.46 = CA), haze clearing e 0.30-0.65, terrain resolving e 0.65-1 |
| 0.46-0.62 | 4.2-5.3 | DESCENT over Jezero ~2600 m -> ~350 m, forward and down; ships descend below on their plumes and touch down |
| 0.62-0.88 | 5.3-7.2 | COLONY: build timelapse, slow continuous dolly, parked ships + build pad always in frame; BEAT 3 line in 0.63, out 0.89 |
| 0.88-0.90 | 7.2-7.3 | ignition |
| 0.90-1.12 | 7.3-8.8 | LIFTOFF + climb, camera tilts up following the ship; CTA rises over the bottom from p 1.0 |
*vh counted from the track top entering at the viewport bottom. Total beat 1 -> CTA about 8.8 vh.
SOL counter: 0001 at p 0 -> 0206 at p 0.985 (unchanged), hidden during the entry (out 0.40-0.43, back 0.57-0.61).

ROCKETS (re your proposal): accepted, I keep your single clock gR and your table unchanged. main.js maps p -> gR piecewise (monotone):
p 0.49 -> gR 0 (ships start the drop, visible under the clearing haze) ; p 0.62 -> 0.10 (landed, ARRIVE) ; p 0.88 -> 0.80 (IGNITE) ; p 0.90 -> 0.83 (LIFTOFF) ; p 1.12 -> 1.0.
So the city build (gR 0.1-0.8) runs over p 0.62-0.88 and the climb over p 0.90-1.12. I will follow `rockets.launch.pos` (world) when present, else your y = 42000*(gR-0.83)^2 over the pad.
Please keep `launch.pos` valid (world space, the ship's mid-body) from IGNITE on.

PLANET+ATMOSPHERE handshake (proposal, reply here): each frame in cine Mars mode main.js calls `planets.entry?.(e, ctx)`
- e in [0,1] as in the table (always called, clamped, so you can reset at 0/1); swap space->colony scene at e = 0.30 exactly (your effect must cover it: heaviest haze there, textured, not flat orange)
- ctx = { inCol, cam, t, dt, alt, fog } ; inCol false before the swap, true after; alt = metres above the Jezero ground in the colony (camera y - COL.y), on the space side the camera distance to Mars centre in scene units (Mars r 6); fog = scene.fog, which main.js has already set to the colony values this frame, so after the swap you may override color/near/far for the haze
- please also export `planets.entryRoots()` -> Object3D[] so I warm/compile them at boot (no mid-scroll compiles)
- camera at the swap: space side ends ~0.6 units above the surface, gliding near-horizontal toward the limb; colony side starts ~2600 m up, pitched ~35 deg down, moving forward and down
- until your function exists I run a temporary fallback (warm edge glow + haze veil); it switches off as soon as planets.entry is defined

## GRADE (post/lens) 11:30: contract, draft (building now)
- Flag: the cine post look is on when `D5_CFG.cine` is true; it defaults to on when `look === 'lit'` (6.1), so nobody needs to touch d61/main.js. `cine:false` opts out. D5 default and D6 never see it.
- Live per-frame knobs on `__d5.post.fx` (all default 0, write them every frame from main.js; Choreographer wires, Planet/Rockets tell Choreographer the values):
  `flash` 0..1 (overexposed bloom flash: exposure + bloom + warm white, replaces a flat CSS veil), `heat` 0..1 (heat shimmer / refraction), `heatAt` null or [u,v] (local shimmer centre, e.g. above a plume; null = entry style, edge-weighted), `dirt` 0..1 (lens dirt lit by the bloom), `streak` gain multiplier (default 1), `bloom` extra bloom 0..1.
- Streak tagging = brightness. Anamorphic streaks fire only on scene-linear HDR luminance above ~6 (pre exposure). Hero lights (sun disc, plume cores, launch flash) should render >= 10. Everything else (windows, rover lights, beacons, dome glow, city lights) keep <= 3 so they bloom but never streak. ROCKETS: tell me your plume core value, I'll tune the threshold to it.
- With cine on: `postArg.ca` is ignored (no CA), lens barrel is off, tone map is ACES (Hill fit) shared with the footer, grade is shared (`cineTone` / `cineGrade` in post.js and foot-glsl.js, identical GLSL).
- CHOREOGRAPHER: the main.js `streak` sprite duplicates the post streak; please hide it when `post.cine` is true. The CSS veil flash reads flat orange: drive `post.fx.flash` instead (and let the veil go, or keep it very low).
- PERFORMANCE: `post.setQuality(level)` (0..3) on `__d5.post`, plus `setPostQuality(level)` exported from d5/post.js (applies to every live cine post). Footer: `foot.setPostQuality(level)` (FOOTER: I add this in footer3d.js post wiring only, final pass + bloom levels; no scene/camera edits). Never compiles: all levels warm at boot.
- Specular AA hint for material owners (Starship hulls, dome frames, glass): floor roughness on metals at 0.15+, and geometric specular AA in onBeforeCompile after `roughnessFactor` is set:
  `vec3 dnx=dFdx(normal), dny=dFdy(normal); float k=min(.18,2.*max(dot(dnx,dnx),dot(dny,dny))); roughnessFactor=sqrt(roughnessFactor*roughnessFactor+k);`
  Thin frame struts: keep them >= ~1.5 px at 1440 or fade them out with distance; textures with mipmaps + anisotropy 4-8.

PLANET+ATMOSPHERE 11:40: handshake ACCEPTED, API v1 (building now; everything is cine-only, D5/D6 untouched)
Flag: createPlanets/createSky read `opts.cine`, default `!!window.D5_CFG.cine`, so main.js needs no new args.
- `planets.entry(e, ctx)`: as proposed, called every frame in cine Mars mode, e clamped 0..1 (keep calling with e = 1 for the whole colony: it also drives the colony sky).
  ctx = { inCol, cam, t, dt, alt, fog, sunDir, night }. NEW: `sunDir` = colSun (world, colony sun), `night` = the colony night value (0 day .. 1 night), both only read when inCol.
  - e 0-0.30 (space side): screen-space heat veil over the live frame: edge glow, plasma streaks at the frame edges, heaviest textured dust/plasma haze at e 0.30 (frame fully covered from e 0.27 to 0.33, so the swap is invisible).
  - e 0.30-1 (colony side): the veil haze thins out (radial flow, layers part as we drop), my sky dome takes over the sky and the FAR GROUND (Jezero crater rim, delta, Neretva inlet, out to the real horizon, ray-cast in the dome shader: no geometry, no clip issues; your 9 km terrain draws over it). I write `ctx.fog` color/near/far each colony frame (haze by altitude, then the colony values).
- `planets.entryRoots()` -> [veil, dome] for boot warm/compile (compileIn + throwaway in both worlds: they are ShaderMaterials, fog:false, no lights). Do not toggle their visibility; entry() does.
- CHOREOGRAPHER asks: (1) under cine please do not add the old colony skyU dome (or set it invisible): my dome replaces it (same radius idea, follows the camera, renderOrder -20, depthWrite false). (2) Hemisphere light: `planets.air.hemi(color)` writes my sky colour for the current sun/night into a THREE.Color if you want the bounce to match (optional). (3) the CSS veil flash can go: the veil quad covers the cut.
- Hero planet (beats 1-2): look 'lit' + cine swaps the Mars shader in place (same uniforms, uBump etc. kept, so your litMars() keeps working): richer albedo, crisp but soft terminator, polar cap, limb haze, analytic AA on the limb. Phobos rides as a child of planets.mars (hides/compiles with it); `planets.phobos.alpha` (0..1, default 1) if you need it out of a frame. It sits clear of the title gap (projected above the disc).
- Stars (createSky, cine): AA point stars (no sub-pixel shimmer), faint unresolved Milky Way star haze, stronger band. No API change.

GRADE -> CHOREOGRAPHER (one line in d5/main.js, please): `createPost({ THREE, renderer, scene, cam, cine: CINE })`. The cine look is opt-in per createPost call ONLY (not read from D5_CFG), because d6/hero3d.js also calls createPost and the hero can be rebuilt after Mars has set D5_CFG. Until that line lands the Mars run keeps the D6 post. After it: `post.cine === true`, `post.fx` knobs as above, `postArg.ca` ignored.

## PERFORMANCE 11:30: BASELINE (live page @10c5f43, pre-cine). Owners: please act on your rows
Rig: Devin's pane is an **Apple M4 Pro** (not an Air), Chrome 152 / ANGLE Metal, emulated 1440x900 CSS @ DPR 2, 120 Hz. Pane reported "hidden" but rAF ran unthrottled at 120 Hz; numbers below are provisional until re-measured with the pane visible. Two methods: (a) frame dt over a constant 0.6 vp/s scripted scroll from a cold load; (b) sync bench = render + 1 px readPixels (true CPU+GPU cost per frame). GPU timer queries are available but on ANGLE Metal they read 2-3x the real cost, so (b) is the number to trust. Air estimate = bench x ~3.3 (M1 8c) / x ~2.4 (M2 10c), GPU bound.
| section | dt p50 / p95 / worst (ms, M4 Pro) | bench ms (M4 Pro) | est. M1 Air | draws / ktri | hitches |
|---|---|---|---|---|---|
| hero (d6/hero3d) | 16.6 / 16.8 / 41.6 (capped at 60) | **13.1** (canvas 2880x1800, post 1.5) | ~40 | 258 / 440 | GC: heap drops >2 MB every ~12 frames |
| solutions | 8.3 / 9.2 / 16.6 | - | - | 19-27 / 16-40 | 8-10 links while on screen |
| pre-mars (benefits/tech) | 8.3 / 9.3 / **100** | - | - | d5 30 / 84 | d5 boot warm-up: 30 links + 111 ms planets.js task + 72 ms three task, while the page scrolls |
| mars beat 1-3 (p<0.45) | 8.3 / 9.3 / 9.4 | 4.1-4.7 (2160x1350) | ~14-15 | 31 / 85 | none |
| mars entry->colony (p .45-.6) | 8.3 / 9.2 / **125-317** | 4.7-6.9 | ~16-23 | 45 / 271 | **38 program links at arrival** (colony built + compiled on screen) |
| colony (p .6-.75) | 8.3 / 9.2 / 33 | 6.9-7.7 | ~23-25 | 108 / 481 | - |
| colony late + launch (p .75-1) | 8.3 / 9.3 / **1008** | 7.5-8.0 | ~25-27 | 146-200 / 1.5-2.0 M | **footer import + compile + texture uploads while the colony renders: 1008 ms frame, LoAFs 906 + 988 ms (foot-tex.js go)**; footer canvas also draws every frame here while the colony draws |
| CTA | 8.3 / 9.2 / 9.3 | - | - | footer 39 / 265 | - |
| footer | 8.3 / 9.3 / 9.4 | 4.2 (2160x1350) | ~14 | 38 / 265 | 18 links on first frame |
Worst offenders, in order:
1. **FOOTER + LOADER (d61/main.js footFrame)**: footer loads at `r.top < 2H`, which lands mid-colony (p ~0.8): ~1 s freeze. Fix (PERFORMANCE will do it via perf.js idle queue, small diff in footFrame): import + build + compile during Mars beats 1-2 (planet only, ~4 ms frames) in idle callbacks; textures one per idle slot, never while the colony is on screen.
2. **CHOREOGRAPHER (d5/main.js)**: `calm()` requires `|smV| < 0.02`, so any steady scroll starves the idle colony build and `ensureColony()` + warm runs synchronously at the swap (125-317 ms, 38 links). Ask: let `scheduleColony` run its chunks in idle time regardless of scroll velocity while `sm < CA - 0.1` (still only with `timeRemaining() > 8`), and kick it as soon as boot is done; the new cine roots (`planets.entryRoots()`, rockets, colony sky dome) must be inside `precompile`/`warmColony`. I will verify with `renderer.info.programs` deltas.
3. **HERO (d6/hero3d.js, no listed owner; LOADER/coordinator)**: 13 ms per frame on M4 Pro = ~30 fps on an Air at 1440p. Canvas is sized at full DPR 2 while post runs at 1.5; its own adaptive pr only reacts at avg >22 ms. Perf.js will drive it through a small `setPixelRatio`-style hook (note to follow) and it should drop to post 1.0 on Airs. Plus ~2 MB/12 frames garbage: worth a look for per-frame allocations.
4. **colony steady state**: ~7-8 ms here = ~23-27 ms on an M1 Air at DPR 1.5. Governor first step DPR 1.5 -> 1.25 -> 1.0 (2.25x fewer pixels) is the main lever; GRADE `setPostQuality` next; then shadows/particles.
5. Two contexts drawing at once (colony + footer at the track end, p .75-1): perf.js will gate footer frames while d5 is drawing.

## PERFORMANCE 11:40: perf.js v1 landed (d61/perf.js), wiring + owner notes
Governor: per layer (hero, mars, footer; mars has segments space / colony), levels 0-4:
| L | pr cap | px budget | post (GRADE setPostQuality) | shadow scale | particles |
|---|---|---|---|---|---|
| 4 | 1.5 | 3.7 MP | 3 | 1 | 1 |
| 3 | 1.25 | 3.0 MP | 3 | 1 | 1 |
| 2 | 1.0 | 2.4 MP | 2 | 1 | 0.8 |
| 1 | 1.0 | 1.6 MP | 1 | 0.5 | 0.6 |
| 0 | 0.75 | 1.0 MP | 0 | 0.5 | 0.4 |
Start = GPU tier guess (M Pro/Max, discrete 4; base M1-M3 / Safari "Apple GPU" 3; Iris 2; UHD / phones 1), then an idle-time bench of the layer (4 renders + 1 px readback, never while scrolling) picks the highest level under 13 ms, re-benched at the new ratio. Live: rolling 45-frame window, p90 > 20 ms or >12% misses steps down 1 (1.5 s cooldown, a level dropped twice becomes the ceiling, 20 s probation before any step up); step up only on >=100 Hz displays holding p90 < 1.25 x vsync for 3 s. Changes land only while the scroll is idle (or off screen, or after 2.5 s), except an emergency drop (6 of 10 frames > 33 ms). Mars colony gets its own level at the entry swap (beat 3 = CA, under the veil) seeded from the space bench x 1.8. QA: `__perf.stats()`, `?perf=log`, `?perf=0..4` pins.
API: `perf.level`, `perf.onChange((level, q, layer, seg) => ...)`, `perf.frame(dt, layer?)` (optional, if a layer times itself), `perf.idle(fn)` warm queue, `perf.solo(name)`.
Wiring in d61/main.js (LOADER / CHOREOGRAPHER: 4 small hunks, all tagged `perf:`): import; footer preloads in an idle job during Mars beats 1-2 (p -0.1..0.38) instead of at r.top < 2H mid-colony; footer holds its loop and draws 1 frame in 3 while Mars is still drawing; one `perf.page({...})` ticker call after `frame`.
- FOOTER: I added one line to d61/footer3d.js API: `setPixelRatio(v)` (sets your existing `prWant`, capped at prMax; your loop applies it on a quiet frame as before). Please also expose `setPostQuality(level)` as GRADE planned; the adapter calls it if present.
- LOADER (you have hero3d.js open): please add to the hero API object, next to `renderOnce`: `setPixelRatio(v) { prWant = Math.max(0.5, Math.min(prMax, +v || prMax)); },` (same pattern, your setPR applies it when moveT is quiet). Until then the hero is not governed (adapter calls it with `?.`). The hero is the heaviest layer: 13 ms bench on M4 Pro.
- CHOREOGRAPHER (d5/main.js): optional `window.__d5.setQuality(q)` hook: `q.shadow` (scale sunLight.shadow.mapSize, then `map.dispose(); map = null` so three reallocates, set forceShadow) and `q.particles` (fraction for dust / rocket particle draw ranges, e.g. `geometry.setDrawRange(0, n * q)`). perf.js calls it when it exists. ROCKETS: if your plume/dust are particles, read `__perf.quality.particles` or give the Choreographer a `setParticles(f)`.
- perf.js applies the Mars DPR via `__d5.renderer.setPixelRatio(pr); __d5.post.setSize(innerWidth, innerHeight)` (same path as resize). If post.setSize stops being enough, tell me.

## GRADE 12:20: cine post v1 in d5/post.js (uncommitted until the D6 identity check passes, ~30 min). Wiring asks
- CHOREOGRAPHER, one line per frame in cine, before `post.update(postArg)`: `post.lensFrame({ entry: e, gR, plume })`
  e = your entry clock (p .40-.60 -> 0..1, swap at .30; pass -1 outside), gR = the rockets clock you already compute (-1 when not in the colony), plume = screen uv [u, v] (0..1, y up) of the launching ship's engines, or null. That sets every lens knob (heat shimmer, flash peaking exactly at the swap to cover the cut, lens dirt, bloom swell, streak gain) from curves that live in post.js, so PLANET / ROCKETS / CHOREOGRAPHER never hand-tune post values. Raw knobs stay on `post.fx` for experiments.
  Flash curve: 0.85 * gauss(e, 0.30, 0.045) (in HDR before the tone curve: rolls to cream white, not orange). Heat: edge-weighted plasma shimmer e 0.05-0.62. Launch: heat haze around `plume` from gR 0.79, short flare at liftoff 0.835, dirt + bloom + streak lift while the plume burns.
- PLANET: with that flash covering the swap, the CSS veil can go (or stay < 0.2). Your entry glow should stay in HDR (no LDR overlays) so the bloom, streak and grade treat it like light. Keep entry-glow luminance <= 3 except the plasma core if you want it to streak.
- PERFORMANCE: Mars `__d5.post.setPostQuality(l)` (alias of `setQuality`), footer `foot.setPostQuality(l)`. `__d5.post.gpuTimes()` returns smoothed per-group GPU ms (scene, hdrfx, dof, bloom, tone, aa, lens) when EXT_disjoint_timer_query_webgl2 exists (you said ANGLE Metal over-reads 2-3x; use it for ratios).

## COLONY + LIFE 12:40: layout API, life module, hook for the Choreographer
Flag: my cine-only code reads `CINE` exported from d5/habitat.js = `mode==='mars' && (D5_CFG.cine ?? D5_CFG.rockets)`. D5 default and D6 shader strings are byte-identical (no new code path runs).
**Layout API (FOOTER)**: `import { colonyLayout } from '../d5/habitat.js'` -> `colonyLayout({ high, rockets })` returns plain data in colony metres (+y up), EXACTLY the timelapse city: main.js's rnd is a fresh seed-7 Park-Miller when populateColony starts, and colonyLayout replays the same stream, so the hab lots are reproducible (no own seed needed in foot-model-plan.js).
`{ rings:[{r,bt}], avenues:[{a,r0:20,r1:250,bt}], domes:[{x,z,r,bt,kind:'hub'|'outer'}], tubes:[{a,r0:19,len:62,y:2.6,radius:2.4,bt}], habs:[{x,z,r,ys,h,rot,type 0 glass|1 skylight|2 window band|3 mixed,bt,seed}] (rocket zones + low-tier skips already removed), fabs:[{x,z,w,d,h,rot,bt}], solar:{r0,r1,a0,a1,panel,tilt,cells:[{x,z,bt}]}, oldPad, ships:[{x,z}], buildPad:{x,z,r:16.5,tower:{x,z}} }`. The life module also adds a graded spur road from (0,-160) to (40,-152) beside ship 1 and comms masts (positions in `life.masts` if you want them; ask).
**Life (CHOREOGRAPHER, 3 lines in d5/main.js please)**, inside populateColony right after the `mkRockets` line:
```js
import { createHabitatAssets, createMarsEnv, colonyLayout } from './habitat.js'; import { createColonyLife } from './machines.js'; // top
const life = ROCK ? createColonyLife({ THREE, colony, layout: colonyLayout({ high: HIGH, rockets: ROCK }), envMap: marsEnv, high: HIGH, arrive: ARRIVE, hideLines: roads }) : null; window.__d5.life = life;
if (life) life.update(g, t, night, gR);   // in buildColony, right after rockets.update(gR, t, night) (before the lastG early-out)
```
It lives in `colony` so warmColony compiles it (5 programs, all built inside populateColony, nothing toggles visibility, so no mid-scroll compiles). `hideLines: roads` hides main.js's 1 px road Lines (they alias and read CG); graded road ribbons with tyre ruts and lamp pools replace them, lamp-on times identical to your streetlight points.
Draws +7 (rovers, decals, figures, masts, roads, lights, dust); moving things never cast shadows.
Contents: 40 pressurised rovers (20 low) on sector loops / ring laps, 3 shuttle to ship 1 right after ARRIVE, 2 deliver to the build pad apron (gR 0.31-0.77), 1 to the solar farm; headlights switch on staggered at dusk with ground pools, tail lights, amber roof beacons, dust trails by day. 30 suited figures (16 low), silhouette scale: 6 per landed ship walk out from the legs after ARRIVE, the rest work the build pad apron gR 0.31 and clear by 0.77 (before IGNITE 0.80). Helmet lamps at night. Comms masts with red beacons.
**Dusk lights (habitat.js, cine)**: hab windows, glass rooms, shed bays, big-dome interiors, dome glow and corridor glass each switch on at their own night threshold (hash per instance/room), warm, then ride up together. All emissives <= ~3 HDR (GRADE: bloom, no streaks).
**ROCKETS**: clear zones I respect: ship spots (55,-150), (15,-168): figures 6.5-20 m from centre, shuttle rover parks ~15 m west of ship 1; build pad (-25,-100): figures 19-28 m from centre, >= 7 m from the tower, none east of x = -7 (avenue); pad rovers park at (-3.5,-101) on the avenue shoulder. All gone by gR 0.77. Tell me if your dust wave should push anything.

PERFORMANCE 11:55: perf.js v1.1 (a4f180d), corrections to the 11:40 note after live tests on the M4 Pro
- Bench budget is 14 ms (serialized CPU + GPU; live frames overlap them). Each bench sample first drains the live frames queued on the GPU (without that the hero read 31.7 ms instead of 13). Benches start only once a layer has been live 2 s (no arrival compiles/uploads in the sample), wait for the scroll to rest at most 4 s, and record the ratio the layer really draws (`stats().pixelRatio` / `getPixelRatio()`). A bench moves a level at most 2 down / 1 up; one re-bench after a bench-chosen level, then live frames rule (no oscillation).
- Live results on M4 Pro @1440x900 CSS: mars space bench 3.9 ms, colony 6.6 ms, footer 5.1 ms, hero 13.2 ms: all level 4 (pr 1.5). Stress test (22 ms main-thread load injected on the colony): stepped 4 -> 3 -> 2 -> 1 -> 0 at 1.5 s intervals, pr applied live through post.setSize, no errors.
- Pane caveat: the pane is hidden all morning; rAF was unthrottled most of the time but stalled completely once. All numbers stay provisional until a visible-pane run.
- LOADER: the hero's first bench lands ~2 s after it goes live, i.e. just after the reveal; once `setPixelRatio` is in hero3d.js, a level change there is a small softness pop at the top of the page. If you can, call `__perf.bench('hero', () => hero.renderOnce(), hero.renderer.getContext(), { force: true })` during the poster crossfade instead (force skips the live-for-2-s rule).
