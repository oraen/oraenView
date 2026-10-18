const assert = require("node:assert/strict");
const test = require("node:test");

const memory = new Map(); let navigated = ""; let definition;
global.wx = {
  getStorageSync: (key) => memory.get(key), setStorageSync: (key, value) => memory.set(key, value),
  removeStorageSync: (key) => memory.delete(key), navigateTo: ({ url }) => { navigated = url; },
};
global.Page = (value) => { definition = value; };
require("../miniprogram/pages/child/index.js");
const storage = require("../miniprogram/utils/child-storage");

function page() { return Object.assign({}, definition, { data: Object.assign({}, definition.data), setData(values) { this.data = Object.assign({}, this.data, values); } }); }

test("child menu teaches the selected game before navigation", () => {
  const instance = page();
  instance.chooseGame({ currentTarget: { dataset: { game: "contrast-stars" } } });
  assert.equal(instance.data.showTutorial, true); assert.equal(instance.data.selectedGameInfo.name, "星光捕手");
  instance.confirmTutorial();
  assert.equal(navigated, "/pages/child-training/index?game=contrast-stars");
});

test("dichoptic games require calibration after the tutorial", () => {
  const instance = page();
  instance.chooseGame({ currentTarget: { dataset: { game: "fusion-rings" } } }); instance.confirmTutorial();
  assert.equal(instance.data.showSetup, true); assert.equal(instance.data.showTutorial, false);
});

test("game tutorial is shown again on later visits", () => {
  navigated = "";
  const instance = page();
  instance.chooseGame({ currentTarget: { dataset: { game: "contrast-stars" } } });
  assert.equal(instance.data.showTutorial, true);
  assert.equal(navigated, "");
});

test("child menu shows each saved current level", () => {
  storage.saveLevels({ "contrast-stars": 8, "stereo-orbs": 30 });
  const instance = page(); instance.onShow();
  assert.equal(instance.data.games.find((game) => game.id === "contrast-stars").levelLabel, "8级");
  assert.equal(instance.data.games.find((game) => game.id === "stereo-orbs").levelLabel, "30级");
});
