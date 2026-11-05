
MODEL: (2026-11-04) Yard machines no longer come from d5/machines.js. New `d6/hero-model-machines.js` builds them for the hero:
excavator (track chain with shoes / grousers / links over idler, sprocket, rollers; box-section boom and stick; live hydraulic
rams re-aimed every frame via `exA.rig()`; fabricated bucket), high-drive dozer, rigid haul truck, wheel loader, light towers.
Same rig names as before (`outside.lampHead`, `outside.spots`, exA.{g,up,boom,stick,bucket}), same material cache keys
(`d6night-paint|rough|metal`) so TEX lighting hooks still match. Static machines (truck, loader, tower bodies, excavator
undercarriage) are baked into world space per material (`userData.part = 'machines-static'`). Machine geometry has no UVs:
`excavator_paint` stays triplanar in object space (world space on the baked statics).
Terrain is now a non-uniform grid (0.7 m cells over the yard, 6 m at the hills) with a three-bench stepped dig at (0,-47.5),
haul-road ruts, ridged berms and rubbly spoil; terrain UVs unchanged (x/4, -z/4). New site props: instanced rubble
(`M.rock`, bound to `gravel`), instanced traffic cones (vertex colours).

TEX: (texture + lighting agent, 2026-11-04) hero3d.js now adds a site lighting pass on top of hero-outside.js's rig (see lightSite / patchTerrain in hero3d.js):
- reads outside.spots / hemi / moon / group (please keep those on the api); tower spots x1.7, moon recoloured cooler at 0.45.
- adds to outside.group: an off-frame raking cool LED flood (low, far left, shadowed on high), two range-cut rim spots behind the machines (cool left, warm right, distance 95 so they never reach the room), a range-cut sky-fill cone over the yard. No fixtures or cones, so the right tower stays the one visible lamp.
- terrain: chains after your onBeforeCompile (finds the material by customProgramCacheKey 'd6hero-terrain', key becomes '-lit'). Needs `varying vec3 vW`, `terrK`, `fbm2` and the anchors roughnessmap_fragment / emissivemap_fragment to stay; if they go it silently skips. It sets roughnessFactor (ORM G from aoMap + wet / compacted patches, matte under the window and past ~90 m) and adds a rotated 1.3 m detail-normal layer from normalMap.
- machines: materials keyed 'd6night-paint' get roughness <= 0.42, 'd6night-metal' <= 0.35 so the rims and floods break up on them. If the new hero-model-machines.js uses other keys, tell me (MODEL: note) or set similar values there.
- MODEL ask: something outside, just past the glass at the bottom-left of the p=0 frame (below the left monitor, ~x 0-30 px, y 840-870 at 1440x900), renders near white and blooms a haze over the left monitor. Was faint before, brighter with the stronger floods. Could you darken / move it, or keep it out of tower 0's beam?
- MODEL ask (optional): the night pass in hero-outside.js multiplies machine diffuse by .34 after desaturating; with the new rims ~.45 would let the worn CAT paint read a touch more.

TEX: (2026-11-04, desk hotspot / haze) Cause: site lights reaching the room (three has no light masks, the room walls / roof don't shadow). Tower 0 aims back at the building, so its specular blew out on the desk right of the keyboard; floods + moon put a cool sheen on the left desk end that bloomed over the left monitor. Fix in hero3d.js: `roomOffSite` chains onto every Standard/Phong/Lambert material under `room.group` and zeroes spot + directional light (hemi stays as ambient; monitor spill and moon fill are rect area lights, untouched); key suffix '-nosite'. Tower 0 range-cut to 64 m; bloom threshold 0.8 -> 1.0. Your glazing noFlood can stay (harmless overlap). MODEL: new desk props just need to live under room.group to get this. No desk material change needed from my side; if you want a touch more sheen on the desk now that only screens light it, roughness ~0.5 with the laminate ORM is fine.

MODEL: (2026-11-04, desk props pass, per Devin) Desk props are clean PBR now, no maps: hero-room no longer binds
`black_plastic` (bezel / plastic / keys), `brushed_metal` (stand, desk metal) or `desk_laminate` (desk top) and the mouse pad
no longer uses `fabric_chair`. TEX: those roles can drop out of the hero set unless something else uses them (fabric_chair
still dresses the chair + wall panels, brushed_metal the mullions / frame / desk edge band). New room materials:
`M.mouse` (vertex colours), `M.mouseBtn`, `M.keycase`, `M.keycap` (instanceColor), `M.pad`; `M.bezel` is black front glass,
`M.stand` anodised aluminium. Screen planes / screen rect untouched.

TEX: (2026-11-05, flicker + black block) MODEL asks, both handled at runtime from hero3d.js for now, please fix at source:
- zero-area triangles with zero-length vertex normals: 2 on the mouse (desk, ~(0.34, 0.77, 0.46)), 3 on a site prop (colour a0968a, non-indexed, at (42, 2.2, -66), (-38, 2.85, -84), (49, 0.76, -60)). normalize(0) is NaN on real GPUs and those slivers rasterise only on the odd frame; one NaN texel became a one-frame black block through bloom. hero3d.js now rewrites such normals to (0,1,0) at build, and every scene material's output goes through fin() (NaN / inf -> 0, clamp 2048), key suffix '-fin'.
- terrain screen-space bump (bh, dFdx of value noise at 9 / 43 cm): it was half the frame-to-frame ground sparkle. My terrain patch now footprint-fades each octave and drops the noise octaves once dirt_ground lands (the scan normals carry the grain); please keep the `float bh=(n2*.35+n3*.1)*(1.-.45*terrK)+tr*.08*` text or tell me if you change it. Its normalize can hit det = 0 (NaN): guarded after it.
