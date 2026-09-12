import { createId, saveVisionTest, saveVisionTestTrial } from "./db.js";

export const TEST_INFO = {
  size: {
    label: "大小测试",
    description: "辨认单个 C 的缺口方向；连续两次正确后缩小，连续两次错误后放大。",
    metric: "size",
    crowded: false,
  },
  contrast: {
    label: "深浅测试",
    description: "C 的大小保持不变，通过改变它与背景的对比度测量最浅可辨水平。",
    metric: "contrast",
    crowded: false,
  },
  "crowded-size": {
    label: "拥挤大小测试",
    description: "每只眼先测单 C 基线，再测 5×5 矩阵中心 C，计算拥挤造成的尺寸损失。",
    metric: "size",
    crowded: true,
  },
  "crowded-contrast": {
    label: "拥挤深浅测试",
    description: "每只眼先测单 C 基线，再在 5×5 矩阵中测中心 C 的对比度阈值。",
    metric: "contrast",
    crowded: true,
  },
};

const EYES = [
  { id: "left", label: "左眼", instruction: "请轻遮右眼，仅用左眼观看" },
  { id: "right", label: "右眼", instruction: "请轻遮左眼，仅用右眼观看" },
  { id: "both", label: "双眼", instruction: "请移开遮盖，双眼同时观看" },
];
const DIRECTIONS = ["up", "up-right", "right", "down-right", "down", "down-left", "left", "up-left"];
const DIRECTION_ANGLES = {
  right: 0,
  "down-right": Math.PI / 4,
  down: Math.PI / 2,
  "down-left": Math.PI * 3 / 4,
  left: Math.PI,
  "up-left": Math.PI * 5 / 4,
  up: Math.PI * 3 / 2,
  "up-right": Math.PI * 7 / 4,
};
const STAIRCASE_STEPS = [0.45, 0.28, 0.16, 0.09, 0.05, 0.025];
const CONFIG = {
  size: { initial: 64, minimum: 4, maximum: 160, fixedContrast: 0.82, fixedSize: 48 },
  contrast: { initial: 0.34, minimum: 0.008, maximum: 0.92, fixedContrast: 0.82, fixedSize: 48 },
};
const BACKGROUND = 158;

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function round(value, decimals = 3) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function geometricMean(values) {
  if (!values.length) return null;
  return Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
}

function formatValue(metric, value) {
  if (!Number.isFinite(Number(value))) return "—";
  return metric === "size" ? `${round(Number(value), 1)} px` : `${round(Number(value) * 100, 2)}%`;
}

function randomDirection(excluded) {
  const available = excluded ? DIRECTIONS.filter((direction) => direction !== excluded) : DIRECTIONS;
  return available[Math.floor(Math.random() * available.length)];
}

export class VisualTestController {
  constructor({ onToast, onTestChanged } = {}) {
    this.onToast = onToast || (() => {});
    this.onTestChanged = onTestChanged || (() => {});
    this.selectedMode = "size";
    this.state = "idle";
    this.session = null;
    this.eyeIndex = 0;
    this.blockIndex = 0;
    this.staircase = null;
    this.currentDirection = null;
    this.trialStartedAt = 0;
    this.runToken = 0;
    this.focusModeActive = false;
    this.elements = {
      cards: [...document.querySelectorAll("[data-test-mode]")],
      explanation: document.querySelector("#testModeExplanation"),
      start: document.querySelector("#startTestButton"),
      runner: document.querySelector("#testRunnerPanel"),
      stage: document.querySelector("#testStage"),
      canvas: document.querySelector("#testCanvas"),
      message: document.querySelector("#testStageMessage"),
      feedback: document.querySelector("#testFeedback"),
      pad: document.querySelector("#testDirectionPad"),
      padButtons: [...document.querySelectorAll("#testDirectionPad button")],
      status: document.querySelector("#testStatus"),
      live: document.querySelector("#testLiveIndicator"),
      label: document.querySelector("#activeTestLabel"),
      eye: document.querySelector("#testEyeText"),
      trial: document.querySelector("#testTrialText"),
      level: document.querySelector("#testLevelText"),
      progress: document.querySelector("#testProgressBar"),
      prompt: document.querySelector("#testResponsePrompt"),
    };
    this.bindEvents();
    this.drawBlank();
    this.setAnswersEnabled(false);
  }

