/**
 * 主题同步 hook（方案 B 的引擎）。
 *
 * 职责：
 * 1. 把 settingsStore.scheme（auto/light/dark）解析成实际明暗 resolvedScheme。
 *    auto 时监听 matchMedia('(prefers-color-scheme: dark)') 跟随系统；
 *    Vditor 主题同步需要「实际值」，而 M3E <m3e-theme scheme="auto"> 内部自己跟随，
 *    不对外暴露解析结果，所以这里自己算一份。
 * 2. 在 App 顶层调用一次即可。
 */
import { useEffect } from "react";
import { useSettingsStore } from "@/stores/settingsStore";

export function useThemeSync(): void {
  const scheme = useSettingsStore((s) => s.scheme);
  const setResolvedScheme = useSettingsStore((s) => s.setResolvedScheme);

  useEffect(() => {
    // 强制明暗：直接采用
    if (scheme !== "auto") {
      setResolvedScheme(scheme);
      return;
    }

    // auto：跟随系统 prefers-color-scheme，并监听变化
    if (typeof window === "undefined" || !window.matchMedia) {
      setResolvedScheme("light");
      return;
    }
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setResolvedScheme(mql.matches ? "dark" : "light");
    apply(); // 立即解析一次
    mql.addEventListener("change", apply);
    return () => mql.removeEventListener("change", apply);
  }, [scheme, setResolvedScheme]);
}
