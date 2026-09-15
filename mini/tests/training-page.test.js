const assert = require("node:assert/strict");
const test = require("node:test");

test("training page initializes a page-level Canvas 2D node and schedules start", () => {
  let definition, scheduled = 0;
  const context = { fillStyle: "", fillRect() {}, createImageData() { return { data: new Uint8ClampedArray(4) }; } };
  const canvas = { width: 0, height: 0, getContext: () => context };
  global.Page = (value) => { definition = value; };
  global.wx = {
    setKeepScreenOn() {},
    createSelectorQuery() {
      return { select: () => ({ fields: () => ({ exec: (callback) => callback([{ node: canvas, width: 320, height: 320 }]) }) }) };
    },
  };
  const originalTimeout = global.setTimeout;
  global.setTimeout = () => { scheduled += 1; return 1; };
  try {
    require("../miniprogram/pages/training/index");
    const page = Object.assign({ data: {}, setData(value) { Object.assign(this.data, value); } }, definition, { canvasInitAttempts: 0 });
    page.initializeCanvas();
    assert.equal(page.canvas, canvas); assert.equal(canvas.width, 480); assert.equal(canvas.height, 480);
    assert.equal(page.data.prompt, "请保持注视，训练即将开始"); assert.equal(scheduled, 1);
  } finally { global.setTimeout = originalTimeout; delete global.Page; delete global.wx; }
});
