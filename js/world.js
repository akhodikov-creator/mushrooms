import * as THREE from 'three';
import { mergeParts } from './geo.js';
import { CONFIG } from './config.js';
import {
  WS, TAU, rng, terrainHeight, terrainSlope, moisture, isWater, WATER_LEVEL,
  wrapDelta, wrapCoord, clamp, lerp, dampTo, torusDist2, forestType, FOREST,
} from './utils.js';
import {
  generateChunkMushrooms, getMushroomGeometry, SPECIES, GEO_VARIANTS,
  MAT_MUSHROOM, MAT_MUSHROOM_NEAR, MAT_MUSHROOM_HL,
} from './mushrooms.js';
import {
  groundTex, barkTex, birchTex, grassTex, leafTex, needleTex, lichenTex,
  metalTex, woodTex, getEnvMap,
} from './textures.js';
import { onAsset, instance } from './assets.js';
import { plantsLoaded, plantTextures, hasPlants, scaledPart, scaledTree } from './plants.js';

const CS = CONFIG.chunkSize;
const GRID = Math.round(WS / CS);          // 8
/* Приёмные пункты. Координаты не жёсткие: рельеф теперь свой на
   каждый день, и на фиксированных точках пункты то и дело оказывались
   в озере — проверка на двадцати днях показала день, где под воду ушли
   все четыре. Место ищется заново под сегодняшний рельеф. */
export const CAMPS = [
  { x: 190, z: 210 }, { x: 690, z: 190 }, { x: 200, z: 690 }, { x: 700, z: 700 },
];

/**
 * Ставит пункты на сухие ровные места — по одному на четверть карты.
 * Перебор детерминированный, по решётке: значит, у всех игроков в один
 * день пункты стоят одинаково, и общая доска остаётся честной.
 */
export function placeCamps() {
  const quads = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
  quads.forEach((q, i) => {
    const cx = q[0] * WS, cz = q[1] * WS;
    let best = null;
    for (let dx = -110; dx <= 110; dx += 10) {
      for (let dz = -110; dz <= 110; dz += 10) {
        const x = wrapCoord(cx + dx), z = wrapCoord(cz + dz);
        const h = terrainHeight(x, z);
        if (h < WATER_LEVEL + 3.5) continue;          // с запасом от берега
        // вокруг тоже должно быть сухо и ровно: пункту нужна поляна
        let ok = true, rough = 0;
        for (let a = 0; a < TAU; a += TAU / 8) {
          const px = x + Math.cos(a) * 14, pz = z + Math.sin(a) * 14;
          if (terrainHeight(px, pz) < WATER_LEVEL + 2) { ok = false; break; }
          rough += Math.abs(terrainHeight(px, pz) - h);
        }
        if (!ok) continue;
        const score = -rough - Math.hypot(dx, dz) * 0.02;
        if (!best || score > best.score) best = { x, z, score };
      }
    }
    if (best) { CAMPS[i].x = best.x; CAMPS[i].z = best.z; }
  });
}

/** Откуда начинается забег — у первого пункта, одинаково для всех. */
export function spawnPoint() {
  const c = CAMPS[0];
  for (let r = 14; r <= 40; r += 6) {
    for (let a = 0; a < TAU; a += TAU / 12) {
      const x = wrapCoord(c.x + Math.cos(a) * r), z = wrapCoord(c.z + Math.sin(a) * r);
      if (terrainHeight(x, z) > WATER_LEVEL + 2.5) return { x, z };
    }
  }
  return { x: c.x, z: c.z };
}

/* ============================================================
   Материалы и ветер
   ============================================================ */
export const windUniform = { value: 0 };

