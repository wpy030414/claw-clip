/**
 * MarkdownEditor：CodeMirror 6 源码编辑器。
 *
 * 半受控：value 只作为挂载初始文档；切换笔记由父级 key={noteId} 重挂载。
 * 不做 value→doc 回流（回流会打断 CJK 组合输入，实测字符乱序）。
 *
 * 工具栏命令通过 `applyCommand` 暴露给上层；参数与纯函数实现见 markdownCommands.ts。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { tags } from "@lezer/highlight";
import { buildCommand, type MarkdownCommand } from "./markdownCommands";

/** 在 EditorView 上执行一次 Markdown 命令；返回是否产生了改动。 */
function runInView(view: EditorView, command: MarkdownCommand): boolean {
  const { from, to } = view.state.selection.main;
  const { changes, selection } = buildCommand(view.state.doc.toString(), from, to, command);
  if (changes.length === 0) return false;
  view.dispatch({
    changes,
    selection: { anchor: selection.anchor, head: selection.head },
    scrollIntoView: true,
  });
  return true;
}

export interface MarkdownEditorHandle {
  focus: () => void;
  getValue: () => string;
  insertText: (text: string) => void;
  getSelection: () => string;
  /** 滚动到指定文档位置并把光标放过去（大纲跳转）。 */
  scrollTo: (pos: number) => void;
  /** 执行工具栏命令（加粗/标题/列表等）。 */
  applyCommand: (command: MarkdownCommand) => void;
  /** 从隐藏状态重新显示后重算布局（CodeMirror 需要）。 */
  measure: () => void;
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
      backgroundColor: "transparent",
      color: "var(--md-sys-color-on-surface)",
      fontSize: `${fontSize}px`,
    },
    ".cm-scroller": {
      fontFamily:
        'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "PingFang SC", monospace',
      lineHeight: "1.75",
      overflow: "auto",
    },
    ".cm-content": {
      padding: "28px 36px 45vh",
      caretColor: "var(--md-sys-color-primary)",
      maxWidth: "860px",
      margin: "0 auto",
    },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "var(--md-sys-color-secondary-container)",
    },
    ".cm-cursor": { borderLeftColor: "var(--md-sys-color-primary)" },
    "&.cm-focused": { outline: "none" },
    ".cm-gutters": {
      backgroundColor: "transparent",
      border: "none",
      color: "var(--md-sys-color-on-surface-variant)",
      fontSize: "0.78em",
    },
    // flex 居中：gutter 元素被 CodeMirror 固定为整行高，纯文本会贴顶显得偏上
    ".cm-lineNumbers .cm-gutterElement": {
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      minWidth: "34px",
      padding: "0 10px 0 14px",
      opacity: "0.65",
    },
    // 光标所在行：深色 + 加粗 + 完全不透明，便于定位
    ".cm-lineNumbers .cm-gutterElement.cm-activeLineGutter": {
      backgroundColor: "transparent",
      color: "var(--md-sys-color-on-surface)",
      opacity: "1",
      fontWeight: "600",
    },
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
      // ★ 必须显式指定 root：EditorView 默认用 getRoot(parent)，而 getRoot 会沿
      //   assignedSlot 走到 <m3e-theme> 的 ShadowRoot，把样式表挂进 Shadow DOM；
      //   编辑器是 light-DOM 插槽内容，Shadow DOM 里的规则匹配不到它，导致
      //   CodeMirror 基础样式（等宽字体/行高/内边距/焦点描边）全部失效。
      root: document,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          drawSelection(),
          dropCursor(),
          highlightSelectionMatches(),
          lineNumbers(),
          highlightActiveLineGutter(),
          EditorView.lineWrapping,
          markdown(),
          syntaxHighlighting(mdHighlight),
          placeholder("开始写点什么吧……支持 Markdown、公式 $E=mc^2$ 与 Mermaid 图表"),
          keymap.of([
            { key: "Mod-b", run: (view) => runInView(view, "bold") },
            { key: "Mod-i", run: (view) => runInView(view, "italic") },
            { key: "Mod-k", run: (view) => runInView(view, "link") },
            ...defaultKeymap,
            ...historyKeymap,
            ...searchKeymap,
            indentWithTab,
          ]),
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
    // 只在挂载时创建；value/fontSize 变化不重挂载（半受控）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    scrollTo: (pos: number) => {
      const view = viewRef.current;
      if (!view) return;
      const target = Math.max(0, Math.min(pos, view.state.doc.length));
      view.dispatch({
        selection: { anchor: target },
        effects: EditorView.scrollIntoView(target, { y: "start", yMargin: 24 }),
      });
      view.focus();
    },
    applyCommand: (command: MarkdownCommand) => {
      const view = viewRef.current;
      if (!view) return;
      if (runInView(view, command)) view.focus();
    },
    measure: () => viewRef.current?.requestMeasure(),
  }));

  return (
    <div className="md-editor-host" data-testid="md-editor" ref={hostRef} />
  );
});
