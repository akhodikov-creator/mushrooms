# -*- coding: utf-8 -*-
"""Чистка текстуры фотоскана лукошка.

Фотоскан снимали на столе посреди комнаты, и в его текстуры попала
вся комната: белый стол, синий пол, тёмные вещи. Часть сетки лукошка
(дно, кромки) при съёмке взяла цвет оттуда — на боку в игре были
тёмные и бело-синие пятна.

Здесь всё, что не похоже на плетёнку, перекрашивается в неё:
  1. маска плетёнки — пиксели соломенного оттенка;
  2. дыры заливаются её цветом «пирамидой»: сначала грубо на уменьшенных
     копиях, потом всё точнее, — так цвет плавно перетекает из соседних
     прутьев и не остаётся резких краёв;
  3. на залитое кладётся узор настоящего плетения с самого чистого
     участка скана — иначе заливка читалась бы гладкой клеёнкой.

    python tools/wicker-clean.py assets/containers/basket_col.webp
"""
import sys
import numpy as np
from PIL import Image

src = sys.argv[1]
dst = sys.argv[2] if len(sys.argv) > 2 else src
img = np.asarray(Image.open(src).convert('RGB')).astype(np.float32) / 255.0
H, W, _ = img.shape

# --- 1. маска плетёнки по оттенку ---
r, g, b = img[..., 0], img[..., 1], img[..., 2]
mx = img.max(axis=2); mn = img.min(axis=2)
d = mx - mn + 1e-6
hue = np.zeros_like(mx)
m = mx == r
hue[m] = ((g - b)[m] / d[m]) % 6
m = mx == g
hue[m] = (b - r)[m] / d[m] + 2
m = mx == b
hue[m] = (r - g)[m] / d[m] + 4
hue *= 60.0
sat = d / (mx + 1e-6)
straw = (hue >= 16) & (hue <= 52) & (sat >= 0.2) & (sat <= 0.9) & (mx >= 0.26)
print('плетёнки в текстуре: %.0f%%' % (straw.mean() * 100))

# --- 2. заливка пирамидой ---
def down(c, w):
    h2, w2 = c.shape[0] // 2, c.shape[1] // 2
    c = c[:h2 * 2, :w2 * 2]; w = w[:h2 * 2, :w2 * 2]
    cs = (c * w[..., None]).reshape(h2, 2, w2, 2, 3).sum(axis=(1, 3))
    ws = w.reshape(h2, 2, w2, 2).sum(axis=(1, 3))
    return cs / np.maximum(ws, 1e-6)[..., None], np.minimum(ws, 1.0)

def upsample(a, h, w):
    # сглаженное увеличение: повтор пикселей давал заливку квадратами
    return np.stack([np.asarray(Image.fromarray(a[..., k].astype(np.float32), mode='F')
                                .resize((w, h), Image.BILINEAR)) for k in range(3)], axis=-1)

levels = [(img, straw.astype(np.float32))]
while levels[-1][0].shape[0] > 4:
    levels.append(down(*levels[-1]))
# на самом грубом уровне пустые клетки — общим цветом плетёнки, иначе
# туда, где соломы не было вовсе, пролезал чёрный
mean = img[straw].mean(axis=0) if straw.any() else np.array([0.62, 0.45, 0.26])
c0, w0 = levels[-1]
fill = c0 * w0[..., None] + mean * (1 - w0[..., None])
for c, w in reversed(levels[:-1]):
    up = upsample(fill, c.shape[0], c.shape[1])
    fill = c * w[..., None] + up * (1 - w[..., None])

# --- 3. узор плетения с чистого участка ---
P = 96
best, bxy = -1, (0, 0)
sm = straw.astype(np.float32)
for y in range(0, H - P, 16):
    for x in range(0, W - P, 16):
        s = sm[y:y + P, x:x + P].mean()
        if s > best:
            best, bxy = s, (y, x)
py, px = bxy
patch = img[py:py + P, px:px + P]
lum = patch.mean(axis=2)
# только мелкая фактура прутьев: крупные перепады (кромки, тени) из
# образца убираем, делением на размытую копию, — иначе при повторе
# они ложатся полосами
blur = np.asarray(Image.fromarray(lum.astype(np.float32), mode='F').resize((6, 6), Image.BILINEAR)
                  .resize((P, P), Image.BILINEAR))
detail = np.clip(lum / np.maximum(blur, 1e-3), 0.7, 1.3)
tile = np.tile(detail, (H // P + 1, W // P + 1))[:H, :W]
print('образец плетения: %d×%d в (%d, %d), чистота %.0f%%' % (P, P, px, py, best * 100))

# там, где плетёнки не было, — заливка с узором; где была — как есть
k = 1 - sm
out = img * (1 - k[..., None]) + np.clip(fill * (0.4 + 0.6 * tile[..., None]), 0, 1) * k[..., None]
Image.fromarray((np.clip(out, 0, 1) * 255 + 0.5).astype(np.uint8)).save(dst, 'WEBP', quality=86)
print('сохранено:', dst)
