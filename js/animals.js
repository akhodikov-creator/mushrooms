import * as THREE from 'three';
import { mergeParts } from './geo.js';
import { CONFIG, ASSETS } from './config.js';
import { Audio } from './audio.js';
import {
  TAU, terrainHeight, wrapCoord, wrapDelta, clamp, lerp, dampTo, isWater, WATER_LEVEL,
} from './utils.js';
import { furTex, scaleTex } from './textures.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { instance, onAsset, animationsOf } from './assets.js';

/* ============================================================
   Материалы зверей: шерсть рисуется в canvas, поэтому силуэт
   перестаёт быть «пластилиновым» даже на простой геометрии.
   ============================================================ */
const MAT_FUR = {
  bear: new THREE.MeshStandardMaterial({
    vertexColors: true, map: furTex('bear', '#4a3122', 11), roughness: 0.95, metalness: 0,
  }),
  boar: new THREE.MeshStandardMaterial({
    vertexColors: true, map: furTex('boar', '#332b24', 22), roughness: 0.9, metalness: 0,
  }),
  wolf: new THREE.MeshStandardMaterial({
    vertexColors: true, map: furTex('wolf', '#6b6660', 33), roughness: 0.92, metalness: 0,
  }),
  fish: new THREE.MeshStandardMaterial({
    vertexColors: true, map: scaleTex(), roughness: 0.28, metalness: 0.45,
    side: THREE.DoubleSide,
  }),
};
const MAT_HORN = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.45, metalness: 0.1,
});
const MAT_EYE = new THREE.MeshBasicMaterial({ color: 0xff2200 });
const MAT_EYE_WOLF = new THREE.MeshBasicMaterial({ color: 0xffd020 });
const MAT_EYE_FISH = new THREE.MeshBasicMaterial({ color: 0xfff0a0 });

export function applyAnimalEnv(env) {
  for (const m of [...Object.values(MAT_FUR), MAT_HORN]) {
    m.envMap = env;
    m.envMapIntensity = m === MAT_FUR.fish ? 1.2 : 0.5;
    m.needsUpdate = true;
  }
}

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

const box = (w, h, d, x, y, z, col, jit) => {
  const g = new THREE.BoxGeometry(w, h, d, 2, 2, 2);
  g.translate(x, y, z);
  return paint(g, col, jit);
};
const sph = (r, x, y, z, col, sx = 1, sy = 1, sz = 1, jit = 0) => {
  const g = new THREE.SphereGeometry(r, 14, 10);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return paint(g, col, jit);
};

/** Лапа из двух сегментов со стопой — прямая коробка читается как ходуля. */
function limb(len, rTop, rBot, col) {
  const p = [];
  const upper = new THREE.CylinderGeometry(rTop, rBot * 1.05, len * 0.55, 8);
  upper.translate(0, -len * 0.275, 0);
  p.push(paint(upper, col, 0.1));
  const lower = new THREE.CylinderGeometry(rBot * 1.05, rBot * 0.8, len * 0.5, 8);
  lower.translate(0, -len * 0.78, 0.02);
  p.push(paint(lower, col, 0.1));
  const paw = new THREE.SphereGeometry(rBot * 1.25, 10, 7);
  paw.scale(1, 0.55, 1.35);
  paw.translate(0, -len * 1.0, 0.03);
  p.push(paint(paw, 0x1c1610, 0.08));
  return mergeParts(p);
}

/* ============================================================
   МОДЕЛИ. Ориентация: «вперёд» у всех зверей — это -Z.
   ============================================================ */

/**
 * Медведь — Копатыч.
 *
 * Модель со скелетом и тремя клипами из Mixamo. Пока файл не приехал,
 * работает прежний процедурный медведь: он и остаётся запаской, так
 * что сломать зверя ненадёжной сетью нельзя.
 */
function buildKopatych() {
  const model = instance('kopatych');
  if (!model) return buildBear();
  const g = new THREE.Group();
  model.traverse((o) => {
    if (!o.isMesh && !o.isSkinnedMesh) return;
    o.castShadow = true;
    // Отсечение пирамидой видимости для скиннутого меша считается по
    // габариту позы покоя, а зверь из неё выходит — в замахе рука
    // вылезает наружу, и меш моргает. Пусть рисуется всегда.
    o.frustumCulled = false;
  });
  g.add(model);
  const head = new THREE.Group();
  head.position.set(0, 1.3, 0);      // по ней считаются точные попадания
  g.add(head);
  return { g, head, legs: [], bodyMesh: g.children[0] };
}

/** Кабан: покупная модель с текстурой, запаска — прежний из шаров. */
function buildBoarModel() {
  const model = instance('boar');
  if (!model) return buildBoar();
  const g = new THREE.Group();
  const tex = boarTexture();
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.material = tex;
  });
  g.add(model);
  const head = new THREE.Group();
  head.position.set(0, 0.8, -0.72);
  g.add(head);
  return { g, head, legs: [], bodyMesh: g.children[0] };
}

let MAT_BOAR = null;
function boarTexture() {
  if (MAT_BOAR) return MAT_BOAR;
  const t = new THREE.TextureLoader().load(ASSETS.boar.tex);
  t.colorSpace = THREE.SRGBColorSpace;
  // развёртка приехала из glb, а там начало отсчёта сверху
  t.flipY = false;
  t.anisotropy = 4;
  MAT_BOAR = new THREE.MeshStandardMaterial({ map: t, roughness: 0.92, metalness: 0 });
  return MAT_BOAR;
}

