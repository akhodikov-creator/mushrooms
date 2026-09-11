/* ============================================================
   ГРИБНИК — конфигурация
   ============================================================
   ЛИДЕРБОРД:
   По умолчанию доска рекордов локальная (localStorage) — игра
   работает сразу, без настройки.

   Чтобы доска стала ОБЩЕЙ для всех друзей — создай бесплатный
   проект на supabase.com и вставь сюда URL и anon-ключ.
   SQL для таблицы лежит в README.md.
   ============================================================ */

export const SUPABASE = {
  url: '',        // например 'https://abcdefgh.supabase.co'
  anonKey: '',    // публичный anon key (его не страшно коммитить)
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
  dodgeCost: 28,
  dodgeSpeed: 18.5,
  dodgeTime: 0.32,
  dodgeCooldown: 0.85,
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
};

// Тара: растёт по мере заполнения
export const CONTAINERS = [
  { name: 'Плетёная корзина', short: 'Корзина',  cap: 14,  icon: '🧺', mult: 1.0 },
  { name: 'Эмалированное ведро', short: 'Ведро', cap: 30,  icon: '🪣', mult: 1.12 },
  { name: 'Брезентовый рюкзак', short: 'Рюкзак', cap: 60,  icon: '🎒', mult: 1.28 },
  { name: 'Садовая тележка', short: 'Тележка',   cap: 120, icon: '🛒', mult: 1.5 },
  { name: 'Прицеп к «Буханке»', short: 'Прицеп', cap: 260, icon: '🚚', mult: 1.85 },
];
