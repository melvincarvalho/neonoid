'use strict';
// NEONOID — a single-file Arkanoid. No assets: all visuals canvas-drawn, all audio synthesized.
// ?shot=<name> renders a deterministic frame for the critic harness (see tools/capture.sh).

const W = 1280, H = 720;
const PF = { x: 248, y: 64, w: 784, h: 656 };            // playfield, open at bottom
const COLS = 13, BW = 60, BH = 26;
const BX = PF.x + (PF.w - COLS * BW) / 2, BY = PF.y + 40;
const BALL_R = 8, MAX_SPEED = 760;

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const DPR = Math.min(window.devicePixelRatio || 1, 2);
canvas.width = W * DPR; canvas.height = H * DPR;
ctx.scale(DPR, DPR);

// ---------- seeded RNG (deterministic shots) ----------
let _seed = 1;
function srand(s) { _seed = s >>> 0; }
function rnd() { _seed = (_seed * 1664525 + 1013904223) >>> 0; return _seed / 4294967296; }
function rng(a, b) { return a + rnd() * (b - a); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

// ---------- audio (lazy, disabled in shot mode) ----------
let AUDIO_ON = true, actx = null, master = null;
function audio() {
  if (!AUDIO_ON) return null;
  if (!actx) {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = actx.createDynamicsCompressor();
    master = actx.createGain(); master.gain.value = 0.45;
    master.connect(comp); comp.connect(actx.destination);
  }
  if (actx.state === 'suspended') actx.resume();
  return actx;
}
function tone(f, dur, type = 'square', vol = 0.2, slideTo = 0) {
  const a = audio(); if (!a) return;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.value = f;
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, a.currentTime + dur);
  g.gain.setValueAtTime(vol, a.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + dur);
  o.connect(g); g.connect(master);
  o.start(); o.stop(a.currentTime + dur);
}
function noise(dur, vol = 0.3, freq = 1200) {
  const a = audio(); if (!a) return;
  const n = a.sampleRate * dur | 0, buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const src = a.createBufferSource(); src.buffer = buf;
  const flt = a.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = freq;
  const g = a.createGain(); g.gain.value = vol;
  src.connect(flt); flt.connect(g); g.connect(master); src.start();
}
const SFX = {
  wall: () => tone(220, 0.05, 'square', 0.12),
  paddle: () => tone(330, 0.07, 'square', 0.18),
  brick: c => { tone(392 * Math.pow(2, Math.min(c, 12) / 12), 0.09, 'triangle', 0.22); noise(0.08, 0.15, 2400); },
  clink: () => tone(880, 0.04, 'square', 0.12),
  boom: () => { noise(0.35, 0.4, 700); tone(90, 0.3, 'sine', 0.3, 45); },
  laser: () => tone(1400, 0.12, 'sawtooth', 0.12, 300),
  power: () => { [523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.1, 'square', 0.15), i * 60)); },
  death: () => { tone(400, 0.7, 'sawtooth', 0.25, 60); noise(0.4, 0.3, 500); },
  start: () => { [392, 523, 659, 784].forEach((f, i) => setTimeout(() => tone(f, 0.12, 'square', 0.15), i * 70)); },
};

// ---------- palette & sprites ----------
// Per-sector brick ramps, cool/electric side, roughly matched luminance.
const PALETTES = [
  ['#ff3d81', '#ff9e3d', '#ffe14d', '#54f28b', '#33d6ff', '#b48cff'], // 1 electric
  ['#8be9fd', '#5ec4ff', '#4d9fff', '#7a7dff', '#b48cff', '#ff7ac8'], // 2 ice
  ['#ffd166', '#ffb347', '#ff8c42', '#ff5d5d', '#ff4d9d', '#c86bff'], // 3 ember
  ['#eaff5e', '#aaff4d', '#5eff8a', '#3dffc8', '#33e0ff', '#59a8ff'], // 4 toxic
  ['#ff5d8f', '#ff8fb3', '#c86bff', '#8f7bff', '#5e8bff', '#33bbff'], // 5 royal
];
const BRICK_SCORE = [120, 110, 100, 90, 80, 70];
const SILVER = 7, GOLD = 8;
const GLOW_PAD = 12; // sprite padding so the neon bleed isn't clipped

function offCanvas(w, h) { const c = document.createElement('canvas'); c.width = w * 2; c.height = h * 2; const x = c.getContext('2d'); x.scale(2, 2); return [c, x]; }

function shade(hex, f) { // f<0 darken, f>0 lighten
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  if (f >= 0) { r += (255 - r) * f; g += (255 - g) * f; b += (255 - b) * f; }
  else { r *= 1 + f; g *= 1 + f; b *= 1 + f; }
  return `rgb(${r | 0},${g | 0},${b | 0})`;
}

