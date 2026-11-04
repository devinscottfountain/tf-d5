# D6 hero textures: credits and licences

## Night sky (`night_sky.hdr`, `512/night_sky_ldr.webp`, `1024/night_sky_ldr.webp`)
- "Dikhololo Night" by Poly Haven (Greg Zaal / Poly Haven team), https://polyhaven.com/a/dikhololo_night
- Licence: **CC0 1.0** (public domain). Pulled from the 1k copy mirrored in `pmndrs/drei-assets` (`hdri/dikhololo_night_1k.hdr`).
- Shipped: 256x128 RGBE HDR (high tier), 512x256 LDR WebP storing `linear * 2` in sRGB (low tier, use intensity 0.5).
  The 1024x512 LDR is an optional visible backdrop and is not loaded by `hero-tex.js`.

## Material sets (all other files)
- Procedurally authored for this project by `_src/gen_tex.py` (periodic FFT noise, wrapped Worley cells, wrapped strokes),
  encoded by `_src/build_tex.py`. No third-party pixels. Released as **CC0 1.0**.
- Poly Haven / ambientCG / cgbookcase / Share Textures were not reachable from the build container, so nothing was copied from them.
- Regenerate: `python3 -I gen_tex.py <png_dir>` then `python3 -I build_tex.py <png_dir> <night.hdr> <d6/assets/tex>`.
- Drop-in upgrade: put scanned PNG masters in `<png_dir>` named `<role>_color.png`, `<role>_normal.png` (OpenGL, green up),
  `<role>_orm.png` (R ao, G roughness, B metal; Poly Haven `_arm` maps are already this layout), 1024 px, then rerun `build_tex.py`.

## Conventions
- `_c` colour (sRGB), `_n` normal (linear, OpenGL), `_orm` packed AO / roughness / metalness (linear).
- `glass_smudge_orm`: R dirt mask, G roughness. `tyre_track_decal_c`: RGBA, alpha = decal mask, v = travel direction.
- Metres per tile (`texScale`): concrete_floor 2, ceiling_panel 1.2 (2x2 tiles of 0.6 m), desk_laminate 1, brushed_metal 0.5,
  black_plastic 0.25, carpet 1 (2x2 carpet tiles), fabric_chair 0.12, glass_smudge 1.5, dirt_ground 4, gravel 1.5,
  tyre_track_decal 0.6 x 1.2, rock_ridge 6, excavator_paint 2, rubber_track 0.5 x 1, rusty_metal 2.

## Scanned replacements (Poly Haven, CC0)
Fetched from polyhaven.com via the browser on 2026-11-02, re-encoded to WebP (colour q~0.7-0.8, normal q~0.6-0.82, ORM q0.75) at the sizes in `_src/manifest.json`. These replace the procedural sets for:

| role | Poly Haven asset |
|---|---|
| concrete_floor | concrete_floor_01 |
| ceiling_panel | ceiling_interior |
| desk_laminate | black_oak_veneer |
| brushed_metal | metal_plate_02 |
| carpet | dirty_carpet |
| fabric_chair | fabric_leather_02 (tan leather: tint dark via material.color) |
| dirt_ground | brown_mud_dry |
| gravel | gravel |
| rock_ridge | cliff_side |
| rusty_metal | rusty_metal_02 |

## Scan pass 2 (Poly Haven, CC0), 2026-11-04
Pulled from polyhaven.com (2k JPG via the browser, downsized in-browser to 1024 / 512), graded and encoded by `_src/hero_scans.py`
(run it after `build_tex.py`, which would otherwise overwrite these with the procedural masters).

| role | Poly Haven asset | changes |
|---|---|---|
| dirt_tracks (new) | muddy_tracks by Amal Kumar, https://polyhaven.com/a/muddy_tracks | regraded to the brown_mud_dry palette, 20 % darker, 1.5x contrast so the ruts survive grazing-angle mips; 512 c / n, ruts along v, texScale 3 |
| excavator_paint | green_metal_rust by Rob Tuytel, https://polyhaven.com/a/green_metal_rust | repainted CAT yellow; rust runs, pits and scratches kept as dark grime; mean luminance matched to the old set. Colour only (the night machine shader reads its luminance) |
| desk_laminate | black_oak_veneer by Jenelle van Heerden, https://polyhaven.com/a/black_oak_veneer | now 1k colour / normal + 512 ORM from the real arm map (was 512 with a flat normal); metal forced to 0 |
| rock_ridge | cliff_side (already shipped) | 512 c / n for the far ridges, mean colour divided out in the material so they keep the blue-hour tint |

Each set now ships only the maps its materials sample: rusty_metal and brushed_metal load normal + ORM, excavator_paint loads colour.
Files still on disk but not loaded by `hero-tex.js`: `1k/rusty_metal_c`, `512/brushed_metal_c`, `1k|512/excavator_paint_n`, `512|256/excavator_paint_orm`,
`1k/rock_ridge_c|n` (master for the 512s), `512/rock_ridge_orm`, `256/tyre_track_decal_*`, `512/rubber_track_*`, `night_sky.hdr` and the LDRs.

Still procedural (no CC0 scan fits): black_plastic, glass_smudge, rubber_track, tyre_track_decal (the last two are not bound by the hero).
Sky: Poly Haven dikhololo_night (CC0), not bound by the hero.

Tier totals for the 14 roles the hero binds (`HERO_ROLES` in `hero3d.js`): high 2278 KB (34 files), low 520 KB (15 files).
Before this pass: high 2144 KB, low 643 KB.
