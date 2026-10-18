import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import * as child from "../public/js/child-db.js";
import * as mobile from "../public/js/mobile-db.js";

test("child web records and settings are isolated from mobile records", async () => {
  await child.clearTrainingData(); await mobile.clearTrainingData();
  await child.saveSession({ id: "child-session", startedAt: "2026-01-02T00:00:00Z" });
  await child.saveTrial({ id: "child-trial", sessionId: "child-session", trialNumber: 1 });
  await child.saveSetting(child.LEVELS_KEY, { "contrast-stars": 3 });
  await child.saveSetting(child.SETTINGS_KEY, { calibrated: true });
  await mobile.saveSession({ id: "mobile-session", startedAt: "2026-01-01T00:00:00Z" });

  const exported = await child.exportTrainingData();
  assert.equal(exported.platform, "child-web");
  assert.equal(exported.sessions.length, 1); assert.equal(exported.trials.length, 1);
  assert.equal(exported.settings.levels["contrast-stars"], 3);
  assert.equal(exported.settings.anaglyph.calibrated, true);

  await child.clearTrainingData();
  assert.equal((await child.getSessions()).length, 0);
  assert.equal((await mobile.getSessions()).length, 1);
  await mobile.clearTrainingData();
});

test("child web retention keeps the newest 100 sessions and their trials", async () => {
  await child.clearTrainingData();
  for (let index = 0; index < 101; index += 1) {
    const id = "child-retention-" + index;
    await child.saveSession({ id, startedAt: new Date(2026, 0, 1, 0, index).toISOString() });
    await child.saveTrial({ id: "trial-" + index, sessionId: id, trialNumber: 1 });
  }
  const sessions = await child.getSessions(); const trials = await child.getAllTrials();
  assert.equal(sessions.length, 100); assert.equal(sessions.some((item) => item.id === "child-retention-0"), false);
  assert.equal(trials.some((item) => item.sessionId === "child-retention-0"), false);
  await child.clearTrainingData();
});
