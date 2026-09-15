import { CONFIG } from './config.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { Leaderboard } from './leaderboard.js';
import { Game } from './game.js';
import { warmAssets } from './assets.js';
import { setDaySeed, todaySeed, seedLabel } from './utils.js';

/* Лес дня задаётся ДО всего остального: от сида зависит рельеф, а от
   рельефа — вода, лагеря, деревья и грибные места. */
setDaySeed(todaySeed());

UI.init();

/* Лес дня — на стартовом экране: у всех, кто играет сегодня, он один
   и тот же, иначе общая доска ничего не значит. */
UI.setDayLabel(seedLabel(todaySeed()));

/* ---------- настройки ---------- */
const saved = Leaderboard.getSettings();
if (saved) {
  CONFIG.mouseSensitivity = saved.sens ?? CONFIG.mouseSensitivity;
  CONFIG.masterVolume = saved.vol ?? CONFIG.masterVolume;
  CONFIG.quality = saved.quality ?? CONFIG.quality;
}
if (CONFIG.quality === 'low') {
  CONFIG.viewChunks = 1;
  CONFIG.fogFar = 165;
  CONFIG.grassPerChunk = 260;
}

// Внешние модели тянем в фоне: пока их нет, играем на процедурных.
warmAssets();

const game = new Game();
window.__game = game;   // для отладки из консоли
game.loop();

/* ---------- ник ---------- */
const nickEl = UI.el.nick;
nickEl.value = Leaderboard.getNick();

function validNick() {
  const n = nickEl.value.trim().replace(/\s+/g, ' ');
  if (n.length < 2) { UI.startMsg('Ник — минимум 2 символа', 'warn'); return null; }
  if (n.length > 16) { UI.startMsg('Ник — максимум 16 символов', 'warn'); return null; }
  return n;
}

function play() {
  const n = validNick();
  if (!n) { nickEl.focus(); return; }
  Leaderboard.setNick(n);
  Audio.resume();
  UI.startMsg('');
  game.start(n);
}

UI.el['btn-play'].addEventListener('click', play);
nickEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') play(); });
nickEl.addEventListener('input', () => UI.startMsg(''));

/* ---------- кнопки ---------- */
UI.el['btn-again'].addEventListener('click', () => game.start(game.nick || Leaderboard.getNick() || 'Грибник'));
UI.el['btn-resume'].addEventListener('click', () => game.resume());
UI.el['btn-menu'].addEventListener('click', () => toMenu());
UI.el['btn-quit'].addEventListener('click', () => toMenu());

async function toMenu() {
  game.state = 'menu';
  Audio.stopAmbient();
  UI.show('screen-start');
  UI.el.hud.hidden = true;
  await refreshBoard();
}

/* ---------- доска ---------- */
async function refreshBoard() {
  const { rows, source } = await Leaderboard.top(15);
  UI.renderBoard('board', rows, source, Leaderboard.getNick());
}

// Результаты, не ушедшие из-за обрыва сети, досылаем на следующем запуске.
(async () => {
  const n = await Leaderboard.flushPending();
  await refreshBoard();
  if (n) UI.startMsg(`Доотправлено результатов: ${n}`, 'info');
})();

/* ---------- ползунки ---------- */
function saveSettings() {
  Leaderboard.saveSettings({
    sens: CONFIG.mouseSensitivity, vol: CONFIG.masterVolume, quality: CONFIG.quality,
  });
}

const sens = UI.el.sens;
sens.value = CONFIG.mouseSensitivity;
UI.el['sens-val'].textContent = Number(CONFIG.mouseSensitivity).toFixed(2);
sens.addEventListener('input', () => {
  CONFIG.mouseSensitivity = parseFloat(sens.value);
  UI.el['sens-val'].textContent = CONFIG.mouseSensitivity.toFixed(2);
  saveSettings();
});

const vol = UI.el.vol;
vol.value = CONFIG.masterVolume;
UI.el['vol-val'].textContent = Math.round(CONFIG.masterVolume * 100) + '%';
vol.addEventListener('input', () => {
  Audio.setVolume(parseFloat(vol.value));
  UI.el['vol-val'].textContent = Math.round(CONFIG.masterVolume * 100) + '%';
  saveSettings();
});

const q = UI.el.quality;
q.value = CONFIG.quality;
q.addEventListener('change', () => {
  CONFIG.quality = q.value;
  saveSettings();
  UI.startMsg('Качество применится при следующей загрузке страницы', 'info');
});

/* первое касание разблокирует звук в браузере */
addEventListener('pointerdown', () => Audio.resume(), { once: true });
addEventListener('keydown', () => Audio.resume(), { once: true });
