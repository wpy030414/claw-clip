/**
 * UI 瞬态 store：断点、当前文件夹、侧栏状态、命令面板/大纲开关、确认对话框队列。
 * 不持久化（除少量），与 notesStore（数据真相源）/settingsStore（偏好）职责分离。
 */
import { create } from "zustand";

/** 侧栏页签：文档树 / 当前文件大纲。 */
export type SidebarTab = "docs" | "outline";

/** 编辑工作区视图：仅编辑 / 编辑+实时预览分屏 / 仅预览。 */
export type ViewMode = "edit" | "split" | "preview";

/**
 * 视图默认值：桌面「编辑 + 实时预览」，移动端「仅编辑」。
 *
 * 只作为未手动选择时的兜底，不落 localStorage —— 刷新后回到默认态（会话内瞬态）。
 */
export function defaultViewMode(isDesktop: boolean): ViewMode {
  return isDesktop ? "split" : "edit";
}

/** 大纲条目（由编辑器实时派生）。 */
export interface OutlineItem {
  level: number;
  text: string;
  /** 标题在文档中的字符偏移。 */
  pos: number;
}

/** 确认对话框请求（驱动 useConfirm + M3E dialog）。 */
export interface ConfirmRequest {
  id: string;
  content: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  /** 用户点确认时由 host 调用（执行动作 + resolve(true) + 出队）。 */
  onConfirm: () => void | Promise<void>;
  /** 用户取消时由 host 调用（resolve(false) + 出队）。 */
  onCancel: () => void;
}

interface UiState {
  /** 由 useMediaQuery 写入，AppShell 据此选布局。 */
  isDesktop: boolean;
  /** 当前选中文件夹；null = 根目录。同时作为「新建」的归属位置。 */
  currentFolderId: string | null;
  /** 桌面侧栏是否展开。 */
  sidebarOpen: boolean;
  sidebarTab: SidebarTab;
  /** 当前笔记大纲（编辑器写入，侧栏消费）。 */
  outline: OutlineItem[];
  commandPaletteOpen: boolean;
  /** 桌面大纲侧栏开关。 */
  tocOpen: boolean;
  /**
   * 用户手动选择的视图；null = 尚未选择，按断点取 defaultViewMode。
   * 不持久化：刷新页面即回到默认态。
   */
  viewMode: ViewMode | null;
  confirmQueue: ConfirmRequest[];

  setDesktop: (v: boolean) => void;
  setCurrentFolderId: (id: string | null) => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setOutline: (items: OutlineItem[]) => void;
  setCommandPalette: (open: boolean) => void;
  setViewMode: (mode: ViewMode | null) => void;
  toggleToc: () => void;
  setTocOpen: (open: boolean) => void;
  pushConfirm: (req: Omit<ConfirmRequest, "id">) => string;
  popConfirm: (id: string) => void;
}

export const useUiStore = create<UiState>()((set, get) => ({
  isDesktop: typeof window !== "undefined" ? window.innerWidth >= 900 : true,
  currentFolderId: null,
  sidebarOpen: true,
  sidebarTab: "docs",
  outline: [],
  commandPaletteOpen: false,
  tocOpen: true,
  viewMode: null,
  confirmQueue: [],

  setDesktop: (v) => set({ isDesktop: v }),
  setCurrentFolderId: (id) => set({ currentFolderId: id }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setOutline: (items) => set({ outline: items }),
  setCommandPalette: (open) => set({ commandPaletteOpen: open }),
  setViewMode: (mode) => set({ viewMode: mode }),
  toggleToc: () => set({ tocOpen: !get().tocOpen }),
  setTocOpen: (open) => set({ tocOpen: open }),
  pushConfirm: (req) => {
    const id = `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set({ confirmQueue: [...get().confirmQueue, { ...req, id }] });
    return id;
  },
  popConfirm: (id) => set({ confirmQueue: get().confirmQueue.filter((c) => c.id !== id) }),
}));
