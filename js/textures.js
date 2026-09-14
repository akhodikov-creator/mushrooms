import * as THREE from 'three';
import { rng } from './utils.js';

/* ============================================================
   Процедурные текстуры.
   Всё рисуется в <canvas> при запуске — ни одного внешнего файла.
   Кэшируются, так что каждая создаётся один раз.
   ============================================================ */

const cache = new Map();

function make(name, w, h, draw, opts = {}) {
  if (cache.has(name)) return cache.get(name);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = opts.wrap ?? THREE.RepeatWrapping;
  t.wrapT = opts.wrap ?? THREE.RepeatWrapping;
  t.colorSpace = opts.data ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = opts.aniso ?? 4;
  if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
  t.needsUpdate = true;
  cache.set(name, t);
  return t;
}

/** Мягкий шум-облака: складываем прямоугольники разного масштаба. */
function cloudNoise(g, w, h, seed, octaves = 5, alpha = 0.5) {
  const r = rng(seed);
  g.globalAlpha = alpha;
  for (let o = 0; o < octaves; o++) {
    const step = Math.max(2, (w >> o) / 4);
    for (let y = 0; y < h; y += step) {
      for (let x = 0; x < w; x += step) {
        const v = (r() * 255) | 0;
        g.fillStyle = `rgb(${v},${v},${v})`;
        g.fillRect(x, y, step, step);
      }
    }
  }
  g.globalAlpha = 1;
}

/* ---------------- земля / мох ---------------- */
export const groundTex = () => make('ground', 512, 512, (g, w, h) => {
  g.fillStyle = '#6b7c3c';
  g.fillRect(0, 0, w, h);
  const r = rng(1337);
  // пятна мха и прелой листвы
  for (let i = 0; i < 2600; i++) {
    const x = r() * w, y = r() * h;
    const rad = 2 + r() * 16;
    const t = r();
    g.fillStyle = t < 0.34 ? `rgba(96,124,52,${0.15 + r() * 0.3})`
      : t < 0.68 ? `rgba(122,100,56,${0.12 + r() * 0.25})`
        : `rgba(52,70,30,${0.15 + r() * 0.3})`;
    g.beginPath(); g.arc(x, y, rad, 0, 6.28); g.fill();
  }
  // хвоя и веточки
  for (let i = 0; i < 900; i++) {
    const x = r() * w, y = r() * h, a = r() * 6.28, len = 3 + r() * 9;
    g.strokeStyle = `rgba(${70 + r() * 40 | 0},${52 + r() * 30 | 0},28,${0.2 + r() * 0.4})`;
    g.lineWidth = 0.8 + r() * 0.9;
    g.beginPath(); g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
  }
}, { repeat: [1, 1] });

/* ---------------- кора ---------------- */
export const barkTex = () => make('bark', 256, 512, (g, w, h) => {
  g.fillStyle = '#5b4227';
  g.fillRect(0, 0, w, h);
  const r = rng(77);
  for (let i = 0; i < 190; i++) {
    const x = r() * w;
    const wid = 2 + r() * 11;
    const dark = r() < 0.5;
    g.fillStyle = dark ? `rgba(30,20,10,${0.12 + r() * 0.4})` : `rgba(140,110,72,${0.06 + r() * 0.2})`;
    // вертикальная борозда с дрожанием
    g.beginPath();
    let cx = x;
    g.moveTo(cx, 0);
    for (let y = 0; y <= h; y += 16) {
      cx += (r() - 0.5) * 5;
      g.lineTo(cx, y);
    }
    for (let y = h; y >= 0; y -= 16) {
      cx += (r() - 0.5) * 3;
      g.lineTo(cx + wid, y);
    }
    g.closePath(); g.fill();
  }
  for (let i = 0; i < 400; i++) {
    const x = r() * w, y = r() * h;
    g.fillStyle = `rgba(90,110,60,${r() * 0.16})`;
    g.beginPath(); g.arc(x, y, 1 + r() * 5, 0, 6.28); g.fill();
  }
}, { repeat: [1, 1] });

