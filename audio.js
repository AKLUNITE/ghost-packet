// GHOST//PACKET audio: procedurally generated synthwave BGM (original, generated at runtime) and arcade SFX.
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

export class Audio {
  constructor() { this.ctx = null; this.bgmOn = true; this.sfxOn = true; this.vol = (() => { try { const v = JSON.parse(localStorage.getItem('gp.vol')); return typeof v === 'number' ? v : 0.8; } catch (e) { return 0.8; } })(); this.mode = 'stop'; this.step = 0; this.nextT = 0; this.intensity = 0; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createDynamicsCompressor(); this.master.threshold.value = -14; this.master.ratio.value = 4; this.master.connect(c.destination);
    this.out = c.createGain(); this.out.gain.value = 0.9 * this.vol * 1.125; this.out.connect(this.master);
    this.music = c.createGain(); this.music.gain.value = 0.55;
    this.mfilt = c.createBiquadFilter(); this.mfilt.type = 'lowpass'; this.mfilt.frequency.value = 18000; this.mfilt.Q.value = 0.8;
    this.music.connect(this.mfilt); this.mfilt.connect(this.out);
    this.fx = c.createGain(); this.fx.gain.value = 0.85; this.fx.connect(this.out);
    // delay send for arps
    this.dly = c.createDelay(1); this.dly.delayTime.value = 60 / 126 * 0.75; const fb = c.createGain(); fb.gain.value = 0.32;
    const dlyOut = c.createGain(); dlyOut.gain.value = 0.35; this.dly.connect(fb); fb.connect(this.dly); this.dly.connect(dlyOut); dlyOut.connect(this.music);
    // noise
    const nb = c.createBuffer(1, c.sampleRate, c.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; this.noiseBuf = nb;
    this.applyGains();
    this.timer = setInterval(() => this._sched(), 25);
  }
  applyGains() { if (!this.ctx) return; const t = this.ctx.currentTime; this.music.gain.setTargetAtTime(this.bgmOn ? 0.55 : 0, t, 0.08); this.fx.gain.setTargetAtTime(this.sfxOn ? 0.85 : 0, t, 0.03); }
  setBgm(on) { this.bgmOn = on; this.applyGains(); }
  setSfx(on) { this.sfxOn = on; this.applyGains(); }
  setVol(v) { this.vol = Math.max(0, Math.min(1, v)); if (this.ctx) this.out.gain.setTargetAtTime(0.9 * this.vol * 1.125, this.ctx.currentTime, 0.05); }
  setMode(m) {
    if (!this.ctx || m === this.mode) return;
    const t = this.ctx.currentTime;
    if (this.mode === 'stop' || m === 'lobby') { this.step = 0; this.nextT = t + 0.05; }
    this.mode = m;
    const cut = { lobby: 4200, game: 16000, tension: 2400, climax: 9000, stop: 18000 }[m] || 16000;
    this.mfilt.frequency.cancelScheduledValues(t); this.mfilt.frequency.setTargetAtTime(cut, t, m === 'tension' ? 0.3 : 0.15);
  }
  // 0..1 during review: opens the filter as the clock runs down
  setTension(k) {
    if (!this.ctx || (this.mode !== 'tension' && this.mode !== 'climax')) return;
    const now = this.ctx.currentTime; if (now - (this._tensT || 0) < 0.25) return; this._tensT = now;
    this.mfilt.frequency.cancelScheduledValues(now); this.mfilt.frequency.setTargetAtTime(this.mode === 'climax' ? 9000 + k * 8000 : 1800 + k * 5500, this.ctx.currentTime, 0.2); }
  duck(sec) { if (!this.ctx) return; const t = this.ctx.currentTime, g = this.music.gain; g.cancelScheduledValues(t); g.setTargetAtTime(0.0001, t, 0.03); g.setTargetAtTime(this.bgmOn ? 0.55 : 0, t + sec, 0.3); }

  // ───── sequencer ─────
  _sched() {
    const c = this.ctx; if (!c || this.mode === 'stop') return;
    const spb = 60 / 126 / 4; // 16th
    if (this.nextT < c.currentTime - 0.2) this.nextT = c.currentTime + 0.02;
    while (this.nextT < c.currentTime + 0.12) { this._play(this.step, this.nextT, spb); this.nextT += spb; this.step++; }
  }
  _play(s, t, spb) {
    const m = this.mode, bar = Math.floor(s / 16), st = s % 16;
    const prog = [[45, 'm'], [41, 'M'], [48, 'M'], [43, 'M']];
    const progL = [[45, 'm'], [41, 'M7'], [38, 'm'], [40, 'm']];
    const [root, q] = (m === 'lobby' ? progL : prog)[bar % 4];
    const chord = q === 'm' ? [0, 3, 7] : q === 'M7' ? [0, 4, 7, 11] : [0, 4, 7];
    if (m === 'lobby') {
      if (st === 0) this.pad(t, chord.map(x => root + 24 + x), spb * 16, 0.05);
      if (st % 2 === 0) this.arp(t, root + 36 + [0, 7, 12, chord[1] + 12, 7, chord[1], 12, 19][(st / 2) % 8], 0.035);
      if (st % 4 === 2) this.hat(t, 0.02);
      if (st === 0 && bar % 2 === 0) this.kick(t, 0.35);
      return;
    }
    const tension = m === 'tension', climax = m === 'climax';
    // drums
    if (st % 4 === 0) this.kick(t, tension ? 0.75 : 0.9);
    if (climax && st % 4 === 2) this.kick(t, 0.6);
    if (!tension && (st === 4 || st === 12)) this.clap(t, 0.4);
    if (tension && st === 12 && bar % 2 === 1) this.clap(t, 0.3);
    if (st % 4 === 2) this.hat(t, 0.06, true);
    if ((tension || climax) ? true : st % 2 === 0) this.hat(t, climax ? 0.05 : 0.035);
    // bass
    if (tension) { this.bass(t, root + (st % 8 === 7 ? 12 : 0), spb * 0.9, 0.2); }
    else if (st % 4 === 2 || st % 4 === 3) this.bass(t, root + (st % 8 === 7 ? 12 : 0), spb * 0.9, 0.26);
    else if (st === 0) this.bass(t, root - 12, spb * 2, 0.25);
    // pad + arp
    if (st === 0) this.pad(t, chord.map(x => root + 24 + x), spb * 16, tension ? 0.04 : 0.055);
    if (!tension) {
      const pat = [0, 12, 7, 19, chord[1] + 12, 7, 24, 12];
      if (climax || st % 2 === 0) this.arp(t, root + 36 + pat[(climax ? st : st / 2) % 8], climax ? 0.05 : 0.04);
    } else if (st % 8 === 0) this.arp(t, root + 48 + chord[2], 0.025);
    // lead hook in game mode every 4 bars
    if (m === 'game' && bar % 8 >= 4) {
      const hook = [12, null, 15, null, 19, 17, 15, null, 12, null, 10, 12, null, 7, null, null];
      const n = hook[st]; if (n != null) this.lead(t, root + 36 + n - (q === 'M' ? 0 : 0), spb * 1.6, 0.05);
    }
  }
  // ───── instruments ─────
  _env(g, t, a, peak, dec, sus = 0.0001) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(Math.max(sus, 0.0001), t + a + dec); }
  _osc(type, f, t, dur, dest, peak, a = 0.005, detune = 0) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(); o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = detune;
    this._env(g, t, a, peak, dur); o.connect(g); g.connect(dest); o.start(t); o.stop(t + a + dur + 0.05); return o;
  }
  _noise(t, dur, dest, peak, type, freq, q = 1) {
    const c = this.ctx, s = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    s.buffer = this.noiseBuf; f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q; this._env(g, t, 0.002, peak, dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05); return f;
  }
  kick(t, v) { const o = this._osc('sine', 150, t, 0.32, this.music, v); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); }
  clap(t, v) { this._noise(t, 0.16, this.music, v, 'bandpass', 1700, 1.2); this._noise(t + 0.012, 0.12, this.music, v * 0.6, 'bandpass', 2400, 1); }
  hat(t, v, open) { this._noise(t, open ? 0.14 : 0.035, this.music, v, 'highpass', 8000); }
  bass(t, n, dur, v) {
    const c = this.ctx, o = c.createOscillator(), f = c.createBiquadFilter(), g = c.createGain();
    o.type = 'sawtooth'; o.frequency.value = mtof(n); f.type = 'lowpass'; f.Q.value = 6; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(160, t + dur);
    this._env(g, t, 0.004, v, dur); o.connect(f); f.connect(g); g.connect(this.music); o.start(t); o.stop(t + dur + 0.05);
  }
  pad(t, notes, dur, v) {
    const c = this.ctx, f = c.createBiquadFilter(), g = c.createGain(); f.type = 'lowpass'; f.frequency.value = 1400;
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.4); g.gain.setValueAtTime(v, t + dur - 0.3); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g); g.connect(this.music);
    for (const n of notes) for (const dt of [-9, 9]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = mtof(n); o.detune.value = dt; o.connect(f); o.start(t); o.stop(t + dur + 0.05); }
  }
  arp(t, n, v) { const c = this.ctx, g = c.createGain(); g.connect(this.music); g.connect(this.dly); g.gain.value = 1; this._osc('square', mtof(n), t, 0.09, g, v); }
  lead(t, n, dur, v) { const c = this.ctx, g = c.createGain(); g.gain.value = 1; g.connect(this.music); g.connect(this.dly); const o = this._osc('sawtooth', mtof(n), t, dur, g, v, 0.01, 7); this._osc('sawtooth', mtof(n), t, dur, g, v * 0.7, 0.01, -7); }

  // ───── sound effects ─────
  sfx(name, o = {}) {
    const c = this.ctx; if (!c || !this.sfxOn) return; const t = c.currentTime + (o.at || 0), D = this.fx;
    const tone = (type, f, dur, v, at = 0, to) => { const os = this._osc(type, f, t + at, dur, D, v); if (to) os.frequency.exponentialRampToValueAtTime(to, t + at + dur); return os; };
    const noise = (dur, v, type, f, at = 0, q) => this._noise(t + at, dur, D, v, type, f, q);
    switch (name) {
      case 'click': tone('square', 1200, 0.03, 0.05); break;
      case 'turn': tone('triangle', 784, 0.12, 0.12); tone('triangle', 1175, 0.18, 0.12, 0.09); break;
      case 'myturn': [523, 659, 784, 1047, 1319].forEach((f, i) => tone('square', f, 0.1, 0.07, i * 0.05)); noise(0.4, 0.15, 'highpass', 5000, 0.1); break;
      case 'reel': tone('square', 1500 + Math.random() * 400, 0.025, 0.05); break;
      case 'reelStop': tone('square', 220, 0.12, 0.2); noise(0.08, 0.3, 'bandpass', 2500); tone('triangle', 880, 0.2, 0.12, 0.03); break;
      case 'rare': { const ns = o.tier === 4 ? [523, 659, 784, 1047, 1319, 1568, 2093] : o.tier === 3 ? [523, 659, 784, 1047] : [523, 784];
        ns.forEach((f, i) => tone('square', f, 0.14, 0.08, i * 0.06)); ns.forEach((f, i) => tone('triangle', f * 2, 0.2, 0.05, i * 0.06 + 0.02));
        if (o.tier === 4) { noise(1.2, 0.2, 'highpass', 6000, 0.3); for (let i = 0; i < 10; i++) tone('sine', 2000 + Math.random() * 3000, 0.08, 0.05, 0.4 + i * 0.07); } break; }
      case 'xroll': for (let i = 0; i < 6; i++) tone('sawtooth', 80 + Math.random() * 400, 0.06, 0.12, i * 0.05); noise(0.5, 0.25, 'bandpass', 600, 0, 4); break;
      case 'declare': tone('sine', 120, 0.6, 0.6, 0, 40); noise(0.5, 0.35, 'lowpass', 900); tone('sawtooth', 300, 0.25, 0.1, 0, 900); tone('square', 600 + (o.v || 1) * 120, 0.18, 0.08, 0.05); break;
      case 'tick': tone('square', o.hi ? 1760 : 1320, 0.05, 0.07); break;
      case 'heart': tone('sine', 60, 0.18, 0.5, 0, 40); tone('sine', 55, 0.16, 0.35, 0.16, 38); break;
      case 'pass': tone('sine', 660, 0.08, 0.1); tone('sine', 990, 0.12, 0.08, 0.06); break;
      case 'unpass': tone('sine', 660, 0.08, 0.1); tone('sine', 440, 0.12, 0.08, 0.06); break;
      case 'doubt': for (let i = 0; i < 4; i++) { tone('sawtooth', 988, 0.11, 0.14, i * 0.2); tone('sawtooth', 740, 0.11, 0.14, i * 0.2 + 0.1); }
        tone('sine', 90, 0.8, 0.6, 0, 35); noise(0.6, 0.4, 'lowpass', 1200); break;
      case 'drumroll': { const len = o.len || 1.2, n = Math.floor(len / 0.04); for (let i = 0; i < n; i++) { const k = i / n; noise(0.05, 0.05 + k * 0.32, 'bandpass', 1500 + k * 900, i * 0.04, 1.5); } tone('sine', 55, len, 0.25, 0, 80); break; }
      case 'scan': { const len = o.len || 1.5, n = Math.floor(len / 0.11); for (let i = 0; i < n; i++) tone('square', 700 + i * 70 + Math.random() * 40, 0.04, 0.05, i * 0.11); tone('sawtooth', 80, len, 0.05, 0, 320); break; }
      case 'hit': tone('sine', 90, 0.9, 0.7, 0, 35); noise(0.6, 0.5, 'lowpass', 2500); tone('sawtooth', 220, 0.4, 0.12, 0, 110); break;
      case 'cut': noise(0.08, 0.3, 'highpass', 3000); break;
      // physical table sounds
      case 'cup': for (let i = 0; i < 3; i++) { noise(0.03, 0.22 + Math.random() * 0.1, 'bandpass', 2200 + Math.random() * 1800, i * 0.035 + Math.random() * 0.02, 6); tone('triangle', 900 + Math.random() * 600, 0.03, 0.05, i * 0.035); } break;
      // dice rattling inside a leather cup: k = shake intensity 0..1, g = loudness (others' cups are quieter)
      case 'rattle': { const k = o.k == null ? 0.6 : o.k, g = o.g == null ? 1 : o.g, n = 2 + Math.round(k * 3);
        for (let i = 0; i < n; i++) { const at = i * (0.018 + Math.random() * 0.03); noise(0.02 + Math.random() * 0.015, (0.18 + k * 0.22) * g, 'bandpass', 2600 + Math.random() * 2600, at, 7); tone('triangle', 1100 + Math.random() * 900, 0.02, 0.035 * g, at); }
        noise(0.06, 0.12 * g * (0.5 + k), 'lowpass', 420); break; }
      // cup slammed onto the felt: thud, then the die settles with a few quick clicks
      case 'slam': { const g = o.g == null ? 1 : o.g; tone('sine', 120, 0.22, 0.75 * g, 0, 48); noise(0.12, 0.55 * g, 'lowpass', 600); noise(0.05, 0.3 * g, 'bandpass', 1800, 0.005, 3);
        [0.07, 0.13, 0.17, 0.2].forEach((at, i) => noise(0.015, (0.22 - i * 0.045) * g, 'bandpass', 3400 + Math.random() * 1200, at, 8)); break; }
      case 'lift': noise(0.25, 0.12, 'bandpass', 900, 0, 1.2); tone('sine', 520, 0.12, 0.08, 0.05, 880); break;
      case 'thunk': tone('sine', 140, 0.18, 0.5, 0, 60); noise(0.09, 0.4, 'lowpass', 700); noise(0.04, 0.2, 'bandpass', 2600, 0.01, 4); break;
      case 'clack': noise(0.035, 0.45, 'bandpass', 3200, 0, 5); tone('triangle', 1700, 0.04, 0.12); tone('sine', 420, 0.06, 0.2, 0.005, 300); break;
      case 'slap': noise(0.09, 0.55, 'bandpass', 1400, 0, 1.2); noise(0.05, 0.3, 'highpass', 4000, 0.004); tone('sine', 180, 0.08, 0.25, 0, 90); break;
      case 'safe': [784, 988, 1175, 1568].forEach((f, i) => tone('square', f, 0.25, 0.09, i * 0.07)); for (let i = 0; i < 14; i++) tone('triangle', 2400 + Math.random() * 1800, 0.07, 0.06, 0.25 + i * 0.05); break;
      case 'busted': for (let i = 0; i < 8; i++) tone('square', 100 + Math.random() * 900, 0.04, 0.13, i * 0.035); tone('sawtooth', 600, 0.6, 0.15, 0.3, 90); this.meow(0.75); break;
      case 'misaudit': tone('sawtooth', 392, 0.25, 0.12); tone('sawtooth', 370, 0.25, 0.12, 0.25); tone('sawtooth', 349, 0.6, 0.12, 0.5, 260); break;
      case 'step': tone('triangle', 900 + (o.k || 0) * 90, 0.05, 0.05); break;
      case 'approve': [659, 880, 1319].forEach((f, i) => tone('square', f, 0.12, 0.07, i * 0.06)); noise(0.3, 0.12, 'highpass', 7000, 0.12); break;
      case 'goal': [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => tone('square', f, 0.16, 0.08, i * 0.075));
        for (let i = 0; i < 24; i++) tone('triangle', 2600 + Math.random() * 2000, 0.06, 0.05, 0.5 + i * 0.04); tone('sine', 110, 0.8, 0.5, 0, 50); break;
      case 'win': [392, 523, 659, 784, 659, 784, 1047, 1319, 1568].forEach((f, i) => tone('square', f, 0.3, 0.09, i * 0.13)); [196, 262, 330].forEach((f, i) => tone('sawtooth', f, 1.6, 0.06, 1.1)); break;
      case 'stamp': tone('triangle', 900, 0.06, 0.08); tone('triangle', 1350, 0.08, 0.07, 0.05); break;
      case 'err': tone('square', 160, 0.18, 0.1); break;
      case 'join': tone('triangle', 660, 0.1, 0.1); tone('triangle', 880, 0.14, 0.1, 0.08); break;
    }
  }
  meow(at = 0) {
    const c = this.ctx, t = c.currentTime + at, o = c.createOscillator(), g = c.createGain(), b = c.createBiquadFilter();
    o.type = 'sawtooth'; o.frequency.setValueAtTime(480, t); o.frequency.linearRampToValueAtTime(820, t + 0.18); o.frequency.linearRampToValueAtTime(420, t + 0.6);
    b.type = 'bandpass'; b.frequency.setValueAtTime(900, t); b.frequency.linearRampToValueAtTime(1800, t + 0.2); b.frequency.linearRampToValueAtTime(700, t + 0.6); b.Q.value = 4;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.35, t + 0.05); g.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
    o.connect(b); b.connect(g); g.connect(this.fx); o.start(t); o.stop(t + 0.7);
  }
}
