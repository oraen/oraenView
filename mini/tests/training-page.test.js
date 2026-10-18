const assert = require("node:assert/strict");
const test = require("node:test");

test("training page initializes Canvas, schedules start and prepares local feedback sounds", () => {
  let definition, scheduled = 0;
  const audioEvents = [];
  const context = { fillStyle: "", fillRect() {}, createImageData() { return { data: new Uint8ClampedArray(4) }; } };
  const canvas = { width: 0, height: 0, getContext: () => context };
  global.Page = (value) => { definition = value; };
  global.wx = {
    setKeepScreenOn() {},
    createInnerAudioContext() {
      return {
        stop() { audioEvents.push("stop"); }, play() { audioEvents.push("play"); }, destroy() { audioEvents.push("destroy"); },
      };
    },
    createSelectorQuery() {
      return { select: () => ({ fields: () => ({ exec: (callback) => callback([{ node: canvas, width: 320, height: 320 }]) }) }) };
    },
  };
  const originalTimeout = global.setTimeout;
  global.setTimeout = () => { scheduled += 1; return 1; };
  try {
    require("../miniprogram/pages/training/index");
    const page = Object.assign({ data: {}, setData(value) { Object.assign(this.data, value); } }, definition, { canvasInitAttempts: 0 });
    page.onReady();
    assert.equal(page.canvas, canvas); assert.equal(canvas.width, 480); assert.equal(canvas.height, 480);
    assert.equal(page.feedbackSounds.correct.src, "/audio/correct.mp3");
    assert.equal(page.feedbackSounds.incorrect.src, "/audio/incorrect.mp3");
    assert.equal(page.feedbackSounds.correct.volume, 1);
    assert.equal(page.feedbackSounds.incorrect.volume, 1);
    page.playFeedbackSound(true); page.playFeedbackSound(false);
    assert.deepEqual(audioEvents, ["stop", "play", "stop", "play"]);
    page.destroyFeedbackSounds();
    assert.deepEqual(audioEvents.slice(-2), ["destroy", "destroy"]);
    assert.equal(page.data.prompt, "请保持注视，训练即将开始"); assert.equal(scheduled, 1);
  } finally { global.setTimeout = originalTimeout; delete global.Page; delete global.wx; }
});
