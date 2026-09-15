const { MODE_INFO } = require("../../utils/training");
const storage = require("../../utils/storage");

Page({
  data: {
    modes: ["mixed", "single", "triple", "darker", "shifted"].map((key) => ({ key, label: MODE_INFO[key].label, caption: MODE_INFO[key].caption })),
    lastRecord: null,
  },
  onLoad() {
    if (wx.showShareMenu) wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] });
  },
  onShow() {
    const completed = storage.getData().sessions.find((item) => item.status === "completed");
    this.setData({ lastRecord: completed ? { mode: completed.modeLabel, accuracy: Math.round((completed.accuracy || 0) * 100), trials: completed.completedTrials || 0 } : null });
  },
  startTraining(event) { wx.navigateTo({ url: "/pages/training/index?mode=" + event.currentTarget.dataset.mode }); },
  onShareAppMessage() { return { title: "开源视觉 · 掌上视觉训练", path: "/pages/mobile/index" }; },
  onShareTimeline() { return { title: "开源视觉 · 掌上视觉训练", query: "" }; },
});
