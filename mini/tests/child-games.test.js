const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../miniprogram/utils/child-games-core");

test("twelve child games build 24-trial sessions and share adaptation rules", () => {
  assert.equal(core.GAME_ORDER.length, 12);
  assert.equal(core.MAX_LEVEL, 30);
  core.GAME_ORDER.forEach((id) => {
    assert.equal(core.buildSequence(id).length, 24);
    const trial = core.createTrial(id, 4, () => .25);
    assert.ok(core.expectedAnswer(trial) !== undefined);
    assert.equal(core.evaluateTrial(trial, core.expectedAnswer(trial)), true);
  });
  assert.deepEqual(core.adaptLevel(4, true, 0), { level: 4, streak: 1 });
  assert.deepEqual(core.adaptLevel(4, true, 1), { level: 5, streak: 0 });
  assert.deepEqual(core.adaptLevel(4, false, 1), { level: 3, streak: 0 });
});
