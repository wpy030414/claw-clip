import { NoteListPane } from "@/features/notes/NoteListPane";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { EditorPlaceholder } from "./EditorPlaceholder";

/** 笔记页：桌面由侧栏渲染笔记树（此处只占编辑器空态），移动端渲染整页笔记树。 */
export function NotesPage() {
  const isDesktop = useIsDesktop();
  return isDesktop ? <EditorPlaceholder /> : <NoteListPane />;
}
