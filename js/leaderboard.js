import { SUPABASE } from './config.js';

const LS_SCORES = 'gribnik.scores.v1';
const LS_NICK = 'gribnik.nick';
const LS_SETTINGS = 'gribnik.settings.v1';

const cloudOn = !!(SUPABASE.url && SUPABASE.anonKey);

function lsGet(key, def) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; }
  catch (e) { return def; }
}
function lsSet(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* приватный режим */ }
}

export const Leaderboard = {
  get cloud() { return cloudOn; },

  getNick() {
    try { return localStorage.getItem(LS_NICK) || ''; } catch (e) { return ''; }
  },
  setNick(n) {
    try { localStorage.setItem(LS_NICK, n); } catch (e) { /* игнорируем */ }
  },

  getSettings() { return lsGet(LS_SETTINGS, null); },
  saveSettings(s) { lsSet(LS_SETTINGS, s); },

  /** Локальная история забегов. */
  localAll() { return lsGet(LS_SCORES, []); },

  async submit(entry) {
    const row = {
      nick: String(entry.nick || 'Грибник').slice(0, 20),
      score: Math.max(0, Math.round(entry.score)),
      mushrooms: entry.mushrooms | 0,
      oles: entry.oles | 0,
      kills: entry.kills | 0,
      died: !!entry.died,
      best_mushroom: entry.bestMushroom || '',
      created_at: new Date().toISOString(),
    };

    const all = this.localAll();
    all.push(row);
    all.sort((a, b) => b.score - a.score);
    lsSet(LS_SCORES, all.slice(0, 200));

    if (!cloudOn) return { ok: true, cloud: false };
    try {
      const res = await fetch(`${SUPABASE.url}/rest/v1/${SUPABASE.table}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: SUPABASE.anonKey,
          Authorization: `Bearer ${SUPABASE.anonKey}`,
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(row),
      });
      return { ok: res.ok, cloud: true, status: res.status };
    } catch (e) {
      return { ok: false, cloud: true, error: String(e) };
    }
  },

  /** Топ. Один забег = одна строка; лучший результат на ник. */
  async top(limit = 15) {
    if (cloudOn) {
      try {
        const url = `${SUPABASE.url}/rest/v1/${SUPABASE.table}` +
          `?select=nick,score,mushrooms,oles,kills,died,created_at&order=score.desc&limit=200`;
        const res = await fetch(url, {
          headers: { apikey: SUPABASE.anonKey, Authorization: `Bearer ${SUPABASE.anonKey}` },
        });
        if (res.ok) {
          const rows = await res.json();
          return { rows: bestPerNick(rows, limit), source: 'cloud' };
        }
      } catch (e) { /* падаем в локальную доску */ }
    }
    return { rows: bestPerNick(this.localAll(), limit), source: 'local' };
  },
};

function bestPerNick(rows, limit) {
  const byNick = new Map();
  for (const r of rows) {
    const k = (r.nick || '').toLowerCase();
    const prev = byNick.get(k);
    if (!prev || r.score > prev.score) byNick.set(k, r);
  }
  return [...byNick.values()].sort((a, b) => b.score - a.score).slice(0, limit);
}
