/**
 * 内存过滤 / 排序 / 分页（方案 §5.3）。
 *
 * IndexedDB 没有全文检索（FTS），keyword 搜索又必须读 content —— 索性取全量
 * notes 在内存里过滤。本地量级（数百~数千条笔记）完全够用，不引入 FTS（记 ADR）。
 *
 * 注意：过滤阶段用完整 Note（keyword 要搜 content），**投影成 NoteSummary 只在
 * 分页切片之后做**，保证返回体轻量。
 */
import { globalConfig } from "@/config";
import type { Note, NoteFilter, NoteSummary } from "@/types/note";
import { toSummary } from "@/types/note";
import { getAllOf } from "./db";

export interface QueryResult {
  /** 过滤后（分页前）的总条数，供分页 UI 计算页数 */
  total: number;
  items: NoteSummary[];
}

export async function queryNotes(
  filter: NoteFilter,
  pageSize: number = globalConfig.pageSize,
  pageOffset = 0,
): Promise<QueryResult> {
  let notes = await getAllOf<Note>(globalConfig.storeNames.notes);

  // ---- 过滤 ----
  const kw = filter.keyword?.trim().toLowerCase();
  if (kw) {
    notes = notes.filter(
      (n) =>
        n.title.toLowerCase().includes(kw) ||
        n.content.toLowerCase().includes(kw) ||
        n.tags.some((t) => t.toLowerCase().includes(kw)),
    );
  }
  if (filter.tags && filter.tags.length > 0) {
    // AND 语义：需同时含所有指定标签
    notes = notes.filter((n) => filter.tags!.every((t) => n.tags.includes(t)));
  }
  if (filter.folderId !== undefined) {
    // 旧笔记没有 folderId → 视为根目录（null）
    notes = notes.filter((n) => (n.folderId ?? null) === filter.folderId);
  }

  // ---- 排序（title 用 localeCompare 升序，时间类降序=新在前） ----
  const sort = filter.sort ?? "updated";
  notes.sort((a, b) => {
    if (sort === "title") return a.title.localeCompare(b.title);
    if (sort === "created") return b.createdAt - a.createdAt;
    return b.updatedAt - a.updatedAt;
  });

  // ---- 分页 + 投影 ----
  const from = Math.max(0, pageOffset);
  const page = notes.slice(from, from + Math.max(0, pageSize));
  return { total: notes.length, items: page.map(toSummary) };
}
