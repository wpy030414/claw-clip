/**
 * UI 瞬态 store：断点、搜索词、列表过滤、命令面板/大纲开关、确认对话框队列。
 * 不持久化（除少量），与 notesStore（数据真相源）/settingsStore（偏好）职责分离。
 */
import { create } from "zustand";
import type { NoteFilter } from "@/types/note";

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
  commandPaletteOpen: boolean;
  /** 桌面大纲侧栏开关。 */
  tocOpen: boolean;
  confirmQueue: ConfirmRequest[];

  setDesktop: (v: boolean) => void;
  setKeyword: (v: string) => void;
  setFilter: (patch: Partial<NoteFilter>) => void;
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
  commandPaletteOpen: false,
  tocOpen: true,
  confirmQueue: [],

  setDesktop: (v) => set({ isDesktop: v }),
  setKeyword: (v) => set({ keyword: v }),
  setFilter: (patch) => set({ filter: { ...get().filter, ...patch } }),
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
