
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
