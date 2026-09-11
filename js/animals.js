import * as THREE from 'three';
import { mergeParts } from './geo.js';
import { CONFIG } from './config.js';
import { Audio } from './audio.js';
import {
  TAU, terrainHeight, wrapCoord, wrapDelta, clamp, lerp, dampTo, isWater, WATER_LEVEL,
} from './utils.js';

const MAT_ANIMAL = new THREE.MeshLambertMaterial({ vertexColors: true });
const MAT_EYE = new THREE.MeshBasicMaterial({ color: 0xff2200 });

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
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return paint(g, col, jit);
};
const sph = (r, x, y, z, col, sx = 1, sy = 1, sz = 1, jit = 0) => {
  const g = new THREE.SphereGeometry(r, 8, 6);
  g.scale(sx, sy, sz);
  g.translate(x, y, z);
  return paint(g, col, jit);
};

/* ============================================================
   МОДЕЛИ
   Ориентация: «вперёд» у всех зверей — это -Z.
   ============================================================ */

function buildBear() {
  const g = new THREE.Group();
  const fur = 0x4a3122, fur2 = 0x3a251a;
  const body = [];
  // корпус
  body.push(sph(0.62, 0, 0, 0.15, fur, 1.05, 0.98, 1.65, 0.16));
  // горб на загривке — узнаваемая черта
  body.push(sph(0.42, 0, 0.3, -0.45, fur2, 1.0, 0.85, 0.95, 0.14));
  body.push(sph(0.3, 0, -0.05, 0.95, fur, 1.0, 0.9, 0.9, 0.1));
  const bodyMesh = new THREE.Mesh(mergeParts(body), MAT_ANIMAL);
  bodyMesh.position.y = 0.92;
  g.add(bodyMesh);

  // голова
  const head = new THREE.Group();
  const hp = [];
  hp.push(sph(0.31, 0, 0, 0, fur2, 1.0, 0.95, 1.05, 0.1));
  hp.push(sph(0.17, 0, -0.08, -0.32, 0x2a1c12, 0.9, 0.8, 1.25, 0.1));   // морда
  hp.push(sph(0.055, 0, -0.03, -0.52, 0x120c08));                        // нос
  hp.push(sph(0.11, -0.24, 0.24, 0.06, fur2, 1, 1, 0.55));               // уши
  hp.push(sph(0.11, 0.24, 0.24, 0.06, fur2, 1, 1, 0.55));
  head.add(new THREE.Mesh(mergeParts(hp), MAT_ANIMAL));
  const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.042, 6, 4), MAT_EYE);
  e1.position.set(-0.13, 0.07, -0.26);
  const e2 = e1.clone(); e2.position.x = 0.13;
  head.add(e1, e2);
  head.position.set(0, 1.18, -0.92);
  g.add(head);

  // лапы
  const legs = [];
  for (const [lx, lz] of [[-0.38, -0.5], [0.38, -0.5], [-0.36, 0.62], [0.36, 0.62]]) {
    const lg = new THREE.Group();
    const parts = [
      box(0.26, 0.72, 0.3, 0, -0.36, 0, fur2, 0.12),
      sph(0.17, 0, -0.72, -0.04, 0x1c1208, 1.1, 0.6, 1.3),
    ];
    lg.add(new THREE.Mesh(mergeParts(parts), MAT_ANIMAL));
    lg.position.set(lx, 0.86, lz);
    g.add(lg);
    legs.push(lg);
  }
  return { g, head, legs, bodyMesh };
}

