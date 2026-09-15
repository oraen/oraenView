const assert = require("node:assert/strict");
const test = require("node:test");
const gabor = require("../miniprogram/utils/gabor");

test("the red frame and Gabor stimulus are committed in one canvas image", () => {
  let committed;
  const context = {
    createImageData(width, height) { return { data: new Uint8ClampedArray(width * height * 4) }; },
    putImageData(image) { committed = image.data; },
  };
  const canvas = { getContext: () => context };
  gabor.temporal(canvas, 120, 120, {
    mode: "single", correctAnswer: "1", sigma: 23, frequency: .047,
    angle: 90, phase: 0, contrast: .24,
  }, 1);
  assert.deepEqual(Array.from(committed.slice(0, 4)), [240, 68, 68, 255]);
  const center = (60 * 120 + 60) * 4;
  assert.notDeepEqual(Array.from(committed.slice(center, center + 3)), [240, 68, 68]);
});
