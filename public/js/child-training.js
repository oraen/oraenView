import * as childStorage from "./child-db.js";

const core = window.ChildGamesCore;
const BACKGROUND = "#eef2f7";
const MEMORY_MASK_MS = 220;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export class ChildTrainingController {
  constructor({ onToast, onSessionChanged } = {}) {
    this.onToast = onToast || (() => {});
    this.onSessionChanged = onSessionChanged || (() => {});
    this.state = "idle"; this.runToken = 0; this.session = null; this.trials = []; this.levels = core.createInitialLevels(); this.correctStreak = 0; this.incorrectStreak = 0;
    this.root = document.querySelector("#mobilePage");
    this.modeList = document.querySelector("#mobileModeList");
    this.hub = document.querySelector("#childGameHub");
    this.panel = document.querySelector("#childGamePanel");
    this.canvas = document.querySelector("#childGameCanvas"); this.context = this.canvas.getContext("2d");
    this.cards = document.querySelector("#childGameCards");
    this.renderCards(); this.bindEvents(); this.resetPanel();
  }

  renderCards(levels = this.levels) {
    const currentLevels = Object.assign(core.createInitialLevels(), levels || {});
    this.cards.innerHTML = core.GAME_ORDER.map((id) => {
      const game = core.GAMES[id];
      return `<button type="button" class="child-game-card" data-child-game="${id}" style="--game-color:${game.color}"><i>${game.icon}</i><span><strong>${game.name}</strong><small>${game.tagline}</small><em>${game.skill}${game.glasses ? " · 需红青眼镜" : ""}</em></span><b>${core.normalizeLevel(currentLevels[id])}级</b></button>`;
    }).join("");
  }

  bindEvents() {
    document.querySelector("#childTrainingEntry").addEventListener("click", () => this.openHub());
    document.querySelector("#childHubBack").addEventListener("click", () => this.closeHub());
    this.cards.addEventListener("click", (event) => { const card = event.target.closest("[data-child-game]"); if (card) this.selectGame(card.dataset.childGame); });
    document.querySelector("#childTutorialCancel").addEventListener("click", () => document.querySelector("#childTutorial").classList.add("hidden"));
    document.querySelector("#childTutorialStart").addEventListener("click", () => this.confirmTutorial());
    document.querySelector("#childSetupCancel").addEventListener("click", () => document.querySelector("#childGlassesSetup").classList.add("hidden"));
    document.querySelector("#childSetupStart").addEventListener("click", () => this.saveGlassesSetupAndStart());
    document.querySelector("#childGameExit").addEventListener("click", () => this.abort("exit_button"));
    document.querySelector("#childGamePause").addEventListener("click", () => this.togglePause());
    document.querySelector("#childGameRestart").addEventListener("click", () => this.startGame(this.gameId));
    document.querySelector("#childDirectionPad").addEventListener("click", (event) => { const button = event.target.closest("[data-child-answer]"); if (button) this.answer(button.dataset.childAnswer); });
    document.querySelector("#childSidePad").addEventListener("click", (event) => { const button = event.target.closest("[data-child-answer]"); if (button) this.answer(button.dataset.childAnswer); });
    this.canvas.addEventListener("pointerdown", (event) => this.answerCanvas(event));
    document.addEventListener("visibilitychange", () => { if (document.hidden && this.isRunning()) this.abort("page_hidden", true); });
    window.addEventListener("resize", () => { if (this.isRunning()) this.resizeCanvas(); });
  }

  async openHub() { let levels = this.levels; try { levels = Object.assign(core.createInitialLevels(), await childStorage.getSetting(childStorage.LEVELS_KEY) || {}); } catch {} this.renderCards(levels); this.modeList.classList.add("hidden"); this.hub.classList.remove("hidden"); this.root.querySelector(".mobile-intro").classList.add("hidden"); }
  closeHub() { if (this.isRunning()) return; this.hub.classList.add("hidden"); this.modeList.classList.remove("hidden"); this.root.querySelector(".mobile-intro").classList.remove("hidden"); }
  isRunning() { return !["idle", "completed", "aborted"].includes(this.state); }
  togglePause() {
    if (this.state === "awaiting-response") {
      this.state = "paused"; this.pausedAt = performance.now(); document.querySelector("#childGamePause").textContent = "继续";
      const element = document.querySelector("#childGameFeedback"); element.textContent = "训练已暂停"; element.className = "child-game-feedback show";
    } else if (this.state === "paused") {
      this.responseStartedAt += performance.now() - this.pausedAt; this.state = "awaiting-response"; document.querySelector("#childGamePause").textContent = "暂停"; document.querySelector("#childGameFeedback").className = "child-game-feedback";
    }
  }

  selectGame(gameId) {
    this.gameId = gameId; const game = core.GAMES[gameId];
    document.querySelector("#childTutorialIcon").textContent = game.icon;
    document.querySelector("#childTutorialTitle").textContent = game.name;
    document.querySelector("#childTutorialText").textContent = game.instruction;
    document.querySelector("#childTutorialSkill").textContent = `每局 24 题 · ${game.skill}${game.glasses ? " · 请准备红青眼镜" : " · 双眼自然观看"}`;
    document.querySelector("#childTutorial").classList.remove("hidden");
  }

  async confirmTutorial() {
    document.querySelector("#childTutorial").classList.add("hidden");
    const gameId = this.gameId;
    await this.beginSelectedGame(gameId);
  }

  async beginSelectedGame(gameId) {
    if (core.GAMES[gameId].glasses) {
      const settings = await childStorage.getSetting(childStorage.SETTINGS_KEY);
      if (!settings?.calibrated) { document.querySelector("#childGlassesSetup").classList.remove("hidden"); return; }
      this.glassesSettings = settings;
    }
    this.startGame(gameId);
  }

  async saveGlassesSetupAndStart() {
    const redLensEye = document.querySelector('input[name="redLensEye"]:checked')?.value || "left";
    const weakEye = document.querySelector('input[name="childWeakEye"]:checked')?.value || "unknown";
    const confirmed = document.querySelector("#childCalibrationConfirm").checked;
    if (!confirmed) { this.onToast("请先完成红青镜片检查", "error"); return; }
    this.glassesSettings = { calibrated: true, redLensEye, weakEye, fellowEyeContrast: 0.55, updatedAt: new Date().toISOString() };
    await childStorage.saveSetting(childStorage.SETTINGS_KEY, this.glassesSettings);
    document.querySelector("#childGlassesSetup").classList.add("hidden"); this.startGame(this.gameId);
  }

  async startGame(gameId) {
    if (this.isRunning()) return;
    this.gameId = gameId; this.runToken += 1; const token = this.runToken; this.state = "preparing";
    this.trials = []; this.index = 0; this.correctCount = 0; this.correctStreak = 0; this.incorrectStreak = 0;
    this.levels = Object.assign(core.createInitialLevels(), await childStorage.getSetting(childStorage.LEVELS_KEY) || {});
    this.sequence = core.buildSequence(gameId); this.enterPanel();
    const startedAt = new Date().toISOString();
    this.session = { id: core.createId("child-session"), platform: "child-web", selectedGame: gameId, gameName: core.GAMES[gameId].name, plannedTrials: this.sequence.length, completedTrials: 0, correctCount: 0, accuracy: 0, initialLevel: this.levels[gameId], finalLevel: this.levels[gameId], status: "in_progress", startedAt, endedAt: null, durationMs: 0, glassesSettings: core.GAMES[gameId].glasses ? this.glassesSettings : null, schemaVersion: 1 };
    await childStorage.saveSession(this.session); if (token !== this.runToken) return;
    this.state = "running"; this.nextTrial();
  }

  enterPanel() {
    document.body.classList.add("child-training-focus"); this.panel.classList.remove("hidden");
    document.querySelector("#childGameName").textContent = core.GAMES[this.gameId].name;
    document.querySelector("#childGameInstruction").textContent = core.GAMES[this.gameId].instruction;
    document.querySelector("#childGameRestart").classList.add("hidden");
    document.querySelector("#childGamePause").textContent = "暂停";
    this.resizeCanvas();
  }
  resizeCanvas() { const size = Math.max(160, Math.min(window.innerWidth, window.innerHeight - 210, 480)); this.canvas.style.width = size + "px"; this.canvas.style.height = size + "px"; }

  nextTrial() {
    if (!this.session || this.session.status !== "in_progress") return;
    if (this.index >= this.sequence.length) { this.complete(); return; }
    this.trial = core.createTrial(this.gameId, this.levels[this.gameId]); this.trial.sessionId = this.session.id; this.trial.trialNumber = this.index + 1;
    this.hitRegions = []; this.state = this.gameId === "memory-cards" ? "preview" : "awaiting-response"; this.responseStartedAt = performance.now(); this.animationElapsed = 0; this.trackingHint = ""; this.renderTrial(); this.updateMetrics();
    if (this.gameId === "memory-cards") { const token = this.runToken; const trialId = this.trial.id; setTimeout(() => { if (token !== this.runToken || !this.trial || this.trial.id !== trialId || this.state !== "preview") return; this.state = "transition"; this.hitRegions = []; this.drawTransitionMask(); setTimeout(() => { if (token !== this.runToken || !this.trial || this.trial.id !== trialId || this.state !== "transition") return; this.state = "awaiting-response"; this.responseStartedAt = performance.now(); this.renderTrial(); }, MEMORY_MASK_MS); }, this.trial.previewMs); }
  }

  drawTransitionMask() {
    const ctx = this.context; const dark = this.gameId === "firefly-chase";
    ctx.clearRect(0, 0, 480, 480); ctx.fillStyle = dark ? "#17253a" : BACKGROUND; ctx.fillRect(0, 0, 480, 480);
    ctx.fillStyle = dark ? "#718196" : "#a3adba"; ctx.beginPath(); ctx.arc(240, 240, 3, 0, Math.PI * 2); ctx.fill();
  }

  renderTrial() {
    const ctx = this.context; ctx.clearRect(0, 0, 480, 480); ctx.fillStyle = BACKGROUND; ctx.fillRect(0, 0, 480, 480);
    document.querySelector("#childDirectionPad").classList.toggle("hidden", this.trial.responseType !== "direction");
    document.querySelector("#childSidePad").classList.toggle("hidden", this.trial.responseType !== "side");
    document.querySelector("#childTapHint").classList.toggle("hidden", this.trial.responseType !== "target");
    document.querySelector("#childTapHint").classList.remove("ready-to-tap");
    if (this.gameId !== "memory-cards") document.querySelector("#childTapHint").textContent = this.gameId === "firefly-chase" ? "跟住发光的萤火虫并点中它" : "点一下你找到的目标";
    if (this.gameId === "contrast-stars") this.drawContrastStars();
    else if (this.gameId === "orientation-forest") this.drawOrientationForest();
    else if (this.gameId === "crowding-c") this.drawCrowdingC();
    else if (this.gameId === "vernier-blocks") this.drawVernier();
    else if (this.gameId === "fusion-rings") this.drawFusionRings();
    else if (this.gameId === "anaglyph-search") this.drawAnaglyphSearch();
    else if (this.gameId === "motion-radar") this.drawMotionRadar();
    else if (this.gameId === "contour-trail") this.drawContourTrail();
    else if (this.gameId === "shape-workshop") this.drawShapeWorkshop();
    else if (this.gameId === "memory-cards") this.drawMemoryCards();
    else if (this.gameId === "firefly-chase") this.drawFireflyChase();
    else this.drawStereoOrbs();
  }

  gridPositions(count) {
    const columns = count <= 4 ? 2 : count <= 9 ? 3 : 4; const rows = Math.ceil(count / columns); const margin = 75; const width = 480 - margin * 2; const height = 480 - margin * 2;
    return Array.from({ length: count }, (_, index) => ({ x: margin + (columns === 1 ? width / 2 : index % columns / (columns - 1) * width), y: margin + (rows === 1 ? height / 2 : Math.floor(index / columns) / (rows - 1) * height) }));
  }
  drawContrastStars() {
    const positions = this.gridPositions(this.trial.count); const base = 150; const delta = Math.round(this.trial.contrastDelta * 180) * this.trial.polarity; const radius = this.trial.starRadius || 27;
    positions.forEach((point, index) => { this.context.fillStyle = `rgb(${base + (index === this.trial.targetIndex ? delta : 0)},${base + (index === this.trial.targetIndex ? delta : 0)},${base + (index === this.trial.targetIndex ? delta : 0)})`; this.drawStar(point.x, point.y, radius, radius * 4 / 9); this.hitRegions.push({ ...point, index, radius: 48 }); });
  }
  drawStar(x, y, outer, inner) { const ctx = this.context; ctx.beginPath(); for (let i = 0; i < 10; i += 1) { const radius = i % 2 ? inner : outer; const angle = -Math.PI / 2 + i * Math.PI / 5; const px = x + Math.cos(angle) * radius; const py = y + Math.sin(angle) * radius; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.closePath(); ctx.fill(); }
  drawOrientationForest() {
    const positions = this.gridPositions(this.trial.count); positions.forEach((point, index) => { const angle = (index === this.trial.targetIndex ? this.trial.targetAngle : this.trial.baseAngle) * Math.PI / 180; const ctx = this.context; ctx.save(); ctx.translate(point.x, point.y); ctx.rotate(angle); ctx.fillStyle = "#26435f"; ctx.fillRect(-5, -31, 10, 62); ctx.beginPath(); ctx.moveTo(0, -39); ctx.lineTo(-13, -20); ctx.lineTo(13, -20); ctx.closePath(); ctx.fill(); ctx.restore(); this.hitRegions.push({ ...point, index, radius: 48 }); });
  }
  drawLandolt(x, y, size, direction, color, gapAngle = .52) { const angles = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }; const center = angles[direction]; const ctx = this.context; ctx.beginPath(); ctx.arc(x, y, size / 2, center + gapAngle / 2, center + Math.PI * 2 - gapAngle / 2); ctx.strokeStyle = color; ctx.lineWidth = Math.max(3, size * .17); ctx.lineCap = "butt"; ctx.stroke(); }
  drawCrowdingC() { const t=this.trial,ctx=this.context;ctx.save();ctx.globalAlpha=t.optotypeContrast;this.drawLandolt(240,240,t.symbolSize,t.correctAnswer,"#18283a",t.gapAngle);const distance=t.symbolSize*t.flankerSpacing;[[0,-1],[1,0],[0,1],[-1,0]].forEach((unit,index)=>this.drawLandolt(240+unit[0]*distance,240+unit[1]*distance,t.symbolSize,t.flankerDirections[index],"#18283a",t.gapAngle));ctx.restore(); }
  drawVernier() { ["left", "right"].forEach((side, index) => { const x = index ? 340 : 140; const isCorrect = this.trial.correctAnswer === side; const shift = isCorrect ? this.trial.alignedJitter : this.trial.offset; const sign = index ? 1 : -1; const ctx = this.context; ctx.strokeStyle = isCorrect ? "#263a50" : "#263a50"; ctx.lineWidth = 8; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x, 125); ctx.lineTo(x, 225); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x + shift * sign, 255); ctx.lineTo(x + shift * sign, 355); ctx.stroke(); }); }
  anaglyphColors() {
    const settings = this.glassesSettings || {}; const fellow = Number(settings.fellowEyeContrast) || 0.55;
    if (!settings.weakEye || settings.weakEye === "unknown") return { red: "rgba(255,0,0,1)", cyan: "rgba(0,210,230,1)" };
    const weakUsesRed = settings.weakEye === settings.redLensEye;
    return { red: `rgba(255,0,0,${weakUsesRed ? 1 : fellow})`, cyan: `rgba(0,210,230,${weakUsesRed ? fellow : 1})` };
  }
  drawFusionRings() { const colors = this.anaglyphColors(); ["left", "right"].forEach((side, index) => { const x = index ? 340 : 140; const aligned = this.trial.correctAnswer === side; const offset = aligned ? 0 : this.trial.offset * (index ? 1 : -1); const ctx = this.context; ctx.lineWidth = 13; ctx.strokeStyle = colors.red; ctx.beginPath(); ctx.arc(x, 240, this.trial.ringRadius, Math.PI / 2, Math.PI * 1.5); ctx.stroke(); ctx.strokeStyle = colors.cyan; ctx.beginPath(); ctx.arc(x + offset, 240, this.trial.ringRadius, -Math.PI / 2, Math.PI / 2); ctx.stroke(); }); }
  drawAnaglyphSearch() { const colors = this.anaglyphColors(); const positions = this.gridPositions(this.trial.count); positions.forEach((point, index) => { const offset = index === this.trial.targetIndex ? 0 : this.trial.distractorOffset * (index % 2 ? 1 : -1); const ctx = this.context; ctx.lineWidth = 8; ctx.strokeStyle = colors.red; ctx.beginPath(); ctx.moveTo(point.x - 13, point.y); ctx.lineTo(point.x + 13, point.y); ctx.stroke(); ctx.strokeStyle = colors.cyan; ctx.beginPath(); ctx.moveTo(point.x + offset, point.y - 13); ctx.lineTo(point.x + offset, point.y + 13); ctx.stroke(); this.hitRegions.push({ ...point, index, radius: 48 }); }); }
  seeded(seed) { let value = (Number(seed) || 1) >>> 0; return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; }; }
  animateTrial(draw) {
    const token = this.runToken, trialId = this.trial.id, generation = (this.animationGeneration || 0) + 1;
    this.animationGeneration = generation;
    const frame = (fn) => requestAnimationFrame(fn); let previous = null;
    const tick = (now) => {
      if (token !== this.runToken || generation !== this.animationGeneration || !this.trial || trialId !== this.trial.id) return;
      if (this.state === "paused") { previous = null; frame(tick); return; }
      if (!(this.state === "awaiting-response")) return;
      if (previous !== null) this.animationElapsed += Math.max(0, Math.min(80, now - previous));
      previous = now; draw(this.animationElapsed); frame(tick);
    };
    frame(tick);
  }
  drawMotionRadar() {
    this.animateTrial((elapsed) => { const ctx = this.context; ctx.fillStyle = BACKGROUND; ctx.fillRect(0,0,480,480); ctx.fillStyle = "#526274";
      core.motionFrame(this.trial, elapsed).forEach((point) => { ctx.beginPath(); ctx.arc(point.x,point.y,3,0,Math.PI*2); ctx.fill(); });
    });
  }
  drawContourTrail() {
    const ctx=this.context, boxes=[{x:125,y:125},{x:355,y:125},{x:125,y:355},{x:355,y:355}], patches=core.contourPatches(this.trial);
    boxes.forEach((box,index)=>{ctx.strokeStyle="#d5dce6";ctx.lineWidth=2;ctx.strokeRect(box.x-92,box.y-92,184,184);
      ctx.strokeStyle="#8ea0b3";ctx.lineWidth=3;ctx.lineCap="butt";
      patches[index].forEach((line)=>{const x=box.x+line.x,y=box.y+line.y;ctx.beginPath();ctx.moveTo(x-Math.cos(line.angle)*7,y-Math.sin(line.angle)*7);ctx.lineTo(x+Math.cos(line.angle)*7,y+Math.sin(line.angle)*7);ctx.stroke();});
      this.hitRegions.push(Object.assign({index:index,radius:94},box));
    });
  }
  drawPolygon(x, y, radius, sides, rotation, squeeze = 1) { const ctx = this.context; ctx.beginPath(); for (let i = 0; i < sides; i += 1) { const angle = rotation + i * Math.PI * 2 / sides; const px = x + Math.cos(angle) * radius; const py = y + Math.sin(angle) * radius * squeeze; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.closePath(); ctx.stroke(); }
  drawShapeWorkshop() {
    const ctx = this.context; const positions = [{x:90,y:340},{x:190,y:340},{x:290,y:340},{x:390,y:340}]; const rotation = this.trial.rotation * Math.PI / 180; ctx.fillStyle = "#657489"; ctx.font = "15px sans-serif"; ctx.textAlign = "center"; ctx.fillText("记住这个样板", 240, 72); ctx.strokeStyle = "#20384f"; ctx.lineWidth = 6; this.drawPolygon(240, 145, 48, this.trial.sides, rotation); positions.forEach((point, index) => { const difference = this.trial.shapeOffsets[index]; ctx.strokeStyle = "#38536d"; ctx.lineWidth = 5; this.drawPolygon(point.x, point.y, 37, this.trial.sides, rotation + difference, 1 - difference * .22); this.hitRegions.push({ ...point, index, radius: 48 }); });
  }
  drawPattern(x,y,seed,count,scale,variant,difference) { const ctx=this.context;ctx.save();ctx.translate(x,y);core.memoryPattern(seed,count,variant==null?-1:variant,difference||0).forEach((point,i)=>{ctx.fillStyle=i%2?"#7658c9":"#ef9a3c";ctx.beginPath();ctx.arc(point.x*scale,point.y*scale,point.radius*scale,0,Math.PI*2);ctx.fill();});ctx.restore(); }
  drawMemoryCards() {
    const positions = [{x:90,y:270},{x:190,y:270},{x:290,y:270},{x:390,y:270}]; const ctx = this.context; ctx.fillStyle = "#657489"; ctx.font = "16px sans-serif"; ctx.textAlign = "center";
    if (this.state === "preview") { ctx.fillText("记住这个图案", 240, 105); ctx.strokeStyle = "#cbd3df"; ctx.strokeRect(165, 145, 150, 150); this.drawPattern(240, 220, this.trial.patternSeed, this.trial.symbolCount, 1.15); document.querySelector("#childTapHint").textContent = "先记住样板"; return; }
    ctx.fillText("刚才是哪一个？", 240, 105); positions.forEach((point, index) => { ctx.strokeStyle = "#cbd3df"; ctx.strokeRect(point.x - 42, point.y - 42, 84, 84); const variant = index === this.trial.targetIndex ? -1 : index % this.trial.symbolCount; const sign = index % 2 ? -1 : 1; this.drawPattern(point.x, point.y, this.trial.patternSeed, this.trial.symbolCount, .72, variant, this.trial.memoryDifference * sign); this.hitRegions.push({ ...point, index, radius: 48 }); }); document.querySelector("#childTapHint").textContent = "点一下刚才的图案";
  }
  fireflyPositions(elapsed) { const rng = this.seeded(this.trial.motionSeed); return Array.from({ length: this.trial.count }, (_, index) => { const phase = rng() * Math.PI * 2; const orbit = 88 + rng() * 78; const speed = this.trial.speed * (.65 + rng() * .55); return { index, x: 240 + Math.cos(phase + elapsed * speed) * orbit, y: 240 + Math.sin(phase * 1.3 + elapsed * speed * .83) * orbit }; }); }
  drawFireflyChase() {
    this.animateTrial((elapsed)=>{const ctx=this.context;ctx.fillStyle="#17253a";ctx.fillRect(0,0,480,480);this.hitRegions=[];
      const hint=elapsed<this.trial.trackingCueMs?"记住发光目标":elapsed<this.trial.trackingCueMs+this.trial.trackingDurationMs?"继续跟踪，先别点击":"现在点中它";
      if(this.trackingHint!==hint){this.trackingHint=hint;const element=document.querySelector("#childTapHint");element.textContent=hint;element.classList.toggle("ready-to-tap",hint==="现在点中它");}
      this.fireflyPositions(elapsed/1000).forEach((point)=>{const highlighted=point.index===this.trial.targetIndex&&elapsed<this.trial.trackingCueMs;ctx.fillStyle=highlighted?"rgba(255,220,80,.28)":"rgba(130,170,200,.14)";ctx.beginPath();ctx.arc(point.x,point.y,highlighted?this.trial.targetRadius+15:this.trial.targetRadius+7,0,Math.PI*2);ctx.fill();ctx.fillStyle=highlighted?"#ffe86b":"#afc1d1";ctx.beginPath();ctx.arc(point.x,point.y,this.trial.targetRadius,0,Math.PI*2);ctx.fill();this.hitRegions.push(Object.assign({radius:this.trial.targetRadius+15},point));});
    });
  }
  drawStereoOrbs() {
    const colors = this.anaglyphColors(); const ctx = this.context; const nearSign = (this.glassesSettings || {}).redLensEye === "left" ? -1 : 1; ctx.save();ctx.fillStyle="#000";ctx.fillRect(0,0,480,480);ctx.globalCompositeOperation="lighter";["left", "right"].forEach((side, index) => { const x = index ? 340 : 140; const near = side === this.trial.correctAnswer; const disparity = (near ? this.trial.disparity : -this.trial.disparity) * nearSign;  ctx.fillStyle = colors.red; ctx.beginPath(); ctx.arc(x - disparity / 2, 240, 52, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = colors.cyan; ctx.beginPath(); ctx.arc(x + disparity / 2, 240, 52, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = "#7b8795"; ctx.lineWidth = 2; ctx.strokeRect(x - 76, 164, 152, 152); });ctx.restore();
  }

  answerCanvas(event) {
    if (this.state !== "awaiting-response" || this.trial.responseType !== "target") return;
    if (this.gameId === "firefly-chase" && this.animationElapsed < this.trial.trackingCueMs + this.trial.trackingDurationMs) return;
    const box = this.canvas.getBoundingClientRect(); const x = (event.clientX - box.left) / box.width * 480; const y = (event.clientY - box.top) / box.height * 480;
    let closest = null; this.hitRegions.forEach((region) => { const distance = Math.hypot(region.x - x, region.y - y); if (!closest || distance < closest.distance) closest = { index: region.index, distance, radius: region.radius }; });
    if (closest && closest.distance <= closest.radius) this.answer(closest.index);
  }

  async answer(response) {
    if (this.state !== "awaiting-response") return; const token = this.runToken; this.state = "feedback";
    this.hitRegions = []; this.drawTransitionMask();
    const correct = core.evaluateTrial(this.trial, response); this.playSound(correct); if (correct) { this.correctCount += 1; this.incorrectStreak = 0; } else this.incorrectStreak += 1;
    const adapted = core.adaptLevel(this.levels[this.gameId], correct, this.correctStreak); this.levels[this.gameId] = adapted.level; this.correctStreak = adapted.streak;
    const stored = Object.assign({}, this.trial, { userAnswer: response, correct, levelAfter: adapted.level, reactionTimeMs: Math.round(performance.now() - this.responseStartedAt), completedAt: new Date().toISOString() });
    this.trials.push(stored); await childStorage.saveTrial(stored); if (token !== this.runToken) return;
    this.index += 1; this.showFeedback(correct); this.updateMetrics(); await wait(this.incorrectStreak >= 3 ? 1200 : 560); if (token !== this.runToken) return; if (this.incorrectStreak >= 3) this.incorrectStreak = 0; this.nextTrial();
  }
  playSound(correct) { try { const audio = new Audio(correct ? "/audio/correct.mp3" : "/audio/incorrect.mp3"); audio.volume = 1; audio.play().catch(() => {}); } catch {} }
  showFeedback(correct) { const element = document.querySelector("#childGameFeedback"); element.textContent = correct ? "答对了！" : "再仔细看看"; element.className = `child-game-feedback show ${correct ? "good" : "bad"}`; setTimeout(() => { element.className = "child-game-feedback"; }, 480); }
  updateMetrics() { document.querySelector("#childGameProgress").textContent = `${this.index} / ${this.sequence?.length || core.DEFAULT_TRIALS}`; document.querySelector("#childGameAccuracy").textContent = this.index ? `${Math.round(this.correctCount / this.index * 100)}%` : "—"; document.querySelector("#childGameLevel").textContent = `${this.levels[this.gameId] || 1} 级`; document.querySelector("#childGameProgressBar").style.width = `${this.index / (this.sequence?.length || core.DEFAULT_TRIALS) * 100}%`; }

  async complete() {
    this.state = "completed"; const endedAt = new Date().toISOString(); const summary = core.summarizeTrials(this.trials);
    this.session = Object.assign({}, this.session, summary, { completedTrials: summary.trials, correctCount: summary.correct, finalLevel: this.levels[this.gameId], status: "completed", endedAt, durationMs: new Date(endedAt) - new Date(this.session.startedAt) });
    await Promise.all([childStorage.saveSession(this.session), childStorage.saveSetting(childStorage.LEVELS_KEY, this.levels)]); await childStorage.pruneTrainingData(); this.renderCards(this.levels); this.onSessionChanged();
    document.querySelector("#childGameInstruction").textContent = `完成 ${summary.trials} 题，正确率 ${Math.round(summary.accuracy * 100)}%，当前 ${this.levels[this.gameId]} 级。`;
    document.querySelector("#childGameRestart").classList.remove("hidden"); this.context.fillStyle = BACKGROUND; this.context.fillRect(0, 0, 480, 480); this.context.fillStyle = "#263a50"; this.context.textAlign = "center"; this.context.font = "700 28px sans-serif"; this.context.fillText("训练完成", 240, 235); this.context.font = "16px sans-serif"; this.context.fillText("休息一下，看看远处", 240, 270);
  }
  async abort(reason, silent = false) {
    if (!this.isRunning()) { this.leavePanel(); return; }
    if (!silent && !window.confirm("结束本次弱视小游戏？已完成的题目会保留。")) return;
    this.runToken += 1; this.state = "aborted"; const endedAt = new Date().toISOString(); const summary = core.summarizeTrials(this.trials);
    if (this.session) { this.session = Object.assign({}, this.session, summary, { completedTrials: summary.trials, correctCount: summary.correct, finalLevel: this.levels[this.gameId], status: "incomplete", incompleteReason: reason, endedAt, durationMs: new Date(endedAt) - new Date(this.session.startedAt) }); await childStorage.saveSession(this.session); }
    this.leavePanel(); this.onSessionChanged();
  }
  leavePanel() { document.body.classList.remove("child-training-focus"); this.panel.classList.add("hidden"); this.canvas.style.width = ""; this.canvas.style.height = ""; this.state = "idle"; }
  resetPanel() { this.context.fillStyle = BACKGROUND; this.context.fillRect(0, 0, 480, 480); }
}
