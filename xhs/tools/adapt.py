"""Initial website-to-mini-tool adaptation. Uses the workspace's existing bs4.
The delivered app/ is independent ES2017 source, with no build dependencies.
"""
from pathlib import Path
import re
import shutil
from bs4 import BeautifulSoup

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'xhs/app'
def read(name): return (ROOT / 'public' / name).read_text(encoding='utf-8')
def write(name, text): (OUT / name).write_text(text, encoding='utf-8')

def methods(source):
    matches = list(re.finditer(r'^  (?:async )?(\w+)\([^\n]*\) \{', source, re.M))
    return {m[1]: source[m.start():matches[i+1].start() if i+1<len(matches) else source.rfind('\n}')].rstrip() for i,m in enumerate(matches)}

def compatible(source):
    source = re.sub(r'^import .*\n', '', source, flags=re.M).replace('export ', '')
    source = source.replace('structuredClone(', 'cloneRecord(')
    substitutions = {
      'this.currentTrial?.mode': '(this.currentTrial || {}).mode',
      'this.currentTrial?.layoutAngle': '(this.currentTrial || {}).layoutAngle',
      'this.session?.isExperience': '(this.session || {}).isExperience',
      'storedLevels?.[mode]': '(storedLevels || {})[mode]',
      'session?.isExperience': '(session || {}).isExperience',
      'session?.sessionType': '(session || {}).sessionType',
      'oldestSession?.initialLevels?.[mode]': '((oldestSession || {}).initialLevels || {})[mode]',
      'session.modeStats?.[mode]?.finalLevel ?? session.finalLevels?.[mode]': 'coalesce(((session.modeStats || {})[mode] || {}).finalLevel, (session.finalLevels || {})[mode])',
      'MODE_INFO[session.selectedMode]?.label': '(MODE_INFO[session.selectedMode] || {}).label',
      'value ?? ""': 'coalesce(value, "")',
      'trial.reactionTimeMs ?? "—"': 'coalesce(trial.reactionTimeMs, "—")',
      'result?.result': '(result || {}).result',
      'points.at(-1)': 'points[points.length - 1]',
      'TASK_MODES.flatMap((mode) => Array(configuredCount).fill(mode))': '[].concat(...TASK_MODES.map((mode) => Array(configuredCount).fill(mode)))',
    }
    for a,b in substitutions.items(): source=source.replace(a,b)
    source=re.sub(r'\.replaceAll\(([^,\n]+), ([^\n]+)\)',r'.split(\1).join(\2)',source)
    # These source objects all start with one spread operand. Convert only that
    # known pattern; any remaining modern syntax causes the delivery scan to fail.
    while True:
      match=re.search(r'\{\s*\.\.\.([\w.]+)\s*([,}])',source)
      if not match: break
      start=match.start(); depth=0; quote=None; escaped=False; end=None
      for i in range(start,len(source)):
        ch=source[i]
        if quote:
          if escaped: escaped=False
          elif ch=='\\': escaped=True
          elif ch==quote: quote=None
          continue
        if ch in "\"'`": quote=ch
        elif ch=='{': depth+=1
        elif ch=='}':
          depth-=1
          if depth==0: end=i;break
      if end is None: raise RuntimeError('unclosed spread object')
      rest=source[match.end():end] if match[2]==',' else ''
      source=source[:start]+'Object.assign({}, '+match[1]+(', {'+rest+'})' if rest.strip() else ')')+source[end+1:]
    return source

# Shared drawing code is unchanged except for ES2017 object construction.
gabor=compatible(read('js/gabor.js'))
write('js/gabor.js','(function () {\n"use strict";\n'+gabor+'\nwindow.ToolGabor = { drawBlank, drawSingle, drawTriple, drawShifted };\n})();\n')

db=read('js/mobile-db.js')
db=db.replace('oraenViewMobileDB','oraenViewXhsDB').replace('mobile:adaptiveLevels:local-user','xhs:adaptiveLevels:local-user')
db=db.replace('export const getSetting = async (key) => (await transaction("settings", "readonly", (tx) => tx.objectStore("settings").get(key)))?.value;', 'export const getSetting = async (key) => { const row = await transaction("settings", "readonly", (tx) => tx.objectStore("settings").get(key)); return row && row.value; };')
db=db[:db.index('export async function exportTrainingData()')]
write('js/storage.js','(function () {\n"use strict";\nconst cloneRecord = window.ToolCompat.cloneRecord;\n'+compatible(db)+'\nwindow.ToolStorage = { ADAPTIVE_LEVELS_KEY, openDatabase, saveTrial, saveSession, getSessions, getAllTrials, getTrialsBySession, getSetting, saveSetting, pruneTrainingData, clearTrainingData };\n})();\n')

