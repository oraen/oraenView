const PREFIX = "oraenViewWechat:child:v1";
const SESSIONS_KEY = PREFIX + ":sessions";
const LEVELS_KEY = PREFIX + ":levels";
const SETTINGS_KEY = PREFIX + ":anaglyph";
const MAX_SESSIONS = 100;

function read(key, fallback) { try { const value = wx.getStorageSync(key); return value || fallback; } catch (error) { return fallback; } }
function write(key, value) { wx.setStorageSync(key, value); }
function trialKey(sessionId) { return PREFIX + ":trials:" + sessionId; }
function getSessions() { const value = read(SESSIONS_KEY, []); return Array.isArray(value) ? value : []; }
function getLevels() { return Object.assign({}, read(LEVELS_KEY, {})); }
function saveLevels(levels) { write(LEVELS_KEY, Object.assign({}, levels)); }
function getSettings() { return Object.assign({}, read(SETTINGS_KEY, {})); }
function saveSettings(settings) { write(SETTINGS_KEY, Object.assign({}, settings)); }
function saveSession(session) {
  const sessions = getSessions(); const index = sessions.findIndex((item) => item.id === session.id);
  if (index < 0) sessions.push(session); else sessions[index] = session;
  sessions.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  sessions.splice(MAX_SESSIONS).forEach((item) => { try { wx.removeStorageSync(trialKey(item.id)); } catch (error) {} });
  write(SESSIONS_KEY, sessions);
}
function saveTrial(trial) { const key = trialKey(trial.sessionId); const trials = read(key, []); trials.push(trial); write(key, trials); }
function getTrials(sessionId) { const value = read(trialKey(sessionId), []); return Array.isArray(value) ? value.slice().sort((a, b) => a.trialNumber - b.trialNumber) : []; }
function getData() { const sessions = getSessions().sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)); return { schemaVersion: 1, platform: "child-wechat", sessions, trials: [].concat.apply([], sessions.map((item) => getTrials(item.id))), levels: getLevels(), settings: getSettings() }; }
function clear() { getSessions().forEach((item) => wx.removeStorageSync(trialKey(item.id))); [SESSIONS_KEY, LEVELS_KEY, SETTINGS_KEY].forEach((key) => wx.removeStorageSync(key)); }

module.exports = { STORAGE_KEY: PREFIX, getData, getSessions, getTrials, getLevels, saveLevels, getSettings, saveSettings, saveSession, saveTrial, clear };
