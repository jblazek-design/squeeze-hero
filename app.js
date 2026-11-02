/*
  @blazek.design — "Squeeze me" hero
  ───────────────────────────────────
  Open hand  → head is normal.  Squeeze into a fist → head crumples into a paper ball
  (121 keyed video frames scrubbed by how closed your hand is).
  Crumpled   → OUCH + bolts pop out with a sound. Open again → it unfolds (+ boing).
  Move hand  → whole page parallaxes; wave → head wobbles, "Say Hi!" waves back,
               (and cross-fades to assets/smile.png if you add one).
  Keys: Space / hold mouse = squeeze without camera · S = sound · C = camera ghost
        M = ignore camera (mouse only) · D = debug values
*/
import { FilesetResolver, HandLandmarker } from './vendor/mediapipe/vision_bundle.mjs';

// ─────────────────────────────── config
const CFG = {
  frames: 121,
  frameSrc: i => `frames/h${String(i).padStart(3, '0')}.webp`,
  srcW: 1302, srcH: 1372,                 // frame canvas in source units
  // where a frame sits in the Figma frame (1440×896): first frame = Step 1, last = Step 2
  start: { s: 0.5000, x: 457.5, y: 105.0 },
  end:   { s: 0.3823, x: 527.3, y: 213.4 },
  region: { x: 440, y: 95, w: 680, h: 705 }, // the head canvas (matches #headWrap in CSS)
  // hand openness = avg fingertip→wrist distance / palm length
  openLo: 1.05,          // ≈ fist
  openHi: 1.80,          // ≈ open hand
  follow: 7,             // how fast the head follows your hand
  // squeeze only kicks in for a real fist: closure below squeezeStart does nothing
  squeezeStart: 0.40,    // 0 = fully open … 1 = fist
  squeezeFull: 0.93,
  // wave = side-to-side swings of the fingertips (palm shift or wrist rotation)
  waveSpeed: 0.75,       // fingertip speed (frame widths / s) that counts as a swing
  waveSwings: 3,         // direction changes needed…
  waveWindow: 1500,      // …within this many ms
  confettiCooldown: 2200,
  // gesture control (whole page): ☝ index only = pointer, ✌ index+middle = scroll
  poseFrames: 4,         // a pose must hold this many camera frames before it switches
  dwell: 700,            // ms of hovering a button with the pointer = click
  pointerBox: [0.18, 0.14, 0.82, 0.78], // camera area (x0,y0,x1,y1) mapped to the whole screen
  scrollGain: 2.6,       // how much the page moves per hand movement (in screen heights)
  popOn: 0.86,           // stickers pop when squeeze passes this…
  popOff: 0.55,          // …and hide when it drops below this
  parallax: 1,           // overall parallax strength
  smileSrc: '',          // optional, e.g. 'assets/smile.png' — shown while you wave (same framing as frames/h000.webp)
};

