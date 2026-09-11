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
    this.counts = Object.create(null);
    this.poisonTaken = 0;
    this.totalPicked = 0;
    this.oles = 0;
    this.kills = 0;
    this.deliveries = 0;
  }

  get container() { return CONTAINERS[this.tier]; }
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
