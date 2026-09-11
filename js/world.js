import * as THREE from 'three';
import { mergeParts } from './geo.js';
import { CONFIG } from './config.js';
import {
  WS, TAU, rng, terrainHeight, terrainSlope, moisture, isWater, WATER_LEVEL,
  wrapDelta, wrapCoord, clamp, lerp,
} from './utils.js';
import {
  generateChunkMushrooms, getMushroomGeometry, MAT_MUSHROOM, MAT_MUSHROOM_HL,
} from './mushrooms.js';

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

const MAT = {
  ground: new THREE.MeshLambertMaterial({ vertexColors: true }),
  tree: new THREE.MeshLambertMaterial({ vertexColors: true }),
  grass: addWind(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), 0.42, 0.02),
  bush: addWind(new THREE.MeshLambertMaterial({ vertexColors: true }), 0.06, 0.25),
  rock: new THREE.MeshLambertMaterial({ vertexColors: true }),
  prop: new THREE.MeshLambertMaterial({ vertexColors: true }),
  water: new THREE.MeshLambertMaterial({
    color: 0x2d4a52, transparent: true, opacity: 0.82, emissive: 0x081418,
  }),
  beam: new THREE.MeshBasicMaterial({
    color: 0xffc247, transparent: true, opacity: 0.22, depthWrite: false,
    blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false,
  }),
};
addWind(MAT.tree, 0.012, 2.2);

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

function buildPine() {
  const p = [];
  const h = 13;
  const tr = new THREE.CylinderGeometry(0.22, 0.42, h, 7);
  tr.translate(0, h / 2, 0);
  p.push(paint(tr, 0x6b4726, 0.18));
  for (let i = 0; i < 3; i++) {
    const y = h * (0.58 + i * 0.16);
    const r = 2.5 - i * 0.65;
    const c = new THREE.ConeGeometry(r, 3.6 - i * 0.5, 8);
    c.translate(0, y + 1.2, 0);
    p.push(paint(c, i === 2 ? 0x3c5c2e : 0x2f4a24, 0.16));
  }
  return mergeParts(p);
}

function buildSpruce() {
  const p = [];
  const h = 16;
  const tr = new THREE.CylinderGeometry(0.18, 0.4, h * 0.55, 6);
  tr.translate(0, h * 0.275, 0);
  p.push(paint(tr, 0x4d3520, 0.15));
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const c = new THREE.ConeGeometry(3.1 - t * 2.35, 4.2 - t * 1.1, 9);
    c.translate(0, 2.2 + t * 11.4, 0);
    p.push(paint(c, 0x1f3a1c + i * 0x000502, 0.2));
  }
  return mergeParts(p);
}

function buildBirch() {
  const p = [];
  const h = 12.5;
  const tr = new THREE.CylinderGeometry(0.17, 0.26, h, 7);
  tr.translate(0, h / 2, 0);
  p.push(paint(tr, 0xe6e2d6, 0.07));
  // чёрные штрихи на стволе
  for (let i = 0; i < 9; i++) {
    const a = Math.random() * TAU;
    const y = 1 + Math.random() * (h - 3);
    const d = new THREE.BoxGeometry(0.1, 0.055, 0.3);
    d.translate(Math.cos(a) * 0.23, y, Math.sin(a) * 0.23);
    d.rotateY(-a);
    p.push(paint(d, 0x2a2622));
  }
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.4;
    const r = 1.5 + Math.random() * 0.7;
    const s = new THREE.IcosahedronGeometry(r, 0);
    s.scale(1, 0.85, 1);
    s.translate(Math.cos(a) * 1.1, h * (0.78 + Math.random() * 0.2), Math.sin(a) * 1.1);
    p.push(paint(s, 0x5c7a2c, 0.24));
  }
  const top = new THREE.IcosahedronGeometry(1.8, 0);
  top.translate(0, h * 1.02, 0);
  p.push(paint(top, 0x53712a, 0.2));
  return mergeParts(p);
}

function buildAspen() {
  const p = [];
  const h = 11;
  const tr = new THREE.CylinderGeometry(0.16, 0.3, h, 6);
  tr.translate(0, h / 2, 0);
  p.push(paint(tr, 0x8e8e78, 0.12));
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * TAU;
    const s = new THREE.IcosahedronGeometry(1.3 + Math.random() * 0.8, 0);
    s.translate(Math.cos(a) * 1.2, h * (0.72 + Math.random() * 0.3), Math.sin(a) * 1.2);
    p.push(paint(s, 0x7b8a2a, 0.28));
  }
  return mergeParts(p);
}

