// T01–T17 acceptance tests (設計書 §14). Runs in node and in the browser page.
(function (root) {
  const GP = typeof module !== 'undefined' ? require('../../engine.js') : root.GP;
  const names = (k) => ['A', 'B', 'C', 'D', 'E'].slice(0, k);
  const mk = (k = 5, sec = 40) => { const s = GP.createGame({ names: names(k), reviewSec: sec, firstSeat: 0, rng: () => 0 }); return s; };
  function assert(c, m) { if (!c) throw new Error(m); }
  const T = [];
  const t = (id, title, fn) => T.push({ id, title, fn });

  t('T01', '出目2・申告4・ダウトなし → 4前進、出目非公開', () => {
    const s = mk(); GP.beginTurn(s, 2); GP.declare(s, 0, 4, 0);
    GP.tick(s, 40000);
    assert(s.players[0].active.pos === 4, 'pos=' + s.players[0].active.pos);
    assert(s.last.kind === 'pass' && s.last.roll === undefined, 'roll leaked in result');
    assert(GP.view(s, 1).myRoll === undefined && GP.view(s, 0).myRoll === undefined, 'roll visible after');
  });
  t('T02', '出目2・申告4・ダウトあり → 送信者消滅、挑戦者4前進', () => {
    const s = mk(); GP.beginTurn(s, 2); GP.declare(s, 0, 4, 0);
    GP.doubt(s, 2, 1000); GP.tick(s, 1250);
    assert(s.players[0].lost === 1 && s.players[0].active.pos === 0 && s.players[0].reserve === 5, 'sender');
    assert(s.players[2].active.pos === 4, 'challenger pos');
    assert(s.log.some(e => e.t === 'destroy' && e.cause === 'cat'), 'cat event');
  });
  t('T03', '出目4・申告4・ダウトあり → 挑戦者消滅、送信者4前進', () => {
    const s = mk(); GP.beginTurn(s, 4); GP.declare(s, 0, 4, 0);
    GP.doubt(s, 1, 500); GP.tick(s, 800);
    assert(s.players[0].active.pos === 4, 'sender');
    assert(s.players[1].lost === 1 && s.players[1].active.pos === 0, 'challenger');
  });
  t('T04', '出目4・申告2・ダウトあり → 少なく申告も虚偽', () => {
    const s = mk(); GP.beginTurn(s, 4); GP.declare(s, 0, 2, 0);
    GP.doubt(s, 1, 500); GP.tick(s, 800);
    assert(s.last.truth === false && s.players[0].lost === 1, 'not lie');
    assert(s.players[1].active.pos === 2, 'reward uses declared value');
  });
  t('T05', '出目×・申告1 → 監査で強制ブラフ', () => {
    const s = mk(); GP.beginTurn(s, 'X'); GP.declare(s, 0, 1, 0);
    GP.doubt(s, 3, 100); GP.tick(s, 400);
    assert(s.last.truth === false && s.last.roll === 'X', 'X not lie');
    assert(s.players[3].active.pos === 1, 'reward');
  });
  t('T06', '40秒で全員スルー → 即転送、出目非公開', () => {
    const s = mk(); GP.beginTurn(s, 1); GP.declare(s, 0, 3, 0);
    [1, 2, 3, 4].forEach((x, i) => GP.pass(s, x, 1000 + i));
    assert(s.phase === 'result' && s.last.why === 'allpass', 'not early');
    assert(s.players[0].active.pos === 3, 'pos');
    assert(s.last.roll === undefined, 'roll leaked');
  });
  t('T07', '一部スルー後に取り消し → 審議継続・再ダウト可', () => {
    const s = mk(); GP.beginTurn(s, 1); GP.declare(s, 0, 3, 0);
    GP.pass(s, 1, 100); GP.pass(s, 2, 200); GP.unpass(s, 2, 300);
    assert(s.phase === 'review' && s.review.passes.length === 1, 'state');
    GP.pass(s, 3, 400); GP.pass(s, 4, 500);
    assert(s.phase === 'review', 'resolved too early');
    GP.doubt(s, 2, 600); GP.tick(s, 900);
    assert(s.last.challenger === 2, 'challenger');
  });
  t('T08', '期限までダウトなし → スルー、期限後ダウト無効', () => {
    const s = mk(); GP.beginTurn(s, 2); GP.declare(s, 0, 4, 0);
    let rej = false; try { GP.doubt(s, 1, 40000); } catch (e) { rej = e.code === 'timeout'; }
    assert(rej, 'late doubt accepted');
    GP.tick(s, 40000);
    assert(s.last.why === 'timeout' && s.players[0].active.pos === 4, 'not timeout pass');
  });
  t('T09', '2人が250ms内にダウト → 時計回り優先で1名', () => {
    const s = mk(5); GP.beginTurn(s, 4); s.turn = 2; s.roll = 4; s.phase = 'declare';
    GP.declare(s, 2, 4, 0);
    GP.doubt(s, 0, 1000); GP.doubt(s, 4, 1200);
    let late = false; try { GP.doubt(s, 1, 1300); } catch (e) { late = e.code === 'closed'; }
    assert(late, 'outside window accepted');
    GP.tick(s, 1250);
    assert(s.last.challenger === 4, 'expected seat 4 (closer clockwise), got ' + s.last.challenger);
    assert(s.players[4].lost === 1 && s.players[0].lost === 0, 'penalty spread');
  });
  t('T10', '位置8→申告1 → ゴール、得点付与', () => {
    const s = mk(); s.players[0].active.pos = 8; GP.beginTurn(s, 1); GP.declare(s, 0, 1, 0); GP.tick(s, 40000);
    assert(s.players[0].goals.length === 1 && s.players[0].goals[0].rank === 1, 'goal');
    assert(s.players[0].active.pos === 0 && s.players[0].reserve === 5, 'refill');
  });
  t('T11', '3個目のゴール → 即勝利（得点比較なし）', () => {
    const s = mk(); const p = s.players[0];
    p.goals = [{ rank: 1 }, { rank: 2 }]; p.reserve = 4; p.active.pos = 8; s.goalCount = 9;
    s.players[1].goals = [{ rank: 9 }]; s.players[1].reserve = 5;
    GP.beginTurn(s, 1); GP.declare(s, 0, 1, 0); GP.tick(s, 40000);
    assert(s.over && s.over.type === 'three' && s.over.winners[0] === 0, 'no instant win');
  });
  function exhaust(s, seat, goals) { const p = s.players[seat]; p.active = null; p.reserve = 0; p.goals = goals.map(r => ({ rank: r })); p.lost = 7 - goals.length; }
  t('T12', 'パケット使い切り・ゴール済みのみ → 賭けてダウト可', () => {
    const s = mk(); exhaust(s, 1, [3]); s.goalCount = 3;
    GP.beginTurn(s, 'X'); GP.declare(s, 0, 2, 0);
    assert(GP.stakeKind(s, 1) === 'goal', 'kind');
    let need = false; try { GP.doubt(s, 1, 10); } catch (e) { need = e.code === 'stake'; }
    assert(need, 'stake not required');
    GP.doubt(s, 1, 20, 3); GP.tick(s, 300);
    assert(s.players[0].lost === 1, 'sender not destroyed');
    assert(s.players[1].goals.length === 1 && !s.players[1].active, 'no reward expected');
  });
  t('T13', 'T12のダウト失敗 → 賭けたゴール済みと得点が消える', () => {
    const s = mk(); exhaust(s, 1, [3, 5]); s.goalCount = 5;
    GP.beginTurn(s, 2); GP.declare(s, 0, 2, 0); GP.doubt(s, 1, 20, 5); GP.tick(s, 300);
    assert(s.players[1].goals.length === 1 && s.players[1].goals[0].rank === 3, 'goal not removed');
    assert(GP.score(s.players[1]) === 3 && GP.total(s.players[1]) === 7, 'score/total');
  });
  t('T14', '順位3の駒が消える → 3は欠番、次は4点', () => {
    const s = mk(); exhaust(s, 1, [3]); s.players[2].goals = [{ rank: 1 }, { rank: 2 }]; s.players[2].reserve = 4; s.goalCount = 3;
    GP.beginTurn(s, 2); GP.declare(s, 0, 2, 0); GP.doubt(s, 1, 20, 3); GP.tick(s, 300);
    s.players[3].active.pos = 8; s.turn = 3; s.phase = 'declare'; s.roll = 1;
    GP.declare(s, 3, 1, 1000); GP.tick(s, 41000);
    assert(s.players[3].goals[0].rank === 4, 'got ' + s.players[3].goals[0].rank);
  });
  t('T15', '送信可能者が1名 → 即終了せず通常処理', () => {
    const s = mk(); [1, 2, 3, 4].forEach((x, i) => exhaust(s, x, i === 0 ? [1] : []));
    s.goalCount = 1; GP.beginTurn(s, 3); GP.declare(s, 0, 3, 0);
    assert(s.phase === 'review' && s.review.elig.length === 1, 'seat1 should be eligible');
    GP.pass(s, 1, 10);
    assert(!s.over && s.players[0].active.pos === 3, 'ended early');
    exhaust(s, 1, []); GP.nextTurn(s, 2);
    assert(s.turn === 0, 'turn should come back to seat 0');
    GP.declare(s, 0, 4, 100);
    assert(s.last.why === 'noone' && s.players[0].active.pos === 7 && !s.over, 'auto pass');
  });
  t('T16', '送信可能者0 → 得点合計で確定（同点は同順位）', () => {
    const s = mk(); exhaust(s, 1, [1, 7]); exhaust(s, 2, [3, 5]); exhaust(s, 3, [2, 6]); exhaust(s, 4, [4]);
    const p = s.players[0]; p.reserve = 0; p.lost = 6; p.active.pos = 8; s.goalCount = 7;
    GP.beginTurn(s, 1); GP.declare(s, 0, 1, 0); GP.tick(s, 40000);
    assert(s.over && s.over.type === 'nomove', 'type ' + (s.over && s.over.type));
    assert(s.over.winners.length === 4 && !s.over.winners.includes(4), 'expected 4-way tie at 8, got ' + s.over.winners);
  });
  t('T17', '5人戦で10番目のゴール → 得点勝負で終了', () => {
    const s = mk(5); let r = 1;
    s.players.forEach((p, i) => { if (i) { p.goals = [{ rank: r++ }, { rank: r++ }]; p.reserve -= 2; } });
    const p0 = s.players[0]; p0.goals = [{ rank: 9 }]; p0.reserve -= 1; p0.active.pos = 8; s.goalCount = 9;
    GP.beginTurn(s, 1); GP.declare(s, 0, 1, 0); GP.tick(s, 40000);
    assert(s.over && s.over.type === 'slots', 'type ' + (s.over && s.over.type));
    assert(s.over.winners[0] === 0 && GP.score(p0) === 19, 'winner/score');
  });

  t('X01', '3人戦が開始でき、得点枠は6', () => {
    const s = mk(3); assert(s.maxRank === 6, 'maxRank ' + s.maxRank);
    GP.beginTurn(s, 2); GP.declare(s, 0, 2, 0); GP.pass(s, 1, 10); GP.pass(s, 2, 20);
    assert(s.players[0].active.pos === 2, 'pos');
  });
  t('X02', '2人・6人は開始できない', () => {
    for (const k of [2, 6]) { let ok = false; try { GP.createGame({ names: Array.from({ length: k }, (_, i) => 'P' + i) }); } catch (e) { ok = e.code === 'players'; } assert(ok, k + '人が通った'); }
  });
  function run() {
    return T.map(x => { try { x.fn(); return { id: x.id, title: x.title, ok: true }; } catch (e) { return { id: x.id, title: x.title, ok: false, msg: e.message }; } });
  }
  if (typeof module !== 'undefined') {
    const res = run(); res.forEach(r => console.log((r.ok ? 'PASS ' : 'FAIL ') + r.id + ' ' + r.title + (r.msg ? '  ← ' + r.msg : '')));
    console.log(res.filter(r => r.ok).length + '/' + res.length + ' passed'); process.exitCode = res.every(r => r.ok) ? 0 : 1;
  } else root.GPTests = { run };
})(this);
