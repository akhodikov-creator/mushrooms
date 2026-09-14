import * as THREE from 'three';
import { mergeParts } from './geo.js';
import { CONTAINERS, ASSETS } from './config.js';
import { skinTex, clothTex, metalTex, woodTex } from './textures.js';
import { buildHandGeometry } from './handmesh.js';
import { onAsset, instance, poseHandBones } from './assets.js';
import { dampTo, clamp } from './utils.js';

/* ============================================================
   Тело от первого лица: ноги с обувью внизу кадра и левая рука
   с тарой. Всё висит на камере, поэтому едет вместе со взглядом.
   ============================================================ */

const MAT = {
  skin: new THREE.MeshStandardMaterial({
    map: skinTex(), roughness: 0.74, metalness: 0,
  }),
  cloth: new THREE.MeshStandardMaterial({
    vertexColors: true, map: clothTex(), roughness: 0.95, metalness: 0,
  }),
  nail: new THREE.MeshStandardMaterial({
    color: 0xdcb49e, roughness: 0.28, metalness: 0,
  }),
  rubber: new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.55, metalness: 0.05,
  }),
  leather: new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.72, metalness: 0.02,
  }),
  plastic: new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.35, metalness: 0.0,
    side: THREE.DoubleSide, transparent: true, opacity: 0.92,
  }),
  metal: new THREE.MeshStandardMaterial({
    vertexColors: true, map: metalTex(), roughness: 0.4, metalness: 0.75,
  }),
  wicker: new THREE.MeshStandardMaterial({
    vertexColors: true, map: woodTex(), roughness: 0.8, metalness: 0,
  }),
};

export function applyBodyEnv(env) {
  for (const m of Object.values(MAT)) {
    m.envMap = env;
    m.envMapIntensity = (m === MAT.metal) ? 1.1 : 0.4;
    m.needsUpdate = true;
  }
}

function paint(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}

function group(pairs) {
  const g = new THREE.Group();
  for (const [mat, parts] of pairs) {
    if (parts.length) g.add(new THREE.Mesh(mergeParts(parts), mat));
  }
  return g;
}

/* ------------------------------------------------------------
   Нога: штанина + ботинок или резиновый сапог
   ------------------------------------------------------------ */
function buildLeg(side, boots) {
  const cloth = [], shoe = [];
  // Отсчёт от глаз: бедро начинается на 0,72 м ниже, ступня — на 1,68 м.
  // Если этого не соблюсти, ноги выглядят обрубками.
  const HIP = -0.72, KNEE = -1.16, FOOT = -1.60;
  const x = side * 0.115;

  const thigh = new THREE.CylinderGeometry(0.086, 0.074, KNEE - HIP, 10);
  thigh.rotateX(0.18);
  thigh.translate(x, (HIP + KNEE) / 2, -0.015);
  cloth.push(paint(thigh, 0xb8bca8));

  const shin = new THREE.CylinderGeometry(0.072, 0.060, FOOT - KNEE, 10);
  shin.rotateX(-0.10);
  shin.translate(x, (KNEE + FOOT) / 2, -0.10);
  cloth.push(paint(shin, 0xa8ac98));

  if (boots) {
    // резиновый сапог: высокое голенище, раструб и рифлёная подошва
    const shaft = new THREE.CylinderGeometry(0.092, 0.084, 0.36, 12);
    shaft.rotateX(-0.06);
    shaft.translate(x, FOOT + 0.2, -0.115);
    shoe.push(paint(shaft, 0x2a3a40));
    const cuff = new THREE.CylinderGeometry(0.1, 0.092, 0.055, 12);
    cuff.rotateX(-0.06);
    cuff.translate(x, FOOT + 0.38, -0.125);
    shoe.push(paint(cuff, 0x3c5058));

  } else {
    // обычный кирзовый ботинок
    const boot = new THREE.CylinderGeometry(0.086, 0.08, 0.17, 10);
    boot.rotateX(-0.06);
    boot.translate(x, FOOT + 0.1, -0.105);
    shoe.push(paint(boot, 0x4a3a2a));

  }

  const g = group([[MAT.cloth, cloth], [boots ? MAT.rubber : MAT.leather, shoe]]);

  // Сама ступня — отдельным узлом: её подменяет скачанная модель, когда
  // догрузится. Модель одна на обе ноги, левая получается зеркалом.
  const node = new THREE.Group();
  node.position.set(x, FOOT - (boots ? 0.055 : 0.048), -0.225);
  node.scale.x = side;
  fillFoot(node, boots);
  onAsset('feet', () => fillFoot(node, boots));
  g.add(node);

  return g;
}