function buildBear() {
  const g = new THREE.Group();
  const fur = 0xffffff, fur2 = 0xd8d0c4;
  const body = [];
  body.push(sph(0.6, 0, 0, 0.2, fur, 1.08, 1.0, 1.62, 0.1));
  body.push(sph(0.46, 0, 0.26, -0.42, fur2, 1.02, 0.9, 1.0, 0.1));    // горб
  body.push(sph(0.34, 0, -0.06, 0.98, fur, 1.0, 0.92, 0.95, 0.08));   // круп
  body.push(sph(0.1, 0, 0.12, 1.24, fur2, 1, 1, 1.4));                // хвостик
  const bodyMesh = new THREE.Mesh(mergeParts(body), MAT_FUR.bear);
  bodyMesh.position.y = 0.94;
  bodyMesh.castShadow = true;
  g.add(bodyMesh);

  const head = new THREE.Group();
  const hp = [];
  hp.push(sph(0.32, 0, 0, 0, fur2, 1.0, 0.96, 1.06, 0.08));
  hp.push(sph(0.185, 0, -0.09, -0.3, 0xa89684, 0.92, 0.82, 1.3, 0.08));   // морда
  hp.push(sph(0.062, 0, -0.05, -0.55, 0x2a2018));                          // мочка носа
  for (const sx of [-1, 1]) {
    hp.push(sph(0.115, sx * 0.235, 0.245, 0.05, fur2, 1, 1, 0.5));         // уши
    hp.push(sph(0.075, sx * 0.235, 0.245, 0.02, 0xb09a86, 1, 1, 0.4));
  }
  const headMesh = new THREE.Mesh(mergeParts(hp), MAT_FUR.bear);
  headMesh.castShadow = true;
  head.add(headMesh);
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), MAT_EYE);
    e.position.set(sx * 0.135, 0.075, -0.255);
    head.add(e);
  }
  head.position.set(0, 1.2, -0.94);
  g.add(head);

  const legs = [];
  for (const [lx, lz] of [[-0.4, -0.5], [0.4, -0.5], [-0.38, 0.66], [0.38, 0.66]]) {
    const lg = new THREE.Group();
    const m = new THREE.Mesh(limb(0.86, 0.16, 0.125, fur2), MAT_FUR.bear);
    m.castShadow = true;
    lg.add(m);
    lg.position.set(lx, 0.92, lz);
    g.add(lg);
    legs.push(lg);
  }
  return { g, head, legs, bodyMesh };
}

function buildBoar() {
  const g = new THREE.Group();
  const hide = 0xffffff, hide2 = 0xc8bcb0;
  const body = [];
  body.push(sph(0.42, 0, 0, 0.14, hide, 1.02, 1.02, 1.5, 0.12));
  body.push(sph(0.34, 0, 0.14, -0.4, hide2, 1.0, 0.92, 0.95, 0.1));
  body.push(sph(0.22, 0, -0.02, 0.8, hide, 1, 0.9, 0.9, 0.1));
  for (let i = 0; i < 9; i++) {                                    // щетина на хребте
    const c = new THREE.ConeGeometry(0.035, 0.3, 5);
    c.rotateX(-0.55);
    c.translate(0, 0.44 - i * 0.008, -0.55 + i * 0.15);
    body.push(paint(c, 0xe8dcd0, 0.2));
  }
  const bodyMesh = new THREE.Mesh(mergeParts(body), MAT_FUR.boar);
  bodyMesh.position.y = 0.64;
  bodyMesh.castShadow = true;
  g.add(bodyMesh);

  const head = new THREE.Group();
  const hp = [];
  hp.push(sph(0.28, 0, 0, -0.08, hide2, 0.94, 0.96, 1.3, 0.08));
  hp.push(sph(0.155, 0, -0.07, -0.44, 0xd8c8bc, 0.88, 0.76, 1.05));   // рыло
  hp.push(sph(0.05, 0, -0.07, -0.56, 0x3a2e26, 1, 0.7, 0.5));         // пятак
  for (const sx of [-1, 1]) {
    const ear = new THREE.ConeGeometry(0.075, 0.19, 6);
    ear.rotateX(-0.35);
    ear.translate(sx * 0.17, 0.25, 0.02);
    hp.push(paint(ear, hide2, 0.1));
  }
  const headMesh = new THREE.Mesh(mergeParts(hp), MAT_FUR.boar);
  headMesh.castShadow = true;
  head.add(headMesh);

  const tusks = [];
  for (const sx of [-1, 1]) {
    const t = new THREE.CylinderGeometry(0.012, 0.03, 0.28, 7);
    t.rotateX(-2.45);
    t.rotateZ(sx * 0.28);
    t.translate(sx * 0.105, -0.04, -0.47);
    tusks.push(paint(t, 0xf0e8d4));
  }
  head.add(new THREE.Mesh(mergeParts(tusks), MAT_HORN));
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.031, 8, 6), MAT_EYE);
    e.position.set(sx * 0.13, 0.07, -0.27);
    head.add(e);
  }
  head.position.set(0, 0.78, -0.58);
  g.add(head);

  const legs = [];
  for (const [lx, lz] of [[-0.25, -0.34], [0.25, -0.34], [-0.23, 0.46], [0.23, 0.46]]) {
    const lg = new THREE.Group();
    const m = new THREE.Mesh(limb(0.58, 0.085, 0.06, hide2), MAT_FUR.boar);
    m.castShadow = true;
    lg.add(m);
    lg.position.set(lx, 0.6, lz);
    g.add(lg);
    legs.push(lg);
  }
  return { g, head, legs, bodyMesh };
}

function buildWolf() {
  const g = new THREE.Group();
  const fur = 0xffffff, fur2 = 0xd0cac2;
  const body = [];
  body.push(sph(0.29, 0, 0, 0.06, fur, 1.02, 0.96, 1.72, 0.1));
  body.push(sph(0.26, 0, 0.09, -0.4, fur2, 1.0, 0.94, 0.9, 0.1));
  body.push(sph(0.2, 0, 0.02, 0.52, fur, 1, 0.92, 0.9, 0.1));
  const tail = new THREE.CylinderGeometry(0.1, 0.035, 0.66, 8);
  tail.rotateX(1.15);
  tail.translate(0, 0.14, 0.66);
  body.push(paint(tail, 0xb8b2aa, 0.15));
  const bodyMesh = new THREE.Mesh(mergeParts(body), MAT_FUR.wolf);
  bodyMesh.position.y = 0.72;
  bodyMesh.castShadow = true;
  g.add(bodyMesh);

  const head = new THREE.Group();
  const hp = [];
  hp.push(sph(0.2, 0, 0, -0.04, fur2, 0.96, 0.96, 1.12, 0.08));
  hp.push(sph(0.105, 0, -0.055, -0.28, 0xb0a89e, 0.84, 0.74, 1.35));
  hp.push(sph(0.042, 0, -0.045, -0.44, 0x1a1614));
  for (const sx of [-1, 1]) {
    const ear = new THREE.ConeGeometry(0.07, 0.21, 5);
    ear.rotateX(-0.12);
    ear.translate(sx * 0.115, 0.235, 0.02);
    hp.push(paint(ear, fur2, 0.1));
  }
  const headMesh = new THREE.Mesh(mergeParts(hp), MAT_FUR.wolf);
  headMesh.castShadow = true;
  head.add(headMesh);
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.027, 8, 6), MAT_EYE_WOLF);
    e.position.set(sx * 0.093, 0.055, -0.215);
    head.add(e);
  }
  head.position.set(0, 0.84, -0.5);
  g.add(head);

  const legs = [];
  for (const [lx, lz] of [[-0.17, -0.26], [0.17, -0.26], [-0.16, 0.36], [0.16, 0.36]]) {
    const lg = new THREE.Group();
    const m = new THREE.Mesh(limb(0.64, 0.058, 0.042, fur2), MAT_FUR.wolf);
    m.castShadow = true;
    lg.add(m);
    lg.position.set(lx, 0.68, lz);
    g.add(lg);
    legs.push(lg);
  }
  return { g, head, legs, bodyMesh };
}

