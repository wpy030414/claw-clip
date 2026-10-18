/**
 * 存储空间报告（「存储空间」大 dialog 用）。
 *
 * 与 stats.ts 的 getDbStats 同口径：只统计本应用四个 store 的数据载荷，
 * 不含 IndexedDB 的索引/页开销。这里额外给出：
 * - 按 store 分解；
 * - 按笔记/附件排行（共享附件按引用笔记数均摊，避免重复计算）；
 * - 浏览器整站配额（navigator.storage.estimate，口径与载荷不同，UI 明确区分）。
 */
import { globalConfig } from "@/config";
import type { BlobRecord } from "@/types/blob";
import type { Folder } from "@/types/folder";
import type { Note } from "@/types/note";
import { extractBlobRefIds } from "./blobStore";
import { idbReq } from "@/utils/idb";
import { withTx } from "./db";
import { jsonBytes } from "./stats";

export interface StoreUsage {
  count: number;
  bytes: number;
}

export interface NoteUsage {
  id: string;
  title: string;
  folderId: string | null;
  updatedAt: number;
  /** 笔记记录本身的 JSON 字节 */
  recordBytes: number;
  /** 引用附件均摊到本笔记的字节（共享附件按引用数均分） */
  attachmentBytes: number;
  /** 引用的去重附件数 */
  attachmentCount: number;
  /** 其中被多条笔记共享的附件数 */
  sharedAttachmentCount: number;
  totalBytes: number;
}

export interface AttachmentUsage {
  id: string;
  mime: string;
  size: number;
  metadataBytes: number;
  createdAt: number;
  ownerIds: string[];
  ownerTitles: string[];
  shared: boolean;
  orphan: boolean;
}

export interface QuotaInfo {
  /** 浏览器是否提供了可用配额 */
  supported: boolean;
  usage: number | null;
  quota: number | null;
  available: number | null;
  persisted: boolean;
  /** navigator.storage.estimate().usageDetails.indexedDB（浏览器口径） */
  indexedDbUsage: number | null;
}

export interface StorageReport {
  capturedAt: number;
  noteCount: number;
  folderCount: number;
  attachmentCount: number;
  stores: {
    notes: StoreUsage;
    folders: StoreUsage;
    blobs: StoreUsage;
    meta: StoreUsage;
  };
  /** notes + folders + blobs + meta 的载荷近似值 */
  appBytes: number;
  /** 附件二进制本体字节 */
  binaryBytes: number;
  /** 没有任何笔记引用的附件字节（启动时会由 reconcile 回收） */
  orphanBytes: number;
  /** 按占用降序 */
  noteRanking: NoteUsage[];
  /** 按体积降序 */
  attachmentRanking: AttachmentUsage[];
  quota: QuotaInfo;
}

/** 附件元数据（不含 Blob 本体）的估算字节。 */
function blobMetaBytes(blob: BlobRecord): number {
  return jsonBytes({
    id: blob.id,
    noteId: blob.noteId,
    mime: blob.mime,
    size: blob.size,
    createdAt: blob.createdAt,
  });
}

function blobSize(blob: BlobRecord): number {
  return blob.size || blob.data?.size || 0;
}

