/* ============================================================
   Предметы леса: фотосканы с Poly Haven (лицензия CC0)
   ============================================================
   Пни, коряга, камни во мху, папоротник, сухие ветки. Скачаны и
   упрощены tools/ph-model.html: сканы снимались для рендера, пень там
   сорок тысяч треугольников, а в игру идёт полторы.

   В .glb только геометрия с развёрткой, текстуры лежат рядом в webp:
   <имя>_col.webp и <имя>_nrm.webp. Материалы собирает world.js — папо-
   ротнику нужен шейдер ветра, а он живёт там.

   Пока файлов нет или они битые, лес остаётся на процедурных пнях и
   камнях: загрузка никогда не отклоняется.
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export const PROP_IDS = [
  'tree_stump_01', 'tree_stump_02', 'dead_tree_trunk',
  'rock_moss_set_01', 'fern_02', 'dry_branches_medium_01',
];

const SET = new Map();       // имя -> { variants: [geo], col, nrm }
let loaded = false;

export function propsLoaded() { return loaded; }
export function prop(name) { return SET.get(name) || null; }

/** Белый вершинный цвет: материалы мира объявлены с vertexColors. */
function paintWhite(geo) {
  if (geo.getAttribute('color')) return geo;
  const c = new Float32Array(geo.getAttribute('position').count * 3).fill(1);
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return geo;
}

/**
 * Высота спила в середине пня. На неё садятся опята.
 * Берём самую высокую вершину в круге посередине, а не весь габарит:
 * у скана край спила рваный, и максимум по всему пню пришёлся бы на
 * щепу, торчащую сбоку.
 */
export function stumpTop(geo, r = 0.28) {
  const p = geo.getAttribute('position');
  let top = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), z = p.getZ(i);
    if (x * x + z * z < r * r) top = Math.max(top, p.getY(i));
  }
  return top || 0.5;
}

export function loadProps(base = 'assets/props/') {
  if (loaded) return Promise.resolve(true);
  const tl = new THREE.TextureLoader();
  const tex = (url, srgb) => tl.loadAsync(url).then((t) => {
    // развёртка из glb, а там начало отсчёта сверху
    t.flipY = false;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  }).catch(() => null);

  const one = (id) => Promise.all([
    new GLTFLoader().loadAsync(base + id + '.glb'),
    tex(base + id + '_col.webp', true),
    tex(base + id + '_nrm.webp', false),
  ]).then(([glb, col, nrm]) => {
    const found = [];
    glb.scene.traverse((o) => { if (o.isMesh) found.push([o.name || '', paintWhite(o.geometry)]); });
    // варианты по имени меша, чтобы порядок не зависел от обхода сцены
    found.sort((x, y) => x[0].localeCompare(y[0], 'en', { numeric: true }));
    const variants = found.map((f) => f[1]);
    if (variants.length && col) SET.set(id, { variants, col, nrm });
  });

  return Promise.all(PROP_IDS.map((id) => one(id).catch((e) => {
    console.warn('предмет ' + id + ' не загрузился:', e && e.message ? e.message : e);
  }))).then(() => {
    loaded = SET.size > 0;
    return loaded;
  });
}
