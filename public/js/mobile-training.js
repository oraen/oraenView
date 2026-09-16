import { TrainingController, MODE_INFO } from "./training.js";
import * as mobileStorage from "./mobile-db.js";

export class MobileTrainingController extends TrainingController {
  constructor(options = {}) {
    const root = document.querySelector("#mobilePage");
    const elements = {};
    for (const name of ["startButton", "trainerPanel", "canvas", "stageMessage", "fixation", "intervalLabel", "feedbackFlash", "responsePrompt", "temporalButtons", "status", "liveIndicator", "activeModeLabel", "progressText", "correctText", "thresholdText", "progressBar"]) {
      elements[name] = root.querySelector(`[data-mobile="${name}"]`);
    }
    elements.modeCards = [...root.querySelectorAll("[data-mobile-mode]")];
    elements.responseButtons = [...elements.temporalButtons.querySelectorAll("button")];
    super({ ...options, storage: mobileStorage, elements });
    this.frameBorderThickness = 6;
  }

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
      if (this.isRunning() && this.state !== "finishing" && this.canvasSize !== this.elements.canvas.getBoundingClientRect().width) {
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
    this.incorrectStreak = 0;
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
    this.canvasSize = this.elements.canvas.getBoundingClientRect().width;
  }

  async leaveFocusMode() {
    document.body.classList.remove("mobile-training-focus");
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
