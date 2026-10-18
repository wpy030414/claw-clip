import { useCallback, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { EditorPane } from "@/features/editor/EditorPane";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useNotesStore } from "@/stores/notesStore";
import { EditorPlaceholder } from "./EditorPlaceholder";

/** 编辑器路由 /n/:noteId：桌面常驻右栏，移动端全屏（带返回）。 */
export function EditorPage() {
  const { noteId } = useParams<{ noteId: string }>();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const dataEpoch = useNotesStore((s) => s.dataEpoch);
  const backToList = useCallback(() => {
    navigate("/");
  }, [navigate]);

  // 导入/清空后当前路由的笔记可能已不存在：回到首页，避免编辑器停在幽灵文档上
  useEffect(() => {
    if (!noteId) return;
    const tree = useNotesStore.getState().treeNotes;
    if (tree.length > 0 && !tree.some((n) => n.id === noteId)) {
      navigate("/", { replace: true });
    }
  }, [dataEpoch, noteId, navigate]);

  if (!noteId) return <EditorPlaceholder />;

  return (
    <EditorPane
      key={`${noteId}-${dataEpoch}`}
      noteId={noteId}
      onBack={isDesktop ? undefined : backToList}
      onDeleted={backToList}
    />
  );
}
