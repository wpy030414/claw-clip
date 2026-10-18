/**
 * 大纲跳转的目标解析。
 *
 * 侧栏里展示的大纲由「上一次解析时的正文」派生，而编辑器里可能已经又变了
 * （上传附件插入的 `clawclip://` 引用、连续输入等都会让字符偏移整体后移）。
 * 直接用旧 `pos` 跳转就会落错行——所以点击时用**编辑器实时正文**重新解析，
 * 再用「序号 + 级别 + 文本」三重校验挑出真正对应的那条标题。
 */

/** 只要能构成大纲条目的最小结构（markdown-it 与 uiStore 的两套类型都满足）。 */
export interface OutlineLike {
  level: number;
  text: string;
  pos: number;
}

export interface ResolvedOutlineTarget<T extends OutlineLike> {
  /** 实时正文里的对应标题（新 `pos`）。 */
  target: T;
  /** 它在实时大纲里的序号（预览端按序号兜底定位）。 */
  index: number;
}

/**
 * 在实时大纲 `fresh` 中找回侧栏里被点击的 `shown`。
 *
 * 优先信序号（标题顺序稳定）；序号处的级别/文本对不上时按文本找；
 * 都找不到时返回 null，调用方退回旧 `pos`（宁可近一点也不丢响应）。
 */
export function resolveOutlineTarget<T extends OutlineLike>(
  fresh: readonly T[],
  shown: OutlineLike,
  index: number,
): ResolvedOutlineTarget<T> | null {
  if (fresh.length === 0) return null;

  const atIndex = fresh[index];
  if (atIndex && atIndex.level === shown.level && atIndex.text === shown.text) {
    return { target: atIndex, index };
  }

  const byText = fresh.findIndex((h) => h.level === shown.level && h.text === shown.text);
  if (byText !== -1) return { target: fresh[byText], index: byText };

  // 序号还在范围内、级别也对：标题文字刚被改过，仍按同位置处理
  if (atIndex && atIndex.level === shown.level) return { target: atIndex, index };

  return null;
}