function buildGrassTuft() {
  const p = [];
  const n = 4;
  for (let i = 0; i < n; i++) {
    const h = 0.34 + Math.random() * 0.44;
    const w = 0.055 + Math.random() * 0.05;
    const g = new THREE.PlaneGeometry(w, h, 1, 2);
    const pos = g.attributes.position;
    // сужаем к верхушке и слегка выгибаем
    for (let v = 0; v < pos.count; v++) {
      const y = pos.getY(v);
      const t = (y + h / 2) / h;
      pos.setX(v, pos.getX(v) * (1 - t * 0.82));
      pos.setZ(v, t * t * 0.09);
    }
    g.translate(0, h / 2, 0);
    g.rotateY(Math.random() * TAU);
    g.translate((Math.random() - 0.5) * 0.22, 0, (Math.random() - 0.5) * 0.22);
    const dark = Math.random() < 0.35;
    p.push(paint(g, dark ? 0x3f5220 : 0x5c7328, 0.3));
  }
  return mergeParts(p);
}

function buildFern() {
  const p = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const g = new THREE.PlaneGeometry(0.16, 0.85, 1, 3);
    const pos = g.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const t = (pos.getY(v) + 0.425) / 0.85;
      pos.setX(v, pos.getX(v) * (1 - t * 0.6));
      pos.setY(v, pos.getY(v) * 0.8 + 0.34);
      pos.setZ(v, t * t * 0.42);
    }
    g.rotateY(a);
    p.push(paint(g, 0x35541f, 0.28));
  }
  return mergeParts(p);
}

function buildBush() {
  const p = [];
  for (let i = 0; i < 4; i++) {
    const r = 0.5 + Math.random() * 0.45;
    const s = new THREE.IcosahedronGeometry(r, 0);
    s.scale(1, 0.72, 1);
    s.translate((Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 0.35, (Math.random() - 0.5) * 0.8);
    p.push(paint(s, 0x2f4a1e, 0.3));
  }
  return mergeParts(p);
}

function buildRock() {
  const g = new THREE.DodecahedronGeometry(0.6, 0);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    pos.setXYZ(i,
      pos.getX(i) * (0.7 + Math.random() * 0.6),
      pos.getY(i) * (0.45 + Math.random() * 0.4),
      pos.getZ(i) * (0.7 + Math.random() * 0.6));
  }
  g.computeVertexNormals();
  return paint(g, 0x6e6e68, 0.26);
}

function buildStump() {
  const p = [];
  const h = 0.55 + Math.random() * 0.35;
  const tr = new THREE.CylinderGeometry(0.42, 0.55, h, 9);
  tr.translate(0, h / 2, 0);
  p.push(paint(tr, 0x4f3a22, 0.16));
  const top = new THREE.CylinderGeometry(0.4, 0.42, 0.06, 9);
  top.translate(0, h, 0);
  p.push(paint(top, 0xa88a5c, 0.12));
  for (let i = 0; i < 3; i++) {
    const a = Math.random() * TAU;
    const rt = new THREE.CylinderGeometry(0.1, 0.18, 0.9, 5);
    rt.rotateZ(1.25);
    rt.rotateY(a);
    rt.translate(Math.cos(a) * 0.5, 0.1, Math.sin(a) * 0.5);
    p.push(paint(rt, 0x4a3620, 0.15));
  }
  return mergeParts(p);
}

