(function () {
"use strict";
const { cloneRecord, coalesce } = window.ToolCompat;
const { INITIAL_LEVELS, LEVEL_BOUNDS, MODE_INFO } = window.ToolTraining;
const MODE_ORDER = ["single", "triple", "darker", "shifted"];
const SESSION_PAGE_SIZE = 20;
const MAX_VISIBLE_SESSIONS = 100;

function isExperienceSession(session) {
  return (session || {}).isExperience === true || (session || {}).sessionType === "experience";
}

function escapeHtml(value) {
  return String(coalesce(value, ""))
    .split("&").join("&amp;")
    .split("<").join("&lt;")
    .split(">").join("&gt;")
    .split('"').join("&quot;")
    .split("'").join("&#039;");
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


class RecordsController {
  constructor({ onToast } = {}) {
    this.onToast = onToast || (() => {});
    this.platform = "mobile";
    this.storage = window.ToolStorage;
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
      clear: document.querySelector("#clearDataButton"),
      detailPanel: document.querySelector("#trialDetailPanel"),
      detailTitle: document.querySelector("#trialDetailTitle"),
      trialsBody: document.querySelector("#trialsTableBody"),
      closeDetail: document.querySelector("#closeTrialDetail"),
    };
    this.bindEvents();
  }
  bindEvents() {
    document.querySelectorAll("[data-records-platform]").forEach((button) => button.addEventListener("click", () => {
      const platform = button.getAttribute("data-records-platform");
      if (platform === this.platform) return;
      this.platform = platform;
      this.storage = platform === "child" ? window.ChildToolStorage : window.ToolStorage;
      this.currentPage = 1;
      this.elements.search.value = "";
      this.elements.detailPanel.classList.add("hidden");
      this.load();
    }));
    this.elements.refresh.addEventListener("click", () => this.load(true));
    this.elements.clear.addEventListener("click", () => this.clearData());
    this.elements.search.addEventListener("input", () => {
      this.currentPage = 1;
      this.renderVisibleSessions();
    });
    this.elements.pagination.addEventListener("click", (event) => {
      const button = event.target.closest("[data-page]");
      if (!button || button.disabled) return;
      this.currentPage = Number(button.dataset.page);
      this.renderVisibleSessions();
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
  renderVisibleSessions() { if (this.platform === "child") this.renderChildSessions(); else this.renderSessions(); }
  async load(showToast = false) {
    const token = ++this.loadToken;
    try {
      await this.storage.pruneTrainingData(MAX_VISIBLE_SESSIONS);
      const levelsKey = this.platform === "child" ? this.storage.LEVELS_KEY : this.storage.ADAPTIVE_LEVELS_KEY;
      const data = await Promise.all([this.storage.getSessions(), this.storage.getAllTrials(), this.storage.getSetting(levelsKey)]);
      if (token !== this.loadToken) return;
      this.sessions = data[0]; this.trials = data[1]; this.currentLevels = data[2] || {};
      document.querySelectorAll("[data-records-platform]").forEach((button) => button.setAttribute("aria-pressed", String(button.getAttribute("data-records-platform") === this.platform)));
      document.querySelector("#recordsPlatformHint").textContent = this.platform === "child" ? "当前显示弱视小游戏数据；记录、等级和清空均与掌上训练隔离。" : "当前显示掌上训练数据；记录、难度和清空均与弱视小游戏隔离。";
      this.loaded = true;
      this.render();
      if (showToast) this.onToast("训练数据已刷新", "success");
    } catch (error) { this.onToast("读取训练数据失败：" + error.message, "error"); }
  }

  render() {
    if (this.platform === "child") { this.renderChild(); return; }
    this.renderKpis();
    this.renderCurrentDifficulty();
    this.renderDifficultyTrends();
    this.renderChart();
    this.renderModeSummary();

    this.renderSessions();
  }
  renderChild() {
    const core = window.ChildGamesCore;
    const completed = this.sessions.filter((item) => item.status === "completed");
    const completedIds = new Set(completed.map((item) => item.id));
    const trials = this.trials.filter((item) => completedIds.has(item.sessionId));
    const correct = trials.filter((item) => item.correct).length;
    this.elements.totalSessions.textContent = String(completed.length);
    this.elements.totalTrials.textContent = String(trials.length);
    this.elements.accuracy.textContent = trials.length ? Math.round(correct / trials.length * 100) + "%" : "—";
    this.elements.duration.textContent = String(Math.round(completed.reduce((sum, item) => sum + (item.durationMs || 0), 0) / 60000));
    this.elements.currentDifficulty.innerHTML = core.GAME_ORDER.map((id) => {
      const value = this.currentLevels[id], trained = Number.isFinite(Number(value)), score = trained ? core.difficultyScore(value) : 0, game = core.GAMES[id];
      return '<article class="current-difficulty-card '+(trained?'':'untrained')+'"><div class="difficulty-card-heading"><strong>'+escapeHtml(game.name)+'</strong><span>'+(trained?score+'/100':'尚未训练')+'</span></div><div class="difficulty-value">'+(trained?value+' 级':'—')+'</div><small>'+escapeHtml(game.skill+(game.glasses?' · 红青分视':''))+'</small><div class="difficulty-track"><i style="width:'+score+'%"></i></div></article>';
    }).join("");
    this.renderChart();
    this.elements.modeSummary.innerHTML = core.GAME_ORDER.map((id) => {
      const items = trials.filter((trial) => trial.gameId === id), rate = items.length ? Math.round(items.filter((trial) => trial.correct).length / items.length * 100) : 0;
      return '<div class="mode-bar"><div class="mode-bar-header"><strong>'+escapeHtml(core.GAMES[id].name)+'</strong><span>'+(items.length?rate+'% · '+items.length+' 题':'暂无数据')+'</span></div><div class="bar-track"><i style="width:'+rate+'%"></i></div></div>';
    }).join("");
    this.renderChildTrends(); this.renderChildSessions();
  }
  renderChildTrends() {
    const core = window.ChildGamesCore;
    this.elements.difficultyTrends.innerHTML = core.GAME_ORDER.map((id) => {
      const items = this.sessions.filter((item) => item.status === "completed" && item.selectedGame === id).slice(0, 20).reverse();
      if (!items.length) return '<article class="difficulty-trend-card"><div class="trend-card-heading"><strong>'+escapeHtml(core.GAMES[id].name)+'</strong><span>尚未训练</span></div><div class="difficulty-chart-empty">完成游戏后生成等级曲线</div></article>';
      const points = items.map((item, index) => ({ x: items.length === 1 ? 190 : 24 + index / (items.length - 1) * 332, y: 14 + (core.MAX_LEVEL - Number(item.finalLevel)) / (core.MAX_LEVEL - 1) * 88, level: item.finalLevel }));
      return '<article class="difficulty-trend-card"><div class="trend-card-heading"><strong>'+escapeHtml(core.GAMES[id].name)+'</strong><span>当前 '+points[points.length-1].level+' 级</span></div><svg viewBox="0 0 380 120"><polyline class="difficulty-chart-line" points="'+points.map((point) => point.x+','+point.y).join(' ')+'"/>'+points.map((point) => '<circle class="difficulty-chart-dot" cx="'+point.x+'" cy="'+point.y+'" r="3"/>').join('')+'</svg></article>';
    }).join("");
  }
  renderChildSessions() {
    const query = this.elements.search.value.trim().toLowerCase(), core = window.ChildGamesCore;
    const filtered = this.sessions.filter((item) => !query || ((item.gameName || "") + " " + formatDate(item.startedAt)).toLowerCase().includes(query));
    const pages = Math.max(1, Math.ceil(filtered.length / SESSION_PAGE_SIZE)); this.currentPage = Math.min(this.currentPage, pages);
    const visible = filtered.slice((this.currentPage - 1) * SESSION_PAGE_SIZE, this.currentPage * SESSION_PAGE_SIZE);
    this.elements.sessionsBody.innerHTML = visible.map((item) => '<tr><td><strong>'+escapeHtml(formatDate(item.startedAt,true))+'</strong></td><td>'+escapeHtml(item.gameName||((core.GAMES[item.selectedGame]||{}).name)||'弱视小游戏')+'</td><td><span class="result-chip '+(item.status==='completed'?'success':'incomplete')+'">'+(item.status==='completed'?'已完成':'未完成')+' · '+(item.completedTrials||0)+'/'+(item.plannedTrials||24)+'</span></td><td><strong>'+(item.completedTrials?Math.round((item.accuracy||0)*100)+'%':'—')+'</strong></td><td>'+escapeHtml(formatDuration(item.durationMs))+'</td><td>'+Number(item.finalLevel||item.initialLevel||1)+' 级</td><td><button class="detail-button" data-session-id="'+escapeHtml(item.id)+'">查看明细 →</button></td></tr>').join('');
    this.elements.empty.classList.toggle('show', !filtered.length); this.elements.pagination.classList.toggle('hidden', pages <= 1);
    this.elements.pagination.innerHTML = Array.from({ length: pages }, (_, index) => '<button data-page="'+(index+1)+'" '+(index+1===this.currentPage?'disabled':'')+'>'+(index+1)+'</button>').join('');
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
      const initialValue = ((oldestSession || {}).initialLevels || {})[mode];
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
        const value = coalesce(((session.modeStats || {})[mode] || {}).finalLevel, (session.finalLevels || {})[mode]);
        if (Number.isFinite(Number(value))) levels[mode] = Number(value);
      });
      return { session, levels: Object.assign({}, levels) };
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
      const points = history.map((point, index) => (Object.assign({}, point, {
        x: history.length === 1 ? padding.left + innerWidth / 2 : padding.left + index * xStep,
        y: padding.top + (axisMaximum - point.stage) / axisRange * innerHeight,
      })));
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
      const lastDate = formatDate(points[points.length - 1].session.startedAt).slice(0, 5);
      const latest = points[points.length - 1];

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
      const modeLabel = escapeHtml(session.modeLabel || (MODE_INFO[session.selectedMode] || {}).label || session.selectedMode);
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
      if (this.platform === "child") {
        const game = window.ChildGamesCore.GAMES[session.selectedGame];
        this.elements.detailPanel.classList.remove("experience-session-detail");
        this.elements.detailTitle.textContent = formatDate(session.startedAt, true) + " · " + (session.gameName || (game && game.name) || "弱视小游戏") + " · " + trials.length + " 个试次";
        this.elements.trialsBody.innerHTML = trials.map((trial) => '<tr><td>'+trial.trialNumber+'</td><td><strong>'+escapeHtml(session.gameName||(game&&game.name)||'弱视小游戏')+'</strong></td><td>'+escapeHtml(trial.userAnswer)+' / '+escapeHtml(window.ChildGamesCore.expectedAnswer(trial))+'</td><td class="'+(trial.correct?'answer-good':'answer-bad')+'">'+(trial.correct?'正确':'错误')+'</td><td>'+coalesce(trial.reactionTimeMs,'—')+' ms</td><td>'+trial.levelBefore+' 级 → '+trial.levelAfter+' 级</td></tr>').join('');
        if (!trials.length) this.elements.trialsBody.innerHTML = '<tr><td colspan="6">该会话没有已完成的试次记录。</td></tr>';
        this.elements.detailPanel.classList.remove("hidden");
        this.elements.detailPanel.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
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
            <td>${coalesce(trial.reactionTimeMs, "—")} ms</td><td class="param-text" title="${escapeHtml(parameters)}">${escapeHtml(parameters)}</td>
          </tr>`;
      }).join("");
      if (!trials.length) this.elements.trialsBody.innerHTML = '<tr><td colspan="6">该会话没有已完成的试次记录。</td></tr>';
      this.elements.detailPanel.classList.remove("hidden");
      this.elements.detailPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      this.onToast(`读取试次明细失败：${error.message}`, "error");
    }
  }
  async clearData() {
    if (!this.sessions.length && !this.trials.length && !this.visionTests.length) {
      this.onToast("当前没有可清理的数据");
      return;
    }
    if (!window.confirm("确定清空" + (this.platform === "child" ? "弱视小游戏" : "掌上训练") + "的记录与难度吗？另一类数据不受影响。此操作不可恢复。")) return;
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

window.ToolRecords = RecordsController;
})();
