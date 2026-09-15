/* Замер отрисовки без опоры на requestAnimationFrame: панель предпросмотра
   бывает скрыта, кадры тогда не идут вовсе и любые «мс на кадр» врут.
   Здесь кадр рисуется руками, а gl.finish() ждёт, пока видеокарта
   действительно закончит, — получается честная стоимость кадра. */
window.__bench = async (biome = 2, frames = 60) => {
  const U = window.__U || (window.__U = await import('/js/utils.js'));
  const g = window.__game;
  let best = null;
  for (let i = 0; i < 40000; i++) {
    const x = (i * 97.3) % 512, z = (i * 53.7 + Math.floor(i / 512) * 31) % 512;
    if (U.forestType(x, z) !== biome) continue;
    let ok = true;
    for (const [dx, dz] of [[8,0],[-8,0],[0,8],[0,-8],[14,14],[-14,-14]])
      if (U.forestType(x + dx, z + dz) !== biome) { ok = false; break; }
    if (!ok) continue;
    best = [x, z]; break;
  }
  if (!best) return 'нет выдела ' + biome;
  g.player.x = best[0]; g.player.z = best[1]; g.player.pitch = -0.06;

  // дать миру достроить чанки вокруг новой точки
  for (let i = 0; i < 25; i++) { g._update(1 / 60); await new Promise(r => setTimeout(r, 12)); }

  const gl = g.renderer.getContext();
  const dt = [];
  for (let i = 0; i < frames; i++) {
    g.player.yaw = i * 0.05;                    // крутимся: просадки были при вращении
    g._update(1 / 60);
    const t = performance.now();
    g.renderer.render(g.scene, g.camera);
    gl.finish();
    dt.push(performance.now() - t);
    if ((i & 7) === 0) await new Promise(r => setTimeout(r, 0));
  }
  dt.splice(0, 8);                              // первые кадры — компиляция шейдеров
  const s = dt.slice().sort((a, b) => a - b);
  const R = g.renderer.info;
  return {
    выдел: U.FOREST_NAME[biome],
    вызовов: R.render.calls, треугольников: R.render.triangles,
    кадр_медиана: +s[s.length >> 1].toFixed(2),
    кадр_95: +s[(s.length * 0.95) | 0].toFixed(2),
    кадр_макс: +s[s.length - 1].toFixed(2),
  };
};
'готово';
