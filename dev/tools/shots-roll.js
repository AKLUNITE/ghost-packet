let pw; try { pw = require('playwright'); } catch (e) { pw = require('/opt/npm-tools/node_modules/playwright'); } const { chromium } = pw;
// usage: node dev/tools/shots-roll.js <outDir> [url]   (practice mode, PC + phone sizes)
const out = process.argv[2] || '.', url = process.argv[3] || 'http://localhost:8099/';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const [w, h, nm, dpr] of [[1366, 768, 'pc', 1], [390, 844, 'sp', 2], [844, 390, 'land', 2]]) {
    const mob = nm !== 'pc';
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, hasTouch: mob, isMobile: mob });
    await ctx.route(/jsdelivr|googleapis|gstatic/, r => r.abort());
    await ctx.addInitScript(() => { try { localStorage.setItem('gp.guideSeen', '1'); localStorage.setItem('gp.guard', 'false'); } catch (e) {} });
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); await p.waitForTimeout(2500);
    const S = async (k) => p.screenshot({ path: `${out}/${nm}_${k}.png` });
    await p.evaluate(() => { document.querySelector('[data-n="4"]').click(); document.querySelector('#bPractice').click(); });
    await p.waitForTimeout(350); await S('0start');
    const shots = new Set(); let myTurns = 0;
    for (let k = 0; k < 500 && myTurns < 2; k++) {
      const st = await p.evaluate(() => { const v = __GP.ST.view; if (!v) return {}; return { ph: v.phase, t: v.turn, me: __GP.ST.you.seat, roll: __GP.ST.roll.st, seq: __GP.ST.roll.id === __GP.ST.room.turnId, rs: __GP.ST.room.rollSt, over: !!v.over }; });
      if (st.over) break;
      if (st.ph === 'declare' && st.t !== st.me && st.rs === 'shake' && !shots.has('othershake')) { shots.add('othershake'); await p.waitForTimeout(250); await S('othershake'); }
      if (st.ph === 'declare' && st.t === st.me && st.seq && st.roll === 'ready') {
        myTurns++;
        await p.waitForTimeout(1300); if (myTurns === 1) await S('1ready');
        await p.evaluate(() => document.querySelector('#cupbox').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
        await p.waitForTimeout(700); if (myTurns === 1) await S('2shake');
        await p.evaluate(() => window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })));
        await p.waitForTimeout(150); if (myTurns === 1) await S('3slam');
        await p.waitForTimeout(450); if (myTurns === 1) await S('4open');
        await p.waitForTimeout(800); if (myTurns === 1) await S('5done');
        // touch: tap once to select (preview), screenshot, tap again
        const n = await p.evaluate(() => 1 + Math.floor(Math.random() * 4));
        await p.evaluate((n) => document.querySelector(`[data-decl="${n}"]`).click(), n);
        await p.waitForTimeout(300); if (myTurns === 1) await S('6pick');
        if (mob) await p.evaluate((n) => document.querySelector(`[data-decl="${n}"]`) && document.querySelector(`[data-decl="${n}"]`).click(), n);
        continue;
      }
      if (st.ph === 'review' && st.t !== st.me) await p.evaluate(() => { const d = document.querySelector('[data-pass][aria-pressed="false"]'); d && d.click(); });
      await p.waitForTimeout(120);
    }
    console.log(nm, 'errors:', errs.join(' | ') || 'none', 'myTurns', myTurns);
    await ctx.close();
  }
  await b.close();
})();
