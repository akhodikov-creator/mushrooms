import * as THREE from 'three';

/* ============================================================
   Предплечье и рукав — общие для обеих рук (weapons.js, body.js)

   Раньше предплечье было ровной трубой, а рукав — цилиндром с плоским
   торцом: издали терпимо, но у самой камеры читалось консервной банкой.
   Здесь предплечье лепится по форме руки: у запястья узкое и плоское,
   к локтю толще, где лежат мышцы, в сечении овал. Рукав — ткань:
   закатанный валик-манжета, за ним сам рукав в складках, уходящий
   из кадра открытым концом, без торца.

   Всё строится вдоль +Z: запястье в z = 0, локоть дальше по оси.
   Вызывающий сам ставит это матрицей куда нужно.
   ============================================================ */

/** Цвет по вершинам: fn(t вдоль длины, угол) → множитель яркости. */
function shade(geo, hex, fn) {
  const c = new THREE.Color(hex);
  const p = geo.attributes.position, uv = geo.attributes.uv, n = p.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const k = fn ? fn(uv.getY(i), uv.getX(i) * Math.PI * 2) : 1;
    arr[i * 3] = c.r * k; arr[i * 3 + 1] = c.g * k; arr[i * 3 + 2] = c.b * k;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/**
 * Трубка вдоль +Z с переменным сечением: radius(t, a) — радиус на доле
 * длины t и угле a. Сечение по кругу, дальше его сплющивают как надо.
 * Торцов нет: и рука, и рукав уходят из кадра.
 */
function tube(len, radius, segA = 18, segL = 14, z0 = 0) {
  const pos = [], uv = [], idx = [];
  for (let j = 0; j <= segL; j++) {
    const t = j / segL;
    for (let i = 0; i <= segA; i++) {
      const u = i / segA, a = u * Math.PI * 2;
      const r = radius(t, a);
      pos.push(Math.cos(a) * r, Math.sin(a) * r, z0 + t * len);
      uv.push(u, t);
    }
  }
  const row = segA + 1;
  for (let j = 0; j < segL; j++) {
    for (let i = 0; i < segA; i++) {
      const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, b, c, b, d, c);         // обход против часовой снаружи — грани наружу
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Предплечье: от запястья (z = 0) на len назад. Тыл руки — в +Y.
 * Запястье узкое и плоское, к локтю мышцы, со стороны ладони полнее.
 */
export function forearmGeometry(len = 0.16) {
  const g = tube(len, (t, a) => {
    const r = 0.029 + 0.016 * Math.sin(Math.min(1, t / 0.75) * Math.PI * 0.5) - 0.002 * Math.max(0, t - 0.75) * 4;
    // мышцы сгибателей — со стороны ладони (-Y) полнее
    const belly = 1 + 0.08 * Math.max(0, -Math.sin(a)) * Math.sin(t * Math.PI);
    return r * belly;
  }, 20, 12);
  // в сечении овал: у запястья сплюснут сильнее
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getZ(i) / len;
    p.setX(i, p.getX(i) * (1.22 - 0.1 * t));
    p.setY(i, p.getY(i) * (0.8 + 0.1 * t));
  }
  g.computeVertexNormals();
  // к локтю чуть темнее: дальше от камеры и в тени рукава
  return shade(g, 0xffffff, (t) => 1 - 0.14 * t);
}

/**
 * Рукав куртки, закатанный до локтя: z0 — где начинается манжета.
 * Манжета — толстый валик скатанной ткани, за ним рукав в складках,
 * длиной len; дальний конец открыт и уходит из кадра.
 */
export function sleeveGeometry(z0 = 0.13, len = 0.3, hex = 0x8e9a72) {
  const parts = [];
  // Складки: несколько волн по кругу, сдвинутых вдоль рукава, — ткань
  // собирается гармошкой и перекашивается, ровных гофр у неё нет.
  const folds = (t, a) =>
    0.0032 * Math.sin(a * 5 + t * 7.0) + 0.0022 * Math.sin(a * 9 - t * 11.0 + 1.3)
    + 0.0026 * Math.sin(t * 38.0 + a * 1.5);

  // валик манжеты: бублик с изнанкой, обращённой к руке
  const roll = tube(0.05, (t, a) => {
    const bulge = Math.sin(t * Math.PI);
    return 0.047 + 0.011 * bulge + folds(t, a) * 0.6;
  }, 22, 8, z0);
  shade(roll, hex, (t) => 0.82 + 0.25 * Math.sin(t * Math.PI));
  parts.push(roll);

  // губа манжеты: заворот к руке, чтобы не было видно пустого торца
  const lip = new THREE.RingGeometry(0.036, 0.048, 22, 1);
  lip.translate(0, 0, z0);
  const lu = lip.attributes.uv;
  for (let i = 0; i < lu.count; i++) lu.setXY(i, lu.getX(i), 0);
  shade(lip, hex, () => 0.55);
  // кольцо смотрит в +Z — разворачиваем к кисти
  lip.rotateY(Math.PI);
  lip.translate(0, 0, 2 * z0);
  parts.push(lip);

  // сам рукав: чуть шире к плечу, в складках
  const sl = tube(len, (t, a) => 0.054 + 0.012 * t + folds(t + 0.4, a), 22, 16, z0 + 0.042);
  shade(sl, hex, (t, a) => (0.92 + 0.08 * Math.sin(a * 5 + t * 7.0)) * (1 - 0.18 * t));
  parts.push(sl);
  return parts;
}
