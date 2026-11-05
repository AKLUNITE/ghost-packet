// GHOST//PACKET 3D table: a round PCB holo-table, hooded hackers, glowing packets and the effects layer.
import { Renderer, Geo, M4, Particles } from './gl.js';

export const COLORS = ['#ff6a4d', '#ffc23a', '#a8f04a', '#2fe0c0', '#4fa6ff', '#a98bff', '#ff5ec8', '#f2e2c4'];
export const STYLE_NAMES = ['クラシック', 'バイザー', 'ネコミミ', 'アンテナ', 'ヘッドホン', 'ツノ', 'トサカ', 'マスク'];
// colour-blind safety: every colour also has its own shape
export function drawSym(g, k, x, y, r) {
  g.beginPath();
  const poly = (n, rot, rr = r) => { for (let i = 0; i < n; i++) { const a = rot + i * Math.PI * 2 / n; i ? g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); };
  switch (k % 8) {
    case 0: poly(4, -Math.PI / 2); break;                                   // diamond
    case 1: g.arc(x, y, r * 0.85, 0, Math.PI * 2); break;                    // circle
    case 2: poly(3, -Math.PI / 2, r * 1.05); break;                           // triangle
    case 3: g.rect(x - r * 0.75, y - r * 0.75, r * 1.5, r * 1.5); break;      // square
    case 4: for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; i ? g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.closePath(); break; // star
    case 5: { const w = r * 0.38; g.rect(x - w, y - r, w * 2, r * 2); g.rect(x - r, y - w, r * 2, w * 2); break; } // plus
    case 6: poly(5, -Math.PI / 2); break;                                   // pentagon
    case 7: poly(6, 0); break;                                              // hexagon
  }
}
const hex = (h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const R_START = 10.2, STEP = 0.82, AV_R = 15.4;
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => 1 - Math.pow(1 - t, 3);
const FONT = '"DotGothic16","Zen Kaku Gothic New",monospace';

function cvs(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

export class Scene3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.scene = { meshes: [], sprites: [], particles: null, fog: [0.03, 0.022, 0.018], fogD: 120, light: [0.15, 1, 0.35] };
    this.t = 0; this.anims = []; this.seats = []; this.n = 0; this.me = 0; this.lost = false;
    this.profile = 'pc'; this.fxScale = 1; this.labelScale = 1; this.yaw = 0; this.zoom = 1; this.pan = [0, 0];
    this.cam = { eye: [0, 22, 22], target: [0, 0, 1], fov: 0.72, maxDpr: 1.75 };
    this.camGoal = null; this.shakeAmt = 0; this.flashC = [0, 0, 0, 0];
    this.timerFrac = 0; this.timerUrgent = false; this.timerOn = false;
    this._initGPU();
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.lost = false; this._initGPU(); if (this.lastSetup) this.setup(...this.lastSetup).then(() => this.onRestore && this.onRestore()); });
    this._loop = this._loop.bind(this); this.last = performance.now(); requestAnimationFrame(this._loop);
  }
  _initGPU() {
    this.r = new Renderer(this.canvas);
    this.scene.meshes = []; this.scene.sprites = []; this.scene.particles = new Particles(5000);
    this.anims = []; this.static = []; this.seats = []; this.claim = null; this.chipRing = null; this.texCache = new Map();
    this.geo = {
      octa: this.r.mesh((() => { const g = new Geo(); g.add(Geo.lathe([[0.5, 0], [0.5, 0.26], [0.001, 0.26]], 6), null, [1, 1, 1]); g.add(Geo.lathe([[0.5, 0], [0.001, 0]], 6), null, [1, 1, 1]); return g; })()),
      chip: this.r.mesh((() => { const g = new Geo(); g.add(Geo.lathe([[0.34, 0], [0.34, 0.12], [0.001, 0.12]], 6), null, [1, 1, 1]); return g; })()),
      pin: this.r.mesh(Geo.box(1, 1, 1)),
      torusS: this.r.mesh(Geo.torus(0.62, 0.06, 40, 8)),
      torusL: this.r.mesh(Geo.torus(3.35, 0.05, 96, 8)),
      plane: this.r.mesh(Geo.plane(1, 1)),
      node: this.r.mesh(Geo.lathe([[0.42, 0], [0.42, 0.1], [0.22, 0.12], [0, 0.12]], 20)),
      // leather dice cup, mouth down on the table
      cup: this.r.mesh(Geo.lathe([[0.001, 0.04], [0.7, 0.04], [0.74, 0.1], [0.7, 0.24], [0.56, 1.42], [0.6, 1.5], [0.5, 1.56], [0.001, 1.56]], 28)),
      cupBand: this.r.mesh(Geo.torus(0.69, 0.07, 32, 6)),
    };
    this._buildRoom();
  }

  // ───── objects ─────
  obj(mesh, o = {}) {
    const ob = Object.assign({ mesh, m: M4.ident(), tint: [1, 1, 1, 1], emi: [0, 0, 0], visible: true, tex: null }, o);
    this.scene.meshes.push(ob); return ob;
  }
  spr(o) { const s = Object.assign({ pos: [0, 0, 0], size: [1, 1], color: [1, 1, 1, 1], mode: 0, glow: 0, visible: true }, o); this.scene.sprites.push(s); return s; }
  rm(o) {
    this.scene.meshes = this.scene.meshes.filter(x => x !== o); this.scene.sprites = this.scene.sprites.filter(x => x !== o);
    if (o.ownTex && o.tex) this.r.deleteTexture(o.tex);
    if (o.ownMesh && o.mesh) this.r.deleteMesh(o.mesh);
  }
  anim(dur, fn, done) { const a = { t: 0, dur, fn, done }; this.anims.push(a); return a; }

  _buildRoom() {
    // a wooden game table under a warm lamp, in a dark room
    const W = 1024, wc = cvs(W, W), g = wc.getContext('2d');
    g.fillStyle = '#3a2416'; g.fillRect(0, 0, W, W);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let y = 0; y < W; y += 2) {      // planks with grain
      const plank = Math.floor(y / 128), base = [58 + plank % 3 * 6, 36 + plank % 2 * 4, 22];
      const n = Math.sin(y * 0.09 + plank * 7) * 8 + Math.sin(y * 0.37 + plank) * 4;
      g.fillStyle = `rgb(${base[0] + n},${base[1] + n * 0.6},${base[2] + n * 0.3})`; g.fillRect(0, y, W, 2);
    }
    g.globalAlpha = 0.18; g.strokeStyle = '#1a0e07';
    for (let k = 0; k < 220; k++) { const y = rnd() * W; g.lineWidth = 0.5 + rnd() * 1.5; g.beginPath(); g.moveTo(0, y); for (let x = 0; x <= W; x += 32) g.lineTo(x, y + Math.sin(x * 0.01 + k) * 3); g.stroke(); }
    g.globalAlpha = 0.55; g.fillStyle = '#140904'; for (let y = 128; y < W; y += 128) g.fillRect(0, y - 1, W, 2);
    g.globalAlpha = 1;
    const vg = g.createRadialGradient(W / 2, W / 2, 80, W / 2, W / 2, W * 0.62); vg.addColorStop(0, 'rgba(255,200,140,.10)'); vg.addColorStop(1, 'rgba(0,0,0,.55)');
    g.fillStyle = vg; g.fillRect(0, 0, W, W);
    const table = this.obj(this.r.mesh(Geo.disc(26, 128)), { tex: this.r.texture(wc), texEmi: 0.05 });
    M4.compose(table.m, 0, -0.64, 0);
    const edge = new Geo(); edge.add(Geo.lathe([[26, -1.5], [26.3, -1.1], [26.1, -0.64]], 128, false), null, [0.16, 0.09, 0.05]);
    this.obj(this.r.mesh(edge), { cull: false });
    // dim floor far below so the room reads as a room
    const fl = this.obj(this.r.mesh(Geo.plane(160, 160)), { tint: [0.05, 0.035, 0.03, 1] }); M4.compose(fl.m, 0, -12, 0);
    // pendant lamp above the table
    const lamp = new Geo();
    lamp.add(Geo.lathe([[0.001, 0], [5.5, -0.2], [6.2, -2.2], [5.9, -2.3], [0.001, -0.6]], 48), null, [0.07, 0.07, 0.06]);
    lamp.add(Geo.lathe([[0.08, 0], [0.08, 18]], 8), M4.compose(M4.ident(), 0, 0, 0), [0.05, 0.05, 0.05]);
    const lampOb = this.lampOb = this.obj(this.r.mesh(lamp), { cull: false }); M4.compose(lampOb.m, 0, 24, 0);
    const bulb = this.bulb = this.obj(this.r.mesh(Geo.disc(5.6, 48)), { tint: [1, 0.85, 0.6, 1], emi: [1.2, 0.95, 0.6], cull: false }); M4.compose(bulb.m, 0, 21.75, 0, Math.PI, 0, 0);
    this.demo = { on: false, next: 0 };
  }

  // ───── per-match setup ─────
  async setup(players, me) {
    try { await document.fonts.load('40px "DotGothic16"'); } catch (e) { /* fallback font */ }
    this.lastSetup = [players, me];
    for (const o of this.static) this.rm(o);
    for (const a of this.anims) a.done = null; this.anims = [];
    for (const s of this.scene.sprites.slice()) this.rm(s);
    this.claim = null;
    this.static = []; this.seats = []; this.n = players.length; this.me = me || 0;
    this.pal = players.map((p, i) => COLORS[p.color != null ? p.color : i]);
    this.sym = players.map((p, i) => p.color != null ? p.color : i);
    const n = this.n, keep = (o) => { this.static.push(o); return o; };
    // board top (PCB texture)
    const tex = this.r.texture(this._pcb(players));
    const top = keep(this.obj(this.r.mesh(Geo.disc(13, 128)), { tex, texEmi: 0.07, ownTex: true, ownMesh: true }));
    M4.compose(top.m, 0, 0, 0);
    const rim = new Geo();
    rim.add(Geo.lathe([[13.0, -0.62], [13.05, -0.6], [13.05, -0.02], [13.0, 0.0]], 128, false), null, hex('#cdbf9f'));
    rim.add(Geo.torus(13.0, 0.04, 160, 6), M4.compose(M4.ident(), 0, 0.0, 0), hex('#0c2a20'), 0);
    keep(this.obj(this.r.mesh(rim), { cull: false, ownMesh: true }));
    // lanes + chip baked into one mesh
    const B = new Geo(), gold = hex('#d9ad55'), copper = hex('#c27a43');
    for (let i = 0; i < n; i++) {
      const a = this.ang(i), col = hex(this.pal[i]);
      const mid = (R_START + 2.6) / 2, len = R_START - 2.6;
      B.add(Geo.box(0.26, 0.06, len), M4.compose(M4.ident(), Math.cos(a) * mid, 0.03, Math.sin(a) * mid, 0, -a + Math.PI / 2, 0), gold, 0.08);
      B.add(Geo.box(0.07, 0.07, len), M4.compose(M4.ident(), Math.cos(a) * mid + Math.cos(a + Math.PI / 2) * 0.38, 0.035, Math.sin(a) * mid + Math.sin(a + Math.PI / 2) * 0.38, 0, -a + Math.PI / 2, 0), col, 1.2);
      const [x0, , z0] = this.nodePos(i, 0);
      B.add(Geo.box(1.0, 0.14, 1.0), M4.compose(M4.ident(), x0, 0.07, z0, 0, -a + Math.PI / 4, 0), copper, 0.15);
    }
    // chip
    B.add(Geo.box(4.6, 0.9, 4.6), M4.compose(M4.ident(), 0, 0.45, 0), hex('#0e1110'));
    for (let k = 0; k < 11; k++) {
      const o = -2.0 + k * 0.4;
      for (const [x, z, sx, sz] of [[o, 2.55, 0.16, 0.5], [o, -2.55, 0.16, 0.5], [2.55, o, 0.5, 0.16], [-2.55, o, 0.5, 0.16]])
        B.add(Geo.box(sx, 0.12, sz), M4.compose(M4.ident(), x, 0.06, z), gold, 0.15);
    }
    keep(this.obj(this.r.mesh(B), { ownMesh: true }));
    // chip face (dynamic)
    this.chipC = cvs(512, 512); this.chipTex = this.r.texture(this.chipC);
    this.chipTop = keep(this.obj(this.geo.plane, { tex: this.chipTex, texEmi: 1.2, ownTex: true }));
    M4.compose(this.chipTop.m, 0, 0.91, 0, 0, 0, 0, 4.3, 1, 4.3);
    this.chipRing = keep(this.obj(this.geo.torusL, { tint: [1, 0.8, 0.4, 1], emi: [0.5, 0.35, 0.1], cull: false }));
    M4.compose(this.chipRing.m, 0, 0.12, 0);
    // timer ring: 60 segments
    this.timerSegs = [];
    for (let k = 0; k < 60; k++) {
      const a = -Math.PI / 2 + k / 60 * Math.PI * 2;
      const o = keep(this.obj(this.geo.pin, { tint: [0.2, 0.25, 0.22, 1], emi: [0, 0, 0] }));
      M4.compose(o.m, Math.cos(a) * 4.0, 0.08, Math.sin(a) * 4.0, 0, -a, 0, 0.18, 0.14, 0.32);
      this.timerSegs.push(o);
    }
    this.goalsText = [0, n * 2]; this._drawChip();
    // lane nodes light up in the owner's colour as the packet passes them
    this.nodes = [];
    for (let i = 0; i < n; i++) {
      const row = [];
      for (let p = 1; p <= 8; p++) { const o = keep(this.obj(this.geo.node)); const [x, , z] = this.nodePos(i, p); M4.compose(o.m, x, 0, z); row.push(o); }
      this.nodes.push(row);
    }
    // seats
    for (let i = 0; i < n; i++) this.seats.push(this._seat(i, players[i], keep));
    this.nextMark = keep(this.spr({ tex: this._textTex('NEXT', { cache: true, size: 120, grad: ['#ffffff', '#ffcf4a'], w: 384, h: 160 }), size: [2.6, 1.08], color: [1, 1, 1, 0], depthTest: false, glow: 0.5 }));
    this.nextSeat = null; this.turnSeat = null;
    this.spot = keep(this.spr({ mode: 3, size: [3.2, 12], color: [1, 0.85, 0.4, 0], add: true, glow: 1.2 })); this.spot.m = M4.ident();
    this.resetCam();
  }
  ang(i) { return Math.PI / 2 + ((i - this.me + this.n) % this.n) * Math.PI * 2 / this.n; }
  nodePos(i, p) {
    const a = this.ang(i);
    if (p >= 9) return [0, 1.4, 0];
    const r = R_START - p * STEP; return [Math.cos(a) * r, 0, Math.sin(a) * r];
  }

  _seat(i, pl, keep) {
    const a = this.ang(i), colHex = this.pal[i], col = hex(colHex);
    const x = Math.cos(a) * AV_R, z = Math.sin(a) * AV_R, face = -a - Math.PI / 2;
    const isMe = i === this.me;
    const G = this._avatarGeo(pl.style != null ? pl.style : i, col);
    const ob = keep(this.obj(this.r.mesh(G.body), { ownMesh: true }));
    const glowOb = keep(this.obj(this.r.mesh(G.glow), { ownMesh: true }));
    const eyeOb = keep(this.obj(this.r.mesh(G.eyes), { tint: [1, 1, 1, 1], emi: [0.6, 1, 0.8], ownMesh: true }));
    const armOb = keep(this.obj(this.r.mesh(G.arms), { ownMesh: true }));
    const shadow = keep(this.spr({ mode: 2, color: [0, 0, 0, 0.6], size: [5.5, 5.5], glow: 0 })); shadow.m = M4.compose(M4.ident(), x, -0.62, z, -Math.PI / 2, 0, 0);
    // halo status ring above head
    const halo = keep(this.obj(this.geo.torusS, { tint: [0.4, 0.4, 0.4, 1], emi: [0, 0, 0], cull: false }));
    // packet + its floor glow + contact shadow
    const pk = keep(this.obj(this.geo.octa, { tint: [...col.map(v => v * 0.85 + 0.1), 1], emi: col.map(v => v * 0.35) }));
    // physical reserve: up to 6 small tokens stacked next to this player's start square
    const sa = a + 0.17, stack = [];
    for (let k = 0; k < 6; k++) { const o = keep(this.obj(this.geo.chip, { tint: [...col.map(v => v * 0.8 + 0.1), 1], emi: col.map(v => v * 0.15) })); M4.compose(o.m, Math.cos(sa) * 11.25, 0.02 + k * 0.13, Math.sin(sa) * 11.25, 0, k * 0.2); stack.push(o); }
    const pkGlow = keep(this.spr({ mode: 2, color: [...col, 0.7], size: [2.2, 2.2], add: true, glow: 1.2 })); pkGlow.m = M4.ident();
    const pkShadow = keep(this.spr({ mode: 2, color: [0, 0, 0, 0.5], size: [1.3, 1.3], glow: 0 })); pkShadow.m = M4.ident();
    // name label
    const label = keep(this.spr({ tex: this._label(pl.name, colHex, this.sym[i], pl.bot), size: [5.2, 1.3], color: [1, 1, 1, 1], depthTest: false, ownTex: true }));
    label.pos = [x, 5.1, z];
    // dice cup: sits on the table in front of the player while it is their turn
    const ca = a - (isMe ? 0.24 : 0.25), cr = isMe ? 12.1 : 12.0;
    const cup = keep(this.obj(this.geo.cup, { tint: [0.42, 0.25, 0.13, 1], emi: [0.02, 0.01, 0] }));
    const cupBand = keep(this.obj(this.geo.cupBand, { tint: [...col.map(v => v * 0.7 + 0.2), 1], emi: col.map(v => v * 0.35) }));
    cup.visible = cupBand.visible = false;
    const cupSt = { st: 'off', x: Math.cos(ca) * cr, z: Math.sin(ca) * cr, k: 0, y: 0, t: 0, lift: 0 };
    if (isMe) { for (const o of [ob, glowOb, eyeOb, armOb, halo]) o.visible = false; shadow.visible = false; label.pos = [Math.cos(a) * 13.9, 0.4, Math.sin(a) * 13.9]; label.size = [4.2, 1.05]; }
    label.size = label.size.map(v => v * this.labelScale);
    return { i, a, x, z, face, col, colHex, stack, reserve: 6, body: ob, glow: glowOb, eyes: eyeOb, arms: armOb, halo, pk, pkGlow, pkShadow, label, cup, cupBand, cupSt, pos: 0, shown: 0, vis: true, status: 'idle', bob: Math.random() * 6, mood: null, moodT: 0, scale: 1, R: {} };
  }

  // cosmetic avatar: cloak + hood + glowing trim, laptop, arms, and one of 8 accessory styles
  _avatarGeo(style, col) {
    const dark = col.map(v => v * 0.3 + 0.05), mid = col.map(v => v * 0.5 + 0.07), ink = [0.012, 0.016, 0.02];
    const body = new Geo(), glow = new Geo(), eyes = new Geo(), arms = new Geo();
    const C = (x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx) => M4.compose(M4.ident(), x, y, z, rx, ry, rz, sx, sy, sz);
    body.add(Geo.lathe([[1.35, -3.1], [1.42, -1.8], [1.18, -0.45], [1.34, 0.25], [1.05, 0.72], [0.55, 0.96], [0, 1.0]], 30), null, dark);
    body.add(Geo.lathe([[0.95, 0.5], [1.08, 1.05], [1.03, 1.7], [0.83, 2.2], [0.46, 2.52], [0, 2.6]], 30), null, mid);
    body.add(Geo.sphere(0.66, 22, 12), C(0, 1.45, 0.5, 0, 0, 0, 1, 1, 0.62), ink);
    glow.add(Geo.torus(0.68, 0.05, 36, 6), C(0, 1.45, 0.82, Math.PI / 2, 0, 0, 1, 1.05, 1), col, 1);
    // chest emblem
    glow.add(Geo.box(0.22, 0.22, 0.05), C(0, 0.1, 1.33, 0, 0, Math.PI / 4), col, 1);
    // laptop: screen light faces the hacker, the lid's back (with a glowing mark) faces the table
    body.add(Geo.box(1.8, 0.09, 1.05), C(0, 0.12, 1.85), [0.07, 0.08, 0.09]);
    body.add(Geo.box(1.8, 1.1, 0.07), C(0, 0.68, 2.36, -0.22), [0.09, 0.1, 0.11]);
    glow.add(Geo.box(1.6, 0.92, 0.02), C(0, 0.68, 2.31, -0.22), col.map(v => v * 0.35 + 0.45), 0.9);
    glow.add(Geo.box(0.32, 0.32, 0.03), C(0, 0.7, 2.41, -0.22, 0, Math.PI / 4), col, 1);
    // arms (separate so they can type / point)
    for (const sx of [-1, 1]) {
      arms.add(Geo.lathe([[0.001, -0.85], [0.2, -0.78], [0.25, 0], [0.22, 0.6], [0.001, 0.72]], 12), C(sx * 0.98, -0.12, 0.85, 1.2, 0, sx * -0.12), dark);
      arms.add(Geo.sphere(0.2, 10, 6), C(sx * 0.85, -0.42, 1.55), mid);
    }
    // eyes
    const E = (gm, m) => eyes.add(gm, m, [1, 1, 1], 1);
    const dot = Geo.sphere(0.1, 10, 6), bar = Geo.box(0.3, 0.08, 0.05);
    switch (style % 8) {
      case 0: E(dot, C(-0.24, 1.5, 0.98)); E(dot, C(0.24, 1.5, 0.98)); break;
      case 1: E(Geo.box(0.95, 0.12, 0.05), C(0, 1.5, 0.98)); break;
      case 2: E(bar, C(-0.25, 1.52, 0.98, 0, 0, 0.35)); E(bar, C(0.25, 1.52, 0.98, 0, 0, -0.35)); break;
      case 3: E(Geo.sphere(0.17, 14, 8), C(0, 1.5, 0.98)); break;
      case 4: E(Geo.box(0.17, 0.17, 0.05), C(-0.24, 1.5, 0.98)); E(Geo.box(0.17, 0.17, 0.05), C(0.24, 1.5, 0.98)); break;
      case 5: E(dot, C(-0.3, 1.54, 0.97)); E(dot, C(0, 1.42, 0.99)); E(dot, C(0.3, 1.54, 0.97)); break;
      case 6: E(bar, C(-0.24, 1.5, 0.98, 0, 0, -0.35)); E(bar, C(0.24, 1.5, 0.98, 0, 0, 0.35)); break;
      case 7: E(Geo.box(0.3, 0.06, 0.05), C(-0.22, 1.47, 0.98)); E(Geo.box(0.3, 0.06, 0.05), C(0.22, 1.47, 0.98)); break;
    }
    // accessory
    const cone = Geo.lathe([[0.3, 0], [0.001, 0.6]], 14);
    switch (style % 8) {
      case 1: for (const sx of [-1, 1]) body.add(Geo.box(0.7, 0.28, 0.9), C(sx * 1.05, 0.62, 0.1, 0, 0, sx * -0.25), mid); glow.add(Geo.box(1.0, 0.05, 0.05), C(0, 1.68, 0.92), col, 1); break;
      case 2: for (const sx of [-1, 1]) { body.add(cone, C(sx * 0.48, 2.25, 0.05, 0, 0, sx * -0.38, 1, 1, 0.7), mid); glow.add(Geo.lathe([[0.16, 0], [0.001, 0.36]], 10), C(sx * 0.5, 2.3, 0.14, 0, 0, sx * -0.38, 1, 1, 0.4), col, 0.9); } break;
      case 3: body.add(Geo.lathe([[0.04, 0], [0.04, 1.1]], 8), C(0.32, 2.4, -0.05, 0, 0, -0.2), [0.3, 0.32, 0.34]); glow.add(Geo.sphere(0.16, 12, 8), C(0.54, 3.48, -0.05), col, 1); break;
      case 4: body.add(Geo.torus(1.02, 0.08, 36, 6), C(0, 1.55, -0.05, Math.PI / 2, 0, 0, 1, 1, 1), [0.12, 0.13, 0.15]);
        for (const sx of [-1, 1]) { body.add(Geo.lathe([[0.32, -0.18], [0.32, 0.18]], 16), C(sx * 1.02, 1.5, 0.05, 0, 0, Math.PI / 2), [0.1, 0.11, 0.13]); glow.add(Geo.torus(0.27, 0.05, 20, 5), C(sx * 1.21, 1.5, 0.05, 0, 0, Math.PI / 2), col, 1); } break;
      case 5: for (const sx of [-1, 1]) body.add(Geo.lathe([[0.22, 0], [0.12, 0.45], [0.001, 0.85]], 12), C(sx * 0.6, 2.15, 0.15, 0.25, 0, sx * -0.65), [0.9, 0.86, 0.78]); break;
      case 6: for (let k = 0; k < 3; k++) { body.add(Geo.box(0.08, 0.5 - k * 0.08, 0.5), C(0, 2.6 - k * 0.1, 0.25 - k * 0.42, -0.2 - k * 0.15), mid); glow.add(Geo.box(0.09, 0.08, 0.5), C(0, 2.86 - k * 0.14, 0.25 - k * 0.42, -0.2 - k * 0.15), col, 1); } break;
      case 7: glow.add(Geo.octa(0.42), C(0, 1.6, 0.95, 0, 0, 0, 1.5, 0.45, 0.22), col.map(v => v * 0.6 + 0.2), 0.8); break;
    }
    return { body, glow, eyes, arms };
  }

  _label(text, color, sym, bot) {
    const c = cvs(512, 128), g = c.getContext('2d');
    g.font = `52px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'middle';
    const tw = Math.min(360, g.measureText(text).width), extra = bot ? 70 : 0, w = Math.min(500, tw + 110 + extra), x0 = 256 - w / 2;
    g.fillStyle = 'rgba(4,10,8,.85)'; g.beginPath(); g.roundRect(x0, 20, w, 88, 14); g.fill();
    g.strokeStyle = color; g.lineWidth = 5; g.stroke();
    g.fillStyle = color; drawSym(g, sym, x0 + 40, 64, 18); g.fill();
    g.fillStyle = '#f1f6ee'; g.fillText(text, x0 + 72, 66, 360);
    if (bot) { g.font = `26px ${FONT}`; g.fillStyle = 'rgba(200,220,210,.7)'; g.fillText('CPU', x0 + 82 + tw, 68); }
    return this.r.texture(c);
  }

  _pcb(players) {
    const S = 2048, c = cvs(S, S), g = c.getContext('2d'), C = S / 2, n = players.length;
    const rg = g.createRadialGradient(C, C * 0.9, 60, C, C, C);
    rg.addColorStop(0, '#0b4a35'); rg.addColorStop(0.65, '#083726'); rg.addColorStop(1, '#05261b');
    g.fillStyle = rg; g.fillRect(0, 0, S, S);
    // dotted grid
    g.fillStyle = 'rgba(80,190,140,.10)';
    for (let y = 0; y < S; y += 24) for (let x = 0; x < S; x += 24) g.fillRect(x, y, 2, 2);
    // traces
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let k = 0; k < 140; k++) {
      let x = rnd() * S, y = rnd() * S; if (Math.hypot(x - C, y - C) > C * 0.96 || Math.hypot(x - C, y - C) < 240) continue;
      g.strokeStyle = rnd() < 0.2 ? 'rgba(230,180,90,.55)' : 'rgba(60,170,120,.45)'; g.lineWidth = rnd() < 0.3 ? 6 : 3;
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < 3; s++) { const d = [[1, 0], [0, 1], [1, 1], [1, -1], [-1, 0], [0, -1]][Math.floor(rnd() * 6)]; const L = 40 + rnd() * 160; x += d[0] * L; y += d[1] * L; g.lineTo(x, y); }
      g.stroke(); g.beginPath(); g.arc(x, y, 7, 0, 7); g.fillStyle = '#05261b'; g.fill(); g.strokeStyle = 'rgba(230,180,90,.7)'; g.lineWidth = 4; g.stroke();
    }
    const W = (r) => r / 13 * C; // world radius → px
    // seat sectors
    for (let i = 0; i < n; i++) {
      const a = this.ang(i), span = Math.PI * 2 / n;
      g.strokeStyle = this.pal[i]; g.globalAlpha = 0.5; g.lineWidth = 14;
      g.beginPath(); g.arc(C, C, W(12.2), a - span / 2 + 0.06, a + span / 2 - 0.06); g.stroke();
      g.globalAlpha = 0.08; g.fillStyle = this.pal[i];
      g.beginPath(); g.moveTo(C, C); g.arc(C, C, W(12.6), a - span / 2 + 0.02, a + span / 2 - 0.02); g.closePath(); g.fill();
      g.globalAlpha = 1;
      // node silkscreen labels
      g.fillStyle = 'rgba(230,240,230,.55)'; g.font = `26px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      for (let p = 1; p <= 8; p++) {
        const r = R_START - p * STEP, ox = Math.cos(a - Math.PI / 2) * 0.75, oz = Math.sin(a - Math.PI / 2) * 0.75;
        g.fillText('N' + p, C + W(Math.cos(a) * r + ox), C + W(Math.sin(a) * r + oz));
      }
    }
    // rim silkscreen ring
    g.save(); g.translate(C, C); g.fillStyle = 'rgba(235,240,230,.6)'; g.font = `30px ${FONT}`;
    const txt = '  GHOST//PACKET  ·  TARGET NETWORK  ·  REV 1.5  ·  SELF-DECLARED TRANSFER PROTOCOL  ·  AUDIT AT YOUR OWN RISK  ·';
    const chars = [...txt]; const step = (Math.PI * 2) / chars.length;
    chars.forEach((ch, k) => { g.save(); g.rotate(k * step); g.translate(0, -W(12.75)); g.fillText(ch, 0, 0); g.restore(); });
    g.restore();
    // central keep-out
    g.strokeStyle = 'rgba(230,180,90,.6)'; g.lineWidth = 4; g.setLineDash([16, 12]); g.beginPath(); g.arc(C, C, W(4.6), 0, 7); g.stroke(); g.setLineDash([]);
    // printed-on-paper feel: fibre grain + a little ink unevenness + printer's corner marks
    const im = g.getImageData(0, 0, S, S), d = im.data;
    for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 18; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
    g.putImageData(im, 0, 0);
    g.globalAlpha = 0.06; g.fillStyle = '#fff3d6'; for (let k = 0; k < 900; k++) g.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 40, 1);
    g.globalAlpha = 1;
    return c;
  }

  _drawChip(flash) {
    const c = this.chipC, g = c.getContext('2d');
    g.clearRect(0, 0, 512, 512);
    g.fillStyle = '#060908'; g.fillRect(0, 0, 512, 512);
    g.strokeStyle = 'rgba(217,173,85,.55)'; g.lineWidth = 6; g.strokeRect(14, 14, 484, 484);
    g.fillStyle = 'rgba(160,190,175,.75)'; g.font = `30px ${FONT}`; g.textAlign = 'center'; g.fillText('TARGET SERVER', 256, 120);
    g.fillStyle = flash ? '#ffe9a8' : '#e8f4ea'; g.font = `150px ${FONT}`; g.fillText(`${this.goalsText[0]}`, 256, 300);
    g.fillStyle = 'rgba(160,190,175,.75)'; g.font = `34px ${FONT}`; g.fillText(`/ ${this.goalsText[1]} GOALS`, 256, 390);
    g.beginPath(); g.arc(60, 60, 12, 0, 7); g.fillStyle = '#d9ad55'; g.fill();
    this.r.updateTexture(this.chipTex, c);
  }

  // ───── state setters ─────
  setGoals(k, max, flash) { this.goalsText = [k, max]; this._drawChip(flash); }
  setPacket(i, pos, jump) {
    const S = this.seats[i]; if (!S) return;
    if (pos == null) { S.vis = false; S.pos = S.shown; return; }
    if (jump || !S.vis) { S.shown = pos; S.vis = true; S.pos = pos; S.scale = 0.01; this.anim(0.35, (t) => { S.scale = ease(t); }); return; }
    S.pos = pos;
  }
  // declare preview: light up the n nodes the packet would travel (n = null clears)
  preview(i, n) {
    if (!n) { this.pv = null; if (this.pvMark) this.pvMark.color[3] = 0; return; }
    if (!this.pvMark || !this.scene.sprites.includes(this.pvMark)) this.pvMark = this.spr({ mode: 2, color: [1, 0.85, 0.35, 0], size: [2.2, 2.2], add: true, glow: 1.4, depthTest: false });
    this.pv = { i, n };
  }
  setStatus(i, st) { const S = this.seats[i]; if (S) S.status = st; }
  // dice cup: 'off' | 'wait' (upright, waiting to be shaken) | 'shake' | 'down' (slammed, roll hidden) | 'lift' (revealed)
  setCup(i, st, quiet) {
    const S = this.seats[i]; if (!S || !S.cupSt) return; const C = S.cupSt; if (C.st === st) return;
    const prev = C.st; C.st = st; C.t = 0;
    if (st === 'down' && prev === 'shake' && !quiet) C.slam = 0.0001;   // drop animation + dust on contact
  }
  setReserve(i, n) { const S = this.seats[i]; if (S) S.reserve = n; }
  // 'pc' | 'land' | 'port' — lighter effects and bigger labels on phones
  setProfile(p) {
    this.profile = p; this.fxScale = p === 'pc' ? 1 : 0.6; this.labelScale = p === 'port' ? 1.45 : p === 'land' ? 1.15 : 1;
    if (p !== 'pc') { this.yaw = 0; this.zoom = 1; this.pan = [0, 0]; }
    for (const S of this.seats) { const b = S.i === this.me ? [4.2, 1.05] : [5.2, 1.3]; S.label.size = [b[0] * this.labelScale, b[1] * this.labelScale]; }
  }
  // PC: drag to turn the table, wheel to zoom, double-click to reset
  orbit(dx) { this.yaw = Math.max(-1.2, Math.min(1.2, this.yaw + dx)); }
  zoomBy(k) { const max = this.profile === 'pc' ? 1.6 : 2.6; this.zoom = Math.max(0.7, Math.min(max, this.zoom * k)); if (this.zoom <= 1.02) this.pan = this.pan.map(v => v * 0.85); }
  // phones: drag (screen px) slides the view across the table while zoomed in
  panBy(dx, dy) {
    if (!this._camE || !this._tgtP) return;
    const e = this._camE, t = this._tgtP, dist = Math.hypot(e[0] - t[0], e[1] - t[1], e[2] - t[2]);
    const k = 2 * dist * Math.tan(this.cam.fov / 2) / Math.max(1, this.canvas.clientHeight);
    const fx = t[0] - e[0], fz = t[2] - e[2], fl = Math.hypot(fx, fz) || 1, f = [fx / fl, fz / fl], r = [-f[1], f[0]];
    const pitch = Math.max(0.35, Math.abs(Math.atan2(e[1] - t[1], Math.hypot(fx, fz))));
    const wx = -dx * k, wz = dy * k / Math.sin(pitch);
    let px = this.pan[0] + r[0] * wx + f[0] * wz, pz = this.pan[1] + r[1] * wx + f[1] * wz;
    const lim = 9 * Math.min(1, (this.zoom - 0.95) / 0.8 + 0.2), l = Math.hypot(px, pz); if (l > lim) { px *= lim / l; pz *= lim / l; }
    this.pan = [px, pz];
  }
  resetView() { this.yaw = 0; this.zoom = 1; this.pan = [0, 0]; }
  setTimer(frac, urgent, on) { this.timerFrac = frac; this.timerUrgent = urgent; this.timerOn = on; }
  _cupFrame(S, t, dt) {
    const C = S.cupSt; C.t += dt;
    const on = C.st !== 'off'; C.k += ((on ? 1 : 0) - C.k) * Math.min(1, dt * 9);
    const vis = C.k > 0.02; S.cup.visible = S.cupBand.visible = vis; if (!vis) return;
    let y = 0, rx = 0, rz = 0, ry = t * 0.2, ox = 0, oz = 0, sq = 1;
    if (C.st === 'wait') { y = Math.max(0, Math.sin(t * 3.2)) * 0.12; rz = Math.sin(t * 3.2) * 0.04; }
    if (C.st === 'shake') {
      const e = Math.min(1, C.t * 4); y = (2.2 + Math.sin(t * 29) * 0.3) * e;
      rx = Math.sin(t * 37) * 0.32 * e; rz = Math.cos(t * 31) * 0.32 * e; ox = Math.sin(t * 23) * 0.18 * e; oz = Math.cos(t * 27) * 0.18 * e;
      if (Math.random() < dt * 14) this.scene.particles.emit({ p: [C.x + ox, 0.3 + y * 0.5, C.z + oz], v: [(Math.random() - 0.5) * 2, 1.5, (Math.random() - 0.5) * 2], c: [1, 0.9, 0.7, 0.25], s: 0.08, life: 0.4, g: -3, drag: 1, fade: 1 });
    }
    if (C.st === 'down') {
      if (C.slam) { // falls from the shaking height, squashes, kicks up dust
        C.slam += dt; const f = Math.min(1, C.slam / 0.12); y = 2.2 * (1 - f * f);
        if (f >= 1) { C.slam = 0; this.shake(0.28); this.burst([C.x, 0.12, C.z], { n: 26, colors: ['#e8d6b0', '#ffffff', S.colHex], speed: 4, size: 0.18, life: 0.5, g: -2, spread: 1.2 }); this.shockwave([C.x, 0.02, C.z], S.colHex, 3.2, 0.45); C.squash = 0.0001; }
      }
      if (C.squash) { C.squash += dt; const p = Math.min(1, C.squash / 0.3); sq = 1 - Math.sin(p * Math.PI) * 0.16 * (1 - p); if (p >= 1) C.squash = 0; }
    }
    if (C.st === 'lift') { const e = Math.min(1, C.t / 0.5), k = 1 - Math.pow(1 - e, 3); y = k * 1.6; rz = k * 1.1; ox = k * 0.6; }
    const s = C.k * 1.45;
    const M = M4.compose(S.cup.m, C.x + ox, y, C.z + oz, rx, ry, rz, s, s * sq, s);
    M4.compose(S.cupBand.m, 0, 0.3, 0); S.cupBand.m = M4.mul(M, S.cupBand.m);
  }
  setMood(i, mood, sec = 2.5) { const S = this.seats[i]; if (S) { S.mood = mood; S.moodT = sec; } }

  // body language: pass = nod, doubt = lean in & point, cat = slump, mis = head shake, goal = jump & spin, win = celebrate, hop = small bounce
  react(i, kind) { const S = this.seats[i]; if (!S) return; const dur = { pass: 0.7, doubt: 1.8, cat: 2.8, mis: 1.3, goal: 1.1, win: 9, hop: 0.45 }[kind] || 1; S.R[kind] = { t: 0, dur }; }
  setNext(i) { this.nextSeat = i; }
  setTurn(i) { this.turnSeat = i; }
  setCalm(on) { this.calm = on; }
  // attract mode for the title / lobby screens: packets wander, the camera drifts
  setDemo(on) { this.demo.on = on; this.demo.next = this.t + 0.8; if (!on) this.autoYaw = 0; }
  resetCam() { this.camGoal = null; }
  focus(i, dur = 2.2) {
    const S = this.seats[i]; if (!S) return;
    const tx = Math.cos(S.a) * 8, tz = Math.sin(S.a) * 8;
    this.camGoal = { target: [tx * 0.8, 0.6, tz * 0.8], k: 0.32, until: this.t + dur };
  }
  shake(a) { if (!this.calm) this.shakeAmt = Math.max(this.shakeAmt, a); }
  flash(hexc, a = 0.5) { const c = hex(hexc); this.flashC = [...c, this.calm ? a * 0.3 : a]; }

  // ───── effects ─────
  _textTex(text, o = {}) {
    if (o.cache) { const k = JSON.stringify([text, o.size, o.grad, o.color, o.w, o.h]); let t = this.texCache.get(k); if (!t) { t = this._textTexRaw(text, o); this.texCache.set(k, t); } return t; }
    return this._textTexRaw(text, o);
  }
  _textTexRaw(text, o) {
    const W = o.w || 512, H = o.h || 256, c = cvs(W, H), g = c.getContext('2d');
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `${o.size || 180}px ${FONT}`;
    if (o.grad) { const gr = g.createLinearGradient(0, H * 0.2, 0, H * 0.8); o.grad.forEach((s, k) => gr.addColorStop(k / (o.grad.length - 1), s)); g.fillStyle = gr; } else g.fillStyle = o.color || '#fff';
    g.lineWidth = o.stroke || 14; g.strokeStyle = o.strokeColor || '#07110d'; g.strokeText(text, W / 2, H / 2 + 6, W - 20); g.fillText(text, W / 2, H / 2 + 6, W - 20);
    return this.r.texture(c);
  }
  burst(p, o = {}) {
    const P = this.scene.particles, n = Math.max(6, Math.round((o.n || 60) * this.fxScale * (this.calm ? 0.45 : 1))), col = o.colors || ['#ffffff'];
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2, el = (o.up ? 0.5 : -0.2) + Math.random() * (o.up ? 1.0 : 1.2), sp = (o.speed || 8) * (0.4 + Math.random() * 0.8);
      const c = hex(col[k % col.length]);
      P.emit({ p: [p[0] + (Math.random() - 0.5) * (o.spread || 0.3), p[1], p[2] + (Math.random() - 0.5) * (o.spread || 0.3)], v: [Math.cos(a) * Math.cos(el) * sp, Math.sin(el) * sp, Math.sin(a) * Math.cos(el) * sp], c: [...c, o.alpha || 1], s: (o.size || 0.35) * (0.6 + Math.random() * 0.8), life: (o.life || 1.4) * (0.6 + Math.random() * 0.7), g: o.g == null ? -9 : o.g, drag: o.drag || 0.9, shape: o.shape == null ? (Math.random() < 0.3 ? 2 : 0) : o.shape });
    }
  }
  shockwave(p, colr, size = 9, dur = 0.7) {
    const s = this.spr({ mode: 1, color: [...hex(colr), 1], size: [1, 1], add: true, glow: 1.5, param: 0.1 });
    s.m = M4.ident(); s.pos = p;
    this.anim(dur, (t) => { const k = 0.5 + ease(t) * size; M4.compose(s.m, p[0], p[1] + 0.05, p[2], -Math.PI / 2, 0, 0, 1, 1, 1); s.size = [k, k]; s.color[3] = 1 - t; }, () => this.rm(s));
  }
  floatText(text, p, o = {}) {
    o = Object.assign({ cache: true }, o);
    const tex = this._textTex(text, o);
    const s = this.spr({ tex, pos: [...p], size: [o.wW || 6, (o.wW || 6) / 2], color: [1, 1, 1, 1], depthTest: false, glow: o.glow == null ? 0.6 : o.glow, ownTex: !o.cache });
    const dur = o.dur || 1.8;
    this.anim(dur, (t) => {
      const pop = t < 0.15 ? ease(t / 0.15) * 1.25 : 1.25 - Math.min(0.25, (t - 0.15) * 1.2);
      const w = (o.wW || 6) * pop; s.size = [w, w / 2]; s.pos[1] = p[1] + t * (o.rise == null ? 1.6 : o.rise); s.color[3] = t > 0.75 ? 1 - (t - 0.75) / 0.25 : 1;
    }, () => this.rm(s));
    return s;
  }
  pktWorld(i) { const S = this.seats[i]; const [x, , z] = this.nodePos(i, Math.min(S.shown, 9)); return [x, 0.9, z]; }
  headWorld(i) { const S = this.seats[i]; return i === this.me ? [Math.cos(S.a) * 12.5, 1.5, Math.sin(S.a) * 12.5] : [S.x, 4.2, S.z]; }

  fxDeclare(i, v) {
    const colors = { 1: '#cfd8dc', 2: '#7fe3ff', 3: '#ffd34d', 4: '#ff4fd8' };
    const p = [0, 3.6, 0];
    const tex = this._textTex(String(v), { cache: true, size: 230, grad: v === 4 ? ['#fff3a0', '#ff6ad5', '#6ad6ff'] : ['#ffffff', colors[v]] });
    if (this.claim) this.rm(this.claim);
    const s = this.claim = this.spr({ tex, pos: p, size: [7, 3.5], color: [1, 1, 1, 1], glow: 0.55, depthTest: false });
    this.anim(0.45, (t) => { const k = t < 0.6 ? 2.6 - ease(t / 0.6) * 1.6 : 1 + Math.sin((t - 0.6) * 25) * 0.06 * (1 - t); s.size = [7 * k, 3.5 * k]; s.pos[1] = 3.6 + (1 - ease(t)) * 3; });
    this.shake(0.35 + v * 0.1); this.shockwave([0, 0.95, 0], colors[v], 10 + v * 3);
    this.burst([0, 1.2, 0], { n: 40 + v * 25, colors: [colors[v], '#ffffff'], speed: 9, up: true, size: 0.3 });
    this.flash(colors[v], 0.12 + v * 0.05);
  }
  clearClaim() { if (this.claim) { const s = this.claim; this.claim = null; this.anim(0.3, (t) => { s.color[3] = 1 - t; }, () => this.rm(s)); } }
  fxDoubt(ch) {
    const p = this.headWorld(ch);
    this.setMood(ch, 'doubt', 3); this.react(ch, 'doubt'); this.shake(1.1); this.flash('#ff2a3a', 0.55);
    this.burst(p, { n: 120, colors: ['#ff3344', '#ffaa00', '#ffffff'], speed: 12, size: 0.4 });
    this.shockwave([p[0], 0.2, p[2]], '#ff3344', 14, 0.8);
    this.focus(ch, 1.4);
  }
  // who audits whom: a stream of red tracers from the challenger to the target packet, plus a lock-on reticle
  fxTarget(ch, sd) {
    this.clearTarget();
    const a = this.headWorld(ch), dur = 2.6;
    const ret = this.spr({ mode: 1, color: [1, 0.2, 0.3, 1], size: [3, 3], add: true, glow: 1.6, param: 0.12, depthTest: false }); ret.m = M4.ident();
    const tag = this.spr({ tex: this._textTex('TARGET', { cache: true, size: 110, grad: ['#ffd0d6', '#ff2f5b'], w: 512, h: 160 }), size: [3.6, 1.12], color: [1, 1, 1, 1], depthTest: false, glow: 0.5 });
    this.target = { ret, tag, sd };
    this.anim(dur, (t, dt) => {
      const b = this.pktWorld(sd), P = this.scene.particles;
      const k = 1.6 + Math.sin(this.t * 10) * 0.25 + (1 - Math.min(1, t * 4)) * 3;
      M4.compose(ret.m, b[0], 0.12, b[2], -Math.PI / 2, this.t * 2, 0); ret.size = [k, k];
      tag.pos = [b[0], 3.1 + Math.sin(this.t * 6) * 0.1, b[2]];
      if (t < 0.8) for (let j = 0; j < (this.calm ? 2 : 6); j++) {
        const u = Math.random(), p = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u + Math.sin(u * Math.PI) * 1.5, a[2] + (b[2] - a[2]) * u];
        P.emit({ p, v: [(b[0] - a[0]) * 0.6, (b[1] - a[1]) * 0.6, (b[2] - a[2]) * 0.6], c: [1, 0.25 + Math.random() * 0.3, 0.3, 1], s: 0.28, life: 0.35, g: 0, drag: 0, shape: 2 });
      }
    });
  }
  clearTarget() { if (this.target) { this.rm(this.target.ret); this.rm(this.target.tag); this.target = null; } }
  // winner / loser tags over the two people involved in an audit
  fxDuelResult(win, lose) {
    this.clearTarget();
    const w = this.headWorld(win), l = this.headWorld(lose);
    this.floatText('WIN', [w[0], w[1] + 1.2, w[2]], { size: 160, grad: ['#fffbe0', '#ffcf4a'], wW: 4.6, dur: 2.6, rise: 1.2, glow: 1 });
    this.floatText('LOSE', [l[0], l[1] + 1.2, l[2]], { size: 150, grad: ['#ffd0d6', '#ff2f5b'], wW: 4.2, dur: 2.6, rise: 0.6, glow: 0.8 });
    this.burst([w[0], w[1], w[2]], { n: 80, colors: ['#ffcf4a', '#ffffff', this.pal[win] || '#fff'], speed: 9, up: true, size: 0.35, g: -6 });
    this.react(win, 'goal');
  }
  scanPacket(i, sec) { const S = this.seats[i]; if (S) S.scanT = sec; }
  fxReveal(i, v, roll, truth, dur = 1.25) {
    // card flip above the sender's packet
    const base = this.pktWorld(i); const p = [base[0] * 0.55, 4.2, base[2] * 0.55];
    const back = this._textTex('?', { cache: true, size: 200, grad: ['#ffffff', '#9aa'], w: 256, h: 256 });
    const face = this._textTex(roll === 'X' ? '×' : String(roll), { cache: true, size: 210, grad: truth ? ['#ffffff', '#6dffb0'] : ['#ffe0e0', '#ff3355'], w: 256, h: 256 });
    const card = this.spr({ tex: back, pos: p, size: [3.4, 3.4], color: [1, 1, 1, 1], depthTest: false, glow: 0.5 });
    const frame = this.spr({ mode: 2, pos: p, size: [7, 7], color: [1, 1, 1, 0], add: true, glow: 1.2, depthTest: false });
    this.focus(i, dur + 1.4);
    this.anim(dur, (t) => {
      // spins fast, slows to a crawl, nearly stops edge-on, then snaps over
      const spin = Math.min(1, t / 0.85), ang = (1 - Math.pow(1 - spin, 2.2)) * Math.PI * 9 + (spin > 0.82 && spin < 0.97 ? Math.sin((spin - 0.82) / 0.15 * Math.PI) * 0.35 : 0);
      const c = Math.cos(ang); card.size = [3.4 * Math.max(0.05, Math.abs(c)) * (1 + (1 - spin) * 0.3), 3.4];
      if (spin >= 1) card.tex = face; else card.tex = c >= 0 ? back : back;
      if (spin >= 1) { const k = 1 + Math.sin((t - 0.85) / 0.4 * Math.PI) * 0.35; card.size = [3.4 * k, 3.4 * k]; frame.color[3] = Math.min(1, (t - 0.85) * 4); }
    }, () => {
      this.shake(truth ? 0.6 : 1.0); this.flash('#ffffff', 0.3);
      this.floatText(truth ? `申告${v}と一致` : `申告${v}と不一致`, [p[0], p[1] - 2.4, p[2]], { size: 110, w: 768, grad: truth ? ['#ffffff', '#9dffcf'] : ['#ffffff', '#ff9aa8'], wW: 4.6, dur: 2.2, rise: 0, glow: 0.6 });
      this.burst(p, { n: 160, colors: truth ? ['#6dffb0', '#ffffff', '#ffd34d'] : ['#ff3355', '#ff9a3c', '#ffffff'], speed: 13, size: 0.42 });
      this.anim(1.8, (t) => { card.color[3] = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1; frame.color[3] = 1 - t; }, () => { this.rm(card); this.rm(frame); });
    });
  }
  fxCat(i) {
    const p = this.pktWorld(i);
    const c = cvs(320, 240), tex = this.r.texture(c);
    const s = this.spr({ tex, pos: [...p], size: [4.4, 3.3], color: [1, 1, 1, 1], depthTest: false, glow: 0.35, ownTex: true });
    this.burst(p, { n: 90, colors: ['#ffb86b', '#ffffff', '#ff8fd0'], speed: 7, size: 0.35, up: true });
    this.setMood(i, 'cat', 3.2); this.react(i, 'cat');
    let fr = 0, acc = 0;
    this.anim(3.0, (t, dt) => {
      acc += dt; if (acc > 0.09) { acc = 0; fr++; drawCat(c, fr); this.r.updateTexture(tex, c); }
      s.pos[1] = p[1] + ease(t) * 5; s.roll = Math.sin(t * 9) * 0.15 * (1 - t);
      const k = t < 0.12 ? ease(t / 0.12) : 1; s.size = [4.4 * k, 3.3 * k]; s.color[3] = t > 0.78 ? 1 - (t - 0.78) / 0.22 : 1;
    }, () => this.rm(s));
    drawCat(c, 0); this.r.updateTexture(tex, c);
  }
  fxConfiscate(i) {
    const p = this.pktWorld(i); this.react(i, 'mis');
    this.burst(p, { n: 70, colors: ['#ff3344', '#552222', '#ffffff'], speed: 8, size: 0.3, shape: 2 });
    this.floatText('没収', p, { size: 170, grad: ['#ffd0d0', '#ff2a3a'], wW: 4.4, glow: 0.8 });
    this.shake(0.5);
  }
  fxGoal(i, rank) {
    const S = this.seats[i], col = this.pal[i];
    this.react(i, 'goal');
    const beam = this.spr({ mode: 3, pos: [0, 0.9, 0], size: [3.6, 26], color: [...hex(col), 1], add: true, glow: 2 });
    beam.m = M4.ident();
    this.anim(2.4, (t) => { M4.compose(beam.m, 0, 0.9 + 13, 0, 0, Math.atan2(this.cam.eye[0], this.cam.eye[2]), 0); beam.size = [3.6 * (1 - t * 0.5) * (t < 0.1 ? t * 10 : 1), 26]; beam.color[3] = 1 - t; }, () => this.rm(beam));
    // coin fountain
    for (let k = 0; k < 6; k++) setTimeout(() => this.burst([0, 1.3, 0], { n: 45, colors: ['#ffd34d', '#ffb02e', '#fff2b0'], speed: 11, up: true, shape: 1, size: 0.55, life: 2.2, g: -14 }), k * 110);
    this.burst([0, 1.5, 0], { n: 120, colors: [col, '#ffffff'], speed: 15, up: true, size: 0.35 });
    this.shockwave([0, 0.95, 0], col, 22, 1.1);
    this.flash('#ffd34d', 0.5); this.shake(0.9);
    this.floatText(`+${rank}`, [0, 5.4, 0], { size: 200, grad: ['#fff8c0', '#ffb02e'], wW: 7.5, dur: 2.2, rise: 2.4, glow: 0.9 });
    this.setGoals(this.goalsText[0] + 1, this.goalsText[1], true); setTimeout(() => this._drawChip(false), 900);
  }
  fxApprove(i, v, streak) {
    const p = this.pktWorld(i);
    this.burst([p[0], 0.8, p[2]], { n: 50, colors: ['#5dffb0', '#ffffff'], speed: 6, up: true, size: 0.3 });
    this.floatText(`+${v}`, [p[0], 2.6, p[2]], { size: 190, grad: ['#ffffff', '#5dffb0'], wW: 4, glow: 0.7 });
    if (streak >= 2) this.floatText(`${streak}連続通過`, [p[0], 4.3, p[2]], { size: 120, grad: ['#fff6b0', '#ff9a3c'], wW: 6, w: 768, glow: 0.8, dur: 2.0 });
  }
  fxWin(i) {
    const col = (this.pal && this.pal[i]) || '#ffd34d'; this.react(i, 'win');
    for (let k = 0; k < 14; k++) setTimeout(() => {
      const p = [(Math.random() - 0.5) * 22, 4 + Math.random() * 6, (Math.random() - 0.5) * 18];
      this.burst(p, { n: 110, colors: [col, '#ffd34d', '#ffffff', this.pal[k % this.pal.length]], speed: 10, size: 0.38, g: -3, drag: 1.4, life: 2 });
      this.flash(this.pal[k % this.pal.length], 0.15);
    }, k * 260);
    this.shake(1.2);
  }
  stepFx(i) { if (this.demo.on) return; const p = this.pktWorld(i); this.burst([p[0], 0.4, p[2]], { n: 10, colors: [this.pal[i], '#ffffff'], speed: 3, up: true, size: 0.22, life: 0.6 }); }

  _demoStep() {
    const i = Math.floor(Math.random() * this.seats.length), S = this.seats[i];
    this.demo.next = this.t + 0.9 + Math.random() * 1.3;
    if (!S.vis) { this.setPacket(i, 0, true); return; }
    const v = 1 + Math.floor(Math.random() * 3), np = S.pos + v;
    if (np >= 9) {
      this.setPacket(i, 9); this.react(i, 'goal');
      setTimeout(() => { this.burst([0, 1.5, 0], { n: 50, colors: [S.colHex, '#ffffff', '#ffd34d'], speed: 10, up: true, size: 0.3 }); this.setPacket(i, null); }, 900);
      setTimeout(() => this.setPacket(i, 0, true), 1700);
    } else { this.setPacket(i, np); if (Math.random() < 0.3) this.react(i, 'hop'); }
  }

  // world → screen (CSS px) for HUD overlays
  project(p) {
    const asp = this.canvas.clientWidth / this.canvas.clientHeight;
    const VP = M4.mul(M4.persp(this.cam.fov, asp, 0.1, 200), M4.lookAt(this._camE || this.cam.eye, this._tgtP || this._tgt || this.cam.target, [0, 1, 0]));
    const x = VP[0] * p[0] + VP[4] * p[1] + VP[8] * p[2] + VP[12], y = VP[1] * p[0] + VP[5] * p[1] + VP[9] * p[2] + VP[13], w = VP[3] * p[0] + VP[7] * p[1] + VP[11] * p[2] + VP[15];
    return [(x / w * 0.5 + 0.5) * this.canvas.clientWidth, (1 - (y / w * 0.5 + 0.5)) * this.canvas.clientHeight, w > 0];
  }

  // ───── frame loop ─────
  _loop(now) {
    requestAnimationFrame(this._loop);
    if (document.hidden || this.lost || this.r.gl.isContextLost()) { this.last = now; return; }
    const dtR = Math.min(0.5, (now - this.last) / 1000), dt = Math.min(0.05, dtR); this.last = now; this.t += dtR;
    const t = this.t;
    // camera framing adapts to aspect
    const asp = this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight);
    const port = asp < 1;
    const baseEye = port ? [0, 40, 21] : [0, 27, 29.5], baseTgt = port ? [0, 0, 0.6] : [0, -1.2, 3.4];
    this.cam.fov = port ? 0.85 : 0.72;
    if (this.lampOb) { this.lampOb.visible = this.bulb.visible = !port; }
    // adaptive quality: drop resolution on slow devices
    this.fq = this.fq || { n: 0, t: 0, lvl: 0 }; this.fq.n++; this.fq.t += dtR;
    if (this.fq.t > 2.5) { const fps = this.fq.n / this.fq.t; if (fps < 24 && this.fq.lvl < 3 && !document.hidden) this.fq.lvl++; this.fq.n = 0; this.fq.t = -1.5; }
    this.cam.maxDpr = [port ? 1.5 : 1.75, 1.15, 0.85, 0.6][this.fq.lvl];
    let eye = [baseEye[0] + Math.sin(t * 0.13) * 1.4, baseEye[1] + Math.sin(t * 0.21) * 0.5, baseEye[2]], tgt = baseTgt.slice();
    if (this.camGoal && t < this.camGoal.until) { const g = this.camGoal; tgt = tgt.map((v, k) => lerp(v, g.target[k], g.k)); eye = eye.map((v, k) => k === 1 ? v * 0.82 : lerp(v, g.target[k] + (v - g.target[k]) * 0.7, g.k)); }
    const sm = 1 - Math.exp(-dt * 4);
    this._eye = this._eye ? this._eye.map((v, k) => lerp(v, eye[k], sm)) : eye; this._tgt = this._tgt ? this._tgt.map((v, k) => lerp(v, tgt[k], sm)) : tgt;
    const sh = this.shakeAmt; this.shakeAmt *= Math.exp(-dtR * 6);
    // user orbit (PC): rotate the eye around the target and scale the distance
    if (this.demo.on) this.autoYaw = (this.autoYaw || 0) + dtR * 0.07;
    const yawAll = this.yaw + (this.autoYaw || 0);
    const pn = this.pan || [0, 0], T = [this._tgt[0] + pn[0], this._tgt[1], this._tgt[2] + pn[1]], cy = Math.cos(yawAll), syw = Math.sin(yawAll), z = this.zoom;
    this._tgtP = T;
    const ex = this._eye[0] - this._tgt[0], ey = this._eye[1] - this._tgt[1], ez = this._eye[2] - this._tgt[2];
    this._camE = [T[0] + (ex * cy + ez * syw) / z, T[1] + ey / z, T[2] + (-ex * syw + ez * cy) / z];
    this.cam.eye = this._camE.map((v, k) => v + (Math.random() - 0.5) * sh * (k === 1 ? 0.6 : 1));
    this.cam.target = T.map((v) => v + (Math.random() - 0.5) * sh * 0.3);
    // flash decay
    this.flashC[3] *= Math.exp(-dtR * 7); this.r.flash = this.flashC;
    // anims
    for (const a of this.anims.slice()) { a.t += dtR; const k = Math.min(1, a.t / a.dur); try { a.fn(k, dtR); } catch (err) { console.error(err); a.t = a.dur; } if (a.t >= a.dur) { this.anims.splice(this.anims.indexOf(a), 1); try { a.done && a.done(); } catch (err) { console.error(err); } } }
    // seats
    const STC = { turn: [1, 0.8, 0.25], pass: [0.3, 1, 0.6], doubt: [1, 0.15, 0.2], think: [0.5, 0.6, 0.6], idle: [0.12, 0.14, 0.13], out: [0.05, 0.05, 0.05] };
    if (this.demo.on && this.seats.length && t > this.demo.next) this._demoStep();
    for (const S of this.seats) {
      // packet glides node to node
      const d = S.pos - S.shown; if (Math.abs(d) > 0.001) { const before = Math.floor(S.shown); S.shown += Math.sign(d) * Math.min(Math.abs(d), dtR * 5.5); if (Math.floor(S.shown) !== before && d > 0) this.stepFx(S.i); }
      const [x, , z] = this.nodePos(S.i, Math.min(S.shown, 9));
      const hop = Math.abs(Math.sin((S.shown % 1) * Math.PI)) * 0.8;
      const y = 0.06 + hop * 1.3;
      const sc = S.vis ? S.scale : 0; S.pk.visible = sc > 0.02; S.pkGlow.visible = S.pk.visible; S.pkShadow.visible = S.pk.visible;
      const spin = Math.PI / 6 + (S.status === 'turn' ? Math.sin(t * 3) * 0.12 : 0);
      let jx = 0, jz = 0, sx = 1; if (S.scanT > 0) { S.scanT -= dtR; jx = (Math.random() - 0.5) * 0.18; jz = (Math.random() - 0.5) * 0.18; sx = 1.15 + Math.sin(t * 30) * 0.08; }
      M4.compose(S.pk.m, x + jx, y, z + jz, 0, spin + (S.scanT > 0 ? t * 6 : 0), 0, sc * sx, sc * sx * (S.status === 'turn' ? 1 + Math.sin(t * 6) * 0.12 : 1), sc * sx);
      M4.compose(S.pkGlow.m, x, 0.06, z, -Math.PI / 2, 0, 0); S.pkGlow.size = [2.4 * sc, 2.4 * sc];
      M4.compose(S.pkShadow.m, x, 0.04, z, -Math.PI / 2, 0, 0); S.pkShadow.size = [1.4 * sc / (1 + (y - 0.9) * 0.4), 1.4 * sc / (1 + (y - 0.9) * 0.4)];
      S.pkGlow.color[3] = S.status === 'turn' ? 0.35 + Math.sin(t * 6) * 0.2 : 0.12;
      // reserve tokens stacked beside the start node
      if (S.stack) S.stack.forEach((o, k) => { o.visible = k < (S.reserve ?? 0); });
      // lane nodes: passed nodes glow in the owner's colour
      const row = this.nodes && this.nodes[S.i];
      if (row) {
        const lit = S.vis ? Math.floor(S.shown + 0.001) : 0, pv = this.pv && this.pv.i === S.i ? this.pv : null, pulse = 0.65 + Math.sin(t * 9) * 0.35;
        row.forEach((o, k) => {
          const on = k + 1 <= lit, ahead = pv && k + 1 > lit && k + 1 <= lit + pv.n;
          o.tint = on ? [...S.col.map(v => v * 0.6 + 0.4), 1] : ahead ? [1, 0.93, 0.7, 1] : [0.85, 0.68, 0.33, 1];
          o.emi = on ? S.col.map(v => v * 0.9) : ahead ? [1.1 * pulse, 0.8 * pulse, 0.25 * pulse] : [0.05, 0.04, 0.02];
        });
        if (pv && this.pvMark) { const dest = Math.min(9, lit + pv.n), [px, , pz] = this.nodePos(S.i, dest); this.pvMark.pos = [px, dest >= 9 ? 1.6 : 0.25, pz]; this.pvMark.color = [1, 0.85, 0.35, 0.55 + Math.sin(t * 9) * 0.25]; const z = dest >= 9 ? 4.2 : 2.2; this.pvMark.size = [z, z]; }
      }
      // halo
      const STC = { turn: [1, 0.8, 0.25], pass: [0.3, 1, 0.6], doubt: [1, 0.15, 0.2], think: [0.5, 0.6, 0.6], idle: [0.12, 0.14, 0.13], out: [0.05, 0.05, 0.05] };
      const hc = STC[S.status] || STC.idle, pulse = S.status === 'turn' || S.status === 'doubt' ? 0.7 + Math.sin(t * 7) * 0.3 : 1;
      S.halo.emi = hc.map(v => v * pulse * 1.4); S.halo.tint = [...hc.map(v => v * 0.6 + 0.2), 1];
      if (S.moodT > 0) S.moodT -= dtR;
      const mood = S.moodT > 0 ? S.mood : null;
      S.eyes.emi = mood === 'doubt' ? [1.7, 0.1, 0.15] : mood === 'cat' ? [1.2, 0.8, 0.3] : S.status === 'out' ? [0.12, 0.12, 0.12] : [0.6, 1, 0.85].map(v => v * (0.75 + 0.25 * Math.sin(t * 3 + S.bob)) * (Math.sin(t * 0.9 + S.bob * 3) > 0.985 ? 0.1 : 1));
      // body language
      let by = Math.sin(t * 1.3 + S.bob) * 0.06, lean = 0, turnY = 0, arm = Math.sin(t * 11 + S.bob) * 0.05 + 0.02;
      for (const k in S.R) {
        const r = S.R[k]; r.t += dtR; const p = Math.min(1, r.t / r.dur), env = Math.sin(p * Math.PI);
        if (k === 'pass') lean += Math.sin(p * Math.PI * 2) * 0.16;
        if (k === 'doubt') { lean += 0.3 * env; arm = -1.35 * Math.min(1, env * 2.5); by += 0.25 * env; }
        if (k === 'cat') { lean += 0.38 * env; by -= 0.55 * env; arm = 0.35 * env; }
        if (k === 'mis') { turnY += Math.sin(r.t * 24) * 0.28 * (1 - p); lean -= 0.1 * env; }
        if (k === 'goal') { by += Math.sin(p * Math.PI) * 1.6; turnY += p * Math.PI * 2; arm = -1.2 * env; }
        if (k === 'win') { by += Math.abs(Math.sin(r.t * 5)) * 1.1; arm = -1.4 + Math.sin(r.t * 10) * 0.3; turnY += Math.sin(r.t * 2) * 0.4; }
        if (k === 'hop') by += env * 0.45;
        if (p >= 1) delete S.R[k];
      }
      if (S.status === 'turn') { by += 0.22; arm += Math.sin(t * 16) * 0.05; }
      if (S.cupSt && S.cupSt.st === 'shake') { arm = -0.95 + Math.sin(t * 34) * 0.22; by += 0.12 + Math.abs(Math.sin(t * 17)) * 0.08; lean += 0.12; }
      if (S.status === 'out') { by -= 0.25; lean += 0.12; }
      const M = M4.compose(S.body.m, S.x, by, S.z, lean, S.face + turnY, 0, 1.3);
      S.glow.m = M; S.eyes.m = M;
      S.glow.emi = S.status === 'turn' ? [0.25, 0.25, 0.25] : [0, 0, 0];
      S.arms.m = M4.mul(M, M4.mul(M4.compose(M4.ident(), 0, 0.42, 0.35, arm), M4.compose(M4.ident(), 0, -0.42, -0.35)));
      M4.compose(S.halo.m, S.x, 4.15 + by + Math.sin(t * 2 + S.bob) * 0.06, S.z, 0.25 * Math.sin(t + S.bob), t * 0.8, 0.2, 1);
      this._cupFrame(S, t, dtR);
    }
    // NEXT marker + turn spotlight
    if (this.nextMark) {
      const N = this.seats[this.nextSeat];
      if (N && !this.demo.on) { const h = N.i === this.me ? [Math.cos(N.a) * 12.9, 1.6, Math.sin(N.a) * 12.9] : [N.x, 6.3, N.z]; this.nextMark.pos = [h[0], h[1] + Math.sin(t * 4) * 0.15, h[2]]; this.nextMark.color[3] = Math.min(1, this.nextMark.color[3] + dtR * 3); }
      else this.nextMark.color[3] = Math.max(0, this.nextMark.color[3] - dtR * 3);
      const TS = this.seats[this.turnSeat];
      if (TS && !this.demo.on) { const px = TS.i === this.me ? Math.cos(TS.a) * 11.5 : TS.x, pz = TS.i === this.me ? Math.sin(TS.a) * 11.5 : TS.z; M4.compose(this.spot.m, px, 3, pz, 0, Math.atan2(this.cam.eye[0] - px, this.cam.eye[2] - pz), 0); this.spot.color = [...TS.col.map(v => v * 0.5 + 0.5), 0.35 + Math.sin(t * 3) * 0.08]; }
      else this.spot.color[3] = 0;
    }
    // environment life
    if (Math.random() < dtR * 5 * this.fxScale) { const a = Math.random() * 7, r = Math.random() * 14; this.scene.particles.emit({ p: [Math.cos(a) * r, 4 + Math.random() * 12, Math.sin(a) * r], v: [(Math.random() - 0.5) * 0.3, -0.15, (Math.random() - 0.5) * 0.3], c: [1, 0.85, 0.6, 0.18], s: 0.07, life: 7, g: 0, drag: 0.1, fade: 1 }); }
    // chip ring + timer
    if (this.chipRing) {
      const glow = 0.35 + Math.sin(t * 2) * 0.15;
      this.chipRing.emi = [glow * 1.2, glow * 0.85, glow * 0.25];
      M4.compose(this.chipRing.m, 0, 0.12, 0, 0, t * 0.2, 0);
      const lit = Math.round(this.timerFrac * 60);
      const urg = this.timerUrgent, blink = urg ? (Math.sin(t * 14) > 0 ? 1 : 0.4) : 1;
      this.timerSegs.forEach((o, k) => {
        const on = this.timerOn && k < lit;
        o.emi = on ? (urg ? [1.6 * blink, 0.15, 0.1] : [1.3, 0.95, 0.3]) : [0, 0, 0];
        o.tint = on ? [1, 0.9, 0.6, 1] : [0.12, 0.16, 0.14, 1];
      });
    }
    this.scene.particles.update(dtR > 0.2 ? 0.2 : dtR);
    // drifting motes
    try { this.r.render(this.scene, this.cam, t); } catch (err) { if (!this._errLogged) { console.error(err); this._errLogged = true; } }
  }
}

