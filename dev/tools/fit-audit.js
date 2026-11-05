// usage: node dev/tools/fit-audit.js <outDir> [url]
// Plays practice games at several screen sizes and reports anything that sticks out of the screen or gets cut off.
let pw; try { pw = require('playwright'); } catch (e) { pw = require('/opt/npm-tools/node_modules/playwright'); } const { chromium } = pw;
const out = process.argv[2] || '.', url = process.argv[3] || 'http://localhost:8099/';
const SIZES = [[375, 560, 'se'], [390, 620, 'ip'], [430, 760, 'max'], [844, 390, 'land'], [667, 375, 'land-s'], [1366, 768, 'pc'], [1024, 700, 'tab']].filter(s => !process.env.SIZES || process.env.SIZES.split(',').includes(s[2]));   // SIZES=se,pc to pick
const AUDIT = () => {
  const vw = innerWidth, vh = innerHeight, bad = [];
  const name = (el) => (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + ` <${el.tagName.toLowerCase()}> "${(el.innerText || '').trim().slice(0, 18).replace(/\s+/g, ' ')}"`;
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('#splash') && el.closest('#splash').getAnimations({ subtree: true }).some(a => a.playState === 'running' && a.currentTime < 400)) continue;
    if (el.closest('[hidden]') || el.tagName === 'CANVAS' || el.closest('#bubbles') || el.closest('svg')) continue;
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity === 0) continue;
    const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) continue;
    // fixed-position scroll containers (sheets) clip their own content; only check what is on screen
    const sc = el.closest('.sheet,.modal .glass,.log'); if (sc && sc !== el) { const sr = sc.getBoundingClientRect(); if (r.bottom < sr.top || r.top > sr.bottom) continue; }
    if (r.right > vw + 1.5 || r.left < -1.5) bad.push('OFF-SCREEN-X ' + name(el) + ` [${Math.round(r.left)}..${Math.round(r.right)} of ${vw}]`);
    if (!sc && !el.closest('.screen') && (r.bottom > vh + 1.5)) bad.push('OFF-SCREEN-Y ' + name(el) + ` [bottom ${Math.round(r.bottom)} of ${vh}]`);
    const clipX = el.scrollWidth > el.clientWidth + 2 && cs.overflowX !== 'visible' && cs.textOverflow !== 'ellipsis' && !['auto', 'scroll'].includes(cs.overflowX);
    if (clipX && el.children.length === 0) bad.push('CLIPPED ' + name(el) + ` [${el.scrollWidth}>${el.clientWidth}]`);
    // one or two characters per line = squeezed text
    if (el.children.length === 0 && (el.innerText || '').trim().length >= 3 && cs.writingMode === 'horizontal-tb') {
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3, lines = Math.round(r.height / lh);
      if (lines >= 3 && r.width < parseFloat(cs.fontSize) * 2.6) bad.push('SQUEEZED ' + name(el) + ` [${lines} lines in ${Math.round(r.width)}px]`);
    }
  }
  return bad;
};
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const all = {};
  for (const [W, H, nm] of SIZES) {
    const mob = W < 1000;
    const ctx = await b.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, hasTouch: mob, isMobile: mob });
    await ctx.route(/jsdelivr|googleapis|gstatic/, r => r.abort());
    await ctx.addInitScript(() => { localStorage.setItem('gp.guideSeen', '1'); localStorage.setItem('gp.guard', 'false'); localStorage.setItem('gp.name', 'ハッカー太郎'); });
    const p = await ctx.newPage();
    await p.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }); await p.waitForTimeout(2000);
    const found = new Map();
    const check = async (state) => { for (const x of await p.evaluate(AUDIT)) if (!found.has(x)) { found.set(x, state); } };
    const snap = async (state) => { await check(state); await p.screenshot({ path: `${out}/${nm}_${state}.png` }); };
    await snap('title');
    await p.evaluate(() => document.querySelector('.lookbox') && (document.querySelector('.lookbox').open = true)); await check('title-look');
    await p.evaluate(() => document.querySelector('#bGuide').click()); await p.waitForTimeout(300); await check('guide');
    await p.evaluate(() => document.querySelector('#modal [data-close], #modal button') && document.querySelector('#modal').querySelectorAll('button')[0].click());
    await p.evaluate(() => { const m = document.querySelector('#modal'); m.hidden = true; });
    await p.evaluate(() => document.querySelector('#bRules2').click()); await p.waitForTimeout(300); await check('rules');
    await p.evaluate(() => { document.querySelector('#modal').hidden = true; });
    await p.evaluate(() => { document.querySelector('[data-n="5"]').click(); document.querySelector('[data-sec="20"]').click(); document.querySelector('#bPractice').click(); });
    const seen = new Set(); let doubted = 0;
    for (let k = 0; k < 900; k++) {
      const st = await p.evaluate(() => { const v = __GP.ST.view; if (!v) return {}; return { ph: v.phase, t: v.turn, me: __GP.ST.you.seat, r: __GP.ST.roll.st, susp: !!__GP.ST.suspense, stage: __GP.ST.duelStage, over: !!v.over, kind: v.last && v.last.kind, stake: v.review && v.review.myStake, sp: !!document.querySelector('#splash .sp') }; });
      if (st.over) { await p.waitForTimeout(3000); await snap('over'); break; }
      const tag = st.susp ? 'duel-' + st.stage : st.ph + (st.t === st.me ? '-me-' + st.r : '');
      if (!seen.has(tag)) { seen.add(tag); await snap(tag); } else if (k % 7 === 0) await check(tag);
      if (st.sp) { await p.waitForTimeout(450); await check('splash'); }
      if (st.ph === 'review' && st.t !== st.me && !st.susp) { if (doubted < 2 && st.stake && Math.random() < 0.5) { doubted++; await p.evaluate(() => document.querySelector('[data-doubt]') && document.querySelector('[data-doubt]').click()); } else await p.evaluate(() => { const d = document.querySelector('[data-pass][aria-pressed="false"]'); d && d.click(); }); }
      if (st.ph === 'declare' && st.t === st.me && st.r === 'ready') { await p.keyboard.press('Enter'); await p.waitForTimeout(1500); await check('declare-me-done'); await p.evaluate(() => { const t = document.querySelector('[data-decl="' + (1 + Math.floor(Math.random() * 4)) + '"]'); t.click(); t.click(); }); }
      if (k === 60) { for (const sh of ['menu', 'rack', 'log', 'stamps', 'p1']) { await p.evaluate((sh) => { if (sh === 'menu') (document.querySelector('#bMenu') || document.querySelector('#bSettings')).click(); else window.__GP && document.querySelector(`[data-sheet="${sh}"]`) ? document.querySelector(`[data-sheet="${sh}"]`).click() : null; }, sh); await p.waitForTimeout(250); await p.evaluate(() => { const s = document.querySelector('#sheet'); if (s) s.scrollTop = 99999; }); await check('sheet-' + sh); await p.evaluate(() => { const x = document.querySelector('[data-sheetclose]'); x && x.click(); document.querySelector('#modal').hidden = true; }); } }
      await p.waitForTimeout(110);
    }
    all[nm] = [...found].map(([k, v]) => `${v}: ${k}`);
    console.log(`\n== ${nm} ${W}x${H}: ${found.size} issues`); all[nm].forEach(x => console.log('  ' + x));
    await ctx.close();
  }
  await b.close();
})();
