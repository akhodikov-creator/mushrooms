import { CONFIG, CONTAINERS } from './config.js';
import { clamp } from './utils.js';

export class Inventory {
  constructor() { this.reset(); }

  reset() {
    this.tier = 0;
    this.items = 0;              // штук в таре
    this.carryValue = 0;         // несданные очки
    this.banked = 0;             // сданные очки (их не потерять)
    this.combo = 1;
    this.comboT = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.counts = Object.create(null);   // за весь день
    this.bag = Object.create(null);      // что лежит в таре сейчас
    this.poisonTaken = 0;
    this.totalPicked = 0;
    this.oles = 0;
    this.kills = 0;
    this.deliveries = 0;
    this.level = 1;
    this.xp = 0;
  }

  /** Сколько опыта нужно, чтобы уйти с текущего уровня. */
  get xpToNext() {
    return Math.round(CONFIG.xpPerLevel * Math.pow(CONFIG.xpLevelGrowth, this.level - 1));
  }

  get xpRatio() { return clamp(this.xp / this.xpToNext, 0, 1); }

  /**
   * Начисляет опыт. Возвращает число новых уровней (0, если не хватило).
   */
  addXp(amount) {
    if (this.level >= CONFIG.maxLevel) return 0;
    this.xp += amount;
    let gained = 0;
    while (this.level < CONFIG.maxLevel && this.xp >= this.xpToNext) {
      this.xp -= this.xpToNext;
      this.level++;
      gained++;
    }
    if (this.level >= CONFIG.maxLevel) this.xp = 0;
    return gained;
  }

  /** Прибавки от уровня — их применяет игрок и сборщик грибов. */
  get speedBonus() { return 1 + (this.level - 1) * CONFIG.levelSpeed; }
  get staminaBonus() { return (this.level - 1) * CONFIG.levelStamina; }
  get pickRangeBonus() { return (this.level - 1) * CONFIG.levelPickRange; }

  get container() { return CONTAINERS[this.tier]; }

  /**
   * Насколько тара мешает идти: 0 — не мешает, 1 — не сдвинуться.
   * Пустая крупная тара уже неудобна, полная — тем более.
   */
  get dragFactor() {
    const c = this.container;
    return c.drag * (CONFIG.dragBase + (1 - CONFIG.dragBase) * this.fillRatio);
  }

  /** Множитель скорости от веса тары. */
  get speedPenalty() { return 1 - this.dragFactor; }

  /** Насколько короче рывок с полной тарой. */
  get dodgePenalty() { return 1 - this.dragFactor * CONFIG.dragDodge; }

  /** Во сколько раз дальше слышно: вёдра гремят, лукошко и пакет — нет. */
  get noiseFactor() {
    const c = this.container;
    return 1 + (c.noise - 1) * (0.5 + 0.5 * this.fillRatio);
  }
  get cap() { return this.container.cap; }
  get full() { return this.items >= this.cap; }
  get fillRatio() { return clamp(this.items / this.cap, 0, 1); }
  get score() { return Math.round(this.banked + this.carryValue); }

  /** Итог: множитель комбо × множитель тары. */
  get totalMult() { return this.combo * this.container.mult; }

  /**
   * Кладёт гриб. Возвращает отчёт для всплывашки.
   */
  add(sp) {
    const poison = sp.price < 0;
    let gained;

    if (poison) {
      this.streak = 0;
      this.combo = 1;
      this.comboT = 0;
      this.poisonTaken++;
      gained = sp.price;            // штраф уже отрицательный
      this.carryValue = Math.max(0, this.carryValue + gained);
    } else {
      this.streak++;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      // множитель на табло — это то, что игрок получает ПРЯМО СЕЙЧАС;
      // растёт он уже для следующего гриба
      gained = sp.price * this.totalMult;
      this.combo = Math.min(CONFIG.comboMax, this.combo + CONFIG.comboStep);
      this.comboT = CONFIG.comboWindow;
      this.carryValue += gained;
      this.items++;
    }

    this.counts[sp.id] = (this.counts[sp.id] || 0) + 1;
    if (!poison) this.bag[sp.id] = (this.bag[sp.id] || 0) + 1;
    this.totalPicked++;

    return {
      sp, gained: Math.round(gained), poison,
      combo: this.combo, mult: this.totalMult,
      full: this.full, streak: this.streak,
    };
  }

  /** Сдача в приёмном пункте. Возвращает отчёт или null. */
  deliver() {
    if (this.items <= 0) return null;
    const value = this.carryValue;
    const items = this.items;
    this.banked += value;
    this.carryValue = 0;
    this.items = 0;
    this.bag = Object.create(null);
    this.deliveries++;

    // тара растёт, когда сдал полную (или почти полную)
    let upgraded = null;
    if (items >= this.cap * 0.8 && this.tier < CONTAINERS.length - 1) {
      this.tier++;
      upgraded = this.container;
    }
    return { value: Math.round(value), items, upgraded };
  }

  /** Смерть: половина несданного пропадает. */
  onDeath() {
    const lost = Math.round(this.carryValue * 0.5);
    this.carryValue -= lost;
    this.banked += this.carryValue;
    this.carryValue = 0;
    this.items = 0;
    this.bag = Object.create(null);
    this.combo = 1;
    this.streak = 0;
    return lost;
  }

  addBonus(points) { this.banked += points; }

  update(dt) {
    if (this.comboT > 0) {
      this.comboT -= dt;
      if (this.comboT <= 0) {
        this.combo = 1;
        this.streak = 0;
      }
    }
  }
}
