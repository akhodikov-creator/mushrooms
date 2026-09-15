# -*- coding: utf-8 -*-
# Запуск: python tools/plants-atlas.py <исходный .gltf> <папка вывода>
"""Атлас листвы: 21 карточка 1024² -> ячейки 256² в одном листе.

   Две тонкости:
   1. Поля. Мипмапы усредняют соседние ячейки, и на дальнем плане
      в траву затекают чужие листья. Карточка кладётся 240² в шаге 256,
      между ними 8 пикселей пустоты.
   2. Растекание цвета. В прозрачных местах PNG хранит чёрный, и при
      сглаживании по краям листа проступает тёмная кайма. Поэтому RGB
      размазывается наружу под альфой.
"""
import json, base64, io, os, sys
import numpy as np
from PIL import Image

src, outdir = sys.argv[1], sys.argv[2]
os.makedirs(outdir, exist_ok=True)
d = json.load(open(src, encoding='utf-8'))
BLOB = base64.b64decode(d['buffers'][0]['uri'].split(',', 1)[1])

def img_by_name(nm):
    for im in d['images']:
        if im.get('name') == nm:
            v = d['bufferViews'][im['bufferView']]
            o = v.get('byteOffset', 0)
            return Image.open(io.BytesIO(BLOB[o:o+v['byteLength']]))
    raise KeyError(nm)

CARDS = ['branch-01','branch-02','branch-1-01','branch-1-02','branch-2-01','branch-2-02',
         'shrubbery-01','shrubbery-02','shrubbery-1-01','shrubbery-1-02',
         'hedge-01','hedge-02','grass-01','grass-02','flowers-01','flowers-02',
         'clover-01','clover-02','clover-03','clover-04','clover-05']
COLS, PITCH, INNER = 8, 256, 240
ROWS = (len(CARDS) + COLS - 1) // COLS
W, H = COLS * PITCH, ROWS * PITCH
PAD = (PITCH - INNER) // 2

def dilate(rgba, steps=12):
    """Растянуть цвет под прозрачные пиксели, чтобы не темнила кайма."""
    a = np.array(rgba, dtype=np.uint8)
    rgb = a[..., :3].astype(np.float32)
    known = a[..., 3] > 8
    for _ in range(steps):
        if known.all(): break
        k = known.astype(np.float32)
        s = np.zeros_like(rgb); c = np.zeros_like(k)
        for dy, dx in ((1,0),(-1,0),(0,1),(0,-1)):
            s += np.roll(rgb * k[..., None], (dy, dx), (0, 1))
            c += np.roll(k, (dy, dx), (0, 1))
        grow = (~known) & (c > 0)
        rgb[grow] = (s[grow] / c[grow][..., None])
        known = known | grow
    a[..., :3] = np.clip(rgb, 0, 255).astype(np.uint8)
    return Image.fromarray(a, 'RGBA')

atlas = Image.new('RGBA', (W, H), (0, 0, 0, 0))
uv = {}
for i, nm in enumerate(CARDS):
    card = dilate(img_by_name(nm).convert('RGBA')).resize((INNER, INNER), Image.LANCZOS)
    cx, cy = (i % COLS) * PITCH + PAD, (i // COLS) * PITCH + PAD
    atlas.paste(card, (cx, cy))
    # прямоугольник ячейки в долях атласа; v отсчитывается снизу
    uv[nm] = [cx / W, 1.0 - (cy + INNER) / H, INNER / W, INNER / H]

atlas.save(os.path.join(outdir, 'plants.webp'), 'WEBP', quality=88, method=6)
atlas.save(os.path.join(outdir, 'plants_preview.png'))

bark = img_by_name('bark').convert('RGB').resize((256, 512), Image.LANCZOS)
bark.save(os.path.join(outdir, 'plants_bark.webp'), 'WEBP', quality=86, method=6)

json.dump(uv, open(os.path.join(outdir, 'atlas_uv.json'), 'w'), indent=1)
for f in ('plants.webp', 'plants_bark.webp'):
    print('%-20s %7.0f КБ' % (f, os.path.getsize(os.path.join(outdir, f)) / 1024))
print('атлас %dx%d, ячеек %d из %d' % (W, H, len(CARDS), COLS * ROWS))
