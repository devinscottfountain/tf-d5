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
