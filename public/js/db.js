const DB_NAME = "oraenViewDB";
// Kept only to copy existing users' local data during the Oraen View rename.
const LEGACY_DB_NAME = "newRevitalVisionDB";
const DB_VERSION = 2;
const SESSION_STORE = "sessions";
const TRIAL_STORE = "trials";
const SETTINGS_STORE = "settings";
const VISION_TEST_STORE = "visionTests";
const VISION_TEST_TRIAL_STORE = "visionTestTrials";
export const ADAPTIVE_LEVELS_KEY = "adaptiveLevels:local-user";
export const MAX_STORED_SESSIONS = 100;
const LEGACY_MIGRATION_KEY = "migration:oraen-view-brand-rename";

let dbPromise;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
  });
}

async function openLegacyDatabaseIfPresent() {
  if (typeof indexedDB.databases === "function") {
    const databases = await indexedDB.databases();
    if (!databases.some((database) => database.name === LEGACY_DB_NAME)) return null;
  }

  return new Promise((resolve) => {
    const request = indexedDB.open(LEGACY_DB_NAME);
    request.onupgradeneeded = () => {
      request.transaction.abort();
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

async function migrateLegacyData(targetDb) {
  const markerTransaction = targetDb.transaction(SETTINGS_STORE, "readonly");
  const migrated = await requestToPromise(markerTransaction.objectStore(SETTINGS_STORE).get(LEGACY_MIGRATION_KEY));
  await transactionDone(markerTransaction);
  if (migrated) return;

  const legacyDb = await openLegacyDatabaseIfPresent();
  if (!legacyDb) return;
  const stores = [SESSION_STORE, TRIAL_STORE, SETTINGS_STORE, VISION_TEST_STORE, VISION_TEST_TRIAL_STORE]
    .filter((storeName) => legacyDb.objectStoreNames.contains(storeName));

  try {
    const recordsByStore = {};
    if (stores.length) {
      const sourceTransaction = legacyDb.transaction(stores, "readonly");
      const reads = stores.map(async (storeName) => {
        recordsByStore[storeName] = await requestToPromise(sourceTransaction.objectStore(storeName).getAll());
      });
      await Promise.all(reads);
      await transactionDone(sourceTransaction);
    }

    const targetStores = [...new Set([...stores, SETTINGS_STORE])];
    const targetTransaction = targetDb.transaction(targetStores, "readwrite");
    stores.forEach((storeName) => {
      const targetStore = targetTransaction.objectStore(storeName);
      recordsByStore[storeName].forEach((record) => targetStore.put(record));
    });
    targetTransaction.objectStore(SETTINGS_STORE).put({
      key: LEGACY_MIGRATION_KEY,
      value: true,
      updatedAt: new Date().toISOString(),
    });
    await transactionDone(targetTransaction);
  } finally {
    legacyDb.close();
  }
}

export function openDatabase() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(SESSION_STORE)) {
          const sessions = db.createObjectStore(SESSION_STORE, { keyPath: "id" });
          sessions.createIndex("startedAt", "startedAt", { unique: false });
          sessions.createIndex("status", "status", { unique: false });
        }

        if (!db.objectStoreNames.contains(TRIAL_STORE)) {
          const trials = db.createObjectStore(TRIAL_STORE, { keyPath: "id" });
          trials.createIndex("sessionId", "sessionId", { unique: false });
          trials.createIndex("createdAt", "createdAt", { unique: false });
          trials.createIndex("mode", "mode", { unique: false });
        }

        if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
          db.createObjectStore(SETTINGS_STORE, { keyPath: "key" });
        }

        if (!db.objectStoreNames.contains(VISION_TEST_STORE)) {
          const tests = db.createObjectStore(VISION_TEST_STORE, { keyPath: "id" });
          tests.createIndex("startedAt", "startedAt", { unique: false });
          tests.createIndex("mode", "mode", { unique: false });
        }

        if (!db.objectStoreNames.contains(VISION_TEST_TRIAL_STORE)) {
          const testTrials = db.createObjectStore(VISION_TEST_TRIAL_STORE, { keyPath: "id" });
          testTrials.createIndex("testId", "testId", { unique: false });
          testTrials.createIndex("createdAt", "createdAt", { unique: false });
        }
      };

      request.onsuccess = async () => {
        const db = request.result;
        try {
          await migrateLegacyData(db);
        } catch (error) {
          console.warn("Oraen View 无法迁移旧版 IndexedDB 数据：", error);
        }
        resolve(db);
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("数据库升级被其他标签页阻止，请关闭其他页面后重试。"));
    });
  }

  return dbPromise;
}

export async function saveSession(session) {
  const db = await openDatabase();
  const transaction = db.transaction(SESSION_STORE, "readwrite");
  transaction.objectStore(SESSION_STORE).put(structuredClone(session));
  await transactionDone(transaction);
  try { await pruneTrainingData(); } catch { /* Retention cleanup is best effort during saving. */ }
  return session;
}

export async function saveTrial(trial) {
  const db = await openDatabase();
  const transaction = db.transaction(TRIAL_STORE, "readwrite");
  transaction.objectStore(TRIAL_STORE).put(structuredClone(trial));
  await transactionDone(transaction);
  return trial;
}

