/**
 * EditorPane：编辑器面板（S4 核心）。
 *
 * 桌面右侧面板与移动全屏编辑器**共用**此组件（仅外层布局不同）。
 * 装配：VditorEditor（画布）+ useNoteEditor（数据桥接）+ 顶栏（标题/保存态/收藏/字数）。
 *
 * content 形态转换由 useNoteEditor 负责：
 * - 载入：clawclip://（存储态）→ object URL（渲染态，喂给 Vditor）
 * - 保存：object URL（渲染态）→ clawclip://（存储态，落库）
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { VditorEditor, type VditorEditorHandle } from "@/components/editor/VditorEditor";
import { useNoteEditor } from "@/hooks/useNoteEditor";
import { useNotesStore } from "@/stores/notesStore";
import { M3eIconButton } from "@/components/m3e";
import { toastSuccess } from "@/components/common/Snackbar";

interface Props {
  noteId: string;
  /** 移动端：返回按钮回调。桌面端不传（列表常驻）。 */
  onBack?: () => void;
}

type SaveState = "idle" | "saving" | "saved";

export function EditorPane({ noteId, onBack }: Props) {
  const { editorValue, loading, handleChange, saveNow } = useNoteEditor(noteId);
  const activeNote = useNotesStore((s) => s.activeNote);
  const toggleStar = useNotesStore((s) => s.toggleStar);
  const remove = useNotesStore((s) => s.remove);

  const vdRef = useRef<VditorEditorHandle>(null);
  const [wordCount, setWordCount] = useState(0);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 输入 → 标记 saving，节流结束后短暂显示 saved
  const onEditorChange = useCallback(
    (value: string) => {
      setSaveState("saving");
      handleChange(value);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => setSaveState("saved"), 1000);
    },
    [handleChange],
  );

  // Cmd+S 立即保存（快捷键层也注册，此处双保险 + 提示）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void handleSaveNow();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  const handleSaveNow = useCallback(async () => {
    await saveNow();
    setSaveState("saved");
    toastSuccess("已保存");
  }, [saveNow]);

  const handleStar = useCallback(async () => {
    await toggleStar(noteId);
  }, [toggleStar, noteId]);

  const handleDelete = useCallback(async () => {
    await remove(noteId);
    onBack?.();
  }, [remove, noteId, onBack]);

  // 切笔记时重置字数/保存态
  useEffect(() => {
    setWordCount(activeNote?.wordCount ?? 0);
    setSaveState("idle");
  }, [noteId, activeNote?.wordCount]);

  const saveLabel =
    saveState === "saving" ? "保存中…" : saveState === "saved" ? "已保存" : "已就绪";

  return (
    <div className="editor-pane" data-testid="editor-pane">
      {/* 顶栏 */}
      <div className="editor-topbar" data-testid="editor-topbar">
        {onBack && (
          <M3eIconButton onClick={onBack} aria-label="返回" data-testid="btn-back">
            <span className="material-symbols-outlined">arrow_back</span>
          </M3eIconButton>
        )}
        <span className="editor-title" data-testid="editor-title">
          {activeNote?.title ?? "无标题"}
        </span>
        <span className="editor-meta">
          <span className="editor-save-state" data-testid="save-state">{saveLabel}</span>
          <span className="editor-word-count" data-testid="word-count">{wordCount} 字</span>
        </span>
        <M3eIconButton
          onClick={handleStar}
          aria-label="收藏"
          data-testid="btn-star"
          data-starred={activeNote?.starred ? "true" : "false"}
        >
          <span className="material-symbols-outlined">
            {activeNote?.starred ? "star" : "star_border"}
          </span>
        </M3eIconButton>
        <M3eIconButton onClick={handleDelete} aria-label="删除" data-testid="btn-delete">
          <span className="material-symbols-outlined">delete</span>
        </M3eIconButton>
      </div>

      {/* 编辑器画布（Vditor IR）
          ★ key={noteId}：VditorEditor 只在 noteId 变化时重挂。
          ★ 载入态用 overlay 覆盖，绝不用 early-return 卸载画布子树——
            否则 useNoteEditor 每次 setLoading(true→false) 都会销毁重建 Vditor 实例
            （叠加 StrictMode 双调用 = 挂载 4 次），file input 与 upload handler 闭包
            错位到不同实例，上传时读到已销毁实例的空 getValue() → 图片丢失。
            （debug10 实测根因，见 VditorEditor upload.handler 注释。） */}
      <div className="editor-canvas">
        <VditorEditor
          key={noteId}
          ref={vdRef}
          noteId={noteId}
          initialValue={editorValue}
          onChange={onEditorChange}
          onWordCount={setWordCount}
        />
        {loading && (
          <div className="editor-loading-overlay" data-testid="editor-loading">
            载入中…
          </div>
        )}
      </div>
    </div>
  );
}
