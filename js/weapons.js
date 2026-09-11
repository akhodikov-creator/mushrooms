import * as THREE from 'three';
import { mergeParts } from './geo.js';
import { Audio } from './audio.js';
import { clamp, dampTo, lerp } from './utils.js';

const MAT_VM = new THREE.MeshLambertMaterial({ vertexColors: true });

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

/* ---------- модель ножа (грибной, с изогнутым лезвием) ---------- */
function buildKnife() {
  const p = [];
  // рукоять — дерево
  const h = new THREE.CylinderGeometry(0.019, 0.024, 0.11, 8);
  h.rotateX(Math.PI / 2);
  h.translate(0, 0, 0.055);
  p.push(paint(h, 0x6b4a26));
  p.push(box(0.05, 0.012, 0.012, 0, 0, -0.005, 0xb8b0a0));  // упор
  // лезвие
  const b = new THREE.BoxGeometry(0.009, 0.042, 0.15);
  b.translate(0, 0.008, -0.082);
  p.push(paint(b, 0xd8dce2));
  const tip = new THREE.ConeGeometry(0.022, 0.055, 4);
  tip.rotateX(-Math.PI / 2);
  tip.scale(0.5, 1, 1);
  tip.translate(0, 0.008, -0.178);
  p.push(paint(tip, 0xe2e6ea));
  // щёточка на торце рукояти — как на настоящих грибных ножах
  const br = new THREE.CylinderGeometry(0.016, 0.02, 0.03, 7);
  br.rotateX(Math.PI / 2);
  br.translate(0, 0, 0.125);
  p.push(paint(br, 0xc9a24a));
  return new THREE.Mesh(mergeParts(p), MAT_VM);
}

/* ---------- модель ТТ ---------- */
function buildPistol() {
  const g = new THREE.Group();
  const p = [];
  const steel = 0x3a3e45, steel2 = 0x4a4f57;
  p.push(box(0.032, 0.055, 0.2, 0, 0.012, -0.055, steel));       // рамка
  p.push(box(0.028, 0.02, 0.13, 0, 0.048, -0.09, steel2));        // ствол/кожух
  p.push(box(0.016, 0.016, 0.03, 0, 0.048, -0.16, 0x1c1e22));     // срез ствола
  // рукоять с накладками
  const grip = new THREE.BoxGeometry(0.034, 0.11, 0.05);
  grip.translate(0, -0.05, 0.02);
  const gg = grip.clone();
  gg.rotateX(-0.22);
  p.push(paint(gg, 0x4a3418));
  p.push(box(0.012, 0.03, 0.016, 0, -0.012, -0.012, 0x1a1c20));   // спусковой крючок
  p.push(box(0.026, 0.008, 0.06, 0, -0.018, -0.028, steel));      // спусковая скоба
  p.push(box(0.006, 0.008, 0.008, 0, 0.064, -0.15, 0xb0b4ba));    // мушка
  const body = new THREE.Mesh(mergeParts(p), MAT_VM);
  g.add(body);

  // затвор — двигается при выстреле
  const slide = new THREE.Mesh(box(0.033, 0.026, 0.145, 0, 0.048, -0.06, 0x484d55), MAT_VM);
  g.add(slide);
  g.userData.slide = slide;

  // вспышка
  const flash = new THREE.Mesh(
    new THREE.ConeGeometry(0.05, 0.14, 5),
    new THREE.MeshBasicMaterial({ color: 0xffd070, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  flash.rotation.x = -Math.PI / 2;
  flash.position.set(0, 0.048, -0.24);
  flash.visible = false;
  g.add(flash);
  g.userData.flash = flash;

  const fl = new THREE.PointLight(0xffc060, 0, 12, 2);
  fl.position.set(0, 0.05, -0.2);
  g.add(fl);
  g.userData.light = fl;

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
    this.current = 'knife';
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

    this.root = new THREE.Group();
    camera.add(this.root);

    // Персональный свет для модели в руках: лес бывает тёмным,
    // а оружие игрок должен видеть всегда.
    const vmLight = new THREE.PointLight(0xfff2dc, 2.2, 1.9, 1.6);
    vmLight.position.set(0.25, 0.15, 0.15);
    this.root.add(vmLight);

    this.knife = buildKnife();
    this.pistol = buildPistol();
    this.root.add(this.knife, this.pistol);
    this.pistol.visible = false;

    this.basePos = {
      knife: new THREE.Vector3(0.23, -0.24, -0.46),
      pistol: new THREE.Vector3(0.12, -0.17, -0.38),
    };
    this.baseRot = {
      knife: new THREE.Euler(-0.34, -0.95, 0.5),
      pistol: new THREE.Euler(0.02, 0.06, 0),
    };
    this._place();
  }

  _place() {
    this.knife.position.copy(this.basePos.knife);
    this.knife.rotation.copy(this.baseRot.knife);
    this.pistol.position.copy(this.basePos.pistol);
    this.pistol.rotation.copy(this.baseRot.pistol);
  }

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
    this.knife.visible = w === 'knife';
    this.pistol.visible = w === 'pistol';
    this.kick = 0.9;
    this.reloadT = 0;
    Audio.noise({ dur: 0.07, gain: 0.07, type: 'bandpass', freq: 1700, q: 3 });
    return true;
  }

  toggle() { this.select(this.current === 'knife' ? 'pistol' : 'knife'); }

  reload() {
    if (this.current !== 'pistol' || this.reloadT > 0) return;
    if (this.mag >= this.magSize || this.reserve <= 0) return;
    this.reloadT = 1.25;
    Audio.reload();
  }

  /** Основное действие. Возвращает описание события для игры. */
  attack(player, onHit) {
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
        const killed = t.damage(52, false);
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
    p.light.intensity = 9;
    this.flashT = 0.055;

    const hit = this.animals.raycast(origin, dir, 140);
    const end = hit ? hit.point : origin.clone().add(dir.clone().multiplyScalar(140));
    this._tracer(origin.clone().add(dir.clone().multiplyScalar(0.5)), end);

    if (hit) {
      const a = hit.animal;
      const killed = a.damage(hit.headshot ? 74 : 62, hit.headshot);
      this.animals.bloodBurst(
        a.x, hit.point.y, a.z, hit.headshot ? 22 : 14, hit.headshot ? 0xb01414 : 0x8a1010);
      onHit?.({ animal: a, killed, weapon: 'pistol', headshot: hit.headshot });
      return { hit: true, headshot: hit.headshot };
    }
    return { hit: false };
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
    this.kick = dampTo(this.kick, 0, 11, dt);
    this.kickRot = dampTo(this.kickRot, 0, 9, dt);

    if (this.flashT > 0) {
      this.flashT -= dt;
      if (this.flashT <= 0) {
        this.pistol.userData.flash.visible = false;
        this.pistol.userData.light.intensity = 0;
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

    const w = this.current === 'knife' ? this.knife : this.pistol;
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
    this.current = 'knife';
    this.knife.visible = true;
    this.pistol.visible = false;
    this.mag = 0; this.reserve = 0;
    this.cooldown = 0; this.swing = 0; this.reloadT = 0;
    this._place();
  }
}