function buildHarius() {
  // ХАРИУС. Парусный спинной плавник как в жизни, только злее.
  const g = new THREE.Group();
  const body = [];
  // тело каплей: сплюснуто с боков, сужается к хвосту
  const bg = new THREE.SphereGeometry(0.3, 18, 12);
  const bp = bg.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const z = bp.getZ(i) / 0.3;
    const k = 1 - Math.max(0, z) * 0.62;
    bp.setX(i, bp.getX(i) * 0.5 * k);
    bp.setY(i, bp.getY(i) * 0.98 * k);
    bp.setZ(i, bp.getZ(i) * 1.95);
  }
  bg.computeVertexNormals();
  body.push(paint(bg, 0xf0f4f8, 0.05));
  body.push(sph(0.15, 0, 0.02, -0.5, 0xb8c4cc, 0.62, 0.86, 0.9, 0.05));   // голова

  // раскрытая пасть
  const jaw = new THREE.ConeGeometry(0.125, 0.22, 8);
  jaw.rotateX(-Math.PI / 2);
  jaw.translate(0, -0.035, -0.64);
  body.push(paint(jaw, 0xc85a62));

  // парус
  const fin = new THREE.PlaneGeometry(0.86, 0.5, 8, 3);
  const fp = fin.attributes.position;
  for (let i = 0; i < fp.count; i++) {
    const t = (fp.getX(i) + 0.43) / 0.86;
    fp.setY(i, fp.getY(i) * (0.5 + Math.sin(t * Math.PI) * 1.0));
    fp.setZ(i, Math.sin(t * 9) * 0.012);        // складки паруса
  }
  fin.computeVertexNormals();
  fin.rotateY(Math.PI / 2);
  fin.translate(0, 0.46, 0.0);
  body.push(paint(fin, 0x9a68c0, 0.22));

  const tail = new THREE.PlaneGeometry(0.4, 0.46, 3, 3);
  const tp = tail.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    const t = (tp.getX(i) + 0.2) / 0.4;
    tp.setY(i, tp.getY(i) * (0.4 + t * 1.3));   // хвост-вилка
  }
  tail.computeVertexNormals();
  tail.rotateY(Math.PI / 2);
  tail.translate(0, 0.02, 0.62);
  body.push(paint(tail, 0x7a90a0, 0.18));

  for (const sx of [-1, 1]) {
    const pf = new THREE.PlaneGeometry(0.26, 0.17);
    pf.rotateX(Math.PI / 2 + sx * 0.55);
    pf.rotateY(sx * 0.3);
    pf.translate(sx * 0.14, -0.08, -0.22);
    body.push(paint(pf, 0xa8b4be, 0.18));
  }

  const bodyMesh = new THREE.Mesh(mergeParts(body), MAT_FUR.fish);
  bodyMesh.position.y = 0.32;
  bodyMesh.castShadow = true;
  g.add(bodyMesh);

  const head = new THREE.Group();
  for (const sx of [-1, 1]) {
    const e = new THREE.Mesh(new THREE.SphereGeometry(0.062, 10, 8), MAT_EYE_FISH);
    e.position.set(sx * 0.1, 0.38, -0.46);
    const pu = new THREE.Mesh(new THREE.SphereGeometry(0.032, 8, 6),
      new THREE.MeshBasicMaterial({ color: 0x000000 }));
    pu.position.set(sx * 0.128, 0.38, -0.48);
    head.add(e, pu);
  }
  g.add(head);

  return { g, head, legs: [], bodyMesh };
}

/* ============================================================
   Типы
   ============================================================ */
export const KINDS = {
  bear: {
    name: 'МЕДВЕДЬ', build: buildKopatych, hp: 330, scale: 1.0,
    approach: 4.6, chargeSpeed: 15.6, telegraph: 1.3, chargeTime: 1.55,
    recover: 1.5, radius: 0.95, maxCharges: 4, instakill: true, damage: 999,
    lockDist: 11.0, chargeTurn: 1.9, engageRange: 17, sound: 'bear', headY: 1.3, bonus: CONFIG.killBonusBear,
    corrida: true, aggroMusic: 1.0,
    // Ходит не шарнирами, а костями: слот с клипами и что играть в
    // каком состоянии — [клип, скорость].
    //
    // Бег и шаг взяты от хозяина бора: у всех ригов Mixamo кости зовутся
    // одинаково, и клип ложится на чужой скелет как родной. Своего бега
    // у медведя нет — скачанный «Running Jump» оказался прыжком, зверь
    // на нём отрывался от земли и плыл по воздуху.
    clips: 'kopatych',
    clipMap: {
      spawn: ['sprint', 0.35], approach: ['walk', 1.1], telegraph: ['attack', 1.0],
      charge: ['sprint', 1.35], recover: ['walk', 0.7], leave: ['sprint', 0.55],
      dead: ['death', 1.0],
    },
    clipOnce: ['death'],
  },
  boar: {
    name: 'КАБАН', build: buildBoarModel, hp: 150, scale: 1.0,
    approach: 5.4, chargeSpeed: 14.2, telegraph: 0.85, chargeTime: 1.3,
    recover: 1.1, radius: 0.7, maxCharges: 5, instakill: false, damage: 58,
    lockDist: 9.0, chargeTurn: 2.4, engageRange: 14, sound: 'boar', headY: 0.8, bonus: CONFIG.killBonusBoar,
    corrida: true, aggroMusic: 0.7,
  },
  wolf: {
    name: 'ВОЛК', build: buildWolf, hp: 90, scale: 1.0,
    approach: 6.6, chargeSpeed: 11.2, telegraph: 0.5, chargeTime: 0.8,
    recover: 0.7, radius: 0.55, maxCharges: 99, instakill: false, damage: 17,
    lockDist: 6.5, chargeTurn: 3.4, engageRange: 22, sound: 'wolf', headY: 0.85, bonus: CONFIG.killBonusWolf,
    corrida: true, circles: true, aggroMusic: 0.55,
  },
  harius: {
    name: 'ХАРИУС', build: buildHarius, hp: 55, scale: 1.0,
    approach: 7.2, chargeSpeed: 13, telegraph: 0.35, chargeTime: 0.75,
    recover: 0.55, radius: 0.45, maxCharges: 99, instakill: false, damage: 13,
    lockDist: 0, chargeTurn: 0, engageRange: 26, sound: 'harius', headY: 0.6, bonus: CONFIG.killBonusHarius,
    corrida: false, jumper: true, aggroMusic: 0.4,
  },
};

