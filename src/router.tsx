/**
 * 路由：单一 data router，`/n/:noteId` 表达「当前选中笔记」。
 * 桌面与移动两套布局共享同一路由树（见 ARCHITECTURE §3）。
 */
import { createBrowserRouter } from "react-router-dom";
import { AppShell } from "@/layouts/AppShell";
import { EditorPage } from "@/pages/EditorPage";
import { NotesPage } from "@/pages/NotesPage";
import { SearchPage } from "@/pages/SearchPage";
import { StarredPage } from "@/pages/StarredPage";

/** GitHub Pages 部署在 /claw-clip/ 子路径；Vite base 决定 basename。 */
const base = import.meta.env.BASE_URL;
const basename = base === "/" ? "/" : base.replace(/\/$/, "");

export const router = createBrowserRouter(
  [
    {
      path: "/",
      element: <AppShell />,
      children: [
        { index: true, element: <NotesPage /> },
        { path: "starred", element: <StarredPage /> },
        { path: "search", element: <SearchPage /> },
        { path: "n/:noteId", element: <EditorPage /> },
      ],
    },
  ],
  { basename },
);
