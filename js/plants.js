/* ============================================================
   Кит низкополигональных растений
   ============================================================
   assets/plants.glb — только геометрия, без материалов: у каждого
   растения меш «__bark» (кора) и меш «__leaf» (вся листва). Листва
   всех тридцати растений разложена в один атлас assets/plants.webp,
   поэтому на весь лес хватает двух материалов, а трава, клевер и
   ромашки чанка сливаются в один вызов отрисовки.

   Материалы собирает world.js: им нужен шейдер ветра, который живёт
   там же. Здесь только геометрия и две текстуры.
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const PARTS = new Map();      // 'Tree-01-1' -> { bark, leaf }
let TEX = null;               // { atlas, bark }
let loaded = false;

export function plantsLoaded() { return loaded; }
export function plantParts(name) { return PARTS.get(name) || null; }
export function plantTextures() { return TEX; }

/** Есть ли в ките всё перечисленное. Ошибка в имени не должна ронять лес. */
export function hasPlants(...names) {
  return loaded && names.every((n) => PARTS.has(n));
}

/**
 * Белый вершинный цвет обязателен.
 *
 * Все материалы мира объявлены с vertexColors, а инстансы тонируются
 * через setColorAt. Если у геометрии нет атрибута color, WebGL
 * подставляет ноль и растение выходит угольно-чёрным — на этом уже
 * один раз сгорел мох.
 */
function paintWhite(geo) {
  if (geo.getAttribute('color')) return geo;
  const n = geo.getAttribute('position').count;
  const c = new Float32Array(n * 3);
  c.fill(1);
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

/**
 * Загрузка кита. Никогда не отклоняется: если файла нет или он битый,
 * возвращает false, и мир просто остаётся на процедурных кустах.
 */
export function loadPlants(base = 'assets/') {
  if (loaded) return Promise.resolve(true);
  const tl = new THREE.TextureLoader();
  const tex = (url, repeat) => tl.loadAsync(url).then((t) => {
    t.colorSpace = THREE.SRGBColorSpace;
    // Развёртка приходит из glb в его же соглашении (начало сверху),
    // а TextureLoader по умолчанию переворачивает картинку.
    t.flipY = false;
    // Кора замощена по стволу, атлас — наоборот: за край ячейки
    // выходить нельзя, иначе в листву затекает соседняя клетка.
    t.wrapS = t.wrapT = repeat ? THREE.RepeatWrapping : THREE.ClampToEdgeWrapping;
    t.anisotropy = 4;
    return t;
  });

  return Promise.all([
    new GLTFLoader().loadAsync(base + 'plants.glb'),
    tex(base + 'plants.webp', false),
    tex(base + 'plants_bark.webp', true),
  ]).then(([glb, atlas, bark]) => {
    TEX = { atlas, bark };
    glb.scene.traverse((o) => {
      if (!o.isMesh) return;
      const m = /^(.+)__(bark|leaf)$/.exec(o.name);
      if (!m) return;
      const rec = PARTS.get(m[1]) || {};
      rec[m[2]] = paintWhite(o.geometry);
      PARTS.set(m[1], rec);
    });
    loaded = PARTS.size > 0;
    return loaded;
  }).catch((e) => {
    console.warn('кит растений не загрузился, остаёмся на процедурных:', e);
    return false;
  });
}

/**
 * Копия геометрии, поставленная в нужный рост.
 *
 * Кит собран в метрах, а игре нужны свои размеры: трава кита 1.34 м
 * при высоте боровика 12 см — гриб утонул бы с головой.
 * height — желаемая высота при масштабе инстанса 1.
 */
export function scaledPart(name, part, height) {
  const p = PARTS.get(name);
  if (!p || !p[part]) return null;
  const g = p[part].clone();
  if (height) {
    g.computeBoundingBox();
    const h = g.boundingBox.max.y - g.boundingBox.min.y;
    if (h > 1e-4) g.scale(height / h, height / h, height / h);
  }
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
}

/**
 * Пара «ствол + крона» под заданную высоту дерева.
 * Обе части масштабируются одинаково, иначе крона слезет со ствола.
 */
export function scaledTree(name, height) {
  const p = PARTS.get(name);
  if (!p || !p.bark || !p.leaf) return null;
  const box = new THREE.Box3();
  for (const g of [p.bark, p.leaf]) {
    g.computeBoundingBox();
    box.union(g.boundingBox);
  }
  const h = box.max.y - box.min.y;
  const k = (height && h > 1e-4) ? height / h : 1;
  const out = {};
  for (const tag of ['bark', 'leaf']) {
    const g = p[tag].clone();
    g.scale(k, k, k);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    out[tag] = g;
  }
  return out;
}
