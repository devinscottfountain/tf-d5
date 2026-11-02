# Encode the PNG masters from gen_tex.py (plus the night sky HDR) into the shipped WebP / HDR set and print the manifest.
# usage: python3 -I build_tex.py <png_dir> <hdr_src> <out_dir>
import sys, os, json, subprocess, math
import numpy as np
import cv2

src, hdr_src, out = sys.argv[1:4]

BIG = ['concrete_floor', 'dirt_ground', 'gravel', 'rock_ridge', 'excavator_paint', 'rusty_metal']
SMALL = ['ceiling_panel', 'desk_laminate', 'brushed_metal', 'black_plastic', 'carpet', 'fabric_chair', 'rubber_track']
LOW = ['concrete_floor', 'desk_laminate', 'dirt_ground', 'excavator_paint', 'gravel', 'black_plastic', 'tyre_track_decal']
ORM512 = {'fabric_chair', 'rubber_track', 'carpet', 'ceiling_panel'}  # fine AO / pattern detail
# metres covered by one texture tile (u, v), for userData.texScale
SCALE = dict(concrete_floor=2, ceiling_panel=1.2, desk_laminate=1, brushed_metal=0.5, black_plastic=0.25, carpet=1,
             fabric_chair=0.12, glass_smudge=1.5, dirt_ground=4, gravel=1.5, tyre_track_decal=[0.6, 1.2], rock_ridge=6,
             excavator_paint=2, rubber_track=[0.5, 1], rusty_metal=2)


def fft_blur(a, s):
    n, m = a.shape[:2]
    fy = np.fft.fftfreq(n)[:, None]; fx = np.fft.fftfreq(m)[None, :]
    g = np.exp(-2 * math.pi ** 2 * s * s * (fx ** 2 + fy ** 2))
    return np.stack([np.real(np.fft.ifft2(np.fft.fft2(a[..., c]) * g)) for c in range(a.shape[2])], -1)


def resize(img, w, h):
    if img.shape[1] == w and img.shape[0] == h: return img
    return cv2.resize(img, (w, h), interpolation=cv2.INTER_AREA)


def norm_resize(nimg, w, h, blur=0.0):
    v = nimg.astype(np.float32) / 127.5 - 1
    if blur: v = fft_blur(v, blur)
    v = resize(v, w, h)
    v /= np.linalg.norm(v, axis=-1, keepdims=True) + 1e-6
    return np.clip(np.round((v + 1) * 127.5), 0, 255).astype(np.uint8)


def webp(img, path, q, extra=()):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + '.png'
    cv2.imwrite(tmp, img)
    subprocess.run(['cwebp', '-quiet', '-mt', '-m', '6', '-q', str(q), *extra, tmp, '-o', path], check=True)
    os.remove(tmp)
    return os.path.getsize(path)


files = {}
manifest = {}


def emit(rel, img, q, extra=()):
    p = os.path.join(out, rel)
    if rel not in files:
        files[rel] = webp(img, p, q, extra)
    return rel


def role_set(role, tier):
    c = cv2.imread(f'{src}/{role}_color.png', cv2.IMREAD_UNCHANGED)
    n = cv2.imread(f'{src}/{role}_normal.png')
    o = cv2.imread(f'{src}/{role}_orm.png')
    big = role in BIG
    if role == 'glass_smudge':
        return {'orm': emit(f'512/{role}_orm.webp', resize(o, 512, 512), 82)}
    if role == 'tyre_track_decal':
        return {'c': emit(f'256/{role}_c.webp', resize(c, 256, 512), 76, ('-alpha_q', '70', '-exact')),
                'n': emit(f'256/{role}_n.webp', norm_resize(n, 256, 512, 1.5), 74)}
    if tier == 'hi' and big:
        nb = 0.5 if role == 'excavator_paint' else 1.0  # keep paint chips crisp
        return {'c': emit(f'1k/{role}_c.webp', c, 76), 'n': emit(f'1k/{role}_n.webp', norm_resize(n, 1024, 1024, nb), 72),
                'orm': emit(f'512/{role}_orm.webp', resize(o, 512, 512), 75)}
    os_ = 512 if role in ORM512 else 256
    cq = 92 if role in ('black_plastic', 'fabric_chair', 'desk_laminate') else 78  # dark flats band at low q
    return {'c': emit(f'512/{role}_c.webp', resize(c, 512, 512), cq), 'n': emit(f'512/{role}_n.webp', norm_resize(n, 512, 512), 76),
            'orm': emit(f'{os_}/{role}_orm.webp', resize(o, os_, os_), 78)}


for role in BIG + SMALL + ['glass_smudge', 'tyre_track_decal']:
    manifest[role] = {'s': SCALE[role], 'hi': role_set(role, 'hi'), 'lo': role_set(role, 'lo') if role in LOW else None}

# night sky: HDR (RGBE, 256x128) for high, LDR sRGB webp for low / backgrounds
hdr = cv2.imread(hdr_src, cv2.IMREAD_UNCHANGED).astype(np.float32)
small = cv2.resize(hdr, (256, 128), interpolation=cv2.INTER_AREA)
os.makedirs(out, exist_ok=True)
cv2.imwrite(os.path.join(out, 'night_sky.hdr'), small)
files['night_sky.hdr'] = os.path.getsize(os.path.join(out, 'night_sky.hdr'))
EXPO = 2.0  # LDR encode: srgb(clamp(linear * EXPO)); loader divides by EXPO via envMapIntensity hint
for w in (1024, 512):
    l = cv2.resize(hdr, (w, w // 2), interpolation=cv2.INTER_AREA) * EXPO
    l = np.clip(l, 0, 1)
    s = np.where(l <= 0.0031308, l * 12.92, 1.055 * np.power(l, 1 / 2.4) - 0.055)
    emit(f'{w}/night_sky_ldr.webp', np.clip(np.round(s * 255), 0, 255).astype(np.uint8), 80)
# high loads the HDR only; 1024 LDR is an optional visible backdrop (not loaded by hero-tex.js)
manifest['night_sky_hdr'] = {'s': 1, 'expo': EXPO, 'hi': {'hdr': 'night_sky.hdr'}, 'lo': {'ldr': '512/night_sky_ldr.webp'}}

tot_hi = set(); tot_lo = set()
for r, m in manifest.items():
    for v in (m['hi'] or {}).values(): tot_hi.add(v)
    for v in (m['lo'] or {}).values(): tot_lo.add(v)
tot_hi.add('night_sky.hdr')
size = lambda s: sum(files[f] for f in s)
for f in sorted(files): print(f'{files[f]:>8}  {f}')
print('HIGH total', size(tot_hi), 'files', len(tot_hi))
print('LOW total', size(tot_lo), 'files', len(tot_lo))
print('ALL on disk', sum(files.values()))
json.dump(manifest, open(os.path.join(out, '_src', 'manifest.json') if os.path.isdir(os.path.join(out, '_src')) else os.path.join(out, 'manifest.json'), 'w'), separators=(',', ':'))
print('MANIFEST', json.dumps(manifest, separators=(',', ':')))