source=read('js/training.js'); base=methods(source); mobile=methods(read('js/mobile-training.js'))
prefix=source[source.index('export const MODE_INFO'):source.index('const EXPERIENCE_LEVEL_CONFIG')]
prefix+=source[source.index('function clamp'):source.index('export class TrainingController')]
constructor='''  constructor({ onToast, onSessionChanged } = {}) {
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
'''
keep=['isRunning','mouseAnswerForTrial','buildSequence','beginPreparedSession','loadStartingLevels','persistTrainedLevels','createTrial','presentNextTrial','presentTemporalTrial','drawTemporalInterval','presentShiftedTrial','enterResponseState','showResponseControls','setResponseEnabled','handleAnswer','adaptLevel','completeSession','abortSession','resetStage','updateMetrics','showFixation','showIntervalLabel','showFeedback','hideFeedback','answerLabel']
training=prefix+'\nclass TrainingController {\n'+constructor+'\n'.join(base[n] for n in keep)+'\n}\n'
training+='class MobileTrainingController extends TrainingController {\n'+'\n'.join(v for n,v in mobile.items() if n!='constructor')+'\n}\n'
training=training.replace('    this.canvasSize = this.elements.canvas.getBoundingClientRect().width;','    this.fitCanvas();\n    this.canvasSize = this.elements.canvas.getBoundingClientRect().width;')
# Use measured stage size instead of modern container units. Lock it for a run.
training=training.replace('  async leaveFocusMode() {','''  fitCanvas() {
    const stage = this.elements.canvas.parentElement;
    const size = Math.max(1, Math.min(stage.clientWidth, stage.clientHeight, 480));
    this.elements.canvas.style.width = size + "px";
    this.elements.canvas.style.height = size + "px";
  }
  async leaveFocusMode() {''')
training=training.replace('this.canvasSize !== this.elements.canvas.getBoundingClientRect().width','(this.viewportWidth !== window.innerWidth || this.viewportHeight !== window.innerHeight)')
training=training.replace('    document.body.classList.add("mobile-training-focus");','    document.body.classList.add("mobile-training-focus");\n    this.viewportWidth = window.innerWidth;\n    this.viewportHeight = window.innerHeight;')
training=training.replace('    document.body.classList.remove("mobile-training-focus");','    document.body.classList.remove("mobile-training-focus");\n    this.elements.canvas.style.width = "";\n    this.elements.canvas.style.height = "";')
training=training.replace('if (reason === "escape" || reason === "fullscreen_exit")','if (reason === "escape")')
training=training.replace('this.trials = [];\n    this.currentTrialIndex = 0;','this.trials = [];\n    this.currentTrialIndex = 0;')
write('js/training.js','(function () {\n"use strict";\nconst { cloneRecord, createId } = window.ToolCompat;\nconst { drawBlank, drawSingle, drawTriple, drawShifted } = window.ToolGabor;\n'+compatible(training)+'\nwindow.ToolTraining = { MobileTrainingController, INITIAL_LEVELS, LEVEL_BOUNDS, MODE_INFO };\n})();\n')

