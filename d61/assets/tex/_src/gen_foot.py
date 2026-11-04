# D6.1 footer texture masters. Grades the Poly Haven scans (regolith, mars_rock) and authors the procedural sets
# (dome_frame, foliage, habitat_panel, stainless, rover_paint, dusk_sky). Everything tiles (periodic noise, wrapped stamps).
# usage: python3 -I gen_foot.py <scan_dir> <png_out_dir>
#   scan_dir holds <polyhaven_id>_{c,n,orm}.webp (1024 c/n, 512 orm) pulled via the browser.
# Output: <role>_color.png (sRGB), <role>_normal.png (OpenGL), <role>_orm.png (R ao, G rough, B metal), dusk_sky.npy (linear float32).
import sys, os, math
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
rng = np.random.default_rng(61)


# ---------- helpers ----------
def s2l(c): return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def l2s(c): c = np.clip(c, 0, 1); return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def load(name, mode='RGB'):
    return np.asarray(Image.open(os.path.join(src, name)).convert(mode), np.float32) / 255


def save(name, a):
    a = np.clip(np.round(a * 255), 0, 255).astype(np.uint8)
    Image.fromarray(a).save(os.path.join(out, name))


def fnoise(n, beta=2.0, lo=1, hi=None, aniso=(1, 1), seed=None):
    """Periodic noise, power spectrum 1/f^beta, band [lo, hi] cycles per tile. Returns zero-mean unit-std."""
    r = np.random.default_rng(seed) if seed is not None else rng
    fy = np.fft.fftfreq(n)[:, None] * n * aniso[1]; fx = np.fft.fftfreq(n)[None, :] * n * aniso[0]
    f = np.sqrt(fx * fx + fy * fy); f[0, 0] = 1
    amp = f ** (-beta / 2)
    amp[f < lo] = 0
    if hi: amp *= np.exp(-(f / hi) ** 2)
    amp[0, 0] = 0
    w = r.standard_normal((n, n)) + 1j * r.standard_normal((n, n))
    v = np.real(np.fft.ifft2(w * amp))
    return (v - v.mean()) / (v.std() + 1e-9)


def blur(a, s):
    n, m = a.shape[:2]
    fy = np.fft.fftfreq(n)[:, None]; fx = np.fft.fftfreq(m)[None, :]
    sx, sy = (s, s) if np.isscalar(s) else s
    g = np.exp(-2 * math.pi ** 2 * ((sx * fx) ** 2 + (sy * fy) ** 2))
    if a.ndim == 2: return np.real(np.fft.ifft2(np.fft.fft2(a) * g))
    return np.stack([np.real(np.fft.ifft2(np.fft.fft2(a[..., c]) * g)) for c in range(a.shape[2])], -1)


