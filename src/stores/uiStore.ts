/**
 * UI 瞬态 store：断点、搜索词、列表过滤、命令面板/大纲开关、确认对话框队列。
 * 不持久化（除少量），与 notesStore（数据真相源）/settingsStore（偏好）职责分离。
 */
import { create } from "zustand";
import type { NoteFilter } from "@/types/note";

/** 列表页语义：决定列表过滤与标题（跨 /n/:id 保持）。 */
export type ListMode = "notes" | "starred" | "search";

/** 侧栏页签：文档树 / 当前文件大纲。 */
export type SidebarTab = "docs" | "outline";

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
  /** 搜索关键词（合并旧 searched store）。 */
  keyword: string;
  /** 当前列表过滤（starred/tags/sort）。 */
  filter: NoteFilter;
  /** 当前列表页语义（笔记/收藏/搜索）。导航到编辑器时保持，返回列表不丢筛选。 */
  listMode: ListMode;
  /** 当前选中文件夹；null = 全部笔记（不按文件夹过滤）。 */
  currentFolderId: string | null;
  /** 桌面侧栏是否展开。 */
  sidebarOpen: boolean;
  sidebarTab: SidebarTab;
  /** 当前笔记大纲（编辑器写入，侧栏消费）。 */
  outline: OutlineItem[];
  commandPaletteOpen: boolean;
  /** 桌面大纲侧栏开关。 */
  tocOpen: boolean;
  confirmQueue: ConfirmRequest[];

  setDesktop: (v: boolean) => void;
  setKeyword: (v: string) => void;
  setFilter: (patch: Partial<NoteFilter>) => void;
  setListMode: (mode: ListMode) => void;
  setCurrentFolderId: (id: string | null) => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarTab: (tab: SidebarTab) => void;
  setOutline: (items: OutlineItem[]) => void;
  resetFilter: () => void;
  setCommandPalette: (open: boolean) => void;
  toggleToc: () => void;
  setTocOpen: (open: boolean) => void;
  pushConfirm: (req: Omit<ConfirmRequest, "id">) => string;
  popConfirm: (id: string) => void;
}

export const useUiStore = create<UiState>()((set, get) => ({
  isDesktop: typeof window !== "undefined" ? window.innerWidth >= 900 : true,
  keyword: "",
  filter: {},
  listMode: "notes",
  currentFolderId: null,
  sidebarOpen: true,
  sidebarTab: "docs",
  outline: [],
  commandPaletteOpen: false,
  tocOpen: true,
  confirmQueue: [],

  setDesktop: (v) => set({ isDesktop: v }),
  setKeyword: (v) => set({ keyword: v }),
  setFilter: (patch) => set({ filter: { ...get().filter, ...patch } }),
  setListMode: (mode) => set({ listMode: mode }),
  setCurrentFolderId: (id) => set({ currentFolderId: id }),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setSidebarTab: (tab) => set({ sidebarTab: tab }),
  setOutline: (items) => set({ outline: items }),
  resetFilter: () => set({ filter: {}, keyword: "" }),
  setCommandPalette: (open) => set({ commandPaletteOpen: open }),
  toggleToc: () => set({ tocOpen: !get().tocOpen }),
  setTocOpen: (open) => set({ tocOpen: open }),
  pushConfirm: (req) => {
    const id = `confirm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set({ confirmQueue: [...get().confirmQueue, { ...req, id }] });
    return id;
  },
  popConfirm: (id) => set({ confirmQueue: get().confirmQueue.filter((c) => c.id !== id) }),
}));
