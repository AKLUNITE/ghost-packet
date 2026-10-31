// GHOST//PACKET peer-to-peer play (no server). The host's browser runs the authoritative room (room.js) and
// sends every player only their own view, exactly like the Node server does. Guests talk to the host over
// WebRTC data channels brokered by PeerJS. Room code ⇄ peer id: "ghostpacket-<CODE>".
const PREFIX = 'ghostpacket-';
const CODE_CH = 'ACDEFHJKLMNPRTUVWXY34679';
const newCode = () => Array.from({ length: 4 }, () => CODE_CH[Math.floor(Math.random() * CODE_CH.length)]).join('');
const PEER_OPTS = { debug: 0 };

// Timers driven by a Worker heartbeat: background tabs throttle setTimeout (to once a minute in Chrome after
// a while), which would freeze the review clock while the host is looking at Discord. Worker messages are not.
function heartbeat(fn, ms = 50) {
  let w = null;
  try {
    const src = `setInterval(() => postMessage(0), ${ms});`;
    w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    w.onmessage = fn;
    return () => w.terminate();
  } catch (e) {
    const iv = setInterval(fn, ms); return () => clearInterval(iv);
  }
}
function makeScheduler() {
  let q = [], id = 0;
  return {
    set(fn, ms) { const h = ++id; q.push({ h, at: performance.now() + (ms || 0), fn }); return h; },
    clear(h) { q = q.filter(x => x.h !== h); },
    run() {
      const t = performance.now(); if (!q.some(x => x.at <= t)) return;
      const due = q.filter(x => x.at <= t).sort((a, b) => a.at - b.at); q = q.filter(x => x.at > t);
      for (const x of due) { try { x.fn(); } catch (e) { console.error(e); } }
    },
  };
}

export const p2pAvailable = () => typeof window.Peer === 'function' && typeof RTCPeerConnection === 'function';

