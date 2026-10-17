import { useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { EditorPane } from "@/features/editor/EditorPane";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { EditorPlaceholder } from "./EditorPlaceholder";

/** 编辑器路由 /n/:noteId：桌面常驻右栏，移动端全屏（带返回）。 */
export function EditorPage() {
  const { noteId } = useParams<{ noteId: string }>();
  const isDesktop = useIsDesktop();
  const navigate = useNavigate();
  const backToList = useCallback(() => {
    navigate("/");
  }, [navigate]);

  if (!noteId) return <EditorPlaceholder />;

  return (
    <EditorPane
      key={noteId}
      noteId={noteId}
      onBack={isDesktop ? undefined : backToList}
      onDeleted={backToList}
    />
  );
}
