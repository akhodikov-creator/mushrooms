import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Склейка кусков в один буфер.
 * Часть примитивов three (Icosahedron/Dodecahedron) не индексирована,
 * а mergeGeometries требует одинаковую индексацию у всех — поэтому
 * приводим всё к неиндексированному виду.
 */
export function mergeParts(parts) {
  const norm = parts.map((g) => (g.index ? g.toNonIndexed() : g));
  const merged = mergeGeometries(norm, false);
  for (let i = 0; i < norm.length; i++) {
    if (norm[i] !== parts[i]) norm[i].dispose();
  }
  if (!merged) throw new Error('mergeParts: не удалось склеить геометрию');
  return merged;
}
