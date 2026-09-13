(function () {
"use strict";
const { cloneRecord, createId } = window.ToolCompat;
const { drawBlank, drawSingle, drawTriple, drawShifted } = window.ToolGabor;
const MODE_INFO = {
  mixed: { label: "综合训练", description: "单图、三图、清晰图、移图按固定顺序分段进行，每种分别完成所选训练长度。" },
  single: { label: "单图训练", description: "两帧中仅一帧出现低对比度 Gabor，判断目标出现的时间位置。" },
  triple: { label: "三图训练", description: "两帧均有侧翼，判断哪一帧额外出现低对比度中间目标。" },
  darker: { label: "清晰图训练", description: "两帧各出现一个 Gabor，判断哪一帧的图像对比更清晰。" },
  shifted: { label: "移图训练", description: "观察三个 Gabor，判断中间目标相对两侧参照的轻微偏移方向。" },
};

const TASK_MODES = ["single", "triple", "darker", "shifted"];
const BACKGROUND = 158;
const BASE_STIMULUS = { background: BACKGROUND, sigma: 23, frequency: 0.047 };
const TIMING = { fixation: 650, interval: 430, gap: 330, shifted: 560, feedback: 520 };

const INITIAL_LEVELS = { single: 0.24, triple: 0.19, darker: 0.10, shifted: 19 };

const LEVEL_BOUNDS = {
  single: [0.0005, 0.55],
  triple: [0.0004, 0.48],
  darker: [0.002, 0.24],
  shifted: [0.5, 42],
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


class TrainingController {
  constructor({ onToast, onSessionChanged } = {}) {
    this.storage = window.ToolStorage;
    this.onToast = onToast || (() => {});
    this.onSessionChanged = onSessionChanged || (() => {});
    this.selectedMode = "mixed";
    this.sessionType = "training";
    this.totalTrials = 256;
    this.session = null;
    this.trials = [];
    this.trialSequence = [];
    this.currentTrial = null;
    this.currentTrialIndex = 0;
    this.correctCount = 0;
    this.state = "idle";
    this.runToken = 0;
    this.levels = {};
    this.persistedLevels = {};
    this.inheritedModes = [];
    this.correctStreaks = {};
    const root = document.querySelector("#mobilePage");
    const elements = {};
    for (const name of ["startButton", "trainerPanel", "canvas", "stageMessage", "fixation", "intervalLabel", "feedbackFlash", "responsePrompt", "temporalButtons", "status", "liveIndicator", "activeModeLabel", "progressText", "correctText", "thresholdText", "progressBar"]) elements[name] = root.querySelector('[data-mobile="' + name + '"]');
    elements.modeCards = Array.from(root.querySelectorAll("[data-mobile-mode]"));
    elements.responseButtons = Array.from(elements.temporalButtons.querySelectorAll("button"));
    this.elements = elements;
    this.bindEvents();
    this.resetStage();
  }
  isRunning() {
    return !["idle", "completed", "aborted"].includes(this.state);
  }
  mouseAnswerForTrial(mouseButton) {
    if (mouseButton !== 0 && mouseButton !== 2) return null;
    if ((this.currentTrial || {}).mode !== "shifted") return mouseButton === 0 ? "1" : "2";
    const verticalLayout = this.currentTrial.layoutAngle === 90;
    if (mouseButton === 0) return verticalLayout ? "left" : "up";
    return verticalLayout ? "right" : "down";
  }
  buildSequence() {
    const configuredCount = this.configuredTrialCount();
    if (this.selectedMode !== "mixed") return Array(configuredCount).fill(this.selectedMode);
    return [].concat(...TASK_MODES.map((mode) => Array(configuredCount).fill(mode)));
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
      initialLevels: cloneRecord(this.levels),
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
    this.levels = Object.assign({}, INITIAL_LEVELS);
    this.persistedLevels = {};
    this.inheritedModes = [];

    if (this.sessionType === "experience") {
      this.levels[this.selectedMode] = this.fixedExperienceLevel;
      return;
    }

    try {
      const storedLevels = await this.storage.getSetting(this.storage.ADAPTIVE_LEVELS_KEY);
      TASK_MODES.forEach((mode) => {
        const storedValue = Number((storedLevels || {})[mode]);
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
    const nextLevels = Object.assign({}, this.persistedLevels);
    new Set(this.trials.map((trial) => trial.mode)).forEach((mode) => {
      nextLevels[mode] = round(this.levels[mode]);
    });
    await this.storage.saveSetting(this.storage.ADAPTIVE_LEVELS_KEY, nextLevels);
    this.persistedLevels = nextLevels;
  }
  createTrial(mode) {
    const layoutAngle = Math.random() < 0.5 ? 0 : 90;
    const angle = layoutAngle === 90 ? 0 : 90;
    const phase = Math.random() * Math.PI * 2;
    const common = {
      id: createId("trial"),
      sessionId: this.session.id,
      trialNumber: this.currentTrialIndex + 1,
      mode,
      modeLabel: MODE_INFO[mode].label,
      isExperience: (this.session || {}).isExperience === true,
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
      return Object.assign({}, common, { correctAnswer, validAnswers: ["1", "2"], contrast: this.levels.single });
    }

    if (mode === "triple") {
      const correctAnswer = String(Math.random() < 0.5 ? 1 : 2);
      return Object.assign({}, common, {
        correctAnswer,
        validAnswers: ["1", "2"],
        targetContrast: this.levels.triple,
        flankerContrast: 0.46,
        spacing: 132,
      });
    }

    if (mode === "darker") {
      const correctAnswer = String(Math.random() < 0.5 ? 1 : 2);
      const baseContrast = 0.18;
      const contrastDelta = this.levels.darker;
      return Object.assign({}, common, {
        correctAnswer,
        validAnswers: ["1", "2"],
        baseContrast,
        contrastDelta,
        clearerContrast: clamp(baseContrast + contrastDelta / 2, 0.03, 0.55),
        faintContrast: clamp(baseContrast - contrastDelta / 2, 0.025, 0.50),
      });
    }

    const directionSign = Math.random() < 0.5 ? -1 : 1;
    const offset = this.levels.shifted;
    let correctAnswer;
    if (layoutAngle === 90) correctAnswer = directionSign > 0 ? "left" : "right";
    else correctAnswer = directionSign > 0 ? "down" : "up";

    return Object.assign({}, common, {
      correctAnswer,
      validAnswers: layoutAngle === 90 ? ["left", "right"] : ["up", "down"],
      offset,
      offsetSigned: directionSign * offset,
      spacing: 132,
      contrast: 0.29,
    });
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
    const common = Object.assign({}, BASE_STIMULUS, {
      angle: trial.angle,
      phase: trial.mode === "darker" ? trial.phase : trial.phase + interval * 0.35,
    });

    if (trial.mode === "single") {
      drawSingle(this.elements.canvas, Object.assign({}, common, { visible: String(interval) === trial.correctAnswer, contrast: trial.contrast }));
      return;
    }

    if (trial.mode === "triple") {
      drawTriple(this.elements.canvas, Object.assign({}, common, {
        layoutAngle: trial.layoutAngle,
        spacing: trial.spacing,
        flankerContrast: trial.flankerContrast,
        targetContrast: trial.targetContrast,
        showTarget: String(interval) === trial.correctAnswer,
      }));
      return;
    }

    const isClearer = String(interval) === trial.correctAnswer;
    drawSingle(this.elements.canvas, Object.assign({}, common, {
      visible: true,
      contrast: isClearer ? trial.clearerContrast : trial.faintContrast,
    }));
  }
  async presentShiftedTrial(token) {
    this.state = "stimulus";
    this.showFixation(false);
    this.showIntervalLabel("观察偏移");
    const trial = this.currentTrial;
    drawShifted(this.elements.canvas, Object.assign({}, BASE_STIMULUS, {
      angle: trial.angle,
      phase: trial.phase,
      layoutAngle: trial.layoutAngle,
      spacing: trial.spacing,
      offsetSigned: trial.offsetSigned,
      contrast: trial.contrast,
    }));

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
    if ((this.currentTrial || {}).layoutAngle === 90) {
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
    if (correct) this.correctCount += 1;

    const levelAfter = this.adaptLevel(trial.mode, correct);
    const storedTrial = Object.assign({}, trial, {
      userAnswer: answer,
      correct,
      reactionTimeMs,
      levelAfter: round(levelAfter),
      completedAt: new Date().toISOString(),
    });
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
    this.elements.status.textContent = correct ? "回答正确" : "继续保持";
    this.elements.responsePrompt.textContent = correct ? "很好，难度将逐步提高" : `本题正确答案：${this.answerLabel(trial.correctAnswer)}`;
    this.currentTrialIndex += 1;
    this.updateMetrics();
    await sleep(TIMING.feedback);
    if (token !== this.runToken) return;
    this.hideFeedback();
    await this.presentNextTrial();
  }
  adaptLevel(mode, correct) {
    let current = this.levels[mode];
    if ((this.session || {}).isExperience) return current;
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

    this.session = Object.assign({}, this.session, {
      status: "completed",
      completedTrials: this.trials.length,
      correctCount: this.correctCount,
      accuracy: this.trials.length ? round(this.correctCount / this.trials.length, 4) : 0,
      endedAt,
      durationMs,
      finalLevels: cloneRecord(this.levels),
      modeStats,
    });

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
      if (reason === "escape") {
        this.onToast("已退出训练预备模式");
      }
      return;
    }
    const endedAt = new Date().toISOString();
    this.session = Object.assign({}, this.session, {
      status: "incomplete",
      incompleteReason: reason,
      completedTrials: this.trials.length,
      correctCount: this.correctCount,
      accuracy: this.trials.length ? round(this.correctCount / this.trials.length, 4) : 0,
      endedAt,
      durationMs: new Date(endedAt) - new Date(this.session.startedAt),
      finalLevels: cloneRecord(this.levels),
    });
    try { await this.storage.saveSession(this.session); } catch { /* best effort during navigation */ }
    await this.leaveFocusMode();
    this.resetStage();
    this.onSessionChanged();
    if (reason === "escape") {
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
    if ((this.currentTrial || {}).mode && this.levels[this.currentTrial.mode] != null) {
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
class MobileTrainingController extends TrainingController {
  bindEvents() {
    this.elements.modeCards.forEach((button) => button.addEventListener("click", () => {
      if (this.isRunning()) return;
      this.selectedMode = button.dataset.mobileMode;
      this.prepareSession();
    }));
    this.elements.startButton.addEventListener("click", () => this.prepareSession());
    this.elements.responseButtons.forEach((button, index) => button.addEventListener("click", () => {
      this.handleAnswer(this.mouseAnswerForTrial(index === 0 ? 0 : 2));
    }));
    document.querySelector("#mobileExit").addEventListener("click", () => this.abortSession("exit_button"));
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.isRunning()) this.abortSession("escape");
    });
    // A hidden page can throttle stimulus timers. End it instead of scoring unseen frames.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && this.isRunning()) this.abortSession("page_hidden");
    });
    window.addEventListener("resize", () => {
      if (this.isRunning() && this.state !== "finishing" && (this.viewportWidth !== window.innerWidth || this.viewportHeight !== window.innerHeight)) {
        this.abortSession("screen_resize");
        this.onToast("屏幕尺寸发生变化，本次已结束，请重新开始");
      }
    });
  }
  configuredTrialCount() { return 64; }
  updateMetrics() {
    super.updateMetrics();
    this.elements.correctText.textContent = this.trials.length
      ? `${Math.round(this.correctCount / this.trials.length * 100)}%` : "—";
  }
  enterResponseState() {
    super.enterResponseState();
    this.elements.responsePrompt.textContent += "\n如果看不清楚凭感觉猜即可";
  }
  lockSetup(locked) {
    this.elements.modeCards.forEach((button) => { button.disabled = locked; });
    this.elements.startButton.disabled = locked;
  }
  async prepareSession() {
    if (this.isRunning()) return;
    const token = ++this.runToken;
    this.state = "preparing";
    this.session = null;
    this.currentTrial = null;
    this.trials = [];
    this.currentTrialIndex = 0;
    this.correctCount = 0;
    this.trialSequence = this.buildSequence();
    this.totalTrials = this.trialSequence.length;
    this.lockSetup(true);
    this.enterFocusMode();
    this.elements.activeModeLabel.textContent = MODE_INFO[this.selectedMode].label;
    this.elements.stageMessage.querySelector("h3").textContent = "正在准备";
    this.elements.stageMessage.querySelector("p").textContent = "保持注视中央，图像即将出现";
    this.elements.stageMessage.classList.remove("hidden");
    this.hideFeedback();
    this.showIntervalLabel("");
    await this.loadStartingLevels();
    if (token !== this.runToken) return;
    this.correctStreaks = { single: 0, triple: 0, darker: 0, shifted: 0 };
    this.state = "ready";
    await this.beginPreparedSession();
  }
  enterFocusMode() {
    this.elements.trainerPanel.classList.remove("hidden");
    document.body.classList.add("mobile-training-focus");
    this.viewportWidth = window.innerWidth;
    this.viewportHeight = window.innerHeight;
    this.fitCanvas();
    this.canvasSize = this.elements.canvas.getBoundingClientRect().width;
  }
  fitCanvas() {
    const stage = this.elements.canvas.parentElement;
    const size = Math.max(1, Math.min(stage.clientWidth, stage.clientHeight, 480));
    this.elements.canvas.style.width = size + "px";
    this.elements.canvas.style.height = size + "px";
  }
  async leaveFocusMode() {
    document.body.classList.remove("mobile-training-focus");
    this.elements.canvas.style.width = "";
    this.elements.canvas.style.height = "";
  }
  resetStage() {
    super.resetStage();
    this.elements.trainerPanel.classList.add("hidden");
    this.elements.stageMessage.querySelector("p").textContent = "点击上方模式直接开始：单项 64 次，综合训练共 256 次。";
    this.elements.startButton.classList.add("hidden");
  }
  async completeSession() {
    await super.completeSession();
    this.elements.status.textContent = "上次训练记录";
    this.elements.stageMessage.querySelector("h3").textContent = "上次训练记录";
    this.elements.startButton.classList.remove("hidden");
    this.elements.stageMessage.querySelector("p").textContent = `完成 ${this.trials.length} 次，正确率 ${Math.round(this.session.accuracy * 100)}%。掌上训练记录已保存。`;
  }
}

window.ToolTraining = { MobileTrainingController, INITIAL_LEVELS, LEVEL_BOUNDS, MODE_INFO };
})();
