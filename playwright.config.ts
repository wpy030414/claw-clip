import { defineConfig, devices } from "@playwright/test";

const BASE = "http://localhost:24680/claw-clip/";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: BASE,
    trace: "on-first-retry",
  },
  // dev server 由外部 npm run dev 提供；E2E 直连 24680（带 /claw-clip/ base）
  webServer: {
    command: "npm run dev",
    url: BASE,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
