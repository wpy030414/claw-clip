/** 桌面工作台：Typora 式「可收侧栏 + 单主区」；侧栏开关在主区顶栏左侧。 */
import { Outlet } from "react-router-dom";
import { useUiStore } from "@/stores/uiStore";
import { Sidebar } from "./Sidebar";

export function DesktopLayout() {
  const open = useUiStore((s) => s.sidebarOpen);
  const setOpen = useUiStore((s) => s.setSidebarOpen);

  return (
    <div className="app-shell app-shell--desktop" data-testid="app-shell">
      <Sidebar />
      <main className="desktop-main">
        <button
          type="button"
          className="main-sidebar-toggle"
          data-testid={open ? "btn-sidebar-close" : "btn-sidebar-open"}
          aria-label={open ? "收起侧栏" : "展开侧栏"}
          title={open ? "收起侧栏" : "展开侧栏"}
          onClick={() => setOpen(!open)}
        >
          <span className="material-symbols-outlined">{open ? "menu_open" : "menu"}</span>
        </button>
        <Outlet />
      </main>
    </div>
  );
}
