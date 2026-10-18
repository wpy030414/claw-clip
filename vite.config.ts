import { execSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite-plus";

/** 当前检出的 commit hash（7 位）；无 git 环境时降级为 "unknown"。 */
function readCommitHash(): string {
  try {
    return execSync("git rev-parse --short=7 HEAD", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * 本地开发与预览恒为根路径；CI 用 PAGES_BASE_PATH 注入线上前缀：
 * - 项目页 `https://<user>.github.io/<repo>/` → `/<repo>/`
 * - 用户页 / 自定义域 → `/`
 *
 * 代码不对仓库名或域名做任何推断（见 docs/DECISIONS.md ADR-050）。
 */
const base = process.env.PAGES_BASE_PATH || "/";

export default defineConfig({
  base,
  plugins: [react()],
  define: {
    // 构建期注入：侧栏标题点击后展示当前构建对应的 commit
    __APP_COMMIT__: JSON.stringify(readCommitHash()),
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 24680,
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
  fmt: {
    semi: true,
    singleQuote: false,
  },
  lint: {
    // 必须显式排除，否则 vp lint 会扫描产物与依赖目录
    ignorePatterns: ["node_modules/**", "dist/**", "coverage/**", "test-results/**"],
    options: { typeAware: true, typeCheck: true },
  },
});