/** 读取完整存储报告。 */
export async function getStorageReport(): Promise<StorageReport> {
  const { notes, folders, blobs, meta } = globalConfig.storeNames;

  // 单只读事务读四张表，保证四份数据来自同一时刻
  const [noteRows, folderRows, blobRows, metaRows] = await withTx<
    [Note[], Folder[], BlobRecord[], Record<string, unknown>[]]
  >(
    [notes, folders, blobs, meta],
    "readonly",
    async (tx) => {
      const noteRows = await idbReq<Note[]>(tx.objectStore(notes).getAll());
      const folderRows = await idbReq<Folder[]>(tx.objectStore(folders).getAll());
      const blobRows = await idbReq<BlobRecord[]>(tx.objectStore(blobs).getAll());
      const metaRows = await idbReq<Record<string, unknown>[]>(tx.objectStore(meta).getAll());
      return [noteRows, folderRows, blobRows, metaRows] as const;
    },
  );

  const blobById = new Map(blobRows.map((b) => [b.id, b]));

  // 归属以笔记正文为唯一真相源（attachmentIds 可能是陈旧索引）
  const owners = new Map<string, Set<string>>();
  for (const note of noteRows) {
    for (const id of extractBlobRefIds(note.content)) {
      if (!blobById.has(id)) continue;
      const set = owners.get(id) ?? new Set<string>();
      set.add(note.id);
      owners.set(id, set);
    }
  }

  const noteRanking: NoteUsage[] = noteRows.map((note) => {
    const recordBytes = jsonBytes(note);
    const refs = extractBlobRefIds(note.content);
    let attachmentBytes = 0;
    let attachmentCount = 0;
    let sharedAttachmentCount = 0;
    for (const id of refs) {
      const blob = blobById.get(id);
      if (!blob) continue;
      const ownerCount = Math.max(1, owners.get(id)?.size ?? 1);
      attachmentBytes += blobSize(blob) / ownerCount;
      attachmentCount += 1;
      if (ownerCount > 1) sharedAttachmentCount += 1;
    }
    return {
      id: note.id,
      title: note.title,
      folderId: note.folderId ?? null,
      updatedAt: note.updatedAt,
      recordBytes,
      attachmentBytes,
      attachmentCount,
      sharedAttachmentCount,
      totalBytes: recordBytes + attachmentBytes,
    };
  });
  noteRanking.sort((a, b) => b.totalBytes - a.totalBytes);

  const titleById = new Map(noteRows.map((n) => [n.id, n.title]));
  const attachmentRanking: AttachmentUsage[] = blobRows.map((blob) => {
    const ownerIds = [...(owners.get(blob.id) ?? [])];
    return {
      id: blob.id,
      mime: blob.mime,
      size: blobSize(blob),
      metadataBytes: blobMetaBytes(blob),
      createdAt: blob.createdAt,
      ownerIds,
      ownerTitles: ownerIds.map((id) => titleById.get(id) ?? id),
      shared: ownerIds.length > 1,
      orphan: ownerIds.length === 0,
    };
  });
  attachmentRanking.sort((a, b) => b.size - a.size);

  const noteBytes = noteRows.reduce((sum, note) => sum + jsonBytes(note), 0);
  const folderBytes = folderRows.reduce((sum, folder) => sum + jsonBytes(folder), 0);
  const blobBytes = blobRows.reduce((sum, blob) => sum + blobSize(blob) + blobMetaBytes(blob), 0);
  const metaBytes = metaRows.reduce((sum, record) => sum + jsonBytes(record), 0);
  const binaryBytes = blobRows.reduce((sum, blob) => sum + blobSize(blob), 0);
  const orphanBytes = attachmentRanking
    .filter((a) => a.orphan)
    .reduce((sum, a) => sum + a.size, 0);

  return {
    capturedAt: Date.now(),
    noteCount: noteRows.length,
    folderCount: folderRows.length,
    attachmentCount: blobRows.length,
    stores: {
      notes: { count: noteRows.length, bytes: noteBytes },
      folders: { count: folderRows.length, bytes: folderBytes },
      blobs: { count: blobRows.length, bytes: blobBytes },
      meta: { count: metaRows.length, bytes: metaBytes },
    },
    appBytes: noteBytes + folderBytes + blobBytes + metaBytes,
    binaryBytes,
    orphanBytes,
    noteRanking,
    attachmentRanking,
    quota: await getQuotaInfo(),
  };
}

/** 浏览器整站用量/配额；不可用时 supported=false（不抛错）。 */
export async function getQuotaInfo(): Promise<QuotaInfo> {
  const unsupported: QuotaInfo = {
    supported: false,
    usage: null,
    quota: null,
    available: null,
    persisted: false,
    indexedDbUsage: null,
  };
  const storage = typeof navigator !== "undefined" ? navigator.storage : undefined;
  if (!storage?.estimate) return unsupported;

  try {
    const [estimate, persisted] = await Promise.all([
      storage.estimate(),
      typeof storage.persisted === "function" ? storage.persisted() : Promise.resolve(false),
    ]);
    const quota = Number.isFinite(estimate.quota) && (estimate.quota ?? 0) > 0 ? estimate.quota! : null;
    const usage = Number.isFinite(estimate.usage) ? estimate.usage! : null;
    const usageDetails = (
      estimate as StorageEstimate & { usageDetails?: { indexedDB?: number } }
    ).usageDetails;
    return {
      supported: quota !== null,
      usage,
      quota,
      available: quota !== null && usage !== null ? Math.max(0, quota - usage) : null,
      persisted,
      indexedDbUsage: usageDetails?.indexedDB ?? null,
    };
  } catch {
    return unsupported;
  }
}

/** 申请持久化存储；浏览器可能静默拒绝，只返回最终状态。 */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
