/**
 * Vditor 主题同步（方案 B）。
 *
 * 两步抹平 Vditor 与 M3E 的视觉接缝：
 * (a) syncVditorTheme：切 Vditor 内置主题（主体 dark/classic + 内容主题 + 代码高亮主题），
 *     让预览区/代码块配色跟随明暗。签名已从 index.d.ts 核实：
 *     setTheme(theme: "dark"|"classic", contentTheme?: string, codeTheme?: string, contentThemePath?: string)
 * (b) styles/vditor-theme.css（全局静态引入）：用 M3E --md-sys-color-* token 覆写 .vditor-* 外壳，
 *     这部分随 token 动态重算天然跟随明暗，无需 JS 干预。
 *
 * 二者配合：外壳吃 M3E token（CSS 层），内容区吃 Vditor 内置主题（JS 层）。
 */
import type Vditor from "vditor";
import type { ResolvedScheme } from "@/types/settings";

/**
 * 切 Vditor 内置主题跟随明暗。
 * - 主体主题：dark → "dark"；light → "classic"
 * - 内容(预览)主题：跟随明暗用 dark/github
 * - 代码高亮主题：dark → "native"；light → "github"
 *
 * contentThemePath 用自托管路径（从 cdnBase 派生），避免走公网。
 */
export function syncVditorTheme(vd: Vditor, scheme: ResolvedScheme, cdnBase: string): void {
  const isDark = scheme === "dark";
  try {
    vd.setTheme(
      isDark ? "dark" : "classic",
      isDark ? "dark" : "light", // contentTheme
      isDark ? "native" : "github", // codeTheme
      `${cdnBase}/dist/css/content-theme`, // contentThemePath（本地）
    );
  } catch {
    // 容错：部分版本 setTheme 参数不同，主题同步失败不应中断编辑
    console.warn("[vditor-theme] setTheme 调用失败，已忽略");
  }
}

/**
 * 运行时注入一个 <style> 兜底：把编辑器字号暴露为 --editor-font-size 供 vditor-theme.css 消费。
 * 主体覆写样式在 main.tsx 里静态 import '@/styles/vditor-theme.css'，此处只管动态变量。
 */
let styleEl: HTMLStyleElement | null = null;
export function applyEditorFontVar(fontSize: number): void {
  if (!styleEl) {
    styleEl = document.createElement("style");
    styleEl.id = "claw-clip-editor-vars";
    document.head.appendChild(styleEl);
  }
  styleEl.textContent = `:root { --editor-font-size: ${fontSize}px; }`;
}