/** Наполняет узел ступни: внешняя модель или коробка с носком. */
function fillFoot(node, boots) {
  node.clear();
  const mat = boots ? MAT.rubber : MAT.leather;
  // Под кроной леса тёмная обувь сливается в кляксу — берём на пару
  // тонов светлее, чем красили коробку.
  const col = boots ? 0x35474f : 0x5c4630;

  const model = instance('feet');
  if (model) {
    model.traverse((o) => {
      if (!o.isMesh) return;
      // материалы обуви красятся вершинным цветом — у модели его нет
      paint(o.geometry, col);
      o.material = mat;
    });
    node.add(model);
    return;
  }

  const parts = [];
  const h = boots ? 0.095 : 0.09;
  const foot = new THREE.BoxGeometry(boots ? 0.12 : 0.11, h, boots ? 0.28 : 0.26, 2, 1, 3);
  foot.translate(0, h / 2 + 0.02, 0.01);
  parts.push(paint(foot, col));
  const toe = new THREE.SphereGeometry(boots ? 0.061 : 0.056, 10, 7);
  toe.scale(1, boots ? 0.72 : 0.76, boots ? 1.1 : 1.05);
  toe.translate(0, h / 2 + 0.015, -0.11);
  parts.push(paint(toe, col));
  const sole = new THREE.BoxGeometry(boots ? 0.13 : 0.118, 0.032, boots ? 0.31 : 0.28, 2, 1, 3);
  sole.translate(0, 0.016, 0.005);
  parts.push(paint(sole, boots ? 0x14181c : 0x1c1610));
  node.add(new THREE.Mesh(mergeParts(parts), mat));
}

/* ------------------------------------------------------------
   Тара в левой руке
   ------------------------------------------------------------ */
function buildContainer(model) {
  const plastic = [], metal = [], wicker = [];
  let gripY = 0;   // где у этой тары ручка — за неё и держит кулак

  if (model === 'bagS' || model === 'bagL') {
    const big = model === 'bagL';
    const w = big ? 0.15 : 0.11, h = big ? 0.2 : 0.15, d = big ? 0.09 : 0.07;
    // мятый пакет: коробка с продавленными боками
    const body = new THREE.BoxGeometry(w, h, d, 3, 4, 2);
    const pos = body.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = (y + h / 2) / h;
      const bulge = 0.72 + Math.sin(t * Math.PI) * 0.5;   // раздут снизу
      pos.setX(i, pos.getX(i) * bulge + (Math.random() - 0.5) * 0.012);
      pos.setZ(i, pos.getZ(i) * bulge + (Math.random() - 0.5) * 0.012);
    }
    body.computeVertexNormals();
    body.translate(0, -h / 2 - 0.03, 0);
    plastic.push(paint(body, big ? 0xd8e4ee : 0xe8eef4));
    // ручки
    for (const sx of [-1, 1]) {
      const hd = new THREE.TorusGeometry(w * 0.24, 0.007, 5, 10, Math.PI);
      hd.rotateY(Math.PI / 2);
      hd.translate(sx * w * 0.26, -0.022, 0);
      plastic.push(paint(hd, big ? 0xc4d4e2 : 0xdfe8f0));
    }
    gripY = -0.022 + w * 0.24;
  } else if (model === 'basket') {
    const r = 0.15;
    const body = new THREE.CylinderGeometry(r, r * 0.72, 0.19, 16, 3, true);
    body.translate(0, -0.125, 0);
    wicker.push(paint(body, 0xb08a4e));
    const bottom = new THREE.CylinderGeometry(r * 0.72, r * 0.72, 0.018, 16);
    bottom.translate(0, -0.215, 0);
    wicker.push(paint(bottom, 0x9a763e));
    const rim = new THREE.TorusGeometry(r, 0.013, 6, 18);
    rim.rotateX(Math.PI / 2);
    rim.translate(0, -0.03, 0);
    wicker.push(paint(rim, 0x8a6a34));
    const handle = new THREE.TorusGeometry(r * 0.94, 0.011, 5, 16, Math.PI);
    handle.rotateY(Math.PI / 2);
    handle.translate(0, -0.03, 0);
    wicker.push(paint(handle, 0x8a6a34));
    gripY = -0.03 + r * 0.94;
  } else {
    // вёдра: чем больше литраж, тем крупнее
    const size = { pail3: 0.105, pail5: 0.125, pail10: 0.155 }[model] || 0.12;
    const hgt = size * 1.5;
    const body = new THREE.CylinderGeometry(size, size * 0.78, hgt, 16, 2, true);
    body.translate(0, -hgt / 2 - 0.03, 0);
    const col = { pail3: 0xd8dce0, pail5: 0x4a7ac0, pail10: 0xc0503a }[model] || 0xd8dce0;
    metal.push(paint(body, col));
    const bottom = new THREE.CylinderGeometry(size * 0.78, size * 0.78, 0.016, 16);
    bottom.translate(0, -hgt - 0.03, 0);
    metal.push(paint(bottom, col));
    const rim = new THREE.TorusGeometry(size, 0.011, 6, 18);
    rim.rotateX(Math.PI / 2);
    rim.translate(0, -0.03, 0);
    metal.push(paint(rim, 0xb8bcc4));
    // дужка
    const bail = new THREE.TorusGeometry(size * 0.95, 0.008, 5, 16, Math.PI);
    bail.rotateY(Math.PI / 2);
    bail.translate(0, -0.03, 0);
    metal.push(paint(bail, 0x9aa0a8));
    gripY = -0.03 + size * 0.95;
  }

  const g = group([[MAT.plastic, plastic], [MAT.metal, metal], [MAT.wicker, wicker]]);
  g.userData.gripY = gripY;
  return g;
}

