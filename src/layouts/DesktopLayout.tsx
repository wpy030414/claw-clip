/** 桌面工作台：Typora 式「可收侧栏 + 单主区」。 */
import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar";

export function DesktopLayout() {
  return (
    <div className="app-shell app-shell--desktop" data-testid="app-shell">
      <Sidebar />
      <main className="desktop-main">
        <Outlet />
      </main>
    </div>
  );
}
