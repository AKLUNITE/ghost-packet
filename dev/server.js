// GHOST//PACKET online server — zero dependencies (Node 18+).
// Dev/test server: serves the repo root (the GitHub Pages site) and runs authoritative game rooms over WebSocket at /ws.
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createRoom } = require('../room.js');

const PORT = +process.env.PORT || 8080;
const TEST = process.env.GP_TEST === '1';
const PUB = path.join(__dirname, '..');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json' };

// ── static files ─────────────────────────────────────────────
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/healthz') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok ' + rooms.size); }
  let p = decodeURIComponent(url.pathname);
  if (p === '/' || p === '') p = '/index.html';
  const f = path.normalize(path.join(PUB, p));
  if (!f.startsWith(PUB) || /^[\\/](dev|\.git)([\\/]|$)/.test(f.slice(PUB.length))) { res.writeHead(403); return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream', 'cache-control': p.endsWith('.html') ? 'no-cache' : 'public, max-age=300' });
    res.end(data);
  });
});

// ── minimal RFC 6455 WebSocket ───────────────────────────────
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MSG = 8 * 1024;
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (new URL(req.url, 'http://x').pathname !== '/ws' || !key || (req.headers.upgrade || '').toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  onConnection(wrap(socket));
});

function wrap(socket) {
  const c = { alive: true, onmessage: null, onclose: null, closed: false, lastSeen: Date.now() };
  let buf = Buffer.alloc(0), frag = [];
  function frame(op, payload) {
    const len = payload.length; let head;
    if (len < 126) head = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    return Buffer.concat([head, payload]);
  }
  c.send = (obj) => { if (c.closed) return; try { socket.write(frame(1, Buffer.from(JSON.stringify(obj)))); } catch (e) { close(); } };
  c.ping = () => { if (!c.closed) try { socket.write(frame(9, Buffer.alloc(0))); } catch (e) { close(); } };
  function close() { if (c.closed) return; c.closed = true; try { socket.end(frame(8, Buffer.alloc(0))); } catch (e) {} socket.destroy(); c.onclose && c.onclose(); }
  c.close = close;
  socket.on('data', (d) => {
    c.lastSeen = Date.now();
    buf = Buffer.concat([buf, d]);
    while (buf.length >= 2) {
      const fin = buf[0] & 0x80, op = buf[0] & 0x0f, masked = buf[1] & 0x80;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      if (len > MAX_MSG) return close();
      if (!masked) return close(); // clients must mask
      if (buf.length < off + 4 + len) return;
      const mask = buf.subarray(off, off + 4); off += 4;
      const pl = Buffer.from(buf.subarray(off, off + len));
      for (let i = 0; i < pl.length; i++) pl[i] ^= mask[i & 3];
      buf = buf.subarray(off + len);
      if (op === 8) return close();
      if (op === 9) { try { socket.write(frame(10, pl)); } catch (e) {} continue; }
      if (op === 10) continue;
      if (op === 1 || op === 0) {
        frag.push(pl);
        if (fin) {
          const text = Buffer.concat(frag).toString('utf8'); frag = [];
          let msg; try { msg = JSON.parse(text); } catch (e) { continue; }
          c.onmessage && c.onmessage(msg);
        }
      }
    }
  });
  socket.on('close', close);
  socket.on('error', close);
  return c;
}

// ── rooms ────────────────────────────────────────────────────
const rooms = new Map();          // code -> room
const conns = new Map();          // memberId -> connection
const CODE_CH = 'ACDEFHJKLMNPRTUVWXY34679';
function newCode() { let c; do { c = Array.from({ length: 4 }, () => CODE_CH[crypto.randomInt(CODE_CH.length)]).join(''); } while (rooms.has(c)); return c; }
function makeRoom() {
  const code = newCode();
  const room = createRoom({ code, test: TEST, send: (id, msg) => { const c = conns.get(id); if (c) c.send(msg); }, timing: TEST ? { pass: 300, doubt: 400, goal: 0, botMin: 10, botScale: 0.05 } : undefined });
  rooms.set(code, room); return room;
}

function onConnection(c) {
  let room = null, member = null;
  let bucket = 20, last = Date.now(), strikes = 0;
  c.onmessage = (msg) => {
    // token bucket: ~12 msgs/s sustained, bursts of 20; persistent flooding closes the socket
    const t = Date.now(); bucket = Math.min(20, bucket + (t - last) / 1000 * 12); last = t;
    if (bucket < 1) { if (++strikes > 60) c.close(); return; }
    bucket--;
    if (!msg || typeof msg.t !== 'string') return;
    if (msg.t === 'ping') return c.send({ t: 'pong', at: msg.at, now: Date.now() });
    if (!member) {
      try {
        if (msg.t === 'create') { room = makeRoom(); if ([20, 40, 60].includes(msg.sec)) room.R.sec = msg.sec; }
        else if (msg.t === 'join') { room = rooms.get(String(msg.code || '').toUpperCase()); if (!room) throw Object.assign(new Error('ルームが見つかりません'), { code: 'noroom' }); }
        else return;
        const prev = msg.token && room.R.members.find(m => m.token === msg.token);
        if (prev && conns.has(prev.id)) { const old = conns.get(prev.id); old.onclose = null; old.close(); }
        member = room.join(msg.name, msg.token);
        conns.set(member.id, c);
        room.resend(member.id);
      } catch (e) { c.send({ t: 'error', code: e.code || 'join', msg: e.message, fatal: true }); room = null; }
      return;
    }
    room.handle(member.id, msg);
  };
  c.onclose = () => { if (member && conns.get(member.id) === c) { conns.delete(member.id); room.disconnect(member.id); } };
}

setInterval(() => { for (const r of rooms.values()) r.tick(); }, 50);
setInterval(() => {
  const t = Date.now();
  for (const [code, r] of rooms) {
    const live = r.R.members.some(m => !m.bot && m.connected);
    if (!live && t - r.R.lastActivity > 30 * 60 * 1000) { r.destroy(); rooms.delete(code); }
  }
}, 60 * 1000);
// keep sockets healthy (and Render's idle timer counts WebSocket traffic)
setInterval(() => { for (const c of conns.values()) c.ping(); }, 25000);

server.listen(PORT, () => console.log(`GHOST//PACKET server on http://localhost:${PORT}${TEST ? ' (TEST MODE)' : ''}`));
module.exports = { server, rooms };
