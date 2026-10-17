/** 移动卡片流（<900px）：内容整页 + 底部导航；进编辑器时全屏并隐藏底栏。 */
import { Outlet, useLocation } from "react-router-dom";
import { AppNavBar } from "./Nav";

export function MobileLayout() {
  const { pathname } = useLocation();
  const inEditor = pathname.startsWith("/n/");

  return (
    <div className="app-shell app-shell--mobile" data-testid="app-shell">
      <main className="mobile-content">
        <Outlet />
      </main>
      {!inEditor && <AppNavBar />}
    </div>
  );
}
