import * as THREE from 'three';
import { CONFIG, CONTAINERS } from './config.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { World, CAMPS } from './world.js';
import { Player } from './player.js';
import { AnimalManager, KINDS } from './animals.js';
import { Weapons } from './weapons.js';
import { Pickups } from './pickups.js';
import { Inventory } from './inventory.js';
import { Leaderboard } from './leaderboard.js';
import { MAT_MUSHROOM, MAT_MUSHROOM_HL } from './mushrooms.js';
import { clamp, lerp, dampTo, fmtNum, terrainHeight, wrapDelta, isWater } from './utils.js';

export class Game {
  constructor() {
    this.canvas = document.getElementById('c');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas, antialias: true, powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.16;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xa8b8a0, CONFIG.fogNear, CONFIG.fogFar);

    this.camera = new THREE.PerspectiveCamera(76, innerWidth / innerHeight, 0.05, 700);
    this.scene.add(this.camera);

    this.world = new World(this.scene);
    this.player = new Player(this.camera, this.canvas);
    this.animals = new AnimalManager(this.scene);
    this.weapons = new Weapons(this.camera, this.animals, this.scene);
    this.pickups = new Pickups(this.scene);
    this.inv = new Inventory();

    this.state = 'menu';
    this.dayT = 0;
    this.timeScale = 1;
    this.slowmoT = 0;
    this.shake = 0;
    this.aimed = null;
    this.bestMult = 1;
    this.nick = '';
    this.hbT = 0;
    this.lastFrame = performance.now();

    // расписание режиссёра
    this.sched = {};

    this._wireAnimals();
    this._wireInput();

    addEventListener('resize', () => this._resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
  }

