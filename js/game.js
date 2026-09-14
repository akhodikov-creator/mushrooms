import * as THREE from 'three';
import { CONFIG, CONTAINERS } from './config.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { World, CAMPS, applyEnvMap } from './world.js';
import { Player } from './player.js';
import { AnimalManager, KINDS, applyAnimalEnv } from './animals.js';
import { Weapons, applyWeaponEnv } from './weapons.js';
import { Pickups, applyPickupEnv } from './pickups.js';
import { Body, applyBodyEnv } from './body.js';
import { Inventory } from './inventory.js';
import { Leaderboard } from './leaderboard.js';
import { MAT_MUSHROOM_HL, SPECIES_BY_ID, applyMushroomEnv } from './mushrooms.js';
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
    if (CONFIG.quality !== 'low') {
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    }

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0xa8b8a0, CONFIG.fogNear, CONFIG.fogFar);

    this.camera = new THREE.PerspectiveCamera(76, innerWidth / innerHeight, 0.05, 700);
    this.scene.add(this.camera);

    this.world = new World(this.scene);
    const env = applyEnvMap(this.renderer, this.scene);
    applyWeaponEnv(env);
    applyAnimalEnv(env);
    applyPickupEnv(env);
    applyMushroomEnv(env);
    applyBodyEnv(env);
    this.player = new Player(this.camera, this.canvas);
    this.animals = new AnimalManager(this.scene);
    this.weapons = new Weapons(this.camera, this.animals, this.scene);
    this.pickups = new Pickups(this.scene);
    this.body = new Body(this.camera);
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
    this.effects = [];          // активные бонусы от находок
    this.pending = [];          // звери, о которых уже предупредили
    this.deathSeq = null;       // замедление в момент гибели
    this.lastKiller = null;

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
        case 'Digit1': this.weapons.select('hands'); break;
        case 'Digit2': this.weapons.select('knife'); break;
        case 'Digit3':
          if (!this.weapons.select('pistol') && !this.weapons.has.pistol)
            UI.toast('Пистолета нет. Может, найдётся в лесу…', 'warn');
          break;
        case 'KeyF': this._primary(); break;
        case 'Tab': e.preventDefault(); this._toggleBag(); break;
      }
    });

    this.player.onLockChange = (locked) => {
      if (!locked && this.state === 'playing') this.pause();
    };
    this.player.onDeath = (src) => this._die(src);
    this.player.onDodgeResult = (res) => {
      if (res === true) return;
      // молчаливый отказ читается как «пробел не работает» — объясняем
      Audio.dryFire();
      UI.toast(`Рывок не вышел: <b>${res}</b>`, 'warn');
    };
  }

  _primary() {
    if (this.aimed && this.weapons.canPick) { this._pick(this.aimed); return; }
    if (this.aimed && this.weapons.armed) {
      // руки заняты оружием — в этом и смысл выбора
      if (this.dayT - (this._armedNag || -99) > 3) {
        this._armedNag = this.dayT;
        UI.toast('Руки заняты. <b>1</b> — убрать оружие', 'warn');
        Audio.dryFire();
      }
      return;
    }
    this.weapons.attack(this.player, (r) => this._onWeaponHit(r));
  }

  _toggleBag() {
    UI.toggleBag(this.inv, SPECIES_BY_ID);
    Audio.click();
  }

  _interact() {
    // находка рядом?
    const near = this.pickups.nearest(this.player.x, this.player.z, 2.6);
    if (near) { this._takePickup(near.pickup); return; }
    // приёмный пункт?
    const { dist } = this.world.nearestCamp(this.player.x, this.player.z);
    if (dist < 8.5) { this._deliver(); return; }
    if (this.aimed && this.weapons.canPick) this._pick(this.aimed);
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
    // эффект снимаем до того, как гриб спрячется
    if (m.chunk) {
      const wp = new THREE.Vector3(
        m.chunk.group.position.x + m.mesh.position.x,
        m.mesh.position.y,
        m.chunk.group.position.z + m.mesh.position.z);
      this.weapons.harvestFx(m.mesh.geometry, wp, m.mesh.rotation,
        () => this.body.getDropPoint(new THREE.Vector3()));
    }
    this.weapons.playPick();

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
    const P = this.player;
    switch (p.type) {
      case 'pistol': {
        const first = this.weapons.givePistol(16);
        this.weapons.select('pistol');
        Audio.found();
        UI.banner('ТТ, 16 ПАТРОНОВ',
          first ? 'ЛКМ — выстрел, R — перезарядка. Патроны ищи по лесу' : '', 3600, 'good');
        break;
      }
      case 'ammo':
        if (!this.weapons.has.pistol) { this.weapons.givePistol(8); Audio.found(); }
        else { this.weapons.addAmmo(8); Audio.reload(); }
        UI.toast('Патроны 7,62×25 <b>+8</b>', 'good');
        break;

      case 'thermos':
        P.hp = Math.min(CONFIG.maxHp, P.hp + 45);
        P.lastDamage = 0;
        Audio.found();
        UI.toast('Чай из термоса <b>+45 ХП</b>', 'good');
        break;

      case 'berries':
        P.hp = Math.min(CONFIG.maxHp, P.hp + 22);
        Audio.pickup(3);
        UI.toast('Брусника <b>+22 ХП</b>', 'good');
        break;

      case 'boots':
        this._addEffect('boots', 'Сапоги', '🥾', 60,
          () => { P.speedScale = 1.3; this.body.setBoots(true); },
          () => { P.speedScale = 1; this.body.setBoots(false); });
        Audio.found();
        UI.toast('Резиновые сапоги: <b>+30% скорости</b> на минуту', 'good');
        break;

      case 'flask':
        P.stamina = CONFIG.maxStamina + P.levelStamina;
        this._addEffect('flask', 'Настойка', '🍶', 45,
          () => { P.staminaFree = true; },
          () => { P.staminaFree = false; });
        Audio.found();
        UI.toast('Настойка на травах: <b>бег не тратит силы</b> 45 c', 'good');
        break;

      case 'raincoat':
        this._addEffect('raincoat', 'Дождевик', '🧥', 70,
          () => { this.animals.aggroScale = 0.6; },
          () => { this.animals.aggroScale = 1; });
        Audio.found();
        UI.toast('Плащ-дождевик: <b>звери сближаются медленнее</b>', 'good');
        break;

      case 'compass':
        this._addEffect('compass', 'Компас', '🧭', 90,
          () => { this.radarRange = 300; },
          () => { this.radarRange = 130; });
        Audio.found();
        UI.toast('Дедов компас: <b>радар видит дальше</b> 90 c', 'good');
        break;

      case 'basket': {
        // чужое лукошко: сразу несколько грибов в тару
        const pool = ['bely', 'podosinovik', 'podberezovik', 'lisichka', 'maslenok', 'ryzhik'];
        let n = 0, gained = 0;
        for (let i = 0; i < 6 && !this.inv.full; i++) {
          const sp = SPECIES_BY_ID[pool[(Math.random() * pool.length) | 0]];
          gained += this.inv.add(sp).gained;
          n++;
        }
        this.bestMult = Math.max(this.bestMult, this.inv.totalMult);
        Audio.upgrade();
        UI.toast(n ? `Чужое лукошко: <b>${n} грибов</b> +${fmtNum(gained)}`
          : 'Лукошко есть, а тара полна', n ? 'rare' : 'warn');
        break;
      }
    }
    this.pickups.take(p);
  }

  /* ============================================================
     Бонусы от находок
     ============================================================ */

  /** Вешает временный бонус. Повторная находка продлевает, а не дублирует. */
  _addEffect(id, name, icon, dur, apply, clear) {
    const found = this.effects.find((e) => e.id === id);
    if (found) { found.t = Math.max(found.t, dur); return; }
    this.effects.push({ id, name, icon, t: dur, dur, clear });
    apply();
  }

  _updateEffects(dt) {
    for (let i = this.effects.length - 1; i >= 0; i--) {
      const e = this.effects[i];
      e.t -= dt;
      if (e.t <= 0) {
        e.clear();
        this.effects.splice(i, 1);
        UI.toast(`${e.icon} ${e.name} — закончилось`, 'info');
      }
    }
  }

  _clearEffects() {
    for (const e of this.effects) e.clear();
    this.effects.length = 0;
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
      this.lastKiller = a;
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

      // Убывающая награда: гонять одного зверя по кругу ради очков
      // не должно быть выгоднее, чем собирать грибы.
      a.oleCount = (a.oleCount || 0) + 1;
      const bonus = Math.round(CONFIG.oleBonus * weight / (1 + (a.oleCount - 1) * 0.85));
      this.inv.addBonus(bonus);
      this.inv.oles++;
      this.inv.combo = Math.min(CONFIG.comboMax, this.inv.combo + 0.6);
      this.inv.comboT = CONFIG.comboWindow;
      Audio.ole();
      // опыт за уворот — только за первый от каждого зверя
      if (a.oleCount === 1) this._gainXp(CONFIG.xpOle);
      this.slowmoT = Math.max(this.slowmoT, 0.4);
      UI.banner('¡OLÉ!', `${a.k.name} мимо · +${fmtNum(bonus)} · множитель растёт`, 1500, 'ole');
    };

    A.onKill = (a) => {
      this.inv.addBonus(a.k.bonus);
      this.inv.kills++;
      this._gainXp({
        bear: CONFIG.xpBear, boar: CONFIG.xpBoar,
        wolf: CONFIG.xpWolf, harius: CONFIG.xpHarius,
      }[a.kindId] || 20);
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

  /** Опыт и повышение уровня охотника. Уровень живёт только внутри забега. */
  _gainXp(amount) {
    const up = this.inv.addXp(amount);
    if (!up) return;
    const lvl = this.inv.level;
    Audio.upgrade();
    UI.banner(`УРОВЕНЬ ${lvl}`,
      `Скорость +${Math.round((this.inv.speedBonus - 1) * 100)}% · ` +
      `выносливость +${this.inv.staminaBonus} · дальше дотягиваешься`, 2600, 'good');
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
      S.nextAmmo = t + 38 + Math.random() * 26;
      if (this.pickups.list.filter((q) => q.type === 'ammo').length < 4) {
        const box = this.pickups.spawnRandom('ammo', p.x, p.z, 30, 110);
        UI.toast(`Патроны: <b>${this._bearing(box)}</b> — ищи оранжевый луч`, 'warn');
      }
    }

    // --- полезные находки ---
    if (t > 45 && t >= (S.nextAid || 45)) {
      S.nextAid = t + 52 + Math.random() * 38;
      const pool = ['thermos', 'berries', 'boots', 'flask', 'raincoat', 'compass', 'basket'];
      const weights = [22, 20, 14, 12, 10, 10, 12];
      let acc = weights.reduce((a, b) => a + b, 0) * Math.random();
      let pick = pool[0];
      for (let i = 0; i < pool.length; i++) { acc -= weights[i]; if (acc <= 0) { pick = pool[i]; break; } }
      if (this.pickups.list.length < 9) this.pickups.spawnRandom(pick, p.x, p.z, 28, 130);
    }

    // --- хариус ---
    if (t > CONFIG.hariusTime && t >= (S.nextHarius || CONFIG.hariusTime)) {
      S.nextHarius = t + 62 + Math.random() * 70;
      if (this.animals.count('harius') < 2) {
        this._announceAnimal('harius', 16 + Math.random() * 12, 1.6);
        UI.banner('ХАРИУС', 'Рыба. Она выпрыгнула. Она бежит на тебя.', 2400, 'bad');
      }
    }

    // --- волки ---
    if (t > CONFIG.wolfPackTime && t >= (S.nextWolves || CONFIG.wolfPackTime)) {
      S.nextWolves = t + (95 + Math.random() * 75) / this.noise;
      if (this.animals.count('wolf') === 0) {
        const n = 2 + ((Math.random() * 2) | 0);
        const base = Math.random() * Math.PI * 2;
        for (let i = 0; i < n; i++)
          this.animals.spawnNear('wolf', p.x, p.z, (30 + Math.random() * 14) / this.noise, base + i * 0.4);
        Audio.roar('wolf');
        UI.banner('СТАЯ', `Волков ${n}. Ножом их не остановить`, 2800, 'bad');
      }
    }

    // --- кабан по расписанию ---
    if (t > 240 && t >= (S.nextBoar || 240)) {
      S.nextBoar = t + (110 + Math.random() * 80) / this.noise;
      if (this.animals.count('boar') < 2) this._announceAnimal('boar', (26 + Math.random() * 12) / this.noise);
    }

    // --- медведь-бродяга во второй половине дня ---
    if (t > 430 && t >= (S.nextBear || 430)) {
      S.nextBear = t + (150 + Math.random() * 110) / this.noise;
      if (this.animals.count('bear') === 0) {
        this._announceAnimal('bear', (34 + Math.random() * 10) / this.noise, 3.2);
        UI.banner('ХОЗЯИН ЛЕСА', 'Медведь вышел сам. Без мухомора.', 3000, 'bad');
      }
    }

    // --- погода ---
    if (t >= (S.nextWeather || 95)) {
      const roll = Math.random();
      // ясно чаще всего, но к вечеру портится
      const late = t > CONFIG.dayLength * 0.55;
      let kind = 'clear';
      if (roll < (late ? 0.34 : 0.2)) kind = 'rain';
      else if (roll < (late ? 0.52 : 0.34)) kind = 'fog';
      else if (roll < (late ? 0.66 : 0.5)) kind = 'wind';
      S.nextWeather = t + 95 + Math.random() * 80;
      if (kind !== this.world.weather) {
        const label = this.world.setWeather(kind);
        UI.setWeather(label);
        const say = {
          rain: ['ПОШЁЛ ДОЖДЬ', 'Грибы полезут быстрее, но видно хуже'],
          fog: ['ЛЁГ ТУМАН', 'Дальше двадцати шагов не видно ничего'],
          wind: ['ПОДНЯЛСЯ ВЕТЕР', 'Лес шумит — зверя не услышишь'],
          clear: ['ПРОЯСНИЛОСЬ', ''],
        }[kind];
        UI.banner(say[0], say[1], 2600, kind === 'clear' ? 'good' : 'info');
      }
    }

    // сапоги выдыхаются
    if (this.bootsT > 0) {
      this.bootsT -= dt;
      if (this.bootsT <= 0) { p.speedScale = 1; UI.toast('Сапоги натёрли. Скорость обычная', 'info'); }
    }
  }

  /**
   * Зверь не выпрыгивает из ниоткуда: сперва хруст веток и далёкий
   * голос, и только через пару секунд он появляется.
   */
  _announceAnimal(kind, dist, delay = 2.6) {
    const p = this.player;
    const ang = Math.random() * Math.PI * 2;
    this.pending.push({
      kind, t: delay,
      x: p.x + Math.cos(ang) * dist,
      z: p.z + Math.sin(ang) * dist,
    });
    const where = this._bearing({ x: p.x + Math.cos(ang) * dist, z: p.z + Math.sin(ang) * dist });
    const line = {
      bear: 'Где-то тяжело хрустнула ветка…',
      boar: 'В кустах кто-то захрюкал…',
      wolf: 'Далёкий вой. Не один голос.',
      harius: 'Плеск. Громкий. Слишком громкий.',
    }[kind] || 'В лесу что-то не так…';
    UI.toast(`${line} <i>${where}</i>`, 'warn');
    // приглушённый голос издалека
    if (kind === 'wolf') Audio.roar('wolf');
    else if (kind === 'harius') Audio.splash();
    else Audio.noise({ dur: 0.35, gain: 0.09, type: 'bandpass', freq: 260, q: 1.4 });
    this.shake = Math.max(this.shake, 0.16);
  }

  _updatePending(dt) {
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const s = this.pending[i];
      s.t -= dt;
      if (s.t > 0) continue;
      this.animals.spawn(s.kind, s.x, s.z);
      this.pending.splice(i, 1);
    }
  }

  /** Словами: «северо-восток, 120 м» — чтобы находку реально нашли. */
  _bearing(obj) {
    const dx = wrapDelta(obj.x - this.player.x);
    const dz = wrapDelta(obj.z - this.player.z);
    const dist = Math.round(Math.hypot(dx, dz));
    // на карте -Z считаем севером
    const ang = (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360;
    const names = ['север', 'северо-восток', 'восток', 'юго-восток',
      'юг', 'юго-запад', 'запад', 'северо-запад'];
    return `${names[Math.round(ang / 45) % 8]}, ${dist} м`;
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
    this.body.reset();
    this.animals.clear();
    this.pickups.clear();
    this.dayT = 0;
    this.bestMult = 1;
    this.bootsT = 0;
    this.sched = {};
    this._clearEffects();
    this.pending.length = 0;
    this.deathSeq = null;
    this.lastKiller = null;
    this.radarRange = 130;
    this.noise = 1;
    this.world.setWeather('clear');
    UI.setWeather('');
    this.slowmoT = 0;
    this.shake = 0;
    this.state = 'playing';
    this.weapons.root.visible = true;
    this.body.root.visible = true;
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
    UI.hideBag();
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
    if (this.deathSeq) return;
    const lost = this.inv.onDeath();
    Audio.death();
    UI.hideBag();
    this.player.releaseLock();
    // Пара секунд на то, чтобы разглядеть, кто именно тебя достал —
    // мгновенный переход к таблице обесценивает смерть.
    this.deathSeq = {
      t: 0,
      killer: src === 'poison' ? null : this.lastKiller,
      reason: src === 'poison'
        ? 'Съел не то. Бледная поганка не шутит.'
        : `${src} тебя достал. Потеряно ${fmtNum(lost)} несданных очков.`,
    };
  }

  /** Медленный доигрыш: камера разворачивается на убийцу. */
  _updateDeath(raw) {
    const d = this.deathSeq;
    d.t += raw;
    const p = this.player;
    this.timeScale = 0.22;

    if (d.killer && !d.killer.remove) {
      const dx = wrapDelta(d.killer.x - p.x);
      const dz = wrapDelta(d.killer.z - p.z);
      const want = Math.atan2(-dx, -dz);
      let diff = ((want - p.yaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      p.yaw += diff * Math.min(1, raw * 3.2);
      const dy = (d.killer.g.position.y + d.killer.k.headY) - this.camera.position.y;
      p.pitch = lerp(p.pitch, Math.atan2(dy, Math.hypot(dx, dz)), Math.min(1, raw * 3));
    }
    // оседаем на землю
    p.y = dampTo(p.y, terrainHeight(p.x, p.z) - 0.85, 2.2, raw);
    p.update(raw * 0.22, this.world);
    this.animals.update(raw * 0.22, p);
    this.body.update(raw, p, this.inv, this.weapons);
    this.world.update(p.x, p.z, raw * 0.22, this.dayT / CONFIG.dayLength, this.camera);
    this.shake = Math.max(this.shake, 0.25 * (1 - d.t / 2.8));
    UI.setVitals(p);
    UI.danger(Math.max(0, 1 - d.t / 2.8), 'ТЫ ПОГИБ');

    if (d.t > 2.8) {
      const reason = d.reason;
      this.deathSeq = null;
      Audio.stopAmbient();
      this._end(true, reason);
    }
  }

  async _end(died, reason) {
    if (this.state === 'ended') return;
    this.state = 'ended';
    UI.hideBag();
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
    this.body.root.visible = false;
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
    if (this.deathSeq) { this._updateDeath(raw); return; }

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
    this._updatePending(dt);
    Audio.setRain(this.world.wet || 0);

    const p = this.player;
    p.levelSpeed = this.inv.speedBonus;
    p.levelStamina = this.inv.staminaBonus;
    p.carrySpeed = this.inv.speedPenalty;
    p.carryDodge = this.inv.dodgePenalty;
    // шум тары: вёдра гремят, звери находят быстрее. Плащ глушит.
    this.noise = this.inv.noiseFactor * (this.effects.some((e) => e.id === 'raincoat') ? 0.55 : 1);
    this._updateEffects(dt);
    p.update(dt, this.world);
    this.body.update(dt, p, this.inv, this.weapons);
    this.inv.update(dt);
    this.weapons.update(dt, p);
    this.animals.update(dt, p);
    this.pickups.update(dt, p.x, p.z);
    this.world.updateDaylight(clamp(this.dayT / CONFIG.dayLength, 0, 1), this.scene);
    this.world.update(p.x, p.z, dt, this.dayT / CONFIG.dayLength, this.camera);
    this.world.updateMushrooms(p.x, p.z, dt);

    // --- прицеливание по грибам ---
    // базовый материал каждому грибу назначает updateMushrooms выше,
    // поэтому прошлую цель отдельно сбрасывать не нужно
    this.aimed = this.world.findTarget(this.camera, p.x, p.z, CONFIG.pickRange + this.inv.pickRangeBonus);
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
      if (this.weapons.armed) {
        // подсказка должна вести к решению, а не просто отказывать
        UI.setPrompt(`убрать оружие, чтобы сорвать <i>${sp.name}</i>`, '1');
        UI.crosshairState('busy');
      } else {
        UI.setPrompt(`${sp.name} <em>${val}</em>${sp.tag ? ` <i>${sp.tag}</i>` : ''}`, 'ЛКМ');
        UI.crosshairState(sp.price > 0 ? 'pick' : 'danger');
      }
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
    // угол на зверя относительно взгляда — для стрелки на экране
    let threatAngle = null;
    if (charging) {
      const ax = wrapDelta(charging.x - p.x), az = wrapDelta(charging.z - p.z);
      threatAngle = ((Math.atan2(ax, -az) - p.yaw) * 180 / Math.PI + 540) % 360 - 180;
    }
    UI.danger(threat, dangerText, threatAngle,
      charging ? charging.state === 'charge' && charging.dist < charging.k.lockDist + 2 : false);

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
    UI.setLevel(this.inv);
    UI.setBuffs(this.effects);
    UI.updateRadar(p, CAMPS, this.animals.list, this.pickups.list, this.radarRange || 130);

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
