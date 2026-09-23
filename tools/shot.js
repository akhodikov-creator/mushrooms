/* Помощники для снимков из консоли (как tools/bench.js и tools/qa.js).

   await import('/tools/shot.js')
   await __ready()                          дождаться игры и начать день
   await __lookAt(tris, dist, pitch, ang)   встать у ближайшего предмета
                                            с таким числом треугольников
   __ab('подпись', on, off)                 кадр «до/после»: on() и off()
                                            включают и выключают правку
   __show(canvas)                           показать холст поверх страницы
*/
window.__ready = async () => {
  for (let i = 0; i < 80 && !window.__game; i++) await new Promise((r) => setTimeout(r, 500));
  const g = window.__game;
  if (g.state !== 'playing') g.start('qa');
  await new Promise((r) => setTimeout(r, 800));
  return g;
};

window.__lookAt = async (tris, dist = 3.5, h = -0.25, ang) => {
  const g = window.__game, w = g.world, p = g.player;
  let best = null, bd = 1e9;
  for (const c of w.chunks.values()) c.group.traverse((o) => {
    if (!o.isInstancedMesh) return;
    const k = Math.round((o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3);
    if (k !== tris) return;
    const a = o.instanceMatrix.array;
    for (let i = 0; i < o.count; i++) {
      const x = c.group.position.x + a[i * 16 + 12], z = c.group.position.z + a[i * 16 + 14];
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < bd) { bd = d; best = [x, z]; }
    }
  });
  if (!best) return 'нет';
  ang = ang ?? Math.random() * 6.28;
  p.x = best[0] + Math.cos(ang) * dist; p.z = best[1] + Math.sin(ang) * dist;
  g.state = 'playing';
  for (let i = 0; i < 20; i++) { g._update(1 / 60); await new Promise((r) => setTimeout(r, 10)); }
  p.yaw = Math.atan2(-(best[0] - p.x), -(best[1] - p.z)); p.pitch = h;
  for (let i = 0; i < 3; i++) g._update(1 / 60);
  g.state = 'test';
  g.render();
  return best;
};

window.__show = (c) => {
  document.querySelectorAll('.__shot').forEach((e) => e.remove());
  c.className = '__shot';
  c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;max-width:100vw';
  for (const e of document.body.children) e.style.visibility = 'hidden';
  c.style.visibility = 'visible';
  document.body.appendChild(c);
};

/** Кадр прямо из видеопамяти: drawImage у холста WebGL отдаёт прежний кадр. */
window.__grab = () => {
  const g = window.__game;
  g.render();
  const gl = g.renderer.getContext();
  const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
  const px = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d'), img = x.createImageData(w, h);
  for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
  x.putImageData(img, 0, 0);
  return c;
};

window.__ab = (label, on, off) => {
  const c = document.createElement('canvas');
  c.width = innerWidth; c.height = innerHeight;
  const x = c.getContext('2d'), H = innerHeight / 2;
  on();
  let f = window.__grab();
  x.drawImage(f, 0, f.height * 0.25, f.width, f.height / 2, 0, 0, innerWidth, H);
  off();
  f = window.__grab();
  x.drawImage(f, 0, f.height * 0.25, f.width, f.height / 2, 0, H, innerWidth, H);
  on();
  x.fillStyle = '#ff0'; x.font = '16px sans-serif';
  x.fillText(label + ' — после', 8, 20); x.fillText('до', 8, H + 20);
  window.__show(c);
};
'готово';

/* Витрина грибов: по три в ряд, крупно, отдельным рендером.
   await __mushrooms(['bely','podosinovik',…], variant) */
window.__mushrooms = async (ids, variant = 0, fromBelow = false) => {
  const T = await import('three');
  const M = await import('/js/mushrooms.js');
  const g = window.__game;
  const W = innerWidth, H = Math.floor(innerHeight / 3);
  const r = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  r.setSize(W, H); r.outputColorSpace = T.SRGBColorSpace;
  r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1.16;
  const out = document.createElement('canvas'); out.width = W; out.height = H * 3;
  const ox = out.getContext('2d');
  for (let row = 0; row < 3; row++) {
    const sc = new T.Scene(); sc.background = new T.Color(0x9fb4c8);
    sc.environment = g.scene.environment;
    sc.add(new T.HemisphereLight(0xdfe8ff, 0x4a4030, 1.1));
    const d = new T.DirectionalLight(0xfff0d8, 2.2); d.position.set(0.5, 1, 0.7); sc.add(d);
    const gr = new T.Mesh(new T.PlaneGeometry(10, 10), new T.MeshStandardMaterial({ color: 0x5a5230, roughness: 1 }));
    gr.rotation.x = -Math.PI / 2; sc.add(gr);
    const list = ids.slice(row * 3, row * 3 + 3);
    list.forEach((id, i) => {
      const geo = M.getMushroomGeometry(M.SPECIES_BY_ID[id], variant);
      const m = new T.Mesh(geo, M.MAT_MUSHROOM);
      m.position.set((i - 1) * 0.36, 0, 0);
      sc.add(m);
    });
    const cam = new T.PerspectiveCamera(32, W / H, 0.01, 20);
    if (fromBelow) cam.position.set(0, 0.03, 0.85); else cam.position.set(0, 0.32, 0.85);
    cam.lookAt(0, 0.12, 0);
    r.render(sc, cam);
    ox.drawImage(r.domElement, 0, row * H);
    ox.fillStyle = '#222'; ox.font = '13px sans-serif';
    list.forEach((id, i) => ox.fillText(id, W / 2 + (i - 1) * W * 0.33 - 30, row * H + 16));
  }
  r.dispose();
  window.__show(out);
  return 'ok';
};

/* Кадр в широком формате, как на обычном мониторе, даже если панель
   узкая: размер кадра меняется на время снимка и возвращается.
   crop = [x0, y0, x1, y1] в долях кадра — какую часть показать. */
window.__grabWide = (w = 1280, h = 720) => {
  const g = window.__game, r = g.renderer, cam = g.camera;
  const pw = r.domElement.width, ph = r.domElement.height, asp = cam.aspect;
  r.setSize(w, h, false);
  cam.aspect = w / h; cam.updateProjectionMatrix();
  if (g.post) g.post.setSize();
  const c = window.__grab();
  r.setSize(pw, ph, false);
  cam.aspect = asp; cam.updateProjectionMatrix();
  if (g.post) g.post.setSize();
  return c;
};
window.__tiles = (frames, crop = [0, 0, 1, 1]) => {
  const W = innerWidth, H = Math.floor(innerHeight / frames.length);
  const out = document.createElement('canvas'); out.width = W; out.height = H * frames.length;
  const x = out.getContext('2d');
  frames.forEach(([label, f], i) => {
    const sx = f.width * crop[0], sy = f.height * crop[1];
    const sw = f.width * (crop[2] - crop[0]), sh = f.height * (crop[3] - crop[1]);
    const k = Math.min(W / sw, H / sh);
    x.drawImage(f, sx, sy, sw, sh, 0, i * H, sw * k, sh * k);
    x.fillStyle = '#ff0'; x.font = '14px sans-serif'; x.fillText(label, 6, i * H + 16);
  });
  window.__show(out);
};
