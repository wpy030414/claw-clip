/**
 * NoteListPane：侧栏 / 移动端笔记面板。
 *
 * 站点只保留「笔记」一个列表语义：内部就是文件夹 + 笔记统一树。
 * 外层 aside 继续承担侧栏/整页的布局与主题底色。
 */
import { NoteTree } from "./NoteTree";

export function NoteListPane() {
  return (
    <aside className="note-list-pane" data-testid="note-list-pane">
      <NoteTree />
    </aside>
  );
}
