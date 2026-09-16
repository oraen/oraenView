import * as desktopStorage from "./db.js";
import { createId } from "./db.js";
import { drawBlank, drawFrameBorder, drawShifted, drawSingle, drawTriple } from "./gabor.js";

export const MODE_INFO = {
  mixed: { label: "综合训练", description: "单图、三图、清晰图、移图按固定顺序分段进行，每种分别完成所选训练长度。" },
  single: { label: "单图训练", description: "两帧中仅一帧出现低对比度 Gabor，判断目标出现的时间位置。" },
  triple: { label: "三图训练", description: "两帧均有侧翼，判断哪一帧额外出现低对比度中间目标。" },
  darker: { label: "清晰图训练", description: "两帧各出现一个 Gabor，判断哪一帧的图像对比更清晰。" },
  shifted: { label: "移图训练", description: "观察三个 Gabor，判断中间目标相对两侧参照的轻微偏移方向。" },
};

const TASK_MODES = ["single", "triple", "darker", "shifted"];
export const STIMULUS_ORIENTATIONS = [0, 45, 90, 135];
const BACKGROUND = 158;
const BASE_STIMULUS = { background: BACKGROUND, sigma: 23, frequency: 0.047 };
const TIMING = { fixation: 650, interval: 430, gap: 330, shifted: 560, feedback: 520 };
const ATTENTION_REMINDER_AFTER = 3;
const ATTENTION_REMINDER_DURATION = 1400;

export const INITIAL_LEVELS = { single: 0.24, triple: 0.19, darker: 0.10, shifted: 19 };

export const LEVEL_BOUNDS = {
  single: [0.0005, 0.55],
  triple: [0.0004, 0.48],
  darker: [0.002, 0.24],
  shifted: [0.5, 42],
};

