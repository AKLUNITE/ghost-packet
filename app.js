// GHOST//PACKET client: transports (online / practice), HUD, and the effects director.
import { Scene3D, COLORS, STYLE_NAMES } from './scene.js';
import { Audio } from './audio.js';
import { P2PHost, P2PClient, p2pAvailable } from './p2p.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const store = { get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }, del(k) { try { localStorage.removeItem(k); } catch (e) {} } };
const STAMPS = ['怪しい！', '信じて', 'お前が行け', 'ｗｗｗ', 'ナイス', 'やめて〜'];
// every colour has a shape too (colour-blind safety)
const SYM_PATHS = ['M12 2L22 12L12 22L2 12Z', 'M12 3.5A8.5 8.5 0 1 1 11.99 3.5Z', 'M12 2.5L22 20.5H2Z', 'M4 4H20V20H4Z',
  'M12 2L14.6 9.1H22L16 13.6L18.2 21L12 16.6L5.8 21L8 13.6L2 9.1H9.4Z', 'M9 2H15V9H22V15H15V22H9V15H2V9H9Z', 'M12 2L21.5 9L18 21H6L2.5 9Z', 'M7 3H17L22 12L17 21H7L2 12Z'];
const symSvg = (k, color, size = 12) => `<svg class="sym" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true"><path d="${SYM_PATHS[k % 8]}" fill="${color}"/></svg>`;
function palOf(seat) {
  const m = ST.room && ST.room.members.find(x => x.seat === seat);
  const c = m && m.color != null ? m.color : seat;
  return { hex: COLORS[c], sym: c, style: m && m.style != null ? m.style : seat, bot: !!(m && m.bot) };
}
const col = (i) => palOf(i).hex;

const A = new Audio();
let S3 = null;
try { S3 = new Scene3D($('#gl')); S3.onRestore = () => hardSync(); } catch (e) { console.error(e); $('#gl').insertAdjacentHTML('afterend', `<div class="nogl">3D表示に対応していないブラウザです（WebGL2が必要）</div>`); }

const ST = {
  t: null, mode: null, sync: null, you: null, room: null, view: null,
  name: (store.get('gp.name') || ''), cfg: { n: 5, sec: 40 }, online: false,
  deadline: 0, frozen: false, fxQ: [], fxBusy: false, stake: null, logs: [],
  setupKey: '', roll: { id: -1, st: 'done' }, pick: null, turnSeq: 0, lastTickSec: null, bubbles: [], overShown: false, reviewKey: null, doubtShown: null,
  layout: 'pc', peeking: false, peekedSeq: -1, sheet: null,
};
const COARSE = matchMedia('(pointer: coarse)').matches;
const CAN_VIBE = typeof navigator.vibrate === 'function';
ST.guard = store.get('gp.guard'); if (ST.guard == null) ST.guard = COARSE;   // touch devices: hold-to-peek by default
ST.vibe = store.get('gp.vibe'); if (ST.vibe == null) ST.vibe = true;
ST.showLog = store.get('gp.log'); if (ST.showLog == null) ST.showLog = true;
function applyLog() { document.body.classList.toggle('nolog', !ST.showLog); const b = $('#bLogT'); if (b) { b.setAttribute('aria-pressed', ST.showLog); b.title = ST.showLog ? '通信ログを隠す' : '通信ログを表示'; } }
ST.calm = store.get('gp.calm'); if (ST.calm == null) ST.calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
function vib(p) { if (ST.vibe && CAN_VIBE && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) { try { navigator.vibrate(p); } catch (e) {} } }

// ───────── device layout: pc | port | land ─────────
function layoutOf() { const w = innerWidth, h = innerHeight; if (w >= 1000 && h >= 600) return 'pc'; return w > h ? 'land' : 'port'; }
function applyLayout(force) {
  const L = layoutOf(), b = document.body;
  if (matchMedia('(pointer: fine)').matches) b.dataset.fine = ''; else delete b.dataset.fine;
  if (L !== ST.layout || force) { ST.layout = L; b.dataset.layout = L; if (S3) S3.setProfile(L); if (ST.room) render(); }
  fitCanvas();
}
// keep the 3D table inside the area the HUD leaves free on phones
function fitCanvas() {
  const st = document.documentElement.style, hud = $('#hud');
  let top = 0, bottom = 0, right = 0;
  if (hud && !hud.hidden && ST.layout === 'port') {
    const rail = $('#rail').getBoundingClientRect(), dock = $('#dock').getBoundingClientRect();
    top = Math.max(0, Math.round(rail.bottom + 4)); bottom = Math.max(0, Math.round(innerHeight - dock.top + 4));
  } else if (hud && !hud.hidden && ST.layout === 'land') {
    const ban = $('#banner').getBoundingClientRect(); right = Math.max(0, Math.round(innerWidth - ban.left + 6));
  }
  st.setProperty('--glTop', top + 'px'); st.setProperty('--glBottom', bottom + 'px'); st.setProperty('--glRight', right + 'px');
}
addEventListener('resize', () => applyLayout());
addEventListener('orientationchange', () => setTimeout(() => applyLayout(), 250));
// screen stays on during a match (phones)
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !ST.wake && document.visibilityState === 'visible') { ST.wake = await navigator.wakeLock.request('screen'); ST.wake.addEventListener('release', () => { ST.wake = null; }); }
    if (!on && ST.wake) { ST.wake.release(); ST.wake = null; }
  } catch (e) { ST.wake = null; }
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && ST.room && ST.room.phase === 'game') keepAwake(true); });

