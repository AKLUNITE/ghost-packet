// GHOST//PACKET room layer. Shared by the online server and the in-browser practice mode,
// so both run identical rules, timing and CPU behaviour.
(function (root) {
  'use strict';
  const GP = typeof module !== 'undefined' ? require('./engine.js') : root.GP;
  const B = typeof module !== 'undefined' ? require('./bots.js') : root.GPBots;

  const DECLARE_SLOW_MS = 30000;   // §15-1: show "考え中" after 30s (no forced action)
  const DISC_GRACE_MS = 90000;     // §15-2: host may skip a disconnected player's turn after 90s
  const MAX = 5, MIN = 3;

  function createRoom(opts) {
    const now = opts.now || Date.now;
    const setT = opts.setTimeout || setTimeout, clrT = opts.clearTimeout || clearTimeout;
    const rng = opts.rng || Math.random;
    const timing = Object.assign({ pass: 2600, doubt: 10500, goal: 1500, win: 0, botMin: 1, botScale: 1 }, opts.timing || {});
    const R = {
      code: opts.code, sec: 40, phase: 'lobby', members: [], G: null, cursor: 0, timers: [],
      mem: null, streak: [], lastActivity: now(), turnSince: 0, nextTurnAt: 0, reactAt: {},
    };
    let idc = 0;
    const tok = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const humans = () => R.members.filter(m => !m.bot);
    const host = () => R.members.find(m => m.host);
    const bySeat = (seat) => R.members.find(m => m.seat === seat);
    const later = (ms, fn) => { const h = setT(() => { R.timers = R.timers.filter(x => x !== h); fn(); }, ms); R.timers.push(h); return h; };
    const clearTimers = () => { R.timers.forEach(clrT); R.timers = []; };
    function fail(code, msg) { const e = new Error(msg); e.code = code; throw e; }

    // ── membership ──
    function join(name, token) {
      R.lastActivity = now();
      const old = token && R.members.find(m => m.token === token);
      if (old) { old.connected = true; old.discSince = null; sync([]); return old; }
      if (R.phase !== 'lobby') fail('started', 'このルームは対戦中です（途中参加はできません）');
      if (R.members.length >= MAX) fail('full', 'ルームが満員です（最大5人）');
      const color = freeColor();
      const m = { id: 'm' + (++idc), token: tok(), name: clean(name) || 'ハッカー' + (R.members.length + 1), bot: false, connected: true, discSince: null, seat: null, host: !humans().length, color, style: color };
      R.members.push(m);
      sync([{ t: 'joined', name: m.name }]);
      return m;
    }
    // looks are cosmetic only (spec 13.2: no character performance differences)
    const freeColor = () => { for (let c = 0; c < 8; c++) if (!R.members.some(x => x.color === c)) return c; return 0; };
    function clean(s) { return String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 10); }
    function disconnect(id) {
      const m = R.members.find(x => x.id === id); if (!m) return;
      if (R.phase === 'lobby') { removeMember(m); return; }
      m.connected = false; m.discSince = now();
      // a host who drops mid-game hands the host role to someone still connected (so skips/lobby stay possible)
      if (m.host) { const h = humans().find(x => x.connected); if (h) { m.host = false; h.host = true; } }
      sync([{ t: 'disc', seat: m.seat }]);
    }
    function removeMember(m) {
      R.members = R.members.filter(x => x !== m);
      if (m.host) { const h = humans()[0]; if (h) h.host = true; }
      sync([{ t: 'left', name: m.name }]);
    }

    // ── messages ──
    function handle(id, msg) {
      const m = R.members.find(x => x.id === id);
      if (!m || !msg || typeof msg !== 'object') return;
      R.lastActivity = now();
      try {
        switch (msg.t) {
          case 'setSec': needHost(m, 'lobby'); if (![20, 40, 60].includes(msg.sec)) fail('sec', '20/40/60秒から選択'); R.sec = msg.sec; sync([]); break;
          case 'addBot': {
            needHost(m, 'lobby'); if (R.members.length >= MAX) fail('full', '最大5人です');
            const used = R.members.map(x => x.name); const nm = B.NAMES.find(n => !used.includes(n)) || 'CPU' + R.members.length;
            R.members.push({ id: 'b' + (++idc), token: null, name: nm, bot: true, connected: true, seat: null, host: false, color: freeColor(), style: Math.floor(rng() * 8) });
            sync([]); break;
          }
          case 'look': {
            if (R.phase !== 'lobby') fail('phase', 'ロビーでのみ変更できます');
            if (Number.isInteger(msg.color) && msg.color >= 0 && msg.color < 8) {
              if (R.members.some(x => x !== m && x.color === msg.color)) fail('color', 'その色は他の人が使っています');
              m.color = msg.color;
            }
            if (Number.isInteger(msg.style) && msg.style >= 0 && msg.style < 8) m.style = msg.style;
            sync([]); break;
          }
          case 'kick': { needHost(m, 'lobby'); const t = R.members.find(x => x.id === msg.id); if (t && t !== m) removeMember(t); break; }
          case 'leave': if (R.phase === 'lobby') removeMember(m); break;
          case 'start': needHost(m, 'lobby'); start(); break;
          case 'declare': inGame(); GP.declare(R.G, m.seat, msg.v, now()); after(); break;
          case 'pass': inGame(); GP.pass(R.G, m.seat, now()); after(); break;
          case 'unpass': inGame(); GP.unpass(R.G, m.seat, now()); after(); break;
          case 'doubt': inGame(); GP.doubt(R.G, m.seat, now(), msg.rank); after(); break;
          case 'skipTurn': {
            needHost(m, 'game'); const t = bySeat(R.G.turn);
            if (!t || t.connected || now() - t.discSince < DISC_GRACE_MS) fail('skip', '切断から90秒経過した手番のみスキップできます');
            GP.skipTurn(R.G); after(); break;
          }
          case 'lobby': needHost(m, 'game'); if (!R.G.over) fail('busy', '対戦中です'); toLobby(); break;
          case 'react': {
            if (typeof msg.k !== 'number' || msg.k < 0 || msg.k > 7) break;
            if (now() - (R.reactAt[m.id] || 0) < 900) break;
            R.reactAt[m.id] = now(); sync([{ t: 'react', seat: m.seat, name: m.name, k: msg.k }]); break;
          }
          case 'debug': if (opts.test) { new Function('G', 'R', 'GP', msg.script)(R.G, R, GP); after(); } break;
        }
      } catch (e) {
        opts.send(m.id, { t: 'error', code: e.code || 'error', msg: e.message });
        if (e.code === 'invariant') throw e;
      }
    }
    function needHost(m, phase) { if (!m.host) fail('host', 'ホストのみ操作できます'); if (phase && R.phase !== phase) fail('phase', phase === 'lobby' ? 'ロビーでのみ操作できます' : '対戦中のみ'); }
    function inGame() { if (R.phase !== 'game' || !R.G) fail('phase', '対戦中ではありません'); }

    function start() {
      if (R.members.length < MIN || R.members.length > MAX) fail('count', '3〜5人で開始できます（現在' + R.members.length + '人）');
      clearTimers();
      R.members.forEach((m, i) => { m.seat = i; });
      R.G = GP.createGame({ names: R.members.map(m => m.name), reviewSec: R.sec, rng });
      R.cursor = 0; R.phase = 'game'; R.mem = { lies: [], seen: [] }; R.streak = R.members.map(() => 0);
      // public per-player record (only things everyone has already seen)
      R.stats = R.members.map(() => ({ ok: 0, lie: 0, truth: 0, dw: 0, dl: 0 }));
      R.hist = R.members.map(() => []);   // public declaration history: value + how it was resolved
      GP.beginTurn(R.G);
      after([{ t: 'start' }]);
    }
    function toLobby() {
      clearTimers(); R.phase = 'lobby'; R.G = null;
      R.members = R.members.filter(m => m.bot || m.connected);
      if (!host() && humans()[0]) humans()[0].host = true;
      R.members.forEach(m => { m.seat = null; });
      sync([{ t: 'lobby' }]);
    }

    // ── after any state change: drain engine log, drive bots + turn pacing, broadcast ──
    function after(extra) {
      const G = R.G; const evs = (extra || []).slice();
      const fresh = G.log.slice(R.cursor); R.cursor = G.log.length;
      let resolved = null, goal = false;
      for (const e of fresh) {
        evs.push(e);
        if (e.t === 'turn') { R.turnSince = now(); const tm = bySeat(e.seat); if (tm && tm.bot) botDeclare(e.seat); }
        if (e.t === 'declare') botsReview();
        if (e.t === 'passed') { resolved = 'pass'; R.streak[e.seat]++; R.stats[e.seat].ok++; pushHist(e.seat, { v: e.value, r: 'ok' }); evs.push({ t: 'streak', seat: e.seat, n: R.streak[e.seat] }); }
        if (e.t === 'reveal') {
          resolved = 'doubt'; R.streak[e.seat] = 0;
          pushHist(e.seat, { v: e.value, r: e.truth ? 'truth' : 'lie', roll: e.roll });
          if (e.truth) { R.stats[e.seat].truth++; R.stats[e.challenger].dl++; } else { R.stats[e.seat].lie++; R.stats[e.challenger].dw++; }
          R.mem.seen[e.seat] = (R.mem.seen[e.seat] || 0) + 1; if (!e.truth) R.mem.lies[e.seat] = (R.mem.lies[e.seat] || 0) + 1;
          const ch = bySeat(e.challenger); if (ch && ch.bot) later(300, () => say(e.challenger, 'doubt'));
          if (!e.truth) { const o = R.members.filter(x => x.bot && x.seat !== e.seat && x.seat !== e.challenger); if (o.length) later(6600, () => say(B.pick(o, rng).seat, 'cat')); }
          else if (ch && ch.bot) later(6800, () => say(e.challenger, 'mis'));
        }
        if (e.t === 'goal') goal = true;
      }
      if (resolved && !G.over) {
        const ms = (resolved === 'pass' ? timing.pass : timing.doubt) + (goal ? timing.goal : 0);
        R.nextTurnAt = now() + ms;
        later(ms, () => { if (R.G === G && G.phase === 'result') { GP.nextTurn(G); after(); } });
      }
      sync(evs);
    }

    function pushHist(seat, h) { const a = R.hist[seat]; a.push(h); if (a.length > 12) a.shift(); }
    function say(seat, kind) {
      if (!R.G || R.phase !== 'game') return;
      sync([{ t: 'say', seat, text: B.pick(B.LINES[kind], rng) }]);
    }
    const botDelay = (a, b) => (a + rng() * (b - a)) * timing.botScale;
    function botDeclare(seat) {
      const G = R.G;
      later(Math.max(timing.botMin, botDelay(1400, 3200)), () => {
        if (R.G !== G || G.phase !== 'declare' || G.turn !== seat) return;
        try { GP.declare(G, seat, B.declare(G.players[seat].active.pos, G.roll, rng), now()); after(); } catch (e) { /* state moved on */ }
      });
    }
    function botsReview() {
      const G = R.G, rv = G.review, sender = G.turn, sp = G.players[sender];
      const bots = rv.elig.filter(s => bySeat(s).bot);
      if (!bots.length) return;
      const span = rv.deadline - rv.start;
      const talkN = rng() < 0.6 ? 2 : 1;
      for (let j = 0; j < talkN; j++) {
        const s = B.pick(bots, rng);
        const kind = rv.value === 4 && rng() < 0.6 ? 'sus4' : (sp.active && sp.active.pos + rv.value >= 9 && rng() < 0.5) ? 'goal' : 'sus';
        later(Math.max(timing.botMin, botDelay(600, Math.min(6000, span * 0.5))), () => { if (R.G === G && G.review === rv && G.phase === 'review') say(s, kind); });
      }
      for (const s of bots) {
        const p = G.players[s];
        const pr = B.doubtChance({ value: rv.value, senderPos: sp.active ? sp.active.pos : null, lies: R.mem.lies[sender] || 0, seen: R.mem.seen[sender] || 0, botCount: bots.length, goalStake: !p.active });
        const willDoubt = rng() < pr;
        const at = Math.max(timing.botMin, (willDoubt ? 0.18 + rng() * 0.62 : 0.08 + rng() * 0.47) * span * timing.botScale);
        later(at, () => {
          if (R.G !== G || G.review !== rv || G.phase !== 'review') return;
          try {
            if (willDoubt) GP.doubt(G, s, now(), p.active ? undefined : p.goals.slice().sort((a, b) => a.rank - b.rank)[0].rank);
            else { GP.pass(G, s, now()); if (rng() < 0.25) sync([{ t: 'say', seat: s, text: B.pick(B.LINES.pass, rng) }]); }
            after();
          } catch (e) { /* closed */ }
        });
      }
    }

    function tick() {
      if (R.phase === 'game' && R.G && R.G.phase === 'review') { if (GP.tick(R.G, now())) after(); }
    }

    function snapshot(m) {
      const t = now(), G = R.G;
      return {
        t: 'sync', now: t,
        you: { id: m.id, seat: m.seat, host: !!m.host, token: m.token },
        room: {
          code: R.code, sec: R.sec, phase: R.phase,
          members: R.members.map(x => ({ id: x.id, name: x.name, bot: x.bot, host: !!x.host, connected: x.connected, seat: x.seat, color: x.color, style: x.style, discFor: x.discSince ? t - x.discSince : 0 })),
          turnFor: G && G.phase === 'declare' ? t - R.turnSince : 0, slowMs: DECLARE_SLOW_MS, graceMs: DISC_GRACE_MS,
          reviewLeft: G && G.phase === 'review' ? Math.max(0, G.review.deadline - t) : 0,
          nextIn: G && G.phase === 'result' ? Math.max(0, R.nextTurnAt - t) : 0,
          streak: R.streak, stats: R.stats || [], hist: R.hist || [],
          passes: G && G.phase === 'review' ? G.review.passes.slice() : [],
          doubters: G && G.phase === 'review' ? G.review.doubts.map(d => d.seat) : [],
        },
        view: G ? GP.view(G, m.seat) : null,
      };
    }
    function sync(evs) {
      for (const m of R.members) if (!m.bot && m.connected) {
        const s = snapshot(m); s.events = evs; opts.send(m.id, s);
      }
    }
    function resend(id) { const m = R.members.find(x => x.id === id); if (m) { const s = snapshot(m); s.events = []; opts.send(m.id, s); } }
    function destroy() { clearTimers(); }

    return { R, join, handle, disconnect, tick, resend, destroy, get code() { return R.code; } };
  }

  const api = { createRoom, DECLARE_SLOW_MS, DISC_GRACE_MS };
  if (typeof module !== 'undefined') module.exports = api; else root.GPRoom = api;
})(this);
