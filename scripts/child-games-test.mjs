import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const core = require("../public/js/child-games-core.js");

function seeded(values) { let index = 0; return () => values[index++ % values.length]; }

test("twelve child games expose complete product metadata", () => {
  assert.equal(core.MAX_LEVEL, 30);
  assert.equal(core.GAME_ORDER.length, 12);
  assert.equal(new Set(core.GAME_ORDER).size, 12);
  for (const id of core.GAME_ORDER) {
    const game = core.GAMES[id];
    assert.equal(game.id, id); assert.ok(game.name); assert.ok(game.tagline); assert.ok(game.skill); assert.ok(game.instruction);
    assert.ok(["target", "direction", "side"].includes(game.responseType));
  }
  assert.deepEqual(core.DICHOPTIC_GAMES, ["fusion-rings", "anaglyph-search", "stereo-orbs"]);
  assert.ok(core.DICHOPTIC_GAMES.every((id) => core.GAMES[id].glasses));
});

test("upper levels materially tighten each training task", () => {
  const rng = () => .25;
  const easy = Object.fromEntries(core.GAME_ORDER.map((id) => [id, core.createTrial(id, 1, rng)]));
  const hard = Object.fromEntries(core.GAME_ORDER.map((id) => [id, core.createTrial(id, core.MAX_LEVEL, rng)]));
  assert.ok(hard["contrast-stars"].contrastDelta < easy["contrast-stars"].contrastDelta);
  assert.ok(hard["orientation-forest"].angleDifference < easy["orientation-forest"].angleDifference);
  assert.ok(hard["crowding-c"].symbolSize < easy["crowding-c"].symbolSize);
  assert.ok(hard["vernier-blocks"].offset < easy["vernier-blocks"].offset);
  assert.ok(hard["fusion-rings"].offset < easy["fusion-rings"].offset);
  assert.ok(hard["anaglyph-search"].distractorOffset < easy["anaglyph-search"].distractorOffset);
  assert.ok(hard["motion-radar"].coherence < easy["motion-radar"].coherence);
  assert.ok(hard["contour-trail"].noiseCount > easy["contour-trail"].noiseCount);
  assert.ok(hard["shape-workshop"].shapeDifference < easy["shape-workshop"].shapeDifference);
  assert.ok(hard["memory-cards"].memoryDifference < easy["memory-cards"].memoryDifference);
  assert.ok(hard["firefly-chase"].speed > easy["firefly-chase"].speed);
  assert.ok(hard["stereo-orbs"].disparity < easy["stereo-orbs"].disparity);
});

test("every step through level 30 changes the intended difficulty parameter", () => {
  const rng = () => .25;
  const value = (id, trial) => ({
    "contrast-stars": [trial.contrastDelta, trial.starRadius],
    "orientation-forest": trial.angleDifference,
    "crowding-c": trial.symbolSize * trial.flankerSpacing,
    "vernier-blocks": trial.offset,
    "fusion-rings": trial.offset,
    "anaglyph-search": trial.distractorOffset,
    "motion-radar": trial.coherence,
    "contour-trail": [trial.noiseCount, trial.orientationJitter],
    "shape-workshop": trial.shapeDifference,
    "memory-cards": [trial.memoryDifference, trial.previewMs, trial.symbolCount],
    "firefly-chase": [trial.speed, trial.count, trial.targetRadius, trial.trackingCueMs],
    "stereo-orbs": trial.disparity,
  }[id]);
  for (const id of core.GAME_ORDER) {
    let previous = JSON.stringify(value(id, core.createTrial(id, 1, rng)));
    for (let level = 2; level <= core.MAX_LEVEL; level += 1) {
      const current = JSON.stringify(value(id, core.createTrial(id, level, rng)));
      assert.notEqual(current, previous, `${id} level ${level} must differ from level ${level - 1}`);
      previous = current;
    }
  }
});

test("crowding flankers never geometrically cover the central optotype", () => {
  for (let level = 1; level <= core.MAX_LEVEL; level += 1) {
    const trial = core.createTrial("crowding-c", level, () => .25);
    const strokeWidth = Math.max(3, trial.symbolSize * .17);
    const edgeGap = trial.symbolSize * trial.flankerSpacing - trial.symbolSize - strokeWidth;
    assert.ok(edgeGap >= .99, `level ${level} edge gap is ${edgeGap}`);
    assert.ok(trial.symbolSize / 2 * trial.gapAngle >= 1.2, `level ${level} central gap is too small to render`);
  }
});