// ───────── transports ─────────
class Online {
  constructor(onMsg) { this.onMsg = onMsg; this.url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'; this.closed = false; this.q = []; }
  open() {
    return new Promise((res, rej) => {
      let done = false, opened = false; const ws = this.ws = new WebSocket(this.url);
      const to = setTimeout(() => { if (!done) { done = true; try { ws.close(); } catch (e) {} rej(new Error('timeout')); } }, 4000);
      ws.onopen = () => { opened = true; if (done) { try { ws.close(); } catch (e) {} return; } done = true; clearTimeout(to); this.q.splice(0).forEach(m => ws.send(m)); res(); };
      ws.onerror = () => { if (!done) { done = true; clearTimeout(to); rej(new Error('ws')); } };
      ws.onmessage = (e) => { try { this.onMsg(JSON.parse(e.data)); } catch (err) { console.error(err); } };
      // only a socket that actually connected and is still the current one may start a reconnect
      ws.onclose = () => { if (opened && ws === this.ws && !this.closed) this.lost(); };
    });
  }
  send(o) { const m = JSON.stringify(o); if (this.ws && this.ws.readyState === 1) this.ws.send(m); else if (this.q.length < 50) this.q.push(m); }
  lost() {
    if (this.reconnecting || this.closed) return; // exactly one reconnect loop at a time
    this.reconnecting = true;
    $('#reconn').hidden = false;
    const retry = async (k) => {
      if (this.closed) { this.reconnecting = false; return; }
      try {
        await this.open(); this.reconnecting = false;
        const sess = store.get('gp.session');
        if (sess) this.send({ t: 'join', code: sess.code, token: sess.token, name: ST.name });
        $('#reconn').hidden = true; toast('再接続しました');
      } catch (e) { setTimeout(() => retry(k + 1), Math.min(5000, 800 + k * 700)); }
    };
    retry(0);
  }
  close() { this.closed = true; try { this.ws.close(); } catch (e) {} }
}
class Local {
  constructor(onMsg) {
    this.room = GPRoom.createRoom({ code: '練習', send: (id, m) => { if (id === this.me) setTimeout(() => onMsg(m), 0); } });
    this.iv = setInterval(() => this.room.tick(), 50);
  }
  start(name, n, sec) {
    const m = this.room.join(name); this.me = m.id;
    const L = myLook(); this.room.handle(m.id, { t: 'look', color: L.color, style: L.style });
    this.room.handle(m.id, { t: 'setSec', sec });
    for (let i = 1; i < n; i++) this.room.handle(m.id, { t: 'addBot' });
    this.room.handle(m.id, { t: 'start' });
  }
  send(o) { if (o.t === 'lobby') { this.room.handle(this.me, o); this.room.handle(this.me, { t: 'start' }); return; } this.room.handle(this.me, o); }
  close() { clearInterval(this.iv); this.room.destroy(); }
}

function send(o) { if (ST.t) ST.t.send(o); }

// ───────── messages ─────────
function onMsg(m) {
  if (m.t === 'error') {
    A.sfx('err');
    if (m.fatal) {
      store.del('gp.session'); ST.joinErr = m.msg;
      if (ST.p2p) { ST.p2p.close(); ST.p2p = null; ST.t = null; $('#reconn').hidden = true; }
      if (ST.room && ST.p2p === null && m.code === 'hostgone') { toast(m.msg); ST.mode = null; ST.room = null; ST.view = null; ST.setupKey = ''; ST.fxQ = []; hideDuel(); $('#hud').hidden = true; renderTitle(); return; }
      if (!ST.room) renderTitle(); else toast(m.msg);
    }
    else toast(m.msg);
    return;
  }
  if (m.t === 'pong') { if (m.at) { ST.ping = Date.now() - m.at; renderPing(); } return; }
  if (m.t !== 'sync') return;
  const prevPhase = ST.room && ST.room.phase;
  // an audit result arrives instantly, but we keep showing the pre-result board until the reveal moment
  if ((m.events || []).some(e => e.t === 'reveal') && ST.view && ST.view.phase === 'review') { ST.held = ST.view; ST.heldRoom = ST.room; ST.suspense = true; }
  ST.sync = m; ST.you = m.you; ST.room = m.room; ST.view = m.view;
  if (ST.mode === 'online') store.set('gp.session', { code: m.room.code, token: m.you.token, host: !!ST.isP2PHost, at: Date.now() });
  if (m.view && m.view.phase === 'review') {
    const key = m.view.turn + ':' + m.view.review.deadline;
    if (m.room.doubters.length) ST.frozen = true; else { ST.frozen = false; ST.deadline = performance.now() + m.room.reviewLeft; }
    if (ST.reviewKey !== key) { ST.reviewKey = key; ST.stake = null; ST.doubtShown = null; }
  }
  if (m.room.phase === 'game' && S3) {
    const key = m.room.members.map(x => x.name).join('|') + '#' + m.you.seat;
    if (key !== ST.setupKey || prevPhase !== 'game') { ST.setupKey = key; ST.fxQ = []; ST.overShown = false; setupBoard(); }
  }
  for (const e of m.events || []) queue(e);
  if (ST.mode === 'online' && m.room.phase === 'lobby' && ST.lookSentFor !== m.room.code + m.you.id) {
    ST.lookSentFor = m.room.code + m.you.id; const L = myLook(), mine = m.room.members.find(x => x.id === m.you.id);
    const taken = m.room.members.some(x => x.id !== m.you.id && x.color === L.color);
    if (mine && (mine.style !== L.style || (!taken && mine.color !== L.color))) send({ t: 'look', color: taken ? undefined : L.color, style: L.style });
  }
  render();
  keepAwake(m.room.phase === 'game' && !(m.view && m.view.over));
  if (prevPhase !== m.room.phase) A.setMode(m.room.phase === 'lobby' ? 'lobby' : 'game');
}

async function setupBoard() {
  const players = ST.room.members.filter(x => x.seat != null).sort((a, b) => a.seat - b.seat).map(x => ({ name: x.name, color: x.color, style: x.style, bot: x.bot }));
  ST.boardReady = false; ST.boardKind = 'game'; ST.boardKey = 'game'; S3.setDemo(false);
  await S3.setup(players, ST.you.seat);
  ST.boardReady = true;
  hardSync();
}
function hardSync() {
  if (!S3 || !ST.view || !ST.boardReady) return;
  for (const p of ST.view.players) {
    const S = S3.seats[p.seat]; if (!S) continue;
    if (p.pos == null) S3.setPacket(p.seat, null);
    else if (!S.vis || Math.abs(S.pos - p.pos) > 0.01) S3.setPacket(p.seat, p.pos, !S.vis);
    S3.setReserve(p.seat, p.reserve);
  }
  S3.setGoals(Math.max(0, ...ST.view.players.map(p => p.goals.length)), 3);
}

// ───────── effects director ─────────
function queue(e) { ST.fxQ.push(e); if (!ST.fxBusy) runQ(); }
async function runQ() {
  ST.fxBusy = true;
  while (ST.fxQ.length) {
    const e = ST.fxQ.shift();
    let w = 0; try { w = await fx(e) || 0; } catch (err) { console.error(err); }
    if (w) await sleep(ST.fxQ.length > 24 ? 0 : w);
  }
  ST.fxBusy = false; endSuspense(); hardSync(); render();
}
const P = (i) => ST.view && ST.view.players[i];
const DV = () => (ST.suspense && ST.held) || ST.view;      // what the board shows (held during the reveal suspense)
const RV = () => (ST.suspense && ST.heldRoom) || ST.room;
function endSuspense() { if (!ST.suspense) return; ST.suspense = false; ST.held = ST.heldRoom = null; render(); }
const nm = (i) => { const p = P(i); return p ? esc(p.name) : '?'; };
const who = (i) => { const p = palOf(i); return `<span class="who">${symSvg(p.sym, p.hex, 13)}${nm(i)}${p.bot ? '<span class="cpu">CPU</span>' : ''}</span>`; };
const me = () => ST.you && ST.you.seat;

async function fx(e) {
  const ok = S3 && ST.boardReady;
  switch (e.t) {
    case 'start': splash('HACK START', 'gold', 'ハッキング開始', 1400); A.sfx('rare', { tier: 3 }); log('対戦開始'); return 900;
    case 'turn': {
      ST.turnSeq++; ST.peeking = false; hideDuel(); if (S3) S3.clearTarget(); endSuspense();
      log(`— 手番：<span class="k" style="color:${col(e.seat)}">${nm(e.seat)}</span>`);
      if (ok) S3.focus(e.seat, 1.0);
      ST.pick = null; otherRattle(false); if (S3) S3.preview(null);
      if (e.seat === me()) { A.sfx('myturn'); vib([30, 50, 30]); splash('YOUR TURN', 'gold', 'カップを振ってください', 1100); beginRoll(); }
      else A.sfx('turn');
      return 300;
    }
    case 'skip': log('送信不能のため手番を飛ばした'); return 0;
    case 'skipDisc': log(`${nm(e.seat)} は切断中のため手番をスキップ（ホスト操作）`); return 0;
    case 'rollfx': {
      if (e.seat === me()) return 0;
      if (e.s === 'shake') otherRattle(true);
      else { otherRattle(false); A.sfx('slam', { g: 0.55 }); }
      renderStatus(); renderDock(); renderBanner(); return 0;
    }
    case 'declare': {
      otherRattle(false); ST.pick = null; if (S3) S3.preview(null);
      log(`${nm(e.seat)} が <b class="k">${e.value}</b> ノードを申告`);
      if (ok) S3.fxDeclare(e.seat, e.value); A.sfx('declare', { v: e.value }); A.sfx('clack');
      splash(String(e.value), e.value === 4 ? 'rain' : 'white', `${P(e.seat) ? P(e.seat).name : ''} の申告`, 1100);
      return 500;
    }
    case 'pass': A.sfx('pass'); if (ok) S3.react(e.seat, 'pass'); return 0;
    case 'unpass': A.sfx('unpass'); return 0;
    case 'doubtIn': {
      if (ST.doubtShown === ST.reviewKey) return 0; ST.doubtShown = ST.reviewKey;
      const sd = ST.view.turn, ch = e.seat, value = ST.view.review ? ST.view.review.value : (ST.view.last && ST.view.last.value), role = roleOf(ch, sd);
      ST.callAt = performance.now(); ST.duelStage = 'call'; ST.duelData = { ch, sd, value };
      A.sfx('doubt'); A.duck(ST.calm ? 4 : 6.5); flashBar(); vib(role === 'sd' ? [120, 60, 120, 60, 120] : role === 'ch' ? [40] : [70]);
      const head = role === 'ch' ? ['あなたがダウト！', `${P(sd).name} の「${value}」を監査`] : role === 'sd' ? ['ダウトされた！', `${P(ch).name} があなたの「${value}」を監査`] : ['DOUBT!!', `${P(ch).name} → ${P(sd).name} の「${value}」`];
      splash(head[0], 'red rstamp', head[1], 1500);
      showDuel('call', { ch, sd, value });
      if (ok) { S3.fxDoubt(ch); S3.fxTarget(ch, sd); } return 300;
    }
    case 'passed': {
      const why = { allpass: '全員スルー', timeout: '時間切れ', noone: 'ダウト資格者なし' }[e.why];
      log(`承認（${why}）：${nm(e.seat)} が ${e.value} 前進。出目は非公開`);
      if (ok) { S3.clearClaim(); S3.fxApprove(e.seat, e.value, 0); } A.sfx('approve');
      splash('承認', 'mint rstamp', `${why}・+${e.value} ノード`, 1100); return 450;
    }
    case 'streak': if (e.n >= 2) { A.sfx('rare', { tier: e.n >= 4 ? 4 : 3 }); if (ok) S3.floatText(`${e.n}連続通過!!`, [0, 6.4, 0], { size: 120, grad: ['#fff6b0', '#ff9a3c', '#ff4fd8'], wW: 9, w: 900, glow: 0.9, dur: 2 }); } return 0;
    case 'reveal': {
      const L = ST.view && ST.view.last;
      const R = e.roll === 'X' ? '×' : e.roll, chN = P(e.challenger).name, sdN = P(e.seat).name;
      const d = { ch: e.challenger, sd: e.seat, value: e.value, roll: e.roll, truth: e.truth, stake: L ? L.stake : { kind: 'active' }, contenders: L ? L.contenders : [] };
      const K = ST.calm ? 0.6 : 1, role = roleOf(e.challenger, e.seat);
      ST.duelData = d; let rollIv = null;
      try {
        // 1) let the DOUBT call land
        const since = performance.now() - (ST.callAt || 0);
        ST.duelStage = 'call'; showDuel('call', d); renderBanner(); renderDock();
        if (since < 1300 * K) await sleep(1300 * K - since);
        // 2) scan: the packet shakes, a progress bar fills, heartbeats speed up
        ST.scanMs = Math.round(1800 * K); ST.duelStage = 'scan'; showDuel('scan', d); renderBanner(); renderDock();
        A.sfx('scan', { len: 1.8 * K }); if (ok) { S3.clearClaim(); S3.scanPacket(e.seat, 1.8 * K); S3.focus(e.seat, 5 * K); }
        [0, 0.55, 1.0, 1.35, 1.6].forEach(t => setTimeout(() => A.sfx('heart'), t * 1000 * K));
        if (role !== 'by') vib([20, 200, 20, 150, 20, 100, 20]);
        await sleep(1800 * K);
        // 3) flip: the real roll spins on the card and in the HUD, slowing down to a stop
        ST.duelStage = 'flip'; showDuel('flip', d); renderBanner(); renderDock();
        if (ok) S3.fxReveal(e.seat, e.value, e.roll, e.truth, 2.3 * K);
        A.sfx('drumroll', { len: 2.2 * K });
        const syms = ['1', '2', '3', '4', '×']; let gap = 60, t0 = performance.now();
        const roll = () => { document.querySelectorAll('.droll').forEach(el => { el.textContent = syms[Math.floor(Math.random() * 5)]; }); gap *= 1.09; if (performance.now() - t0 < 2100 * K) rollIv = setTimeout(roll, gap); };
        roll();
        await sleep(2300 * K);
      } finally { clearTimeout(rollIv); }
      // 4) result
      A.sfx('hit'); A.sfx('cut');
      if (L && L.contenders && L.contenders.length > 1) log(`同時ダウト${L.contenders.length}名 → 時計回り優先で ${nm(e.challenger)}`);
      log(`${nm(e.challenger)} が ${nm(e.seat)} の「${e.value}」をダウト → 実際 <b class="k">${R}</b> で${e.truth ? '本当' : '嘘'} → <b class="k">${e.truth ? nm(e.seat) : nm(e.challenger)} の勝ち</b>`);
      ST.duelStage = 'result'; showDuel('result', d); endSuspense();
      const iWon = (role === 'ch' && !e.truth) || (role === 'sd' && e.truth);
      const gain = d.stake.kind === 'active' ? `+${e.value}前進` : '前進なし';
      const H = role === 'ch' ? (e.truth ? ['外した…', `${sdN}は本当だった。あなたの${d.stake.kind === 'active' ? 'パケット' : 'ゴール済み1個'}を没収`] : ['見破った！', `${sdN}の嘘を暴いた（実際 ${R}）・あなた ${gain}`])
        : role === 'sd' ? (e.truth ? ['守り切った！', `${chN}の誤監査・あなた +${e.value}前進`] : ['バレた…', `${chN}に見破られた・パケットは猫動画に`])
        : (e.truth ? ['ダウト失敗', `${sdN}は本当だった（実際 ${R}）→ ${sdN}の勝ち`] : ['ダウト成功', `${sdN}の嘘（実際 ${R}）→ ${chN}の勝ち`]);
      splash(H[0], (role === 'by' ? 'cyan' : iWon ? 'gold' : 'red') + ' rstamp', H[1], 1900);
      if (role === 'by') A.sfx(e.truth ? 'misaudit' : 'busted');
      else if (iWon) { A.sfx('safe'); vib([30, 40, 30]); }
      else { A.sfx(role === 'sd' ? 'busted' : 'misaudit'); vib([200]); }
      if (ok) S3.fxDuelResult(e.truth ? e.seat : e.challenger, e.truth ? e.challenger : e.seat);
      return 900;
    }
    case 'move': if (ok) S3.setPacket(e.seat, e.to); A.sfx('step', { k: e.to }); return e.by * 190 + 150;
    case 'goal': {
      log(`${nm(e.seat)} がゴール！（${P(e.seat) ? P(e.seat).goals.length : ''}個目）`);
      if (ok) { S3.setPacket(e.seat, null); S3.fxGoal(e.seat, 1); }
      A.sfx('goal'); vib([20, 30, 20, 30, 80]); splash('GOAL!!', 'gold', `${P(e.seat) ? P(e.seat).name : ''}  ★${P(e.seat) ? P(e.seat).goals.length : ''}個目`, 1500); return 1250;
    }
    case 'destroy': {
      if (e.cause !== 'cat') { ST.lostPop = e.seat; setTimeout(() => { if (ST.lostPop === e.seat) ST.lostPop = null; }, 1300); }
      if (e.cause === 'cat') {
        log(`${nm(e.seat)} のパケットは嘘がバレて猫動画にすり替えられた（パケット1個を失う）`);
        if (ok) S3.fxCat(e.seat);
        await sleep(650); if (ok) S3.setPacket(e.seat, null);
        catJack(e.seat); A.sfx('meow'); setTimeout(() => A.sfx('meow', { at: 0 }), 900); return ST.calm ? 1500 : 2200;
      }
      log(`${nm(e.seat)} のパケットを誤監査で没収`); if (ok) S3.fxConfiscate(e.seat); A.sfx('misaudit');
      await sleep(450); if (ok) S3.setPacket(e.seat, null); return 200;
    }
    case 'insert': if (ok) { S3.setPacket(e.seat, 0, true); const S = S3.seats[e.seat]; if (S) S.reserve = Math.max(0, S.reserve - 1); } A.sfx('clack'); return 180;
    case 'goalLost': log(`${nm(e.seat)} のゴール済みパケットを1個没収`); if (ok) S3.floatText('★-1', S3.headWorld(e.seat), { cache: true, size: 170, grad: ['#ffd0d0', '#ff2a3a'], wW: 4 }); A.sfx('misaudit'); return 500;
    case 'win3': case 'end': {
      const o = ST.view && ST.view.over; if (!o) return 0;
      log(e.t === 'win3' ? `${nm(e.seat)} が3パケット送信で即勝利` : `ゲーム終了（${{ nomove: '送信可能なパケットなし' }[e.why] || ''}）`);
      A.setMode('stop'); A.sfx('win'); vib([60, 40, 60, 40, 200]); keepAwake(false); if (ok) S3.fxWin(o.winners[0]);
      splash('WINNER', 'rain', o.winners.map(w => P(w) && P(w).name).join('・'), 2400); return 2600;
    }
    case 'say': if (ok) S3.react(e.seat, 'hop'); bubble(e.seat, e.text, false); log(`<span class="vc">🎙 ${nm(e.seat)}「${esc(e.text)}」</span>`); return 0;
    case 'react': if (e.seat != null) { bubble(e.seat, STAMPS[e.k], true); A.sfx('stamp'); if (ok) S3.react(e.seat, 'hop'); } return 0;
    case 'joined': A.sfx('join'); return 0;
    case 'disc': if (e.seat != null) { toast(`${nm(e.seat)} の接続が切れました`); log(`${nm(e.seat)} が切断`); } return 0;
    case 'left': return 0;
    case 'lobby': ST.overShown = false; return 0;
  }
  return 0;
}

// ───────── duel card: who audited whom, and who won (shown from your point of view) ─────────
function roleOf(ch, sd) { const m = me(); return m === ch ? 'ch' : m === sd ? 'sd' : 'by'; }
// phones: one slim card in the dock (no floating overlay)
function duelMini(stage, d) {
  const res = stage === 'result', R = d.roll === 'X' ? '×' : d.roll, chWin = res && !d.truth;
  const pill = (i, win) => { const pp = palOf(i); return `<span class="dm-p ${res ? (win ? 'win' : 'lose') : ''}" style="--pc:${pp.hex}">${symSvg(pp.sym, pp.hex, 12)}<span class="dm-n">${i === me() ? 'あなた' : nm(i)}</span>${res ? `<b>${win ? 'WIN' : 'LOSE'}</b>` : ''}</span>`; };
  const chOut = d.truth ? (d.stake && d.stake.kind === 'goal' ? 'ゴール済み1個を没収' : 'パケット没収') : (d.stake && d.stake.kind === 'goal' ? '前進なし' : `+${d.value} 前進`);
  const sdOut = d.truth ? `+${d.value} 前進` : '猫動画に';
  const actual = res ? `<b class="${d.truth ? 'ok' : 'ng'}">${R}</b>` : `<b class="q">?</b>`;
  const tail = res ? `<span class="dm-stamp ${d.truth ? 'ok' : 'ng'}">${d.truth ? '本当だった' : '嘘だった'}</span>`
    : `<span class="dm-st">${stage === 'flip' ? '結果発表…' : '照合中…'}</span>`;
  return `<div class="dmini ${res ? 'res' : stage}">
    <div class="dm-row">${pill(d.ch, chWin)}<span class="dm-ar">DOUBT<i>→</i></span>${pill(d.sd, res && !chWin)}</div>
    <div class="dm-row dm-2"><span class="dm-v">申告 <b>${d.value}</b></span><span class="dm-v">実際 ${actual}</span>${tail}</div>
    ${stage === 'scan' ? `<div class="dscan" style="--scan:${ST.scanMs || 1700}ms"><i></i></div>` : ''}
    ${res ? `<div class="dm-out"><span>${d.ch === me() ? 'あなた' : nm(d.ch)}：${chOut}</span><span>${d.sd === me() ? 'あなた' : nm(d.sd)}：${sdOut}</span></div>` : ''}</div>`;
}
function duelHtml(stage, d, compact) {
  if (compact && ST.layout !== 'pc') return duelMini(stage, d);
  const res = stage === 'result', R = d.roll === 'X' ? '×' : d.roll;
  const chWin = res && !d.truth, sdWin = res && d.truth;
  const side = (i, role, win, out) => {
    const pp = palOf(i), you = i === me();
    return `<div class="dside ${res ? (win ? 'win' : 'lose') : ''} ${you ? 'you' : ''}" style="--pc:${pp.hex}">
      <div class="drole">${role}${you ? '<b>あなた</b>' : ''}</div>
      <div class="dname">${symSvg(pp.sym, pp.hex, 15)}<span>${nm(i)}</span></div>
      ${res ? `<div class="dres">${win ? 'WIN' : 'LOSE'}</div><div class="dout">${out}</div>` : ''}</div>`;
  };
  const chOut = d.truth ? (d.stake && d.stake.kind === 'goal' ? 'ゴール済み1個を没収' : '転送中パケットを没収') : (d.stake && d.stake.kind === 'goal' ? '前進なし（ゴール済みを賭けた監査）' : `+${d.value} 前進`);
  const sdOut = d.truth ? `+${d.value} 前進` : 'パケットは猫動画に';
  const mid = res
    ? `<div class="dvs"><span>申告</span><b>${d.value}</b><span>実際</span><b class="${d.truth ? 'ok' : 'ng'}">${R}</b></div><div class="dverdict stamp ${d.truth ? 'ok' : 'ng'}">${d.truth ? '本当だった' : '嘘だった'}</div>`
    : stage === 'flip' ? `<div class="dvs"><span>申告</span><b>${d.value}</b><span>実際</span><b class="roll droll">?</b></div>`
    : `<div class="darrow">DOUBT<span>→</span></div><div class="dvs"><span>申告</span><b>${d.value}</b><span>実際</span><b class="q">?</b></div>`;
  const prog = stage === 'scan' ? `<div class="dscan" style="--scan:${ST.scanMs || 1700}ms"><i></i></div><div class="dstatus">照合中…</div>` : stage === 'flip' ? `<div class="dstatus">結果発表…</div>` : '';
  const note = res && d.contenders && d.contenders.length > 1 ? `<div class="dnote">同時ダウト${d.contenders.length}人 → 時計回りで ${nm(d.ch)} が挑戦者</div>` : '';
  return `<div class="duel ${compact ? 'compact' : ''} ${res ? 'res' : stage === 'call' ? 'call' : 'scan'}">${compact ? '' : '<div class="dhead">AUDIT</div>'}
    <div class="drow">${side(d.ch, 'ダウトした人', chWin, chOut)}<div class="dmid">${mid}</div>${side(d.sd, '申告した人', sdWin, sdOut)}</div>${prog}${note}</div>`;
}
function showDuel(stage, d) { const el = $('#duelBox'); if (ST.layout !== 'pc') { hideDuel(); return; } el.innerHTML = duelHtml(stage, d); el.classList.toggle('res', stage === 'result'); el.hidden = false; }
function hideDuel() { const el = $('#duelBox'); if (el) { el.hidden = true; el.innerHTML = ''; } }

// ───────── private roll slot ─────────
// the private roll: a die rattles under a cup; the cup lifts only for you (or only while held, with the guard on)
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8] };
function dieHtml(v, small) {
  // drawn as SVG so the cross is always centred and sized to the die (a text "×" depends on the font)
  if (v === 'X') return `<div class="die x ${small ? 'sm' : ''}"><svg viewBox="0 0 10 10" aria-label="×"><path d="M2.6 2.6L7.4 7.4M7.4 2.6L2.6 7.4"/></svg></div>`;
  return `<div class="die ${small ? 'sm' : ''}">${Array.from({ length: 9 }, (_, k) => `<i class="${(PIPS[v] || []).includes(k) ? 'on' : ''}"></i>`).join('')}</div>`;
}
function cupHtml(state, roll, peekable) {
  // state: 'shake' | 'down' | 'up'
  // state: 'ready' | 'shake' | 'slam' | 'down' | 'up'
  const lbl = state === 'ready' ? `<div class="cuplbl go">${COARSE ? '長押しで<br>振る' : '長押しで<br>振る<span class="kbd">Space</span>'}</div>`
    : state === 'down' ? `<div class="cuplbl">${COARSE ? '長押しで<br>のぞく' : '押している間<br>のぞく<span class="kbd">Space</span>'}</div>` : '';
  const attr = state === 'ready' || state === 'shake' ? 'data-roll role="button" tabindex="0" aria-label="カップを振る"' : peekable ? 'data-peek' : '';
  return `<div class="cupbox ${state}" id="cupbox" ${attr}>
    <div class="felt">${state === 'shake' || state === 'ready' ? '' : dieHtml(roll)}</div>
    <svg class="cup" viewBox="0 0 120 120" aria-hidden="true"><defs><linearGradient id="cupg" x1="0" x2="1"><stop offset="0" stop-color="#2a1a10"/><stop offset=".45" stop-color="#6b4325"/><stop offset=".6" stop-color="#7c5130"/><stop offset="1" stop-color="#24150c"/></linearGradient></defs>
      <path d="M22 112 L32 14 Q60 4 88 14 L98 112 Z" fill="url(#cupg)" stroke="#140b05" stroke-width="3"/>
      <path d="M33 22 Q38 60 34 104" stroke="#f0d29a" stroke-width="4" stroke-linecap="round" opacity=".18" fill="none"/>
      <path d="M26 98 Q60 106 94 98" fill="none" stroke="#d9b46a" stroke-width="3" opacity=".7"/>
      <path d="M30 30 Q60 38 90 30" fill="none" stroke="#d9b46a" stroke-width="2" opacity=".5"/>
      <text x="60" y="70" text-anchor="middle" font-family="DotGothic16,monospace" font-size="15" fill="#e8d3a6" opacity=".8">G//P</text></svg>
    ${lbl}<div class="lbl">PRIVATE</div></div>`;
}
// ───────── rolling: the player shakes and slams their own cup ─────────
// The roll was already made by the host at turn start; shaking only decides when you look (cosmetic, no rule change).
// States: ready → shake (held) → land (minimum shake time) → reveal (slam + lift) → done
const rollBusy = () => ['shake', 'land', 'reveal'].includes(ST.roll.st);
// keyed by the room's turn id, so a fresh view never shows a stale "already rolled" state
const turnId = () => (ST.room && ST.room.turnId) || 0;
function syncRoll() {
  const v = ST.view, r = ST.room;
  if (!v || v.over || v.phase !== 'declare' || v.turn !== me()) return false;
  if (ST.roll.id !== turnId()) ST.roll = { id: turnId(), st: r.rollSt === 'done' || v.myRoll === undefined ? 'done' : 'ready' };
  return true;
}
function myRollPending() { return syncRoll() && ST.roll.st !== 'done'; }
function beginRoll() { syncRoll(); renderStatus(); renderDock(); renderBanner(); }
let rattleT = null;
function rattleLoop(on, g) {
  clearTimeout(rattleT); rattleT = null; if (!on) return;
  const t0 = performance.now();
  const step = () => { const k = Math.min(1, (performance.now() - t0) / 1200); A.sfx('rattle', { k: 0.35 + k * 0.65, g }); rattleT = setTimeout(step, 150 - k * 70 + Math.random() * 40); };
  step();
}
function otherRattle(on) { if (on && ST.calm) return; ST.otherRattle = on; rattleLoop(on, 0.45); }
function shakeStart(src) {
  if (!myRollPending() || ST.roll.st !== 'ready') return;
  Object.assign(ST.roll, { st: 'shake', t0: performance.now(), src, tap: false });
  send({ t: 'roll', s: 'shake' });
  rattleLoop(true, 1); vib([12, 40, 12, 40, 12, 40, 12]);
  ST.roll.vibT = setInterval(() => vib([10, 30, 10]), 260);
  ST.roll.maxT = setTimeout(() => shakeEnd(), 2400);   // the cup is put down by itself after a while
  renderStatus(); renderDock();
}
function shakeEnd(tap) {
  if (ST.roll.st !== 'shake') return;
  clearTimeout(ST.roll.maxT);
  const held = performance.now() - ST.roll.t0, min = tap || held < 220 ? 850 : 520;
  ST.roll.st = 'land';
  const id = ST.roll.id; setTimeout(() => { if (ST.roll.id === id) land(); }, Math.max(0, min - held));
}
function land() {
  if (ST.roll.st !== 'land') return;
  const seq = ST.roll.id, roll = ST.view && ST.view.myRoll, guard = ST.guard;
  rattleLoop(false); clearInterval(ST.roll.vibT); A.sfx('slam'); vib(45);
  send({ t: 'roll', s: 'done' });
  ST.roll.st = 'reveal'; renderStatus(); renderDock();
  if (S3) S3.shake(0.22);
  setTimeout(() => {
    if (ST.roll.id !== seq) return;
    const cb = $('#cupbox'); if (!guard && cb) { cb.classList.add('open'); A.sfx('lift'); }
    setTimeout(() => {
      if (ST.roll.id !== seq) return;
      ST.roll.st = 'done'; ST.roll.fresh = true;
      if (!guard) { // fanfares would give the roll away to anyone nearby
        if (roll === 'X') { A.sfx('xroll'); if (S3) { S3.flash('#ff2a3a', 0.25); S3.shake(0.4); } }
        else { A.sfx('rare', { tier: roll }); if (roll === 4 && S3) { S3.flash('#ffcf4a', 0.3); S3.burst([0, 2, 6], { n: 120, colors: ['#ffe08a', '#ffffff', '#ffb347'], speed: 10, up: true }); } }
      }
      renderDock(); renderBanner(); renderStatus(); ST.roll.fresh = false;
    }, guard ? 120 : 560);
  }, 300);
}
// Android etc.: shaking the phone itself shakes the cup (iOS would need a permission prompt, so it is not used there)
const MOTION = typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission !== 'function' && COARSE;
if (MOTION) addEventListener('devicemotion', (e) => {
  const a = e.acceleration; if (!a || a.x == null) return; ST.motionOK = true;
  const g = Math.hypot(a.x, a.y, a.z);
  if (g > 15 && ST.roll.st === 'ready' && myRollPending()) shakeStart('motion');
  if (ST.roll.src === 'motion' && ST.roll.st === 'shake') { if (g > 7) ST.roll.lastMove = performance.now(); else if (performance.now() - (ST.roll.lastMove || ST.roll.t0) > 380) shakeEnd(); }
});
const symColor = (v) => v === 'X' ? '#ff2f5b' : ['#cfd8dc', '#7fe3ff', '#ffd34d', '#ff6ad5'][v - 1];
const tierText = (v) => v === 'X' ? ['TRANSFER DENIED', 'tx', '転送不能。何を言っても嘘になる（強制ブラフ）'] : v === 4 ? ['MAX BANDWIDTH!!', 't4', '最大転送枠'] : v === 3 ? ['HIGH BANDWIDTH', '', ''] : v === 2 ? ['STANDARD', '', ''] : ['LOW BANDWIDTH', '', ''];