let uid = 1;

/* ------------------------------------------------------------
   Хозяин бора — грибной великан.

   Модель скачанная; если её нет, собирается запаска из шляпки на
   ножке, чтобы игра не сломалась. Своего материала у модели не
   доезжает (в FBX текстуры остались ссылками), поэтому красим сами:
   тёмно-бурая шляпка и белёсая нога, как у боровика.
   ------------------------------------------------------------ */
const MAT_SHROOM = new THREE.MeshStandardMaterial({
  vertexColors: true, color: 0xb98a5e, roughness: 0.85, metalness: 0,
});

/**
 * Текстуры хозяина.
 *
 * В самом FBX их нет — только ссылки на файлы, которых с моделью не
 * прислали. Карты лежат отдельно и подключаются вручную: имена в
 * файле и на диске всё равно не совпадают.
 *
 * Исходники были 2048 и весили 22 МБ на одно чудище — вшестеро больше
 * всей остальной игры. Здесь они ужаты, затенение вмешано прямо в
 * цвет (развёртка у модели одна, а aoMap в three ждёт вторую), металл
 * выброшен: по карте он везде ноль.
 *
 * Пока карты едут, монстр стоит однотонно-бурый и игру не ломает.
 */
let shroomTexStarted = false;

function loadShroomTextures() {
  if (shroomTexStarted) return;
  shroomTexStarted = true;
  const L = new THREE.TextureLoader();
  L.load('assets/shroom_color.jpg', (t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    MAT_SHROOM.map = t;
    MAT_SHROOM.color.set(0xffffff);       // цвет теперь из карты
    MAT_SHROOM.needsUpdate = true;
  }, undefined, () => console.info('[animals] текстур хозяина нет — остаётся однотонный'));
  L.load('assets/shroom_normal.jpg', (t) => {
    MAT_SHROOM.normalMap = t;
    MAT_SHROOM.needsUpdate = true;
  }, undefined, () => {});
  L.load('assets/shroom_rough.jpg', (t) => {
    MAT_SHROOM.roughnessMap = t;
    MAT_SHROOM.needsUpdate = true;
  }, undefined, () => {});
}

function buildShroom() {
  const g = new THREE.Group();
  const model = instance('shroom');
  if (model) {
    loadShroomTextures();
    model.traverse((o) => {
      if (!o.isMesh) return;
      // белый вершинный цвет: материал общий с запаской, а она красится
      // по вершинам — модель же должна показывать текстуру как есть
      paint(o.geometry, 0xffffff);
      o.material = MAT_SHROOM;
    });
    g.add(model);
  } else {
    const p = [];
    const stem = new THREE.CylinderGeometry(0.42, 0.62, 2.1, 12);
    stem.translate(0, 1.05, 0);
    p.push(paint(stem, 0xe6dcc0));
    const cap = new THREE.SphereGeometry(1.5, 16, 10, 0, TAU, 0, Math.PI / 2);
    cap.scale(1, 0.62, 1);
    cap.translate(0, 2.1, 0);
    p.push(paint(cap, 0x7a4a26));
    g.add(new THREE.Mesh(mergeParts(p), MAT_SHROOM));
  }
  // «голова» — шляпка: по ней и считаются точные попадания
  const head = new THREE.Group();
  head.position.set(0, 2.6, 0);
  g.add(head);
  return { g, head, legs: [], bodyMesh: g.children[0] };
}

/* ============================================================
   Прототипы зверей.

   Собрать медведя из кусков — несколько миллисекунд, и приходятся
   они ровно на тот кадр, когда зверь выскакивает из-за деревьев.
   Поэтому каждый вид собирается один раз, а дальше клонируется:
   клон делит с оригиналом и геометрию, и материалы, так что стоит
   он копейки. Значит, и выбрасывать геометрию при смерти нельзя.
   ============================================================ */
const protos = new Map();

function protoOf(kindId) {
  let p = protos.get(kindId);
  if (!p) {
    p = KINDS[kindId].build();
    p.head.name = 'head';
    p.bodyMesh.name = 'body';
    p.legs.forEach((l, i) => { l.name = 'leg' + i; });
    p.skinned = false;
    p.g.traverse((o) => { if (o.isSkinnedMesh) p.skinned = true; });
    protos.set(kindId, p);
  }
  return p;
}

function modelOf(kindId) {
  const p = protoOf(kindId);
  // Обычный clone() у скиннутого меша оставляет кости в оригинале:
  // прототип в сцену не добавлен, и тварь рисуется в начале координат,
  // за сотни метров от игрока. Для таких есть SkeletonUtils.
  const g = p.skinned ? skeletonClone(p.g) : p.g.clone(true);
  return {
    g,
    head: g.getObjectByName('head'),
    bodyMesh: g.getObjectByName('body'),
    legs: p.legs.map((_, i) => g.getObjectByName('leg' + i)),
  };
}

/**
 * По одной модели каждого вида — для прогрева.
 * Первая отрисовка нового материала стоит компиляции шейдера, и на
 * слабой машине это сотни миллисекунд. Лучше заплатить их на загрузке,
 * чем в кадре, где на игрока несётся кабан.
 */
export function animalWarmupModels() {
  return Object.keys(KINDS).map((id) => modelOf(id).g);
}

/* Хозяин бора. Не зверь: не разгоняется, не уклоняется, не убивает —
   отбирает собранное. Живёт по своему автомату, см. _updateBoss. */
KINDS.shroom = {
  name: 'ХОЗЯИН БОРА', build: buildShroom, hp: 10, scale: 1.0,
  boss: true,
  walkSpeed: 3.6,         // тяжёлый шаг вразвалку
  sprintSpeed: 8.2,       // рывком догоняет даже бегущего
  sprintFrom: 16,         // дальше этого переходит на бег
  jumpFrom: 6.5,          // отсюда прыгает
  jumpRadius: 3.6,        // радиус поражения при приземлении
  jumpDamage: 50,
  grabTake: 0.35,         // какую долю тары выгребает за раз
  grabMin: 3,
  life: 78,               // сколько держится, если не убить
  radius: 1.5, headY: 2.7,
  bonus: 2600, sound: 'bear',
  damage: 0, instakill: false,
  // Без этого в шкалу опасности уходит NaN: threatLevel умножает
  // близость на aggroMusic, а у хозяина её не было.
  aggroMusic: 0.85,
};

