import * as THREE from 'three';
import { mergeParts } from './geo.js';
import { CONFIG } from './config.js';
import { rng, terrainHeight, moisture, isWater, clamp, TAU, forestType } from './utils.js';
import { mushAtlasTex, MUSH_TILE } from './textures.js';

/* ============================================================
   Виды грибов средней полосы России.
   price — очки за штуку, weight — относительная частота.
   shape — профиль шляпки, см. capProfile().
   ============================================================ */

export const SPECIES = [
  // ---------- благородные ----------
  {
    id: 'bely', name: 'Белый гриб', latin: 'Boletus edulis', price: 240, weight: 3.2,
    capColor: 0x8a5a32, stemColor: 0xe8dcc2, shape: 'bulb',
    capR: 0.155, capH: 0.105, stemH: 0.135, stemR: 0.062, gills: 0xd8cfa8,
    wet: 0.55, tag: 'Царь грибов', rare: true,
  },
  {
    id: 'tsar', name: 'Белый-исполин', latin: 'Boletus edulis regalis', price: 720, weight: 0.42,
    capColor: 0x6d4423, stemColor: 0xf2e9cf, shape: 'bulb',
    capR: 0.255, capH: 0.175, stemH: 0.215, stemR: 0.105, gills: 0xd8cfa8,
    wet: 0.72, tag: 'ТРОФЕЙ!', rare: true, glow: 0x2a1d08,
  },
  {
    id: 'podosinovik', name: 'Подосиновик', latin: 'Leccinum aurantiacum', price: 155, weight: 5.0,
    capColor: 0xc2521f, stemColor: 0xdad3c4, shape: 'dome',
    capR: 0.125, capH: 0.082, stemH: 0.17, stemR: 0.043, gills: 0xcfc7ae,
    speckle: 0x3a3a38, wet: 0.5,
  },
  {
    id: 'podberezovik', name: 'Подберёзовик', latin: 'Leccinum scabrum', price: 120, weight: 5.6,
    capColor: 0x7b6046, stemColor: 0xdcd8cc, shape: 'dome',
    capR: 0.115, capH: 0.072, stemH: 0.185, stemR: 0.036, gills: 0xc9c3b0,
    speckle: 0x4a4a46, wet: 0.45,
  },
  {
    id: 'ryzhik', name: 'Рыжик', latin: 'Lactarius deliciosus', price: 105, weight: 4.2,
    capColor: 0xe07b28, stemColor: 0xe09046, shape: 'funnel',
    capR: 0.115, capH: 0.05, stemH: 0.07, stemR: 0.036, gills: 0xf0a04a,
    wet: 0.5,
  },
  {
    id: 'lisichka', name: 'Лисичка', latin: 'Cantharellus cibarius', price: 85, weight: 6.4,
    capColor: 0xf2b21c, stemColor: 0xf0bb3a, shape: 'funnel',
    capR: 0.078, capH: 0.036, stemH: 0.075, stemR: 0.026, gills: 0xf7cc55,
    cluster: [3, 7], wet: 0.6,
  },
  {
    id: 'gruzd', name: 'Груздь настоящий', latin: 'Lactarius resimus', price: 92, weight: 3.4,
    capColor: 0xf2eeda, stemColor: 0xeae4cc, shape: 'funnel',
    capR: 0.135, capH: 0.045, stemH: 0.062, stemR: 0.048, gills: 0xe6dfc0,
    cluster: [2, 4], wet: 0.68,
  },
  {
    id: 'maslenok', name: 'Маслёнок', latin: 'Suillus luteus', price: 62, weight: 6.8,
    capColor: 0x6b4a1c, stemColor: 0xf0dc86, shape: 'dome',
    capR: 0.072, capH: 0.042, stemH: 0.065, stemR: 0.026, gills: 0xe8d268,
    cluster: [3, 8], wet: 0.4, wet2: true,
  },
  {
    id: 'mokhovik', name: 'Моховик', latin: 'Xerocomus subtomentosus', price: 58, weight: 5.2,
    capColor: 0x6e6a34, stemColor: 0xd6cf9a, shape: 'dome',
    capR: 0.085, capH: 0.05, stemH: 0.085, stemR: 0.03, gills: 0xd8d878,
    wet: 0.55,
  },
  {
    id: 'openok', name: 'Опёнок осенний', latin: 'Armillaria mellea', price: 40, weight: 6.0,
    capColor: 0xb08544, stemColor: 0xdcc79a, shape: 'flat',
    capR: 0.055, capH: 0.028, stemH: 0.1, stemR: 0.016, gills: 0xe8dcbc,
    cluster: [5, 12], onStump: true, wet: 0.5,
  },
  {
    id: 'veshenka', name: 'Вешенка', latin: 'Pleurotus ostreatus', price: 50, weight: 2.6,
    capColor: 0x9e9a8e, stemColor: 0xd8d4c4, shape: 'shelf',
    capR: 0.115, capH: 0.03, stemH: 0.03, stemR: 0.024, gills: 0xe2ded0,
    cluster: [3, 6], onStump: true, wet: 0.5,
  },
  {
    id: 'syroezhka', name: 'Сыроежка', latin: 'Russula', price: 30, weight: 8.5,
    capColor: 0xc03a52, stemColor: 0xf4f2ea, shape: 'flat',
    capR: 0.085, capH: 0.032, stemH: 0.085, stemR: 0.028, gills: 0xf6f4ec,
    palette: [0xc03a52, 0x8c3f8e, 0x4c7a3a, 0xd07a26, 0xb8b03c], wet: 0.42,
  },
  {
    id: 'shampinion', name: 'Шампиньон', latin: 'Agaricus campestris', price: 34, weight: 4.0,
    capColor: 0xf0ead8, stemColor: 0xf2ecdc, shape: 'dome',
    capR: 0.068, capH: 0.042, stemH: 0.07, stemR: 0.026, gills: 0x9a6a72,
    cluster: [2, 5], wet: 0.35, meadow: true,
  },
  {
    id: 'zontik', name: 'Зонтик пёстрый', latin: 'Macrolepiota procera', price: 66, weight: 2.2,
    capColor: 0xcabfa8, stemColor: 0xd8cfb8, shape: 'cone',
    capR: 0.135, capH: 0.075, stemH: 0.28, stemR: 0.022, gills: 0xefeade,
    speckle: 0x6a5a44, wet: 0.35, meadow: true,
  },
  {
    id: 'dozhdevik', name: 'Дождевик', latin: 'Lycoperdon perlatum', price: 22, weight: 5.0,
    capColor: 0xeee8d6, stemColor: 0xe4dcc6, shape: 'ball',
    capR: 0.055, capH: 0.062, stemH: 0.022, stemR: 0.03, gills: 0xe4dcc6,
    speckle: 0xbfb49a, cluster: [2, 5], wet: 0.45,
  },

  // ---------- ядовитые ----------
  {
    id: 'mukhomor', name: 'Мухомор красный', latin: 'Amanita muscaria', price: -70, weight: 4.6,
    capColor: 0xd41f1f, stemColor: 0xf6f2e4, shape: 'dome',
    capR: 0.105, capH: 0.062, stemH: 0.175, stemR: 0.03, gills: 0xf8f6ec,
    warts: true, poison: true, wet: 0.5,
  },
  {
    id: 'mukhomor_big', name: 'ГИГАНТСКИЙ МУХОМОР', latin: 'Amanita muscaria maxima', price: -160, weight: 1.15,
    capColor: 0xe81010, stemColor: 0xfffaf0, shape: 'dome',
    capR: 0.34, capH: 0.2, stemH: 0.42, stemR: 0.085, gills: 0xfffaf0,
    warts: true, poison: true, wet: 0.55, glow: 0x3a0606,
    summons: 'bear', tag: 'НЕ ТРОГАЙ',
  },
  {
    id: 'poganka', name: 'Бледная поганка', latin: 'Amanita phalloides', price: -150, weight: 2.6,
    capColor: 0xc9d6b4, stemColor: 0xf4f6ea, shape: 'dome',
    capR: 0.1, capH: 0.055, stemH: 0.19, stemR: 0.026, gills: 0xf8faf0,
    poison: true, damage: 22, wet: 0.5, tag: 'смертельно',
  },
  {
    id: 'satanic', name: 'Сатанинский гриб', latin: 'Rubroboletus satanas', price: -120, weight: 1.5,
    capColor: 0xe2ddc8, stemColor: 0xc4342a, shape: 'bulb',
    capR: 0.155, capH: 0.1, stemH: 0.115, stemR: 0.07, gills: 0xd0403a,
    poison: true, wet: 0.5, summons: 'boar', tag: 'НЕ ТРОГАЙ',
  },
  {
    id: 'lozhnyi', name: 'Ложный опёнок', latin: 'Hypholoma fasciculare', price: -45, weight: 4.2,
    capColor: 0xd8c23c, stemColor: 0xe0d474, shape: 'flat',
    capR: 0.05, capH: 0.026, stemH: 0.095, stemR: 0.014, gills: 0x7a7a3a,
    poison: true, cluster: [4, 9], onStump: true, wet: 0.5,
  },
  {
    id: 'panterny', name: 'Мухомор пантерный', latin: 'Amanita pantherina', price: -80, weight: 2.4,
    capColor: 0x6b5238, stemColor: 0xf2eee0, shape: 'dome',
    capR: 0.098, capH: 0.055, stemH: 0.16, stemR: 0.027, gills: 0xf4f2e6,
    warts: true, poison: true, damage: 10, wet: 0.5,
  },
];