function makeBrickSprite(color, kind) { // 'neon' | 'metal' | 'gold'
  const P = GLOW_PAD;
  const [c, x] = offCanvas(BW + P * 2, BH + P * 2);
  const ix = P + 1.5, iy = P + 1.5, iw = BW - 3, ih = BH - 3, r = 5;
  if (kind === 'neon') {
    // dark glass body
    const g = x.createLinearGradient(0, iy, 0, iy + ih);
    g.addColorStop(0, shade(color, -0.62)); g.addColorStop(0.5, shade(color, -0.78)); g.addColorStop(1, shade(color, -0.68));
    x.fillStyle = g;
    x.beginPath(); x.roundRect(ix, iy, iw, ih, r); x.fill();
    // inner sheen
    const sh = x.createLinearGradient(0, iy, 0, iy + ih * 0.5);
    sh.addColorStop(0, 'rgba(255,255,255,0.10)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = sh;
    x.beginPath(); x.roundRect(ix + 2, iy + 1.5, iw - 4, ih * 0.45, 3); x.fill();
    // emissive rim with bloom bleed
    x.save();
    x.shadowColor = color; x.shadowBlur = 11;
    x.strokeStyle = color; x.lineWidth = 2;
    x.beginPath(); x.roundRect(ix, iy, iw, ih, r); x.stroke();
    x.stroke();
    x.restore();
    x.strokeStyle = shade(color, 0.6); x.globalAlpha = 0.9; x.lineWidth = 1;
    x.beginPath(); x.roundRect(ix + 1, iy + 1, iw - 2, ih - 2, r - 1); x.stroke();
    x.globalAlpha = 1;
  } else {
    const base = kind === 'gold' ? '#e8b71a' : '#aab8c8';
    const g = x.createLinearGradient(0, iy, 0, iy + ih);
    g.addColorStop(0, shade(base, 0.55)); g.addColorStop(0.45, shade(base, -0.1));
    g.addColorStop(0.55, shade(base, -0.4)); g.addColorStop(1, shade(base, 0.1));
    x.fillStyle = g;
    x.beginPath(); x.roundRect(ix, iy, iw, ih, r); x.fill();
    x.strokeStyle = 'rgba(0,0,0,0.55)'; x.lineWidth = 1;
    x.beginPath(); x.roundRect(ix, iy, iw, ih, r); x.stroke();
    x.save();
    x.shadowColor = kind === 'gold' ? '#ffdf70' : '#cfe4ff'; x.shadowBlur = 7;
    x.strokeStyle = kind === 'gold' ? 'rgba(255,223,112,0.8)' : 'rgba(207,228,255,0.55)';
    x.lineWidth = 1.2;
    x.beginPath(); x.roundRect(ix + 0.5, iy + 0.5, iw - 1, ih - 1, r); x.stroke();
    x.restore();
    // rivets
    x.fillStyle = 'rgba(20,26,36,0.7)';
    for (const [dx, dy] of [[7, ih / 2], [iw - 7, ih / 2]]) { x.beginPath(); x.arc(ix + dx, iy + dy, 1.6, 0, 7); x.fill(); }
  }
  return c;
}
const SPRITE_CACHE = {};
function brickSprite(type, level, damaged) {
  const pi = (level - 1) % PALETTES.length;
  const key = type === GOLD ? 'gold' : type === SILVER ? (damaged ? 'sd' : 'silver') : `p${pi}c${type}`;
  if (!SPRITE_CACHE[key]) {
    if (type === GOLD) SPRITE_CACHE[key] = makeBrickSprite('', 'gold');
    else if (type === SILVER) {
      const s = makeBrickSprite('', 'metal');
      if (damaged) {
        const P = GLOW_PAD, [c, x] = offCanvas(BW + P * 2, BH + P * 2);
        x.drawImage(s, 0, 0, BW + P * 2, BH + P * 2);
        x.strokeStyle = 'rgba(8,12,18,0.85)'; x.lineWidth = 1.3; x.lineCap = 'round';
        x.beginPath();
        x.moveTo(P + 14, P + 4); x.lineTo(P + 24, P + 12); x.lineTo(P + 20, P + 22);
        x.moveTo(P + 24, P + 12); x.lineTo(P + 38, P + 10); x.lineTo(P + 46, P + 20);
        x.moveTo(P + 38, P + 10); x.lineTo(P + 44, P + 3);
        x.stroke();
        SPRITE_CACHE[key] = c;
      } else SPRITE_CACHE[key] = s;
    } else SPRITE_CACHE[key] = makeBrickSprite(PALETTES[pi][type], 'neon');
  }
  return SPRITE_CACHE[key];
}

function makePaddleSprite(w) {
  const h = 18, [c, x] = offCanvas(w, h);
  // gunmetal hull
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#9fb2c8'); g.addColorStop(0.3, '#46536a'); g.addColorStop(0.62, '#232c3d'); g.addColorStop(1, '#3a4557');
  x.fillStyle = g;
  x.beginPath(); x.roundRect(0.5, 0.5, w - 1, h - 1, 9); x.fill();
  x.strokeStyle = 'rgba(0,0,0,0.65)'; x.lineWidth = 1;
  x.beginPath(); x.roundRect(0.5, 0.5, w - 1, h - 1, 9); x.stroke();
  // wing tips
  for (const side of [0, 1]) {
    const g2 = x.createLinearGradient(0, 0, 0, h);
    g2.addColorStop(0, '#ff8090'); g2.addColorStop(0.5, '#ff2545'); g2.addColorStop(1, '#8f0a1e');
    x.fillStyle = g2;
    x.beginPath();
    if (side === 0) x.roundRect(1, 1, 13, h - 2, [8, 2, 2, 8]);
    else x.roundRect(w - 14, 1, 13, h - 2, [2, 8, 8, 2]);
    x.fill();
  }
  // panel seams
  x.strokeStyle = 'rgba(10,14,22,0.5)'; x.lineWidth = 1;
  for (const fx of [0.3, 0.7]) { x.beginPath(); x.moveTo(w * fx, 2); x.lineTo(w * fx, h - 2); x.stroke(); }
  // emissive core strip
  x.save();
  x.shadowColor = '#33d6ff'; x.shadowBlur = 6;
  x.fillStyle = 'rgba(51,214,255,0.95)';
  x.fillRect(17, h / 2 - 1.5, w - 34, 3);
  x.restore();
  x.fillStyle = 'rgba(255,255,255,0.85)';
  x.fillRect(17, h / 2 - 1.2, w - 34, 1.2);
  return c;
}
const PADDLE_SPRITES = {};
function paddleSprite(w) { const k = Math.round(w); if (!PADDLE_SPRITES[k]) PADDLE_SPRITES[k] = makePaddleSprite(k); return PADDLE_SPRITES[k]; }

// starfield layers + nebula, pre-rendered
function makeStars(count, size, alpha, opts = {}) {
  const [c, x] = offCanvas(PF.w, PF.h);
  if (opts.nebula) {
    const blobs = [
      [0.22, 0.30, 320, 258, 0.50], [0.72, 0.16, 280, 195, 0.40], [0.55, 0.62, 360, 285, 0.38],
      [0.12, 0.80, 260, 175, 0.36], [0.88, 0.55, 300, 215, 0.44], [0.40, 0.10, 240, 300, 0.30],
      [0.35, 0.45, 380, 320, 0.26], [0.80, 0.85, 300, 185, 0.30],
    ];
    for (const [fx, fy, nr, hue, a] of blobs) {
      const nx = fx * PF.w, ny = fy * PF.h;
      const g = x.createRadialGradient(nx, ny, 0, nx, ny, nr);
      g.addColorStop(0, `hsla(${hue},70%,42%,${a})`);
      g.addColorStop(0.55, `hsla(${hue + 25},62%,30%,${a * 0.45})`);
      g.addColorStop(1, 'hsla(230,60%,25%,0)');
      x.fillStyle = g; x.fillRect(0, 0, PF.w, PF.h);
    }
  }
  for (let i = 0; i < count; i++) {
    const s = rng(size * 0.45, size), a = rng(alpha * 0.35, alpha);
    const warm = rnd() < 0.3;
    x.fillStyle = warm ? `rgba(255,${215 + rng(0, 30) | 0},${170 + rng(0, 50) | 0},${a})` : `rgba(${190 + rng(0, 45) | 0},${210 + rng(0, 45) | 0},255,${a})`;
    x.beginPath(); x.arc(rng(0, PF.w), rng(0, PF.h), s, 0, 7); x.fill();
  }
  if (opts.flares) {
    for (let i = 0; i < 7; i++) {
      const fx = rng(20, PF.w - 20), fy = rng(20, PF.h - 20), r = rng(8, 15);
      x.save();
      x.globalAlpha = rng(0.5, 0.9);
      const g = x.createRadialGradient(fx, fy, 0, fx, fy, r);
      g.addColorStop(0, 'rgba(255,255,255,0.9)'); g.addColorStop(0.25, 'rgba(190,225,255,0.35)'); g.addColorStop(1, 'rgba(190,225,255,0)');
      x.fillStyle = g;
      x.beginPath(); x.arc(fx, fy, r, 0, 7); x.fill();
      x.strokeStyle = 'rgba(230,245,255,0.6)'; x.lineWidth = 1;
      x.beginPath(); x.moveTo(fx - r, fy); x.lineTo(fx + r, fy); x.moveTo(fx, fy - r); x.lineTo(fx, fy + r); x.stroke();
      x.restore();
    }
  }
  return c;
}
srand(777);
const STARS = [makeStars(120, 1.0, 0.45, { nebula: true }), makeStars(70, 1.6, 0.65), makeStars(26, 2.3, 0.9, { flares: true })];

const VIGNETTE = (() => {
  const [c, x] = offCanvas(W, H);
  const g = x.createRadialGradient(W / 2, H / 2, H * 0.46, W / 2, H / 2, H * 0.9);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,10,0.38)');
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  return c;
})();