source=read('js/records.js'); chunks=methods(source)
constructor=chunks['constructor'].replace('this.platform = "desktop";','this.platform = "mobile";').replace('this.storage = desktopStorage;','this.storage = window.ToolStorage;')
constructor='\n'.join(line for line in constructor.splitlines() if not any(x in line for x in ['export: document','visionTestCharts:','visionTestsBody:','visionTestsEmpty:']))
events=chunks['bindEvents']; a=events.index('    document.querySelectorAll("[data-records-platform]")'); b=events.index('    this.elements.refresh',a); events=events[:a]+events[b:]
events='\n'.join(line for line in events.splitlines() if 'this.elements.export' not in line)
load='''  async load(showToast = false) {
    const token = ++this.loadToken;
    try {
      await this.storage.pruneTrainingData(MAX_VISIBLE_SESSIONS);
      const data = await Promise.all([this.storage.getSessions(), this.storage.getAllTrials(), this.storage.getSetting(this.storage.ADAPTIVE_LEVELS_KEY)]);
      if (token !== this.loadToken) return;
      this.sessions = data[0]; this.trials = data[1]; this.currentLevels = data[2] || {};
      this.loaded = true;
      this.render();
      if (showToast) this.onToast("训练数据已刷新", "success");
    } catch (error) { this.onToast("读取训练数据失败：" + error.message, "error"); }
  }
'''
keep=['render','renderKpis','renderCurrentDifficulty','buildDifficultySnapshots','renderDifficultyTrends','renderChart','renderModeSummary','renderSessions','showSessionDetails','clearData']
records=source[source.index('const MODE_ORDER'):source.index('export class RecordsController')]+ '\nclass RecordsController {\n'+constructor+'\n'+events+'\n'+chunks['invalidate']+'\n'+load+'\n'+'\n'.join(chunks[n] for n in keep)+'\n}\n'
records=records.replace('    this.renderVisionTests();','')
records=re.sub(r'if \(!window.confirm\(`确定清空[^\n]+', 'if (!window.confirm("确定清空小工具中的训练记录与难度吗？此操作不可恢复。")) return;',records)
write('js/records.js','(function () {\n"use strict";\nconst { cloneRecord, coalesce } = window.ToolCompat;\nconst { INITIAL_LEVELS, LEVEL_BOUNDS, MODE_INFO } = window.ToolTraining;\n'+compatible(records)+'\nwindow.ToolRecords = RecordsController;\n})();\n')

soup=BeautifulSoup(read('index.html'),'html.parser')
mobile=soup.select_one('#mobilePage');records=soup.select_one('#recordsPage')
for selector in ['#exportDataButton','.records-platform','#recordsPlatformHint','.vision-test-results-panel']:
    records.select_one(selector).decompose()
records.select_one('.empty-state a')['href']='#/mobile'
records.select_one('.records-header p').string='记录保存在当前小工具中，不会上传。清理小工具数据后记录可能丢失。'
mobile.select_one('.mobile-author-card').decompose()
caption=soup.new_tag('p',attrs={'class':'tool-site-caption'})
caption.string='专业版：view.oraen.com'
mobile.select_one('.mobile-mode-list').insert_after(caption)
for element in mobile.select('[src]'): element['src']='.'+element['src']
html='''<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"><title>开源视觉 Oraen View</title><link rel="icon" href="./images/author-avatar.jpg"><link rel="stylesheet" href="./style.css"></head>
<body><header class="tool-header"><strong>开源视觉</strong><span>ORAEN VIEW</span></header>
<nav class="tool-nav" aria-label="功能菜单"><button type="button" data-route="mobile" aria-pressed="true">掌上训练</button><button type="button" data-route="records" aria-pressed="false">训练数据</button></nav>
<main class="page-container">'''+str(mobile)+str(records)+'''</main>
<p id="startupStatus" class="hidden" role="alert"></p>
<div class="toast-region" id="toastRegion" aria-live="polite"></div>
<script src="./js/compat.js"></script><script src="./js/gabor.js"></script><script src="./js/storage.js"></script><script src="./js/training.js"></script><script src="./js/records.js"></script><script src="./js/app.js"></script></body></html>'''
write('index.html',html)
shutil.copyfile(ROOT/'public/images/author-avatar.jpg',OUT/'images/author-avatar.jpg')
# Keep familiar visuals, drop unused desktop/test-only rules and provide explicit
# Chrome 61 layout overrides in baseline.css (appended during packaging).
css=read('styles.css')
css='\n'.join(line for line in css.splitlines() if not any(x in line for x in [':has(', 'body.training-focus', 'body.testing-focus','container-type:', '100cqw', 'body.mobile-training-focus [data-mobile="trainerPanel"]']))
css=re.sub(r'(?<![\w-])gap:', 'grid-gap:', css)
write('style.css',css+'\n'+(ROOT/'xhs/tools/baseline.css').read_text(encoding='utf-8'))
print('Adapted only training, local storage, records and their page markup into xhs/app')
