/*
 * Dependency-free browser smoke test.
 * Start Chrome with --remote-debugging-port=9224 and the application open,
 * then run: node scripts/browser-smoke.js http://127.0.0.1:9224
 */

const endpoint = process.argv[2] || "http://127.0.0.1:9224";
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  const targets = await fetch(`${endpoint}/json`).then((response) => response.json());
  const target = targets.find((item) => item.type === "page" && item.url.includes("127.0.0.1"));
  if (!target) throw new Error("No application page found in Chrome debugging targets");

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let commandId = 0;
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (!message.id || !pending.has(message.id)) return;
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  function command(method, params = {}) {
    commandId += 1;
    return new Promise((resolve, reject) => {
      pending.set(commandId, { resolve, reject });
      socket.send(JSON.stringify({ id: commandId, method, params }));
    });
  }

  async function evaluate(expression, awaitPromise = false) {
    const result = await command("Runtime.evaluate", { expression, awaitPromise, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Browser evaluation failed");
    return result.result.value;
  }

  await command("Runtime.enable");
  await evaluate("location.hash = '#/training'");
  await wait(500);
  await evaluate(`(() => {
    document.querySelector('[data-mode="single"]').click();
    const length = document.querySelector('#trialCount');
    length.value = '8';
    length.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#startTrainingButton').click();
    window.__newVisionFocusEntered = document.body.classList.contains('training-focus');
    window.__newVisionSmokeResponder = setInterval(() => {
      if (!window.__newVisionReadyStarted && document.querySelector('#trainerStatus').textContent === '预备模式') {
        window.__newVisionReadyStarted = true;
        document.querySelector('#trainerPanel').dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
        }));
        return;
      }
      const firstFrame = document.querySelector('#temporalButtons [data-answer="1"]');
      if (firstFrame && !firstFrame.disabled && firstFrame.offsetParent !== null) {
        document.querySelector('#trainerPanel').dispatchEvent(new MouseEvent('mousedown', {
          bubbles: true,
          button: 0,
        }));
        return;
      }
    }, 80);
    return true;
  })()`);

  const deadline = Date.now() + 45000;
  let status = "";
  while (Date.now() < deadline) {
    status = await evaluate("document.querySelector('#trainerStatus').textContent");
    if (status === "训练完成") break;
    await wait(500);
  }

  const result = await evaluate(`(async () => {
    clearInterval(window.__newVisionSmokeResponder);
    const request = indexedDB.open('oraenViewDB');
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction(['sessions', 'trials'], 'readonly');
    const read = (request) => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const sessions = await read(transaction.objectStore('sessions').getAll());
    const trials = await read(transaction.objectStore('trials').getAll());
    return {
      status: document.querySelector('#trainerStatus').textContent,
      progress: document.querySelector('#trialProgressText').textContent,
      focusEntered: window.__newVisionFocusEntered,
      readyModeEntered: window.__newVisionReadyStarted === true,
      focusRestored: !document.body.classList.contains('training-focus'),
      sessionCount: sessions.length,
      completedSessions: sessions.filter((session) => session.status === 'completed').length,
      trialCount: trials.length,
    };
  })()`, true);

  await evaluate("location.hash = '#/records'");
  await wait(800);
  result.dashboard = await evaluate(`({
    route: location.hash,
    completedSessions: document.querySelector('#totalSessionsKpi').textContent,
    totalTrials: document.querySelector('#totalTrialsKpi').textContent,
    emptyStateVisible: document.querySelector('#recordsEmptyState').classList.contains('show'),
    paginationVisible: !document.querySelector('#sessionsPagination').classList.contains('hidden'),
    difficultyTrendCards: document.querySelectorAll('#difficultyTrendsGrid .difficulty-trend-card').length,
    singleDifficultyCurve: Boolean(document.querySelector('#difficultyTrendsGrid [data-mode="single"] .difficulty-chart-line'))
  })`);

  const passed = !(
    result.status !== "训练完成"
    || !result.focusEntered
    || !result.readyModeEntered
    || !result.focusRestored
    || result.completedSessions < 1
    || result.trialCount < 8
    || result.dashboard.route !== "#/records"
    || Number(result.dashboard.completedSessions) < 1
    || Number(result.dashboard.totalTrials) < 8
    || result.dashboard.emptyStateVisible
    || !result.dashboard.paginationVisible
    || result.dashboard.difficultyTrendCards !== 4
    || !result.dashboard.singleDifficultyCurve
  );
  console.log(JSON.stringify(result, null, 2));
  socket.close();
  process.exit(passed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
