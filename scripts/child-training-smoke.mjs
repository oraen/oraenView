import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../public/", import.meta.url));
const server = http.createServer((request, response) => {
  const relative = decodeURIComponent(new URL(request.url, "http://localhost").pathname).replace(/^\//, "") || "index.html";
  if (relative === "favicon.ico") { response.writeHead(204); response.end(); return; }
  const file = path.resolve(root, relative);
  if (!file.startsWith(root) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { response.writeHead(404); response.end(); return; }
  let content = fs.readFileSync(file);
  if (relative === "js/child-training.js") content = Buffer.from(content.toString().replace("setTimeout(resolve, milliseconds)", "setTimeout(resolve, Math.min(milliseconds, 2))").replace("const MEMORY_MASK_MS = 220", "const MEMORY_MASK_MS = 2").replace("this.trial.previewMs);", "Math.min(this.trial.previewMs, 2));").replace("this.trial.trackingCueMs : 0", "Math.min(this.trial.trackingCueMs, 2) : 0"));
  const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".mp3": "audio/mpeg", ".jpg": "image/jpeg", ".png": "image/png" }[path.extname(file)] || "application/octet-stream";
  response.writeHead(200, { "Content-Type": mime, "Cache-Control": "no-store" }); response.end(content);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "chrome" });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.addInitScript(() => localStorage.setItem("oraenView:agreement", JSON.stringify({ version: "2026-10-14.1", accepted: true, acceptedAt: new Date().toISOString() })));
  const page = await context.newPage(); const errors = []; const failedUrls = [];
  const windowGames = ["contrast-stars", "orientation-forest", "crowding-c", "vernier-blocks", "fusion-rings", "anaglyph-search", "motion-radar", "contour-trail", "shape-workshop", "memory-cards", "firefly-chase", "stereo-orbs"];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("response", (response) => { if (response.status() >= 400) failedUrls.push(response.url()); });
  await page.goto(origin + "/#/mobile"); await page.locator("#mobilePage.active").waitFor();
  await page.evaluate(async () => { const storage = await import("/js/child-db.js"); await storage.saveSetting(storage.LEVELS_KEY, Object.fromEntries(window.ChildGamesCore.GAME_ORDER.map((id) => [id, window.ChildGamesCore.MAX_LEVEL]))); window.ChildGamesCore.adaptLevel = () => ({ level: window.ChildGamesCore.MAX_LEVEL, streak: 0 }); });
  await page.locator("#childTrainingEntry").tap();
  assert.equal(await page.locator("[data-child-game]").count(), 12);
  await page.waitForFunction(() => document.querySelector('[data-child-game="contrast-stars"] > b').textContent === "30级");
  assert.equal(await page.locator('[data-child-game="contrast-stars"] > b').innerText(), "30级");
  assert.equal(await page.locator(".child-parent-note").count(), 0);
  assert.equal(await page.locator(".child-hub-heading p").count(), 0);
  const games = windowGames;
  for (const game of games) {
    console.log("VERIFY child game", game, "at max level");
    await page.locator(`[data-child-game="${game}"]`).tap();
    await page.locator("#childTutorial:not(.hidden)").waitFor();
    assert.ok((await page.locator("#childTutorialText").innerText()).length > 4);
    await page.locator("#childTutorialStart").tap();
    if (game === "fusion-rings") {
      await page.locator("#childGlassesSetup:not(.hidden)").waitFor();
      await page.locator("#childCalibrationConfirm").check();
      await page.locator("#childSetupStart").tap();
    }
    await page.locator("#childGamePanel:not(.hidden)").waitFor();
    if (game === "contrast-stars") {
      await page.locator("#childGamePause").tap();
      assert.equal(await page.locator("#childGameProgress").innerText(), "0 / 24");
      assert.equal(await page.locator("#childGameFeedback").innerText(), "训练已暂停");
      await page.setViewportSize({ width: 844, height: 390 });
      await page.waitForFunction(() => document.querySelector("#childGameCanvas").getBoundingClientRect().height <= 180);
      let box = await page.locator("#childGameCanvas").boundingBox();
      assert.ok(Math.abs(box.width - box.height) < 1 && box.height <= 180);
      await page.setViewportSize({ width: 320, height: 568 });
      await page.waitForFunction(() => document.querySelector("#childGameCanvas").getBoundingClientRect().width <= 320);
      box = await page.locator("#childGameCanvas").boundingBox();
      assert.ok(Math.abs(box.width - box.height) < 1 && box.width <= 320);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator("#childGamePause").tap();
    }
    for (let index = 0; index < 24; index += 1) {
      const responseType = ["contrast-stars", "orientation-forest", "anaglyph-search", "contour-trail", "shape-workshop", "memory-cards", "firefly-chase"].includes(game) ? "target" : ["crowding-c", "motion-radar"].includes(game) ? "direction" : "side";
      if (responseType === "target") {
        const box = await page.locator("#childGameCanvas").boundingBox();
        if (game === "memory-cards") await page.waitForTimeout(4);
        if (game === "firefly-chase") await page.waitForFunction(() => document.querySelector("#childTapHint").textContent === "现在点中它");
        const points = game === "contour-trail" ? [[125,125]] : game === "shape-workshop" ? [[90,340]] : game === "memory-cards" ? [[90,270]] : [[75,75]];
        if (game === "firefly-chase") await page.evaluate(() => { const canvas = document.querySelector("#childGameCanvas"); const bounds = canvas.getBoundingClientRect(); for (let y = 60; y <= 420; y += 30) for (let x = 60; x <= 420; x += 30) canvas.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: bounds.left + bounds.width * x / 480, clientY: bounds.top + bounds.height * y / 480 })); });
        else for (const point of points) await page.mouse.click(box.x + box.width * point[0] / 480, box.y + box.height * point[1] / 480);
      } else if (responseType === "direction") await page.locator("#childDirectionPad button").first().tap();
      else await page.locator("#childSidePad button").first().tap();
      await page.waitForFunction((expected) => document.querySelector("#childGameProgress").textContent.startsWith(expected + " /"), index + 1);
    }
    await page.locator("#childGameRestart:not(.hidden)").waitFor();
    await page.locator("#childGameExit").tap();
  }
  await page.evaluate(() => { location.hash = "#/records"; }); await page.locator("#recordsPage.active").waitFor();
  assert.equal(await page.locator("#totalTrialsKpi").innerText(), "0");
  await page.locator('[data-records-platform="child"]').tap();
  await page.waitForFunction(() => document.querySelector("#totalTrialsKpi").textContent === "288");
  assert.equal(await page.locator("#currentDifficultyGrid .current-difficulty-card").count(), 12);
  assert.equal(await page.locator("#difficultyTrendsGrid .difficulty-trend-card").count(), 12);
  assert.equal(await page.locator("#sessionsTableBody [data-session-id]").count(), 12);
  await page.reload(); await page.locator("#recordsPage.active").waitFor();
  await page.locator('[data-records-platform="child"]').tap(); await page.waitForFunction(() => document.querySelector("#totalTrialsKpi").textContent === "288");
  await page.evaluate(() => { location.hash = "#/mobile"; }); await page.locator("#mobilePage.active").waitFor();
  await page.locator("#childTrainingEntry").tap(); await page.locator('[data-child-game="contrast-stars"]').tap();
  await page.locator("#childTutorial:not(.hidden)").waitFor();
  assert.deepEqual(failedUrls, []);
  assert.deepEqual(errors, []);
  console.log("PASS twelve child games, 288 trials, reload, records and mobile data isolation");
  await context.close();
} finally {
  await browser.close(); await new Promise((resolve) => server.close(resolve));
}
