/**
 * useHotkeys 单测：组合键规范化 + 全局拦截。
 * 纯 window keydown 逻辑，不涉及 M3E/Vditor 渲染。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useHotkeys, normalizeCombo } from "@/hooks/useHotkeys";

/** 派发一个 keydown 事件到 window。 */
function fireKey(init: KeyboardEventInit) {
  const ev = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  window.dispatchEvent(ev);
  return ev;
}

describe("normalizeCombo", () => {
  it("单字符键小写化", () => {
    expect(normalizeCombo(new KeyboardEvent("keydown", { key: "S" }))).toBe("s");
  });
  it("mod 组合（metaKey）", () => {
    expect(normalizeCombo(new KeyboardEvent("keydown", { key: "s", metaKey: true }))).toBe("mod+s");
  });
  it("mod 组合（ctrlKey，非 mac）", () => {
    expect(normalizeCombo(new KeyboardEvent("keydown", { key: "s", ctrlKey: true }))).toBe("mod+s");
  });
  it("mod+shift 组合", () => {
    expect(
      normalizeCombo(new KeyboardEvent("keydown", { key: "d", metaKey: true, shiftKey: true })),
    ).toBe("mod+shift+d");
  });
  it("命名键（Escape）小写", () => {
    expect(normalizeCombo(new KeyboardEvent("keydown", { key: "Escape" }))).toBe("escape");
  });
  it("符号键原样", () => {
    expect(normalizeCombo(new KeyboardEvent("keydown", { key: "/", metaKey: true }))).toBe("mod+/");
  });
});

describe("useHotkeys", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("命中注册的组合键 → 调用 handler 并 preventDefault", () => {
    const onSave = vi.fn();
    renderHook(() => useHotkeys({ "mod+s": onSave }));

    const ev = fireKey({ key: "s", metaKey: true });
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(true); // 拦截了默认行为
  });

  it("未注册的组合键 → 不调用、不 preventDefault", () => {
    const onSave = vi.fn();
    renderHook(() => useHotkeys({ "mod+s": onSave }));

    const ev = fireKey({ key: "x", metaKey: true });
    expect(onSave).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it("纯字符输入（无 mod）不被已注册 mod 组合拦截", () => {
    const onSave = vi.fn();
    renderHook(() => useHotkeys({ "mod+s": onSave }));

    const ev = fireKey({ key: "s" }); // 无 metaKey，只是打字 s
    expect(onSave).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false); // ★ 不干扰正常输入
  });

  it("多个 handler 各自命中", () => {
    const onNew = vi.fn();
    const onPalette = vi.fn();
    renderHook(() => useHotkeys({ "mod+n": onNew, "mod+k": onPalette }));

    fireKey({ key: "n", metaKey: true });
    fireKey({ key: "k", metaKey: true });
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(onPalette).toHaveBeenCalledTimes(1);
  });

  it("enabled=false 时不拦截", () => {
    const onSave = vi.fn();
    renderHook(() => useHotkeys({ "mod+s": onSave }, false));

    const ev = fireKey({ key: "s", metaKey: true });
    expect(onSave).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(false);
  });

  it("handlers 更新后读最新闭包（ref 存最新，不过时）", () => {
    let count = 0;
    const { rerender } = renderHook(
      ({ n }) => useHotkeys({ "mod+s": () => { count = n; } }),
      { initialProps: { n: 1 } },
    );
    rerender({ n: 2 }); // 更新 handler
    fireKey({ key: "s", metaKey: true });
    expect(count).toBe(2); // ★ 读到最新 n，非旧闭包的 1
  });

  it("卸载后移除监听", () => {
    const onSave = vi.fn();
    const { unmount } = renderHook(() => useHotkeys({ "mod+s": onSave }));
    unmount();
    fireKey({ key: "s", metaKey: true });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("Escape 命中", () => {
    const onEsc = vi.fn();
    renderHook(() => useHotkeys({ escape: onEsc }));
    fireKey({ key: "Escape" });
    expect(onEsc).toHaveBeenCalledTimes(1);
  });
});
