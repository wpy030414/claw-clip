/**
 * 自定义页面 CSS：把 settingsStore.customCss 同步到 <head> 里的一个 <style>。
 *
 * 用 textContent 写入而不是 dangerouslySetInnerHTML，CSS 里即使出现
 * `</style>` 也不会提前截断样式块；打开/关闭主题 dialog 不重挂载，输入即生效。
 */
import { useEffect, useRef } from "react";
import { useSettingsStore } from "@/stores/settingsStore";

export function CustomCss() {
  const css = useSettingsStore((s) => s.customCss);
  const styleRef = useRef<HTMLStyleElement | null>(null);

  useEffect(() => {
    const el = document.createElement("style");
    el.setAttribute("data-clawclip-custom-css", "");
    document.head.appendChild(el);
    styleRef.current = el;
    return () => {
      el.remove();
      styleRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (styleRef.current) styleRef.current.textContent = css;
  }, [css]);

  return null;
}
