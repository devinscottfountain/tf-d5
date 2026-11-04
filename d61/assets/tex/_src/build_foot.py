# Encode gen_foot.py masters into the shipped WebP / HDR set and write manifest.json (sizes per tier).
# usage: python3 -I build_foot.py <png_dir> <d61/assets/tex>
import sys, os, json, subprocess
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
D6 = '../../../d6/assets/tex/'  # shared files, relative to d61/assets/tex/
files = {}


def resize(img, s):
    return img if img.size[0] == s else img.resize((s, s), Image.LANCZOS)


def renorm(img):
    v = np.asarray(img, np.float32) / 127.5 - 1
    v /= np.linalg.norm(v, axis=-1, keepdims=True) + 1e-6
    return Image.fromarray(np.clip(np.round((v + 1) * 127.5), 0, 255).astype(np.uint8))


def emit(role, kind, size, q):
    rel = f'{size if size != 1024 else "1k"}/{role}_{kind}.webp'
    if rel in files: return rel
    p = os.path.join(out, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    img = Image.open(os.path.join(src, f'{role}_{dict(c="color", n="normal", orm="orm")[kind]}.png')).convert('RGB')
    img = resize(img, size)
    if kind == 'n': img = renorm(img)
    tmp = p + '.png'; img.save(tmp)
    extra = ['-sharp_yuv'] if kind == 'c' else []
    subprocess.run(['cwebp', '-quiet', '-mt', '-m', '6', '-q', str(q), *extra, tmp, '-o', p], check=True)
    os.remove(tmp); files[rel] = os.path.getsize(p)
    return rel


# role: (texScale, high {c,n,orm: (size, q)}, low {...} or None)
SETS = {
    'regolith': (4, dict(c=(1024, 80), n=(1024, 78), orm=(512, 75)), dict(c=(512, 78), n=(512, 75), orm=(256, 75))),
    'mars_rock': (3, dict(c=(1024, 80), n=(1024, 78), orm=(512, 75)), dict(c=(512, 78), n=(512, 75))),
    'dome_frame': (0.5, dict(c=(256, 82), n=(512, 80), orm=(256, 78)), None),
    'foliage': (0.6, dict(c=(512, 80), n=(512, 78), orm=(256, 78)), dict(c=(256, 80))),
    'habitat_panel': ([2, 2], dict(c=(512, 82), n=(512, 82), orm=(512, 78)), dict(c=(256, 80))),
    'stainless': ([1, 1.8], dict(c=(512, 80), n=(512, 80), orm=(256, 78)), dict(n=(256, 80))),
    'rover_paint': (1, dict(c=(512, 80), n=(512, 78), orm=(256, 78)), None),
}
manifest = {}
for role, (s, hi, lo) in SETS.items():
    m = {'s': s, 'hi': {k: emit(role, k, *v) for k, v in hi.items()}}
    m['lo'] = {k: emit(role, k, *v) for k, v in lo.items()} if lo else None
    manifest[role] = m
manifest['dome_glass'] = {'s': 1.5, 'hi': {'orm': D6 + '512/glass_smudge_orm.webp'}, 'lo': {'orm': D6 + '512/glass_smudge_orm.webp'}}


# dusk sky: RLE RGBE 256 x 128 (high), sRGB WebP of linear * 0.5 (low; loader scales intensity by 2)
def write_hdr(path, a):
    h, w, _ = a.shape
    m = a.max(-1); e = np.floor(np.log2(np.maximum(m, 1e-32))) + 1
    sc = np.where(m > 1e-32, 256.0 / np.exp2(e), 0)
    rgbe = np.zeros((h, w, 4), np.uint8)
    rgbe[..., :3] = np.clip(a * sc[..., None], 0, 255).astype(np.uint8)
    rgbe[..., 3] = np.where(m > 1e-32, e + 128, 0).astype(np.uint8)
    buf = bytearray(b'#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n' + f'-Y {h} +X {w}\n'.encode())
    for y in range(h):
        buf += bytes([2, 2, w >> 8, w & 255])
        for c in range(4):
            row = rgbe[y, :, c]; i = 0
            while i < w:
                j = i
                while j < w and j - i < 127 and row[j] == row[i]: j += 1
                if j - i >= 4: buf += bytes([128 + j - i, row[i]]); i = j; continue
                k = i  # literal run until a repeat of 4 starts
                while k < w and k - i < 128:
                    if k + 3 < w and row[k] == row[k + 1] == row[k + 2] == row[k + 3]: break
                    k += 1
                buf += bytes([k - i]) + row[i:k].tobytes(); i = k
    open(path, 'wb').write(buf)


sky = np.load(os.path.join(src, 'dusk_sky.npy'))
sky2 = sky.reshape(128, 2, 256, 2, 3).mean((1, 3))
write_hdr(os.path.join(out, 'dusk_sky.hdr'), sky2); files['dusk_sky.hdr'] = os.path.getsize(os.path.join(out, 'dusk_sky.hdr'))
ldr = np.clip(sky2 * 0.5, 0, 1); ldr = np.where(ldr <= 0.0031308, ldr * 12.92, 1.055 * ldr ** (1 / 2.4) - 0.055)
p = os.path.join(out, '256/dusk_sky_ldr.webp'); os.makedirs(os.path.dirname(p), exist_ok=True)
Image.fromarray((ldr * 255 + 0.5).astype(np.uint8)).save(p + '.png')
subprocess.run(['cwebp', '-quiet', '-m', '6', '-q', '85', '-sharp_yuv', p + '.png', '-o', p], check=True); os.remove(p + '.png')
files['256/dusk_sky_ldr.webp'] = os.path.getsize(p)
manifest['dusk_sky'] = {'s': 1, 'hi': {'hdr': 'dusk_sky.hdr'}, 'lo': {'ldr': '256/dusk_sky_ldr.webp', 'scale': 2}}

d6 = os.path.join(out, D6)
def size(rel): return files.get(rel) or os.path.getsize(os.path.normpath(os.path.join(out, rel)))
tot = {}
for tier in ('hi', 'lo'):
    seen = set()
    for m in manifest.values():
        for k, rel in (m[tier] or {}).items():
            if k != 'scale': seen.add(rel)
    tot[tier] = sum(size(r) for r in seen)
manifest['_sizes'] = {k: v for k, v in sorted(files.items())}
manifest['_totals'] = tot
json.dump(manifest, open(os.path.join(src if False else out, '_src/manifest.json'), 'w'), indent=1)
for k, v in sorted(files.items()): print(f'{v / 1024:7.1f} KB  {k}')
print('high %.1f KB, low %.1f KB' % (tot['hi'] / 1024, tot['lo'] / 1024))
