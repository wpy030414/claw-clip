/**
 * uiStore 单测：UI 瞬态 + 确认对话框队列。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useUiStore } from "@/stores/uiStore";

beforeEach(() => {
  useUiStore.setState({
    isDesktop: true,
    keyword: "",
    filter: {},
    commandPaletteOpen: false,
    tocOpen: true,
    confirmQueue: [],
  });
});

describe("uiStore 基础 setter", () => {
  it("setDesktop 切换断点", () => {
    useUiStore.getState().setDesktop(false);
    expect(useUiStore.getState().isDesktop).toBe(false);
  });

  it("setKeyword 更新搜索词", () => {
    useUiStore.getState().setKeyword("搜索内容");
    expect(useUiStore.getState().keyword).toBe("搜索内容");
  });

  it("setFilter 合并过滤条件", () => {
    useUiStore.getState().setFilter({ starred: true });
    useUiStore.getState().setFilter({ tags: ["a"] });
    expect(useUiStore.getState().filter).toEqual({ starred: true, tags: ["a"] }); // ★ 合并非替换
  });

  it("resetFilter 清空过滤 + 关键词", () => {
    useUiStore.getState().setFilter({ starred: true });
    useUiStore.getState().setKeyword("x");
    useUiStore.getState().resetFilter();
    expect(useUiStore.getState().filter).toEqual({});
    expect(useUiStore.getState().keyword).toBe("");
  });

  it("toggleToc 翻转大纲开关", () => {
    expect(useUiStore.getState().tocOpen).toBe(true);
    useUiStore.getState().toggleToc();
    expect(useUiStore.getState().tocOpen).toBe(false);
  });

  it("setCommandPalette", () => {
    useUiStore.getState().setCommandPalette(true);
    expect(useUiStore.getState().commandPaletteOpen).toBe(true);
  });
});

describe("uiStore 确认对话框队列", () => {
  it("pushConfirm 入队并返回 id", () => {
    const id = useUiStore.getState().pushConfirm({
      content: "确认删除？",
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    });
    expect(id).toBeTruthy();
    expect(useUiStore.getState().confirmQueue).toHaveLength(1);
    expect(useUiStore.getState().confirmQueue[0].content).toBe("确认删除？");
  });

  it("多次 push 按序入队", () => {
    useUiStore.getState().pushConfirm({ content: "A", onConfirm: vi.fn(), onCancel: vi.fn() });
    useUiStore.getState().pushConfirm({ content: "B", onConfirm: vi.fn(), onCancel: vi.fn() });
    const queue = useUiStore.getState().confirmQueue;
    expect(queue).toHaveLength(2);
    expect(queue[0].content).toBe("A");
    expect(queue[1].content).toBe("B");
  });

  it("popConfirm 按 id 出队", () => {
    const id = useUiStore.getState().pushConfirm({ content: "X", onConfirm: vi.fn(), onCancel: vi.fn() });
    useUiStore.getState().popConfirm(id);
    expect(useUiStore.getState().confirmQueue).toHaveLength(0);
  });

  it("popConfirm 不存在的 id 不影响队列", () => {
    useUiStore.getState().pushConfirm({ content: "keep", onConfirm: vi.fn(), onCancel: vi.fn() });
    useUiStore.getState().popConfirm("no-such-id");
    expect(useUiStore.getState().confirmQueue).toHaveLength(1);
  });

  it("pushConfirm 生成的 id 唯一", () => {
    const id1 = useUiStore.getState().pushConfirm({ content: "1", onConfirm: vi.fn(), onCancel: vi.fn() });
    const id2 = useUiStore.getState().pushConfirm({ content: "2", onConfirm: vi.fn(), onCancel: vi.fn() });
    expect(id1).not.toBe(id2);
  });
});
