/**
 * MarkdownEditor：CodeMirror 6 编辑器。
 *
 * 两种显示语义共用同一份源码：
 * - 编辑模式：显示完整 Markdown 源码（等宽字体）
 * - 浏览模式：轻量 IR（`markdownIR.ts`）——光标不在的行隐藏标记并渲染样式，仍可直接写
 *
 * 半受控：value 只作为挂载初始文档；切换笔记由父级 key={noteId} 重挂载。
 * 不做 value→doc 回流（回流会打断 CJK 组合输入，实测字符乱序）。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  keymap,
  placeholder,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from "@codemirror/search";
import { tags } from "@lezer/highlight";
import { markdownIRExtension } from "./markdownIR";

export interface MarkdownEditorHandle {
  focus: () => void;
  getValue: () => string;
  insertText: (text: string) => void;
  getSelection: () => string;
  /** 滚动到指定文档位置并把光标放过去（大纲跳转）。 */
  scrollTo: (pos: number) => void;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  /** 粘贴/拖入文件（图片等）时回调，由上层存 IDB 后插入引用。 */
  onFiles?: (files: File[]) => void;
  fontSize?: number;
  /** true = 浏览模式（轻量 IR），false = 源码模式。 */
  ir?: boolean;
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
      lineHeight: "1.85",
      overflow: "auto",
    },
    ".cm-content": { padding: "24px 8px 50vh", caretColor: "var(--md-sys-color-primary)" },
    ".cm-activeLine": { backgroundColor: "transparent" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "var(--md-sys-color-secondary-container)",
    },
    ".cm-cursor": { borderLeftColor: "var(--md-sys-color-primary)" },
  });
}

export const MarkdownEditor = forwardRef<MarkdownEditorHandle, Props>(function MarkdownEditor(
  { value, onChange, onFiles, fontSize = 16, ir = false },
  ref,
) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onFilesRef = useRef(onFiles);
  const irCompartment = useRef(new Compartment()).current;
  onChangeRef.current = onChange;
  onFilesRef.current = onFiles;

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          drawSelection(),
          dropCursor(),
          highlightSelectionMatches(),
          EditorView.lineWrapping,
          markdown(),
          syntaxHighlighting(mdHighlight),
          placeholder("开始写点什么吧……"),
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
          irCompartment.of(ir ? markdownIRExtension : []),
          themeExtension(fontSize),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // 只在挂载时创建；IR/字号变化走 reconfigure
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 浏览/源码模式切换：热重配置，不重建文档、不丢撤销历史
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: irCompartment.reconfigure(ir ? markdownIRExtension : []),
    });
  }, [ir, irCompartment]);

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
  }));

  return (
    <div
      className={`md-editor-host ${ir ? "md-editor-host--browse" : "md-editor-host--source"}`}
      data-testid="md-editor"
      data-mode={ir ? "browse" : "edit"}
      ref={hostRef}
    />
  );
});