export const birchTex = () => make('birch', 256, 512, (g, w, h) => {
  g.fillStyle = '#e7e3d6';
  g.fillRect(0, 0, w, h);
  const r = rng(909);
  for (let i = 0; i < 260; i++) {
    const x = r() * w, y = r() * h;
    g.fillStyle = `rgba(190,182,164,${r() * 0.5})`;
    g.fillRect(x, y, 1 + r() * 30, 1 + r() * 3);
  }
  // характерные чёрные чёрточки
  for (let i = 0; i < 46; i++) {
    const x = r() * w, y = r() * h;
    const len = 12 + r() * 46;
    g.fillStyle = `rgba(26,22,20,${0.55 + r() * 0.4})`;
    g.beginPath();
    g.ellipse(x, y, len / 2, 2 + r() * 3.5, 0, 0, 6.28);
    g.fill();
  }
  for (let i = 0; i < 10; i++) {
    const y = r() * h;
    g.fillStyle = `rgba(60,50,40,${0.1 + r() * 0.2})`;
    g.fillRect(0, y, w, 1 + r() * 2);
  }
}, { repeat: [1, 1] });

/* ---------------- трава: пучок с прозрачным фоном ---------------- */
export const grassTex = () => make('grass', 128, 128, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  const r = rng(4242);
  const blade = (x0, tipDx, wid, c1, c2) => {
    const grad = g.createLinearGradient(0, h, 0, 0);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(x0 - wid, h);
    g.quadraticCurveTo(x0 - wid * 0.5, h * 0.45, x0 + tipDx, 4);
    g.quadraticCurveTo(x0 + wid * 0.5, h * 0.45, x0 + wid, h);
    g.closePath(); g.fill();
  };
  // несколько травинок в кадре — так один квад выглядит пучком
  blade(w * 0.5, (r() - 0.5) * 26, 9, '#243a12', '#6f9438');
  blade(w * 0.26, (r() - 0.5) * 30, 7, '#1e3210', '#5f8730');
  blade(w * 0.74, (r() - 0.5) * 30, 7, '#22380f', '#79a03f');
  blade(w * 0.4, (r() - 0.5) * 40, 4.5, '#1b2c0d', '#54782a');
  blade(w * 0.62, (r() - 0.5) * 40, 4.5, '#1b2c0d', '#6b8f34');
}, { wrap: THREE.ClampToEdgeWrapping });

/* ---------------- листва и хвоя ---------------- */
export const leafTex = () => make('leaf', 128, 128, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  const r = rng(555);
  for (let i = 0; i < 26; i++) {
    const x = 12 + r() * (w - 24), y = 12 + r() * (h - 24);
    const rad = 8 + r() * 15;
    const a = r() * 6.28;
    const v = 0.55 + r() * 0.45;
    g.fillStyle = `rgba(${(70 * v) | 0},${(112 * v) | 0},${(38 * v) | 0},1)`;
    g.beginPath();
    g.ellipse(x, y, rad, rad * (0.5 + r() * 0.4), a, 0, 6.28);
    g.fill();
  }
}, { wrap: THREE.ClampToEdgeWrapping });

export const needleTex = () => make('needle', 128, 128, (g, w, h) => {
  g.clearRect(0, 0, w, h);
  const r = rng(31337);
  // Ветка идёт по центру, иглы расходятся почти на всю высоту кадра —
  // иначе на квадрате остаётся тонкая полоска хвои и дерево лысое.
  g.strokeStyle = '#5a4622';
  g.lineWidth = 3.5;
  g.beginPath(); g.moveTo(2, h / 2); g.lineTo(w - 2, h / 2); g.stroke();
  for (let i = 0; i < 300; i++) {
    const x = 2 + r() * (w - 4);
    const up = r() < 0.5 ? -1 : 1;
    // короче у основания ветки, длиннее к середине
    const taper = 1 - Math.abs(x / w - 0.45) * 0.55;
    const len = (26 + r() * 34) * taper;
    const v = 0.62 + r() * 0.5;
    g.strokeStyle = `rgba(${(58 * v) | 0},${(104 * v) | 0},${(44 * v) | 0},1)`;
    g.lineWidth = 1.7 + r() * 1.7;
    g.beginPath();
    g.moveTo(x, h / 2 + up * 2);
    g.lineTo(x + (r() - 0.5) * 20, h / 2 + up * len);
    g.stroke();
  }
}, { wrap: THREE.ClampToEdgeWrapping });

