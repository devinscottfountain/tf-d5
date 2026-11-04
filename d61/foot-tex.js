// D6.1 footer texture streamer (WIP, roles fixed). Mars dusk settlement. Files in ./assets/tex/ (see CREDITS.md),
// some shared from ../d6/assets/tex/ by URL. Same loader pattern as d6/hero-tex.js.
// Each role set: { map, normalMap, roughnessMap, aoMap, metalnessMap, texScale } (ORM: R ao, G rough, B metal).
// texScale = metres per UV repeat (number or [u, v]). Roles:
//   regolith       dark red dusty ground, fine pebbles (texScale 4)
//   mars_rock      boulders / ridge rock, red-brown basalt (texScale 3, triplanar or box UV)
//   dome_glass     { roughnessMap, dirtMap } same texture: R = dust/smudge mask, G = roughness (texScale 1.5)
//   dome_frame     painted off-white geodesic strut metal, light wear (texScale 0.5)
//   foliage        dense leafy canopy for the greenery inside the dome (texScale 0.6)
//   habitat_panel  off-white composite hab panels, seams + rivets, dust at bottom of v (texScale [2, 2])
//   stainless      Starship 304L stainless, brushed along u, faint weld bands (texScale 1)
//   rover_paint    white rover paint, chips + dust (texScale 1)
//   dusk_sky       { map, envMap (PMREM), intensity } warm Mars dusk equirect for scene.environment / reflections
