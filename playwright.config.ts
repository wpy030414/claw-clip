import { defineConfig, devices } from "@playwright/test";

/**
 * 本地 dev server 默认以根路径运行（vite.config.ts 的 base 由 PAGES_BASE_PATH 决定）。
 * 若要验证 GitHub Pages 项目页形态：
 *   PAGES_BASE_PATH=/claw-clip/ pnpm run dev
 * 再以同样的环境变量跑 E2E。
 */
const PORT = 24680;
const BASE_PATH = process.env.PAGES_BASE_PATH || "/";
const BASE = `http://localhost:${PORT}${BASE_PATH}`;

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: [["list"]],
  use: {
    baseURL: BASE,
    trace: "on-first-retry",
  },
  // dev server 由外部 pnpm run dev 提供；E2E 直连 24680
  webServer: {
    command: "pnpm run dev",
    url: BASE,
    reuseExistingServer: true,
    timeout: 60_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
