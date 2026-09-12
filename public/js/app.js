import { openDatabase } from "./db.js";
import { RecordsController } from "./records.js";
import { TrainingController } from "./training.js";
import { VisualTestController } from "./visual-test.js";

const PAGE_META = {
  training: { title: "视觉训练", eyebrow: "TRAINING CENTER" },
  testing: { title: "视觉测试", eyebrow: "LANDOLT C ASSESSMENT" },
  records: { title: "训练数据", eyebrow: "LOCAL DATA CENTER" },
};

function toast(message, type = "default") {
  const region = document.querySelector("#toastRegion");
  const element = document.createElement("div");
  element.className = `toast ${type}`;
  element.textContent = message;
  region.append(element);
  setTimeout(() => element.remove(), 3400);
}

const records = new RecordsController({ onToast: toast });
const training = new TrainingController({ onToast: toast, onSessionChanged: () => records.invalidate() });
const visualTest = new VisualTestController({ onToast: toast, onTestChanged: () => records.invalidate() });
let currentRoute = "training";
let routeGuardActive = false;

function getRoute() {
  const routeName = location.hash.replace(/^#\//, "").split("/")[0];
  return PAGE_META[routeName] ? routeName : "training";
}

async function route() {
  if (routeGuardActive) return;
  const nextRoute = getRoute();
  if (currentRoute === "training" && nextRoute !== "training" && training.isRunning()) {
    const leave = window.confirm("训练尚未完成。离开后本次会话会保存为“未完成”，确定离开吗？");
    if (!leave) {
      routeGuardActive = true;
      location.hash = "#/training";
      setTimeout(() => { routeGuardActive = false; }, 0);
      return;
    }
    await training.abortSession("route_change");
  }
  if (currentRoute === "testing" && nextRoute !== "testing" && visualTest.isRunning()) {
    const leave = window.confirm("视觉测试尚未完成。离开后已完成阶段会保留，确定离开吗？");
    if (!leave) {
      routeGuardActive = true;
      location.hash = "#/testing";
      setTimeout(() => { routeGuardActive = false; }, 0);
      return;
    }
    await visualTest.abort("route_change");
  }

  currentRoute = nextRoute;
  document.querySelectorAll(".page").forEach((page) => page.classList.toggle("active", page.dataset.page === nextRoute));
  document.querySelectorAll(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.route === nextRoute));
  document.querySelector("#pageTitle").textContent = PAGE_META[nextRoute].title;
  document.querySelector("#pageEyebrow").textContent = PAGE_META[nextRoute].eyebrow;
  document.querySelector("#sidebar").classList.remove("open");
  document.title = `${PAGE_META[nextRoute].title} · Oraen View`;
  if (nextRoute === "records" && !records.loaded) await records.load();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function setCurrentDate() {
  document.querySelector("#currentDate").textContent = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "long", day: "numeric", weekday: "short",
  }).format(new Date());
}

document.querySelector("#menuButton").addEventListener("click", () => document.querySelector("#sidebar").classList.toggle("open"));
document.addEventListener("click", (event) => {
  const sidebar = document.querySelector("#sidebar");
  if (window.innerWidth > 900 || !sidebar.classList.contains("open")) return;
  if (!event.target.closest("#sidebar") && !event.target.closest("#menuButton")) sidebar.classList.remove("open");
});
window.addEventListener("hashchange", route);
window.addEventListener("beforeunload", (event) => {
  if (!training.isRunning() && !visualTest.isRunning()) return;
  event.preventDefault();
  event.returnValue = "";
});

async function initialize() {
  setCurrentDate();
  try { await openDatabase(); } catch (error) { toast(`IndexedDB 初始化失败：${error.message}`, "error"); }
  if (!location.hash) location.replace("#/training");
  await route();
}

initialize();
