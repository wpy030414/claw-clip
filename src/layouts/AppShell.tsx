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
import { TaskProgressOverlay } from "@/components/common/TaskProgressOverlay";
import { requestPersistentStorage } from "@/data/storageReport";
import { StorageDialog } from "@/features/storage/StorageDialog";
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

  // 持久化存储：启动时自动尝试一次（浏览器可能静默拒绝），不向用户暴露申请按钮
  useEffect(() => {
    void requestPersistentStorage();
  }, []);

  // 侧栏笔记树是常驻数据，启动时加载一次
  useEffect(() => {
    void loadFolders();
    void loadTree();
  }, [loadFolders, loadTree]);

  /**
   * 全局文件拖放兜底：拖到没有自定义处理的位置（例如大纲页签、编辑器空白处）时
   * 阻止浏览器直接打开文件把应用顶掉。真正消费文件的区域会各自 preventDefault 并处理。
   */
  useEffect(() => {
    const isFileDrag = (e: globalThis.DragEvent) =>
      Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const prevent = (e: globalThis.DragEvent) => {
      if (isFileDrag(e)) e.preventDefault();
    };
    window.addEventListener("dragover", prevent);
    window.addEventListener("drop", prevent);
    return () => {
      window.removeEventListener("dragover", prevent);
      window.removeEventListener("drop", prevent);
    };
  }, []);

  // 跨区快捷键（编辑器内的文本格式化由 CodeMirror 处理）
  useHotkeys({
    "mod+n": () => void create(),
    "mod+shift+d": () => toggleScheme(),
  });

  return (
    <>
      {isDesktop ? <DesktopLayout /> : <MobileLayout />}
      <StorageDialog />
      <TaskProgressOverlay />
    </>
  );
}
