import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

test("device defaults choose the home route and records tab while explicit links still work", async ({ browser }) => {
  for (const mobile of [false, true]) {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      isMobile: mobile, hasTouch: mobile,
      ...(mobile ? { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1" } : {}),
    });
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:4178/");
    await page.locator("#agreementCheckbox").check();
    await page.locator("#acceptAgreement").click();
    await expect(page).toHaveURL(new RegExp(mobile ? "#/mobile$" : "#/training$"));
    await page.locator("#menuButton").click();
    await page.locator('[data-route="records"]').click();
    const expected = mobile ? "mobile" : "desktop";
    const other = mobile ? "desktop" : "mobile";
    await expect(page.locator(`[data-records-platform="${expected}"]`)).toHaveAttribute("aria-pressed", "true");
    await page.locator(`[data-records-platform="${other}"]`).click();
    await expect(page.locator(`[data-records-platform="${other}"]`)).toHaveAttribute("aria-pressed", "true");
    await page.goto(`http://127.0.0.1:4178/#/${mobile ? "training" : "mobile"}`);
    await expect(page.locator(mobile ? "#trainingPage" : "#mobilePage")).toHaveClass(/active/);
    await page.locator("#menuButton").click();
    await page.locator('[data-route="records"]').click();
    await expect(page.locator(`[data-records-platform="${expected}"]`)).toHaveAttribute("aria-pressed", "true");
    await context.close();
  }
});

test("touch sessions complete all five modes and records stay separated after reload", async ({ page }) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Speed up stimulus waits only; exercise the real lifecycle, controls and IndexedDB.
  await page.route("**/js/training.js", async (route) => {
    const body = (await readFile(new URL("../public/js/training.js", import.meta.url), "utf8")).replace("setTimeout(resolve, milliseconds)", "setTimeout(resolve, Math.min(milliseconds, 15))");
    await route.fulfill({ contentType: "application/javascript", body });
  });
  await page.goto("/#/mobile");
  await page.locator("#agreementCheckbox").check();
  await page.locator("#acceptAgreement").click();
  await expect(page.locator("#mobilePage")).toHaveClass(/active/);
  await expect(page).toHaveTitle("开源视觉 Oraen View");
  await page.evaluate(async () => {
    const desktop = await import("/js/db.js");
    await desktop.saveSetting(desktop.ADAPTIVE_LEVELS_KEY, { single: 0.013 });
  });
  for (const mode of ["mixed", "single", "triple", "darker", "shifted"]) {
    await page.locator(`[data-mobile-mode="${mode}"]`).tap();
    await expect(page.locator("body")).toHaveClass(/mobile-training-focus/);
    const canvas = await page.locator('[data-mobile="canvas"]').boundingBox();
    expect(canvas.width).toBeGreaterThan(200);
    expect(canvas.width).toBeLessThanOrEqual(390);
    expect(Math.abs(canvas.width - canvas.height)).toBeLessThan(1);
    const count = mode === "mixed" ? 256 : 64;
    for (let i = 0; i < count; i++) {
      await page.locator('[data-mobile="temporalButtons"] button').nth(i % 2).tap();
    }
    await expect(page.locator('[data-mobile="stageMessage"] h3')).toHaveText("本次训练已完成");
    await expect(page.locator('[data-mobile="progressText"]')).toHaveText(`${count} / ${count}`);
  }
  const data = await page.evaluate(async () => {
    const mobile = await import("/js/mobile-db.js");
    const desktop = await import("/js/db.js");
    return { mobile: await mobile.exportTrainingData(), desktop: await desktop.exportTrainingData() };
  });
  expect(data.mobile.sessions).toHaveLength(5);
  expect(data.mobile.trials).toHaveLength(512);
  expect(data.mobile.sessions.every((s) => s.status === "completed" && s.completedTrials === (s.selectedMode === "mixed" ? 256 : 64))).toBe(true);
  expect(data.desktop.sessions).toHaveLength(0);
  expect(data.desktop.settings.adaptiveLevels).toEqual({ single: 0.013 });
  await page.goto("/#/records");
  await page.locator('[data-records-platform="mobile"]').tap();
  await expect(page.locator("#totalSessionsKpi")).toHaveText("5");
  await expect(page.locator("#difficultyTrendsGrid svg")).toHaveCount(4);
  await page.screenshot({ path: "test-results/mobile-records.png", fullPage: true });
  await page.reload();
  await expect(page.locator("#totalSessionsKpi")).toHaveText("0");
  await page.locator('[data-records-platform="mobile"]').tap();
  await expect(page.locator("#totalSessionsKpi")).toHaveText("5");
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator("#clearDataButton").tap();
  await expect(page.locator("#totalSessionsKpi")).toHaveText("0");
  expect(await page.evaluate(async () => {
    const desktop = await import("/js/db.js");
    return desktop.getSetting(desktop.ADAPTIVE_LEVELS_KEY);
  })).toEqual({ single: 0.013 });
  expect(errors).toEqual([]);
});

test("phone layout, early taps, rotation and navigation stop pending trials", async ({ page }) => {
  await page.goto("/#/mobile");
  await page.locator("#agreementCheckbox").check();
  await page.locator("#acceptAgreement").click();
  await page.screenshot({ path: "test-results/mobile-menu.png", fullPage: true });
  await page.locator('[data-mobile-mode="shifted"]').tap();
  await expect(page.locator('[data-mobile="status"]')).toHaveText("保持注视");
  await expect(page.locator('[data-mobile="temporalButtons"] button').first()).toBeDisabled();
  await expect(page.locator('[data-mobile="intervalLabel"]')).toHaveText("观察偏移");
  await page.screenshot({ path: "test-results/mobile-training.png" });
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator("body")).not.toHaveClass(/mobile-training-focus/);
  await page.waitForTimeout(2000);
  await expect(page.locator('[data-mobile="temporalButtons"] button').first()).toBeDisabled();
  await page.setViewportSize({ width: 320, height: 568 });
  await page.locator('[data-mobile-mode="single"]').tap();
  await expect(page.locator('[data-mobile="status"]')).toHaveText("保持注视");
  await page.evaluate(() => { location.hash = "#/records"; });
  await expect(page.locator("#recordsPage")).toHaveClass(/active/);
  await page.waitForTimeout(2000);
  await page.locator('[data-records-platform="mobile"]').tap();
  await expect(page.locator("#sessionsTableBody tr")).toHaveCount(2);
  await expect(page.locator("#totalTrialsKpi")).toHaveText("0");
});

test("desktop preparation and experience training still use desktop storage", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/#/training");
  await page.locator("#agreementCheckbox").check();
  await page.locator("#acceptAgreement").click();
  await page.locator('#modeGrid [data-mode="single"]').click();
  await page.locator('[data-session-type="experience"]').click();
  await page.locator("#experienceTrialCount").fill("1");
  await page.locator("#startTrainingButton").click();
  await expect(page.locator("#trainerStatus")).toHaveText("预备模式");
  await page.locator("#stageMessage h3").click();
  await expect(page.locator("#trainerStatus")).toHaveText("等待作答");
  await page.keyboard.press("1");
  await expect(page.locator("#trainerStatus")).toHaveText("体验完成");
  expect(await page.evaluate(async () => {
    const desktop = await import("/js/db.js");
    const mobile = await import("/js/mobile-db.js");
    return { desktop: (await desktop.getSessions()).length, mobile: (await mobile.getSessions()).length };
  })).toEqual({ desktop: 1, mobile: 0 });
});
