export const DB_NAME = "oraenViewChildDB";
export const LEVELS_KEY = "child:levels:local-user";
export const SETTINGS_KEY = "child:anaglyph-settings:local-user";
let database;

function clone(value) { return typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value)); }
function requestResult(request) { return new Promise((resolve, reject) => { request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); }); }
function transactionDone(transaction) { return new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error || new Error("弱视小游戏数据保存已中断")); }); }

export function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore("sessions", { keyPath: "id" });
      db.createObjectStore("trials", { keyPath: "id" });
      db.createObjectStore("settings", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("请关闭其他页面后重试"));
  }).catch((error) => { database = null; throw error; });
  return database;
}

async function all(storeName) {
  const db = await openDatabase(); const tx = db.transaction(storeName, "readonly");
  const value = await requestResult(tx.objectStore(storeName).getAll()); await transactionDone(tx); return value;
}
async function put(storeName, value) {
  const db = await openDatabase(); const tx = db.transaction(storeName, "readwrite");
  tx.objectStore(storeName).put(clone(value)); await transactionDone(tx); return value;
}
export async function saveSession(session) { const saved = await put("sessions", { ...session, platform: "child-web" }); await pruneTrainingData(); return saved; }
export const saveTrial = (trial) => put("trials", { ...trial, platform: "child-web" });
export const getSessions = async () => (await all("sessions")).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
export const getAllTrials = async () => (await all("trials")).sort((a, b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt));
export const getTrialsBySession = async (sessionId) => (await all("trials")).filter((trial) => trial.sessionId === sessionId).sort((a, b) => a.trialNumber - b.trialNumber);
export async function getSetting(key) { const db = await openDatabase(); const tx = db.transaction("settings", "readonly"); const row = await requestResult(tx.objectStore("settings").get(key)); await transactionDone(tx); return row?.value; }
export const saveSetting = (key, value) => put("settings", { key, value, updatedAt: new Date().toISOString() });
export async function pruneTrainingData(limit = 100) {
  const sessions = await getSessions(); const removed = sessions.slice(Math.max(1, limit)); if (!removed.length) return 0;
  const removedIds = new Set(removed.map((session) => session.id)); const trials = await all("trials"); const db = await openDatabase();
  const tx = db.transaction(["sessions", "trials"], "readwrite");
  removedIds.forEach((id) => tx.objectStore("sessions").delete(id));
  trials.filter((trial) => removedIds.has(trial.sessionId)).forEach((trial) => tx.objectStore("trials").delete(trial.id));
  await transactionDone(tx); return removed.length;
}
export async function clearTrainingData() {
  const db = await openDatabase(); const tx = db.transaction(["sessions", "trials", "settings"], "readwrite");
  ["sessions", "trials", "settings"].forEach((name) => tx.objectStore(name).clear()); await transactionDone(tx);
}
export async function exportTrainingData() {
  const [sessions, trials, levels, anaglyphSettings] = await Promise.all([getSessions(), getAllTrials(), getSetting(LEVELS_KEY), getSetting(SETTINGS_KEY)]);
  return { schemaVersion: 1, application: "Oraen View", platform: "child-web", exportedAt: new Date().toISOString(), sessions, trials, settings: { levels: levels || {}, anaglyph: anaglyphSettings || {} } };
}
