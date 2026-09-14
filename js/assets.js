import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as skeletonClone } from 'three/addons/utils/SkeletonUtils.js';
import { ASSETS } from './config.js';

/* ============================================================
   Необязательные внешние модели.

   Правило: игра обязана работать без них. Модель подгружается в
   фоне и заменяет процедурную заглушку, когда приедет. Нет файла,
   битый файл, отвалившаяся сеть — в консоли предупреждение, в игре
   остаётся процедурная версия.

   Как добавить модель — см. assets/README.md.
   ============================================================ */

/**
 * Загрузчик по расширению файла. Грузятся только те, что реально
 * понадобились: FBX и OBJ тянут свои модули с CDN, и если модель
 * в .glb, лишний код качать незачем.
 *
 * .blend сюда не входит намеренно: это внутренний формат Blender,
 * его не читает ни один браузерный загрузчик. Из .blend нужно
 * экспортировать .glb — см. assets/README.md.
 */
async function loaderFor(url) {
  const ext = url.split('?')[0].split('.').pop().toLowerCase();
  if (ext === 'glb' || ext === 'gltf') {
    return { load: (u, ok, pr, err) => new GLTFLoader().load(u, (g) => ok(g.scene, g.animations), pr, err) };
  }
  if (ext === 'fbx') {
    const { FBXLoader } = await import('three/addons/loaders/FBXLoader.js');
    return { load: (u, ok, pr, err) => new FBXLoader().load(u, (o) => ok(o, o.animations || []), pr, err) };
  }
  if (ext === 'obj') {
    const { OBJLoader } = await import('three/addons/loaders/OBJLoader.js');
    return { load: (u, ok, pr, err) => new OBJLoader().load(u, (o) => ok(o, []), pr, err) };
  }
  throw new Error(`формат .${ext} не поддерживается — нужен .glb, .gltf, .fbx или .obj`);
}

const slots = new Map();      // slot -> { status, root, listeners }

function slotOf(name) {
  let s = slots.get(name);
  if (!s) {
    s = { status: 'idle', root: null, listeners: [] };
    slots.set(name, s);
  }
  return s;
}

/** Настроен ли слот в config.js. */
export function hasAsset(name) {
  const a = ASSETS[name];
  return !!(a && a.url);
}

/**
 * Приводит модель к нужному масштабу и развороту.
 * fit задаётся в config.js — подгонять чужую модель приходится
 * почти всегда, и лезть за этим в код неудобно.
 */
export function applyFit(obj, fit) {
  if (!fit) return obj;

  // Полная модель человека годится под руки только если из неё можно
  // выкинуть лишнее. hide прячет по подстроке имени, only оставляет
  // лишь совпавшее. Если модель — один сплошной меш, разделить нечего.
  if (fit.hide && fit.hide.length) {
    obj.traverse((o) => {
      if (o.isMesh && fit.hide.some((k) => o.name.toLowerCase().includes(k.toLowerCase()))) {
        o.visible = false;
      }
    });
  }
  if (fit.only && fit.only.length) {
    obj.traverse((o) => {
      if (o.isMesh) {
        o.visible = fit.only.some((k) => o.name.toLowerCase().includes(k.toLowerCase()));
      }
    });
  }

  // FBX почти всегда приезжает без рабочих материалов: текстуры лежали
  // рядом с исходником и в файл не попали, поэтому модель чёрная.
  // Красим меши по именам — это дешевле, чем тащить текстуры.
  if (fit.palette) {
    obj.traverse((o) => {
      if (!o.isMesh) return;
      const col = fit.palette[(o.name || '').toLowerCase()];
      if (col === undefined) return;
      o.material = new THREE.MeshStandardMaterial({
        color: col, roughness: 0.82, metalness: 0.02,
      });
    });
  }

  const wrap = new THREE.Group();
  wrap.add(obj);
  const s = fit.scale ?? 1;
  wrap.scale.set(s, s, s);
  wrap.rotation.set(fit.rotX || 0, fit.rotY || 0, fit.rotZ || 0);
  wrap.position.set(fit.x || 0, fit.y || 0, fit.z || 0);
  return wrap;
}

