// T01–T17 over the real network: starts server.js in test mode and drives 5–8 WebSocket clients.
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const PORT = 18000 + Math.floor(Math.random() * 1000);
const URL_ = `ws://127.0.0.1:${PORT}/ws`;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

class Client {
  constructor(name) { this.name = name; this.msgs = []; this.last = null; this.waiters = []; this.leaks = []; }
  open() {
    return new Promise((res, rej) => {
      this.ws = new WebSocket(URL_);
      this.ws.onopen = res; this.ws.onerror = rej;
      this.ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data); this.msgs.push(m);
        if (m.t === 'sync') {
          this.last = m;
          // hidden-info audit: a roll may only reach the turn player
          if (m.view && m.view.myRoll !== undefined && m.view.turn !== m.you.seat) this.leaks.push(m);
        }
        this.waiters = this.waiters.filter(w => { if (w.pred(m)) { w.res(m); return false; } return true; });
      };
    });
  }
  send(o) { this.ws.send(JSON.stringify(o)); }
  wait(pred, ms = 4000) {
    const hit = [...this.msgs].reverse().find(pred); // not used for fresh waits
    return new Promise((res, rej) => { const w = { pred, res }; this.waiters.push(w); setTimeout(() => rej(new Error(this.name + ' wait timeout')), ms); });
  }
  get view() { return this.last && this.last.view; }
  close() { try { this.ws.close(); } catch (e) {} }
}

async function room(n) {
  const cs = Array.from({ length: n }, (_, i) => new Client('P' + i));
  await cs[0].open(); cs[0].send({ t: 'create', name: 'P0', sec: 40 });
  const s0 = await cs[0].wait(m => m.t === 'sync'); const code = s0.room.code;
  for (let i = 1; i < n; i++) { await cs[i].open(); cs[i].send({ t: 'join', code, name: 'P' + i }); await cs[i].wait(m => m.t === 'sync'); }
  const started = Promise.all(cs.map(c => c.wait(m => m.t === 'sync' && m.room.phase === 'game')));
  cs[0].send({ t: 'start' }); await started;
  // deterministic opening: seat 0 to act
  await debug(cs, "G.turn=0; G.phase='declare'; G.review=null;");
  return cs;
}
async function debug(cs, script) { const p = cs[0].wait(m => m.t === 'sync'); cs[0].send({ t: 'debug', script }); await p; }
const settle = (c) => c.wait(m => m.t === 'sync' && m.events && m.events.some(e => e.t === 'passed' || e.t === 'reveal'));
function assert(c, m) { if (!c) throw new Error(m); }
const P = (c, i) => c.view.players[i];

const T = [];
const t = (id, title, fn) => T.push({ id, title, fn });

