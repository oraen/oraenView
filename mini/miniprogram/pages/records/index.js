const engine = require("../../utils/training");
const storage = require("../../utils/storage");
const MODES = engine.TASK_MODES;

function formatDate(value) {
  const date = new Date(value); const pad = (number) => String(number).padStart(2, "0");
  return pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes());
}
function formatDuration(milliseconds) { const seconds = Math.round((milliseconds || 0) / 1000); return Math.floor(seconds / 60) + "分 " + seconds % 60 + "秒"; }
function levelName(mode) { return ({ single: "目标对比度", triple: "中心目标对比度", darker: "两帧对比差", shifted: "中心偏移量" })[mode]; }

Page({
  data: {
    hasData: false, totalSessions: 0, totalTrials: 0, accuracy: "—", duration: 0,
    levelCards: [], modeSummary: [], sessions: [], detail: null,
  },
  onShow() { this.load(); },
  onPullDownRefresh() { this.load(); wx.stopPullDownRefresh(); },
  load() {
    const data = storage.getData(); this.raw = data;
    const completed = data.sessions.filter((item) => item.status === "completed");
    const completedIds = {}; completed.forEach((item) => { completedIds[item.id] = true; });
    const formalTrials = data.trials.filter((item) => completedIds[item.sessionId]);
    const correct = formalTrials.filter((item) => item.correct).length;
    const levelCards = MODES.map((mode) => {
      const value = data.levels[mode];
      return { mode, label: engine.MODE_INFO[mode].label, description: levelName(mode), value: value == null ? "—" : engine.formatLevel(mode, value), stage: value == null ? "尚未训练" : engine.difficultyStage(mode, value).toFixed(1) + " 阶" };
    });
    const modeSummary = MODES.map((mode) => { const trials = formalTrials.filter((item) => item.mode === mode), good = trials.filter((item) => item.correct).length, rate = trials.length ? Math.round(good / trials.length * 100) : 0; return { mode, label: engine.MODE_INFO[mode].label, trials: trials.length, rate, text: trials.length ? rate + "% · " + trials.length + " 试次" : "暂无数据" }; });
    const sessions = data.sessions.map((session) => ({ id: session.id, date: formatDate(session.startedAt), mode: session.modeLabel, status: session.status === "completed" ? "已完成" : "未完成", completeClass: session.status === "completed" ? "complete" : "incomplete", progress: (session.completedTrials || 0) + "/" + (session.plannedTrials || 0), accuracy: session.completedTrials ? Math.round((session.accuracy || 0) * 100) + "%" : "—", duration: formatDuration(session.durationMs) }));
    this.setData({ hasData: data.sessions.length > 0, totalSessions: completed.length, totalTrials: formalTrials.length, accuracy: formalTrials.length ? Math.round(correct / formalTrials.length * 100) + "%" : "—", duration: Math.round(completed.reduce((sum, item) => sum + (item.durationMs || 0), 0) / 60000), levelCards, modeSummary, sessions }, () => this.drawCharts());
  },
  drawCharts() {
    this.drawChart("#accuracyChart", this.raw.sessions.filter((item) => item.status === "completed").slice(0, 12).reverse().map((item) => (item.accuracy || 0) * 100), 0, 100, "%");
    MODES.forEach((mode) => {
      const points = this.raw.sessions.filter((item) => item.status === "completed" && item.finalLevels && Number.isFinite(Number(item.finalLevels[mode]))).slice().reverse().map((item) => engine.difficultyStage(mode, item.finalLevels[mode]));
      this.drawChart("#trend-" + mode, points, 0, null, "阶");
    });
  },
  drawChart(selector, points, fixedMin, fixedMax, unit) {
    wx.createSelectorQuery().select(selector).fields({ node: true, size: true }).exec((result) => {
      const item = result[0]; if (!item || !item.node) return;
      const canvas = item.node, ratio = 1, width = item.width, height = item.height;
      canvas.width = width * ratio; canvas.height = height * ratio; const context = canvas.getContext("2d"); context.scale(ratio, ratio);
      context.clearRect(0, 0, width, height); context.strokeStyle = "#e8ecf3"; context.lineWidth = 1;
      [0, .5, 1].forEach((part) => { const y = 12 + (height - 34) * part; context.beginPath(); context.moveTo(28, y); context.lineTo(width - 8, y); context.stroke(); });
      if (!points.length) { context.fillStyle = "#9aa3b1"; context.font = "12px sans-serif"; context.textAlign = "center"; context.fillText("完成训练后生成曲线", width / 2, height / 2); return; }
      const minimum = fixedMin == null ? Math.min.apply(null, points) : fixedMin, maximumRaw = fixedMax == null ? Math.max.apply(null, points) : fixedMax, maximum = maximumRaw === minimum ? minimum + 1 : maximumRaw;
      const plotWidth = width - 44, plotHeight = height - 34; context.beginPath(); context.strokeStyle = "#3158df"; context.lineWidth = 2;
      points.forEach((value, index) => { const x = 28 + (points.length === 1 ? plotWidth / 2 : index / (points.length - 1) * plotWidth), y = 12 + (1 - (value - minimum) / (maximum - minimum)) * plotHeight; if (index) context.lineTo(x, y); else context.moveTo(x, y); }); context.stroke();
      context.fillStyle = "#3158df"; points.forEach((value, index) => { const x = 28 + (points.length === 1 ? plotWidth / 2 : index / (points.length - 1) * plotWidth), y = 12 + (1 - (value - minimum) / (maximum - minimum)) * plotHeight; context.beginPath(); context.arc(x, y, 3, 0, Math.PI * 2); context.fill(); });
      context.fillStyle = "#7b8596"; context.font = "10px sans-serif"; context.textAlign = "left"; context.fillText(Math.round(maximum) + unit, 2, 13); context.fillText(Math.round(minimum) + unit, 2, height - 10);
    });
  },
  showDetails(event) {
    const session = this.raw.sessions.find((item) => item.id === event.currentTarget.dataset.id); if (!session) return;
    const trials = storage.getTrials(session.id).map((trial) => ({ number: trial.trialNumber, mode: trial.modeLabel, answer: engine.answerLabel(trial.userAnswer) + " / " + engine.answerLabel(trial.correctAnswer), result: trial.correct ? "正确" : "错误", resultClass: trial.correct ? "good" : "bad", reaction: trial.reactionTimeMs + " ms", level: engine.formatLevel(trial.mode, trial.levelBefore) + " → " + engine.formatLevel(trial.mode, trial.levelAfter) }));
    this.setData({ detail: { title: formatDate(session.startedAt) + " · " + session.modeLabel, trials } });
  },
  closeDetails() { this.setData({ detail: null }); },
  noop() {},
  clearData() {
    wx.showModal({ title: "清空训练数据？", content: "训练记录和累计难度都会删除，此操作无法恢复。", confirmColor: "#c73d4e", success: (result) => { if (result.confirm) { storage.clear(); this.setData({ detail: null }); this.load(); wx.showToast({ title: "已清空" }); } } });
  },
  onShareAppMessage() { return { title: "开源视觉 · 掌上视觉训练", path: "/pages/mobile/index" }; },
});
