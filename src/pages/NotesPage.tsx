import { useEffect } from "react";
import { NoteListPane } from "@/features/notes/NoteListPane";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useUiStore } from "@/stores/uiStore";
import { EditorPlaceholder } from "./EditorPlaceholder";

/** 笔记页：桌面由壳渲染列表（此处只占编辑器空态），移动端渲染整页列表。 */
export function NotesPage() {
  const isDesktop = useIsDesktop();
  const setListMode = useUiStore((s) => s.setListMode);
  const setFilter = useUiStore((s) => s.setFilter);
  const setKeyword = useUiStore((s) => s.setKeyword);

  useEffect(() => {
    setListMode("notes");
    setFilter({ starred: undefined });
    setKeyword("");
  }, [setListMode, setFilter, setKeyword]);

  return isDesktop ? <EditorPlaceholder /> : <NoteListPane />;
}
