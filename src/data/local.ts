/**
 * LocalDataSource：IndexedDB 实现（方案 §5.3）。
 *
 * 复用 db.ts（连接/事务）、blobStore.ts（附件）、query.ts（内存过滤）、backup.ts（base64）。
 *
 * ★ 核心修正：upsertNote 用 `put`（同 id 覆盖 = 原地更新），而非旧版的 delete+add。
 *   旧版「编辑=删旧建新」导致 id 变化的语义 bug 在此根除。
 *
 * 实现 datasource.ts 定义的 DataSource 接口（class 风格，返回类型与接口严格对齐）。
 */
import { globalConfig } from "@/config";
import type { Note, NoteFilter, NoteSummary } from "@/types/note";
import type { Folder } from "@/types/folder";
import type { BlobRecord } from "@/types/blob";
import type { BackupBlob, BackupPayload } from "@/types/backup";
import { idbReq } from "@/utils/idb";
import { getAllOf, withTx } from "./db";
import { base64ToBlob, blobToBase64 } from "./backup";
import {
  adjustBlobRefs,
  extractBlobRefIds,
  getBlob,
  reconcileBlobRefs,
  saveBlob,
} from "./blobStore";
import { queryNotes, type QueryResult } from "./query";
import type { DataSource } from "./datasource";

const notesStore = globalConfig.storeNames.notes;
const blobsStore = globalConfig.storeNames.blobs;
const foldersStore = globalConfig.storeNames.folders;

export class LocalDataSource implements DataSource {
  /**
   * ★ put = 原地 upsert：同 id 覆盖更新，新 id 插入；永不改 id。返回落库后的 Note。
   *
   * ★ 附件引用计数与笔记写入在**同一事务**内完成：比对新旧正文引用的差集，
   *   新增 +1、移除 -1，计数归零的 blob 自动删除（无笔记使用即回收）。
   *   attachmentIds 以正文为准重新反填，避免调用方传入陈旧索引。
   */
  async upsertNote(note: Note): Promise<Note> {
    const next: Note = { ...note, attachmentIds: extractBlobRefIds(note.content) };
    await withTx([notesStore, blobsStore], "readwrite", async (tx) => {
      const prev = await idbReq<Note | undefined>(tx.objectStore(notesStore).get(note.id));
      // 以旧正文为真相源算旧引用（不信任可能陈旧的 attachmentIds）
      const prevIds = new Set(prev ? extractBlobRefIds(prev.content) : []);
      const nextIds = new Set(next.attachmentIds);
      const removed = [...prevIds].filter((id) => !nextIds.has(id));
      const added = [...nextIds].filter((id) => !prevIds.has(id));

      await adjustBlobRefs(tx, removed, -1);
      await adjustBlobRefs(tx, added, 1);

      tx.objectStore(notesStore).put(next);
    });
    return next;
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

  /**
   * ★ 删除笔记：在同一事务里按引用计数释放其附件，再删笔记本体。
   *
   * 不再按 noteId 批量删除——同一附件可能被多条笔记引用（复制粘贴），
   * 只有计数归零才真正删除，避免误删其它笔记仍在用的图片。
   */
  async deleteNote(id: string): Promise<void> {
    await withTx([notesStore, blobsStore], "readwrite", async (tx) => {
      const prev = await idbReq<Note | undefined>(tx.objectStore(notesStore).get(id));
      // 以正文为真相源释放引用（附件可被多笔记共享，按计数递减而非按 noteId 盲删）
      if (prev) await adjustBlobRefs(tx, extractBlobRefIds(prev.content), -1);
      tx.objectStore(notesStore).delete(id);
    });
  }

  async saveAttachment(noteId: string, file: Blob): Promise<string> {
    return saveBlob(noteId, file);
  }

  async getAttachment(id: string): Promise<BlobRecord | undefined> {
    return getBlob(id);
  }

  /** 全库校准附件引用计数并回收无引用 blob（启动/导入后调用）。 */
  async reconcileAttachmentRefs(): Promise<{ kept: number; purged: number }> {
    return reconcileBlobRefs();
  }

  // —— 文件夹 ——

  async listFolders(): Promise<Folder[]> {
    const all = await getAllOf<Folder>(foldersStore);
    return all.sort(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
        a.name.localeCompare(b.name),
    );
  }

  /** 侧栏笔记树：一次取回全部投影，搜索/分页语义与列表互不影响。 */
  async listAllNotes(): Promise<NoteSummary[]> {
    const { items } = await queryNotes({ sort: "title" }, Number.MAX_SAFE_INTEGER, 0);
    return items;
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
      refCount: 0, // 真实计数由 reconcileBlobRefs() 按正文重算
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

    // 导入的备份可能带有陈旧 attachmentIds / 零引用孤儿：以正文为准重算并回收
    await reconcileBlobRefs();

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
