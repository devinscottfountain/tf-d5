# Procedural, tileable PBR set for the D6 hero (authored for this project, CC0).
# Every field is periodic (FFT noise, wrapped Worley, wrapped strokes), so all maps tile.
# usage: python3 -I gen_tex.py <outdir_png> [role ...]
import sys, os, math
import numpy as np
import cv2

N = 1024
RNG = np.random.default_rng


# ---------- periodic primitives ----------
def freqs(n):
    f = np.fft.fftfreq(n) * n
    return np.meshgrid(f, f)  # fx (cols), fy (rows)


def spectral(n, seed, lo=1.0, hi=None, beta=1.0, ax=1.0, ay=1.0):
    """Periodic noise with 1/f^beta spectrum, band-limited [lo, hi] cycles per tile. ax/ay stretch."""
    r = RNG(seed)
    w = r.standard_normal((n, n))
    fx, fy = freqs(n)
    f = np.sqrt((fx * ax) ** 2 + (fy * ay) ** 2)
    amp = np.where(f > 0, 1.0 / np.maximum(f, 1e-6) ** beta, 0.0)
    amp *= (f >= lo)
    if hi:
        amp *= np.exp(-(f / hi) ** 4)
    out = np.real(np.fft.ifft2(np.fft.fft2(w) * amp))
    out -= out.mean()
    return out / (out.std() + 1e-9)


def blur(a, sx, sy=None):
    """Periodic gaussian blur (sigma in px), optional anisotropic."""
    sy = sx if sy is None else sy
    n = a.shape[0]
    fx, fy = freqs(n)
    g = np.exp(-2 * (math.pi ** 2) * ((fx / n * sx) ** 2 + (fy / n * sy) ** 2))
    if a.ndim == 3:
        return np.stack([np.real(np.fft.ifft2(np.fft.fft2(a[..., c]) * g)) for c in range(a.shape[2])], -1)
    return np.real(np.fft.ifft2(np.fft.fft2(a) * g))


def warp(a, dx, dy):
    """Periodic domain warp by pixel offsets."""
    n = a.shape[0]
    yy, xx = np.mgrid[0:n, 0:n].astype(np.float32)
    mx = ((xx + dx) % n).astype(np.float32)
    my = ((yy + dy) % n).astype(np.float32)
    return cv2.remap(a.astype(np.float32), mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_WRAP)


def worley(n, cells, seed, jitter=1.0):
    """Wrapped Worley: returns F1, F2 (in cell units) and cell id hash."""
    r = RNG(seed)
    pts = r.random((cells, cells, 2)) * jitter + (1 - jitter) * 0.5
    ids = r.random((cells, cells))
    s = n / cells
    yy, xx = np.mgrid[0:n, 0:n] / s
    cx, cy = np.floor(xx).astype(int), np.floor(yy).astype(int)
    f1 = np.full((n, n), 9.0); f2 = np.full((n, n), 9.0); idv = np.zeros((n, n))
    for oy in (-1, 0, 1):
        for ox in (-1, 0, 1):
            gx, gy = cx + ox, cy + oy
            p = pts[gy % cells, gx % cells]
            d = np.sqrt((gx + p[..., 0] - xx) ** 2 + (gy + p[..., 1] - yy) ** 2)
            i = ids[gy % cells, gx % cells]
            closer = d < f1
            f2 = np.where(closer, f1, np.minimum(f2, d))
            idv = np.where(closer, i, idv)
            f1 = np.where(closer, d, f1)
    return f1, f2, idv