/* ---------------- шерсть ---------------- */
export const furTex = (name, base, seed) => make('fur_' + name, 256, 256, (g, w, h) => {
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);
  const r = rng(seed);
  for (let i = 0; i < 5200; i++) {
    const x = r() * w, y = r() * h;
    const a = -1.3 + (r() - 0.5) * 0.9;
    const len = 4 + r() * 13;
    const light = r() < 0.5;
    g.strokeStyle = light ? `rgba(255,240,215,${r() * 0.13})` : `rgba(0,0,0,${r() * 0.22})`;
    g.lineWidth = 0.7 + r() * 1.1;
    g.beginPath(); g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len); g.stroke();
  }
});

/* ---------------- чешуя (хариус) ---------------- */
export const scaleTex = () => make('scale', 256, 256, (g, w, h) => {
  g.fillStyle = '#9aa8b2';
  g.fillRect(0, 0, w, h);
  const r = rng(6161);
  const s = 13;
  for (let y = 0; y < h + s; y += s * 0.6) {
    for (let x = 0; x < w + s; x += s) {
      const ox = (Math.round(y / (s * 0.6)) % 2) * s * 0.5;
      g.strokeStyle = `rgba(60,80,96,${0.25 + r() * 0.3})`;
      g.lineWidth = 1;
      g.beginPath();
      g.arc(x + ox, y, s * 0.5, 0.1, Math.PI - 0.1);
      g.stroke();
    }
  }
  for (let i = 0; i < 700; i++) {
    const x = r() * w, y = r() * h;
    g.fillStyle = `rgba(${r() < 0.5 ? '255,255,255' : '30,44,56'},${r() * 0.18})`;
    g.beginPath(); g.arc(x, y, 1 + r() * 6, 0, 6.28); g.fill();
  }
});

/* ---------------- шляпка гриба ---------------- */
export const capTex = () => make('cap', 256, 256, (g, w, h) => {
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, w, h);
  const r = rng(2024);

  // мягкая неровность тона
  for (let i = 0; i < 1200; i++) {
    const x = r() * w, y = r() * h;
    const v = r() < 0.5 ? 0 : 255;
    g.fillStyle = `rgba(${v},${v},${v},${r() * 0.13})`;
    g.beginPath(); g.arc(x, y, 1 + r() * 11, 0, 6.28); g.fill();
  }

  // Волокна. Раньше все 150 линий выходили ровно из центра холста,
  // складывались там и выжигали чёрное пятно — на шляпке оно читалось
  // как дырка. Теперь линии стартуют от кольца и не пересекают центр.
  for (let i = 0; i < 130; i++) {
    const a = r() * 6.28;
    const r0 = 26 + r() * 34;
    g.strokeStyle = `rgba(0,0,0,${0.015 + r() * 0.045})`;
    g.lineWidth = 0.7 + r() * 1.1;
    g.beginPath();
    g.moveTo(w / 2 + Math.cos(a) * r0, h / 2 + Math.sin(a) * r0);
    g.lineTo(w / 2 + Math.cos(a) * w, h / 2 + Math.sin(a) * h);
    g.stroke();
  }

  // продольные штрихи: на развёртке боковины это радиальные волокна
  for (let i = 0; i < 90; i++) {
    const x = r() * w;
    g.strokeStyle = `rgba(${r() < 0.5 ? '0,0,0' : '255,255,255'},${0.02 + r() * 0.05})`;
    g.lineWidth = 0.7 + r() * 1.6;
    g.beginPath();
    g.moveTo(x, 0);
    for (let y = 0; y <= h; y += 32) g.lineTo(x + Math.sin(y * 0.03 + i) * 3, y);
    g.stroke();
  }
});

