/*
 * Browser smoke test for the Landolt C flow.
 * Start Chrome with --remote-debugging-port=9225 and the application open,
 * then run: node scripts/visual-test-smoke.js http://127.0.0.1:9225
 */

const endpoint = process.argv[2] || "http://127.0.0.1:9225";
const testMode = process.argv[3] || "size";
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function main() {
  const targets = await fetch(`${endpoint}/json`).then((response) => response.json());
  const target = targets.find((item) => item.type === "page" && item.url.includes("127.0.0.1"));
  if (!target) throw new Error("No application page found in Chrome debugging targets");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let commandId = 0;
  const runtimeErrors = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.method === "Runtime.exceptionThrown") {
      const details = message.params.exceptionDetails;
      runtimeErrors.push(details?.exception?.description || details?.text || "Runtime error");
    }
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
  await evaluate("location.reload(); true");
  await wait(700);
  await evaluate("location.hash = '#/testing'");
  await wait(500);
  runtimeErrors.length = 0;
  await evaluate(`(() => {
    document.querySelector('[data-test-mode="${testMode}"]').click();
    document.querySelector('#startTestButton').click();
    window.__visionTestResponder = setInterval(() => {
      const message = document.querySelector('#testStageMessage');
      if (message && !message.classList.contains('hidden')) {
        document.querySelector('#testStage').click();
        return;
      }
      const enabled = [...document.querySelectorAll('#testDirectionPad button:not(:disabled)')];
      if (enabled.length) enabled[Math.floor(Math.random() * enabled.length)].click();
    }, 270);
    return true;
  })()`);

  const deadline = Date.now() + 55000;
  let status = "";
  while (Date.now() < deadline) {
    status = await evaluate("document.querySelector('#testStatus').textContent");
    if (status === "测试完成") break;
    await wait(500);
  }
  const result = await evaluate(`(async () => {
    clearInterval(window.__visionTestResponder);
    const request = indexedDB.open('oraenViewDB');
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction(['visionTests', 'visionTestTrials'], 'readonly');
    const read = (request) => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const tests = await read(transaction.objectStore('visionTests').getAll());
    const trials = await read(transaction.objectStore('visionTestTrials').getAll());
    const latest = tests.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0];
    return {
      status: document.querySelector('#testStatus').textContent,
      focusRestored: !document.body.classList.contains('testing-focus'),
      testCount: tests.length,
      trialCount: trials.length,
      latestStatus: latest?.status,
      latestMode: latest?.mode,
      resultEyes: latest ? Object.keys(latest.results) : [],
      crowdedBlocksComplete: latest?.crowded ? Object.values(latest.results).every((result) => result.isolated && result.crowded && Number.isFinite(result.crowdingLossPercent)) : true,
    };
  })()`, true);
  await evaluate("location.hash = '#/records'");
  await wait(700);
  result.records = await evaluate(`({
    chartCards: document.querySelectorAll('#visionTestCharts .vision-test-chart-card').length,
    tableRows: document.querySelectorAll('#visionTestsTableBody tr').length,
    emptyHidden: document.querySelector('#visionTestsEmpty').classList.contains('hidden')
  })`);
  result.runtimeErrors = runtimeErrors;
  const passed = result.status === "测试完成"
    && result.focusRestored
    && result.latestStatus === "completed"
    && result.latestMode === testMode
    && result.resultEyes.length === 3
    && result.crowdedBlocksComplete
    && result.records.chartCards === 4
    && result.records.tableRows >= 1
    && result.records.emptyHidden
    && runtimeErrors.length === 0;
  console.log(JSON.stringify(result, null, 2));
  socket.close();
  process.exit(passed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
