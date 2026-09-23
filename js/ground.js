/* ============================================================
   Фото-текстуры земли
   ============================================================
   Сканы лесной подстилки с Poly Haven (лицензия CC0), по одному на
   выдел: песок с хвоей в бору, мох в ельнике, листва в березняке.
   Скачаны и ужаты tools/ph-fetch.html в assets/ground.

   Раньше земля была одной процедурной текстурой, подкрашенной по
   вершинам. Вершины у грунта стоят раз в девять метров, и настоящую
   фото-текстуру по ним не раскрасить — поэтому слои смешивает шейдер
   по отдельной карте выделов (её печёт world.js).

   Все слои сложены в два массива текстур — цвет и нормали. Так шейдер
   берёт любой слой по номеру, а не держит по сэмплеру на каждый: иначе
   пять слоёв с нормалями съели бы десять из шестнадцати гнёзд, и на
   тени от фонаря могло не хватить.
   ============================================================ */
import * as THREE from 'three';

// Порядок = номер слоя в массиве. world.js ссылается на эти номера.
export const GROUND_LAYERS = [
  'forrest_sand_01',     // 0: песок с хвоей — бор
  'forrest_ground_01',   // 1: мох и хвоя — ельник, поляна
  'forest_leaves_04',    // 2: бурая листва — березняк
  'forest_floor',        // 3: рыже-красная листва — осинник
  'forest_ground_06',    // 4: тёмная сырая земля — низина, берег, склоны
];
const SIZE_COL = 1024;
const SIZE_NRM = 512;

let arrays = null;
export function groundLoaded() { return !!arrays; }
export function groundArrays() { return arrays; }

// Кора сосны и ели — тоже скан Poly Haven (knotted_pine_bark). Лежит
// здесь же, в assets/ground, и грузится вместе с землёй.
let bark = null;
export function pineBark() { return bark; }

function loadBark(base) {
  const tl = new THREE.TextureLoader();
  const one = (url, srgb) => tl.loadAsync(url).then((t) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  });
  return Promise.all([
    one(base + 'knotted_pine_bark_Diffuse.webp', true),
    one(base + 'knotted_pine_bark_nor_gl.webp', false),
  ]).then(([col, nrm]) => { bark = { col, nrm }; })
    .catch((e) => console.warn('кора не загрузилась, стволы остаются прежними:', e));
}

/**
 * Картинки в массив текстур.
 *
 * Рисуем вверх ногами нарочно. Обычная текстура из картинки
 * переворачивается при загрузке (flipY), а массив из байтов — нет, и
 * без переворота верх картинки оказался бы внизу. Для цвета это
 * неважно, а у карты нормалей перевернулся бы зелёный канал, и свет
 * падал бы на бугры не с той стороны.
 */
async function toArray(urls, size, srgb) {
  const layers = urls.length;
  const data = new Uint8Array(size * size * 4 * layers);
  const c = new OffscreenCanvas(size, size);
  const g = c.getContext('2d', { willReadFrequently: true });
  for (let i = 0; i < layers; i++) {
    const blob = await (await fetch(urls[i])).blob();
    const bmp = await createImageBitmap(blob);
    g.setTransform(1, 0, 0, -1, 0, size);
    g.drawImage(bmp, 0, 0, size, size);
    data.set(g.getImageData(0, 0, size, size).data, i * size * size * 4);
  }
  const t = new THREE.DataArrayTexture(data, size, size, layers);
  t.format = THREE.RGBAFormat;
  t.type = THREE.UnsignedByteType;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

/** Никогда не отклоняется: без текстур земля остаётся прежней. */
export function loadGround(base = 'assets/ground/') {
  if (arrays) return Promise.resolve(true);
  const col = GROUND_LAYERS.map((n) => base + n + '_Diffuse.webp');
  const nrm = GROUND_LAYERS.map((n) => base + n + '_nor_gl.webp');
  const barkDone = loadBark(base);
  return Promise.all([toArray(col, SIZE_COL, true), toArray(nrm, SIZE_NRM, false)])
    .then(async ([c, n]) => { arrays = { col: c, nrm: n }; await barkDone; return true; })
    .catch((e) => {
      console.warn('текстуры земли не загрузились, земля остаётся прежней:', e);
      return false;
    });
}
