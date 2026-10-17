/**
 * 当前活动编辑器句柄（模块级单例）。
 *
 * 侧栏大纲需要「点标题跳转」，但侧栏与编辑器分属两棵子树；
 * 用一个极薄的模块级注册表替代事件总线/context，避免额外状态层。
 */
import type { MarkdownEditorHandle } from "@/components/editor/MarkdownEditor";

let handle: MarkdownEditorHandle | null = null;

export function setActiveEditor(next: MarkdownEditorHandle | null): void {
  handle = next;
}

export function jumpToOutline(pos: number): void {
  handle?.scrollTo(pos);
}
