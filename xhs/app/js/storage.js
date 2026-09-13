(function () {
"use strict";
const cloneRecord = window.ToolCompat.cloneRecord;
// Deliberately separate from db.js: no desktop migration, reads, or fallback.
const DB_NAME = "oraenViewXhsDB";
const ADAPTIVE_LEVELS_KEY = "xhs:adaptiveLevels:local-user";
let database;

function openDatabase() {
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
    tx.oncomplete = () => resolve((result || {}).result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("保存已中断"));
    result = action(tx);
  });
}

const read = (store) => transaction(store, "readonly", (tx) => tx.objectStore(store).getAll());
const put = (store, record) => transaction(store, "readwrite", (tx) => tx.objectStore(store).put(cloneRecord(record)));
const saveTrial = (trial) => put("trials", Object.assign({}, trial, { platform: "mobile" }));
async function saveSession(session) {
  await put("sessions", Object.assign({}, session, { platform: "mobile" }));
  await pruneTrainingData();
}
const getSessions = async () => (await read("sessions")).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
const getAllTrials = async () => (await read("trials")).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
const getTrialsBySession = async (id) => (await read("trials")).filter((trial) => trial.sessionId === id).sort((a, b) => a.trialNumber - b.trialNumber);
const getSetting = async (key) => { const row = await transaction("settings", "readonly", (tx) => tx.objectStore("settings").get(key)); return row && row.value; };
const saveSetting = (key, value) => put("settings", { key, value });
const getVisionTests = async () => [];

async function pruneTrainingData(limit = 100) {
  const sessions = await getSessions();
  const removed = new Set(sessions.slice(Math.max(1, limit)).map((session) => session.id));
  if (!removed.size) return;
  const trials = await read("trials");
  await transaction(["sessions", "trials"], "readwrite", (tx) => {
    removed.forEach((id) => tx.objectStore("sessions").delete(id));
    trials.filter((trial) => removed.has(trial.sessionId)).forEach((trial) => tx.objectStore("trials").delete(trial.id));
  });
}

const clearTrainingData = () => transaction(["sessions", "trials", "settings"], "readwrite", (tx) => {
  for (const name of ["sessions", "trials", "settings"]) tx.objectStore(name).clear();
});


window.ToolStorage = { ADAPTIVE_LEVELS_KEY, openDatabase, saveTrial, saveSession, getSessions, getAllTrials, getTrialsBySession, getSetting, saveSetting, pruneTrainingData, clearTrainingData };
})();
