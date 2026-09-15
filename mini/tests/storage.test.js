const assert = require("node:assert/strict");
const test = require("node:test");
const memory = new Map([["unrelated", "keep-me"]]);
global.wx = {
  getStorageSync: (key) => memory.get(key),
  setStorageSync: (key, value) => memory.set(key, structuredClone(value)),
  removeStorageSync: (key) => memory.delete(key),
};
const storage = require("../miniprogram/utils/storage");

test("wechat data uses its own namespace and clear leaves unrelated storage", () => {
  const session = { id: "s1", startedAt: new Date().toISOString(), status: "completed" };
  storage.saveSession(session); storage.saveTrial({ id: "t1", sessionId: "s1", trialNumber: 1 }); storage.saveLevels({ single: .2 });
  const data = storage.getData(); assert.equal(data.sessions.length, 1); assert.equal(data.trials.length, 1); assert.equal(data.levels.single, .2);
  storage.clear(); assert.equal(storage.getData().sessions.length, 0); assert.equal(memory.get("unrelated"), "keep-me");
});

test("only the newest 100 sessions are retained", () => {
  for (let index = 0; index < 101; index += 1) storage.saveSession({ id: "session-" + index, startedAt: new Date(2026, 0, 1, 0, index).toISOString() });
  const sessions = storage.getData().sessions;
  assert.equal(sessions.length, 100); assert.equal(sessions[0].id, "session-100"); assert.equal(sessions.some((item) => item.id === "session-0"), false);
  storage.clear();
});
