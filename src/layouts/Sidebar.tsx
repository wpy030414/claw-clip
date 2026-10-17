/**
 * Typora 式侧栏：文档 / 大纲两个页签，可整体收起。
 *
 * 收起/展开按钮由 DesktopLayout 放在主内容顶栏左侧；侧栏自身只在打开时渲染。
 * 文档页签的内容由 NoteTree 负责（行级新建按钮 + 文件夹/笔记树）。
 */
import { globalConfig } from "@/config";
import { NoteTree } from "@/features/notes/NoteTree";
import { SidebarStats } from "@/features/notes/SidebarStats";
import { OutlinePane } from "@/features/outline/OutlinePane";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUiStore } from "@/stores/uiStore";

export function Sidebar() {
  const open = useUiStore((s) => s.sidebarOpen);
  const tab = useUiStore((s) => s.sidebarTab);
  const setTab = useUiStore((s) => s.setSidebarTab);
  const resolvedScheme = useSettingsStore((s) => s.resolvedScheme);
  const toggleScheme = useSettingsStore((s) => s.toggleScheme);

  if (!open) return null;

  return (
    <aside className="app-sidebar" data-testid="app-sidebar">
      <div className="sidebar-brand" data-testid="sidebar-brand">
        <span className="sidebar-brand-main">
          <img
            className="sidebar-logo"
            data-testid="sidebar-logo"
            src={`${import.meta.env.BASE_URL}favicon.ico`}
            alt=""
            aria-hidden="true"
            data-dark={resolvedScheme === "dark" ? "true" : "false"}
          />
          <span className="sidebar-brand-name">{globalConfig.appName.en}</span>
        </span>
        <a
          className="sidebar-github"
          data-testid="link-github"
          href={globalConfig.projectUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="打开 GitHub 项目页"
          title="GitHub"
        >
          <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
          </svg>
        </a>
      </div>

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
      </div>

      {tab === "outline" ? <OutlinePane /> : <NoteTree />}

      <footer className="sidebar-footer" data-testid="sidebar-footer">
        <SidebarStats />
        <button
          type="button"
          className="sidebar-theme-toggle"
          data-testid="btn-theme-toggle"
          aria-label={resolvedScheme === "dark" ? "切换到浅色" : "切换到深色"}
          aria-pressed={resolvedScheme === "dark"}
          title={resolvedScheme === "dark" ? "切换到浅色" : "切换到深色"}
          onClick={toggleScheme}
        >
          <span className="material-symbols-outlined">
            {resolvedScheme === "dark" ? "light_mode" : "dark_mode"}
          </span>
        </button>
      </footer>
    </aside>
  );
}
