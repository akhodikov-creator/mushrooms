import * as THREE from 'three';
import { mergeParts } from './geo.js';
import { CONFIG } from './config.js';
import { rng, terrainHeight, moisture, isWater, clamp, TAU } from './utils.js';
import { capTex } from './textures.js';

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
function capProfile(r, h, shape, stemR) {
  const pts = [];
  const N = 11;
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
    pts.push(new THREE.Vector2(Math.max(0.0012, r * t), yOf(t)));
  }
  // нижняя кромка и возврат к ножке (замыкаем силуэт)
  const thick = Math.max(0.006, h * 0.2);
  pts.push(new THREE.Vector2(r * 0.985, yOf(1) - thick * 0.55));
  const inner = shape === 'funnel' || shape === 'flat' ? 0.35 : 0.55;
  pts.push(new THREE.Vector2(r * inner, yOf(0.45) - thick));
  pts.push(new THREE.Vector2(Math.max(0.004, stemR * 0.9), Math.max(0.002, yOf(0) - thick * 1.5)));
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

/** Собирает один меш-грибу: шляпка + ножка + пластинки + крап. */
function buildMushroomGeometry(sp, rnd) {
  const parts = [];
  // Настоящие грибы мелкие, но на экране их нужно замечать —
  // поэтому весь вид слегка «игровой» по масштабу.
  const sc = (0.86 + rnd() * 0.32) * 1.34;
  const capR = sp.capR * sc, capH = sp.capH * sc;
  const stemH = sp.stemH * sc, stemR = sp.stemR * sc;
  const capColor = sp.palette ? sp.palette[(rnd() * sp.palette.length) | 0] : sp.capColor;

  // ножка
  if (sp.shape === 'shelf') {
    const st = new THREE.CylinderGeometry(stemR * 0.7, stemR, stemH, 6);
    st.rotateZ(0.5);
    st.translate(-capR * 0.55, stemH * 0.5, 0);
    parts.push(paint(st, sp.stemColor));
  } else if (sp.shape !== 'ball') {
    const bulge = sp.shape === 'bulb' ? 1.55 : 1.0;
    const st = new THREE.CylinderGeometry(stemR * 0.8, stemR * bulge, stemH, 8, 2);
    st.translate(0, stemH * 0.5, 0);
    parts.push(paint(st, sp.stemColor));
    // кольцо-вольва у мухоморов
    if (sp.warts) {
      const ring = new THREE.TorusGeometry(stemR * 1.5, stemR * 0.32, 4, 10);
      ring.rotateX(Math.PI / 2);
      ring.translate(0, stemH * 0.72, 0);
      parts.push(paint(ring, sp.gills));
    }
  } else {
    const st = new THREE.CylinderGeometry(stemR * 0.6, stemR * 0.85, stemH, 7);
    st.translate(0, stemH * 0.5, 0);
    parts.push(paint(st, sp.stemColor));
  }

  // пластинки/трубчатый слой — тонкий диск под шляпкой
  if (sp.shape !== 'ball') {
    const g = new THREE.CircleGeometry(capR * 0.94, 14);
    g.rotateX(Math.PI / 2);
    const gy = sp.shape === 'funnel' ? stemH + capH * 0.1 : stemH + capH * 0.04;
    g.translate(0, gy, 0);
    parts.push(paint(g, sp.gills));
  }

  // шляпка
  const prof = capProfile(capR, capH, sp.shape, stemR);
  const cap = new THREE.LatheGeometry(prof, 14);
  cap.translate(0, stemH, 0);
  if (sp.shape === 'shelf') {
    cap.scale(1, 1, 0.62);
    cap.translate(capR * 0.12, 0, 0);
  }
  parts.push(paint(cap, capColor));

  // белые хлопья мухомора
  if (sp.warts) {
    const n = 7 + ((rnd() * 6) | 0);
    for (let i = 0; i < n; i++) {
      const t = 0.16 + rnd() * 0.74;
      const a = rnd() * TAU;
      const rr = capR * t;
      const yy = stemH + capH * Math.sqrt(Math.max(0, 1 - t * t * 0.94)) * 0.99;
      const w = new THREE.SphereGeometry(capR * (0.055 + rnd() * 0.05), 5, 4);
      w.scale(1, 0.5, 1);
      w.translate(Math.cos(a) * rr, yy, Math.sin(a) * rr);
      parts.push(paint(w, 0xfffaf0));
    }
  }

  // крап (подосиновик/зонтик/дождевик)
  if (sp.speckle) {
    const n = 6 + ((rnd() * 5) | 0);
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU;
      const onStem = sp.id === 'podosinovik' || sp.id === 'podberezovik' || sp.id === 'zontik';
      const s = new THREE.SphereGeometry(capR * 0.035, 4, 3);
      if (onStem) {
        const hh = 0.12 + rnd() * 0.78;
        s.scale(1, 2.4, 1);
        s.translate(Math.cos(a) * stemR * 1.02, stemH * hh, Math.sin(a) * stemR * 1.02);
      } else {
        const t = rnd() * 0.85;
        s.scale(1, 0.4, 1);
        s.translate(Math.cos(a) * capR * t, stemH + capH * (0.95 - t * 0.2), Math.sin(a) * capR * t);
      }
      parts.push(paint(s, sp.speckle));
    }
  }

  const merged = mergeParts(parts);
  parts.forEach((p) => p.dispose());
  merged.computeVertexNormals();
  merged.computeBoundingSphere();
  merged.userData.height = stemH + capH;
  merged.userData.capR = capR;
  return merged;
}

/* ------------------------------------------------------------
   Кэш геометрий: по 3 варианта на вид
   ------------------------------------------------------------ */
const geoCache = new Map();
export function getMushroomGeometry(sp, variant) {
  const key = sp.id + ':' + variant;
  let g = geoCache.get(key);
  if (!g) {
    g = buildMushroomGeometry(sp, rng(0x9e37 + variant * 7919 + sp.id.length * 131));
    geoCache.set(key, g);
  }
  return g;
}

export const MAT_MUSHROOM = new THREE.MeshStandardMaterial({
  vertexColors: true, map: capTex(), roughness: 0.82, metalness: 0,
});
/** Гриб рядом: лёгкое свечение, иначе шляпку не видно в траве. */
export const MAT_MUSHROOM_NEAR = new THREE.MeshStandardMaterial({
  vertexColors: true, map: capTex(), roughness: 0.78, metalness: 0,
  emissive: 0x2a3410, emissiveIntensity: 1.0,
});
export const MAT_MUSHROOM_HL = new THREE.MeshStandardMaterial({
  vertexColors: true, map: capTex(), roughness: 0.7, metalness: 0,
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

export function pickSpecies(rnd, x, z, nearStump, openMeadow) {
  const wet = moisture(x, z);
  let acc = 0;
  const weights = SPECIES.map((s) => {
    let w = s.weight;
    // совпадение по влажности
    w *= 1.25 - Math.abs(wet - (s.wet ?? 0.5)) * 1.35;
    if (s.onStump) w *= nearStump ? 5.5 : 0.06;
    if (s.meadow) w *= openMeadow ? 3.4 : 0.35;
    if (!s.meadow && openMeadow) w *= 0.7;
    w = Math.max(0.001, w);
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
        variant: (rnd() * 3) | 0,
        rot: rnd() * TAU,
        tilt: (rnd() - 0.5) * 0.24,
        onStump: !!nearStump && sp.onStump ? nearStump : null,
        picked: false, respawn: 0,
      });
    }
  }
  return out;
}
