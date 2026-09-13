import { chromium } from '@playwright/test';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../app/', import.meta.url));
const accelerated = process.argv.includes('--full');
const policy = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'";
const server = http.createServer((req, res) => {
  const relative = decodeURIComponent(new URL(req.url, 'http://localhost').pathname).replace(/^\//, '') || 'index.html';
  const file = path.resolve(root, relative);
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  let body = fs.readFileSync(file);
  if (accelerated && relative === 'js/training.js') body = Buffer.from(body.toString().replace('setTimeout(resolve, milliseconds)', 'setTimeout(resolve, Math.min(milliseconds, 10))'));
  res.writeHead(200, { 'Content-Type': ({ '.html':'text/html; charset=utf-8', '.js':'application/javascript', '.css':'text/css', '.jpg':'image/jpeg' })[path.extname(file)], 'Content-Security-Policy': policy });
  res.end(body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({channel:'chrome'});
try {
  const context = await browser.newContext({ viewport:{width:390,height:844}, isMobile:true, hasTouch:true });
  // Modern browser with a restricted-container API surface; NOT a Chrome 61 test.
  await context.addInitScript(() => {
    window.structuredClone = undefined;
    String.prototype.replaceAll = undefined;
    Array.prototype.flatMap = undefined;
    Array.prototype.at = undefined;
    Object.fromEntries = undefined;
    for (const name of ['fetch','XMLHttpRequest','Worker','SharedWorker','WebSocket','EventSource','open']) window[name] = () => { throw new Error('Forbidden container API: '+name); };
    Element.prototype.requestFullscreen = () => { throw new Error('Forbidden fullscreen'); };
  });
  const page = await context.newPage();
  const errors=[]; const requests=[];
  page.on('pageerror', e=>errors.push(e.message));
  page.on('console', msg=>{if(msg.type()==='error')errors.push(msg.text())});
  page.on('request', r=>requests.push(r.url()));
  await page.goto(origin);
  assert.equal(await page.locator('#consentOverlay').count(),0);
  await page.locator('#mobilePage.active').waitFor();
  assert.equal(await page.locator('.page').count(),2);
  assert.equal(await page.locator('[data-records-platform]').count(),0);
  assert.equal(await page.locator('[target="_blank"], [download], script[type="module"]').count(),0);
  await page.screenshot({path:new URL('../menu.png',import.meta.url).pathname.replace(/^\/([A-Z]:)/,'$1'),fullPage:true});
  // Verify adaptation retained staircase behavior and fixed session lengths.
  const invariants = await page.evaluate(() => {
    const proto = window.ToolTraining.MobileTrainingController.prototype;
    const trainer = Object.create(proto);
    trainer.levels = Object.assign({},window.ToolTraining.INITIAL_LEVELS);
    trainer.correctStreaks={single:0,triple:0,darker:0,shifted:0};
    return ['single','triple','darker','shifted'].map(mode=>{
      const initial=trainer.levels[mode]; const first=trainer.adaptLevel(mode,true);
      const second=trainer.adaptLevel(mode,true); const wrong=trainer.adaptLevel(mode,false);
      return first===initial && second<first && wrong>second;
    });
  });
  assert.ok(invariants.every(Boolean));
  const modes=accelerated?['mixed','single','triple','darker','shifted']:['single'];
  for(const mode of modes){
    await page.locator(`[data-mobile-mode="${mode}"]`).tap();
    const count=mode==='mixed'?256:64;
    await page.waitForFunction(total=>document.querySelector('[data-mobile="progressText"]').textContent==='0 / '+total,count);
    const box=await page.locator('[data-mobile="canvas"]').boundingBox();
    assert.ok(box.width>200 && box.width<=390 && Math.abs(box.width-box.height)<1);
    if(accelerated){
      for(let i=0;i<count;i++)await page.locator('[data-mobile="temporalButtons"] button').nth(i%2).tap();
      await page.waitForFunction(()=>document.querySelector('[data-mobile="status"]').textContent==='上次训练记录');
      assert.match(await page.locator('[data-mobile="correctText"]').innerText(),/^\d+%$/);
      console.log('PASS complete',mode,count);
    }else{
      await page.waitForFunction(()=>document.querySelector('[data-mobile="responsePrompt"]').textContent.includes('如果看不清楚凭感觉猜即可'));
      await page.screenshot({path:fileURLToPath(new URL('../training.png',import.meta.url))});
      await page.locator('[data-mobile="temporalButtons"] button').first().tap();
      await page.locator('#mobileExit').tap();
    }
  }
  await page.locator('[data-route="records"]').tap();
  await page.locator('#recordsPage.active').waitFor();
  await page.waitForFunction(()=>document.querySelector('#sessionsTableBody tr'));
  const expectedCount=accelerated?512:1;
  assert.equal(await page.locator('#totalTrialsKpi').innerText(),String(expectedCount));
  if(accelerated)assert.equal(await page.locator('#difficultyTrendsGrid svg').count(),4);
  await page.screenshot({path:fileURLToPath(new URL('../records.png',import.meta.url)),fullPage:true});
  await page.reload();
  await page.waitForFunction(expected=>document.querySelector('#totalTrialsKpi').textContent===String(expected),expectedCount);
  await page.locator('[data-session-id]').first().tap();
  await page.locator('#trialDetailPanel:not(.hidden)').waitFor();
  await page.locator('#closeTrialDetail').tap();
  page.once('dialog',dialog=>dialog.accept());
  await page.locator('#clearDataButton').tap();
  await page.waitForFunction(()=>document.querySelector('#totalTrialsKpi').textContent==='0');
  assert.deepEqual(errors,[]);
  assert.ok(requests.every(url=>url.startsWith(origin+'/')));
  // file:// boot is separately exercised, since offline modules are not allowed.
  const filePage=await context.newPage();
  await filePage.goto(new URL('../app/index.html',import.meta.url).href);
  assert.equal(await filePage.locator('#consentOverlay').count(),0);
  await filePage.locator('#mobilePage.active').waitFor();
  console.log('PASS strict CSP, no network APIs, records reload/detail/clear, file:// boot');
  await context.close();
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }
