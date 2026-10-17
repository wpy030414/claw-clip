/**
 * settingsStore 单测：主题偏好 + 编辑器偏好的纯逻辑分支。
 * persist 落 localStorage 由 zustand middleware 保证，此处测 action 逻辑。
 */
import { beforeEach, describe, expect, it } from "vitest";
import { useSettingsStore } from "@/stores/settingsStore";
import { DEFAULT_SETTINGS } from "@/types/settings";

beforeEach(() => {
  // 重置到默认态
  useSettingsStore.setState({ ...DEFAULT_SETTINGS, resolvedScheme: "light" });
});

describe("settingsStore.set", () => {
  it("set 单字段更新", () => {
    useSettingsStore.getState().set("scheme", "dark");
    expect(useSettingsStore.getState().scheme).toBe("dark");
  });

  it("set seedColor", () => {
    useSettingsStore.getState().set("seedColor", "#00FF00");
    expect(useSettingsStore.getState().seedColor).toBe("#00FF00");
  });
});

describe("settingsStore.toggleScheme（明暗快捷切换）", () => {
  it("auto 且当前解析为 dark → 强制 light", () => {
    useSettingsStore.setState({ scheme: "auto", resolvedScheme: "dark" });
    useSettingsStore.getState().toggleScheme();
    expect(useSettingsStore.getState().scheme).toBe("light");
  });

  it("auto 且当前解析为 light → 强制 dark", () => {
    useSettingsStore.setState({ scheme: "auto", resolvedScheme: "light" });
    useSettingsStore.getState().toggleScheme();
    expect(useSettingsStore.getState().scheme).toBe("dark");
  });

  it("已强制 dark → 切到 light", () => {
    useSettingsStore.setState({ scheme: "dark" });
    useSettingsStore.getState().toggleScheme();
    expect(useSettingsStore.getState().scheme).toBe("light");
  });

  it("已强制 light → 切到 dark", () => {
    useSettingsStore.setState({ scheme: "light" });
    useSettingsStore.getState().toggleScheme();
    expect(useSettingsStore.getState().scheme).toBe("dark");
  });
});

describe("settingsStore.setResolvedScheme", () => {
  it("写入解析后的明暗值", () => {
    useSettingsStore.getState().setResolvedScheme("dark");
    expect(useSettingsStore.getState().resolvedScheme).toBe("dark");
  });
});

describe("settingsStore persist（partialize 排除 resolvedScheme）", () => {
  it("resolvedScheme 不进持久化白名单", () => {
    const state = useSettingsStore.getState();
    // persist 的 partialize 由 middleware 内部调用，此处验证 setResolvedScheme 不写 localStorage
    state.setResolvedScheme("dark");
    const raw = localStorage.getItem("claw-clip-settings");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!);
    expect(parsed.state.resolvedScheme).toBeUndefined(); // ★ 不持久化
    expect(parsed.state.scheme).toBeDefined(); // 但 scheme 持久化
  });
});
