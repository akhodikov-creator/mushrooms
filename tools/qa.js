/* ============================================================
   Прогон игры на ошибки.

   Загружается в уже запущенную страницу игры и крутит её по
   сценариям без участия человека: день целиком, босс, сбор и сдача,
   мухоморный приход, смерть, несколько дней подряд.

   Смотрит не только на исключения. Половина настоящих багов в такой
   игре — это не падение, а тихо уехавшее число: NaN в координате,
   зверь под землёй, счётчик инстансов больше выделенного буфера.
   Поэтому на каждом кадре проверяются инварианты.

   Запуск из консоли:  await window.__qa()
   ============================================================ */
const ЛОГ = [];
const ОШИБКИ = [];

function беда(где, что) {
  const ключ = где + ': ' + что;
  if (!ОШИБКИ.some((e) => e.ключ === ключ)) ОШИБКИ.push({ ключ, где, что, кадр: null });
}

/** Ловим всё, что игра роняет мимо нас. */
function ловушки() {
  if (window.__qaHooked) return;
  window.__qaHooked = true;
  addEventListener('error', (e) => беда('исключение', String(e.message)));
  addEventListener('unhandledrejection', (e) => беда('обещание', String(e.reason)));
  const warn = console.warn.bind(console);
  console.warn = (...a) => { беда('console.warn', a.map(String).join(' ').slice(0, 160)); warn(...a); };
  const err = console.error.bind(console);
  console.error = (...a) => { беда('console.error', a.map(String).join(' ').slice(0, 160)); err(...a); };
}

const конечно = (v) => typeof v === 'number' && Number.isFinite(v);

/** Проверки, которые должны быть верны в любой момент игры. */
function инварианты(g, U) {
  const p = g.player;
  if (!конечно(p.x) || !конечно(p.z) || !конечно(p.y)) беда('игрок', 'координата не число');
  if (!конечно(p.hp) || p.hp > 100.001) беда('игрок', 'здоровье вне диапазона: ' + p.hp);
  if (!конечно(p.stamina)) беда('игрок', 'силы не число');
  if (!конечно(g.dayT)) беда('игра', 'время дня не число');

  for (const z of g.animals.list) {
    if (!конечно(z.x) || !конечно(z.z) || !конечно(z.y)) { беда('зверь ' + z.kindId, 'координата не число'); continue; }
    if (!конечно(z.hp)) беда('зверь ' + z.kindId, 'здоровье не число');
    const gh = U.terrainHeight(z.x, z.z);
    // Хозяин бора поднимается из земли и уходит обратно — под рельефом
    // он в эти два состояния находится законно.
    const подЗемлёйМожно = z.state === 'sink' || z.state === 'spawn';
    if (!подЗемлёйМожно && z.g.position.y < gh - 1.2) {
      беда('зверь ' + z.kindId, 'провалился под рельеф на ' + (gh - z.g.position.y).toFixed(1) + ' м');
    }
    if (z.g.position.y > gh + 12) беда('зверь ' + z.kindId, 'улетел вверх на ' + (z.g.position.y - gh).toFixed(1) + ' м');
    if (z.mixer && !z.clip && z.state !== 'spawn') беда('зверь ' + z.kindId, 'состояние «' + z.state + '» без клипа');
    if (z.mixer && z.k.clipMap && z.clip && z.state !== 'spawn') {
      // на кадре смены состояния клип отстаёт на один шаг — это норма,
      // ловим только стойкое расхождение
      const ждём = z.k.clipMap[z.state] && z.k.clipMap[z.state][0];
      if (ждём && ждём !== z.clip) {
        z._qaРасх = (z._qaРасх || 0) + 1;
        if (z._qaРасх > 8) беда('зверь ' + z.kindId, 'состояние «' + z.state + '» держит клип «' + z.clip + '», ждали «' + ждём + '»');
      } else z._qaРасх = 0;
    }
  }

  const W = g.world;
  const проверьКовёр = (им, m) => {
    if (!m) return;
    if (m.count > m.instanceMatrix.count) беда('ковёр ' + им, 'инстансов ' + m.count + ' при буфере ' + m.instanceMatrix.count);
  };
  проверьКовёр('трава', W.nearGrass);
  проверьКовёр('ягель', W.nearMoss);
  (W.nearClover || []).forEach((m, i) => проверьКовёр('клевер' + i, m));
}

