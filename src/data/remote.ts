/**
 * RemoteDataSource：远程后端占位实现（方案 §5.3）。
 *
 * 保留旧版「按 enableStoringLocally 切换后端」的接口形状，但**未实现具体远程服务**。
 * 默认 enableStoringLocally=true，运行时走 LocalDataSource，本类不会被实例化调用。
 * 每个方法抛出 NotImplemented，保留 fetch 形状的注释说明将来如何对接。
 *
 * 将来若实现远程后端：把这些方法体换成对 `${globalConfig.dataSource.addr}/<method>`
 * 的 POST 请求即可（旧 remote.ts 即此形状），接口无需变动。
 */
import { globalConfig } from "@/config";
import type { Note, NoteFilter, NoteSummary } from "@/types/note";
import type { Folder } from "@/types/folder";
import type { BlobRecord } from "@/types/blob";
import type { BackupPayload } from "@/types/backup";
import type { DataSource } from "./datasource";
import type { QueryResult } from "./query";

function notImplemented(method: string): never {
  throw new Error(
    `RemoteDataSource.${method} 未实现：本项目默认本地 IndexedDB 存储` +
      `（enableStoringLocally=${globalConfig.enableStoringLocally}，addr=${globalConfig.dataSource.addr}）。`,
  );
}

export class RemoteDataSource implements DataSource {
  async upsertNote(_note: Note): Promise<Note> {
    // 将来：POST `${addr}/upsert` body=note
    return notImplemented("upsertNote");
  }
  async getNote(_id: string): Promise<Note | undefined> {
    return notImplemented("getNote");
  }
  async listNotes(
    _filter: NoteFilter,
    _pageSize?: number,
    _pageOffset?: number,
  ): Promise<QueryResult> {
    return notImplemented("listNotes");
  }
  async deleteNote(_id: string): Promise<void> {
    return notImplemented("deleteNote");
  }
  async listFolders(): Promise<Folder[]> {
    return notImplemented("listFolders");
  }
  async listAllNotes(): Promise<NoteSummary[]> {
    return notImplemented("listAllNotes");
  }
  async upsertFolder(_folder: Folder): Promise<Folder> {
    return notImplemented("upsertFolder");
  }
  async deleteFolder(_id: string): Promise<void> {
    return notImplemented("deleteFolder");
  }
  async saveAttachment(_noteId: string, _file: Blob): Promise<string> {
    return notImplemented("saveAttachment");
  }
  async getAttachment(_id: string): Promise<BlobRecord | undefined> {
    return notImplemented("getAttachment");
  }
  async reconcileAttachmentRefs(): Promise<{ kept: number; purged: number }> {
    return notImplemented("reconcileAttachmentRefs");
  }
  async exportAll(): Promise<BackupPayload> {
    return notImplemented("exportAll");
  }
  async importAll(_payload: BackupPayload): Promise<{ notes: number; blobs: number }> {
    return notImplemented("importAll");
  }
  async clear(): Promise<void> {
    return notImplemented("clear");
  }
  async countAll(): Promise<number> {
    return notImplemented("countAll");
  }
}
