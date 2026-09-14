import * as THREE from 'three';
import { MarchingCubes } from 'three/addons/objects/MarchingCubes.js';
import { mergeParts } from './geo.js';

/* ============================================================
   Кисть как единая органическая поверхность.

   Собирать руку из цилиндров и шаров бесполезно: детали пересекаются,
   между ними видны швы, нормали не сшиваются, и получаются «грабли».
   Здесь вдоль костей расставлены меташары, а marching cubes достраивает
   по ним одну гладкую оболочку — перепонки между пальцами, бугры
   костяшек и подушечка большого пальца возникают сами.

   Считается один раз при запуске и кэшируется.
   ============================================================ */

const RES = 72;              // разрешение поля
const SUBTRACT = 12;         // жёсткость спада меташара
const SCALE = 0.108;         // поле [-1,1] -> метры

/** Радиус в единицах поля -> «сила» меташара. */
const strengthFor = (r) => SUBTRACT * (r * 0.5) * (r * 0.5);

class Field {
  constructor() {
    this.balls = [];
  }
  /** x,y,z и радиус — в единицах поля, где кисть умещается в [-1,1]. */
  add(x, y, z, r) {
    this.balls.push([x, y, z, r]);
    return this;
  }
  /** Цепочка шаров между двумя точками — так кость становится сплошной. */
  bone(x0, y0, z0, x1, y1, z1, r0, r1, n = 6) {
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.add(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t,
        r0 + (r1 - r0) * t);
    }
    return this;
  }
}

/**
 * Скелет кисти. Возвращает поле меташаров и позиции кончиков пальцев,
 * чтобы посадить на них ногти.
 */
function handField(side, pose) {
  const f = new Field();
  const tips = [];

  /* ---------- запястье и ладонь ---------- */
  f.bone(0, 0, 0.98, 0, 0, 0.66, 0.30, 0.33, 3);
  // ладонь — сетка шаров: плоская, чуть толще у костяшек
  for (let cx = 0; cx < 4; cx++) {
    const x = side * (-0.34 + cx * 0.226);
    f.bone(x, 0.0, 0.60, x, 0.03, -0.30, 0.255, 0.235, 4);
  }
  // ребро ладони со стороны мизинца полнее
  f.bone(side * -0.40, 0, 0.5, side * -0.40, 0.01, -0.22, 0.2, 0.19, 3);
  // подушечка под большим пальцем
  f.bone(side * 0.34, -0.04, 0.52, side * 0.42, -0.05, 0.16, 0.26, 0.24, 3);

  /* ---------- четыре пальца ---------- */
  const FINGERS = [
    { x: -0.34, lens: [0.33, 0.23, 0.17], r: 0.212, spread: -0.16 },  // указательный
    { x: -0.113, lens: [0.36, 0.26, 0.18], r: 0.218, spread: -0.05 }, // средний
    { x: 0.113, lens: [0.33, 0.23, 0.17], r: 0.205, spread: 0.06 },   // безымянный
    { x: 0.34, lens: [0.26, 0.19, 0.15], r: 0.182, spread: 0.19 },    // мизинец
  ];

  const CURL = pose === 'fist' ? [0.98, 1.30, 1.02] : [0.10, 0.16, 0.20];

  for (const fg of FINGERS) {
    // старт у костяшки
    let px = side * fg.x, py = 0.05, pz = -0.34;
    // направление: вперёд (-Z), с небольшим разведением в стороны
    let dirX = side * fg.spread * (pose === 'fist' ? 0.25 : 1);
    let dirY = 0;
    let dirZ = -1;
    // нормируем
    let L = Math.hypot(dirX, dirY, dirZ);
    dirX /= L; dirY /= L; dirZ /= L;

    let r = fg.r;
    for (let i = 0; i < fg.lens.length; i++) {
      // сгиб в суставе — поворот направления вниз (к ладони)
      const a = CURL[i];
      const ca = Math.cos(a), sa = Math.sin(a);
      // поворот вокруг оси X: (y,z) -> (y cos - z sin, y sin + z cos)
      const ry = dirY * ca - dirZ * sa;
      const rz = dirY * sa + dirZ * ca;
      dirY = ry; dirZ = rz;
      L = Math.hypot(dirX, dirY, dirZ);
      dirX /= L; dirY /= L; dirZ /= L;

      const len = fg.lens[i];
      const nx2 = px + dirX * len, ny2 = py + dirY * len, nz2 = pz + dirZ * len;
      const r2 = r * 0.90;
      f.bone(px, py, pz, nx2, ny2, nz2, r, r2, 5);
      px = nx2; py = ny2; pz = nz2; r = r2;
    }
    // кончик слегка приплюснут
    f.add(px, py, pz, r * 0.92);
    tips.push({ x: px, y: py, z: pz, r, dirX, dirY, dirZ });
  }

  /* ---------- большой палец ---------- */
  {
    let px = side * 0.42, py = -0.06, pz = 0.18;
    // отведён в сторону и вперёд
    let dirX = side * (pose === 'fist' ? 0.55 : 0.78);
    let dirY = pose === 'fist' ? 0.12 : -0.05;
    let dirZ = -0.82;
    let L = Math.hypot(dirX, dirY, dirZ);
    dirX /= L; dirY /= L; dirZ /= L;

    const lens = [0.34, 0.27];
    const curls = pose === 'fist' ? [0.45, 0.85] : [0.12, 0.3];
    let r = 0.215;
    for (let i = 0; i < lens.length; i++) {
      const a = curls[i], ca = Math.cos(a), sa = Math.sin(a);
      const ry = dirY * ca - dirZ * sa;
      const rz = dirY * sa + dirZ * ca;
      dirY = ry; dirZ = rz;
      L = Math.hypot(dirX, dirY, dirZ);
      dirX /= L; dirY /= L; dirZ /= L;

      const len = lens[i];
      const nx2 = px + dirX * len, ny2 = py + dirY * len, nz2 = pz + dirZ * len;
      const r2 = r * 0.85;
      f.bone(px, py, pz, nx2, ny2, nz2, r, r2, 5);
      px = nx2; py = ny2; pz = nz2; r = r2;
    }
    f.add(px, py, pz, r * 0.92);
    tips.push({ x: px, y: py, z: pz, r, dirX, dirY, dirZ });
  }

  return { field: f, tips };
}

