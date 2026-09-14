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
      'level-num', 'level-fill', 'buffs', 'threat-arrow', 'radar-label', 'now-cue',
      'bag', 'bag-body', 'bag-cap', 'weather',
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

  setLevel(inv) {
    this.el['level-num'].textContent = inv.level;
    this.el['level-fill'].style.width = (inv.xpRatio * 100).toFixed(1) + '%';
    this.el['level-num'].parentElement.classList.toggle('maxed', inv.xpRatio >= 1 && inv.level >= 12);
  },

  /** Полоса активных бонусов с обратным отсчётом. */
  setBuffs(list) {
    const box = this.el.buffs;
    const want = list.map((e) => e.id).join(',');
    if (box.dataset.keys !== want) {
      box.dataset.keys = want;
      box.innerHTML = list.map((e) =>
        `<div class="buff" data-id="${e.id}"><span class="ic">${e.icon}</span>` +
        `<span class="nm">${e.name}</span><b></b></div>`).join('');
    }
    for (const e of list) {
      const el = box.querySelector(`[data-id="${e.id}"] b`);
      if (el) el.textContent = Math.ceil(e.t) + 'с';
    }
  },

  setWeapon(w) {
    const n = this.el['weapon-name'], a = this.el['weapon-ammo'];
    if (w.current === 'hands') {
      n.textContent = '🖐 Руки';
      a.textContent = w.has.pistol ? '[2] нож · [3] ТТ' : '[2] нож';
      a.className = 'ammo hint';
    } else if (w.current === 'knife') {
      n.textContent = '🔪 Нож';
      a.textContent = '[1] руки';
      a.className = 'ammo hint';
    } else {
      n.textContent = '🔫 ТТ';
      a.textContent = `${w.mag} / ${w.reserve}`;
      a.className = 'ammo' + (w.mag === 0 ? ' empty' : '');
    }
    n.classList.toggle('reloading', w.reloadT > 0);
    n.classList.toggle('unarmed', w.current === 'hands');
  },

  /** Что лежит в таре прямо сейчас. */
  toggleBag(inv, speciesById) {
    const el = this.el.bag;
    if (!el.hidden) { el.hidden = true; return false; }
    const rows = Object.entries(inv.bag)
      .map(([id, n]) => ({ sp: speciesById[id], n }))
      .filter((x) => x.sp)
      .sort((a, b) => b.n * b.sp.price - a.n * a.sp.price);
    this.el['bag-cap'].textContent =
      `${inv.container.name} · ${inv.items}/${inv.cap} · ${fmtNum(inv.carryValue)} очков`;
    this.el['bag-body'].innerHTML = rows.length
      ? rows.map((x) => `<div class="bagrow"><span>${x.sp.name}</span>` +
        `<b>×${x.n}</b><i>${fmtNum(x.n * x.sp.price * inv.container.mult)}</i></div>`).join('')
      : '<div class="empty">Пусто. Иди собирай.</div>';
    el.hidden = false;
    return true;
  },

  hideBag() { this.el.bag.hidden = true; },

  /** Строка погоды в углу. */
  setWeather(text) {
    const el = this.el.weather;
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('on', !!text);
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

  danger(level, text, angle = null, nowCue = false) {
    const d = this.el.danger;
    if (level <= 0.01) {
      d.classList.remove('on');
      d.style.opacity = 0;
      this.el['threat-arrow'].style.opacity = 0;
      this.el['now-cue'].classList.remove('on');
      return;
    }
    d.classList.add('on');
    d.style.opacity = (level * 0.92).toFixed(2);
    this.el['danger-text'].textContent = text || '';
    this.el['threat-ring'].style.opacity = level > 0.55 ? '1' : '0';

    // Стрелка вокруг прицела: показывает, с какой стороны зверь.
    // Без неё непонятно, куда вообще уходить.
    const arrow = this.el['threat-arrow'];
    if (angle === null) {
      arrow.style.opacity = 0;
    } else {
      arrow.style.opacity = 1;
      arrow.style.transform = `translate(-50%,-50%) rotate(${angle.toFixed(1)}deg)`;
      arrow.classList.toggle('behind', Math.abs(angle) > 100);
    }
    this.el['now-cue'].classList.toggle('on', nowCue);
  },

  /* ---------------- радар ---------------- */
  updateRadar(player, camps, animals, pickups, range = 130) {
    const ctx = this.radarCtx;
    if (!ctx) return;
    const W = this.el.radar.width, H = this.el.radar.height;
    const cx = W / 2, cy = H / 2, R = W / 2 - 12;
    ctx.clearRect(0, 0, W, H);

    /* --- подложка --- */
    const grd = ctx.createRadialGradient(cx, cy, R * 0.1, cx, cy, R);
    grd.addColorStop(0, 'rgba(18,30,18,0.82)');
    grd.addColorStop(1, 'rgba(8,14,10,0.66)');
    ctx.fillStyle = grd;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();

    /* --- сектор обзора: сразу видно, куда смотришь --- */
    ctx.fillStyle = 'rgba(180,220,150,0.10)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, R, -Math.PI / 2 - 0.62, -Math.PI / 2 + 0.62);
    ctx.closePath(); ctx.fill();

    /* --- кольца дальности --- */
    ctx.strokeStyle = 'rgba(150,200,140,0.13)';
    ctx.lineWidth = 1;
    for (const k of [0.33, 0.66]) {
      ctx.beginPath(); ctx.arc(cx, cy, R * k, 0, TAU); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(160,210,150,0.4)';
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.stroke();

    /* --- север --- */
    const northA = -player.yaw - Math.PI / 2;
    const nx = cx + Math.cos(northA) * (R + 6), ny = cy + Math.sin(northA) * (R + 6);
    ctx.fillStyle = '#cfe0c0';
    ctx.font = 'bold 10px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('С', nx, ny);

    /* --- перевод мировых координат в экран радара --- */
    const put = (wx, wz) => {
      const dx = wrapDelta(wx - player.x);
      const dz = wrapDelta(wz - player.z);
      const s = Math.sin(-player.yaw), c = Math.cos(-player.yaw);
      const rx = dx * c - dz * s;
      const rz = dx * s + dz * c;
      let px = (rx / range) * R;
      let py = (rz / range) * R;
      const d = Math.hypot(px, py);
      const edge = d > R - 5;
      if (edge && d > 0) { const k = (R - 5) / d; px *= k; py *= k; }
      return { x: cx + px, y: cy + py, edge, dist: Math.hypot(dx, dz) };
    };

    /* --- треугольник-указатель для того, что за краем --- */
    const edgeMark = (x, y, color) => {
      const a = Math.atan2(y - cy, x - cx);
      ctx.save();
      ctx.translate(cx + Math.cos(a) * (R + 4), cy + Math.sin(a) * (R + 4));
      ctx.rotate(a + Math.PI / 2);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, -4); ctx.lineTo(3.6, 3); ctx.lineTo(-3.6, 3);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    };

    /* --- приёмные пункты --- */
    let nearest = null;
    for (const cp of camps) {
      const q = put(cp.x, cp.z);
      if (!nearest || q.dist < nearest.dist) nearest = q;
      ctx.fillStyle = q.edge ? 'rgba(255,205,90,0.55)' : '#ffcd5a';
      ctx.beginPath();
      ctx.moveTo(q.x, q.y - 6); ctx.lineTo(q.x + 5, q.y + 4); ctx.lineTo(q.x - 5, q.y + 4);
      ctx.closePath(); ctx.fill();
      if (q.edge) edgeMark(q.x, q.y, 'rgba(255,205,90,0.8)');
    }

    /* --- находки --- */
    for (const p of pickups) {
      const q = put(p.x, p.z);
      const col = (p.def && p.def.radar) || '#7fd6ff';
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(q.x, q.y, 3.4, 0, TAU); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 1.2; ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.arc(q.x, q.y, 6.5, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
      if (q.edge) edgeMark(q.x, q.y, col);
    }

    /* --- звери --- */
    for (const a of animals) {
      if (a.dead || a.state === 'leave') continue;
      const q = put(a.x, a.z);
      const hot = a.state === 'charge' || a.state === 'telegraph';
      ctx.fillStyle = hot ? '#ff3322' : '#ff9070';
      ctx.beginPath(); ctx.arc(q.x, q.y, hot ? 5 : 3.6, 0, TAU); ctx.fill();
      if (hot) {
        const pulse = 8 + Math.sin(performance.now() / 90) * 3;
        ctx.strokeStyle = 'rgba(255,60,40,0.75)'; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(q.x, q.y, pulse, 0, TAU); ctx.stroke();
        // линия тарана
        if (a.state === 'charge') {
          const s = Math.sin(-player.yaw), c = Math.cos(-player.yaw);
          const lx = a.lockDx * c - a.lockDz * s;
          const lz = a.lockDx * s + a.lockDz * c;
          ctx.strokeStyle = 'rgba(255,90,60,0.5)';
          ctx.beginPath();
          ctx.moveTo(q.x, q.y);
          ctx.lineTo(q.x + lx * 22, q.y + lz * 22);
          ctx.stroke();
        }
      }
      if (q.edge) edgeMark(q.x, q.y, hot ? '#ff3322' : '#ff9070');
    }

    /* --- игрок --- */
    ctx.fillStyle = '#eaf6dc';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7); ctx.lineTo(cx + 5, cy + 5);
    ctx.lineTo(cx, cy + 2.5); ctx.lineTo(cx - 5, cy + 5);
    ctx.closePath(); ctx.fill();

    if (this.el['radar-label'] && nearest) {
      this.el['radar-label'].textContent = `пункт ${Math.round(nearest.dist)} м`;
    }
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
      const label = {
        cloud: '● общая доска — виден весь рейтинг',
        local: '○ локальная доска (только этот браузер)',
        error: '⚠ доска недоступна — показаны твои забеги',
      }[source] || '';
      this.el['board-src'].textContent = label;
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
