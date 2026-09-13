import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./scripts",
  testMatch: "mobile-browser.spec.mjs",
  timeout: 120000,
  workers: 1,
  use: { channel: "chrome", actionTimeout: 10000, navigationTimeout: 15000, baseURL: "http://127.0.0.1:4178", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  webServer: { command: "node index.js", env: { PORT: "4178" }, port: 4178, reuseExistingServer: false },
});

