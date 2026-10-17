/**
 * useCreateNote：新建笔记（归属当前选中文件夹）→ 跳转编辑器。
 * 侧栏新建行与快捷键 Cmd+N 共用。
 */
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useNotesStore } from "@/stores/notesStore";
import { useUiStore } from "@/stores/uiStore";

export function useCreateNote(): () => Promise<string> {
  const navigate = useNavigate();
  const createNote = useNotesStore((s) => s.createNote);
  const currentFolderId = useUiStore((s) => s.currentFolderId);

  return useCallback(async () => {
    const id = await createNote(currentFolderId);
    navigate(`/n/${id}`);
    return id;
  }, [createNote, navigate, currentFolderId]);
}