function buildBoar() {
  const g = new THREE.Group();
  const hide = 0x2e2620, hide2 = 0x1f1a16;
  const body = [];
  body.push(sph(0.44, 0, 0, 0.1, hide, 1.0, 1.0, 1.5, 0.18));
  body.push(sph(0.3, 0, 0.12, -0.42, hide2, 1.0, 0.9, 0.9, 0.14));
  // щетина на хребте
  for (let i = 0; i < 7; i++) {
    const c = new THREE.ConeGeometry(0.04, 0.26, 4);
    c.rotateX(-0.5);
    c.translate(0, 0.46 - i * 0.012, -0.5 + i * 0.16);
    body.push(paint(c, 0x4a4038, 0.2));
  }
  const bodyMesh = new THREE.Mesh(mergeParts(body), MAT_ANIMAL);
  bodyMesh.position.y = 0.62;
  g.add(bodyMesh);

  const head = new THREE.Group();
  const hp = [];
  hp.push(sph(0.26, 0, 0, -0.1, hide2, 0.92, 0.95, 1.3, 0.1));
  hp.push(sph(0.14, 0, -0.06, -0.42, 0x3a3028, 0.85, 0.72, 1.0));      // рыло
  hp.push(sph(0.09, -0.16, 0.2, 0.02, hide2, 0.7, 1.2, 0.4));          // уши
  hp.push(sph(0.09, 0.16, 0.2, 0.02, hide2, 0.7, 1.2, 0.4));
  // клыки
  for (const s of [-1, 1]) {
    const t = new THREE.ConeGeometry(0.035, 0.26, 5);
    t.rotateX(-2.5);
    t.rotateZ(s * 0.3);
    t.translate(s * 0.1, -0.05, -0.46);
    hp.push(paint(t, 0xe8e2d0));
  }
  head.add(new THREE.Mesh(mergeParts(hp), MAT_ANIMAL));
  const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.032, 6, 4), MAT_EYE);
  e1.position.set(-0.12, 0.06, -0.28);
  const e2 = e1.clone(); e2.position.x = 0.12;
  head.add(e1, e2);
  head.position.set(0, 0.76, -0.58);
  g.add(head);

  const legs = [];
  for (const [lx, lz] of [[-0.24, -0.34], [0.24, -0.34], [-0.22, 0.44], [0.22, 0.44]]) {
    const lg = new THREE.Group();
    lg.add(new THREE.Mesh(box(0.15, 0.52, 0.16, 0, -0.26, 0, hide2, 0.12), MAT_ANIMAL));
    lg.position.set(lx, 0.56, lz);
    g.add(lg);
    legs.push(lg);
  }
  return { g, head, legs, bodyMesh };
}

function buildWolf() {
  const g = new THREE.Group();
  const fur = 0x6b6660, fur2 = 0x4e4a45;
  const body = [];
  body.push(sph(0.3, 0, 0, 0.05, fur, 1.0, 0.95, 1.7, 0.16));
  body.push(sph(0.24, 0, 0.08, -0.38, fur2, 1.0, 0.9, 0.9, 0.12));
  // хвост
  const tail = new THREE.CylinderGeometry(0.09, 0.04, 0.6, 5);
  tail.rotateX(1.1);
  tail.translate(0, 0.12, 0.62);
  body.push(paint(tail, fur2, 0.18));
  const bodyMesh = new THREE.Mesh(mergeParts(body), MAT_ANIMAL);
  bodyMesh.position.y = 0.7;
  g.add(bodyMesh);

  const head = new THREE.Group();
  const hp = [];
  hp.push(sph(0.19, 0, 0, -0.06, fur2, 0.95, 0.95, 1.15, 0.1));
  hp.push(sph(0.1, 0, -0.05, -0.3, 0x3a3632, 0.8, 0.7, 1.3));
  hp.push(sph(0.045, 0, -0.03, -0.46, 0x141210));
  for (const s of [-1, 1]) {
    const ear = new THREE.ConeGeometry(0.075, 0.2, 4);
    ear.translate(s * 0.11, 0.22, 0.02);
    hp.push(paint(ear, fur2, 0.1));
  }
  head.add(new THREE.Mesh(mergeParts(hp), MAT_ANIMAL));
  const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 4), new THREE.MeshBasicMaterial({ color: 0xffd020 }));
  e1.position.set(-0.09, 0.05, -0.22);
  const e2 = e1.clone(); e2.position.x = 0.09;
  head.add(e1, e2);
  head.position.set(0, 0.82, -0.5);
  g.add(head);

  const legs = [];
  for (const [lx, lz] of [[-0.16, -0.26], [0.16, -0.26], [-0.15, 0.34], [0.15, 0.34]]) {
    const lg = new THREE.Group();
    lg.add(new THREE.Mesh(box(0.1, 0.6, 0.11, 0, -0.3, 0, fur2, 0.12), MAT_ANIMAL));
    lg.position.set(lx, 0.66, lz);
    g.add(lg);
    legs.push(lg);
  }
  return { g, head, legs, bodyMesh };
}

