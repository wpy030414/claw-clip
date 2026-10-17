/**
 * EditorPane：Markdown 编辑工作区（参考 markdownassistant 的核心布局）。
 *
 * 顶栏：返回（移动端）/ 标题与状态 / 编辑·分屏·预览 / 收藏 / 更多菜单。
 * 工具栏：标题、粗斜体、删除线、行内代码、引用、列表、任务、代码块、链接、图片、表格、公式、分隔线。
 * 主区：左源码（CodeMirror）+ 右实时预览（markdown-it），编辑仍保持 Typora 式自动保存。
 *
 * 保存：纯防抖自动保存（700ms），没有手动保存入口；切笔记/卸载立即落库。
 * 导出：MD / HTML / DOCX / 打印（PDF）；打印根与预览共用同一份渲染结果。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MarkdownEditor, type MarkdownEditorHandle } from "@/components/editor/MarkdownEditor";
import { MarkdownToolbar } from "@/components/editor/MarkdownToolbar";
import type { MarkdownCommand } from "@/components/editor/markdownCommands";
import { MarkdownPreview } from "@/components/preview/MarkdownPreview";
import { toastError, toastInfo, toastSuccess } from "@/components/common/Snackbar";
import { useMarkdownSession } from "@/hooks/useMarkdownSession";
import { useRenderedMarkdown } from "@/hooks/useRenderedMarkdown";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useNotesStore } from "@/stores/notesStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore, type OutlineItem } from "@/stores/uiStore";
import { composePreviewCss } from "@/features/preview/themes";
import { hydrateMarkdown, releaseBlobUrls, saveBlob } from "@/data/blobStore";
import {
  buildHtmlDocument,
  downloadBlob,
  downloadText,
  htmlToDocx,
  safeFilename,
} from "@/data/exchange";
import { countWords } from "@/utils/markdown";
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
  const toggleStar = useNotesStore((s) => s.toggleStar);
  const remove = useNotesStore((s) => s.remove);
  const previewCss = useSettingsStore((s) => s.previewCss);
  const fontsize = useSettingsStore((s) => s.fontSize);
  const viewMode = useSettingsStore((s) => s.viewMode);
  const resolvedScheme = useSettingsStore((s) => s.resolvedScheme);
  const setSetting = useSettingsStore((s) => s.set);
  const toggleScheme = useSettingsStore((s) => s.toggleScheme);
  const setOutline = useUiStore((s) => s.setOutline);
  const isDesktop = useIsDesktop();

  const editorRef = useRef<MarkdownEditorHandle>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [themePanel, setThemePanel] = useState(false);
  const [printRequested, setPrintRequested] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  // 移动端没有横向空间：split 退化为纯编辑，仍可手动切到预览
  const effectiveView: ViewMode = !isDesktop && viewMode === "split" ? "edit" : viewMode;
  const showPreview = effectiveView !== "edit";

  const wordCount = useMemo(() => countWords(value), [value]);
  const { html, ready: htmlReady } = useRenderedMarkdown(
    value,
    showPreview || printRequested || themePanel,
  );
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

  // 切笔记：关闭浮层并回收上一篇笔记的 object URL
  useEffect(() => {
    setSaveState("idle");
    setMenuOpen(false);
    setThemePanel(false);
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

  const handleStar = () => void toggleStar(noteId);

  const handleDelete = async () => {
    setMenuOpen(false);
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

  /** 导出 HTML/DOCX 时若当前没有可见预览，按需渲染一次（不改变视图状态）。 */
  const renderForExport = async (): Promise<string> => {
    if (htmlReady) return html;
    const [{ renderMarkdown }, hydrated] = await Promise.all([
      import("@/utils/markdownRender"),
      hydrateMarkdown(value),
    ]);
    return renderMarkdown(hydrated);
  };

  const handleExport = async (kind: "md" | "html" | "docx" | "pdf" | "theme") => {
    setMenuOpen(false);
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
      if (kind === "html") {
        const doc = await buildHtmlDocument(title, await renderForExport(), css);
        downloadText(safeFilename(title, "html"), doc, "text/html");
        toastSuccess("已导出 HTML");
        return;
      }
      if (kind === "docx") {
        const blob = await htmlToDocx(await renderForExport(), title);
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

        <button
          type="button"
          className="editor-icon-btn"
          onClick={handleStar}
          aria-label={activeNote?.starred ? "取消收藏" : "收藏"}
          data-testid="btn-star"
          data-starred={activeNote?.starred ? "true" : "false"}
        >
          <span className="material-symbols-outlined">
            {activeNote?.starred ? "star" : "star_border"}
          </span>
        </button>

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
                  <span className="material-symbols-outlined">print</span> 打印 / PDF
                </button>
                <div className="editor-menu-sep" />
                <button
                  type="button"
                  role="menuitem"
                  data-testid="menu-attach"
                  onClick={() => {
                    setMenuOpen(false);
                    fileInputRef.current?.click();
                  }}
                >
                  <span className="material-symbols-outlined">image</span> 插入图片 / 附件
                </button>
                <button type="button" role="menuitem" data-testid="menu-theme" onClick={() => void handleExport("theme")}>
                  <span className="material-symbols-outlined">palette</span> 打印主题…
                </button>
                <button type="button" role="menuitem" data-testid="menu-scheme" onClick={() => { toggleScheme(); setMenuOpen(false); }}>
                  <span className="material-symbols-outlined">
                    {resolvedScheme === "dark" ? "light_mode" : "dark_mode"}
                  </span>
                  {resolvedScheme === "dark" ? "切换到浅色" : "切换到深色"}
                </button>
                <div className="editor-menu-sep" />
                <button
                  type="button"
                  role="menuitem"
                  className="editor-menu-danger"
                  data-testid="menu-delete"
                  onClick={() => void handleDelete()}
                >
                  <span className="material-symbols-outlined">delete</span> 删除笔记
                </button>
              </div>
            </>
          )}
        </div>

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
      </header>

      <MarkdownToolbar onCommand={runCommand} />

      {themePanel && (
        <div className="theme-panel" data-testid="theme-panel">
          <div className="theme-panel-header">
            <strong>打印主题 CSS</strong>
            <span className="theme-panel-actions">
              <button type="button" onClick={() => setSetting("previewCss", "")}>
                恢复内置
              </button>
              <button type="button" onClick={() => setThemePanel(false)}>
                关闭
              </button>
            </span>
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

      {/* 打印根：屏幕上移出视口，@media print 时占据整页 */}
      {(printRequested || themePanel) && (
        <div id="print-root">
          <MarkdownPreview html={html} css={css} testId="md-preview-print" />
        </div>
      )}
    </div>
  );
}