/** Достаёт BufferGeometry из MarchingCubes независимо от версии three. */
function extractGeometry(mc) {
  if (typeof mc.generateBufferGeometry === 'function') {
    return mc.generateBufferGeometry();
  }
  // запасной путь: собираем вручную из внутренних буферов
  const g = new THREE.BufferGeometry();
  const n = mc.count * 3;
  g.setAttribute('position', new THREE.BufferAttribute(mc.positionArray.slice(0, n), 3));
  g.setAttribute('normal', new THREE.BufferAttribute(mc.normalArray.slice(0, n), 3));
  return g;
}

const cache = new Map();

/**
 * Готовая геометрия кисти в метрах: начало координат в запястье,
 * пальцы смотрят в -Z, ладонь в плоскости XZ.
 * Возвращает { skin, nails } — две геометрии под разные материалы.
 */
export function buildHandGeometry(side = 1, pose = 'fist') {
  const key = side + ':' + pose;
  if (cache.has(key)) return cache.get(key);

  const { field, tips } = handField(side, pose);

  const mc = new MarchingCubes(RES, new THREE.MeshBasicMaterial(), true, false, 120000);
  mc.isolation = 80;
  mc.reset();
  for (const [x, y, z, r] of field.balls) {
    // поле живёт в [0,1], наш скелет — в [-1,1]
    mc.addBall((x + 1) * 0.5, (y + 1) * 0.5, (z + 1) * 0.5, strengthFor(r), SUBTRACT);
  }
  mc.update();

  const raw = extractGeometry(mc);
  // MarchingCubes отдаёт координаты в [-1,1] — переводим в метры.
  // Нормали НЕ пересчитываем: marching cubes уже вернул гладкие, по
  // градиенту поля, а computeVertexNormals на несшитом супе
  // треугольников сделал бы их плоскими и вся кисть стала бы гранёной.
  raw.scale(SCALE, SCALE, SCALE);
  raw.computeBoundingSphere();

  /* ---------- ногти ---------- */
  // Ногти строим в тех же единицах поля и масштабируем ВСЁ разом:
  // иначе радиус остаётся в метрах и ноготь выходит с ладонь.
  const nailParts = [];
  for (const t of tips) {
    const g = new THREE.SphereGeometry(t.r * 0.44, 10, 7);
    g.scale(0.9, 0.26, 1.2);
    g.translate(
      t.x - t.dirX * t.r * 0.3,
      t.y + t.r * 0.66,
      t.z - t.dirZ * t.r * 0.3
    );
    nailParts.push(g);
  }
  const nails = mergeParts(nailParts);
  nails.scale(SCALE, SCALE, SCALE);
  nails.computeVertexNormals();

  mc.geometry.dispose();
  mc.material.dispose();

  const out = { skin: raw, nails };
  cache.set(key, out);
  return out;
}

export function disposeHands() {
  for (const { skin, nails } of cache.values()) { skin.dispose(); nails.dispose(); }
  cache.clear();
}