// ---------- levels ----------
function buildLevel(n) {
  G.bricks = [];
  const idx = ((n - 1) % 5) + 1;
  const put = (r, c, type) => {
    if (c < 0 || c >= COLS) return;
    G.bricks.push({ r, c, x: BX + c * BW, y: BY + r * BH, type, hp: type === SILVER ? 2 : 1, alive: true, flash: 0 });
  };
  if (idx === 1) {
    for (let r = 0; r < 6; r++) for (let c = 0; c < COLS; c++) put(r, c, r);
  } else if (idx === 2) {
    for (let c = 0; c < COLS; c++) put(0, c, SILVER);
    for (let r = 1; r < 8; r++) for (let c = 0; c < COLS; c++)
      if ((r + c) % 2 === 0) put(r, c, (r - 1) % 6);
  } else if (idx === 3) {
    for (let r = 0; r < 7; r++) for (let c = r; c < COLS - r; c++)
      put(r, c, r === 0 ? SILVER : (r - 1) % 6);
  } else if (idx === 4) { // space invader bitmap, 11 wide x 8 tall
    const bmp = [
      '00100000100', '00010001000', '00111111100', '01101110110',
      '11111111111', '10111111101', '10100000101', '00011011000'];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 11; c++)
      if (bmp[r][c] === '1') put(r, c + 1, r % 6);
  } else {
    for (let c = 0; c < COLS; c++) put(0, c, SILVER);
    for (let r = 1; r < 7; r++) { put(r, 2, GOLD); put(r, 10, GOLD); }
    for (let r = 1; r < 7; r++) for (let c = 4; c <= 8; c++) put(r, c, (r + c) % 6);
    for (let r = 1; r < 7; r++) { put(r, 0, r % 6); put(r, 12, r % 6); }
  }
}
function brickColor(br) {
  return br.type === GOLD ? '#ffdf70' : br.type === SILVER ? '#c8d4e0' : PALETTES[(G.level - 1) % PALETTES.length][br.type];
}

// ---------- game state ----------
let G = null;
let mouseX = W / 2, keys = {}, usingMouse = false;

function newGame(seed, attract) {
  srand(seed);
  G = {
    state: 'serve', stateT: 0, time: 0, attract: !!attract, showTitle: !!attract,
    score: 0, hiScore: Number(localStorage.getItem('neonoid_hi') || 25000),
    lives: 3, level: 1, combo: 0, comboPulse: 0, bricksBroken: 0, laserHits: 0, hitStop: 0,
    balls: [], bricks: [], pups: [], lasers: [], parts: [], pops: [],
    shake: 0, flash: 0, flashCol: '#ffffff',
    paddle: { x: W / 2, y: PF.y + PF.h - 54, w: 110, wTarget: 110, h: 18, vx: 0, px: W / 2, laserT: 0, catchT: 0, slowT: 0, expandT: 0, cool: 0 },
  };
  buildLevel(1);
  spawnBall(true);
}
function spawnBall(stuck) {
  const p = G.paddle;
  G.balls.push({ x: p.x, y: p.y - BALL_R - 10, px: p.x, py: p.y - 20, vx: 0, vy: 0, r: BALL_R, speed: 400 + G.level * 15, stuck, stickDx: 0, releaseT: 0, trail: [] });
}
function launchBall(b) {
  b.stuck = false;
  const a = -Math.PI / 2 + rng(-0.35, 0.35);
  b.vx = Math.cos(a) * b.speed; b.vy = Math.sin(a) * b.speed;
}

// ---------- powerups ----------
const PUP_TYPES = [
  { k: 'D', color: '#33d6ff', wt: 20 }, { k: 'E', color: '#3ae374', wt: 20 },
  { k: 'L', color: '#ff3b5c', wt: 17 }, { k: 'S', color: '#ff9143', wt: 15 },
  { k: 'C', color: '#a55eea', wt: 15 }, { k: 'P', color: '#ffd12a', wt: 8 },
];
function maybeDropPup(x, y) {
  if (rnd() > 0.13) return;
  let t = rnd() * PUP_TYPES.reduce((s, p) => s + p.wt, 0);
  for (const p of PUP_TYPES) { t -= p.wt; if (t <= 0) { G.pups.push({ x, y, vy: 130, rot: 0, glowT: 0, type: p }); return; } }
}
function applyPup(type) {
  const p = G.paddle;
  SFX.power();
  addPop(p.x, p.y - 34, { D: 'MULTIBALL', E: 'EXPAND', L: 'LASER', S: 'SLOW', C: 'CATCH', P: '+1 LIFE' }[type.k], type.color, true);
  if (type.k === 'E') p.expandT = 14;
  else if (type.k === 'S') p.slowT = 8;
  else if (type.k === 'L') p.laserT = 12;
  else if (type.k === 'C') p.catchT = 12;
  else if (type.k === 'P') G.lives = Math.min(G.lives + 1, 6);
  else if (type.k === 'D') {
    const src = G.balls.filter(b => !b.stuck);
    for (const b of src.slice(0, 2)) for (const da of [-0.55, 0.55]) {
      if (G.balls.length >= 9) break;
      const sp = Math.hypot(b.vx, b.vy) || b.speed;
      const a = Math.atan2(b.vy, b.vx) + da;
      G.balls.push({ ...b, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, trail: [] });
    }
  }
}

// ---------- particles ----------
function addParts(x, y, color, n, power) {
  for (let i = 0; i < n + 5; i++) {
    const a = rng(0, Math.PI * 2), s = rng(120, power ? 560 : 430);
    G.parts.push({ kind: 'shard', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, w: rng(5, 12), h: rng(3, 8), rot: rng(0, 7), vr: rng(-10, 10), color, life: rng(0.5, 0.95), t: 0 });
  }
  for (let i = 0; i < n; i++) {
    const a = rng(0, Math.PI * 2), s = rng(200, 680);
    G.parts.push({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, life: rng(0.2, 0.42), t: 0 });
  }
  for (let i = 0; i < 6; i++) { // lingering embers give the field battle memory
    G.parts.push({ kind: 'ember', x: x + rng(-14, 14), y: y + rng(-8, 8), vx: rng(-22, 22), vy: rng(6, 34), color, life: rng(1.3, 2.4), t: 0 });
  }
  G.parts.push({ kind: 'flash', x, y, r: power ? 120 : 84, color, life: 0.28, t: 0 });
  G.parts.push({ kind: 'flash', x, y, r: power ? 52 : 36, color: '#ffffff', life: 0.2, t: 0 });
  G.parts.push({ kind: 'ring', x, y, r: 6, color, life: 0.22, t: 0 });
}
function addSpark(x, y, color) {
  for (let i = 0; i < 5; i++) {
    const a = rng(0, Math.PI * 2), s = rng(80, 300);
    G.parts.push({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, color, life: rng(0.15, 0.3), t: 0 });
  }
}
function addPop(x, y, txt, color, big) {
  let py = Math.max(y, PF.y + 26);
  for (let guard = 0; guard < 6; guard++) { // don't stack popups on each other
    if (!G.pops.some(o => Math.abs(o.x - x) < 54 && Math.abs(o.y - py) < 20)) break;
    py -= 20;
  }
  G.pops.push({ x, y: py, txt, color, t: 0, life: big ? 1.1 : 0.9, big: !!big });
}