/* ------------------------------------------------------------
   Кисть левой руки, держащая тару за ручку.
   Модель общая с оружием — из handmesh.js.
   ------------------------------------------------------------ */
const HAND_GRIP = 0.03;

function buildLeftHand() {
  const g = new THREE.Group();

  // Кулак обхватывает то, что лежит вдоль его оси X, а ручка тары
  // как раз горизонтальная — доворачивать не нужно, только приподнять
  // кисть на высоту хвата.
  const m = new THREE.Matrix4().makeRotationX(0.35);
  m.premultiply(new THREE.Matrix4().makeTranslation(0, HAND_GRIP, 0.008));

  const node = new THREE.Group();
  node.matrixAutoUpdate = false;
  node.matrix.copy(m);
  fillLeftHand(node);
  onAsset('hands', () => fillLeftHand(node));
  g.add(node);

  // Предплечье уходит от кисти НАЗАД и чуть вниз — к локтю у бока.
  // Раньше оно торчало вверх и читалось как гриб на палке.
  const cloth = [];
  const A = 1.95;
  const dy = Math.cos(A), dz = Math.sin(A);
  // манжета садится на срез запястья: у модели он на 0,10 м от кисти,
  // и открытым его оставлять нельзя — он читается как плоский лоскут
  const cuff = new THREE.CylinderGeometry(0.040, 0.045, 0.055, 14);
  cuff.rotateX(A);
  cuff.translate(0.004, HAND_GRIP + dy * 0.10, dz * 0.10);
  cloth.push(paint(cuff, 0xffffff));
  const sleeve = new THREE.CylinderGeometry(0.044, 0.046, 0.10, 14);
  sleeve.rotateX(A);
  sleeve.translate(0.008, HAND_GRIP + dy * 0.163, dz * 0.163);
  cloth.push(paint(sleeve, 0xd8dcc8));
  g.add(new THREE.Mesh(mergeParts(cloth), MAT.cloth));

  return g;
}

/** Наполняет узел левой кисти: внешняя модель или процедурная. */
function fillLeftHand(node) {
  node.clear();
  const model = instance('hands');
  if (model) {
    const cfg = ASSETS.hands;
    // модель даёт одну конкретную руку; если пришла правая — зеркалим
    if ((cfg.side || 1) !== -1) model.scale.x *= -1;
    poseHandBones(model, cfg.fistCurl, cfg.bendAxis, cfg.bendSign);
    node.add(model);
    return;
  }
  const src = buildHandGeometry(-1, 'fist');
  node.add(new THREE.Mesh(src.skin, MAT.skin));
  node.add(new THREE.Mesh(src.nails, MAT.nail));
}

/* ============================================================ */
export class Body {
  constructor(camera) {
    this.camera = camera;
    this.root = new THREE.Group();
    camera.add(this.root);

    this.legsWrap = new THREE.Group();
    this.root.add(this.legsWrap);
    this.legs = { normal: null, boots: null };
    this.boots = false;

    this.armWrap = new THREE.Group();
    // Локоть у левого бока, поэтому предплечье должно уходить назад-влево.
    // При положительном довороте оно шло поперёк кадра и читалось бревном.
    this.armWrap.position.set(-0.30, -0.20, -0.70);
    this.armWrap.rotation.set(0.04, -0.26, -0.08);
    this.root.add(this.armWrap);

    this.hand = buildLeftHand();
    this.armWrap.add(this.hand);

    this.containerNode = new THREE.Group();
    this.containerNode.position.set(0, 0.012, 0);
    this.armWrap.add(this.containerNode);
    this.tier = -1;
    this.setContainer(0);

    this.bob = 0;
    this.legPhase = 0;
    this.lookDown = 0;
  }

