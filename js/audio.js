import { CONFIG } from './config.js';
import { clamp } from './utils.js';

/* ============================================================
   Весь звук синтезируется на лету через WebAudio.
   Ни одного внешнего файла — репозиторий остаётся лёгким.
   ============================================================ */

let ctx = null;
let master = null;
let noiseBuf = null;
let ambientNodes = null;
let birdTimer = 0;
let started = false;

/* Единственный звуковой файл в игре — музыка мухоморного прихода.
   Всё остальное синтезируется на лету. Файла может и не быть: тогда
   приход просто проходит молча, без ошибок в консоли. */
const TRIP_URL = 'assets/trip.mp3';
let tripEl = null;
let tripGain = null;
let tripOk = true;
let tripPlaying = false;

export const Audio = {
  init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = CONFIG.masterVolume;
    master.connect(ctx.destination);

    // белый шум, 2 сек — база для шагов, выстрелов, ветра
    const len = ctx.sampleRate * 2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  },

  resume() {
    if (!ctx) this.init();
    if (ctx && ctx.state === 'suspended') ctx.resume();
    started = true;
  },

  setVolume(v) {
    CONFIG.masterVolume = v;
    if (master) master.gain.value = v;
  },

  get ok() { return !!ctx && started; },

  /* ---------- примитивы ---------- */
  tone({ freq = 440, to = null, dur = 0.2, type = 'sine', gain = 0.2, delay = 0, attack = 0.005, curve = 'exp' }) {
    if (!ctx) return;
    const t0 = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (to !== null) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
      else o.frequency.linearRampToValueAtTime(to, t0 + dur);
    }
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
    return o;
  },

  noise({ dur = 0.2, gain = 0.2, delay = 0, type = 'bandpass', freq = 1000, q = 1, sweepTo = null }) {
    if (!ctx || !noiseBuf) return;
    const t0 = ctx.currentTime + delay;
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    f.Q.value = q;
    if (sweepTo !== null) f.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t0); s.stop(t0 + dur + 0.02);
  },

  /* ---------- эффекты ---------- */
  footstep(inWater = false) {
    if (inWater) {
      this.noise({ dur: 0.22, gain: 0.16, type: 'bandpass', freq: 700, sweepTo: 240, q: 0.8 });
    } else {
      this.noise({ dur: 0.11, gain: 0.075, type: 'bandpass', freq: 420 + Math.random() * 260, q: 1.1 });
      this.noise({ dur: 0.06, gain: 0.035, type: 'highpass', freq: 3200 });
    }
  },

  pickup(combo = 1) {
    const base = 480 * Math.pow(1.055, clamp(combo, 1, 18));
    this.tone({ freq: base, to: base * 1.5, dur: 0.11, type: 'triangle', gain: 0.16 });
    this.noise({ dur: 0.05, gain: 0.05, type: 'bandpass', freq: 2400, q: 2 });
  },

  /**
   * Стон удовольствия на белом грибе.
   *
   * Голос синтезируем формантами: две полосы шума на частотах «а» и
   * «о» плюс тон с вибрато. Файлов в игре нет принципиально, а так
   * получается достаточно похоже, чтобы было смешно.
   */
  moan() {
    if (!this.ok) return;
    const t0 = ctx.currentTime;
    const dur = 1.35;

    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t0);
    out.gain.exponentialRampToValueAtTime(0.17, t0 + 0.22);
    out.gain.setValueAtTime(0.17, t0 + dur * 0.55);
    out.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    out.connect(master);

    // основной тон: снизу вверх и обратно, с дрожью
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(210, t0);
    osc.frequency.exponentialRampToValueAtTime(330, t0 + dur * 0.45);
    osc.frequency.exponentialRampToValueAtTime(190, t0 + dur);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.4;
    const vibGain = ctx.createGain();
    vibGain.gain.value = 11;
    vib.connect(vibGain).connect(osc.frequency);

    // форманты делают из пилы голос, а не сирену
    for (const [f, q, g] of [[720, 7, 1.0], [1150, 9, 0.7], [2600, 11, 0.25]]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      const gn = ctx.createGain();
      gn.gain.value = g;
      osc.connect(bp).connect(gn).connect(out);
    }

    osc.start(t0); vib.start(t0);
    osc.stop(t0 + dur + 0.05); vib.stop(t0 + dur + 0.05);
  },

  rare() {
    [0, 0.08, 0.17].forEach((d, i) => this.tone({ freq: 620 * (1 + i * 0.32), dur: 0.3, type: 'sine', gain: 0.16, delay: d }));
  },

  bad() {
    this.tone({ freq: 210, to: 70, dur: 0.4, type: 'sawtooth', gain: 0.15 });
    this.noise({ dur: 0.25, gain: 0.08, type: 'lowpass', freq: 500 });
  },

  upgrade() {
    [523, 659, 784, 1047].forEach((f, i) =>
      this.tone({ freq: f, dur: 0.34, type: 'triangle', gain: 0.16, delay: i * 0.085 }));
  },

  ole() {
    this.noise({ dur: 0.5, gain: 0.12, type: 'bandpass', freq: 900, sweepTo: 3000, q: 0.7 });
    [784, 988, 1319].forEach((f, i) => this.tone({ freq: f, dur: 0.4, type: 'triangle', gain: 0.14, delay: i * 0.06 }));
  },

  roar(kind = 'bear') {
    if (kind === 'bear') {
      this.tone({ freq: 108, to: 52, dur: 1.15, type: 'sawtooth', gain: 0.26 });
      this.tone({ freq: 71, to: 38, dur: 1.25, type: 'square', gain: 0.13 });
      this.noise({ dur: 1.1, gain: 0.17, type: 'lowpass', freq: 800, sweepTo: 260 });
    } else if (kind === 'boar') {
      for (let i = 0; i < 5; i++)
        this.noise({ dur: 0.09, gain: 0.17, type: 'bandpass', freq: 320 + i * 55, q: 3, delay: i * 0.1 });
      this.tone({ freq: 180, to: 120, dur: 0.5, type: 'sawtooth', gain: 0.12 });
    } else if (kind === 'wolf') {
      this.tone({ freq: 420, to: 620, dur: 0.9, type: 'sine', gain: 0.16 });
      this.tone({ freq: 640, to: 430, dur: 1.3, type: 'sine', gain: 0.11, delay: 0.55 });
    } else if (kind === 'harius') {
      // кринж по спецзаказу
      this.tone({ freq: 1750, to: 3100, dur: 0.26, type: 'sawtooth', gain: 0.15 });
      this.tone({ freq: 2600, to: 1300, dur: 0.3, type: 'square', gain: 0.09, delay: 0.2 });
      this.noise({ dur: 0.3, gain: 0.1, type: 'bandpass', freq: 4200, q: 6, delay: 0.05 });
    }
  },

  /**
   * Музыка прихода. Идёт через общий регулятор громкости, поэтому
   * ползунок в настройках на неё тоже действует.
   */
  tripStart() {
    if (!this.ok || !tripOk || tripPlaying) return;
    if (!tripEl) {
      tripEl = new window.Audio(TRIP_URL);
      tripEl.loop = true;                 // трек короче прихода — зациклим
      tripEl.preload = 'auto';
      tripEl.addEventListener('error', () => {
        tripOk = false;
        console.info(`[audio] ${TRIP_URL} нет — приход пройдёт молча`);
      });
      try {
        tripGain = ctx.createGain();
        tripGain.gain.value = 0;
        ctx.createMediaElementSource(tripEl).connect(tripGain).connect(master);
      } catch (e) {
        tripOk = false;
        return;
      }
    }
    tripPlaying = true;
    tripEl.currentTime = 0;
    const pr = tripEl.play();
    if (pr && pr.catch) pr.catch(() => { tripOk = false; tripPlaying = false; });
    const t = ctx.currentTime;
    tripGain.gain.cancelScheduledValues(t);
    tripGain.gain.setValueAtTime(0.0001, t);
    tripGain.gain.linearRampToValueAtTime(0.9, t + 1.2);
  },

  /** Состояние музыки прихода — для отладки из консоли. */
  tripState() {
    return {
      ok: this.ok, tripOk, tripPlaying,
      ctx: ctx ? ctx.state : 'нет',
      el: tripEl ? {
        paused: tripEl.paused, t: +tripEl.currentTime.toFixed(2),
        ready: tripEl.readyState, dur: +(tripEl.duration || 0).toFixed(1),
        err: tripEl.error ? tripEl.error.code : null,
      } : 'не создан',
      gain: tripGain ? +tripGain.gain.value.toFixed(3) : 'нет',
    };
  },

  tripStop() {
    if (!tripEl || !tripGain || !tripPlaying) return;
    tripPlaying = false;
    const t = ctx.currentTime;
    tripGain.gain.cancelScheduledValues(t);
    tripGain.gain.setValueAtTime(tripGain.gain.value, t);
    tripGain.gain.linearRampToValueAtTime(0.0001, t + 2.0);
    setTimeout(() => { if (tripEl && !tripPlaying) tripEl.pause(); }, 2200);
  },

  /** Хозяин поднимается: низкий гул и шелест спор. */
  shroom() {
    this.tone({ freq: 62, to: 34, dur: 1.5, type: 'sawtooth', gain: 0.24 });
    this.tone({ freq: 94, to: 47, dur: 1.2, type: 'triangle', gain: 0.14, delay: 0.06 });
    this.noise({ dur: 1.1, gain: 0.1, type: 'lowpass', freq: 520, sweepTo: 140, delay: 0.12 });
  },

  /** Запустил лапу в тару. */
  shroomGrab() {
    this.noise({ dur: 0.35, gain: 0.16, type: 'bandpass', freq: 380, q: 1.4, sweepTo: 120 });
    this.tone({ freq: 88, to: 52, dur: 0.4, type: 'square', gain: 0.1 });
  },

  splash() {
    this.noise({ dur: 0.4, gain: 0.2, type: 'highpass', freq: 900, sweepTo: 4200 });
    this.noise({ dur: 0.3, gain: 0.12, type: 'lowpass', freq: 700, delay: 0.03 });
  },

  gunshot() {
    this.noise({ dur: 0.06, gain: 0.62, type: 'highpass', freq: 1400 });
    this.noise({ dur: 0.3, gain: 0.3, type: 'lowpass', freq: 1600, sweepTo: 180 });
    this.tone({ freq: 140, to: 42, dur: 0.26, type: 'square', gain: 0.24 });
    // эхо по лесу
    this.noise({ dur: 0.5, gain: 0.09, type: 'bandpass', freq: 700, q: 0.6, delay: 0.19 });
    this.noise({ dur: 0.7, gain: 0.05, type: 'bandpass', freq: 500, q: 0.6, delay: 0.43 });
  },

  dryFire() {
    this.noise({ dur: 0.04, gain: 0.12, type: 'highpass', freq: 3000 });
    this.tone({ freq: 900, to: 400, dur: 0.05, type: 'square', gain: 0.06 });
  },

  reload() {
    this.noise({ dur: 0.05, gain: 0.1, type: 'bandpass', freq: 2100, q: 3 });
    this.noise({ dur: 0.06, gain: 0.12, type: 'bandpass', freq: 1500, q: 3, delay: 0.22 });
    this.tone({ freq: 1200, to: 800, dur: 0.05, type: 'square', gain: 0.07, delay: 0.42 });
  },

  knifeSwing() {
    this.noise({ dur: 0.13, gain: 0.1, type: 'bandpass', freq: 1800, sweepTo: 520, q: 1.2 });
  },

  hit(flesh = true) {
    if (flesh) {
      this.noise({ dur: 0.1, gain: 0.2, type: 'lowpass', freq: 900 });
      this.tone({ freq: 150, to: 80, dur: 0.1, type: 'square', gain: 0.1 });
    } else {
      this.noise({ dur: 0.06, gain: 0.12, type: 'highpass', freq: 2600 });
    }
  },

  playerHurt() {
    this.tone({ freq: 260, to: 90, dur: 0.5, type: 'sawtooth', gain: 0.2 });
    this.noise({ dur: 0.4, gain: 0.18, type: 'lowpass', freq: 420 });
  },

  death() {
    this.tone({ freq: 220, to: 44, dur: 2.2, type: 'sawtooth', gain: 0.26 });
    this.tone({ freq: 146, to: 33, dur: 2.6, type: 'triangle', gain: 0.18, delay: 0.15 });
    this.noise({ dur: 1.8, gain: 0.12, type: 'lowpass', freq: 600, sweepTo: 90 });
  },

  dayEnd() {
    [392, 523, 659, 784, 1047].forEach((f, i) =>
      this.tone({ freq: f, dur: 0.75, type: 'triangle', gain: 0.15, delay: i * 0.16 }));
  },

  found() {
    this.tone({ freq: 300, to: 900, dur: 0.4, type: 'square', gain: 0.14 });
    this.tone({ freq: 600, to: 1800, dur: 0.5, type: 'sine', gain: 0.1, delay: 0.1 });
  },

  heartbeat(intensity = 1) {
    this.tone({ freq: 62, to: 40, dur: 0.16, type: 'sine', gain: 0.24 * intensity });
    this.tone({ freq: 55, to: 34, dur: 0.2, type: 'sine', gain: 0.17 * intensity, delay: 0.2 });
  },

  click() { this.tone({ freq: 640, to: 880, dur: 0.05, type: 'square', gain: 0.06 }); },

  /**
   * Дурной знак: сорван сатанинский гриб.
   *
   * Тревога держится не на громкости, а на двух вещах. Первая —
   * биения: две пилы, расстроенные на полтора герца, дают медленное
   * «уханье», от которого не по себе даже на тихой громкости. Вторая —
   * малая секунда: тон и он же на полтона выше звучат грязно, и ухо
   * читает это как «что-то не так». Сверху три удара сердца вразбежку.
   */
  omen() {
    if (!ctx) return;
    const t0 = ctx.currentTime;
    const ДЛИТ = 4.6;

    const шина = ctx.createGain();
    шина.gain.setValueAtTime(0.0001, t0);
    шина.gain.exponentialRampToValueAtTime(0.5, t0 + 0.7);   // наплыв
    шина.gain.setValueAtTime(0.5, t0 + ДЛИТ * 0.45);
    шина.gain.exponentialRampToValueAtTime(0.0001, t0 + ДЛИТ);
    шина.connect(master);

    // подрезаем верх: гул должен давить, а не свистеть
    const фильтр = ctx.createBiquadFilter();
    фильтр.type = 'lowpass';
    фильтр.frequency.setValueAtTime(900, t0);
    фильтр.frequency.exponentialRampToValueAtTime(180, t0 + ДЛИТ);
    фильтр.Q.value = 1.4;
    фильтр.connect(шина);

    for (const [частота, громкость] of [[48.5, 0.34], [50, 0.34], [51.4, 0.2]]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(частота, t0);
      // к концу всё сползает вниз — как будто земля уходит
      o.frequency.exponentialRampToValueAtTime(частота * 0.72, t0 + ДЛИТ);
      const g = ctx.createGain();
      g.gain.value = громкость;
      o.connect(g).connect(фильтр);
      o.start(t0);
      o.stop(t0 + ДЛИТ + 0.1);
    }

    for (let i = 0; i < 3; i++) {
      this.tone({ freq: 70, to: 38, dur: 0.22, type: 'sine', gain: 0.3, delay: 0.25 + i * 0.62 });
    }
  },

  /* ---------- фон: ветер + птицы ---------- */
  startAmbient() {
    if (!ctx || ambientNodes) return;
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf; s.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 340; f.Q.value = 0.6;
    const g = ctx.createGain(); g.gain.value = 0.05;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.09;
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.032;
    lfo.connect(lfoG); lfoG.connect(g.gain);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(); lfo.start();
    ambientNodes = { s, g, lfo };
  },

  stopAmbient() {
    this.setRain(0);
    if (!ambientNodes) return;
    try { ambientNodes.s.stop(); ambientNodes.lfo.stop(); } catch (e) { /* уже остановлено */ }
    ambientNodes = null;
  },

  /** Далёкий раскат — только в дождь, редко. */
  thunder() {
    this.noise({ dur: 2.4, gain: 0.16, type: 'lowpass', freq: 320, sweepTo: 70 });
    this.tone({ freq: 44, to: 24, dur: 2.0, type: 'sine', gain: 0.14, delay: 0.1 });
    this.noise({ dur: 0.7, gain: 0.07, type: 'bandpass', freq: 180, q: 0.6, delay: 0.6 });
  },

  lampClick() {
    this.noise({ dur: 0.03, gain: 0.1, type: 'highpass', freq: 3600 });
    this.tone({ freq: 1400, to: 900, dur: 0.04, type: 'square', gain: 0.06 });
  },

  /* ---------- дождь ---------- */
  setRain(level) {
    if (!ctx) return;
    if (level <= 0.01) {
      if (this.rainNodes) {
        try { this.rainNodes.s.stop(); } catch (e) { /* уже остановлен */ }
        this.rainNodes = null;
      }
      return;
    }
    if (!this.rainNodes) {
      const s = ctx.createBufferSource();
      s.buffer = noiseBuf; s.loop = true;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 900;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass'; lp.frequency.value = 7000;
      const g = ctx.createGain(); g.gain.value = 0;
      s.connect(hp); hp.connect(lp); lp.connect(g); g.connect(master);
      s.start();
      this.rainNodes = { s, g };
    }
    this.rainNodes.g.gain.value = 0.16 * level;
  },

  /** Случайные птицы; зови каждый кадр. */
  tick(dt, tension = 0) {
    if (!ctx) return;
    birdTimer -= dt;
    if (birdTimer <= 0) {
      birdTimer = 2.6 + Math.random() * 7;
      if (tension < 0.4 && Math.random() < 0.72) {
        const base = 1500 + Math.random() * 2100;
        const n = 2 + (Math.random() * 3) | 0;
        for (let i = 0; i < n; i++) {
          this.tone({
            freq: base * (0.86 + Math.random() * 0.34),
            to: base * (1.1 + Math.random() * 0.5),
            dur: 0.06 + Math.random() * 0.07,
            type: 'sine', gain: 0.035, delay: i * (0.07 + Math.random() * 0.06),
          });
        }
      }
    }
  },
};
