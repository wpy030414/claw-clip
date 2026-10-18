/**
 * useThemeSync 单测：scheme → resolvedScheme 解析（方案 B 明暗同步引擎）。
 * 用一个可控的 matchMedia mock（覆盖 setup 的静态 mock）验证 auto 跟随系统。
 */
import { describe, expect, it, beforeEach, vi } from "vite-plus/test";
import { renderHook, act } from "@testing-library/react";
import { useThemeSync } from "@/hooks/useThemeSync";
import { useSettingsStore } from "@/stores/settingsStore";
import { DEFAULT_SETTINGS } from "@/types/settings";

/** 可控 matchMedia mock：记录监听器，可手动触发 change。 */
let mqlMatches = false;
let changeHandlers: Array<(e: { matches: boolean }) => void> = [];

beforeEach(() => {
  mqlMatches = false;
  changeHandlers = [];
  useSettingsStore.setState({ ...DEFAULT_SETTINGS, resolvedScheme: "light" });

  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      get matches() {
        return query.includes("prefers-color-scheme") ? mqlMatches : false;
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, h: (e: { matches: boolean }) => void) => changeHandlers.push(h),
      removeEventListener: (_: string, h: (e: { matches: boolean }) => void) => {
        changeHandlers = changeHandlers.filter((x) => x !== h);
      },
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: vi.fn(),
    })),
  });
});

describe("useThemeSync", () => {
  it("scheme=light → resolvedScheme=light", () => {
    useSettingsStore.setState({ scheme: "light" });
    renderHook(() => useThemeSync());
    expect(useSettingsStore.getState().resolvedScheme).toBe("light");
  });

  it("scheme=dark → resolvedScheme=dark（无视系统）", () => {
    mqlMatches = false; // 系统是 light
    useSettingsStore.setState({ scheme: "dark" });
    renderHook(() => useThemeSync());
    expect(useSettingsStore.getState().resolvedScheme).toBe("dark"); // 强制 dark 覆盖系统
  });

  it("scheme=auto + 系统 dark → resolvedScheme=dark", () => {
    mqlMatches = true; // 系统 dark
    useSettingsStore.setState({ scheme: "auto" });
    renderHook(() => useThemeSync());
    expect(useSettingsStore.getState().resolvedScheme).toBe("dark");
  });

  it("scheme=auto + 系统 light → resolvedScheme=light", () => {
    mqlMatches = false;
    useSettingsStore.setState({ scheme: "auto" });
    renderHook(() => useThemeSync());
    expect(useSettingsStore.getState().resolvedScheme).toBe("light");
  });

  it("scheme=auto：系统明暗切换 → resolvedScheme 实时跟随", () => {
    mqlMatches = false;
    useSettingsStore.setState({ scheme: "auto" });
    renderHook(() => useThemeSync());
    expect(useSettingsStore.getState().resolvedScheme).toBe("light");

    // 模拟系统切到 dark
    mqlMatches = true;
    act(() => changeHandlers.forEach((h) => h({ matches: true })));
    expect(useSettingsStore.getState().resolvedScheme).toBe("dark");

    // 再切回 light
    mqlMatches = false;
    act(() => changeHandlers.forEach((h) => h({ matches: false })));
    expect(useSettingsStore.getState().resolvedScheme).toBe("light");
  });

  it("scheme=auto 时注册系统监听；强制明暗时不注册", () => {
    useSettingsStore.setState({ scheme: "dark" });
    const { unmount } = renderHook(() => useThemeSync());
    expect(changeHandlers).toHaveLength(0); // 强制模式不监听系统
    unmount();

    useSettingsStore.setState({ scheme: "auto" });
    renderHook(() => useThemeSync());
    expect(changeHandlers.length).toBeGreaterThan(0); // auto 注册了监听
  });

  it("卸载时移除系统监听（防泄漏）", () => {
    useSettingsStore.setState({ scheme: "auto" });
    const { unmount } = renderHook(() => useThemeSync());
    const before = changeHandlers.length;
    unmount();
    expect(changeHandlers.length).toBeLessThan(before); // 监听被移除
  });
});
