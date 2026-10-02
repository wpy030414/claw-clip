/**
 * throttle / debounce 单测。
 *
 * ★ throttle 是 leading+trailing 语义（离散动作立即落库，连续打字仍节流），
 *   这是附件自动保存 bug 修复的关键，行为必须被锁定。
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { throttle, debounce } from "@/utils/throttle";

describe("throttle (leading + trailing)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("首次调用立即执行（leading edge）——离散动作无需等窗口", () => {
    const fn = vi.fn();
    const t = throttle(fn, 800);
    t("a");
    expect(fn).toHaveBeenCalledTimes(1); // ★ 立即执行，不等 800ms
    expect(fn).toHaveBeenCalledWith("a");
  });

  it("窗口内连续调用只在末尾执行最后一次（trailing edge）", () => {
    const fn = vi.fn();
    const t = throttle(fn, 800);
    t("a"); // leading 立即执行
    t("b");
    t("c"); // 窗口内，只记录最后参数
    expect(fn).toHaveBeenCalledTimes(1); // 窗口内不再执行
    vi.advanceTimersByTime(800);
    expect(fn).toHaveBeenCalledTimes(2); // trailing 执行一次
    expect(fn).toHaveBeenLastCalledWith("c"); // 用最后一次参数
  });

  it("窗口结束后再次调用重新 leading 立即执行", () => {
    const fn = vi.fn();
    const t = throttle(fn, 800);
    t("a"); // leading
    vi.advanceTimersByTime(800); // 窗口结束（trailing 无挂起参数，不额外执行）
    expect(fn).toHaveBeenCalledTimes(1);
    t("b"); // 新窗口 leading
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("b");
  });

  it("flush 立即执行挂起的 trailing 调用", () => {
    const fn = vi.fn();
    const t = throttle(fn, 800);
    t("a"); // leading
    t("b"); // 挂起
    t.flush();
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith("b");
  });

  it("flush 无挂起调用时不额外执行", () => {
    const fn = vi.fn();
    const t = throttle(fn, 800);
    t("a"); // leading，无挂起
    t.flush();
    expect(fn).toHaveBeenCalledTimes(1); // 仍是 1，flush 不重复执行 a
  });

  it("cancel 丢弃挂起调用，不执行", () => {
    const fn = vi.fn();
    const t = throttle(fn, 800);
    t("a"); // leading
    t("b"); // 挂起
    t.cancel();
    vi.advanceTimersByTime(800);
    expect(fn).toHaveBeenCalledTimes(1); // 只有 leading 的 a，b 被丢弃
  });

  it("saveActive 语义验证：Cmd+S 用 cancel+直接保存（不依赖窗口）", () => {
    // useNoteEditor.saveNow 走 throttled.cancel() 后立即 saveActive，
    // 此处验证 cancel 后 trailing 不再重复触发（避免双写）
    const fn = vi.fn();
    const t = throttle(fn, 800);
    t("typing1"); // leading 立即存
    t("typing2"); // 挂起
    t.cancel(); // Cmd+S：取消挂起，改用即时保存
    fn("saved-now"); // 模拟 saveNow 直接调用
    vi.advanceTimersByTime(800);
    expect(fn).toHaveBeenCalledTimes(2); // typing1(leading) + saved-now，无 trailing 双写
    expect(fn).toHaveBeenLastCalledWith("saved-now");
  });
});

describe("debounce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("停止调用 wait 后才执行（搜索场景）", () => {
    const fn = vi.fn();
    const d = debounce(fn, 300);
    d("a");
    d("ab");
    d("abc");
    expect(fn).not.toHaveBeenCalled(); // 仍在打字，不执行
    vi.advanceTimersByTime(300);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("abc"); // 最后一次
  });

  it("每次调用重置计时器", () => {
    const fn = vi.fn();
    const d = debounce(fn, 300);
    d("a");
    vi.advanceTimersByTime(200);
    d("ab"); // 重置
    vi.advanceTimersByTime(200);
    expect(fn).not.toHaveBeenCalled(); // 累计 400ms 但因重置还没到
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("cancel 丢弃挂起调用", () => {
    const fn = vi.fn();
    const d = debounce(fn, 300);
    d("a");
    d.cancel();
    vi.advanceTimersByTime(300);
    expect(fn).not.toHaveBeenCalled();
  });

  it("flush 立即执行挂起调用", () => {
    const fn = vi.fn();
    const d = debounce(fn, 300);
    d("a");
    d.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith("a");
  });
});
