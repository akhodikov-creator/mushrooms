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

/**
 * Освобождает буферы поддерева.
 *
 * clear() и remove() только отцепляют объект от родителя — геометрия
 * остаётся в видеопамяти до перезагрузки страницы. Тару пересобирают
 * на каждый апгрейд и на каждый новый день (reset ставит tier = -1),
 * так что за сессию из десятка забегов набирается десяток брошенных
 * мешей. Материалы при этом не трогаем: они общие на всю игру, и
 * освободить их значит обнулить заодно чужие меши.
 */
function disposeGeometries(node) {
  // Сетки скачанной тары общие с загруженной моделью (instance делит
  // геометрию): их не выбрасываем, иначе каждая смена тары заливала бы
  // ведро в видеопамять заново.
  node.traverse((o) => { if (o.isMesh && o.geometry && !o.userData.sharedGeo) o.geometry.dispose(); });
}

/* Горка грибов в таре: материал один на всю игру. Раньше он заводился
   заново вместе с мешем при каждой смене тары. */
const MAT_FILL = new THREE.MeshStandardMaterial({
  color: 0x9a6a3a, roughness: 0.85, metalness: 0,
});

/* Стенки вёдер и лукошка — открытые цилиндры без толщины. С обычным
   отсечением изнанки задняя стенка изнутри пропадала, и сквозь тару
   была видна трава: двусторонний материал закрывает дыру и не требует
   лепить второй слой геометрии. */
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
    vertexColors: true, side: THREE.DoubleSide, map: metalTex(), roughness: 0.4, metalness: 0.75,
  }),
  wicker: new THREE.MeshStandardMaterial({
    vertexColors: true, side: THREE.DoubleSide, map: woodTex(), roughness: 0.8, metalness: 0,
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

/* ------------------------------------------------------------
   Скачанные модели тары и сапог (см. ASSETS в config.js).
   Текстуры лежат рядом с .glb файлами — грузим их один раз.
   ------------------------------------------------------------ */
const texCache = new Map();
function assetTex(url, srgb) {
  if (!url) return null;
  if (texCache.has(url)) return texCache.get(url);
  const t = new THREE.TextureLoader().load(url);
  t.flipY = false;                    // развёртка из glb
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  texCache.set(url, t);
  return t;
}

const bucketMats = new Map();
/** Пластик ведра нужного цвета: у скана корпус сплошной, цвет — наш. */
function bucketMat(hex) {
  let m = bucketMats.get(hex);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color: hex, roughness: 0.5, metalness: 0,
      normalMap: assetTex(ASSETS.bucket && ASSETS.bucket.nrm, false),
      side: THREE.DoubleSide,
      // отражение неба как у остальной тары: в полную силу пластик
      // выходил молочным, будто стеклянный
      envMapIntensity: 0.35,
    });
    bucketMats.set(hex, m);
  }
  return m;
}
let MAT_HANDLE = null, MAT_BASKET = null, MAT_BOOT = null;

/**
 * Вписать скачанную тару в кулак.
 *
 * Горка грибов (setFill) и хват рассчитаны на прежнюю процедурную тару:
 * ободок на 3 см ниже начала координат, ручка — горизонтально вдоль X.
 * Сюда модель и ставится: ужимается до радиуса ободка, ободок — на
 * −0,03, верх ручки отдаётся как gripY. У лукошка ручка может лежать
 * вдоль любой оси — разворачиваем по верхним точкам.
 */
