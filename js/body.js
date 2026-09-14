import * as THREE from 'three';
import { mergeParts } from './geo.js';
import { CONTAINERS } from './config.js';
import { skinTex, clothTex, metalTex, woodTex } from './textures.js';
import { dampTo, clamp } from './utils.js';

/* ============================================================
   Тело от первого лица: ноги с обувью внизу кадра и левая рука
   с тарой. Всё висит на камере, поэтому едет вместе со взглядом.
   ============================================================ */

const MAT = {
  skin: new THREE.MeshStandardMaterial({
    vertexColors: true, map: skinTex(), roughness: 0.78, metalness: 0,
  }),
  cloth: new THREE.MeshStandardMaterial({
    vertexColors: true, map: clothTex(), roughness: 0.95, metalness: 0,
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

  const thigh = new THREE.CylinderGeometry(0.088, 0.076, KNEE - HIP, 10);
  thigh.rotateX(0.14);
  thigh.translate(x, (HIP + KNEE) / 2, -0.07);
  cloth.push(paint(thigh, 0xb8bca8));

  const shin = new THREE.CylinderGeometry(0.074, 0.062, FOOT - KNEE, 10);
  shin.rotateX(-0.06);
  shin.translate(x, (KNEE + FOOT) / 2, -0.12);
  cloth.push(paint(shin, 0xa8ac98));

  if (boots) {
    // резиновый сапог: высокое голенище, раструб и рифлёная подошва
    const shaft = new THREE.CylinderGeometry(0.092, 0.084, 0.36, 12);
    shaft.rotateX(-0.06);
    shaft.translate(x, FOOT + 0.2, -0.135);
    shoe.push(paint(shaft, 0x2a3a40));
    const cuff = new THREE.CylinderGeometry(0.1, 0.092, 0.055, 12);
    cuff.rotateX(-0.06);
    cuff.translate(x, FOOT + 0.38, -0.145);
    shoe.push(paint(cuff, 0x3c5058));
    const foot = new THREE.BoxGeometry(0.12, 0.095, 0.28, 2, 1, 3);
    foot.translate(x, FOOT + 0.02, -0.19);
    shoe.push(paint(foot, 0x222e34));
    const toe = new THREE.SphereGeometry(0.061, 10, 7);
    toe.scale(1, 0.72, 1.1);
    toe.translate(x, FOOT + 0.015, -0.31);
    shoe.push(paint(toe, 0x222e34));
    const sole = new THREE.BoxGeometry(0.13, 0.035, 0.31, 2, 1, 4);
    sole.translate(x, FOOT - 0.038, -0.2);
    shoe.push(paint(sole, 0x14181c));
  } else {
    // обычный кирзовый ботинок
    const boot = new THREE.CylinderGeometry(0.086, 0.08, 0.17, 10);
    boot.rotateX(-0.06);
    boot.translate(x, FOOT + 0.1, -0.125);
    shoe.push(paint(boot, 0x4a3a2a));
    const foot = new THREE.BoxGeometry(0.11, 0.09, 0.26, 2, 1, 3);
    foot.translate(x, FOOT + 0.02, -0.18);
    shoe.push(paint(foot, 0x40311f));
    const toe = new THREE.SphereGeometry(0.056, 10, 7);
    toe.scale(1, 0.76, 1.05);
    toe.translate(x, FOOT + 0.015, -0.29);
    shoe.push(paint(toe, 0x40311f));
    const sole = new THREE.BoxGeometry(0.118, 0.03, 0.28, 2, 1, 3);
    sole.translate(x, FOOT - 0.033, -0.19);
    shoe.push(paint(sole, 0x1c1610));
  }

  return group([[MAT.cloth, cloth], [boots ? MAT.rubber : MAT.leather, shoe]]);
}

/* ------------------------------------------------------------
   Тара в левой руке
   ------------------------------------------------------------ */
function buildContainer(model) {
  const plastic = [], metal = [], wicker = [];

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
  }

  return group([[MAT.plastic, plastic], [MAT.metal, metal], [MAT.wicker, wicker]]);
}

/* ------------------------------------------------------------
   Кисть левой руки, держащая тару за ручку
   ------------------------------------------------------------ */
function buildLeftHand() {
  const skin = [], cloth = [];
  const palm = new THREE.BoxGeometry(0.05, 0.048, 0.062, 2, 2, 2);
  palm.translate(0, 0.028, 0);
  skin.push(paint(palm, 0xffffff));
  for (let i = 0; i < 4; i++) {
    const f = new THREE.CylinderGeometry(0.0095, 0.0102, 0.046, 8);
    f.rotateX(Math.PI / 2);
    f.translate(-0.016 + i * 0.011, 0.018, -0.004);
    skin.push(paint(f, 0xffffff));
  }
  const th = new THREE.CylinderGeometry(0.0108, 0.0114, 0.042, 8);
  th.rotateZ(Math.PI / 2.4);
  th.translate(0.024, 0.042, -0.006);
  skin.push(paint(th, 0xe8d0c0));
  // Дальше кисти руку не показываем: в кадре от первого лица
  // длинное предплечье загораживает пол-экрана.
  const wrist = new THREE.CylinderGeometry(0.026, 0.029, 0.06, 10);
  wrist.rotateX(0.55);
  wrist.translate(0.004, 0.072, 0.036);
  skin.push(paint(wrist, 0xffffff));
  const cuff = new THREE.CylinderGeometry(0.034, 0.038, 0.05, 12);
  cuff.rotateX(0.55);
  cuff.translate(0.008, 0.115, 0.062);
  cloth.push(paint(cuff, 0xd8dcc8));
  return group([[MAT.skin, skin], [MAT.cloth, cloth]]);
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
    this.armWrap.position.set(-0.3, -0.4, -0.5);
    this.armWrap.rotation.set(0.12, 0.3, -0.12);
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
    const def = CONTAINERS[tier];
    if (!def) return;
    const c = buildContainer(def.model);
    this.containerNode.add(c);
    this.current = c;
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
    this.fillMesh.position.y = -0.035 - (1 - ratio) * 0.06;
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
      -0.3 + Math.sin(t * 6.2) * 0.014 * this.bob,
      -0.4 - Math.abs(Math.cos(t * 6.2)) * 0.02 * this.bob - (player.dodging ? 0.08 : 0),
      -0.5
    );
    this.armWrap.rotation.z = -0.12 + Math.sin(t * 6.2) * 0.06 * this.bob;

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
