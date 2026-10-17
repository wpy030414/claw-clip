/**
 * MarkdownEditor：CodeMirror 6 源码编辑器。
 *
 * 只负责「文本 + 语法高亮 + 编辑命令」，不渲染 Markdown ——
 * 预览由独立的 markdown-it 管线负责，编辑与打印彻底解耦。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { tags } from "@lezer/highlight";

export interface MarkdownEditorHandle {
  focus: () => void;
  getValue: () => string;
  insertText: (text: string) => void;
  getSelection: () => string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** 粘贴/拖入文件（图片等）时回调，由上层存 IDB 后插入引用。 */
  onFiles?: (files: File[]) => void;
  fontSize?: number;
}

/** Markdown 语法高亮：颜色全部走 M3E token，明暗自动跟随。 */
const mdHighlight = HighlightStyle.define([
  { tag: tags.heading, color: "var(--md-sys-color-primary)", fontWeight: "700" },
  { tag: tags.strong, fontWeight: "700" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.link, color: "var(--md-sys-color-primary)", textDecoration: "underline" },
  { tag: tags.url, color: "var(--md-sys-color-tertiary)" },
  { tag: tags.monospace, color: "var(--md-sys-color-secondary)" },
  { tag: tags.meta, color: "var(--md-sys-color-on-surface-variant)" },
  { tag: tags.comment, color: "var(--md-sys-color-on-surface-variant)", fontStyle: "italic" },
  { tag: tags.keyword, color: "var(--md-sys-color-tertiary)" },
  { tag: tags.string, color: "var(--md-sys-color-secondary)" },
  { tag: tags.number, color: "var(--md-sys-color-tertiary)" },
  { tag: tags.typeName, color: "var(--md-sys-color-primary)" },
]);

function themeExtension(fontSize: number) {
  return EditorView.theme({
    "&": {
      height: "100%",
      backgroundColor: "var(--md-sys-color-surface)",
      color: "var(--md-sys-color-on-surface)",
      fontSize: `${fontSize}px`,
    },
    ".cm-scroller": {
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "PingFang SC", monospace',
      lineHeight: "1.7",
      overflow: "auto",
    },
    ".cm-content": { padding: "16px 8px 40vh", caretColor: "var(--md-sys-color-primary)" },
    ".cm-gutters": {
      backgroundColor: "var(--md-sys-color-surface-container-low)",
      color: "var(--md-sys-color-on-surface-variant)",
      border: "none",
    },
    ".cm-activeLine": { backgroundColor: "var(--md-sys-color-surface-container)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "var(--md-sys-color-secondary-container)",
    },
    ".cm-cursor": { borderLeftColor: "var(--md-sys-color-primary)" },
  });
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(function MarkdownEditor(
  { value, onChange, onFiles, fontSize = 16 },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onFilesRef = useRef(onFiles);

  onChangeRef.current = onChange;
  onFilesRef.current = onFiles;

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          dropCursor(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          EditorView.lineWrapping,
          markdown(),
          syntaxHighlighting(mdHighlight),
          placeholder("开始写点什么吧……支持 Markdown 与扩展语法"),
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
          EditorView.domEventHandlers({
            paste(event) {
              const files = Array.from(event.clipboardData?.files ?? []);
              if (files.length === 0) return false;
              event.preventDefault();
              onFilesRef.current?.(files);
              return true;
            },
            drop(event) {
              const files = Array.from(event.dataTransfer?.files ?? []);
              if (files.length === 0) return false;
              event.preventDefault();
              onFilesRef.current?.(files);
              return true;
            },
          }),
          themeExtension(fontSize),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 只在挂载时创建；外部 value 变化走下一个 effect 同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 说明：本组件是「半受控」——value 只在挂载时作为初始文档。
  // 切换笔记由父级 key={noteId} 重挂载；文档内容的真相源始终在 EditorView 内，
  // 不做 value→doc 回流（回流会打断 CJK 组合输入，实测字符乱序）。

  // 字号变化：重建主题扩展成本高，直接改 DOM 变量
  useEffect(() => {
    const el = hostRef.current;
    if (el) el.style.fontSize = `${fontSize}px`;
  }, [fontSize]);

  useImperativeHandle(ref, () => ({
    focus: () => viewRef.current?.focus(),
    getValue: () => viewRef.current?.state.doc.toString() ?? "",
    insertText: (text: string) => {
      const view = viewRef.current;
      if (!view) return;
      const { from, to } = view.state.selection.main;
      view.dispatch({
        changes: { from, to, insert: text },
        selection: { anchor: from + text.length },
      });
      view.focus();
    },
    getSelection: () => {
      const view = viewRef.current;
      if (!view) return "";
      const { from, to } = view.state.selection.main;
      return view.state.sliceDoc(from, to);
    },
  }));

  return <div className="md-editor-host" data-testid="md-editor" ref={hostRef} />;
});