const EXPERIENCE_LEVEL_CONFIG = {
  single: { label: "目标对比度", unit: "%", step: 0.01, scale: 100 },
  triple: { label: "中心目标对比度", unit: "%", step: 0.01, scale: 100 },
  darker: { label: "两帧对比差", unit: "Δ", step: 0.001, scale: 1 },
  shifted: { label: "中心偏移量", unit: "px", step: 0.1, scale: 1 },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round(value, decimals = 4) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function formatLevel(mode, value) {
  if (mode === "shifted") return `${round(value, 1)} px`;
  if (mode === "darker") return `Δ ${round(value, 3)}`;
  const percentage = value * 100;
  return `${round(percentage, percentage < 1 ? 2 : 1)}%`;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class TrainingController {
  constructor({ onToast, onSessionChanged, storage = desktopStorage, elements } = {}) {
    this.storage = storage;
    this.onToast = onToast || (() => {});
    this.onSessionChanged = onSessionChanged || (() => {});
    this.selectedMode = "mixed";
    this.sessionType = "training";
    this.totalTrials = 64;
    this.experienceLevels = { ...INITIAL_LEVELS };
    this.experienceTrialCounts = Object.fromEntries(TASK_MODES.map((mode) => [mode, 16]));
    this.fixedExperienceLevel = null;
    this.session = null;
    this.trials = [];
    this.trialSequence = [];
    this.currentTrial = null;
    this.currentTrialIndex = 0;
    this.correctCount = 0;
    this.state = "idle";
    this.runToken = 0;
    this.focusModeActive = false;
    this.levels = {};
    this.persistedLevels = {};
    this.inheritedModes = [];
    this.correctStreaks = {};
    this.incorrectStreak = 0;
    this.frameBorderThickness = 2;

    this.elements = elements || {
      modeGrid: document.querySelector("#modeGrid"),
      modeCards: [...document.querySelectorAll("#modeGrid .mode-card")],
      sessionTypeButtons: [...document.querySelectorAll("[data-session-type]")],
      sessionTypeHelp: document.querySelector("#sessionTypeHelp"),
      trainingLengthGroup: document.querySelector("#trainingLengthGroup"),
      trialCount: document.querySelector("#trialCount"),
      trialCountValue: document.querySelector("#trialCountValue"),
      experienceSettings: document.querySelector("#experienceSettings"),
      experienceDifficulty: document.querySelector("#experienceDifficulty"),
      experienceDifficultyUnit: document.querySelector("#experienceDifficultyUnit"),
      experienceDifficultyHelp: document.querySelector("#experienceDifficultyHelp"),
      experienceTrialCount: document.querySelector("#experienceTrialCount"),
      modeExplanation: document.querySelector("#modeExplanation"),
      startButton: document.querySelector("#startTrainingButton"),
      trainerPanel: document.querySelector("#trainerPanel"),
      canvas: document.querySelector("#stimulusCanvas"),
      stageMessage: document.querySelector("#stageMessage"),
      fixation: document.querySelector("#fixation"),
      intervalLabel: document.querySelector("#intervalLabel"),
      feedbackFlash: document.querySelector("#feedbackFlash"),
      responsePrompt: document.querySelector("#responsePrompt"),
      temporalButtons: document.querySelector("#temporalButtons"),
      responseButtons: [...document.querySelectorAll("#trainerPanel .response-buttons button")],
      status: document.querySelector("#trainerStatus"),
      liveIndicator: document.querySelector("#trainerPanel .live-indicator"),
      activeModeLabel: document.querySelector("#activeModeLabel"),
      progressText: document.querySelector("#trialProgressText"),
      correctText: document.querySelector("#correctCountText"),
      thresholdText: document.querySelector("#thresholdText"),
      progressBar: document.querySelector("#trainingProgressBar"),
    };

    this.bindEvents();
    this.resetStage();
  }

  bindEvents() {
    this.elements.modeCards.forEach((card) => {
      card.addEventListener("click", () => this.selectMode(card.dataset.mode));
    });

    this.elements.sessionTypeButtons.forEach((button) => {
      button.addEventListener("click", () => this.selectSessionType(button.dataset.sessionType));
    });

    this.elements.trialCount.addEventListener("input", () => {
      this.refreshPlannedTrialCount();
    });

    this.elements.experienceDifficulty.addEventListener("input", () => {
      const config = EXPERIENCE_LEVEL_CONFIG[this.selectedMode];
      const displayValue = Number(this.elements.experienceDifficulty.value);
      if (config && Number.isFinite(displayValue)) {
        this.experienceLevels[this.selectedMode] = displayValue / config.scale;
      }
    });

    this.elements.experienceTrialCount.addEventListener("input", () => {
      const count = Number(this.elements.experienceTrialCount.value);
      if (!TASK_MODES.includes(this.selectedMode) || !Number.isInteger(count) || count < 1 || count > 96) return;
      this.experienceTrialCounts[this.selectedMode] = count;
      this.refreshPlannedTrialCount();
    });

    this.elements.startButton.addEventListener("click", () => this.prepareSession());

    this.elements.trainerPanel.addEventListener("mousedown", (event) => {
      if (this.state === "ready" && event.button === 0) {
        event.preventDefault();
        this.beginPreparedSession();
        return;
      }
      if (this.state !== "awaiting-response") return;
      const answer = this.mouseAnswerForTrial(event.button);
      if (!answer) return;
      event.preventDefault();
      this.handleAnswer(answer);
    });

    this.elements.trainerPanel.addEventListener("contextmenu", (event) => {
      if (this.isRunning()) event.preventDefault();
    });

    window.addEventListener("mousedown", (event) => {
      if (event.button !== 1 || this.state !== "completed") return;
      event.preventDefault();
      this.prepareSession();
    });

    document.addEventListener("fullscreenchange", () => {
      if (this.focusModeActive && !document.fullscreenElement && this.isRunning()) {
        this.abortSession("fullscreen_exit");
      }
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.isRunning()) {
        event.preventDefault();
        this.abortSession("escape");
        return;
      }
      if (this.state !== "awaiting-response") return;
      const answerMap = { "1": "1", "2": "2", ArrowLeft: "left", ArrowRight: "right", ArrowUp: "up", ArrowDown: "down" };
      const answer = answerMap[event.key];
      if (!answer || !this.currentTrial.validAnswers.includes(answer)) return;
      event.preventDefault();
      this.handleAnswer(answer);
    });
  }

  selectMode(mode) {
    if (this.isRunning()) return;
    this.selectedMode = mode;
    if (mode === "mixed" && this.sessionType === "experience") {
      this.selectSessionType("training");
    }
    this.elements.modeCards.forEach((card) => {
      const selected = card.dataset.mode === mode;
      card.classList.toggle("selected", selected);
      card.setAttribute("aria-checked", String(selected));
    });
    this.elements.activeModeLabel.textContent = MODE_INFO[mode].label;
    this.elements.modeExplanation.querySelector("strong").textContent = MODE_INFO[mode].label;
    this.elements.modeExplanation.querySelector("p").textContent = MODE_INFO[mode].description;
    this.updateSessionTypeControls();
    this.refreshPlannedTrialCount();
    this.showResponseControls(mode);
  }

  selectSessionType(type) {
    if (this.isRunning() || !["training", "experience"].includes(type)) return;
    if (type === "experience" && !TASK_MODES.includes(this.selectedMode)) {
      this.onToast("请先选择单图、三图、清晰图或移图训练");
      return;
    }
    this.sessionType = type;
    this.updateSessionTypeControls();
    this.refreshPlannedTrialCount();
    if (this.state === "completed") {
      this.elements.startButton.querySelector("span").textContent = type === "experience" ? "再体验一次" : "再训练一次";
    } else if (["idle", "aborted"].includes(this.state)) {
      this.elements.startButton.querySelector("span").textContent = type === "experience" ? "开始体验" : "开始本次训练";
    }
  }

  updateSessionTypeControls() {
    const experienceAvailable = TASK_MODES.includes(this.selectedMode);
    this.elements.sessionTypeButtons.forEach((button) => {
      const selected = button.dataset.sessionType === this.sessionType;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", String(selected));
      button.disabled = Boolean(this.setupLocked) || (button.dataset.sessionType === "experience" && !experienceAvailable);
    });
    const experienceActive = this.sessionType === "experience" && experienceAvailable;
    const activeLabel = MODE_INFO[this.selectedMode].label;
    this.elements.activeModeLabel.textContent = `${activeLabel}${experienceActive ? " · 体验" : ""}`;
    this.elements.modeExplanation.querySelector("strong").textContent = `${activeLabel}${experienceActive ? "（体验）" : ""}`;
    this.elements.trainingLengthGroup.classList.toggle("hidden", experienceActive);
    this.elements.experienceSettings.classList.toggle("hidden", !experienceActive);
    this.elements.sessionTypeHelp.textContent = experienceAvailable
      ? "体验模式使用固定难度，记录会保留，但不改变累计难度和正式训练统计。"
      : "请先选择一个单项训练后再开启体验模式；综合训练保持正式自适应。";
    if (experienceActive) this.updateExperienceControls();
  }

  updateExperienceControls() {
    const config = EXPERIENCE_LEVEL_CONFIG[this.selectedMode];
    if (!config) return;
    const [minimum, maximum] = LEVEL_BOUNDS[this.selectedMode].map((value) => round(value * config.scale, 4));
    const defaultValue = round(INITIAL_LEVELS[this.selectedMode] * config.scale, 4);
    const currentValue = round(this.experienceLevels[this.selectedMode] * config.scale, 4);
    this.elements.experienceDifficulty.min = String(minimum);
    this.elements.experienceDifficulty.max = String(maximum);
    this.elements.experienceDifficulty.step = String(config.step);
    this.elements.experienceDifficulty.value = String(currentValue);
    this.elements.experienceDifficultyUnit.textContent = config.unit;
    this.elements.experienceTrialCount.value = String(this.experienceTrialCounts[this.selectedMode]);
    this.elements.experienceDifficulty.disabled = Boolean(this.setupLocked);
    this.elements.experienceTrialCount.disabled = Boolean(this.setupLocked);
    this.elements.experienceDifficultyHelp.textContent = `${config.label}可设为 ${minimum}${config.unit}～${maximum}${config.unit}，默认 ${defaultValue}${config.unit}；整场保持不变。`;
  }

  validateExperienceSettings() {
    if (this.sessionType !== "experience") {
      this.fixedExperienceLevel = null;
      this.refreshPlannedTrialCount();
      return true;
    }
    const config = EXPERIENCE_LEVEL_CONFIG[this.selectedMode];
    const displayLevel = Number(this.elements.experienceDifficulty.value);
    const trialCount = Number(this.elements.experienceTrialCount.value);
    if (!config || !Number.isFinite(displayLevel)) {
      this.onToast("请输入有效的体验难度", "error");
      this.elements.experienceDifficulty.focus();
      return false;
    }
    const level = displayLevel / config.scale;
    const [minimum, maximum] = LEVEL_BOUNDS[this.selectedMode];
    if (level < minimum || level > maximum) {
      this.onToast(`体验难度需要在 ${round(minimum * config.scale, 4)}${config.unit}～${round(maximum * config.scale, 4)}${config.unit} 之间`, "error");
      this.elements.experienceDifficulty.focus();
      return false;
    }
    if (!Number.isInteger(trialCount) || trialCount < 1 || trialCount > 96) {
      this.onToast("体验次数需要是 1～96 之间的整数", "error");
      this.elements.experienceTrialCount.focus();
      return false;
    }
    this.fixedExperienceLevel = level;
    this.experienceLevels[this.selectedMode] = level;
    this.experienceTrialCounts[this.selectedMode] = trialCount;
    this.refreshPlannedTrialCount();
    return true;
  }

  isRunning() {
    return !["idle", "completed", "aborted"].includes(this.state);
  }

  mouseAnswerForTrial(mouseButton) {
    if (mouseButton !== 0 && mouseButton !== 2) return null;
    if (this.currentTrial?.mode !== "shifted") return mouseButton === 0 ? "1" : "2";
    const verticalLayout = this.currentTrial.layoutAngle === 90;
    if (mouseButton === 0) return verticalLayout ? "left" : "up";
    return verticalLayout ? "right" : "down";
  }

  configuredTrialCount() {
    if (this.sessionType === "experience") return this.experienceTrialCounts[this.selectedMode];
    return Number(this.elements.trialCount.value);
  }

  refreshPlannedTrialCount() {
    const configuredCount = this.configuredTrialCount();
    this.totalTrials = this.selectedMode === "mixed" ? configuredCount * TASK_MODES.length : configuredCount;
    this.elements.trialCountValue.textContent = this.selectedMode === "mixed"
      ? `每种 ${configuredCount} 次 · 共 ${this.totalTrials} 次`
      : `${configuredCount} 试次`;
    this.updateMetrics();
  }

  buildSequence() {
    const configuredCount = this.configuredTrialCount();
    if (this.selectedMode !== "mixed") return Array(configuredCount).fill(this.selectedMode);
    return TASK_MODES.flatMap((mode) => Array(configuredCount).fill(mode));
  }

  async prepareSession() {
    if (this.isRunning()) return;
    if (!this.validateExperienceSettings()) return;
    this.runToken += 1;
    const token = this.runToken;
    this.state = "preparing";
    this.session = null;
    this.currentTrial = null;
    this.showResponseControls(this.selectedMode);
    this.enterFocusMode();
    this.trials = [];
    this.currentTrialIndex = 0;
    this.correctCount = 0;
    this.trialSequence = this.buildSequence();
    this.incorrectStreak = 0;
    this.totalTrials = this.trialSequence.length;
    this.lockSetup(true);
    this.elements.startButton.querySelector("span").textContent = this.sessionType === "experience" ? "正在准备体验" : "正在准备";
    this.elements.stageMessage.classList.remove("hidden");
    this.elements.stageMessage.querySelector("h3").textContent = "正在进入预备模式";
    this.elements.stageMessage.querySelector("p").textContent = "请保持约 1.5 米观看距离，准备好后按鼠标左键开始。";
    this.elements.status.textContent = "正在准备";
    this.elements.responsePrompt.textContent = "进入预备模式后，按鼠标左键正式开始";
    this.elements.liveIndicator.classList.remove("running");
    this.setResponseEnabled(false);
    this.showFixation(false);
    this.showIntervalLabel("");
    this.hideFeedback();
    drawBlank(this.elements.canvas, BACKGROUND);
    this.updateMetrics();

    await this.loadStartingLevels();
    if (token !== this.runToken) return;
    this.correctStreaks = { single: 0, triple: 0, darker: 0, shifted: 0 };

    this.state = "ready";
    this.elements.startButton.querySelector("span").textContent = "等待左键开始";
    this.elements.stageMessage.querySelector("h3").textContent = "训练准备就绪";
    this.elements.stageMessage.querySelector("p").textContent = "保持注视灰色区域中央，按鼠标左键开始第一题。";
    this.elements.status.textContent = "预备模式";
    this.elements.responsePrompt.textContent = "按鼠标左键正式开始训练；按 Esc 退出";
  }

  async beginPreparedSession() {
    if (this.state !== "ready") return;
    const token = this.runToken;
    this.state = "starting";

    const startedAt = new Date().toISOString();
    const isExperience = this.sessionType === "experience";
    this.session = {
      id: createId("session"),
      userId: "local-user",
      userName: "本机训练用户",
      selectedMode: this.selectedMode,
      modeLabel: MODE_INFO[this.selectedMode].label,
      sessionType: isExperience ? "experience" : "training",
      isExperience,
      fixedLevel: isExperience ? round(this.fixedExperienceLevel) : null,
      plannedTrials: this.totalTrials,
      trialsPerMode: this.selectedMode === "mixed" ? this.configuredTrialCount() : null,
      modeOrder: this.selectedMode === "mixed" ? [...TASK_MODES] : [this.selectedMode],
      completedTrials: 0,
      correctCount: 0,
      accuracy: 0,
      startedAt,
      endedAt: null,
      durationMs: 0,
      status: "in_progress",
      initialLevels: structuredClone(this.levels),
      levelSource: isExperience ? "experience_fixed" : this.inheritedModes.length ? "adaptive_history" : "initial_default",
      inheritedModes: [...this.inheritedModes],
      finalLevels: null,
      modeStats: {},
      schemaVersion: 2,
    };

    try {
      await this.storage.saveSession(this.session);
    } catch (error) {
      this.state = "idle";
      await this.leaveFocusMode();
      this.resetStage();
      this.onToast(`无法创建训练记录：${error.message}`, "error");
      return;
    }
    if (token !== this.runToken) return;

    this.lockSetup(true);
    this.elements.startButton.querySelector("span").textContent = isExperience ? "体验进行中" : "训练进行中";
    this.elements.stageMessage.classList.add("hidden");
    this.elements.liveIndicator.classList.add("running");
    this.updateMetrics();
    this.onSessionChanged();
    if (isExperience) {
      this.onToast(`体验模式：固定难度 ${formatLevel(this.selectedMode, this.fixedExperienceLevel)}`, "success");
    } else if (this.inheritedModes.length) {
      this.onToast(`已继承上次训练阈值：${this.inheritedModes.map((mode) => MODE_INFO[mode].label).join("、")}`, "success");
    }
    await this.presentNextTrial();
  }

  async loadStartingLevels() {
    this.levels = { ...INITIAL_LEVELS };
    this.persistedLevels = {};
    this.inheritedModes = [];

    if (this.sessionType === "experience") {
      this.levels[this.selectedMode] = this.fixedExperienceLevel;
      return;
    }

    try {
      const storedLevels = await this.storage.getSetting(this.storage.ADAPTIVE_LEVELS_KEY);
      TASK_MODES.forEach((mode) => {
        const storedValue = Number(storedLevels?.[mode]);
        if (!Number.isFinite(storedValue)) return;
        const [minimum, maximum] = LEVEL_BOUNDS[mode];
        const value = clamp(storedValue, minimum, maximum);
        this.levels[mode] = value;
        this.persistedLevels[mode] = value;
        this.inheritedModes.push(mode);
      });
    } catch (error) {
      this.onToast(`历史阈值读取失败，本次使用默认难度：${error.message}`, "error");
    }
  }

  async persistTrainedLevels() {
    const nextLevels = { ...this.persistedLevels };
    new Set(this.trials.map((trial) => trial.mode)).forEach((mode) => {
      nextLevels[mode] = round(this.levels[mode]);
    });
    await this.storage.saveSetting(this.storage.ADAPTIVE_LEVELS_KEY, nextLevels);
    this.persistedLevels = nextLevels;
  }

  enterFocusMode() {
    this.focusModeActive = true;
    document.body.classList.add("training-focus");
    if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen().catch(() => {
        this.onToast("浏览器未允许全屏，已切换为页面沉浸模式");
      });
    }
  }

  async leaveFocusMode() {
    this.focusModeActive = false;
    document.body.classList.remove("training-focus");
    if (document.fullscreenElement && document.exitFullscreen) {
      try {
        await document.exitFullscreen();
      } catch {
        // The browser may already be leaving fullscreen after Escape.
      }
    }
  }

  lockSetup(locked) {
    this.setupLocked = locked;
    this.elements.modeCards.forEach((element) => { element.disabled = locked; });
    this.elements.trialCount.disabled = locked;
    this.elements.startButton.disabled = locked;
    this.updateSessionTypeControls();
  }

  createTrial(mode) {
    const layoutAngle = Math.random() < 0.5 ? 0 : 90;
    const angle = STIMULUS_ORIENTATIONS[Math.floor(Math.random() * STIMULUS_ORIENTATIONS.length)];
    const phase = Math.random() * Math.PI * 2;
    const common = {
      id: createId("trial"),
      sessionId: this.session.id,
      trialNumber: this.currentTrialIndex + 1,
      mode,
      modeLabel: MODE_INFO[mode].label,
      isExperience: this.session?.isExperience === true,
      levelBefore: round(this.levels[mode]),
      layoutAngle,
      angle,
      phase,
      background: BACKGROUND,
      sigma: BASE_STIMULUS.sigma,
      frequency: BASE_STIMULUS.frequency,
      createdAt: new Date().toISOString(),
    };

    if (mode === "single") {
      const correctAnswer = String(Math.random() < 0.5 ? 1 : 2);
      return { ...common, correctAnswer, validAnswers: ["1", "2"], contrast: this.levels.single };
    }

    if (mode === "triple") {
      const correctAnswer = String(Math.random() < 0.5 ? 1 : 2);
      return {
        ...common,
        correctAnswer,
        validAnswers: ["1", "2"],
        targetContrast: this.levels.triple,
        flankerContrast: 0.46,
        spacing: 132,
      };
    }

    if (mode === "darker") {
      const correctAnswer = String(Math.random() < 0.5 ? 1 : 2);
      const baseContrast = 0.18;
      const contrastDelta = this.levels.darker;
      return {
        ...common,
        correctAnswer,
        validAnswers: ["1", "2"],
        baseContrast,
        contrastDelta,
        clearerContrast: clamp(baseContrast + contrastDelta / 2, 0.03, 0.55),
        faintContrast: clamp(baseContrast - contrastDelta / 2, 0.025, 0.50),
      };
    }

    const directionSign = Math.random() < 0.5 ? -1 : 1;
    const offset = this.levels.shifted;
    let correctAnswer;
    if (layoutAngle === 90) correctAnswer = directionSign > 0 ? "left" : "right";
    else correctAnswer = directionSign > 0 ? "down" : "up";

    return {
      ...common,
      correctAnswer,
      validAnswers: layoutAngle === 90 ? ["left", "right"] : ["up", "down"],
      offset,
      offsetSigned: directionSign * offset,
      spacing: 132,
      contrast: 0.29,
    };
  }

  async presentNextTrial() {
    const token = this.runToken;
    if (this.currentTrialIndex >= this.trialSequence.length) {
      await this.completeSession();
      return;
    }

    const mode = this.trialSequence[this.currentTrialIndex];
    this.currentTrial = this.createTrial(mode);
    this.state = "fixation";
    this.elements.activeModeLabel.textContent = MODE_INFO[mode].label;
    this.elements.status.textContent = "保持注视";
    this.elements.responsePrompt.textContent = "请注视中央圆环，等待刺激出现";
    this.setResponseEnabled(false);
    this.showResponseControls(mode);
    this.showFixation(true);
    this.showIntervalLabel("");
    drawBlank(this.elements.canvas, BACKGROUND);
    this.updateMetrics();

    await sleep(TIMING.fixation);
    if (token !== this.runToken) return;

    if (mode === "shifted") await this.presentShiftedTrial(token);
    else await this.presentTemporalTrial(token);
  }

  async presentTemporalTrial(token) {
    for (let interval = 1; interval <= 2; interval += 1) {
      if (token !== this.runToken) return;
      this.state = `interval-${interval}`;
      this.showFixation(false);
      this.showIntervalLabel(`第 ${interval} 帧`);
      this.drawTemporalInterval(interval);
      drawFrameBorder(this.elements.canvas, this.frameBorderThickness);
      await sleep(TIMING.interval);
      if (token !== this.runToken) return;

      drawBlank(this.elements.canvas, BACKGROUND);
      this.showFixation(true);
      this.showIntervalLabel("");
      if (interval === 1) await sleep(TIMING.gap);
    }

    if (token !== this.runToken) return;
    this.enterResponseState();
  }

  drawTemporalInterval(interval) {
    const trial = this.currentTrial;
    const common = {
      ...BASE_STIMULUS,
      angle: trial.angle,
      phase: trial.mode === "darker" ? trial.phase : trial.phase + interval * 0.35,
    };

    if (trial.mode === "single") {
      drawSingle(this.elements.canvas, { ...common, visible: String(interval) === trial.correctAnswer, contrast: trial.contrast });
      return;
    }

    if (trial.mode === "triple") {
      drawTriple(this.elements.canvas, {
        ...common,
        layoutAngle: trial.layoutAngle,
        spacing: trial.spacing,
        flankerContrast: trial.flankerContrast,
        targetContrast: trial.targetContrast,
        showTarget: String(interval) === trial.correctAnswer,
      });
      return;
    }

    const isClearer = String(interval) === trial.correctAnswer;
    drawSingle(this.elements.canvas, {
      ...common,
      visible: true,
      contrast: isClearer ? trial.clearerContrast : trial.faintContrast,
    });
  }

  async presentShiftedTrial(token) {
    this.state = "stimulus";
    this.showFixation(false);
    this.showIntervalLabel("观察偏移");
    const trial = this.currentTrial;
    drawShifted(this.elements.canvas, {
      ...BASE_STIMULUS,
      angle: trial.angle,
      phase: trial.phase,
      layoutAngle: trial.layoutAngle,
      spacing: trial.spacing,
      offsetSigned: trial.offsetSigned,
      contrast: trial.contrast,
    });
    drawFrameBorder(this.elements.canvas, this.frameBorderThickness);

    await sleep(TIMING.shifted);
    if (token !== this.runToken) return;
    drawBlank(this.elements.canvas, BACKGROUND);
    this.showFixation(true);
    this.showIntervalLabel("");
    this.enterResponseState();
  }

  enterResponseState() {
    this.state = "awaiting-response";
    this.currentTrial.responseStartedAt = performance.now();
    this.elements.status.textContent = "等待作答";
    this.showFixation(true);
    const prompts = {
      single: "哪一帧出现了图像？左键选第一帧，右键选第二帧",
      triple: "哪一帧出现了三个图像？左键选第一帧，右键选第二帧",
      darker: "哪一帧中的图像更清晰？左键选第一帧，右键选第二帧",
      shifted: this.currentTrial.layoutAngle === 90
        ? "中间图像向左还是向右？左键选左，右键选右"
        : "中间图像向上还是向下？左键选上，右键选下",
    };
    this.elements.responsePrompt.textContent = prompts[this.currentTrial.mode];
    this.setResponseEnabled(true);
  }

  showResponseControls(mode) {
    const shifted = mode === "shifted";
    this.elements.temporalButtons.classList.remove("hidden");
    const labels = [...this.elements.temporalButtons.querySelectorAll("button span")];
    if (!shifted) {
      labels[0].textContent = "第一帧";
      labels[1].textContent = "第二帧";
      return;
    }
    if (this.currentTrial?.layoutAngle === 90) {
      labels[0].textContent = "向左";
      labels[1].textContent = "向右";
    } else if (this.currentTrial) {
      labels[0].textContent = "向上";
      labels[1].textContent = "向下";
    } else {
      labels[0].textContent = "向上 / 向左";
      labels[1].textContent = "向下 / 向右";
    }
  }

  setResponseEnabled(enabled) {
    this.elements.responseButtons.forEach((button) => { button.disabled = !enabled; });
  }

  async handleAnswer(answer) {
    if (this.state !== "awaiting-response" || !this.currentTrial.validAnswers.includes(answer)) return;
    const token = this.runToken;
    this.state = "feedback";
    this.setResponseEnabled(false);
    const trial = this.currentTrial;
    const correct = answer === trial.correctAnswer;
    const reactionTimeMs = Math.round(performance.now() - trial.responseStartedAt);
    if (correct) {
      this.correctCount += 1;
      this.incorrectStreak = 0;
    } else {
      this.incorrectStreak += 1;
    }
    const showAttentionReminder = this.incorrectStreak >= ATTENTION_REMINDER_AFTER;
    if (showAttentionReminder) this.incorrectStreak = 0;

    const levelAfter = this.adaptLevel(trial.mode, correct);
    const storedTrial = {
      ...trial,
      userAnswer: answer,
      correct,
      reactionTimeMs,
      levelAfter: round(levelAfter),
      completedAt: new Date().toISOString(),
    };
    delete storedTrial.responseStartedAt;
    delete storedTrial.validAnswers;
    this.trials.push(storedTrial);

    try {
      await this.storage.saveTrial(storedTrial);
    } catch (error) {
      this.onToast(`试次记录保存失败：${error.message}`, "error");
    }
    if (token !== this.runToken) return;

    this.showFeedback(correct, trial.correctAnswer);
    this.elements.status.textContent = showAttentionReminder ? "重新注视中心" : correct ? "回答正确" : "继续保持";
    this.elements.responsePrompt.textContent = showAttentionReminder
      ? "可以稍作调整，重新注视中心；看不清楚凭感觉猜即可。"
      : correct ? "很好，难度将逐步提高" : `本题正确答案：${this.answerLabel(trial.correctAnswer)}`;
    this.currentTrialIndex += 1;
    this.updateMetrics();
    await sleep(showAttentionReminder ? ATTENTION_REMINDER_DURATION : TIMING.feedback);
    if (token !== this.runToken) return;
    this.hideFeedback();
    await this.presentNextTrial();
  }

  adaptLevel(mode, correct) {
    let current = this.levels[mode];
    if (this.session?.isExperience) return current;
    if (correct) {
      this.correctStreaks[mode] += 1;
      if (this.correctStreaks[mode] >= 2) {
        current *= mode === "shifted" ? 0.82 : 0.84;
        this.correctStreaks[mode] = 0;
      }
    } else {
      this.correctStreaks[mode] = 0;
      current *= mode === "shifted" ? 1.24 : 1.20;
    }
    const [minimum, maximum] = LEVEL_BOUNDS[mode];
    this.levels[mode] = clamp(current, minimum, maximum);
    return this.levels[mode];
  }

  async completeSession() {
    this.state = "finishing";
    this.runToken += 1;
    const endedAt = new Date().toISOString();
    const durationMs = new Date(endedAt) - new Date(this.session.startedAt);
    const modeStats = {};
    TASK_MODES.forEach((mode) => {
      const trials = this.trials.filter((trial) => trial.mode === mode);
      if (!trials.length) return;
      const correct = trials.filter((trial) => trial.correct).length;
      modeStats[mode] = {
        trials: trials.length,
        correct,
        accuracy: round(correct / trials.length, 4),
        finalLevel: round(this.levels[mode]),
      };
    });

    this.session = {
      ...this.session,
      status: "completed",
      completedTrials: this.trials.length,
      correctCount: this.correctCount,
      accuracy: this.trials.length ? round(this.correctCount / this.trials.length, 4) : 0,
      endedAt,
      durationMs,
      finalLevels: structuredClone(this.levels),
      modeStats,
    };

    try {
      await this.storage.saveSession(this.session);
    } catch (error) {
      this.onToast(`会话汇总保存失败：${error.message}`, "error");
    }

    if (!this.session.isExperience) {
      try {
        await this.persistTrainedLevels();
      } catch (error) {
        this.onToast(`自适应阈值保存失败：${error.message}`, "error");
      }
    }

    await this.leaveFocusMode();

    drawBlank(this.elements.canvas, BACKGROUND);
    this.showFixation(false);
    this.elements.stageMessage.classList.remove("hidden");
    this.elements.stageMessage.querySelector("h3").textContent = this.session.isExperience ? "本次体验已完成" : "本次训练已完成";
    this.elements.stageMessage.querySelector("p").textContent = `完成 ${this.trials.length} 个试次，正确率 ${Math.round(this.session.accuracy * 100)}%。${this.session.isExperience ? "体验记录已保存，累计难度未改变。" : "训练数据已保存到 IndexedDB。"}`;
    this.elements.status.textContent = this.session.isExperience ? "体验完成" : "训练完成";
    this.elements.liveIndicator.classList.remove("running");
    this.elements.responsePrompt.textContent = "可以前往“训练数据”查看本次结果";
    this.setResponseEnabled(false);
    this.elements.temporalButtons.classList.remove("hidden");
    this.state = "completed";
    this.lockSetup(false);
    this.elements.startButton.querySelector("span").textContent = this.session.isExperience ? "再体验一次" : "再训练一次";
    this.updateMetrics();
    this.onToast(this.session.isExperience ? "体验完成，记录已保存且未改变累计难度" : "训练完成，数据已保存", "success");
    this.onSessionChanged();
  }

  async abortSession(reason = "interrupted") {
    if (!this.isRunning() || this.state === "finishing" || this.state === "aborting") return;
    this.runToken += 1;
    this.state = "aborting";
    if (!this.session) {
      await this.leaveFocusMode();
      this.resetStage();
      if (reason === "escape" || reason === "fullscreen_exit") {
        this.onToast("已退出训练预备模式");
      }
      return;
    }
    const endedAt = new Date().toISOString();
    this.session = {
      ...this.session,
      status: "incomplete",
      incompleteReason: reason,
      completedTrials: this.trials.length,
      correctCount: this.correctCount,
      accuracy: this.trials.length ? round(this.correctCount / this.trials.length, 4) : 0,
      endedAt,
      durationMs: new Date(endedAt) - new Date(this.session.startedAt),
      finalLevels: structuredClone(this.levels),
    };
    try { await this.storage.saveSession(this.session); } catch { /* best effort during navigation */ }
    await this.leaveFocusMode();
    this.resetStage();
    this.onSessionChanged();
    if (reason === "escape" || reason === "fullscreen_exit") {
      this.onToast("训练已结束，本次记录标记为未完成");
    }
  }

  resetStage() {
    this.state = "idle";
    this.currentTrial = null;
    drawBlank(this.elements.canvas, BACKGROUND);
    this.showFixation(false);
    this.elements.stageMessage.classList.remove("hidden");
    this.elements.stageMessage.querySelector("h3").textContent = "训练区已准备";
    this.elements.stageMessage.querySelector("p").textContent = "选择训练模式和长度后，点击“开始本次训练”。";
    this.elements.status.textContent = "等待开始";
    this.elements.liveIndicator.classList.remove("running");
    this.elements.responsePrompt.textContent = "训练开始后在这里作答";
    this.setResponseEnabled(false);
    this.showResponseControls(this.selectedMode);
    this.lockSetup(false);
    this.elements.startButton.querySelector("span").textContent = this.sessionType === "experience" ? "开始体验" : "开始本次训练";
    this.updateMetrics();
  }

  updateMetrics() {
    const completed = this.currentTrialIndex;
    const total = this.totalTrials;
    this.elements.progressText.textContent = `${completed} / ${total}`;
    this.elements.correctText.textContent = String(this.correctCount);
    this.elements.progressBar.style.width = `${total ? completed / total * 100 : 0}%`;
    if (this.currentTrial?.mode && this.levels[this.currentTrial.mode] != null) {
      this.elements.thresholdText.textContent = formatLevel(this.currentTrial.mode, this.levels[this.currentTrial.mode]);
    } else {
      this.elements.thresholdText.textContent = "—";
    }
  }

  showFixation(show) {
    this.elements.fixation.classList.toggle("hidden", !show);
  }

  showIntervalLabel(label) {
    this.elements.intervalLabel.textContent = label;
    this.elements.intervalLabel.classList.toggle("visible", Boolean(label));
  }

  showFeedback(correct, correctAnswer) {
    const element = this.elements.feedbackFlash;
    element.textContent = correct ? "回答正确" : `正确：${this.answerLabel(correctAnswer)}`;
    element.className = `feedback-flash show ${correct ? "correct" : "incorrect"}`;
  }

  hideFeedback() {
    this.elements.feedbackFlash.className = "feedback-flash";
  }

  answerLabel(answer) {
    return { "1": "第一帧", "2": "第二帧", left: "向左", right: "向右", up: "向上", down: "向下" }[answer] || answer;
  }
}
