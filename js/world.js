import * as THREE from 'three';
import { mergeParts } from './geo.js';
import { CONFIG } from './config.js';
import {
  WS, TAU, rng, terrainHeight, terrainSlope, moisture, isWater, WATER_LEVEL,
  wrapDelta, wrapCoord, clamp, lerp, dampTo, torusDist2,
} from './utils.js';
import {
  generateChunkMushrooms, getMushroomGeometry,
  MAT_MUSHROOM, MAT_MUSHROOM_NEAR, MAT_MUSHROOM_HL,
} from './mushrooms.js';
import {
  groundTex, barkTex, birchTex, grassTex, leafTex, needleTex,
  metalTex, woodTex, getEnvMap,
} from './textures.js';
import { onAsset, instance } from './assets.js';

const CS = CONFIG.chunkSize;
const GRID = Math.round(WS / CS);          // 8
export const CAMPS = [
  { x: 190, z: 210 }, { x: 690, z: 190 }, { x: 200, z: 690 }, { x: 700, z: 700 },
];

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

const GEO = {};
function initGeometries() {
  if (GEO.pine) return;
  GEO.pine = buildPine();
  GEO.spruce = buildSpruce();
  GEO.birch = buildBirch();
  GEO.aspen = buildAspen();
  GEO.grass = buildGrassTuft();
  GEO.fern = buildFern();
  GEO.bush = buildBush();
  GEO.rock = buildRock();
  GEO.stump = buildStump();
  GEO.log = buildLog();
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

function buildCamp() {
  const g = new THREE.Group();
  const p = [];

  // УАЗ — отдельным узлом: его подменяет скачанная модель
  const uaz = new THREE.Group();
  fillUaz(uaz);
  onAsset('uaz', () => fillUaz(uaz));
  g.add(uaz);

  // палатка-скупка
  const tent = new THREE.ConeGeometry(2.1, 2.0, 4);
  tent.rotateY(Math.PI / 4);
  tent.translate(-4.2, 1.0, 0);
  p.push(paint(tent, 0x7a5a30, 0.1));

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
  g.add(new THREE.Mesh(mergeParts(p), MAT.prop));

  // пламя
  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.3, 0.8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff9128, transparent: true, opacity: 0.92 })
  );
  flame.position.set(2.6, 0.7, 1.6);
  g.add(flame);
  g.userData.flame = flame;

  const fireLight = new THREE.PointLight(0xff8830, 2.4, 16, 2);
  fireLight.position.set(2.6, 1.1, 1.6);
  g.add(fireLight);
  g.userData.fireLight = fireLight;

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
      if (h < WATER_LEVEL + 1.1) c.setRGB(1.05, 0.9, 0.66);     // ил у воды
      else if (slope > 0.42) c.setRGB(1.0, 0.86, 0.62);         // склон, обнажённая земля
      else if (wet > 0.6) c.setRGB(0.72, 0.9, 0.62);            // сырой мох
      else if (wet < 0.32) c.setRGB(1.15, 1.1, 0.78);           // сухая поляна
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
      const wet = moisture(wx, wz);
      if (wet < 0.3 && rnd() < 0.72) continue;                  // поляны остаются открытыми
      if (terrainSlope(wx, wz) > 0.6) continue;
      // Вокруг приёмного пункта — поляна. Иначе ель вырастает прямо
      // в кузове «Буханки» и заслоняет весь лагерь.
      let atCamp = false;
      for (const cp of CAMPS) {
        if (torusDist2(wx, wz, cp.x, cp.z) < 12 * 12) { atCamp = true; break; }
      }
      if (atCamp) continue;
      let t;
      const r = rnd();
      if (wet > 0.62) t = r < 0.55 ? 'spruce' : r < 0.8 ? 'birch' : 'aspen';
      else if (wet < 0.42) t = r < 0.6 ? 'pine' : r < 0.85 ? 'birch' : 'aspen';
      else t = r < 0.34 ? 'pine' : r < 0.6 ? 'spruce' : r < 0.85 ? 'birch' : 'aspen';
      const s = 0.72 + rnd() * 0.62;
      byType[t].push({ lx, lz, y: terrainHeight(wx, wz), s, rot: rnd() * TAU });
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
      const list = byType[t];
      if (!list.length) continue;
      const mats = TREE_MAT[t];
      const pair = [
        { geo: GEO[t].trunk, mat: MAT[mats.trunk], shadow: true },
        { geo: GEO[t].foliage, mat: MAT[mats.foliage], shadow: true },
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
        g.add(im);
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
    const bushes = [], ferns = [];
    for (let i = 0; i < CONFIG.bushesPerChunk; i++) {
      const lx = rnd() * CS, lz = rnd() * CS;
      const wx = this.baseX + lx, wz = this.baseZ + lz;
      if (isWater(wx, wz)) continue;
      const o = { lx, lz, y: terrainHeight(wx, wz), s: 0.7 + rnd() * 0.8, rot: rnd() * TAU };
      (moisture(wx, wz) > 0.55 ? ferns : bushes).push(o);
    }
    for (const [list, geo, mat] of [[bushes, GEO.bush, MAT.bush], [ferns, GEO.fern, MAT.bush]]) {
      if (!list.length) continue;
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
    const gim = new THREE.InstancedMesh(GEO.grass, MAT.grass, gn);
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
      gim.setColorAt(used, tint.setRGB(j, j * (0.95 + rnd() * 0.12), j * 0.85));
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
      if (d.sp.glow) {
        const l = new THREE.PointLight(d.sp.glow, 1.1, 5, 2);
        l.position.set(d.lx, y + 0.3, d.lz);
        this.mushGroup.add(l);
        m.light = l;
      }
    }
  }
}