def strokes(n, seed, count, lmin, lmax, wmin=1, wmax=2, angle=None, aspread=math.pi, curve=0.0, val=(0.3, 1.0)):
    """Random line/arc strokes drawn with wrap-around (3x3 offsets)."""
    r = RNG(seed)
    img = np.zeros((n, n), np.float32)
    for _ in range(count):
        x, y = r.random() * n, r.random() * n
        a = (angle if angle is not None else 0) + (r.random() - 0.5) * aspread
        L = lmin + r.random() * (lmax - lmin)
        k = (r.random() - 0.5) * curve
        seg = 12
        pts = []
        for i in range(seg + 1):
            t = i / seg
            aa = a + k * (t - 0.5)
            pts.append((x + math.cos(aa) * L * (t - 0.5), y + math.sin(aa) * L * (t - 0.5)))
        w = int(round(wmin + r.random() * (wmax - wmin)))
        v = val[0] + r.random() * (val[1] - val[0])
        for oy in (-n, 0, n):
            for ox in (-n, 0, n):
                p = np.array([[px + ox, py + oy] for px, py in pts], np.float32) * 16
                cv2.polylines(img, [p.astype(np.int32)], False, float(v), max(1, w), cv2.LINE_AA, shift=4)
    return img


def sstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    t = t[..., None] if (t.ndim == 2 and a.ndim == 3) else t
    return a * (1 - t) + b * t


def col(*rgb):
    return np.array(rgb, np.float32)


def normal_from_height(h, strength):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    nrm = np.stack([-gx, gy, np.ones_like(h)], -1)  # OpenGL (green = +v)
    nrm /= np.linalg.norm(nrm, axis=-1, keepdims=True)
    return nrm


def cavity_ao(h, sigma, k, floor=0.25):
    d = blur(h, sigma) - h
    return np.clip(1 - k * np.maximum(d, 0), floor, 1)


# ---------- roles ----------
def concrete_floor(n):
    m = spectral(n, 1, 1, 10, 1.2); m2 = spectral(n, 2, 6, 80, 0.9); fine = spectral(n, 3, 120, 500, 0.2)
    base = col(0.43, 0.43, 0.42)
    a = base[None, None] * (1 + 0.07 * m[..., None] + 0.035 * m2[..., None] + 0.03 * fine[..., None])
    a = mix(a, a * col(1.02, 1.0, 0.96), sstep(-0.5, 1.5, spectral(n, 4, 2, 12, 1.0)))
    # aggregate specks + pits
    sp = spectral(n, 5, 200, 500, 0.0)
    dark = sstep(2.4, 3.2, sp); light = sstep(2.6, 3.4, -sp)
    a = mix(a, a * 0.55, dark * 0.8); a = mix(a, a * 1.25, light * 0.6)
    f1, f2, _ = worley(n, 4, 6)
    crack = sstep(0.02, 0.0, f2 - f1) * sstep(1.0, 1.8, spectral(n, 7, 2, 12, 1.0)) * 0.6
    sc = blur(strokes(n, 8, 70, 40, 220, 1, 1, curve=0.6, val=(0.1, 0.4)), 0.8)
    a = mix(a, a * 0.8, crack * 0.7); a = mix(a, a * 1.06, np.clip(sc, 0, 1) * 0.5)
    h = 0.15 * m2 + 0.1 * fine - 1.2 * dark - 2.0 * crack - 0.25 * sc
    rough = 0.48 + 0.08 * m + 0.05 * m2 - 0.12 * np.clip(sc, 0, 1) + 0.15 * dark
    rough = mix(rough, rough - 0.1, sstep(0.3, 1.5, spectral(n, 9, 2, 8, 1.0)))
    return dict(albedo=a, height=h, nstr=0.9, rough=rough, metal=0.0, ao=cavity_ao(h, 3, 0.25))


def ceiling_panel(n):
    # 2x2 lay-in acoustic tiles (texture = 1.2 m), T-bar grid on tile borders
    yy, xx = np.mgrid[0:n, 0:n] / n * 2
    fx, fy = np.abs(xx - np.round(xx)), np.abs(yy - np.round(yy))
    e = np.minimum(fx, fy) * n / 2  # px to nearest grid line (per tile units * px)
    e = np.minimum(fx, fy) * (n / 2)
    bar = sstep(7.0, 5.5, e)  # 24 mm tee approx
    bevel = sstep(14, 7.5, e) * (1 - bar)
    fis = spectral(n, 11, 60, 400, 0.4)
    worms = sstep(1.6, 2.4, np.abs(spectral(n, 12, 40, 200, 0.6)) * -1 + 2.6)  # fissures
    pits = sstep(2.5, 3.2, spectral(n, 13, 150, 500, 0.0))
    tile = col(0.80, 0.80, 0.78)[None, None] * (1 + 0.025 * fis[..., None] + 0.03 * spectral(n, 14, 1, 6, 1.0)[..., None])
    tile = mix(tile, tile * 0.72, np.clip(worms * 0.6 + pits * 0.8, 0, 1))
    a = mix(tile, tile * 0.85, bevel * 0.5)
    a = mix(a, col(0.86, 0.86, 0.85)[None, None], bar)
    h = 0.12 * fis - 0.8 * worms - 0.9 * pits - 3.0 * bevel + 1.0 * bar
    rough = 0.9 - 0.45 * bar
    return dict(albedo=a, height=h, nstr=1.0, rough=rough, metal=0.0, ao=np.clip(cavity_ao(h, 2, 0.3) * (1 - 0.35 * bevel), 0, 1))


