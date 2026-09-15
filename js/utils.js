import { CONFIG } from './config.js';

export const WS = CONFIG.worldSize;
export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => t * t * (3 - 2 * t);
export const dampTo = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

/** Координата, приведённая в [0, WS) — мир зациклен как тор. */
export const wrapCoord = (x) => ((x % WS) + WS) % WS;

/** Кратчайшая разница по зацикленной оси: результат в [-WS/2, WS/2). */
export function wrapDelta(d) {
  let r = (d + WS * 0.5) % WS;
  if (r < 0) r += WS;
  return r - WS * 0.5;
}

/** Квадрат расстояния между точками с учётом зацикливания. */
export function torusDist2(ax, az, bx, bz) {
  const dx = wrapDelta(bx - ax);
  const dz = wrapDelta(bz - az);
  return dx * dx + dz * dz;
}
export function torusDist(ax, az, bx, bz) {
  return Math.sqrt(torusDist2(ax, az, bx, bz));
}

/** Детерминированный ГПСЧ (mulberry32). */
export function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------
   Рельеф. Сумма синусоид с целыми волновыми числами —
   поэтому функция строго периодична с периодом WS и на границе
   зацикливания нет шва.
   ------------------------------------------------------------ */
const K = TAU / WS;

/* ------------------------------------------------------------
   Лес дня.

   Сид берётся из календарной даты по UTC, поэтому у всех, кто играет
   в один день, лес один и тот же: одинаковый рельеф, одинаковые боры
   и одинаковые грибные места. Иначе общая доска рекордов бессмысленна —
   кому-то достался бор под боком, кому-то болото.

   Меняются фазы и амплитуды волн, но НЕ их номера: они обязаны
   оставаться целыми, иначе рельеф перестанет сходиться на стыке
   зацикленного мира и появится шов.
   ------------------------------------------------------------ */
export function todaySeed() {
  return Math.floor(Date.now() / 86400000);
}

/** Номер дня -> человеческая дата, чтобы сравнивать леса с друзьями. */
export function seedLabel(seed) {
  const d = new Date(seed * 86400000);
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
}

let DAY_SEED = 0;
// [амплитуда, номер волны по X, номер по Z, фаза X, фаза Z]
let TER = [
  [6.2, 3, 2, 0.4, -0.9], [3.4, 5, 7, 1.7, 0.3],
  [1.7, 11, 9, 2.2, 1.1], [0.7, 17, 19, -0.6, 2.4],
];
let SOIL = [[2, 3, 0.7], [5, 4, 2.1]];

export function setDaySeed(seed) {
  DAY_SEED = seed >>> 0;
  const r = rng(DAY_SEED ^ 0x9e3779b9);
  const pick = (a) => a[(r() * a.length) | 0];
  // крупные волны задают холмы и низины, мелкие — бугры
  TER = [
    [5.4 + r() * 2.2, pick([2, 3, 4]), pick([2, 3, 4]), r() * TAU, r() * TAU],
    [2.8 + r() * 1.6, pick([5, 6, 7]), pick([5, 6, 7, 8]), r() * TAU, r() * TAU],
    [1.3 + r() * 0.9, pick([9, 11, 12]), pick([9, 10, 13]), r() * TAU, r() * TAU],
    [0.5 + r() * 0.5, pick([17, 19, 23]), pick([17, 19, 21]), r() * TAU, r() * TAU],
  ];
  // почва: где песок (боры), где суглинок (березняки и осинники)
  SOIL = [[pick([2, 3]), pick([2, 3]), r() * TAU], [pick([4, 5, 6]), pick([4, 5]), r() * TAU]];
}

export const daySeed = () => DAY_SEED;

export function terrainHeight(x, z) {
  let h = 0;
  for (let i = 0; i < TER.length; i++) {
    const t = TER[i];
    h += t[0] * Math.sin(t[1] * K * x + t[3]) * Math.cos(t[2] * K * z + t[4]);
  }
  return h;
}

export function terrainNormal(x, z, out) {
  const e = 1.0;
  const hL = terrainHeight(x - e, z), hR = terrainHeight(x + e, z);
  const hD = terrainHeight(x, z - e), hU = terrainHeight(x, z + e);
  const nx = hL - hR, ny = 2 * e, nz = hD - hU;
  const l = Math.hypot(nx, ny, nz);
  out.set(nx / l, ny / l, nz / l);
  return out;
}

/** Крутизна склона 0..1 (0 — ровно). */
export function terrainSlope(x, z) {
  const e = 1.2;
  const dx = terrainHeight(x + e, z) - terrainHeight(x - e, z);
  const dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return clamp(Math.hypot(dx, dz) / (2 * e), 0, 1);
}

export const WATER_LEVEL = -4.4;
export const isWater = (x, z) => terrainHeight(x, z) < WATER_LEVEL;

/* ------------------------------------------------------------
   Тип леса.

   Гриб растёт не «где повезло», а под своим деревом: боровик — в
   сухом сосновом бору по белому мху, подосиновик — в осиннике,
   подберёзовик и груздь — в березняке, опёнок — на пне. Поэтому лес
   поделён на выделы, а виды разложены по ним (см. mushrooms.js).

   Что решает тип: сухость (из рельефа) и почва (своя волна).
   На песке встаёт бор, на суглинке — лиственный лес, в низинах — ель
   и болото. Рельеф меняется каждый день, значит и выделы переезжают.
   ------------------------------------------------------------ */
export const FOREST = {
  BOR: 0,          // сосняк-беломошник: песок, ягель, редкие сосны
  ELNIK: 1,        // ельник: сыро, темно, мох
  BEREZNYAK: 2,    // березняк
  OSINNIK: 3,      // осинник
  MEADOW: 4,       // поляна, опушка
  BOLOTO: 5,       // низина у воды
};

export const FOREST_NAME = ['бор-беломошник', 'ельник', 'березняк', 'осинник', 'поляна', 'низина'];

/** Почва: 0 — песок, 1 — суглинок. Крупные пятна в сотню метров. */
export function soil(x, z) {
  const a = SOIL[0], b = SOIL[1];
  const v = 0.62 * Math.sin(a[0] * K * x + a[2]) * Math.cos(a[1] * K * z - a[2])
          + 0.38 * Math.cos(b[0] * K * x - b[2]) * Math.sin(b[1] * K * z + b[2]);
  return clamp(0.5 + v * 0.62, 0, 1);
}

export function forestType(x, z) {
  const h = terrainHeight(x, z);
  if (h < WATER_LEVEL + 1.6) return FOREST.BOLOTO;
  // Сырость выдела берём по высоте, без крутизны. moisture() штрафует
  // склоны, и бор из-за этого садился на обрывы вместо сухих песчаных
  // грив — выдел должен читаться пятном, а не полоской по откосу.
  const wet = clamp(0.62 - h * 0.052, 0, 1);
  if (wet < 0.30) return FOREST.MEADOW;
  const s = soil(x, z);
  if (s < 0.38 && wet < 0.58) return FOREST.BOR;
  if (wet > 0.58) return FOREST.ELNIK;
  if (s > 0.66) return FOREST.OSINNIK;
  return FOREST.BEREZNYAK;
}

/** «Влажность» — где больше грибов: низины и пологие места. */
export function moisture(x, z) {
  const h = terrainHeight(x, z);
  const s = terrainSlope(x, z);
  return clamp(0.62 - h * 0.052 - s * 0.55, 0, 1);
}

export function fmtTime(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtNum(n) {
  return Math.round(n).toLocaleString('ru-RU');
}