/* ============================================================
   Мир
   ============================================================ */
export class World {
  constructor(scene) {
    this.scene = scene;
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
    this.nearGrass = new THREE.InstancedMesh(GEO.grass, MAT.grass, n);
    this.nearGrass.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
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
  }

  /**
   * Карта проплешин: где стоит гриб, трава не растёт. Каждый гриб
   * попадает максимум в четыре метровых ячейки, поэтому травинке
   * достаточно одного поиска по своей ячейке.
   */
  _bareSpots(px, pz, R) {
    const map = new Map();
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
            const key = ix + ',' + iz;
            let arr = map.get(key);
            if (!arr) { arr = []; map.set(key, arr); }
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
    const m4 = this._ngM, q = this._ngQ, v = this._ngV, sc = this._ngS, col = this._ngC;
    const i0 = Math.floor(px - R), i1 = Math.ceil(px + R);
    const j0 = Math.floor(pz - R), j1 = Math.ceil(pz + R);
    let k = 0;
    const max = im.instanceMatrix.count;
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
        if (r3 < 0.22) continue;                       // проплешины
        const wx = i + r1, wz = j + r2;
        if (isWater(wx, wz)) continue;
        // не заслоняем грибы
        const spots = bare.get(i + ',' + j);
        if (spots) {
          let blocked = false;
          for (let k = 0; k < spots.length; k += 2) {
            const dx2 = wx - spots[k], dz2 = wz - spots[k + 1];
            if (dx2 * dx2 + dz2 * dz2 < 0.1764) { blocked = true; break; }
          }
          if (blocked) continue;
        }
        const wet = moisture(wx, wz);
        const s = (wet < 0.34 ? 1.3 : 0.95) * (0.65 + r3 * 0.8);
        q.setFromAxisAngle(this._ngAxis, r1 * TAU);
        v.set(wx, terrainHeight(wx, wz) - 0.03, wz);
        sc.set(s, s, s);
        im.setMatrixAt(k, m4.compose(v, q, sc));
        const jj = 0.7 + r2 * 0.6;
        im.setColorAt(k, col.setRGB(jj, jj * (0.95 + r1 * 0.12), jj * 0.82));
        k++;
      }
    }
    im.count = k;
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
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
    this.hemi = new THREE.HemisphereLight(0x9fc0e8, 0x3a4426, 0.72);
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
    if (night > 0.01) {
      scene.fog.color.lerp(new THREE.Color(0x0a0e18), night * 0.9);
      scene.fog.far *= 1 - night * 0.45;
    }
    this.dusk = dl;
  }

  /** Перекладывает чанки и пункты вокруг игрока (зацикливание мира). */
  update(px, pz, dt, dayT, camera) {
    this.time += dt;
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

    for (const { g, camp } of this.campGroups) {
      const ox = px + wrapDelta(camp.x - px);
      const oz = pz + wrapDelta(camp.z - pz);
      g.position.set(ox, terrainHeight(camp.x, camp.z), oz);
      // Скупщик стоит во всех четырёх пунктах, но модель тяжёлая:
      // показываем только того, к кому реально можно подойти.
      if (g.userData.buyer) {
        const d = Math.hypot(ox - px, oz - pz);
        g.userData.buyer.visible = d < 120;
      }

      const f = g.userData.flame;
      if (f) {
        const s = 0.82 + Math.sin(this.time * 11) * 0.12 + Math.sin(this.time * 23) * 0.07;
        f.scale.set(s, 1 / s, s);
        g.userData.fireLight.intensity = 2.2 + Math.sin(this.time * 13) * 0.6;
      }
    }

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
            if (m.light) m.light.visible = true;
          } else continue;
        }
        const dx = gx + m.mesh.position.x - px;
        const dz = gz + m.mesh.position.z - pz;
        const d2 = dx * dx + dz * dz;
        const vis = d2 < showR2;
        m.mesh.visible = vis;
        // «грибное чутьё»: близкие грибы чуть светятся, иначе трава их прячет
        if (vis) m.mesh.material = d2 < 256 ? MAT_MUSHROOM_NEAR : MAT_MUSHROOM;
        if (m.light) m.light.visible = vis && dx * dx + dz * dz < 900;
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
    if (m.light) m.light.visible = false;
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
