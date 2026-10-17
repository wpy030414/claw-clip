/**
 * EditorPane：编辑器面板（桌面右栏 / 移动全屏共用）。
 *
 * 两种视图：
 * - 编辑：CodeMirror 6 源码编辑器（Markdown 语法高亮）
 * - 预览：markdown-it 渲染结果 + 可配置打印主题 CSS
 *
 * 预览与打印共用同一份 HTML（useRenderedMarkdown），因此「预览所见 = 打印所得」。
 * 导出：MD（原文）、DOCX（HTML→docx）、PDF（浏览器打印 → 另存为 PDF）。
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
import { composePreviewCss } from "@/features/preview/themes";
import { saveBlob } from "@/data/blobStore";
import {
  downloadBlob,
  downloadText,
  htmlToDocx,
  safeFilename,
} from "@/data/exchange";
import { countWords } from "@/utils/markdown";

interface Props {
  noteId: string;
  /** 移动端：返回按钮回调。桌面端不传（列表常驻）。 */
  onBack?: () => void;
  /** 删除后回调（离开已失效的 /n/:id 路由）。 */
  onDeleted?: () => void;
}

type SaveState = "idle" | "saving" | "saved";

export function EditorPane({ noteId, onBack, onDeleted }: Props) {
  const { value, loading, onChange, saveNow } = useMarkdownSession(noteId);
  const activeNote = useNotesStore((s) => s.activeNote);
  const toggleStar = useNotesStore((s) => s.toggleStar);
  const remove = useNotesStore((s) => s.remove);
  const previewCss = useSettingsStore((s) => s.previewCss);
  const setSetting = useSettingsStore((s) => s.set);

  const editorRef = useRef<MarkdownEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState(false);
  const [themePanel, setThemePanel] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [printRequested, setPrintRequested] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  const wordCount = useMemo(() => countWords(value), [value]);
  // 预览/打印才渲染 HTML（编辑器本身不需要 markdown-it，首屏更轻）
  const { html, ready: htmlReady } = useRenderedMarkdown(value, preview || printRequested);
  const css = useMemo(() => composePreviewCss(previewCss), [previewCss]);
  const title = activeNote?.title ?? "无标题";

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const markDirty = useCallback(() => {
    setSaveState("saving");
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSaveState("saved"), 900);
  }, []);

  const handleChange = useCallback(
    (next: string) => {
      onChange(next);
      markDirty();
    },
    [onChange, markDirty],
  );

  // Cmd/Ctrl+S：立即保存
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveNow().then(() => {
          setSaveState("saved");
          toastSuccess("已保存");
        });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveNow]);

  // 切笔记时重置状态
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
      markDirty();
    },
    [noteId, markDirty],
  );

  const handleExport = async (kind: "md" | "docx" | "pdf") => {
    setExportOpen(false);
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
      // PDF：切到预览渲染 → 调起系统打印 → 用户选择「另存为 PDF」
      toastInfo("在打印对话框中选择「另存为 PDF」");
      setPrintRequested(true);
    } catch (e) {
      toastError(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  // 打印：等 HTML 渲染完成后再调起系统打印对话框
  useEffect(() => {
    if (!printRequested || !htmlReady) return; // 等 HTML 渲染完成（空文档也算完成）
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
    saveState === "saving" ? "保存中…" : saveState === "saved" ? "已保存" : "已就绪";

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
          data-testid="btn-save"
          aria-label="立即保存"
          onClick={() =>
            void saveNow().then(() => {
              setSaveState("saved");
              toastSuccess("已保存");
            })
          }
        >
          <span className="material-symbols-outlined">save</span>
        </M3eIconButton>

        <M3eIconButton
          data-testid="btn-mode"
          aria-label={preview ? "切换到编辑" : "切换到预览"}
          data-mode={preview ? "preview" : "edit"}
          onClick={() => setPreview((v) => !v)}
        >
          <span className="material-symbols-outlined">{preview ? "edit" : "visibility"}</span>
        </M3eIconButton>

        {preview && (
          <M3eIconButton
            data-testid="btn-theme"
            aria-label="打印主题"
            onClick={() => setThemePanel((v) => !v)}
          >
            <span className="material-symbols-outlined">palette</span>
          </M3eIconButton>
        )}

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

      {preview && themePanel && (
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

      <div className={`editor-canvas ${preview ? "editor-canvas--preview" : ""}`}>
        {preview ? (
          <MarkdownPreview html={html} css={css} />
        ) : (
          !loading && (
            <MarkdownEditor
              key={noteId}
              ref={editorRef}
              value={value}
              onChange={handleChange}
              onFiles={(files) => void insertFiles(files)}
            />
          )
        )}
        {loading && (
          <div className="editor-loading-overlay" data-testid="editor-loading">
            载入中…
          </div>
        )}
      </div>

      {/* 打印根：屏幕上移出视口，@media print 时占据整页 */}
      {(preview || printRequested) && (
        <div id="print-root">
          <MarkdownPreview html={html} css={css} testId="md-preview-print" />
        </div>
      )}
    </div>
  );
}
