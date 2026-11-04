# D6 hero scan pass 2 (2026-11-04): grade the Poly Haven scans pulled via the browser and encode them into the shipped set.
# Leaves every other file alone (build_tex.py made those). Rewrites _src/manifest.json from what is on disk.
# usage: python3 -I hero_scans.py <scan_dir> <d6/assets/tex>
#   scan_dir: <polyhaven_id>_{diff,nor_gl,arm}.webp, downsized in-browser from the 2k JPGs (diff / nor 1024, arm 512;
#   muddy_tracks all 512).
# Roles written:
#   dirt_tracks      muddy_tracks (Amal Kumar), regraded to the brown_mud_dry palette (darker, more contrast), ruts along v. 512 c / n.
#   excavator_paint  green_metal_rust (Rob Tuytel), repainted CAT yellow, rust runs / pits kept as dark grime. c only
#                    (the night machine shader reads luminance of the colour map, nothing else).
#   desk_laminate    black_oak_veneer (Jenelle van Heerden) at 1k colour / normal, 512 ORM from the real arm map.
#   rock_ridge       cliff_side (already shipped at 1k) re-encoded at 512 c / n for the far ridges.
import sys, os, json, subprocess, math
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]


def s2l(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def l2s(c): c = np.clip(c, 0, 1); return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)
def load(p, mode='RGB'): return np.asarray(Image.open(p).convert(mode), np.float32) / 255
def luma(a): return a @ np.array([0.3, 0.59, 0.11], np.float32)


def resize(a, s):
    if a.shape[0] == s: return a
    return np.asarray(Image.fromarray(np.clip(np.round(a * 255), 0, 255).astype(np.uint8)).resize((s, s), Image.LANCZOS), np.float32) / 255


def nresize(n, s):
    v = n * 2 - 1
    if v.shape[0] != s:
        v = np.stack([np.asarray(Image.fromarray(v[..., c]).resize((s, s), Image.BOX)) for c in range(3)], -1)
    v /= np.linalg.norm(v, axis=-1, keepdims=True) + 1e-6
    return v * 0.5 + 0.5


def webp(a, rel, q, srgb_lin=None):
    p = os.path.join(out, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    tmp = p + '.png'
    Image.fromarray(np.clip(np.round(a * 255), 0, 255).astype(np.uint8)).save(tmp)
    subprocess.run(['cwebp', '-quiet', '-mt', '-m', '6', '-q', str(q), '-sharp_yuv', tmp, '-o', p], check=True)
    os.remove(tmp)
    print(f'{os.path.getsize(p) // 1024:>5} KB  {rel}')


def match(lin, ref_mean, ref_std_l, keep_sat=1.0):
    """Shift a linear colour image to a reference mean RGB and luminance std (keeps the scan's structure)."""
    L = luma(lin); Lm, Ls = L.mean(), L.std() + 1e-6
    k = (L - Lm) / Ls * ref_std_l + luma(ref_mean)                  # target luminance
    chroma = lin / (L[..., None] + 1e-4)
    chroma = chroma / chroma.reshape(-1, 3).mean(0) * (ref_mean / (luma(ref_mean) + 1e-6))
    chroma = 1 + (chroma - 1) * keep_sat
    return np.clip(chroma * np.clip(k, 0.002, None)[..., None], 0, 1)


# reference stats (linear mean RGB, luminance std) of the 2026-11-02 sets these replace or sit next to, so reruns are idempotent
REF = {'dirt_ground': ([0.191, 0.121, 0.060], 0.096), 'excavator_paint': ([0.679, 0.328, 0.016], 0.091), 'desk_laminate': ([0.144, 0.121, 0.096], 0.012)}
def stats(role): m, sd = REF[role]; return np.array(m, np.float32), sd


# ---------- dirt_tracks: muddy ruts in the brown_mud_dry palette, slightly darker (compacted, damp)
dm, ds = stats('dirt_ground')
c = match(s2l(load(f'{src}/muddy_tracks_diff.webp')), dm * 0.8, ds * 1.5, 1.1)   # ruts must survive grazing-angle mips: extra contrast
webp(l2s(c), '512/dirt_tracks_c.webp', 80)
webp(nresize(load(f'{src}/muddy_tracks_nor_gl.webp'), 512), '512/dirt_tracks_n.webp', 80)

# ---------- excavator_paint: CAT yellow over the green_metal_rust structure
g = s2l(load(f'{src}/green_metal_rust_diff.webp'))
L = luma(g); Ln = L / L.mean()
rust = np.clip((g[..., 0] - g[..., 1]) * 6 + 0.15, 0, 1)                 # rust runs / pits read redder than the green paint
rust = np.clip(rust + np.clip(0.75 - Ln, 0, 1) * 1.8, 0, 1)              # and darker
yellow = np.array([0.72, 0.36, 0.012], np.float32)
grime = np.array([0.07, 0.04, 0.02], np.float32)
Lb = np.clip(1 - 1.8 * np.abs(Ln - 1), 0.08, 1.2) ** 1.5            # any departure from the flat paint (drips, pits, runs) reads as grime: the shader only sees luminance
Lb = Lb / Lb.mean()
col = yellow * Lb[..., None]
col = col * (1 - rust[..., None]) + grime * rust[..., None]
em, es = stats('excavator_paint')
col = col * (luma(em) / luma(col).mean())
print('excavator luma mean', luma(col).mean().round(3), 'std', luma(col).std().round(3), '(was', round(float(luma(em)), 3), es, ')')
webp(l2s(col), '1k/excavator_paint_c.webp', 80)
for f in ('512/excavator_paint_c.webp',):
    webp(l2s(resize(col, 512)), f, 80)

# ---------- desk_laminate: black oak veneer at 1k with its own arm (metal forced 0)
d = s2l(load(f'{src}/black_oak_veneer_diff.webp'))
dkm, dks = stats('desk_laminate')
d = match(d, dkm, max(dks, luma(d).std() * (luma(dkm) / luma(d).mean())), 1.0)
webp(l2s(d), '1k/desk_laminate_c.webp', 88)
webp(l2s(resize(d, 512)), '512/desk_laminate_c.webp', 90)
n = load(f'{src}/black_oak_veneer_nor_gl.webp')
webp(nresize(n, 1024), '1k/desk_laminate_n.webp', 82)
webp(nresize(n, 512), '512/desk_laminate_n.webp', 82)
a = load(f'{src}/black_oak_veneer_arm.webp'); a[..., 2] = 0
webp(a, '512/desk_laminate_orm.webp', 82)
webp(resize(a, 256), '256/desk_laminate_orm.webp', 82)

# ---------- rock_ridge at 512 (far ridges only need the strata, not the grit)
webp(resize(load(os.path.join(out, '1k/rock_ridge_c.webp')), 512), '512/rock_ridge_c.webp', 80)
webp(nresize(load(os.path.join(out, '1k/rock_ridge_n.webp')), 512), '512/rock_ridge_n.webp', 80)