def h2n(h, strength):
    """Height (in pixels-ish units) to OpenGL normal (green up = +v), wrapped."""
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    dy = (np.roll(h, 1, 0) - np.roll(h, -1, 0)) * 0.5 * strength  # image rows go down, +v goes up
    n = np.stack([-dx, -dy, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def worley(n, cells, seed):
    r = np.random.default_rng(seed)
    pts = r.random((cells, 2)) * n
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    d1 = np.full((n, n), 1e9, np.float32); d2 = d1.copy()
    for px, py in pts:
        dx = np.abs(xx - px); dx = np.minimum(dx, n - dx)
        dy = np.abs(yy - py); dy = np.minimum(dy, n - dy)
        d = np.sqrt(dx * dx + dy * dy)
        m = d < d1; d2 = np.where(m, d1, np.minimum(d2, d)); d1 = np.where(m, d, d1)
    return d1, d2


def streaks(n, s, seed):
    a = blur(np.random.default_rng(seed).standard_normal((n, n)), s)
    return (a - a.mean()) / (a.std() + 1e-9)


def sm(e0, e1, x): t = np.clip((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t)


def orm(ao, rough, metal):
    return np.stack([ao, rough, metal], -1)


# ---------- regolith (Poly Haven red_laterite_soil_stones, graded toward Mars dust) ----------
def regolith():
    c = s2l(load('red_laterite_soil_stones_c.webp'))
    y = c @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    mars = np.array([0.36, 0.165, 0.085], np.float32)  # linear Mars dust (approx JPL true-colour)
    k = y / (y.mean() + 1e-6)
    graded = mars[None, None] * k[..., None] * 0.62 + c * 0.38
    graded *= 0.82  # darker: the footer foreground sits in dusk shadow, keep albedo honest ~0.18
    save('regolith_color.png', l2s(graded))
    save('regolith_normal.png', load('red_laterite_soil_stones_n.webp'))
    o = load('red_laterite_soil_stones_orm.webp'); o[..., 1] = np.clip(o[..., 1] * 0.95 + 0.05, 0, 1); o[..., 2] = 0
    save('regolith_orm.png', o)


# ---------- mars_rock (Poly Haven rock_face_03, recoloured to dusty basalt) ----------
def mars_rock():
    c = s2l(load('rock_face_03_c.webp'))
    y = c @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    yn = y / (y.mean() + 1e-6)
    basalt = np.array([0.055, 0.034, 0.026], np.float32)
    dust = np.array([0.15, 0.072, 0.040], np.float32)
    # dust settles on the brighter, flatter facets; cracks stay dark basalt
    d = sm(0.6, 1.9, yn + 0.25 * fnoise(1024, 2.2, 2, seed=7))[..., None]
    col = (basalt * (1 - d) + dust * d) * np.clip(yn, 0.25, 2.2)[..., None] ** 0.85
    sat = c / (y[..., None] + 1e-6)  # keep a trace of the scan's own hue variation
    col *= (0.8 + 0.2 * np.clip(sat, 0.5, 1.6))
    save('mars_rock_color.png', l2s(col))
    save('mars_rock_normal.png', load('rock_face_03_n.webp'))
    o = load('rock_face_03_orm.webp'); o[..., 2] = 0
    save('mars_rock_orm.png', o)


# ---------- dome_frame: off-white painted strut metal ----------
def dome_frame(n=512):
    peel = fnoise(n, 1.0, 40, 200, seed=11) * 0.3          # orange peel
    blot = fnoise(n, 2.4, 1, seed=12)
    dust = sm(0.6, 1.8, blot + 0.4 * fnoise(n, 1.5, 8, seed=13))
    scratch = np.zeros((n, n), np.float32)
    r = np.random.default_rng(14)
    for _ in range(30):  # fine wrapped scratches
        x0, y0 = r.random(2) * n; a = r.random() * math.pi; L = r.uniform(8, 40); k = r.uniform(0.2, 0.6)
        for t in np.linspace(0, 1, int(L) * 3):
            x = int(x0 + math.cos(a) * L * t) % n; y = int(y0 + math.sin(a) * L * t) % n
            scratch[y, x] = max(scratch[y, x], k * math.sin(math.pi * t))
    scratch = np.clip(blur(scratch, 0.5) * 1.6, 0, 1)
    paint = np.array([0.62, 0.61, 0.58], np.float32)
    dustc = np.array([0.30, 0.15, 0.08], np.float32)
    bare = np.array([0.22, 0.22, 0.23], np.float32)
    col = paint * (1 + 0.04 * blot[..., None])
    col = col * (1 - 0.55 * dust[..., None]) + dustc * 0.55 * dust[..., None]
    col = col * (1 - scratch[..., None]) + bare * scratch[..., None]
    h = peel * 0.25 - scratch * 1.2 + dust * 0.3
    rough = np.clip(0.42 + 0.25 * dust + 0.05 * blot - 0.1 * scratch, 0.2, 1)
    metal = scratch * 0.9
    save('dome_frame_color.png', l2s(col)); save('dome_frame_normal.png', h2n(h, 1.0))
    save('dome_frame_orm.png', orm(np.ones_like(h) - 0.08 * scratch, rough, metal))


# ---------- foliage: dense leaf canopy, wrapped stamps ----------
def foliage(n=512, leaves=2600):
    r = np.random.default_rng(21)
    H = np.full((n, n), -1.0, np.float32)            # top surface height (layer depth)
    C = np.zeros((n, n, 3), np.float32)
    VE = np.zeros((n, n), np.float32)               # vein mask
    greens = np.array([[0.035, 0.09, 0.02], [0.06, 0.13, 0.03], [0.02, 0.06, 0.018], [0.10, 0.15, 0.03], [0.045, 0.11, 0.045]], np.float32)
    for i in range(leaves):
        depth = i / leaves                            # later = on top
        L = r.uniform(14, 30) * (0.8 + 0.4 * depth); W = L * r.uniform(0.32, 0.5)
        cx, cy = r.random(2) * n; a = r.random() * 2 * math.pi
        ca, sa = math.cos(a), math.sin(a)
        R = int(L) + 2
        ys, xs = np.mgrid[-R:R + 1, -R:R + 1].astype(np.float32)
        u = (xs * ca + ys * sa) / L                  # along leaf, -1..1
        v = (-xs * sa + ys * ca) / W
        prof = 1 - u * u                             # lanceolate outline
        inside = (u > -1) & (u < 1) & (np.abs(v) < np.sqrt(np.clip(prof, 0, 1)) * (1 - 0.25 * u))
        if not inside.any(): continue
        hh = depth + 0.08 * (1 - v * v) * prof - 0.03 * np.abs(v) + 0.02 * u * r.uniform(-1, 1)
        gx = (np.round(cx + xs).astype(int)) % n; gy = (np.round(cy + ys).astype(int)) % n
        gx, gy, hh, vv, uu = gx[inside], gy[inside], hh[inside], v[inside], u[inside]
        top = hh > H[gy, gx]
        gx, gy, hh, vv, uu = gx[top], gy[top], hh[top], vv[top], uu[top]
        base = greens[r.integers(len(greens))] * r.uniform(0.75, 1.3)
        shade = (0.85 + 0.25 * (1 - np.abs(vv)))[:, None]
        H[gy, gx] = hh
        C[gy, gx] = base[None] * shade
        VE[gy, gx] = np.exp(-(vv / 0.08) ** 2) * (np.abs(uu) < 0.9)
    gap = H < 0
    H[gap] = -0.4; C[gap] = [0.008, 0.012, 0.006]
    ao = np.clip(0.35 + 0.65 * sm(-0.2, 0.9, blur(H, 3.0)), 0, 1) * np.clip(1 + 3.0 * (H - blur(H, 5.0)), 0.3, 1)
    col = C * (0.5 + 0.5 * ao[..., None]) * (1 + 0.35 * VE[..., None]) * (1 + 0.12 * fnoise(n, 1.2, 8, seed=22))[..., None]
    hpix = H * 22 + VE * 0.6
    save('foliage_color.png', l2s(col)); save('foliage_normal.png', h2n(blur(hpix, 0.7), 0.6))
    save('foliage_orm.png', orm(ao, np.clip(0.55 - 0.1 * VE + 0.25 * gap, 0, 1), np.zeros_like(H)))


# ---------- habitat_panel: off-white composite cladding, 2 x 2 panels per tile ----------
def habitat_panel(n=512):
    p = n // 2
    yy, xx = np.mgrid[0:n, 0:n]
    lx, ly = xx % p, yy % p
    de = np.minimum(np.minimum(lx, p - 1 - lx), np.minimum(ly, p - 1 - ly)).astype(np.float32)
    groove = np.exp(-(de / 1.6) ** 2)              # seam groove
    bevel = sm(1.5, 6, de)
    # rivets: ring 9 px in from edges, every 16 px
    rv = np.zeros((n, n), np.float32)
    off = 9
    for k in range(0, p, 16):
        for (rx, ry) in [(k + 8, off), (k + 8, p - 1 - off), (off, k + 8), (p - 1 - off, k + 8)]:
            for qx in (0, p):
                for qy in (0, p):
                    d = np.hypot(xx - (rx + qx), yy - (ry + qy))
                    rv = np.maximum(rv, np.clip(1 - d / 2.4, 0, 1))
    pid = (xx // p) + 2 * (yy // p)
    tint = np.array([1.0, 0.97, 1.02, 0.985])[pid]
    blot = fnoise(n, 2.2, 1, seed=31); fine = fnoise(n, 1.0, 30, 160, seed=32)
    dust = np.clip(sm(0.5, 2.0, blot) + 0.6 * groove * sm(-0.5, 1.0, blot), 0, 1)
    streak = sm(0.6, 2.0, streaks(n, (2, 40), 33) * 0.6 + 0.6 * fnoise(n, 2.0, 1, seed=34))   # vertical dust runs
    base = np.array([0.56, 0.55, 0.52], np.float32)
    dustc = np.array([0.29, 0.14, 0.075], np.float32)
    dmix = np.clip(0.45 * dust + 0.25 * streak, 0, 0.8)[..., None]
    col = base * tint[..., None] * (1 + 0.025 * fine[..., None]) * (1 - 0.35 * groove[..., None])
    col = col * (1 - dmix) + dustc * dmix
    h = bevel * 1.0 + rv * 0.9 + fine * 0.05
    ao = np.clip(1 - 0.55 * groove - 0.15 * (1 - bevel), 0, 1)
    rough = np.clip(0.5 + 0.3 * dmix[..., 0] + 0.03 * fine - 0.15 * rv, 0, 1)
    save('habitat_panel_color.png', l2s(col)); save('habitat_panel_normal.png', h2n(h, 1.4))
    save('habitat_panel_orm.png', orm(ao, rough, rv * 0.8))


# ---------- stainless: Starship 304L, brushed along u, one circumferential weld per tile ----------
def stainless(n=512):
    brush = streaks(n, (60, 0.8), 41)                                  # brushed along u
    brush2 = streaks(n, (14, 0.5), 42)
    blot = fnoise(n, 2.4, 1, seed=43)
    heat = sm(0.9, 2.2, fnoise(n, 2.6, 1, seed=44))                   # straw / blue heat tint patches
    soot = 0.5 * sm(1.4, 2.8, fnoise(n, 2.2, 1, aniso=(1.5, 0.7), seed=45))
    yy = np.mgrid[0:n, 0:n][0].astype(np.float32)
    wy = n * 0.5
    dw = np.abs(yy - wy)
    weld = np.exp(-(dw / 3.0) ** 2); haz = np.exp(-(dw / 14) ** 2)   # bead + heat-affected zone
    ripple = np.sin(np.mgrid[0:n, 0:n][1] * 2 * math.pi / 5) * weld
    base = np.array([0.56, 0.55, 0.53], np.float32)
    straw = np.array([0.60, 0.48, 0.30], np.float32); blue = np.array([0.30, 0.33, 0.42], np.float32)
    col = base * (1 + 0.05 * brush[..., None] + 0.025 * blot[..., None])
    tint = np.clip(heat * 0.25 + haz * 0.35, 0, 0.5)[..., None]
    col = col * (1 - tint) + (straw * 0.6 + blue * 0.4) * tint
    col *= (1 - 0.5 * soot[..., None] * np.array([1, 1, 1], np.float32))
    h = brush * 0.12 + brush2 * 0.05 + weld * 1.2 + ripple * 0.25
    rough = np.clip(0.28 + 0.06 * brush + 0.12 * soot + 0.1 * haz + 0.03 * blot, 0.12, 0.8)
    save('stainless_color.png', l2s(col)); save('stainless_normal.png', h2n(blur(h, 0.5), 1.2))
    save('stainless_orm.png', orm(np.clip(1 - 0.12 * weld, 0, 1), rough, np.clip(1 - 0.3 * soot, 0, 1)))


# ---------- rover_paint: white paint, chips to primer / alloy, dust in low areas ----------
def rover_paint(n=512):
    d1, d2 = worley(n, 70, 51)
    edge = d2 - d1
    w = fnoise(n, 1.8, 2, seed=52)
    chip = sm(0.55, 0.62, (1 - np.clip(d1 / 22, 0, 1)) * 0.6 + 0.25 * w + 0.25 * fnoise(n, 1.0, 20, seed=53))
    chip *= sm(0.6, 1.8, fnoise(n, 2.2, 1, seed=54) + 0.3)            # chips cluster in worn zones
    primer = sm(0.3, 0.6, chip) * (1 - sm(0.8, 0.95, chip))           # primer ring around bare metal
    bare = sm(0.85, 0.98, chip)
    dust = sm(0.4, 1.8, fnoise(n, 2.0, 1, seed=55) + 0.5 * fnoise(n, 1.0, 16, seed=56))
    paint = np.array([0.70, 0.69, 0.66], np.float32)
    prim = np.array([0.20, 0.20, 0.19], np.float32); metal = np.array([0.55, 0.55, 0.56], np.float32)
    dustc = np.array([0.30, 0.15, 0.08], np.float32)
    col = paint * (1 + 0.03 * w[..., None])
    col = col * (1 - primer[..., None]) + prim * primer[..., None]
    col = col * (1 - bare[..., None]) + metal * bare[..., None]
    dm = (0.55 * dust)[..., None]
    col = col * (1 - dm) + dustc * dm
    h = -chip * 0.8 + fnoise(n, 1.0, 40, 200, seed=57) * 0.06 + dust * 0.15
    rough = np.clip(0.35 + 0.35 * dust + 0.15 * primer + 0.05 * bare, 0, 1)
    save('rover_paint_color.png', l2s(col)); save('rover_paint_normal.png', h2n(blur(h, 0.6), 1.2))
    save('rover_paint_orm.png', orm(np.clip(1 - 0.2 * primer, 0, 1), rough, bare * 0.9))


# ---------- dusk_sky: Mars dusk equirect (linear, float), sun just under the ridge at -Z ----------
def dusk_sky(w=512, h=256):
    # three.js equirect: u = atan(z, x) / 2pi + 0.5, v = asin(y) / pi + 0.5, row 0 = zenith
    u = (np.arange(w) + 0.5) / w; v = 1 - (np.arange(h) + 0.5) / h
    phi = (u - 0.5) * 2 * math.pi; el = (v - 0.5) * math.pi
    PH, EL = np.meshgrid(phi, el)
    dx, dy, dz = np.cos(EL) * np.cos(PH), np.sin(EL), np.cos(EL) * np.sin(PH)
    sun = np.array([0, -0.035, -1.0]); sun /= np.linalg.norm(sun)
    cosg = dx * sun[0] + dy * sun[1] + dz * sun[2]
    g = np.arccos(np.clip(cosg, -1, 1))
    e = np.maximum(EL, 0)
    # ridge silhouette: periodic in azimuth, 0.5 to 3 degrees
    az = (u * 2 * math.pi)[None, :]
    ridge = np.radians(1.4 + 0.9 * np.sin(az * 3 + 1.1) + 0.5 * np.sin(az * 7 + 0.3) + 0.25 * np.sin(az * 17 + 2.0))
    hor = np.exp(-e / 0.10)
    glow = np.exp(-g / 0.42) * np.exp(-e / 0.18)                 # concentrated dusk glow
    halo = np.exp(-g / 1.1) * np.exp(-e / 0.45)                   # broad warm wash
    sky = (np.array([0.0035, 0.0030, 0.0042]) * (1 - hor[..., None]) +            # near-black zenith
           np.array([0.06, 0.028, 0.014]) * hor[..., None] +
           np.array([2.6, 1.05, 0.34]) * glow[..., None] * 3.0 +
           np.array([0.35, 0.13, 0.045]) * halo[..., None])
    core = np.exp(-g / 0.06) * np.exp(-e / 0.05)
    sky += np.array([6.0, 3.0, 1.1]) * core[..., None] * 4.0          # hot spot just over the ridge
    # ground and ridge: dark regolith, faintly lit by the glow on sun-facing slopes
    below = EL < ridge
    lit = np.clip(cosg, 0, 1) ** 4
    ground = np.array([0.012, 0.0065, 0.004]) + np.array([0.09, 0.04, 0.018]) * lit[..., None] * np.exp(-np.maximum(-EL, 0) / 0.25)[..., None]
    rim = np.exp(-np.maximum(ridge - EL, 0) / 0.004) * lit                             # back-lit ridge edge
    ground += np.array([0.5, 0.2, 0.07]) * rim[..., None] * 0.6
    img = np.where(below[..., None], ground, sky).astype(np.float32)
    np.save(os.path.join(out, 'dusk_sky.npy'), img)
    return img


regolith(); mars_rock(); dome_frame(); foliage(); habitat_panel(); stainless(); rover_paint(); dusk_sky()
print('ok')
