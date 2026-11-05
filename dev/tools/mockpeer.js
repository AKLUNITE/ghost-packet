(() => { const mem = {}; const st = { getItem: k => k in mem ? mem[k] : null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; }, clear: () => { for (const k in mem) delete mem[k]; }, key: i => Object.keys(mem)[i] || null, get length() { return Object.keys(mem).length; } }; Object.defineProperty(window, 'localStorage', { value: st, configurable: true }); st.setItem('gp.guideSeen', '1'); })();
// PeerJS-compatible mock over BroadcastChannel (same browser context, many tabs)
(() => {
  const bc = new BroadcastChannel('mockpeer');
  const peers = new Map();            // local peers in this page
  const Em = () => { const h = {}; return { on(e, f) { (h[e] = h[e] || []).push(f); return this; }, emit(e, ...a) { (h[e] || []).forEach(f => { try { f(...a); } catch (x) { console.error(x); } }); } }; };
  function Conn(peer, cid, other) { const c = Object.assign(Em(), { open: false, peer: other, cid });
    c.send = (data) => { if (!c.open) return; bc.postMessage({ type: 'data', cid, to: other, from: peer.id, data: JSON.parse(JSON.stringify(data)) }); };
    c.close = () => { if (!c.open && c._closed) return; c._closed = true; c.open = false; bc.postMessage({ type: 'close', cid, to: other }); c.emit('close'); peer.conns.delete(cid); };
    return c; }
  window.Peer = function (id, opts) {
    if (typeof id === 'object' || id == null) id = 'p' + Math.random().toString(36).slice(2, 10);
    const p = Object.assign(Em(), { id, conns: new Map(), disconnected: false, destroyed: false });
    p.reconnect = () => {}; p.destroy = () => { p.destroyed = true; for (const c of p.conns.values()) c.close(); peers.delete(id);  };
    p.connect = (to) => { const cid = 'c' + Math.random().toString(36).slice(2); const c = Conn(p, cid, to); p.conns.set(cid, c);
      bc.postMessage({ type: 'connect', cid, from: id, to });
      setTimeout(() => { if (!c.open && !c._closed) { p.emit('error', { type: 'peer-unavailable', message: 'unavailable' }); c._closed = true; } }, 1200);
      return c; };
    peers.set(id, p);
    setTimeout(() => { if (false) p.emit('error', { type: 'unavailable-id' }); else p.emit('open', id); }, 30);
    return p;
  };
  addEventListener('pagehide', () => { for (const p of peers.values()) p.destroy(); });
  bc.onmessage = ({ data: m }) => { 
    if (m.type === 'connect') { const p = peers.get(m.to);  if (!p || p.destroyed) return; const c = Conn(p, m.cid, m.from); c.open = true; p.conns.set(m.cid, c); p.emit('connection', c); bc.postMessage({ type: 'accept', cid: m.cid, to: m.from }); setTimeout(() => c.emit('open'), 0); return; }
    for (const p of peers.values()) { const c = p.conns.get(m.cid); if (!c) continue;
      if (m.type === 'accept' && m.to === p.id) { c.open = true; c.emit('open'); }
      if (m.type === 'data' && m.to === p.id) c.emit('data', m.data);
      if (m.type === 'close' && m.to === p.id) { c.open = false; c._closed = true; p.conns.delete(m.cid); c.emit('close'); } }
  };
})();
