# TerraFirma: prototype to production handoff

Written Mon 2026-11-09, from prototype commit `bc7d95d` (live on tf-prototype.webflow.io/direction-6-1).

This repo (`devinscottfountain/tf-d5`) is the **prototype**. Freeze it. The real site gets a new Webflow build (Fountwind, from Tim's Figma) and a new repo that ports only the Direction 6.1 code path.

## The rule for the real site
- **Webflow owns all 2D**: text, tabs, cards, images, video, links, the carousel (CMS), modal copy, nav, footer links. The client must be able to swap any image, video or line of copy in the Designer without touching JS.
- **Three.js owns only the canvases**: hero scene, Solutions terrain, Mars run, 3D footer. Each mounts into a Webflow element and reads anything content-like (images, video URLs, copy) from the DOM or `data-*` attributes.
- Prototype debt to undo: a few things are hardcoded in JS today (see "Hardcoded content" below).

## What to port (6.1 path only)

| Piece | Prototype files | Entry / API | Notes |
|---|---|---|---|
| Page glue | `d61/main.js` (58 KB) | runs on import | Loader gating, nav/rail, scroll wiring, lazy-loads everything else. **Rewrite, don't copy.** It's welded to the prototype's `.d6-*` / `.d61-*` class names. Use it as the reference for timing and load order. |
| Loader | `d6/loader.js` | `createProgress(weights)`, `runLoader({ THREE, el, minMs, maxMs, progress, fallbackMs: 6000, onExit })` | Real progress. Stages and weights: page 5, modules 25, build 10, compile 25, tex 25, sol 5, frame 5. Never reveals before the first real frame. After 6 s it shows the poster and keeps loading. |
| Perf governor | `d61/perf.js` | `perf.level`, `perf.onChange`, `perf.frame(dt)`, `perf.bench()`, `perf.idle(fn)`, `d5Adapter`, `capAdapter` | Levels 0 to 4 per canvas. Recovers after emergency drops on 60 Hz screens. `?perf=log` prints decisions. Port as-is. |
| Hero | `d6/hero3d.js` + `hero-room/outside/cab/screens/mini/glsl/tex.js`, `hero-model-*.js`, `d6/assets/models`, `d6/assets/tex` | `createHero({ THREE, host, quality, still, exit: 'under' })` returns `setScreenMedia`, `setCopyOpacity`, `pickScreen(x, y)`, `setPixelRatio`, `real` | `exit: 'under'` is the 6.1 scroll-off pan plus night-to-day. Critical textures: `HERO_CRITICAL`. Right monitor = `hero-mini.js` (mini Mission Control loop); clicks go through `bindScreenClicks`. |
| Solutions terrain + game | `d6/solutions.js`, `sol-game.js`, `sol-machines.js`, `d6/assets/topo.bin` | `createSolutions({ THREE, host, topoUrl, quality })` returns `setScene({ fitPad, dotTop })`, `warm()` | Tab order: Orchestration first. The tabs themselves should be Webflow tabs or plain DOM; the canvas only listens. |
| Mars run | `d5/main.js` (112 KB) + `planets.js`, `sky.js`, `habitat.js`, `machines.js`, `rockets.js`, `post.js`, `d5/assets` | `window.D5_CFG = {...}` then `import('d5/main.js')`. Mounts to `.d5-canvas`, drives off `.d5-track`. `onProgress(p, beat)` every frame, `window.__d5.mars.p` | See "Strip on port". Also imports `d61/foot-model-starship.js` + `foot-model-kit.js` for the rockets. |
| Footer | `d61/footer3d.js`, `foot-glsl.js`, `foot-model*.js`, `foot-tex.js`, `d61/assets/tex` | `createFooter({ THREE, host, quality, base })` returns `ready`, `setProgress(p)`, `setPointer(x, y)`, `setLogoRect`, `setPostQuality`, `start/stop/resize/dispose` | Same colony at dusk. `setProgress` 0 to 1 drives the sunrise. Shares `colonyLayout()` from `d5/habitat.js`. |
| Post / grade | `d5/post.js` | `createPost({ THREE, renderer, scene, cam, cine: true })`, `setPostQuality(level)` | Used by hero, Mars and footer. Cine chain: TAA, bloom, ACES warm grade, SMAA/FXAA, grain .04, vignette .3. Anamorphic flares built but off (`__d5.post.look.streak = 0.2` turns them on). |

### Strip on port
`d5/main.js` still carries all of D5 (Earth, Moon, the Austin site via `site.js`, the intro timeline, veil, scroll lock) behind `MM = CFG.mode === 'mars'`. For production:
- Hard-code the 6.1 flags (`mode:'mars', look:'lit', beats:true, rockets:true, cine:true`) and delete the branches they switch off. About 17 `MM ?` ternaries plus the non-Mars blocks.
- `site.js` (43 KB), the Earth/Moon textures and the D5 intro are likely dead after that. Check with a bundle or coverage pass before deleting.
- Kill the QA hooks you don't need (`__d5.seek`, `__d5.path`, etc.), or gate them behind `?qa`.
- The old D5 lander pad is already hidden under rockets (`pad.visible = !ROCK`). It goes away entirely once the flags are hard-coded.

## Mars timeline (scroll progress `p` on the Mars track)
- Track: 800vh desktop, 700vh phones
- Beat 1 "One day / on Mars": planet in the word gap
- Beat 2: the two SpaceX lines on black
- Entry .40 to .60, planet-to-colony swap at .46
- Descent .46 to .62, city grows .62 to .88
- Rockets: ships land at gR 0 to .064 (before the domes), the new ship builds .30 to .76, ignition .80, liftoff .83
- Ignition .88 to .90, launch .90 to 1.12
- CTA rises from p 1.0
- SOL counter hits 0206 at p .985

The beat copy is DOM text that `d5/main.js` measures and positions (`frameBehind`, `frameBeat`), so it can live in Webflow. Keep those elements as real text in the new build.

## Hardcoded content to move into Webflow
- `d6/hero3d.js` `SERIES_B`: the Series B still URL. Read it from the Series B card's image instead.
- Hero monitor media (`setScreenMedia`): needs Webflow media slots (`data-` attributes or hidden images and videos the hero reads).
- `d61/main.js:500` builds the "Try Mission Control" button text in JS. Make it a Webflow element.
- Modal copy (`.d6-modal-msg`, `.d61-sb-modal-msg`): it's in the DOM already. Keep it there and don't regenerate it in JS.
- "Our tech in action" carousel: should become a CMS collection (title, poster, video URL). The JS only handles arrows and swipe.

## Page dependencies
- three@0.160.0 via importmap (`three`, `three/addons/`). Addons used: `SVGLoader`, `RoomEnvironment`, `ShaderPass` and postprocessing.
- Globals from the Webflow head: `gsap`, `ScrollTrigger`, `SplitText`, `lenis` (the code checks `window.lenis` and works without it).
- Head preloads that matter for the loader: modulepreload `three`, page main, `perf.js`, `loader.js`, `hero3d.js`, the two addons; `preload` of the hero webp; `body{background-color:#000}`.
- Quality tier: `?q=low|high` override; phones, coarse pointers under 820 px and ≤2-core machines get `low`. Hero is 3D at ≥768 px without reduced motion, poster otherwise (`?hero=3d` / `?hero=0` force it).

## Budgets that held in the prototype
- M4 Pro worst frames: colony 9 ms, pre-Mars 9.4 ms, CTA + footer 9.3 ms. Hero GC is 12 KB/frame.
- No shader compiles mid-scroll: everything warms off-screen via `perf.idle` before it's visible (`footerWarmWindow`).
- Extra download target: ≤ ~6 MB high / ~2 MB low past the hero. Assets right now: `d5/assets` 8.2 MB (includes D5-only Earth/Moon), `d6/assets` 4.1 MB, `d61/assets` 1.9 MB.

## Hosting
Prototype: jsDelivr `cdn.jsdelivr.net/gh/<repo>@<sha>/...`, pinned per commit in the page head and footer. Short SHAs work. That's fine for production too (or move to a bundled build). Either way, pin versions; never point at `@main`.

## Open issues (design review #1 on `be78799`, plus perf)
1. Square seam in the Mars terrain (blocker)
2. Nav shade reads as a dark lid over the Mars track
3. Launch framing loses the ground; the glow under the rocket is a disc and should be plume-shaped
4. CTA top edge is a hard cut. Feather it with a ~160px gradient.
5. Starship material: matte beige in the colony, dark in the footer. Unify.
6. Planet limb sparkles; halo too creamy
7. Entry streaks look like hyperspace
8. Faceted hab domes
9. Phone SOL counter reads 0017 where desktop reads 0090
10. Footer foreground slab; unlit parked ships
11. Program count creeps up on phones
12. Planet-to-colony swap hitch was 167 ms on a real GPU. A fix landed (`4bae612`) but was only verified in swiftshader.
13. Not yet measured on an M1/M2 Air (target is 60 fps at 1440p)
14. Decode the 4k Mars map off-thread; small per-frame allocations in the colony
15. On Fast 3G and slower, the code lands after the 6 s fallback, so visitors get the poster first. That's by design, but worth testing.
16. Phone Mission Control dig zone runs off-screen

## Notes worth keeping
- Briefs and decisions: `d6/BRIEF.md`, `d6/HERO-CONTRACT.md`, `d61/BRIEF.md`, `d61/CINEMA.md` (cinematic brief, all settled decisions), `d61/CINEMA-NOTES.md` (agent notes, reviews, perf logs).
- Look: *For All Mankind* / *The Martian* warm, subtle film treatment (grain hides aliasing), flares only on the strongest lights.
- The cyber shroud GLB was run through gltfpack (`-si 0.1 -cc`, 19k tris, 122 KB). It needs `toCreasedNormals(geo, PI/6)` and is mounted 180° (vents face the boom).
- Starships are uniform stainless (no black tile side). Ships land before the domes go up.
- Tim's Figma: file `XCCTVzFivyIw11FDb1IH53`, 6.1 section `22954:281`. His Dev Mode annotations are the spec for 6.1 behaviour.