// original cat-video thumbnail (simple vector cat), animated by frame index
function drawCat(c, f) {
  const g = c.getContext('2d'), W = c.width, H = c.height;
  g.fillStyle = '#16161c'; g.fillRect(0, 0, W, H);
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#ffd9a8'); bg.addColorStop(1, '#ffb3c7'); g.fillStyle = bg; g.fillRect(8, 8, W - 16, H - 52);
  const bob = Math.sin(f * 0.6) * 6, tilt = Math.sin(f * 0.35) * 0.18;
  g.save(); g.translate(W / 2, 112 + bob); g.rotate(tilt);
  g.fillStyle = '#f39a3d';
  g.beginPath(); g.moveTo(-62, -18); g.lineTo(-48, -80); g.lineTo(-10, -48); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(62, -18); g.lineTo(48, -80); g.lineTo(10, -48); g.closePath(); g.fill();
  g.beginPath(); g.ellipse(0, 0, 76, 62, 0, 0, 7); g.fill();
  g.fillStyle = '#ffd9b0'; g.beginPath(); g.ellipse(0, 22, 40, 28, 0, 0, 7); g.fill();
  const blink = f % 18 === 0;
  g.fillStyle = '#1a1a1a';
  if (blink) { g.fillRect(-36, -8, 22, 4); g.fillRect(14, -8, 22, 4); } else { g.beginPath(); g.ellipse(-25, -6, 9, 12, 0, 0, 7); g.ellipse(25, -6, 9, 12, 0, 0, 7); g.fill(); }
  g.fillStyle = '#ff7aa0'; g.beginPath(); g.moveTo(-7, 12); g.lineTo(7, 12); g.lineTo(0, 20); g.closePath(); g.fill();
  g.strokeStyle = '#1a1a1a'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(0, 20); g.quadraticCurveTo(-8, 30, -16, 24); g.moveTo(0, 20); g.quadraticCurveTo(8, 30, 16, 24); g.stroke();
  g.lineWidth = 2; for (const s of [-1, 1]) for (const dy of [14, 24]) { g.beginPath(); g.moveTo(s * 40, dy); g.lineTo(s * 86, dy + (dy - 19) * 0.8); g.stroke(); }
  g.restore();
  // player chrome
  g.fillStyle = 'rgba(0,0,0,.75)'; g.fillRect(0, H - 44, W, 44);
  g.fillStyle = '#ff3b3b'; g.fillRect(12, H - 30, (W - 140) * ((f % 60) / 60), 6);
  g.fillStyle = '#555'; g.fillRect(12 + (W - 140) * ((f % 60) / 60), H - 30, (W - 140) * (1 - (f % 60) / 60), 6);
  g.fillStyle = '#fff'; g.font = '18px "Share Tech Mono",monospace'; g.textAlign = 'right'; g.fillText('cat.mp4', W - 12, H - 20);
  g.beginPath(); g.moveTo(W / 2 - 18, 60); g.lineTo(W / 2 + 22, 84); g.lineTo(W / 2 - 18, 108); g.closePath(); g.fillStyle = f < 8 ? 'rgba(255,255,255,.85)' : 'rgba(255,255,255,0)'; g.fill();
}
