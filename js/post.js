/* ============================================================
   Постобработка: лучи сквозь кроны, свечение, цветокоррекция
   ============================================================
   Кадр рисуется как раньше — прямо на экран, с тем же тонмаппингом.
   Потом он копируется в текстуру и проходит три дешёвых прохода:

     1. лучи — от солнца по экрану тянутся полосы света там, где небо
        видно сквозь ветки (половинное разрешение);
     2. свечение — яркое чуть расплывается: солнце в кронах, светлячки,
        налобник, светящиеся грибы (четверть разрешения);
     3. итог — всё складывается, сверху цветокоррекция: тёплый свет,
        прохладные тени, мягкий контраст и виньетка.

   Небо помечается нулевой альфой (см. world.js, uniform skyA). Лучи
   рождаются только из неба: светлый ягель и песок на солнце яркие не
   меньше, но полос из земли быть не должно.

   Всё работает в «экранных» цветах, после тонмаппинга. Поэтому вид
   неба, тумана и кровавого неба остаётся ровно тем, каким был, — пост
   только добавляет поверх. На низком качестве модуль не создаётся.
   ============================================================ */
import * as THREE from 'three';

const VERT = `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;

/* --- лучи ---
   Радиальное размытие маски неба к точке солнца. Маска — только небо и
   только вблизи солнца, иначе весь горизонт светился бы полосами. */
const RAYS = `
  uniform sampler2D tSrc;
  uniform vec2 sunUv;
  uniform float aspect;
  varying vec2 vUv;
  #define N 40
  void main() {
    vec2 d = (vUv - sunUv) * (0.9 / float(N));
    vec2 uv = vUv;
    float w = 1.0, acc = 0.0;
    for (int i = 0; i < N; i++) {
      uv -= d;
      vec4 s = texture2D(tSrc, uv);
      float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
      float sky = (1.0 - s.a) * inside;
      float near = exp(-length((uv - sunUv) * vec2(aspect, 1.0)) * 2.8);
      acc += sky * near * dot(s.rgb, vec3(0.3, 0.5, 0.2)) * w;
      w *= 0.965;
    }
    gl_FragColor = vec4(vec3(acc / float(N) * 3.2), 1.0);
  }`;

/* --- свечение: выборка яркого с уменьшением --- */
const BRIGHT = `
  uniform sampler2D tSrc;
  uniform vec2 texel;
  uniform float thr;
  varying vec2 vUv;
  vec3 tap(vec2 o) {
    vec4 s = texture2D(tSrc, vUv + o * texel);
    // небо светится слабее: оно яркое целиком, и без поправки весь
    // край крон тонул бы в молочной дымке
    float l = max(s.r, max(s.g, s.b));
    return s.rgb * smoothstep(thr, thr + 0.22, l) * mix(0.12, 1.0, s.a);
  }
  void main() {
    vec3 c = tap(vec2(-1.0, -1.0)) + tap(vec2(1.0, -1.0)) + tap(vec2(-1.0, 1.0)) + tap(vec2(1.0, 1.0));
    gl_FragColor = vec4(c * 0.25, 1.0);
  }`;

/* --- свечение: гауссово размытие в одну сторону (9 выборок за 5 чтений) --- */
const BLUR = `
  uniform sampler2D tSrc;
  uniform vec2 dir;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
    c += texture2D(tSrc, vUv + dir * 1.3846153846).rgb * 0.3162162162;
    c += texture2D(tSrc, vUv - dir * 1.3846153846).rgb * 0.3162162162;
    c += texture2D(tSrc, vUv + dir * 3.2307692308).rgb * 0.0702702703;
    c += texture2D(tSrc, vUv - dir * 3.2307692308).rgb * 0.0702702703;
    gl_FragColor = vec4(c, 1.0);
  }`;

/* --- итог --- */
const FINAL = `
  uniform sampler2D tSrc, tBloom, tRays;
  uniform vec3 raysCol;
  uniform float raysK, bloomK, grade, vign, blood;
  uniform vec2 res;
  varying vec2 vUv;
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  void main() {
    vec4 src = texture2D(tSrc, vUv);
    vec3 c = src.rgb;
    // Свечение и лучи — «экраном», чтобы светлое не пережигалось в белое.
    // Над открытым небом лучи втрое слабее: там от них только молочный
    // ореол, а полосы видны на фоне крон и земли.
    float rk = raysK * mix(0.3, 1.0, src.a);
    vec3 add = texture2D(tBloom, vUv).rgb * bloomK + raysCol * texture2D(tRays, vUv).r * rk;
    c = 1.0 - (1.0 - c) * (1.0 - clamp(add, 0.0, 1.0));

    // Цветокоррекция. Тени чуть в холодную зелень, света в тёплое —
    // так выглядит лес в солнечный день на плёнке. Потом мягкий
    // S-контраст и насыщенность, щадящая и без того яркую зелень.
    float l = luma(c);
    vec3 cool = vec3(0.9, 0.99, 1.06), warm = vec3(1.07, 1.0, 0.9);
    c *= mix(vec3(1.0), mix(cool, warm, smoothstep(0.18, 0.75, l)), grade);
    vec3 s = c * c * (3.0 - 2.0 * c);
    c = mix(c, s, 0.4 * grade);
    l = luma(c);
    float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
    c = mix(vec3(l), c, 1.0 + 0.22 * grade * (1.0 - sat));

    // кровавое небо: лес тоже немного наливается красным
    c = mix(c, c * vec3(1.18, 0.82, 0.78), blood * 0.5);

    // виньетка по краям
    vec2 v = (vUv - 0.5) * vec2(res.x / res.y, 1.0);
    c *= 1.0 - vign * smoothstep(0.35, 1.05, length(v));

    // лёгкий шум против полос на плавных переходах неба
    float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    c += (n - 0.5) / 255.0;
    gl_FragColor = vec4(c, 1.0);
  }`;

function shader(frag, uniforms) {
  return new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader: frag, uniforms,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
}

function target(w, h) {
  return new THREE.WebGLRenderTarget(w, h, {
    depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
}

export class Post {
  constructor(renderer) {
    this.r = renderer;
    this.qScene = new THREE.Scene();
    this.qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this.quad.frustumCulled = false;
    this.qScene.add(this.quad);

    this.src = null;
    this.rtRays = target(4, 4);
    this.rtA = target(4, 4);
    this.rtB = target(4, 4);

    this.mRays = shader(RAYS, {
      tSrc: { value: null }, sunUv: { value: new THREE.Vector2() }, aspect: { value: 1 },
    });
    this.mBright = shader(BRIGHT, {
      tSrc: { value: null }, texel: { value: new THREE.Vector2() }, thr: { value: 0.78 },
    });
    this.mBlur = shader(BLUR, { tSrc: { value: null }, dir: { value: new THREE.Vector2() } });
    this.mFinal = shader(FINAL, {
      tSrc: { value: null }, tBloom: { value: this.rtA.texture }, tRays: { value: this.rtRays.texture },
      raysCol: { value: new THREE.Color(1, 0.95, 0.8) }, raysK: { value: 0 },
      bloomK: { value: 0.55 }, grade: { value: 1 }, vign: { value: 0.38 }, blood: { value: 0 },
      res: { value: new THREE.Vector2(1, 1) },
    });

    this._v = new THREE.Vector3();
    this._f = new THREE.Vector3();
    this._size = new THREE.Vector2();
    this.setSize();
  }

  setSize() {
    this.r.getDrawingBufferSize(this._size);
    const w = Math.max(4, this._size.x), h = Math.max(4, this._size.y);
    if (this.src) this.src.dispose();
    this.src = new THREE.FramebufferTexture(w, h);
    this.src.minFilter = this.src.magFilter = THREE.LinearFilter;
    this.rtRays.setSize(Math.ceil(w / 2), Math.ceil(h / 2));
    this.rtA.setSize(Math.ceil(w / 4), Math.ceil(h / 4));
    this.rtB.setSize(Math.ceil(w / 4), Math.ceil(h / 4));
    this.mBright.uniforms.texel.value.set(1 / w, 1 / h);
    this.mFinal.uniforms.res.value.set(w, h);
    this.mRays.uniforms.aspect.value = w / h;
    for (const m of [this.mRays, this.mBright, this.mFinal]) m.uniforms.tSrc.value = this.src;
  }

  _draw(mat, rt) {
    this.quad.material = mat;
    this.r.setRenderTarget(rt);
    this.r.render(this.qScene, this.qCam);
  }

  /**
   * Кадр с постобработкой. world нужен ради солнца, погоды и времени
   * суток: лучи есть только днём, в ясную погоду и когда солнце впереди.
   */
  render(scene, camera, world) {
    const r = this.r;
    r.setRenderTarget(null);
    r.render(scene, camera);
    r.copyFramebufferToTexture(this.src);

    // солнце на экране
    const sun = world.sun;
    const sd = this._v.copy(sun.position).sub(sun.target.position).normalize();
    camera.getWorldDirection(this._f);
    const facing = this._f.dot(sd);
    let rays = 0;
    if (facing > 0.05) {
      const p = this._f.copy(camera.position).addScaledVector(sd, 400).project(camera);
      this.mRays.uniforms.sunUv.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
      const day = THREE.MathUtils.clamp((sun.intensity - 0.35) / 1.1, 0, 1);
      const clear = 1 - Math.min(1, (world.fogBoost || 0) * 0.8 + (world.wet || 0) * 0.6);
      rays = day * clear * THREE.MathUtils.smoothstep(facing, 0.05, 0.5) * (1 - (world.night || 0));
    }
    const U = this.mFinal.uniforms;
    U.raysK.value = rays * 0.9;
    U.raysCol.value.copy(sun.color);
    U.blood.value = world.blood || 0;
    if (rays > 0.01) this._draw(this.mRays, this.rtRays);
    else { r.setRenderTarget(this.rtRays); r.clear(true, false, false); }

    // свечение: ночью сильнее — там светится всё, что светится
    U.bloomK.value = 0.45 + (world.night || 0) * 0.5;
    this._draw(this.mBright, this.rtA);
    const bw = this.rtA.width, bh = this.rtA.height;
    this.mBlur.uniforms.tSrc.value = this.rtA.texture;
    this.mBlur.uniforms.dir.value.set(1.4 / bw, 0);
    this._draw(this.mBlur, this.rtB);
    this.mBlur.uniforms.tSrc.value = this.rtB.texture;
    this.mBlur.uniforms.dir.value.set(0, 1.4 / bh);
    this._draw(this.mBlur, this.rtA);

    this._draw(this.mFinal, null);
  }
}
