/**
 * AppShell：响应式双形态外壳。
 * 只做断点分派与全局快捷键，不写业务；列表/编辑器由子布局组合。
 */
import { useEffect } from "react";
import { useCreateNote } from "@/hooks/useCreateNote";
import { useHotkeys } from "@/hooks/useHotkeys";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useNotesStore } from "@/stores/notesStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";
import { DesktopLayout } from "./DesktopLayout";
import { MobileLayout } from "./MobileLayout";

export function AppShell() {
  const isDesktop = useIsDesktop();
  const setDesktop = useUiStore((s) => s.setDesktop);
  const create = useCreateNote();
  const toggleScheme = useSettingsStore((s) => s.toggleScheme);
  const loadFolders = useNotesStore((s) => s.loadFolders);
  const loadTree = useNotesStore((s) => s.loadTree);

  useEffect(() => {
    setDesktop(isDesktop);
  }, [isDesktop, setDesktop]);

  // 侧栏笔记树是常驻数据，启动时加载一次
  useEffect(() => {
    void loadFolders();
    void loadTree();
  }, [loadFolders, loadTree]);

  // 跨区快捷键（编辑器内的文本格式化由 CodeMirror 处理）
  useHotkeys({
    "mod+n": () => void create(),
    "mod+shift+d": () => toggleScheme(),
  });

  return isDesktop ? <DesktopLayout /> : <MobileLayout />;
}