export const SPECIES_BY_ID = Object.fromEntries(SPECIES.map((s) => [s.id, s]));

/* ------------------------------------------------------------
   Профиль шляпки для LatheGeometry: массив Vector2 (радиус, высота)
   ------------------------------------------------------------ */
function capProfile(r, h, shape, stemR, N = 14) {
  const pts = [];
  const yOf = (t) => {
    switch (shape) {
      case 'bulb':   return h * Math.pow(Math.cos((t * Math.PI) / 2), 0.72);
      case 'dome':   return h * Math.sqrt(Math.max(0, 1 - t * t * 0.94));
      case 'flat':   return h * (1 - t * t * 0.9) * 0.85;
      case 'cone':   return h * Math.pow(1 - t, 1.35);
      case 'funnel': return h * (0.12 + 1.15 * t * t);
      case 'ball':   return h * Math.sqrt(Math.max(0, 1 - t * t));
      case 'shelf':  return h * (1 - t * t * 0.55) * 0.7;
      default:       return h * (1 - t);
    }
  };
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    // на макушке радиус ровно ноль, иначе остаётся микроотверстие
    pts.push(new THREE.Vector2(i === 0 ? 0 : r * t, yOf(t)));
  }
  // Нижняя кромка и возврат к оси. Профиль ОБЯЗАН прийти в радиус 0:
  // если оборвать его на радиусе ножки, тело вращения остаётся с
  // кольцевой дырой на макушке — именно она и просвечивала.
  const thick = Math.max(0.006, h * 0.2);
  pts.push(new THREE.Vector2(r * 0.985, yOf(1) - thick * 0.55));
  const inner = shape === 'funnel' || shape === 'flat' ? 0.35 : 0.55;
  pts.push(new THREE.Vector2(r * inner, yOf(0.45) - thick));
  pts.push(new THREE.Vector2(Math.max(0.004, stemR * 0.75), Math.max(0.002, yOf(0) - thick * 1.6)));
  pts.push(new THREE.Vector2(0, Math.max(0.001, yOf(0) - thick * 1.9)));
  return pts;
}

