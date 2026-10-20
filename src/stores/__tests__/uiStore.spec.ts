/**
 * uiStore 单测：UI 瞬态 + 确认对话框队列。
 */
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { defaultViewMode, useUiStore } from "@/stores/uiStore";

beforeEach(() => {
  useUiStore.setState({
    isDesktop: true,
    currentFolderId: null,
    sidebarOpen: true,
    sidebarTab: "docs",
    commandPaletteOpen: false,
    searchOpen: false,
    searchJump: null,
    tocOpen: true,
    viewMode: null,
    confirmQueue: [],
  });
});

describe("uiStore 基础 setter", () => {
  it("setDesktop 切换断点", () => {
    useUiStore.getState().setDesktop(false);
    expect(useUiStore.getState().isDesktop).toBe(false);
  });

  it("setSidebarOpen / setSidebarTab", () => {
    useUiStore.getState().setSidebarOpen(false);
    expect(useUiStore.getState().sidebarOpen).toBe(false);
    useUiStore.getState().setSidebarTab("outline");
    expect(useUiStore.getState().sidebarTab).toBe("outline");
  });

  it("setCurrentFolderId 记录新建位置", () => {
    useUiStore.getState().setCurrentFolderId("f1");
    expect(useUiStore.getState().currentFolderId).toBe("f1");
    useUiStore.getState().setCurrentFolderId(null);
    expect(useUiStore.getState().currentFolderId).toBeNull();
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

  it("setThemeDialogOpen", () => {
    useUiStore.getState().setThemeDialogOpen(true);
    expect(useUiStore.getState().themeDialogOpen).toBe(true);
    useUiStore.getState().setThemeDialogOpen(false);
    expect(useUiStore.getState().themeDialogOpen).toBe(false);
  });
});

describe("uiStore 编辑器视图（会话内瞬态）", () => {
  it("默认值：桌面分屏、移动端仅编辑", () => {
    expect(defaultViewMode(true)).toBe("split");
    expect(defaultViewMode(false)).toBe("edit");
  });

  it("初始不记录用户选择（null → 由断点兜底）", () => {
    expect(useUiStore.getState().viewMode).toBeNull();
  });

  it("setViewMode 记录手动选择，可重置回 null", () => {
    useUiStore.getState().setViewMode("preview");
    expect(useUiStore.getState().viewMode).toBe("preview");
    useUiStore.getState().setViewMode(null);
    expect(useUiStore.getState().viewMode).toBeNull();
  });

  it("视图选择不写 localStorage（刷新即重置）", () => {
    useUiStore.getState().setViewMode("edit");
    expect(localStorage.getItem("claw-clip-ui")).toBeNull();
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
    const id = useUiStore
      .getState()
      .pushConfirm({ content: "X", onConfirm: vi.fn(), onCancel: vi.fn() });
    useUiStore.getState().popConfirm(id);
    expect(useUiStore.getState().confirmQueue).toHaveLength(0);
  });

  it("popConfirm 不存在的 id 不影响队列", () => {
    useUiStore.getState().pushConfirm({ content: "keep", onConfirm: vi.fn(), onCancel: vi.fn() });
    useUiStore.getState().popConfirm("no-such-id");
    expect(useUiStore.getState().confirmQueue).toHaveLength(1);
  });

  it("pushConfirm 生成的 id 唯一", () => {
    const id1 = useUiStore
      .getState()
      .pushConfirm({ content: "1", onConfirm: vi.fn(), onCancel: vi.fn() });
    const id2 = useUiStore
      .getState()
      .pushConfirm({ content: "2", onConfirm: vi.fn(), onCancel: vi.fn() });
    expect(id1).not.toBe(id2);
  });
});

describe("uiStore 搜索跳转目标", () => {
  it("setSearchJump 写入目标并递增 token", () => {
    useUiStore.getState().setSearchJump({ noteId: "n1", from: 3, to: 8 });
    const first = useUiStore.getState().searchJump;
    expect(first).toMatchObject({ noteId: "n1", from: 3, to: 8 });
    expect(first?.token).toBeGreaterThan(0);

    useUiStore.getState().setSearchJump({ noteId: "n1", from: 9, to: 14 });
    expect(useUiStore.getState().searchJump?.token).toBe((first?.token ?? 0) + 1);
  });

  it("consumeSearchJump 只清空 token 匹配的目标", () => {
    useUiStore.getState().setSearchJump({ noteId: "n2", from: 0, to: 0 });
    const token = useUiStore.getState().searchJump!.token;

    useUiStore.getState().consumeSearchJump(token + 1);
    expect(useUiStore.getState().searchJump).not.toBeNull();

    useUiStore.getState().consumeSearchJump(token);
    expect(useUiStore.getState().searchJump).toBeNull();
  });
});
