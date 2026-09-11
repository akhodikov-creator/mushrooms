import { CONFIG, CONTAINERS } from './config.js';
import { fmtTime, fmtNum, clamp, wrapDelta, TAU } from './utils.js';
import { SPECIES_BY_ID } from './mushrooms.js';

const $ = (id) => document.getElementById(id);

export const UI = {
  el: {},

  init() {
    const ids = [
      'screen-start', 'screen-end', 'screen-pause', 'hud', 'nick', 'btn-play', 'start-msg',
      'board', 'board-src', 'timer', 'timer-fill', 'score', 'score-banked', 'basket-icon',
      'basket-name', 'basket-fill', 'basket-count', 'combo', 'combo-fill', 'hp-fill', 'st-fill',
      'weapon-name', 'weapon-ammo', 'prompt', 'crosshair', 'toasts', 'danger', 'danger-text',
      'hurt', 'banner', 'banner-title', 'banner-sub', 'end-title', 'end-body', 'end-board',
      'radar', 'hp-num', 'tab-board', 'btn-again', 'btn-menu', 'btn-resume', 'btn-quit',
      'sens', 'sens-val', 'vol', 'vol-val', 'quality', 'vignette', 'end-sub', 'threat-ring',
    ];
    for (const id of ids) this.el[id] = $(id);
    this.radarCtx = this.el.radar ? this.el.radar.getContext('2d') : null;
    this._toasts = [];
    this._bannerT = 0;
    return this;
  },

  /* ---------------- экраны ---------------- */
  show(screen) {
    for (const s of ['screen-start', 'screen-end', 'screen-pause']) {
      this.el[s].hidden = s !== screen;
    }
    this.el.hud.hidden = screen !== null;
    if (screen === null) this.el.hud.hidden = false;
  },

  hideAll() {
    this.el['screen-start'].hidden = true;
    this.el['screen-end'].hidden = true;
    this.el['screen-pause'].hidden = true;
    this.el.hud.hidden = false;
  },

  startMsg(text, cls = '') {
    this.el['start-msg'].textContent = text;
    this.el['start-msg'].className = 'msg ' + cls;
  },

  /* ---------------- HUD ---------------- */
  setTimer(left, total) {
    this.el.timer.textContent = fmtTime(left);
    const k = clamp(left / total, 0, 1);
    this.el['timer-fill'].style.width = (k * 100).toFixed(1) + '%';
    this.el.timer.classList.toggle('low', left < 60);
  },

  setScore(total, banked) {
    this.el.score.textContent = fmtNum(total);
    this.el['score-banked'].textContent = 'сдано ' + fmtNum(banked);
  },

  setBasket(inv) {
    const c = inv.container;
    this.el['basket-icon'].textContent = c.icon;
    this.el['basket-name'].textContent = c.short;
    this.el['basket-fill'].style.width = (inv.fillRatio * 100).toFixed(1) + '%';
    this.el['basket-count'].textContent = `${inv.items}/${inv.cap}`;
    this.el['basket-fill'].classList.toggle('full', inv.full);
  },

  setCombo(inv) {
    const on = inv.combo > 1.001;
    this.el.combo.classList.toggle('on', on);
    this.el.combo.querySelector('.x').textContent = '×' + inv.totalMult.toFixed(2);
    this.el.combo.querySelector('.streak').textContent = on ? `серия ${inv.streak}` : 'серия';
    const k = inv.comboT / CONFIG.comboWindow;
    this.el['combo-fill'].style.width = (clamp(k, 0, 1) * 100).toFixed(1) + '%';
    const hot = clamp((inv.combo - 1) / (CONFIG.comboMax - 1), 0, 1);
    this.el.combo.style.setProperty('--hot', hot.toFixed(2));
  },

  setVitals(p) {
    const hp = clamp(p.hp / CONFIG.maxHp, 0, 1);
    this.el['hp-fill'].style.width = (hp * 100).toFixed(1) + '%';
    this.el['hp-fill'].classList.toggle('low', hp < 0.34);
    this.el['hp-num'].textContent = Math.ceil(p.hp);
    this.el['st-fill'].style.width = (clamp(p.stamina / CONFIG.maxStamina, 0, 1) * 100).toFixed(1) + '%';
    this.el.hurt.style.opacity = (p.hurtFlash * 0.55).toFixed(2);
    this.el.vignette.style.opacity = (0.16 + (1 - hp) * 0.46).toFixed(2);
  },

  setWeapon(w) {
    if (w.current === 'knife') {
      this.el['weapon-name'].textContent = '🔪 Нож';
      this.el['weapon-ammo'].textContent = w.has.pistol ? '[2] ТТ' : '';
      this.el['weapon-ammo'].className = 'ammo hint';
    } else {
      this.el['weapon-name'].textContent = '🔫 ТТ';
      this.el['weapon-ammo'].textContent = `${w.mag} / ${w.reserve}`;
      this.el['weapon-ammo'].className = 'ammo' + (w.mag === 0 ? ' empty' : '');
    }
    this.el['weapon-name'].classList.toggle('reloading', w.reloadT > 0);
  },

  setPrompt(text, key = '') {
    const e = this.el.prompt;
    if (!text) { e.hidden = true; return; }
    e.hidden = false;
    e.innerHTML = key ? `<b>${key}</b> ${text}` : text;
  },

  crosshairState(mode) {
    this.el.crosshair.className = 'ch ' + mode;
  },

  /* ---------------- события ---------------- */
  toast(text, cls = '') {
    const d = document.createElement('div');
    d.className = 'toast ' + cls;
    d.innerHTML = text;
    this.el.toasts.appendChild(d);
    requestAnimationFrame(() => d.classList.add('in'));
    setTimeout(() => {
      d.classList.remove('in');
      setTimeout(() => d.remove(), 400);
    }, 2300);
    while (this.el.toasts.children.length > 7) this.el.toasts.firstChild.remove();
  },

  banner(title, sub = '', ms = 2200, cls = '') {
    this.el['banner-title'].textContent = title;
    this.el['banner-sub'].textContent = sub;
    this.el.banner.className = 'banner show ' + cls;
    clearTimeout(this._bt);
    this._bt = setTimeout(() => { this.el.banner.className = 'banner ' + cls; }, ms);
  },

  danger(level, text) {
    const d = this.el.danger;
    if (level <= 0.01) { d.classList.remove('on'); d.style.opacity = 0; return; }
    d.classList.add('on');
    d.style.opacity = (level * 0.92).toFixed(2);
    this.el['danger-text'].textContent = text || '';
    this.el['threat-ring'].style.opacity = level > 0.55 ? '1' : '0';
  },

  /* ---------------- радар ---------------- */
  updateRadar(player, camps, animals, pickups, range = 130) {
    const ctx = this.radarCtx;
    if (!ctx) return;
    const W = this.el.radar.width, H = this.el.radar.height;
    const cx = W / 2, cy = H / 2, R = W / 2 - 3;
    ctx.clearRect(0, 0, W, H);

    // фон
    ctx.fillStyle = 'rgba(10,16,10,0.55)';
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(150,200,140,0.35)'; ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.strokeStyle = 'rgba(150,200,140,0.14)';
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.5, 0, TAU); ctx.stroke();

    const put = (wx, wz, draw) => {
      const dx = wrapDelta(wx - player.x);
      const dz = wrapDelta(wz - player.z);
      // поворот в систему камеры: вперёд игрока — вверх
      const s = Math.sin(-player.yaw), c = Math.cos(-player.yaw);
      let rx = dx * c - dz * s;
      let rz = dx * s + dz * c;
      // вперёд игрока = -Z, значит вверх экрана
      let px = rx / range * R;
      let py = rz / range * R;
      const d = Math.hypot(px, py);
      const edge = d > R - 6;
      if (edge) { const k = (R - 6) / d; px *= k; py *= k; }
      draw(cx + px, cy + py, edge);
    };

    // приёмные пункты
    for (const cp of camps) {
      put(cp.x, cp.z, (x, y, edge) => {
        ctx.fillStyle = edge ? 'rgba(255,205,90,0.65)' : '#ffcd5a';
        ctx.beginPath();
        ctx.moveTo(x, y - 5); ctx.lineTo(x + 4.5, y + 4); ctx.lineTo(x - 4.5, y + 4);
        ctx.closePath(); ctx.fill();
      });
    }

    // находки
    for (const p of pickups) {
      put(p.x, p.z, (x, y) => {
        ctx.fillStyle = p.type === 'pistol' ? '#ffdd55' : '#7fd6ff';
        ctx.beginPath(); ctx.arc(x, y, 2.6, 0, TAU); ctx.fill();
      });
    }

    // звери
    for (const a of animals) {
      if (a.dead) continue;
      put(a.x, a.z, (x, y) => {
        const hot = a.state === 'charge' || a.state === 'telegraph';
        ctx.fillStyle = hot ? '#ff3322' : '#ff8866';
        ctx.beginPath(); ctx.arc(x, y, hot ? 4.4 : 3.2, 0, TAU); ctx.fill();
        if (hot) {
          ctx.strokeStyle = 'rgba(255,60,40,0.6)'; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.arc(x, y, 7.5, 0, TAU); ctx.stroke();
        }
      });
    }

    // игрок
    ctx.fillStyle = '#d8f0c0';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 6); ctx.lineTo(cx + 4, cy + 4); ctx.lineTo(cx, cy + 2); ctx.lineTo(cx - 4, cy + 4);
    ctx.closePath(); ctx.fill();
  },

  /* ---------------- доска рекордов ---------------- */
  renderBoard(target, rows, source, myNick) {
    const el = this.el[target];
    if (!rows.length) {
      el.innerHTML = '<div class="empty">Пока пусто. Первый рекорд — твой.</div>';
    } else {
      el.innerHTML = rows.map((r, i) => {
        const me = myNick && (r.nick || '').toLowerCase() === myNick.toLowerCase();
        const medal = ['🥇', '🥈', '🥉'][i] || `<span class="pos">${i + 1}</span>`;
        return `<div class="row${me ? ' me' : ''}">
          <span class="medal">${medal}</span>
          <span class="who">${escapeHtml(r.nick || '—')}</span>
          <span class="stat">${r.mushrooms || 0} 🍄</span>
          <span class="stat">${r.oles || 0} 🐂</span>
          <span class="pts">${fmtNum(r.score)}</span>
        </div>`;
      }).join('');
    }
    if (this.el['board-src'] && target === 'board') {
      this.el['board-src'].textContent = source === 'cloud'
        ? '● общая доска' : '○ локальная доска (этот браузер)';
      this.el['board-src'].className = 'src ' + source;
    }
  },

  /* ---------------- итоги дня ---------------- */
  showEnd(data) {
    this.el['end-title'].textContent = data.died ? 'ЗАБЕГ ОКОНЧЕН' : 'ВЕЧЕР. ПОРА ДОМОЙ';
    this.el['end-title'].className = data.died ? 'dead' : '';
    this.el['end-sub'].textContent = data.reason || '';

    const top = Object.entries(data.counts)
      .map(([id, n]) => ({ sp: SPECIES_BY_ID[id], n }))
      .filter((x) => x.sp && x.sp.price > 0)
      .sort((a, b) => b.n * b.sp.price - a.n * a.sp.price)
      .slice(0, 6);

    this.el['end-body'].innerHTML = `
      <div class="big">${fmtNum(data.score)}<span>очков</span></div>
      <div class="grid">
        <div><b>${data.mushrooms}</b><span>грибов</span></div>
        <div><b>${data.oles}</b><span>оле!</span></div>
        <div><b>${data.kills}</b><span>зверей</span></div>
        <div><b>${data.deliveries}</b><span>сдач</span></div>
        <div><b>×${data.bestMult.toFixed(2)}</b><span>лучший множитель</span></div>
        <div><b>${data.container}</b><span>тара</span></div>
        <div><b>${(data.dist / 1000).toFixed(2)} км</b><span>пройдено</span></div>
        <div><b>${data.poison}</b><span>поганок</span></div>
      </div>
      ${top.length ? `<div class="bag">${top.map((x) =>
        `<div class="bagrow"><span>${x.sp.name}</span><b>×${x.n}</b><i>${fmtNum(x.n * x.sp.price)}</i></div>`
      ).join('')}</div>` : ''}
    `;
    this.show('screen-end');
  },
};

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