// ───────── host ─────────
export class P2PHost {
  constructor(onMsg, onStatus) { this.onMsg = onMsg; this.onStatus = onStatus || (() => {}); this.conns = new Map(); this.closed = false; }
  // resolves with the room code once the broker has registered our id
  open(name, sec, tries = 0) {
    return new Promise((res, rej) => {
      const code = newCode();
      const peer = this.peer = new window.Peer(PREFIX + code, PEER_OPTS);
      let done = false;
      peer.on('open', () => {
        done = true; this.code = code;
        this.sched = makeScheduler();
        this.room = GPRoom.createRoom({
          code, send: (id, m) => this._send(id, m),
          setTimeout: (fn, ms) => this.sched.set(fn, ms), clearTimeout: (h) => this.sched.clear(h),
        });
        this.stopBeat = heartbeat(() => { this.sched.run(); this.room.tick(); });
        const me = this.room.join(name); this.me = me.id;
        if ([20, 40, 60].includes(sec)) this.room.handle(this.me, { t: 'setSec', sec });
        this.room.resend(this.me);
        res(code);
      });
      peer.on('connection', (conn) => this._accept(conn));
      peer.on('disconnected', () => { if (!this.closed) { this.onStatus('reconnecting'); setTimeout(() => { try { peer.reconnect(); } catch (e) {} }, 800); } });
      peer.on('error', (err) => {
        if (!done && err.type === 'unavailable-id' && tries < 4) { peer.destroy(); this.open(name, sec, tries + 1).then(res, rej); done = true; return; }
        if (!done) { done = true; rej(err); return; }
        if (err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error' || err.type === 'socket-closed') this.onStatus('reconnecting');
      });
      peer.on('open', () => this.onStatus('ok'));
      setTimeout(() => { if (!done) { done = true; try { peer.destroy(); } catch (e) {} rej(Object.assign(new Error('timeout'), { type: 'timeout' })); } }, 12000);
    });
  }
  _send(id, m) {
    if (id === this.me) { setTimeout(() => this.onMsg(m), 0); return; }
    const c = this.conns.get(id); if (c && c.open) { try { c.send(m); } catch (e) {} }
  }
  _accept(conn) {
    let member = null;
    conn.on('data', (msg) => {
      if (!msg || typeof msg.t !== 'string') return;
      if (msg.t === 'ping') { try { conn.send({ t: 'pong', at: msg.at }); } catch (e) {} return; }
      if (!member) {
        if (msg.t !== 'join') return;
        try {
          if (String(msg.code || '').toUpperCase() !== this.code) throw Object.assign(new Error('ルームが見つかりません'), { code: 'noroom' });
          // the host's own seat can never be claimed over the wire (e.g. a second tab of the host's browser)
          const tk = msg.token && this.room.R.members.some(m => m.token === msg.token && m.id === this.me) ? undefined : msg.token;
          const prev = tk && this.room.R.members.find(m => m.token === tk);
          if (prev && this.conns.has(prev.id)) { const old = this.conns.get(prev.id); this.conns.delete(prev.id); try { old.close(); } catch (e) {} }
          member = this.room.join(msg.name, tk);
          this.conns.set(member.id, conn);
          this.room.resend(member.id);
        } catch (e) { try { conn.send({ t: 'error', code: e.code || 'join', msg: e.message, fatal: true }); } catch (x) {} setTimeout(() => { try { conn.close(); } catch (x) {} }, 300); }
        return;
      }
      this.room.handle(member.id, msg);
    });
    const gone = () => { if (member && this.conns.get(member.id) === conn) { this.conns.delete(member.id); this.room.disconnect(member.id); } };
    conn.on('close', gone); conn.on('error', gone);
  }
  send(o) {
    if (this.closed || !this.room) return;
    if (o.t === 'ping') { setTimeout(() => this.onMsg({ t: 'pong', at: o.at }), 0); return; }
    this.room.handle(this.me, o);
  }
  close() {
    if (this.closed) return; this.closed = true;
    for (const c of this.conns.values()) { try { c.send({ t: 'error', code: 'hostgone', msg: 'ホストがルームを閉じました', fatal: true }); } catch (e) {} }
    setTimeout(() => { for (const c of this.conns.values()) { try { c.close(); } catch (e) {} } try { this.peer.destroy(); } catch (e) {} }, 300);
    if (this.stopBeat) this.stopBeat(); if (this.room) this.room.destroy();
  }
}

// ───────── guest ─────────
export class P2PClient {
  constructor(onMsg, onStatus) { this.onMsg = onMsg; this.onStatus = onStatus || (() => {}); this.closed = false; this.q = []; }
  open(code, hello) {
    this.code = code; this.hello = hello;
    return new Promise((res, rej) => {
      const peer = this.peer = new window.Peer(PEER_OPTS);
      let done = false;
      const fail = (e) => { if (!done) { done = true; rej(e); } };
      peer.on('open', () => this._connect(() => { if (!done) { done = true; res(); } }, fail));
      peer.on('error', (err) => {
        if (err.type === 'peer-unavailable') { if (!done) fail(Object.assign(new Error('ルームが見つかりません（コード違い、またはホストがいません）'), { type: 'noroom' })); else this._retry(); return; }
        if (!done) fail(err); else this._retry();
      });
      peer.on('disconnected', () => { if (!this.closed) setTimeout(() => { try { peer.reconnect(); } catch (e) {} }, 800); });
      setTimeout(() => fail(Object.assign(new Error('ホストに接続できませんでした'), { type: 'timeout' })), 15000);
    });
  }
  _connect(ok, ng) {
    const conn = this.conn = this.peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
    let opened = false;
    conn.on('open', () => {
      opened = true; this.retries = 0; this.onStatus('ok');
      conn.send(this.hello());           // join (with token on reconnect)
      this.q.splice(0).forEach(m => conn.send(m));
      ok && ok();
    });
    conn.on('data', (m) => { try { this.onMsg(m); } catch (e) { console.error(e); } });
    conn.on('close', () => { if (conn === this.conn && !this.closed) { this.onStatus('reconnecting'); this._retry(); } });
    conn.on('error', () => { if (!opened) ng && ng(new Error('ホストに接続できませんでした')); });
  }
  _retry() {
    if (this.closed || this.retryT) return;
    const k = (this.retries = (this.retries || 0) + 1);
    this.retryT = setTimeout(() => { this.retryT = null; if (this.closed) return; try { if (this.peer.disconnected) this.peer.reconnect(); } catch (e) {} this._connect(null, () => this._retry()); }, Math.min(5000, 700 + k * 600));
  }
  send(o) { if (this.conn && this.conn.open) { try { this.conn.send(o); } catch (e) {} } else if (this.q.length < 50) this.q.push(o); }
  close() { this.closed = true; clearTimeout(this.retryT); try { this.conn && this.conn.close(); } catch (e) {} setTimeout(() => { try { this.peer.destroy(); } catch (e) {} }, 200); }
}
