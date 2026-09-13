// Deliberately separate from db.js: no desktop migration, reads, or fallback.
export const DB_NAME = "oraenViewMobileDB";
export const ADAPTIVE_LEVELS_KEY = "mobile:adaptiveLevels:local-user";
let database;

export function openDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      for (const name of ["sessions", "trials", "settings"]) {
        request.result.createObjectStore(name, { keyPath: name === "settings" ? "key" : "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("请关闭其他页面后重试"));
  }).catch((error) => { database = null; throw error; });
  return database;
}

async function transaction(stores, mode, action) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let result;
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("保存已中断"));
    result = action(tx);
  });
}

const read = (store) => transaction(store, "readonly", (tx) => tx.objectStore(store).getAll());
const put = (store, record) => transaction(store, "readwrite", (tx) => tx.objectStore(store).put(structuredClone(record)));
export const saveTrial = (trial) => put("trials", { ...trial, platform: "mobile" });
export async function saveSession(session) {
  await put("sessions", { ...session, platform: "mobile" });
  await pruneTrainingData();
}
export const getSessions = async () => (await read("sessions")).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
export const getAllTrials = async () => (await read("trials")).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
export const getTrialsBySession = async (id) => (await read("trials")).filter((trial) => trial.sessionId === id).sort((a, b) => a.trialNumber - b.trialNumber);
export const getSetting = async (key) => (await transaction("settings", "readonly", (tx) => tx.objectStore("settings").get(key)))?.value;
export const saveSetting = (key, value) => put("settings", { key, value });
export const getVisionTests = async () => [];

export async function pruneTrainingData(limit = 100) {
  const sessions = await getSessions();
  const removed = new Set(sessions.slice(Math.max(1, limit)).map((session) => session.id));
  if (!removed.size) return;
  const trials = await read("trials");
  await transaction(["sessions", "trials"], "readwrite", (tx) => {
    removed.forEach((id) => tx.objectStore("sessions").delete(id));
    trials.filter((trial) => removed.has(trial.sessionId)).forEach((trial) => tx.objectStore("trials").delete(trial.id));
  });
}

export const clearTrainingData = () => transaction(["sessions", "trials", "settings"], "readwrite", (tx) => {
  for (const name of ["sessions", "trials", "settings"]) tx.objectStore(name).clear();
});

export async function exportTrainingData() {
  const [sessions, trials, adaptiveLevels] = await Promise.all([getSessions(), getAllTrials(), getSetting(ADAPTIVE_LEVELS_KEY)]);
  return { schemaVersion: 1, application: "Oraen View", platform: "mobile", exportedAt: new Date().toISOString(), sessions, trials, settings: { adaptiveLevels: adaptiveLevels || {} } };
}
