// usage: node dev/tools/shots-phone.js <outDir> [url] [WxH]   — iPhone Safari-sized checks: review dock, my turn, my doubt (duel), menu sheet
let pw; try { pw = require('playwright'); } catch (e) { pw = require('/opt/npm-tools/node_modules/playwright'); } const { chromium } = pw;
const out = process.argv[2] || '.', url = process.argv[3] || 'http://localhost:8099/', [W, H] = (process.argv[4] || '390x620').split('x').map(Number);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  await ctx.route(/jsdelivr|googleapis|gstatic/, r => r.abort());
  await ctx.addInitScript(() => { localStorage.setItem('gp.guideSeen', '1'); localStorage.setItem('gp.guard', 'false'); });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); await p.waitForTimeout(2500);
  const S = (k) => p.screenshot({ path: `${out}/ph_${k}.png` });
  await p.evaluate(() => { document.querySelector('[data-n="5"]').click(); document.querySelector('[data-sec="20"]').click(); document.querySelector('#bPractice').click(); });
  const got = new Set(); let doubted = false;
  for (let k = 0; k < 600 && got.size < 7; k++) {
    const st = await p.evaluate(() => { const v = __GP.ST.view; if (!v) return {}; return { ph: v.phase, t: v.turn, me: __GP.ST.you.seat, r: __GP.ST.roll.st, susp: !!__GP.ST.suspense, stage: __GP.ST.duelStage, kind: v.last && v.last.kind, stake: v.review && v.review.myStake }; });
    if (st.ph === 'review' && st.t !== st.me && !st.susp) {
      if (!got.has('review')) { got.add('review'); await p.waitForTimeout(500); await S('1review'); }
      if (!doubted && st.stake) { doubted = true; await p.evaluate(() => document.querySelector('[data-doubt]') && document.querySelector('[data-doubt]').click()); }
      else await p.evaluate(() => { const d = document.querySelector('[data-pass][aria-pressed="false"]'); d && d.click(); });
    }
    if (st.susp && st.stage === 'scan' && !got.has('scan')) { got.add('scan'); await S('2scan'); }
    if (st.susp && st.stage === 'flip' && !got.has('flip')) { got.add('flip'); await S('3flip'); }
    if (!st.susp && st.ph === 'result' && st.kind !== 'pass' && !got.has('res')) { got.add('res'); await p.waitForTimeout(300); await S('4result'); }
    if (st.ph === 'declare' && st.t === st.me && st.r === 'ready') {
      if (!got.has('ready')) { got.add('ready'); await S('5ready'); }
      await p.evaluate(() => { document.querySelector('#cupbox').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); setTimeout(() => window.dispatchEvent(new PointerEvent('pointerup')), 100); });
      await p.waitForTimeout(1800);
      if (!got.has('done')) { got.add('done'); await S('6done'); }
      await p.evaluate(() => { const t = document.querySelector('[data-decl="2"]'); t.click(); t.click(); });
    }
    if (got.has('done') && got.has('res') && !got.has('menu')) {
      got.add('menu'); await p.evaluate(() => document.querySelector('[data-sheet="menu"], #bMenu') && document.querySelector('[data-sheet="menu"], #bMenu').click()); await p.waitForTimeout(400);
      await p.evaluate(() => { const s = document.querySelector('#sheet'); s.scrollTop = 9999; }); await p.waitForTimeout(200); await S('7menu');
      await p.evaluate(() => document.querySelector('[data-sheetclose]') && document.querySelector('[data-sheetclose]').click()); await p.waitForTimeout(300);
      console.log('sheet closed:', await p.evaluate(() => document.querySelector('#sheet').hidden));
    }
    await p.waitForTimeout(120);
  }
  console.log('captured', [...got].join(','), '| errors:', errs.join(' | ') || 'none');
  await b.close();
})();
