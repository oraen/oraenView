const PREFIX = "oraenViewWechat:v1";
const SESSIONS_KEY = PREFIX + ":sessions";
const LEVELS_KEY = PREFIX + ":levels";
const MAX_SESSIONS = 100;
function safeRead(key, fallback) { try { const value = wx.getStorageSync(key); return value || fallback; } catch (error) { return fallback; } }
function write(key, value) { wx.setStorageSync(key, value); }
function trialKey(sessionId) { return PREFIX + ":trials:" + sessionId; }
function getSessions() { const value = safeRead(SESSIONS_KEY, []); return Array.isArray(value) ? value : []; }
function getLevels() { return Object.assign({}, safeRead(LEVELS_KEY, {})); }
function saveLevels(levels) { write(LEVELS_KEY, Object.assign({}, levels)); }
function saveSession(session) {
  const sessions = getSessions(), index = sessions.findIndex((item) => item.id === session.id);
  if (index < 0) sessions.push(session); else sessions[index] = session;
  sessions.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  const removed = sessions.splice(MAX_SESSIONS); removed.forEach((item) => { try { wx.removeStorageSync(trialKey(item.id)); } catch (error) {} });
  write(SESSIONS_KEY, sessions);
}
function saveTrial(trial) { const key = trialKey(trial.sessionId), trials = safeRead(key, []); trials.push(trial); write(key, trials); }
function getTrials(sessionId) { const trials = safeRead(trialKey(sessionId), []); return Array.isArray(trials) ? trials.sort((a, b) => a.trialNumber - b.trialNumber) : []; }
function getData() { const sessions = getSessions().sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)); return { schemaVersion: 1, sessions, trials: [].concat.apply([], sessions.map((item) => getTrials(item.id))), levels: getLevels() }; }
function clear() { getSessions().forEach((item) => wx.removeStorageSync(trialKey(item.id))); wx.removeStorageSync(SESSIONS_KEY); wx.removeStorageSync(LEVELS_KEY); }
module.exports = { STORAGE_KEY: PREFIX, getData, getLevels, saveLevels, saveSession, saveTrial, getTrials, clear };