function addWind(mat, amp = 1, minY = 0) {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = windUniform;
    shader.uniforms.uAmp = { value: amp };
    shader.uniforms.uMinY = { value: minY };
    shader.vertexShader =
      'uniform float uTime;\nuniform float uAmp;\nuniform float uMinY;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       float _ph = 0.0;
       #ifdef USE_INSTANCING
         _ph = instanceMatrix[3].x * 0.63 + instanceMatrix[3].z * 0.87;
       #endif
       float _sw = sin(uTime * 1.6 + _ph) * 0.6 + sin(uTime * 3.3 + _ph * 1.9) * 0.25;
       float _in = max(0.0, transformed.y - uMinY) * uAmp;
       transformed.x += _sw * _in;
       transformed.z += _sw * _in * 0.55;`
    );
  };
  mat.customProgramCacheKey = () => 'wind' + amp + '_' + minY;
  return mat;
}

const texBark = barkTex(); texBark.repeat.set(2, 5);
const texBirch = birchTex(); texBirch.repeat.set(1.6, 4);
const texGround = groundTex(); texGround.repeat.set(16, 16);

const MAT = {
  ground: new THREE.MeshStandardMaterial({
    vertexColors: true, map: texGround, roughness: 1, metalness: 0,
  }),
  bark: new THREE.MeshStandardMaterial({
    vertexColors: true, map: texBark, roughness: 0.95, metalness: 0,
  }),
  birch: new THREE.MeshStandardMaterial({
    vertexColors: true, map: texBirch, roughness: 0.85, metalness: 0,
  }),
  needle: addWind(new THREE.MeshLambertMaterial({
    vertexColors: true, map: needleTex(), alphaTest: 0.42,
    side: THREE.DoubleSide,
  }), 0.010, 1.5),
  leaf: addWind(new THREE.MeshLambertMaterial({
    vertexColors: true, map: leafTex(), alphaTest: 0.42,
    side: THREE.DoubleSide,
  }), 0.014, 1.5),
  // Ягель — не трава: плотная белёсая подушка без прозрачности и без
  // колыхания на ветру. Отдельный материал нужен именно поэтому:
  // под зелёной текстурой травы белый мох белым не читается.
  // Ягель кладётся плоскими пятнами внахлёст, поэтому нужен вырез по
  // альфе. Прозрачность именно отсечением, а не смешиванием: пятен под
  // ногами под две тысячи, и сортировать их каждый кадр незачем.
  moss: new THREE.MeshLambertMaterial({
    vertexColors: true, map: lichenTex(), alphaTest: 0.4, side: THREE.DoubleSide,
  }),
  grass: addWind(new THREE.MeshLambertMaterial({
    vertexColors: true, map: grassTex(), alphaTest: 0.4,
    side: THREE.DoubleSide,
  }), 0.5, 0.02),
  bush: addWind(new THREE.MeshLambertMaterial({
    vertexColors: true, map: leafTex(), alphaTest: 0.42,
    side: THREE.DoubleSide,
  }), 0.07, 0.15),
  rock: new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.82, metalness: 0.04,
  }),
  prop: new THREE.MeshStandardMaterial({
    vertexColors: true, map: woodTex(), roughness: 0.85, metalness: 0.05,
  }),
  metal: new THREE.MeshStandardMaterial({
    vertexColors: true, map: metalTex(), roughness: 0.42, metalness: 0.8,
  }),
  water: new THREE.MeshStandardMaterial({
    color: 0x2f5058, transparent: true, opacity: 0.8,
    roughness: 0.08, metalness: 0.25,
  }),
  // Луч-маяк. Затухает кверху вершинными цветами, иначе на фоне
  // светлого неба читается как белая стена во весь экран.
  beam: new THREE.MeshBasicMaterial({
    color: 0xffc247, transparent: true, opacity: 0.5, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
    vertexColors: true,
  }),
};

/** Раздаёт карту окружения PBR-материалам — без неё металл выглядит мёртвым. */
export function applyEnvMap(renderer, scene) {
  const env = getEnvMap(renderer);
  if (scene) scene.environment = env;
  for (const m of Object.values(MAT)) {
    if (m.isMeshStandardMaterial) {
      m.envMap = env;
      m.envMapIntensity = m === MAT.metal ? 1.1 : 0.4;
      m.needsUpdate = true;
    }
  }
  return env;
}

/* ============================================================
   Геометрии растительности (создаются один раз)
   ============================================================ */
function paint(geo, hex, jitter = 0) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const j = jitter ? 1 + (Math.random() - 0.5) * jitter : 1;
    arr[i * 3] = c.r * j; arr[i * 3 + 1] = c.g * j; arr[i * 3 + 2] = c.b * j;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

/** Ствол с сужением и лёгким изгибом — прямые цилиндры сразу выдают процедурку. */
function trunkGeo(h, rBottom, rTop, bend = 0.25, col = 0xffffff) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, 9, 6);
  const pos = g.attributes.position;
  const bx = (Math.random() - 0.5) * bend, bz = (Math.random() - 0.5) * bend;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const t = (y + h / 2) / h;
    pos.setX(i, pos.getX(i) + bx * t * t * h * 0.12);
    pos.setZ(i, pos.getZ(i) + bz * t * t * h * 0.12);
  }
  g.computeVertexNormals();
  g.translate(0, h / 2, 0);
  return paint(g, col, 0.12);
}

/** Лапа хвойного: плоскость с текстурой хвои, отклонённая от ствола. */
function frond(len, wid, tilt, angle, y, col) {
  // Две скрещённые плоскости: одна горизонтальная, одна вертикальная.
  // Одиночный горизонтальный квад с уровня глаз виден с ребра, и крона
  // пропадает — дерево выглядит сухостоем.
  const parts = [];
  for (let k = 0; k < 2; k++) {
    const g = new THREE.PlaneGeometry(len, wid, 3, 1);
    const pos = g.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getX(i) + len / 2) / len;
      pos.setZ(i, -t * t * len * 0.18);        // провисание к концу
    }
    if (k === 0) g.rotateX(-Math.PI / 2);      // плашмя
    else g.rotateX(-0.35);                     // почти вертикально
    g.translate(len / 2, 0, 0);
    g.rotateZ(tilt);
    g.rotateY(angle);
    g.translate(0, y, 0);
    parts.push(paint(g, col, 0.22));
  }
  return parts;
}

/** Пучок листвы: три скрещённых квада с текстурой листьев. */
function leafCluster(size, x, y, z, col) {
  const parts = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.PlaneGeometry(size, size);
    g.rotateY((i / 3) * Math.PI);
    g.rotateX(i === 2 ? Math.PI / 2 : (Math.random() - 0.5) * 0.7);
    g.translate(x, y, z);
    parts.push(paint(g, col, 0.3));
  }
  return parts;
}

function buildPine() {
  const h = 15;
  const tr = mergeParts([trunkGeo(h, 0.46, 0.17, 0.5, 0xb08a5e)]);
  const fol = [];
  for (let w = 0; w < 5; w++) {
    const t = w / 4;
    const y = h * (0.5 + t * 0.48);
    const len = 3.0 - t * 1.7;
    const n = 9 - w;
    for (let i = 0; i < n; i++) {
      fol.push(...frond(len, len * 0.78, 0.12 + t * 0.1, (i / n) * TAU + w * 0.7, y, 0x5d8236));
    }
  }
  return { trunk: tr, foliage: mergeParts(fol) };
}

function buildSpruce() {
  const h = 17;
  const tr = mergeParts([trunkGeo(h, 0.42, 0.13, 0.3, 0x8a6a44)]);
  const fol = [];
  for (let w = 0; w < 9; w++) {
    const t = w / 8;
    const y = 1.8 + t * (h - 3.2);
    const len = 3.4 - t * 2.7;
    const n = Math.max(5, 10 - w);
    for (let i = 0; i < n; i++) {
      fol.push(...frond(len, len * 0.82, -0.22 - t * 0.12, (i / n) * TAU + w * 0.55, y, 0x3d6128));
    }
  }
  return { trunk: tr, foliage: mergeParts(fol) };
}

function buildBirch() {
  const h = 14;
  const parts = [trunkGeo(h, 0.28, 0.12, 0.55, 0xffffff)];
  for (let i = 0; i < 3; i++) {
    const a = Math.random() * TAU;
    const b = new THREE.CylinderGeometry(0.05, 0.1, 3.2, 5);
    b.rotateZ(0.75);
    b.rotateY(a);
    b.translate(Math.cos(a) * 0.9, h * (0.62 + i * 0.1), Math.sin(a) * 0.9);
    parts.push(paint(b, 0xe8e4d8, 0.08));
  }
  const fol = [];
  for (let i = 0; i < 16; i++) {
    const a = Math.random() * TAU;
    const rr = 0.6 + Math.random() * 2.2;
    fol.push(...leafCluster(2.2 + Math.random() * 1.4,
      Math.cos(a) * rr, h * (0.62 + Math.random() * 0.42), Math.sin(a) * rr, 0x77a03a));
  }
  return { trunk: mergeParts(parts), foliage: mergeParts(fol) };
}

function buildAspen() {
  const h = 12.5;
  const parts = [trunkGeo(h, 0.3, 0.13, 0.4, 0xa8a894)];
  const fol = [];
  for (let i = 0; i < 15; i++) {
    const a = Math.random() * TAU;
    const rr = 0.5 + Math.random() * 2.0;
    fol.push(...leafCluster(2.0 + Math.random() * 1.5,
      Math.cos(a) * rr, h * (0.6 + Math.random() * 0.45), Math.sin(a) * rr, 0x8fa832));
  }
  return { trunk: mergeParts(parts), foliage: mergeParts(fol) };
}

/** Пучок травы: скрещённые квады с текстурой травинок. */
/**
 * Пятно ягеля.
 *
 * Раньше это был приплюснутый многогранник. Грани выходили по полметра
 * и бликовали плоскостями — в бору лежали не подушки лишайника, а
 * смятые листы бумаги; случайный завал набок, которым это лечили,
 * только показывал плоскую изнанку. Купол вместо многогранника убрал
 * бумагу, но принёс твёрдую кромку, и ягель стал грудой камней.
 *
 * Работает третий подход: плоское пятно с рваным краем, вырезанным по
 * альфе. Положенные внахлёст, они сливаются в сплошной покров — ягель
 * так и растёт. Заодно два треугольника вместо полусотни: ковёр в бору
 * почти две тысячи пятен, и это разница в сто тысяч треугольников.
 */
function buildMossPad() {
  const g = new THREE.PlaneGeometry(1, 1, 1, 1);
  g.rotateX(-Math.PI / 2);
  // Белый вершинный цвет обязателен: материал объявлен vertexColors,
  // и без атрибута WebGL подставляет чёрный — пятна выходят углями.
  return paint(g, 0xffffff);
}

function buildGrassTuft() {
  const p = [];
  for (let i = 0; i < 3; i++) {
    // Раньше трава была 50–92 см при высоте гриба 12–16 см: шляпка
    // тонула гарантированно. Лесная подстилка и правда ниже.
    const hgt = 0.24 + Math.random() * 0.22;
    const wid = hgt * 0.85;
    const g = new THREE.PlaneGeometry(wid, hgt, 1, 3);
    const pos = g.attributes.position;
    const lean = (Math.random() - 0.5) * 0.34;
    for (let v = 0; v < pos.count; v++) {
      const t = (pos.getY(v) + hgt / 2) / hgt;
      pos.setX(v, pos.getX(v) + lean * t * t);
      pos.setZ(v, t * t * 0.07);
    }
    g.translate(0, hgt / 2, 0);
    g.rotateY((i / 3) * Math.PI + Math.random() * 0.4);
    g.translate((Math.random() - 0.5) * 0.16, 0, (Math.random() - 0.5) * 0.16);
    const sh = 0.78 + Math.random() * 0.44;
    p.push(paint(g, new THREE.Color(sh, sh * 1.02, sh * 0.9).getHex(), 0.18));
  }
  return mergeParts(p);
}

function buildFern() {
  const p = [];
  for (let i = 0; i < 7; i++) {
    const len = 0.75 + Math.random() * 0.3;
    const g = new THREE.PlaneGeometry(len, 0.3, 3, 1);
    const pos = g.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const t = (pos.getX(v) + len / 2) / len;
      pos.setY(v, pos.getY(v) + 0.16 + t * t * 0.5);
    }
    g.rotateX(-Math.PI / 2.6);
    g.translate(len / 2, 0.1, 0);
    g.rotateY((i / 7) * TAU);
    p.push(paint(g, 0x3f6224, 0.26));
  }
  return mergeParts(p);
}

function buildBush() {
  const p = [];
  for (let i = 0; i < 7; i++) {
    const a = Math.random() * TAU;
    const rr = Math.random() * 0.5;
    p.push(...leafCluster(0.85 + Math.random() * 0.5,
      Math.cos(a) * rr, 0.35 + Math.random() * 0.5, Math.sin(a) * rr, 0x3d5c22));
  }
  return mergeParts(p);
}

function buildRock() {
  const g = new THREE.DodecahedronGeometry(0.6, 1);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const n = 0.72 + Math.random() * 0.55;
    pos.setXYZ(i, pos.getX(i) * n, pos.getY(i) * n * 0.62, pos.getZ(i) * n);
  }
  g.computeVertexNormals();
  return paint(g, 0x6e6e68, 0.3);
}

function buildStump() {
  const p = [];
  const h = 0.55 + Math.random() * 0.35;
  p.push(trunkGeo(h, 0.55, 0.42, 0.1, 0xb08a5e));
  const top = new THREE.CylinderGeometry(0.4, 0.42, 0.06, 12);
  top.translate(0, h, 0);
  p.push(paint(top, 0xd8bc8a, 0.12));
  for (let i = 0; i < 4; i++) {
    const a = Math.random() * TAU;
    const rt = new THREE.CylinderGeometry(0.1, 0.2, 0.95, 6);
    rt.rotateZ(1.28);
    rt.rotateY(a);
    rt.translate(Math.cos(a) * 0.5, 0.1, Math.sin(a) * 0.5);
    p.push(paint(rt, 0x8a6a42, 0.15));
  }
  return mergeParts(p);
}

function buildLog() {
  const p = [];
  const len = 3.5 + Math.random() * 2.5;
  const l = new THREE.CylinderGeometry(0.33, 0.38, len, 10);
  l.rotateZ(Math.PI / 2);
  l.translate(0, 0.34, 0);
  p.push(paint(l, 0xa07c48, 0.18));
  const m = new THREE.CylinderGeometry(0.35, 0.35, len * 0.7, 10, 1, true, 0, Math.PI);
  m.rotateZ(Math.PI / 2);
  m.rotateX(-0.3);
  m.scale(1, 1.04, 1.04);
  m.translate(0, 0.34, 0);
  p.push(paint(m, 0x4a7028, 0.3));
  return mergeParts(p);
}

/**
 * Материалы кита. Собираются лениво: текстуры приходят из сети, а MAT
 * объявлен на разборе модуля.
 *
 * Листва вся в одном атласе, так что материалов нужно всего два — и
 * различаются они только ветром. Трава гнётся от самой земли и сильно,
 * крона лишь колышется и только выше полутора метров; одним значением
 * это не покрыть, а текстура у обоих одна и та же, так что лишней
 * памяти на GPU второй материал не занимает.
 */
function initKitMaterials() {
  if (MAT.kitLeaf || !plantsLoaded()) return;
  const T = plantTextures();
  MAT.kitLeaf = addWind(new THREE.MeshLambertMaterial({
    vertexColors: true, map: T.atlas, alphaTest: 0.45, side: THREE.DoubleSide,
  }), 0.014, 1.5);
  MAT.kitGrass = addWind(new THREE.MeshLambertMaterial({
    vertexColors: true, map: T.atlas, alphaTest: 0.45, side: THREE.DoubleSide,
  }), 0.42, 0.02);
  MAT.kitBark = new THREE.MeshStandardMaterial({
    vertexColors: true, map: T.bark, roughness: 0.95, metalness: 0,
  });
  // Берёзе нужна своя кора: выдел так и называется, и белые стволы —
  // единственное, чем березняк читается с полусотни метров. Развёртка
  // ствола кита мостится шестнадцать раз по высоте, поэтому шаг
  // текстуры делится на те же шестнадцать, иначе выйдет серая каша.
  const tb = birchTex();
  tb.repeat.set(1.6, 4 / 16);
  MAT.kitBirch = new THREE.MeshStandardMaterial({
    vertexColors: true, map: tb, roughness: 0.85, metalness: 0,
  });
}

/* Лиственные породы берём из кита: [имя в ките, высота в метрах].
   По два роста на выдел — взрослое дерево и подрост. Хвойных в ките
   нет вовсе, так что сосна и ель остаются процедурными: бор и ельник
   держатся именно на хвойном силуэте.
   Рост подогнан под соседей: сосна в лесу 15 м, берёза была 14, осина
   12.5 — кит должен встать вровень, иначе лиственные читаются подлеском. */
const KIT_TREES = {
  birch: [['Tree-01-1', 14.0], ['Tree-01-4', 9.0]],
  aspen: [['Tree-02-2', 13.0], ['Tree-02-4', 8.5]],
};
/* Подлесок: [имя, высота]. Сухие места — куст, сырые — раскидистый.
   Каждая форма — отдельный инстанс-меш, то есть отдельный вызов
   отрисовки на чанк. Трёх на весь подлесок достаточно: дальше растёт
   счёт вызовов, а не разнообразие — кусты и так крутит по оси. */
const KIT_BUSH = [['Bush-02', 1.15], ['Bush-04', 1.30]];
const KIT_WET = [['Bush-05', 1.75]];
/* Напочвенный ковёр: клевер плоский и почти ничего не стоит. */
const KIT_CLOVER = ['Clover-01', 'Clover-03', 'Clover-05'];
/* Трава в ките снята с сухого луга — соломенная. На зелёной подстилке
   такие пучки читаются не травой, а бурым мусором, поэтому тон уводим
   в зелень. На поляне выдел сам вернёт желтизну своим множителем. */
const KIT_GRASS_TINT = [0.50, 0.82, 0.58];

const GEO = {};
function initGeometries() {
  if (GEO.pine) return;
  GEO.pine = buildPine();
  GEO.spruce = buildSpruce();
  GEO.birch = buildBirch();
  GEO.aspen = buildAspen();
  GEO.grass = buildGrassTuft();
  GEO.moss = buildMossPad();
  GEO.fern = buildFern();
  GEO.bush = buildBush();
  GEO.rock = buildRock();
  GEO.stump = buildStump();
  GEO.log = buildLog();
  initKit();
}

/**
 * Подмена процедурных заготовок китом — там, где кит лучше.
 * Всё, чего в ките нет (сосна, ель, ягель, камни, пни), остаётся своим,
 * и если файл не доехал, лес просто выглядит как раньше.
 */
function initKit() {
  initKitMaterials();
  if (!plantsLoaded()) return;
  // На «низком» качестве кит остаётся, но без излишеств: листва кита —
  // крупные карточки с отсечением по альфе, и платят за неё заливкой,
  // а не треугольниками. Ковёр клевера, вторые формы кустов и подрост
  // — первое, чем стоит пожертвовать на слабой машине.
  const low = CONFIG.quality === 'low';

  // Трава. Один пучок кита — это две скрещённые карточки на 10
  // треугольников, и поодиночке он читается не травой, а торчащими
  // соломинами. Склеиваем два под углом: густота выходит как у
  // процедурного кустика, а треугольников те же 20, что и раньше.
  // Высоту держим прежнюю: выше — и шляпка боровика тонет с головой.
  if (hasPlants('Grass-01')) {
    const tuft = [];
    for (const [n, ang, dx, dz] of [['Grass-01', 0, 0, 0], ['Grass-03', 1.15, 0.07, 0.05]]) {
      const gg = hasPlants(n) ? scaledPart(n, 'leaf', 0.44) : null;
      if (!gg) continue;
      gg.rotateY(ang);
      gg.translate(dx, 0, dz);
      tuft.push(gg);
    }
    GEO.kitGrass = tuft.length > 1 ? mergeParts(tuft) : tuft[0];
    // Дальний слой чанка — одиночная карточка. Там пучок стоит раз на
    // тридцать квадратов и с двадцати метров всё равно неразличим, а
    // вторая половинка стоила бы сто тридцать тысяч треугольников.
    GEO.kitGrassFar = scaledPart('Grass-01', 'leaf', 0.44);
  }
  // Клевер берём как есть: коврик 1.6 м шириной и 7 см высотой. Тянуть
  // его по высоте нельзя — масштаб общий, и от «подросшего» клевера
  // коврик расплывается на два с лишним метра.
  for (const n of (low ? [] : KIT_CLOVER)) {
    if (!hasPlants(n)) continue;
    (GEO.kitClover || (GEO.kitClover = [])).push(scaledPart(n, 'leaf', 0));
  }
  const bushes = (list) => {
    const out = [];
    for (const [n, h] of (low ? list.slice(0, 1) : list)) {
      if (hasPlants(n)) out.push(scaledPart(n, 'leaf', h));
    }
    return out.length ? out : null;
  };
  GEO.kitBush = bushes(KIT_BUSH);
  GEO.kitWet = bushes(KIT_WET);
  if (hasPlants('Flowers-02')) GEO.kitFlower = scaledPart('Flowers-02', 'leaf', 0.75);

  // Деревья: по два роста на породу, ствол и крона отдельными мешами.
  GEO.kit = {};
  for (const sp of Object.keys(KIT_TREES)) {
    const vs = [];
    for (const [n, h] of (low ? KIT_TREES[sp].slice(0, 1) : KIT_TREES[sp])) {
      if (!hasPlants(n)) continue;
      const t = scaledTree(n, h);
      if (t) vs.push(t);
    }
    if (vs.length) GEO.kit[sp] = vs;
  }
}

/** Варианты породы: кит, если он есть на эту породу, иначе своя одна заготовка. */
function treeVariants(t) {
  const k = GEO.kit && GEO.kit[t];
  if (k) return k.map((v) => ({ trunk: v.bark, foliage: v.leaf, kit: true }));
  return [{ trunk: GEO[t].trunk, foliage: GEO[t].foliage, kit: false }];
}

/** Материалы варианта: у кита своя кора и общий атлас листвы. */
function treeMats(t, kit) {
  if (!kit) return [MAT[TREE_MAT[t].trunk], MAT[TREE_MAT[t].foliage]];
  return [t === 'birch' ? MAT.kitBirch : MAT.kitBark, MAT.kitLeaf];
}

/** Какой материал у ствола и кроны каждой породы. */
const TREE_MAT = {
  pine: { trunk: 'bark', foliage: 'needle' },
  spruce: { trunk: 'bark', foliage: 'needle' },
  birch: { trunk: 'birch', foliage: 'leaf' },
  aspen: { trunk: 'bark', foliage: 'leaf' },
};

export const TREE_TYPES = ['pine', 'spruce', 'birch', 'aspen'];

/* ============================================================
   Приёмный пункт: «Буханка», палатка, ящики, костёр, луч-маяк
   ============================================================ */
/**
 * УАЗ на приёмном пункте: скачанная модель или коробочная «буханка».
 * Модель уже в метрах, колёсами на нуле и капотом в -Z, так что
 * ставится в начало координат лагеря как есть.
 */
function fillUaz(node) {
  node.clear();
  const model = instance('uaz');
  if (model) {
    model.traverse((o) => { if (o.isMesh) o.frustumCulled = true; });
    node.add(model);
    return;
  }

  const p = [];
  const body = new THREE.BoxGeometry(2.0, 1.5, 4.4);
  body.translate(0, 1.35, 0);
  p.push(paint(body, 0xb8bfa8, 0.06));
  const cabin = new THREE.BoxGeometry(2.02, 0.62, 1.5);
  cabin.translate(0, 2.18, 1.4);
  p.push(paint(cabin, 0x2c3a42, 0.05));
  const roof = new THREE.BoxGeometry(2.05, 0.12, 4.4);
  roof.translate(0, 2.15, -0.1);
  p.push(paint(roof, 0xa8b096, 0.05));
  for (const [dx, dz] of [[-1, 1.45], [1, 1.45], [-1, -1.5], [1, -1.5]]) {
    const w = new THREE.CylinderGeometry(0.42, 0.42, 0.28, 10);
    w.rotateZ(Math.PI / 2);
    w.translate(dx, 0.42, dz);
    p.push(paint(w, 0x1c1c1c, 0.1));
  }
  const win = new THREE.BoxGeometry(1.9, 0.5, 0.06);
  win.translate(0, 1.85, 2.22);
  p.push(paint(win, 0x18323a));
  node.add(new THREE.Mesh(mergeParts(p), MAT.prop));
}

/**
 * Гора сданных грибов у приёмного пункта: те же модели, что растут
 * в лесу, просто свалены в кучу и развёрнуты как попало. Шляпки
 * держат вершинный цвет, поэтому вся гора собирается в один меш.
 *
 * Геометрия общая на все пункты: гриб — модель подробная, и четыре
 * своих кучи стоили бы полмиллиона вершин.
 */
let pileGeo = null;

function mushroomPileGeometry() {
  if (pileGeo) return pileGeo;

  const kinds = SPECIES.filter((sp) => sp.price > 0);
  const parts = [];
  const R = 0.38, H = 0.55;   // куча, а не россыпь: узкая и высокая
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const scl = new THREE.Vector3();

  for (let i = 0; i < 44; i++) {
    const sp = kinds[(Math.random() * kinds.length) | 0];
    const geo = getMushroomGeometry(sp, (Math.random() * GEO_VARIANTS) | 0).clone();
    // куполом: к краю кучи ниже
    const a = Math.random() * TAU;
    const r = R * Math.sqrt(Math.random());
    const t = 1 - r / R;
    const y = H * t * t * (0.35 + 0.65 * Math.random());
    // валяются боком: кувыркать вокруг всех осей нельзя, половина
    // уйдёт шляпками в землю
    e.set((Math.random() - 0.5) * 2.6, Math.random() * TAU, (Math.random() - 0.5) * 2.6);
    q.setFromEuler(e);
    const k = 0.85 + Math.random() * 0.3;
    scl.set(k, k, k);
    pos.set(Math.cos(a) * r, y, Math.sin(a) * r);
    geo.applyMatrix4(m.compose(pos, q, scl));
    parts.push(geo);
  }

  pileGeo = mergeParts(parts);
  // сажаем кучу на землю: после кувырков нижняя точка уходит в минус
  pileGeo.computeBoundingBox();
  pileGeo.translate(0, -pileGeo.boundingBox.min.y, 0);
  return pileGeo;
}

function buildMushroomPile() {
  const mesh = new THREE.Mesh(mushroomPileGeometry(), MAT_MUSHROOM);
  mesh.position.set(-3.5, 0, 0.3);
  return mesh;
}

function buildCamp() {
  const g = new THREE.Group();
  const p = [];

  // УАЗ — отдельным узлом: его подменяет скачанная модель
  const uaz = new THREE.Group();
  fillUaz(uaz);
  onAsset('uaz', () => fillUaz(uaz));
  g.add(uaz);

  // гора сданного
  const pile = buildMushroomPile();
  g.add(pile);

  // весы и ящики
  for (let i = 0; i < 5; i++) {
    const b = new THREE.BoxGeometry(0.7, 0.45, 0.5);
    b.translate(-2.4 + (i % 2) * 0.85, 0.24 + Math.floor(i / 2) * 0.47, -2.2 + (i % 3) * 0.7);
    p.push(paint(b, 0x8a6a3a, 0.14));
  }

  // костёр
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const s = new THREE.CylinderGeometry(0.06, 0.08, 0.8, 4);
    s.rotateZ(0.55);
    s.rotateY(a);
    s.translate(2.6 + Math.cos(a) * 0.2, 0.3, 1.6 + Math.sin(a) * 0.2);
    p.push(paint(s, 0x3a2a18, 0.2));
  }
  const props = new THREE.Mesh(mergeParts(p), MAT.prop);
  g.add(props);

  // Ящики, УАЗ и гора грибов — это 34 тысячи треугольников на пункт,
  // и рисовались они с любого расстояния. Луч-маяк остаётся: по нему
  // пункт и находят издалека.
  g.userData.props = [uaz, pile, props];

  // пламя
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 0.8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff9128, transparent: true, opacity: 0.92 })
  );
  flame.position.set(2.6, 0.7, 1.6);
  g.add(flame);
  g.userData.flame = flame;



  // луч-маяк, чтобы пункт было видно сквозь туман
  const beamGeo = new THREE.CylinderGeometry(0.25, 0.9, 70, 10, 6, true);
  const bp = beamGeo.attributes.position;
  const bc = new Float32Array(bp.count * 3);
  for (let i = 0; i < bp.count; i++) {
    const t = (bp.getY(i) + 35) / 70;            // 0 у земли, 1 наверху
    const a = Math.pow(1 - t, 2.2) * 0.9;
    bc[i * 3] = a; bc[i * 3 + 1] = a; bc[i * 3 + 2] = a;
  }
  beamGeo.setAttribute('color', new THREE.BufferAttribute(bc, 3));
  const beam = new THREE.Mesh(beamGeo, MAT.beam);
  beam.position.y = 35;
  g.add(beam);

  return g;
}

/* ============================================================
   Чанк
   ============================================================ */
class Chunk {
  constructor(cx, cz, world) {
    this.cx = cx; this.cz = cz;
    this.baseX = cx * CS; this.baseZ = cz * CS;
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = true;
    this.mushrooms = [];
    this.treeCols = [];       // локальные координаты стволов для коллизий
    this.built = false;
    this.world = world;
  }

  build() {
    if (this.built) return;
    this.built = true;
    initGeometries();
    const rnd = rng(((this.cx * 374761393) ^ (this.cz * 668265263) ^ 0xa17) >>> 0);
    const g = this.group;

    /* --- земля --- */
    const seg = 14;
    const gg = new THREE.PlaneGeometry(CS, CS, seg, seg);
    gg.rotateX(-Math.PI / 2);
    const pos = gg.attributes.position;
    const colArr = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const lx = pos.getX(i) + CS / 2;
      const lz = pos.getZ(i) + CS / 2;
      const wx = this.baseX + lx, wz = this.baseZ + lz;
      const h = terrainHeight(wx, wz);
      pos.setY(i, h);
      const wet = moisture(wx, wz);
      const slope = terrainSlope(wx, wz);
      // цвет несёт текстура, вершины только подкрашивают — иначе
      // тёмный оттенок умножается на тёмную текстуру и земля чернеет
      const biome = forestType(wx, wz);
      if (h < WATER_LEVEL + 1.1) c.setRGB(1.05, 0.9, 0.66);     // ил у воды
      // Бор-беломошник должно быть видно издалека: по белому мху
      // игрок и понимает, что тут стоит искать боровики. Проверяем
      // раньше склона — иначе песчаная грива красится как обрыв.
      else if (biome === FOREST.BOR) c.setRGB(1.34, 1.32, 1.18);
      else if (slope > 0.42) c.setRGB(1.0, 0.86, 0.62);         // склон, обнажённая земля
      else if (biome === FOREST.BOLOTO) c.setRGB(0.66, 0.84, 0.6);
      else if (biome === FOREST.ELNIK) c.setRGB(0.74, 0.92, 0.64);
      else if (biome === FOREST.MEADOW) c.setRGB(1.15, 1.1, 0.78);
      else if (biome === FOREST.OSINNIK) c.setRGB(1.0, 1.0, 0.74);
      else c.setRGB(0.92, 1.0, 0.8);
      const j = 0.9 + rnd() * 0.2;
      colArr[i * 3] = c.r * j; colArr[i * 3 + 1] = c.g * j; colArr[i * 3 + 2] = c.b * j;
    }
    gg.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
    gg.computeVertexNormals();
    const ground = new THREE.Mesh(gg, MAT.ground);
    ground.position.set(CS / 2, 0, CS / 2);
    ground.receiveShadow = true;
    g.add(ground);

    /* --- вода (плоскость; рельеф выше уровня сам её перекрывает) --- */
    let minH = 1e9;
    for (let i = 0; i <= 6; i++)
      for (let k = 0; k <= 6; k++)
        minH = Math.min(minH, terrainHeight(this.baseX + (i / 6) * CS, this.baseZ + (k / 6) * CS));
    this.hasWater = minH < WATER_LEVEL;
    if (this.hasWater) {
      const wg = new THREE.PlaneGeometry(CS + 0.5, CS + 0.5, 1, 1);
      wg.rotateX(-Math.PI / 2);
      const wm = new THREE.Mesh(wg, MAT.water);
      wm.position.set(CS / 2, WATER_LEVEL + 0.35, CS / 2);
      g.add(wm);
    }

    /* --- деревья --- */
    const byType = { pine: [], spruce: [], birch: [], aspen: [] };
    const nTrees = CONFIG.treesPerChunk;
    for (let i = 0; i < nTrees; i++) {
      const lx = rnd() * CS, lz = rnd() * CS;
      const wx = this.baseX + lx, wz = this.baseZ + lz;
      if (isWater(wx, wz)) continue;
      const biome = forestType(wx, wz);
      // Бор стоит редко и светло, на поляне почти пусто, в ельнике густо.
      const thin = [0.42, 0.06, 0.16, 0.2, 0.78, 0.5][biome];
      if (rnd() < thin) continue;
      if (terrainSlope(wx, wz) > 0.6) continue;
      // Вокруг приёмного пункта — поляна. Иначе ель вырастает прямо
      // в кузове «Буханки» и заслоняет весь лагерь.
      let atCamp = false;
      for (const cp of CAMPS) {
        if (torusDist2(wx, wz, cp.x, cp.z) < 12 * 12) { atCamp = true; break; }
      }
      if (atCamp) continue;
      // порода по выделу: [сосна, ель, берёза] — остаток уходит осине
      const mix = [
        [0.90, 0.95, 1.00],   // бор
        [0.06, 0.78, 0.92],   // ельник
        [0.08, 0.26, 0.86],   // березняк
        [0.04, 0.18, 0.46],   // осинник
        [0.30, 0.40, 0.82],   // поляна
        [0.05, 0.55, 0.88],   // низина
      ][biome];
      const r = rnd();
      const t = r < mix[0] ? 'pine' : r < mix[1] ? 'spruce' : r < mix[2] ? 'birch' : 'aspen';
      const s = 0.72 + rnd() * 0.62;
      // Подрост реже взрослого дерева: сплошной молодняк читается
      // кустарником, а не лесом.
      const nv = treeVariants(t).length;
      const v = nv < 2 ? 0 : (rnd() < 0.72 ? 0 : 1 + ((rnd() * (nv - 1)) | 0));
      byType[t].push({ lx, lz, y: terrainHeight(wx, wz), s, v, rot: rnd() * TAU });
      this.treeCols.push(lx, lz, 0.34 * s + 0.2);
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v3 = new THREE.Vector3();
    const sc = new THREE.Vector3();
    const tint = new THREE.Color();
    const UP = new THREE.Vector3(0, 1, 0);

    // Ствол и крона — разные материалы (кора против хвои с прозрачностью),
    // поэтому на породу приходится два инстанс-меша.
    for (const t of TREE_TYPES) {
      if (!byType[t].length) continue;
      const vars = treeVariants(t);
      for (let vi = 0; vi < vars.length; vi++) {
        const list = vars.length < 2 ? byType[t] : byType[t].filter((o) => o.v === vi);
        if (!list.length) continue;
        const [mTrunk, mFoliage] = treeMats(t, vars[vi].kit);
        const pair = [
          { geo: vars[vi].trunk, mat: mTrunk, shadow: true },
          { geo: vars[vi].foliage, mat: mFoliage, shadow: true },
        ];
        // одинаковые матрицы для обеих частей — считаем один раз
        const mats4 = [], cols = [];
        for (const o of list) {
          q.setFromAxisAngle(UP, o.rot);
          sc.set(o.s * (0.9 + rnd() * 0.2), o.s, o.s * (0.9 + rnd() * 0.2));
          v3.set(o.lx, o.y, o.lz);
          mats4.push(m4.clone().compose(v3, q, sc));
          const j = 0.85 + rnd() * 0.3;
          cols.push(new THREE.Color(j, j * (0.96 + rnd() * 0.08), j * 0.97));
        }
        for (const part of pair) {
          const im = new THREE.InstancedMesh(part.geo, part.mat, list.length);
          im.instanceMatrix.setUsage(THREE.StaticDrawUsage);
          for (let i = 0; i < list.length; i++) {
            im.setMatrixAt(i, mats4[i]);
            im.setColorAt(i, cols[i]);
          }
          im.instanceMatrix.needsUpdate = true;
          if (im.instanceColor) im.instanceColor.needsUpdate = true;
          im.castShadow = part.shadow;
          im.receiveShadow = true;
          im.computeBoundingSphere();
          // подпись для отладки: сколько какой породы встало в чанк
          im.userData.kind = t + (vars.length > 1 ? '-' + (vi + 1) : '');
          g.add(im);
        }
      }
    }

    /* --- пни (на них растут опята) --- */
    this.stumps = [];
    const nStumps = 2 + ((rnd() * 3) | 0);
    const stumpList = [];
    for (let i = 0; i < nStumps; i++) {
      const lx = rnd() * CS, lz = rnd() * CS;
      const wx = this.baseX + lx, wz = this.baseZ + lz;
      if (isWater(wx, wz)) continue;
      stumpList.push({ lx, lz, y: terrainHeight(wx, wz), rot: rnd() * TAU });
      this.stumps.push({ x: lx, z: lz });
    }
    if (stumpList.length) {
      const im = new THREE.InstancedMesh(GEO.stump, MAT.prop, stumpList.length);
      stumpList.forEach((o, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.rot);
        im.setMatrixAt(i, m4.compose(v3.set(o.lx, o.y, o.lz), q, sc.set(1, 1, 1)));
      });
      im.instanceMatrix.needsUpdate = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      g.add(im);
    }

    /* --- валежник --- */
    const nLogs = 1 + ((rnd() * 2) | 0);
    const logList = [];
    for (let i = 0; i < nLogs; i++) {
      const lx = rnd() * CS, lz = rnd() * CS;
      const wx = this.baseX + lx, wz = this.baseZ + lz;
      if (isWater(wx, wz)) continue;
      logList.push({ lx, lz, y: terrainHeight(wx, wz), rot: rnd() * TAU });
    }
    if (logList.length) {
      const im = new THREE.InstancedMesh(GEO.log, MAT.prop, logList.length);
      logList.forEach((o, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.rot);
        im.setMatrixAt(i, m4.compose(v3.set(o.lx, o.y, o.lz), q, sc.set(1, 1, 1)));
      });
      im.instanceMatrix.needsUpdate = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      g.add(im);
    }

    /* --- кусты и папоротник --- */
    // Сухие места и сырые получают разный подлесок. Из кита на каждую
    // группу идёт по нескольку форм: один и тот же куст, повторённый
    // шестнадцать раз на чанк, слишком заметно повторяется.
    const dry = GEO.kitBush || [GEO.bush];
    const wet = GEO.kitWet || [GEO.fern];
    const bMat = GEO.kitBush ? MAT.kitLeaf : MAT.bush;
    const wMat = GEO.kitWet ? MAT.kitLeaf : MAT.bush;
    const sets = [];
    for (const g of dry) sets.push({ geo: g, mat: bMat, list: [] });
    for (const g of wet) sets.push({ geo: g, mat: wMat, list: [] });
    const nDry = dry.length;
    for (let i = 0; i < CONFIG.bushesPerChunk; i++) {
      const lx = rnd() * CS, lz = rnd() * CS;
      const wx = this.baseX + lx, wz = this.baseZ + lz;
      if (isWater(wx, wz)) continue;
      const o = { lx, lz, y: terrainHeight(wx, wz), s: 0.7 + rnd() * 0.8, rot: rnd() * TAU };
      const soggy = moisture(wx, wz) > 0.55;
      const pool = soggy ? wet : dry;
      sets[(soggy ? nDry : 0) + ((rnd() * pool.length) | 0)].list.push(o);
    }
    // Ромашки — только на полянах и опушках, в глухом ельнике их нет.
    if (GEO.kitFlower) {
      const fl = { geo: GEO.kitFlower, mat: MAT.kitLeaf, list: [] };
      for (let i = 0; i < 14; i++) {
        const lx = rnd() * CS, lz = rnd() * CS;
        const wx = this.baseX + lx, wz = this.baseZ + lz;
        if (isWater(wx, wz)) continue;
        const b = forestType(wx, wz);
        if (b !== FOREST.MEADOW && b !== FOREST.BEREZNYAK) continue;
        fl.list.push({ lx, lz, y: terrainHeight(wx, wz), s: 0.7 + rnd() * 0.7, rot: rnd() * TAU });
      }
      sets.push(fl);
    }
    for (const { list, geo, mat } of sets) {
      if (!list.length || !geo) continue;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((o, i) => {
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.rot);
        im.setMatrixAt(i, m4.compose(v3.set(o.lx, o.y, o.lz), q, sc.set(o.s, o.s, o.s)));
        const j = 0.8 + rnd() * 0.4;
        im.setColorAt(i, tint.setRGB(j, j, j));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      g.add(im);
    }

    /* --- камни --- */
    const rocks = [];
    for (let i = 0; i < CONFIG.rocksPerChunk; i++) {
      const lx = rnd() * CS, lz = rnd() * CS;
      rocks.push({
        lx, lz, y: terrainHeight(this.baseX + lx, this.baseZ + lz) - 0.15,
        s: 0.6 + rnd() * 1.5, rot: rnd() * TAU,
      });
    }
    const rim = new THREE.InstancedMesh(GEO.rock, MAT.rock, rocks.length);
    rocks.forEach((o, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.rot);
      rim.setMatrixAt(i, m4.compose(v3.set(o.lx, o.y, o.lz), q, sc.set(o.s, o.s * 0.8, o.s)));
      const j = 0.8 + rnd() * 0.45;
      rim.setColorAt(i, tint.setRGB(j, j, j));
    });
    rim.instanceMatrix.needsUpdate = true;
    if (rim.instanceColor) rim.instanceColor.needsUpdate = true;
    rim.receiveShadow = true;
    rim.computeBoundingSphere();
    g.add(rim);

    /* --- трава --- */
    const gn = CONFIG.quality === 'low' ? (CONFIG.grassPerChunk * 0.4) | 0 : CONFIG.grassPerChunk;
    const gim = new THREE.InstancedMesh(
      GEO.kitGrassFar || GEO.grass, GEO.kitGrassFar ? MAT.kitGrass : MAT.grass, gn);
    let used = 0;
    for (let i = 0; i < gn; i++) {
      const lx = rnd() * CS, lz = rnd() * CS;
      const wx = this.baseX + lx, wz = this.baseZ + lz;
      if (isWater(wx, wz)) continue;
      const wet = moisture(wx, wz);
      const s = (wet < 0.34 ? 1.25 : 0.85) * (0.7 + rnd() * 0.8);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * TAU);
      gim.setMatrixAt(used, m4.compose(v3.set(lx, terrainHeight(wx, wz) - 0.03, lz), q, sc.set(s, s, s)));
      const j = 0.72 + rnd() * 0.56;
      const G = GEO.kitGrass ? KIT_GRASS_TINT : [1, 1, 1];
      gim.setColorAt(used, tint.setRGB(j * G[0], j * (0.95 + rnd() * 0.12) * G[1], j * 0.85 * G[2]));
      used++;
    }
    gim.count = used;
    gim.instanceMatrix.needsUpdate = true;
    if (gim.instanceColor) gim.instanceColor.needsUpdate = true;
    gim.receiveShadow = true;
    gim.computeBoundingSphere();
    g.add(gim);

    /* --- грибы --- */
    this.mushGroup = new THREE.Group();
    g.add(this.mushGroup);
    const defs = generateChunkMushrooms(this.cx, this.cz, this.stumps);
    for (const d of defs) {
      const geo = getMushroomGeometry(d.sp, d.variant);
      const mesh = new THREE.Mesh(geo, MAT_MUSHROOM);
      const y = d.onStump
        ? terrainHeight(this.baseX + d.onStump.x, this.baseZ + d.onStump.z) + 0.5
        : terrainHeight(this.baseX + d.lx, this.baseZ + d.lz) - 0.004;
      mesh.position.set(d.lx, y, d.lz);
      mesh.rotation.set(d.tilt * 0.7, d.rot, d.tilt);
      mesh.visible = false;
      mesh.frustumCulled = true;
      this.mushGroup.add(mesh);
      const m = {
        sp: d.sp, mesh,
        wx: wrapCoord(this.baseX + d.lx), wz: wrapCoord(this.baseZ + d.lz),
        y, picked: false, respawn: 0, chunk: this,
      };
      mesh.userData.m = m;
      this.mushrooms.push(m);
      // Личную лампу гриб больше не носит: их десятки, и каждая
      // гасла и зажигалась по дистанции. Свет выдаётся из общего пула
      // (см. requestGlow) — иначе число источников в сцене скачет.
      if (d.sp.glow) m.glow = d.sp.glow;
    }
  }
}

/* ============================================================
   Мир
   ============================================================ */
/* Напочвенный покров по выделам: [плешивость, высота, R, G, B].
   Ягель в бору низкий, густой и почти белый — по нему боровик и
   ищется; на поляне трава высокая и сухая, в низине тёмная. */
/* Шестое число — доля клеток с ковриком клевера. В бору его нет: там
   сплошной ягель, по которому и ищется боровик. */
const NG_BIOME = [
  [0.06, 0.55, 1.55, 1.52, 1.44, 0.00],   // бор
  [0.20, 1.05, 0.80, 1.02, 0.72, 0.10],   // ельник
  [0.22, 1.00, 1.00, 1.00, 1.00, 0.17],   // березняк
  [0.22, 1.00, 1.06, 1.02, 0.92, 0.17],   // осинник
  [0.18, 1.25, 1.18, 1.10, 0.70, 0.24],   // поляна
  [0.16, 1.12, 0.72, 0.96, 0.66, 0.14],   // низина
];

export class World {
  constructor(scene) {
    this.scene = scene;
    // до всего остального: от места пунктов зависят поляны в чанках
    placeCamps();
    this.chunks = new Map();
    this.root = new THREE.Group();
    scene.add(this.root);
    this.campGroups = [];
    this.time = 0;

    // сетка чанков
    for (let cz = 0; cz < GRID; cz++) {
      for (let cx = 0; cx < GRID; cx++) {
        const ch = new Chunk(cx, cz, this);
        this.chunks.set(cx + ',' + cz, ch);
        this.root.add(ch.group);
        ch.group.visible = false;
      }
    }

    // приёмные пункты
    for (const c of CAMPS) {
      const g = buildCamp();
      g.rotation.y = Math.random() * TAU;
      this.campGroups.push({ g, camp: c });
      this.root.add(g);
    }

    // Скупщик появится, когда подгрузится модель. Пока её нет, пункт
    // просто стоит пустой — как и раньше.
    onAsset('buyer', () => {
      for (const { g } of this.campGroups) {
        const man = instance('buyer');
        if (!man) continue;
        // между палаткой и костром, лицом наружу — за «Буханкой» его
        // не видно, а это единственный живой человек в лесу
        // у водительской двери УАЗа, лицом наружу
        man.position.set(-1.55, 0, 0.9);
        man.rotation.y = -1.25;
        // Загрузчик выключает отсечение (это нужно моделям в руках),
        // но скупщик — обычный объект мира: пусть его отсекает пирамида,
        // иначе четыре пункта рисуются всегда, даже за спиной.
        man.traverse((o) => { if (o.isMesh) o.frustumCulled = true; });
        g.add(man);
        g.userData.buyer = man;
      }
    });

    this._buildSky();
    this._buildMidges();
    this._buildNearGrass();
    this._buildRain();

    // Кровавое небо: сорвал сатанинский гриб — на минуту темнеет и
    // краснеет весь свет. Держим отдельным числом, а не погодой:
    // погода живёт своей жизнью и не должна это затирать.
    this.blood = 0;
    this.bloodT = 0;

    // погода: 0 — ясно, 1 — стена воды
    this.weather = 'clear';
    this.wet = 0;
    this.fogBoost = 0;
    this.windBoost = 0;
  }

  /* ------------------------------------------------------------
     Дождь. Столб капель едет за игроком: рисовать его на весь
     километр бессмысленно, дальше 25 м капли всё равно не видно.
     ------------------------------------------------------------ */
  _buildRain() {
    const n = CONFIG.quality === 'low' ? 900 : 2600;
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3);
    const spd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      p[i * 3] = (Math.random() - 0.5) * 46;
      p[i * 3 + 1] = Math.random() * 22;
      p[i * 3 + 2] = (Math.random() - 0.5) * 46;
      spd[i] = 14 + Math.random() * 12;
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.rainSpeed = spd;
    this.rain = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xa8c4d8, size: 0.075, transparent: true, opacity: 0,
      depthWrite: false, sizeAttenuation: true, fog: false,
    }));
    this.rain.frustumCulled = false;
    this.rain.visible = false;
    this.scene.add(this.rain);
  }

  /** Меняет погоду. Возвращает подпись для интерфейса. */
  setWeather(kind) {
    this.weather = kind;
    return {
      clear: '', rain: '☂ дождь', fog: '🌫 туман', wind: '🍃 ветер',
    }[kind] || '';
  }

  _updateWeather(dt, px, pz) {
    const targetWet = this.weather === 'rain' ? 1 : 0;
    const targetFog = this.weather === 'fog' ? 1 : this.weather === 'rain' ? 0.45 : 0;
    const targetWind = this.weather === 'wind' ? 1 : this.weather === 'rain' ? 0.5 : 0;
    this.wet = dampTo(this.wet, targetWet, 0.6, dt);
    this.fogBoost = dampTo(this.fogBoost, targetFog, 0.5, dt);
    this.windBoost = dampTo(this.windBoost, targetWind, 0.7, dt);

    this.rain.visible = this.wet > 0.02;
    if (this.rain.visible) {
      this.rain.material.opacity = this.wet * 0.55;
      const pos = this.rain.geometry.attributes.position;
      const drift = this.windBoost * 6;
      for (let i = 0; i < this.rainSpeed.length; i++) {
        let y = pos.getY(i) - this.rainSpeed[i] * dt;
        let x = pos.getX(i) + drift * dt;
        if (y < -3) { y = 20 + Math.random() * 4; x = (Math.random() - 0.5) * 46; }
        if (x > 23) x -= 46;
        pos.setXYZ(i, x, y, pos.getZ(i));
      }
      pos.needsUpdate = true;
      this.rain.position.set(px, terrainHeight(px, pz), pz);
    }
  }

  /* ------------------------------------------------------------
     Ближняя трава. Чанковой плотности хватает только на дальний
     план, поэтому вокруг игрока держим отдельный «ковёр»: пучки
     привязаны к ячейкам мировой сетки 1×1 м, поэтому при ходьбе
     они стоят на месте, а не едут за камерой.
     ------------------------------------------------------------ */
  _buildNearGrass() {
    initGeometries();
    this.ngR = CONFIG.quality === 'low' ? 20 : 29;
    const n = Math.ceil(Math.PI * this.ngR * this.ngR * 1.05);
    this.nearGrass = new THREE.InstancedMesh(
      GEO.kitGrass || GEO.grass, GEO.kitGrass ? MAT.kitGrass : MAT.grass, n);
    this.nearGrass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Цвет травинок three завёл бы сам при первом setColorAt — но со
    // статическим флагом. Ковёр пересобирается каждые два метра хода,
    // и перезалив статического буфера заставлял драйвер ждать GPU:
    // замер показывал провал до 100 мс раз в полсекунды при ходьбе.
    this.nearGrass.instanceColor =
      new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.nearGrass.instanceColor.setUsage(THREE.DynamicDrawUsage);

    // Ковёр ягеля — второй такой же, только в борах вместо травы
    this.nearMoss = new THREE.InstancedMesh(GEO.moss, MAT.moss, n);
    this.nearMoss.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.nearMoss.instanceColor =
      new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
    this.nearMoss.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.nearMoss.frustumCulled = false;
    this.nearMoss.count = 0;
    this.nearMoss.receiveShadow = true;
    this.scene.add(this.nearMoss);

    // Ковёр клевера. Земля в игре — ровная зелёная заливка, и именно
    // клевер под ногами превращает её в лесную подстилку. Коврик стоит
    // четыре-пять треугольников, так что слой почти бесплатный; форм
    // три, и меш на каждую, иначе повтор бьёт в глаза.
    this.nearClover = [];
    const cg = GEO.kitClover;
    if (cg) {
      const cap = Math.ceil(n * 0.3);
      for (const g of cg) {
        const im = new THREE.InstancedMesh(g, MAT.kitGrass, cap);
        im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        im.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
        im.instanceColor.setUsage(THREE.DynamicDrawUsage);
        im.frustumCulled = false;
        im.count = 0;
        im.receiveShadow = true;
        this.scene.add(im);
        this.nearClover.push(im);
      }
    }
    this.nearGrass.frustumCulled = false;
    this.nearGrass.count = 0;
    this.scene.add(this.nearGrass);
    this._ngX = 1e9; this._ngZ = 1e9;
    this._ngM = new THREE.Matrix4();
    this._ngQ = new THREE.Quaternion();
    this._ngV = new THREE.Vector3();
    this._ngS = new THREE.Vector3();
    this._ngC = new THREE.Color();
    this._ngAxis = new THREE.Vector3(0, 1, 0);
    this._ngTilt = new THREE.Euler();
  }

  /**
   * Карта проплешин: где стоит гриб, трава не растёт. Каждый гриб
   * попадает максимум в четыре метровых ячейки, поэтому травинке
   * достаточно одного поиска по своей ячейке.
   */
  /**
   * Клетки вокруг грибов, где траву рисовать нельзя.
   *
   * Считается каждые два метра хода, и важна тут не скорость, а мусор.
   * Строковый ключ вида "12,34" на каждую клетку ковра давал три
   * тысячи временных строк за пересборку; сборщик мусора потом ронял
   * кадр на сотню миллисекунд — при ходьбе это читалось как дёрганье.
   * Ключ теперь числовой, Map и массивы переиспользуются.
   */
  _bareSpots(px, pz, R) {
    const map = this._bareMap || (this._bareMap = new Map());
    const pool = this._barePool || (this._barePool = []);
    map.clear();
    let used = 0;
    const CLR = 0.42;
    for (const ch of this.chunks.values()) {
      if (!ch.built || !ch.group.visible) continue;
      const gx = ch.group.position.x, gz = ch.group.position.z;
      for (const m of ch.mushrooms) {
        if (m.picked) continue;
        const wx = gx + m.mesh.position.x, wz = gz + m.mesh.position.z;
        if (Math.abs(wx - px) > R + 1 || Math.abs(wz - pz) > R + 1) continue;
        for (let ix = Math.floor(wx - CLR); ix <= Math.floor(wx + CLR); ix++) {
          for (let iz = Math.floor(wz - CLR); iz <= Math.floor(wz + CLR); iz++) {
            const key = (ix & 2047) * 2048 + (iz & 2047);
            let arr = map.get(key);
            if (!arr) {
              arr = pool[used] || (pool[used] = []);
              arr.length = 0;
              used++;
              map.set(key, arr);
            }
            arr.push(wx, wz);
          }
        }
      }
    }
    return map;
  }

  _updateNearGrass(px, pz) {
    if (Math.hypot(px - this._ngX, pz - this._ngZ) < 2) return;
    this._ngX = px; this._ngZ = pz;
    const R = this.ngR, R2 = R * R;
    const bare = this._bareSpots(px, pz, R);
    const im = this.nearGrass;
    const mo = this.nearMoss;
    const m4 = this._ngM, q = this._ngQ, v = this._ngV, sc = this._ngS, col = this._ngC;
    const i0 = Math.floor(px - R), i1 = Math.ceil(px + R);
    const j0 = Math.floor(pz - R), j1 = Math.ceil(pz + R);
    let k = 0, mk = 0;
    const max = im.instanceMatrix.count;
    const GT = GEO.kitGrass ? KIT_GRASS_TINT : [1, 1, 1];
    const clov = this.nearClover;
    const nClov = clov.length;
    const ck = this._ngCk || (this._ngCk = []);
    for (let c = 0; c < nClov; c++) ck[c] = 0;
    const cMax = nClov ? clov[0].instanceMatrix.count : 0;
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const dx = i - px, dz = j - pz;
        if (dx * dx + dz * dz > R2) continue;
        if (k >= max) break;
        // детерминированный «шум» по координатам ячейки
        const h = ((i * 73856093) ^ (j * 19349663)) >>> 0;
        const r1 = (h & 1023) / 1023;
        const r2 = ((h >>> 10) & 1023) / 1023;
        const r3 = ((h >>> 20) & 1023) / 1023;
        const wx = i + r1, wz = j + r2;
        if (isWater(wx, wz)) continue;
        // [плешивость, высота, красный, зелёный, синий]
        // В бору вместо травы сплошной ягель: низкий, густой и белёсый.
        const biome = forestType(wx, wz);
        const B = NG_BIOME[biome];

        // Клевер кладётся до проверки на проплешины: там, где травы
        // нет, голая земля видна сильнее всего, и коврик её как раз
        // закрывает. Свой хеш — иначе клевер сядет ровно под траву.
        if (nClov && B[5] > 0) {
          const h2 = ((i * 83492791) ^ (j * 28613039)) >>> 0;
          const c1 = (h2 & 1023) / 1023;
          if (c1 < B[5]) {
            const c2 = ((h2 >>> 10) & 1023) / 1023;
            const c3 = ((h2 >>> 20) & 1023) / 1023;
            const ci = (c2 * nClov) | 0;
            const cm = clov[ci];
            if (ck[ci] < cMax) {
              const cs = 0.7 + c3 * 0.7;
              q.setFromAxisAngle(this._ngAxis, c2 * TAU);
              // чуть над землёй: коврик плоский, и на одном уровне с
              // грунтом он мерцает от борьбы за глубину
              v.set(wx, terrainHeight(wx, wz) + 0.015, wz);
              sc.set(cs, 1, cs);
              cm.setMatrixAt(ck[ci], m4.compose(v, q, sc));
              const cj = 0.72 + c3 * 0.45;
              cm.setColorAt(ck[ci], col.setRGB(cj * B[2] * 0.9, cj * B[3], cj * B[4] * 0.8));
              ck[ci]++;
            }
          }
        }

        if (r3 < B[0]) continue;                       // проплешины
        // не заслоняем грибы
        const spots = bare.get((i & 2047) * 2048 + (j & 2047));
        if (spots) {
          let blocked = false;
          for (let k = 0; k < spots.length; k += 2) {
            const dx2 = wx - spots[k], dz2 = wz - spots[k + 1];
            if (dx2 * dx2 + dz2 * dz2 < 0.1764) { blocked = true; break; }
          }
          if (blocked) continue;
        }
        const wet = moisture(wx, wz);
        const s = (wet < 0.34 ? 1.3 : 0.95) * (0.65 + r3 * 0.8) * B[1];
        q.setFromAxisAngle(this._ngAxis, r1 * TAU);
        v.set(wx, terrainHeight(wx, wz) - 0.03, wz);
        sc.set(s, s, s);
        const jj = 0.7 + r2 * 0.6;

        if (biome === FOREST.BOR) {
          // В бору землю кроет ягель, а не трава. Подушки лежат НА
          // земле и перекрывают друг друга: травинку можно утопить,
          // а редкие плоские комки читаются клочками бумаги, а не мхом.
          // Подушки поменьше и погуще: одна большая читалась предметом,
          // а ягель — это сплошной ковёр, из которого торчат сосны.
          // Подушки должны смыкаться: ягель — сплошной ковёр, из
          // которого торчат сосны, а не разложенные по траве камни.
          // При шаге сетки в метр диаметр меньше метра оставляет между
          // ними зелёные проплешины.
          // Пятна должны перекрываться: при шаге сетки в метр пятно
          // меньше метра оставляет между собой зелёные проплешины, и
          // ковёр рассыпается на отдельные кляксы.
          const sm = 1.15 + r3 * 0.75;
          v.y = terrainHeight(wx, wz) + 0.02;
          sc.set(sm, 1, sm);
          // Завал набок убран: он показывал плоскую изнанку и добивал
          // сходство с бумагой. Достаточно поворота вокруг вертикали.
          q.setFromAxisAngle(this._ngAxis, r1 * TAU);
          mo.setMatrixAt(mk, m4.compose(v, q, sc));
          // Не белый лист, а бледная серо-зелёная губка. Чистый белый в
          // солнце выбивался в пересвет и слепил сильнее снега.
          // Бор-беломошник и правда белёсый, но в полном солнце чистый
          // белый выбивался в пересвет и слепил сильнее снега.
          const g0 = 0.60 + r2 * 0.24;
          mo.setColorAt(mk, col.setRGB(g0 * 0.97, g0, g0 * 0.84));
          mk++;
          continue;
        }

        im.setMatrixAt(k, m4.compose(v, q, sc));
        im.setColorAt(k, col.setRGB(
          jj * B[2] * GT[0], jj * (0.95 + r1 * 0.12) * B[3] * GT[1], jj * 0.82 * B[4] * GT[2]));
        k++;
      }
    }
    for (let c = 0; c < nClov; c++) {
      const cm = clov[c];
      cm.count = ck[c];
      cm.instanceMatrix.needsUpdate = true;
      cm.instanceColor.needsUpdate = true;
    }
    im.count = k;
    im.instanceMatrix.needsUpdate = true;
    im.instanceColor.needsUpdate = true;
    mo.count = mk;
    mo.instanceMatrix.needsUpdate = true;
    mo.instanceColor.needsUpdate = true;
  }

  _buildSky() {
    const geo = new THREE.SphereGeometry(600, 24, 16);
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        top: { value: new THREE.Color(0x4a86c4) },
        bottom: { value: new THREE.Color(0xcfd8c8) },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunCol: { value: new THREE.Color(0xffe6b0) },
        night: { value: 0 },
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: `
        uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol;
        uniform float night;
        varying vec3 vP;
        void main(){
          vec3 d = normalize(vP);
          float t = clamp(d.y * 1.15 + 0.12, 0.0, 1.0);
          vec3 col = mix(bottom, top, pow(t, 0.72));
          float s = max(0.0, dot(d, normalize(sunDir)));
          col += sunCol * pow(s, 22.0) * 1.5;
          col += sunCol * pow(s, 4.0) * 0.18;

          // звёзды: хеш по направлению, проступают только к ночи
          if (night > 0.01 && d.y > 0.0) {
            vec3 cell = floor(d * 260.0);
            float h = fract(sin(dot(cell, vec3(12.9898, 78.233, 45.164))) * 43758.5453);
            float star = smoothstep(0.9972, 1.0, h);
            col += vec3(star) * night * smoothstep(0.0, 0.35, d.y) * 1.4;
          }
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xfff0d0, 1.5);
    if (CONFIG.quality !== 'low') {
      this.sun.castShadow = true;
      this.sun.shadow.mapSize.set(1280, 1280);
      // Тесная теневая камера вокруг игрока: на километр карты теней
      // не напасёшься, а дальше 50 м их всё равно съедает туман.
      const d = 52;
      const c = this.sun.shadow.camera;
      c.left = -d; c.right = d; c.top = d; c.bottom = -d;
      c.near = 60; c.far = 460;
      this.sun.shadow.bias = -0.0006;
      this.sun.shadow.normalBias = 0.08;
    }
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    /* Пул «светлячков».
       Три лампы на всю сцену, всегда включённые в граф. Каждый кадр
       они переезжают к ближайшим светящимся объектам — грибам и
       находкам. Раньше лампа была у каждого объекта и гасла по
       дистанции; three на смену числа источников пересобирает ВСЕ
       шейдеры сцены, и это давало рывки на ровном месте. */
    this.glowLights = [];
    this._glowClaims = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 6, 2);
      l.position.set(0, -50, 0);
      this.root.add(l);
      this.glowLights.push(l);
    }

    // Костёр горит во всех четырёх пунктах, но игрок всегда рядом
    // максимум с одним: одна лампа переезжает к ближайшему.
    this.campLight = new THREE.PointLight(0xff8830, 0, 16, 2);
    this.root.add(this.campLight);

    this.hemi = new THREE.HemisphereLight(0x9fc0e8, 0x3a4426, 0.72);
    // Цвет солнца пересчитывается каждый кадр с нуля, а полусферный —
    // нет. Держим исходный отдельно, иначе подмешанный красный
    // накапливался бы и оставался в лесу навсегда.
    this.hemiBase = this.hemi.color.clone();
    this.scene.add(this.hemi);
    this.ambient = new THREE.AmbientLight(0xffffff, 0.22);
    this.scene.add(this.ambient);
  }

  _buildMidges() {
    const n = 260;
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3);
    // кольцом вокруг игрока: если посадить мошку вплотную к камере,
    // спрайт растягивается на пол-экрана серым квадратом
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const r = 5 + Math.sqrt(Math.random()) * 19;
      p[i * 3] = Math.cos(a) * r;
      p[i * 3 + 1] = 0.35 + Math.random() * 2.4;
      p[i * 3 + 2] = Math.sin(a) * r;
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    this.midges = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xfff0c0, size: 0.055, transparent: true, opacity: 0.45,
      sizeAttenuation: true, depthWrite: false,
    }));
    this.midges.frustumCulled = false;
    this.scene.add(this.midges);
  }

  /** Время суток 0..1 → свет, туман, небо. */
  updateDaylight(t, scene) {
    // утро (0) → полдень (0.42) → закат (0.85) → сумерки (1)
    const elev = Math.sin(Math.PI * clamp(t * 0.78 + 0.19, 0, 1));
    const az = -0.6 + t * 2.3;
    this.sun.position.set(Math.cos(az) * 260 * (1 - elev * 0.2), 40 + elev * 300, Math.sin(az) * 200);
    const sd = this.sun.position.clone().normalize();
    this.skyMat.uniforms.sunDir.value.copy(sd);

    const warm = new THREE.Color(0xffb060);
    const day = new THREE.Color(0xfff2d6);
    const dusk = new THREE.Color(0x6a5a7a);
    const k = clamp(elev * 1.5, 0, 1);
    const sunCol = t > 0.78
      ? warm.clone().lerp(dusk, clamp((t - 0.78) / 0.22, 0, 1))
      : warm.clone().lerp(day, k);

    this.sun.color.copy(sunCol);
    this.sun.intensity = 0.6 + elev * 1.5;
    this.skyMat.uniforms.sunCol.value.copy(sunCol);

    const topDay = new THREE.Color(0x4a86c4), topDusk = new THREE.Color(0x2a2c50);
    const botDay = new THREE.Color(0xd6dcc8), botDusk = new THREE.Color(0x8a6a58);
    const dl = clamp((t - 0.7) / 0.3, 0, 1);
    const nt = clamp((t - 0.8) / 0.2, 0, 1);
    this.skyMat.uniforms.top.value.copy(topDay).lerp(topDusk, dl)
      .lerp(new THREE.Color(0x070a18), nt);
    this.skyMat.uniforms.bottom.value.copy(botDay).lerp(botDusk, dl)
      .lerp(new THREE.Color(0x141020), nt);

    this.hemi.intensity = 1.15 - dl * 0.55;
    this.ambient.intensity = 0.42 - dl * 0.16;

    // Последняя пятая часть дня — настоящая темнота, иначе фонарь
    // не имеет смысла: и так всё видно.
    const night = clamp((t - 0.8) / 0.2, 0, 1);
    this.night = night;
    if (night > 0) {
      const k = 1 - night * 0.94;
      this.sun.intensity *= k;
      this.hemi.intensity *= 1 - night * 0.86;
      this.ambient.intensity *= 1 - night * 0.8;
    }
    this.skyMat.uniforms.night.value = night;

    const fogDay = new THREE.Color(0xa8b8a0), fogDusk = new THREE.Color(0x4a4258);
    scene.fog.color.copy(fogDay).lerp(fogDusk, dl);
    // в дождь и туман видно заметно хуже
    const wf = (this.fogBoost || 0);
    scene.fog.near = (CONFIG.fogNear - dl * 18) * (1 - wf * 0.7);
    scene.fog.far = (CONFIG.fogFar - dl * 75) * (1 - wf * 0.62);
    if (wf > 0.01) {
      const grey = new THREE.Color(0x9aa8b0);
      scene.fog.color.lerp(grey, wf * 0.6);
      this.sun.intensity *= 1 - wf * 0.55;
      this.hemi.intensity *= 1 - wf * 0.2;
    }
    // Кровавое небо. Подмешивается последним, поверх времени суток и
    // погоды: сатанинский гриб должен перекрывать всё, в том числе
    // ясный полдень. Солнце при этом гасим — от красного света в
    // полную силу лес выглядит нарядно, а не тревожно.
    const bl = this.blood || 0;
    if (bl > 0.005) {
      const верх = new THREE.Color(0x4a0606), низ = new THREE.Color(0x8c1608);
      this.skyMat.uniforms.top.value.lerp(верх, bl * 0.92);
      this.skyMat.uniforms.bottom.value.lerp(низ, bl * 0.88);
      this.skyMat.uniforms.sunCol.value.lerp(new THREE.Color(0xff3a14), bl * 0.9);
      this.sun.color.lerp(new THREE.Color(0xff4a1e), bl * 0.85);
      this.sun.intensity *= 1 - bl * 0.45;
      this.hemi.color.copy(this.hemiBase).lerp(new THREE.Color(0xff5a30), bl * 0.7);
      this.hemi.intensity *= 1 - bl * 0.35;
      scene.fog.color.lerp(new THREE.Color(0x63110b), bl * 0.85);
      scene.fog.far *= 1 - bl * 0.3;          // горизонт придвигается
    } else if (this.hemiBase) {
      this.hemi.color.copy(this.hemiBase);
    }

    if (night > 0.01) {
      scene.fog.color.lerp(new THREE.Color(0x0a0e18), night * 0.9);
      scene.fog.far *= 1 - night * 0.45;
    }
    this.dusk = dl;
  }

  /** Перекладывает чанки и пункты вокруг игрока (зацикливание мира). */
  /** Небо наливается кровью на sec секунд. Повтор продлевает, а не складывает. */
  bloodSky(sec = 26) {
    this.bloodT = Math.max(this.bloodT, sec);
  }

  update(px, pz, dt, dayT, camera) {
    this.time += dt;
    // Наплыв быстрый, отпускает медленно: пугать надо резко, а
    // возвращать лес в норму — так, чтобы игрок этого не заметил.
    if (this.bloodT > 0) this.bloodT -= dt;
    const мишень = this.bloodT > 0 ? 1 : 0;
    this.blood = dampTo(this.blood, мишень, мишень ? 0.28 : 2.6, dt);
    windUniform.value = this.time * (1 + (this.windBoost || 0) * 1.6);

    const viewR = CONFIG.viewChunks;

    for (const ch of this.chunks.values()) {
      // ближайшее зацикленное смещение чанка относительно игрока
      const ox = px + wrapDelta(ch.baseX - px);
      const oz = pz + wrapDelta(ch.baseZ - pz);
      // дистанция в чанках по тору
      const ddx = Math.abs(wrapDelta(ch.baseX + CS / 2 - px)) / CS;
      const ddz = Math.abs(wrapDelta(ch.baseZ + CS / 2 - pz)) / CS;
      const near = ddx <= viewR + 0.5 && ddz <= viewR + 0.5;
      if (near && !ch.built) ch.build();
      ch.group.visible = near;
      if (near) ch.group.position.set(ox, 0, oz);
    }

    let nearestCamp = Infinity;
    for (const { g, camp } of this.campGroups) {
      const ox = px + wrapDelta(camp.x - px);
      const oz = pz + wrapDelta(camp.z - pz);
      g.position.set(ox, terrainHeight(camp.x, camp.z), oz);
      // Скупщик стоит во всех четырёх пунктах, но модель тяжёлая:
      // показываем только того, к кому реально можно подойти.
      const dCamp = Math.hypot(ox - px, oz - pz);
      if (g.userData.buyer) g.userData.buyer.visible = dCamp < 120;
      if (g.userData.props) {
        const near = dCamp < 165;
        for (const o of g.userData.props) o.visible = near;
      }

      const f = g.userData.flame;
      if (f) {
        const s = 0.82 + Math.sin(this.time * 11) * 0.12 + Math.sin(this.time * 23) * 0.07;
        f.scale.set(s, 1 / s, s);
        if (dCamp < nearestCamp) {
          nearestCamp = dCamp;
          this.campLight.position.set(ox + 2.6, terrainHeight(camp.x, camp.z) + 1.1, oz + 1.6);
        }
      }
    }

    this.campLight.intensity = nearestCamp < 60
      ? 2.2 + Math.sin(this.time * 13) * 0.6 : 0;

    this._updateWeather(dt, px, pz);
    this._updateNearGrass(px, pz);

    // мошкара следует за игроком, а к ночи становится светлячками
    this.midges.position.set(px, terrainHeight(px, pz), pz);
    this.midges.rotation.y = this.time * 0.06;
    const nt = this.night || 0;
    const mm = this.midges.material;
    mm.size = 0.055 + nt * 0.075;
    mm.opacity = 0.45 + nt * 0.5;
    mm.color.setRGB(1, 0.94 - nt * 0.1, 0.75 - nt * 0.45);

    if (this.sky) this.sky.position.set(px, 0, pz);
    this.sun.target.position.set(px, 0, pz);
    this.sun.target.updateMatrixWorld();
    this.sun.position.x += px;
    this.sun.position.z += pz;
  }

  /**
   * Попросить света для точки. Заявки собираются за кадр, ближайшие
   * получают лампы из пула, остальные обходятся. Вызывать можно
   * сколько угодно раз: лампы в сцене от этого не прибавляется.
   */
  requestGlow(x, y, z, color, intensity, d2) {
    this._glowClaims.push({ x, y, z, color, intensity, d2 });
  }

  /** Раздать пул ближайшим заявкам. Вызывается в конце кадра. */
  applyGlow() {
    const c = this._glowClaims;
    if (c.length > 1) c.sort((a, b) => a.d2 - b.d2);
    for (let i = 0; i < this.glowLights.length; i++) {
      const l = this.glowLights[i];
      const q = c[i];
      if (q) {
        l.position.set(q.x, q.y, q.z);
        l.color.setHex(q.color);
        l.intensity = q.intensity;
      } else {
        l.intensity = 0;
      }
    }
    c.length = 0;
  }

  /** Видимость грибов по дистанции + возврат ближайшего в прицеле. */
  updateMushrooms(px, pz, dt) {
    const showR = 48, showR2 = showR * showR;
    for (const ch of this.chunks.values()) {
      if (!ch.built || !ch.group.visible) continue;
      const gx = ch.group.position.x, gz = ch.group.position.z;
      // чанк целиком дальше радиуса показа — не трогаем его грибы вообще
      const ccx = gx + CS / 2 - px, ccz = gz + CS / 2 - pz;
      const far = Math.hypot(ccx, ccz) > showR + CS * 0.75;
      ch.mushGroup.visible = !far;
      if (far) continue;
      for (const m of ch.mushrooms) {
        if (m.picked) {
          m.respawn -= dt;
          if (m.respawn <= 0) {
            m.picked = false;
            m.mesh.scale.setScalar(1);
          } else continue;
        }
        const dx = gx + m.mesh.position.x - px;
        const dz = gz + m.mesh.position.z - pz;
        const d2 = dx * dx + dz * dz;
        const vis = d2 < showR2;
        m.mesh.visible = vis;
        // «грибное чутьё»: близкие грибы чуть светятся, иначе трава их прячет
        if (vis) m.mesh.material = d2 < 256 ? MAT_MUSHROOM_NEAR : MAT_MUSHROOM;
        if (m.glow && vis && d2 < 900) {
          this.requestGlow(gx + m.mesh.position.x, m.mesh.position.y + 0.3,
            gz + m.mesh.position.z, m.glow, 1.1, d2);
        }
      }
    }
  }

  /** Ближайший несобранный гриб в конусе взгляда. */
  findTarget(camera, px, pz, range) {
    const fwd = new THREE.Vector3();
    camera.getWorldDirection(fwd);
    const cam = camera.position;
    let best = null, bestScore = -1;
    for (const ch of this.chunks.values()) {
      if (!ch.built || !ch.group.visible) continue;
      const gx = ch.group.position.x, gz = ch.group.position.z;
      for (const m of ch.mushrooms) {
        if (m.picked || !m.mesh.visible) continue;
        const wx = gx + m.mesh.position.x;
        const wz = gz + m.mesh.position.z;
        const dx = wx - cam.x, dz = wz - cam.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > range * range) continue;
        const dy = m.y + 0.12 - cam.y;
        const len = Math.sqrt(d2 + dy * dy);
        const dot = (dx * fwd.x + dy * fwd.y + dz * fwd.z) / (len || 1);
        if (dot < 0.72) continue;
        const score = dot * 2.2 - len * 0.12;
        if (score > bestScore) { bestScore = score; best = m; }
      }
    }
    return best;
  }

  pick(m) {
    m.picked = true;
    // в дождь грибы лезут заметно бодрее
    m.respawn = (34 + Math.random() * 46) * (1 - (this.wet || 0) * 0.45);
    m.mesh.scale.setScalar(0.0001);
  }

  /** Простая коллизия со стволами: выталкивает точку из круга ствола. */
  resolveTrees(x, z, radius) {
    let nx = x, nz = z;
    for (const ch of this.chunks.values()) {
      if (!ch.built || !ch.group.visible) continue;
      const gx = ch.group.position.x, gz = ch.group.position.z;
      const c = ch.treeCols;
      for (let i = 0; i < c.length; i += 3) {
        const tx = gx + c[i], tz = gz + c[i + 1], tr = c[i + 2] + radius;
        const dx = nx - tx, dz = nz - tz;
        const d2 = dx * dx + dz * dz;
        if (d2 < tr * tr && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          nx = tx + (dx / d) * tr;
          nz = tz + (dz / d) * tr;
        }
      }
    }
    return [nx, nz];
  }

  nearestCamp(px, pz) {
    let best = null, bd = 1e9;
    for (const c of CAMPS) {
      const dx = wrapDelta(c.x - px), dz = wrapDelta(c.z - pz);
      const d = Math.hypot(dx, dz);
      if (d < bd) { bd = d; best = c; }
    }
    return { camp: best, dist: bd };
  }
}
