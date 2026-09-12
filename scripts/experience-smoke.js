/*
 * Dependency-free experience-mode smoke test.
 * Start Chrome with --remote-debugging-port=9225 and a fresh profile, then run:
 * node scripts/experience-smoke.js http://127.0.0.1:9225
 */

const endpoint = process.argv[2] || "http://127.0.0.1:9225";
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
  await wait(400);
  await evaluate(`(() => {
    document.querySelector('[data-mode="single"]').click();
    document.querySelector('[data-session-type="experience"]').click();
    const difficulty = document.querySelector('#experienceDifficulty');
    difficulty.value = '0.69';
    difficulty.dispatchEvent(new Event('input', { bubbles: true }));
    const count = document.querySelector('#experienceTrialCount');
    count.value = '1';
    count.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('#startTrainingButton').click();
    return true;
  })()`);

  const readyDeadline = Date.now() + 5000;
  while (Date.now() < readyDeadline) {
    if (await evaluate("document.querySelector('#trainerStatus').textContent === '预备模式'")) break;
    await wait(80);
  }
  await evaluate(`document.querySelector('#trainerPanel').dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true, button: 0,
  }))`);

  const completionDeadline = Date.now() + 10000;
  while (Date.now() < completionDeadline) {
    const status = await evaluate("document.querySelector('#trainerStatus').textContent");
    if (status === "体验完成") break;
    await evaluate(`(() => {
      const first = document.querySelector('#temporalButtons [data-answer="1"]');
      if (!first.disabled) document.querySelector('#trainerPanel').dispatchEvent(new MouseEvent('mousedown', {
        bubbles: true, button: 0,
      }));
    })()`);
    await wait(80);
  }

  const stored = await evaluate(`(async () => {
    const request = indexedDB.open('oraenViewDB');
    const db = await new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const transaction = db.transaction(['sessions', 'trials', 'settings'], 'readonly');
    const read = (request) => new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const [sessions, trials, adaptive] = await Promise.all([
      read(transaction.objectStore('sessions').getAll()),
      read(transaction.objectStore('trials').getAll()),
      read(transaction.objectStore('settings').get('adaptiveLevels:local-user')),
    ]);
    return { sessions, trials, adaptive };
  })()`, true);

  await evaluate("location.hash = '#/records'");
  await wait(700);
  const dashboard = await evaluate(`(() => {
    const row = document.querySelector('#sessionsTableBody tr');
    return {
      totalSessions: document.querySelector('#totalSessionsKpi').textContent,
      totalTrials: document.querySelector('#totalTrialsKpi').textContent,
      rowIsGreen: row?.classList.contains('experience-session-row') === true,
      rowLabel: row?.textContent || '',
      difficultyLines: document.querySelectorAll('.difficulty-chart-line').length,
    };
  })()`);

  const session = stored.sessions[0];
  const trial = stored.trials[0];
  const passed = Boolean(
    session?.status === "completed"
    && session?.isExperience === true
    && session?.sessionType === "experience"
    && session?.plannedTrials === 1
    && session?.fixedLevel === 0.0069
    && trial?.isExperience === true
    && trial?.levelBefore === 0.0069
    && trial?.levelAfter === 0.0069
    && !stored.adaptive
    && dashboard.totalSessions === "0"
    && dashboard.totalTrials === "0"
    && dashboard.rowIsGreen
    && dashboard.rowLabel.includes("体验")
    && dashboard.difficultyLines === 0
  );
  console.log(JSON.stringify({ session, trial, adaptive: stored.adaptive, dashboard, passed }, null, 2));
  socket.close();
  process.exit(passed ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