function buildLog() {
  const p = [];
  const len = 3.5 + Math.random() * 2.5;
  const l = new THREE.CylinderGeometry(0.33, 0.38, len, 8);
  l.rotateZ(Math.PI / 2);
  l.translate(0, 0.34, 0);
  p.push(paint(l, 0x55401f, 0.18));
  const m = new THREE.CylinderGeometry(0.35, 0.35, len * 0.7, 8, 1, true, 0, Math.PI);
  m.rotateZ(Math.PI / 2);
  m.rotateX(-0.3);
  m.scale(1, 1.04, 1.04);
  m.translate(0, 0.34, 0);
  p.push(paint(m, 0x3f6024, 0.3));
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

export const TREE_TYPES = ['pine', 'spruce', 'birch', 'aspen'];

/* ============================================================
   Приёмный пункт: «Буханка», палатка, ящики, костёр, луч-маяк
   ============================================================ */
function buildCamp() {
  const g = new THREE.Group();
  const p = [];

  // УАЗ-«буханка»
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
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 1.15, 80, 10, 1, true), MAT.beam);
  beam.position.y = 40;
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
      if (h < WATER_LEVEL + 1.1) c.setHex(0x5a4b32);            // ил у воды
      else if (slope > 0.42) c.setHex(0x4e412b);                // склон, обнажённая земля
      else if (wet > 0.6) c.setHex(0x2f3d19);                   // сырой мох
      else if (wet < 0.32) c.setHex(0x6d7a36);                  // сухая поляна
      else c.setHex(0x435022);
      const j = 0.88 + rnd() * 0.26;
      colArr[i * 3] = c.r * j; colArr[i * 3 + 1] = c.g * j; colArr[i * 3 + 2] = c.b * j;
    }
    gg.setAttribute('color', new THREE.BufferAttribute(colArr, 3));
    gg.computeVertexNormals();
    const ground = new THREE.Mesh(gg, MAT.ground);
    ground.position.set(CS / 2, 0, CS / 2);
    ground.receiveShadow = false;
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
    for (const t of TREE_TYPES) {
      const list = byType[t];
      if (!list.length) continue;
      const im = new THREE.InstancedMesh(GEO[t], MAT.tree, list.length);
      im.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      for (let i = 0; i < list.length; i++) {
        const o = list[i];
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), o.rot);
        sc.set(o.s * (0.9 + rnd() * 0.2), o.s, o.s * (0.9 + rnd() * 0.2));
        v3.set(o.lx, o.y, o.lz);
        im.setMatrixAt(i, m4.compose(v3, q, sc));
        const j = 0.85 + rnd() * 0.3;
        im.setColorAt(i, tint.setRGB(j, j * (0.96 + rnd() * 0.08), j * 0.97));
      }
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.frustumCulled = false;
      g.add(im);
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
      im.frustumCulled = false;
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
      im.frustumCulled = false;
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
      im.frustumCulled = false;
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
    rim.frustumCulled = false;
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
    gim.frustumCulled = false;
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
        : terrainHeight(this.baseX + d.lx, this.baseZ + d.lz) - 0.015;
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

    this._buildSky();
    this._buildMidges();
    this._buildNearGrass();
  }

  /* ------------------------------------------------------------
     Ближняя трава. Чанковой плотности хватает только на дальний
     план, поэтому вокруг игрока держим отдельный «ковёр»: пучки
     привязаны к ячейкам мировой сетки 1×1 м, поэтому при ходьбе
     они стоят на месте, а не едут за камерой.
     ------------------------------------------------------------ */
  _buildNearGrass() {
    initGeometries();
    this.ngR = CONFIG.quality === 'low' ? 22 : 34;
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

  _updateNearGrass(px, pz) {
    if (Math.hypot(px - this._ngX, pz - this._ngZ) < 2) return;
    this._ngX = px; this._ngZ = pz;
    const R = this.ngR, R2 = R * R;
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
      },
      vertexShader: `varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);} `,
      fragmentShader: `
        uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol;
        varying vec3 vP;
        void main(){
          vec3 d = normalize(vP);
          float t = clamp(d.y * 1.15 + 0.12, 0.0, 1.0);
          vec3 col = mix(bottom, top, pow(t, 0.72));
          float s = max(0.0, dot(d, normalize(sunDir)));
          col += sunCol * pow(s, 22.0) * 1.5;
          col += sunCol * pow(s, 4.0) * 0.18;
          gl_FragColor = vec4(col, 1.0);
        }`,
      side: THREE.BackSide, depthWrite: false, fog: false,
    });
    this.sky = new THREE.Mesh(geo, this.skyMat);
    this.scene.add(this.sky);

    this.sun = new THREE.DirectionalLight(0xfff0d0, 1.5);
    this.scene.add(this.sun);
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
    this.skyMat.uniforms.top.value.copy(topDay).lerp(topDusk, dl);
    this.skyMat.uniforms.bottom.value.copy(botDay).lerp(botDusk, dl);

    this.hemi.intensity = 0.98 - dl * 0.5;
    this.ambient.intensity = 0.34 - dl * 0.14;

    const fogDay = new THREE.Color(0xa8b8a0), fogDusk = new THREE.Color(0x4a4258);
    scene.fog.color.copy(fogDay).lerp(fogDusk, dl);
    scene.fog.near = CONFIG.fogNear - dl * 18;
    scene.fog.far = CONFIG.fogFar - dl * 75;
    this.dusk = dl;
  }

  /** Перекладывает чанки и пункты вокруг игрока (зацикливание мира). */
  update(px, pz, dt, dayT, camera) {
    this.time += dt;
    windUniform.value = this.time;

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
      const f = g.userData.flame;
      if (f) {
        const s = 0.82 + Math.sin(this.time * 11) * 0.12 + Math.sin(this.time * 23) * 0.07;
        f.scale.set(s, 1 / s, s);
        g.userData.fireLight.intensity = 2.2 + Math.sin(this.time * 13) * 0.6;
      }
    }

    this._updateNearGrass(px, pz);

    // мошкара следует за игроком
    this.midges.position.set(px, terrainHeight(px, pz), pz);
    this.midges.rotation.y = this.time * 0.06;

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
        const vis = dx * dx + dz * dz < showR2;
        m.mesh.visible = vis;
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
    m.respawn = 34 + Math.random() * 46;
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
