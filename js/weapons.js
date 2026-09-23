import * as THREE from 'three';
import { mergeParts } from './geo.js';
import { Audio } from './audio.js';
import { metalTex, woodTex, skinTex, clothTex } from './textures.js';
import { buildHandGeometry } from './handmesh.js';
import { onAsset, instance, poseHandBones } from './assets.js';
import { ASSETS } from './config.js';
import { MAT_MUSHROOM as MAT_HARVEST } from './mushrooms.js';
import { clamp, dampTo, lerp } from './utils.js';

/* ============================================================
   Модели в руках. Отдельные PBR-материалы: дерево, вороненая
   сталь, латунь — с картой окружения металл наконец блестит.
   ============================================================ */
const texMetal = metalTex();
const texWood = woodTex();

const VM = {
  steel: new THREE.MeshStandardMaterial({
    vertexColors: true, map: texMetal, roughness: 0.34, metalness: 0.92,
  }),
  blade: new THREE.MeshStandardMaterial({
    vertexColors: true, map: texMetal, roughness: 0.14, metalness: 1.0,
  }),
  wood: new THREE.MeshStandardMaterial({
    vertexColors: true, map: texWood, roughness: 0.72, metalness: 0.0,
  }),
  brass: new THREE.MeshStandardMaterial({
    vertexColors: true, map: texMetal, roughness: 0.3, metalness: 0.95,
  }),
  rubber: new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.94, metalness: 0.0,
  }),
  skin: new THREE.MeshStandardMaterial({
    map: skinTex(), roughness: 0.74, metalness: 0.0,
  }),
  nail: new THREE.MeshStandardMaterial({
    color: 0xdcb49e, roughness: 0.28, metalness: 0.0,
  }),
  cloth: new THREE.MeshStandardMaterial({
    vertexColors: true, map: clothTex(), roughness: 0.95, metalness: 0.0,
  }),
};

