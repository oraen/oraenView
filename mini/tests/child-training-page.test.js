const assert = require("node:assert/strict");
const test = require("node:test");

let definition;
global.Page = (value) => { definition = value; };
require("../miniprogram/pages/child-training/index.js");

test("child training page supports pause and ignores answers until resumed", () => {
  const page = Object.assign({}, definition, {
    data: { paused: false }, awaiting: true, responseStartedAt: 100,
    setData(values) { this.data = Object.assign({}, this.data, values); },
  });
  const originalNow = Date.now; let now = 200;
  Date.now = () => now;
  try {
    page.togglePause();
    assert.equal(page.data.paused, true);
    assert.equal(page.awaiting, false);
    assert.equal(page.data.feedback, "训练已暂停");
    now = 700; page.togglePause();
    assert.equal(page.data.paused, false);
    assert.equal(page.awaiting, true);
    assert.equal(page.responseStartedAt, 600);
  } finally { Date.now = originalNow; }
});

test("child training page exposes twelve game-compatible response paths", () => {
  assert.equal(typeof definition.tapCanvas, "function");
  assert.equal(typeof definition.answer, "function");
  assert.equal(typeof definition.drawContrastStars, "function");
  assert.equal(typeof definition.drawOrientationForest, "function");
  assert.equal(typeof definition.drawCrowdingC, "function");
  assert.equal(typeof definition.drawVernier, "function");
  assert.equal(typeof definition.drawFusionRings, "function");
  assert.equal(typeof definition.drawAnaglyphSearch, "function");
  assert.equal(typeof definition.drawMotionRadar, "function");
  assert.equal(typeof definition.drawContourTrail, "function");
  assert.equal(typeof definition.drawShapeWorkshop, "function");
  assert.equal(typeof definition.drawMemoryCards, "function");
  assert.equal(typeof definition.drawFireflyChase, "function");
  assert.equal(typeof definition.drawStereoOrbs, "function");
});

test("child training masks the previous stimulus between trials", () => {
  const calls = [];
  const context = {
    clearRect(...args) { calls.push(["clearRect", ...args]); },
    fillRect(...args) { calls.push(["fillRect", ...args]); },
    beginPath() { calls.push(["beginPath"]); },
    arc(...args) { calls.push(["arc", ...args]); },
    fill() { calls.push(["fill"]); },
  };
  const page = Object.assign({}, definition, { context, gameId: "crowding-c" });
  page.drawTransitionMask();
  assert.deepEqual(calls[0], ["clearRect", 0, 0, 480, 480]);
  assert.deepEqual(calls[1], ["fillRect", 0, 0, 480, 480]);
  assert.deepEqual(calls.find((item) => item[0] === "arc").slice(0, 4), ["arc", 240, 240, 3]);
});

test("canvas hits use local touch coordinates or subtract page offsets", () => {
  for (const size of [280, 360, 414]) {
    const answers = [];
    const page = Object.assign({}, definition, { awaiting: true, gameId: "contrast-stars", trial: { responseType: "target" }, displayWidth: size, displayHeight: size, canvasLeft: 17, canvasTop: 183, hitRegions: [{ index: 2, x: 240, y: 240, radius: 24 }], handleAnswer: answer => answers.push(answer) });
    const center = size / 2;
    page.tapCanvas({ changedTouches: [{ x: center, y: center }], detail: { x: 0, y: 0 } });
    page.tapCanvas({ changedTouches: [{ clientX: 17 + center, clientY: 183 + center }] });
    page.tapCanvas({ detail: { x: 17 + center, y: 183 + center } });
    page.tapCanvas({ changedTouches: [{ x: -1, y: center }] });
    page.tapCanvas({ changedTouches: [] });
    assert.deepEqual(answers, [2, 2, 2]);
    page.awaiting = false;
    page.tapCanvas({ changedTouches: [{ x: center, y: center }] });
    assert.equal(answers.length, 3);
  }
});

test("canvas initialization scales physical pixels while keeping logical hit coordinates", () => {
  const scales = [];
  const canvas = { getContext: () => ({ scale: (...args) => scales.push(args) }) };
  let started = 0;
  global.wx = {
    getWindowInfo: () => ({ pixelRatio: 3 }),
    createSelectorQuery: () => ({ select() { return this; }, fields(options) { assert.equal(options.rect, true); return this; }, exec(callback) { callback([{ node: canvas, width: 320, height: 320, left: 12, top: 150 }]); } }),
  };
  const page = Object.assign({}, definition, { start() { started++; } });
  page.initializeCanvas();
  assert.equal(canvas.width, 960); assert.equal(canvas.height, 960);
  assert.deepEqual(scales, [[2, 2]]);
  assert.equal(page.displayWidth, 320); assert.equal(page.canvasTop, 150); assert.equal(started, 1);
  page.session = {}; page.drawTransitionMask = () => {};
  page.initializeCanvas(); assert.equal(started, 1);
});