/* ---------------- кожа руки и ткань рукава ---------------- */
export const skinTex = () => make('skin', 128, 128, (g, w, h) => {
  g.fillStyle = '#c98d68';
  g.fillRect(0, 0, w, h);
  const r = rng(4711);
  // неровный тон и поры, иначе кисть выглядит пластмассовой
  for (let i = 0; i < 900; i++) {
    const x = r() * w, y = r() * h;
    g.fillStyle = r() < 0.5
      ? `rgba(168,104,74,${r() * 0.16})`
      : `rgba(240,196,164,${r() * 0.14})`;
    g.beginPath(); g.arc(x, y, 1 + r() * 9, 0, 6.28); g.fill();
  }
  for (let i = 0; i < 26; i++) {           // складки на костяшках
    const y = r() * h;
    g.strokeStyle = `rgba(140,84,58,${0.05 + r() * 0.13})`;
    g.lineWidth = 0.8 + r() * 1.4;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= w; x += 16) g.lineTo(x, y + Math.sin(x * 0.08 + i) * 2.5);
    g.stroke();
  }
});

export const clothTex = () => make('cloth', 128, 128, (g, w, h) => {
  g.fillStyle = '#4a5a38';
  g.fillRect(0, 0, w, h);
  const r = rng(1212);
  for (let i = 0; i < 3000; i++) {         // плетение брезента
    const x = r() * w, y = r() * h;
    g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${r() * 0.2})` : `rgba(200,210,180,${r() * 0.12})`;
    g.fillRect(x, y, 1 + r() * 3, 1 + r() * 2);
  }
  for (let i = 0; i < 40; i++) {
    const y = (i / 40) * h;
    g.strokeStyle = `rgba(0,0,0,${0.05 + r() * 0.08})`;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
  }
});

/* ---------------- металл ---------------- */
export const metalTex = () => make('metal', 256, 256, (g, w, h) => {
  g.fillStyle = '#8f949c';
  g.fillRect(0, 0, w, h);
  const r = rng(808);
  for (let i = 0; i < 2400; i++) {
    const y = r() * h;
    g.strokeStyle = `rgba(${r() < 0.5 ? '255,255,255' : '0,0,0'},${r() * 0.09})`;
    g.lineWidth = 0.6 + r() * 1.2;
    g.beginPath(); g.moveTo(0, y); g.lineTo(w, y + (r() - 0.5) * 4); g.stroke();
  }
});

export const woodTex = () => make('wood', 256, 256, (g, w, h) => {
  g.fillStyle = '#7a5527';
  g.fillRect(0, 0, w, h);
  const r = rng(191);
  for (let i = 0; i < 130; i++) {
    const y = r() * h;
    g.strokeStyle = `rgba(${r() < 0.5 ? '40,26,10' : '160,124,70'},${0.1 + r() * 0.35})`;
    g.lineWidth = 0.7 + r() * 3.2;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= w; x += 24) g.lineTo(x, y + Math.sin(x * 0.05 + i) * 3);
    g.stroke();
  }
});

/* ============================================================
   Карта окружения. Рендерим крошечную сцену «небо + земля»
   в кубическую карту — без неё металл в MeshStandardMaterial
   выглядит плоским и мёртвым.
   ============================================================ */
let envMap = null;
export function getEnvMap(renderer) {
  if (envMap) return envMap;
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const scene = new THREE.Scene();
  const geo = new THREE.SphereGeometry(50, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    uniforms: {},
    vertexShader: 'varying vec3 vP; void main(){ vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
    fragmentShader: `
      varying vec3 vP;
      void main(){
        vec3 d = normalize(vP);
        float t = clamp(d.y*0.5+0.5, 0.0, 1.0);
        vec3 sky = mix(vec3(0.55,0.62,0.52), vec3(0.35,0.55,0.85), t);
        vec3 ground = vec3(0.16,0.18,0.10);
        vec3 col = d.y < 0.0 ? mix(ground, vec3(0.5,0.53,0.45), pow(1.0+d.y, 6.0)) : sky;
        float sun = pow(max(0.0, dot(d, normalize(vec3(0.4,0.75,0.3)))), 40.0);
        col += vec3(1.0,0.92,0.75) * sun * 2.2;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  scene.add(new THREE.Mesh(geo, mat));
  envMap = pmrem.fromScene(scene, 0.04).texture;
  geo.dispose(); mat.dispose();
  pmrem.dispose();
  return envMap;
}

export function disposeTextures() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
