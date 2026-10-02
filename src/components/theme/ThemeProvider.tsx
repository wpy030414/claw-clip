/**
 * 主题 Provider：包装 <m3e-theme> + 字体加载 + useThemeSync 挂载。
 * 放在 React 树根，所有 light-DOM 内容（Vditor 画布）必须是其后代才能消费 token。
 */
import type { ReactNode } from "react";
import { M3eTheme } from "@/components/m3e";
import { useSettingsStore } from "@/stores/settingsStore";
import { useThemeSync } from "@/hooks/useThemeSync";

interface Props {
  children: ReactNode;
}

export function ThemeProvider({ children }: Props) {
  useThemeSync(); // 顶层调一次，解析 auto → resolvedScheme

  const scheme = useSettingsStore((s) => s.scheme);
  const seedColor = useSettingsStore((s) => s.seedColor);
  const contrast = useSettingsStore((s) => s.contrast);
  const density = useSettingsStore((s) => s.density);
  const motion = useSettingsStore((s) => s.motion);

  return (
    <M3eTheme
      color={seedColor}
      scheme={scheme}
      variant="expressive"
      contrast={contrast}
      density={density}
      motion={motion}
    >
      {children}
    </M3eTheme>
  );
}
