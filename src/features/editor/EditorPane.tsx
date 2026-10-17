/**
 * EditorPane：Markdown 编辑工作区（参考 markdownassistant 的核心布局）。
 *
 * 顶栏：返回（移动端）/ 标题与状态 / 编辑·分屏·预览 / 更多菜单。
 * 工具栏：标题、粗斜体、删除线、行内代码、引用、列表、任务、代码块、链接、图片、表格、公式、分隔线。
 * 主区：左源码（CodeMirror）+ 右实时预览（markdown-it），编辑仍保持 Typora 式自动保存。
 *
 * 保存：纯防抖自动保存（700ms），没有手动保存入口；切笔记/卸载立即落库。
 * 导出：MD / HTML / DOCX / PDF 全部直接下载文件；DOCX/PDF 排版对齐预览。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownEditor, type MarkdownEditorHandle } from "@/components/editor/MarkdownEditor";
import { MarkdownToolbar } from "@/components/editor/MarkdownToolbar";
import type { MarkdownCommand } from "@/components/editor/markdownCommands";
import { MarkdownPreview } from "@/components/preview/MarkdownPreview";
import { toastError, toastSuccess } from "@/components/common/Snackbar";
import { M3eDialog } from "@/components/m3e";
import { useMarkdownSession } from "@/hooks/useMarkdownSession";
import { useRenderedMarkdown } from "@/hooks/useRenderedMarkdown";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useNotesStore } from "@/stores/notesStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore, type OutlineItem } from "@/stores/uiStore";
import { DEFAULT_PREVIEW_CSS } from "@/features/preview/themes";
import { hydrateMarkdown, releaseBlobUrls, saveBlob } from "@/data/blobStore";
import {
  buildHtmlDocument,
  buildPrintDocument,
  downloadBlob,
  downloadText,
  htmlToDocx,
  prepareExportHtml,
  printHtmlDocument,
  safeFilename,
} from "@/data/exchange";
import { countWords } from "@/utils/markdown";
import { formatMarkdown } from "@/utils/markdownFormat";
import { setActiveEditor } from "./activeEditor";
import "@/features/editor/editor.css";

interface Props {
  noteId: string;
  /** 移动端：返回按钮回调。桌面端不传（侧栏常驻）。 */
  onBack?: () => void;
  /** 删除后回调（离开已失效的 /n/:id 路由）。 */
  onDeleted?: () => void;
}

type SaveState = "idle" | "saving" | "saved";
type ViewMode = "edit" | "split" | "preview";