def desk_laminate(n):
    g = spectral(n, 21, 2, 300, 0.6, ax=12.0, ay=1.0)  # faint long grain along x
    sp = spectral(n, 22, 150, 500, 0.1)
    m = spectral(n, 23, 1, 8, 1.0)
    a = col(0.13, 0.13, 0.135)[None, None] * (1 + 0.06 * g[..., None] + 0.06 * sp[..., None] + 0.04 * m[..., None])
    sc = blur(strokes(n, 24, 60, 30, 160, 1, 1, curve=0.4, val=(0.2, 0.6)), 0.5)
    a = mix(a, a * 1.4, np.clip(sc, 0, 1) * 0.5)
    h = 0.2 * sp + 0.15 * g - 0.4 * sc
    rough = 0.42 + 0.05 * m + 0.03 * g + 0.08 * np.clip(sc, 0, 1)
    rough = mix(rough, rough - 0.12, sstep(0.4, 1.6, spectral(n, 25, 2, 10, 1.0)))  # wiped areas
    return dict(albedo=a, height=h, nstr=0.6, rough=rough, metal=0.0, ao=None)


def brushed_metal(n):
    s = spectral(n, 31, 4, 500, 0.5, ax=40.0, ay=1.0)
    s2 = spectral(n, 32, 40, 500, 0.2, ax=120.0, ay=1.0)
    m = spectral(n, 33, 1, 6, 1.0)
    a = col(0.62, 0.62, 0.63)[None, None] * (1 + 0.06 * s[..., None] + 0.09 * s2[..., None] + 0.015 * m[..., None])
    sc = blur(strokes(n, 34, 40, 40, 200, 1, 1, curve=0.5, val=(0.3, 0.8)), 0.5)
    h = 0.5 * s + 0.3 * s2 - 0.6 * sc
    rough = 0.32 + 0.04 * s + 0.05 * s2 + 0.03 * m + 0.1 * np.clip(sc, 0, 1)
    return dict(albedo=a, height=h, nstr=0.5, rough=rough, metal=1.0, ao=None)


def black_plastic(n):
    st = blur(spectral(n, 41, 60, 300, 0.0), 1.6)  # VDI stipple
    m = spectral(n, 42, 1, 8, 1.0)
    smudge = sstep(0.5, 1.8, spectral(n, 43, 2, 20, 1.2))
    a = col(0.045, 0.045, 0.048)[None, None] * (1 + 0.12 * st[..., None] + 0.06 * m[..., None])
    a = mix(a, a * 1.5 + 0.01, smudge * 0.35)
    h = st
    rough = 0.55 + 0.04 * st - 0.18 * smudge + 0.03 * m
    return dict(albedo=a, height=h, nstr=1.6, rough=rough, metal=0.0, ao=None)


