import * as THREE from 'three';
import { CONFIG } from './config.js';
import { Audio } from './audio.js';
import { terrainHeight, wrapCoord, clamp, dampTo, isWater, WATER_LEVEL } from './utils.js';

export class Player {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.x = 190; this.z = 224;             // старт у приёмного пункта
    this.y = terrainHeight(this.x, this.z);
    this.yaw = 0; this.pitch = 0;
    this.vx = 0; this.vz = 0;
    this.hp = CONFIG.maxHp;
    this.stamina = CONFIG.maxStamina;
    this.alive = true;
    this.locked = false;

    this.dodgeT = 0;
    this.dodgeCd = 0;
    this.dodgeDx = 0; this.dodgeDz = 0;
    this.lastDamage = 99;
    this.bob = 0;
    this.stepAcc = 0;
    this.speedScale = 1;
    this.levelSpeed = 1;        // множитель от уровня охотника
    this.levelStamina = 0;
    this.staminaFree = false;   // настойка из фляжки
    this.carrySpeed = 1;        // множитель от веса тары
    this.carryDodge = 1;
    this.keys = Object.create(null);
    this.recoilKick = 0;
    this.hurtFlash = 0;
    this.dist = 0;
    this.chargeLine = null;   // {dx,dz} — линия тарана ближайшего зверя