export function EditorPane({ noteId, onBack, onDeleted }: Props) {
  const { value, loading, onChange } = useMarkdownSession(noteId);
  const activeNote = useNotesStore((s) => s.activeNote);
  const remove = useNotesStore((s) => s.remove);
  const fontsize = useSettingsStore((s) => s.fontSize);
  const viewMode = useSettingsStore((s) => s.viewMode);
  const setSetting = useSettingsStore((s) => s.set);
  const setOutline = useUiStore((s) => s.setOutline);
  const isDesktop = useIsDesktop();

  const editorRef = useRef<MarkdownEditorHandle>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // 移动端没有横向空间：split 退化为纯编辑，仍可手动切到预览
  const effectiveView: ViewMode = !isDesktop && viewMode === "split" ? "edit" : viewMode;
  const showPreview = effectiveView !== "edit";

  const wordCount = useMemo(() => countWords(value), [value]);
  const { html, ready: htmlReady } = useRenderedMarkdown(value, showPreview);
  const css = DEFAULT_PREVIEW_CSS;
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

  // 切笔记：关闭浮层并回收上一篇笔记的 object URL
  useEffect(() => {
    setSaveState("idle");
    setMenuOpen(false);
  }, [noteId]);

  useEffect(() => {
    return () => releaseBlobUrls();
  }, [noteId]);

  // 从隐藏/窄栏切回源码时让 CodeMirror 重算布局
  useEffect(() => {
    if (effectiveView === "edit" || effectiveView === "split") {
      const t = requestAnimationFrame(() => editorRef.current?.measure());
      return () => cancelAnimationFrame(t);
    }
    return undefined;
  }, [effectiveView]);

  /** 强制校准整篇 Markdown 格式（不依赖选区）。 */
  const handleFormat = () => {
    setMenuOpen(false);
    const editor = editorRef.current;
    if (!editor) return;
    const before = editor.getValue();
    const after = formatMarkdown(before);
    if (after === before) {
      toastSuccess("格式已符合规范");
      return;
    }
    editor.replaceAll(after);
    toastSuccess("已格式化");
  };

  /** 打开删除确认（M3E dialog，与文件夹删除一致）。 */
  const handleDelete = () => {
    setMenuOpen(false);
    setDeleteOpen(true);
  };

  const confirmDelete = async () => {
    setDeleteOpen(false);
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

  /**
   * 导出用渲染：**总是**用当前正文重新渲染。
   *
   * 预览有 120ms 防抖且防抖期间 `htmlReady` 仍为 true，直接复用缓存会让
   * 「输入后立刻导出」拿到上一版内容。导出是低频动作，宁可多渲染一次。
   */
  const renderForExport = useCallback(async (): Promise<string> => {
    const [{ renderMarkdown }, hydrated] = await Promise.all([
      import("@/utils/markdownRender"),
      hydrateMarkdown(value),
    ]);
    if (typeof document !== "undefined" && document.fonts) await document.fonts.ready;
    return renderMarkdown(hydrated);
  }, [value]);

  const handleExport = async (kind: "md" | "html" | "docx" | "pdf") => {
    setMenuOpen(false);
    try {
      if (kind === "md") {
        downloadText(safeFilename(title, "md"), value);
        toastSuccess("已导出 Markdown");
        return;
      }
      if (kind === "html") {
        // Mermaid → 内联 SVG；附件 → data URL，保证单文件离线可看
        const body = await prepareExportHtml(await renderForExport(), { mermaid: "svg" });
        const doc = await buildHtmlDocument(title, body, css);
        downloadText(safeFilename(title, "html"), doc, "text/html");
        toastSuccess("已导出 HTML");
        return;
      }
      if (kind === "docx") {
        // htmlToDocx 内部会做自包含处理（附件 data URL、Mermaid → PNG、原生公式）
        const blob = await htmlToDocx(await renderForExport(), title);
        downloadBlob(safeFilename(title, "docx"), blob);
        toastSuccess("已导出 DOCX");
        return;
      }
      if (kind === "pdf") {
        // 矢量 PDF：同源 HTML → 浏览器打印 → 用户「另存为 PDF」
        const doc = await buildPrintDocument(title, await renderForExport(), css);
        await printHtmlDocument(doc);
        toastSuccess("已打开打印对话框，请选择「另存为 PDF」");
      }
    } catch (e) {
      toastError(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const runCommand = (command: MarkdownCommand) => {
    if (isDesktop && effectiveView === "preview") setSetting("viewMode", "split");
    if (!isDesktop && effectiveView === "preview") setSetting("viewMode", "edit");
    editorRef.current?.applyCommand(command);
    requestAnimationFrame(() => editorRef.current?.focus());
  };

  const changeView = (next: ViewMode) => {
    setSetting("viewMode", next);
    requestAnimationFrame(() => {
      if (next !== "preview") editorRef.current?.focus();
      else editorRef.current?.measure();
    });
  };

  const saveLabel =
    saveState === "saving" ? "自动保存中…" : saveState === "saved" ? "已保存" : "已就绪";

  return (
    <div className="editor-pane" data-testid="editor-pane" data-view={effectiveView}>
      <header className="editor-topbar" data-testid="editor-topbar">
        {onBack && (
          <button
            type="button"
            className="editor-icon-btn"
            onClick={onBack}
            aria-label="返回"
            data-testid="btn-back"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
        )}

        <div className="editor-title-block">
          <span className="editor-title" data-testid="editor-title">
            {title}
          </span>
          <span className="editor-meta">
            <span className="editor-save-state" data-testid="save-state">
              {saveLabel}
            </span>
            <span aria-hidden="true">·</span>
            <span className="editor-word-count" data-testid="word-count">
              {wordCount} 字
            </span>
          </span>
        </div>

        <div className="view-switch" role="group" aria-label="视图模式">
          <button
            type="button"
            data-testid="btn-view-edit"
            data-active={effectiveView === "edit" ? "true" : "false"}
            title="仅编辑"
            aria-label="仅编辑"
            onClick={() => changeView("edit")}
          >
            <span className="material-symbols-outlined">edit_note</span>
          </button>
          {isDesktop && (
            <button
              type="button"
              data-testid="btn-view-split"
              data-active={effectiveView === "split" ? "true" : "false"}
              title="编辑 + 实时预览"
              aria-label="编辑 + 实时预览"
              onClick={() => changeView("split")}
            >
              <span className="material-symbols-outlined">vertical_split</span>
            </button>
          )}
          <button
            type="button"
            data-testid="btn-view-preview"
            data-active={effectiveView === "preview" ? "true" : "false"}
            title="仅预览"
            aria-label="仅预览"
            onClick={() => changeView("preview")}
          >
            <span className="material-symbols-outlined">visibility</span>
          </button>
        </div>

        <div className="editor-menu-wrap">
          <button
            type="button"
            className="editor-icon-btn"
            aria-label="更多操作"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            data-testid="btn-menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span className="material-symbols-outlined">more_horiz</span>
          </button>
          {menuOpen && (
            <>
              <div
                className="editor-menu-backdrop"
                aria-hidden="true"
                onClick={() => setMenuOpen(false)}
              />
              <div className="editor-menu" role="menu" data-testid="editor-menu">
                <button
                  type="button"
                  role="menuitem"
                  data-testid="menu-format"
                  onClick={handleFormat}
                >
                  <span className="material-symbols-outlined">auto_fix_high</span> 格式化
                </button>
                <div className="editor-menu-sep" />
                <div className="editor-menu-label">导出</div>
                <button type="button" role="menuitem" data-testid="menu-export-md" onClick={() => void handleExport("md")}>
                  <span className="material-symbols-outlined">description</span> Markdown (.md)
                </button>
                <button type="button" role="menuitem" data-testid="menu-export-html" onClick={() => void handleExport("html")}>
                  <span className="material-symbols-outlined">web</span> HTML (.html)
                </button>
                <button type="button" role="menuitem" data-testid="menu-export-docx" onClick={() => void handleExport("docx")}>
                  <span className="material-symbols-outlined">article</span> Word (.docx)
                </button>
                <button type="button" role="menuitem" data-testid="menu-export-pdf" onClick={() => void handleExport("pdf")}>
                  <span className="material-symbols-outlined">picture_as_pdf</span> PDF (.pdf)
                </button>
                <div className="editor-menu-sep" />
                <button
                  type="button"
                  role="menuitem"
                  className="editor-menu-danger"
                  data-testid="menu-delete"
                  onClick={handleDelete}
                >
                  <span className="material-symbols-outlined">delete</span> 删除笔记
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      <MarkdownToolbar onCommand={runCommand} />

      <div className="editor-workspace" data-view={effectiveView}>
        <section className="editor-source-pane" data-testid="source-pane">
          {!loading && (
            <MarkdownEditor
              key={noteId}
              ref={(handle) => {
                editorRef.current = handle;
                setActiveEditor(handle);
              }}
              value={value}
              onChange={handleChange}
              onFiles={(files) => void insertFiles(files)}
              fontSize={fontsize}
            />
          )}
          {loading && (
            <div className="editor-loading-overlay" data-testid="editor-loading">
              载入中…
            </div>
          )}
        </section>

        {showPreview && (
          <section className="editor-preview-pane" data-testid="preview-pane">
            {htmlReady ? (
              <MarkdownPreview html={html} css={css} testId="md-preview" />
            ) : (
              <div className="editor-preview-loading">渲染中…</div>
            )}
          </section>
        )}
      </div>

      <M3eDialog
        open={deleteOpen}
        data-testid="delete-note-dialog"
        onClosed={() => setDeleteOpen(false)}
      >
        <span slot="header">删除笔记</span>
        <div className="confirm-dialog" data-testid="delete-note-content">
          <p className="confirm-dialog-text">
            删除「{title}」？笔记将被移除，仅被它引用的附件会一并回收，且无法恢复。
          </p>
          <div className="confirm-dialog-actions">
            <button
              type="button"
              className="confirm-dialog-btn"
              data-testid="delete-note-cancel"
              onClick={() => setDeleteOpen(false)}
            >
              取消
            </button>
            <button
              type="button"
              className="confirm-dialog-btn confirm-dialog-btn--danger"
              data-testid="delete-note-confirm"
              onClick={() => void confirmDelete()}
            >
              删除
            </button>
          </div>
        </div>
      </M3eDialog>

    </div>
  );
}
