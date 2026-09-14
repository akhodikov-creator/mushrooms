import * as THREE from 'three';
import { mergeParts } from './geo.js';
import { Audio } from './audio.js';
import { metalTex, woodTex } from './textures.js';
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
};

export function applyWeaponEnv(env) {
  for (const m of Object.values(VM)) {
    m.envMap = env;
    m.envMapIntensity = 1.35;
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

/* ---------- грибной нож: изогнутое лезвие, щётка на торце ---------- */
function buildKnife() {
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
  const bristles = paint(br, 0xd8b45c);
  wood.push(bristles);

  const g = assemble([[VM.steel, steel], [VM.wood, wood], [VM.brass, brass]]);
  return g;
}

/* ---------- ТТ: рамка, затвор с насечкой, накладки ---------- */
function buildPistol() {
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

  const body = assemble([[VM.steel, steel], [VM.wood, wood], [VM.brass, brass]]);

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
  const slide = new THREE.Mesh(mergeParts(sl), VM.steel);

  const g = new THREE.Group();
  g.add(body, slide);
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

  const fl = new THREE.PointLight(0xffc060, 0, 14, 2);
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
      knife: new THREE.Vector3(0.22, -0.20, -0.42),
      pistol: new THREE.Vector3(0.155, -0.125, -0.34),
    };
    this.baseRot = {
      knife: new THREE.Euler(-0.12, -1.5, 0.38),
      pistol: new THREE.Euler(0.02, 0.22, -0.06),
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