function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/* ------------------------------------------------------------
   Какую плитку атласа (textures.js, MUSH_TILE) берёт каждая часть.
   У подосиновика и подберёзовика ножка в тёмных чешуйках, у белого
   и сатанинского — в сеточке; у трубчатых снизу губка, у остальных
   пластинки.
   ------------------------------------------------------------ */
const STEM_TILE = {
  podosinovik: 'stemScaly', podberezovik: 'stemScaly',
  bely: 'stemNet', tsar: 'stemNet', satanic: 'stemNet',
};
const CAP_TILE = { zontik: 'capFlakes', dozhdevik: 'capFlakes' };
const PORES = new Set(['bely', 'tsar', 'podosinovik', 'podberezovik', 'maslenok', 'mokhovik', 'satanic']);

/**
 * Развёртку части — в её плитку атласа. uvOf(x, y, z, u, v) даёт
 * координаты внутри плитки 0..1; без него берётся родная развёртка.
 * У холста верх — это v = 1 (flipY), отсюда и пересчёт ряда.
 */
function toTile(geo, name, uvOf) {
  const [c, row] = MUSH_TILE[name];
  const uv = geo.attributes.uv, pos = geo.attributes.position;
  for (let i = 0; i < uv.count; i++) {
    let u = uv.getX(i), v = uv.getY(i);
    if (uvOf) [u, v] = uvOf(pos.getX(i), pos.getY(i), pos.getZ(i), u, v);
    u = 0.04 + clamp(u, 0, 1) * 0.92;
    v = 0.04 + clamp(v, 0, 1) * 0.92;
    uv.setXY(i, (c + u) / 4, 1 - (row + 1) / 2 + v / 2);
  }
  return geo;
}

