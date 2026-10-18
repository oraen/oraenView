const core = require("../../utils/child-games-core");
const storage = require("../../utils/child-storage");

function gameCards() {
  const levels = Object.assign(core.createInitialLevels(), storage.getLevels());
  return core.GAME_ORDER.map((id) => Object.assign({}, core.GAMES[id], { levelLabel: core.normalizeLevel(levels[id]) + "级" }));
}

Page({
  data: { games: gameCards(), showTutorial: false, selectedGameInfo: null, showSetup: false, selectedGame: "", redLensEye: "left", weakEye: "unknown", confirmed: false },
  onLoad() { if (wx.showShareMenu) wx.showShareMenu({ menus: ["shareAppMessage", "shareTimeline"] }); },
  onShow() { this.setData({ games: gameCards() }); },
  chooseGame(event) {
    const gameId = event.currentTarget.dataset.game; const game = core.GAMES[gameId];
    if (!game) return;
    this.setData({ selectedGame: gameId, selectedGameInfo: game, showTutorial: true });
  },
  cancelTutorial() { this.setData({ showTutorial: false }); },
  confirmTutorial() {
    const gameId = this.data.selectedGame; const game = core.GAMES[gameId];
    if (!game) return;
    this.setData({ showTutorial: false });
    this.beginSelectedGame(gameId, game);
  },
  beginSelectedGame(gameId, game) {
    const settings = storage.getSettings();
    if (game.glasses && !settings.calibrated) { this.setData({ showSetup: true, confirmed: false }); return; }
    wx.navigateTo({ url: "/pages/child-training/index?game=" + gameId });
  },
  setRedLens(event) { this.setData({ redLensEye: event.detail.value }); },
  setWeakEye(event) { this.setData({ weakEye: event.detail.value }); },
  setConfirmed(event) { this.setData({ confirmed: event.detail.value.length > 0 }); },
  cancelSetup() { this.setData({ showSetup: false }); },
  saveSetup() {
    if (!this.data.confirmed) { wx.showToast({ title: "请先完成镜片检查", icon: "none" }); return; }
    storage.saveSettings({ calibrated: true, redLensEye: this.data.redLensEye, weakEye: this.data.weakEye, fellowEyeContrast: 0.55, updatedAt: new Date().toISOString() });
    const game = this.data.selectedGame; this.setData({ showSetup: false }); wx.navigateTo({ url: "/pages/child-training/index?game=" + game });
  },
  onShareAppMessage() { return { title: "开源视觉 · 弱视小游戏", path: "/pages/child/index" }; },
  onShareTimeline() { return { title: "开源视觉 · 弱视小游戏" }; },
});
