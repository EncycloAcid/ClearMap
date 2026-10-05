#!/usr/bin/env node
// Make the Google Play store images from the app itself: the 512 px icon, the 1024×500 feature
// graphic and 1080×1920 phone screenshots, written to fastlane/metadata/android/en-US/images.
// Run after tools/build.py:  node tools/store_assets.js
// Needs Playwright with Chromium (npm i -g playwright; or set CHROMIUM to a chromium binary).
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'fastlane/metadata/android/en-US/images');
const PAGE = 'file://' + path.join(ROOT, 'index.html');
const NOON = new Date('2026-10-05T13:00:00-04:00');     // shops open, a sensible boarding time

// The launcher icon, from the Android vector drawable, on the brand blue
function iconSvg(size, rounded) {
  const xml = fs.readFileSync(path.join(ROOT, 'android/app/src/main/res/drawable/ic_launcher_foreground.xml'), 'utf8');
  const paths = [...xml.matchAll(/fillColor="([^"]+)" android:pathData="([^"]+)"/g)].map(([, c, d]) => `<path fill="${c}" d="${d}"/>`).join('');
  // the adaptive icon's visible area is the middle 72 of its 108 units; show a little more for the store
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="14 14 80 80">
    <rect x="14" y="14" width="80" height="80" rx="${rounded ? 18 : 0}" fill="#2F50D0"/>${paths}</svg>`;
}

(async () => {
  fs.mkdirSync(path.join(OUT, 'phoneScreenshots'), { recursive: true });
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});

  // ---------- Icon: 512 × 512, square (Play rounds the corners itself) ----------
  {
    const p = await b.newPage({ viewport: { width: 512, height: 512 } });
    await p.setContent(`<body style="margin:0">${iconSvg(512, false)}</body>`);
    await p.screenshot({ path: path.join(OUT, 'icon.png') });
    await p.close();
  }

  // ---------- Phone screenshots: 1080 × 1920 ----------
  const shots = [];
  async function shoot(name, caption, setup, { scheme = 'light', airport = 'CLE' } = {}) {
    const ctx = await b.newContext({ viewport: { width: 432, height: 768 }, deviceScaleFactor: 2.5, isMobile: true, hasTouch: true, colorScheme: scheme });
    await ctx.addInitScript(a => { try { localStorage.clear(); localStorage.setItem('cw.airport', a); } catch (e) {} }, airport);
    const p = await ctx.newPage();
    await p.clock.install({ time: NOON });
    await p.route(/^https?:/, r => r.abort());
    await p.goto(PAGE); await p.clock.runFor(2500);
    await setup(p); await p.clock.runFor(1600);
    const file = path.join(OUT, 'phoneScreenshots', name + '.png');
    await p.screenshot({ path: file });
    shots.push({ file, caption });
    await ctx.close();
  }
  const sheet = async (p, detent) => p.evaluate(d => { const s = document.querySelector('#sheetHead');
    const ev = t => s.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 9, clientY: 700 }));
    for (let i = 0; i < (d === 'full' ? 1 : 0); i++) { ev('pointerdown'); ev('pointerup'); } }, detent);

  await shoot('1_directions', 'Walking directions to your gate', async () => {});
  await shoot('2_navigation', 'Step by step, floor by floor', async p => { await p.tap('[data-go]'); await p.clock.runFor(800); await p.tap('#nbNext'); });
  await shoot('3_atlanta', 'Rides the Plane Train at Atlanta', async p => {
    await p.tap('#q'); await p.fill('#q', 'E14'); await p.clock.runFor(300); await p.tap('#results [data-i]'); await p.clock.runFor(1000);
    await p.evaluate(() => document.querySelector('[data-act="to"]').click());
  }, { airport: 'ATL' });
  await shoot('4_pass_time', 'Time for a coffee before boarding?', async p => { await p.tap('#tab-kill'); await p.clock.runFor(500); await sheet(p, 'full');
    await p.evaluate(() => { document.querySelector('#sheetBody, .sheet-body').scrollTop = 330; }); });
  await shoot('5_place', 'Hours, walk times and what’s nearby', async p => {
    await p.tap('#q'); await p.fill('#q', 'Bar Symon'); await p.clock.runFor(300); await p.tap('#results [data-i]'); });
  await shoot('6_arrivals', 'Landed? Bags, trains and rides', async p => { await p.tap('#modeSw [data-mode="arr"]'); });
  await shoot('7_dark', 'Easy on the eyes at night', async p => {
    await p.tap('#tab-air'); await p.clock.runFor(500); await sheet(p, 'full'); }, { scheme: 'dark' });

  // ---------- Feature graphic: 1024 × 500 ----------
  {
    const img = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
    const p = await b.newPage({ viewport: { width: 1024, height: 500 } });
    await p.setContent(`<!doctype html><body style="margin:0;width:1024px;height:500px;overflow:hidden;font-family:Roboto,Arial,sans-serif;
      background:radial-gradient(120% 140% at 0% 0%,#3e63e6 0%,#2F50D0 45%,#1f3497 100%);color:#fff;position:relative">
      <div style="position:absolute;left:72px;top:110px;width:470px">
        <div style="display:flex;align-items:center;gap:22px">${iconSvg(104, true).replace('fill="#2F50D0"', 'fill="#ffffff22"')}
          <div style="font:800 70px/1 Roboto,Arial,sans-serif;letter-spacing:-1.5px">Clearway</div></div>
        <div style="margin-top:34px;font:600 34px/1.25 Roboto,Arial,sans-serif">Find your gate.<br>Find your way.</div>
        <div style="margin-top:20px;font:400 21px/1.4 Roboto,Arial,sans-serif;opacity:.85">Indoor maps and walking directions for Cleveland Hopkins and Atlanta Hartsfield–Jackson</div>
      </div>
      <img src="${img(shots[0].file)}" style="position:absolute;right:150px;top:40px;width:250px;border-radius:30px;box-shadow:0 30px 60px #0006;transform:rotate(-4deg)">
      <img src="${img(shots[2].file)}" style="position:absolute;right:-30px;top:96px;width:230px;border-radius:28px;box-shadow:0 30px 60px #0006;transform:rotate(5deg)">
    </body>`);
    await p.screenshot({ path: path.join(OUT, 'featureGraphic.png') });
    await p.close();
  }
  await b.close();
  console.log('wrote', path.relative(ROOT, OUT), shots.map(s => path.basename(s.file)).join(', '));
})();
