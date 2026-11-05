// Extra room checks beyond §14: host handover, cosmetic looks, public history.
'use strict';
const { createRoom } = require('../../room.js');
const out = {}; const send = (id, m) => { (out[id] = out[id] || []).push(m); };
const last = (id) => out[id].filter(m => m.t === 'sync').slice(-1)[0];
let ok = 0, n = 0; const t = (name, fn) => { n++; try { fn(); ok++; console.log('PASS', name); } catch (e) { console.log('FAIL', name, '←', e.message); } };
const assert = (c, m) => { if (!c) throw new Error(m); };

t('ホストが対戦中に切断 → 接続中の人にホスト移譲', () => {
  const r = createRoom({ code: 'TEST', send, rng: () => 0.5 });
  const ms = ['A', 'B', 'C', 'D', 'E'].map(nm => r.join(nm));
  r.handle(ms[0].id, { t: 'start' });
  r.disconnect(ms[0].id);
  const s = last(ms[1].id); const host = s.room.members.find(x => x.host);
  assert(host && host.id === ms[1].id, 'host moved to ' + (host && host.name));
  r.destroy();
});
t('見た目：色の重複は拒否、キャラは自由', () => {
  const r = createRoom({ code: 'TEST', send });
  const a = r.join('A'), b = r.join('B');
  r.handle(b.id, { t: 'look', color: a.color });
  assert(out[b.id].some(m => m.t === 'error' && /他の人/.test(m.msg)), 'duplicate colour accepted');
  r.handle(b.id, { t: 'look', color: 5, style: 2 });
  const me = last(b.id).room.members.find(x => x.id === b.id);
  assert(me.color === 5 && me.style === 2, 'look not applied');
  r.destroy();
});
t('見た目は対戦開始後に変更不可', () => {
  const r = createRoom({ code: 'TEST', send });
  const ms = ['A', 'B', 'C', 'D', 'E'].map(nm => r.join(nm));
  r.handle(ms[0].id, { t: 'start' }); out[ms[2].id] = [];
  r.handle(ms[2].id, { t: 'look', style: 6 });
  assert(out[ms[2].id].some(m => m.t === 'error'), 'look changed mid-game');
  r.destroy();
});
t('公開申告履歴：通過・発覚・真実を記録、出目は発覚時のみ', () => {
  const r = createRoom({ code: 'TEST', send, rng: () => 0 });
  const ms = ['A', 'B', 'C', 'D', 'E'].map(nm => r.join(nm));
  r.handle(ms[0].id, { t: 'start' });
  const G = r.R.G; G.turn = 0; G.phase = 'declare'; G.roll = 2;
  r.handle(ms[0].id, { t: 'declare', v: 4 });
  for (let i = 1; i < 5; i++) r.handle(ms[i].id, { t: 'pass' });
  let h = last(ms[1].id).room.hist[0];
  assert(h.length === 1 && h[0].r === 'ok' && h[0].roll === undefined, 'approved entry leaked roll');
  G.turn = 0; G.phase = 'declare'; G.roll = 1;
  r.handle(ms[0].id, { t: 'declare', v: 3 }); r.handle(ms[1].id, { t: 'doubt' }); r.tick(); G.review.windowEnd = G.review.doubts[0].at; r.tick();
  h = last(ms[1].id).room.hist[0];
  assert(h.length === 2 && h[1].r === 'lie' && h[1].roll === 1, 'lie entry ' + JSON.stringify(h[1]));
  r.destroy();
});
console.log(`${ok}/${n} passed (room extras)`); process.exit(ok === n ? 0 : 1);