// ---------- brick damage ----------
function damageBrick(br, fromLaser) {
  if (!br.alive) return;
  if (br.type === GOLD) { SFX.clink(); br.flash = 1; addSpark(br.x + BW / 2, br.y + BH / 2, '#ffe9a0'); return; }
  br.hp--;
  if (br.hp > 0) { SFX.clink(); br.flash = 1; addSpark(br.x + BW / 2, br.y + BH / 2, '#dfe8f2'); return; }
  br.alive = false;
  G.bricksBroken++;
  if (fromLaser) G.laserHits++;
  const color = brickColor(br);
  const base = br.type === SILVER ? 150 : BRICK_SCORE[br.type];
  const pts = Math.round(base * (1 + Math.min(G.combo, 10) * 0.1));
  G.score += pts;
  if (G.score > G.hiScore) { G.hiScore = G.score; if (!G.attract) try { localStorage.setItem('neonoid_hi', String(G.hiScore)); } catch (e) {} }
  G.combo++;
  G.comboPulse = 0.25;
  G.hitStop = 0.03;
  SFX.brick(G.combo);
  addParts(br.x + BW / 2, br.y + BH / 2, color, 11, false);
  addPop(br.x + BW / 2, br.y, G.combo >= 3 ? `${pts} ×${G.combo}` : String(pts), color);
  for (const nb of G.bricks) // light leak onto neighbours
    if (nb.alive && Math.abs(nb.r - br.r) <= 1 && Math.abs(nb.c - br.c) <= 1) nb.flash = Math.max(nb.flash, 0.45);
  G.shake = Math.min(G.shake + 6, 16);
  maybeDropPup(br.x + BW / 2, br.y + BH / 2);
}

// ---------- simulation ----------
const STEP = 1 / 120;
function autopilot() {
  const p = G.paddle;
  let target = p.x;
  let best = null, bestY = -1;
  for (const b of G.balls) if (!b.stuck && b.vy > 0 && b.y > bestY) { best = b; bestY = b.y; }
  if (best) target = best.x + (best.vx / Math.abs(best.vy || 1)) * clamp((p.y - best.y) * 0.5, 0, 120);
  else if (G.pups.length) target = G.pups[0].x;
  else if (G.balls[0]) target = G.balls[0].x;
  target += Math.sin(G.time * 1.7) * 12;
  const maxV = 950 * STEP;
  p.x += clamp(target - p.x, -maxV, maxV);
  if (G.state === 'serve' && G.stateT > 0.5) { for (const b of G.balls) if (b.stuck) launchBall(b); G.state = 'play'; }
  if (p.laserT > 0 && p.cool <= 0) fireLaser();
  for (const b of G.balls) if (b.stuck && b.releaseT > 0.7) launchBall(b);
}
function fireLaser() {
  const p = G.paddle;
  if (p.cool > 0 || p.laserT <= 0) return;
  p.cool = 0.32;
  SFX.laser();
  for (const dx of [-p.w * 0.36, p.w * 0.36]) {
    G.lasers.push({ x: p.x + dx, y: p.y - 14, vy: -1100 });
    G.parts.push({ kind: 'flash', x: p.x + dx, y: p.y - 16, r: 38, color: '#ff8095', life: 0.16, t: 0 });
    for (let i = 0; i < 4; i++)
      G.parts.push({ kind: 'spark', x: p.x + dx, y: p.y - 16, vx: rng(-140, 140), vy: rng(-260, -60), color: '#ffb0c0', life: 0.2, t: 0 });
  }
}
function sim(dt) {
  G.time += dt; G.stateT += dt;
  const p = G.paddle;

  // paddle
  p.wTarget = p.expandT > 0 ? 164 : 110;
  p.w += (p.wTarget - p.w) * Math.min(1, dt * 10);
  for (const k of ['laserT', 'catchT', 'slowT', 'expandT']) p[k] = Math.max(0, p[k] - dt);
  p.cool = Math.max(0, p.cool - dt);
  if (G.attract || G.shotAuto) autopilot();
  else {
    if (usingMouse) p.x = mouseX;
    const kv = (keys.ArrowRight || keys.d ? 1 : 0) - (keys.ArrowLeft || keys.a ? 1 : 0);
    if (kv) { p.x += kv * 760 * dt; usingMouse = false; }
  }
  p.x = clamp(p.x, PF.x + p.w / 2 + 6, PF.x + PF.w - p.w / 2 - 6);
  p.vx = (p.x - p.px) / dt; p.px = p.x;

  if (G.state === 'clear') {
    if (G.stateT > 2.4) { G.level++; buildLevel(G.level); G.balls = []; G.pups = []; G.lasers = []; spawnBall(true); G.state = 'serve'; G.stateT = 0; }
  }
  if (G.state === 'over' && G.attract) { newGame((_seed ^ 0x9e3779b9) >>> 0, true); return; }

  let ballDt = dt * (p.slowT > 0 ? 0.62 : 1);
  if (G.hitStop > 0) { G.hitStop = Math.max(0, G.hitStop - dt); ballDt *= 0.12; }

  // balls
  for (let bi = G.balls.length - 1; bi >= 0; bi--) {
    const b = G.balls[bi];
    b.px = b.x; b.py = b.y;
    if (b.stuck) {
      b.releaseT += dt;
      b.x = clamp(p.x + b.stickDx, PF.x + b.r, PF.x + PF.w - b.r);
      b.y = p.y - p.h / 2 - b.r - 1;
    } else {
      b.x += b.vx * ballDt; b.y += b.vy * ballDt;
      // walls
      if (b.x < PF.x + b.r) { b.x = PF.x + b.r; b.vx = Math.abs(b.vx); SFX.wall(); addSpark(PF.x + 2, b.y, '#9fd8ff'); }
      if (b.x > PF.x + PF.w - b.r) { b.x = PF.x + PF.w - b.r; b.vx = -Math.abs(b.vx); SFX.wall(); addSpark(PF.x + PF.w - 2, b.y, '#9fd8ff'); }
      if (b.y < PF.y + b.r) { b.y = PF.y + b.r; b.vy = Math.abs(b.vy); SFX.wall(); addSpark(b.x, PF.y + 2, '#9fd8ff'); }
      // paddle
      if (b.vy > 0 && b.y + b.r > p.y - p.h / 2 && b.y - b.r < p.y + p.h / 2 && Math.abs(b.x - p.x) < p.w / 2 + b.r) {
        if (p.catchT > 0) { b.stuck = true; b.stickDx = clamp(b.x - p.x, -p.w / 2 + 10, p.w / 2 - 10); b.releaseT = 0; SFX.paddle(); }
        else {
          const off = clamp((b.x - p.x) / (p.w / 2), -1, 1);
          const a = -Math.PI / 2 + off * 1.05;
          b.speed = Math.min(b.speed + 7, MAX_SPEED);
          b.vx = Math.cos(a) * b.speed + p.vx * 0.12;
          b.vy = Math.sin(a) * b.speed;
          if (b.vy > -b.speed * 0.32) b.vy = -b.speed * 0.32;
          SFX.paddle();
          addSpark(b.x, p.y - p.h / 2, '#9fd8ff');
        }
        G.combo = 0;
        b.y = p.y - p.h / 2 - b.r - 0.5;
      }
      // death
      if (b.y > H + 60) {
        G.balls.splice(bi, 1);
        if (G.balls.length === 0) loseLife();
        continue;
      }
      // bricks (one hit per step)
      const c0 = clamp(((b.x - b.r - BX) / BW) | 0, 0, COLS - 1), c1 = clamp(((b.x + b.r - BX) / BW) | 0, 0, COLS - 1);
      outer:
      for (const br of G.bricks) {
        if (!br.alive || br.c < c0 - 1 || br.c > c1 + 1) continue;
        const rx = br.x, ry = br.y;
        const cx = clamp(b.x, rx, rx + BW), cy = clamp(b.y, ry, ry + BH);
        const dx = b.x - cx, dy = b.y - cy;
        if (dx * dx + dy * dy <= b.r * b.r) {
          const fromSide = b.px < rx - b.r * 0.5 || b.px > rx + BW + b.r * 0.5;
          if (fromSide) { b.vx = -b.vx; b.x = b.px; } else { b.vy = -b.vy; b.y = b.py; }
          damageBrick(br, false);
          break outer;
        }
      }
    }
    // trail
    b.trail.push({ x: b.x, y: b.y });
    if (b.trail.length > 26) b.trail.shift();
  }

  // lasers
  for (let i = G.lasers.length - 1; i >= 0; i--) {
    const l = G.lasers[i];
    l.y += l.vy * dt;
    let dead = l.y < PF.y;
    for (const br of G.bricks) {
      if (!br.alive) continue;
      if (l.x > br.x && l.x < br.x + BW && l.y > br.y && l.y < br.y + BH) {
        damageBrick(br, true);
        G.parts.push({ kind: 'flash', x: l.x, y: br.y + BH, r: 34, color: '#ff8095', life: 0.12, t: 0 });
        dead = true; break;
      }
    }
    if (dead) G.lasers.splice(i, 1);
  }

  // powerups
  for (let i = G.pups.length - 1; i >= 0; i--) {
    const u = G.pups[i];
    u.y += u.vy * dt; u.rot += dt * 3; u.glowT += dt;
    if (u.glowT > 0.07) {
      u.glowT = 0;
      G.parts.push({ kind: 'spark', x: u.x + rng(-8, 8), y: u.y - 12, vx: rng(-15, 15), vy: rng(-60, -20), color: u.type.color, life: 0.35, t: 0 });
    }
    if (u.y > p.y - 16 && u.y < p.y + 22 && Math.abs(u.x - p.x) < p.w / 2 + 14) { applyPup(u.type); G.pups.splice(i, 1); }
    else if (u.y > H + 30) G.pups.splice(i, 1);
  }

  // particles
  for (let i = G.parts.length - 1; i >= 0; i--) {
    const pt = G.parts[i];
    pt.t += dt;
    if (pt.t >= pt.life) { G.parts.splice(i, 1); continue; }
    if (pt.kind === 'shard') { pt.vy += 900 * dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.rot += pt.vr * dt; }
    else if (pt.kind === 'spark') { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vx *= (1 - 3 * dt); pt.vy *= (1 - 3 * dt); }
    else if (pt.kind === 'ember') { pt.x += pt.vx * dt; pt.y += pt.vy * dt; pt.vy += 6 * dt; }
    else if (pt.kind === 'ring') pt.r += 540 * dt;
  }
  for (let i = G.pops.length - 1; i >= 0; i--) { const o = G.pops[i]; o.t += dt; o.y -= 44 * dt; if (o.t >= o.life) G.pops.splice(i, 1); }

  G.shake = Math.max(0, G.shake - 32 * dt);
  G.flash = Math.max(0, G.flash - 3.2 * dt);
  G.comboPulse = Math.max(0, G.comboPulse - dt);
  for (const br of G.bricks) br.flash = Math.max(0, br.flash - 6 * dt);

  // level clear
  if (G.state === 'play' && !G.bricks.some(b => b.alive && b.type !== GOLD)) {
    G.state = 'clear'; G.stateT = 0;
    G.flash = 0.22; G.flashCol = '#8fffc8';
    G.shake = 10;
    G.score += 500;
    const pal = PALETTES[(G.level - 1) % PALETTES.length];
    for (let i = 0; i < 5; i++)
      addParts(rng(PF.x + 90, PF.x + PF.w - 90), rng(PF.y + 60, PF.y + 300), pal[i % 6], 12, true);
    SFX.start();
  }
}
function loseLife() {
  const p = G.paddle;
  p.laserT = p.catchT = p.slowT = p.expandT = 0;
  G.combo = 0; G.lasers = [];
  SFX.death();
  G.flash = 0.45; G.flashCol = '#ff2545';
  G.shake = 14;
  addParts(p.x, p.y, '#ff2545', 16, true);
  if (G.attract) { spawnBall(true); G.state = 'serve'; G.stateT = 0; return; }
  G.lives--;
  if (G.lives < 0) { G.state = 'over'; G.stateT = 0; }
  else { spawnBall(true); G.state = 'serve'; G.stateT = 0; }
}

