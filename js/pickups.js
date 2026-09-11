import * as THREE from 'three';
import { mergeParts } from './geo.js';
import { TAU, terrainHeight, wrapCoord, wrapDelta, isWater } from './utils.js';

const MAT = new THREE.MeshLambertMaterial({ vertexColors: true });

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

/* ---------- модели находок ---------- */
function buildPistolCase() {
  const p = [];
  p.push(box(0.5, 0.14, 0.34, 0, 0.07, 0, 0x4a3a24));          // ящик
  p.push(box(0.52, 0.04, 0.36, 0, 0.16, 0, 0x5c4a30));          // крышка
  p.push(box(0.09, 0.03, 0.12, 0, 0.19, 0.04, 0x2a2c30));       // ТТ поверх
  p.push(box(0.05, 0.02, 0.16, 0, 0.205, -0.02, 0x33363c));
  p.push(box(0.46, 0.02, 0.02, 0, 0.185, 0.15, 0x8a7a4a));
  return new THREE.Mesh(mergeParts(p), MAT);
}
function buildAmmo() {
  const p = [];
  p.push(box(0.2, 0.12, 0.13, 0, 0.06, 0, 0x8a6a2a));
  p.push(box(0.21, 0.02, 0.14, 0, 0.13, 0, 0xb08a3a));
  for (let i = 0; i < 3; i++) {
    const c = new THREE.CylinderGeometry(0.016, 0.016, 0.05, 6);
    c.translate(-0.05 + i * 0.05, 0.15, 0);
    p.push(paint(c, 0xd4a636));
  }
  return new THREE.Mesh(mergeParts(p), MAT);
}
function buildThermos() {
  const p = [];
  const b = new THREE.CylinderGeometry(0.07, 0.075, 0.3, 10);
  b.translate(0, 0.15, 0);
  p.push(paint(b, 0x1f4a6a));
  const cap = new THREE.CylinderGeometry(0.065, 0.07, 0.07, 10);
  cap.translate(0, 0.33, 0);
  p.push(paint(cap, 0xc0392b));
  const h = new THREE.TorusGeometry(0.05, 0.012, 4, 8, Math.PI);
  h.rotateY(Math.PI / 2);
  h.translate(0.08, 0.2, 0);
  p.push(paint(h, 0x2a2c30));
  return new THREE.Mesh(mergeParts(p), MAT);
}
function buildBoots() {
  const p = [];
  for (const s of [-1, 1]) {
    p.push(box(0.11, 0.26, 0.14, s * 0.08, 0.13, 0, 0x1e2a2e));
    p.push(box(0.12, 0.05, 0.26, s * 0.08, 0.03, -0.06, 0x14181a));
  }
  return new THREE.Mesh(mergeParts(p), MAT);
}

export const PICKUP_TYPES = {
  pistol:  { build: buildPistolCase, label: 'ТТ и патроны', color: 0xffcc44, beam: true,  glow: 0xffaa22 },
  ammo:    { build: buildAmmo,       label: 'Патроны 7,62', color: 0xffaa33, beam: false, glow: 0xcc8822 },
  thermos: { build: buildThermos,    label: 'Термос с чаем', color: 0x55bbee, beam: false, glow: 0x3388cc },
  boots:   { build: buildBoots,      label: 'Резиновые сапоги', color: 0x88ff99, beam: false, glow: 0x44aa55 },
};

const geoCache = {};

export class Pickups {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.list = [];
  }

  spawn(type, x, z, data = {}) {
    const def = PICKUP_TYPES[type];
    if (!geoCache[type]) geoCache[type] = def.build().geometry;
    const mesh = new THREE.Mesh(geoCache[type], MAT);
    const g = new THREE.Group();
    g.add(mesh);

    const light = new THREE.PointLight(def.glow, 1.4, 7, 2);
    light.position.y = 0.4;
    g.add(light);

    if (def.beam) {
      const beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.6, 26, 8, 1, true),
        new THREE.MeshBasicMaterial({
          color: def.color, transparent: true, opacity: 0.16, depthWrite: false,
          blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        })
      );
      beam.position.y = 13;
      g.add(beam);
    }

    this.root.add(g);
    const p = {
      type, def, g, mesh, light,
      x: wrapCoord(x), z: wrapCoord(z),
      y: terrainHeight(x, z), t: Math.random() * 10, taken: false, data,
    };
    this.list.push(p);
    return p;
  }

  /** Случайная точка не в воде, на расстоянии min..max от игрока. */
  spawnRandom(type, px, pz, min = 40, max = 260, data = {}) {
    for (let i = 0; i < 40; i++) {
      const a = Math.random() * TAU;
      const d = min + Math.random() * (max - min);
      const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
      if (!isWater(x, z)) return this.spawn(type, x, z, data);
    }
    return this.spawn(type, px + 30, pz, data);
  }

  nearest(px, pz, range) {
    let best = null, bd = range;
    for (const p of this.list) {
      if (p.taken) continue;
      const d = Math.hypot(wrapDelta(p.x - px), wrapDelta(p.z - pz));
      if (d < bd) { bd = d; best = p; }
    }
    return best ? { pickup: best, dist: bd } : null;
  }

  take(p) {
    p.taken = true;
    this.root.remove(p.g);
    const i = this.list.indexOf(p);
    if (i >= 0) this.list.splice(i, 1);
  }

  update(dt, px, pz) {
    for (const p of this.list) {
      p.t += dt;
      p.g.position.set(
        px + wrapDelta(p.x - px),
        p.y + 0.12 + Math.sin(p.t * 1.8) * 0.07,
        pz + wrapDelta(p.z - pz)
      );
      p.mesh.rotation.y = p.t * 0.8;
      p.light.intensity = 1.2 + Math.sin(p.t * 3.4) * 0.45;
    }
  }

  clear() {
    for (const p of this.list) this.root.remove(p.g);
    this.list.length = 0;
  }
}