  bindEvents() {
    this.elements.cards.forEach((card) => card.addEventListener("click", () => this.selectMode(card.dataset.testMode)));
    this.elements.start.addEventListener("click", () => this.start());
    this.elements.stage.addEventListener("click", () => {
      if (this.state === "phase-ready") this.beginPhase();
    });
    this.elements.pad.addEventListener("click", (event) => {
      const button = event.target.closest("[data-direction]");
      if (button && this.state === "awaiting-response") this.answer(button.dataset.direction);
    });
    window.addEventListener("keydown", (event) => this.handleKey(event));
    document.addEventListener("fullscreenchange", () => {
      if (this.focusModeActive && !document.fullscreenElement && this.isRunning()) this.abort("fullscreen_exit");
    });
    window.addEventListener("resize", () => {
      if (this.state === "awaiting-response") this.drawStimulus();
      else this.drawBlank();
    });
  }

  handleKey(event) {
    if (event.key === "Escape" && this.isRunning()) {
      event.preventDefault();
      this.abort("escape");
      return;
    }
    if (this.state !== "awaiting-response") return;
    const keyMap = {
      ArrowUp: "up", ArrowRight: "right", ArrowDown: "down", ArrowLeft: "left",
      "8": "up", "9": "up-right", "6": "right", "3": "down-right",
      "2": "down", "1": "down-left", "4": "left", "7": "up-left",
    };
    const direction = keyMap[event.key];
    if (!direction) return;
    event.preventDefault();
    this.answer(direction);
  }

  selectMode(mode) {
    if (this.isRunning() || !TEST_INFO[mode]) return;
    this.selectedMode = mode;
    const info = TEST_INFO[mode];
    this.elements.cards.forEach((card) => {
      const selected = card.dataset.testMode === mode;
      card.classList.toggle("selected", selected);
      card.setAttribute("aria-checked", String(selected));
    });
    this.elements.label.textContent = info.label;
    this.elements.explanation.querySelector("strong").textContent = info.label;
    this.elements.explanation.querySelector("p").textContent = info.description;
  }

  isRunning() {
    return !["idle", "completed", "aborted"].includes(this.state);
  }

  async start() {
    if (this.isRunning()) return;
    this.runToken += 1;
    this.state = "starting";
    this.eyeIndex = 0;
    this.blockIndex = 0;
    const now = new Date().toISOString();
    this.session = {
      id: createId("vision-test"),
      userId: "local-user",
      mode: this.selectedMode,
      modeLabel: TEST_INFO[this.selectedMode].label,
      metric: TEST_INFO[this.selectedMode].metric,
      crowded: TEST_INFO[this.selectedMode].crowded,
      eyeOrder: EYES.map((eye) => eye.id),
      results: {},
      totalTrials: 0,
      startedAt: now,
      endedAt: null,
      durationMs: 0,
      status: "in_progress",
      unit: TEST_INFO[this.selectedMode].metric === "size" ? "css-px" : "contrast-ratio",
      schemaVersion: 1,
    };
    this.enterFocusMode();
    try {
      await saveVisionTest(this.session);
    } catch (error) {
      this.state = "idle";
      await this.leaveFocusMode();
      this.onToast(`无法创建视觉测试记录：${error.message}`, "error");
      return;
    }
    this.elements.cards.forEach((card) => { card.disabled = true; });
    this.elements.start.disabled = true;
    this.elements.start.querySelector("span").textContent = "测试进行中";
    this.elements.live.classList.add("running");
    this.onTestChanged();
    this.preparePhase();
  }

  currentBlocks() {
    return TEST_INFO[this.selectedMode].crowded ? ["isolated", "crowded"] : ["isolated"];
  }

  preparePhase() {
    const eye = EYES[this.eyeIndex];
    const block = this.currentBlocks()[this.blockIndex];
    this.state = "phase-ready";
    this.staircase = null;
    this.setAnswersEnabled(false);
    this.drawBlank();
    this.elements.eye.textContent = eye.label;
    this.elements.trial.textContent = "0";
    this.elements.level.textContent = "—";
    this.elements.status.textContent = "阶段准备";
    this.elements.prompt.textContent = "阅读屏幕提示，准备好后点击灰色区域";
    this.elements.message.classList.remove("hidden");
    this.elements.message.querySelector("h3").textContent = `${eye.label}${block === "crowded" ? " · 5×5 拥挤" : " · 单 C 基线"}`;
    this.elements.message.querySelector("p").textContent = `${eye.instruction}。保持观看距离，准备好后点击灰色区域开始。`;
    this.updateProgress();
  }

