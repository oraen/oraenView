const engine = require("../../utils/training");
const storage = require("../../utils/storage");
const gabor = require("../../utils/gabor");

function wait(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }

Page({
  data: {
    modeLabel: "训练", status: "正在准备", progress: "0 / 64", accuracy: "—", threshold: "—", progressWidth: 0,
    showFixation: false, intervalLabel: "", prompt: "请保持注视，训练即将开始", leftLabel: "第一帧", rightLabel: "第二帧",
    canAnswer: false, feedback: "", feedbackClass: "", completed: false, resultText: "",
  },
  onLoad(options) {
    this.mode = engine.MODE_INFO[options.mode] ? options.mode : "mixed";
    this.sequence = engine.buildSequence(this.mode); this.runToken = 1; this.index = 0; this.correctCount = 0; this.trials = [];
    this.levels = Object.assign({}, engine.INITIAL_LEVELS, storage.getLevels()); this.streaks = { single: 0, triple: 0, darker: 0, shifted: 0 };
    this.setData({ modeLabel: engine.MODE_INFO[this.mode].label, progress: "0 / " + this.sequence.length });
  },
  onReady() {
    wx.setKeepScreenOn({ keepScreenOn: true });
    this.canvasInitAttempts = 0;
    this.initializeCanvas();
  },
  initializeCanvas() {
    this.canvasInitAttempts += 1;
    this.setData({ status: "正在准备", prompt: "正在初始化训练画布…" });
    const query = wx.createSelectorQuery();
    query.select("#stimulusCanvas").fields({ node: true, size: true }).exec((result) => {
      const info = result && result[0];
      if (!info || !info.node) {
        if (this.canvasInitAttempts < 6) { setTimeout(() => this.initializeCanvas(), 180); return; }
        this.showCanvasError("当前微信版本无法初始化训练画布，请升级微信后重试"); return;
      }
      try {
        this.canvas = info.node;
        this.canvasWidth = 480; this.canvasHeight = 480;
        this.canvas.width = this.canvasWidth; this.canvas.height = this.canvasHeight;
        const context = this.canvas.getContext("2d");
        if (!context || typeof context.createImageData !== "function") throw new Error("Canvas 2D ImageData unavailable");
        gabor.blank(this.canvas, this.canvasWidth, this.canvasHeight);
        this.setData({ prompt: "请保持注视，训练即将开始" });
        setTimeout(() => this.start(), 250);
      } catch (error) {
        console.error("training canvas initialization failed", error);
        this.showCanvasError("训练画布初始化失败，请退出后重新进入");
      }
    });
  },
  showCanvasError(message) {
    this.setData({ status: "无法开始", prompt: message, canAnswer: false });
    wx.showModal({ title: "无法开始训练", content: message, showCancel: false });
  },
  async start() {
    if (this.session || !this.canvas) return;
    const startedAt = new Date().toISOString();
    this.session = { id: engine.createId("session"), platform: "wechat", selectedMode: this.mode, modeLabel: engine.MODE_INFO[this.mode].label, plannedTrials: this.sequence.length, trialsPerMode: this.mode === "mixed" ? 64 : null, modeOrder: this.mode === "mixed" ? engine.TASK_MODES.slice() : [this.mode], completedTrials: 0, correctCount: 0, accuracy: 0, startedAt, endedAt: null, durationMs: 0, status: "in_progress", initialLevels: Object.assign({}, this.levels), finalLevels: null, modeStats: {}, schemaVersion: 1 };
    try { storage.saveSession(this.session); await this.nextTrial(); }
    catch (error) { console.error("training start failed", error); this.showCanvasError("训练启动失败，请退出后重新进入"); }
  },
  async nextTrial() {
    const token = this.runToken;
    if (this.index >= this.sequence.length) return this.complete();
    const mode = this.sequence[this.index]; this.trial = engine.createTrial(mode, this.levels[mode], this.session.id, this.index + 1);
    this.setData({ modeLabel: engine.MODE_INFO[mode].label, status: "保持注视", showFixation: true, intervalLabel: "", prompt: "请注视中央圆环，等待刺激出现", canAnswer: false, feedback: "", threshold: engine.formatLevel(mode, this.levels[mode]) });
    gabor.blank(this.canvas, this.canvasWidth, this.canvasHeight); await wait(engine.TIMING.fixation); if (token !== this.runToken) return;
    if (mode === "shifted") await this.showShifted(token); else await this.showTemporal(token);
  },
  async showTemporal(token) {
    for (let interval = 1; interval <= 2; interval += 1) {
      gabor.temporal(this.canvas, this.canvasWidth, this.canvasHeight, this.trial, interval); this.setData({ showFixation: false, intervalLabel: "第 " + interval + " 帧" });
      await wait(engine.TIMING.interval); if (token !== this.runToken) return;
      gabor.blank(this.canvas, this.canvasWidth, this.canvasHeight); this.setData({ showFixation: true, intervalLabel: "" });
      if (interval === 1) await wait(engine.TIMING.gap); if (token !== this.runToken) return;
    }
    this.enterAnswer();
  },
  async showShifted(token) {
    gabor.shifted(this.canvas, this.canvasWidth, this.canvasHeight, this.trial); this.setData({ showFixation: false, intervalLabel: "观察偏移" });
    await wait(engine.TIMING.shifted); if (token !== this.runToken) return;
    gabor.blank(this.canvas, this.canvasWidth, this.canvasHeight); this.setData({ showFixation: true, intervalLabel: "" }); this.enterAnswer();
  },
  enterAnswer() {
    const trial = this.trial, shifted = trial.mode === "shifted";
    const prompts = { single: "哪一帧出现了图像？", triple: "哪一帧出现了三个图像？", darker: "哪一帧中的图像更清晰？", shifted: trial.layoutAngle === 90 ? "中间图像向左还是向右？" : "中间图像向上还是向下？" };
    this.responseStartedAt = Date.now();
    this.setData({ status: "等待作答", prompt: prompts[trial.mode] + "\n如果看不清楚，凭感觉猜即可。", canAnswer: true, leftLabel: shifted ? (trial.layoutAngle === 90 ? "向左" : "向上") : "第一帧", rightLabel: shifted ? (trial.layoutAngle === 90 ? "向右" : "向下") : "第二帧" });
  },
  answer(event) {
    if (!this.data.canAnswer || !this.trial) return;
    let answer = event.currentTarget.dataset.side;
    if (this.trial.mode === "shifted") answer = this.trial.layoutAngle === 90 ? (answer === "left" ? "left" : "right") : (answer === "left" ? "up" : "down");
    else answer = answer === "left" ? "1" : "2";
    this.handleAnswer(answer);
  },
  async handleAnswer(answer) {
    this.setData({ canAnswer: false }); const trial = this.trial, correct = answer === trial.correctAnswer;
    if (correct) this.correctCount += 1;
    const adapted = engine.adaptLevel(trial.mode, this.levels[trial.mode], correct, this.streaks[trial.mode]); this.levels[trial.mode] = adapted.value; this.streaks[trial.mode] = adapted.streak;
    const storedTrial = {
      id: trial.id, sessionId: trial.sessionId, trialNumber: trial.trialNumber, mode: trial.mode, modeLabel: trial.modeLabel,
      platform: "wechat", correctAnswer: trial.correctAnswer, userAnswer: answer, correct,
      reactionTimeMs: Date.now() - this.responseStartedAt, levelBefore: trial.levelBefore,
      levelAfter: engine.round(adapted.value), completedAt: new Date().toISOString(),
    };
    this.trials.push(storedTrial);
    try { storage.saveTrial(storedTrial); } catch (error) { wx.showToast({ title: "本题记录保存失败", icon: "none" }); }
    this.index += 1;
    this.setData({ status: correct ? "回答正确" : "继续保持", feedback: correct ? "✓" : "×", feedbackClass: correct ? "good" : "bad", prompt: correct ? "很好，难度将逐步提高" : "本题正确答案：" + engine.answerLabel(trial.correctAnswer) }); this.updateMetrics();
    await wait(engine.TIMING.feedback); if (!this.session || this.session.status !== "in_progress") return;
    this.setData({ feedback: "", feedbackClass: "" }); this.nextTrial();
  },
  updateMetrics() {
    this.setData({ progress: this.index + " / " + this.sequence.length, accuracy: this.index ? Math.round(this.correctCount / this.index * 100) + "%" : "—", threshold: this.trial ? engine.formatLevel(this.trial.mode, this.levels[this.trial.mode]) : "—", progressWidth: this.index / this.sequence.length * 100 });
  },
  complete() {
    const endedAt = new Date().toISOString(), modeStats = {};
    engine.TASK_MODES.forEach((mode) => { const items = this.trials.filter((trial) => trial.mode === mode); if (items.length) { const correct = items.filter((trial) => trial.correct).length; modeStats[mode] = { trials: items.length, correct, accuracy: engine.round(correct / items.length), finalLevel: engine.round(this.levels[mode]) }; } });
    this.session = Object.assign({}, this.session, { status: "completed", completedTrials: this.trials.length, correctCount: this.correctCount, accuracy: engine.round(this.correctCount / this.trials.length), endedAt, durationMs: new Date(endedAt) - new Date(this.session.startedAt), finalLevels: Object.assign({}, this.levels), modeStats });
    storage.saveSession(this.session); storage.saveLevels(this.levels); gabor.blank(this.canvas, this.canvasWidth, this.canvasHeight);
    this.setData({ status: "训练完成", showFixation: false, intervalLabel: "", canAnswer: false, completed: true, resultText: "完成 " + this.trials.length + " 个试次，正确率 " + Math.round(this.session.accuracy * 100) + "%", prompt: "训练数据已保存，1 秒后返回主页" });
    this.returnTimer = setTimeout(() => {
      this.returnTimer = null;
      wx.switchTab({ url: "/pages/mobile/index" });
    }, 1000);
  },
  finish() {
    if (this.data.completed) {
      this.clearReturnTimer();
      wx.switchTab({ url: "/pages/records/index" });
    } else this.confirmExit();
  },
  clearReturnTimer() { if (this.returnTimer) { clearTimeout(this.returnTimer); this.returnTimer = null; } },
  confirmExit() { wx.showModal({ title: "结束本次训练？", content: "已完成的试次会保留，本次会话将标记为未完成。", success: (res) => { if (res.confirm) { this.abort("manual"); wx.navigateBack(); } } }); },
  abort(reason) {
    if (!this.session || this.session.status !== "in_progress") return;
    this.runToken += 1; const endedAt = new Date().toISOString(); this.session = Object.assign({}, this.session, { status: "incomplete", incompleteReason: reason, completedTrials: this.trials.length, correctCount: this.correctCount, accuracy: this.trials.length ? engine.round(this.correctCount / this.trials.length) : 0, endedAt, durationMs: new Date(endedAt) - new Date(this.session.startedAt), finalLevels: Object.assign({}, this.levels) }); storage.saveSession(this.session);
  },
  onUnload() { this.clearReturnTimer(); this.abort("navigation"); },
  onShareAppMessage() { return { title: "开源视觉 · 掌上视觉训练", path: "/pages/mobile/index" }; },
});
