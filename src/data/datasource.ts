/**
 * 数据源门面（方案 §5.3 / 附录 B）。
 *
 * 定义统一 `DataSource` 接口，按 `globalConfig.enableStoringLocally` 在
 * Local（IndexedDB）/ Remote（占位，未实现）之间切换，导出 `datasource` 单例。
 * 上层（stores/hooks）只依赖本接口，不感知具体实现。
 */
import { globalConfig } from "@/config";
import type { BackupPayload } from "@/types/backup";
import type { BlobRecord } from "@/types/blob";
import type { Note, NoteFilter } from "@/types/note";
import { LocalDataSource } from "./local";
import { RemoteDataSource } from "./remote";
import type { QueryResult } from "./query";

export type { QueryResult };

export interface DataSource {
  /** 新增或原地更新笔记（put 覆盖，永不改 id，落库刷新 updatedAt）。 */
  upsertNote(note: Note): Promise<Note>;
  /** 按 id 取完整 Note（含 content）。 */
  getNote(id: string): Promise<Note | undefined>;
  /** 过滤/排序/分页列表，返回 { total, items: NoteSummary[] }。 */
  listNotes(
    filter: NoteFilter,
    pageSize?: number,
    pageOffset?: number,
  ): Promise<QueryResult>;
  /** 删除笔记（级联删除其全部附件 blob）。 */
  deleteNote(id: string): Promise<void>;
  /** 设置收藏（starred 为 Note 内联字段）。 */
  setStarred(id: string, starred: boolean): Promise<void>;
  /** 切换收藏，返回切换后的值。 */
  toggleStar(id: string): Promise<boolean>;
  /** 保存附件二进制，返回 blob id（正文用 clawclip://blob/<id> 引用）。 */
  saveAttachment(noteId: string, file: Blob): Promise<string>;
  /** 取附件记录（含 Blob 本体）。 */
  getAttachment(id: string): Promise<BlobRecord | undefined>;
  /** 导出全库（notes + blobs base64 化）。 */
  exportAll(): Promise<BackupPayload>;
  /** 导入备份，返回写入计数。 */
  importAll(payload: BackupPayload): Promise<{ notes: number; blobs: number }>;
  /** 清空全部数据（危险操作，UI 层须二次确认）。 */
  clear(): Promise<void>;
  /** notes 总数。 */
  countAll(): Promise<number>;
}

/** 全局数据源单例：默认本地 IndexedDB；enableStoringLocally=false 时走远程占位。 */
export const datasource: DataSource = globalConfig.enableStoringLocally
  ? new LocalDataSource()
  : new RemoteDataSource();
