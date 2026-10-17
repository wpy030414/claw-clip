/**
 * 移动端（<900px）：内容整页。
 * 站点只有「笔记」一个目的地，因此不再渲染底部导航；进编辑器时同样全屏。
 */
import { Outlet } from "react-router-dom";

export function MobileLayout() {
  return (
    <div className="app-shell app-shell--mobile" data-testid="app-shell">
      <main className="mobile-content">
        <Outlet />
      </main>
    </div>
  );
}
