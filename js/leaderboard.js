import { SUPABASE, FIREBASE } from './config.js';

const LS_SCORES = 'gribnik.scores.v1';
const LS_PENDING = 'gribnik.pending.v1';
const LS_NICK = 'gribnik.nick';
const LS_SETTINGS = 'gribnik.settings.v1';

function lsGet(key, def) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; }
  catch (e) { return def; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* приватный режим */ }
}

/** Запрос с таймаутом — чтобы игра не висела на мёртвой сети. */
async function req(url, opts = {}, ms = 9000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

const trimSlash = (u) => String(u || '').replace(/\/+$/, '');

/* ============================================================
   Бэкенды общей доски. Нужен один из двух — какой заполнен
   в config.js, тот и работает.
   ============================================================ */

const supabaseBackend = {
  name: 'supabase',

  /**
   * У Supabase два поколения публичных ключей: старый anon-JWT
   * (начинается с «eyJ») и новый publishable. JWT кладётся и в apikey,
   * и в Authorization; новый формат в Authorization отдаёт 401.
   */
  headers() {
    const h = { 'Content-Type': 'application/json', apikey: SUPABASE.anonKey };
    if (SUPABASE.anonKey.startsWith('eyJ')) h.Authorization = `Bearer ${SUPABASE.anonKey}`;
    return h;
  },

  async push(rows) {
    const res = await req(`${trimSlash(SUPABASE.url)}/rest/v1/${SUPABASE.table}`, {
      method: 'POST',
      headers: { ...this.headers(), Prefer: 'return=minimal' },
      body: JSON.stringify(rows),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 140)}`);
  },

  async fetchRows() {
    const url = `${trimSlash(SUPABASE.url)}/rest/v1/${SUPABASE.table}` +
      '?select=nick,score,mushrooms,oles,kills,died,created_at' +
      '&order=score.desc&limit=400';
    const res = await req(url, { headers: this.headers() });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 140)}`);
    return await res.json();
  },
};

const firebaseBackend = {
  name: 'firebase',

  base() { return `${trimSlash(FIREBASE.dbUrl)}/${FIREBASE.path || 'gribnik_scores'}`; },

  /** В Realtime Database POST создаёт по одной записи за запрос. */
  async push(rows) {
    for (const row of rows) {
      const res = await req(`${this.base()}.json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(row),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 140)}`);
    }
  },

  async fetchRows() {
    // limitToLast по индексу score отдаёт как раз верхушку таблицы
    const url = `${this.base()}.json?orderBy=%22score%22&limitToLast=400`;
    const res = await req(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 140)}`);
    const data = await res.json();
    if (!data) return [];
    return Object.values(data);
  },
};

function pickBackend() {
  if (SUPABASE.url && SUPABASE.anonKey) return supabaseBackend;
  if (FIREBASE.dbUrl) return firebaseBackend;
  return null;
}
const backend = pickBackend();

/* ============================================================ */

export const Leaderboard = {
  get cloud() { return !!backend; },
  get backendName() { return backend ? backend.name : 'local'; },
  lastError: null,

  getNick() {
    try { return localStorage.getItem(LS_NICK) || ''; } catch (e) { return ''; }
  },
  setNick(n) {
    try { localStorage.setItem(LS_NICK, n); } catch (e) { /* игнорируем */ }
  },

  getSettings() { return lsGet(LS_SETTINGS, null); },
  saveSettings(s) { lsSet(LS_SETTINGS, s); },

  localAll() { return lsGet(LS_SCORES, []); },

  /* ---------------- отправка ---------------- */
  async submit(entry) {
    const row = {
      nick: String(entry.nick || 'Грибник').slice(0, 20),
      score: Math.max(0, Math.min(2000000, Math.round(entry.score))),
      mushrooms: entry.mushrooms | 0,
      oles: entry.oles | 0,
      kills: entry.kills | 0,
      died: !!entry.died,
      best_mushroom: String(entry.bestMushroom || '').slice(0, 40),
      created_at: new Date().toISOString(),
    };

    // локальная копия есть всегда — даже без интернета игрок видит свои забеги
    const all = this.localAll();
    all.push(row);
    all.sort((a, b) => b.score - a.score);
    lsSet(LS_SCORES, all.slice(0, 200));

    if (!backend) return { ok: true, cloud: false };

    const sent = await this._push([row]);
    if (!sent.ok) {
      // не дошло — в очередь, попробуем при следующем запуске
      const q = lsGet(LS_PENDING, []);
      q.push(row);
      lsSet(LS_PENDING, q.slice(-30));
    }
    return { ...sent, cloud: true };
  },

  async _push(rows) {
    try {
      await backend.push(rows);
      this.lastError = null;
      return { ok: true };
    } catch (e) {
      this.lastError = e.name === 'AbortError' ? 'таймаут сети' : String(e.message || e);
      return { ok: false };
    }
  },

  /** Досылает результаты, не ушедшие в прошлые разы. */
  async flushPending() {
    if (!backend) return 0;
    const q = lsGet(LS_PENDING, []);
    if (!q.length) return 0;
    const sent = await this._push(q);
    if (sent.ok) { lsSet(LS_PENDING, []); return q.length; }
    return 0;
  },

  /* ---------------- чтение ---------------- */
  /** Один ник — одна строка, его лучший забег. */
  async top(limit = 15) {
    if (!backend) {
      return { rows: bestPerNick(this.localAll(), limit), source: 'local' };
    }
    try {
      const rows = await backend.fetchRows();
      this.lastError = null;
      return { rows: bestPerNick(rows, limit), source: 'cloud', total: rows.length };
    } catch (e) {
      this.lastError = e.name === 'AbortError' ? 'таймаут сети' : String(e.message || e);
      // сеть подвела — показываем хотя бы свои забеги
      return { rows: bestPerNick(this.localAll(), limit), source: 'error', error: this.lastError };
    }
  },
};

function bestPerNick(rows, limit) {
  const byNick = new Map();
  for (const r of rows) {
    if (!r || typeof r.nick !== 'string') continue;
    const k = r.nick.toLowerCase();
    const prev = byNick.get(k);
    if (!prev || r.score > prev.score) byNick.set(k, r);
  }
  return [...byNick.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