test("all games create valid serializable trials at every level", () => {
  for (const id of core.GAME_ORDER) for (let level = 1; level <= core.MAX_LEVEL; level += 1) {
    const trial = core.createTrial(id, level, seeded([.02, .26, .51, .74, .93]));
    assert.equal(trial.gameId, id); assert.equal(trial.levelBefore, level); assert.ok(trial.id); assert.ok(trial.responseType);
    assert.ok(Number.isInteger(trial.targetIndex) ? trial.targetIndex >= 0 && trial.targetIndex < trial.count : true);
    for (const value of Object.values(trial)) if (typeof value === "number") assert.ok(Number.isFinite(value), `${id} level ${level} contains a non-finite number`);
    const answer = core.expectedAnswer(trial); assert.equal(core.evaluateTrial(trial, answer), true);
    assert.doesNotThrow(() => JSON.stringify(trial));
  }
});

test("child adaptation uses two-correct one-wrong staircase with hard bounds", () => {
  let state = { level: 1, streak: 0 };
  state = core.adaptLevel(state.level, true, state.streak); assert.deepEqual(state, { level: 1, streak: 1 });
  state = core.adaptLevel(state.level, true, state.streak); assert.deepEqual(state, { level: 2, streak: 0 });
  state = core.adaptLevel(state.level, false, state.streak); assert.deepEqual(state, { level: 1, streak: 0 });
  assert.equal(core.adaptLevel(1, false, 0).level, 1); assert.equal(core.adaptLevel(core.MAX_LEVEL, true, 1).level, core.MAX_LEVEL);
});

test("three platform core copies remain byte-identical", async () => {
  const files = await Promise.all(["../public/js/child-games-core.js", "../xhs/app/js/child-games-core.js", "../mini/miniprogram/utils/child-games-core.js"].map((path) => readFile(new URL(path, import.meta.url), "utf8")));
  assert.equal(files[1], files[0]); assert.equal(files[2], files[0]);
});

test("motion moves dots; contours have equal density and randomized paths", () => {
  for (const level of [1,16,30]) {
    const motion=core.createTrial('motion-radar',level);
    const a=core.motionFrame(motion,0), b=core.motionFrame(motion,80);
    assert.equal(a.length,motion.dotCount);assert.notDeepEqual(a,b);
    for(const p of b){assert.ok(p.x>=45&&p.x<435&&p.y>=45&&p.y<435);assert.deepEqual(Object.keys(p),['x','y']);}
    const t=core.createTrial('contour-trail',level), patches=core.contourPatches(t);
    assert.ok(patches.every(p=>p.length===t.noiseCount+t.segmentCount));
    assert.notDeepEqual(patches,core.contourPatches({...t,seed:t.seed+1}));
    for(const patch of patches)for(const line of patch)assert.ok(Math.abs(line.x)<80&&Math.abs(line.y)<80&&Number.isFinite(line.angle));
  }
  assert.ok(core.createTrial('crowding-c',30).optotypeContrast<core.createTrial('crowding-c',16).optotypeContrast);
  const signs=new Set();
  for(let n=0;n<100;n++){const t=core.createTrial('shape-workshop',30);assert.equal(t.shapeOffsets[t.targetIndex],0);t.shapeOffsets.forEach((v,i)=>{if(i!==t.targetIndex){assert.ok(Math.abs(v)>=t.shapeDifference);signs.add(Math.sign(v));}});}
  assert.equal(signs.size,2);
});

test("firefly dark tracking lasts 4.5 to 9.5 seconds before answers unlock",()=>{
  for(let level=1;level<=30;level++)assert.equal(core.createTrial('firefly-chase',level).trackingDurationMs,Math.round(4500+(level-1)*5000/29));
});

test("memory alternatives differ visibly in geometry without hiding a changed dot",()=>{
  for(let seed=1;seed<=50;seed++)for(const level of [1,16,30]){
    const t=core.createTrial('memory-cards',level);
    const original=core.memoryPattern(seed,t.symbolCount,-1,0);
    for(let variant=0;variant<4;variant++)for(const sign of [-1,1]){
      const dots=core.memoryPattern(seed,t.symbolCount,variant%t.symbolCount,t.memoryDifference*sign);
      assert.notDeepEqual(dots,original);
      for(let i=0;i<dots.length;i++)for(let j=i+1;j<dots.length;j++)assert.ok(Math.hypot(dots[i].x-dots[j].x,dots[i].y-dots[j].y)>dots[i].radius+dots[j].radius);
    }
  }
});

