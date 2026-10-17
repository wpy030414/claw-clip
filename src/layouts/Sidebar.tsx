/**
 * Typora 式侧栏：文档 / 大纲两个页签，可整体收起。
 * 桌面常驻；收起后左上角留一个展开按钮。
 */
import { useLocation, useNavigate } from "react-router-dom";
import { M3eIconButton } from "@/components/m3e";
import { NoteListPane } from "@/features/notes/NoteListPane";
import { OutlinePane } from "@/features/outline/OutlinePane";
import { useUiStore } from "@/stores/uiStore";

const NAV = [
  { key: "notes", path: "/", icon: "description", label: "全部笔记" },
  { key: "starred", path: "/starred", icon: "star", label: "收藏" },
  { key: "search", path: "/search", icon: "search", label: "搜索" },
] as const;

function useActiveNav(): string {
  const { pathname } = useLocation();
  if (pathname.startsWith("/starred")) return "starred";
  if (pathname.startsWith("/search")) return "search";
  return "notes";
}

export function Sidebar() {
  const navigate = useNavigate();
  const active = useActiveNav();
  const open = useUiStore((s) => s.sidebarOpen);
  const setOpen = useUiStore((s) => s.setSidebarOpen);
  const tab = useUiStore((s) => s.sidebarTab);
  const setTab = useUiStore((s) => s.setSidebarTab);

  if (!open) {
    return (
      <button
        type="button"
        className="sidebar-expand"
        data-testid="btn-sidebar-open"
        aria-label="展开侧栏"
        onClick={() => setOpen(true)}
      >
        <span className="material-symbols-outlined">menu</span>
      </button>
    );
  }

  return (
    <aside className="app-sidebar" data-testid="app-sidebar">
      <div className="sidebar-top">
        <div className="sidebar-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            data-testid="tab-docs"
            data-active={tab === "docs" ? "true" : "false"}
            aria-selected={tab === "docs"}
            onClick={() => setTab("docs")}
          >
            文档
          </button>
          <button
            type="button"
            role="tab"
            data-testid="tab-outline"
            data-active={tab === "outline" ? "true" : "false"}
            aria-selected={tab === "outline"}
            onClick={() => setTab("outline")}
          >
            大纲
          </button>
        </div>
        <M3eIconButton
          data-testid="btn-sidebar-close"
          aria-label="收起侧栏"
          onClick={() => setOpen(false)}
        >
          <span className="material-symbols-outlined">chevron_left</span>
        </M3eIconButton>
      </div>

      {tab === "outline" ? (
        <OutlinePane />
      ) : (
        <>
          <div className="sidebar-nav" role="navigation">
            {NAV.map((item) => (
              <button
                key={item.key}
                type="button"
                className="sidebar-nav-item"
                data-testid={`nav-${item.key}`}
                data-active={active === item.key ? "true" : "false"}
                onClick={() => navigate(item.path)}
                title={item.label}
                aria-label={item.label}
              >
                <span className="material-symbols-outlined">{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <NoteListPane />
        </>
      )}
    </aside>
  );
}