class Animal {
  constructor(kindId, x, z, mgr) {
    this.k = KINDS[kindId];
    this.kindId = kindId;
    this.id = uid++;
    this.mgr = mgr;
    this.x = wrapCoord(x); this.z = wrapCoord(z);
    this.y = terrainHeight(this.x, this.z);
    this.hp = this.k.hp;
    this.maxHp = this.k.hp;
    this.dir = Math.random() * TAU;
    this.state = 'spawn';
    this.t = 0;
    this.charges = 0;
    this.hitThisCharge = false;
    this.animT = Math.random() * 10;
    this.dead = false;
    this.fade = 1;
    this.jumpV = 0;
    this.jumpY = 0;
    this.circleSide = Math.random() < 0.5 ? 1 : -1;
    this.lockDx = 0; this.lockDz = -1;

    const m = modelOf(kindId);
    this.g = m.g;
    // У хозяина настоящий риг (бёдра, колени, плечи), и шагает он
    // костями: трёхметровая туша, скользящая по траве, читается как
    // ошибка, а не как чудище.
    // Клипы из Mixamo. Микшер у каждого зверя свой — скелет-то тоже
    // свой, клонированный. Слот задаётся в KINDS: у хозяина бора это
    // «shroom», у медведя «kopatych». Если файл не приехал, клипов
    // не будет, и зверь останется на процедурной анимации.
    const slot = this.k.clips || (this.k.boss ? 'shroom' : null);
    if (slot) {
      const clips = animationsOf(slot);
      if (clips.length) {
        this.mixer = new THREE.AnimationMixer(m.g);
        this.act = {};
        for (const c of clips) {
          const a = this.mixer.clipAction(c);
          a.enabled = true;
          this.act[c.name] = a;
        }
        const once = this.k.clipOnce || ['jump', 'steal'];
        for (const nm of once) {
          if (this.act[nm]) {
            this.act[nm].setLoop(THREE.LoopOnce, 1);
            this.act[nm].clampWhenFinished = true;
          }
        }
      }
    }
    this.head = m.head;
    this.legs = m.legs;
    this.bodyMesh = m.bodyMesh;
    this.g.scale.setScalar(this.k.scale);
    this.g.userData.animal = this;
    mgr.root.add(this.g);
  }

  dispose() {
    // геометрия общая с прототипом — выбрасывать её нельзя
    this.mgr.root.remove(this.g);
  }

  damage(amount, headshot, weapon) {
    // Хозяин считает не урон, а попадания: десять в тулово, пять в
    // шляпу. Нож по великану вдвое выше медведя — так, царапина.
    if (this.k.boss) {
      if (this.dead) return false;
      this.hp -= headshot ? 2 : (weapon === 'knife' ? 0.25 : 1);
      this.flash = 0.12;
      Audio.hit(headshot);
      if (this.hp <= 0) { this.die(); return true; }
      return false;
    }
    if (this.dead) return false;
    this.hp -= amount * (headshot ? 2.6 : 1);
    this.flash = 0.16;
    if (this.hp <= 0) {
      this.die();
      return true;
    }
    // раненый зверь свирепеет
    if (this.state === 'approach' || this.state === 'idle') { this.state = 'telegraph'; this.t = 0; }
    return false;
  }

  die() {
    this.dead = true;
    this.state = 'dead';
    this.t = 0;
    Audio.hit(true);
    Audio.tone({ freq: 130, to: 46, dur: 1.0, type: 'sawtooth', gain: 0.18 });
    this.mgr.onKill?.(this);
  }

  /** Мировая точка «удара» — перед мордой. */
  hitPoint() {
    const s = this.k.radius * 0.9;
    return [this.x - Math.sin(this.dir) * s, this.z - Math.cos(this.dir) * s];
  }

  /**
   * Хозяин бора.
   *
   * Зверь — это коррида: разгон по прямой и рывок в последний момент.
   * Хозяин так не умеет вообще, и в этом весь смысл: он не бегает,
   * его нельзя обмануть уклонением, он всегда знает, где ты, и не
   * устаёт. Зато он и не убивает — он запускает лапу в тару и
   * выгребает собранное. Угроза не жизни, а урожаю: беги сдавать
   * или стой и стреляй.
   */
  /** Переключить клип с перекрёстным затуханием. */
  _play(name, fade = 0.25, speed = 1) {
    if (!this.act || !this.act[name]) return;
    if (this.clip === name) {
      // Тот же клип, но темп другой: у медведя и подход, и отход — это
      // «run», просто с разной скоростью. Перезапускать его ради этого
      // нельзя, зверь дёргался бы на каждом переходе.
      const cur = this.act[name];
      if (Math.abs(cur.timeScale - speed) > 1e-3) cur.timeScale = speed;
      return;
    }
    const next = this.act[name];
    next.reset();
    next.timeScale = speed;
    next.fadeIn(fade).play();
    if (this.clip && this.act[this.clip]) this.act[this.clip].fadeOut(fade);
    this.clip = name;
    this.clipT = 0;
  }

