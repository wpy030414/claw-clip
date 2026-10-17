/**
 * 设置 store：主题偏好 + 编辑器偏好，持久化到 localStorage。
 *
 * - scheme/seedColor/contrast/density/motion 驱动 <m3e-theme>
 * - resolvedScheme 是 auto 解析后的实际明暗值，供预览高亮主题消费（useThemeSync 写入）
 */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_SETTINGS, type ResolvedScheme, type Settings } from "@/types/settings";

interface SettingsState extends Settings {
  /** auto 解析后的实际明暗，供预览/高亮主题消费。不持久化（每次启动由 useThemeSync 重算）。 */
  resolvedScheme: ResolvedScheme;

  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  setResolvedScheme: (s: ResolvedScheme) => void;
  /** 明暗快捷切换：auto→(取反当前) light↔dark。 */
  toggleScheme: () => void;
}

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
        fontSize: s.fontSize,
        previewCss: s.previewCss,
        viewMode: s.viewMode,
      }),
    },
  ),
);
