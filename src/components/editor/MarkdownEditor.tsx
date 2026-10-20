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
  highlightActiveLine,
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
import {
  buildCommand,
  markerFromInput,
  wrapSelection,
  type MarkdownCommand,
} from "./markdownCommands";
import { animateScrollTo, scrollTopFor } from "@/utils/scroll";

/** 大纲跳转贴顶时保留的留白（与旧 scrollIntoView 的 yMargin 一致）。 */
const SCROLL_MARGIN = 24;

/**
 * 选中文档中的一段并滚动到它的起点。
 *
 * 落点每帧重算（见 utils/scroll）：刚切回编辑/分屏时列宽还在过渡，
 * 一次性算好的位置会偏。`to === from` 时退化为「把光标放到该位置」。
 */
function revealRange(view: EditorView, from: number, to: number): void {
  const docLength = view.state.doc.length;
  const start = Math.max(0, Math.min(from, docLength));
  const end = Math.max(start, Math.min(to, docLength));

  // 选中命中文本，视觉上能立刻确认跳到了哪一处；滚动交给平滑动画。
  view.dispatch({ selection: { anchor: start, head: end } });
  view.focus();
  animateScrollTo(view.scrollDOM, () => {
    const scroller = view.scrollDOM;
    const block = view.lineBlockAt(start);
    return scrollTopFor({
      scrollTop: scroller.scrollTop,
      currentTop: view.documentTop + block.top,
      containerTop: scroller.getBoundingClientRect().top,
      margin: SCROLL_MARGIN,
      maxScrollTop: scroller.scrollHeight - scroller.clientHeight,
    });
  });
}

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

/**
 * 选中文本后直接敲 Markdown 标记 → 包裹选区（而不是把选中内容替换掉）。
 *
 * 支持的标记：`*`（斜体）、`_`（斜体）、`~`（删除线/下标）、`` ` ``（行内代码）、
 * `$`（行内公式）、`^`（上标）、`=`（连敲两次为 `==高亮==`）。
 * 包裹后内文仍保持选中，所以连敲两次 `*` 会得到 `**…**`（加粗），连敲两次 `$` 得到 `$$…$$`。
 */