  /**
   * Хозяин бора.
   *
   * Зверь — это коррида: разгон по прямой и рывок в последний момент.
   * Хозяин устроен иначе: выходит из земли, идёт вразвалку, с дальней
   * дистанции переходит на бег, а вблизи прыгает и бьёт по площади.
   * Попал — отнимает здоровье и лезет в тару; промахнулся — стоит
   * отдыхает, и это единственное окно, чтобы всадить в него пулю.
   */
  _updateBoss(dt, player, mgr) {
    this.animT += dt;
    if (this.flash > 0) this.flash -= dt;
    this.t += dt;
    this.age = (this.age || 0) + dt;
    if (this.mixer) this.mixer.update(dt);

    const dx = wrapDelta(player.x - this.x);
    const dz = wrapDelta(player.z - this.z);
    const dist = Math.hypot(dx, dz);
    const k = this.k;
    const grow = 1 + (this.meals || 0) * 0.07;
    let step = 0;

    // в прыжке он летит по заранее взятой линии, иначе смотрит на игрока
    if (this.state !== 'jump') this.dir = Math.atan2(-dx, -dz);

    switch (this.state) {
      case 'spawn': {
        const t = Math.min(1, this.t / 2.2);
        this.rise = t;
        if (!this.greeted) { this.greeted = true; Audio.shroom(); }
        this._play('walk', 0.01);
        if (t >= 1) { this.state = 'walk'; this.t = 0; }
        break;
      }

      case 'walk': {
        this._play('walk', 0.3);
        step = k.walkSpeed * (1 + (this.meals || 0) * 0.05);
        // вплотную прыгать незачем — просто лезет в тару
        if (dist < 2.4) { this.state = 'steal'; this.t = 0; this.took = false; }
        else if (dist < k.jumpFrom) { this.state = 'jump'; this.t = 0; this._startJump(dx, dz, dist); }
        else if (dist > k.sprintFrom) { this.state = 'sprint'; this.t = 0; }
        else if (this.age > k.life) { this.state = 'sink'; this.t = 0; }
        break;
      }

      case 'sprint': {
        this._play('sprint', 0.22);
        step = k.sprintSpeed;
        if (dist < k.jumpFrom) { this.state = 'jump'; this.t = 0; this._startJump(dx, dz, dist); }
        else if (dist > k.sprintFrom * 2.2 || this.age > k.life) { this.state = 'walk'; this.t = 0; }
        break;
      }

      case 'jump': {
        this._play('jump', 0.12, 1.35);
        const d = (this.act && this.act.jump) ? this.act.jump.getClip().duration / 1.35 : 2.8;
        const p = this.t / d;
        // разгон и полёт занимают середину клипа, приземление на 62%
        if (p > 0.18 && p < 0.62) step = this.jumpSpeed;
        if (p >= 0.62 && !this.landed) {
          this.landed = true;
          this.jumpY = 0;
          const hit = dist < k.jumpRadius;
          mgr.onBossSlam?.(this, hit);
          if (hit) { this.state = 'steal'; this.t = 0; this.took = false; break; }
        }
        if (p >= 1) { this.state = 'recover'; this.t = 0; }
        break;
      }

      case 'steal': {
        this._play('steal', 0.15);
        const d = (this.act && this.act.steal) ? this.act.steal.getClip().duration : 2.6;
        if (this.t > d * 0.42 && !this.took) {
          this.took = true;
          Audio.shroomGrab();
          mgr.onSteal?.(this);
        }
        if (this.t > d) { this.state = 'recover'; this.t = 0; }
        break;
      }

      case 'recover': {
        this._play('walk', 0.3, 0.35);          // топчется, переводит дух
        if (this.t > 2.2) {
          this.state = this.age > k.life ? 'sink' : 'walk';
          this.t = 0;
          this.landed = false;
        }
        break;
      }

      case 'sink': {
        this.rise = Math.max(0, 1 - this.t / 1.8);
        if (this.t > 1.8) {
          this.dead = true;
          this.fade = 0;
          this.remove = true;
          mgr.onLeave?.(this);
        }
        break;
      }

      case 'dead': {
        this.fade -= dt * 0.55;
        if (this.fade <= 0) { this.fade = 0; this.remove = true; }
        break;
      }
    }

    if (step > 0 && dist > 0.001) {
      this.x = wrapCoord(this.x + (dx / dist) * step * dt);
      this.z = wrapCoord(this.z + (dz / dist) * step * dt);
    }

    this.y = terrainHeight(this.x, this.z);
    const hide = (1 - (this.rise ?? 1)) * 3.4;
    this.g.position.set(
      player.x + wrapDelta(this.x - player.x),
      this.y - hide + (this.state === 'dead' ? -(1 - this.fade) * 2.5 : 0),
      player.z + wrapDelta(this.z - player.z)
    );
    this.g.rotation.y = this.dir;
    this.g.scale.setScalar(grow);
    this.dist = dist;          // им пользуются радар и шкала опасности
    return dist;
  }

  /** Замах перед прыжком: цель берётся один раз, дальше он летит по ней. */
  _startJump(dx, dz, dist) {
    this.landed = false;
    // долетает ровно туда, где игрок стоял в момент отрыва
    this.jumpSpeed = Math.max(6, Math.min(15, dist / 0.9));
    this.dir = Math.atan2(-dx, -dz);
  }

