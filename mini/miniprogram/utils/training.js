const MODE_INFO = {
  mixed: { label: "综合训练", caption: "四种模式，各 64 次" },
  single: { label: "单图训练", caption: "选出有图像的那一帧" },
  triple: { label: "三图训练", caption: "选出有中间图像的那一帧" },
  darker: { label: "清晰图训练", caption: "选出更清晰的那一帧" },
  shifted: { label: "移图训练", caption: "判断中间图像偏向哪边" },
};
const TASK_MODES = ["single", "triple", "darker", "shifted"];
const INITIAL_LEVELS = { single: 0.24, triple: 0.19, darker: 0.10, shifted: 19 };
const LEVEL_BOUNDS = { single: [0.0005, 0.55], triple: [0.0004, 0.48], darker: [0.002, 0.24], shifted: [0.5, 42] };
const TIMING = { fixation: 650, interval: 430, gap: 330, shifted: 560, feedback: 520 };
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function round(value, decimals = 4) { const scale = Math.pow(10, decimals); return Math.round(value * scale) / scale; }
function createId(prefix) { return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 9); }
function buildSequence(mode) { if (mode !== "mixed") return Array(64).fill(mode); return [].concat.apply([], TASK_MODES.map((item) => Array(64).fill(item))); }
function createTrial(mode, level, sessionId, trialNumber) {
  const layoutAngle = Math.random() < 0.5 ? 0 : 90;
  const common = { id: createId("trial"), sessionId, trialNumber, mode, modeLabel: MODE_INFO[mode].label, levelBefore: round(level), layoutAngle, angle: layoutAngle === 90 ? 0 : 90, phase: Math.random() * Math.PI * 2, background: 158, sigma: 23, frequency: 0.047, createdAt: new Date().toISOString() };
  if (mode === "single") return Object.assign(common, { correctAnswer: Math.random() < .5 ? "1" : "2", contrast: level });
  if (mode === "triple") return Object.assign(common, { correctAnswer: Math.random() < .5 ? "1" : "2", targetContrast: level, flankerContrast: .46, spacing: 132 });
  if (mode === "darker") { const base = .18; return Object.assign(common, { correctAnswer: Math.random() < .5 ? "1" : "2", contrastDelta: level, clearerContrast: clamp(base + level / 2, .03, .55), faintContrast: clamp(base - level / 2, .025, .5) }); }
  const sign = Math.random() < .5 ? -1 : 1;
  const correctAnswer = layoutAngle === 90 ? (sign > 0 ? "left" : "right") : (sign > 0 ? "down" : "up");
  return Object.assign(common, { correctAnswer, offset: level, offsetSigned: sign * level, spacing: 132, contrast: .29 });
}
function adaptLevel(mode, current, correct, streak) {
  let nextStreak = correct ? streak + 1 : 0, value = current;
  if (correct && nextStreak >= 2) { value *= mode === "shifted" ? .82 : .84; nextStreak = 0; }
  if (!correct) value *= mode === "shifted" ? 1.24 : 1.20;
  const bounds = LEVEL_BOUNDS[mode]; return { value: clamp(value, bounds[0], bounds[1]), streak: nextStreak };
}
function formatLevel(mode, value) {
  if (value == null) return "—";
  if (mode === "shifted") return round(value, 1) + " px";
  if (mode === "darker") return "Δ " + Number(value).toFixed(3);
  const percent = value * 100; return percent.toFixed(percent < 1 ? 2 : 1) + "%";
}
function difficultyStage(mode, value) {
  const multiplier = mode === "shifted" ? .82 : .84;
  if (!Number.isFinite(Number(value)) || Number(value) <= 0) return 0;
  return Math.max(0, Math.log(INITIAL_LEVELS[mode] / Number(value)) / Math.log(1 / multiplier));
}
function answerLabel(value) { return ({ "1": "第一帧", "2": "第二帧", left: "向左", right: "向右", up: "向上", down: "向下" })[value] || "—"; }
module.exports = { MODE_INFO, TASK_MODES, INITIAL_LEVELS, LEVEL_BOUNDS, TIMING, round, createId, buildSequence, createTrial, adaptLevel, formatLevel, difficultyStage, answerLabel };