export async function getSessions() {
  const db = await openDatabase();
  const transaction = db.transaction(SESSION_STORE, "readonly");
  const sessions = await requestToPromise(transaction.objectStore(SESSION_STORE).getAll());
  await transactionDone(transaction);
  return sessions.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

export async function getTrialsBySession(sessionId) {
  const db = await openDatabase();
  const transaction = db.transaction(TRIAL_STORE, "readonly");
  const index = transaction.objectStore(TRIAL_STORE).index("sessionId");
  const trials = await requestToPromise(index.getAll(IDBKeyRange.only(sessionId)));
  await transactionDone(transaction);
  return trials.sort((a, b) => a.trialNumber - b.trialNumber);
}

export async function getAllTrials() {
  const db = await openDatabase();
  const transaction = db.transaction(TRIAL_STORE, "readonly");
  const trials = await requestToPromise(transaction.objectStore(TRIAL_STORE).getAll());
  await transactionDone(transaction);
  return trials.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function saveVisionTest(test) {
  const db = await openDatabase();
  const transaction = db.transaction(VISION_TEST_STORE, "readwrite");
  transaction.objectStore(VISION_TEST_STORE).put(structuredClone(test));
  await transactionDone(transaction);
  return test;
}

export async function saveVisionTestTrial(trial) {
  const db = await openDatabase();
  const transaction = db.transaction(VISION_TEST_TRIAL_STORE, "readwrite");
  transaction.objectStore(VISION_TEST_TRIAL_STORE).put(structuredClone(trial));
  await transactionDone(transaction);
  return trial;
}

export async function getVisionTests() {
  const db = await openDatabase();
  const transaction = db.transaction(VISION_TEST_STORE, "readonly");
  const tests = await requestToPromise(transaction.objectStore(VISION_TEST_STORE).getAll());
  await transactionDone(transaction);
  return tests.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
}

export async function getAllVisionTestTrials() {
  const db = await openDatabase();
  const transaction = db.transaction(VISION_TEST_TRIAL_STORE, "readonly");
  const trials = await requestToPromise(transaction.objectStore(VISION_TEST_TRIAL_STORE).getAll());
  await transactionDone(transaction);
  return trials.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function pruneTrainingData(maxSessions = MAX_STORED_SESSIONS) {
  const limit = Math.max(1, Math.floor(Number(maxSessions) || MAX_STORED_SESSIONS));
  const sessions = await getSessions();
  if (sessions.length <= limit) return 0;

  const removedSessions = sessions.slice(limit);
  const removedIds = new Set(removedSessions.map((session) => session.id));
  const trials = await getAllTrials();
  const db = await openDatabase();
  const transaction = db.transaction([SESSION_STORE, TRIAL_STORE], "readwrite");
  const sessionStore = transaction.objectStore(SESSION_STORE);
  const trialStore = transaction.objectStore(TRIAL_STORE);

  removedIds.forEach((sessionId) => sessionStore.delete(sessionId));
  trials.forEach((trial) => {
    if (removedIds.has(trial.sessionId)) trialStore.delete(trial.id);
  });

  await transactionDone(transaction);
  return removedSessions.length;
}

export async function saveSetting(key, value) {
  const db = await openDatabase();
  const transaction = db.transaction(SETTINGS_STORE, "readwrite");
  transaction.objectStore(SETTINGS_STORE).put({ key, value, updatedAt: new Date().toISOString() });
  await transactionDone(transaction);
}

export async function getSetting(key) {
  const db = await openDatabase();
  const transaction = db.transaction(SETTINGS_STORE, "readonly");
  const setting = await requestToPromise(transaction.objectStore(SETTINGS_STORE).get(key));
  await transactionDone(transaction);
  return setting?.value;
}

export async function clearTrainingData() {
  const db = await openDatabase();
  const transaction = db.transaction([SESSION_STORE, TRIAL_STORE, SETTINGS_STORE, VISION_TEST_STORE, VISION_TEST_TRIAL_STORE], "readwrite");
  transaction.objectStore(SESSION_STORE).clear();
  transaction.objectStore(TRIAL_STORE).clear();
  transaction.objectStore(SETTINGS_STORE).delete(ADAPTIVE_LEVELS_KEY);
  transaction.objectStore(VISION_TEST_STORE).clear();
  transaction.objectStore(VISION_TEST_TRIAL_STORE).clear();
  await transactionDone(transaction);
}

export async function exportTrainingData() {
  const [sessions, trials, adaptiveLevels, visionTests, visionTestTrials] = await Promise.all([
    getSessions(),
    getAllTrials(),
    getSetting(ADAPTIVE_LEVELS_KEY),
    getVisionTests(),
    getAllVisionTestTrials(),
  ]);
  return {
    schemaVersion: 2,
    exportedAt: new Date().toISOString(),
    application: "Oraen View",
    sessions,
    trials,
    visionTests,
    visionTestTrials,
    settings: { adaptiveLevels: adaptiveLevels || {} },
  };
}

export function createId(prefix) {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
