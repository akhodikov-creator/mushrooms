/* ============================================================
   ГРИБНИК — конфигурация
   ============================================================
   ДОСКА РЕКОРДОВ
   Без настройки доска локальная (localStorage) — игра работает
   сразу, но каждый видит только свои забеги.

   Чтобы рейтинг стал ОБЩИМ, заполни ОДИН из двух блоков ниже.
   Что заполнено — то и используется (Supabase имеет приоритет).
   Пошаговая инструкция — в README.md.
   ============================================================ */

/* Вариант 1: Firebase Realtime Database.
   Нужен только адрес базы — никаких ключей. Правила доступа
   настраиваются на стороне Firebase (см. README). */
export const FIREBASE = {
  dbUrl: 'https://gribnik-e28f3-default-rtdb.europe-west1.firebasedatabase.app',
  path: 'gribnik_scores',
};

/* Вариант 2: Supabase. */
export const SUPABASE = {
  url: '',        // например 'https://abcdefgh.supabase.co'
  anonKey: '',    // публичный anon или publishable ключ
  table: 'gribnik_scores',
};

export const CONFIG = {
  // --- мир ---
  worldSize: 1000,          // метров, зациклен по обеим осям (тор)
  chunkSize: 125,           // 8x8 = 64 чанка
  viewChunks: 2,            // радиус подгрузки чанков (2 => 5x5)
  fogNear: 40,
  fogFar: 230,

  // --- день ---
  dayLength: 720,           // 12 минут
  pistolTime: 180,          // ровно на 3:00 находим ТТ
  wolfPackTime: 330,        // с 5:30 начинают ходить стаи
  hariusTime: 90,           // хариус может выпрыгнуть после 1:30

  // --- игрок ---
  walkSpeed: 4.2,
  sprintSpeed: 7.4,
  eyeHeight: 1.68,
  maxHp: 100,
  hpRegenDelay: 9,          // сек без урона до начала регена
  hpRegenRate: 3.5,         // hp/сек
  maxStamina: 100,
  staminaDrain: 13,
  staminaRegen: 11,
  dodgeCost: 12,
  dodgeSpeed: 18.5,
  dodgeTime: 0.32,
  dodgeCooldown: 0.7,
  pickRange: 3.1,
  interactRange: 5.0,

  // --- экономика ---
  comboWindow: 3.4,         // сек на следующий гриб, чтобы держать серию
  comboStep: 0.28,          // +к множителю за гриб
  comboMax: 5.0,
  oleBonus: 260,            // очки за успешный уворот от рывка
  killBonusBear: 1400,
  killBonusBoar: 600,
  killBonusWolf: 340,
  killBonusHarius: 900,

  // --- уровень охотника (только внутри забега) ---
  xpBear: 100,
  xpBoar: 45,
  xpWolf: 28,
  xpHarius: 55,
  xpOle: 15,                // только за первый уворот от каждого зверя
  xpPerLevel: 60,           // порог первого уровня
  xpLevelGrowth: 1.45,      // каждый следующий дороже
  levelSpeed: 0.05,         // +5% скорости за уровень
  levelStamina: 8,          // +выносливость
  levelPickRange: 0.18,     // +радиус сбора
  maxLevel: 12,

  // --- плотность ---
  mushroomsPerChunk: 62,
  treesPerChunk: 46,
  grassPerChunk: 520,
  bushesPerChunk: 16,
  rocksPerChunk: 5,

  // --- прочее ---
  mouseSensitivity: 1.0,
  masterVolume: 0.7,
  quality: 'high',          // high | low

  // --- тара: вес и шум ---
  dragBase: 0.35,           // доля штрафа, которая есть даже у пустой тары
  dragDodge: 0.8,           // насколько вес режет рывок
};

// Тара. Всё помещается в одной руке — вторая должна оставаться
// свободной под нож или пистолет.
//   cap   — сколько грибов влезает
//   mult  — множитель цены
//   drag  — насколько тяжелеет ход у полной тары (доля скорости)
//   noise — во сколько раз дальше тебя слышат звери
export const CONTAINERS = [
  { name: 'Пакет-майка',    short: 'Пакет',      cap: 8,   icon: '🛍️', mult: 1.00, drag: 0.02, noise: 1.00, model: 'bagS' },
  { name: 'Большой пакет',  short: 'Пакет XL',   cap: 16,  icon: '🛍️', mult: 1.10, drag: 0.05, noise: 1.06, model: 'bagL' },
  { name: 'Ведёрко 3 литра', short: 'Ведёрко',   cap: 26,  icon: '🪣', mult: 1.22, drag: 0.08, noise: 1.16, model: 'pail3' },
  { name: 'Ведро 5 литров', short: 'Ведро 5 л',  cap: 40,  icon: '🪣', mult: 1.34, drag: 0.12, noise: 1.22, model: 'pail5' },
  { name: 'Ведро 10 литров', short: 'Ведро 10 л', cap: 70, icon: '🪣', mult: 1.52, drag: 0.18, noise: 1.30, model: 'pail10' },
  { name: 'Лукошко 15 литров', short: 'Лукошко', cap: 110, icon: '🧺', mult: 1.72, drag: 0.24, noise: 1.10, model: 'basket' },
];
