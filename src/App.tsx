/**
 * S4 最小可运行 App：验证「新建→编辑→自动保存→刷新仍在」数据闭环。
 * 不含完整双形态布局（S5），仅 ThemeProvider + EditorPane + 新建按钮。
 */
import { useEffect, useState } from "react";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { EditorPane } from "@/features/editor/EditorPane";
import { useNotesStore } from "@/stores/notesStore";
import { M3eButton } from "@/components/m3e";
import "@/features/editor/editor.css";

export function App() {
  const [currentNoteId, setCurrentNoteId] = useState<string | null>(null);
  const createNote = useNotesStore((s) => s.createNote);
  const load = useNotesStore((s) => s.load);
  const summaries = useNotesStore((s) => s.summaries);

  // 启动：加载已有笔记（如有），自动打开第一条；否则留空
  useEffect(() => {
    (async () => {
      await load({});
      const list = useNotesStore.getState().summaries;
      if (list.length > 0) setCurrentNoteId(list[0].id);
    })();
  }, [load]);

  const handleCreate = async () => {
    const id = await createNote();
    setCurrentNoteId(id);
  };

  const handleOpenNote = (id: string) => {
    setCurrentNoteId(id);
  };

  return (
    <ThemeProvider>
      <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
        <div
          style={{
            padding: "1rem",
            borderBottom: "1px solid var(--md-sys-color-outline-variant)",
            background: "var(--md-sys-color-surface-container)",
          }}
        >
          <h1 style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>
            S4 数据闭环验证
          </h1>
          <M3eButton variant="filled" onClick={handleCreate} data-testid="btn-new">
            新建笔记
          </M3eButton>
          {summaries.length > 0 && (
            <div style={{ marginTop: "0.5rem", fontSize: "0.85rem" }}>
              <strong>已有笔记：</strong>
              {summaries.map((s) => (
                <button
                  key={s.id}
                  onClick={() => handleOpenNote(s.id)}
                  style={{
                    marginLeft: "0.5rem",
                    padding: "0.25rem 0.5rem",
                    background: currentNoteId === s.id ? "var(--md-sys-color-primary)" : "transparent",
                    color: currentNoteId === s.id ? "var(--md-sys-color-on-primary)" : "var(--md-sys-color-on-surface)",
                    border: "1px solid var(--md-sys-color-outline)",
                    borderRadius: "4px",
                    cursor: "pointer",
                  }}
                  data-testid={`note-link-${s.id}`}
                >
                  {s.title} ({s.wordCount}字)
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ flex: 1, minHeight: 0 }}>
          {currentNoteId ? (
            <EditorPane noteId={currentNoteId} />
          ) : (
            <div
              style={{
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--md-sys-color-on-surface-variant)",
              }}
              data-testid="empty-state"
            >
              点击「新建笔记」开始
            </div>
          )}
        </div>
      </div>
    </ThemeProvider>
  );
}
