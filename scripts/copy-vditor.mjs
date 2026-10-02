// 把 node_modules/vditor/dist 拷到 public/vditor，实现离线自托管（不依赖 unpkg CDN）。
// 在 predev / prebuild / postinstall 触发。用 fs.cpSync 递归拷贝。
import { cpSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const src = resolve(root, "node_modules/vditor/dist");
const dest = resolve(root, "public/vditor/dist");

if (!existsSync(src)) {
  console.warn("[copy-vditor] 跳过：未找到 node_modules/vditor/dist（依赖尚未安装）");
  process.exit(0);
}

rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, { recursive: true });
console.log(`[copy-vditor] 已拷贝 vditor dist → public/vditor/dist`);