  update(dt, player, mgr) {
    if (this.k.boss) return this._updateBoss(dt, player, mgr);
    this.animT += dt;
    if (this.flash > 0) this.flash -= dt;

    const px = player.x, pz = player.z;
    const dx = wrapDelta(px - this.x);
    const dz = wrapDelta(pz - this.z);
    const dist = Math.hypot(dx, dz);
    const toPlayer = Math.atan2(-dx, -dz);   // «вперёд» = -Z

    let moveSpeed = 0;
    let mvx = 0, mvz = 0;

    switch (this.state) {
      case 'spawn': {
        this.t += dt;
        if (!this.greeted) {
          this.greeted = true;            // ровно один рёв на появление
          if (this.kindId === 'harius') { Audio.splash(); Audio.roar('harius'); }
          else Audio.roar(this.k.sound);
          mgr.onSpawnRoar?.(this);
        }
        if (this.kindId === 'harius') {
          this.jumpY = Math.max(0, 1.6 - Math.abs(this.t - 0.4) * 4);
        }
        if (this.t > (this.kindId === 'harius' ? 0.8 : 1.0)) { this.state = 'approach'; this.t = 0; }
        break;
      }

      case 'approach': {
        this.t += dt;
        let target = toPlayer;
        if (this.k.circles && dist < 13 && this.t % 4 < 2.4) {
          // волк обходит по дуге
          target = toPlayer + this.circleSide * 1.0;
        }
        this.dir = angleTo(this.dir, target, dt * 3.2);
        moveSpeed = this.k.approach * mgr.aggroScale;
        if (dist < (this.k.jumper ? 12 : this.k.circles ? 9 : this.k.engageRange * 0.62)) {
          this.state = 'telegraph';
          this.t = 0;
          if (!this.k.jumper) Audio.roar(this.k.sound);
          else Audio.roar('harius');
        }
        if (dist > 80) { this.state = 'leave'; this.t = 0; }
        break;
      }

      case 'telegraph': {
        this.t += dt;
        this.dir = angleTo(this.dir, toPlayer, dt * 5.5);
        moveSpeed = this.k.jumper ? 1.2 : 0.35;
        if (this.t >= this.k.telegraph) {
          // фиксируем направление рывка — дальше зверь несётся по прямой
          const lead = this.k.jumper ? 0.14 : 0.1;
          const tx = dx + player.vx * lead;
          const tz = dz + player.vz * lead;
          const l = Math.hypot(tx, tz) || 1;
          this.lockDx = tx / l; this.lockDz = tz / l;
          this.dir = Math.atan2(-this.lockDx, -this.lockDz);
          this.state = 'charge';
          this.t = 0;
          this.hitThisCharge = false;
          this.playerDodged = false;
          this.charges++;
          if (this.k.jumper) { this.jumpV = 6.2; Audio.roar('harius'); }
          mgr.onChargeStart?.(this);
        }
        break;
      }

      case 'charge': {
        this.t += dt;
        // Пока зверь далеко — он ещё доворачивает за игроком, и ранний
        // рывок ничего не даёт. Траектория намертво фиксируется только
        // на lockDist метрах: вот там и решает выдержка.
        if (!this.k.jumper && dist > this.k.lockDist) {
          const want = Math.atan2(dz, dx);
          let cur = Math.atan2(this.lockDz, this.lockDx);
          let diff = ((want - cur + Math.PI) % TAU + TAU) % TAU - Math.PI;
          const step = clamp(diff, -this.k.chargeTurn * dt, this.k.chargeTurn * dt);
          cur += step;
          this.lockDx = Math.cos(cur); this.lockDz = Math.sin(cur);
          this.dir = Math.atan2(-this.lockDx, -this.lockDz);
        }
        mvx = this.lockDx; mvz = this.lockDz;
        moveSpeed = this.k.chargeSpeed * (this.k.jumper ? 1 : (0.55 + Math.min(1, this.t / 0.35) * 0.45));
        if (this.k.jumper) {
          this.jumpV -= 13 * dt;
          this.jumpY = Math.max(0, this.jumpY + this.jumpV * dt);
        }
        if (player.evading) this.playerDodged = true;   // ушёл рывком, а не пешком
        // проверка попадания
        if (!this.hitThisCharge) {
          const [hx, hz] = this.hitPoint();
          const hd = Math.hypot(wrapDelta(px - hx), wrapDelta(pz - hz));
          const reach = this.k.radius + player.hitRadius;
          const vertOk = !this.k.jumper || this.jumpY < 1.9;
          if (hd < reach && vertOk) {
            this.hitThisCharge = true;
            mgr.onHitPlayer?.(this);
          }
        }
        if (this.t >= this.k.chargeTime || (this.k.jumper && this.jumpY <= 0 && this.t > 0.2)) {
          this.state = 'recover';
          this.t = 0;
          if (!this.hitThisCharge) mgr.onDodged?.(this);
          if (this.k.jumper) { Audio.splash(); this.jumpY = 0; }
        }
        break;
      }

      case 'recover': {
        this.t += dt;
        moveSpeed = Math.max(0, 4 - this.t * 4);
        mvx = this.lockDx; mvz = this.lockDz;
        this.dir = angleTo(this.dir, toPlayer, dt * 1.6);
        if (this.t >= this.k.recover) {
          if (this.charges >= this.k.maxCharges || this.hp < this.maxHp * 0.28) {
            this.state = 'leave'; this.t = 0;
            mgr.onLeave?.(this);
          } else {
            this.state = 'approach'; this.t = 0;
          }
        }
        break;
      }

      case 'leave': {
        this.t += dt;
        this.dir = angleTo(this.dir, toPlayer + Math.PI, dt * 2.5);
        moveSpeed = this.k.approach * 1.5;
        if (this.t > 6 || dist > 90) { this.remove = true; }
        break;
      }

      case 'dead': {
        this.t += dt;
        this.fade = Math.max(0, 1 - Math.max(0, this.t - 3.5) / 2);
        if (this.t > 5.5) this.remove = true;
        break;
      }
    }

    // ---- перемещение ----
    if (moveSpeed > 0 && this.state !== 'dead') {
      if (!mvx && !mvz) { mvx = -Math.sin(this.dir); mvz = -Math.cos(this.dir); }
      const nx = this.x + mvx * moveSpeed * dt;
      const nz = this.z + mvz * moveSpeed * dt;
      this.x = wrapCoord(nx); this.z = wrapCoord(nz);
    }

    const gh = terrainHeight(this.x, this.z);
    this.y = dampTo(this.y, gh, 12, dt);

    // ---- анимация ----
    const running = moveSpeed > 1;
    if (this.mixer) {
      // Зверь со скелетом: позу задаёт клип, а не синусы по шарнирам.
      // Падать на бок вручную тоже не надо — на смерть есть свой клип.
      this.mixer.update(dt);
      const c = (this.k.clipMap && this.k.clipMap[this.state]) || ['run', 1];
      this._play(c[0], this.state === 'dead' ? 0.1 : 0.22, c[1]);
      this.g.rotation.z = 0;
      this.g.position.y = this.y;
    } else {
      const rate = this.state === 'charge' ? 15 : running ? 7.5 : 2.2;
      const amp = this.state === 'charge' ? 0.95 : running ? 0.62 : 0.12;
      this.legs.forEach((l, i) => {
        const ph = (i < 2 ? 0 : Math.PI) + (i % 2) * Math.PI;
        l.rotation.x = Math.sin(this.animT * rate + ph) * amp;
      });

      if (this.state === 'dead') {
        this.g.rotation.z = lerp(this.g.rotation.z, Math.PI * 0.42, Math.min(1, dt * 4));
        this.g.position.y = this.y - 0.15;
      } else {
        this.g.rotation.z = 0;
        const bodyBob = Math.sin(this.animT * rate * 0.5) * (running ? 0.05 : 0.012);
        this.g.position.y = this.y + bodyBob + (this.k.jumper ? this.jumpY : 0);
      }

      // Покупная модель приходит одним куском: шарниров нет, ногами не
      // подвигать. Галоп изображаем наклоном и подскоком всего корпуса —
      // на скорости тарана этого хватает, чтобы туша не «ехала» по траве.
      // Крутим не саму группу, а модель внутри: на группе висит курс.
      if (!this.k.jumper && !this.legs.length && this.bodyMesh) {
        const gal = Math.sin(this.animT * rate);
        this.bodyMesh.rotation.x = gal * (running ? 0.12 : 0.015);
        this.bodyMesh.position.y = Math.abs(Math.sin(this.animT * rate * 0.5))
          * (running ? 0.09 : 0.008);
      }

      if (this.k.jumper) {
        // хариус вращается и хлопает в полёте — тот самый кринж
        this.g.rotation.x = Math.sin(this.animT * 9) * 0.5 - (this.jumpY > 0.1 ? 0.35 : 0);
        this.bodyMesh.rotation.z = Math.sin(this.animT * 16) * 0.32;
      } else if (this.head) {
        this.head.rotation.x = this.state === 'telegraph'
          ? Math.sin(this.animT * 20) * 0.14 - 0.2
          : Math.sin(this.animT * rate * 0.5) * 0.06;
      }
    }

    // телеграф: зверь «раздувается» и роет землю
    if (this.state === 'telegraph') {
      const p = 1 + Math.sin(this.animT * 22) * 0.045;
      this.g.scale.setScalar(this.k.scale * p);
    } else {
      this.g.scale.setScalar(this.k.scale * (this.flash > 0 ? 1.06 : 1));
    }

    this.g.rotation.y = this.dir;
    this.dist = dist;
  }
}