  _ensureLegs(boots) {
    const key = boots ? 'boots' : 'normal';
    if (!this.legs[key]) {
      const g = new THREE.Group();
      g.add(buildLeg(-1, boots), buildLeg(1, boots));
      this.legs[key] = g;
      this.legsWrap.add(g);
    }
    for (const k of Object.keys(this.legs)) {
      if (this.legs[k]) this.legs[k].visible = (k === key);
    }
    return this.legs[key];
  }

  setBoots(on) {
    if (this.boots === on && this.legs.normal) return;
    this.boots = on;
    this._ensureLegs(on);
  }

  setContainer(tier) {
    if (this.tier === tier) return;
    this.tier = tier;
    this.containerNode.clear();
    // clear() выбросил и горку грибов — ссылку тоже надо сбросить,
    // иначе после апгрейда тары наполнение перестаёт показываться
    this.fillMesh = null;
    const def = CONTAINERS[tier];
    if (!def) return;
    const c = buildContainer(def.model);
    // ручка тары должна оказаться ровно в кулаке
    c.position.y = HAND_GRIP - (c.userData.gripY || 0);
    this.containerNode.add(c);
    this.current = c;
    this.containerBase = c.position.y;
  }

  /** Показывает, сколько набрано: грибы горкой в таре. */
  setFill(ratio) {
    this.fill = ratio;
    if (!this.fillMesh) {
      const g = new THREE.SphereGeometry(0.1, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      g.scale(1, 0.45, 1);
      this.fillMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({
        color: 0x9a6a3a, roughness: 0.85, metalness: 0,
      }));
      this.containerNode.add(this.fillMesh);
    }
    const def = CONTAINERS[this.tier];
    const isBag = def && (def.model === 'bagS' || def.model === 'bagL');
    const r = isBag ? 0.07 : def && def.model === 'basket' ? 0.13 : 0.1;
    this.fillMesh.visible = ratio > 0.02 && !isBag;
    this.fillMesh.scale.setScalar((r / 0.1) * (0.6 + ratio * 0.4));
    this.fillMesh.position.y = (this.containerBase || 0) - 0.035 - (1 - ratio) * 0.06;
  }

  update(dt, player, inv, weapons) {
    // Ноги висят на камере, но принадлежат телу: гасим наклон головы,
    // иначе они наклоняются вместе со взглядом и никогда не попадают
    // в кадр. Так они честно уходят вниз и видны, когда смотришь под ноги.
    this.legsWrap.rotation.x = -player.pitch;
    this.legsWrap.visible = player.pitch < -0.32;

    const sp = Math.min(1, (player.speed || 0) / 6);
    this.legPhase += dt * (player.speed || 0) * 1.5;

    const legs = this._ensureLegs(this.boots);
    if (legs && legs.children.length === 2) {
      // шаг: ноги качаются в противофазе
      legs.children[0].rotation.x = Math.sin(this.legPhase) * 0.5 * sp;
      legs.children[1].rotation.x = -Math.sin(this.legPhase) * 0.5 * sp;
      legs.children[0].position.z = Math.cos(this.legPhase) * 0.07 * sp;
      legs.children[1].position.z = -Math.cos(this.legPhase) * 0.07 * sp;
      legs.children[0].position.y = Math.max(0, Math.sin(this.legPhase)) * 0.05 * sp;
      legs.children[1].position.y = Math.max(0, -Math.sin(this.legPhase)) * 0.05 * sp;
    }

    // левая рука покачивается при ходьбе и уходит вниз в рывке
    this.bob = dampTo(this.bob, sp, 6, dt);
    const t = performance.now() / 1000;
    this.armWrap.position.set(
      -0.30 + Math.sin(t * 6.2) * 0.016 * this.bob,
      -0.20 - Math.abs(Math.cos(t * 6.2)) * 0.024 * this.bob - (player.dodging ? 0.09 : 0),
      -0.70
    );
    this.armWrap.rotation.z = -0.1 + Math.sin(t * 6.2) * 0.06 * this.bob;

    if (inv) {
      this.setContainer(inv.tier);
      this.setFill(inv.fillRatio);
    }
  }

  /** Куда «падают» сорванные грибы — горловина тары в мире. */
  getDropPoint(out) {
    this.containerNode.updateWorldMatrix(true, false);
    return out.setFromMatrixPosition(this.containerNode.matrixWorld);
  }

  reset() {
    this.setBoots(false);
    this.tier = -1;
    this.setContainer(0);
    this.legPhase = 0;
  }
}
