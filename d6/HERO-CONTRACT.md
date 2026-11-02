# D6 hero upgrade: who owns what

Three agents work on the Three.js hero at the same time. Stay inside your files.

| Owner | Files |
|---|---|
| Modeller | `d6/hero-room.js`, `d6/hero-outside.js`, new `d6/hero-model-*.js` |
| Textures | new `d6/hero-tex.js`, new `d6/assets/tex/*` |
| Compositing / camera | `d6/hero3d.js`, `d6/hero-glsl.js`, `d6/hero-screens.js`, `d6/hero-cab.js` |

Nobody touches `d6/main.js`, `d6/loader.js`, `d6/solutions.js`, `d6/sol-*.js`, `d5/*` (another agent is mid-fix there).
Tests: `d6/test/hero.html` (shared; add query flags, don't break others), harness `/home/claude/tf/t/hero-shot.js`.

## Texture contract
`d6/hero-tex.js` exports
```js
export const TEX_ROLES = [ /* names below */ ];
export function loadHeroTextures({ THREE, renderer, quality /* 'high'|'low' */, base /* URL of d6/assets/tex/ */ })
  -> { ready: Promise, get(role) -> { map?, normalMap?, roughnessMap?, aoMap? } | null, onReady(fn) }
```
- `get(role)` returns null until loaded (materials keep their flat look until then; swapping a map in later must set `material.needsUpdate = true` once).
- Roles (texture agent may add more, modeller may request more via a comment in the contract):
  `concrete_floor`, `ceiling_panel`, `desk_laminate`, `brushed_metal`, `black_plastic`, `carpet`, `fabric_chair`, `glass_smudge` (roughness/dirt mask for the window), `dirt_ground`, `gravel`, `tyre_track_decal`, `rock_ridge`, `excavator_paint` (worn yellow paint with grime), `rubber_track`, `rusty_metal`, `night_sky_hdr` (small equirect HDR or LDR for env lighting / reflections).
- Each texture: webp (or KTX2 if it clearly wins), 512 or 1024 px, tileable, colour maps sRGB, data maps linear. Budget: < 2.5 MB total on high, low tier loads a subset at 512.
- Modeller: build UVs that tile sensibly (world-scale UVs, e.g. 1 UV unit = 1 m, store `userData.texScale`), and wire materials through a single `applyHeroTextures(tex)` function exported from each of your modules so integration is one call.
- Compositing owner wires `loadHeroTextures` + `applyHeroTextures` into `createHero` (ready must NOT wait on textures; they stream in).

## Look targets
`d6/ref/1-hero.png`, `d6/ref/2-hero-zoom.png`. Real footage will later replace the three monitor feeds (keep `setMedia`-style hooks per screen).