/** Один прогон: n секунд игрового времени, игрок ходит по лесу. */
function крутить(g, U, сек, шаг = 1 / 30, наКадре = null) {
  let t = 0, i = 0;
  while (t < сек) {
    // Ходим змейкой: так строятся и выгружаются чанки. Скорость —
    // человеческая: при 0.9 на кадр игрок летел 27 м/с, убегал от
    // любого зверя, и половина сценариев не проверяла ничего.
    const шагМ = 5.2 * шаг;
    g.player.x += Math.cos(t * 0.41) * шагМ;
    g.player.z += Math.sin(t * 0.27) * шагМ;
    g.player.yaw += 0.02;
    try { g._update(шаг); } catch (e) { беда('_update', String(e && e.message || e)); return t; }
    try { инварианты(g, U); } catch (e) { беда('инварианты', String(e && e.message || e)); }
    if (наКадре) { try { наКадре(t, i); } catch (e) { беда('сценарий', String(e && e.message || e)); } }
    t += шаг; i++;
  }
  return t;
}

window.__qa = async function (opts = {}) {
  ловушки();
  const U = await import('/js/utils.js');
  const { KINDS } = await import('/js/animals.js');
  const g = window.__game;
  const отчёт = {};
  const пауза = () => new Promise((r) => setTimeout(r, 0));

  const старт = () => {
    g.start('qa');
    // зверей делаем безвредными: иначе сценарий обрывается на первой смерти
    if (opts.смертельно !== true) for (const k of Object.values(KINDS)) { k.instakill = false; k.damage = 0; }
  };

  /* --- 1. полный день со всеми зверями --- */
  {
    старт();
    const виды = ['bear', 'boar', 'wolf', 'harius'];
    const встречены = new Set();
    let n = 0;
    крутить(g, U, 720, 1 / 30, (t) => {
      if (Math.floor(t * 30) % 420 === 0 && g.animals.list.length < 6) {
        g.animals.spawnNear(виды[(n++) % 4], g.player.x, g.player.z, 20 + (n % 9), (n * 1.7) % 6.28);
      }
      for (const z of g.animals.list) встречены.add(z.kindId + '/' + z.state);
    });
    отчёт['1. полный день'] = {
      экран: g.state, секунд: Math.round(g.dayT),
      состояний: встречены.size,
      виды: [...new Set([...встречены].map((s) => s.split('/')[0]))].join(', '),
    };
  }
  await пауза();

  /* --- 2. хозяин бора: весь автомат --- */
  {
    старт();
    g.animals.spawnNear('shroom', g.player.x, g.player.z, 26, 0.5);
    const сост = new Set();
    крутить(g, U, 120, 1 / 30, () => {
      for (const z of g.animals.list) if (z.k.boss) сост.add(z.state + '/' + (z.clip || '—'));
    });
    отчёт['2. хозяин бора'] = { состояния: [...сост].sort().join(' · ') || 'не появился' };
  }
  await пауза();

  /* --- 3. сбор грибов и сдача --- */
  {
    старт();
    let собрано = 0, сдач = 0;
    крутить(g, U, 240, 1 / 30, () => {
      // тем же путём, что и живой игрок: прицел -> сорвать
      const m = g.world.findTarget(g.camera, g.player.x, g.player.z, 3.2 + g.inv.pickRangeBonus);
      if (m && !g.inv.full) {
        try { g._pick(m); собрано++; } catch (e) { беда('сбор', String(e && e.message || e)); }
      }
      if (g.inv.full) { try { g._deliver(); сдач++; } catch (e) { беда('сдача', String(e && e.message || e)); } }
    });
    отчёт['3. сбор и сдача'] = {
      собрано, попытокСдачи: сдач, очки: g.inv.score,
      тара: g.inv.container && g.inv.container.name, вТаре: g.inv.items,
    };
  }
  await пауза();

  /* --- 4. мухоморный приход --- */
  {
    старт();
    g.tripT = 30;
    крутить(g, U, 45);
    отчёт['4. мухоморный приход'] = { остаток: +g.tripT.toFixed(2), экран: g.state };
  }
  await пауза();

  /* --- 5. смерть и новый день --- */
  {
    старт();
    крутить(g, U, 20);
    g.player.damage(999, 'qa');
    крутить(g, U, 12);
    const послеСмерти = g.state;
    старт();
    крутить(g, U, 20);
    отчёт['5. смерть и рестарт'] = { послеСмерти, послеРестарта: g.state, здоровье: g.player.hp };
  }
  await пауза();

  /* --- 6. три дня подряд без перезагрузки --- */
  {
    const веса = [];
    for (let d = 0; d < 3; d++) {
      старт();
      крутить(g, U, 240, 1 / 30, (t) => {
        if (Math.floor(t * 30) % 600 === 0) g.animals.spawnNear('bear', g.player.x, g.player.z, 22, t);
      });
      веса.push({
        день: d + 1,
        геометрий: g.renderer.info.memory.geometries,
        текстур: g.renderer.info.memory.textures,
        программ: g.renderer.info.programs.length,
        зверей: g.animals.list.length,
        детейСцены: g.scene.children.length,
      });
      await пауза();
    }
    отчёт['6. три дня подряд'] = веса;
  }

  отчёт['ошибки'] = ОШИБКИ.map((e) => e.ключ);
  отчёт['итог'] = ОШИБКИ.length ? ('НАЙДЕНО: ' + ОШИБКИ.length) : 'чисто';
  window.__qaОтчёт = отчёт;
  return отчёт;
};