function fitContainer(model, radius) {
  model.traverse((o) => { if (o.isMesh) o.userData.sharedGeo = true; });
  model.updateMatrixWorld(true);
  const pts = [];
  const v = new THREE.Vector3();
  model.traverse((o) => {
    if (!o.isMesh) return;
    const p = o.geometry.attributes.position;
    for (let i = 0; i < p.count; i += 2) pts.push(v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).clone());
  });
  const box = new THREE.Box3().setFromPoints(pts);
  const H = box.max.y - box.min.y;
  // ручка: самые верхние точки; её направление в плане — главная ось их разброса
  const top = pts.filter((p) => p.y > box.max.y - H * 0.08);
  const cx = top.reduce((s, p) => s + p.x, 0) / top.length, cz = top.reduce((s, p) => s + p.z, 0) / top.length;
  let sxx = 0, szz = 0, sxz = 0;
  for (const p of top) { const dx = p.x - cx, dz = p.z - cz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
  // угол главной оси от X; поворачиваем на него обратно — ручка ляжет вдоль X
  const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const rot = new THREE.Matrix4().makeRotationY(ang);
  for (const p of pts) p.applyMatrix4(rot);
  // ободок: самая высокая полоса, где сетка почти во всю ширину
  const b2 = new THREE.Box3().setFromPoints(pts);
  const W = Math.max(b2.max.x - b2.min.x, b2.max.z - b2.min.z);
  const bins = 40;
  let rimY = b2.min.y + H * 0.6;
  for (let i = bins - 1; i >= 0; i--) {
    const y0 = b2.min.y + H * i / bins, y1 = y0 + H / bins;
    let mnx = 1e9, mxx = -1e9, mnz = 1e9, mxz = -1e9;
    for (const p of pts) {
      if (p.y < y0 || p.y >= y1) continue;
      mnx = Math.min(mnx, p.x); mxx = Math.max(mxx, p.x); mnz = Math.min(mnz, p.z); mxz = Math.max(mxz, p.z);
    }
    if (mxx > mnx && Math.min(mxx - mnx, mxz - mnz) > W * 0.8) { rimY = y1; break; }
  }
  const k = radius / (W / 2);
  const inner = new THREE.Group();
  inner.add(model);
  inner.rotation.y = ang;
  const g = new THREE.Group();
  g.add(inner);
  g.scale.setScalar(k);
  const ccx = (b2.min.x + b2.max.x) / 2, ccz = (b2.min.z + b2.max.z) / 2;
  g.position.set(-ccx * k, -0.03 - rimY * k, -ccz * k);
  const wrap = new THREE.Group();
  wrap.add(g);
  wrap.userData.gripY = -0.03 + (b2.max.y - rimY) * k - 0.004;
  return wrap;
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

  const shaftParts = [];
  if (boots) {
    // резиновый сапог: высокое голенище, раструб и рифлёная подошва.
    // Голенище отдельным мешем: когда приедет модель сапога, оно прячется.
    const shaft = new THREE.CylinderGeometry(0.092, 0.084, 0.36, 12);
    shaft.rotateX(-0.06);
    shaft.translate(x, FOOT + 0.2, -0.115);
    shaftParts.push(paint(shaft, 0x2a3a40));
    const cuff = new THREE.CylinderGeometry(0.1, 0.092, 0.055, 12);
    cuff.rotateX(-0.06);
    cuff.translate(x, FOOT + 0.38, -0.125);
    shaftParts.push(paint(cuff, 0x3c5058));

  } else {
    // обычный кирзовый ботинок
    const boot = new THREE.CylinderGeometry(0.086, 0.08, 0.17, 10);
    boot.rotateX(-0.06);
    boot.translate(x, FOOT + 0.1, -0.105);
    shoe.push(paint(boot, 0x4a3a2a));

  }

  const g = group([[MAT.cloth, cloth], [boots ? MAT.rubber : MAT.leather, shoe]]);
  const shaftMesh = shaftParts.length ? new THREE.Mesh(mergeParts(shaftParts), MAT.rubber) : null;
  if (shaftMesh) g.add(shaftMesh);

  // Сама ступня — отдельным узлом: её подменяет скачанная модель, когда
  // догрузится. Модель одна на обе ноги, левая получается зеркалом.
  const node = new THREE.Group();
  node.position.set(x, FOOT - (boots ? 0.055 : 0.048), -0.225);
  node.scale.x = side;
  fillFoot(node, boots, shaftMesh);
  onAsset('feet', () => fillFoot(node, boots, shaftMesh));
  if (boots) onAsset('boots', () => fillFoot(node, boots, shaftMesh));
  g.add(node);

  return g;
}

