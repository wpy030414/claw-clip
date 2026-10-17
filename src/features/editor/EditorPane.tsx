/**
 * EditorPane：Typora 式单主区编辑器。
 *
 * 顶栏：返回（移动端）/ 标题 / 自动保存态 / 字数 / 编辑⇄浏览 / 导出 / 附件 / 收藏 / 删除。
 * - 编辑：完整 Markdown 源码（等宽）
 * - 浏览：轻量 IR（隐藏非当前行的标记与语法，仍可直接写）
 *
 * 保存：纯防抖自动保存（700ms），**没有手动保存入口**；切笔记/卸载立即落库。
 * 导出：MD、DOCX、打印（PDF）；打印根与导出共用 markdown-it 渲染结果。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { M3eIconButton } from "@/components/m3e";
import { MarkdownEditor, type MarkdownEditorHandle } from "@/components/editor/MarkdownEditor";
import { MarkdownPreview } from "@/components/preview/MarkdownPreview";
import { toastError, toastInfo, toastSuccess } from "@/components/common/Snackbar";
import { useMarkdownSession } from "@/hooks/useMarkdownSession";
import { useRenderedMarkdown } from "@/hooks/useRenderedMarkdown";
import { useNotesStore } from "@/stores/notesStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore, type OutlineItem } from "@/stores/uiStore";
import { composePreviewCss } from "@/features/preview/themes";
import { saveBlob } from "@/data/blobStore";
import { downloadBlob, downloadText, htmlToDocx, safeFilename } from "@/data/exchange";
import { countWords } from "@/utils/markdown";
import { setActiveEditor } from "./activeEditor";

interface Props {
  noteId: string;
  /** 移动端：返回按钮回调。桌面端不传（侧栏常驻）。 */
  onBack?: () => void;
  /** 删除后回调（离开已失效的 /n/:id 路由）。 */
  onDeleted?: () => void;
}

type SaveState = "idle" | "saving" | "saved";
type ViewMode = "edit" | "browse";