/** Вершинный цвет по правилу: fn(x, y, z) → THREE.Color. */
function paintBy(geo, fn) {
  const p = geo.attributes.position, n = p.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const c = fn(p.getX(i), p.getY(i), p.getZ(i));
    arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Развернуть грани наизнанку (порядок обхода треугольников). */
function flipWinding(geo) {
  const ix = geo.index.array;
  for (let i = 0; i < ix.length; i += 3) { const t = ix[i]; ix[i] = ix[i + 2]; ix[i + 2] = t; }
  geo.index.needsUpdate = true;
  return geo;
}

const EARTH = new THREE.Color(0x5a4630);
const WHITE = new THREE.Color(0xffffff);

/**
 * Собирает один гриб: ножка, пластинки или губка, шляпка, хлопья.
 *
 * Цвет не плоский: шляпка к макушке темнее и насыщеннее, к краю
 * светлее (у белого — светлая кайма, по которой его и узнают), ножка
 * у земли в земле и темнее. Поверхность — из атласа: волокна шляпки,
 * чешуйки или сеточка на ножке, пластинки или губка снизу.
 */
function buildMushroomGeometry(sp, rnd, lo = false) {
  const parts = [];
  // Дальняя копия (lo) — та же форма и цвет, но редкая сетка: гриб за
  // тридцать метров занимает пару пикселей, а видно их за раз под
  // полторы сотни. Генератор вызывается в том же порядке, что и у
  // ближней, — иначе при переключении гриб менял бы форму.
  const SEG = lo ? 10 : 26, PN = lo ? 7 : 14;
  // Настоящие грибы мелкие, но на экране их нужно замечать —
  // поэтому весь вид слегка «игровой» по масштабу.
  const sc = (0.86 + rnd() * 0.32) * 1.34;
  const capR = sp.capR * sc, capH = sp.capH * sc;
  const stemH = sp.stemH * sc, stemR = sp.stemR * sc;
  const capHex = sp.palette ? sp.palette[(rnd() * sp.palette.length) | 0] : sp.capColor;
  const capCol = new THREE.Color(capHex);
  const stemCol = new THREE.Color(sp.stemColor);
  const gillCol = new THREE.Color(sp.gills);
  const tmp = new THREE.Color();

  // ножка у земли темнеет: в неё набилась подстилка
  const stemPaint = (hh) => (x, y) => {
    const t = clamp(y / Math.max(0.001, hh), 0, 1);
    tmp.copy(stemCol).lerp(EARTH, (1 - Math.min(1, t / 0.28)) * 0.55);
    return tmp.multiplyScalar(0.86 + 0.14 * t);
  };
  const stemTile = STEM_TILE[sp.id] || 'stem';

  // ножка
  if (sp.shape === 'shelf') {
    const st = new THREE.CylinderGeometry(stemR * 0.7, stemR, stemH, lo ? 5 : 8);
    st.rotateZ(0.5);
    st.translate(-capR * 0.55, stemH * 0.5, 0);
    parts.push(toTile(paint(st, sp.stemColor), stemTile));
  } else if (sp.shape !== 'ball') {
    const bulge = sp.shape === 'bulb' ? 1.55 : 1.0;
    const st = new THREE.CylinderGeometry(stemR * 0.8, stemR * bulge, stemH, lo ? 7 : 14, lo ? 1 : 5);
    // ножка слегка ведёт в сторону — прямые как карандаш не растут
    const sp2 = st.attributes.position;
    const bx = (rnd() - 0.5) * stemR * 1.2, bz = (rnd() - 0.5) * stemR * 1.2;
    for (let i = 0; i < sp2.count; i++) {
      const t = (sp2.getY(i) + stemH / 2) / stemH;
      sp2.setX(i, sp2.getX(i) + bx * t * t);
      sp2.setZ(i, sp2.getZ(i) + bz * t * t);
    }
    st.computeVertexNormals();
    st.translate(0, stemH * 0.5, 0);
    parts.push(toTile(paintBy(st, stemPaint(stemH)), stemTile));
    // кольцо-юбочка у мухоморов и поганки
    if (sp.warts || sp.id === 'poganka') {
      const ring = new THREE.TorusGeometry(stemR * 1.35, stemR * 0.28, lo ? 3 : 5, lo ? 8 : 16);
      ring.rotateX(Math.PI / 2);
      ring.scale(1, 0.6, 1);
      ring.translate(0, stemH * 0.74, 0);
      parts.push(toTile(paint(ring, sp.gills), 'stem'));
    }
  } else {
    const st = new THREE.CylinderGeometry(stemR * 0.6, stemR * 0.85, stemH, lo ? 6 : 10);
    st.translate(0, stemH * 0.5, 0);
    parts.push(toTile(paintBy(st, stemPaint(stemH)), 'stem'));
  }

  // шляпка
  const prof = capProfile(capR, capH, sp.shape, stemR, PN);
  // Низ шляпки — отдельной поверхностью пластинок или губки. Идёт вдоль
  // изнанки шляпки, от ножки к краю, чуть ниже неё: плоский диск
  // снизу читался тарелкой.
  const under = prof.slice(-4).reverse();      // от оси к краю изнанки
  // Профиль идёт от макушки наружу и вниз — у LatheGeometry от этого
  // грани смотрят внутрь, и снаружи была видна изнанка дальней стороны
  // шляпки (тёмный серп сверху). Разворачиваем.
  const cap = flipWinding(new THREE.LatheGeometry(prof, SEG));
  // Идеальное тело вращения выдаёт процедурку с первого взгляда:
  // мнём окружность и заваливаем шляпку на случайную сторону. Та же
  // деформация — и пластинкам, иначе край шляпки разойдётся с ними.
  const w1 = rnd() * TAU, w2 = rnd() * TAU;
  const tiltA = rnd() * TAU, tiltK = 0.1 + rnd() * 0.12;
  const deform = (geo) => {
    const cp = geo.attributes.position;
    for (let i = 0; i < cp.count; i++) {
      const x = cp.getX(i), y = cp.getY(i), z = cp.getZ(i);
      const ang = Math.atan2(z, x);
      const rr = Math.hypot(x, z);
      const k = 1 + Math.sin(ang * 2 + w1) * 0.055 + Math.sin(ang * 3 + w2) * 0.04;
      cp.setX(i, x * k);
      cp.setZ(i, z * k);
      cp.setY(i, y - Math.cos(ang - tiltA) * (rr / Math.max(0.001, capR)) * capH * tiltK);
    }
    geo.computeVertexNormals();
    return geo;
  };
  // цвет шляпки: макушка темнее, край светлее
  const rimCol = new THREE.Color(capHex).lerp(WHITE, 0.2);
  const band = sp.id === 'bely' || sp.id === 'tsar' ? new THREE.Color(0xe2d2ae) : null;
  const centerCol = new THREE.Color(capHex).multiplyScalar(0.78);
  paintBy(cap, (x, y, z) => {
    const t = clamp(Math.hypot(x, z) / capR, 0, 1);
    tmp.copy(centerCol).lerp(capCol, Math.min(1, t / 0.55));
    if (t > 0.55) tmp.lerp(rimCol, (t - 0.55) / 0.45);
    if (band && t > 0.86) tmp.lerp(band, Math.min(1, (t - 0.86) / 0.1) * 0.8);
    return tmp;
  });
  toTile(cap, CAP_TILE[sp.id] || 'cap', (x, y, z) => [0.5 + x / (2.1 * capR), 0.5 + z / (2.1 * capR)]);
  deform(cap);
  cap.translate(0, stemH, 0);

  let gills = null;
  if (sp.shape !== 'ball') {
    const pts = [];
    const GN = lo ? 3 : 6;
    for (let i = 0; i <= GN; i++) {
      const t = i / GN;
      // по изнанке: ломаная из профиля, чуть ниже неё
      const seg = t * (under.length - 1), k = Math.min(under.length - 2, Math.floor(seg)), f = seg - k;
      const x = under[k].x + (under[k + 1].x - under[k].x) * f;
      const y = under[k].y + (under[k + 1].y - under[k].y) * f;
      pts.push(new THREE.Vector2(Math.max(stemR * 0.95, Math.min(capR * 0.95, x)), y - 0.0025));
    }
    gills = new THREE.LatheGeometry(pts, SEG);
    paintBy(gills, (x, y, z) => {
      const t = clamp(Math.hypot(x, z) / capR, 0, 1);
      return tmp.copy(gillCol).multiplyScalar(0.72 + 0.28 * t);
    });
    toTile(gills, PORES.has(sp.id) ? 'pores' : 'gills', (x, y, z) => [0.5 + x / (2 * capR), 0.5 + z / (2 * capR)]);
    deform(gills);
    gills.translate(0, stemH, 0);
    // изнанкой вниз: у тела вращения нормали смотрят наружу от оси
    // в сторону обхода профиля — разворачиваем, если вышло вверх
    const nrm = gills.attributes.normal;
    let up = 0;
    for (let i = 0; i < nrm.count; i++) up += nrm.getY(i);
    if (up > 0) {
      flipWinding(gills);
      for (let i = 0; i < nrm.count; i++) nrm.setXYZ(i, -nrm.getX(i), -nrm.getY(i), -nrm.getZ(i));
    }
  }

  if (sp.shape === 'shelf') {
    for (const g of [cap, gills]) {
      if (!g) continue;
      g.scale(1, 1, 0.62);
      g.translate(capR * 0.12, 0, 0);
    }
  }
  parts.push(cap);
  if (gills) parts.push(gills);

  // белые хлопья мухомора
  if (sp.warts) {
    const n = 8 + ((rnd() * 7) | 0);
    for (let i = 0; i < n; i++) {
      const t = 0.12 + rnd() * 0.76;
      const a = rnd() * TAU;
      const rr = capR * t;
      const yy = stemH + capH * Math.sqrt(Math.max(0, 1 - t * t * 0.94)) * 0.99
        - Math.cos(a - tiltA) * t * capH * tiltK;
      const w = new THREE.SphereGeometry(capR * (0.05 + rnd() * 0.05), lo ? 4 : 7, lo ? 2 : 4);
      w.scale(1, 0.45, 1);
      w.translate(Math.cos(a) * rr, yy, Math.sin(a) * rr);
      parts.push(toTile(paint(w, 0xfff8ec), 'stem'));
    }
  }

  // Хвоинка или жёлтый листок на шляпке — у каждого третьего
  // съедобного. Мелочь, а гриб сразу «вырос в лесу», а не на складе.
  if (!sp.poison && sp.shape !== 'ball' && sp.shape !== 'shelf' && rnd() < 0.35) {
    const a = rnd() * TAU, t = 0.2 + rnd() * 0.35;
    const topY = (tt) => stemH + capProfile(capR, capH, sp.shape, stemR)[Math.round(tt * 14)].y;
    // на дальней копии хвоинки не видно — случайные числа всё равно
    // берём, чтобы остальной гриб совпал с ближним
    const y0 = topY(t) + 0.002 - Math.cos(a - tiltA) * t * capH * tiltK;
    let d;
    if (rnd() < 0.5) {
      d = new THREE.BoxGeometry(capR * 0.9, 0.0025, 0.003);
      paint(d, 0x8a6a3a);
    } else {
      d = new THREE.SphereGeometry(capR * 0.22, 8, 3);
      d.scale(1, 0.08, 0.55);
      paint(d, 0xd8a828);
    }
    d.rotateY(rnd() * TAU);
    d.rotateZ((rnd() - 0.5) * 0.3);
    d.translate(Math.cos(a) * capR * t, y0, Math.sin(a) * capR * t);
    if (lo) d.dispose(); else parts.push(toTile(d, 'stem'));
  }

  const merged = mergeParts(parts);
  parts.forEach((p) => p.dispose());
  merged.computeBoundingSphere();
  merged.userData.height = stemH + capH;
  merged.userData.capR = capR;
  return merged;
}

/* ------------------------------------------------------------
   Кэш геометрий: по 3 варианта на вид
   ------------------------------------------------------------ */
const geoCache = new Map();
export const GEO_VARIANTS = 5;

/** lo — дальняя упрощённая копия того же гриба (см. buildMushroomGeometry). */
export function getMushroomGeometry(sp, variant, lo = false) {
  const key = sp.id + ':' + variant + (lo ? ':lo' : '');
  let g = geoCache.get(key);
  if (!g) {
    g = buildMushroomGeometry(sp, rng(0x9e37 + variant * 7919 + sp.id.length * 131), lo);
    geoCache.set(key, g);
  }
  return g;
}

export const MAT_MUSHROOM = new THREE.MeshStandardMaterial({
  vertexColors: true, map: mushAtlasTex(), roughness: 0.74, metalness: 0,
});
/**
 * Гриб рядом: лёгкое свечение, иначе шляпку не видно в траве.
 * Светится он собственным цветом, а не общим зеленоватым: прежнее
 * свечение прибавляло всем одну и ту же зелень, и подосиновик
 * становился жёлтым, а белый — оливковым.
 */
export const MAT_MUSHROOM_NEAR = new THREE.MeshStandardMaterial({
  vertexColors: true, map: mushAtlasTex(), roughness: 0.72, metalness: 0,
});
MAT_MUSHROOM_NEAR.onBeforeCompile = (sh) => {
  sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>',
    '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * 0.24;');
};
MAT_MUSHROOM_NEAR.customProgramCacheKey = () => 'mush-near-selfglow';
export const MAT_MUSHROOM_HL = new THREE.MeshStandardMaterial({
  vertexColors: true, map: mushAtlasTex(), roughness: 0.7, metalness: 0,
  emissive: 0x66832a, emissiveIntensity: 1.0,
});

