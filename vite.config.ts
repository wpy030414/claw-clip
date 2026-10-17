import { execSync } from "node:child_process";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

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

export default defineConfig({
  base: "/claw-clip/",
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
});
