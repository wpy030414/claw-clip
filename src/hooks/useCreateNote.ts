/**
 * useCreateNote：新建笔记 → 切回「全部笔记」语义 → 跳转编辑器。
 * 列表页按钮、移动 FAB 与 Cmd+N 快捷键共用，避免三处重复同一套状态清理。
 */
import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useNotesStore } from "@/stores/notesStore";
import { useUiStore } from "@/stores/uiStore";

export function useCreateNote(): () => Promise<string> {
  const navigate = useNavigate();
  const createNote = useNotesStore((s) => s.createNote);
  const setFilter = useUiStore((s) => s.setFilter);
  const setKeyword = useUiStore((s) => s.setKeyword);
  const setListMode = useUiStore((s) => s.setListMode);
  const currentFolderId = useUiStore((s) => s.currentFolderId);

  return useCallback(async () => {
    const id = await createNote(currentFolderId);
    // 新笔记一定不属于当前收藏/搜索筛选，回到全部笔记避免「创建后看不见」
    setFilter({ starred: undefined });
    setKeyword("");
    setListMode("notes");
    navigate(`/n/${id}`);
    return id;
  }, [createNote, navigate, setFilter, setKeyword, setListMode, currentFolderId]);
}
