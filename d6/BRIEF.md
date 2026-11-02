# Direction 6 brief (designer: Tim)

Webflow page `/direction-6` on the TF Prototype site (NOT linked from the index). Same stack as D5:
three@0.160.0 via importmap in the page head, GSAP + ScrollTrigger + Lenis + SplitText loaded by the site,
our ES modules served from jsDelivr pinned by commit SHA: `https://cdn.jsdelivr.net/gh/devinscottfountain/tf-d5@<sha>/d6/main.js`.
Webflow markup/CSS is authored in `/home/claude/tf/d6.html` + `/home/claude/tf/d6.css` (see d3/d5 files there,
`build.py` resolves `IMG:name` from `assets.py` and converts px to vw via `px2vw.py`; design canvas is 1600 px wide).
Fonts: Figma uses "APK Galeria" (trial): substitute **Geist** 400/500 (already loaded site-wide); mono labels **IBM Plex Mono** 500
uppercase with 0.1em tracking. Colours: bg #000, text #fff, secondary #b9b9b9, accent cyan dots #6cc0e6 / #97ddfb (see refs).
No em dashes anywhere (copy or comments). Concise comments.

## Reference frames (`d6/ref/*.png`, 1600-wide frames scaled)
0-loader, 1-hero, 2-hero-zoom, 3-seriesb-mission, 4-mission-to-planner, 5-control, 6-execution, mission-block.
`ref/d5-live.html` is the live D5 page markup (class names main.js expects).

## Assets
Webflow CDN (`https://cdn.prod.website-files.com/6ae4c2b96de64cf78d486e72/<id>_<name>`), CORS OK:
- `6ae8ed33c6dae18c84b3f0a8_d6-hero.webp` 1920x1080: control room at night, three monitors (centre = dozer cab view). Hero background. (Figma treats it as a video still; keep a `<video>`-ready slot.)
- `6ae8ed33c51d167d8d66b21b_d6-seriesb.webp` 1920x1080: Deere 700 dozer, Series B "video" still.
- `6ae8ed505306bea0897d9909_d6-rail-earth.webp`, `6ae8ed50e85649c5dd53e962_d6-rail-mars.webp` 96 px planet icons for the right rail.
Repo (`d6/`):
- `assets/topo.bin`: topographic contour map from Figma (1774.5 x 1195.6 design units, frame offset x=-312 in the 1600 frame, sits lower-right behind the mission copy). Format, little endian: `u32 nSub`, `u32 len[nSub]`, then `i16 x*10, i16 y*10` per point (polylines, y down). 992 polylines, 48k points. Figma styled it white stroke ~0.6 opacity with a left-to-right fade (gradient from x=1774 opaque to x=583 transparent) and a bottom-to-top black fade.
- `fig/ld1.svg` 50x50: TerraFirma mark (circle T/F), use for the 3D extruded loader logo (SVGLoader -> ExtrudeGeometry).
- `fig/logo1.svg` wordmark letters 207x25, `fig/logo2.svg`/`logo3.svg` mark variants, `fig/logo4.svg` 165x20.
- `fig/ld2.svg` loader HUD ring (215x224, rotate-copies ticks), `fig/ld3.svg`/`ld4.svg` 519x6 dotted lines with gradient (left/right of the ring), `fig/ld5-7.svg` ellipses, `ld8/9` tick marks.
- `fig/play.svg` 64x64 play button; `fig/m9.svg` 42x42 CTA plus box; `fig/m6.svg` 8x8 CTA notch corners; `fig/m1.svg` 5x5 corner bracket; `fig/m5,m8,m10` rail ticks.

## Storyboard (Tim's Loom, condensed)
1. **Loader, 1 to 2 s.** Black grid bg, TF mark spinning on its axis in 3D with a slight extrude, HUD ring around it, the cyan dot lines either side animate out / draw in, `LOADING...` mono label. Quick. Then fades into the hero text + background.
2. **Hero.** Control-room photo background, "Redefining construction from the ground up" (H1, left), lead copy right, centred logotype nav, "Join our team" outline button top right. As you scroll it keeps zooming into the photo (frame 2 = zoomed toward the centre monitor, text fading) and **morphs into the Series B video** card (frame 3: full-bleed rounded card 1520x839 at x40 y132 in a 1600 frame, play button + "Announcing our Series B", vertical tick scale at right edge). Video plays in background with small UI.
3. **Mission.** Topographic map draws in (stroke draw) while the copy reveals (OUR MISSION label, H2 "Technology to solve the biggest infrastructure challenges on Earth, and one day on Mars", white CTA "Learn more about our mission" + plus box, two paragraphs, corner brackets). Then fades as you scroll into Solutions, **the map turning into the dot grid**.
4. **Solutions** ("SOLUTIONS" label, H2 "Advancing construction with human-in-the-loop autonomy through Planning, Orchestration, and Operation", 3 tab cards: PLANNING / Mission Planner / "AI-enabled pre-con software suite for project bidding, planning, simulation, and execution."; ORCHESTRATION / Mission Control / "Remote Command-and-Control center to tightly coordinate dynamic construction operations."; EXECUTION / Accelerated Operations / "Retrofitted heavy machinery that can be remotely operated by small, highly efficient crews.". Active card is filled #151515 with corner brackets and a rule.)
   - Planning: overhead view of the dot grid, white wireframe machines seen from above with cyan polygon zones (corner handles).
   - Mission Control: click/scroll tilts into 3D, terrain dots swell into waves, the little game from Direction 3 (`/home/claude/tf/d3.js`: draw a zone, excavator digs it), HUD cards: "EXCAVATOR SN-20 / IDLE" table (HEIGHT 415.63 FT, YAW -7.14°, ROLL 0.47°, BODY 2.89°, SPEED 1.0, live values) and "BLADE LEVEL" gauge.
   - Accelerated Operations: land flattens, three big white wireframe machines (excavator, backhoe loader, single-drum roller) drive in slowly.
5. **Skip the Moon, go to Mars**: reuse D5's Mars (planet with text behind it, then the Jezero colony build), then a plain closing section (CTA + footer).
Right rail: Earth icon top, Mars icon lower, thin line with tick marks and a moving indicator (progress).

## Module interfaces (agreed, don't change without telling the integrator)
`d6/solutions.js`
```js
export function createSolutions({ THREE, host /* element, canvas fills it */, topoUrl, quality /* 'high'|'low' */ }) -> {
  ready: Promise,                 // topo + geometry built
  setScene({ topo, morph, mode, modeT, flatten }), // all 0..1 except mode (0 plan,1 control,2 exec); call per frame from scroll
  //   topo: contour draw-in progress, morph: contours -> dot grid, modeT: progress inside the current mode
  setMode(i),                     // click on a tab: animate to that mode (internal tween)
  onTelemetry(fn),                // fn({ height, yaw, roll, body, speed, state, blade }) ~10 Hz while in control mode
  resize(), start(), stop(), dispose()
}
```
`d5/main.js` Mars mode: page sets `window.D5_CFG = { mode: 'mars' }` before `import('../d5/main.js')`. Same markup hooks as D5
(`.d5-canvas`, `.d5-track`, `.d5-after`, `.d5-hud`, overlays), only the Mars part of the journey; renders only while its track is near the viewport.
`d6/main.js` page orchestrator: loader, nav, hero zoom -> Series B, mission, drives `solutions.setScene` from ScrollTrigger, lazy-imports d5 Mars mode.
