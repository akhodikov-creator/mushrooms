import * as THREE from 'three';
import { mergeParts } from './geo.js';
import { TAU, terrainHeight, wrapCoord, wrapDelta, isWater } from './utils.js';
import { metalTex } from './textures.js';

const MAT = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.6, metalness: 0.15,
});
const MAT_METAL = new THREE.MeshStandardMaterial({
  vertexColors: true, map: metalTex(), roughness: 0.35, metalness: 0.85,
});

export function applyPickupEnv(env) {
  for (const m of [MAT, MAT_METAL]) {
    m.envMap = env; m.envMapIntensity = 1.0; m.needsUpdate = true;
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

/* ---------- модели находок ---------- */
function buildPistolCase() {
  const p = [];
  p.push(box(0.5, 0.14, 0.34, 0, 0.07, 0, 0x4a3a24));
  p.push(box(0.52, 0.04, 0.36, 0, 0.16, 0, 0x5c4a30));
  p.push(box(0.09, 0.032, 0.13, 0, 0.19, 0.04, 0x54595f));
  p.push(box(0.05, 0.022, 0.17, 0, 0.206, -0.03, 0x6a707a));
  p.push(box(0.46, 0.02, 0.02, 0, 0.185, 0.15, 0x9a8a5a));
  return new THREE.Mesh(mergeParts(p), MAT);
}

function buildAmmo() {
  const p = [];
  // раскрытая пачка патронов — заметнее закрытой коробки
  p.push(box(0.24, 0.1, 0.16, 0, 0.05, 0, 0x9a7028));
  p.push(box(0.25, 0.015, 0.17, 0, 0.105, 0, 0xc8a038));
  const lid = new THREE.BoxGeometry(0.24, 0.012, 0.15);
  lid.rotateX(-1.1);
  lid.translate(0, 0.16, -0.11);
  p.push(paint(lid, 0xb08a30));
  for (let i = 0; i < 8; i++) {
    const c = new THREE.CylinderGeometry(0.017, 0.017, 0.062, 8);
    c.translate(-0.075 + (i % 4) * 0.05, 0.135, -0.03 + Math.floor(i / 4) * 0.05);
    p.push(paint(c, 0xe8b93c));
    const tip = new THREE.ConeGeometry(0.017, 0.026, 8);
    tip.translate(-0.075 + (i % 4) * 0.05, 0.179, -0.03 + Math.floor(i / 4) * 0.05);
    p.push(paint(tip, 0xc08a2a));
  }
  return new THREE.Mesh(mergeParts(p), MAT_METAL);
}

function buildThermos() {
  const p = [];
  const b = new THREE.CylinderGeometry(0.07, 0.075, 0.3, 14);
  b.translate(0, 0.15, 0);
  p.push(paint(b, 0x2a5f86));
  const cap = new THREE.CylinderGeometry(0.065, 0.072, 0.075, 14);
  cap.translate(0, 0.335, 0);
  p.push(paint(cap, 0xc0392b));
  const h = new THREE.TorusGeometry(0.05, 0.013, 6, 12, Math.PI);
  h.rotateY(Math.PI / 2);
  h.translate(0.085, 0.2, 0);
  p.push(paint(h, 0x2a2c30));
  return new THREE.Mesh(mergeParts(p), MAT);
}

function buildBoots() {
  const p = [];
  for (const s of [-1, 1]) {
    p.push(box(0.115, 0.28, 0.14, s * 0.085, 0.15, 0, 0x1e2a2e));
    p.push(box(0.125, 0.055, 0.27, s * 0.085, 0.032, -0.065, 0x14181a));
    p.push(box(0.12, 0.02, 0.145, s * 0.085, 0.295, 0, 0x2c3a40));
  }
  return new THREE.Mesh(mergeParts(p), MAT);
}

function buildBerries() {
  const p = [];
  // горсть брусники на листьях
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const l = new THREE.CircleGeometry(0.075, 7);
    l.rotateX(-Math.PI / 2);
    l.translate(Math.cos(a) * 0.06, 0.012, Math.sin(a) * 0.06);
    p.push(paint(l, 0x3a6b28));
  }
  for (let i = 0; i < 11; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 0.06;
    const b = new THREE.SphereGeometry(0.026, 9, 7);
    b.translate(Math.cos(a) * r, 0.038 + Math.random() * 0.02, Math.sin(a) * r);
    p.push(paint(b, 0xc41f2a));
  }
  return new THREE.Mesh(mergeParts(p), MAT);
}

function buildFlask() {
  const p = [];
  const b = new THREE.CylinderGeometry(0.085, 0.085, 0.17, 16);
  b.scale(1, 1, 0.42);
  b.translate(0, 0.09, 0);
  p.push(paint(b, 0x7c6a4a));
  const neck = new THREE.CylinderGeometry(0.028, 0.032, 0.05, 10);
  neck.translate(0, 0.195, 0);
  p.push(paint(neck, 0x5c4a30));
  const cap = new THREE.CylinderGeometry(0.034, 0.034, 0.028, 10);
  cap.translate(0, 0.232, 0);
  p.push(paint(cap, 0xc8a54a));
  return new THREE.Mesh(mergeParts(p), MAT_METAL);
}

function buildRaincoat() {
  const p = [];
  // свёрнутый плащ-дождевик
  const roll = new THREE.CylinderGeometry(0.085, 0.085, 0.34, 12);
  roll.rotateZ(Math.PI / 2);
  roll.translate(0, 0.09, 0);
  p.push(paint(roll, 0x3f6b3a));
  for (const sx of [-1, 1]) {
    const strap = new THREE.TorusGeometry(0.088, 0.012, 5, 12);
    strap.rotateY(Math.PI / 2);
    strap.translate(sx * 0.1, 0.09, 0);
    p.push(paint(strap, 0x2a2c22));
  }
  return new THREE.Mesh(mergeParts(p), MAT);
}

function buildCompass() {
  const p = [];
  const body = new THREE.CylinderGeometry(0.085, 0.09, 0.038, 18);
  body.translate(0, 0.02, 0);
  p.push(paint(body, 0x8a6a3a));
  const glass = new THREE.CylinderGeometry(0.07, 0.07, 0.008, 18);
  glass.translate(0, 0.043, 0);
  p.push(paint(glass, 0xdce8f0));
  const nd = new THREE.BoxGeometry(0.012, 0.005, 0.11);
  nd.translate(0, 0.05, 0);
  p.push(paint(nd, 0xd03028));
  return new THREE.Mesh(mergeParts(p), MAT_METAL);
}

function buildBasket() {
  const p = [];
  const b = new THREE.CylinderGeometry(0.17, 0.12, 0.18, 14, 1, true);
  b.translate(0, 0.09, 0);
  p.push(paint(b, 0xa87c44));
  const bottom = new THREE.CylinderGeometry(0.12, 0.12, 0.02, 14);
  bottom.translate(0, 0.01, 0);
  p.push(paint(bottom, 0x8a6434));
  const handle = new THREE.TorusGeometry(0.15, 0.014, 6, 16, Math.PI);
  handle.rotateY(Math.PI / 2);
  handle.translate(0, 0.18, 0);
  p.push(paint(handle, 0x8a6434));
  // грибы внутри
  for (let i = 0; i < 5; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() * 0.09;
    const cap = new THREE.SphereGeometry(0.05, 9, 6, 0, 6.28, 0, Math.PI / 2);
    cap.scale(1, 0.62, 1);
    cap.translate(Math.cos(a) * r, 0.18, Math.sin(a) * r);
    p.push(paint(cap, i % 2 ? 0x8a5a32 : 0xc2521f));
  }
  return new THREE.Mesh(mergeParts(p), MAT);
}

export const PICKUP_TYPES = {
  pistol: {
    build: buildPistolCase, label: 'ТТ и патроны', color: 0xffcc44,
    beam: 26, glow: 0xffaa22, radar: '#ffdd55',
  },
  ammo: {
    build: buildAmmo, label: 'Патроны 7,62', color: 0xffa020,
    beam: 16, glow: 0xff9820, radar: '#ffa833',
  },
  thermos: {
    build: buildThermos, label: 'Термос с чаем', color: 0x55bbee,
    beam: 9, glow: 0x3388cc, radar: '#7fd6ff',
  },
  boots: {
    build: buildBoots, label: 'Резиновые сапоги', color: 0x88ff99,
    beam: 9, glow: 0x44aa55, radar: '#88ff99',
  },
  berries: {
    build: buildBerries, label: 'Горсть брусники', color: 0xff5566,
    beam: 0, glow: 0xcc3344, radar: '#ff7788',
  },
  flask: {
    build: buildFlask, label: 'Фляжка с настойкой', color: 0xffcc88,
    beam: 9, glow: 0xcc9944, radar: '#ffcc88',
  },
  raincoat: {
    build: buildRaincoat, label: 'Плащ-дождевик', color: 0x66dd88,
    beam: 9, glow: 0x338844, radar: '#66dd88',
  },
  compass: {
    build: buildCompass, label: 'Дедов компас', color: 0xffee99,
    beam: 12, glow: 0xccaa44, radar: '#ffee99',
  },
  basket: {
    build: buildBasket, label: 'Чужое лукошко', color: 0xffbb66,
    beam: 12, glow: 0xcc8833, radar: '#ffbb66',
  },
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

    let p_beam = null;
    // Личной лампы у находки нет: она бы появлялась и исчезала вместе
    // с ней, а three на смену числа источников пересобирает все шейдеры
    // сцены. Свет берётся из общего пула мира.

    if (def.beam) {
      // Луч с затуханием кверху: находку должно быть видно издалека,
      // но столб на пол-экрана мешает смотреть на лес.
      const hgt = def.beam;
      const bg = new THREE.CylinderGeometry(0.14, 0.42, hgt, 9, 5, true);
      const bp = bg.attributes.position;
      const bc = new Float32Array(bp.count * 3);
      for (let i = 0; i < bp.count; i++) {
        const t = (bp.getY(i) + hgt / 2) / hgt;
        const a = Math.pow(1 - t, 1.8);
        bc[i * 3] = a; bc[i * 3 + 1] = a; bc[i * 3 + 2] = a;
      }
      bg.setAttribute('color', new THREE.BufferAttribute(bc, 3));
      const beam = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({
        color: def.color, transparent: true, opacity: 0.55, depthWrite: false,
        blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
        vertexColors: true, fog: false,
      }));
      beam.position.y = hgt / 2;
      g.add(beam);
      p_beam = beam;
    }

    this.root.add(g);
    const p = {
      type, def, g, mesh, beam: p_beam,
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

  update(dt, px, pz, world) {
    for (const p of this.list) {
      p.t += dt;
      p.g.position.set(
        px + wrapDelta(p.x - px),
        p.y + 0.12 + Math.sin(p.t * 1.8) * 0.07,
        pz + wrapDelta(p.z - pz)
      );
      p.mesh.rotation.y = p.t * 0.8;
      const pulse = 0.5 + Math.sin(p.t * 3.4) * 0.5;
      if (p.beam) p.beam.material.opacity = 0.38 + pulse * 0.34;
      if (world) {
        const dx = p.g.position.x - px, dz = p.g.position.z - pz;
        const d2 = dx * dx + dz * dz;
        if (d2 < 900) {
          world.requestGlow(p.g.position.x, p.g.position.y + 0.45, p.g.position.z,
            p.def.glow, 1.6 + pulse * 1.5, d2);
        }
      }
    }
  }

  clear() {
    for (const p of this.list) this.root.remove(p.g);
    this.list.length = 0;
  }
}