  _resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }

  /* ============================================================
     Ввод
     ============================================================ */
  _wireInput() {
    this.canvas.addEventListener('mousedown', (e) => {
      if (this.state !== 'playing') return;
      if (!this.player.locked) { this.player.requestLock(); return; }
      if (e.button === 0) this._primary();
      if (e.button === 2) this.weapons.toggle();
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('wheel', () => { if (this.state === 'playing') this.weapons.toggle(); }, { passive: true });

    addEventListener('keydown', (e) => {
      if (e.code === 'Escape') {
        if (this.state === 'playing') this.pause();
        else if (this.state === 'paused') this.resume();
        return;
      }
      if (this.state !== 'playing') return;
      switch (e.code) {
        case 'KeyE': this._interact(); break;
        case 'KeyR': this.weapons.reload(); break;
        case 'Digit1': this.weapons.select('knife'); break;
        case 'Digit2':
          if (!this.weapons.select('pistol') && !this.weapons.has.pistol)
            UI.toast('Пистолета нет. Может, найдётся в лесу…', 'warn');
          break;
        case 'KeyF': this._primary(); break;
      }
    });

    this.player.onLockChange = (locked) => {
      if (!locked && this.state === 'playing') this.pause();
    };
    this.player.onDeath = (src) => this._die(src);
  }

  _primary() {
    // гриб в прицеле важнее ножа
    if (this.aimed) { this._pick(this.aimed); return; }
    this.weapons.attack(this.player, (r) => this._onWeaponHit(r));
  }

  _interact() {
    // находка рядом?
    const near = this.pickups.nearest(this.player.x, this.player.z, 2.6);
    if (near) { this._takePickup(near.pickup); return; }
    // приёмный пункт?
    const { dist } = this.world.nearestCamp(this.player.x, this.player.z);
    if (dist < 8.5) { this._deliver(); return; }
    if (this.aimed) this._pick(this.aimed);
  }

  /* ============================================================
     Грибы
     ============================================================ */
  _pick(m) {
    const sp = m.sp;
    if (this.inv.full && sp.price > 0) {
      if (this.dayT - (this._fullNag || -99) > 4) {
        this._fullNag = this.dayT;
        UI.toast('Тара полна! Сдай грибы в приёмном пункте', 'warn');
        Audio.dryFire();
      }
      return;
    }
    this.world.pick(m);
    const r = this.inv.add(sp);
    this.bestMult = Math.max(this.bestMult, this.inv.totalMult);

    if (r.poison) {
      Audio.bad();
      UI.toast(`<b>${sp.name}</b> <s>${fmtNum(sp.price)}</s> <i>серия сброшена</i>`, 'bad');
      if (sp.damage) {
        this.player.damage(sp.damage, 'poison');
        UI.toast('Отравление! Руки в поганке…', 'bad');
      }
    } else {
      Audio.pickup(this.inv.streak);
      if (sp.rare) Audio.rare();
      const tag = sp.tag ? ` <i>${sp.tag}</i>` : '';
      UI.toast(
        `<b>${sp.name}</b> +${fmtNum(r.gained)}${this.inv.combo > 1.01 ? ` <em>×${r.mult.toFixed(2)}</em>` : ''}${tag}`,
        sp.rare ? 'rare' : 'good');
    }

    if (r.full) UI.banner('ТАРА ПОЛНА', 'Иди к приёмному пункту — там дадут больше', 2600, 'info');

    // грибы-триггеры
    if (sp.summons === 'bear') {
      this._summonBear(m);
    } else if (sp.summons === 'boar') {
      const a = this.animals.spawnNear('boar', this.player.x, this.player.z, 22);
      UI.banner('ХРЮ?!', 'Кабан услышал, как ты сорвал сатанинский гриб', 2400, 'bad');
      this.shake = Math.max(this.shake, 0.4);
    }
  }

  _summonBear(m) {
    // медведь всегда появляется в поле зрения — это должно быть страшно, а не подло
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    const a = Math.atan2(fwd.x, fwd.z) + (Math.random() - 0.5) * 1.1;
    const d = 24 + Math.random() * 8;
    this.animals.spawn('bear', this.player.x + Math.sin(a) * d, this.player.z + Math.cos(a) * d);
    UI.banner('МЕДВЕДЬ', 'Пробел — уйти в сторону. Стоять на месте нельзя', 3200, 'bad');
    this.shake = 0.85;
    UI.toast('Зачем ты тронул гигантский мухомор…', 'bad');
  }

  /* ============================================================
     Сдача грибов
     ============================================================ */
  _deliver() {
    const r = this.inv.deliver();
    if (!r) { UI.toast('Тара пустая — нечего сдавать', 'warn'); return; }
    Audio.upgrade();
    UI.toast(`Сдано ${r.items} шт. → <b>+${fmtNum(r.value)}</b>`, 'good');
    if (r.upgraded) {
      UI.banner(r.upgraded.icon + '  ' + r.upgraded.name.toUpperCase(),
        `Вместимость ${r.upgraded.cap} · множитель ×${r.upgraded.mult.toFixed(2)}`, 3200, 'good');
      Audio.rare();
    } else if (this.inv.tier < CONTAINERS.length - 1) {
      UI.toast(`Принеси полную тару (${this.inv.cap}) — дадут больше`, 'info');
    }
  }

  _takePickup(p) {
    if (p.type === 'pistol') {
      const first = this.weapons.givePistol(16);
      this.weapons.select('pistol');
      Audio.found();
      UI.banner('ТТ, 16 ПАТРОНОВ', first ? 'ЛКМ — выстрел, R — перезарядка. Больше патронов — в лесу' : '', 3600, 'good');
    } else if (p.type === 'ammo') {
      if (!this.weapons.has.pistol) { this.weapons.givePistol(8); Audio.found(); }
      else { this.weapons.addAmmo(8); Audio.reload(); }
      UI.toast('Патроны 7,62×25 <b>+8</b>', 'good');
    } else if (p.type === 'thermos') {
      this.player.hp = Math.min(CONFIG.maxHp, this.player.hp + 45);
      this.player.lastDamage = 0;
      Audio.found();
      UI.toast('Чай из термоса <b>+45 ХП</b>', 'good');
    } else if (p.type === 'boots') {
      this.player.speedScale = 1.28;
      this.bootsT = 55;
      Audio.found();
      UI.toast('Резиновые сапоги: <b>+28% скорости</b> на 55 c', 'good');
    }
    this.pickups.take(p);
  }

  /* ============================================================
     Звери
     ============================================================ */
  _wireAnimals() {
    const A = this.animals;

    A.onSpawnRoar = (a) => {
      this.shake = Math.max(this.shake, a.kindId === 'bear' ? 0.7 : 0.35);
      UI.toast(`<b>${a.k.name}</b> рядом!`, 'bad');
    };

    A.onChargeStart = (a) => {
      this.shake = Math.max(this.shake, 0.35);
      if (a.k.corrida) UI.toast(`${a.k.name} пошёл на таран — <b>ПРОБЕЛ</b>`, 'warn');
    };

    A.onHitPlayer = (a) => {
      this.shake = 1;
      if (a.k.instakill) {
        Audio.death();
        this.player.kill(a.k.name);
      } else {
        this.player.damage(a.k.damage, a.k.name);
        // отбрасывание
        this.player.vx += a.lockDx * 9;
        this.player.vz += a.lockDz * 9;
        UI.toast(`${a.k.name} достал тебя! −${a.k.damage}`, 'bad');
      }
    };

    A.onDodged = (a) => {
      if (!a.k.corrida && !a.k.jumper) return;
      if (a.dist > 14) return;                     // промазал издалека — не считается
      const weight = a.kindId === 'bear' ? 1.6 : a.kindId === 'boar' ? 1 : 0.55;

      // Полная награда — только за настоящий рывок. Просто отойти
      // с линии тарана тоже можно, но это не коррида.
      if (!a.playerDodged) {
        const small = Math.round(CONFIG.oleBonus * weight * 0.22);
        this.inv.addBonus(small);
        UI.toast(`${a.k.name} промахнулся +${fmtNum(small)} <i>без рывка</i>`, 'warn');
        return;
      }

      const bonus = Math.round(CONFIG.oleBonus * weight);
      this.inv.addBonus(bonus);
      this.inv.oles++;
      this.inv.combo = Math.min(CONFIG.comboMax, this.inv.combo + 0.6);
      this.inv.comboT = CONFIG.comboWindow;
      Audio.ole();
      this.slowmoT = Math.max(this.slowmoT, 0.4);
      UI.banner('¡OLÉ!', `${a.k.name} мимо · +${fmtNum(bonus)} · множитель растёт`, 1500, 'ole');
    };

    A.onKill = (a) => {
      this.inv.addBonus(a.k.bonus);
      this.inv.kills++;
      const extra = a.kindId === 'harius'
        ? 'Ты застрелил рыбу. В лесу. Молодец.'
        : a.kindId === 'bear' ? 'Ты завалил медведя. Легенда.' : '';
      UI.banner(`${a.k.name} ПОВЕРЖЕН`, `+${fmtNum(a.k.bonus)} ${extra}`, 2600, 'good');
      Audio.dayEnd();
    };

    A.onLeave = (a) => {
      if (!a.dead) UI.toast(`${a.k.name} потерял интерес и ушёл`, 'info');
    };
  }

  _onWeaponHit(r) {
    if (!r) return;
    if (r.headshot) UI.toast('В голову!', 'good');
    if (!r.killed && r.weapon === 'knife') UI.toast(`Ножом по ${r.animal.k.name.toLowerCase()}у — он в ярости`, 'warn');
  }

  /* ============================================================
     Режиссёр событий дня
     ============================================================ */
  _director(dt) {
    const t = this.dayT;
    const S = this.sched;
    const p = this.player;

    // --- 3:00 — находка ТТ ---
    if (!S.pistol && t >= CONFIG.pistolTime) {
      S.pistol = true;
      const fwd = new THREE.Vector3();
      this.camera.getWorldDirection(fwd);
      let x = p.x + fwd.x * 9, z = p.z + fwd.z * 9;
      if (isWater(x, z)) { x = p.x - fwd.x * 9; z = p.z - fwd.z * 9; }
      this.pickups.spawn('pistol', x, z);
      Audio.gunshot();
      setTimeout(() => Audio.gunshot(), 420);
      this.shake = 0.5;
      UI.banner('ГДЕ-ТО СТРЕЛЯЛИ', 'И бросили ящик. Прямо перед тобой', 4000, 'bad');
      UI.toast('Подойди и нажми <b>E</b>', 'warn');
      S.nextAmmo = t + 45;
    }

    // --- патроны ---
    if (S.pistol && t >= (S.nextAmmo || 1e9)) {
      S.nextAmmo = t + 52 + Math.random() * 38;
      if (this.pickups.list.filter((q) => q.type === 'ammo').length < 3) {
        this.pickups.spawnRandom('ammo', p.x, p.z, 45, 190);
        UI.toast('Кто-то обронил патроны — видно на радаре', 'info');
      }
    }

    // --- термос / сапоги ---
    if (t > 70 && t >= (S.nextAid || 70)) {
      S.nextAid = t + 95 + Math.random() * 60;
      this.pickups.spawnRandom(Math.random() < 0.68 ? 'thermos' : 'boots', p.x, p.z, 40, 170);
    }

    // --- хариус ---
    if (t > CONFIG.hariusTime && t >= (S.nextHarius || CONFIG.hariusTime)) {
      S.nextHarius = t + 62 + Math.random() * 70;
      if (this.animals.count('harius') < 2) {
        this.animals.spawnNear('harius', p.x, p.z, 16 + Math.random() * 12);
        UI.banner('ХАРИУС', 'Рыба. Она выпрыгнула. Она бежит на тебя.', 2400, 'bad');
      }
    }

    // --- волки ---
    if (t > CONFIG.wolfPackTime && t >= (S.nextWolves || CONFIG.wolfPackTime)) {
      S.nextWolves = t + 95 + Math.random() * 75;
      if (this.animals.count('wolf') === 0) {
        const n = 2 + ((Math.random() * 2) | 0);
        const base = Math.random() * Math.PI * 2;
        for (let i = 0; i < n; i++)
          this.animals.spawnNear('wolf', p.x, p.z, 30 + Math.random() * 14, base + i * 0.4);
        Audio.roar('wolf');
        UI.banner('СТАЯ', `Волков ${n}. Ножом их не остановить`, 2800, 'bad');
      }
    }

    // --- кабан по расписанию ---
    if (t > 240 && t >= (S.nextBoar || 240)) {
      S.nextBoar = t + 110 + Math.random() * 80;
      if (this.animals.count('boar') < 2) this.animals.spawnNear('boar', p.x, p.z, 26 + Math.random() * 12);
    }

    // --- медведь-бродяга во второй половине дня ---
    if (t > 430 && t >= (S.nextBear || 430)) {
      S.nextBear = t + 150 + Math.random() * 110;
      if (this.animals.count('bear') === 0) {
        this.animals.spawnNear('bear', p.x, p.z, 34 + Math.random() * 10);
        UI.banner('ХОЗЯИН ЛЕСА', 'Медведь вышел сам. Без мухомора.', 3000, 'bad');
      }
    }

    // сапоги выдыхаются
    if (this.bootsT > 0) {
      this.bootsT -= dt;
      if (this.bootsT <= 0) { p.speedScale = 1; UI.toast('Сапоги натёрли. Скорость обычная', 'info'); }
    }
  }

  /* ============================================================
     Жизненный цикл забега
     ============================================================ */
  start(nick) {
    this.nick = nick;
    Audio.resume();
    Audio.startAmbient();
    this.inv.reset();
    this.player.reset();
    this.weapons.reset();
    this.animals.clear();
    this.pickups.clear();
    this.dayT = 0;
    this.bestMult = 1;
    this.bootsT = 0;
    this.sched = {};
    this.slowmoT = 0;
    this.shake = 0;
    this.state = 'playing';
    this.weapons.root.visible = true;
    // строим чанки вокруг точки старта и отходим от ствола,
    // если игрок оказался вплотную к дереву
    this.world.update(this.player.x, this.player.z, 0, 0, this.camera);
    for (let i = 0; i < 30; i++) {
      const [nx, nz] = this.world.resolveTrees(this.player.x, this.player.z, 3.2);
      if (Math.hypot(nx - this.player.x, nz - this.player.z) < 0.01) break;
      this.player.x = nx; this.player.z = nz;
    }
    this.player.y = terrainHeight(this.player.x, this.player.z);
    UI.hideAll();
    UI.banner('УТРО. ТИХАЯ ОХОТА', '12 минут. Собирай быстро — множитель растёт', 3600, 'info');
    UI.toast('Полную тару сдавай в приёмном пункте (жёлтый луч)', 'info');
    this.player.requestLock();
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.player.releaseLock();
    UI.show('screen-pause');
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    UI.hideAll();
    this.player.requestLock();
    this.lastFrame = performance.now();
  }

  _die(src) {
    const lost = this.inv.onDeath();
    Audio.stopAmbient();
    this._end(true, src === 'poison'
      ? 'Съел не то. Бледная поганка не шутит.'
      : `${src} тебя достал. Потеряно ${fmtNum(lost)} несданных очков.`);
  }

  async _end(died, reason) {
    if (this.state === 'ended') return;
    this.state = 'ended';
    this.player.releaseLock();
    Audio.stopAmbient();
    if (!died) Audio.dayEnd();

    // несданное на закате доезжает до дома
    if (!died && this.inv.carryValue > 0) {
      this.inv.banked += this.inv.carryValue;
      this.inv.carryValue = 0;
    }

    const data = {
      died, reason,
      score: this.inv.score,
      mushrooms: this.inv.totalPicked - this.inv.poisonTaken,
      oles: this.inv.oles,
      kills: this.inv.kills,
      deliveries: this.inv.deliveries,
      bestMult: this.bestMult,
      container: this.inv.container.short,
      dist: this.player.dist,
      poison: this.inv.poisonTaken,
      counts: this.inv.counts,
    };
    UI.showEnd(data);

    const best = Object.entries(this.inv.counts)
      .map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n)[0];
    await Leaderboard.submit({
      nick: this.nick, score: data.score, mushrooms: data.mushrooms,
      oles: data.oles, kills: data.kills, died, bestMushroom: best ? best.id : '',
    });
    const { rows, source } = await Leaderboard.top(12);
    UI.renderBoard('end-board', rows, source, this.nick);
  }

  /* ============================================================
     Кадр
     ============================================================ */
  loop() {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    let raw = (now - this.lastFrame) / 1000;
    this.lastFrame = now;
    raw = Math.min(raw, 0.05);

    if (this.state === 'playing') this._update(raw);
    else if (this.state === 'menu') this._updateMenu(raw);

    this.renderer.render(this.scene, this.camera);
  }

  /** Медленный облёт леса за спиной главного меню. */
  _updateMenu(dt) {
    this.weapons.root.visible = false;
    this.menuT = (this.menuT || 0) + dt;
    const p = this.player;
    p.x = 190 + Math.cos(this.menuT * 0.06) * 26;
    p.z = 232 + Math.sin(this.menuT * 0.06) * 26;
    p.y = dampTo(p.y, terrainHeight(p.x, p.z), 8, dt);
    p.yaw = this.menuT * 0.06 + Math.PI * 0.6;
    p.pitch = -0.06;
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(p.x, p.y + 1.9, p.z);
    this.camera.rotation.set(p.pitch, p.yaw, 0);
    this.world.updateDaylight(0.28, this.scene);
    this.world.update(p.x, p.z, dt, 0.28, this.camera);
    this.world.updateMushrooms(p.x, p.z, dt);
  }

  _update(raw) {
    // --- замедление времени в момент корриды ---
    let target = 1;
    for (const a of this.animals.list) {
      if (a.dead) continue;
      if (a.state === 'charge' && a.dist < 7.5) target = Math.min(target, 0.62);
    }
    if (this.slowmoT > 0) { this.slowmoT -= raw; target = Math.min(target, 0.4); }
    this.timeScale = dampTo(this.timeScale, target, 14, raw);
    const dt = raw * this.timeScale;

    this.dayT += dt;
    const left = CONFIG.dayLength - this.dayT;

    this._director(dt);

    const p = this.player;
    p.update(dt, this.world);
    this.inv.update(dt);
    this.weapons.update(dt, p);
    this.animals.update(dt, p);
    this.pickups.update(dt, p.x, p.z);
    this.world.updateDaylight(clamp(this.dayT / CONFIG.dayLength, 0, 1), this.scene);
    this.world.update(p.x, p.z, dt, this.dayT / CONFIG.dayLength, this.camera);
    this.world.updateMushrooms(p.x, p.z, dt);

    // --- прицеливание по грибам ---
    const prev = this.aimed;
    this.aimed = this.world.findTarget(this.camera, p.x, p.z, CONFIG.pickRange);
    if (prev && prev !== this.aimed) prev.mesh.material = MAT_MUSHROOM;
    if (this.aimed) this.aimed.mesh.material = MAT_MUSHROOM_HL;

    // --- подсказки ---
    const near = this.pickups.nearest(p.x, p.z, 2.6);
    const camp = this.world.nearestCamp(p.x, p.z);
    if (near) {
      UI.setPrompt(near.pickup.def.label, 'E');
      UI.crosshairState('use');
    } else if (camp.dist < 8.5) {
      UI.setPrompt(this.inv.items > 0
        ? `Сдать ${this.inv.items} шт. (${fmtNum(this.inv.carryValue)})` : 'Приёмный пункт', 'E');
      UI.crosshairState('use');
    } else if (this.aimed) {
      const sp = this.aimed.sp;
      const val = sp.price > 0 ? `+${fmtNum(sp.price * this.inv.totalMult)}` : `${fmtNum(sp.price)}`;
      UI.setPrompt(`${sp.name} <em>${val}</em>${sp.tag ? ` <i>${sp.tag}</i>` : ''}`, 'ЛКМ');
      UI.crosshairState(sp.price > 0 ? 'pick' : 'danger');
    } else {
      UI.setPrompt('');
      UI.crosshairState(this.weapons.current === 'pistol' ? 'gun' : '');
    }

    // --- опасность, тряска, сердце ---
    const threat = this.animals.threatLevel;
    let dangerText = '';
    let charging = null;
    for (const a of this.animals.list) {
      if (a.dead || a.state === 'leave') continue;
      if (a.state === 'telegraph' || a.state === 'charge') {
        if (!charging || a.dist < charging.dist) charging = a;
      }
    }
    // линия тарана — по ней игрок и уходит рывком
    if (charging) {
      if (charging.state === 'charge') {
        p.chargeLine = { dx: charging.lockDx, dz: charging.lockDz };
      } else {
        const ldx = wrapDelta(p.x - charging.x), ldz = wrapDelta(p.z - charging.z);
        const l = Math.hypot(ldx, ldz) || 1;
        p.chargeLine = { dx: ldx / l, dz: ldz / l };
      }
    } else {
      p.chargeLine = null;
    }

    if (charging) {
      dangerText = charging.state === 'telegraph'
        ? `${charging.k.name} ГОТОВИТСЯ  ·  ПРОБЕЛ — В СТОРОНУ`
        : `${charging.k.name} ИДЁТ НА ТАРАН`;
    }
    UI.danger(threat, dangerText);

    this.hbT -= raw;
    if (threat > 0.45 && this.hbT <= 0) {
      Audio.heartbeat(clamp(threat, 0, 1));
      this.hbT = lerp(1.0, 0.42, threat);
    }
    Audio.tick(raw, threat);

    // тряска камеры
    this.shake = dampTo(this.shake, 0, 4.5, raw);
    if (this.shake > 0.002) {
      const s = this.shake * 0.055;
      this.camera.position.x += (Math.random() - 0.5) * s;
      this.camera.position.y += (Math.random() - 0.5) * s;
      this.camera.rotation.z += (Math.random() - 0.5) * s * 0.5;
    }

    // --- HUD ---
    UI.setTimer(left, CONFIG.dayLength);
    UI.setScore(this.inv.score, this.inv.banked);
    UI.setBasket(this.inv);
    UI.setCombo(this.inv);
    UI.setVitals(p);
    UI.setWeapon(this.weapons);
    UI.updateRadar(p, CAMPS, this.animals.list, this.pickups.list);

    // --- конец дня ---
    if (left <= 0) this._end(false, 'Солнце село. Ты дошёл до вечера живым.');
    else if (left < 30 && !this.sched.warn30) {
      this.sched.warn30 = true;
      UI.banner('30 СЕКУНД', 'Успей сдать тару', 2600, 'warn');
    } else if (left < 90 && !this.sched.warn90) {
      this.sched.warn90 = true;
      UI.toast('Полторы минуты до темноты', 'warn');
    }
  }
}
