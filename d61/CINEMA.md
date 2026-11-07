# D6.1 cinematic pass: Mars run + footer (Sat 2026-11-07, deadline 20:30 ET)

Devin's brief: make the Mars section and the footer "as slick as possible: performant, smooth, gorgeous, cinematic". Settled decisions (do not relitigate; ask the coordinator if blocked):

## Scope: one continuous film
1. Beat 1 "One day / on Mars" (lit planet in the word gap, clear air, never bite letters)
2. Beat 2 SpaceX lines around the planet (copy on black)
3. Flash / atmospheric entry, must read as a DESCENT, not a cut, and not flat orange
4. Colony timelapse: ships land first, then the city grows, rovers + lights + a few tiny suited figures, a ship built on the pad, ENDING WITH THE BUILT ROCKET LAUNCHING (plume, light sweep across domes, dust wave, camera tilts up to follow)
5. Fade into the CTA, no dead/black scroll
6. 3D footer: THE SAME colony seen from ground level at dusk after it's finished (same dome layout language, a second ship on the pad since the first launched, parked ships), sunrise glow on scroll in + shimmer at rest

## Look
- Warm, optimistic: *For All Mankind* / *The Martian*, grounded physical light, slightly saturated warm grade.
- Film treatment SUBTLE: light grain, gentle bloom, mild vignette, no chromatic aberration. Grain/bloom also hide aliasing. Anamorphic streak flares ONLY on the strongest lights (sun, engine plumes, launch).
- Camera: slow dollies, long continuous moves, rack-focus feel; free to re-choreograph camera, timing and scroll length. Copy, beat order and Tim's key frames are anchors.

## Gripes to fix
flat orange during entry; camera turning away from the parked ships; black stretch before the CTA; planet->colony flash reads as a cut.

## Budgets
- 60 fps on an M1/M2 MacBook Air at 1440p, adaptive quality governor keeps integrated-GPU laptops smooth at lower res. Phones keep the lighter 3D.
- Mars run up to ~9 viewports of scroll total, no dead scroll (every screen has motion or copy).
- Extra download: <= ~6 MB desktop high, <= ~2 MB low, streamed lazily when the section nears. Nothing added to the hero's critical path.
- No shader compiles mid-scroll (warm everything before it's visible). No NaN, no flicker, no z-fighting.

## Loader (Devin: "the progress isn't real")
Real progress from actual hero work (scene built, shaders compiled, first textures), min ~1 s so the animation reads, never reveal before the first real frame is drawn. After ~6 s show the poster hero + copy, keep loading, crossfade to live 3D when ready. Mars + footer stream in the background and are warmed off-screen so they never stutter on arrival.

## Isolation
6.1 only. D5 default and D6 (`{mode:'mars'}`) must stay pixel-identical: everything new behind `window.D5_CFG` flags (6.1 sets `look:'lit', beats:true, rockets:true`; add new flags as needed, e.g. `cine:true`). Prove with `/home/claude/tf/t/detqa.js` spot checks.

## Ownership (stay in your files; coordinate via `d61/CINEMA-NOTES.md`, append notes prefixed with your role)
| Role | Files |
|---|---|
| Choreographer | `d5/main.js` (Mars-mode timeline, camera paths, beat timing, flash/descent choreography, colony camera), Mars-track scroll lengths in `d61/main.js` + `/home/claude/tf/d61.css` (Mars/CTA spacing only) |
| Planet + atmosphere | `d5/planets.js`, `d5/sky.js` (planet look, space, atmosphere entry visuals, Mars sky in the colony) |
| Colony + life | `d5/habitat.js`, `d5/site.js`, `d5/machines.js` (domes, lights coming on, rovers, figures, terrain) |
| Rockets + VFX | `d5/rockets.js` (landing, build, LAUNCH, plumes, dust, light sweep) |
| Footer scene | `d61/foot-model*.js`, `d61/footer3d.js` scene/camera (same colony at dusk, ship on pad) |
| Grade / post / lens | `d5/post.js`, `d61/foot-glsl.js` (+ post wiring in `footer3d.js` coordinated with Footer) : warm grade, AA, grain, bloom, flares, shared look across Mars + footer |
| Loader | `d6/loader.js` (6.1-safe: D6 behaviour unchanged by default) + boot/gating section of `d61/main.js` |
| Performance | new `d61/perf.js` (adaptive governor, budgets, frame stats), profiling on the real GPU via the browser pane; small perf fixes anywhere after leaving a note for the owner |

`d5/main.js` is big: Choreographer owns it. Others needing a hook there add a small exported function in their own file and leave a note; Choreographer wires it.

## Practicalities
- Repo `/home/claude/tf-d5`, GitHub devinscottfountain/tf-d5 main. Commit only your files: `git fetch origin && git rebase --autostash origin/main`, push. Small commits, never revert others.
- Harnesses: `/home/claude/tf/t/` (detqa.js, mqa61.js, marsqa.js, gap61.js, foot-qa.js, d61rock.html, d61/d61h.html). Playwright chromium `--use-gl=swiftshader` is slow; chromium here can't reach jsDelivr, serve three from `/home/claude/tf/t/node_modules/three`.
- Real GPU: Devin keeps the built-in browser pane visible. Tools `mcp__remote-devices__Claude_Browser__*` (ToolSearch "mcp__remote-devices__Claude_Browser__", read the `anthropic-skills:built-in-browser` skill). Live page tf-prototype.webflow.io/direction-6-1 shows only what's published; the coordinator publishes. One pane, shared: Performance has priority; keep sessions short and reset viewport emulation after.
- Never em dashes anywhere. Concise comments. Don't publish Webflow; report SHAs to the coordinator.
