const assert = require("node:assert/strict");
const test = require("node:test");
const engine = require("../miniprogram/utils/training");

test("single modes contain 64 trials and mixed contains 64 of each mode", () => {
  engine.TASK_MODES.forEach((mode) => assert.equal(engine.buildSequence(mode).length, 64));
  const mixed = engine.buildSequence("mixed"); assert.equal(mixed.length, 256);
  engine.TASK_MODES.forEach((mode) => assert.equal(mixed.filter((item) => item === mode).length, 64));
});
test("two correct answers make each mode harder and one error makes it easier", () => {
  engine.TASK_MODES.forEach((mode) => {
    const initial = engine.INITIAL_LEVELS[mode], first = engine.adaptLevel(mode, initial, true, 0);
    assert.equal(first.value, initial); assert.equal(first.streak, 1);
    const second = engine.adaptLevel(mode, first.value, true, first.streak); assert.ok(second.value < initial); assert.equal(second.streak, 0);
    const failed = engine.adaptLevel(mode, second.value, false, second.streak); assert.ok(failed.value > second.value); assert.equal(failed.streak, 0);
  });
});
test("trial answers and parameters match all four experiments", () => {
  engine.TASK_MODES.forEach((mode) => {
    const trial = engine.createTrial(mode, engine.INITIAL_LEVELS[mode], "session", 1);
    assert.equal(trial.mode, mode); assert.ok(trial.correctAnswer);
    if (mode === "triple") assert.equal(trial.spacing, 132);
    if (mode === "darker") assert.ok(trial.clearerContrast > trial.faintContrast);
    if (mode === "shifted") assert.ok(["left", "right", "up", "down"].includes(trial.correctAnswer));
  });
});
