/**
 * 设置 store：主题偏好 + 编辑器偏好，持久化到 localStorage。
 *
 * - scheme/seedColor/contrast/density/motion 驱动 <m3e-theme>
 * - resolvedScheme 是 auto 解析后的实际明暗值，供 Vditor 主题同步消费（useThemeSync 写入）
 * - editorMode 变化会触发 VditorEditor 重建（mount effect 依赖它）
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_SETTINGS, type EditorMode, type ResolvedScheme, type Settings } from "@/types/settings";

interface SettingsState extends Settings {
  /** auto 解析后的实际明暗，供 Vditor 同步。不持久化（每次启动由 useThemeSync 重算）。 */
  resolvedScheme: ResolvedScheme;

  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  setResolvedScheme: (s: ResolvedScheme) => void;
  /** 循环切换编辑模式：ir → sv → wysiwyg → ir。 */
  cycleEditorMode: () => void;
  /** 明暗快捷切换：auto→(取反当前) light↔dark。 */
  toggleScheme: () => void;
}

const MODE_ORDER: EditorMode[] = ["ir", "sv", "wysiwyg"];

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...DEFAULT_SETTINGS,
      resolvedScheme:
        typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light",

      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
      setResolvedScheme: (s) => set({ resolvedScheme: s }),

      cycleEditorMode: () => {
        const cur = get().editorMode;
        const next = MODE_ORDER[(MODE_ORDER.indexOf(cur) + 1) % MODE_ORDER.length];
        set({ editorMode: next });
      },

      toggleScheme: () => {
        const { scheme, resolvedScheme } = get();
        // auto 时取当前解析值的反面；已强制则对调 light/dark
        if (scheme === "auto") set({ scheme: resolvedScheme === "dark" ? "light" : "dark" });
        else set({ scheme: scheme === "dark" ? "light" : "dark" });
      },
    }),
    {
      name: "claw-clip-settings",
      // resolvedScheme 不持久化（运行时重算）
      partialize: (s) => ({
        scheme: s.scheme,
        seedColor: s.seedColor,
        contrast: s.contrast,
        density: s.density,
        motion: s.motion,
        editorMode: s.editorMode,
        fontSize: s.fontSize,
      }),
    },
  ),
);
