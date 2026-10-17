/** 桌面工作台（≥900px）：左导航栏 + 列表/编辑器分栏（M3eSplitPane，可拖拽）。 */
import { Outlet } from "react-router-dom";
import { M3eSplitPane } from "@/components/m3e";
import { NoteListPane } from "@/features/notes/NoteListPane";
import { AppNavRail } from "./Nav";

export function DesktopLayout() {
  return (
    <div className="app-shell app-shell--desktop" data-testid="app-shell">
      <AppNavRail />
      <M3eSplitPane className="desktop-split" value={28} min={18} max={45}>
        <div slot="start" className="split-pane-pane">
          <NoteListPane />
        </div>
        <div slot="end" className="split-pane-pane split-pane-pane--editor">
          <Outlet />
        </div>
      </M3eSplitPane>
    </div>
  );
}
