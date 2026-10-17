/**
 * NoteListPane：列表面板（桌面分栏左栏 / 移动整页共用）。
 *
 * 过滤语义由 uiStore.listMode 驱动并**跨 /n/:id 保持**——进编辑器再返回不会丢收藏/搜索筛选。
 * 数据仍走 notesStore.load(filter)，列表只持有 NoteSummary。
 */
import { useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { M3eFab, M3eIconButton } from "@/components/m3e";
import { useCreateNote } from "@/hooks/useCreateNote";
import { useImportDocument } from "@/hooks/useImportDocument";
import { FolderTree } from "@/features/folders/FolderTree";
import { useIsDesktop } from "@/hooks/useMediaQuery";
import { useNotesStore } from "@/stores/notesStore";
import { useUiStore } from "@/stores/uiStore";
import type { NoteFilter } from "@/types/note";
import { NoteList } from "./NoteList";

const TITLES = { notes: "笔记", starred: "收藏", search: "搜索" } as const;

export function NoteListPane() {
  const navigate = useNavigate();
  const isDesktop = useIsDesktop();
  const create = useCreateNote();
  const importDoc = useImportDocument();

  const items = useNotesStore((s) => s.summaries);
  const total = useNotesStore((s) => s.total);
  const loading = useNotesStore((s) => s.loading);
  const load = useNotesStore((s) => s.load);
  const toggleStar = useNotesStore((s) => s.toggleStar);
  const activeId = useNotesStore((s) => s.activeNoteId);

  const listMode = useUiStore((s) => s.listMode);
  const currentFolderId = useUiStore((s) => s.currentFolderId);
  const filter = useUiStore((s) => s.filter);
  const keyword = useUiStore((s) => s.keyword);
  const setKeyword = useUiStore((s) => s.setKeyword);

  // 有效过滤：收藏页强制 starred=true；搜索页才把 keyword 纳入查询
  const effective: NoteFilter = useMemo(
    () => ({
      ...filter,
      starred: listMode === "starred" ? true : undefined,
      keyword: listMode === "search" ? keyword.trim() || undefined : undefined,
      folderId: listMode === "notes" ? currentFolderId ?? undefined : undefined,
    }),
    [filter, listMode, keyword, currentFolderId],
  );
  const filterKey = JSON.stringify(effective);

  const pageRef = useRef(0);
  useEffect(() => {
    pageRef.current = 0;
    void load(effective);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterKey, load]);

  const handleMore = async () => {
    pageRef.current += 1;
    await load(effective, pageRef.current);
  };

  return (
    <aside
      className="note-list-pane"
      data-testid="note-list-pane"
      data-folder={currentFolderId ?? "all"}
      data-filter={filterKey}
    >
      <header className="note-list-header">
        <h1 className="note-list-title" data-testid="note-list-title">
          {TITLES[listMode]}
        </h1>
        <span className="note-list-actions">
          <label className="note-import" title="导入 MD / DOCX / PDF" aria-label="导入文件">
            <span className="material-symbols-outlined">upload_file</span>
            <input
              type="file"
              accept=".md,.markdown,.txt,.docx,.pdf"
              data-testid="import-input"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void importDoc(file);
              }}
            />
          </label>
          {isDesktop && (
            <M3eIconButton
              data-testid="btn-new"
              aria-label="新建笔记"
              onClick={() => void create()}
            >
              <span className="material-symbols-outlined">add</span>
            </M3eIconButton>
          )}
        </span>
      </header>

      {listMode === "notes" && <FolderTree />}

      {listMode === "search" && (
        <div className="note-search">
          <span className="material-symbols-outlined" aria-hidden="true">
            search
          </span>
          <input
            data-testid="search-input"
            type="search"
            placeholder="搜索标题、正文或标签"
            aria-label="搜索笔记"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            autoFocus
          />
          {keyword && (
            <button
              type="button"
              className="note-search-clear"
              aria-label="清空搜索"
              onClick={() => setKeyword("")}
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          )}
        </div>
      )}

      <div className="note-list-body">
        {loading && items.length === 0 ? (
          <div className="note-list-loading">载入中…</div>
        ) : (
          <NoteList
            items={items}
            variant={isDesktop ? "compact" : "card"}
            activeId={activeId}
            onSelect={(id) => navigate(`/n/${id}`)}
            onToggleStar={(id) => void toggleStar(id)}
            emptyText={
              listMode === "search"
                ? "没有匹配的笔记"
                : listMode === "starred"
                  ? "还没有收藏的笔记"
                  : "还没有笔记，点「+」新建一条"
            }
          />
        )}
        {items.length < total && (
          <button type="button" className="note-list-more" onClick={() => void handleMore()}>
            加载更多（{items.length}/{total}）
          </button>
        )}
      </div>

      {!isDesktop && (
        <M3eFab
          className="note-fab"
          data-testid="btn-new"
          aria-label="新建笔记"
          onClick={() => void create()}
        >
          <span className="material-symbols-outlined">add</span>
        </M3eFab>
      )}
    </aside>
  );
}