  beginPhase() {
    if (this.state !== "phase-ready") return;
    const metric = TEST_INFO[this.selectedMode].metric;
    this.staircase = {
      metric,
      level: CONFIG[metric].initial,
      correctStreak: 0,
      incorrectStreak: 0,
      trialCount: 0,
      reversals: [],
      reversalCount: 0,
      stepIndex: 0,
      lastMove: 0,
      bestConfirmed: null,
      boundaryHits: 0,
    };
    if (this.selectedMode === "crowded-size" && metric === "size") {
      const canvasRect = this.elements.canvas.getBoundingClientRect();
      const displayLimit = Math.floor(Math.min(canvasRect.width || 960, canvasRect.height || 540) / 6.5);
      this.staircase.maximum = clamp(displayLimit, 28, 80);
      this.staircase.level = Math.min(56, this.staircase.maximum);
    }
    this.elements.message.classList.add("hidden");
    this.elements.status.textContent = "测试中";
    this.elements.prompt.textContent = "请选择中心 C 的缺口方向";
    this.presentTrial();
  }

  presentTrial() {
    if (!this.staircase) return;
    this.currentDirection = randomDirection(this.currentDirection);
    this.staircase.trialCount += 1;
    this.trialStartedAt = performance.now();
    this.state = "awaiting-response";
    this.elements.trial.textContent = String(this.staircase.trialCount);
    this.elements.level.textContent = formatValue(this.staircase.metric, this.staircase.level);
    this.setAnswersEnabled(true);
    this.drawStimulus();
  }

  async answer(direction) {
    if (this.state !== "awaiting-response") return;
    this.state = "processing";
    this.setAnswersEnabled(false);
    const token = this.runToken;
    const before = this.staircase.level;
    const correct = direction === this.currentDirection;
    const reactionTimeMs = Math.round(performance.now() - this.trialStartedAt);
    const move = this.updateStaircase(correct);
    const eye = EYES[this.eyeIndex];
    const block = this.currentBlocks()[this.blockIndex];
    const trial = {
      id: createId("vision-test-trial"),
      testId: this.session.id,
      mode: this.selectedMode,
      metric: this.staircase.metric,
      eye: eye.id,
      block,
      trialNumber: this.staircase.trialCount,
      direction: this.currentDirection,
      answer: direction,
      correct,
      levelBefore: round(before, 5),
      levelAfter: round(this.staircase.level, 5),
      reversalCount: this.staircase.reversalCount,
      stepIndex: this.staircase.stepIndex,
      reactionTimeMs,
      createdAt: new Date().toISOString(),
    };
    this.session.totalTrials += 1;
    try {
      await saveVisionTestTrial(trial);
    } catch (error) {
      this.onToast(`保存测试试次失败：${error.message}`, "error");
    }
    if (token !== this.runToken) return;
    this.showFeedback(correct);
    await new Promise((resolve) => setTimeout(resolve, 230));
    if (token !== this.runToken) return;
    this.hideFeedback();
    if (this.shouldFinishPhase()) await this.finishPhase();
    else this.presentTrial(move);
  }

  updateStaircase(correct) {
    const staircase = this.staircase;
    let move = 0;
    if (correct) {
      staircase.correctStreak += 1;
      staircase.incorrectStreak = 0;
      if (staircase.correctStreak >= 2) {
        staircase.bestConfirmed = staircase.bestConfirmed == null
          ? staircase.level
          : Math.min(staircase.bestConfirmed, staircase.level);
        staircase.correctStreak = 0;
        move = -1;
      }
    } else {
      staircase.correctStreak = 0;
      staircase.incorrectStreak += 1;
      if (staircase.incorrectStreak >= 2) {
        staircase.incorrectStreak = 0;
        move = 1;
      }
    }
    if (!move) return 0;
    if (staircase.lastMove && move !== staircase.lastMove) {
      staircase.reversalCount += 1;
      staircase.reversals.push(staircase.level);
      staircase.stepIndex = Math.min(STAIRCASE_STEPS.length - 1, staircase.reversalCount);
    }
    staircase.lastMove = move;
    const config = CONFIG[staircase.metric];
    const maximum = staircase.maximum || config.maximum;
    const next = clamp(staircase.level * Math.exp(move * STAIRCASE_STEPS[staircase.stepIndex]), config.minimum, maximum);
    staircase.boundaryHits = next === staircase.level ? staircase.boundaryHits + 1 : 0;
    staircase.level = next;
    return move;
  }

