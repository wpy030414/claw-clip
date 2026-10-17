/** 侧栏「大纲」页签：当前文件标题树，点击跳转并聚焦编辑器。 */
import { useUiStore } from "@/stores/uiStore";
import { jumpToOutline } from "@/features/editor/activeEditor";

export function OutlinePane() {
  const outline = useUiStore((s) => s.outline);

  if (outline.length === 0) {
    return (
      <div className="outline-empty" data-testid="outline-empty">
        当前文件还没有标题
      </div>
    );
  }

  return (
    <nav className="outline-pane" data-testid="outline-pane" aria-label="大纲">
      {outline.map((item, i) => (
        <button
          key={`${item.pos}-${i}`}
          type="button"
          className="outline-item"
          data-level={item.level}
          title={item.text}
          onClick={() => jumpToOutline(item.pos)}
        >
          {item.text}
        </button>
      ))}
    </nav>
  );
}
