# D6.1: who owns what

Repo `/home/claude/tf-d5` (GitHub devinscottfountain/tf-d5, main). Pages load modules from jsDelivr pinned by SHA. Commit your own files only (`git add <your files>`), small commits, `git pull --rebase` before pushing. Never revert someone else's change.

| Owner | Files |
|---|---|
| Page | `d61/main.js`, `d61/d61.css` (source `/home/claude/tf/d61.css`, built like d6), `d61/test/index.html`, Webflow page `6aeb9d772036553b903cda16`, any `d6/solutions.js` option needed for tabs-above layout (default behaviour for D6 unchanged) |
| Mars | `d5/*.js` behind new `window.D5_CFG` flags only. D5 default and D6 (`{mode:'mars'}`) must render identically to today |
| Footer modeller | `d61/foot-model-*.js` |
| Footer textures | `d61/foot-tex.js`, `d61/assets/tex/*` (may reuse `d6/assets/tex/*` and D5 textures by URL) |
| Footer compositing | `d61/footer3d.js`, `d61/foot-glsl.js`, `d61/test/footer.html` |

Nobody touches `d6/*` (except the Page agent's flagged solutions option) or `d5/*` (except Mars).

## Interfaces
Footer
```js
export function createFooter({ THREE, host /* element, canvas fills it */, quality /* 'high'|'low' */, base /* URL of d61/ */ }) -> {
  ready: Promise,          // first frame compiled; textures stream after
  setProgress(p),          // 0 = footer just entering the viewport, 1 = footer at rest (fully in view). Drives the sunrise.
  setPointer(x, y),        // -1..1, optional subtle parallax
  start(), stop(), resize(), dispose()
}
```
Modeller exports `buildFooterScene({ THREE, quality }) -> { root: Object3D, lights?: [], applyTextures(tex), update?(t) }`. Textures export `loadFooterTextures({ THREE, renderer, quality, base }) -> { ready, get(role) }` (same shape as `d6/hero-tex.js`). Compositing wires both into `createFooter` and owns camera, sky, sunset glow, fog, post, the sunrise + ambient shimmer.

Mars (page sets before `import('../d5/main.js')`)
```js
window.D5_CFG = { mode: 'mars', look: 'lit', beats: true, onProgress(p, beat) {} }
// look:'lit' = front-left lit planet with surface detail + glowing rim. beats:true = three copy beats (title, SpaceX lines, colony line) driven by the track.
// __d5.mars.p stays available. Page uses onProgress / __d5.mars.p for the SOL counter.
```