// ───────── HUD render ─────────
function render() {
  const r = ST.room;
  if (!r) { if (!$('#screen').dataset.v || $('#screen').dataset.v !== 'title') renderTitle(); return; }
  if (r.phase === 'lobby') { $('#hud').hidden = true; renderLobby(); A.setMode('lobby'); return; }
  if ($('#hud').hidden) { $('#hud').hidden = false; applyLayout(true); }
  const v = ST.view;
  if (v && v.over && !ST.fxBusy && !ST.fxQ.length) { renderOver(); }
  else if (!(v && v.over)) { $('#screen').hidden = true; $('#screen').dataset.v = ''; }
  $('#hudCode').textContent = ST.mode === 'practice' ? '練習モード' : 'ROOM ' + r.code + (ST.ping != null ? `・${ST.ping}ms` : '');
  ST.nextSeat = nextSeatOf(DV());
  renderBanner(); renderRail(); renderRack(); renderDock(); renderStatus();
  if (ST.sheet) renderSheet();
  requestAnimationFrame(fitCanvas);
}
function renderStatus() {
  if (!S3 || !ST.boardReady || !ST.view) return;
  const v = DV(), r = RV();
  S3.setNext(ST.nextSeat); S3.setTurn(v.over ? null : v.turn);
  for (const p of v.players) {
    let st = 'idle';
    if (v.turn === p.seat && (v.phase === 'declare' || v.phase === 'review')) st = 'turn';
    else if (v.phase === 'review' && r.doubters.includes(p.seat)) st = 'doubt';
    else if (v.phase === 'review' && r.passes.includes(p.seat)) st = 'pass';
    else if (p.pos == null && !p.goals.length) st = 'out';
    S3.setStatus(p.seat, st);
    // the turn player's dice cup on the table
    let cup = 'off';
    if (!v.over && v.turn === p.seat) {
      if (v.phase === 'declare') {
        if (p.seat === me() && syncRoll()) cup = { ready: 'wait', shake: 'shake', land: 'shake', reveal: 'down', done: 'down' }[ST.roll.st];
        else cup = { wait: 'wait', shake: 'shake', done: 'down' }[r.rollSt || 'wait'];
      } else if (v.phase === 'review') cup = 'down';
      else if (v.phase === 'result') cup = v.last && v.last.kind !== 'pass' ? 'lift' : 'down';
    }
    S3.setCup(p.seat, cup);
  }
}
function renderBanner() {
  const v = DV(); if (!v) return;
  let ph = '', sub = `先に★3で優勝（最多★${Math.max(0, ...v.players.map(p => p.goals.length))}）・審議 ${ST.room.sec}秒` + (ST.nextSeat != null && !v.over ? `・次は <b>${ST.nextSeat === me() ? 'あなた' : esc(P(ST.nextSeat).name)}</b>` : '');
  if (v.over && !ST.suspense) ph = '対戦終了';
  else if (v.phase === 'declare') ph = v.turn === me() ? (myRollPending() ? 'あなたの手番：カップを振る' : 'あなたの手番：申告する数を選ぶ') : `${nm(v.turn)} ${{ wait: 'の手番', shake: 'がカップを振っています', done: 'が申告を考え中' }[ST.room.rollSt || 'wait']}`;
  if (ST.suspense && ST.duelData) ph = `${nm(ST.duelData.ch)} → ${nm(ST.duelData.sd)} — ${ST.duelStage === 'flip' ? '結果発表…' : '照合中…'}`;
  else if (v.phase === 'review') ph = ST.room.doubters.length ? `${nm(ST.room.doubters[0])} → ${nm(v.turn)} をダウト — 照合中` : `ダウト審議：${nm(v.turn)} の「${v.review.value}」`;
  else if (v.phase === 'result') ph = v.last && v.last.kind === 'doubt' ? (v.last.truth ? `ダウト失敗 — ${nm(v.last.seat)} の勝ち` : `ダウト成功 — ${nm(v.last.challenger)} の勝ち`) : '申告承認';
  $('#ph').innerHTML = ph; $('#phSub').innerHTML = sub;
}
function statusOf(p) {
  const v = DV(), r = RV(), i = p.seat, m = r.members.find(x => x.seat === i) || {};
  let k = '', label = '';
  if (v.over) { if (v.over.winners.includes(i)) { k = 't'; label = '勝利'; } }
  else if (v.turn === i && v.phase !== 'result') { k = 't'; label = '手番'; }
  else if (v.phase === 'review' && r.doubters.includes(i)) { k = 'd'; label = 'ダウト'; }
  else if (v.phase === 'review' && r.passes.includes(i)) { k = 'p'; label = 'スルー'; }
  else if (p.pos == null && !p.goals.length) { k = 'o'; label = '観戦'; }
  return { k, label, off: !m.connected && !m.bot };
}
// public declaration history: ✓ approved (truth unknown), ✗ caught lying (shows real roll), ◎ proven honest
function histHtml(i, n = 10) {
  const h = ((RV().hist || [])[i] || []).slice(-n);
  if (!h.length) return '<span class="hist none">申告履歴なし</span>';
  return `<span class="hist">${h.map(x => x.r === 'ok' ? `<b class="ok" title="審議通過（真偽不明）">${x.v}</b>` : x.r === 'lie' ? `<b class="lie" title="嘘が発覚（実際 ${x.roll === 'X' ? '×' : x.roll}）">${x.v}<i>${x.roll === 'X' ? '×' : x.roll}</i></b>` : `<b class="truth" title="監査で真実と証明">${x.v}</b>`).join('')}</span>`;
}
function nextSeatOf(v) {
  if (!v || v.over) return null;
  for (let k = 1; k <= v.players.length; k++) { const s = (v.turn + k) % v.players.length; if (v.players[s].pos != null) return s; }
  return null;
}
// a player's 7 packets at a glance: ★ = goal, filled = in transit (with node), hollow = still in hand, cat = turned into a cat video / confiscated
const CAT_SVG = '<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2 5 2.6 1.6 4.8 3.6h2.4l2.2-2L10 5v3.2C10 10 8.2 11 6 11S2 10 2 8.2z"/><circle cx="4.6" cy="6.6" r=".7"/><circle cx="7.4" cy="6.6" r=".7"/></svg>';
function trayHtml(p, big) {
  const c = col(p.seat), out = [];
  p.goals.forEach(() => out.push(`<i class="k g" title="ゴール済み">★</i>`));
  if (p.pos != null) out.push(`<i class="k a" style="--c:${c}" title="転送中 N${p.pos}">${big ? p.pos : ''}</i>`);
  for (let k = 0; k < p.reserve; k++) out.push(`<i class="k r" style="--c:${c}" title="手元"></i>`);
  for (let k = 0; k < p.lost; k++) out.push(`<i class="k x ${k === p.lost - 1 && ST.lostPop === p.seat ? 'pop' : ''}" title="猫動画・没収">${CAT_SVG}</i>`);
  return `<span class="tray ${big ? 'big' : ''}">${out.join('')}</span>`;
}
const trayText = (p) => `ゴール${p.goals.length}・${p.pos == null ? '転送中なし' : '転送中N' + p.pos}・手元${p.reserve}${p.lost ? '・猫' + p.lost : ''}`;
function recordHtml(i) {
  const s = (RV().stats || [])[i] || { ok: 0, lie: 0, truth: 0, dw: 0, dl: 0 };
  return `審議通過 ${s.ok}・嘘が発覚 ${s.lie}・監査で真実 ${s.truth}<br>自分の監査 成功 ${s.dw} / 失敗 ${s.dl}`;
}
function renderRail() {
  const v = DV(); if (!v) return; const r = RV();
  const meTag = (p) => p.seat === me() && p.name !== 'あなた' ? '（あなた）' : '';
  $('#rail').style.setProperty('--n', v.players.length);
  if (ST.layout !== 'pc') {
    $('#rail').innerHTML = v.players.map(p => {
      const i = p.seat, st = statusOf(p);
      return `<button class="pchip ${v.turn === i && !v.over ? 'turn' : ''} ${st.off ? 'off' : ''} ${ST.nextSeat === i ? 'next' : ''}" data-player="${i}"><span class="row1">${symSvg(palOf(i).sym, col(i), 11)}<span class="n">${esc(p.name)}</span></span><span class="s"><b class="gstar">★</b>${p.score}</span>${trayHtml(p)}${st.label ? `<span class="m ${st.k}">${st.label}</span>` : ''}${st.off ? '<span class="m x">切断</span>' : ''}</button>`;
    }).join('');
    return;
  }
  $('#rail').innerHTML = v.players.map(p => {
    const i = p.seat, st = statusOf(p);
    const chip = (st.label ? `<span class="chip ${st.k}">${st.label}</span>` : '') + (st.off ? '<span class="chip x">切断</span>' : '');
    const stk = r.streak && r.streak[i] >= 2 ? `<span class="streak">${r.streak[i]}連</span>` : '';
    return `<div class="pc ${v.turn === i && !v.over ? 'turn' : ''} ${st.off ? 'off' : ''}">${stk}<div class="bar" style="background:${col(i)};box-shadow:0 0 10px ${col(i)}"></div>
      <div style="min-width:0"><div class="nm">${symSvg(palOf(i).sym, col(i), 13)}<span>${esc(p.name)}${meTag(p)}</span>${palOf(i).bot ? '<span class="cpu">CPU</span>' : ''}</div>
      <div class="st">${chip}${ST.nextSeat === i && !st.label ? '<span class="chip n">NEXT</span>' : ''}</div><div class="trayrow" title="${trayText(p)}">${trayHtml(p, true)}</div></div>
      <div class="score"><b class="gstar">★</b>${p.score}</div><div class="more">${histHtml(i, 8)}<div>${recordHtml(i)}</div></div></div>`;
  }).join('');
}
// race to 3: each player's goals out of 3
function rackHtml() {
  const v = DV();
  const rows = v.players.slice().sort((a, b) => b.goals.length - a.goals.length).map(p => `<div class="race" style="--c:${col(p.seat)}">${symSvg(palOf(p.seat).sym, col(p.seat), 12)}<span class="rn">${p.seat === me() ? 'あなた' : esc(p.name)}</span><span class="rs">${[0, 1, 2].map(k => `<i class="${k < p.goals.length ? 'on' : ''}">★</i>`).join('')}</span></div>`).join('');
  return `<div class="ttl"><span>先に3個ゴールした人が優勝</span></div><div class="races">${rows}</div>`;
}
function renderRack() { const v = DV(); if (!v) return; $('#rack').innerHTML = rackHtml(); }
function declTiles(pos, roll, locked, hidden) {
  const K = (k) => `<span class="kbd">${k}</span>`;
  return `<div class="decl ${locked ? 'locked' : ''} ${ST.roll.fresh ? 'fresh' : ''}">${[1, 2, 3, 4].map(n => {
    const goal = pos + n >= 9, truth = !hidden && !locked && n === roll, sel = !locked && ST.pick === n;
    const sub = locked ? (goal ? 'ゴール' : `N${pos + n}`) : sel && COARSE ? 'タップで決定' : `${hidden ? '' : truth ? '真実・' : '嘘・'}${goal ? 'ゴール' : 'N' + (pos + n)}`;
    return `<button data-decl="${n}" class="tile ${truth ? 'truth' : ''} ${sel ? 'sel' : ''}" ${locked ? 'disabled' : ''}><span class="tn">${n}</span>${dieHtml(n, true)}${K(n)}<small>${sub}</small></button>`;
  }).join('')}</div>`;
}
function renderDock() {
  const v = ST.view, d = $('#dock'); if (!v) return;
  if (rollBusy() && myRollPending() && ST.roll.drawn === ST.roll.st && $('#cupbox')) return; // don't restart the cup animation mid-shake
  const r = ST.room; let h = '';
  const stamps = ST.layout === 'pc' ? `<div class="stamps">${STAMPS.map((s, k) => `<button data-stamp="${k}">${s}</button>`).join('')}</div>`
    : `<div class="tabs"><button data-sheet="stamps">スタンプ</button><button data-sheet="rack">優勝まで</button>${ST.showLog ? '<button data-sheet="log">ログ</button>' : ''}</div>`;
  const hidden = ST.guard && !ST.peeking;   // hold-to-peek guard
  const K = (k) => `<span class="kbd">${k}</span>`;
  if (ST.suspense && ST.duelData) {
    const dd = ST.duelData;
    d.innerHTML = (ST.layout === 'pc' ? `<div class="big" style="text-align:center">${who(dd.ch)} が ${who(dd.sd)} の「${dd.value}」をダウト — ${ST.duelStage === 'flip' ? '結果発表…' : '照合中…'}</div>` : duelMini(ST.duelStage || 'call', dd)) + stamps; return;
  }
  if (v.over) { h = `<div class="big">対戦終了</div>`; d.innerHTML = h; return; }
  if (v.phase === 'declare') {
    if (v.turn === me()) {
      const roll = v.myRoll, [tt, tc, tsub] = tierText(roll), pos = P(me()).pos || 0;
      const st = myRollPending() ? ST.roll.st : 'done';
      if (st !== 'done') {
        ST.roll.drawn = st;
        const cs = st === 'ready' ? 'ready' : st === 'reveal' ? 'slam' : 'shake';
        const tx = st === 'ready' ? ['カップを振ってください', COARSE ? `カップを長押しして振り、指を離すと置きます${ST.motionOK ? '（スマホを振ってもOK）' : ''}` : 'カップを長押し（Spaceキー長押しでも可）して振り、離すと置きます']
          : st === 'reveal' ? ['…', ''] : ['振っています', '離すとカップを置きます'];
        h = `<div class="row rollrow">${cupHtml(cs, roll, false)}<div class="rolltx"><div class="big">${tx[0]}</div><div class="small">${tx[1]}</div></div></div>` + declTiles(pos, roll, true, hidden);
      } else {
        const reel = cupHtml(hidden ? 'down' : 'up', roll, ST.guard);
        const where = `いま N${pos}・ゴールまで ${9 - pos}`;
        const info = hidden ? `<div class="tier">カップの中を確認</div><div class="small">左のカップを押している間だけ出目が見えます。${where}</div>`
          : `<div class="tier ${tc} ${ST.roll.fresh ? 'fresh' : ''}">${tt}</div><div class="small">${tsub || `${roll} を申告すれば真実、それ以外は嘘`}。${where}</div>`;
        h = `<div class="row">${reel}<div style="flex:1;min-width:0">${info}</div></div>` + declTiles(pos, roll, false, hidden);
      }
    } else {
      const m = r.members.find(x => x.seat === v.turn) || {};
      const slow = r.turnFor > r.slowMs, rs = r.rollSt || 'wait';
      const act = rs === 'wait' ? 'がカップを手に取りました' : rs === 'shake' ? 'がカップを振っています' : 'が申告を考えています';
      h = `<div class="big waitline ${rs}">${rs === 'shake' ? '<span class="minicup"></span>' : ''}${who(v.turn)} ${act}<span class="dots"><i></i><i></i><i></i></span>${slow && rs === 'done' ? '<span class="chip" style="margin-left:6px">30秒経過</span>' : ''}</div>
        <div class="small">${rs === 'done' ? '申告が出るとダウト審議が始まります' : '出目は振った本人にしか見えません'}</div>`;
      if (!m.connected && !m.bot) h += `<div class="small" style="color:#ff9aa8">${nm(v.turn)} は切断中（${Math.floor(m.discFor / 1000)}秒）。</div>` + (ST.you.host && m.discFor > r.graceMs ? `<button class="go ghost" data-skip>この手番をスキップ（ホスト）</button>` : '');
    }
  } else if (v.phase === 'review') {
    const rv = v.review, doubting = r.doubters.length;
    const bar = `<div class="passbar">スルー ${rv.passCount}/${rv.eligCount}　${r.members.filter(x => x.seat != null && x.seat !== v.turn).sort((a, b) => a.seat - b.seat).map(x => `<i class="${r.doubters.includes(x.seat) ? 'd' : r.passes.includes(x.seat) ? 'on' : ''}" title="${esc(x.name)}"></i>`).join('')}</div>`;
    const hl = `<div class="histline ${((RV().hist || [])[v.turn] || []).length ? '' : 'empty'}"><span class="small">直近の申告</span>${histHtml(v.turn, 6)}</div>`;
    h = `<div class="claim"><div class="hglass ${doubting ? 'stop' : ''}" id="hglass"><svg viewBox="0 0 60 90" aria-hidden="true"><path d="M8 4h44M8 86h44" stroke="#c9a86a" stroke-width="5" stroke-linecap="round"/><path d="M12 8 C12 30 26 38 30 45 C34 38 48 30 48 8 Z" class="hg-g"/><path d="M12 82 C12 60 26 52 30 45 C34 52 48 60 48 82 Z" class="hg-g"/><path class="hg-top" d="M14 10 C14 30 27 38 30 44 C33 38 46 30 46 10 Z"/><path class="hg-bot" d="M14 80 C14 62 27 54 30 47 C33 54 46 62 46 80 Z"/><line class="hg-stream" x1="30" y1="44" x2="30" y2="80"/></svg><div class="timer" id="timer">${doubting ? '!' : ''}</div></div><div class="claimbox"><div class="small">${who(v.turn)} の申告</div><div class="row" style="gap:10px"><div class="claimtile"><span>${rv.value}</span></div><span class="small">ノード</span></div></div><div style="margin-left:auto">${bar}</div></div>${v.turn === me() ? '' : hl}`;
    if (v.turn === me()) h += `<div class="mine">${hidden ? cupHtml('down', v.myRoll, true) : dieHtml(v.myRoll)}<div><div class="mt">あなたの「${rv.value}」を審議中${hidden ? '' : rv.value === v.myRoll ? '<em class="ok">本当</em>' : '<em class="lie">嘘</em>'}</div>
      <div class="ms">${hidden ? '左のカップを押している間だけ、実際の出目をのぞけます。' : ''}ダウトされなければ ${rv.value} 進みます。</div></div></div>`;
    else if (!rv.myStake) h += `<div class="small">ダウト資格なし（観戦・会話のみ）</div>`;
    else if (doubting) h += `<div class="big" style="color:var(--hot)">${who(r.doubters[0])} が ${who(v.turn)} をダウト — 照合中…</div>`;
    else {
      const passed = rv.iPassed;
      if (rv.myStake === 'goal') {
        const gs = P(me()).goals.slice().sort((a, b) => b - a); ST.stake = gs[0];
        h += `<div class="small">手元のパケットがないので、ゴール済み1個を賭けてダウトします（外すと1個没収・当てても前進なし）</div>`;
      }
      h += `<div class="acts"><button class="bDoubt acard2" data-doubt><span class="ck">AUDIT</span><svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="17" cy="17" r="10"/><path d="M25 25 L35 35"/></svg><b>DOUBT${K('D')}</b><small>${rv.myStake === 'active' ? `<span class="lg-only">転送中パケットを賭ける・</span>成功で +${rv.value}` : 'ゴール済み1個を賭ける'}</small></button>
        <button class="bPass acard2" data-pass aria-pressed="${passed}"><span class="ck">PASS</span><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M9 21 L17 29 L32 12"/></svg><b>${passed ? 'スルー済み' : 'スルー'}${K('S')}</b><small>${passed ? '押すと取り消し' : '<span class="lg-only">全員スルーで</span>即承認'}</small></button></div>`;
    }
  } else if (v.phase === 'result' && v.last) {
    const L = v.last;
    if (L.kind === 'pass') h = `<div class="big">${who(L.seat)} の申告 ${L.value} を承認</div><div class="small">本当の出目は最後まで公開されません。</div>`;
    else if (ST.layout === 'pc' && !$('#duelBox').hidden) h = `<div class="big" style="text-align:center">${who(L.challenger)} → ${who(L.seat)}：${L.truth ? '本当だった' : '嘘だった'}（申告 ${L.value}・実際 ${L.roll === 'X' ? '×' : L.roll}）</div>`;
    else h = duelHtml('result', { ch: L.challenger, sd: L.seat, value: L.value, roll: L.roll, truth: L.truth, stake: L.stake, contenders: L.contenders }, true);
  }
  d.innerHTML = h + stamps;
}