function buildHarius() {
  // ХАРИУС. Огромный парусный плавник — как в жизни, только злее.
  const g = new THREE.Group();
  const silver = 0xa8b4bc, dark = 0x4a5a66;
  const body = [];
  body.push(sph(0.3, 0, 0, 0, silver, 0.62, 0.95, 1.9, 0.1));
  body.push(sph(0.16, 0, 0.02, -0.46, dark, 0.72, 0.9, 1.0, 0.08));      // голова
  // раскрытая пасть
  const jawG = new THREE.ConeGeometry(0.13, 0.2, 6);
  jawG.rotateX(-Math.PI / 2);
  jawG.translate(0, -0.03, -0.62);
  body.push(paint(jawG, 0xb04a52));
  // парус-плавник с фиолетовым крапом
  const fin = new THREE.PlaneGeometry(0.78, 0.44, 4, 2);
  const fp = fin.attributes.position;
  for (let i = 0; i < fp.count; i++) {
    const t = (fp.getX(i) + 0.39) / 0.78;
    fp.setY(i, fp.getY(i) * (0.55 + Math.sin(t * Math.PI) * 0.85));
  }
  fin.rotateY(Math.PI / 2);
  fin.translate(0, 0.42, -0.02);
  body.push(paint(fin, 0x7a4a9c, 0.3));
  // хвост
  const tail = new THREE.PlaneGeometry(0.34, 0.42);
  tail.rotateY(Math.PI / 2);
  tail.translate(0, 0.02, 0.52);
  body.push(paint(tail, dark, 0.2));
  // брюшные плавники
  for (const s of [-1, 1]) {
    const pf = new THREE.PlaneGeometry(0.24, 0.16);
    pf.rotateX(Math.PI / 2 + s * 0.5);
    pf.translate(s * 0.16, -0.1, -0.2);
    body.push(paint(pf, 0x8a96a0, 0.2));
  }
  const bodyMesh = new THREE.Mesh(mergeParts(body), MAT_ANIMAL);
  bodyMesh.material = new THREE.MeshLambertMaterial({
    vertexColors: true, side: THREE.DoubleSide, emissive: 0x101820,
  });
  bodyMesh.position.y = 0.32;          // лежит на брюхе, а не утоплен в землю
  g.add(bodyMesh);

  const head = new THREE.Group();
  const e1 = new THREE.Mesh(new THREE.SphereGeometry(0.06, 7, 5), new THREE.MeshBasicMaterial({ color: 0xfff0a0 }));
  e1.position.set(-0.1, 0.38, -0.44);
  const e2 = e1.clone(); e2.position.x = 0.1;
  const p1 = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), new THREE.MeshBasicMaterial({ color: 0x000000 }));
  p1.position.set(-0.13, 0.38, -0.46);
  const p2 = p1.clone(); p2.position.x = 0.13;
  head.add(e1, e2, p1, p2);
  g.add(head);

  return { g, head, legs: [], bodyMesh };
}

/* ============================================================
   Типы
   ============================================================ */
export const KINDS = {
  bear: {
    name: 'МЕДВЕДЬ', build: buildBear, hp: 330, scale: 1.0,
    approach: 4.6, chargeSpeed: 15.6, telegraph: 1.3, chargeTime: 1.55,
    recover: 1.5, radius: 0.95, maxCharges: 4, instakill: true, damage: 999,
    lockDist: 6.2, chargeTurn: 1.9, engageRange: 17, sound: 'bear', headY: 1.2, bonus: CONFIG.killBonusBear,
    corrida: true, aggroMusic: 1.0,
  },
  boar: {
    name: 'КАБАН', build: buildBoar, hp: 150, scale: 1.0,
    approach: 5.4, chargeSpeed: 14.2, telegraph: 0.85, chargeTime: 1.3,
    recover: 1.1, radius: 0.7, maxCharges: 5, instakill: false, damage: 58,
    lockDist: 5.2, chargeTurn: 2.4, engageRange: 14, sound: 'boar', headY: 0.8, bonus: CONFIG.killBonusBoar,
    corrida: true, aggroMusic: 0.7,
  },
  wolf: {
    name: 'ВОЛК', build: buildWolf, hp: 90, scale: 1.0,
    approach: 6.6, chargeSpeed: 11.2, telegraph: 0.5, chargeTime: 0.8,
    recover: 0.7, radius: 0.55, maxCharges: 99, instakill: false, damage: 17,
    lockDist: 3.8, chargeTurn: 3.4, engageRange: 22, sound: 'wolf', headY: 0.85, bonus: CONFIG.killBonusWolf,
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

    const m = this.k.build();
    this.g = m.g;
    this.head = m.head;
    this.legs = m.legs;
    this.bodyMesh = m.bodyMesh;
    this.g.scale.setScalar(this.k.scale);
    this.g.userData.animal = this;
    mgr.root.add(this.g);
  }

  dispose() {
    this.mgr.root.remove(this.g);
    this.g.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); });
  }

  damage(amount, headshot) {
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

  update(dt, player, mgr) {
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
        moveSpeed = this.k.approach;
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
        if (player.dodging) this.playerDodged = true;   // ушёл рывком, а не пешком
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

    if (this.k.jumper) {
      // хариус вращается и хлопает в полёте — тот самый кринж
      this.g.rotation.x = Math.sin(this.animT * 9) * 0.5 - (this.jumpY > 0.1 ? 0.35 : 0);
      this.bodyMesh.rotation.z = Math.sin(this.animT * 16) * 0.32;
    } else if (this.head) {
      this.head.rotation.x = this.state === 'telegraph'
        ? Math.sin(this.animT * 20) * 0.14 - 0.2
        : Math.sin(this.animT * rate * 0.5) * 0.06;
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
