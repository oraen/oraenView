(function () {
  "use strict";
  let training;
  let records;
  let routeToken = 0;
  function toast(message, type) {
    const element = document.createElement("div");
    element.className = "toast " + (type || "");
    element.textContent = message;
    document.querySelector("#toastRegion").appendChild(element);
    setTimeout(() => element.remove(), 3400);
  }
  async function route() {
    const token = ++routeToken;
    const name = location.hash === "#/records" ? "records" : "mobile";
    if (name === "records" && training.isRunning()) await training.abortSession("route_change");
    if (token !== routeToken) return;
    document.querySelectorAll(".page").forEach(page => page.classList.toggle("active", page.getAttribute("data-page") === name));
    document.querySelectorAll("[data-route]").forEach(button => button.setAttribute("aria-pressed", String(button.getAttribute("data-route") === name)));
    if (name === "records" && !records.loaded) await records.load();
    window.scrollTo(0, 0);
  }
  async function initialize() {
    try {
      if (!window.indexedDB) throw new Error("当前容器不支持本地记录存储，请更新小红书后重试");
      await window.ToolStorage.openDatabase();
      const canvas = document.createElement("canvas");
      if (!canvas.getContext("2d")) throw new Error("当前容器不支持训练画面，请更新小红书后重试");
      records = new window.ToolRecords({ onToast: toast });
      training = new window.ToolTraining.MobileTrainingController({ onToast: toast, onSessionChanged: () => records.invalidate() });
      document.querySelectorAll("[data-route]").forEach(button => button.addEventListener("click", () => {
        location.hash = "#/" + button.getAttribute("data-route");
      }));
      window.addEventListener("hashchange", route);
      await route();
    } catch (error) {
      const status = document.querySelector("#startupStatus");
      status.textContent = error.message;
      status.classList.remove("hidden");
    }
  }
  initialize();
})();
