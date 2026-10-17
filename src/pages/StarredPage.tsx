import { useEffect } from "react";
import { NoteListPane } from "@/features/notes/NoteListPane";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useUiStore } from "@/stores/uiStore";
import { EditorPlaceholder } from "./EditorPlaceholder";

/** 收藏页：列表过滤 starred=true。 */
export function StarredPage() {
  const isDesktop = useIsDesktop();
  const setListMode = useUiStore((s) => s.setListMode);
  const setFilter = useUiStore((s) => s.setFilter);
  const setKeyword = useUiStore((s) => s.setKeyword);

  useEffect(() => {
    setListMode("starred");
    setFilter({ starred: true });
    setKeyword("");
  }, [setListMode, setFilter, setKeyword]);

  return isDesktop ? <EditorPlaceholder /> : <NoteListPane />;
}
