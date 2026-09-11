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
export function terrainHeight(x, z) {
  return (
    6.2 * Math.sin(3 * K * x + 0.4) * Math.cos(2 * K * z - 0.9) +
    3.4 * Math.sin(5 * K * x + 1.7) * Math.sin(7 * K * z + 0.3) +
    1.7 * Math.cos(11 * K * x + 2.2) * Math.cos(9 * K * z + 1.1) +
    0.7 * Math.sin(17 * K * x - 0.6) * Math.sin(19 * K * z + 2.4)
  );
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