  shouldFinishPhase() {
    const staircase = this.staircase;
    return (staircase.trialCount >= 16 && staircase.reversalCount >= 6)
      || staircase.trialCount >= 34
      || staircase.boundaryHits >= 3;
  }

  async finishPhase() {
    const eye = EYES[this.eyeIndex];
    const block = this.currentBlocks()[this.blockIndex];
    const finalReversals = this.staircase.reversals.slice(-6);
    const estimatedThreshold = geometricMean(finalReversals) || this.staircase.level;
    const minimumConfirmed = this.staircase.bestConfirmed ?? estimatedThreshold;
    const result = {
      threshold: round(estimatedThreshold, 4),
      minimumConfirmed: round(minimumConfirmed, 4),
      trials: this.staircase.trialCount,
      reversals: this.staircase.reversalCount,
    };
    if (!this.session.results[eye.id]) this.session.results[eye.id] = {};
    this.session.results[eye.id][block] = result;

    if (TEST_INFO[this.selectedMode].crowded && block === "crowded") {
      const baseline = this.session.results[eye.id].isolated.threshold;
      const crowded = result.threshold;
      this.session.results[eye.id].crowdingLossPercent = round((crowded / baseline - 1) * 100, 1);
    }
    try { await saveVisionTest(this.session); } catch { /* A final save is attempted again at completion. */ }

    this.blockIndex += 1;
    if (this.blockIndex >= this.currentBlocks().length) {
      this.blockIndex = 0;
      this.eyeIndex += 1;
    }
    if (this.eyeIndex >= EYES.length) await this.complete();
    else this.preparePhase();
  }

  async complete() {
    this.state = "completed";
    const endedAt = new Date().toISOString();
    this.session.status = "completed";
    this.session.endedAt = endedAt;
    this.session.durationMs = new Date(endedAt) - new Date(this.session.startedAt);
    try { await saveVisionTest(this.session); } catch (error) { this.onToast(`保存测试结果失败：${error.message}`, "error"); }
    this.onTestChanged();
    await this.leaveFocusMode();
    this.unlockSetup();
    this.setAnswersEnabled(false);
    this.elements.live.classList.remove("running");
    this.elements.status.textContent = "测试完成";
    this.elements.progress.style.width = "100%";
    this.elements.message.classList.remove("hidden");
    this.elements.message.querySelector("h3").textContent = "三种眼别测试完成";
    this.elements.message.querySelector("p").textContent = this.buildCompletionSummary();
    this.elements.prompt.textContent = "结果已保存到训练数据页面";
    this.drawBlank();
    this.onToast("视觉测试已完成并保存", "success");
  }

  buildCompletionSummary() {
    const info = TEST_INFO[this.selectedMode];
    return EYES.map((eye) => {
      const result = this.session.results[eye.id];
      if (!result) return `${eye.label} —`;
      if (info.crowded) {
        return `${eye.label}：单 C ${formatValue(info.metric, result.isolated.threshold)}，拥挤 ${formatValue(info.metric, result.crowded.threshold)}，损失 ${result.crowdingLossPercent > 0 ? "+" : ""}${result.crowdingLossPercent}%`;
      }
      return `${eye.label} ${formatValue(info.metric, result.isolated.threshold)}`;
    }).join("；");
  }

  async abort(reason = "manual") {
    if (!this.isRunning()) return;
    this.runToken += 1;
    this.state = "aborted";
    if (this.session) {
      const endedAt = new Date().toISOString();
      this.session.status = "aborted";
      this.session.abortReason = reason;
      this.session.endedAt = endedAt;
      this.session.durationMs = new Date(endedAt) - new Date(this.session.startedAt);
      try { await saveVisionTest(this.session); } catch { /* Keep UI recoverable if storage fails. */ }
    }
    this.onTestChanged();
    await this.leaveFocusMode();
    this.unlockSetup();
    this.setAnswersEnabled(false);
    this.elements.live.classList.remove("running");
    this.elements.status.textContent = "测试已结束";
    this.elements.message.classList.remove("hidden");
    this.elements.message.querySelector("h3").textContent = "测试已提前结束";
    this.elements.message.querySelector("p").textContent = "已完成的阶段仍会保存在视觉测试记录中。";
    this.drawBlank();
  }

