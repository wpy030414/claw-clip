/**
 * 当前活动编辑器句柄（模块级单例）。
 *
 * 侧栏大纲需要「点标题跳转」，但侧栏与编辑器分属两棵子树；
 * 用一个极薄的模块级注册表替代事件总线/context，避免额外状态层。
 *
 * 跳转目标由「导航器」决定：仅编辑 / 编辑+预览时落到 CodeMirror，
 * 仅预览时落到预览面板（见 EditorPane 的注册）。没有导航器时退回编辑器。
 */
import type { MarkdownEditorHandle } from "@/components/editor/MarkdownEditor";

/** 一次大纲跳转的完整意图（含在列表中的序号，预览端按序号兜底定位）。 */
export interface OutlineJumpTarget {
  level: number;
  text: string;
  /** 标题所在行的源码字符偏移。 */
  pos: number;
  /** 该标题在当前大纲列表中的序号。 */
  index: number;
}

let handle: MarkdownEditorHandle | null = null;
let navigator: ((target: OutlineJumpTarget) => void) | null = null;

export function setActiveEditor(next: MarkdownEditorHandle | null): void {
  handle = next;
}

/** 注册当前视图的跳转策略；卸载时传 null 注销。 */
export function setOutlineNavigator(next: ((target: OutlineJumpTarget) => void) | null): void {
  navigator = next;
}

/** 编辑器里的**实时**正文（不是上层 React state，可能落后一拍）。 */
export function getActiveEditorValue(): string | null {
  return handle?.getValue() ?? null;
}

export function jumpToOutline(target: OutlineJumpTarget): void {
  if (navigator) {
    navigator(target);
    return;
  }
  handle?.scrollTo(target.pos);
}
