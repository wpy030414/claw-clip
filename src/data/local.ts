/**
 * LocalDataSource：IndexedDB 实现（方案 §5.3）。
 *
 * 复用 db.ts（连接/事务）、blobStore.ts（附件）、query.ts（内存过滤）、backup.ts（base64）。
 *
 * ★ 核心修正：upsertNote 用 `put`（同 id 覆盖 = 原地更新），而非旧版的 delete+add。
 *   旧版「编辑=删旧建新」导致 id 变化、收藏靠手动搬运的语义 bug 在此根除。
 *
 * 实现 datasource.ts 定义的 DataSource 接口（class 风格，返回类型与接口严格对齐）。
 */
import { globalConfig } from "@/config";
import type { Note, NoteFilter } from "@/types/note";
import type { Folder } from "@/types/folder";
import type { BlobRecord } from "@/types/blob";
import type { BackupBlob, BackupPayload } from "@/types/backup";
import { idbReq } from "@/utils/idb";
import { getAllOf, withTx } from "./db";
import { base64ToBlob, blobToBase64 } from "./backup";
import { deleteBlobsOfNote, getBlob, saveBlob } from "./blobStore";
import { queryNotes, type QueryResult } from "./query";
import type { DataSource } from "./datasource";

const notesStore = globalConfig.storeNames.notes;
const blobsStore = globalConfig.storeNames.blobs;
const foldersStore = globalConfig.storeNames.folders;

export class LocalDataSource implements DataSource {
  /** ★ put = 原地 upsert：同 id 覆盖更新，新 id 插入；永不改 id。返回落库后的 Note。 */
  async upsertNote(note: Note): Promise<Note> {
    await withTx(notesStore, "readwrite", (tx) =>
      idbReq(tx.objectStore(notesStore).put(note)),
    );
    return note;
  }

  async getNote(id: string): Promise<Note | undefined> {
    return withTx<Note | undefined>(notesStore, "readonly", (tx) =>
      idbReq<Note | undefined>(tx.objectStore(notesStore).get(id)),
    );
  }

  async listNotes(
    filter: NoteFilter,
    pageSize?: number,
    pageOffset?: number,
  ): Promise<QueryResult> {
    return queryNotes(filter, pageSize, pageOffset);
  }

  /** ★ 先级联删附件 blob，再删笔记本体。 */
  async deleteNote(id: string): Promise<void> {
    await deleteBlobsOfNote(id);
    await withTx(notesStore, "readwrite", (tx) =>
      idbReq(tx.objectStore(notesStore).delete(id)),
    );
  }

  /** 内联字段：改 starred 再原地 put（保留原 createdAt/updatedAt，不因收藏刷新时间）。 */
  async setStarred(id: string, starred: boolean): Promise<void> {
    const note = await this.getNote(id);
    if (!note) return;
    await withTx(notesStore, "readwrite", (tx) =>
      idbReq(tx.objectStore(notesStore).put({ ...note, starred })),
    );
  }

  /** 切换收藏，返回切换后的值（笔记不存在返回 false）。 */
  async toggleStar(id: string): Promise<boolean> {
    const note = await this.getNote(id);
    if (!note) return false;
    const next = !note.starred;
    await this.setStarred(id, next);
    return next;
  }

  async saveAttachment(noteId: string, file: Blob): Promise<string> {
    return saveBlob(noteId, file);
  }

  async getAttachment(id: string): Promise<BlobRecord | undefined> {
    return getBlob(id);
  }

  // —— 文件夹 ——

  async listFolders(): Promise<Folder[]> {
    const all = await getAllOf<Folder>(foldersStore);
    return all.sort((a, b) => a.name.localeCompare(b.name));
  }

  async upsertFolder(folder: Folder): Promise<Folder> {
    const next: Folder = { ...folder, updatedAt: Date.now() };
    await withTx(foldersStore, "readwrite", (tx) =>
      idbReq(tx.objectStore(foldersStore).put(next)),
    );
    return next;
  }

  /** 级联删除：先收集子孙文件夹，再删其中笔记（含附件），最后删文件夹记录。 */
  async deleteFolder(id: string): Promise<void> {
    const allFolders = await getAllOf<Folder>(foldersStore);
    const doomed = new Set<string>([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of allFolders) {
        if (f.parentId && doomed.has(f.parentId) && !doomed.has(f.id)) {
          doomed.add(f.id);
          grew = true;
        }
      }
    }
    const allNotes = await getAllOf<Note>(notesStore);
    for (const n of allNotes) {
      if (n.folderId && doomed.has(n.folderId)) await this.deleteNote(n.id);
    }
    await withTx(foldersStore, "readwrite", (tx) => {
      const store = tx.objectStore(foldersStore);
      for (const fid of doomed) store.delete(fid);
    });
  }

  async exportAll(): Promise<BackupPayload> {
    const notes = await getAllOf<Note>(notesStore);
    const folders = await getAllOf<Folder>(foldersStore);
    const blobs = await getAllOf<BlobRecord>(blobsStore);

    // blob 二进制 → base64（JSON 无法承载二进制）
    const backupBlobs: BackupBlob[] = await Promise.all(
      blobs.map(async (b) => ({
        id: b.id,
        noteId: b.noteId,
        mime: b.mime,
        size: b.size,
        base64: await blobToBase64(b.data),
      })),
    );

    return {
      schemaVersion: 2,
      exportedAt: Date.now(),
      notes,
      folders,
      blobs: backupBlobs,
    };
  }

  async importAll(payload: BackupPayload): Promise<{ notes: number; blobs: number }> {
    // 还原 blob：base64 → Blob
    const blobRecords: BlobRecord[] = payload.blobs.map((b) => ({
      id: b.id,
      noteId: b.noteId,
      mime: b.mime,
      size: b.size,
      data: base64ToBlob(b.base64, b.mime),
      createdAt: Date.now(),
    }));

    // notes + folders + blobs 分事务写入（各自 store）
    await withTx(notesStore, "readwrite", (tx) => {
      const store = tx.objectStore(notesStore);
      for (const note of payload.notes) store.put(note);
    });
    if (payload.folders?.length) {
      await withTx(foldersStore, "readwrite", (tx) => {
        const store = tx.objectStore(foldersStore);
        for (const folder of payload.folders!) store.put(folder);
      });
    }
    await withTx(blobsStore, "readwrite", (tx) => {
      const store = tx.objectStore(blobsStore);
      for (const rec of blobRecords) store.put(rec);
    });

    return { notes: payload.notes.length, blobs: blobRecords.length };
  }

  /** 清空 notes + folders + blobs（meta 保留）。危险操作，UI 层须二次确认。 */
  async clear(): Promise<void> {
    await withTx([notesStore, foldersStore, blobsStore], "readwrite", (tx) => {
      tx.objectStore(notesStore).clear();
      tx.objectStore(foldersStore).clear();
      tx.objectStore(blobsStore).clear();
    });
  }

  async countAll(): Promise<number> {
    return withTx<number>(notesStore, "readonly", (tx) =>
      idbReq<number>(tx.objectStore(notesStore).count()),
    );
  }
}