export function EditorPane({ noteId, onBack, onDeleted }: Props) {
  const { value, loading, onChange } = useMarkdownSession(noteId);
  const activeNote = useNotesStore((s) => s.activeNote);
  const toggleStar = useNotesStore((s) => s.toggleStar);
  const remove = useNotesStore((s) => s.remove);
  const previewCss = useSettingsStore((s) => s.previewCss);
  const setSetting = useSettingsStore((s) => s.set);
  const setOutline = useUiStore((s) => s.setOutline);

  const editorRef = useRef<MarkdownEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<ViewMode>("browse");
  const [themePanel, setThemePanel] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [printRequested, setPrintRequested] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const wordCount = useMemo(() => countWords(value), [value]);
  const { html, ready: htmlReady } = useRenderedMarkdown(value);
  const css = useMemo(() => composePreviewCss(previewCss), [previewCss]);
  const title = activeNote?.title ?? "无标题";

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleChange = useCallback(
    (next: string) => {
      onChange(next);
      setSaveState("saving");
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => setSaveState("saved"), 800);
    },
    [onChange],
  );

  // 大纲：从正文实时派生（文档树之外的第二页签）
  useEffect(() => {
    const items: OutlineItem[] = [];
    const re = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm;
    let m: RegExpExecArray | null;
    while ((m = re.exec(value))) {
      items.push({ level: m[1].length, text: m[2].trim(), pos: m.index });
    }
    setOutline(items);
    return () => setOutline([]);
  }, [value, setOutline]);

  // 切笔记重置局部状态
  useEffect(() => {
    setSaveState("idle");
    setExportOpen(false);
    setThemePanel(false);
  }, [noteId]);

  const handleStar = () => void toggleStar(noteId);

  const handleDelete = async () => {
    if (!window.confirm("删除这条笔记？附件也会一并删除。")) return;
    await remove(noteId);
    onBack?.();
    onDeleted?.();
  };

  const insertFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        const blobId = await saveBlob(noteId, file);
        const ref = `clawclip://blob/${blobId}`;
        const md = file.type.startsWith("image/")
          ? `![${file.name || "图片"}](${ref})`
          : `[${file.name || "附件"}](${ref})`;
        editorRef.current?.insertText(`\n${md}\n`);
      }
    },
    [noteId],
  );

  const handleExport = async (kind: "md" | "docx" | "pdf" | "theme") => {
    setExportOpen(false);
    if (kind === "theme") {
      setThemePanel((v) => !v);
      return;
    }
    try {
      if (kind === "md") {
        downloadText(safeFilename(title, "md"), value);
        toastSuccess("已导出 Markdown");
        return;
      }
      if (kind === "docx") {
        const blob = await htmlToDocx(html, title);
        downloadBlob(safeFilename(title, "docx"), blob);
        toastSuccess("已导出 DOCX");
        return;
      }
      toastInfo("在打印对话框中选择「另存为 PDF」");
      setPrintRequested(true);
    } catch (e) {
      toastError(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // 打印：等 HTML 渲染就绪后再调系统打印
  useEffect(() => {
    if (!printRequested || !htmlReady) return;
    const timer = setTimeout(() => {
      const prevTitle = document.title;
      document.title = title;
      window.print();
      setTimeout(() => {
        document.title = prevTitle;
      }, 1000);
      setPrintRequested(false);
    }, 250);
    return () => clearTimeout(timer);
  }, [printRequested, htmlReady, title]);

  const saveLabel =
    saveState === "saving" ? "自动保存中…" : saveState === "saved" ? "已保存" : "已就绪";

  return (
    <div className="editor-pane" data-testid="editor-pane">
      <div className="editor-topbar" data-testid="editor-topbar">
        {onBack && (
          <M3eIconButton onClick={onBack} aria-label="返回" data-testid="btn-back">
            <span className="material-symbols-outlined">arrow_back</span>
          </M3eIconButton>
        )}
        <span className="editor-title" data-testid="editor-title">
          {title}
        </span>
        <span className="editor-meta">
          <span className="editor-save-state" data-testid="save-state">
            {saveLabel}
          </span>
          <span className="editor-word-count" data-testid="word-count">
            {wordCount} 字
          </span>
        </span>

        <M3eIconButton
          data-testid="btn-mode"
          aria-label={mode === "browse" ? "切换到源码编辑" : "切换到浏览模式"}
          data-mode={mode}
          onClick={() => setMode((m) => (m === "browse" ? "edit" : "browse"))}
        >
          <span className="material-symbols-outlined">
            {mode === "browse" ? "code" : "visibility"}
          </span>
        </M3eIconButton>

        <div className="editor-export">
          <M3eIconButton
            data-testid="btn-export"
            aria-label="导出"
            onClick={() => setExportOpen((v) => !v)}
          >
            <span className="material-symbols-outlined">download</span>
          </M3eIconButton>
          {exportOpen && (
            <div className="export-menu" role="menu" data-testid="export-menu">
              <button type="button" role="menuitem" data-testid="export-md" onClick={() => void handleExport("md")}>
                Markdown (.md)
              </button>
              <button type="button" role="menuitem" data-testid="export-docx" onClick={() => void handleExport("docx")}>
                Word (.docx)
              </button>
              <button type="button" role="menuitem" data-testid="export-pdf" onClick={() => void handleExport("pdf")}>
                打印 / PDF
              </button>
              <button type="button" role="menuitem" data-testid="export-theme" onClick={() => void handleExport("theme")}>
                打印主题…
              </button>
            </div>
          )}
        </div>

        <M3eIconButton
          onClick={() => fileInputRef.current?.click()}
          aria-label="插入图片或附件"
          data-testid="btn-attach"
        >
          <span className="material-symbols-outlined">image</span>
        </M3eIconButton>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          data-testid="file-input"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            e.target.value = "";
            void insertFiles(files);
          }}
        />

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
        <M3eIconButton onClick={() => void handleDelete()} aria-label="删除" data-testid="btn-delete">
          <span className="material-symbols-outlined">delete</span>
        </M3eIconButton>
      </div>

      {themePanel && (
        <div className="theme-panel" data-testid="theme-panel">
          <div className="theme-panel-header">
            <strong>打印主题 CSS</strong>
            <button type="button" onClick={() => setSetting("previewCss", "")}>
              恢复内置
            </button>
          </div>
          <textarea
            data-testid="preview-css-input"
            spellCheck={false}
            value={previewCss}
            placeholder={".md-preview-content { font-family: ...; font-size: 12pt; }\n@page { margin: 20mm; }"}
            onChange={(e) => setSetting("previewCss", e.target.value)}
          />
        </div>
      )}

      <div className="editor-canvas">
        {!loading && (
          <MarkdownEditor
            key={noteId}
            ref={(handle) => {
              // 载入完成前编辑器不挂载，用回调 ref 保证句柄在真正挂载时注册（供大纲跳转）
              editorRef.current = handle;
              setActiveEditor(handle);
            }}
            value={value}
            onChange={handleChange}
            onFiles={(files) => void insertFiles(files)}
            ir={mode === "browse"}
          />
        )}
        {loading && (
          <div className="editor-loading-overlay" data-testid="editor-loading">
            载入中…
          </div>
        )}
      </div>

      {/* 打印根：屏幕上移出视口，@media print 时占据整页 */}
      {(printRequested || themePanel) && (
        <div id="print-root">
          <MarkdownPreview html={html} css={css} testId="md-preview-print" />
        </div>
      )}
    </div>
  );
}
