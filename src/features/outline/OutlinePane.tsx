/** 侧栏「大纲」页签：当前文件标题树，点击跳转（编辑视图落编辑器，仅预览落预览）。 */
import { useState } from "react";
import { useUiStore, type OutlineItem } from "@/stores/uiStore";
import { useOverlayScrollbar } from "@/hooks/useOverlayScrollbar";
import {
  getActiveEditorValue,
  jumpToOutline,
  type OutlineJumpTarget,
} from "@/features/editor/activeEditor";
import { resolveOutlineTarget } from "@/utils/outline";

/**
 * 点击大纲：用编辑器实时正文重新解析一次标题位置再跳。
 *
 * 侧栏大纲是防抖派生的，上传附件/连续输入后 `pos` 可能落后（整段字符后移），
 * 直接按旧偏移跳会「差几行」。重解析只在大纲页签可见、点击这种低频时机发生，
 * markdownRender 此时早已加载，没有额外开销。
 */
async function jumpTo(item: OutlineItem, index: number): Promise<void> {
  const fallback: OutlineJumpTarget = { ...item, index };
  const live = getActiveEditorValue();
  if (live === null) {
    jumpToOutline(fallback);
    return;
  }
  const { extractOutline } = await import("@/utils/markdownRender");
  // 二次确认：解析期间正文又变了（极端情况），本轮仍按当次快照跳
  const resolved = resolveOutlineTarget(extractOutline(live), item, index);
  jumpToOutline(resolved ? { ...resolved.target, index: resolved.index } : fallback);
}

export function OutlinePane() {
  const outline = useUiStore((s) => s.outline);
  const [pane, setPane] = useState<HTMLElement | null>(null);
  useOverlayScrollbar(pane);

  if (outline.length === 0) {
    return (
      <div className="outline-empty" data-testid="outline-empty">
        当前文件还没有标题
      </div>
    );
  }

  return (
    <nav ref={setPane} className="outline-pane" data-testid="outline-pane" aria-label="大纲">
      {outline.map((item, i) => (
        <button
          key={`${item.pos}-${i}`}
          type="button"
          className="outline-item"
          data-level={item.level}
          title={item.text}
          data-testid={`outline-item-${i}`}
          onClick={() => void jumpTo(item, i)}
        >
          {item.text}
        </button>
      ))}
    </nav>
  );
}
