import { useEffect } from "react";
import { NoteListPane } from "@/features/notes/NoteListPane";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useUiStore } from "@/stores/uiStore";
import { EditorPlaceholder } from "./EditorPlaceholder";

/** 搜索页：关键词匹配标题 + 正文 + 标签（大小写不敏感，见 query.ts）。 */
export function SearchPage() {
  const isDesktop = useIsDesktop();
  const setListMode = useUiStore((s) => s.setListMode);
  const setFilter = useUiStore((s) => s.setFilter);

  useEffect(() => {
    setListMode("search");
    setFilter({ starred: undefined });
  }, [setListMode, setFilter]);

  return isDesktop ? <EditorPlaceholder /> : <NoteListPane />;
}