/** Запускает загрузку слота. Повторный вызов безопасен. */
export function loadAsset(name) {
  const cfg = ASSETS[name];
  const s = slotOf(name);
  if (!cfg || !cfg.url || s.status === 'loading' || s.status === 'done') return;

  s.status = 'loading';
  const fail = (err) => {
    s.status = 'failed';
    s.listeners.length = 0;
    console.warn(
      `[assets] ${name}: не загрузилось (${cfg.url}). Играем на процедурной модели.`,
      err && err.message ? err.message : err
    );
  };

  loaderFor(cfg.url).then((ld) => {
    ld.load(
      cfg.url,
      (root, animations) => {
        s.root = root;
        s.animations = animations || [];
        s.status = 'done';
        root.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = false;
            o.receiveShadow = false;
            o.frustumCulled = false;
            // OBJ приходит без нормалей чаще, чем хотелось бы
            if (o.geometry && !o.geometry.attributes.normal) o.geometry.computeVertexNormals();
          }
        });
        console.info(`[assets] ${name}: модель загружена (${cfg.url})`);
        for (const cb of s.listeners) {
          try { cb(s); } catch (e) { console.warn('[assets] обработчик упал:', e); }
        }
        s.listeners.length = 0;
      },
      undefined,
      fail
    );
  }).catch(fail);
}

/**
 * Вызовет cb, когда модель слота будет готова. Если слот не настроен
 * или уже провалился — cb не вызовется никогда, и это нормально:
 * значит, остаётся процедурная версия.
 */
export function onAsset(name, cb) {
  if (!hasAsset(name)) return;
  const s = slotOf(name);
  if (s.status === 'done') { cb(s); return; }
  if (s.status === 'failed') return;
  s.listeners.push(cb);
  loadAsset(name);
}

/** Готовая копия модели слота (или null). */
export function instance(name) {
  const s = slots.get(name);
  if (!s || s.status !== 'done' || !s.root) return null;

  // Обычный clone() ломает скиннутые меши: кости в скелете копии
  // остаются от оригинала, и на GPU меш схлопывается в точку.
  // Для таких моделей есть SkeletonUtils.
  let skinned = false;
  s.root.traverse((o) => { if (o.isSkinnedMesh) skinned = true; });
  const copy = skinned ? skeletonClone(s.root) : s.root.clone(true);

  return applyFit(copy, (ASSETS[name] || {}).fit);
}

/** Стартует загрузку всех настроенных слотов. */
export function warmAssets() {
  for (const name of Object.keys(ASSETS)) loadAsset(name);
}

/* ------------------------------------------------------------
   Постановка пальцев у рига.

   Скачанные кисти почти всегда идут скелетом. Гнём пальцы по именам
   костей: у большинства бесплатных моделей они называются в стиле
   index_01 / f_index.01 / IndexFinger1 — ловим все три варианта.
   Ось сгиба у ригов разная, поэтому она задаётся в config.
   ------------------------------------------------------------ */
const FINGER_KEYS = {
  thumb: ['thumb'],
  index: ['index'],
  middle: ['middle', 'mid'],
  ring: ['ring'],
  pinky: ['pinky', 'little', 'pink'],
};

/** Разбирает имя кости: какой палец и какая фаланга. */
function parseBone(name) {
  const n = name.toLowerCase();
  for (const [finger, keys] of Object.entries(FINGER_KEYS)) {
    if (!keys.some((k) => n.includes(k))) continue;
    const m = n.match(/(\d+)\s*$/) || n.match(/[._-](\d)/);
    const joint = m ? Math.min(3, Math.max(1, parseInt(m[1], 10))) : 1;
    return { finger, joint };
  }
  return null;
}