  unlockSetup() {
    this.elements.cards.forEach((card) => { card.disabled = false; });
    this.elements.start.disabled = false;
    this.elements.start.querySelector("span").textContent = this.state === "completed" ? "再测试一次" : "重新开始测试";
  }

  enterFocusMode() {
    this.focusModeActive = true;
    document.body.classList.add("testing-focus");
    if (!document.fullscreenElement) this.elements.runner.requestFullscreen?.().catch(() => {});
  }

  async leaveFocusMode() {
    this.focusModeActive = false;
    document.body.classList.remove("testing-focus");
    if (document.fullscreenElement) {
      try { await document.exitFullscreen(); } catch { /* CSS focus mode is still restored. */ }
    }
  }

  updateProgress() {
    const blocks = this.currentBlocks().length;
    const completedUnits = this.eyeIndex * blocks + this.blockIndex;
    this.elements.progress.style.width = `${completedUnits / (EYES.length * blocks) * 100}%`;
  }

  setAnswersEnabled(enabled) {
    this.elements.padButtons.forEach((button) => { button.disabled = !enabled; });
  }

  showFeedback(correct) {
    this.elements.feedback.textContent = correct ? "正确" : "方向不对";
    this.elements.feedback.className = `feedback-flash show ${correct ? "correct" : "incorrect"}`;
  }

  hideFeedback() {
    this.elements.feedback.className = "feedback-flash";
  }

  resizeCanvas() {
    const canvas = this.elements.canvas;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, Math.round(rect.width || 960));
    const height = Math.max(240, Math.round(rect.height || 540));
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const context = canvas.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { context, width, height };
  }

  drawBlank() {
    const { context, width, height } = this.resizeCanvas();
    context.fillStyle = `rgb(${BACKGROUND},${BACKGROUND},${BACKGROUND})`;
    context.fillRect(0, 0, width, height);
  }

  drawLandolt(context, x, y, size, contrast, direction) {
    const stroke = Math.max(1, size / 5);
    const radius = Math.max(stroke, size / 2 - stroke / 2);
    const halfGap = Math.asin(Math.min(0.9, (stroke / 2) / radius));
    const gapAngle = DIRECTION_ANGLES[direction];
    const shade = Math.round(BACKGROUND * (1 - clamp(contrast, 0, 1)));
    context.beginPath();
    context.arc(x, y, radius, gapAngle + halfGap, gapAngle + Math.PI * 2 - halfGap);
    context.strokeStyle = `rgb(${shade},${shade},${shade})`;
    context.lineWidth = stroke;
    context.lineCap = "butt";
    context.stroke();
  }

  drawStimulus() {
    const { context, width, height } = this.resizeCanvas();
    context.fillStyle = `rgb(${BACKGROUND},${BACKGROUND},${BACKGROUND})`;
    context.fillRect(0, 0, width, height);
    const metric = this.staircase.metric;
    const crowded = this.currentBlocks()[this.blockIndex] === "crowded";
    const level = this.staircase.level;
    const crowdedFixedSize = Math.min(CONFIG.contrast.fixedSize, Math.min(width, height) / 6.5);
    const size = metric === "size"
      ? level
      : TEST_INFO[this.selectedMode].crowded ? crowdedFixedSize : CONFIG.contrast.fixedSize;
    const contrast = metric === "contrast" ? level : CONFIG.size.fixedContrast;
    const centerX = width / 2;
    const centerY = height / 2;

    if (!crowded) {
      this.drawLandolt(context, centerX, centerY, size, contrast, this.currentDirection);
      return;
    }

    const spacing = size * 1.36;
    for (let row = -2; row <= 2; row += 1) {
      for (let column = -2; column <= 2; column += 1) {
        const target = row === 0 && column === 0;
        const itemDirection = target ? this.currentDirection : randomDirection();
        const itemContrast = target ? contrast : 0.78;
        this.drawLandolt(context, centerX + column * spacing, centerY + row * spacing, size, itemContrast, itemDirection);
      }
    }
  }
}
