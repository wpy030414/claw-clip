/**
 * NoteListPane：移动端首页。
 *
 * 尽可能还原桌面侧栏功能：品牌行（标题/commit + GitHub）、笔记树、
 * 底部 IDB 统计与明暗切换。移动端没有常驻编辑器，因此不展示大纲页签。
 */
import { SidebarBody } from "@/layouts/Sidebar";

export function NoteListPane() {
  return (
    <aside className="note-list-pane" data-testid="note-list-pane">
      <SidebarBody showOutline={false} />
    </aside>
  );
}
