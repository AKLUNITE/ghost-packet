// GHOST//PACKET rule engine (v1.5). Pure, deterministic given rng + timestamps.
// Designed to run server-side later: all decisions take an explicit `now` (ms).
(function (root) {
  'use strict';
  const FACES = [1, 2, 3, 4, 'X', 'X'];
  const PACKETS = 7, GOAL_POS = 9, WINDOW_MS = 250;
  const REVIEW_CHOICES = [20, 40, 60];

  function err(code, msg) { const e = new Error(msg || code); e.code = code; throw e; }

  function createGame(opts) {
    const names = opts.names || [];
    if (names.length < 3 || names.length > 5) err('players', 'プレイヤーは3〜5人');
    const reviewSec = opts.reviewSec == null ? 40 : opts.reviewSec;
    if (!REVIEW_CHOICES.includes(reviewSec)) err('review', '審議時間は20/40/60秒');
    const rng = opts.rng || Math.random;
    const n = names.length;
    const s = {
      n, reviewMs: reviewSec * 1000, rng,
      players: names.map((name, seat) => ({
        seat, name, reserve: PACKETS - 1, active: { pos: 0 }, goals: [], lost: 0,
      })),
      turn: opts.firstSeat != null ? opts.firstSeat : Math.floor(rng() * n),
      phase: 'idle', roll: null, review: null, last: null,
      goalCount: 0, seq: 0, over: null, log: [],
    };
    return s;
  }

  const log = (s, e) => { e.i = ++s.seq; s.log.push(e); return e; };
  const P = (s, seat) => s.players[seat];
  const total = (p) => p.reserve + (p.active ? 1 : 0) + p.goals.length + p.lost;

  // ── turn start ─────────────────────────────────────────────
  function beginTurn(s, forcedRoll) {
    if (s.over) return;
    let seat = s.turn, k = 0;
    while (!P(s, seat).active && k < s.n) { seat = (seat + 1) % s.n; k++; }
    if (!P(s, seat).active) return endByScore(s, 'nomove');
    if (seat !== s.turn) log(s, { t: 'skip', from: s.turn, to: seat });
    s.turn = seat;
    s.roll = forcedRoll != null ? forcedRoll : FACES[Math.floor(s.rng() * 6)];
    s.phase = 'declare'; s.review = null;
    log(s, { t: 'turn', seat });
  }

  // ── eligibility (section 9) ───────────────────────────────
  function stakeKind(s, seat) {
    if (seat === s.turn) return null;
    const p = P(s, seat);
    if (p.active) return 'active';
    if (p.reserve === 0 && p.goals.length) return 'goal';
    return null;
  }
  const eligibleSeats = (s) => s.players.map(p => p.seat).filter(x => stakeKind(s, x));

  function declare(s, seat, value, now) {
    if (s.phase !== 'declare') err('phase', '申告フェーズではありません');
    if (seat !== s.turn) err('turn', '手番ではありません');
    if (![1, 2, 3, 4].includes(value)) err('value', '申告は1〜4');
    const elig = eligibleSeats(s);
    s.review = { value, start: now, deadline: now + s.reviewMs, elig, passes: [], doubts: [], windowEnd: null };
    s.phase = 'review';
    log(s, { t: 'declare', seat, value });
    if (elig.length === 0) resolvePass(s, 'noone');
  }

  function canAct(s, seat, now) {
    if (s.phase !== 'review') err('phase', '審議中ではありません');
    if (now >= s.review.deadline) err('timeout', '審議時間切れ');
    if (!s.review.elig.includes(seat)) err('elig', 'ダウト資格がありません');
  }

  function pass(s, seat, now) {
    canAct(s, seat, now);
    const r = s.review;
    if (r.doubts.some(d => d.seat === seat)) err('doubted', 'ダウト済み');
    if (!r.passes.includes(seat)) r.passes.push(seat);
    log(s, { t: 'pass', seat, count: r.passes.length, of: r.elig.length });
    if (!r.doubts.length && r.passes.length === r.elig.length) resolvePass(s, 'allpass');
  }

  function unpass(s, seat, now) {
    canAct(s, seat, now);
    const r = s.review, i = r.passes.indexOf(seat);
    if (i < 0) err('notpassed', 'スルーしていません');
    r.passes.splice(i, 1);
    log(s, { t: 'unpass', seat, count: r.passes.length, of: r.elig.length });
  }

  function doubt(s, seat, now, goalRank) {
    canAct(s, seat, now);
    const r = s.review;
    if (r.passes.includes(seat)) err('passed', 'スルーを取り消してからダウトしてください');
    if (r.doubts.some(d => d.seat === seat)) err('doubted', 'ダウト済み');
    if (r.windowEnd != null && now > r.windowEnd) err('closed', '先に別のダウトが成立しました');
    const kind = stakeKind(s, seat);
    let stake = { kind };
    if (kind === 'goal') {
      const g = P(s, seat).goals.find(g => g.rank === goalRank);
      if (!g) err('stake', '賭けるゴール済みパケットを指定してください');
      stake.rank = goalRank;
    }
    r.doubts.push({ seat, at: now, stake });
    if (r.windowEnd == null) r.windowEnd = now + WINDOW_MS;
    log(s, { t: 'doubtIn', seat });
  }

  // server clock tick: resolves timeout / doubt window
  function tick(s, now) {
    if (s.phase !== 'review') return false;
    const r = s.review;
    if (r.doubts.length) { if (now >= r.windowEnd) { resolveDoubt(s); return true; } }
    else if (now >= r.deadline) { resolvePass(s, 'timeout'); return true; }
    return false;
  }

  // ── resolution ─────────────────────────────────────────────
  function refill(s, p) {
    if (!p.active && p.reserve > 0) { p.reserve--; p.active = { pos: 0 }; log(s, { t: 'insert', seat: p.seat }); }
  }
  function destroyActive(s, p, cause) {
    p.active = null; p.lost++;
    log(s, { t: 'destroy', seat: p.seat, cause });
    refill(s, p);
  }
  function advance(s, p, v) {
    const from = p.active.pos; p.active.pos += v;
    log(s, { t: 'move', seat: p.seat, from, to: Math.min(p.active.pos, GOAL_POS), by: v });
    if (p.active.pos >= GOAL_POS) {
      const rank = ++s.goalCount;
      p.goals.push({ rank }); p.active = null;
      log(s, { t: 'goal', seat: p.seat, rank });
      if (p.goals.length >= 3) { s.over = { type: 'three', winners: [p.seat], standings: standings(s) }; log(s, { t: 'win3', seat: p.seat }); return; }
      refill(s, p);
    }
  }

  function resolvePass(s, why) {
    const r = s.review, p = P(s, s.turn);
    s.last = { kind: 'pass', why, seat: s.turn, value: r.value };
    log(s, { t: 'passed', why, seat: s.turn, value: r.value });
    advance(s, p, r.value);
    finish(s);
  }

  function resolveDoubt(s) {
    const r = s.review, sender = P(s, s.turn);
    // clockwise from the seat after the sender among those in the window
    const inWin = r.doubts.filter(d => d.at <= r.windowEnd);
    const dist = (seat) => (seat - s.turn + s.n) % s.n;
    const ch = inWin.slice().sort((a, b) => dist(a.seat) - dist(b.seat))[0];
    const c = P(s, ch.seat);
    const truth = r.value === s.roll;
    s.last = { kind: 'doubt', seat: s.turn, challenger: ch.seat, value: r.value, roll: s.roll, truth, stake: ch.stake, contenders: inWin.map(d => d.seat) };
    log(s, { t: 'reveal', seat: s.turn, challenger: ch.seat, value: r.value, roll: s.roll, truth });
    if (!truth) {
      destroyActive(s, sender, 'cat');
      if (ch.stake.kind === 'active') advance(s, c, r.value);
    } else {
      // challenger loses stake first so a game-ending advance scores the true state
      if (ch.stake.kind === 'active') destroyActive(s, c, 'misaudit');
      else {
        const gi = c.goals.findIndex(g => g.rank === ch.stake.rank);
        c.goals.splice(gi, 1); c.lost++;
        log(s, { t: 'goalLost', seat: c.seat, rank: ch.stake.rank });
      }
      advance(s, sender, r.value);
    }
    finish(s);
  }

  function finish(s) {
    s.phase = s.over ? 'over' : 'result';
    if (!s.over && !s.players.some(p => p.active)) endByScore(s, 'nomove');
    for (const p of s.players) if (total(p) !== PACKETS) err('invariant', 'パケット総数が7でない: ' + p.name);
  }

  // called after result display
  function nextTurn(s, forcedRoll) {
    if (s.over) return;
    s.turn = (s.turn + 1) % s.n;
    beginTurn(s, forcedRoll);
  }

  // host-invoked skip when the turn player has been disconnected >90s (拡張・運用ルール)
  function skipTurn(s) {
    if (s.phase !== 'declare') err('phase', '申告前のみスキップ可能');
    log(s, { t: 'skipDisc', seat: s.turn });
    nextTurn(s);
  }

  // 勝敗はゴールしたパケットの数だけ。先に3個ゴールした人が優勝（2026-11 ユーザー決定。到着順位の点数とゴール台の上限は廃止）。
  // 誰も送れなくなって終わったときだけ、ゴール数の多い人が勝ち（同数は同時優勝）
  function score(p) { return p.goals.length; }
  function standings(s) {
    const rows = s.players.map(p => ({ seat: p.seat, score: score(p), goals: p.goals.length }));
    rows.sort((a, b) => b.score - a.score);
    rows.forEach((r, i) => { r.place = i && rows[i - 1].score === r.score ? rows[i - 1].place : i + 1; });
    return rows;
  }
  function endByScore(s, why) {
    if (s.over) return;
    const st = standings(s);
    s.over = { type: why, winners: st.filter(r => r.place === 1).map(r => r.seat), standings: st };
    s.phase = 'over';
    log(s, { t: 'end', why });
  }

  // per-viewer sanitized view (server → client)
  function view(s, seat) {
    const showRoll = (s.phase === 'declare' || s.phase === 'review') && seat === s.turn;
    return {
      n: s.n, turn: s.turn, phase: s.phase, goalCount: s.goalCount, winAt: 3,
      players: s.players.map(p => ({ seat: p.seat, name: p.name, reserve: p.reserve, pos: p.active ? p.active.pos : null, goals: p.goals.map(g => g.rank), lost: p.lost, score: score(p) })),
      myRoll: showRoll ? s.roll : undefined,
      review: s.review && { value: s.review.value, deadline: s.review.deadline, passCount: s.review.passes.length, eligCount: s.review.elig.length, iPassed: s.review.passes.includes(seat), myStake: stakeKind(s, seat) },
      last: s.last && (s.last.kind === 'doubt' ? s.last : { kind: 'pass', seat: s.last.seat, value: s.last.value, why: s.last.why }),
      over: s.over,
    };
  }

  const api = { FACES, PACKETS, GOAL_POS, WINDOW_MS, createGame, beginTurn, skipTurn, declare, pass, unpass, doubt, tick, nextTurn, stakeKind, eligibleSeats, view, score, standings, total };
  if (typeof module !== 'undefined') module.exports = api; else root.GP = api;
})(this);