'qa готов';

/* ============================================================
   Вторая батарея: то, что не проверишь одним прогоном дня.
   ============================================================ */
window.__qa2 = async function (дней = 24) {
  ловушки();
  const U = await import('/js/utils.js');
  const W = await import('/js/world.js');
  const M = await import('/js/mushrooms.js');
  const g = window.__game;
  const отчёт = {};

  /* --- сиды: у каждого дня свой лес, и он должен быть играбельным --- */
  {
    const плохие = [];
    const доли = {};
    const сегодня = U.todaySeed();
    for (let d = 0; d < дней; d++) {
      const сид = сегодня + d;
      U.setDaySeed(сид);
      W.placeCamps();
      const лагеря = W.CAMPS;
      if (лагеря.length !== 4) плохие.push(сид + ': лагерей ' + лагеря.length);
      for (const c of лагеря) {
        const h = U.terrainHeight(c.x, c.z);
        if (!Number.isFinite(h)) { плохие.push(сид + ': лагерь вне рельефа'); continue; }
        if (h <= U.WATER_LEVEL + 0.5) плохие.push(сид + ': лагерь в воде (h=' + h.toFixed(1) + ')');
      }
      const sp = W.spawnPoint();
      const sh = U.terrainHeight(sp.x, sp.z);
      if (sh <= U.WATER_LEVEL + 0.5) плохие.push(сид + ': старт в воде');
      // доли выделов: если какой-то исчез, часть грибов негде взять
      const счёт = [0, 0, 0, 0, 0, 0];
      let вода = 0;
      for (let i = 0; i < 4000; i++) {
        const x = (i * 137.7) % U.WS, z = (i * 71.3 + (i / 64 | 0) * 29) % U.WS;
        счёт[U.forestType(x, z)]++;
        if (U.isWater(x, z)) вода++;
      }
      const пусто = счёт.map((v, i) => [i, v]).filter(([, v]) => v === 0);
      if (пусто.length) плохие.push(сид + ': нет выделов ' + пусто.map(([i]) => U.FOREST_NAME[i]).join(','));
      if (вода / 4000 > 0.42) плохие.push(сид + ': воды ' + Math.round(вода / 40) + '%');
      доли[сид] = счёт.map((v) => Math.round(v / 40) + '%').join(' ') + ' | вода ' + Math.round(вода / 40) + '%';
    }
    U.setDaySeed(сегодня);
    W.placeCamps();
    отчёт['сиды'] = { проверено: дней, плохих: плохие.length, что: плохие.slice(0, 8) };
    отчёт['пример долей'] = Object.entries(доли).slice(0, 3)
      .map(([s, v]) => s + ': ' + v);
  }

  /* --- спрос дня: цены не должны уходить в ноль или бесконечность --- */
  {
    const плохие = [];
    for (let d = 0; d < дней; d++) {
      M.setDemand(U.todaySeed() + d);
      for (const sp of Object.values(M.SPECIES)) {
        const p = sp.price;
        if (!Number.isFinite(p)) { плохие.push('цена не число у ' + sp.name); break; }
        if (p < 0) плохие.push('отрицательная цена у ' + sp.name);
      }
    }
    M.setDemand(U.todaySeed());
    отчёт['спрос'] = { плохих: плохие.length, что: плохие.slice(0, 5) };
  }

  /* --- погода: все состояния должны отрабатывать без следов --- */
  {
    g.start('qa-погода');
    const было = [];
    for (const w of ['clear', 'rain', 'fog', 'wind', 'clear']) {
      g.world.setWeather(w);
      крутить(g, U, 12);
      было.push(w + ':' + (g.world.weather || '?') + ' сырость ' + (+g.world.wet).toFixed(2));
    }
    отчёт['погода'] = было;
  }

  /* --- мухоморный приход: экран должен вернуться в норму --- */
  {
    g.start('qa-приход');
    const чисто = () => (document.documentElement.style.getPropertyValue('--trip') || '0');
    const доПрихода = чисто();
    g.tripT = 30;
    крутить(g, U, 5);
    const вПриходе = чисто();
    крутить(g, U, 40);
    отчёт['приход'] = { до: доПрихода, вПриходе, после: чисто(), остаток: +g.tripT.toFixed(2) };
  }

  /* --- вёрстка: до всего кликабельного должно быть можно домотать --- */
  {
    // Ловушка флексбокса: при центрировании через align-items то, что не
    // влезло сверху, уходит ЗА начало прокрутки. На низком окне кнопка
    // «В ЛЕС» так стала недосягаемой, и игру нельзя было запустить.
    // Проверка идёт при том размере окна, в каком запущен стенд.
    const беды = [];
    for (const id of ['screen-start', 'screen-end', 'screen-pause']) {
      const s = document.getElementById(id);
      if (!s) { беды.push(id + ': нет в разметке'); continue; }
      const былоСкрыто = s.hidden;
      s.hidden = false;                       // проверяем вёрстку, а не текущий экран
      const предел = s.scrollHeight;
      for (const el of s.querySelectorAll('button, input, select')) {
        const r = el.getBoundingClientRect();
        const верх = r.top + s.scrollTop;     // в координатах прокрутки экрана
        const низ = r.bottom + s.scrollTop;
        if (верх < -1 || низ > предел + 1) {
          беды.push(id + ' / ' + (el.id || el.tagName.toLowerCase()) +
                    ': не домотать (верх ' + Math.round(верх) + ', предел ' + предел + ')');
        }
      }
      s.hidden = былоСкрыто;
    }
    отчёт['вёрстка'] = { окно: innerWidth + '×' + innerHeight,
                         недостижимых: беды.length, что: беды.slice(0, 6) };
    for (const б of беды) беда('вёрстка', б);
  }


  отчёт['ошибки'] = ОШИБКИ.map((e) => e.ключ);
  отчёт['итог'] = ОШИБКИ.length ? ('НАЙДЕНО: ' + ОШИБКИ.length) : 'чисто';
  return отчёт;
};
