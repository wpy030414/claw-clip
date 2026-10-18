/**
 * 明暗主题切换的全局过渡开关。
 *
 * M3E 的 `--md-sys-color-*` token 是在 <m3e-theme> 上整体替换的，元素本身没有
 * 声明 transition，颜色会瞬间跳变。这里在 resolvedScheme 变化时给 <html> 打一个
 * 短暂标记，由 global.css 对子树统一开启颜色过渡，结束后移除，避免常驻 `*` 过渡
 * 拖慢悬停/输入等高频交互。
 */
import { useEffect, useLayoutEffect, useRef } from "react";
import { useSettingsStore } from "@/stores/settingsStore";

const DURATION_MS = 320;

export function useThemeTransition(): void {
  const scheme = useSettingsStore((s) => s.scheme);
  const resolved = useSettingsStore((s) => s.resolvedScheme);
  const ready = useRef(false);

  // 启动阶段（系统明暗解析、首屏渲染）不算用户切换，避免首屏颜色闪一下
  useEffect(() => {
    const timer = setTimeout(() => {
      ready.current = true;
    }, 400);
    return () => clearTimeout(timer);
  }, []);

  // layout effect：标记先于本次提交的绘制落下，token 变色才会走过渡而不是闪一下
  useLayoutEffect(() => {
    if (typeof document === "undefined" || !ready.current) return undefined;
    const root = document.documentElement;
    root.dataset.themeTransition = "true";
    const timer = setTimeout(() => {
      delete root.dataset.themeTransition;
    }, DURATION_MS);
    return () => clearTimeout(timer);
  }, [scheme, resolved]);
}
