let pw; try { pw = require('playwright'); } catch (e) { pw = require('/opt/npm-tools/node_modules/playwright'); } const { chromium } = pw;
// usage: node dev/tools/e2e-p2p.js <outDir> [url]   (serve the repo root first, e.g. python3 -m http.server 8097)
const fs = require('fs'), path = require('path'); const out = process.argv[2] || '.'; const URL0 = process.argv[3] || 'http://localhost:8097/';
const MOCK = fs.readFileSync(path.join(__dirname, 'mockpeer.js'), 'utf8');
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 900, height: 600 } });
  await ctx.route(/jsdelivr|googleapis|gstatic/, r => r.abort());
  await ctx.addInitScript(MOCK); await ctx.addInitScript(() => { try { localStorage.setItem('gp.guideSeen', '1'); } catch (e) {} });
  const errs = [];
  const open = async (name) => { const p = await ctx.newPage(); p.on('pageerror', e => errs.push(name + ': ' + e.message)); await p.goto(URL0, { waitUntil: 'domcontentloaded', timeout: 60000 }); await p.waitForTimeout(2200); return p; };
  const host = await open('host');
  console.log('online card:', await host.evaluate(() => !!document.querySelector('#bCreate')), '| wsMode', await host.evaluate(() => __GP.ST.wsMode));
  await host.evaluate(() => { document.querySelector('#nm').value = 'ホスト'; document.querySelector('#bCreate').click(); });
  await host.waitForTimeout(1200);
  const code = await host.evaluate(() => __GP.ST.room && __GP.ST.room.code); console.log('room', code);
  // bad code
  const g0 = await open('bad'); await g0.evaluate(() => { document.querySelector('#nm').value = 'X'; document.querySelector('#code').value = 'ZZZZ'; document.querySelector('#bJoin').click(); });
  await g0.waitForTimeout(2500); console.log('bad code →', await g0.evaluate(() => document.querySelector('#err') && document.querySelector('#err').textContent)); await g0.close();
  const gs = [];
  for (const nm of ['アオ', 'ミドリ', 'キイロ']) { const g = await open(nm); await g.evaluate(([nm, code]) => { document.querySelector('#nm').value = nm; document.querySelector('#code').value = code; document.querySelector('#bJoin').click(); }, [nm, code]); await g.waitForTimeout(900); gs.push(g); }
  console.log('lobby members (host view):', await host.evaluate(() => __GP.ST.room.members.map(m => m.name).join(',')));
  console.log('guest sees:', await gs[0].evaluate(() => __GP.ST.room && __GP.ST.room.members.length + ' members, host=' + __GP.ST.you.host));
  await host.screenshot({ path: out + '/p2p_lobby.png' });
  await host.evaluate(() => document.querySelector('#bStart').click()); await host.waitForTimeout(1500);
  // autoplay everyone for a while; audit hidden roll on guests
  let shakes = 0, seenShake = 0, leaks = 0, turns = new Set(), reconnected = null;
  const pages = [host, ...gs];
  for (let k = 0; k < 90; k++) {
    for (const p of pages) {
      const st = await p.evaluate(() => { const v = __GP.ST.view; if (!v) return null; return { ph: v.phase, turn: v.turn, me: __GP.ST.you.seat, spin: __GP.ST.roll.st !== 'done' && __GP.ST.roll.id === __GP.ST.room.turnId, rst: __GP.ST.roll.st, roll: v.myRoll, over: !!v.over, others: __GP.ST.room.rollSt }; });
      if (!st) continue; turns.add(st.turn);
      if (st.roll !== undefined && st.turn !== st.me) leaks++;
      if (st.ph === 'declare' && st.turn === st.me && st.rst === 'ready') { await p.bringToFront(); await p.keyboard.press('Enter'); shakes++; }
      if (st.ph === 'declare' && st.turn !== st.me && st.others === 'shake') seenShake++;
      if (st.ph === 'declare' && st.turn === st.me && !st.spin) await p.evaluate(() => { const b = [...document.querySelectorAll('[data-decl]')]; b.length && b[Math.floor(Math.random() * 4)].click(); });
      if (st.ph === 'review' && st.turn !== st.me) await p.evaluate(() => { if (Math.random() < .1) { const d = document.querySelector('[data-doubt]'); d && d.click(); } else { const d = document.querySelector('[data-pass][aria-pressed="false"]'); d && d.click(); } });
    }
    if (k === 30) { // guest drops its connection and must come back to the same seat
      const before = await gs[1].evaluate(() => __GP.ST.you.seat);
      await gs[1].evaluate(() => __GP.ST.p2p.conn.close());
      await gs[1].waitForTimeout(2500);
      reconnected = await gs[1].evaluate((b) => ({ same: __GP.ST.you.seat === b, connected: __GP.ST.room.members.find(m => m.seat === b).connected }), before);
    }
    if (k === 45) await gs[0].screenshot({ path: out + '/p2p_guest.png' });
    await host.waitForTimeout(250);
  }
  // hidden-tab host: clock must keep running (worker-driven timers)
  console.log('turns seen', [...turns].sort().join(','), '| hidden-roll leaks', leaks, '| guest reconnect', JSON.stringify(reconnected), '| shakes', shakes, 'others saw shaking', seenShake);
  // host leaves → guests get sent back to title
  await host.evaluate(() => document.querySelector('#bLeave') && document.querySelector('#bLeave').click()); await gs[2].waitForTimeout(1500);
  console.log('after host left, guest screen:', await gs[2].evaluate(() => document.querySelector('#screen').dataset.v), '| err:', await gs[2].evaluate(() => __GP.ST.joinErr));
  console.log(errs.join('\n') || 'no page errors'); await b.close();
})();
