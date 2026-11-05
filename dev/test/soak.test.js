// Soak: full games through the real server (1 socket player + 4–7 practice CPUs) until someone wins.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const PORT = 19000 + Math.floor(Math.random() * 500);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function game(nBots, sec) {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  await new Promise(r => { ws.onopen = r; });
  let last = null, errors = [], over = null, turns = 0, leak = 0;
  const send = (o) => ws.send(JSON.stringify(o));
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'error') { errors.push(m.code); return; }
    if (m.t !== 'sync') return; last = m; const v = m.view; if (!v) return;
    if (v.myRoll !== undefined && v.turn !== m.you.seat) leak++;
    (m.events || []).forEach(x => { if (x.t === 'turn') turns++; });
    if (v.over) { over = v.over; return; }
    if (v.phase === 'declare' && v.turn === m.you.seat) send({ t: 'declare', v: typeof v.myRoll === 'number' ? v.myRoll : 1 + Math.floor(Math.random() * 4) });
    if (v.phase === 'review' && v.turn !== m.you.seat && v.review.myStake && !v.review.iPassed && !m.room.doubters.length) {
      if (Math.random() < 0.1) send({ t: 'doubt', rank: v.review.myStake === 'goal' ? v.players[m.you.seat].goals[0] : undefined }); else send({ t: 'pass' });
    }
  };
  send({ t: 'create', name: 'SOAK', sec });
  await sleep(100);
  for (let i = 0; i < nBots; i++) send({ t: 'addBot' });
  await sleep(100); send({ t: 'start' });
  const t0 = Date.now();
  while (!over && Date.now() - t0 < 300000) await sleep(100);
  ws.close();
  // "passed"/"doubted"/"phase"/"timeout"/"closed" are expected races between the player and CPUs
  const bad = errors.filter(c => !['passed', 'doubted', 'phase', 'timeout', 'closed', 'turn'].includes(c));
  return { over, turns, bad, leak, ms: Date.now() - t0 };
}

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, GP_TEST: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(r => srv.stdout.once('data', r));
  let ok = 0; const N = +(process.env.N || 6);
  for (let g = 0; g < N; g++) {
    const r = await game(2 + (g % 3), [20, 40, 60][g % 3]);
    const pass = r.over && !r.bad.length && !r.leak;
    if (pass) ok++;
    console.log(`${pass ? 'PASS' : 'FAIL'} game ${g + 1}: ${3 + (g % 3)}人 → ${r.over ? r.over.type : 'NO END'} (${r.turns}手番, ${(r.ms / 1000).toFixed(1)}s) ${r.bad.length ? 'errors:' + r.bad : ''}${r.leak ? ' LEAK' : ''}`);
  }
  console.log(`${ok}/${N} full games completed (server soak)`);
  srv.kill(); process.exit(ok === N ? 0 : 1);
})();
