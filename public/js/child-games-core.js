(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ChildGamesCore = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  const MIN_LEVEL = 1;
  const MAX_LEVEL = 30;
  const DEFAULT_TRIALS = 24;
  const DICHOPTIC_GAMES = ["fusion-rings", "anaglyph-search", "stereo-orbs"];
  const DIRECTIONS = ["up", "right", "down", "left"];

  const GAMES = {
    "contrast-stars": {
      id: "contrast-stars", name: "星光捕手", icon: "✦", color: "#6c63ff",
      tagline: "找到藏在灰色天空里的小星星", skill: "对比检测",
      instruction: "仔细看灰色区域，点一下亮度不同的星星。",
      responseType: "target", glasses: false,
    },
    "orientation-forest": {
      id: "orientation-forest", name: "方向森林", icon: "⌁", color: "#18a77b",
      tagline: "找出朝向不一样的小树", skill: "方向辨别",
      instruction: "点一下方向和其他图案不同的那一个。",
      responseType: "target", glasses: false,
    },
    "crowding-c": {
      id: "crowding-c", name: "缺口侦探", icon: "C", color: "#ff8a3d",
      tagline: "看清中间圆环的缺口方向", skill: "拥挤视力",
      instruction: "只看中间的圆环，选择它的缺口方向。",
      responseType: "direction", glasses: false,
    },
    "vernier-blocks": {
      id: "vernier-blocks", name: "对齐积木", icon: "║", color: "#e94f75",
      tagline: "判断哪一边的积木排得更整齐", skill: "位置精度",
      instruction: "左右比较，选择上下两段更接近一条直线的一边。",
      responseType: "side", glasses: false,
    },
    "fusion-rings": {
      id: "fusion-rings", name: "红蓝合环", icon: "◉", color: "#2878ff",
      tagline: "让两只眼看到的半环合在一起", skill: "双眼融合",
      instruction: "戴好红青眼镜，选择红色半环和青色半环拼得更完整的一边。",
      responseType: "side", glasses: true,
    },
    "anaglyph-search": {
      id: "anaglyph-search", name: "红蓝寻宝", icon: "⌾", color: "#00a6a6",
      tagline: "找到红青图案重合的宝藏", skill: "双眼协同搜索",
      instruction: "戴好红青眼镜，点一下红色和青色图案重合得最好的一格。",
      responseType: "target", glasses: true,
    },
    "motion-radar": {
      id: "motion-radar", name: "风向雷达", icon: "➤", color: "#4c7cf3",
      tagline: "看清小点一起移动的方向", skill: "全局运动辨别",
      instruction: "观察移动的小点，找出其中共同移动的方向。其他小点会随机移动。",
      responseType: "direction", glasses: false,
    },
    "contour-trail": {
      id: "contour-trail", name: "曲线寻踪", icon: "〰", color: "#20a36a",
      tagline: "从杂乱线条里找出连贯的小路", skill: "轮廓整合",
      instruction: "四块图案里只有一块藏着一条连贯曲线，找到后点它。",
      responseType: "target", glasses: false,
    },
    "shape-workshop": {
      id: "shape-workshop", name: "拼图工坊", icon: "◇", color: "#f08c36",
      tagline: "找出和上方样板完全相同的图形", skill: "形状辨别",
      instruction: "记住上方的样板，在下面四个图形中点出完全相同的一个。",
      responseType: "target", glasses: false,
    },
    "memory-cards": {
      id: "memory-cards", name: "记忆翻牌", icon: "▦", color: "#8b63d9",
      tagline: "记住闪过的图案和位置", skill: "视觉记忆与注意",
      instruction: "记住上方短暂出现的图案，再从下方选出相同的一个。",
      responseType: "target", glasses: false,
    },
    "firefly-chase": {
      id: "firefly-chase", name: "萤火追击", icon: "●", color: "#e3a719",
      tagline: "跟住发光移动的萤火虫并点中它", skill: "动态追踪与手眼协调",
      instruction: "先记住带光环的萤火虫，光环消失后继续跟踪，等提示可以点击时再点它。",
      responseType: "target", glasses: false,
    },
    "stereo-orbs": {
      id: "stereo-orbs", name: "红蓝深度球", icon: "◍", color: "#d54c70",
      tagline: "分辨哪一侧的小球更靠前", skill: "双眼视差与深度判断",
      instruction: "戴好红青眼镜，选择看起来更靠近自己的那一侧小球。",
      responseType: "side", glasses: true,
    },
  };

  const GAME_ORDER = ["contrast-stars", "orientation-forest", "crowding-c", "vernier-blocks", "fusion-rings", "anaglyph-search", "motion-radar", "contour-trail", "shape-workshop", "memory-cards", "firefly-chase", "stereo-orbs"];

  function clamp(value, minimum, maximum) { return Math.max(minimum, Math.min(maximum, value)); }
  function round(value, decimals) { const factor = Math.pow(10, decimals == null ? 4 : decimals); return Math.round(value * factor) / factor; }
  function pick(items, random) { return items[Math.floor(random() * items.length)]; }
  function integer(maximum, random) { return Math.floor(random() * maximum); }
  function createId(prefix) { return prefix + "-" + Date.now() + "-" + Math.random().toString(16).slice(2); }
  function normalizeLevel(level) { return clamp(Math.round(Number(level) || MIN_LEVEL), MIN_LEVEL, MAX_LEVEL); }
  function gridCount(level) { return [4,4,6,6,9,9,12,12,12,16,16,16,20,20,20,24,24,24,24,24,24,24,24,24,24,24,24,24,24,24][normalizeLevel(level) - 1]; }

  function createTrial(gameId, level, random) {
    const rng = typeof random === "function" ? random : Math.random;
    const normalized = normalizeLevel(level);
    const common = {
      id: createId("child-trial"), gameId: gameId, levelBefore: normalized,
      createdAt: new Date().toISOString(), responseType: GAMES[gameId] && GAMES[gameId].responseType,
    };
    if (!GAMES[gameId]) throw new Error("Unknown child game: " + gameId);

    if (gameId === "contrast-stars") {
      const count = gridCount(normalized);
      const deltas = [0.34,0.29,0.24,0.20,0.16,0.13,0.10,0.08,0.065,0.052,0.042,0.034,0.028,0.023,0.019,0.016,0.0145,0.0132,0.0121,0.0112,0.0105,0.0099,0.0094,0.0090,0.0087,0.0084,0.0081,0.0078,0.0075,0.0072];
      return Object.assign(common, { count: count, targetIndex: integer(count, rng), contrastDelta: deltas[normalized - 1], polarity: rng() < 0.5 ? -1 : 1, starRadius: normalized <= 16 ? 27 : round(27 - (normalized - 16) * 0.65, 2) });
    }
    if (gameId === "orientation-forest") {
      const count = gridCount(normalized);
      const differences = [60,50,40,32,25,19,14,10,8,6.5,5,4,3.2,2.6,2.1,1.7,1.5,1.32,1.17,1.04,.93,.83,.74,.66,.59,.53,.48,.43,.39,.35];
      const baseAngle = pick([0, 45, 90, 135], rng);
      const sign = rng() < 0.5 ? -1 : 1;
      return Object.assign(common, { count: count, targetIndex: integer(count, rng), baseAngle: baseAngle, targetAngle: baseAngle + differences[normalized - 1] * sign, angleDifference: differences[normalized - 1] });
    }
    if (gameId === "crowding-c") {
      const legacySpacings = [2.8,2.6,2.4,2.2,2.05,1.95,1.86,1.78,1.72,1.67,1.63,1.59,1.56,1.54,1.52,1.50];
      const sizes = [58,55,52,49,46,43,40,37,34,32,30,28,26,24,23,22,21.5,21,20.5,20,19.5,19,18.5,18,17.5,17,16.5,16,15,14];
      const edgeGaps = [6.5,6,5.5,5,4.5,4,3.5,3,2.7,2.4,2.1,1.8,1.4,1];
      const gapAngles = [.52,.52,.52,.52,.52,.52,.52,.52,.52,.52,.52,.52,.52,.52,.52,.52,.49,.46,.43,.40,.37,.34,.32,.30,.28,.26,.24,.22,.20,.18];
      const size = sizes[normalized - 1]; const strokeWidth = Math.max(3, size * .17);
      const spacing = normalized <= 16 ? legacySpacings[normalized - 1] : (size + strokeWidth + edgeGaps[normalized - 17]) / size;
      return Object.assign(common, { correctAnswer: pick(DIRECTIONS, rng), flankerSpacing: round(spacing, 4), symbolSize: size, gapAngle: gapAngles[normalized - 1], optotypeContrast: round(.88 * Math.pow(.22 / .88, (normalized - 1) / 29), 4), flankerDirections: [pick(DIRECTIONS, rng), pick(DIRECTIONS, rng), pick(DIRECTIONS, rng), pick(DIRECTIONS, rng)] });
    }
    if (gameId === "vernier-blocks") {
      const offsets = [24,20,16,13,10,8,6,5,4,3.4,2.8,2.3,1.9,1.6,1.3,1,.9,.81,.73,.66,.59,.53,.48,.43,.39,.35,.32,.29,.26,.23];
      const correctAnswer = rng() < 0.5 ? "left" : "right";
      return Object.assign(common, { correctAnswer: correctAnswer, offset: offsets[normalized - 1], alignedJitter: 0 });
    }
    if (gameId === "fusion-rings") {
      const offsets = [30,25,20,16,13,11,9,7.5,6,5,4.2,3.5,3,2.6,2.3,2,1.8,1.62,1.46,1.31,1.18,1.06,.95,.86,.77,.69,.62,.56,.50,.45];
      return Object.assign(common, { correctAnswer: rng() < 0.5 ? "left" : "right", offset: offsets[normalized - 1], ringRadius: 54 });
    }
    if (gameId === "anaglyph-search") {
      const count = gridCount(normalized);
      const offsets = [32,28,24,20,17,14,12,10,8,7,6,5,4,3.3,2.6,2,1.8,1.62,1.46,1.31,1.18,1.06,.95,.86,.77,.69,.62,.56,.50,.45];
      return Object.assign(common, { count: count, targetIndex: integer(count, rng), distractorOffset: offsets[normalized - 1], markerRadius: 13 });
    }
    if (gameId === "motion-radar") {
      const coherences = [.88,.80,.72,.64,.56,.48,.40,.34,.29,.25,.21,.18,.15,.13,.115,.10,.092,.085,.079,.073,.068,.063,.059,.055,.051,.048,.045,.042,.039,.036];
      return Object.assign(common, { correctAnswer: pick(DIRECTIONS, rng), dotCount: 24 + normalized * 3, coherence: coherences[normalized - 1], phase: round(rng() * Math.PI * 2, 4) });
    }
    if (gameId === "contour-trail") {
      const jitters = [4,6,8,10,12,14,16,18,20,22,24,26,28,30,32,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49];
      return Object.assign(common, { count: 4, targetIndex: integer(4, rng), segmentCount: 12, noiseCount: 18 + normalized * 4, orientationJitter: jitters[normalized - 1], seed: integer(100000, rng) });
    }
    if (gameId === "shape-workshop") {
      const differences = [.42,.36,.30,.25,.20,.16,.12,.09,.072,.058,.047,.038,.031,.026,.021,.017,.0155,.0141,.0128,.0116,.0105,.0095,.0086,.0078,.0071,.0065,.0059,.0054,.0049,.0045];
      const targetIndex = integer(4, rng);
      const shapeOffsets = Array.from({ length: 4 }, function (_, i) { return i === targetIndex ? 0 : differences[normalized - 1] * (rng() < .5 ? -1 : 1) * (1 + rng() * .35); });
      return Object.assign(common, { count: 4, targetIndex: targetIndex, sides: 3 + integer(4, rng), rotation: rng() * 360, shapeDifference: differences[normalized - 1], shapeOffsets: shapeOffsets });
    }
    if (gameId === "memory-cards") {
      const symbols = 3 + Math.floor((normalized - 1) / 2);
      const differences = [28,25,22,20,18,16,14,12,10,9,8,7,6,5,4,3,2.8,2.6,2.4,2.2,2.05,1.9,1.75,1.62,1.5,1.39,1.29,1.2,1.11,1.03];
      return Object.assign(common, { count: 4, targetIndex: integer(4, rng), symbolCount: Math.min(12, symbols), patternSeed: integer(100000, rng), previewMs: Math.max(280, 1550 - normalized * 75), memoryDifference: differences[normalized - 1] });
    }
    if (gameId === "firefly-chase") {
      const speeds = [.45,.55,.65,.78,.92,1.08,1.25,1.45,1.58,1.70,1.82,1.94,2.04,2.12,2.20,2.28,2.36,2.44,2.52,2.60,2.68,2.76,2.84,2.92,3.00,3.08,3.16,3.24,3.32,3.40];
      const count = normalized < 3 ? 3 : normalized < 6 ? 4 : normalized < 11 ? 5 : normalized < 19 ? 6 : normalized < 25 ? 7 : 8;
      return Object.assign(common, { count: count, targetIndex: integer(count, rng), speed: speeds[normalized - 1], motionSeed: integer(100000, rng), targetRadius: Math.max(9, 27 - normalized), trackingCueMs: Math.max(280, 1250 - normalized * 50), trackingDurationMs: Math.round(4500 + (normalized - 1) * 5000 / 29) });
    }
    const disparities = [30,26,22,18,15,12,10,8,6.5,5.3,4.4,3.7,3.1,2.7,2.3,2,1.8,1.62,1.46,1.31,1.18,1.06,.95,.86,.77,.69,.62,.56,.50,.45];
    return Object.assign(common, { correctAnswer: rng() < 0.5 ? "left" : "right", disparity: disparities[normalized - 1], dotCount: 28 + normalized * 3, seed: integer(100000, rng) });
  }

  function seededRandom(seed) { let value = (Number(seed) || 1) >>> 0; return function () { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; }; }

  // Limited-lifetime dots: identity, colour and size never disclose the signal.
  function motionFrame(trial, elapsedMs) {
    const vectors = { up: [0,-1], right: [1,0], down: [0,1], left: [-1,0] };
    const main = vectors[trial.correctAnswer];
    const age = Math.max(0, elapsedMs); const lifetime = 240;
    return Array.from({ length: trial.dotCount }, function (_, i) {
      const offset = i * lifetime / trial.dotCount;
      const cycle = Math.floor((age + offset) / lifetime);
      const fraction = ((age + offset) % lifetime) / 1000;
      const rng = seededRandom(Math.round(trial.phase * 100000) + i * 104729 + cycle * 15485863);
      const x = rng() * 390, y = rng() * 390;
      const signal = rng() < trial.coherence;
      const angle = rng() * Math.PI * 2;
      const vx = signal ? main[0] : Math.cos(angle), vy = signal ? main[1] : Math.sin(angle);
      return { x: 45 + (x + vx * fraction * 95 + 390) % 390, y: 45 + (y + vy * fraction * 95 + 390) % 390 };
    });
  }

  // Every patch has the same number, length, colour and width of segments.
  function contourPatches(trial) {
    const rng = seededRandom(trial.seed);
    const rotation = rng() * Math.PI * 2;
    const phase = rng() * Math.PI * 2;
    const amplitude = 16 + rng() * 10;
    return Array.from({ length: 4 }, function (_, index) {
      const lines = [];
      for (let n = 0; n < trial.noiseCount + trial.segmentCount; n += 1) {
        let x = (rng() - .5) * 144, y = (rng() - .5) * 144, angle = rng() * Math.PI;
        if (n < trial.segmentCount && index === trial.targetIndex) {
          const p = n / (trial.segmentCount - 1), localX = -60 + p * 120;
          const localY = Math.sin(p * Math.PI * 2 + phase) * amplitude;
          x = localX * Math.cos(rotation) - localY * Math.sin(rotation);
          y = localX * Math.sin(rotation) + localY * Math.cos(rotation);
          angle = rotation + Math.atan2(Math.cos(p * Math.PI * 2 + phase) * amplitude * Math.PI * 2, 120) + (rng() - .5) * trial.orientationJitter * Math.PI / 180;
        }
        lines.push({ x: x, y: y, angle: angle });
      }
      return lines;
    });
  }

  function memoryPattern(seed, count, variant, difference) {
    const rng = seededRandom(seed);
    return Array.from({ length: count }, function (_, i) {
      return { x: -33 + (i % 4) * 22 + (rng() - .5) * 2 + (i === variant ? difference * .22 : 0), y: -22 + Math.floor(i / 4) * 22 + (rng() - .5) * 2, radius: 4 + rng() };
    });
  }

  function expectedAnswer(trial) {
    if (trial.responseType === "target") return trial.targetIndex;
    return trial.correctAnswer;
  }

  function evaluateTrial(trial, response) { return String(response) === String(expectedAnswer(trial)); }

  function adaptLevel(currentLevel, correct, correctStreak) {
    let level = normalizeLevel(currentLevel);
    let streak = Number(correctStreak) || 0;
    if (correct) {
      streak += 1;
      if (streak >= 2) { level += 1; streak = 0; }
    } else {
      level -= 1;
      streak = 0;
    }
    return { level: clamp(level, MIN_LEVEL, MAX_LEVEL), streak: streak };
  }

  function difficultyScore(level) { return round((normalizeLevel(level) - MIN_LEVEL) / (MAX_LEVEL - MIN_LEVEL) * 100, 1); }
  function buildSequence(gameId, count) {
    if (!GAMES[gameId]) throw new Error("Unknown child game: " + gameId);
    return Array(Math.max(1, Math.floor(Number(count) || DEFAULT_TRIALS))).fill(gameId);
  }
  function createInitialLevels() {
    const levels = {};
    GAME_ORDER.forEach(function (id) { levels[id] = 1; });
    return levels;
  }
  function summarizeTrials(trials) {
    const list = Array.isArray(trials) ? trials : [];
    const correct = list.filter(function (trial) { return trial.correct; }).length;
    const responseTimes = list.map(function (trial) { return Number(trial.reactionTimeMs); }).filter(Number.isFinite);
    return {
      trials: list.length, correct: correct, accuracy: list.length ? round(correct / list.length, 4) : 0,
      averageReactionTimeMs: responseTimes.length ? Math.round(responseTimes.reduce(function (sum, value) { return sum + value; }, 0) / responseTimes.length) : 0,
    };
  }

  return {
    GAMES: GAMES, GAME_ORDER: GAME_ORDER, DICHOPTIC_GAMES: DICHOPTIC_GAMES, DIRECTIONS: DIRECTIONS,
    MIN_LEVEL: MIN_LEVEL, MAX_LEVEL: MAX_LEVEL, DEFAULT_TRIALS: DEFAULT_TRIALS,
    clamp: clamp, round: round, createId: createId, normalizeLevel: normalizeLevel,
    createTrial: createTrial, expectedAnswer: expectedAnswer, evaluateTrial: evaluateTrial,
    motionFrame: motionFrame, contourPatches: contourPatches, memoryPattern: memoryPattern,
    adaptLevel: adaptLevel, difficultyScore: difficultyScore, buildSequence: buildSequence,
    createInitialLevels: createInitialLevels, summarizeTrials: summarizeTrials,
  };
});