def carpet(n):
    # 2x2 carpet tiles (0.5 m each), quarter-turn pile direction alternates shade
    yy, xx = np.mgrid[0:n, 0:n]
    tx, ty = (xx * 2 // n), (yy * 2 // n)
    q = ((tx + ty) % 2).astype(np.float32)
    loops = 0.5 * (np.sin(xx / n * 2 * math.pi * 256) * np.sin(yy / n * 2 * math.pi * 256)) ** 2
    fib = spectral(n, 51, 150, 500, 0.0)
    fibx = spectral(n, 52, 80, 500, 0.3, ax=1.0, ay=0.25)
    fiby = spectral(n, 53, 80, 500, 0.3, ax=0.25, ay=1.0)
    dirf = mix(fibx, fiby, q)
    fleck = sstep(2.3, 3.0, spectral(n, 54, 200, 500, 0.0))
    base = col(0.16, 0.17, 0.20)
    a = base[None, None] * (1 + 0.28 * fib[..., None] + 0.2 * dirf[..., None] + 0.06 * (q[..., None] - 0.5))
    a = mix(a, col(0.32, 0.33, 0.36)[None, None], fleck * 0.6)
    a = a * (1 + 0.04 * spectral(n, 55, 1, 6, 1.0)[..., None])
    xe = np.minimum(xx % (n // 2), (n // 2) - xx % (n // 2)); ye = np.minimum(yy % (n // 2), (n // 2) - yy % (n // 2))
    seam = sstep(2.5, 0.5, np.minimum(xe, ye).astype(np.float32))
    a = mix(a, a * 0.6, seam * 0.7)
    h = 0.6 * loops + 0.35 * fib + 0.25 * dirf - 1.5 * seam
    return dict(albedo=a, height=h, nstr=1.2, rough=0.95 + 0.02 * fib, metal=0.0, ao=cavity_ao(h, 2, 0.35, 0.4))


def fabric_chair(n):
    # plain weave mesh, 64 threads per tile each way
    yy, xx = np.mgrid[0:n, 0:n] / n
    T = 64
    u, v = xx * T, yy * T
    iu, iv = np.floor(u), np.floor(v)
    fu, fv = u - iu, v - iv
    over = ((iu + iv) % 2).astype(np.float32)
    warp_t = np.sin(math.pi * fu) ** 0.7  # thread round profile across
    weft_t = np.sin(math.pi * fv) ** 0.7
    warp_h = warp_t * (0.6 + 0.4 * np.cos(math.pi * (fv - 0.5) * 1.0) * (2 * over - 1) * 0.5 + 0.2)
    weft_h = weft_t * (0.6 - 0.4 * np.cos(math.pi * (fu - 0.5) * 1.0) * (2 * over - 1) * 0.5 + 0.2)
    h = np.maximum(warp_h, weft_h)
    gap = sstep(0.25, 0.05, h)
    fz = spectral(n, 61, 100, 500, 0.0, ax=1.0, ay=0.3) * 0.5 + spectral(n, 62, 100, 500, 0.0, ax=0.3, ay=1.0) * 0.5
    a = col(0.085, 0.085, 0.09)[None, None] * (0.75 + 0.45 * h[..., None] + 0.1 * fz[..., None])
    a = mix(a, col(0.01, 0.01, 0.012)[None, None], gap * 0.85)
    h = h + 0.15 * fz
    return dict(albedo=a, height=h, nstr=2.5, rough=0.82 + 0.06 * fz, metal=0.0, ao=np.clip(0.45 + 0.55 * sstep(0.0, 0.7, h), 0, 1))


def glass_smudge(n):
    dust = sstep(1.5, 3.5, spectral(n, 71, 150, 500, 0.0)) * 0.5 + 0.15 * sstep(-0.5, 2, spectral(n, 72, 4, 60, 0.8))
    wipes = blur(strokes(n, 73, 18, 200, 520, 30, 60, curve=2.6, val=(0.12, 0.3)), 14)
    wipes = wipes * (0.6 + 0.4 * sstep(-1, 1, spectral(n, 77, 20, 200, 0.5, ax=1.0, ay=0.2)))
    streak = blur(strokes(n, 74, 50, 40, 200, 1, 3, angle=math.pi / 2, aspread=0.25, curve=0.2, val=(0.15, 0.5)), 1.2)
    prints = np.zeros((n, n), np.float32)
    r = RNG(75)
    for _ in range(14):
        cx, cy = r.random() * n, r.random() * n
        rx, ry = 10 + r.random() * 8, 14 + r.random() * 8
        for k in range(6):
            for oy in (-n, 0, n):
                for ox in (-n, 0, n):
                    cv2.ellipse(prints, (int(cx + ox), int(cy + oy)), (int(rx - k * 1.8), int(ry - k * 2.2)), r.random() * 180, 0, 360, 0.5, 1, cv2.LINE_AA)
    prints = blur(prints, 0.7)
    lowmask = sstep(-0.6, 1.2, spectral(n, 76, 1, 6, 1.0))
    dirt = np.clip(dust + wipes * lowmask + streak + prints * 0.8, 0, 1)
    rough = 0.04 + 0.5 * dirt
    return dict(dirt=dirt, rough=rough)


def dirt_ground(n):
    lo = spectral(n, 81, 1, 8, 1.3); mid = spectral(n, 82, 6, 60, 1.0); fine = spectral(n, 83, 60, 500, 0.4)
    damp = sstep(0.2, 1.4, spectral(n, 84, 1, 10, 1.2))
    tan, brown, dk = col(0.50, 0.40, 0.29), col(0.36, 0.28, 0.20), col(0.24, 0.19, 0.14)
    a = mix(tan[None, None] * np.ones((n, n, 1)), brown[None, None], sstep(-1.0, 1.2, lo + 0.4 * mid))
    a = mix(a, dk[None, None], damp * 0.55)
    a = a * (1 + 0.08 * fine[..., None] + 0.05 * mid[..., None])
    # pebbles
    f1, f2, idv = worley(n, 40, 85)
    pr = 0.12 + 0.3 * ((idv * 7.13) % 1)
    sel = (idv > 0.72)
    peb = sstep(pr, pr - 0.08, f1) * sel
    pdome = np.clip(1 - (f1 / pr) ** 2, 0, 1) * sel
    ptone = a * (0.75 + 0.5 * ((idv * 13.7) % 1))[..., None]
    a = mix(a, ptone, peb * 0.9)
    # clods / cracks
    c1, c2, _ = worley(n, 6, 86)
    crack = sstep(0.025, 0.0, c2 - c1) * sstep(0.8, 1.6, spectral(n, 87, 2, 12, 1.0))
    a = mix(a, a * 0.6, crack * 0.6)
    h = 0.5 * lo + 0.6 * mid + 0.25 * fine + 1.6 * pdome - 1.5 * crack
    rough = 0.92 - 0.2 * damp + 0.03 * fine - 0.08 * peb
    return dict(albedo=a, height=h, nstr=1.4, rough=rough, metal=0.0, ao=cavity_ao(h, 4, 0.35, 0.35))


def gravel(n):
    hmax = np.full((n, n), -1.0); tone = np.zeros((n, n)); edge = np.zeros((n, n))
    for i, (cells, rad, seed) in enumerate(((22, 0.62, 91), (34, 0.6, 92), (14, 0.66, 93))):
        f1, f2, idv = worley(n, cells, seed, jitter=0.85)
        d = f1 / rad
        hh = np.sqrt(np.clip(1 - d ** 2, 0, 1)) * (0.7 + 0.6 * idv) * (cells ** -0.5) * 6
        hh = np.where(d < 1, hh, -0.2)
        take = hh > hmax
        hmax = np.where(take, hh, hmax); tone = np.where(take, idv, tone)
    stone = hmax > 0
    rnd = spectral(n, 94, 30, 500, 0.3)
    pal = [col(0.52, 0.50, 0.47), col(0.40, 0.38, 0.36), col(0.60, 0.57, 0.52), col(0.33, 0.31, 0.29), col(0.48, 0.43, 0.38)]
    idx = np.clip((tone * len(pal)).astype(int), 0, len(pal) - 1)
    a = np.stack(pal)[idx] * (1 + 0.08 * rnd[..., None])
    gapc = col(0.16, 0.13, 0.10)[None, None] * (1 + 0.15 * rnd[..., None])
    a = np.where(stone[..., None], a, gapc)
    h = np.maximum(hmax, -0.2) + 0.05 * rnd
    ao = cavity_ao(h, 6, 1.2, 0.2)
    a = a * (0.55 + 0.45 * ao[..., None])  # baked dirt in crevices
    rough = np.where(stone, 0.72 + 0.08 * rnd, 0.95)
    return dict(albedo=a, height=h * 6, nstr=1.0, rough=rough, metal=0.0, ao=ao)


def rock_ridge(n):
    w1, w2 = spectral(n, 101, 1, 12, 1.2), spectral(n, 102, 1, 12, 1.2)
    lo = spectral(n, 103, 1, 10, 1.3); mid = spectral(n, 104, 8, 80, 1.0); fine = spectral(n, 105, 80, 500, 0.4)
    yy, xx = np.mgrid[0:n, 0:n] / n
    strata = np.sin(2 * math.pi * (yy * 9 + 0.35 * w1 + 0.1 * mid))
    ridged = 1 - np.abs(spectral(n, 106, 3, 40, 1.0))
    c1, c2, _ = worley(n, 9, 107)
    crack = sstep(0.03, 0.0, c2 - c1) * sstep(0.6, 1.5, spectral(n, 109, 2, 12, 1.0)) * 0.7
    crack = np.maximum(crack, sstep(0.06, 0.0, np.abs(warp(spectral(n, 108, 2, 16, 1.2), 20 * w1, 20 * w2))) * 0.8)
    h = 0.5 * lo + 0.45 * mid + 0.15 * fine + 0.35 * strata + 0.4 * ridged - 1.6 * crack
    g1, g2, g3 = col(0.42, 0.40, 0.37), col(0.33, 0.30, 0.27), col(0.52, 0.47, 0.40)
    a = mix(g1[None, None] * np.ones((n, n, 1)), g2[None, None], sstep(-0.6, 0.8, strata * 0.6 + lo * 0.5))
    a = mix(a, g3[None, None], sstep(0.6, 1.8, mid + 0.5 * w2) * 0.6)
    a = a * (1 + 0.07 * fine[..., None] + 0.05 * mid[..., None])
    ao = cavity_ao(h, 5, 0.35, 0.25)
    a = a * (0.6 + 0.4 * ao[..., None])
    rough = 0.86 + 0.05 * fine - 0.05 * sstep(0.5, 2, mid)
    return dict(albedo=a, height=h, nstr=2.2, rough=rough, metal=0.0, ao=ao)


def excavator_paint(n):
    yel = col(0.90, 0.64, 0.10)
    lo = spectral(n, 111, 1, 8, 1.2); mid = spectral(n, 112, 6, 80, 1.0); fine = spectral(n, 113, 80, 500, 0.3)
    a = yel[None, None] * (1 + 0.04 * lo[..., None] + 0.025 * fine[..., None])
    # chips: sharp-edged blobs from high-pass noise, clustered by a low mask
    cl = sstep(0.4, 1.6, spectral(n, 114, 2, 16, 1.0))
    ch = spectral(n, 115, 20, 200, 0.8) + 0.8 * cl
    chip = sstep(2.1, 2.25, ch)
    rim = sstep(1.85, 2.1, ch) * (1 - chip)
    steel = col(0.20, 0.20, 0.21)[None, None] * (1 + 0.1 * fine[..., None])
    primer = col(0.32, 0.30, 0.28)
    a = mix(a, primer[None, None], rim * 0.0)
    a = mix(a, steel, chip)
    # grime: vertical run streaks + dust
    runs = sstep(0.2, 2.0, spectral(n, 116, 3, 300, 0.7, ax=1.0, ay=25.0))
    dust = sstep(-0.3, 1.5, spectral(n, 117, 2, 30, 1.0))
    grime = col(0.20, 0.15, 0.09)[None, None]
    dustc = col(0.62, 0.55, 0.44)[None, None]
    a = mix(a, a * grime / 0.5, runs * 0.35)
    a = mix(a, dustc, dust * 0.28)
    a = a * (1 + 0.04 * mid[..., None])
    h = 0.1 * mid + 0.15 * fine - 1.0 * chip + 0.25 * rim
    metal = chip * 0.85
    rough = 0.45 + 0.1 * lo + 0.25 * dust + 0.15 * runs + 0.1 * chip
    return dict(albedo=a, height=h, nstr=1.2, rough=rough, metal=metal, ao=cavity_ao(h, 3, 0.25, 0.5))


def rubber_track(n):
    # chevron lugs along v (track length = tile v), 6 lugs per tile
    yy, xx = np.mgrid[0:n, 0:n] / n
    L = 6
    xc = np.abs(xx - 0.5)
    ph = (yy * L + xc * 1.2) % 1.0
    lug = sstep(0.0, 0.05, ph) * sstep(0.42, 0.37, ph) * sstep(0.47, 0.44, xc)
    center = sstep(0.05, 0.035, np.abs(xx - 0.5)) * 0.0
    body = sstep(0.5, 0.47, xc)
    wear = spectral(n, 121, 4, 200, 0.6)
    h = 1.0 * lug + 0.1 * wear * lug + 0.05 * spectral(n, 122, 100, 500, 0.0)
    rub = col(0.055, 0.055, 0.058)
    a = rub[None, None] * (1 + 0.15 * spectral(n, 123, 60, 500, 0.2)[..., None])
    groove = (1 - lug) * body
    mud = sstep(0.8, 2.0, spectral(n, 124, 4, 60, 0.9)) * groove
    a = mix(a, col(0.30, 0.24, 0.17)[None, None], mud * 0.45)
    a = mix(a, a * 1.6, lug * sstep(0.5, 2.0, wear) * 0.5)  # polished lug tops
    rough = 0.82 - 0.15 * lug + 0.1 * mud
    return dict(albedo=a, height=h * 2.5, nstr=1.6, rough=rough, metal=0.0, ao=cavity_ao(h * 2.5, 5, 0.4, 0.35))


def rusty_metal(n):
    lo = spectral(n, 131, 1, 10, 1.2); mid = spectral(n, 132, 6, 100, 1.0); fine = spectral(n, 133, 80, 500, 0.3)
    w1, w2 = spectral(n, 134, 2, 20, 1.0), spectral(n, 135, 2, 20, 1.0)
    rm = warp(lo + 0.6 * mid, 30 * w1, 30 * w2)
    rust = sstep(-0.1, 0.5, rm)
    heavy = sstep(0.6, 1.4, rm)
    steel = col(0.30, 0.30, 0.31)[None, None] * (1 + 0.08 * fine[..., None] + 0.05 * mid[..., None])
    r1, r2, r3 = col(0.42, 0.20, 0.08), col(0.27, 0.13, 0.06), col(0.55, 0.30, 0.12)
    rc = mix(r1[None, None] * np.ones((n, n, 1)), r2[None, None], sstep(-1, 1, mid))
    rc = mix(rc, r3[None, None], sstep(1.0, 2.5, fine + mid) * 0.6)
    a = mix(steel, rc, rust)
    a = mix(a, a * 0.7, heavy * 0.5)
    streak = sstep(0.4, 2.0, spectral(n, 136, 3, 300, 0.7, ax=1.0, ay=25.0)) * (1 - rust)
    a = mix(a, r2[None, None], streak * 0.35)
    pits = sstep(2.0, 2.8, spectral(n, 137, 120, 500, 0.0)) * rust
    h = 0.5 * rust * (1 + 0.4 * fine) + 0.4 * heavy * mid - 1.0 * pits + 0.05 * fine
    rough = mix(0.38 + 0.06 * fine, 0.9 + 0.04 * fine, rust)
    metal = np.clip(1 - rust * 1.2 - streak * 0.3, 0, 1)
    return dict(albedo=a, height=h, nstr=1.4, rough=rough, metal=metal, ao=cavity_ao(h, 3, 0.3, 0.45))


def tyre_track_decal(n):
    # RGBA decal: 1 tile = track width x 2*width, grousers across, soft broken edges. v = travel direction.
    W, H = n // 2, n
    yy, xx = np.mgrid[0:H, 0:W]
    u, v = xx / W, yy / H
    # periodic noises sampled from square fields
    def sq(seed, lo, hi, beta):
        return spectral(H, seed, lo, hi, beta)[:, :W]
    e1 = sq(141, 2, 30, 1.0); e2 = sq(142, 2, 30, 1.0); fine = sq(143, 60, 500, 0.3)
    band = sstep(0.04, 0.12 + 0.03 * e1, u) * sstep(0.96, 0.88 + 0.03 * e2, u)
    G = 10  # grousers per tile
    ph = (v * G + 0.02 * e1) % 1.0
    ridge = sstep(0.0, 0.08, ph) * sstep(0.30, 0.20, ph)  # compressed bar imprint (low)
    push = sstep(0.30, 0.36, ph) * sstep(0.48, 0.38, ph)  # soil pushed up behind bar
    h = -1.0 * ridge + 0.5 * push + 0.08 * fine
    h = h * band
    alpha = np.clip(band * (0.65 + 0.25 * ridge + 0.1 * e1) * sstep(-2.2, -1.2, e2), 0, 1)
    c = col(0.30, 0.24, 0.18)[None, None] * (1 + 0.06 * blur(spectral(H, 144, 10, 120, 0.6), 1)[:, :W][..., None]) * (0.8 + 0.3 * push[..., None] - 0.2 * ridge[..., None])
    nrm = None
    return dict(albedo=c, height=h, nstr=3.0, alpha=alpha, rough=0.75 + 0.15 * push, metal=0.0, rect=True)


ROLES = dict(concrete_floor=concrete_floor, ceiling_panel=ceiling_panel, desk_laminate=desk_laminate,
             brushed_metal=brushed_metal, black_plastic=black_plastic, carpet=carpet, fabric_chair=fabric_chair,
             glass_smudge=glass_smudge, dirt_ground=dirt_ground, gravel=gravel, tyre_track_decal=tyre_track_decal,
             rock_ridge=rock_ridge, excavator_paint=excavator_paint, rubber_track=rubber_track, rusty_metal=rusty_metal)


def to8(x):
    return np.clip(np.round(np.asarray(x, np.float64) * 255), 0, 255).astype(np.uint8)


def normal_rect(h, strength):
    gx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) * 0.5 * strength
    gy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) * 0.5 * strength
    nrm = np.stack([-gx, gy, np.ones_like(h)], -1)
    return nrm / np.linalg.norm(nrm, axis=-1, keepdims=True)


def save(out, role, d):
    os.makedirs(out, exist_ok=True)
    w = lambda name, img: cv2.imwrite(os.path.join(out, f'{role}_{name}.png'), img)
    if role == 'glass_smudge':
        z = np.zeros_like(d['dirt'])
        w('orm', cv2.cvtColor(np.dstack([to8(d['dirt']), to8(d['rough']), to8(z)]), cv2.COLOR_RGB2BGR))
        return
    a = np.clip(d['albedo'], 0, 1)
    h = d['height']
    # height is in arbitrary units; normalise slope to texel scale so strength is resolution independent
    nm = normal_rect(h, d['nstr'] * (h.shape[0] / 1024) ** 0 * 1.0)
    nm8 = to8(nm * 0.5 + 0.5)
    if d.get('alpha') is not None:
        rgba = np.dstack([to8(a), to8(d['alpha'])])
        w('color', cv2.cvtColor(rgba, cv2.COLOR_RGBA2BGRA))
    else:
        w('color', cv2.cvtColor(to8(a), cv2.COLOR_RGB2BGR))
    w('normal', cv2.cvtColor(nm8, cv2.COLOR_RGB2BGR))
    ao = d.get('ao'); ao = np.ones_like(h) if ao is None else ao
    rough = np.clip(np.broadcast_to(d['rough'], h.shape), 0.02, 1)
    metal = np.clip(np.broadcast_to(np.asarray(d['metal'], np.float64), h.shape), 0, 1)
    w('orm', cv2.cvtColor(np.dstack([to8(ao), to8(rough), to8(metal)]), cv2.COLOR_RGB2BGR))


if __name__ == '__main__':
    out = sys.argv[1]
    roles = sys.argv[2:] or list(ROLES)
    for r in roles:
        print('gen', r, flush=True)
        save(out, r, ROLES[r](N))