function angleTo(cur, target, maxStep) {
  let d = ((target - cur + Math.PI) % TAU + TAU) % TAU - Math.PI;
  const step = clamp(d, -maxStep * 3.2, maxStep * 3.2);
  return cur + step;
}

/* ============================================================
   Менеджер
   ============================================================ */
export class AnimalManager {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.list = [];
    this.blood = [];
    this.aggroScale = 1;      // плащ-дождевик: звери сближаются медленнее
  }

  spawn(kindId, x, z) {
    const a = new Animal(kindId, x, z, this);
    this.list.push(a);
    return a;
  }

  /** Спавн на расстоянии dist от игрока в случайном направлении. */
  spawnNear(kindId, px, pz, dist = 26, angle = null) {
    const a = angle ?? Math.random() * TAU;
    let x = px + Math.cos(a) * dist;
    let z = pz + Math.sin(a) * dist;
    if (kindId === 'harius') {
      // ищем воду поблизости, иначе прыгает из травы (так ещё смешнее)
      for (let i = 0; i < 26; i++) {
        const aa = Math.random() * TAU, dd = 8 + Math.random() * 26;
        const tx = px + Math.cos(aa) * dd, tz = pz + Math.sin(aa) * dd;
        if (isWater(tx, tz)) { x = tx; z = tz; break; }
      }
    }
    return this.spawn(kindId, x, z);
  }

  count(kindId) {
    return this.list.filter((a) => !a.dead && a.kindId === kindId && a.state !== 'leave').length;
  }

  get threatLevel() {
    let t = 0;
    for (const a of this.list) {
      if (a.dead || a.state === 'leave') continue;
      const near = clamp(1 - a.dist / 30, 0, 1);
      t = Math.max(t, near * a.k.aggroMusic * (a.state === 'charge' || a.state === 'telegraph' ? 1 : 0.6));
    }
    return clamp(t, 0, 1);
  }

  /** Хитскан: возвращает {animal, headshot, dist} или null. */
  raycast(origin, dir, maxDist) {
    let best = null, bestT = maxDist;
    const tmp = new THREE.Vector3();
    for (const a of this.list) {
      if (a.dead) continue;
      // сферы: тело и голова (в мировых координатах с учётом зацикливания)
      const ax = origin.x + wrapDelta(a.x - origin.x);
      const az = origin.z + wrapDelta(a.z - origin.z);
      const spheres = [
        { x: ax, y: a.g.position.y + a.k.radius * 0.9, z: az, r: a.k.radius * 1.05, head: false },
        {
          x: ax - Math.sin(a.dir) * a.k.radius * 0.85,
          y: a.g.position.y + a.k.headY,
          z: az - Math.cos(a.dir) * a.k.radius * 0.85,
          r: a.k.radius * 0.45, head: true,
        },
      ];
      for (const s of spheres) {
        tmp.set(s.x - origin.x, s.y - origin.y, s.z - origin.z);
        const proj = tmp.dot(dir);
        if (proj < 0 || proj > bestT) continue;
        const perp2 = tmp.lengthSq() - proj * proj;
        if (perp2 > s.r * s.r) continue;
        bestT = proj;
        best = { animal: a, headshot: s.head, dist: proj, point: new THREE.Vector3().copy(dir).multiplyScalar(proj).add(origin) };
      }
    }
    return best;
  }

  /** Ближайший зверь в ближнем бою в конусе. */
  meleeTarget(origin, dir, range, cos) {
    let best = null, bd = 1e9;
    for (const a of this.list) {
      if (a.dead) continue;
      const dx = origin.x + wrapDelta(a.x - origin.x) - origin.x;
      const dz = origin.z + wrapDelta(a.z - origin.z) - origin.z;
      const dy = a.g.position.y + a.k.radius - origin.y;
      const d = Math.hypot(dx, dy, dz);
      if (d > range + a.k.radius) continue;
      const dot = (dx * dir.x + dy * dir.y + dz * dir.z) / (d || 1);
      if (dot < cos) continue;
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }

  bloodBurst(x, y, z, n = 14, color = 0x8a1010) {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3);
    const v = [];
    for (let i = 0; i < n; i++) {
      p[i * 3] = 0; p[i * 3 + 1] = 0; p[i * 3 + 2] = 0;
      v.push(new THREE.Vector3(
        (Math.random() - 0.5) * 3.4, Math.random() * 3.2 + 0.6, (Math.random() - 0.5) * 3.4));
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({
      color, size: 0.13, transparent: true, opacity: 1, depthWrite: false,
    }));
    pts.userData = { v, t: 0, wx: x, wz: z, wy: y };
    pts.frustumCulled = false;
    this.root.add(pts);
    this.blood.push(pts);
  }

  update(dt, player) {
    for (const a of this.list) a.update(dt, player, this);


    // выкладываем зверей вокруг игрока с учётом зацикливания
    for (const a of this.list) {
      const ox = player.x + wrapDelta(a.x - player.x);
      const oz = player.z + wrapDelta(a.z - player.z);
      a.g.position.x = ox;
      a.g.position.z = oz;
      a.g.traverse((o) => {
        if (o.isMesh && o.material && o.material.transparent !== undefined) { /* оставляем как есть */ }
      });
      if (a.dead && a.fade < 1) {
        a.g.visible = a.fade > 0.02;
        a.g.scale.setScalar(a.k.scale * Math.max(0.02, a.fade));
      }
    }

    // кровь
    for (let i = this.blood.length - 1; i >= 0; i--) {
      const b = this.blood[i];
      const u = b.userData;
      u.t += dt;
      const pos = b.geometry.attributes.position;
      for (let k = 0; k < u.v.length; k++) {
        const v = u.v[k];
        v.y -= 9 * dt;
        pos.setXYZ(k, pos.getX(k) + v.x * dt, pos.getY(k) + v.y * dt, pos.getZ(k) + v.z * dt);
      }
      pos.needsUpdate = true;
      b.material.opacity = Math.max(0, 1 - u.t / 1.1);
      b.position.set(
        player.x + wrapDelta(u.wx - player.x), u.wy, player.z + wrapDelta(u.wz - player.z));
      if (u.t > 1.1) {
        this.root.remove(b);
        b.geometry.dispose(); b.material.dispose();
        this.blood.splice(i, 1);
      }
    }

    // уборка
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i].remove) { this.list[i].dispose(); this.list.splice(i, 1); }
    }
  }

  clear() {
    for (const a of this.list) a.dispose();
    this.list.length = 0;
    for (const b of this.blood) { this.root.remove(b); b.geometry.dispose(); b.material.dispose(); }
    this.blood.length = 0;
  }
}