    this._bindInput();
  }

  _bindInput() {
    const kd = (e) => {
      if (e.repeat) return;
      this.keys[e.code] = true;
      if (e.code === 'Space' && this.locked) {
        e.preventDefault();
        const res = this.tryDodge();
        if (this.onDodgeResult) this.onDodgeResult(res);
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.wantSprint = true;
    };
    const ku = (e) => {
      this.keys[e.code] = false;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.wantSprint = false;
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    this._onKeyDown = kd;

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const s = 0.0021 * CONFIG.mouseSensitivity;
      this.yaw -= e.movementX * s;
      this.pitch -= e.movementY * s;
      this.pitch = clamp(this.pitch, -1.45, 1.35);
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      if (this.onLockChange) this.onLockChange(this.locked);
    });
  }

  requestLock() {
    if (!this.dom.requestPointerLock) return;
    // Браузер вправе отказать (например, сразу после выхода по Esc).
    // Тогда игрок просто кликнет по экрану ещё раз — молча гасим отказ.
    try {
      const r = this.dom.requestPointerLock();
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch (e) { /* не поддерживается — играем без захвата курсора */ }
  }
  releaseLock() {
    try { if (document.pointerLockElement) document.exitPointerLock(); }
    catch (e) { /* уже отпущен */ }
  }

  /**
   * Рывок. Возвращает true, если получилось, иначе строку с причиной —
   * молчаливый отказ читается как «пробел не работает».
   */
  tryDodge() {
    if (this.dodgeT > 0) return 'уже в рывке';
    if (this.dodgeCd > 0) return 'не отдышался';

    let ix = 0, iz = 0;
    if (this.keys['KeyW']) iz += 1;
    if (this.keys['KeyS']) iz -= 1;
    if (this.keys['KeyA']) ix -= 1;
    if (this.keys['KeyD']) ix += 1;

    if (this.chargeLine) {
      // Коррида: рывок всегда ПОПЕРЁК линии тарана, иначе уворот
      // превращался бы в лотерею «куда я в тот момент смотрел».
      // Сторону выбирает A/D, а без ввода — та, куда игрок уже смещён.
      const { dx, dz } = this.chargeLine;
      let px = -dz, pz = dx;                    // перпендикуляр к линии
      let side;
      if (ix !== 0) side = Math.sign(ix);
      else {
        const sy0 = Math.sin(this.yaw), cy0 = Math.cos(this.yaw);
        const rx = cy0, rz = -sy0;              // «вправо» от игрока
        side = (rx * px + rz * pz) >= 0 ? 1 : -1;
      }
      this.dodgeDx = px * side;
      this.dodgeDz = pz * side;
    } else {
      if (ix === 0 && iz === 0) ix = 1;
      const len = Math.hypot(ix, iz);
      ix /= len; iz /= len;
      const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
      // локальный ввод → мировые оси (вперёд = -Z камеры)
      this.dodgeDx = ix * cy - iz * sy;
      this.dodgeDz = -ix * sy - iz * cy;
    }
    this.dodgeT = CONFIG.dodgeTime;
    this.dodgeCd = CONFIG.dodgeCooldown;
    // уворот от медведя не должен срываться из-за пустой полоски сил
    this.stamina = Math.max(0, this.stamina - CONFIG.dodgeCost);
    Audio.noise({ dur: 0.24, gain: 0.13, type: 'bandpass', freq: 900, sweepTo: 300, q: 0.9 });
    return true;
  }

  get dodging() { return this.dodgeT > 0; }
  /** Небольшой запас после рывка — иначе попадание «в спину» на выходе. */
  get evading() { return this.dodgeT > 0 || this.dodgeCd > CONFIG.dodgeCooldown - CONFIG.dodgeTime - 0.18; }

  /** Радиус попадания: во время рывка игрок «уходит» — цель меньше. */
  get hitRadius() { return this.evading ? 0.42 : 1.15; }

  damage(amount, src) {
    if (!this.alive) return;
    this.hp -= amount;
    this.lastDamage = 0;
    this.hurtFlash = 1;
    Audio.playerHurt();
    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      if (this.onDeath) this.onDeath(src);
    }
  }

  kill(src) { this.damage(9999, src); }

  update(dt, world) {
    const inWater = isWater(this.x, this.z);

    // ---- ввод ----
    let ix = 0, iz = 0;
    if (this.locked) {
      if (this.keys['KeyW'] || this.keys['ArrowUp']) iz += 1;
      if (this.keys['KeyS'] || this.keys['ArrowDown']) iz -= 1;
      if (this.keys['KeyA'] || this.keys['ArrowLeft']) ix -= 1;
      if (this.keys['KeyD'] || this.keys['ArrowRight']) ix += 1;
    }
    const moving = ix !== 0 || iz !== 0;
    if (moving) { const l = Math.hypot(ix, iz); ix /= l; iz /= l; }

    const sprinting = this.wantSprint && moving && this.stamina > 1 && !inWater;
    let speed = (sprinting ? CONFIG.sprintSpeed : CONFIG.walkSpeed)
      * this.speedScale * this.levelSpeed * this.carrySpeed;
    if (inWater) speed *= 0.52;

    if (sprinting && !this.staminaFree) this.stamina -= CONFIG.staminaDrain * dt;
    else this.stamina += CONFIG.staminaRegen * dt * (moving ? 0.6 : 1);
    this.stamina = clamp(this.stamina, 0, CONFIG.maxStamina + this.levelStamina);

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = ix * cy - iz * sy;
    let wz = -ix * sy - iz * cy;

    // ---- рывок ----
    if (this.dodgeT > 0) {
      this.dodgeT -= dt;
      const k = CONFIG.dodgeSpeed * this.carryDodge * (0.35 + (this.dodgeT / CONFIG.dodgeTime) * 0.9);
      wx = this.dodgeDx * k / Math.max(0.001, speed);
      wz = this.dodgeDz * k / Math.max(0.001, speed);
    }
    if (this.dodgeCd > 0) this.dodgeCd -= dt;

    const tvx = wx * speed, tvz = wz * speed;
    this.vx = dampTo(this.vx, tvx, this.dodging ? 40 : 13, dt);
    this.vz = dampTo(this.vz, tvz, this.dodging ? 40 : 13, dt);

    let nx = this.x + this.vx * dt;
    let nz = this.z + this.vz * dt;

    // деревья
    const r = world.resolveTrees(nx, nz, 0.34);
    nx = r[0]; nz = r[1];

    const dd = Math.hypot(nx - this.x, nz - this.z);
    this.dist += dd;
    this.x = wrapCoord(nx);
    this.z = wrapCoord(nz);

    // ---- земля ----
    const gh = terrainHeight(this.x, this.z);
    this.y = dampTo(this.y, gh, 16, dt);

    // ---- шаги и покачивание ----
    const sp = Math.hypot(this.vx, this.vz);
    if (sp > 0.4) {
      this.bob += dt * sp * (sprinting ? 2.0 : 1.55);
      this.stepAcc += sp * dt;
      const stride = sprinting ? 2.1 : 1.65;
      if (this.stepAcc > stride) {
        this.stepAcc = 0;
        Audio.footstep(inWater || gh < WATER_LEVEL + 0.5);
      }
    } else {
      this.bob = dampTo(this.bob, Math.round(this.bob / Math.PI) * Math.PI, 6, dt);
    }

    // ---- регенерация ----
    this.lastDamage += dt;
    if (this.lastDamage > CONFIG.hpRegenDelay && this.hp < CONFIG.maxHp) {
      this.hp = Math.min(CONFIG.maxHp, this.hp + CONFIG.hpRegenRate * dt);
    }
    this.hurtFlash = Math.max(0, this.hurtFlash - dt * 1.6);
    this.recoilKick = dampTo(this.recoilKick, 0, 9, dt);

    // ---- камера ----
    const bobY = Math.sin(this.bob * 2) * 0.042 * Math.min(1, sp / 4);
    const bobX = Math.cos(this.bob) * 0.032 * Math.min(1, sp / 4);
    const crouchWater = inWater ? -0.3 : 0;
    this.camera.position.set(
      this.x + bobX * cy,
      this.y + CONFIG.eyeHeight + bobY + crouchWater,
      this.z - bobX * sy
    );
    const roll = -bobX * 0.12 + (this.dodging ? this.dodgeDx * 0.0 : 0);
    this.camera.rotation.set(0, 0, 0);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch + this.recoilKick;
    this.camera.rotation.z = roll;

    this.inWater = inWater;
    this.sprinting = sprinting;
    this.speed = sp;
  }

  reset() {
    const c = [
      { x: 190, z: 224 }, { x: 690, z: 204 }, { x: 200, z: 704 }, { x: 700, z: 714 },
    ][(Math.random() * 4) | 0];
    this.x = c.x; this.z = c.z;
    this.y = terrainHeight(this.x, this.z);
    this.hp = CONFIG.maxHp;
    this.stamina = CONFIG.maxStamina;
    this.alive = true;
    this.levelSpeed = 1;
    this.levelStamina = 0;
    this.speedScale = 1;
    this.staminaFree = false;
    this.carrySpeed = 1;
    this.carryDodge = 1;
    this.vx = this.vz = 0;
    this.dodgeT = this.dodgeCd = 0;
    this.lastDamage = 99;
    this.hurtFlash = 0;
    this.dist = 0;
    this.chargeLine = null;
    this.yaw = Math.random() * Math.PI * 2;
    this.pitch = -0.1;
  }
}