export function applyMushroomEnv(env) {
  for (const m of [MAT_MUSHROOM, MAT_MUSHROOM_NEAR, MAT_MUSHROOM_HL]) {
    m.envMap = env; m.envMapIntensity = 0.5; m.needsUpdate = true;
  }
}

/* ------------------------------------------------------------
   Взвешенный выбор вида под условия точки
   ------------------------------------------------------------ */
const totalW = SPECIES.reduce((a, s) => a + s.weight, 0);

/* ============================================================
   Спрос дня.

   У скупщика каждый день свой интерес: сегодня в цене белые, завтра
   лисички. Лес у всех один, а задача разная — ради этого и стоит
   заходить назавтра. Выбирается из сида дня, значит у всех совпадает.
   ============================================================ */
let DEMAND = { up: null, down: null };

export function setDemand(seed) {
  const r = rng((seed ^ 0x51ed2701) >>> 0);
  // торгуют съедобным: спрос на поганку смысла не имеет
  const good = SPECIES.filter((sp) => sp.price > 0);
  const up = good[(r() * good.length) | 0];
  let down = good[(r() * good.length) | 0];
  for (let i = 0; i < 6 && down === up; i++) down = good[(r() * good.length) | 0];
  DEMAND = { up, down };
}

export const demand = () => DEMAND;

