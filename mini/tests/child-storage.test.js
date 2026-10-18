const assert = require("node:assert/strict");
const test = require("node:test");

const memory = new Map();
global.wx = {
  getStorageSync: (key) => memory.get(key),
  setStorageSync: (key, value) => memory.set(key, structuredClone(value)),
  removeStorageSync: (key) => memory.delete(key),
};
const mobile = require("../miniprogram/utils/storage");
const child = require("../miniprogram/utils/child-storage");

test("child records, levels and calibration use a separate WeChat namespace", () => {
  mobile.saveSession({ id: "mobile", startedAt: "2026-01-01T00:00:00Z" });
  child.saveSession({ id: "child", startedAt: "2026-01-02T00:00:00Z", selectedGame: "contrast-stars" });
  child.saveTrial({ id: "trial", sessionId: "child", trialNumber: 1 });
  child.saveLevels({ "contrast-stars": 3 });
  child.saveSettings({ calibrated: true, redLensEye: "left" });

  assert.equal(child.getData().sessions[0].id, "child");
  assert.equal(child.getData().trials.length, 1);
  assert.equal(child.getLevels()["contrast-stars"], 3);
  assert.equal(child.getSettings().calibrated, true);
  assert.equal(mobile.getData().sessions[0].id, "mobile");

  child.clear();
  assert.equal(child.getData().sessions.length, 0);
  assert.equal(mobile.getData().sessions.length, 1);
  mobile.clear();
});