function wrapAt(view: EditorView, from: number, to: number, marker: string): boolean {
  const { changes, selection } = wrapSelection(view.state.doc.toString(), from, to, marker);
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
  /** 整篇替换（格式化用）：保留撤销历史，光标尽量停在原偏移处。 */
  replaceAll: (text: string) => void;
  getSelection: () => string;
  /** 滚动到指定文档位置并把光标放过去（大纲跳转）。 */
  scrollTo: (pos: number) => void;
  /** 选中指定区间并滚动到起点（搜索结果跳转；from=to 时只放光标）。 */
  selectRange: (from: number, to: number) => void;
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
      // 行内折行已开启；水平裁剪用于让活动行的全宽底色不产生横向滚动条
      overflowX: "clip",
      overflowY: "auto",
    },
    ".cm-content": {
      padding: "28px 36px 45vh",
      caretColor: "var(--md-sys-color-primary)",
      maxWidth: "860px",
      margin: "0 auto",
      // CJK 字体没有 italic 面，Chrome 默认不给回退字体合成倾斜；
      // 显式开启后 `*斜体*` 的中文才真正「斜」起来（属性可继承）。
      fontSynthesis: "style",
    },
    // 光标所在行：用 M3 surface 层色贯穿整行（含行号列与两侧留白）。
    // 正文内容有 860px 的阅读宽度上限、两侧可能是 auto margin，
    // 直接给 .cm-line 铺底只会覆盖文本列；改用绝对定位伪元素向左右各
    // 延伸 100vw，再由 .cm-scroller 的 overflow-x: clip 裁到可视区域。
    // 不设 z-index：一旦创建层叠上下文，行内 ::before 背景会盖到选择层
    // （选中态背景被活动行底色吃掉），只保留定位所需的 position。
    ".cm-activeLine": {
      position: "relative",
      backgroundColor: "transparent",
    },
    // z-index 必须低于选择层：CodeMirror 给 `.cm-selectionLayer` 动态写的是
    // 内联 `-1 - 层序`（实测 -2），行底色若停在 -1 就会盖住选中态。
    // 行内 pseudo 没有自己的层叠上下文，负值让它退到选择层之下、
    // 但仍高于滚动容器的背景，文字照常绘制在最上层。
    ".cm-activeLine::before": {
      content: '""',
      position: "absolute",
      top: "0",
      bottom: "0",
      left: "-100vw",
      right: "-100vw",
      backgroundColor: "var(--md-sys-color-surface-container-high)",
      zIndex: "-100",
      pointerEvents: "none",
    },
    // 选中态：固定青色，与活动行/表面的中性底色形成色相区分。
    // 不用 `--md-sys-color-primary`：主色是可被用户改成的 seed（默认桃粉），
    // 与同样带主色倾向的行底色挤在一起就分不出来了。变量定义见 editor.css。
    // 选择器要压过 CodeMirror 自带主题（后者用 `.cm-scroller > .cm-selectionLayer`），
    // 所以重复一层 `.cm-selectionBackground` 提权，而不是靠样式注入顺序。
    ".cm-selectionLayer .cm-selectionBackground": {
      backgroundColor: "var(--editor-selection-bg-idle, rgba(0, 172, 193, 0.22))",
      borderRadius: "2px",
    },
    "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground.cm-selectionBackground":
      {
        backgroundColor: "var(--editor-selection-bg, rgba(0, 188, 212, 0.34))",
        boxShadow: "inset 0 0 0 1px var(--editor-selection-ring, rgba(0, 172, 193, 0.7))",
        borderRadius: "2px",
      },
    // 同词高亮（highlightSelectionMatches）跟随同一色系，不抢选中态
    ".cm-selectionMatch.cm-selectionMatch": {
      backgroundColor: "var(--editor-selection-match, rgba(0, 188, 212, 0.14))",
      borderRadius: "2px",
    },
    ".cm-cursor": { borderLeftColor: "var(--md-sys-color-primary)" },
    "&.cm-focused": { outline: "none" },
    ".cm-gutters": {
      backgroundColor: "transparent",
      border: "none",
      color: "var(--md-sys-color-on-surface-variant)",
      fontSize: "0.78em",
      // 活动行的全宽底色来自正文的伪元素；行号列必须盖在它上面
      zIndex: "1",
    },
    // 行号与「首行」对齐：gutter 元素高度 = 整块（含折行）高度，
    // 不能用 center，否则折行时行号会飘到整块中间。
    // 数字字号是 0.78em，把行高折算成正文行高（1.75 / 0.78），
    // 让数字的行盒与正文首行等高，再靠 flex-start 贴顶。
    ".cm-lineNumbers .cm-gutterElement": {
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "flex-end",
      lineHeight: "2.244",
      minWidth: "34px",
      padding: "0 10px 0 14px",
      opacity: "0.65",
    },
    // 光标所在行：深色 + 加粗 + 完全不透明，便于定位；行号列与正文同一底色
    ".cm-lineNumbers .cm-gutterElement.cm-activeLineGutter": {
      backgroundColor: "var(--md-sys-color-surface-container-high)",
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
          highlightActiveLine(),
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
          // 唯一的拦截点：按「实际落进文档的字符」判断。
          // 不额外挂 keydown —— 有些环境（输入法/英文键盘）preventDefault 之后
          // 仍会再派发一次 input，两条路径同时生效就会一次敲出两个标记
          // （* → **，直接变粗体）。只走输入层，一次按键只加一层。
          EditorView.inputHandler.of((view, from, to, text) => {
            if (view.composing) return false;
            const marker = markerFromInput(text);
            if (!marker) return false;
            const { state } = view;
            if (state.selection.ranges.length !== 1) return false;
            const sel = state.selection.main;
            if (from !== sel.from || to !== sel.to || from === to) return false;
            return wrapAt(view, from, to, marker);
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
    replaceAll: (text: string) => {
      const view = viewRef.current;
      if (!view) return;
      const head = Math.min(view.state.selection.main.head, text.length);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: head },
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
      revealRange(view, pos, pos);
    },
    selectRange: (from: number, to: number) => {
      const view = viewRef.current;
      if (!view) return;
      revealRange(view, from, to);
    },
    applyCommand: (command: MarkdownCommand) => {
      const view = viewRef.current;
      if (!view) return;
      if (runInView(view, command)) view.focus();
    },
    measure: () => viewRef.current?.requestMeasure(),
  }));

  return <div className="md-editor-host" data-testid="md-editor" ref={hostRef} />;
});
