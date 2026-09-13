import * as desktopStorage from "./db.js";
import * as mobileStorage from "./mobile-db.js";
import { INITIAL_LEVELS, LEVEL_BOUNDS, MODE_INFO } from "./training.js";
import { TEST_INFO } from "./visual-test.js";

const MODE_ORDER = ["single", "triple", "darker", "shifted"];
const SESSION_PAGE_SIZE = 20;
const MAX_VISIBLE_SESSIONS = 100;

function isExperienceSession(session) {
  return session?.isExperience === true || session?.sessionType === "experience";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value, includeSeconds = false) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: includeSeconds ? "2-digit" : undefined,
    hour12: false,
  }).format(new Date(value));
}

function formatDuration(milliseconds) {
  if (!milliseconds) return "0 分钟";
  const totalSeconds = Math.round(milliseconds / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}分 ${seconds}秒` : `${seconds} 秒`;
}

function formatLevel(mode, value) {
  if (value == null) return "—";
  if (mode === "shifted") return `${Number(value).toFixed(1)} px`;
  if (mode === "darker") return `Δ ${Number(value).toFixed(3)}`;
  const percentage = Number(value) * 100;
  return `${percentage.toFixed(percentage < 1 ? 2 : 1)}%`;
}

function finalLevelText(session) {
  if (!session.finalLevels) return "—";
  if (session.selectedMode === "mixed") return "多维阈值";
  return formatLevel(session.selectedMode, session.finalLevels[session.selectedMode]);
}

function difficultyScore(mode, value) {
  if (value == null) return null;
  const initial = INITIAL_LEVELS[mode];
  const minimum = LEVEL_BOUNDS[mode][0];
  const score = (initial - Number(value)) / (initial - minimum) * 100;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function equivalentDifficultyStage(mode, value) {
  const current = Number(value);
  if (!Number.isFinite(current) || current <= 0) return null;
  const harderMultiplier = mode === "shifted" ? 0.82 : 0.84;
  const stage = Math.log(INITIAL_LEVELS[mode] / current) / Math.log(1 / harderMultiplier);
  return Math.max(0, stage);
}

function formatDifficultyStage(value) {
  return `${Number(value).toFixed(1)} 阶`;
}

function levelDescription(mode) {
  return {
    single: "目标对比度",
    triple: "中心目标对比度",
    darker: "两帧对比差",
    shifted: "中心偏移量",
  }[mode];
}

function answerLabel(answer) {
  return { "1": "第一帧", "2": "第二帧", left: "向左", right: "向右", up: "向上", down: "向下" }[answer] || answer || "—";
}

export class RecordsController {
  constructor({ onToast } = {}) {
    this.onToast = onToast || (() => {});
    this.platform = "desktop";
    this.storage = desktopStorage;
    this.loadToken = 0;
    this.sessions = [];
    this.trials = [];
    this.currentLevels = {};
    this.visionTests = [];
    this.currentPage = 1;
    this.loaded = false;
    this.elements = {
      totalSessions: document.querySelector("#totalSessionsKpi"),
      totalTrials: document.querySelector("#totalTrialsKpi"),
      accuracy: document.querySelector("#accuracyKpi"),
      duration: document.querySelector("#durationKpi"),
      currentDifficulty: document.querySelector("#currentDifficultyGrid"),
      difficultyTrends: document.querySelector("#difficultyTrendsGrid"),
      chart: document.querySelector("#accuracyChart"),
      modeSummary: document.querySelector("#modeSummary"),
      sessionsBody: document.querySelector("#sessionsTableBody"),
      empty: document.querySelector("#recordsEmptyState"),
      search: document.querySelector("#sessionSearch"),
      pagination: document.querySelector("#sessionsPagination"),
      refresh: document.querySelector("#refreshDataButton"),
      export: document.querySelector("#exportDataButton"),
      clear: document.querySelector("#clearDataButton"),
      detailPanel: document.querySelector("#trialDetailPanel"),
      detailTitle: document.querySelector("#trialDetailTitle"),
      trialsBody: document.querySelector("#trialsTableBody"),
      closeDetail: document.querySelector("#closeTrialDetail"),
      visionTestCharts: document.querySelector("#visionTestCharts"),
      visionTestsBody: document.querySelector("#visionTestsTableBody"),
      visionTestsEmpty: document.querySelector("#visionTestsEmpty"),
    };
    this.bindEvents();
  }

  selectPlatform(platform) {
    if (!["desktop", "mobile"].includes(platform) || this.platform === platform) return false;
    this.platform = platform;
    this.storage = platform === "mobile" ? mobileStorage : desktopStorage;
    this.loadToken += 1;
    this.loaded = false;
    this.currentPage = 1;
    this.elements.search.value = "";
    this.elements.detailPanel.classList.add("hidden");
    return true;
  }

  bindEvents() {
    document.querySelectorAll("[data-records-platform]").forEach((button) => button.addEventListener("click", () => {
      if (!this.selectPlatform(button.dataset.recordsPlatform)) return;
      this.load();
    }));
    this.elements.refresh.addEventListener("click", () => this.load(true));
    this.elements.export.addEventListener("click", () => this.exportData());
    this.elements.clear.addEventListener("click", () => this.clearData());
    this.elements.search.addEventListener("input", () => {
      this.currentPage = 1;
      this.renderSessions();
    });
    this.elements.pagination.addEventListener("click", (event) => {
      const button = event.target.closest("[data-page]");
      if (!button || button.disabled) return;
      this.currentPage = Number(button.dataset.page);
      this.renderSessions();
      this.elements.sessionsBody.closest(".sessions-panel").scrollIntoView({ behavior: "smooth", block: "start" });
    });
    this.elements.closeDetail.addEventListener("click", () => this.elements.detailPanel.classList.add("hidden"));
    this.elements.sessionsBody.addEventListener("click", (event) => {
      const button = event.target.closest("[data-session-id]");
      if (button) this.showSessionDetails(button.dataset.sessionId);
    });
  }

  invalidate() {
    this.loaded = false;
  }

  async load(showToast = false) {
    const token = ++this.loadToken;
    const storage = this.storage;
    this.elements.export.disabled = true;
    this.elements.clear.disabled = true;
    document.querySelector("#recordsPlatformHint").textContent = "正在读取数据…";
    try {
      await storage.pruneTrainingData(MAX_VISIBLE_SESSIONS);
      const data = await Promise.all([
        storage.getSessions(),
        storage.getAllTrials(),
        storage.getSetting(storage.ADAPTIVE_LEVELS_KEY).then((levels) => levels || {}),
        storage.getVisionTests(),
      ]);
      if (token !== this.loadToken) return;
      [this.sessions, this.trials, this.currentLevels, this.visionTests] = data;
      const mobile = this.platform === "mobile";
      document.querySelectorAll("[data-records-platform]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.recordsPlatform === this.platform)));
      document.querySelector("#recordsPlatformHint").textContent = `当前显示${mobile ? "掌上训练" : "电脑版"}数据；曲线、导出和清空仅针对这一端。两端难度不互通。`;
      this.elements.visionTestCharts.closest(".vision-test-results-panel").classList.toggle("hidden", mobile);
      this.elements.empty.querySelector("a").href = mobile ? "#/mobile" : "#/training";
      this.elements.export.disabled = false;
      this.elements.clear.disabled = false;
      this.loaded = true;
      this.render();
      if (showToast) this.onToast("训练数据已刷新", "success");
    } catch (error) {
      if (token !== this.loadToken) return;
      document.querySelector("#recordsPlatformHint").textContent = "数据读取失败，请点击刷新重试。";
      this.onToast(`读取训练数据失败：${error.message}`, "error");
    }
  }

  render() {
    this.renderKpis();
    this.renderCurrentDifficulty();
    this.renderDifficultyTrends();
    this.renderChart();
    this.renderModeSummary();
    this.renderVisionTests();
    this.renderSessions();
  }

  renderKpis() {
    const formalSessions = this.sessions.filter((session) => !isExperienceSession(session));
    const experienceSessionIds = new Set(this.sessions.filter(isExperienceSession).map((session) => session.id));
    const formalTrials = this.trials.filter((trial) => !trial.isExperience && !experienceSessionIds.has(trial.sessionId));
    const completedSessions = formalSessions.filter((session) => session.status === "completed");
    const totalDuration = formalSessions.reduce((sum, session) => sum + (session.durationMs || 0), 0);
    const completedTrials = completedSessions.reduce((sum, session) => sum + (session.completedTrials || 0), 0);
    const correct = completedSessions.reduce((sum, session) => sum + (session.correctCount || 0), 0);

    this.elements.totalSessions.textContent = String(completedSessions.length);
    this.elements.totalTrials.textContent = String(formalTrials.length);
    this.elements.accuracy.textContent = completedTrials ? `${Math.round(correct / completedTrials * 100)}%` : "—";
    this.elements.duration.textContent = String(Math.round(totalDuration / 60000));
  }

  renderCurrentDifficulty() {
    this.elements.currentDifficulty.innerHTML = MODE_ORDER.map((mode) => {
      const value = this.currentLevels[mode];
      const score = difficultyScore(mode, value);
      const trained = score != null;
      return `
        <article class="current-difficulty-card ${trained ? "" : "untrained"}">
          <div class="difficulty-card-heading">
            <strong>${MODE_INFO[mode].label}</strong>
            <span>${trained ? `${score}/100` : "尚未训练"}</span>
          </div>
          <div class="difficulty-value">${trained ? escapeHtml(formatLevel(mode, value)) : "—"}</div>
          <small>${levelDescription(mode)} · 数值越低越难</small>
          <div class="difficulty-track" aria-label="${MODE_INFO[mode].label}累计难度">
            <i style="width:${score || 0}%"></i>
          </div>
        </article>`;
    }).join("");
  }

  buildDifficultySnapshots() {
    const completedSessions = this.sessions
      .filter((session) => session.status === "completed" && !isExperienceSession(session))
      .slice(0, MAX_VISIBLE_SESSIONS)
      .reverse();
    const levels = {};
    const oldestSession = completedSessions[0];
    MODE_ORDER.forEach((mode) => {
      const initialValue = oldestSession?.initialLevels?.[mode];
      if (this.currentLevels[mode] != null && Number.isFinite(Number(initialValue))) {
        levels[mode] = Number(initialValue);
      }
    });

    return completedSessions.map((session) => {
      const trainedModes = Object.keys(session.modeStats || {}).filter((mode) => MODE_ORDER.includes(mode));
      if (!trainedModes.length) {
        if (MODE_ORDER.includes(session.selectedMode)) trainedModes.push(session.selectedMode);
        else if (session.selectedMode === "mixed") trainedModes.push(...MODE_ORDER);
      }
      trainedModes.forEach((mode) => {
        const value = session.modeStats?.[mode]?.finalLevel ?? session.finalLevels?.[mode];
        if (Number.isFinite(Number(value))) levels[mode] = Number(value);
      });
      return { session, levels: { ...levels } };
    });
  }

  renderDifficultyTrends() {
    const snapshots = this.buildDifficultySnapshots();
    const width = 420;
    const height = 175;
    const padding = { top: 18, right: 16, bottom: 28, left: 54 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;

    this.elements.difficultyTrends.innerHTML = MODE_ORDER.map((mode) => {
      const history = snapshots
        .map(({ session, levels }) => ({
          session,
          value: levels[mode],
          stage: equivalentDifficultyStage(mode, levels[mode]),
        }))
        .filter((point) => point.stage != null);

      if (!history.length) {
        return `
          <article class="difficulty-trend-card" data-mode="${mode}">
            <div class="trend-card-heading"><strong>${MODE_INFO[mode].label}</strong><span>尚无趋势</span></div>
            <div class="difficulty-chart-empty">完成该模式训练后生成曲线</div>
          </article>`;
      }

      const stages = history.map((point) => point.stage);
      const observedMinimum = Math.min(...stages);
      const observedMaximum = Math.max(...stages);
      const paddingStage = observedMaximum === observedMinimum
        ? 2
        : Math.max(0.5, (observedMaximum - observedMinimum) * 0.12);
      const axisMinimum = Math.max(0, observedMinimum - paddingStage);
      const axisMaximum = Math.max(axisMinimum + 1, observedMaximum + paddingStage);
      const axisRange = axisMaximum - axisMinimum;
      const xStep = history.length > 1 ? innerWidth / (history.length - 1) : 0;
      const points = history.map((point, index) => ({
        ...point,
        x: history.length === 1 ? padding.left + innerWidth / 2 : padding.left + index * xStep,
        y: padding.top + (axisMaximum - point.stage) / axisRange * innerHeight,
      }));
      const pointString = points.map((point) => `${point.x},${point.y}`).join(" ");
      const grids = [axisMaximum, (axisMinimum + axisMaximum) / 2, axisMinimum].map((stage) => {
        const y = padding.top + (axisMaximum - stage) / axisRange * innerHeight;
        return `<line class="difficulty-chart-grid" x1="${padding.left}" y1="${y}" x2="${padding.left + innerWidth}" y2="${y}"/><text class="difficulty-chart-label" text-anchor="end" x="${padding.left - 6}" y="${y + 3}">${formatDifficultyStage(stage)}</text>`;
      }).join("");
      const dots = points.map((point) => {
        const tooltipWidth = 66;
        const tooltipHeight = 23;
        const tooltipX = point.x > width / 2 ? point.x - tooltipWidth - 8 : point.x + 8;
        const tooltipY = point.y < 42 ? point.y + 10 : point.y - tooltipHeight - 8;
        return `
          <g class="difficulty-chart-point" tabindex="0" aria-label="${escapeHtml(formatDate(point.session.startedAt, true))}，${formatDifficultyStage(point.stage)}">
            <circle class="difficulty-chart-hit" cx="${point.x}" cy="${point.y}" r="9"/>
            <circle class="difficulty-chart-dot" cx="${point.x}" cy="${point.y}" r="2.7"/>
            <g class="difficulty-point-tooltip" aria-hidden="true">
              <rect x="${tooltipX}" y="${tooltipY}" width="${tooltipWidth}" height="${tooltipHeight}" rx="6"/>
              <text x="${tooltipX + tooltipWidth / 2}" y="${tooltipY + 15}" text-anchor="middle">${formatDifficultyStage(point.stage)}</text>
            </g>
            <title>${escapeHtml(formatDate(point.session.startedAt, true))} · ${formatDifficultyStage(point.stage)} · 当前阈值 ${escapeHtml(formatLevel(mode, point.value))}</title>
          </g>`;
      }).join("");
      const firstDate = formatDate(points[0].session.startedAt).slice(0, 5);
      const lastDate = formatDate(points.at(-1).session.startedAt).slice(0, 5);
      const latest = points.at(-1);

      return `
        <article class="difficulty-trend-card" data-mode="${mode}">
          <div class="trend-card-heading"><strong>${MODE_INFO[mode].label}</strong><span>当前 ${formatDifficultyStage(latest.stage)} · ${escapeHtml(formatLevel(mode, latest.value))}</span></div>
          <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${MODE_INFO[mode].label}等效难度阶数变化曲线">
            ${grids}
            <polyline class="difficulty-chart-line" points="${pointString}"/>
            ${dots}
            <text class="difficulty-chart-current" text-anchor="end" x="${latest.x - 5}" y="${Math.max(11, latest.y - 7)}">${formatDifficultyStage(latest.stage)}</text>
            <text class="difficulty-chart-label" x="${padding.left}" y="${height - 7}">${firstDate}</text>
            <text class="difficulty-chart-label" text-anchor="end" x="${padding.left + innerWidth}" y="${height - 7}">${lastDate}</text>
          </svg>
        </article>`;
    }).join("");
  }

  renderChart() {
    const sessions = this.sessions
      .filter((session) => session.status === "completed" && !isExperienceSession(session))
      .slice(0, 12)
      .reverse();
    if (!sessions.length) {
      this.elements.chart.innerHTML = '<div class="chart-empty">完成训练后将在这里生成趋势图</div>';
      return;
    }

    const width = 720;
    const height = 210;
    const padding = { top: 15, right: 18, bottom: 30, left: 35 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;
    const xStep = sessions.length > 1 ? innerWidth / (sessions.length - 1) : 0;
    const points = sessions.map((session, index) => ({
      x: sessions.length === 1 ? padding.left + innerWidth / 2 : padding.left + index * xStep,
      y: padding.top + innerHeight - session.accuracy * innerHeight,
      session,
    }));
    const pointString = points.map((point) => `${point.x},${point.y}`).join(" ");
    const areaString = `${padding.left},${padding.top + innerHeight} ${pointString} ${padding.left + innerWidth},${padding.top + innerHeight}`;
    const gridLines = [0, .25, .5, .75, 1].map((ratio) => {
      const y = padding.top + innerHeight - ratio * innerHeight;
      return `<line class="chart-grid" x1="${padding.left}" y1="${y}" x2="${padding.left + innerWidth}" y2="${y}"/><text class="chart-label" x="2" y="${y + 3}">${Math.round(ratio * 100)}%</text>`;
    }).join("");
    const labels = points.map((point, index) => {
      const show = sessions.length <= 6 || index % 2 === 0 || index === points.length - 1;
      return show ? `<text class="chart-label" text-anchor="middle" x="${point.x}" y="${height - 7}">${formatDate(point.session.startedAt).slice(0, 5)}</text>` : "";
    }).join("");
    const dots = points.map((point) => `<circle class="chart-dot" cx="${point.x}" cy="${point.y}" r="4"><title>${formatDate(point.session.startedAt)} · ${Math.round(point.session.accuracy * 100)}%</title></circle>`).join("");

    this.elements.chart.innerHTML = `
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="最近训练正确率趋势">
        <defs><linearGradient id="chartGradient" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4968ff" stop-opacity=".22"/><stop offset="1" stop-color="#4968ff" stop-opacity="0"/></linearGradient></defs>
        ${gridLines}<polygon class="chart-area" points="${areaString}"/><polyline class="chart-line" points="${pointString}"/>${dots}${labels}
      </svg>`;
  }

  renderModeSummary() {
    const experienceSessionIds = new Set(this.sessions.filter(isExperienceSession).map((session) => session.id));
    const formalTrials = this.trials.filter((trial) => !trial.isExperience && !experienceSessionIds.has(trial.sessionId));
    this.elements.modeSummary.innerHTML = MODE_ORDER.map((mode) => {
      const trials = formalTrials.filter((trial) => trial.mode === mode);
      const correct = trials.filter((trial) => trial.correct).length;
      const accuracy = trials.length ? Math.round(correct / trials.length * 100) : 0;
      return `
        <div class="mode-bar">
          <div class="mode-bar-header"><strong>${MODE_INFO[mode].label}</strong><span>${trials.length ? `${accuracy}% · ${trials.length} 试次` : "暂无数据"}</span></div>
          <div class="bar-track"><i style="width:${accuracy}%"></i></div>
        </div>`;
    }).join("");
  }

  formatVisionTestValue(test, eyeId) {
    const result = test.results?.[eyeId];
    if (!result?.isolated) return "—";
    const unitValue = (value) => test.metric === "size"
      ? `${Number(value).toFixed(1)} px`
      : `${(Number(value) * 100).toFixed(2)}%`;
    if (!test.crowded || !result.crowded) return unitValue(result.isolated.threshold ?? result.isolated.minimumConfirmed);
    const baseline = unitValue(result.isolated.threshold ?? result.isolated.minimumConfirmed);
    const crowded = unitValue(result.crowded.threshold ?? result.crowded.minimumConfirmed);
    const loss = Number(result.crowdingLossPercent);
    return `${baseline} → ${crowded} (${loss > 0 ? "+" : ""}${Number.isFinite(loss) ? loss.toFixed(1) : "—"}%)`;
  }

  visionChartValue(test, eyeId) {
    const result = test.results?.[eyeId];
    if (!result?.isolated) return null;
    if (test.crowded) return Number.isFinite(Number(result.crowdingLossPercent)) ? Number(result.crowdingLossPercent) : null;
    const raw = Number(result.isolated.threshold ?? result.isolated.minimumConfirmed);
    if (!Number.isFinite(raw)) return null;
    return test.metric === "contrast" ? raw * 100 : raw;
  }

  renderVisionTestChart(mode) {
    const info = TEST_INFO[mode];
    const tests = this.visionTests
      .filter((test) => test.mode === mode && test.status === "completed")
      .slice(0, 12)
      .reverse();
    const unit = info.crowded ? "% 损失" : info.metric === "size" ? "px" : "% 对比度";
    if (!tests.length) {
      return `<article class="vision-test-chart-card" data-test-chart="${mode}">
        <div class="trend-card-heading"><strong>${escapeHtml(info.label)}</strong><span>${unit}</span></div>
        <div class="vision-chart-empty">完成该项目后生成趋势图</div>
      </article>`;
    }

    const eyes = [
      { id: "left", label: "左", color: "#4968ff" },
      { id: "right", label: "右", color: "#8b5aee" },
      { id: "both", label: "双", color: "#18a9bd" },
    ];
    const allValues = tests.flatMap((test) => eyes.map((eye) => this.visionChartValue(test, eye.id))).filter((value) => value != null);
    if (!allValues.length) return "";
    const width = 430;
    const height = 185;
    const padding = { top: 18, right: 15, bottom: 29, left: 48 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;
    const observedMin = Math.min(...allValues);
    const observedMax = Math.max(...allValues);
    const valuePadding = observedMin === observedMax ? Math.max(1, Math.abs(observedMin) * 0.15) : (observedMax - observedMin) * 0.14;
    const axisMin = info.crowded ? Math.min(0, observedMin - valuePadding) : Math.max(0, observedMin - valuePadding);
    const axisMax = Math.max(axisMin + (info.metric === "contrast" ? 0.25 : 1), observedMax + valuePadding);
    const xFor = (index) => tests.length === 1 ? padding.left + innerWidth / 2 : padding.left + index / (tests.length - 1) * innerWidth;
    const yFor = (value) => padding.top + (axisMax - value) / (axisMax - axisMin) * innerHeight;
    const formatAxis = (value) => `${Number(value).toFixed(Math.abs(value) < 10 ? 1 : 0)}${info.metric === "size" && !info.crowded ? "" : "%"}`;
    const grids = [axisMax, (axisMax + axisMin) / 2, axisMin].map((value) => {
      const y = yFor(value);
      return `<line class="difficulty-chart-grid" x1="${padding.left}" y1="${y}" x2="${padding.left + innerWidth}" y2="${y}"/><text class="difficulty-chart-label" text-anchor="end" x="${padding.left - 6}" y="${y + 3}">${formatAxis(value)}</text>`;
    }).join("");
    const lines = eyes.map((eye) => {
      const points = tests.map((test, index) => ({ test, index, value: this.visionChartValue(test, eye.id) })).filter((point) => point.value != null);
      const pointString = points.map((point) => `${xFor(point.index)},${yFor(point.value)}`).join(" ");
      const dots = points.map((point) => `<circle cx="${xFor(point.index)}" cy="${yFor(point.value)}" r="3" fill="#fff" stroke="${eye.color}" stroke-width="2"><title>${eye.label}眼 · ${formatDate(point.test.startedAt, true)} · ${Number(point.value).toFixed(2)} ${unit}</title></circle>`).join("");
      return `${points.length > 1 ? `<polyline points="${pointString}" fill="none" stroke="${eye.color}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>` : ""}${dots}`;
    }).join("");
    const legend = eyes.map((eye, index) => `<g transform="translate(${padding.left + index * 46},8)"><circle r="3" fill="${eye.color}"/><text x="7" y="3" class="difficulty-chart-label">${eye.label}眼</text></g>`).join("");
    const firstDate = formatDate(tests[0].startedAt).slice(0, 5);
    const lastDate = formatDate(tests.at(-1).startedAt).slice(0, 5);

    return `<article class="vision-test-chart-card" data-test-chart="${mode}">
      <div class="trend-card-heading"><strong>${escapeHtml(info.label)}</strong><span>${unit} · ${info.crowded ? "越低越好" : "阈值越低越好"}</span></div>
      <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(info.label)}历史趋势">
        ${legend}${grids}${lines}
        <text class="difficulty-chart-label" x="${padding.left}" y="${height - 7}">${firstDate}</text>
        <text class="difficulty-chart-label" text-anchor="end" x="${padding.left + innerWidth}" y="${height - 7}">${lastDate}</text>
      </svg>
    </article>`;
  }

  renderVisionTests() {
    const modes = ["size", "contrast", "crowded-size", "crowded-contrast"];
    this.elements.visionTestCharts.innerHTML = modes.map((mode) => this.renderVisionTestChart(mode)).join("");
    const recent = this.visionTests.slice(0, 20);
    this.elements.visionTestsEmpty.classList.toggle("hidden", recent.length > 0);
    this.elements.visionTestsBody.innerHTML = recent.map((test) => {
      const complete = test.status === "completed";
      return `<tr>
        <td><strong>${escapeHtml(formatDate(test.startedAt, true))}</strong></td>
        <td>${escapeHtml(test.modeLabel || TEST_INFO[test.mode]?.label || test.mode)}</td>
        <td>${escapeHtml(this.formatVisionTestValue(test, "left"))}</td>
        <td>${escapeHtml(this.formatVisionTestValue(test, "right"))}</td>
        <td>${escapeHtml(this.formatVisionTestValue(test, "both"))}</td>
        <td><span class="result-chip ${complete ? "success" : "incomplete"}">${complete ? "已完成" : "未完成"}</span></td>
      </tr>`;
    }).join("");
  }

  renderSessions() {
    const query = this.elements.search.value.trim().toLowerCase();
    const retainedSessions = this.sessions.slice(0, MAX_VISIBLE_SESSIONS);
    const sessions = retainedSessions.filter((session) => {
      if (!query) return true;
      const typeLabel = isExperienceSession(session) ? "体验模式" : "正式训练";
      return `${session.modeLabel} ${typeLabel} ${formatDate(session.startedAt)} ${session.status}`.toLowerCase().includes(query);
    });
    const pageCount = Math.max(1, Math.ceil(sessions.length / SESSION_PAGE_SIZE));
    this.currentPage = Math.min(Math.max(1, this.currentPage), pageCount);
    const pageStart = (this.currentPage - 1) * SESSION_PAGE_SIZE;
    const pageSessions = sessions.slice(pageStart, pageStart + SESSION_PAGE_SIZE);

    this.elements.empty.classList.toggle("show", !retainedSessions.length);
    this.elements.sessionsBody.innerHTML = pageSessions.map((session) => {
      const completed = session.status === "completed";
      const experience = isExperienceSession(session);
      const modeLabel = escapeHtml(session.modeLabel || MODE_INFO[session.selectedMode]?.label || session.selectedMode);
      return `
        <tr class="${experience ? "experience-session-row" : ""}">
          <td><strong>${escapeHtml(formatDate(session.startedAt, true))}</strong></td>
          <td>${modeLabel}${experience ? '<span class="experience-record-tag">体验</span>' : ""}</td>
          <td><span class="result-chip ${completed ? "success" : "incomplete"}">${completed ? "已完成" : "未完成"} · ${session.completedTrials || 0}/${session.plannedTrials || 0}</span></td>
          <td><strong>${session.completedTrials ? `${Math.round((session.accuracy || 0) * 100)}%` : "—"}</strong></td>
          <td>${escapeHtml(formatDuration(session.durationMs))}</td>
          <td>${escapeHtml(finalLevelText(session))}</td>
          <td><button class="detail-button" type="button" data-session-id="${escapeHtml(session.id)}">查看明细 →</button></td>
        </tr>`;
    }).join("");

    if (retainedSessions.length && !pageSessions.length) {
      this.elements.sessionsBody.innerHTML = '<tr><td colspan="7" class="no-search-result">没有匹配的训练会话。</td></tr>';
    }

    const pageButtons = Array.from({ length: pageCount }, (_, index) => index + 1).map((page) => `
      <button type="button" data-page="${page}" class="${page === this.currentPage ? "active" : ""}" aria-label="第 ${page} 页" aria-current="${page === this.currentPage ? "page" : "false"}">${page}</button>`).join("");
    this.elements.pagination.classList.toggle("hidden", !retainedSessions.length);
    this.elements.pagination.innerHTML = `
      <span>共 ${sessions.length} 条 · 第 ${this.currentPage}/${pageCount} 页</span>
      <div>
        <button type="button" data-page="${this.currentPage - 1}" ${this.currentPage === 1 ? "disabled" : ""} aria-label="上一页">‹</button>
        ${pageButtons}
        <button type="button" data-page="${this.currentPage + 1}" ${this.currentPage === pageCount ? "disabled" : ""} aria-label="下一页">›</button>
      </div>`;
  }

  async showSessionDetails(sessionId) {
    const session = this.sessions.find((item) => item.id === sessionId);
    if (!session) return;
    try {
      const token = this.loadToken;
      const trials = await this.storage.getTrialsBySession(sessionId);
      if (token !== this.loadToken) return;
      const experience = isExperienceSession(session);
      this.elements.detailPanel.classList.toggle("experience-session-detail", experience);
      this.elements.detailTitle.textContent = `${formatDate(session.startedAt, true)} · ${session.modeLabel}${experience ? " · 体验模式" : ""} · ${trials.length} 个试次`;
      this.elements.trialsBody.innerHTML = trials.map((trial) => {
        const parameters = experience || trial.isExperience
          ? `固定难度 ${formatLevel(trial.mode, trial.levelBefore)}`
          : trial.mode === "shifted"
            ? `偏移 ${formatLevel("shifted", trial.levelBefore)} → ${formatLevel("shifted", trial.levelAfter)}`
            : trial.mode === "darker"
              ? `对比差 ${formatLevel("darker", trial.levelBefore)} → ${formatLevel("darker", trial.levelAfter)}`
              : `目标对比 ${formatLevel(trial.mode, trial.levelBefore)} → ${formatLevel(trial.mode, trial.levelAfter)}`;
        return `
          <tr>
            <td>${trial.trialNumber}</td><td><strong>${escapeHtml(trial.modeLabel)}</strong></td>
            <td>${escapeHtml(answerLabel(trial.userAnswer))} / ${escapeHtml(answerLabel(trial.correctAnswer))}</td>
            <td class="${trial.correct ? "answer-good" : "answer-bad"}">${trial.correct ? "正确" : "错误"}</td>
            <td>${trial.reactionTimeMs ?? "—"} ms</td><td class="param-text" title="${escapeHtml(parameters)}">${escapeHtml(parameters)}</td>
          </tr>`;
      }).join("");
      if (!trials.length) this.elements.trialsBody.innerHTML = '<tr><td colspan="6">该会话没有已完成的试次记录。</td></tr>';
      this.elements.detailPanel.classList.remove("hidden");
      this.elements.detailPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      this.onToast(`读取试次明细失败：${error.message}`, "error");
    }
  }

  async exportData() {
    const platform = this.platform;
    try {
      const data = await this.storage.exportTrainingData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `oraen-view-${platform}-data-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      this.onToast("训练数据已导出", "success");
    } catch (error) {
      this.onToast(`导出失败：${error.message}`, "error");
    }
  }

  async clearData() {
    if (!this.sessions.length && !this.trials.length && !this.visionTests.length) {
      this.onToast("当前没有可清理的数据");
      return;
    }
    if (!window.confirm(`确定清空${this.platform === "mobile" ? "掌上训练的记录与难度" : "电脑版的训练、难度与视觉测试记录"}吗？另一端的数据不受影响。此操作不可恢复。`)) return;
    try {
      await this.storage.clearTrainingData();
      this.elements.detailPanel.classList.add("hidden");
      await this.load();
      this.onToast("训练数据已清空", "success");
    } catch (error) {
      this.onToast(`清空失败：${error.message}`, "error");
    }
  }
}