t('T01', '出目2・申告4・ダウトなし', async () => {
  const cs = await room(5); await debug(cs, 'G.roll=2');
  const done = settle(cs[1]); cs[0].send({ t: 'declare', v: 4 });
  await sleep(50); await debug(cs, 'G.review.deadline=Date.now()+150'); await done;
  assert(P(cs[1], 0).pos === 4, 'pos'); assert(!JSON.stringify(cs[1].msgs).includes('"roll"'), 'roll leaked to others');
  return cs;
});
t('T02', '出目2・申告4・ダウトあり', async () => {
  const cs = await room(5); await debug(cs, 'G.roll=2');
  cs[0].send({ t: 'declare', v: 4 }); await cs[2].wait(m => m.view && m.view.phase === 'review');
  const done = settle(cs[1]); cs[2].send({ t: 'doubt' }); await done;
  assert(P(cs[1], 0).lost === 1 && P(cs[1], 0).pos === 0, 'sender'); assert(P(cs[1], 2).pos === 4, 'challenger +4'); return cs;
});
t('T03', '出目4・申告4・ダウトあり', async () => {
  const cs = await room(5); await debug(cs, 'G.roll=4');
  cs[0].send({ t: 'declare', v: 4 }); await cs[1].wait(m => m.view && m.view.phase === 'review');
  const done = settle(cs[3]); cs[1].send({ t: 'doubt' }); await done;
  assert(P(cs[3], 0).pos === 4 && P(cs[3], 1).lost === 1, 'result'); return cs;
});
t('T04', '出目4・申告2・ダウトあり', async () => {
  const cs = await room(5); await debug(cs, 'G.roll=4');
  cs[0].send({ t: 'declare', v: 2 }); await cs[1].wait(m => m.view && m.view.phase === 'review');
  const done = settle(cs[1]); cs[1].send({ t: 'doubt' }); const m = await done;
  assert(m.view.last.truth === false && P(cs[1], 0).lost === 1 && P(cs[1], 1).pos === 2, 'lie'); return cs;
});
t('T05', '出目×・申告1', async () => {
  const cs = await room(5); await debug(cs, "G.roll='X'");
  cs[0].send({ t: 'declare', v: 1 }); await cs[4].wait(m => m.view && m.view.phase === 'review');
  const done = settle(cs[4]); cs[4].send({ t: 'doubt' }); const m = await done;
  assert(m.view.last.roll === 'X' && !m.view.last.truth && P(cs[4], 4).pos === 1, 'forced bluff'); return cs;
});
t('T06', '40秒審議で全員スルー → 即転送', async () => {
  const cs = await room(5); await debug(cs, 'G.roll=1');
  const t0 = Date.now(); cs[0].send({ t: 'declare', v: 3 }); await cs[1].wait(m => m.view && m.view.phase === 'review');
  const done = settle(cs[1]); for (let i = 1; i < 5; i++) cs[i].send({ t: 'pass' }); const m = await done;
  assert(Date.now() - t0 < 3000, 'did not end early'); assert(m.events.some(e => e.t === 'passed' && e.why === 'allpass'), 'why');
  assert(m.view.last.roll === undefined, 'roll leaked'); return cs;
});
t('T07', '一部スルー後に取り消し → 継続・再ダウト可', async () => {
  const cs = await room(5); await debug(cs, 'G.roll=1');
  cs[0].send({ t: 'declare', v: 3 }); await cs[1].wait(m => m.view && m.view.phase === 'review');
  cs[1].send({ t: 'pass' }); cs[2].send({ t: 'pass' }); await sleep(80); cs[2].send({ t: 'unpass' });
  cs[3].send({ t: 'pass' }); cs[4].send({ t: 'pass' }); await sleep(150);
  assert(cs[2].view.phase === 'review' && cs[2].view.review.passCount === 3, 'should still be reviewing');
  const done = settle(cs[2]); cs[2].send({ t: 'doubt' }); const m = await done;
  assert(m.view.last.challenger === 2, 'challenger'); return cs;
});
t('T08', '期限までダウトなし → スルー、期限後ダウト無効', async () => {
  const cs = await room(5); await debug(cs, 'G.roll=2');
  cs[0].send({ t: 'declare', v: 4 }); await cs[1].wait(m => m.view && m.view.phase === 'review');
  const done = settle(cs[1]); await debug(cs, 'G.review.deadline=Date.now()+120'); const m = await done;
  assert(m.events.some(e => e.why === 'timeout'), 'timeout');
  const err = cs[1].wait(m => m.t === 'error'); cs[1].send({ t: 'doubt' }); const e = await err;
  assert(['phase', 'timeout'].includes(e.code), 'late doubt accepted'); return cs;
});
t('T09', '2人が250ms内にダウト → 時計回り優先', async () => {
  const cs = await room(5); await debug(cs, "G.turn=2; G.roll=4; G.phase='declare'");
  cs[2].send({ t: 'declare', v: 4 }); await Promise.all([cs[0].wait(m => m.view && m.view.phase === 'review'), cs[4].wait(m => m.view && m.view.phase === 'review')]);
  const done = settle(cs[1]); cs[0].send({ t: 'doubt' }); await sleep(60); cs[4].send({ t: 'doubt' }); const m = await done;
  assert(m.view.last.challenger === 4 && m.view.last.contenders.length === 2, 'got ' + m.view.last.challenger);
  assert(P(cs[1], 4).lost === 1 && P(cs[1], 0).lost === 0, 'penalty only seat4'); return cs;
});
t('T10', '位置8→申告1でゴール', async () => {
  const cs = await room(5); await debug(cs, 'G.roll=1; G.players[0].active.pos=8');
  const done = settle(cs[1]); cs[0].send({ t: 'declare', v: 1 }); await sleep(50); await debug(cs, 'G.review.deadline=Date.now()+100'); await done;
  assert(P(cs[1], 0).goals[0] === 1 && P(cs[1], 0).score === 1, 'goal'); return cs;
});
t('T11', '3個目ゴールで即勝利', async () => {
  const cs = await room(5); await debug(cs, "G.roll=1; const p=G.players[0]; p.goals=[{rank:1},{rank:2}]; p.reserve=4; p.active.pos=8; G.goalCount=2;");
  const over = cs[1].wait(m => m.view && m.view.over); cs[0].send({ t: 'declare', v: 1 }); await sleep(50); await debug(cs, 'G.review.deadline=Date.now()+100');
  const m = await over; assert(m.view.over.type === 'three' && m.view.over.winners[0] === 0, 'win'); return cs;
});
const EXH = (seat, goals) => `{const p=G.players[${seat}]; p.active=null; p.reserve=0; p.goals=${JSON.stringify(goals.map(r => ({ rank: r })))}; p.lost=${7 - goals.length};}`;
t('T12', 'ゴール済みのみ → 賭けてダウト可', async () => {
  const cs = await room(5); await debug(cs, "G.roll='X'; G.goalCount=3;" + EXH(1, [3]));
  cs[0].send({ t: 'declare', v: 2 }); await cs[1].wait(m => m.view && m.view.phase === 'review');
  assert(cs[1].view.review.myStake === 'goal', 'stake kind');
  const done = settle(cs[1]); cs[1].send({ t: 'doubt', rank: 3 }); await done;
  assert(P(cs[1], 0).lost === 1 && P(cs[1], 1).goals.length === 1 && P(cs[1], 1).pos === null, 'result'); return cs;
});
t('T13', 'T12のダウト失敗 → ゴール済みが1個消える', async () => {
  const cs = await room(5); await debug(cs, "G.roll=2; G.goalCount=5;" + EXH(1, [3, 5]));
  cs[0].send({ t: 'declare', v: 2 }); await cs[1].wait(m => m.view && m.view.phase === 'review');
  const done = settle(cs[1]); cs[1].send({ t: 'doubt', rank: 5 }); await done;
  assert(P(cs[1], 1).goals.join() === '3' && P(cs[1], 1).score === 1, 'goal removed'); return cs;
});
t('T14', '順位3が消える → 次のゴールの記録は順位4', async () => {
  const cs = await room(5); await debug(cs, "G.roll=2; G.goalCount=3; G.players[2].goals=[{rank:1},{rank:2}]; G.players[2].reserve=4;" + EXH(1, [3]));
  cs[0].send({ t: 'declare', v: 2 }); await cs[1].wait(m => m.view && m.view.phase === 'review');
  let done = settle(cs[1]); cs[1].send({ t: 'doubt', rank: 3 }); await done;
  await cs[1].wait(m => m.view && m.view.phase === 'declare', 3000);
  await debug(cs, "G.turn=3; G.roll=1; G.phase='declare'; G.players[3].active.pos=8;");
  done = settle(cs[1]); cs[3].send({ t: 'declare', v: 1 }); await sleep(50); await debug(cs, 'G.review.deadline=Date.now()+100'); await done;
  assert(P(cs[1], 3).goals[0] === 4, 'rank ' + P(cs[1], 3).goals[0]); return cs;
});
t('T15', '送信可能者1名 → 即終了しない', async () => {
  const cs = await room(5); await debug(cs, "G.roll=3; G.goalCount=1;" + EXH(1, [1]) + EXH(2, []) + EXH(3, []) + EXH(4, []));
  cs[0].send({ t: 'declare', v: 3 }); await cs[1].wait(m => m.view && m.view.phase === 'review');
  let done = settle(cs[1]); cs[1].send({ t: 'pass' }); await done;
  assert(!cs[1].view.over && P(cs[1], 0).pos === 3, 'continues');
  await cs[0].wait(m => m.view && m.view.phase === 'declare' && m.view.turn === 0, 3000);
  await debug(cs, 'G.roll=2;' + EXH(1, []));
  done = settle(cs[1]); cs[0].send({ t: 'declare', v: 4 }); const m = await done;
  assert(m.events.some(e => e.why === 'noone') && P(cs[1], 0).pos === 7 && !m.view.over, 'auto pass'); return cs;
});
t('T16', '送信可能者0 → ゴール数で確定', async () => {
  const cs = await room(5); await debug(cs, "G.roll=1; G.goalCount=7;" + EXH(1, [1, 7]) + EXH(2, [3, 5]) + EXH(3, [2, 6]) + EXH(4, [4]) + "{const p=G.players[0];p.reserve=0;p.lost=6;p.active.pos=8;}");
  const over = cs[1].wait(m => m.view && m.view.over); cs[0].send({ t: 'declare', v: 1 }); await sleep(50); await debug(cs, 'G.review.deadline=Date.now()+100');
  const m = await over; assert(m.view.over.type === 'nomove' && m.view.over.winners.join() === '1,2,3', 'tie ' + m.view.over.winners); return cs;
});
t('T17', '5人戦10個目のゴール → 終わらず続行', async () => {
  const cs = await room(5);
  await debug(cs, "let r=1; G.players.forEach((p,i)=>{ if(i){p.goals=[{rank:r++},{rank:r++}]; p.reserve-=2;} }); const p0=G.players[0]; p0.goals=[{rank:9}]; p0.reserve-=1; p0.active.pos=8; G.goalCount=9; G.roll=1;");
  const next = cs[1].wait(m => m.view && m.view.turn === 1 && m.view.phase === 'declare', 8000); cs[0].send({ t: 'declare', v: 1 }); await sleep(50); await debug(cs, 'G.review.deadline=Date.now()+100');
  const m = await next; assert(!m.view.over && m.view.goalCount === 10 && P(cs[1], 0).score === 2, 'should continue'); return cs;
});