export function applyWeaponEnv(env) {
  for (const m of Object.values(VM)) {
    m.envMap = env;
    m.envMapIntensity = (m === VM.skin || m === VM.cloth || m === VM.nail) ? 0.35 : 1.35;
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
const box = (w, h, d, x, y, z, col) => {
  const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); return paint(g, col);
};

/** Собирает группу из кусков, разложенных по материалам. */
function assemble(groups) {
  const g = new THREE.Group();
  for (const [mat, parts] of groups) {
    if (!parts.length) continue;
    const m = new THREE.Mesh(mergeParts(parts), mat);
    m.castShadow = false;
    g.add(m);
  }
  return g;
}

/* ============================================================
   Кисть руки берётся из handmesh.js — там она собирается
   меташарами в одну гладкую оболочку. Здесь только ставим её
   на место и добавляем манжету куртки.
   ============================================================ */

/**
 * Узел кисти. Сам узел несёт матрицу посадки, а внутри лежит либо
 * процедурная кисть, либо подгруженная модель — так её можно
 * заменить на лету, когда приедет .glb.
 */
function handSlot(side, pose, m) {
  const node = new THREE.Group();
  node.matrixAutoUpdate = false;
  node.matrix.copy(m);
  node.userData.hand = { side, pose };
  fillHand(node);

  // если для рук настроена внешняя модель — подменим, когда загрузится
  onAsset('hands', () => fillHand(node));
  return node;
}

/** Наполняет узел кисти: модель, если она есть, иначе процедурная. */
function fillHand(node) {
  const { side, pose } = node.userData.hand;
  node.clear();

  const model = instance('hands');
  if (model) {
    // Скачанная модель — всегда одна конкретная рука; вторая получается
    // зеркалом. Какая именно пришла, записано в конфиге: определять на
    // глаз бесполезно, кулак с обеих сторон выглядит одинаково.
    const cfg = ASSETS.hands;
    if (side !== (cfg.side || 1)) model.scale.x *= -1;
    // тот же материал, что у предплечья: иначе на запястье виден стык
    // Ногти у новой модели — отдельная сетка со своим материалом
    // (basicRigSkin), им — материал ногтей.
    model.traverse((o) => {
      if (o.isMesh) o.material = o.material && o.material.name === 'basicRigSkin' ? VM.nail : VM.skin;
    });
    const curls = pose === 'fist' ? cfg.fistCurl : cfg.openCurl;
    // знак сгиба от стороны не зависит: зеркало применяется к целой
    // кисти вместе со скелетом и само переворачивает позу
    const bones = poseHandBones(model, curls, cfg.bendAxis, cfg.bendSign, cfg.thumbAxis, cfg.thumbSign);
    if (!bones) {
      console.info('[hands] в модели нет костей — поза остаётся как в файле');
    }
    node.add(model);
    return;
  }

  const src = buildHandGeometry(side, pose);
  node.add(new THREE.Mesh(src.skin, VM.skin));
  node.add(new THREE.Mesh(src.nails, VM.nail));
}

/**
 * Предплечье, поставленное матрицей m: голая рука и закатанный
 * по локоть рукав на дальнем конце. Строится вдоль +Z и уходит
 * от запястья назад.
 */
function sleeveAt(m) {
  const skin = [], cloth = [];

  const arm = new THREE.CylinderGeometry(0.039, 0.047, 0.13, 14);
  arm.rotateX(Math.PI / 2);
  arm.translate(0, 0, 0.08);
  arm.applyMatrix4(m);
  skin.push(arm);

  // закатанный рукав: валик ткани, чтобы рука не обрывалась в пустоте
  const roll = new THREE.CylinderGeometry(0.052, 0.050, 0.055, 14);
  roll.rotateX(Math.PI / 2);
  roll.translate(0, 0, 0.158);
  roll.applyMatrix4(m);
  cloth.push(paint(roll, 0x8e9a72));

  return { skin, cloth };
}

/**
 * Матрица посадки кисти, заданная по смыслу, а не стопкой углов.
 *
 * grip — вдоль чего идёт обхват: линия, по которой в кулаке лежит
 *        рукоять (она же — куда смотрит большой палец);
 * wrist — куда от кисти уходит предплечье.
 *
 * Кулак устроен так, что запястье перпендикулярно обхвату, поэтому
 * wrist только уточняется: его составляющая вдоль grip отбрасывается.
 * Ладонь после этого определяется однозначно — рука-то правая.
 */
function gripBasis(grip, wrist, pos) {
  const x = grip.clone().normalize();
  const z = wrist.clone().addScaledVector(x, -wrist.dot(x)).normalize();
  const y = new THREE.Vector3().crossVectors(z, x);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(pos);
}

/* Докуда у кисти тянется запястье: туда садится манжета. У модели
   срез приходится на 0.10 м, у процедурной кисти культя чуть длиннее —
   манжета шириной 5,5 см закрывает оба варианта. */
const WRIST_Z = 0.070;

/**
 * Рука в сборе: кисть плюс уходящее от неё предплечье.
 *
 * Раньше кисть и рукав ставились независимыми матрицами. Стоило
 * тронуть хват — предплечье уезжало не туда, а у скачанной модели
 * оставался открыт срез запястья и читался как плоский лоскут.
 * Теперь и то и другое висит на одном якоре: рукав растёт вдоль оси
 * запястья и всегда затыкает срез.
 *
 * Система якоря — та же, в которой собрана процедурная кисть:
 * пальцы в -Z, запястье в +Z, тыл ладони в +Y, ось обхвата — X.
 * bend слегка опускает предплечье относительно кисти.
 */
function armAt(side, pose, m, bend = 0) {
  const arm = new THREE.Group();
  arm.matrixAutoUpdate = false;
  arm.matrix.copy(m);

  arm.add(handSlot(side, pose, new THREE.Matrix4()));

  const cuffM = new THREE.Matrix4().makeRotationX(bend);
  cuffM.premultiply(new THREE.Matrix4().makeTranslation(0, 0, WRIST_Z));
  const fore = sleeveAt(cuffM);
  arm.add(assemble([[VM.skin, fore.skin], [VM.cloth, fore.cloth]]));
  return arm;
}

/** Пустая правая рука — ей и собирают грибы. */
function buildBareHand() {
  // Ладонь раскрыта и тянется к грибу: пальцы вперёд-вниз, большой
  // отведён вверх, предплечье уходит назад-вправо к плечу.
  const m = gripBasis(
    new THREE.Vector3(-0.20, 0.94, -0.28),      // большой палец
    new THREE.Vector3(0.45, -0.55, 0.70),       // куда уходит предплечье
    new THREE.Vector3(0, 0, 0.02)
  );
  const g = new THREE.Group();
  g.add(armAt(1, 'open', m, -0.12));
  return g;
}

/* ---------- грибной нож: изогнутое лезвие, щётка на торце ---------- */
function knifeGeometry() {
  const steel = [], wood = [], brass = [];

  // рукоять — точёный профиль под пальцы
  const prof = [];
  for (let i = 0; i <= 12; i++) {
    const t = i / 12;
    const r = 0.019 + Math.sin(t * Math.PI) * 0.0075 + t * 0.004;
    prof.push(new THREE.Vector2(r, t * 0.115));
  }
  const h = new THREE.LatheGeometry(prof, 14);
  h.rotateX(Math.PI / 2);
  h.translate(0, 0, 0.012);
  wood.push(paint(h, 0x8a6234));

  // латунная больстер-шайба
  const bol = new THREE.CylinderGeometry(0.0235, 0.0215, 0.012, 14);
  bol.rotateX(Math.PI / 2);
  bol.translate(0, 0, 0.006);
  brass.push(paint(bol, 0xc8a54a));

  // клинок: сужается и загибается кверху, с фаской
  const bl = new THREE.BoxGeometry(0.0075, 0.032, 0.145, 1, 3, 10);
  const bp = bl.attributes.position;
  for (let i = 0; i < bp.count; i++) {
    const z = bp.getZ(i);
    const t = (-z + 0.0725) / 0.145;            // 0 у рукояти, 1 у острия
    const taper = 1 - t * t * 0.72;
    bp.setX(i, bp.getX(i) * (1 - Math.abs(bp.getY(i)) * 22));  // фаска к режущей кромке
    bp.setY(i, bp.getY(i) * taper + t * t * 0.012);            // подъём острия
  }
  bl.computeVertexNormals();
  bl.translate(0, 0.004, -0.078);
  steel.push(paint(bl, 0xd6dae0));

  // щётка на торце рукояти
  const br = new THREE.CylinderGeometry(0.017, 0.021, 0.026, 12);
  br.rotateX(Math.PI / 2);
  br.translate(0, 0, 0.132);
  wood.push(paint(br, 0xd8b45c));

  return assemble([[VM.steel, steel], [VM.wood, wood], [VM.brass, brass]]);
}

/**
 * Наполняет узел ножа: скачанная модель, если она есть, иначе своя.
 * Материалы модели заменяются на оружейные по именам мешей — в FBX
 * их всё равно нет, а рисованные текстуры со сталью и деревом лучше
 * любой заглушки.
 */
const KNIFE_TINT = { steel: 0xd6dae0, wood: 0x8a6234, brass: 0xc8a54a };

function fillKnife(node) {
  node.clear();
  const model = instance('knife');
  if (model) {
    const parts = ASSETS.knife.parts || {};
    model.traverse((o) => {
      if (!o.isMesh) return;
      const kind = parts[(o.name || '').toLowerCase()] || 'steel';
      // оружейные материалы красятся вершинным цветом; у чужой модели
      // его нет, и без этого она выходит чёрной
      paint(o.geometry, KNIFE_TINT[kind]);
      o.material = VM[kind];
    });
    node.add(model);
    return;
  }
  node.add(knifeGeometry());
}

function buildKnife() {
  const g = new THREE.Group();

  const blade = new THREE.Group();
  fillKnife(blade);
  onAsset('knife', () => fillKnife(blade));
  g.add(blade);

  // «Тычковый» хват: рукоять лежит в кулаке вдоль Z, большой палец
  // вытянут по ней к клинку, предплечье уходит вниз-вправо за кадр.
  const m = gripBasis(
    new THREE.Vector3(0, 0, -1),                // обхват вдоль рукояти, к клинку
    new THREE.Vector3(0.62, -0.62, 0.30),       // предплечье
    new THREE.Vector3(0.002, -0.004, 0.062)
  );
  g.add(armAt(1, 'fist', m, -0.10));
  return g;
}

/* ---------- ТТ: рамка, затвор с насечкой, накладки ---------- */
function pistolGeometry() {
  const steel = [], wood = [], brass = [];
  const dark = 0x6a6f78, darker = 0x565b64;

  // рамка
  steel.push(box(0.030, 0.048, 0.19, 0, 0.010, -0.05, dark));
  // спусковая скоба
  const guard = new THREE.TorusGeometry(0.021, 0.0045, 6, 14, Math.PI * 1.15);
  guard.rotateY(Math.PI / 2);
  guard.rotateZ(-0.5);
  guard.translate(0, -0.017, -0.030);
  steel.push(paint(guard, dark));
  steel.push(box(0.008, 0.026, 0.010, 0, -0.008, -0.030, 0x3c4048));   // крючок

  // рукоять с наклоном
  const grip = new THREE.BoxGeometry(0.031, 0.115, 0.046, 1, 3, 1);
  const gp = grip.attributes.position;
  for (let i = 0; i < gp.count; i++) {
    const t = (gp.getY(i) + 0.0575) / 0.115;
    gp.setZ(i, gp.getZ(i) + (1 - t) * 0.028);      // наклон назад
    gp.setX(i, gp.getX(i) * (0.92 + t * 0.1));
  }
  grip.computeVertexNormals();
  grip.translate(0, -0.062, 0.012);
  steel.push(paint(grip, darker));
  // деревянные накладки по бокам
  for (const sx of [-1, 1]) {
    const pl = new THREE.BoxGeometry(0.005, 0.098, 0.040, 1, 3, 1);
    const pp = pl.attributes.position;
    for (let i = 0; i < pp.count; i++) {
      const t = (pp.getY(i) + 0.049) / 0.098;
      pp.setZ(i, pp.getZ(i) + (1 - t) * 0.026);
    }
    pl.computeVertexNormals();
    pl.translate(sx * 0.0168, -0.062, 0.012);
    wood.push(paint(pl, 0x6b4a24));
  }
  // звезда на накладке — как на настоящем ТТ
  for (const sx of [-1, 1]) {
    const st = new THREE.CylinderGeometry(0.008, 0.008, 0.002, 5);
    st.rotateZ(Math.PI / 2);
    st.translate(sx * 0.0192, -0.055, 0.014);
    brass.push(paint(st, 0xc9a94e));
  }
  // пятка магазина
  steel.push(box(0.032, 0.008, 0.044, 0, -0.118, 0.024, darker));

  // курок
  const ham = new THREE.CylinderGeometry(0.011, 0.011, 0.009, 10, 1, false, 0, Math.PI);
  ham.rotateZ(Math.PI / 2);
  ham.rotateY(Math.PI / 2);
  ham.translate(0, 0.040, 0.036);
  steel.push(paint(ham, 0x3c4048));

  // мушка
  steel.push(box(0.005, 0.007, 0.008, 0, 0.062, -0.138, 0xb8bcc4));
  // целик
  steel.push(box(0.014, 0.006, 0.008, 0, 0.060, 0.026, 0xb8bcc4));

  const body = assemble([
    [VM.steel, steel], [VM.wood, wood], [VM.brass, brass],
  ]);

  // затвор — отдельной деталью, ездит при выстреле
  const sl = [];
  sl.push(box(0.032, 0.030, 0.150, 0, 0.044, -0.055, 0x767c86));
  // насечка на затворе
  for (let i = 0; i < 9; i++) {
    sl.push(box(0.0335, 0.024, 0.0028, 0, 0.044, 0.004 + i * 0.006, 0x4e535c));
  }
  // срез ствола
  const muz = new THREE.CylinderGeometry(0.0075, 0.0075, 0.016, 12);
  muz.rotateX(Math.PI / 2);
  muz.translate(0, 0.044, -0.136);
  sl.push(paint(muz, 0x24282e));

  return { body, slide: new THREE.Mesh(mergeParts(sl), VM.steel) };
}

/**
 * Наполняет узлы пистолета: скачанная модель или своя.
 * У модели затвор отдельной деталью не выделить — меши в ней
 * называются Plane003 и Cube, — поэтому при выстреле дёргается вся
 * рука целиком, а узел затвора остаётся пустым.
 */
function fillPistol(gun, slide) {
  gun.clear();
  slide.clear();
  const model = instance('pistol');
  if (model) {
    model.traverse((o) => {
      if (!o.isMesh) return;
      paint(o.geometry, 0x9aa0aa);     // оружейным материалам нужен вершинный цвет
      o.material = VM.steel;
    });
    gun.add(model);
    return;
  }
  const parts = pistolGeometry();
  gun.add(parts.body);
  slide.add(parts.slide);
}

function buildPistol() {
  // Рукоять наклонена назад — вдоль неё и идёт обхват кулака,
  // большой палец смотрит вверх к затвору.
  const gripAxis = new THREE.Vector3(0, 0.965, -0.262);
  const mR = gripBasis(gripAxis, new THREE.Vector3(0.42, -0.60, 0.68),
    new THREE.Vector3(-0.002, -0.050, 0.026));

  const gun = new THREE.Group();
  const slide = new THREE.Group();
  fillPistol(gun, slide);
  onAsset('pistol', () => fillPistol(gun, slide));

  const g = new THREE.Group();
  g.add(gun, slide);
  // Держим одной рукой: левая занята тарой, и вторая кисть на рукояти
  // читалась третьей рукой в кадре.
  g.add(armAt(1, 'fist', mR, -0.16));
  g.userData.slide = slide;

  // дульная вспышка
  const flash = new THREE.Mesh(
    new THREE.ConeGeometry(0.055, 0.16, 6),
    new THREE.MeshBasicMaterial({
      color: 0xffd070, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false,
    })
  );
  flash.rotation.x = -Math.PI / 2;
  flash.position.set(0, 0.044, -0.22);
  flash.visible = false;
  g.add(flash);
  g.userData.flash = flash;


  return g;
}

/* ============================================================
   Оружие игрока
   ============================================================ */
export class Weapons {
  constructor(camera, animals, scene) {
    this.camera = camera;
    this.animals = animals;
    this.scene = scene;

    this.has = { knife: true, pistol: false };
    // Правая рука занята чем-то одним: либо она пустая и собирает
    // грибы, либо в ней оружие. Совмещать нельзя — это и есть цена
    // за то, чтобы быть готовым к зверю.
    this.current = 'hands';
    this.lastWeapon = 'knife';
    this.ammo = 0;
    this.mag = 0;
    this.magSize = 8;          // ТТ: 8 патронов
    this.reserve = 0;

    this.cooldown = 0;
    this.swing = 0;
    this.reloadT = 0;
    this.kick = 0;
    this.kickRot = 0;
    this.sway = new THREE.Vector2();
    this.tracers = [];
    this.pickT = 0;          // замах за грибом
    this.harvest = [];       // сорванные грибы в полёте

    this.root = new THREE.Group();
    camera.add(this.root);

    // Персональный свет для модели в руках: лес бывает тёмным,
    // а оружие игрок должен видеть всегда.
    const vmLight = new THREE.PointLight(0xfff2dc, 2.2, 1.9, 1.6);
    vmLight.position.set(0.25, 0.15, 0.15);
    this.root.add(vmLight);

    // Вспышка выстрела висит на корне, а не в группе пистолета: вместе
    // с пистолетом она пропадала из сцены, число источников менялось,
    // и three пересобирал все шейдеры при каждой смене оружия.
    this.flashLight = new THREE.PointLight(0xffc060, 0, 14, 2);
    this.flashLight.position.set(0.12, 0.0, -0.45);
    this.root.add(this.flashLight);

    this.knife = buildKnife();
    this.pistol = buildPistol();
    this.bare = buildBareHand();
    this.root.add(this.knife, this.pistol, this.bare);
    this.knife.visible = false;
    this.pistol.visible = false;

    this.basePos = {
      hands: new THREE.Vector3(0.235, -0.215, -0.38),
      knife: new THREE.Vector3(0.185, -0.145, -0.385),
      pistol: new THREE.Vector3(0.115, -0.125, -0.47),
    };
    this.baseRot = {
      hands: new THREE.Euler(-0.05, -0.52, 0.05),
      // «тычковый» хват: клинок смотрит вперёд-влево, как в CS
      knife: new THREE.Euler(-0.26, 0.38, 0.30),
      pistol: new THREE.Euler(0.02, 0.20, -0.05),
    };
    this._place();
  }

  _place() {
    for (const k of ['hands', 'knife', 'pistol']) {
      const o = this.obj(k);
      o.position.copy(this.basePos[k]);
      o.rotation.copy(this.baseRot[k]);
    }
  }

  obj(mode) {
    return mode === 'knife' ? this.knife : mode === 'pistol' ? this.pistol : this.bare;
  }

  /** Можно ли сейчас рвать грибы: только пустой рукой. */
  get canPick() { return this.current === 'hands'; }
  get armed() { return this.current !== 'hands'; }

  givePistol(ammo = 8) {
    const first = !this.has.pistol;
    this.has.pistol = true;
    if (first) { this.mag = Math.min(this.magSize, ammo); this.reserve = Math.max(0, ammo - this.mag); }
    else this.addAmmo(ammo);
    return first;
  }

  addAmmo(n) {
    this.reserve += n;
    return n;
  }

  get totalAmmo() { return this.mag + this.reserve; }

  select(w) {
    if (w === 'pistol' && !this.has.pistol) return false;
    if (this.current === w) return false;
    this.current = w;
    if (w !== 'hands') this.lastWeapon = w;
    this.knife.visible = w === 'knife';
    this.pistol.visible = w === 'pistol';
    this.bare.visible = w === 'hands';
    this.kick = 0.9;
    this.reloadT = 0;
    Audio.noise({ dur: 0.07, gain: 0.07, type: 'bandpass', freq: 1700, q: 3 });
    return true;
  }

  /** ПКМ: мгновенно спрятать оружие или достать последнее. */
  toggle() {
    if (this.armed) this.select('hands');
    else if (!this.select(this.lastWeapon)) this.select('knife');
  }

  reload() {
    if (this.current !== 'pistol' || this.reloadT > 0) return;
    if (this.mag >= this.magSize || this.reserve <= 0) return;
    this.reloadT = 1.25;
    Audio.reload();
  }

  /** Основное действие. Возвращает описание события для игры. */
  attack(player, onHit) {
    if (this.current === 'hands') return null;
    if (this.cooldown > 0 || this.reloadT > 0) return null;

    const dir = new THREE.Vector3();
    this.camera.getWorldDirection(dir);
    const origin = this.camera.position.clone();

    if (this.current === 'knife') {
      this.cooldown = 0.42;
      this.swing = 0.42;
      Audio.knifeSwing();
      const t = this.animals.meleeTarget(origin, dir, 2.5, 0.55);
      if (t) {
        const killed = t.damage(52, false, 'knife');
        this.animals.bloodBurst(t.x, t.g.position.y + t.k.radius, t.z, 12);
        Audio.hit(true);
        onHit?.({ animal: t, killed, weapon: 'knife', headshot: false });
        return { hit: true };
      }
      return { hit: false };
    }

    // пистолет
    if (this.mag <= 0) {
      this.cooldown = 0.3;
      Audio.dryFire();
      if (this.reserve > 0) this.reload();
      return { dry: true };
    }
    this.mag--;
    this.cooldown = 0.21;
    this.kick = 1;
    this.kickRot = 1;
    player.recoilKick += 0.055;
    Audio.gunshot();

    const p = this.pistol.userData;
    p.flash.visible = true;
    p.flash.rotation.z = Math.random() * 6.28;
    p.flash.scale.setScalar(0.8 + Math.random() * 0.5);
    this.flashLight.intensity = 9;
    this.flashT = 0.055;

    const hit = this.animals.raycast(origin, dir, 140);
    const end = hit ? hit.point : origin.clone().add(dir.clone().multiplyScalar(140));
    this._tracer(origin.clone().add(dir.clone().multiplyScalar(0.5)), end);

    if (hit) {
      const a = hit.animal;
      const killed = a.damage(hit.headshot ? 74 : 62, hit.headshot, 'pistol');
      this.animals.bloodBurst(
        a.x, hit.point.y, a.z, hit.headshot ? 22 : 14, hit.headshot ? 0xb01414 : 0x8a1010);
      onHit?.({ animal: a, killed, weapon: 'pistol', headshot: hit.headshot });
      return { hit: true, headshot: hit.headshot };
    }
    return { hit: false };
  }

  /** Рука тянется вниз за грибом. */
  playPick() {
    this.pickT = 0.5;
  }

  /**
   * Сорванный гриб: подпрыгивает, крутится и улетает вниз-влево,
   * «в корзину». Без этого сбор выглядит как мгновенное исчезновение.
   */
  harvestFx(geometry, worldPos, rot, dropPoint) {
    const m = new THREE.Mesh(geometry, MAT_HARVEST);
    m.position.copy(worldPos);
    if (rot) m.rotation.copy(rot);
    m.frustumCulled = false;
    this.scene.add(m);
    this.harvest.push({ m, t: 0, from: worldPos.clone(), spin: (Math.random() - 0.5) * 12, dropPoint });

    // облачко спор у ножки
    const n = 9;
    const g = new THREE.BufferGeometry();
    const arr = new Float32Array(n * 3);
    const vel = [];
    for (let i = 0; i < n; i++) {
      vel.push(new THREE.Vector3(
        (Math.random() - 0.5) * 0.9, Math.random() * 0.7 + 0.2, (Math.random() - 0.5) * 0.9));
    }
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({
      color: 0xd8cba8, size: 0.045, transparent: true, opacity: 0.85, depthWrite: false,
    }));
    pts.position.copy(worldPos);
    pts.frustumCulled = false;
    this.scene.add(pts);
    this.harvest.push({ pts, vel, t: 0, puff: true });
  }

  _updateHarvest(dt) {
    if (!this.harvest.length) return;
    const cam = this.camera;
    const fwd = new THREE.Vector3();
    cam.getWorldDirection(fwd);
    const right = new THREE.Vector3().crossVectors(fwd, cam.up).normalize();
    // куда «складываем»: чуть ниже-левее камеры, где нарисована корзина
    const fallback = cam.position.clone()
      .add(fwd.clone().multiplyScalar(0.55))
      .add(right.multiplyScalar(-0.3))
      .add(new THREE.Vector3(0, -0.42, 0));

    for (let i = this.harvest.length - 1; i >= 0; i--) {
      const h = this.harvest[i];
      h.t += dt;

      if (h.puff) {
        const pos = h.pts.geometry.attributes.position;
        for (let k = 0; k < h.vel.length; k++) {
          const v = h.vel[k];
          v.y -= 1.4 * dt;
          pos.setXYZ(k, pos.getX(k) + v.x * dt, pos.getY(k) + v.y * dt, pos.getZ(k) + v.z * dt);
        }
        pos.needsUpdate = true;
        h.pts.material.opacity = Math.max(0, 0.85 * (1 - h.t / 0.6));
        if (h.t > 0.6) {
          this.scene.remove(h.pts);
          h.pts.geometry.dispose(); h.pts.material.dispose();
          this.harvest.splice(i, 1);
        }
        continue;
      }

      const T = 0.55;
      const k = Math.min(1, h.t / T);
      // сначала вверх из травы, потом по дуге к корзине
      const lift = Math.sin(Math.min(1, k / 0.35) * Math.PI * 0.5) * 0.45;
      const ease = k < 0.35 ? 0 : (k - 0.35) / 0.65;
      const e = ease * ease;
      // цель — горловина тары в левой руке, если она известна
      const target = h.dropPoint ? h.dropPoint() : fallback;
      h.m.position.lerpVectors(
        h.from.clone().add(new THREE.Vector3(0, lift, 0)), target, e);
      h.m.rotation.y += h.spin * dt;
      h.m.rotation.x += h.spin * 0.4 * dt;
      const sc = 1 - e * 0.85;
      h.m.scale.setScalar(Math.max(0.02, sc));
      if (k >= 1) {
        this.scene.remove(h.m);
        this.harvest.splice(i, 1);
      }
    }
  }

  _tracer(a, b) {
    const g = new THREE.BufferGeometry().setFromPoints([a, b]);
    const m = new THREE.LineBasicMaterial({
      color: 0xffe0a0, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const l = new THREE.Line(g, m);
    l.frustumCulled = false;
    this.scene.add(l);
    this.tracers.push({ l, t: 0 });
  }

  update(dt, player) {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.swing > 0) this.swing = Math.max(0, this.swing - dt);
    if (this.pickT > 0) this.pickT = Math.max(0, this.pickT - dt);
    this._updateHarvest(dt);
    this.kick = dampTo(this.kick, 0, 11, dt);
    this.kickRot = dampTo(this.kickRot, 0, 9, dt);

    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) {
        this.pistol.userData.flash.visible = false;
        this.flashLight.intensity = 0;
      }
    }

    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const need = this.magSize - this.mag;
        const take = Math.min(need, this.reserve);
        this.mag += take;
        this.reserve -= take;
      }
    }

    // покачивание в руках
    const sp = Math.min(1, (player.speed || 0) / 7);
    const t = performance.now() / 1000;
    this.sway.x = dampTo(this.sway.x, Math.sin(t * 6.2) * 0.012 * sp, 8, dt);
    this.sway.y = dampTo(this.sway.y, Math.abs(Math.cos(t * 6.2)) * 0.014 * sp, 8, dt);

    const w = this.obj(this.current);
    const bp = this.basePos[this.current];
    const br = this.baseRot[this.current];

    let px = bp.x + this.sway.x, py = bp.y - this.sway.y, pz = bp.z;
    let rx = br.x, ry = br.y, rz = br.z;

    if (this.current === 'knife' && this.swing > 0) {
      const k = 1 - this.swing / 0.42;
      const arc = Math.sin(k * Math.PI);
      rx = br.x - arc * 1.5;
      rz = br.z + arc * 0.9;
      px = bp.x - arc * 0.16;
      pz = bp.z - arc * 0.12;
      py = bp.y + arc * 0.07;
    }
    if (this.current === 'pistol') {
      pz = bp.z + this.kick * 0.055;
      py = bp.y + this.kick * 0.016;
      rx = br.x + this.kickRot * 0.28;
      const sl = this.pistol.userData.slide;
      sl.position.z = this.kick * 0.045;
      if (this.reloadT > 0) {
        const k = 1 - Math.abs(this.reloadT / 1.25 - 0.5) * 2;
        py = bp.y - k * 0.17;
        rz = br.z + k * 0.55;
        rx = br.x + k * 0.3;
      }
    }
    // замах за грибом: кисть уходит вниз-вперёд и возвращается
    if (this.pickT > 0) {
      const k = 1 - this.pickT / 0.5;
      const arc = Math.sin(k * Math.PI);
      py -= arc * 0.19;
      pz -= arc * 0.10;
      px -= arc * 0.05;
      rx += arc * 0.75;
      rz -= arc * 0.3;
    }
    if (player.dodging) { py -= 0.06; rz += 0.22; }

    w.position.set(px, py, pz);
    w.rotation.set(rx, ry, rz);

    // трассеры
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const tr = this.tracers[i];
      tr.t += dt;
      tr.l.material.opacity = Math.max(0, 0.85 * (1 - tr.t / 0.09));
      if (tr.t > 0.09) {
        this.scene.remove(tr.l);
        tr.l.geometry.dispose(); tr.l.material.dispose();
        this.tracers.splice(i, 1);
      }
    }
  }

  reset() {
    this.has.pistol = false;
    this.current = 'hands';
    this.lastWeapon = 'knife';
    this.knife.visible = false;
    this.pistol.visible = false;
    this.bare.visible = true;
    this.mag = 0; this.reserve = 0;
    this.cooldown = 0; this.swing = 0; this.reloadT = 0;
    this.pickT = 0;
    for (const h of this.harvest) this.scene.remove(h.m || h.pts);
    this.harvest.length = 0;
    this._place();
  }
}
