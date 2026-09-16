import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import * as desktop from "../public/js/db.js";
import * as mobile from "../public/js/mobile-db.js";
import { drawFrameBorder } from "../public/js/gabor.js";
import { MobileTrainingController } from "../public/js/mobile-training.js";
import { INITIAL_LEVELS, TrainingController } from "../public/js/training.js";
import { isMobileDevice } from "../public/js/device.js";

test("device detection supports phones and iPad without treating touch PCs as mobile", () => {
  for (const device of [
    { userAgentData: { mobile: true } },
    { userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)" },
    { userAgent: "Mozilla/5.0 (Linux; Android 14)" },
    { userAgent: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)" },
    { platform: "MacIntel", maxTouchPoints: 5 },
  ]) assert.equal(isMobileDevice(device), true);
  for (const device of [
    { platform: "Win32", maxTouchPoints: 10, userAgentData: { mobile: false } },
    { platform: "MacIntel", maxTouchPoints: 0 },
    { userAgent: "Mozilla/5.0 (X11; Linux x86_64)" },
  ]) assert.equal(isMobileDevice(device), false);
});

test("both platforms get harder after two consecutive correct answers and easier after one wrong answer", () => {
  for (const Controller of [TrainingController, MobileTrainingController]) {
    const controller = Object.create(Controller.prototype);
    controller.levels = { ...INITIAL_LEVELS };
    controller.correctStreaks = { single: 0, triple: 0, darker: 0, shifted: 0 };
    for (const mode of Object.keys(INITIAL_LEVELS)) {
      const initial = controller.levels[mode];
      assert.equal(controller.adaptLevel(mode, true), initial);
      const harder = controller.adaptLevel(mode, true);
      assert.ok(harder < initial, `${Controller.name}: ${mode} must get harder`);
      assert.equal(controller.adaptLevel(mode, true), harder);
      const easier = controller.adaptLevel(mode, false);
      assert.ok(easier > harder, `${Controller.name}: ${mode} must get easier`);
      assert.equal(controller.correctStreaks[mode], 0);
      assert.equal(controller.adaptLevel(mode, true), easier, "a wrong answer resets the consecutive-correct count");
      assert.ok(controller.adaptLevel(mode, true) < easier);
    }
  }
});

test("web stimulus frame draws all four red edges inside the stimulus canvas", () => {
  const rectangles = [];
  const context = {
    save() {},
    restore() {},
    fillRect(...values) { rectangles.push(values); },
  };
  drawFrameBorder({ width: 480, height: 480, getContext: () => context });
  assert.deepEqual(rectangles, [
    [0, 0, 480, 6],
    [0, 474, 480, 6],
    [0, 6, 6, 468],
    [474, 6, 6, 468],
  ]);
  assert.equal(context.fillStyle, "rgb(240, 68, 68)");

  rectangles.length = 0;
  drawFrameBorder({ width: 960, height: 540, getContext: () => context }, 2);
  assert.deepEqual(rectangles, [
    [0, 0, 960, 2],
    [0, 538, 960, 2],
    [0, 2, 2, 536],
    [958, 2, 2, 536],
  ]);
});

test("mobile records, settings, export, retention and clearing cannot touch desktop data", async () => {
  await desktop.saveSession({ id: "same-id", startedAt: "2026-01-01", status: "completed" });
  await desktop.saveTrial({ id: "same-trial", sessionId: "same-id", trialNumber: 1 });
  await desktop.saveSetting(desktop.ADAPTIVE_LEVELS_KEY, { single: 0.01 });
  assert.deepEqual(await mobile.getSessions(), []);
  const controller = Object.create(MobileTrainingController.prototype);
  controller.storage = mobile;
  controller.sessionType = "training";
  controller.onToast = () => {};
  await controller.loadStartingLevels();
  assert.equal(controller.levels.single, INITIAL_LEVELS.single);
  assert.deepEqual(controller.inheritedModes, []);
  controller.trials = [{ mode: "single" }];
  controller.levels.single = 0.12;
  await controller.persistTrainedLevels();
  await controller.loadStartingLevels();
  assert.equal(controller.levels.single, 0.12);
  assert.deepEqual(await desktop.getSetting(desktop.ADAPTIVE_LEVELS_KEY), { single: 0.01 });

  await mobile.saveSession({ id: "same-id", startedAt: "2026-02-01", status: "completed" });
  await mobile.saveTrial({ id: "same-trial", sessionId: "same-id", trialNumber: 1 });
  const exported = await mobile.exportTrainingData();
  assert.equal(exported.platform, "mobile");
  assert.equal(exported.sessions[0].startedAt, "2026-02-01");
  await mobile.saveSession({ id: "new", startedAt: "2026-03-01", status: "completed" });
  await mobile.pruneTrainingData(1);
  assert.deepEqual(await mobile.getTrialsBySession("same-id"), []);
  assert.equal((await desktop.getAllTrials()).length, 1);
  await mobile.clearTrainingData();
  assert.deepEqual(await mobile.getSessions(), []);
  assert.equal(await mobile.getSetting(mobile.ADAPTIVE_LEVELS_KEY), undefined);
  assert.equal((await desktop.getSessions()).length, 1);
  assert.deepEqual(await desktop.getSetting(desktop.ADAPTIVE_LEVELS_KEY), { single: 0.01 });
  await mobile.saveSetting(mobile.ADAPTIVE_LEVELS_KEY, { triple: 0.09 });
  await desktop.clearTrainingData();
  assert.deepEqual(await mobile.getSetting(mobile.ADAPTIVE_LEVELS_KEY), { triple: 0.09 });
});

test("mobile single-mode sessions have 64 trials, mixed has 64 per mode; touch mapping follows orientation", () => {
  const controller = Object.create(MobileTrainingController.prototype);
  for (const mode of ["mixed", "single", "triple", "darker", "shifted"]) {
    controller.selectedMode = mode;
    const sequence = controller.buildSequence();
    assert.equal(sequence.length, mode === "mixed" ? 256 : 64);
    if (mode === "mixed") for (const item of ["single", "triple", "darker", "shifted"]) assert.equal(sequence.filter((value) => value === item).length, 64);
    else assert.ok(sequence.every((value) => value === mode));
  }
  for (const [mode, layoutAngle, left, right] of [["single", 0, "1", "2"], ["shifted", 90, "left", "right"], ["shifted", 0, "up", "down"]]) {
    controller.currentTrial = { mode, layoutAngle };
    assert.equal(controller.mouseAnswerForTrial(0), left);
    assert.equal(controller.mouseAnswerForTrial(2), right);
  }
});
