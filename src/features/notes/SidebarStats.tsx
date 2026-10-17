/**
 * 侧栏底部：本应用 IndexedDB 数据统计（共 x 个笔记，xxx KB/MB/GB）。
 *
 * 监听 notesStore.revision：创建/编辑/删除/导入/重置后重算。
 * 400ms 防抖，避免连续保存时反复全表扫描。
 */
import { useEffect, useState } from "react";
import { formatBytes, getDbStats, type DbStats } from "@/data/stats";
import { useNotesStore } from "@/stores/notesStore";

export function SidebarStats() {
  const revision = useNotesStore((s) => s.revision);
  const [stats, setStats] = useState<DbStats | null>(null);

  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void getDbStats()
        .then((next) => {
          if (!cancelled) setStats(next);
        })
        .catch(() => {
          if (!cancelled) setStats(null);
        });
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [revision]);

  return (
    <div className="sidebar-stats" data-testid="sidebar-stats" title="IndexedDB 数据统计">
      <span className="material-symbols-outlined" aria-hidden="true">
        database
      </span>
      {stats ? (
        <>
          <span className="sidebar-stats-count">共 {stats.noteCount} 个笔记</span>
          <span className="sidebar-stats-sep" aria-hidden="true">
            ·
          </span>
          <span className="sidebar-stats-size">{formatBytes(stats.bytes)}</span>
        </>
      ) : (
        <span>统计中…</span>
      )}
    </div>
  );
}
