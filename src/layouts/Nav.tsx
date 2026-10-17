/**
 * 导航：桌面 NavRail（左竖排）/ 移动 NavBar（底部横排）。
 * 选中态从当前路由派生，两套壳共享同一份 tab 定义。
 */
import { useLocation, useNavigate } from "react-router-dom";
import { M3eIcon, M3eNavBar, M3eNavItem, M3eNavRail } from "@/components/m3e";

const TABS = [
  { key: "notes", path: "/", icon: "description", label: "笔记" },
  { key: "starred", path: "/starred", icon: "star", label: "收藏" },
  { key: "search", path: "/search", icon: "search", label: "搜索" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

function useActiveTab(): TabKey {
  const { pathname } = useLocation();
  if (pathname.startsWith("/starred")) return "starred";
  if (pathname.startsWith("/search")) return "search";
  return "notes";
}

export function AppNavRail() {
  const active = useActiveTab();
  const navigate = useNavigate();
  return (
    <M3eNavRail className="app-nav-rail" data-testid="nav-rail">
      {TABS.map((t) => (
        <M3eNavItem
          key={t.key}
          selected={active === t.key}
          data-testid={`nav-${t.key}`}
          onClick={() => navigate(t.path)}
        >
          <M3eIcon slot="icon" name={t.icon} />
          {t.label}
        </M3eNavItem>
      ))}
    </M3eNavRail>
  );
}

export function AppNavBar() {
  const active = useActiveTab();
  const navigate = useNavigate();
  return (
    <M3eNavBar className="app-nav-bar" data-testid="nav-bar">
      {TABS.map((t) => (
        <M3eNavItem
          key={t.key}
          orientation="horizontal"
          selected={active === t.key}
          data-testid={`nav-${t.key}`}
          onClick={() => navigate(t.path)}
        >
          <M3eIcon slot="icon" name={t.icon} />
          {t.label}
        </M3eNavItem>
      ))}
    </M3eNavBar>
  );
}
