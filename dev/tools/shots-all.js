let pw; try { pw = require('playwright'); } catch (e) { pw = require('/opt/npm-tools/node_modules/playwright'); } const { chromium } = pw;
// usage: node dev/tools/shots-all.js <outDir> [url]   (practice mode, PC + phone sizes)
const out = process.argv[2] || '.', url = process.argv[3] || 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [w, h, nm, dpr] of [[1366, 768, 'pc', 1], [390, 844, 'sp', 2]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: nm === 'sp', isMobile: nm === 'sp' });
    await ctx.route(/jsdelivr|googleapis|gstatic/, r => r.abort());
    await ctx.addInitScript(() => { try { localStorage.setItem('gp.guideSeen', '1'); } catch (e) {} });
    const p = await ctx.newPage(); p.on('pageerror', e => console.log(nm, 'ERR', e.message));
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); await p.waitForTimeout(2500);
    const S = async (k) => p.screenshot({ path: `${out}/${nm}_${k}.png` });
    await S('title');
    await p.evaluate(() => { document.querySelector('[data-n="4"]').click(); document.querySelector('#bPractice').click(); });
    await p.waitForTimeout(500); await S('start');
    const shots = new Set();
    for (let k = 0; k < 400 && shots.size < 7; k++) {
      const st = await p.evaluate(() => { const v = __GP.ST.view; if (!v) return {}; return { ph: v.phase, t: v.turn, me: __GP.ST.you.seat, spin: __GP.ST.spin.active, susp: !!__GP.ST.suspense, stage: __GP.ST.duelStage, over: !!v.over, kind: v.last && v.last.kind }; });
      if (st.over) { await p.waitForTimeout(2500); await S('over'); break; }
      if (st.ph === 'declare' && st.t === st.me && st.spin && !shots.has('spin')) { shots.add('spin'); await p.waitForTimeout(400); await S('spin'); }
      if (st.ph === 'declare' && st.t === st.me && !st.spin) { if (!shots.has('mine')) { shots.add('mine'); await S('mine'); } await p.evaluate(() => { const b = [...document.querySelectorAll('[data-decl]')]; b[Math.floor(Math.random() * 4)].click(); }); }
      if (st.ph === 'declare' && st.t !== st.me && !shots.has('other')) { shots.add('other'); await S('other'); }
      if (st.ph === 'review' && st.t !== st.me && !st.susp) { if (!shots.has('review')) { shots.add('review'); await p.waitForTimeout(600); await S('review'); }
        await p.evaluate(() => { if (Math.random() < .35) document.querySelector('[data-doubt]') && document.querySelector('[data-doubt]').click(); else { const d = document.querySelector('[data-pass][aria-pressed="false"]'); d && d.click(); } }); }
      if (st.susp && !shots.has('duel')) { shots.add('duel'); await p.waitForTimeout(1500); await S('duel'); }
      if (st.ph === 'result' && st.kind !== 'pass' && !shots.has('res')) { shots.add('res'); await S('res'); }
      await p.evaluate(() => __GP.ST && __GP.fast && __GP.fast());
      await p.waitForTimeout(150);
    }
    await ctx.close();
  }
  await b.close();
})();