/** Надбавка скупщика за конкретный вид. */
export function demandMult(sp) {
  if (sp === DEMAND.up) return 1.5;
  if (sp === DEMAND.down) return 0.6;
  return 1;
}

/** Строка для стартового экрана. */
export function demandLabel() {
  if (!DEMAND.up) return '';
  return `сегодня берут ${DEMAND.up.name.toLowerCase()} в полтора раза дороже, ` +
    `${DEMAND.down.name.toLowerCase()} — за полцены`;
}

/* ============================================================
   Где какой гриб растёт.

   Порядок весов: бор, ельник, березняк, осинник, поляна, низина.
   Раскладка не выдумана: боровик берёт сосновый бор-беломошник и
   ельник, подосиновик идёт за осиной, подберёзовик и груздь — за
   берёзой, маслёнок и рыжик — в сосняк, шампиньон и зонтик — на
   открытое место, опята и вешенка — на пни, а бледная поганка
   держится лиственного леса.
   ============================================================ */
const BIOME_W = {
  bely:          [3.4, 2.4, 1.5, 0.7, 0.12, 0.25],
  tsar:          [3.2, 2.6, 1.3, 0.6, 0.08, 0.2],
  podosinovik:   [0.3, 0.6, 1.6, 4.2, 0.2, 0.5],
  podberezovik:  [0.7, 0.7, 4.0, 1.5, 0.45, 0.7],
  ryzhik:        [3.0, 2.3, 0.4, 0.3, 0.2, 0.2],
  lisichka:      [1.1, 2.6, 1.5, 0.9, 0.12, 0.9],
  gruzd:         [0.25, 0.7, 3.4, 1.2, 0.2, 0.5],
  maslenok:      [3.8, 0.7, 0.3, 0.2, 0.5, 0.2],
  mokhovik:      [1.2, 2.0, 1.1, 0.9, 0.2, 1.8],
  openok:        [0.6, 1.0, 1.6, 1.5, 0.2, 0.8],
  veshenka:      [0.3, 0.7, 1.6, 1.6, 0.1, 0.6],
  syroezhka:     [1.0, 1.0, 1.2, 1.1, 0.5, 0.8],
  shampinion:    [0.2, 0.1, 0.3, 0.2, 4.0, 0.1],
  zontik:        [0.4, 0.2, 0.8, 0.5, 3.0, 0.15],
  dozhdevik:     [0.5, 0.5, 1.0, 0.7, 2.2, 0.4],
  mukhomor:      [0.8, 2.0, 2.2, 1.2, 0.2, 0.5],
  mukhomor_big:  [0.7, 2.0, 2.2, 1.1, 0.2, 0.4],
  poganka:       [0.2, 0.7, 2.4, 1.5, 0.15, 0.4],
  satanic:       [0.5, 0.2, 1.0, 0.5, 0.6, 0.1],
  lozhnyi:       [0.6, 1.0, 1.5, 1.4, 0.2, 0.7],
  panterny:      [0.8, 1.2, 1.6, 1.0, 0.2, 0.4],
};