/** Наполняет узел ступни: внешняя модель или коробка с носком. */
function fillFoot(node, boots, shaftMesh) {
  node.clear();
  // Сапог целиком — со своим голенищем, процедурное тогда не нужно.
  const boot = boots ? instance('boots') : null;
  if (boot) {
    if (!MAT_BOOT) {
      MAT_BOOT = new THREE.MeshStandardMaterial({
        map: assetTex(ASSETS.boots.tex, true), normalMap: assetTex(ASSETS.boots.nrm, false),
        roughness: 0.42, metalness: 0, envMapIntensity: 0.5,
      });
    }
    boot.traverse((o) => { if (o.isMesh) o.material = MAT_BOOT; });
    // голенище скана стоит над пяткой — сдвигаем, чтобы оно пришлось
    // под штанину, и чуть шире: скан снят с узкой ноги
    boot.scale.set(1.25, 1.1, 1.1);
    boot.position.set(0, 0.012, 0.03);
    node.add(boot);
    if (shaftMesh) shaftMesh.visible = false;
    return;
  }
  if (shaftMesh) shaftMesh.visible = true;
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
  if (model === 'basket') {
    const m = instance('basket');
    if (m) {
      if (!MAT_BASKET) {
        MAT_BASKET = new THREE.MeshStandardMaterial({
          map: assetTex(ASSETS.basket.tex, true), roughness: 0.85, metalness: 0, side: THREE.DoubleSide,
          envMapIntensity: 0.3,
          // плетёнка в скане снята при ярком свете и на солнце в игре
          // выгорала добела — приглушаем и чуть утепляем
          color: 0xb89c74,
        });
      }
      m.traverse((o) => { if (o.isMesh) o.material = MAT_BASKET; });
      return fitContainer(m, 0.15);
    }
  } else if (model && model.startsWith('pail')) {
    const m = instance('bucket');
    if (m) {
      const size = { pail3: 0.105, pail5: 0.125, pail10: 0.155 }[model] || 0.12;
      const col = { pail3: 0xe6e8ea, pail5: 0x3f72c0, pail10: 0xc8402e }[model] || 0xe6e8ea;
      if (!MAT_HANDLE) MAT_HANDLE = new THREE.MeshStandardMaterial({ color: 0xb4b8be, roughness: 0.35, metalness: 0.85, envMapIntensity: 1.1 });
      m.traverse((o) => { if (o.isMesh) o.material = o.name === 'handle' ? MAT_HANDLE : bucketMat(col); });
      return fitContainer(m, size);
    }
  }
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
  // Голая рука, а на дальнем конце — закатанный рукав. Заодно он
  // затыкает срез запястья модели: у неё он на 0,10 м от кисти, и
  // открытым читается как плоский лоскут.
  const arm = new THREE.CylinderGeometry(0.039, 0.047, 0.14, 14);
  arm.rotateX(A);
  arm.translate(0.004, HAND_GRIP + dy * 0.115, dz * 0.115);
  const roll = new THREE.CylinderGeometry(0.052, 0.050, 0.055, 14);
  roll.rotateX(A);
  roll.translate(0.008, HAND_GRIP + dy * 0.20, dz * 0.20);
  cloth.push(paint(roll, 0x8e9a72));
  g.add(new THREE.Mesh(arm, MAT.skin));
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
    model.traverse((o) => {
      if (o.isMesh) o.material = o.material && o.material.name === 'basicRigSkin' ? MAT.nail : MAT.skin;
    });
    poseHandBones(model, cfg.fistCurl, cfg.bendAxis, cfg.bendSign, cfg.thumbAxis, cfg.thumbSign);
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
    // Модели тары могут приехать позже, чем собрана первая тара.
    const refresh = () => {
      const t = this.tier;
      this.tier = -1;
      this.setContainer(t);
      if (this.fill !== undefined) this.setFill(this.fill);
    };
    onAsset('bucket', refresh);
    onAsset('basket', refresh);

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
    disposeGeometries(this.containerNode);
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
      this.fillMesh = new THREE.Mesh(g, MAT_FILL);
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