// ---------- render ----------
function draw() {
  ctx.save();
  ctx.fillStyle = '#04050a';
  ctx.fillRect(0, 0, W, H);

  // arena shakes; HUD does not
  ctx.save();
  if (G.shake > 0.1) {
    ctx.translate(W / 2, H / 2);
    ctx.rotate(rng(-1, 1) * G.shake * 0.0025);
    ctx.translate(-W / 2 + rng(-1, 1) * G.shake, -H / 2 + rng(-1, 1) * G.shake);
  }
  drawPlayfieldBG();
  drawFrame();
  ctx.save();
  ctx.beginPath(); ctx.rect(PF.x - 2, PF.y - 2, PF.w + 4, H - PF.y + 2); ctx.clip();
  drawBricks();
  drawPups();
  drawLasers();
  drawBalls();
  drawPaddle();
  drawParticles();
  drawPops();
  ctx.restore();
  ctx.restore();

  drawHUD();

  if (G.state === 'serve' && !G.attract && G.stateT % 1 < 0.7) {
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(220,240,255,0.9)';
    ctx.font = '700 17px Verdana, sans-serif';
    ctx.letterSpacing = '2px';
    ctx.fillText('CLICK OR SPACE TO LAUNCH', W / 2, G.paddle.y - 70);
    ctx.font = '600 12px Verdana, sans-serif';
    ctx.fillStyle = 'rgba(150,185,215,0.75)';
    ctx.fillText('MOUSE OR A·D TO MOVE', W / 2, G.paddle.y - 48);
    ctx.letterSpacing = '0px';
  }
  if (G.state === 'clear') banner(`SECTOR ${String(G.level).padStart(2, '0')} CLEAR`, '#3ae374', '+500 — ADVANCING');
  if (G.state === 'over' && !G.attract) banner('GAME OVER', '#ff3b5c', `FINAL SCORE ${G.score.toLocaleString('en-US')} — CLICK TO RETRY`);

  if (G.showTitle) drawTitle();

  if (G.flash > 0) { ctx.globalAlpha = Math.min(G.flash, 0.6); ctx.fillStyle = G.flashCol; ctx.fillRect(0, 0, W, H); ctx.globalAlpha = 1; }
  ctx.restore();
  ctx.drawImage(VIGNETTE, 0, 0, W, H);
}
function drawPlayfieldBG() {
  const g = ctx.createLinearGradient(0, PF.y, 0, H);
  g.addColorStop(0, '#070a16'); g.addColorStop(0.55, '#0b0e20'); g.addColorStop(0.85, '#0a1224'); g.addColorStop(1, '#0c1a30');
  ctx.fillStyle = g;
  ctx.fillRect(PF.x, PF.y, PF.w, H - PF.y);
  ctx.save();
  ctx.beginPath(); ctx.rect(PF.x, PF.y, PF.w, H - PF.y); ctx.clip();
  const speeds = [5, 11, 19];
  for (let i = 0; i < 3; i++) {
    const off = (G.time * speeds[i]) % PF.h;
    ctx.drawImage(STARS[i], PF.x, PF.y + off, PF.w, PF.h);
    ctx.drawImage(STARS[i], PF.x, PF.y + off - PF.h, PF.w, PF.h);
  }
  // horizon glow silhouetting the paddle
  const hg = ctx.createLinearGradient(0, H - 150, 0, H);
  hg.addColorStop(0, 'rgba(51,214,255,0)'); hg.addColorStop(1, 'rgba(51,214,255,0.20)');
  ctx.fillStyle = hg;
  ctx.fillRect(PF.x, H - 150, PF.w, 150);
  ctx.restore();
}
function drawFrame() {
  const t = 12;
  const g = ctx.createLinearGradient(0, PF.y - t, 0, H);
  g.addColorStop(0, '#2c3546'); g.addColorStop(0.12, '#141a28'); g.addColorStop(0.6, '#1c2434'); g.addColorStop(1, '#0d111c');
  ctx.fillStyle = g;
  ctx.fillRect(PF.x - t, PF.y - t, t, H - PF.y + t);
  ctx.fillRect(PF.x + PF.w, PF.y - t, t, H - PF.y + t);
  ctx.fillRect(PF.x - t, PF.y - t, PF.w + t * 2, t);
  ctx.save();
  const glow = 0.7 + Math.min(G.shake / 13, 1) * 0.3;
  ctx.strokeStyle = `rgba(51,214,255,${glow})`;
  ctx.lineWidth = 1.6;
  ctx.shadowColor = '#33d6ff'; ctx.shadowBlur = 13 + G.shake;
  ctx.beginPath();
  ctx.moveTo(PF.x, H); ctx.lineTo(PF.x, PF.y); ctx.lineTo(PF.x + PF.w, PF.y); ctx.lineTo(PF.x + PF.w, H);
  ctx.stroke();
  ctx.restore();
}
function drawBricks() {
  const P = GLOW_PAD;
  for (const br of G.bricks) {
    if (!br.alive) continue;
    const spr = brickSprite(br.type, G.level, br.type === SILVER && br.hp === 1);
    ctx.drawImage(spr, br.x - P, br.y - P, BW + P * 2, BH + P * 2);
    if (br.flash > 0) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = br.flash * 0.9;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.roundRect(br.x + 1.5, br.y + 1.5, BW - 3, BH - 3, 5); ctx.fill();
      ctx.restore();
    }
  }
}
function drawBalls() {
  for (const b of G.balls) {
    // light spill onto surroundings
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const lg = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 64);
    lg.addColorStop(0, 'rgba(80,200,255,0.24)'); lg.addColorStop(1, 'rgba(80,200,255,0)');
    ctx.fillStyle = lg;
    ctx.beginPath(); ctx.arc(b.x, b.y, 64, 0, 7); ctx.fill();
    // ribbon trail: wide colored pass then hot core pass
    const n = b.trail.length;
    if (n > 2) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 1; i < n; i++) {
          const k = i / n;
          ctx.beginPath();
          ctx.moveTo(b.trail[i - 1].x, b.trail[i - 1].y);
          ctx.lineTo(b.trail[i].x, b.trail[i].y);
          if (pass === 0) { ctx.strokeStyle = `rgba(35,180,255,${k * 0.30})`; ctx.lineWidth = k * 11; }
          else { ctx.strokeStyle = `rgba(235,250,255,${k * 0.75})`; ctx.lineWidth = k * 3.2; }
          ctx.stroke();
        }
      }
    }
    ctx.restore();
    // ball, stretched along velocity
    ctx.save();
    const sp = Math.hypot(b.vx, b.vy);
    ctx.translate(b.x, b.y);
    if (sp > 40) { ctx.rotate(Math.atan2(b.vy, b.vx)); ctx.scale(1 + 0.5 * Math.min(sp / 700, 1), 1 - 0.18 * Math.min(sp / 700, 1)); }
    ctx.shadowColor = '#5fdcff'; ctx.shadowBlur = 20;
    const g = ctx.createRadialGradient(-2.5, -3, 1, 0, 0, b.r);
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.55, '#d9f6ff'); g.addColorStop(1, '#2fb9e8');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, b.r, 0, 7); ctx.fill();
    ctx.restore();
  }
}
function drawPaddle() {
  const p = G.paddle;
  const recoil = p.cool > 0.26 ? 3 : 0;
  const tilt = clamp(p.vx * 0.00008, -0.07, 0.07);
  ctx.save();
  ctx.translate(p.x, p.y + recoil);
  ctx.rotate(tilt);
  // engine glow beneath
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const pulse = 0.65 + Math.sin(G.time * 7) * 0.2;
  const eg = ctx.createRadialGradient(0, 10, 2, 0, 10, p.w * 0.6);
  eg.addColorStop(0, `rgba(51,214,255,${0.42 * pulse})`); eg.addColorStop(1, 'rgba(51,214,255,0)');
  ctx.fillStyle = eg;
  ctx.beginPath(); ctx.ellipse(0, 13, p.w * 0.6, 24, 0, 0, 7); ctx.fill();
  for (const dx of [-p.w * 0.28, p.w * 0.28]) {
    const tg = ctx.createRadialGradient(dx, 12, 0, dx, 12, 12);
    tg.addColorStop(0, `rgba(160,235,255,${0.85 * pulse})`); tg.addColorStop(1, 'rgba(160,235,255,0)');
    ctx.fillStyle = tg;
    ctx.beginPath(); ctx.arc(dx, 12, 12, 0, 7); ctx.fill();
  }
  ctx.restore();
  ctx.shadowColor = 'rgba(51,214,255,0.7)'; ctx.shadowBlur = 14;
  ctx.drawImage(paddleSprite(p.w), -p.w / 2, -p.h / 2, p.w, p.h);
  ctx.shadowBlur = 0;
  if (p.laserT > 0) { // attached cannons
    for (const dx of [-p.w * 0.36, p.w * 0.36]) {
      ctx.fillStyle = '#39445a';
      ctx.beginPath(); ctx.roundRect(dx - 3.5, -p.h / 2 - 8, 7, 9, 2); ctx.fill();
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = 'rgba(255,90,110,0.9)';
      ctx.shadowColor = '#ff5a6e'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.arc(dx, -p.h / 2 - 8, 2.4, 0, 7); ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
}
function drawPups() {
  for (const u of G.pups) {
    ctx.save();
    ctx.translate(u.x, u.y);
    const sx = Math.abs(Math.cos(u.rot)) * 0.6 + 0.4;
    ctx.scale(sx, 1);
    ctx.shadowColor = u.type.color; ctx.shadowBlur = 18;
    const g = ctx.createLinearGradient(0, -12, 0, 12);
    g.addColorStop(0, shade(u.type.color, 0.5)); g.addColorStop(0.5, u.type.color); g.addColorStop(1, shade(u.type.color, -0.4));
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.roundRect(-16, -11, 32, 22, 10); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.beginPath(); ctx.roundRect(-13, -9, 26, 8, 5); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#0a0e16';
    ctx.font = '900 15px Verdana, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(u.type.k, u.x, u.y + 1);
    ctx.textBaseline = 'alphabetic';
  }
}
function drawLasers() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const l of G.lasers) {
    const g = ctx.createLinearGradient(l.x - 11, 0, l.x + 11, 0);
    g.addColorStop(0, 'rgba(255,60,90,0)'); g.addColorStop(0.5, 'rgba(255,80,110,0.85)'); g.addColorStop(1, 'rgba(255,60,90,0)');
    ctx.fillStyle = g;
    ctx.fillRect(l.x - 11, l.y - 30, 22, 46);
    ctx.fillStyle = 'rgba(255,240,244,1)';
    ctx.fillRect(l.x - 2, l.y - 26, 4, 40);
    ctx.fillStyle = 'rgba(255,255,255,1)';
    ctx.beginPath(); ctx.arc(l.x, l.y - 26, 3, 0, 7); ctx.fill();
  }
  ctx.restore();
}
function drawParticles() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const pt of G.parts) {
    const k = 1 - pt.t / pt.life;
    if (pt.kind === 'shard') {
      ctx.save();
      ctx.translate(pt.x, pt.y); ctx.rotate(pt.rot);
      ctx.globalAlpha = k;
      ctx.fillStyle = pt.color;
      ctx.fillRect(-pt.w / 2, -pt.h / 2, pt.w, pt.h);
      ctx.restore();
    } else if (pt.kind === 'spark') {
      ctx.globalAlpha = k;
      ctx.strokeStyle = pt.color; ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(pt.x, pt.y);
      ctx.lineTo(pt.x - pt.vx * 0.03, pt.y - pt.vy * 0.03); ctx.stroke();
    } else if (pt.kind === 'flash') {
      const g = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, pt.r);
      g.addColorStop(0, pt.color); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = k * 0.95;
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, 7); ctx.fill();
    } else if (pt.kind === 'ember') {
      ctx.globalAlpha = k * 0.18;
      ctx.fillStyle = pt.color;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 5, 0, 7); ctx.fill();
      ctx.globalAlpha = k * 0.7;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, 1.8, 0, 7); ctx.fill();
    } else if (pt.kind === 'ring') {
      ctx.globalAlpha = k * 0.85;
      ctx.strokeStyle = pt.color; ctx.lineWidth = 10 * k + 2;
      ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, 7); ctx.stroke();
    }
  }
  ctx.restore();
  ctx.globalAlpha = 1;
}
function drawPops() {
  for (const o of G.pops) {
    // hold full opacity for 60% of life, then fade fast — outline stays crisp
    const k = o.t < o.life * 0.6 ? 1 : 1 - (o.t - o.life * 0.6) / (o.life * 0.4);
    const punch = 1 + 0.5 * Math.max(0, 1 - o.t / 0.15);
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.scale(punch, punch);
    ctx.globalAlpha = k;
    ctx.font = `900 ${o.big ? 24 : 19}px Verdana, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 4; ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(6,9,15,0.95)';
    ctx.strokeText(o.txt, 0, 0);
    ctx.shadowColor = o.color; ctx.shadowBlur = 10;
    ctx.fillStyle = o.big ? o.color : '#ffffff';
    ctx.fillText(o.txt, 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
function panel(x, y, w, h, dim) {
  ctx.fillStyle = dim ? 'rgba(140,190,255,0.028)' : 'rgba(140,190,255,0.05)';
  ctx.strokeStyle = dim ? 'rgba(51,214,255,0.10)' : 'rgba(51,214,255,0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.roundRect(x, y, w, h, 8); ctx.fill(); ctx.stroke();
}
function hudLabel(txt, x, y, align = 'left') {
  ctx.font = '700 12px Verdana, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.textAlign = align;
  ctx.fillStyle = 'rgba(150,190,225,0.9)';
  ctx.fillText(txt, x, y);
  ctx.letterSpacing = '0px';
}
const LEVEL_NAMES = ['FIRST STEPS', 'CHECKER FIELD', 'THE PYRAMID', 'INVADER', 'THE VAULT'];
function drawHUD() {
  const p = G.paddle;
  const dash = G.showTitle;
  ctx.save();
  if (dash) ctx.globalAlpha = 0.5;

  // ---- left rail ----
  panel(20, 64, 208, 150);
  hudLabel('SCORE', 40, 96);
  ctx.font = '800 32px "Arial Black", Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff';
  ctx.save(); ctx.shadowColor = 'rgba(51,214,255,0.7)'; ctx.shadowBlur = 10;
  ctx.fillText(dash ? '——' : G.score.toLocaleString('en-US'), 208, 134);
  ctx.restore();
  hudLabel('HIGH', 40, 168);
  ctx.font = '700 19px "Arial Black", Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = '#8fa8c0';
  ctx.fillText(G.hiScore.toLocaleString('en-US'), 208, 194);

  const comboActive = G.combo >= 2 && !dash;
  panel(20, 230, 208, 54, !comboActive);
  if (comboActive) {
    const pulse = 1 + Math.sin(G.time * 12) * 0.04 + 0.25 * Math.max(0, G.comboPulse / 0.25);
    ctx.save();
    ctx.translate(124, 265); ctx.scale(pulse, pulse);
    ctx.font = '900 24px "Arial Black", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffd12a';
    ctx.shadowColor = '#ffd12a'; ctx.shadowBlur = 12;
    ctx.fillText(`COMBO ×${G.combo}`, 0, 0);
    ctx.restore();
  } else {
    hudLabel('COMBO', 40, 258);
    ctx.font = '800 20px "Arial Black", Arial, sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(140,170,200,0.35)';
    ctx.fillText('—', 208, 262);
  }

  // ---- right rail ----
  panel(1052, 64, 208, 96);
  hudLabel('SECTOR', 1072, 96);
  ctx.font = '800 32px "Arial Black", Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(String(G.level).padStart(2, '0'), 1072, 136);
  ctx.font = '700 12px Verdana, sans-serif';
  ctx.fillStyle = '#6d87ab';
  ctx.letterSpacing = '1px';
  ctx.fillText(LEVEL_NAMES[(G.level - 1) % 5], 1134, 136);
  ctx.letterSpacing = '0px';

  panel(1052, 176, 208, 62);
  hudLabel('LIVES', 1072, 204);
  for (let i = 0; i < 6; i++) {
    const lx = 1080 + i * 30, ly = 220;
    const lit = i < G.lives && !dash;
    if (lit) {
      ctx.save();
      ctx.shadowColor = '#33d6ff'; ctx.shadowBlur = 10;
      ctx.fillStyle = '#5fdcff';
      ctx.beginPath(); ctx.arc(lx, ly, 6.5, 0, 7); ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      ctx.beginPath(); ctx.arc(lx - 1.8, ly - 1.8, 2.1, 0, 7); ctx.fill();
    } else {
      ctx.strokeStyle = 'rgba(120,150,185,0.45)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(lx, ly, 6, 0, 7); ctx.stroke();
    }
  }

  panel(1052, 254, 208, 140);
  hudLabel('SYSTEMS', 1072, 282);
  const SYS = [
    ['L', 'LASER', '#ff3b5c', p.laserT / 12], ['C', 'CATCH', '#a55eea', p.catchT / 12],
    ['S', 'SLOW', '#ff9143', p.slowT / 8], ['E', 'EXPAND', '#3ae374', p.expandT / 14],
  ];
  SYS.forEach(([letter, word, color, frac], i) => {
    const y = 298 + i * 24;
    const on = frac > 0 && !dash;
    ctx.globalAlpha = (dash ? 0.5 : 1) * (on ? 1 : 0.25);
    ctx.fillStyle = on ? color : 'rgba(140,170,200,0.6)';
    ctx.beginPath(); ctx.roundRect(1072, y, 15, 15, 3); ctx.fill();
    ctx.fillStyle = '#0a0e16';
    ctx.font = '900 10px Verdana, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(letter, 1079.5, y + 11);
    ctx.font = '700 11px Verdana, sans-serif';
    ctx.textAlign = 'left';
    ctx.letterSpacing = '2px';
    ctx.fillStyle = on ? '#dceaf8' : 'rgba(140,170,200,0.8)';
    ctx.fillText(word, 1096, y + 11.5);
    ctx.letterSpacing = '0px';
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    ctx.fillRect(1168, y + 5, 76, 5);
    if (on) { ctx.fillStyle = color; ctx.fillRect(1168, y + 5, 76 * clamp(frac, 0, 1), 5); }
    ctx.globalAlpha = dash ? 0.5 : 1;
  });
  ctx.restore();
}
function banner(title, color, sub) {
  ctx.save();
  const by = H / 2 - 80, bh = 150;
  ctx.fillStyle = 'rgba(4,8,16,0.86)';
  ctx.fillRect(PF.x - 12, by, PF.w + 24, bh);
  ctx.save();
  ctx.shadowColor = color; ctx.shadowBlur = 10;
  ctx.fillStyle = color;
  ctx.fillRect(PF.x - 12, by, PF.w + 24, 2);
  ctx.fillRect(PF.x - 12, by + bh - 2, PF.w + 24, 2);
  ctx.restore();
  ctx.textAlign = 'center';
  ctx.font = '900 46px "Arial Black", Arial, sans-serif';
  ctx.letterSpacing = '6px';
  ctx.shadowColor = color; ctx.shadowBlur = 26;
  ctx.fillStyle = color;
  ctx.fillText(title, W / 2, by + 64);
  ctx.shadowBlur = 0;
  ctx.font = '600 15px Verdana, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillStyle = 'rgba(225,240,255,0.92)';
  ctx.fillText(sub, W / 2, by + 106);
  ctx.letterSpacing = '0px';
  ctx.restore();
}
function drawTitle() {
  ctx.save();
  ctx.fillStyle = 'rgba(3,4,9,0.35)';
  ctx.fillRect(0, 0, W, H);
  // containment band for the wordmark
  const by = 170, bh = 240, bx = PF.x - 12, bw = PF.w + 24;
  ctx.fillStyle = 'rgba(3,5,11,0.88)';
  ctx.fillRect(bx, by, bw, bh);
  ctx.save();
  ctx.shadowColor = '#33d6ff'; ctx.shadowBlur = 8;
  ctx.fillStyle = 'rgba(51,214,255,0.55)';
  ctx.fillRect(bx, by, bw, 1.5);
  ctx.fillRect(bx, by + bh - 1.5, bw, 1.5);
  ctx.restore();
  ctx.textAlign = 'center';
  const ly = 300;
  ctx.font = '900 104px "Arial Black", Arial, sans-serif';
  ctx.letterSpacing = '12px';
  ctx.fillStyle = 'rgba(255,40,80,0.5)'; ctx.fillText('NEONOID', W / 2 - 3, ly);
  ctx.fillStyle = 'rgba(30,200,255,0.5)'; ctx.fillText('NEONOID', W / 2 + 3, ly);
  ctx.save();
  ctx.shadowColor = '#33d6ff'; ctx.shadowBlur = 34;
  ctx.fillStyle = '#eef8ff'; ctx.fillText('NEONOID', W / 2, ly);
  ctx.restore();
  ctx.letterSpacing = '6px';
  ctx.font = '600 17px Verdana, sans-serif';
  ctx.fillStyle = '#7fb0d0';
  ctx.fillText('A  TRIBUTE  TO  ARKANOID', W / 2, ly + 56);
  const a = (Math.sin(G.time * 4) + 1) / 2 * 0.45 + 0.55;
  ctx.globalAlpha = a;
  ctx.font = '900 25px "Arial Black", Arial, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = '#33d6ff'; ctx.shadowBlur = 14;
  ctx.fillText('CLICK TO START', W / 2, 500);
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  ctx.font = '600 13px Verdana, sans-serif';
  ctx.letterSpacing = '3px';
  ctx.fillStyle = 'rgba(140,170,200,0.75)';
  ctx.fillText('MOUSE — MOVE      SPACE — LAUNCH', W / 2, 640);
  ctx.letterSpacing = '0px';
  ctx.restore();
}

// ---------- input ----------
canvas.addEventListener('mousemove', e => {
  const r = canvas.getBoundingClientRect();
  mouseX = (e.clientX - r.left) * (W / r.width);
  usingMouse = true;
});
canvas.addEventListener('mousedown', () => {
  audio();
  if (G.showTitle) { G.showTitle = false; newGame((Math.random() * 1e9) >>> 0, false); SFX.start(); return; }
  if (G.state === 'over') { newGame((Math.random() * 1e9) >>> 0, false); SFX.start(); return; }
  if (G.state === 'serve') { for (const b of G.balls) if (b.stuck) launchBall(b); G.state = 'play'; G.stateT = 0; return; }
  if (G.state === 'play') { for (const b of G.balls) if (b.stuck) launchBall(b); fireLaser(); }
});
window.addEventListener('keydown', e => {
  keys[e.key] = true;
  if (e.key === ' ') {
    e.preventDefault(); audio();
    if (G.showTitle) { G.showTitle = false; newGame((Math.random() * 1e9) >>> 0, false); SFX.start(); }
    else if (G.state === 'serve') { for (const b of G.balls) if (b.stuck) launchBall(b); G.state = 'play'; G.stateT = 0; }
    else if (G.state === 'play') { for (const b of G.balls) if (b.stuck) launchBall(b); fireLaser(); }
    else if (G.state === 'over') newGame((Math.random() * 1e9) >>> 0, false);
  }
});
window.addEventListener('keyup', e => { keys[e.key] = false; });

// ---------- main loop ----------
let last = 0, acc = 0;
function frame(t) {
  requestAnimationFrame(frame);
  const dt = Math.min((t - last) / 1000, 1 / 20);
  last = t;
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 12) { sim(STEP); acc -= STEP; n++; }
  draw();
}

// ---------- shot harness ----------
function runShot(name) {
  AUDIO_ON = false;
  newGame(1234567, false);
  G.shotAuto = true;
  const stepUntil = (cond, cap) => { let n = 0; while (!cond() && n < cap) { sim(STEP); n++; } };
  const stepFor = s => { const n = Math.round(s / STEP); for (let i = 0; i < n; i++) sim(STEP); };
  if (name === 'title') {
    G.attract = true; G.showTitle = true;
    stepFor(6);
  } else if (name === 'serve') {
    G.shotAuto = false;
    stepFor(0.3);
  } else if (name === 'action') {
    stepUntil(() => G.bricksBroken >= 5, 120 * 60);
    stepFor(0.04);
  } else if (name === 'burst') {
    stepUntil(() => G.bricksBroken >= 9, 120 * 90);
    stepFor(0.05);
  } else if (name === 'multiball') {
    stepFor(1);
    applyPup(PUP_TYPES[0]); // D
    stepUntil(() => G.bricksBroken >= 10, 120 * 90);
    stepFor(0.03);
  } else if (name === 'laser') {
    stepFor(1);
    applyPup(PUP_TYPES[2]); // L
    stepUntil(() => G.laserHits >= 2, 120 * 60);
    stepFor(0.05);
  } else if (name === 'level4') {
    G.level = 4; buildLevel(4); G.balls = []; spawnBall(true);
    stepUntil(() => G.bricksBroken >= 4, 120 * 90);
    stepFor(0.04);
  } else if (name === 'hero') {
    // README hero: real action, but captured after the shake settles so the frame is level
    G.level = 4; buildLevel(4); G.balls = []; spawnBall(true);
    stepUntil(() => G.bricksBroken >= 6, 120 * 90);
    stepUntil(() => G.shake < 1.5, 120 * 2);
  } else if (name === 'clear') {
    for (const br of G.bricks) if (br.type !== GOLD) br.alive = false;
    G.bricks = G.bricks.filter(b => b.alive);
    G.state = 'play';
    sim(STEP); stepFor(0.3);
  } else {
    stepFor(2);
  }
  draw();
  document.title = 'shot-ready';
}

const q = new URLSearchParams(location.search);
const shotName = q.get('shot');
if (shotName) runShot(shotName);
else { newGame(1357911, true); requestAnimationFrame(t => { last = t; requestAnimationFrame(frame); }); }
