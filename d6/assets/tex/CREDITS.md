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

Still procedural (no good CC0 scan match): black_plastic, excavator_paint, rubber_track, tyre_track_decal, glass_smudge. Sky: Poly Haven dikhololo_night (CC0).
Tier totals: high ~2.65 MB (incl. HDR), low ~0.68 MB.