/**
 * Сгибает пальцы модели. curls — по фалангам, в радианах.
 * Возвращает число найденных костей: ноль значит, что модель без рига
 * и позу ей задать нельзя.
 */
export function poseHandBones(root, curls, axis = 'z', sign = 1) {
  let found = 0;
  root.traverse((o) => {
    if (!o.isBone) return;
    const p = parseBone(o.name);
    if (!p) return;
    const a = (p.finger === 'thumb' ? curls.thumb : curls.finger)[p.joint - 1] || 0;
    o.rotation[axis] += a * sign;
    found++;
  });
  // Имена вроде Bone001 не разбираются, а такие риги встречаются чаще
  // осмысленных. Тогда идём по структуре скелета.
  if (!found) found = poseHandChains(root, curls, axis, sign);
  return found;
}

/**
 * Постановка пальцев по иерархии, без опоры на имена.
 * Скелет кисти всегда устроен одинаково: корневая кость запястья, от
 * неё пять цепочек. Самая короткая цепочка — большой палец. Первая
 * кость в цепочке пястная, она не гнётся; гнём со второй.
 */
export function poseHandChains(root, curls, axis = 'x', sign = 1) {
  let rootBone = null;
  root.traverse((o) => {
    if (!rootBone && o.isBone && (!o.parent || !o.parent.isBone)) rootBone = o;
  });
  if (!rootBone) return 0;

  const chains = rootBone.children.filter((c) => c.isBone);
  if (chains.length < 4) return 0;

  const chainLen = (b) => {
    let sum = 0, cur = b;
    while (cur) {
      sum += cur.position.length();
      cur = cur.children.find((c) => c.isBone);
    }
    return sum;
  };
  const lens = chains.map(chainLen);
  const thumb = lens.indexOf(Math.min(...lens));

  let n = 0;
  chains.forEach((chain, ci) => {
    const set = ci === thumb ? curls.thumb : curls.finger;
    let b = chain, depth = 0;
    while (b) {
      if (depth >= 1) {
        const a = set[depth - 1];
        if (a) { b.rotation[axis] += a * sign; n++; }
      }
      b = b.children.find((c) => c.isBone);
      depth++;
    }
  });
  return n;
}


/* ============================================================
   Инспектор: что вообще лежит в скачанной модели.
   Вызывать из консоли: window.__inspectAsset('hands')
   ============================================================ */
export function inspectAsset(name) {
  const s = slots.get(name);
  if (!s || s.status !== 'done') {
    console.warn(`[assets] ${name}: модель не загружена (статус: ${s ? s.status : 'нет слота'})`);
    return null;
  }
  const meshes = [];
  const bones = [];
  s.root.traverse((o) => {
    if (o.isMesh) {
      const n = o.geometry.attributes.position ? o.geometry.attributes.position.count : 0;
      meshes.push({ имя: o.name || '(без имени)', вершин: n, скиннед: !!o.isSkinnedMesh });
    }
    if (o.isBone) bones.push(o.name);
  });
  const box = new THREE.Box3().setFromObject(s.root);
  const size = box.getSize(new THREE.Vector3());
  const info = {
    мешей: meshes.length,
    костей: bones.length,
    габарит: {
      x: +size.x.toFixed(3), y: +size.y.toFixed(3), z: +size.z.toFixed(3),
    },
    подсказка_scale: size.y > 0 ? +(1.75 / size.y).toFixed(4) : 1,
    анимаций: (s.animations || []).length,
    меши: meshes.slice(0, 40),
    кости: bones.slice(0, 60),
  };
  console.table(meshes.slice(0, 40));
  console.info('[assets] габарит модели, м:', info.габарит,
    '| если это человек, scale ≈', info.подсказка_scale);
  return info;
}

if (typeof window !== 'undefined') window.__inspectAsset = inspectAsset;
