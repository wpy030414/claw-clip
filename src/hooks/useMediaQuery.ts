/**
 * 响应式断点 hook：监听 media query，返回是否匹配。
 * 用于 AppShell 在桌面工作台 / 移动端两套布局间切换（方案 §5.6）。
 */
import { useEffect, useState } from "react";

/** 桌面断点，与 styles/tokens.css 的 --breakpoint-desktop 同源。 */
export const DESKTOP_QUERY = "(min-width: 900px)";
/** 移动断点。 */
export const MOBILE_QUERY = "(max-width: 599px)";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia(query).matches
      : false,
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    // 初始化同步一次，防止 query 变化时状态滞后
    setMatches(mql.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, [query]);

  return matches;
}

/** 便捷：是否桌面形态。 */
export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}