// ───────── screens ─────────
function lookPicker(cur, taken) {
  return `<div class="look">
    <div><label>カラー</label><div class="swatches">${COLORS.map((c, k) => `<button data-color="${k}" aria-pressed="${cur.color === k}" ${taken.includes(k) ? 'disabled title="使用中"' : ''} style="--c:${c}">${symSvg(k, c, 16)}</button>`).join('')}</div></div>
    <div><label>キャラ（見た目だけ。性能差なし）</label><div class="styles">${STYLE_NAMES.map((n, k) => `<button data-style="${k}" aria-pressed="${cur.style === k}" title="${n}">${avatarSvg(k, COLORS[cur.color] || COLORS[0], 44)}<span>${n}</span></button>`).join('')}</div></div>
  </div>`;
}
// 2D portrait of the 3D avatar (same hood, face ring, eyes and accessory per style) for lobby / pickers
function avatarSvg(style, hex, size = 48) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const mix = (k, b) => '#' + rgb.map(v => Math.round(v * k + b).toString(16).padStart(2, '0')).join('');
  const dark = mix(0.3, 13), mid = mix(0.5, 18), c = hex, W = '#fff';
  let back = '', front = '', eyes = '';
  switch (style % 8) {
    case 0: eyes = `<circle cx="26" cy="36" r="2.6" fill="${W}"/><circle cx="38" cy="36" r="2.6" fill="${W}"/>`; break;
    case 1: eyes = `<rect x="20" y="34.5" width="24" height="3.2" rx="1.6" fill="${W}"/>`;
      back = `<path d="M5 30l11-4 1 9-11 3z M59 30l-11-4-1 9 11 3z" fill="${mid}"/>`; front = `<rect x="18" y="27" width="28" height="1.8" rx=".9" fill="${c}"/>`; break;
    case 2: eyes = `<path d="M22 37.5l7-3M42 37.5l-7-3" stroke="${W}" stroke-width="2.4" stroke-linecap="round"/>`;
      back = `<path d="M14 18L16 2l11 10z M50 18L48 2 37 12z" fill="${mid}"/><path d="M17 13l1-7 5 5z M47 13l-1-7-5 5z" fill="${c}"/>`; break;
    case 3: eyes = `<circle cx="32" cy="36" r="4" fill="${W}"/>`;
      back = `<path d="M39 13l6-11" stroke="#555a60" stroke-width="2"/>`; front = `<circle cx="45.5" cy="3.5" r="3.3" fill="${c}"/>`; break;
    case 4: eyes = `<rect x="23.5" y="33.5" width="5" height="5" fill="${W}"/><rect x="35.5" y="33.5" width="5" height="5" fill="${W}"/>`;
      back = `<path d="M8 34C8 8 56 8 56 34" fill="none" stroke="#24272c" stroke-width="3.4"/>`;
      front = `<rect x="3" y="27" width="9" height="15" rx="4" fill="#202328" stroke="${c}" stroke-width="1.8"/><rect x="52" y="27" width="9" height="15" rx="4" fill="#202328" stroke="${c}" stroke-width="1.8"/>`; break;
    case 5: eyes = `<circle cx="24.5" cy="35" r="2.4" fill="${W}"/><circle cx="32" cy="38.5" r="2.4" fill="${W}"/><circle cx="39.5" cy="35" r="2.4" fill="${W}"/>`;
      back = `<path d="M18 17C12 12 8 6 7 1c5 3 10 7 15 12z M46 17c6-5 10-11 11-16-5 3-10 7-15 12z" fill="#e6dcc7"/>`; break;
    case 6: eyes = `<path d="M22 34.5l7 3M42 34.5l-7 3" stroke="${W}" stroke-width="2.4" stroke-linecap="round"/>`;
      back = `<path d="M28 13l1-11h6l1 11z" fill="${mid}"/><rect x="29" y="1" width="6" height="3" rx="1" fill="${c}"/><path d="M27 15l-7-8 4-2 6 9z M37 15l7-8-4-2-6 9z" fill="${mid}"/>`; break;
    case 7: eyes = `<rect x="21" y="38" width="8" height="1.8" fill="${W}"/><rect x="35" y="38" width="8" height="1.8" fill="${W}"/>`;
      front = `<path d="M16 32L32 27 48 32 32 36.5z" fill="${c}" opacity=".85"/>`; break;
  }
  return `<svg class="ava" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">${back}
    <path d="M4 64C4 52 6 46 12 42 9 22 18 11 32 11s23 11 20 31c6 4 8 10 8 22z" fill="${dark}"/>
    <path d="M12 44C9 23 18 12 32 12s23 11 20 32c-5 3-11 4-20 4s-15-1-20-4z" fill="${mid}"/>
    <ellipse cx="32" cy="36" rx="14" ry="9.5" fill="#05080a" stroke="${c}" stroke-width="2"/>${eyes}
    <rect x="29.5" y="54" width="5" height="5" transform="rotate(45 32 56.5)" fill="${c}"/>${front}</svg>`;
}
function myLook() { const l = store.get('gp.look') || {}; return { color: Number.isInteger(l.color) ? l.color : 0, style: Number.isInteger(l.style) ? l.style : 0 }; }
// title / lobby: the 3D table plays an attract loop behind the menus
async function attract(players, meIdx, key) {
  if (!S3 || ST.boardKey === key) return;
  ST.boardKey = key; ST.boardKind = 'attract'; ST.boardReady = false;
  await S3.setup(players, meIdx);
  if (ST.boardKind === 'attract') S3.setDemo(true);
}
function renderTitle() {
  const sc = $('#screen'); sc.hidden = false; sc.dataset.v = 'title'; $('#hud').hidden = true;
  const L = myLook();
  attract(['KAGE', 'ミント', 'ボルト', 'ヨル', 'ハルカ'].map((name, k) => ({ name, color: (k + 2) % 8, style: k + 1 })), 0, 'title');
  const sess = store.get('gp.session');
  const online = ST.online ? `
      <div><label for="nm">ハンドルネーム</label><input type="text" id="nm" maxlength="10" value="${esc(ST.name)}" placeholder="例：KAGE" autocomplete="nickname"></div>
      <div><label>ダウト審議時間（新規ルーム）</label><div class="seg" id="segSecO">${[20, 40, 60].map(s => `<button data-seco="${s}" aria-pressed="${ST.cfg.sec === s}">${s}秒${s === 40 ? '（標準）' : ''}</button>`).join('')}</div></div>
      <button class="go" id="bCreate">ルームを作る</button>
      <div class="row"><input type="text" id="code" maxlength="4" placeholder="ルームコード" style="flex:1;text-transform:uppercase;letter-spacing:.2em" value="${esc(new URLSearchParams(location.search).get('room') || '')}" autocomplete="off"><button class="go alt" id="bJoin" style="flex:none;padding:10px 18px;font-size:16px">参加</button></div>
      ${sess && !(sess.host && !ST.wsMode) ? `<button class="go ghost" id="bRejoin">前回のルーム ${esc(sess.code)} に戻る</button>` : ''}
      <div class="err" id="err">${esc(ST.joinErr || '')}</div>`
    : `<p class="small">このページではオンライン対戦を使えません。練習モードでルールと操作を試せます。</p>`;
  sc.innerHTML = `<div class="panel">
    <div class="hero boxlid"><h1>GHOST<b>//</b>PACKET</h1><p>自分の不正通信は通したい。他人の不正通信は見破って利用したい。</p>
      <div class="specs"><span><b>3〜5</b>人</span><span><b>20〜30</b>分</span><span><b>10</b>歳以上</span></div></div>
    <div class="cards">
      <div class="glass card"><h2>オンライン対戦</h2>${online}</div>
      <div class="glass card"><h2>練習モード（CPU）</h2>
        ${ST.online ? '' : `<div><label for="nm">ハンドルネーム</label><input type="text" id="nm" maxlength="10" value="${esc(ST.name)}" placeholder="例：KAGE" autocomplete="nickname"></div>`}
        <div><label>人数（あなた＋CPU）</label><div class="seg">${[3, 4, 5].map(n => `<button data-n="${n}" aria-pressed="${ST.cfg.n === n}">${n}人</button>`).join('')}</div></div>
        <div><label>ダウト審議時間</label><div class="seg">${[20, 40, 60].map(s => `<button data-sec="${s}" aria-pressed="${ST.cfg.sec === s}">${s}秒${s === 40 ? '（標準）' : ''}</button>`).join('')}</div></div>
        <button class="go alt" id="bPractice">練習スタート</button>
        <details class="lookbox"><summary>自分の見た目を選ぶ</summary>${lookPicker(L, [])}</details></div>
    </div>
    <div class="row" style="justify-content:center"><button class="tb" id="bGuide">はじめての人へ（30秒）</button><button class="tb" id="bRules2">ルール詳細</button><button class="tb" id="bSettings2">設定</button></div>
  </div>`;
}
function renderLobby() {
  const sc = $('#screen'), r = ST.room; sc.hidden = false; sc.dataset.v = 'lobby';
  const host = ST.you.host, n = r.members.length;
  const link = location.origin + location.pathname + '?room=' + r.code;
  const meM = r.members.find(m => m.id === ST.you.id) || {};
  const taken = r.members.filter(m => m.id !== ST.you.id).map(m => m.color);
  // the lobby table shows everyone who has joined, in their chosen looks
  const meIdx = Math.max(0, r.members.findIndex(m => m.id === ST.you.id));
  attract(r.members.map(m => ({ name: m.name, color: m.color, style: m.style, bot: m.bot })), meIdx, 'lobby:' + r.members.map(m => m.name + m.color + m.style).join('|') + meIdx);
  sc.innerHTML = `<div class="panel lobbyp"><div class="glass card">
    <div class="row" style="justify-content:space-between"><div><div class="small">ルームコード</div><div class="bigcode">${esc(r.code)}</div></div>
      <div style="display:flex;flex-direction:column;gap:6px;align-items:flex-end;min-width:0"><button class="copy" id="bCopy">招待リンクをコピー</button><span class="small" style="user-select:all;font-family:var(--f-mono);overflow-wrap:anywhere;text-align:right">${esc(link)}</span></div></div>
 ${ST.isP2PHost ? `<div class="small" style="background:rgba(255,207,74,.12);border-radius:8px;padding:8px 10px;color:#ffe7a0">あなたのブラウザがこのルームの審判役です。<b>対戦が終わるまでこのタブを閉じないでください</b>（ほかのタブやDiscordを見ていても大丈夫）。PCでのホストがおすすめです。</div>` : ''}
    ${ST.wsMode && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? `<div class="small" style="background:rgba(255,207,74,.12);border-radius:8px;padding:8px 10px;color:#ffe7a0">いま自分のPC（localhost）で開いています。友達には、起動した黒い画面に出た <b>https://〜.trycloudflare.com</b> のURLと、ルームコード <b>${esc(r.code)}</b> を送ってください。</div>` : ''}
    <div class="small">参加 ${n}/5 人（3人以上で開始）・審議 ${r.sec}秒</div>
    <div class="members">${r.members.map(m => `<div class="mem" style="--c:${COLORS[m.color]}"><span class="memava">${avatarSvg(m.style, COLORS[m.color], 40)}</span><div class="memtx"><b>${symSvg(m.color, COLORS[m.color], 12)}${esc(m.name)}</b><span class="small">${STYLE_NAMES[m.style] || ''}</span></div>${m.host ? '<span class="chip t">ホスト</span>' : ''}${m.bot ? '<span class="chip">練習CPU</span>' : ''}${m.id === ST.you.id ? '<span class="chip p">あなた</span>' : ''}
      ${host && m.id !== ST.you.id ? `<button class="x" data-kick="${m.id}">外す</button>` : ''}</div>`).join('')}</div>
    <details class="lookbox" open><summary>自分の見た目</summary>${lookPicker({ color: meM.color, style: meM.style }, taken)}</details>
    ${host ? `<div><label>ダウト審議時間（開始後は変更不可）</label><div class="seg">${[20, 40, 60].map(s => `<button data-setsec="${s}" aria-pressed="${r.sec === s}">${s}秒${s === 40 ? '（標準）' : ''}</button>`).join('')}</div></div>
      <div class="row"><button class="go ghost" id="bBot" ${n >= 5 ? 'disabled' : ''} style="flex:1">練習用CPUを追加</button><button class="go" id="bStart" ${n < 3 ? 'disabled' : ''} style="flex:2">${n < 3 ? `あと${3 - n}人で開始できます` : '対戦開始'}</button></div>`
      : `<div class="big" style="text-align:center">ホストの開始を待っています…</div>`}
    <div class="lobbyfoot"><span></span><button class="go ghost" id="bLeave2" style="padding:8px 18px;font-size:14px">ルームを出る</button></div>
  </div></div>`;
}
// end-of-match awards — computed only from public facts
function awards() {
  const st = ST.room.stats || [], v = ST.view, out = [];
  const best = (key, min = 1) => { let mx = min - 1; st.forEach(s => { if (s[key] > mx) mx = s[key]; }); return mx >= min ? st.map((s, i) => s[key] === mx ? i : -1).filter(i => i >= 0) : []; };
  const A = (title, key, unit, sub) => { const w = best(key); if (w.length) out.push(`<div class="award"><div class="at">${title}</div><div class="aw">${w.map(who).join('')}</div><div class="small">${sub}：${st[w[0]][key]}${unit}</div></div>`); };
  A('名監査官', 'dw', '回', '嘘を見破った');
  A('すり抜け王', 'ok', '回', '審議を通過');
  A('猫動画職人', 'lie', '本', '猫動画に変えられた');
  A('正直者', 'truth', '回', '監査で真実を証明');
  A('早とちり', 'dl', '回', '誤監査');
  return out.join('');
}
function renderOver() {
  if (ST.overShown && $('#screen').dataset.v === 'over') return;
  ST.overShown = true;
  const v = ST.view, o = v.over, sc = $('#screen'); sc.hidden = false; sc.dataset.v = 'over';
  const host = ST.you.host || ST.mode === 'practice';
  const iWon = o.winners.includes(me());
  sc.innerHTML = `<div class="panel" style="width:min(640px,100%)"><div class="glass card">
    <div class="hero"><h1 style="font-size:clamp(40px,8vw,70px)">${iWon ? 'YOU WIN' : 'WINNER'}</h1></div>
    <div class="big" style="text-align:center">${o.type === 'three' ? `${who(o.winners[0])} が先に3個ゴール！` : `誰も送れなくなったため、ゴール数で決着：${o.winners.map(who).join('・')}`}</div>
    <table class="st">${o.standings.map(r => `<tr class="${r.seat === me() ? 'me' : ''}"><td style="font-family:var(--f-mono);width:3em">${r.place}位</td><td>${who(r.seat)}</td><td style="text-align:right;font-family:var(--f-disp);font-size:20px;width:4em">★${r.score}</td></tr>`).join('')}</table>
    <div class="small">${o.type === 'three' ? '先に3個ゴールした人が優勝。' : 'ゴールした数が同じ人は同順位（同時優勝）。'}</div>
    <div class="awards">${awards()}</div>
    ${host ? `<div class="row"><button class="go" id="bAgain" style="flex:2">${ST.mode === 'practice' ? 'もう一戦' : 'ロビーに戻る'}</button><button class="go ghost" id="bQuit" style="flex:1">タイトルへ</button></div>` : `<div class="small" style="text-align:center">ホストがロビーに戻すのを待っています</div><button class="go ghost" id="bQuit">タイトルへ</button>`}
  </div></div>`;
  setTimeout(() => A.setMode('lobby'), 2500);
}

// ───────── first-visit guide ─────────
const GUIDE = [
  ['出目はあなただけが見る', `<div class="gill"><div class="row" style="justify-content:center;gap:18px">${dieHtml(3)}<span class="gsmall">カップの中は<br>あなただけが見る</span></div></div>`, '手番ではカップを長押しして振り、離して置きます。出目は 1・2・3・4・×・× のどれか。見えるのはあなただけです。'],
  ['1〜4を申告。嘘でもいい', `<div class="gill row" style="justify-content:center"><span class="gnum">1</span><span class="gnum">2</span><span class="gnum">3</span><span class="gnum hot">4</span></div>`, '申告した数だけ進めます。×が出たら何を言っても嘘。'],
  ['怪しいと思ったらDOUBT', `<div class="gill"><div class="gdoubt">DOUBT</div></div>`, '嘘なら相手のパケットは猫動画に、あなたは申告値だけ前進。真実なら、あなたのパケットが没収。'],
  ['先に3個届けたら勝ち', `<div class="gill row" style="justify-content:center;gap:10px">${symSvg(0, '#ffcf4a', 34)}${symSvg(0, '#ffcf4a', 34)}${symSvg(0, '#ffcf4a', 34)}</div>`, 'ゴールの順番や点数は関係ありません。3個そろえた人の勝ちです。「ダウトしようかな」と口で言うだけなら何も起きません。'],
];
function guide(k = 0) {
  const [t, ill, d] = GUIDE[k];
  modal(`<div class="guide"><div class="small">STEP ${k + 1} / ${GUIDE.length}</div><h2>${t}</h2>${ill}<p>${d}</p>
    <div class="row" style="justify-content:space-between"><div class="dots">${GUIDE.map((_, i) => `<i class="${i === k ? 'on' : ''}"></i>`).join('')}</div>
    <div class="row">${k < GUIDE.length - 1 ? `<button class="tb" data-close>スキップ</button><button class="go" data-guide="${k + 1}" style="padding:8px 22px;font-size:16px">次へ</button>` : `<button class="go alt" data-close style="padding:8px 22px;font-size:16px">はじめる</button>`}</div></div></div>`, true);
  store.set('gp.guideSeen', 1);
}

// ───────── bottom sheet (phones): stamps / goal rack / log / player / menu ─────────
function openSheet(kind) { ST.sheet = kind; renderSheet(); A.sfx('click'); }
function closeSheet() { ST.sheet = null; $('#sheet').hidden = true; $('#sheetBack').hidden = true; }
function renderSheet() {
  const k = ST.sheet, el = $('#sheet'); if (!k) return;
  const sw = (id, on, label, sub) => `<div class="opt"><div>${label}${sub ? `<small>${sub}</small>` : ''}</div><button class="sw" data-opt="${id}" aria-pressed="${on}">${on ? 'ON' : 'OFF'}</button></div>`;
  const titles = { menu: 'メニュー', stamps: 'スタンプ', rack: '優勝まで', log: '通信ログ' };
  let h = `<div class="shead"><div class="grab"></div><span class="sht">${titles[k] || '詳細'}</span><button class="shx" data-sheetclose aria-label="閉じる">✕ 閉じる</button></div>`;
  if (k === 'menu') {
    h += `<div class="opt"><div>音量<small>BGMと効果音の全体</small></div><input type="range" class="vol" id="vol" min="0" max="100" value="${Math.round(A.vol * 100)}" aria-label="音量"></div>${sw('bgm', A.bgmOn, 'BGM')}${sw('sfx', A.sfxOn, '効果音')}${sw('guard', ST.guard, '出目ガード', '自分の出目を、押している間だけ表示')}${CAN_VIBE ? sw('vibe', ST.vibe, '振動', '手番・ダウト・残り5秒などで振動') : ''}
      ${sw('calm', ST.calm, '演出ひかえめ', '画面の揺れ・フラッシュ・粒子を減らす')}
      ${sw('log', ST.showLog, '通信ログを表示', ST.layout === 'pc' ? '右側のログ欄を出す／隠す' : '操作パネルの「ログ」ボタンを出す／隠す')}
      ${ST.mode === 'online' && ST.room ? `<div class="opt"><div>通信の遅れ<small>サーバーまでの往復時間</small></div><b style="font-family:var(--f-mono)">${ST.ping != null ? ST.ping + ' ms' : '計測中'}</b></div>` : ''}
      <div class="row" style="margin-top:10px"><button class="go ghost" id="bGuide" style="flex:1">はじめての人へ</button><button class="go ghost" id="bRules" style="flex:1">ルール</button>${ST.room ? '<button class="go ghost" id="bLeave" style="flex:1">退出</button>' : ''}</div>`;
  } else if (!ST.view) { closeSheet(); return; }
  else if (k === 'stamps') h += `<div class="stamps">${STAMPS.map((t, i) => `<button data-stamp="${i}">${t}</button>`).join('')}</div>`;
  else if (k === 'rack') h += `<div class="rack" style="padding:0">${rackHtml()}</div>`;
  else if (k === 'log') h += `<div class="log">${ST.logs.slice().reverse().map(x => `<div>${x}</div>`).join('')}</div>`;
  else if (k.startsWith('p')) {
    const i = +k.slice(1), p = DV().players[i]; if (!p) { closeSheet(); return; }
    const st = statusOf(p);
    h += `<h3>${who(i)} ${st.label ? `<span class="chip ${st.k}">${st.label}</span>` : ''}</h3>
      <div class="trayrow" style="margin:4px 0 8px">${trayHtml(p, true)}</div><div class="recs"><div>ゴール<b>★${p.goals.length}</b></div><div>転送中<b>${p.pos == null ? '—' : 'N' + p.pos}</b></div><div>手元<b>${p.reserve}</b></div><div>猫動画・没収<b>${p.lost}</b></div><div>連続通過<b>${(ST.room.streak || [])[i] || 0}</b></div></div>
      <div class="histline" style="margin-top:10px"><span class="small">申告履歴</span>${histHtml(i, 12)}</div>
      <p class="small" style="margin:6px 0 0">${recordHtml(i)}</p><p class="small" style="margin:4px 0 0">白＝審議通過（真偽は不明）・赤＝嘘が発覚（小さい数字が実際の出目）・緑＝監査で真実と証明</p>`;
  }
  el.innerHTML = h; el.hidden = false; $('#sheetBack').hidden = false;
}

// ───────── overlays ─────────
// "your packet became a cat video": the whole screen is briefly hijacked by a cat-video player (tap to skip)
function catJack(seat) {
  const p = P(seat); if (!p) return;
  document.querySelector('.catjack')?.remove();
  const dur = ST.calm ? 1500 : 2300, el = document.createElement('div');
  el.className = 'catjack' + (ST.calm ? ' calm' : ''); el.style.setProperty('--dur', dur + 'ms');
  const who = seat === me() ? 'あなた' : esc(p.name);
  el.innerHTML = `<div class="cj-top"><span class="cj-back">‹</span><span class="cj-title">cat.mp4</span><span class="cj-hd">HD</span></div>
    <div class="cj-stage">
      <i class="cj-spark" style="--x:18%;--y:22%"></i><i class="cj-spark" style="--x:78%;--y:30%;--d:.3s"></i><i class="cj-spark" style="--x:30%;--y:74%;--d:.6s"></i><i class="cj-spark" style="--x:84%;--y:70%;--d:.15s"></i>
      <svg class="cj-cat" viewBox="0 0 200 200" aria-hidden="true">
        <path class="cj-tail" d="M140 150c30 4 44-14 40-40" stroke="#f39a3d" stroke-width="12" stroke-linecap="round" fill="none"/>
        <ellipse cx="100" cy="150" rx="46" ry="36" fill="#f39a3d"/><ellipse cx="100" cy="158" rx="26" ry="22" fill="#ffd9b0"/>
        <g class="cj-pawL"><ellipse cx="62" cy="140" rx="11" ry="20" fill="#f39a3d"/><ellipse cx="62" cy="124" rx="9" ry="7" fill="#ffd9b0"/></g>
        <g class="cj-pawR"><ellipse cx="138" cy="140" rx="11" ry="20" fill="#f39a3d"/><ellipse cx="138" cy="124" rx="9" ry="7" fill="#ffd9b0"/></g>
        <g class="cj-head"><path d="M52 92 58 38 84 64h32l26-26 6 54v18c0 24-22 38-48 38s-48-14-48-38z" fill="#f39a3d"/><path d="M62 52l4 22 12-10zM138 52l-4 22-12-10z" fill="#ff9fb4"/>
        <ellipse cx="100" cy="106" rx="24" ry="17" fill="#ffd9b0"/><g class="cj-eyes"><ellipse cx="82" cy="86" rx="6" ry="8" fill="#1a1a1a"/><ellipse cx="118" cy="86" rx="6" ry="8" fill="#1a1a1a"/><circle cx="84" cy="83" r="2.2" fill="#fff"/><circle cx="120" cy="83" r="2.2" fill="#fff"/></g>
        <path d="M96 99h8l-4 5z" fill="#ff7aa0"/><path d="M100 104q-6 8-12 4M100 104q6 8 12 4" stroke="#1a1a1a" stroke-width="2.2" fill="none"/>
        <path d="M70 100 40 94M70 108 40 112M130 100l30-6M130 108l30 4" stroke="#1a1a1a" stroke-width="1.6"/></g>
      </svg>
      <div class="cj-sub">${who}のパケットは猫動画にすり替えられました</div>
    </div>
    <div class="cj-ctrl"><div class="cj-bar"><b></b></div><div class="cj-row"><span class="cj-play">❚❚</span><span class="cj-time">0:00 / 0:03</span><span class="cj-sp"></span><span class="cj-ic">🔊</span><span class="cj-ic">⛶</span></div></div>`;
  document.body.appendChild(el);
  const t0 = performance.now(), tm = el.querySelector('.cj-time');
  const iv = setInterval(() => { const s = Math.min(3, Math.floor((performance.now() - t0) / dur * 3 + 0.0001)); tm.textContent = `0:0${s} / 0:03`; }, 120);
  let done = false;
  const close = () => { if (done) return; done = true; clearInterval(iv); el.classList.add('out'); setTimeout(() => el.remove(), 260);
    ST.lostPop = seat; renderRail(); setTimeout(() => { if (ST.lostPop === seat) { ST.lostPop = null; } }, 1300); };   // the cat mark pops into the player's tray once the screen is back
  el.addEventListener('pointerdown', close, { once: true });
  setTimeout(close, dur);
  $('#splash').innerHTML = '';
}
function splash(text, cls, sub, ms = 1300) {
  if (ST.calm) ms = Math.round(ms * 0.65);
  const n = Math.max(3, [...String(text)].reduce((w, ch) => w + (/[A-Z0-9]/.test(ch) ? 0.8 : /[\x20-\x7e]/.test(ch) ? 0.6 : 1.04), 0));   // text width in em, so it always fits the board
  const el = $('#splash'); el.innerHTML = `<div class="sp ${cls}" style="--n:${n.toFixed(2)};animation-duration:${ms}ms${cls === 'rain' ? `,1s` : ''}">${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>`;
  clearTimeout(ST.splashT); ST.splashT = setTimeout(() => { el.innerHTML = ''; }, ms);
}
function flashBar() { if (ST.calm) return; const b = document.createElement('div'); b.className = 'flashbar'; document.body.appendChild(b); setTimeout(() => b.remove(), 950); }
function toast(t) { const el = document.createElement('div'); el.className = 'toast'; el.textContent = t; document.body.appendChild(el); setTimeout(() => el.remove(), 3000); }
function log(h) { ST.logs.push(h); if (ST.logs.length > 150) ST.logs.shift(); const el = $('#log'); if (el) el.innerHTML = ST.logs.slice().reverse().map(x => `<div>${x}</div>`).join(''); }
function bubble(seat, text, stamp) {
  if (!S3 || !ST.boardReady) return;
  const el = document.createElement('div'); el.className = 'bub' + (stamp ? ' stamp' : ''); el.textContent = text; $('#bubbles').appendChild(el);
  const b = { el, seat, until: performance.now() + 2800 }; ST.bubbles.push(b); placeBubble(b);
  setTimeout(() => { el.remove(); ST.bubbles = ST.bubbles.filter(x => x !== b); }, 2800);
}
function placeBubble(b) { const cr = $('#gl').getBoundingClientRect(), p0 = S3.project(S3.headWorld(b.seat)), p = [p0[0] + cr.left, p0[1] + cr.top]; const off = ST.bubbles.filter(x => x.seat === b.seat && x !== b && x.until > b.until).length; b.el.style.left = p[0] + 'px'; b.el.style.top = Math.max(cr.top + 44, p[1] - 8 - off * 30) + 'px'; const hw = (b.el.offsetWidth || 120) / 2 + 6; b.el.style.left = Math.min(cr.right - hw, Math.max(cr.left + hw, p[0])) + 'px'; }
function modal(html, own) { const m = $('#modal'); m.className = 'modal' + (own ? ' paper' : ''); m.hidden = false; m.innerHTML = `<div class="glass">${html}${own ? '' : '<div class="row" style="justify-content:flex-end;margin-top:12px"><button class="go ghost" data-close>閉じる</button></div>'}</div>`; }
const RULES = `<h2>遊び方</h2>
 <p>全員がライバルのハッカー。各自7個の不正パケットを、9ノード先の目的サーバーへ1個ずつ送り込みます。<b>先に3個届けた人が即勝利</b>。</p>
 <h3>手番</h3><p>カップを振って、あなたにだけ見える転送許容量（1・2・3・4・×・× が等確率）を確認し、1〜4を申告。スマホでは数字をタップで選び、もう一度タップで決定です。出目と同じなら真実、違えば嘘。×は何を言っても嘘です。</p>
 <h3>ダウト審議</h3><p>申告後は自由に会話できます。画面のDOUBTを押した1人だけが監査します。誰も押さず時間切れ、または全員スルーで申告どおり前進し、本当の出目は誰にも明かされません。</p>
 <ul><li>嘘だった：送信者のパケットは猫動画に変換されて消滅。監査した人は申告値だけ前進。</li><li>真実だった：送信者は前進。監査した人は転送中パケットを没収。</li><li>250ms以内の同時ダウトは、手番の次の席から時計回りで近い人が挑戦者。</li><li>口で「ダウトしようかな」と言っても正式なダウトにはなりません。</li></ul>
 <h3>勝敗</h3><p><b>先に3個ゴールさせた人が優勝</b>。万一、全員のパケットが尽きて誰も送れなくなったときだけ、ゴール数が一番多い人の勝ち（同数は同時優勝）。手元のパケットを使い切った人は、ゴール済みを1個賭けてダウトできます（当てても前進なし、外すと1個没収）。</p>
 <h3>パケットの見方</h3><p>プレイヤー欄の7つの印が、その人のパケット全部です。<b>★</b>＝ゴール済み、<b>塗りつぶし</b>＝転送中（数字は今いるノード）、<b>枠だけ</b>＝手元、<b>猫</b>＝猫動画にされた・没収された。</p>
 <h3>マナー</h3><p>出目が見える画面共有は禁止。申告に時間制限はありませんが、30秒を過ぎると「考え中」が表示されます。</p>`;

// ───────── input ─────────
document.addEventListener('click', (e) => {
  A.init(); if (A.mode === 'stop' && (!ST.room || ST.room.phase === 'lobby')) A.setMode('lobby');
  if (e.target.id === 'sheetBack' || e.target.closest('[data-sheetclose]')) { closeSheet(); return; }
  if (e.target.closest('#bZoom')) { if (S3) S3.resetView(); syncZoomChip(); return; }
  const t = e.target.closest('button'); if (!t) { if (e.target.id === 'modal') $('#modal').hidden = true; return; }
  const ds = t.dataset;
  if (ds.close != null) { $('#modal').hidden = true; return; }
  if (ds.n) { ST.cfg.n = +ds.n; keepTitle(); A.sfx('click'); return; }
  if (ds.sec) { ST.cfg.sec = +ds.sec; keepTitle(); A.sfx('click'); return; }
  if (ds.seco) { ST.cfg.sec = +ds.seco; keepTitle(); A.sfx('click'); return; }
  if (ds.setsec) { send({ t: 'setSec', sec: +ds.setsec }); return; }
  if (ds.kick) { send({ t: 'kick', id: ds.kick }); return; }
  if (ds.decl) {
    const n = +ds.decl; if (myRollPending()) return;
    if (COARSE && ST.pick !== n) { ST.pick = n; if (S3) S3.preview(me(), n); A.sfx('click'); vib(8); renderDock(); return; }   // touch: tap to choose, tap again to declare
    ST.pick = null; if (S3) S3.preview(null); send({ t: 'declare', v: n }); A.sfx('clack'); vib(15); return;
  }
  if (ds.pass != null) { A.sfx('slap'); send({ t: ST.view.review.iPassed ? 'unpass' : 'pass' }); return; }
  if (ds.doubt != null) { vib(25); A.sfx('slap'); if (ST.view.review.iPassed) send({ t: 'unpass' }); send({ t: 'doubt', rank: ST.view.review.myStake === 'goal' ? ST.stake : undefined }); return; }
  if (ds.stake) { ST.stake = +ds.stake; renderDock(); return; }
  if (ds.stamp) { send({ t: 'react', k: +ds.stamp }); if (ST.sheet === 'stamps') closeSheet(); return; }
  if (ds.skip != null) { send({ t: 'skipTurn' }); return; }
  if (ds.player) { openSheet('p' + ds.player); return; }
  if (ds.color || ds.style) {
    const L = myLook(); if (ds.color) L.color = +ds.color; if (ds.style) L.style = +ds.style; store.set('gp.look', L); A.sfx('click');
    if (ST.room && ST.room.phase === 'lobby') send({ t: 'look', color: ds.color ? +ds.color : undefined, style: ds.style ? +ds.style : undefined });
    else renderTitleKeepOpen();
    return;
  }
  if (ds.guide) { guide(+ds.guide); A.sfx('click'); return; }
  if (ds.sheet) { openSheet(ds.sheet); return; }
  if (ds.opt) {
    if (ds.opt === 'bgm') A.setBgm(!A.bgmOn);
    if (ds.opt === 'sfx') A.setSfx(!A.sfxOn);
    if (ds.opt === 'guard') setGuard(!ST.guard);
    if (ds.opt === 'vibe') { ST.vibe = !ST.vibe; store.set('gp.vibe', ST.vibe); vib(30); }
    if (ds.opt === 'log') { ST.showLog = !ST.showLog; store.set('gp.log', ST.showLog); applyLog(); renderDock(); }
    if (ds.opt === 'calm') { ST.calm = !ST.calm; store.set('gp.calm', ST.calm); if (S3) S3.setCalm(ST.calm); }
    syncToggles(); renderSheet(); return;
  }
  switch (t.id) {
    case 'bPractice': { saveName(); startPractice(); break; }
    case 'bCreate': { if (!saveName()) return; ST.joinErr = ''; if (ST.wsMode) ST.t.send({ t: 'create', name: ST.name, sec: ST.cfg.sec }); else hostP2P(); break; }
    case 'bJoin': { if (!saveName()) return; const c = ($('#code').value || '').trim().toUpperCase(); if (c.length !== 4) { $('#err').textContent = '4文字のルームコードを入力してください'; return; } ST.joinErr = ''; if (ST.wsMode) ST.t.send({ t: 'join', code: c, name: ST.name }); else joinP2P(c, null); break; }
    case 'bRejoin': { const s = store.get('gp.session'); if (s) { if (ST.wsMode) ST.t.send({ t: 'join', code: s.code, token: s.token, name: ST.name }); else joinP2P(s.code, s.token); } break; }
    case 'bBot': send({ t: 'addBot' }); break;
    case 'bStart': send({ t: 'start' }); break;
    case 'bCopy': { const link = location.origin + location.pathname + '?room=' + ST.room.code; navigator.clipboard.writeText(link).then(() => toast('コピーしました'), () => toast('リンクを選択してコピーしてください')); break; }
    case 'bAgain': send({ t: 'lobby' }); ST.overShown = false; break;
    case 'bQuit': case 'bLeave': case 'bLeave2': closeSheet(); leave(); break;
    case 'bMenu': case 'bSettings': case 'bSettings2': openSheet('menu'); break;
    case 'bLogT': ST.showLog = !ST.showLog; store.set('gp.log', ST.showLog); applyLog(); break;
    case 'bGuide': closeSheet(); guide(0); break;
    case 'bGuard': setGuard(!ST.guard); break;
    case 'bRules': case 'bRules2': closeSheet(); modal(RULES); $('#modal').classList.add('paper'); break;
    case 'bLog': modal(`<h2>通信ログ</h2><div class="log" style="max-height:60vh">${ST.logs.slice().reverse().map(x => `<div>${x}</div>`).join('')}</div>`); break;
    case 'bBgm': A.setBgm(!A.bgmOn); syncToggles(); break;
    case 'bSfx': A.setSfx(!A.sfxOn); syncToggles(); break;
    case 'bSnd': A.setBgm(!A.bgmOn); A.setSfx(A.bgmOn); renderTitle(); break;
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && ST.sheet) { closeSheet(); return; }
  if (e.target.tagName === 'INPUT') { if (e.key === 'Enter' && e.target.id === 'code') $('#bJoin').click(); return; }
  const v = ST.view; if (!v || v.over) return;
  if ((e.code === 'Space' || e.key === 'Enter') && myRollPending()) { e.preventDefault(); if (!e.repeat) { if (e.key === 'Enter') { shakeStart('key'); shakeEnd(true); } else shakeStart('key'); } return; }
  if (e.code === 'Space' && !e.repeat && canPeek()) { e.preventDefault(); peek(true); return; }
  if (v.phase === 'declare' && v.turn === me() && !myRollPending() && '1234'.includes(e.key)) { ST.pick = null; if (S3) S3.preview(null); send({ t: 'declare', v: +e.key }); A.sfx('clack'); }
  if (v.phase === 'review' && v.turn !== me() && v.review.myStake) {
    if (e.key === 'd' || e.key === 'D') $('[data-doubt]') && $('[data-doubt]').click();
    if (e.key === 's' || e.key === 'S') $('[data-pass]') && $('[data-pass]').click();
  }
});
document.addEventListener('input', (e) => { if (e.target.id === 'vol') { A.setVol(+e.target.value / 100); store.set('gp.vol', A.vol); } });
// when the tab is in the background (e.g. you're in Discord), the tab title tells you it's your move
const BASE_TITLE = document.title;
function attention() {
  const v = ST.view; let msg = '';
  if (v && !v.over && ST.room && ST.room.phase === 'game') {
    if (v.phase === 'declare' && v.turn === me()) msg = '● あなたの手番';
    else if (v.phase === 'review' && v.turn !== me() && v.review.myStake && !v.review.iPassed && !ST.room.doubters.length) msg = '● ダウト審議中';
    else if (v.phase === 'review' && v.turn === me()) msg = '● 審議されています';
  }
  const t = document.hidden && msg ? `${msg} — ${BASE_TITLE}` : BASE_TITLE;
  if (document.title !== t) document.title = t;
}
setInterval(attention, 1000); document.addEventListener('visibilitychange', attention);
function setGuard(on) { ST.guard = on; store.set('gp.guard', on); ST.peeking = false; syncToggles(); renderDock(); toast(on ? '出目ガードON：押している間だけ出目を表示' : '出目ガードOFF'); }
function syncToggles() {
  const set = (id, on) => { const b = $(id); if (b) b.setAttribute('aria-pressed', on); };
  set('#bBgm', A.bgmOn); set('#bSfx', A.sfxOn); set('#bGuard', ST.guard);
}
function canPeek() { const v = ST.view; return ST.guard && v && !v.over && v.turn === me() && (v.phase === 'declare' || v.phase === 'review') && !myRollPending(); }
function peek(on) {
  if (on && !canPeek()) return;
  if (ST.peeking === on) return;
  ST.peeking = on; if (on) { vib(10); if (ST.peekedSeq !== ST.turnSeq) { ST.peekedSeq = ST.turnSeq; A.sfx('click'); } }
  renderDock();
}
document.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-peek]')) { e.preventDefault(); peek(true); } });
for (const ev of ['pointerup', 'pointercancel', 'blur']) addEventListener(ev, () => peek(false));
document.addEventListener('contextmenu', (e) => { if (e.target.closest('[data-peek]')) e.preventDefault(); });
document.addEventListener('keyup', (e) => { if (e.code === 'Space') { peek(false); if (ST.roll.src === 'key') shakeEnd(); } });
// the cup: press and hold to shake, let go to slam it down (a quick tap shakes for a moment by itself)
document.addEventListener('pointerdown', (e) => { if (e.target.closest('[data-roll]')) { e.preventDefault(); shakeStart('ptr'); } });
for (const ev of ['pointerup', 'pointercancel']) addEventListener(ev, () => { if (ST.roll.src === 'ptr') shakeEnd(); });
addEventListener('blur', () => { if (ST.roll.st === 'shake') shakeEnd(); });
// PC: hovering a number shows where the packet would go
document.addEventListener('pointerover', (e) => { if (e.pointerType !== 'mouse' || !S3) return; const t = e.target.closest('[data-decl]'); if (t && !t.disabled) S3.preview(me(), +t.dataset.decl); });
document.addEventListener('pointerout', (e) => { if (e.pointerType !== 'mouse' || !S3) return; const t = e.target.closest('[data-decl]'); if (t && !(e.relatedTarget && t.contains(e.relatedTarget))) S3.preview(ST.pick ? me() : null, ST.pick); });
// PC: drag the table to turn it, wheel to zoom, double-click to reset
(() => {
  const c = $('#gl'); let drag = null;
  c.addEventListener('pointerdown', (e) => { if (ST.layout === 'pc' && e.pointerType === 'mouse' && S3) { drag = e.clientX; c.setPointerCapture(e.pointerId); } });
  c.addEventListener('pointermove', (e) => { if (drag != null) { S3.orbit((e.clientX - drag) * 0.004); drag = e.clientX; } });
  c.addEventListener('pointerup', () => { drag = null; });
  c.addEventListener('wheel', (e) => { if (ST.layout === 'pc' && S3) { e.preventDefault(); S3.zoomBy(e.deltaY > 0 ? 0.93 : 1.07); } }, { passive: false });
  c.addEventListener('dblclick', () => { if (S3) S3.resetView(); });
  // touch: pinch to zoom the board, drag to slide it while zoomed, double-tap to reset
  const pts = new Map(); let last = null, tapAt = 0;
  const mid = () => { const a = [...pts.values()]; return a.length < 2 ? a[0] : { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2, d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) }; };
  c.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' || !S3) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); c.setPointerCapture(e.pointerId); last = mid();
    if (pts.size === 1) { const t = performance.now(); if (t - tapAt < 300) { S3.resetView(); syncZoomChip(); } tapAt = t; }
  });
  c.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const m = mid(); if (!last || !m) return;
    if (pts.size >= 2 && last.d) S3.zoomBy(m.d / last.d);
    if (pts.size >= 2 || S3.zoom > 1.05) S3.panBy(m.x - last.x, m.y - last.y);
    last = m; syncZoomChip();
  });
  for (const ev of ['pointerup', 'pointercancel']) c.addEventListener(ev, (e) => { pts.delete(e.pointerId); last = mid(); });
  // keep iOS Safari from zooming the whole page instead
  for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
})();
function syncZoomChip() {
  const b = $('#bZoom'); if (!b || !S3) return;
  b.hidden = ST.layout === 'pc' || !(S3.zoom > 1.03 || S3.zoom < 0.97 || Math.hypot(...S3.pan) > 0.3);
}
function keepTitle() { const nmv = $('#nm') && $('#nm').value, code = $('#code') && $('#code').value, open = $('.lookbox') && $('.lookbox').open; renderTitle(); if (nmv != null && $('#nm')) $('#nm').value = nmv; if (code != null && $('#code')) $('#code').value = code; if (open && $('.lookbox')) $('.lookbox').open = true; }
function renderTitleKeepOpen() { const nmv = $('#nm') && $('#nm').value; renderTitle(); const d = $('.lookbox'); if (d) d.open = true; if (nmv != null && $('#nm')) $('#nm').value = nmv; }
function saveName() {
  const i = $('#nm'); const v = (i ? i.value : ST.name).trim();
  if (!v) { const er = $('#err'); if (er) er.textContent = 'ハンドルネームを入力してください'; else toast('ハンドルネームを入力してください'); return false; }
  ST.name = v.slice(0, 10); store.set('gp.name', ST.name); return true;
}
function startPractice() {
  if (ST.t) ST.t.close && ST.mode === 'practice' && ST.t.close();
  ST.mode = 'practice'; ST.room = null; ST.logs = [];
  const L = new Local(onMsg); ST.prevT = ST.t; ST.t = L; L.start(ST.name || 'あなた', ST.cfg.n, ST.cfg.sec);
  A.init(); A.setMode('game');
}
function leave() {
  if (ST.mode === 'practice' && ST.t) { ST.t.close(); ST.t = ST.wsMode ? ST.onlineT : null; }
  else if (ST.mode === 'online' && ST.p2p) { send({ t: 'leave' }); store.del('gp.session'); ST.p2p.close(); ST.p2p = null; ST.t = null; ST.onlineT = null; ST.isP2PHost = false; $('#reconn').hidden = true; }
  else if (ST.mode === 'online') { send({ t: 'leave' }); store.del('gp.session'); ST.onlineT.close(); ST.onlineT = null; connectOnline(); }
  ST.mode = ST.online && ST.wsMode ? 'online' : null; ST.room = null; ST.view = null; ST.setupKey = ''; ST.fxQ = []; keepAwake(false); fitCanvas(); hideDuel();
  $('#hud').hidden = true; A.setMode('lobby'); renderTitle();
}

// ───────── per-frame HUD (timer, bubbles, music) ─────────
function frame() {
  requestAnimationFrame(frame);
  const v = ST.view;
  // watchdog: the private reel must never block declaring
  if (ST.roll.st === 'land' && performance.now() - ST.roll.t0 > 4000) land();
  for (const b of ST.bubbles) placeBubble(b);
  if (!v || !ST.room || ST.room.phase !== 'game') { if (S3) S3.setTimer(0, false, false); return; }
  if (v.phase === 'review' && !v.over) {
    const total = ST.room.sec * 1000, left = ST.frozen ? 0 : Math.max(0, ST.deadline - performance.now());
    const sec = Math.ceil(left / 1000), el = $('#timer');
    if (el && !ST.frozen) { el.textContent = sec; el.classList.toggle('hurry', left < 5000); }
    const hg = $('#hglass'); if (hg) { hg.style.setProperty('--k', (ST.frozen ? 0 : left / total).toFixed(3)); hg.classList.toggle('hurry', left < 5000); }
    if (S3) S3.setTimer(ST.frozen ? 1 : left / total, left < 10000 || ST.frozen, true);
    if (!ST.frozen && !ST.fxBusy) {
      A.setMode(left < 10000 ? 'climax' : 'tension'); A.setTension(1 - left / total);
      if (sec !== ST.lastTickSec) { ST.lastTickSec = sec; if (sec <= 5 && sec > 0) { A.sfx('tick', { hi: sec <= 3 }); if (v.review.myStake || v.turn === me()) vib(12); } else if (sec <= 10 && sec > 0) A.sfx('heart'); }
    }
  } else {
    if (S3) S3.setTimer(0, false, false);
    if (!v.over && !ST.fxBusy) A.setMode('game');
    ST.lastTickSec = null;
  }
}
requestAnimationFrame(frame);
setInterval(() => { if (ST.view && ST.view.phase === 'declare' && ST.room) { ST.room.turnFor += 1000; ST.room.members.forEach(m => { if (!m.connected && !m.bot) m.discFor += 1000; }); if (!rollBusy() && ST.view.turn !== me()) renderDock(); } }, 1000);
setInterval(() => { if (ST.mode === 'online' && ST.onlineT && ST.room) ST.onlineT.send({ t: 'ping', at: Date.now() }); }, 5000);
function renderPing() { const el = $('#hudCode'); if (el && ST.mode === 'online' && ST.room) el.textContent = 'ROOM ' + ST.room.code + (ST.ping != null ? `・${ST.ping}ms` : ''); }

// ───────── boot ─────────
// ── peer-to-peer (GitHub Pages etc.) ──
function p2pStatus(st) { const el = $('#reconn'); if (!el) return; el.hidden = st !== 'reconnecting'; }
function p2pFail(e) {
  const msg = e && e.type === 'noroom' ? e.message : e && e.type === 'browser-incompatible' ? 'このブラウザはオンライン対戦に対応していません' : (e && e.message) || '接続できませんでした';
  ST.joinErr = msg; if (ST.p2p) { try { ST.p2p.close(); } catch (x) {} ST.p2p = null; } ST.t = null; ST.mode = null; $('#reconn').hidden = true;
  if (!ST.room) renderTitle(); else toast(msg);
}
async function hostP2P() {
  if (ST.busy) return; ST.busy = true; toast('ルームを準備しています…');
  const h = new P2PHost(onMsg, p2pStatus);
  try { await h.open(ST.name, ST.cfg.sec); ST.p2p = h; ST.t = h; ST.onlineT = h; ST.mode = 'online'; ST.isP2PHost = true; }
  catch (e) { p2pFail(e); }
  ST.busy = false;
}
async function joinP2P(code, token) {
  if (ST.busy) return; ST.busy = true; toast('ホストに接続しています…');
  const c = new P2PClient(onMsg, p2pStatus);
  ST.p2p = c; ST.t = c; ST.onlineT = c; ST.mode = 'online'; ST.isP2PHost = false;
  const hello = () => { const s = store.get('gp.session'); return { t: 'join', code, name: ST.name, token: (s && s.code === code && !s.host && s.token) || token || undefined }; };
  try { await c.open(code, hello); } catch (e) { p2pFail(e); }
  ST.busy = false;
}
async function connectOnline() {
  if (!/^https?:$/.test(location.protocol)) return false;
  // a Node server (server.js) answers /healthz; static hosts like GitHub Pages don't → play peer-to-peer
  try { const ctl = new AbortController(); setTimeout(() => ctl.abort(), 1500); const r = await fetch('healthz', { signal: ctl.signal, cache: 'no-store' }); if (!r.ok || !/^ok/.test(await r.text())) throw 0; }
  catch (e) { ST.wsMode = false; ST.online = p2pAvailable() && !/claude|anthropic/.test(location.hostname); return false; }
  ST.wsMode = true;
  const o = new Online(onMsg);
  try { await o.open(); ST.onlineT = o; ST.online = true; if (ST.mode !== 'practice') { ST.t = o; ST.mode = 'online'; } return true; } catch (e) { return false; }
}
(async () => {
  applyLayout(true); syncToggles(); applyLog(); if (S3) S3.setCalm(ST.calm);
  if (!store.get('gp.guideSeen')) setTimeout(() => { if (!ST.room) guide(0); }, 900);
  renderTitle();
  const ok = await connectOnline();
  renderTitle();
  if (!ok && ST.online) {
    const sess = store.get('gp.session'), qp = new URLSearchParams(location.search).get('room');
    if (sess && !sess.host && Date.now() - (sess.at || 0) < 3 * 3600e3 && (!qp || qp.toUpperCase() === sess.code)) joinP2P(sess.code, sess.token);
  }
  if (ok) {
    const sess = store.get('gp.session'), qp = new URLSearchParams(location.search).get('room');
    if (sess && (!qp || qp.toUpperCase() === sess.code)) ST.t.send({ t: 'join', code: sess.code, token: sess.token, name: ST.name });
  }
})();
window.__GP = { ST, S3, A, splash, catJack }; // debug handle
