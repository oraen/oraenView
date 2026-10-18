const core = require("../../utils/child-games-core");
const storage = require("../../utils/child-storage");
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const BACKGROUND = "#eef2f7";
const MEMORY_MASK_MS = 220;

Page({
  data: { gameName: "弱视小游戏", instruction: "准备开始", progress: "0 / 24", accuracy: "—", level: "1 级", progressWidth: 0, responseType: "target", feedback: "", feedbackClass: "", paused: false },
  onLoad(options) { this.gameId = core.GAMES[options.game] ? options.game : core.GAME_ORDER[0]; this.runToken = 1; this.index = 0; this.correctCount = 0; this.correctStreak = 0; this.incorrectStreak = 0; this.trials = []; this.levels = Object.assign(core.createInitialLevels(), storage.getLevels()); this.settings = storage.getSettings(); this.setData({ gameName: core.GAMES[this.gameId].name, instruction: core.GAMES[this.gameId].instruction, level: this.levels[this.gameId] + " 级" }); },
  onReady() { wx.setKeepScreenOn({ keepScreenOn: true }); this.initSounds(); this.initializeCanvas(); },
  initializeCanvas() {
    wx.createSelectorQuery().select("#childCanvas").fields({ node: true, size: true, rect: true }).exec((result) => {
      const item = result && result[0];
      if (!item || !item.node || !(item.width > 0) || !(item.height > 0)) { wx.showToast({ title: "画布初始化失败", icon: "none" }); return; }
      this.canvas = item.node;
      this.displayWidth = item.width; this.displayHeight = item.height;
      this.canvasLeft = item.left; this.canvasTop = item.top;
      const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
      const ratio = Number(info.pixelRatio) || 1;
      this.canvas.width = Math.round(item.width * ratio); this.canvas.height = Math.round(item.height * ratio);
      this.context = this.canvas.getContext("2d");
      this.context.scale(this.canvas.width / 480, this.canvas.height / 480);
      if (!this.session) this.start();
      else if (this.awaiting || this.previewing) { this.hitRegions = []; this.renderTrial(); }
      else this.drawTransitionMask();
    });
  },
  onResize() { if (this.canvas) this.initializeCanvas(); },
  start() { const startedAt = new Date().toISOString(); this.sequence = core.buildSequence(this.gameId); this.session = { id: core.createId("child-session"), platform: "child-wechat", selectedGame: this.gameId, gameName: core.GAMES[this.gameId].name, plannedTrials: this.sequence.length, completedTrials: 0, correctCount: 0, accuracy: 0, initialLevel: this.levels[this.gameId], finalLevel: this.levels[this.gameId], status: "in_progress", startedAt, endedAt: null, durationMs: 0, glassesSettings: core.GAMES[this.gameId].glasses ? this.settings : null, schemaVersion: 1 }; storage.saveSession(this.session); this.nextTrial(); },
  nextTrial() { if (!this.session || this.session.status !== "in_progress") return; if (this.index >= this.sequence.length) { this.complete(); return; } this.trial = core.createTrial(this.gameId, this.levels[this.gameId]); this.trial.sessionId = this.session.id; this.trial.trialNumber = this.index + 1; this.hitRegions = []; this.awaiting = this.gameId !== "memory-cards"; this.previewing = this.gameId === "memory-cards"; this.responseStartedAt = Date.now(); this.animationElapsed = 0; this.trackingHint = ""; this.renderTrial(); this.updateMetrics(); if (this.previewing) { const token=this.runToken,trialId=this.trial.id; this.previewTimer=setTimeout(()=>{if(token!==this.runToken||!this.trial||this.trial.id!==trialId)return;this.previewing=false;this.hitRegions=[];this.drawTransitionMask();this.memoryMaskTimer=setTimeout(()=>{if(token!==this.runToken||!this.trial||this.trial.id!==trialId)return;this.awaiting=true;this.responseStartedAt=Date.now();this.renderTrial();},MEMORY_MASK_MS);},this.trial.previewMs); } },
  drawTransitionMask() { const ctx=this.context,dark=this.gameId==="firefly-chase";ctx.clearRect(0,0,480,480);ctx.fillStyle=dark?"#17253a":BACKGROUND;ctx.fillRect(0,0,480,480);ctx.fillStyle=dark?"#718196":"#a3adba";ctx.beginPath();ctx.arc(240,240,3,0,Math.PI*2);ctx.fill(); },
  renderTrial() { const ctx = this.context; ctx.clearRect(0, 0, 480, 480); ctx.fillStyle = BACKGROUND; ctx.fillRect(0, 0, 480, 480); this.setData({ responseType: this.trial.responseType }); if (this.gameId === "contrast-stars") this.drawContrastStars(); else if (this.gameId === "orientation-forest") this.drawOrientationForest(); else if (this.gameId === "crowding-c") this.drawCrowdingC(); else if (this.gameId === "vernier-blocks") this.drawVernier(); else if (this.gameId === "fusion-rings") this.drawFusionRings(); else if (this.gameId === "anaglyph-search") this.drawAnaglyphSearch(); else if (this.gameId === "motion-radar") this.drawMotionRadar(); else if (this.gameId === "contour-trail") this.drawContourTrail(); else if (this.gameId === "shape-workshop") this.drawShapeWorkshop(); else if (this.gameId === "memory-cards") this.drawMemoryCards(); else if (this.gameId === "firefly-chase") this.drawFireflyChase(); else this.drawStereoOrbs(); },
  gridPositions(count) { const columns = count <= 4 ? 2 : count <= 9 ? 3 : 4; const rows = Math.ceil(count / columns); const margin = 75, width = 330, height = 330; return Array.from({ length: count }, (_, index) => ({ x: margin + (columns === 1 ? width / 2 : index % columns / (columns - 1) * width), y: margin + (rows === 1 ? height / 2 : Math.floor(index / columns) / (rows - 1) * height) })); },
  drawStar(x, y, outer, inner) { const ctx = this.context; ctx.beginPath(); for (let i = 0; i < 10; i += 1) { const radius = i % 2 ? inner : outer, angle = -Math.PI / 2 + i * Math.PI / 5, px = x + Math.cos(angle) * radius, py = y + Math.sin(angle) * radius; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.closePath(); ctx.fill(); },
  drawContrastStars() { const positions = this.gridPositions(this.trial.count), base = 150, delta = Math.round(this.trial.contrastDelta * 180) * this.trial.polarity, radius = this.trial.starRadius || 27; positions.forEach((point, index) => { const value = base + (index === this.trial.targetIndex ? delta : 0); this.context.fillStyle = "rgb(" + value + "," + value + "," + value + ")"; this.drawStar(point.x, point.y, radius, radius * 4 / 9); this.hitRegions.push(Object.assign({ index, radius: 48 }, point)); }); },
  drawOrientationForest() { this.gridPositions(this.trial.count).forEach((point, index) => { const angle = (index === this.trial.targetIndex ? this.trial.targetAngle : this.trial.baseAngle) * Math.PI / 180, ctx = this.context; ctx.save(); ctx.translate(point.x, point.y); ctx.rotate(angle); ctx.fillStyle = "#26435f"; ctx.fillRect(-5, -31, 10, 62); ctx.beginPath(); ctx.moveTo(0, -39); ctx.lineTo(-13, -20); ctx.lineTo(13, -20); ctx.closePath(); ctx.fill(); ctx.restore(); this.hitRegions.push(Object.assign({ index, radius: 48 }, point)); }); },
  drawLandolt(x, y, size, direction, color, gapAngle) { const angles = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 }, center = angles[direction], gap = gapAngle == null ? .52 : gapAngle, ctx = this.context; ctx.beginPath(); ctx.arc(x, y, size / 2, center + gap / 2, center + Math.PI * 2 - gap / 2); ctx.strokeStyle = color; ctx.lineWidth = Math.max(3, size * .17); ctx.lineCap = "butt"; ctx.stroke(); },
  drawCrowdingC() { const t=this.trial,ctx=this.context;ctx.save();ctx.globalAlpha=t.optotypeContrast;this.drawLandolt(240,240,t.symbolSize,t.correctAnswer,"#18283a",t.gapAngle);const distance=t.symbolSize*t.flankerSpacing;[[0,-1],[1,0],[0,1],[-1,0]].forEach((unit,index)=>this.drawLandolt(240+unit[0]*distance,240+unit[1]*distance,t.symbolSize,t.flankerDirections[index],"#18283a",t.gapAngle));ctx.restore(); },
  drawVernier() { ["left", "right"].forEach((side, index) => { const x = index ? 340 : 140, isCorrect = this.trial.correctAnswer === side, shift = isCorrect ? this.trial.alignedJitter : this.trial.offset, sign = index ? 1 : -1, ctx = this.context; ctx.strokeStyle = "#263a50"; ctx.lineWidth = 8; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x, 125); ctx.lineTo(x, 225); ctx.stroke(); ctx.beginPath(); ctx.moveTo(x + shift * sign, 255); ctx.lineTo(x + shift * sign, 355); ctx.stroke(); }); },
  colors() { const fellow = Number(this.settings.fellowEyeContrast) || .55; if (!this.settings.weakEye || this.settings.weakEye === "unknown") return { red: "rgba(255,0,0,1)", cyan: "rgba(0,210,230,1)" }; const weakRed = this.settings.weakEye === this.settings.redLensEye; return { red: "rgba(255,0,0," + (weakRed ? 1 : fellow) + ")", cyan: "rgba(0,210,230," + (weakRed ? fellow : 1) + ")" }; },
  drawFusionRings() { const colors = this.colors(); ["left", "right"].forEach((side, index) => { const x = index ? 340 : 140, aligned = this.trial.correctAnswer === side, offset = aligned ? 0 : this.trial.offset * (index ? 1 : -1), ctx = this.context; ctx.lineWidth = 13; ctx.strokeStyle = colors.red; ctx.beginPath(); ctx.arc(x, 240, this.trial.ringRadius, Math.PI / 2, Math.PI * 1.5); ctx.stroke(); ctx.strokeStyle = colors.cyan; ctx.beginPath(); ctx.arc(x + offset, 240, this.trial.ringRadius, -Math.PI / 2, Math.PI / 2); ctx.stroke(); }); },
  drawAnaglyphSearch() { const colors = this.colors(); this.gridPositions(this.trial.count).forEach((point, index) => { const offset = index === this.trial.targetIndex ? 0 : this.trial.distractorOffset * (index % 2 ? 1 : -1), ctx = this.context; ctx.lineWidth = 8; ctx.strokeStyle = colors.red; ctx.beginPath(); ctx.moveTo(point.x - 13, point.y); ctx.lineTo(point.x + 13, point.y); ctx.stroke(); ctx.strokeStyle = colors.cyan; ctx.beginPath(); ctx.moveTo(point.x + offset, point.y - 13); ctx.lineTo(point.x + offset, point.y + 13); ctx.stroke(); this.hitRegions.push(Object.assign({ index, radius: 48 }, point)); }); },
  seeded(seed) { let value = (Number(seed) || 1) >>> 0; return () => { value = (value * 1664525 + 1013904223) >>> 0; return value / 4294967296; }; },
  animateTrial(draw) {
    const token = this.runToken, trialId = this.trial.id, generation = (this.animationGeneration || 0) + 1;
    this.animationGeneration = generation;
    const frame = this.canvas.requestAnimationFrame ? (fn) => this.canvas.requestAnimationFrame(fn) : (fn) => setTimeout(() => fn(Date.now()), 32); let previous = null;
    const tick = (now) => {
      if (token !== this.runToken || generation !== this.animationGeneration || !this.trial || trialId !== this.trial.id) return;
      if (this.data.paused) { previous = null; frame(tick); return; }
      if (!(this.awaiting)) return;
      if (previous !== null) this.animationElapsed += Math.max(0, Math.min(80, now - previous));
      previous = now; draw(this.animationElapsed); frame(tick);
    };
    frame(tick);
  },
  drawMotionRadar() {
    this.animateTrial((elapsed) => { const ctx = this.context; ctx.fillStyle = BACKGROUND; ctx.fillRect(0,0,480,480); ctx.fillStyle = "#526274";
      core.motionFrame(this.trial, elapsed).forEach((point) => { ctx.beginPath(); ctx.arc(point.x,point.y,3,0,Math.PI*2); ctx.fill(); });
    });
  },
  drawContourTrail() {
    const ctx=this.context, boxes=[{x:125,y:125},{x:355,y:125},{x:125,y:355},{x:355,y:355}], patches=core.contourPatches(this.trial);
    boxes.forEach((box,index)=>{ctx.strokeStyle="#d5dce6";ctx.lineWidth=2;ctx.strokeRect(box.x-92,box.y-92,184,184);
      ctx.strokeStyle="#8ea0b3";ctx.lineWidth=3;ctx.lineCap="butt";
      patches[index].forEach((line)=>{const x=box.x+line.x,y=box.y+line.y;ctx.beginPath();ctx.moveTo(x-Math.cos(line.angle)*7,y-Math.sin(line.angle)*7);ctx.lineTo(x+Math.cos(line.angle)*7,y+Math.sin(line.angle)*7);ctx.stroke();});
      this.hitRegions.push(Object.assign({index:index,radius:94},box));
    });
  },
  drawPolygon(x, y, radius, sides, rotation, squeeze) { const ctx = this.context, ratio = squeeze == null ? 1 : squeeze; ctx.beginPath(); for (let i = 0; i < sides; i += 1) { const angle = rotation + i * Math.PI * 2 / sides, px = x + Math.cos(angle) * radius, py = y + Math.sin(angle) * radius * ratio; if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); } ctx.closePath(); ctx.stroke(); },
  drawShapeWorkshop() { const ctx = this.context, positions = [{x:90,y:340},{x:190,y:340},{x:290,y:340},{x:390,y:340}], rotation = this.trial.rotation * Math.PI / 180; ctx.fillStyle = "#657489"; ctx.font = "15px sans-serif"; ctx.textAlign = "center"; ctx.fillText("记住这个样板", 240, 72); ctx.strokeStyle = "#20384f"; ctx.lineWidth = 6; this.drawPolygon(240,145,48,this.trial.sides,rotation); positions.forEach((point,index) => { const difference = this.trial.shapeOffsets[index]; ctx.strokeStyle = "#38536d"; ctx.lineWidth = 5; this.drawPolygon(point.x,point.y,37,this.trial.sides,rotation + difference,1 - difference * .22); this.hitRegions.push(Object.assign({index,radius:48},point)); }); },
  drawPattern(x,y,seed,count,scale,variant,difference) { const ctx=this.context;ctx.save();ctx.translate(x,y);core.memoryPattern(seed,count,variant==null?-1:variant,difference||0).forEach((point,i)=>{ctx.fillStyle=i%2?"#7658c9":"#ef9a3c";ctx.beginPath();ctx.arc(point.x*scale,point.y*scale,point.radius*scale,0,Math.PI*2);ctx.fill();});ctx.restore(); },
  drawMemoryCards() { const positions=[{x:90,y:270},{x:190,y:270},{x:290,y:270},{x:390,y:270}],ctx=this.context;ctx.fillStyle="#657489";ctx.font="16px sans-serif";ctx.textAlign="center";if(this.previewing){ctx.fillText("记住这个图案",240,105);ctx.strokeStyle="#cbd3df";ctx.strokeRect(165,145,150,150);this.drawPattern(240,220,this.trial.patternSeed,this.trial.symbolCount,1.15);return;}ctx.fillText("刚才是哪一个？",240,105);positions.forEach((point,index)=>{ctx.strokeStyle="#cbd3df";ctx.strokeRect(point.x-42,point.y-42,84,84);const variant=index===this.trial.targetIndex?-1:index%this.trial.symbolCount,sign=index%2?-1:1;this.drawPattern(point.x,point.y,this.trial.patternSeed,this.trial.symbolCount,.72,variant,this.trial.memoryDifference*sign);this.hitRegions.push(Object.assign({index,radius:48},point));}); },
  fireflyPositions(elapsed) { const rng=this.seeded(this.trial.motionSeed); return Array.from({length:this.trial.count},(_,index)=>{const phase=rng()*Math.PI*2,orbit=88+rng()*78,speed=this.trial.speed*(.65+rng()*.55);return{index,x:240+Math.cos(phase+elapsed*speed)*orbit,y:240+Math.sin(phase*1.3+elapsed*speed*.83)*orbit};}); },
  drawFireflyChase() {
    this.animateTrial((elapsed)=>{const ctx=this.context;ctx.fillStyle="#17253a";ctx.fillRect(0,0,480,480);this.hitRegions=[];
      const hint=elapsed<this.trial.trackingCueMs?"记住发光目标":elapsed<this.trial.trackingCueMs+this.trial.trackingDurationMs?"继续跟踪，先别点击":"现在点中它";
      if(this.trackingHint!==hint){this.trackingHint=hint;this.setData({ trackingHint: hint });}
      this.fireflyPositions(elapsed/1000).forEach((point)=>{const highlighted=point.index===this.trial.targetIndex&&elapsed<this.trial.trackingCueMs;ctx.fillStyle=highlighted?"rgba(255,220,80,.28)":"rgba(130,170,200,.14)";ctx.beginPath();ctx.arc(point.x,point.y,highlighted?this.trial.targetRadius+15:this.trial.targetRadius+7,0,Math.PI*2);ctx.fill();ctx.fillStyle=highlighted?"#ffe86b":"#afc1d1";ctx.beginPath();ctx.arc(point.x,point.y,this.trial.targetRadius,0,Math.PI*2);ctx.fill();this.hitRegions.push(Object.assign({radius:this.trial.targetRadius+15},point));});
    });
  },
  drawStereoOrbs() { const colors=this.colors(),ctx=this.context,nearSign=this.settings.redLensEye==="left"?-1:1;ctx.save();ctx.fillStyle="#000";ctx.fillRect(0,0,480,480);ctx.globalCompositeOperation="lighter";["left","right"].forEach((side,index)=>{const x=index?340:140,near=side===this.trial.correctAnswer,disparity=(near?this.trial.disparity:-this.trial.disparity)*nearSign;ctx.fillStyle=colors.red;ctx.beginPath();ctx.arc(x-disparity/2,240,52,0,Math.PI*2);ctx.fill();ctx.fillStyle=colors.cyan;ctx.beginPath();ctx.arc(x+disparity/2,240,52,0,Math.PI*2);ctx.fill();ctx.strokeStyle="#7b8795";ctx.lineWidth=2;ctx.strokeRect(x-76,164,152,152);});ctx.restore(); },
  tapCanvas(event) {
    if (!this.awaiting || !this.trial || this.trial.responseType !== "target") return;
    if (this.gameId === "firefly-chase" && this.animationElapsed < this.trial.trackingCueMs + this.trial.trackingDurationMs) return;
    // Canvas touch x/y are local; generic tap detail and client coordinates are page-relative.
    const touch = (event.changedTouches && event.changedTouches[0]) || (event.touches && event.touches[0]);
    const detail = event.detail || {};
    let rawX, rawY;
    if (touch && Number.isFinite(touch.x) && Number.isFinite(touch.y)) { rawX = touch.x; rawY = touch.y; }
    else { rawX = (touch ? touch.clientX : detail.x) - (this.canvasLeft || 0); rawY = (touch ? touch.clientY : detail.y) - (this.canvasTop || 0); }
    if (!Number.isFinite(rawX) || !Number.isFinite(rawY) || !(this.displayWidth > 0) || !(this.displayHeight > 0)) return;
    if (rawX < 0 || rawY < 0 || rawX > this.displayWidth || rawY > this.displayHeight) return;
    const x = rawX / this.displayWidth * 480, y = rawY / this.displayHeight * 480;
    let closest;
    this.hitRegions.forEach((region) => { const distance = Math.hypot(region.x - x, region.y - y); if (!closest || distance < closest.distance) closest = { index: region.index, distance, radius: region.radius }; });
    if (closest && closest.distance <= closest.radius) this.handleAnswer(closest.index);
  },
  answer(event) { this.handleAnswer(event.currentTarget.dataset.answer); },
  togglePause() { if (!this.awaiting && !this.data.paused) return; if (!this.data.paused) { this.awaiting = false; this.pausedAt = Date.now(); this.setData({ paused: true, feedback: "训练已暂停", feedbackClass: "" }); } else { this.responseStartedAt += Date.now() - this.pausedAt; this.awaiting = true; this.setData({ paused: false, feedback: "" }); } },
  async handleAnswer(response) { if (!this.awaiting) return; this.awaiting = false; this.hitRegions=[]; this.drawTransitionMask(); const token = this.runToken, correct = core.evaluateTrial(this.trial, response); this.playSound(correct); if (correct) { this.correctCount += 1; this.incorrectStreak = 0; } else this.incorrectStreak += 1; const adapted = core.adaptLevel(this.levels[this.gameId], correct, this.correctStreak); this.levels[this.gameId] = adapted.level; this.correctStreak = adapted.streak; const stored = Object.assign({}, this.trial, { userAnswer: response, correct, levelAfter: adapted.level, reactionTimeMs: Date.now() - this.responseStartedAt, completedAt: new Date().toISOString() }); this.trials.push(stored); storage.saveTrial(stored); this.index += 1; const remind = this.incorrectStreak >= 3; this.setData({ feedback: remind ? "重新集中注意力" : correct ? "答对了！" : "再仔细看看", feedbackClass: correct ? "good" : "bad" }); this.updateMetrics(); await wait(remind ? 1200 : 560); if (token !== this.runToken) return; if (remind) this.incorrectStreak = 0; this.setData({ feedback: "" }); this.nextTrial(); },
  updateMetrics() { this.setData({ progress: this.index + " / " + (this.sequence ? this.sequence.length : 24), accuracy: this.index ? Math.round(this.correctCount / this.index * 100) + "%" : "—", level: this.levels[this.gameId] + " 级", progressWidth: this.index / (this.sequence ? this.sequence.length : 24) * 100 }); },
  initSounds() { if (!wx.createInnerAudioContext) return; const make = (src) => { const audio = wx.createInnerAudioContext(); audio.src = src; audio.volume = 1; audio.obeyMuteSwitch = true; return audio; }; this.sounds = { correct: make("/audio/correct.mp3"), incorrect: make("/audio/incorrect.mp3") }; },
  playSound(correct) { const audio = this.sounds && this.sounds[correct ? "correct" : "incorrect"]; if (audio) { try { audio.stop(); audio.play(); } catch (error) {} } },
  complete() { const endedAt = new Date().toISOString(), summary = core.summarizeTrials(this.trials); this.session = Object.assign({}, this.session, summary, { completedTrials: summary.trials, correctCount: summary.correct, finalLevel: this.levels[this.gameId], status: "completed", endedAt, durationMs: new Date(endedAt) - new Date(this.session.startedAt) }); storage.saveSession(this.session); storage.saveLevels(this.levels); wx.showToast({ title: "训练完成", icon: "success", duration: 900 }); this.returnTimer = setTimeout(() => wx.navigateBack(), 1000); },
  finish() { wx.showModal({ title: "结束本次训练？", content: "已完成的题目会保留。", success: (result) => { if (result.confirm) { this.abort("manual"); wx.navigateBack(); } } }); },
  abort(reason) { if (!this.session || this.session.status !== "in_progress") return; this.runToken += 1; const endedAt = new Date().toISOString(), summary = core.summarizeTrials(this.trials); this.session = Object.assign({}, this.session, summary, { completedTrials: summary.trials, correctCount: summary.correct, finalLevel: this.levels[this.gameId], status: "incomplete", incompleteReason: reason, endedAt, durationMs: new Date(endedAt) - new Date(this.session.startedAt) }); storage.saveSession(this.session); },
  onUnload() { if (this.returnTimer) clearTimeout(this.returnTimer); if (this.previewTimer) clearTimeout(this.previewTimer); if (this.memoryMaskTimer) clearTimeout(this.memoryMaskTimer); this.abort("navigation"); if (this.sounds) Object.keys(this.sounds).forEach((key) => this.sounds[key].destroy()); },
});