export function pickSpecies(rnd, x, z, nearStump, openMeadow) {
  const wet = moisture(x, z);
  const biome = forestType(x, z);
  let acc = 0;
  const weights = SPECIES.map((s) => {
    let w = s.weight;
    // главное — выдел: под какое дерево гриб ходит
    const b = BIOME_W[s.id];
    w *= b ? b[biome] : 1;
    // влажность доуточняет внутри выдела
    w *= 1.15 - Math.abs(wet - (s.wet ?? 0.5)) * 0.9;
    if (s.onStump) w *= nearStump ? 6.5 : 0.04;
    w = Math.max(0.0005, w);
    acc += w;
    return w;
  });
  let r = rnd() * acc;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return SPECIES[i];
  }
  return SPECIES[0];
}

/** Размещает грибы в пределах чанка. Возвращает описания (без мешей). */
// густота по выделам: бор, ельник, березняк, осинник, поляна, низина
const BIOME_DENSITY = [0.72, 1.0, 0.95, 0.88, 0.28, 0.45];

export function generateChunkMushrooms(cx, cz, stumps) {
  const cs = CONFIG.chunkSize;
  const rnd = rng(((cx * 73856093) ^ (cz * 19349663) ^ 0x5ee5) >>> 0);
  const out = [];
  const n = CONFIG.mushroomsPerChunk;
  for (let i = 0; i < n; i++) {
    let lx, lz, wx, wz, tries = 0;
    do {
      lx = rnd() * cs; lz = rnd() * cs;
      wx = cx * cs + lx; wz = cz * cs + lz;
      tries++;
    } while (isWater(wx, wz) && tries < 8);
    if (isWater(wx, wz)) continue;
    // Грибов поровну везде не бывает: в ельнике и березняке густо, на
    // сухой поляне и в низине почти пусто. Ровная сетка по всему лесу
    // лишала смысла выбор, куда идти.
    if (rnd() > BIOME_DENSITY[forestType(wx, wz)]) continue;

    // рядом ли пень (опята/вешенки растут на них)
    let nearStump = null;
    for (const s of stumps) {
      const d2 = (s.x - lx) ** 2 + (s.z - lz) ** 2;
      if (d2 < 9) { nearStump = s; break; }
    }
    const openMeadow = moisture(wx, wz) < 0.34;
    const sp = pickSpecies(rnd, wx, wz, !!nearStump, openMeadow);

    const cluster = sp.cluster ? sp.cluster[0] + ((rnd() * (sp.cluster[1] - sp.cluster[0] + 1)) | 0) : 1;
    for (let k = 0; k < cluster; k++) {
      const a = rnd() * TAU;
      const rr = k === 0 ? 0 : (0.15 + rnd() * 0.8) * (sp.onStump ? 0.5 : 1);
      const px = lx + Math.cos(a) * rr;
      const pz = lz + Math.sin(a) * rr;
      if (px < 0 || px > cs || pz < 0 || pz > cs) continue;
      out.push({
        sp, lx: px, lz: pz,
        variant: (rnd() * GEO_VARIANTS) | 0,
        rot: rnd() * TAU,
        tilt: (rnd() - 0.5) * 0.24,
        onStump: !!nearStump && sp.onStump ? nearStump : null,
        picked: false, respawn: 0,
      });
    }
  }
  return out;
}