t('X03', '3人ルームで開始・6人目は満員で拒否', async () => {
  const cs = Array.from({ length: 6 }, (_, i) => new Client('Q' + i));
  await cs[0].open(); cs[0].send({ t: 'create', name: 'Q0' }); const s0 = await cs[0].wait(m => m.t === 'sync'); const code = s0.room.code;
  for (let i = 1; i < 5; i++) { await cs[i].open(); cs[i].send({ t: 'join', code, name: 'Q' + i }); await cs[i].wait(m => m.t === 'sync'); }
  await cs[5].open(); cs[5].send({ t: 'join', code, name: 'Q5' }); const e = await cs[5].wait(m => m.t === 'error');
  assert(e.code === 'full', 'expected full, got ' + e.code);
  cs[4].send({ t: 'leave' }); cs[3].send({ t: 'leave' }); await sleep(150);
  const st = cs[0].wait(m => m.t === 'sync' && m.room.phase === 'game'); cs[0].send({ t: 'start' }); const g = await st;
  assert(g.view.players.length === 3 && g.view.winAt === 3, '3p start');
  return cs;
});

(async () => {
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...process.env, PORT, GP_TEST: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise(r => srv.stdout.once('data', r));
  let ok = 0;
  for (const x of T) {
    let cs = [];
    try {
      cs = await Promise.race([x.fn(), sleep(15000).then(() => { throw new Error('timeout'); })]);
      const leaks = cs.reduce((a, c) => a + c.leaks.length, 0);
      if (leaks) throw new Error('hidden roll leaked to non-turn player ×' + leaks);
      ok++; console.log('PASS', x.id, x.title);
    } catch (e) { console.log('FAIL', x.id, x.title, '←', e.message); }
    (cs || []).forEach(c => c.close());
  }
  console.log(`${ok}/${T.length} passed (network)`);
  srv.kill(); process.exit(ok === T.length ? 0 : 1);
})();
