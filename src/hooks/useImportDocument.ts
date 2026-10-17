/**
 * useImportDocument：导入 MD / DOCX / PDF → 新建笔记 → 跳转编辑器。
 * 解析在 exchange.ts（重型依赖动态加载），本 hook 只负责编排与提示。
 */
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { toastError, toastSuccess } from "@/components/common/Snackbar";
import { importDocument } from "@/data/exchange";
import { useNotesStore } from "@/stores/notesStore";
import { useUiStore } from "@/stores/uiStore";

export function useImportDocument(): (file: File) => Promise<void> {
  const navigate = useNavigate();
  const createNote = useNotesStore((s) => s.createNote);
  const openNote = useNotesStore((s) => s.openNote);
  const saveActive = useNotesStore((s) => s.saveActive);
  const currentFolderId = useUiStore((s) => s.currentFolderId);

  return useCallback(
    async (file: File) => {
      try {
        toastSuccess(`正在导入 ${file.name}…`, 2000);
        const doc = await importDocument(file);
        const id = await createNote(currentFolderId);
        await openNote(id);
        await saveActive({ content: doc.content, title: doc.title });
        navigate(`/n/${id}`);
        toastSuccess(`已导入「${doc.title}」`);
      } catch (e) {
        toastError(`导入失败：${e instanceof Error ? e.message : String(e)}`);
      }
    },
    [navigate, createNote, openNote, saveActive, currentFolderId],
  );
}
