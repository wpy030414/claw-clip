/** 未选中笔记时编辑器区域的空态（桌面分栏右侧 / 移动端无路由时）。 */
export function EditorPlaceholder() {
  return (
    <div className="editor-placeholder" data-testid="empty-state">
      <span className="material-symbols-outlined" aria-hidden="true">
        edit_note
      </span>
      <p>选择一条笔记，或点击「+」新建一条</p>
    </div>
  );
}