// ─────────────────────────────── dom
const $ = s => document.querySelector(s);
const root = document.documentElement;
const bgCanvas = $('#bg');
const headCanvas = $('#head'), hctx = headCanvas.getContext('2d');
const headWrap = $('#headWrap'), stickersEl = $('#stickers');
const copyEl = $('#copy'), mediaLayer = $('#mediaLayer');
const cam = $('#cam'), skel = $('#skel'), sctx = skel.getContext('2d');
const hintText = $('#hintText'), meterBar = $('#meter b'), debugEl = $('#debug');
const hiChip = $('#hiChip'), soundBtn = $('#soundBtn');
const stickers = [$('#stOuch'), $('#stBolt1'), $('#stBolt2')];
const hiBubble = $('#stHi');
const fx = $('#fx'), fctx = fx.getContext('2d');
const heroEl = $('#hero'), stageEl = $('#stage');
const handCursor = $('#handCursor'), hudEl = $('#hud'), hudMode = $('#hudMode');
const hudSkel = $('#hudSkel'), hctx2 = hudSkel.getContext('2d');
new IntersectionObserver(([en]) => { S.heroVisible = en.isIntersecting; }, { threshold: 0.02 }).observe(heroEl);
const drawerOpen = () => !!(window.siteUI && window.siteUI.drawerOpen);
const typing = () => { const a = document.activeElement; return a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName); };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const clamp01 = v => clamp(v, 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// ─────────────────────────────── state
const S = {
  time: 0,
  t: 0, speed: 0,                 // squeeze 0 (open) … 1 (crumpled)
  handSq: 0, mouseSq: 0, pressed: false,
  par: { x: 0, y: 0 }, handPar: { x: 0, y: 0 }, mousePar: { x: 0, y: 0 }, mouseActive: false,
  vx: 0, mvx: 0, lastX: null, lastHandT: 0,
  flips: [], lastSign: 0, waveUntil: 0, wave: 0, wasWaving: false,
  tipX: null, tipV: 0, greet: 0, lastConfetti: -1e9, mflips: [], mSign: 0,
  pose: 'none', poseCand: 'none', poseN: 0,
  ptr: { x: 0, y: 0, tx: 0, ty: 0, on: false }, hoverEl: null, hoverT: 0, clickedEl: null,
  scrollY0: null, scrollAcc: 0, scrollV: 0,
  heroVisible: true,
  wob: { x: 0, v: 0 }, bounce: { x: 0, v: 0 },
  popped: false, crumpledOnce: false,
  hand: null, handAt: -1e9, ratio: null, lo: CFG.openLo, hi: CFG.openHi,
  input: 'camera', camStatus: 'starting', showCam: false, debug: false,
  loaded: 0, drawnIdx: -1, drawnSmile: -1, dirty: true,
  smileImg: null, smile: 0,
  view: null,
  u: 1, W: 1440, H: 896, portrait: false,
};

// ─────────────────────────────── layout
function layout() {
  const vw = innerWidth, vh = innerHeight;
  S.portrait = vw / vh < 0.9;
  S.u = S.portrait ? vw / 820 : Math.min(vw / 1440, vh / 896);
  S.W = vw / S.u; S.H = vh / S.u;
  root.style.setProperty('--u', S.u);
  root.style.setProperty('--W', S.W);
  root.style.setProperty('--H', S.H);
  root.classList.toggle('portrait', S.portrait);
  const dpr = Math.min(devicePixelRatio || 1, 2);
  headCanvas.width = Math.round(CFG.region.w * S.u * dpr);
  headCanvas.height = Math.round(CFG.region.h * S.u * dpr);
  skel.width = Math.round(250 * S.u * dpr);
  skel.height = Math.round(312 * S.u * dpr);
  const bgScale = Math.min(dpr, 1) * 0.6;   // the gradient is soft — render it at low res
  bgCanvas.width = Math.max(2, Math.round(vw * bgScale));
  bgCanvas.height = Math.max(2, Math.round(vh * bgScale));
  if (gl) gl.viewport(0, 0, bgCanvas.width, bgCanvas.height);
  fx.width = Math.round(vw * dpr); fx.height = Math.round(vh * dpr);
  S.dpr = dpr;
  S.drawnIdx = -1;
}
addEventListener('resize', layout);

// ─────────────────────────────── frames
const frames = new Array(CFG.frames).fill(null);
function loadFrames() {
  return new Promise(resolve => {
    let next = 0, done = 0;
    const order = [0, CFG.frames - 1, ...Array.from({ length: CFG.frames - 2 }, (_, i) => i + 1)];
    const pump = () => {
      if (next >= order.length) return;
      const i = order[next++];
      const img = new Image();
      img.decoding = 'async';
      img.src = CFG.frameSrc(i);
      const fin = () => {
        frames[i] = img.naturalWidth ? img : null;
        S.loaded = ++done;
        if (i === 0) firstFrameReady();
        if (done === CFG.frames) resolve(); else pump();
      };
      img.decode().then(fin, fin);
    };
    for (let k = 0; k < 6; k++) pump();
  });
}
function nearestFrame(idx) {
  for (let d = 0; d < CFG.frames; d++) {
    if (frames[idx - d]) return idx - d;
    if (frames[idx + d]) return idx + d;
  }
  return -1;
}
function framePlacement(idx) {
  const w = smooth(0.15, 0.9, idx / (CFG.frames - 1));
  return {
    s: lerp(CFG.start.s, CFG.end.s, w),
    x: lerp(CFG.start.x, CFG.end.x, w),
    y: lerp(CFG.start.y, CFG.end.y, w),
  };
}
function drawHead() {
  const want = Math.round(S.t * (CFG.frames - 1));
  const idx = nearestFrame(want);
  const smileQ = Math.round(S.smile * 40);
  if (idx < 0 || (idx === S.drawnIdx && smileQ === S.drawnSmile)) return;
  S.drawnIdx = idx; S.drawnSmile = smileQ;
  const k = headCanvas.width / CFG.region.w;
  hctx.setTransform(1, 0, 0, 1, 0, 0);
  hctx.clearRect(0, 0, headCanvas.width, headCanvas.height);
  hctx.setTransform(k, 0, 0, k, -CFG.region.x * k, -CFG.region.y * k);
  hctx.imageSmoothingQuality = 'high';
  const p = framePlacement(idx);
  hctx.globalAlpha = 1;
  hctx.drawImage(frames[idx], p.x, p.y, CFG.srcW * p.s, CFG.srcH * p.s);
  if (S.smileImg && S.smile > 0.02) {
    const p0 = framePlacement(0);
    hctx.globalAlpha = S.smile * (1 - S.t);
    hctx.drawImage(S.smileImg, p0.x, p0.y, CFG.srcW * p0.s, CFG.srcH * p0.s);
    hctx.globalAlpha = 1;
  }
}
// optional smile image
{
  if (CFG.smileSrc) {
    const im = new Image();
    im.onload = () => { S.smileImg = im; };
    im.src = CFG.smileSrc;
  }
}

// ─────────────────────────────── animated gradient (WebGL)
let gl = null, glU = {};
function initGL() {
  try { gl = bgCanvas.getContext('webgl', { antialias: false, alpha: false, premultipliedAlpha: false }); } catch { gl = null; }
  if (!gl) { root.classList.add('no-gl'); return; }
  const vs = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`;
  const fs = `
precision highp float;
uniform sampler2D uTex;
uniform vec2 uRes, uPar, uHead;
uniform float uTime, uSq, uWave, uWob;
vec2 mirror(vec2 u){ return 1. - abs(1. - mod(u, 2.)); }
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
void main(){
  // pixel → Figma frame coords (1440×896)
  vec2 f = vec2(gl_FragCoord.x / uRes.x * 1440., (1. - gl_FragCoord.y / uRes.y) * 896.);

  // mask: Figma's blurred ellipse (σ = 160) clipped to the 782px-tall rect
  vec2 pe = f - vec2(720.5, -80.5), r = vec2(1245.5, 588.5);
  float k0 = length(pe / r), k1 = length(pe / (r * r));
  float d = k0 * (k0 - 1.) / k1;
  float m = 1. / (1. + exp(1.702 * d / 160.));
  m *= smoothstep(800., 720., f.y);

  // squeeze → swirl the gradient into the head
  float T = uTime;
  vec2 dv = f - uHead;
  float fall = exp(-length(dv) / 460.);
  dv = rot(uSq * 0.65 * fall + uWob * 0.012 * fall) * dv;
  dv *= 1. + uSq * 0.22 * fall;
  vec2 g = uHead + dv;

  // slow liquid flow
  g.x += 62. * sin(g.y / 130. + T * 0.35) + 26. * sin(g.y / 57. - T * 0.61);
  g.y += 34. * cos(g.x / 210. - T * 0.27) + 15. * sin(g.x / 95. + T * 0.52);
  g.x += 90. * sin(T * 0.11);
  // hand parallax + wave ripples
  g += uPar * vec2(-46., -24.);
  g.x += uWave * 26. * sin(g.y / 34. - T * 7.);

  // Figma: image cover-fit into 1440×782, blurred, 32% black on top
  vec2 uv = vec2(g.x / 1440., (g.y + 889.) / 2560.);
  vec3 col = texture2D(uTex, mirror(uv)).rgb * 0.68;
  col *= 1. - 0.06 * uSq;
  vec3 base = vec3(244. / 255.);
  gl_FragColor = vec4(mix(base, col, m), 1.);
}`;
  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  try {
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['uTex', 'uRes', 'uPar', 'uHead', 'uTime', 'uSq', 'uWave', 'uWob']) glU[n] = gl.getUniformLocation(prog, n);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([40, 90, 160, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const img = new Image();
    img.onload = () => { gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); };
    img.src = 'assets/gradient.jpg';
    gl.uniform1i(glU.uTex, 0);
  } catch (e) {
    console.warn('WebGL gradient failed, using static fallback', e);
    gl = null; root.classList.add('no-gl');
  }
}
function drawBG() {
  if (!gl) return;
  const r = headWrap.getBoundingClientRect(), h = heroEl.getBoundingClientRect();
  const hx = (r.left + r.width * 0.5) / innerWidth * 1440;
  const hy = (r.top - h.top + r.height * 0.52) / h.height * 896;
  gl.uniform2f(glU.uRes, bgCanvas.width, bgCanvas.height);
  gl.uniform2f(glU.uPar, S.par.x, S.par.y);
  gl.uniform2f(glU.uHead, hx, hy);
  gl.uniform1f(glU.uTime, S.time);
  gl.uniform1f(glU.uSq, S.t);
  gl.uniform1f(glU.uWave, S.wave);
  gl.uniform1f(glU.uWob, S.wob.x);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
}

// ─────────────────────────────── sound
const A = { ctx: null, master: null, cGain: null, cSrc: null, noise: null, on: false, wanted: true, unlocked: false };
try { A.wanted = localStorage.getItem('sq-sound') !== 'off'; } catch {}
async function unlockAudio() {
  if (A.unlocked) return;
  A.unlocked = true;
  try {
    A.ctx = new (window.AudioContext || window.webkitAudioContext)();
    A.master = A.ctx.createGain(); A.master.gain.value = 0.9; A.master.connect(A.ctx.destination);
    // white noise buffer for clicks
    const nb = A.ctx.createBuffer(1, A.ctx.sampleRate * 0.2, A.ctx.sampleRate);
    const ch = nb.getChannelData(0); for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
    A.noise = nb;
    await A.ctx.resume();
    // crumple loop from the original video's audio, gain driven by squeeze speed
    const res = await fetch('audio/crumple.mp3');
    const buf = await A.ctx.decodeAudioData(await res.arrayBuffer());
    A.cGain = A.ctx.createGain(); A.cGain.gain.value = 0;
    A.cGain.connect(A.master);
    A.cSrc = A.ctx.createBufferSource(); A.cSrc.buffer = buf; A.cSrc.loop = true;
    A.cSrc.connect(A.cGain); A.cSrc.start(0, Math.random() * buf.duration);
  } catch (e) { console.warn('audio unavailable', e); }
  setSound(A.wanted);
}
function setSound(on) {
  A.on = on && !!A.ctx;
  A.wanted = on;
  try { localStorage.setItem('sq-sound', on ? 'on' : 'off'); } catch {}
  soundBtn.setAttribute('aria-pressed', String(A.on));
  if (A.master) A.master.gain.setTargetAtTime(A.on ? 0.9 : 0, A.ctx.currentTime, 0.03);
}
function popSound(pitch = 1, delay = 0) {
  if (!A.on) return;
  const c = A.ctx, t = c.currentTime + delay;
  const o = c.createOscillator(), g = c.createGain();
  o.type = 'sine';
  o.frequency.setValueAtTime(1150 * pitch, t);
  o.frequency.exponentialRampToValueAtTime(170 * pitch, t + 0.09);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.75, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
  o.connect(g).connect(A.master); o.start(t); o.stop(t + 0.2);
  const n = c.createBufferSource(); n.buffer = A.noise;
  const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2600;
  const ng = c.createGain(); ng.gain.setValueAtTime(0.4, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
  n.connect(hp).connect(ng).connect(A.master); n.start(t); n.stop(t + 0.05);
}
function boingSound() {
  if (!A.on) return;
  const c = A.ctx, t = c.currentTime;
  const o = c.createOscillator(), g = c.createGain(), lfo = c.createOscillator(), lg = c.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(140, t);
  o.frequency.exponentialRampToValueAtTime(420, t + 0.12);
  o.frequency.exponentialRampToValueAtTime(260, t + 0.5);
  lfo.frequency.setValueAtTime(22, t); lfo.frequency.linearRampToValueAtTime(8, t + 0.5);
  lg.gain.setValueAtTime(60, t); lg.gain.exponentialRampToValueAtTime(4, t + 0.55);
  lfo.connect(lg).connect(o.frequency);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.38, t + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
  o.connect(g).connect(A.master);
  o.start(t); lfo.start(t); o.stop(t + 0.65); lfo.stop(t + 0.65);
}
function hiSound() {
  if (!A.on) return;
  const c = A.ctx, t = c.currentTime;
  // confetti "pff" (filtered noise) + little rising chime
  const n = c.createBufferSource(); n.buffer = A.noise;
  const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(900, t); bp.frequency.exponentialRampToValueAtTime(3500, t + 0.15);
  const ng = c.createGain(); ng.gain.setValueAtTime(0.0001, t);
  ng.gain.exponentialRampToValueAtTime(0.55, t + 0.01); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.19);
  n.connect(bp).connect(ng).connect(A.master); n.start(t); n.stop(t + 0.2);
  [[784, 0.08], [988, 0.16], [1319, 0.24]].forEach(([f, d]) => {
    const o = c.createOscillator(), g = c.createGain();
    o.type = 'triangle'; o.frequency.setValueAtTime(f, t + d);
    g.gain.setValueAtTime(0.0001, t + d);
    g.gain.exponentialRampToValueAtTime(0.18, t + d + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.3);
    o.connect(g).connect(A.master); o.start(t + d); o.stop(t + d + 0.32);
  });
}
function updateCrumpleAudio() {
  if (!A.cGain) return;
  const sp = S.speed;
  const amt = clamp01(Math.abs(sp) * 0.9 - 0.04) * (sp > 0 ? 1 : 0.6);
  A.cGain.gain.setTargetAtTime(A.on ? amt : 0, A.ctx.currentTime, 0.05);
  A.cSrc.playbackRate.setTargetAtTime(0.85 + Math.min(Math.abs(sp), 2) * 0.18, A.ctx.currentTime, 0.1);
}
soundBtn.addEventListener('click', async e => {
  e.stopPropagation();
  if (!A.unlocked) { A.wanted = true; await unlockAudio(); return; }
  setSound(!A.on);
});

// ─────────────────────────────── stickers
function pop() {
  S.popped = true; S.crumpledOnce = true;
  hiBubble.classList.remove('on');
  stickers.forEach((el, i) => {
    const d = [0, 110, 200][i];
    el.style.setProperty('--pd', d + 'ms');
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    popSound([1, 1.35, 1.7][i] * (0.92 + Math.random() * 0.16), d / 1000);
  });
  headWrap.classList.remove('shake'); void headWrap.offsetWidth; headWrap.classList.add('shake');
  setTimeout(() => headWrap.classList.remove('shake'), 500);
}
function unpop() {
  S.popped = false;
  stickers.forEach(el => el.classList.remove('on'));
}

// ─────────────────────────────── greeting: confetti + AHOJ bubble
const CONFETTI_COLORS = ['#FE3A39', '#FFFFFF', '#FFD23F', '#3BA1FF', '#8CE0FF', '#1D1D1D', '#FF8FB1'];
const confetti = [];
function burst(x, y, n, spread = 1) {
  const k = S.u;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.25 * spread;
    const v = (520 + Math.random() * 760) * k;
    confetti.push({
      x: x + (Math.random() - 0.5) * 120 * k, y: y + (Math.random() - 0.5) * 60 * k,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      w: (7 + Math.random() * 8) * k, h: (10 + Math.random() * 12) * k,
      rot: Math.random() * Math.PI * 2, vr: (Math.random() - 0.5) * 14,
      flip: Math.random() * Math.PI * 2, vf: 6 + Math.random() * 10,
      sway: Math.random() * Math.PI * 2,
      shape: Math.random() < 0.22 ? 'circle' : Math.random() < 0.35 ? 'strip' : 'rect',
      color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
      life: 0, ttl: 2.6 + Math.random() * 1.6,
    });
  }
}
function drawConfetti(dt) {
  const d = S.dpr || 1;
  if (!confetti.length) { if (fx._dirty) { fctx.clearRect(0, 0, fx.width, fx.height); fx._dirty = false; } return; }
  fx._dirty = true;
  fctx.setTransform(1, 0, 0, 1, 0, 0);
  fctx.clearRect(0, 0, fx.width, fx.height);
  const G = 1500 * S.u, H = innerHeight;
  for (let i = confetti.length - 1; i >= 0; i--) {
    const c = confetti[i];
    c.life += dt;
    const drag = Math.pow(c.vy > 0 ? 0.08 : 0.35, dt);   // flutters down slowly
    c.vx *= drag; c.vy = c.vy * drag + G * dt;
    c.x += (c.vx + Math.sin(c.sway + c.life * 4) * 60 * S.u) * dt;
    c.y += c.vy * dt;
    c.rot += c.vr * dt; c.flip += c.vf * dt;
    if (c.life > c.ttl || c.y > H + 40) { confetti.splice(i, 1); continue; }
    const alpha = clamp01((c.ttl - c.life) / 0.5);
    fctx.setTransform(d, 0, 0, d, c.x * d, c.y * d);
    fctx.rotate(c.rot);
    fctx.scale(1, Math.cos(c.flip));
    fctx.globalAlpha = alpha;
    fctx.fillStyle = c.color;
    if (c.shape === 'circle') { fctx.beginPath(); fctx.arc(0, 0, c.w * 0.45, 0, Math.PI * 2); fctx.fill(); }
    else if (c.shape === 'strip') fctx.fillRect(-c.w * 0.18, -c.h * 0.7, c.w * 0.36, c.h * 1.4);
    else fctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
  }
  fctx.globalAlpha = 1;
}
function greet() {
  const r = headWrap.getBoundingClientRect();
  const x = r.left + r.width * 0.5, y = r.top + r.height * 0.16;
  burst(x, y, 150);
  setTimeout(() => burst(x - r.width * 0.32, y + r.height * 0.2, 60, 0.8), 160);
  setTimeout(() => burst(x + r.width * 0.32, y + r.height * 0.2, 60, 0.8), 300);
  hiBubble.style.setProperty('--pd', '60ms');
  hiBubble.classList.remove('on'); void hiBubble.offsetWidth; hiBubble.classList.add('on');
  hiSound();
}

// ─────────────────────────────── input: mouse / keys
const isUI = el => el && el.closest && el.closest('a, button');
addEventListener('pointerdown', e => {
  unlockAudio();
  if (isUI(e.target) || drawerOpen() || !e.target.closest('#hero')) return;
  S.pressed = true;
});
addEventListener('pointerup', () => { S.pressed = false; });
addEventListener('pointercancel', () => { S.pressed = false; });
addEventListener('blur', () => { S.pressed = false; });
let lastMouse = null;
addEventListener('pointermove', e => {
  const x = e.clientX / innerWidth * 2 - 1, y = e.clientY / innerHeight * 2 - 1;
  S.mousePar.x = x * 0.7; S.mousePar.y = y * 0.7; S.mouseActive = true;
  const now = performance.now();
  if (lastMouse) {
    const dt = Math.max(8, now - lastMouse.t) / 1000;
    S.mvx = lerp(S.mvx, clamp((x - lastMouse.x) / dt * 0.25, -3, 3), 0.5);
    const sg = Math.abs(S.mvx) > 0.9 ? Math.sign(S.mvx) : 0;
    if (sg && sg !== S.mSign) { if (S.mSign) S.mflips.push(now); S.mSign = sg; }
    S.mflips = S.mflips.filter(t => now - t < 1200);
    if (S.mflips.length >= 4 && now - S.handAt > 450) S.waveUntil = now + 700;
  }
  lastMouse = { x, t: now };
});
document.addEventListener('mouseleave', () => { S.mouseActive = false; });
addEventListener('keydown', e => {
  if (typing()) return;
  unlockAudio();
  if (e.code === 'Space') {
    if (drawerOpen() || scrollY > innerHeight * 0.4) return;   // normal page scroll below the hero
    e.preventDefault(); if (!e.repeat) S.pressed = true;
  }
  else if (e.key === 'd' || e.key === 'D') { S.debug = !S.debug; debugEl.hidden = !S.debug; }
  else if (e.key === 'c' || e.key === 'C') { S.showCam = !S.showCam; root.classList.toggle('show-cam', S.showCam); }
  else if (e.key === 'm' || e.key === 'M') { S.input = S.input === 'camera' ? 'mouse' : 'camera'; }
  else if (e.key === 's' || e.key === 'S') { if (A.unlocked) setSound(!A.on); }
});
addEventListener('keyup', e => { if (e.code === 'Space') S.pressed = false; });

// ─────────────────────────────── hand tracking
let landmarker = null;
async function initCamera() {
  if (!navigator.mediaDevices?.getUserMedia) { S.camStatus = 'error'; return; }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user', frameRate: { ideal: 60 } },
      audio: false,
    });
    cam.srcObject = stream;
    await cam.play();
    S.camStatus = 'model';
  } catch (e) {
    console.warn('Camera unavailable:', e);
    S.camStatus = 'denied'; return;
  }
  try {
    const fileset = await FilesetResolver.forVisionTasks(new URL('vendor/mediapipe/wasm', location.href).href);
    const opts = delegate => ({
      baseOptions: { modelAssetPath: new URL('vendor/mediapipe/hand_landmarker.task', location.href).href, delegate },
      runningMode: 'VIDEO', numHands: 1,
      minHandDetectionConfidence: 0.6, minHandPresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    try { landmarker = await HandLandmarker.createFromOptions(fileset, opts('GPU')); }
    catch { landmarker = await HandLandmarker.createFromOptions(fileset, opts('CPU')); }
    S.camStatus = 'live';
    detectLoop();
  } catch (e) {
    console.error('Hand model failed:', e);
    S.camStatus = 'error';
  }
}
let lastCamTime = -1;
function detectLoop() {
  if (cam.readyState >= 2 && cam.currentTime !== lastCamTime) {
    lastCamTime = cam.currentTime;
    const now = performance.now();
    try {
      const res = landmarker.detectForVideo(cam, now);
      const lm = res.landmarks && res.landmarks[0];
      if (lm) onHand(lm, now);
    } catch (e) { /* skip frame */ }
  }
  requestAnimationFrame(detectLoop);
}
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
function onHand(lm, now) {
  if (S.input !== 'camera') return;
  const wrist = lm[0];
  const palm = dist(wrist, lm[9]) || 1e-3;
  const tips = [8, 12, 16, 20];
  const ratio = tips.reduce((s, i) => s + dist(lm[i], wrist), 0) / tips.length / palm;
  S.ratio = ratio;
  // gentle self-calibration: widen the range if the user goes beyond it
  if (ratio < S.lo) S.lo = lerp(S.lo, ratio, 0.04);
  if (ratio > S.hi) S.hi = lerp(S.hi, ratio, 0.04);
  if (S.hi - S.lo < 0.45) S.hi = S.lo + 0.45;
  const open = clamp01((ratio - S.lo) / (S.hi - S.lo));
  S.open = open;
  classifyPose(lm, now);
  // dead zone: a relaxed / half-open hand does nothing, only a real fist crumples
  const sq = smooth(CFG.squeezeStart, CFG.squeezeFull, 1 - open);

  // palm centre → parallax (mirrored like a selfie)
  const ids = [0, 5, 9, 13, 17];
  const cx = 1 - ids.reduce((s, i) => s + lm[i].x, 0) / ids.length;
  const cy = ids.reduce((s, i) => s + lm[i].y, 0) / ids.length;
  S.handPar.x = clamp((cx - 0.5) * 2.4, -1, 1);
  S.handPar.y = clamp((cy - 0.5) * 2.4, -1, 1);

  // velocities: palm (→ wobble) and fingertips (→ wave; catches wrist rotation too)
  const tx = 1 - (lm[8].x + lm[12].x + lm[16].x) / 3;
  if (S.lastX != null && now - S.lastHandT < 200) {
    const dt = Math.max(8, now - S.lastHandT) / 1000;
    S.vx = lerp(S.vx, clamp((cx - S.lastX) / dt, -4, 4), 0.45);
    S.tipV = lerp(S.tipV, clamp((tx - S.tipX) / dt, -6, 6), 0.5);
    const sign = Math.abs(S.tipV) > CFG.waveSpeed ? Math.sign(S.tipV) : 0;
    if (sign && sign !== S.lastSign) {
      if (S.lastSign) S.flips.push(now);
      S.lastSign = sign;
    }
  }
  S.flips = S.flips.filter(t => now - t < CFG.waveWindow);
  if (S.flips.length >= CFG.waveSwings && open > 0.45 && S.pose === 'open') S.waveUntil = now + 800;
  S.lastX = cx; S.tipX = tx; S.lastHandT = now;

  // while the hand is swinging, never crumple (motion blur makes fingers look shorter)
  const moving = now < S.waveUntil + 400 || Math.abs(S.tipV) > 1.2;
  // pointing / scrolling poses never crumple the head
  const gesture = S.pose === 'point' || S.pose === 'two' || S.poseCand === 'point' || S.poseCand === 'two';
  S.handSq = gesture || drawerOpen() ? 0 : moving ? Math.min(sq, S.handSq) : sq;

  // pointer target (index fingertip, mirrored, mapped from the comfortable middle of the camera)
  const [bx0, by0, bx1, by1] = CFG.pointerBox;
  S.ptr.tx = clamp01(((1 - lm[8].x) - bx0) / (bx1 - bx0)) * innerWidth;
  S.ptr.ty = clamp01((lm[8].y - by0) / (by1 - by0)) * innerHeight;
  // two-finger scroll: drag the page with the hand
  if (S.pose === 'two') {
    const y = (lm[8].y + lm[12].y) / 2;
    if (S.scrollY0 != null) {
      const dy = y - S.scrollY0;
      if (Math.abs(dy) > 0.002) S.scrollAcc += -dy * innerHeight * CFG.scrollGain;
    }
    S.scrollY0 = y;
  } else S.scrollY0 = null;

  S.hand = lm; S.handAt = now;
}

// ─────────────────────────────── gesture poses
// a finger counts as extended when its tip is clearly further from the wrist than its middle joint
const FINGERS = [[8, 6], [12, 10], [16, 14], [20, 18]];
function classifyPose(lm, now) {
  const w = lm[0];
  const ext = FINGERS.map(([tip, pip]) => dist(lm[tip], w) > dist(lm[pip], w) * 1.12);
  const n = ext.filter(Boolean).length;
  let p = 'other';
  if (ext[0] && !ext[1] && !ext[2] && !ext[3]) p = 'point';
  else if (ext[0] && ext[1] && !ext[2] && !ext[3]) p = 'two';
  else if (n >= 3) p = 'open';
  else if (n === 0) p = 'fist';
  if (p === S.poseCand) S.poseN++; else { S.poseCand = p; S.poseN = 1; }
  // entering pointer/scroll needs a steady pose; leaving them needs a bit longer (no flicker)
  const need = (S.pose === 'point' || S.pose === 'two') ? CFG.poseFrames + 2 : CFG.poseFrames;
  if (S.poseN >= need && S.pose !== p) setPose(p);
}
function setPose(p) {
  const was = S.pose;
  S.pose = p;
  if (p === 'point' && was !== 'point') { S.ptr.x = S.ptr.tx; S.ptr.y = S.ptr.ty; }
  if (was === 'two' && p !== 'two') S.scrollV = S.scrollV; // keep momentum
}
const CLICKABLE = 'a, button, [data-drawer], [data-copy], .topic, label.field';
function setHover(el, now) {
  if (el === S.hoverEl) return;
  if (S.hoverEl) S.hoverEl.classList.remove('hand-hover');
  S.hoverEl = el; S.hoverT = now;
  if (el) el.classList.add('hand-hover');
  if (el !== S.clickedEl) S.clickedEl = null;
}
function handClick(el) {
  S.clickedEl = el;
  handCursor.classList.remove('click'); void handCursor.offsetWidth; handCursor.classList.add('click');
  popSound(1.6, 0);
  if (el.matches('label.field')) { const f = el.querySelector('input,textarea'); f && f.focus(); return; }
  // links that would open a new tab are opened in this tab (pop-up blockers stop scripted new tabs)
  if (el.tagName === 'A' && el.target === '_blank' && el.href) { location.href = el.href; return; }
  el.click();
}
function gestureTick(now, dt, live) {
  const pointing = live && S.pose === 'point';
  const scrolling = live && S.pose === 'two';
  // cursor
  if (pointing) {
    const d = Math.hypot(S.ptr.tx - S.ptr.x, S.ptr.ty - S.ptr.y);
    const k = 9 + Math.min(d, 300) * 0.12;            // adaptive smoothing: steady when still, quick when moving
    S.ptr.x = damp(S.ptr.x, S.ptr.tx, k, dt);
    S.ptr.y = damp(S.ptr.y, S.ptr.ty, k, dt);
  } else if (scrolling) {
    S.ptr.x = damp(S.ptr.x, S.ptr.tx, 10, dt);
    S.ptr.y = damp(S.ptr.y, S.ptr.ty, 10, dt);
  }
  handCursor.classList.toggle('on', pointing || scrolling);
  handCursor.classList.toggle('scroll', scrolling);
  handCursor.style.transform = `translate3d(${S.ptr.x.toFixed(1)}px, ${S.ptr.y.toFixed(1)}px, 0)`;

  // hover + dwell click
  let progress = 0;
  if (pointing) {
    const hit = document.elementFromPoint(S.ptr.x, S.ptr.y);
    let el = hit && hit.closest(CLICKABLE);
    // inside an open drawer only its own controls count
    if (el && drawerOpen() && !el.closest('.drawer')) el = null;
    setHover(el, now);
    if (el && el !== S.clickedEl) {
      progress = clamp01((now - S.hoverT) / CFG.dwell);
      if (progress >= 1) { handClick(el); S.hoverT = now; }
    }
  } else setHover(null, now);
  handCursor.classList.toggle('hover', !!S.hoverEl && pointing);
  handCursor.style.setProperty('--p', progress.toFixed(3));

  // scroll with momentum
  if (scrolling) {
    const dy = S.scrollAcc; S.scrollAcc = 0;
    const target = dy / Math.max(dt, 1e-3);
    S.scrollV = lerp(S.scrollV, target, 0.35);
    if (dy && !drawerOpen()) scrollBy(0, dy);
    else if (dy && drawerOpen()) { const b = document.querySelector('.drawer.open .dr-body'); b && (b.scrollTop += dy); }
  } else {
    S.scrollAcc = 0;
    if (Math.abs(S.scrollV) > 30 && !drawerOpen()) { scrollBy(0, S.scrollV * dt); S.scrollV *= Math.exp(-3.2 * dt); }
    else S.scrollV = 0;
  }

  // HUD outside the hero
  const showHud = live && !S.heroVisible;
  hudEl.classList.toggle('show', showHud || (S.camStatus === 'live' && !S.heroVisible));
  hudEl.classList.toggle('pointer', pointing);
  hudEl.classList.toggle('scroll', scrolling);
  const label = !live ? 'Show your hand' : pointing ? 'Pointer' : scrolling ? 'Scrolling' : S.pose === 'fist' ? 'Fist' : 'Hand';
  if (hudMode.textContent !== label) hudMode.textContent = label;
  if (!S.heroVisible) drawMiniSkeleton(live);
}
function drawMiniSkeleton(live) {
  const w = hudSkel.width, h = hudSkel.height;
  hctx2.clearRect(0, 0, w, h);
  if (!live || !S.hand) return;
  const pts = S.hand.map(p => ({ x: 1 - p.x, y: p.y }));
  let x0 = 1, y0 = 1, x1 = 0, y1 = 0;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const sc = (w * 0.72) / Math.max(x1 - x0, y1 - y0, 0.05);
  const ox = w / 2 - (x0 + x1) / 2 * sc, oy = h / 2 - (y0 + y1) / 2 * sc;
  hctx2.strokeStyle = '#fff'; hctx2.lineWidth = 1.4; hctx2.lineCap = 'round';
  hctx2.beginPath();
  for (const [a, b] of BONES) { hctx2.moveTo(pts[a].x * sc + ox, pts[a].y * sc + oy); hctx2.lineTo(pts[b].x * sc + ox, pts[b].y * sc + oy); }
  hctx2.stroke();
  hctx2.fillStyle = '#D5FF2C';
  for (const i of S.pose === 'point' ? [8] : S.pose === 'two' ? [8, 12] : []) { hctx2.beginPath(); hctx2.arc(pts[i].x * sc + ox, pts[i].y * sc + oy, 4, 0, 7); hctx2.fill(); }
}

// ─────────────────────────────── skeleton (media box)
const BONES = [[0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17]];
function drawSkeleton(live) {
  const w = skel.width, h = skel.height;
  sctx.clearRect(0, 0, w, h);
  if (!live || !S.hand) return;
  const ar = (cam.videoWidth || 640) / (cam.videoHeight || 480);
  const pts = S.hand.map(p => ({ x: (1 - p.x) * ar, y: p.y }));
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  const target = { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, size: Math.max(x1 - x0, y1 - y0, 0.12) };
  if (!S.view) S.view = { ...target };
  for (const k of ['cx', 'cy', 'size']) S.view[k] = lerp(S.view[k], target[k], 0.25);
  const sc = Math.min(w, h) * 0.62 / S.view.size;
  const ox = w / 2 - S.view.cx * sc, oy = h * 0.52 - S.view.cy * sc;
  const unit = w / 250;
  sctx.strokeStyle = '#fff'; sctx.fillStyle = '#fff';
  sctx.lineWidth = 1.2 * unit; sctx.lineCap = 'round';
  sctx.beginPath();
  for (const [a, b] of BONES) {
    sctx.moveTo(pts[a].x * sc + ox, pts[a].y * sc + oy);
    sctx.lineTo(pts[b].x * sc + ox, pts[b].y * sc + oy);
  }
  sctx.stroke();
  for (const p of pts) { sctx.beginPath(); sctx.arc(p.x * sc + ox, p.y * sc + oy, 2.6 * unit, 0, Math.PI * 2); sctx.fill(); }
}

// ─────────────────────────────── main loop
let last = performance.now();
let hintCache = '';
function tick(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  S.time += dt;
  const live = S.input === 'camera' && now - S.handAt < 450;
  root.classList.toggle('has-hand', live);

  // squeeze
  S.mouseSq = clamp01(S.mouseSq + (S.pressed ? 1.3 : -1.7) * dt);
  const target = (live ? S.handSq : S.mouseSq) * (S.heroVisible ? 1 : 0);
  const prev = S.t;
  S.t = damp(S.t, target, CFG.follow, dt);
  S.speed = (S.t - prev) / Math.max(dt, 1e-3);

  // parallax
  const pt = live ? S.handPar : (S.mouseActive ? S.mousePar : { x: 0, y: 0 });
  S.par.x = damp(S.par.x, pt.x * CFG.parallax, 4, dt);
  S.par.y = damp(S.par.y, pt.y * CFG.parallax, 4, dt);

  // wobble spring (driven by hand / mouse horizontal speed)
  const vx = live ? S.vx : S.mvx;
  if (!live) S.mvx = damp(S.mvx, 0, 5, dt);
  if (live && now - S.lastHandT > 120) S.vx = damp(S.vx, 0, 8, dt);
  S.wob.v += (-70 * S.wob.x - 7 * S.wob.v + vx * 55) * dt;
  S.wob.x = clamp(S.wob.x + S.wob.v * dt, -12, 12);
  S.bounce.v += (-190 * S.bounce.x - 9 * S.bounce.v) * dt;
  S.bounce.x += S.bounce.v * dt;

  // wave → greet: head turns to you and nods, confetti, AHOJ bubble
  const waving = now < S.waveUntil && S.t < 0.3;
  S.wave = damp(S.wave, waving ? 1 : 0, 3, dt);
  S.greet = damp(S.greet, waving ? 1 : 0, waving ? 5 : 2.2, dt);
  if (waving && !S.wasWaving) {
    S.bounce.v += 0.9;
    if (now - S.lastConfetti > CFG.confettiCooldown) { S.lastConfetti = now; greet(); }
  }
  S.wasWaving = waving;
  if (waving) clearTimeout(S.hiOff), S.hiOff = null;
  else if (hiBubble.classList.contains('on') && !S.hiOff) S.hiOff = setTimeout(() => { hiBubble.classList.remove('on'); S.hiOff = null; }, 900);
  hiChip.classList.toggle('waving', waving);
  S.smile = damp(S.smile, waving && S.t < 0.25 ? 1 : 0, 5, dt);

  // pops
  if (!S.popped && S.t > CFG.popOn) pop();
  else if (S.popped && S.t < CFG.popOff) unpop();
  if (S.crumpledOnce && !S.popped && S.t < 0.1) { S.crumpledOnce = false; boingSound(); S.bounce.v += 1.3; }

  updateCrumpleAudio();

  // transforms
  const p = S.par, u = 1;
  const float = Math.sin(S.time * 1.15) * 4 * (1 - S.t * 0.6);
  const squish = S.t * 0.03 * Math.sin(S.time * 30) * clamp01(Math.abs(S.speed));
  // greeting: turn the face towards the viewer, friendly tilt + a little nod
  const g = S.greet;
  const nod = g * Math.sin(S.time * 7) * 3;
  const turn = g * 18 + g * Math.sin(S.time * 3.2) * 3;
  headWrap.style.transform =
    `translate3d(${(p.x * 24 + g * 10).toFixed(2)}px, ${(p.y * 16 + float - g * 8).toFixed(2)}px, 0) ` +
    `rotateY(${(p.x * 10 + turn).toFixed(2)}deg) rotateX(${(-p.y * 7 + nod).toFixed(2)}deg) ` +
    `rotateZ(${(S.wob.x - g * 6).toFixed(2)}deg) ` +
    `scale(${(1 + S.bounce.x + squish + g * 0.02).toFixed(4)})`;
  stickersEl.style.translate = `${(p.x * 36).toFixed(2)}px ${(p.y * 24 + float * 0.6).toFixed(2)}px`;
  copyEl.style.translate = `${(-p.x * 12 * u).toFixed(2)}px ${(-p.y * 7).toFixed(2)}px`;
  mediaLayer.style.translate = `${(-p.x * 7).toFixed(2)}px ${(-p.y * 5).toFixed(2)}px`;

  if (S.heroVisible) {
    drawHead();
    drawBG();
    drawSkeleton(live);
    const sp = Math.min(scrollY, innerHeight);
    stageEl.style.translate = `0 ${(sp * 0.35 / S.u).toFixed(1)}px`;
    stageEl.style.opacity = (1 - sp / innerHeight * 0.9).toFixed(3);
  }
  gestureTick(now, dt, live);
  drawConfetti(dt);

  // ui
  meterBar.style.transform = `scaleX(${S.t.toFixed(3)})`;
  let hint;
  if (S.loaded < CFG.frames) hint = `Loading ${Math.round(S.loaded / CFG.frames * 100)}%`;
  else if (live && S.pose === 'point') hint = 'Pointer · hold over a button';
  else if (live && S.pose === 'two') hint = 'Scroll · move hand up / down';
  else if (live && S.popped) hint = 'Ouch! Open to fix it';
  else if (live && waving) hint = 'Ahoj!';
  else if (live) hint = 'Squeeze your hand';
  else if (S.input === 'mouse') hint = 'Mouse mode · hold click';
  else if (S.camStatus === 'starting') hint = 'Allow camera access';
  else if (S.camStatus === 'model') hint = 'Loading hand model…';
  else if (S.camStatus === 'denied' || S.camStatus === 'error') hint = 'No camera · hold click / space';
  else hint = 'Show me your palm';
  if (hint !== hintCache) { hintText.textContent = hint; hintCache = hint; }

  if (S.debug) {
    debugEl.textContent =
      `input   ${S.input}  cam ${S.camStatus}  hand ${live ? 'yes' : 'no'}\n` +
      `ratio   ${S.ratio == null ? '–' : S.ratio.toFixed(2)}  range [${S.lo.toFixed(2)}–${S.hi.toFixed(2)}]\n` +
      `squeeze ${S.t.toFixed(2)}  frame ${S.drawnIdx}  speed ${S.speed.toFixed(2)}\n` +
      `par     ${p.x.toFixed(2)}, ${p.y.toFixed(2)}  vx ${vx.toFixed(2)}  wave ${S.wave.toFixed(2)}\n` +
      `sound   ${A.on ? 'on' : 'off'}  frames ${S.loaded}/${CFG.frames}`;
  }
  requestAnimationFrame(tick);
}

// ─────────────────────────────── intro
root.classList.add('intro');
let introDone = false;
function firstFrameReady() {
  if (introDone) return; introDone = true;
  document.querySelectorAll('.title .word').forEach((w, i) => w.style.setProperty('--d', 150 + i * 110));
  $('.btn').style.setProperty('--d', 520);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('intro')));
  setTimeout(() => document.querySelectorAll('.title .word, .btn').forEach(el => el.style.setProperty('--d', 0)), 1800);
}

// test hook (used for automated checks; harmless in production)
window.__sq = { S, CFG, onHand, A, confetti, setPose };

// ─────────────────────────────── boot
initGL();
layout();
requestAnimationFrame(tick);
loadFrames();
if (!/[?&]nocam\b/.test(location.search)) initCamera(); else S.camStatus = 'denied';
