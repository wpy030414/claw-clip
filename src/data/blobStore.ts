/**
 * 附件 blob 存取 + 引用计数 + object URL 生命周期管理（方案 §5.4）。
 *
 * 正文里用自定义协议 `clawclip://blob/<id>` 持久引用附件（object URL 是
 * 运行时产物、刷新即失效，不能写进 Markdown）；渲染前经 `hydrateMarkdown()`
 * 批量换成 object URL，`urlCache` 去重复用，切笔记/卸载时 `releaseBlobUrls()`
 * 统一 revoke 防泄漏。
 *
 * ★ 引用计数（refCount）：
 * - 每个 blob 的 `refCount` = 正文中引用它的**笔记数**（同一笔记内多次引用只算 1）。
 * - 引用关系以笔记正文为准，保存笔记时反填 `Note.attachmentIds`；`upsertNote` /
 *   `deleteNote` 在**同一事务**里增减计数。
 * - 计数归零的 blob 立即删除，并 revoke 其缓存 object URL——无笔记引用的附件
 *   不会在 IndexedDB 里越积越多。
 * - 启动与导入备份后执行 `reconcileBlobRefs()` 全量校准：按正文重算计数、
 *   修复陈旧 `attachmentIds`、回收历史孤儿（含旧版本遗留的无 refCount 记录）。
 */
import { globalConfig } from "@/config";
import type { BlobRecord } from "@/types/blob";
import type { Note } from "@/types/note";
import { newId } from "@/utils/id";
import { idbReq } from "@/utils/idb";
import { withTx } from "./db";

/** 正文附件引用协议前缀（供编辑器 upload.handler 等别处拼接引用） */
export const BLOB_URL_SCHEME = "clawclip://blob/";

/** 匹配正文中所有 clawclip://blob/<id> 引用（id 为 UUID/降级 id：字母数字-_） */
const BLOB_REF_RE = /clawclip:\/\/blob\/([\w-]+)/g;

/** 提取正文引用的 blob id（去重，同一附件多处引用只算一个）。 */
export function extractBlobRefIds(content: string): string[] {
  const ids = new Set<string>();
  for (const m of content.matchAll(BLOB_REF_RE)) ids.add(m[1]);
  return [...ids];
}

/** object URL 缓存：blobId → objectURL。同一附件多处引用只建一次 URL。 */
const urlCache = new Map<string, string>();
/** 反向映射：objectURL → blobId。dehydrate（渲染态→存储态）用。 */
const urlToId = new Map<string, string>();

const blobStoreName = globalConfig.storeNames.blobs;
const notesStoreName = globalConfig.storeNames.notes;

/** 回收某个 blob 的缓存 object URL（删除 blob 时调用，防泄漏）。 */
function revokeBlobUrl(id: string): void {
  const url = urlCache.get(id);
  if (url === undefined) return;
  URL.revokeObjectURL(url);
  urlCache.delete(id);
  urlToId.delete(url);
}

/** 保存附件二进制，返回 blob id（正文用 `BLOB_URL_SCHEME + id` 引用）。 */
export async function saveBlob(
  noteId: string,
  file: Blob,
  options: { sourceUrl?: string } = {},
): Promise<string> {
  const id = newId();
  const record: BlobRecord = {
    id,
    noteId,
    mime: file.type || "application/octet-stream",
    size: file.size,
    data: file,
    createdAt: Date.now(),
    // 此刻正文还没保存；笔记落库时 upsertNote 会把它加到 1。
    refCount: 0,
    ...(options.sourceUrl ? { sourceUrl: options.sourceUrl } : {}),
  };
  await withTx(blobStoreName, "readwrite", (tx) =>
    idbReq(tx.objectStore(blobStoreName).put(record)),
  );
  return id;
}

/** 按 id 取附件记录（含 Blob 本体）。 */
export async function getBlob(id: string): Promise<BlobRecord | undefined> {
  return withTx<BlobRecord | undefined>(blobStoreName, "readonly", (tx) =>
    idbReq<BlobRecord | undefined>(tx.objectStore(blobStoreName).get(id)),
  );
}

/** 记录附件已上传到图床的外链（云快照组装时复用，避免重复上传）。 */
export async function setBlobRemoteUrl(id: string, url: string): Promise<void> {
  await withTx(blobStoreName, "readwrite", async (tx) => {
    const store = tx.objectStore(blobStoreName);
    const record = await idbReq<BlobRecord | undefined>(store.get(id));
    if (!record) return;
    store.put({ ...record, remoteUrl: url, remoteUploadedAt: Date.now() });
  });
}

/**
 * 解析附件为可渲染的 object URL。
 *
 * 命中缓存直接复用；blob 不存在（悬空引用）返回空串，由调用方决定降级表现。
 * 同时登记反向映射 url→id，供 dehydrateMarkdown 反解。
 */
export async function resolveBlobUrl(id: string): Promise<string> {
  const cached = urlCache.get(id);
  if (cached !== undefined) return cached;
  const record = await getBlob(id);
  if (!record) return "";
  const url = URL.createObjectURL(record.data);
  urlCache.set(id, url);
  urlToId.set(url, id); // ★ 登记反向映射
  return url;
}

/**
 * 把 Markdown 正文里所有 `clawclip://blob/<id>` 批量替换成运行时 object URL。
 *
 * 引用 id 去重后并行解析；悬空引用（blob 已不存在）替换为空串。
 */
export async function hydrateMarkdown(md: string): Promise<string> {
  const ids = new Set<string>();
  for (const m of md.matchAll(BLOB_REF_RE)) ids.add(m[1]);
  if (ids.size === 0) return md;
  const entries = await Promise.all(
    [...ids].map(async (id) => [id, await resolveBlobUrl(id)] as const),
  );
  const urlMap = new Map(entries);
  return md.replace(BLOB_REF_RE, (_full, id: string) => urlMap.get(id) ?? "");
}

/**
 * dehydrate：把渲染态 content 里的 object URL 反解回 clawclip://blob/<id>（存储态）。
 *
 * 保存落库前必须调用——object URL 是运行时产物（blob:mock/... 或 blob:http://...），
 * 刷新即失效，绝不能写进 IndexedDB。用 urlToId 反向映射还原为可持久化的协议引用。
 * 未知的 blob: URL（无映射）原样保留，避免误伤正文里的其它 blob 引用。
 */
export function dehydrateMarkdown(md: string): string {
  return md.replace(/blob:[^\s)"']+/g, (url) => {
    const id = urlToId.get(url);
    return id ? `${BLOB_URL_SCHEME}${id}` : url;
  });
}

/** revoke 全部缓存的 object URL 并清空双向映射（切笔记/组件卸载时调用，防泄漏）。 */
export function releaseBlobUrls(): void {
  for (const url of urlCache.values()) URL.revokeObjectURL(url);
  urlCache.clear();
  urlToId.clear();
}

/**
 * 在调用方事务内增减若干 blob 的引用计数。
 *
 * `delta=+1` 用于笔记新增引用，`delta=-1` 用于撤销引用；计数降到 0 的 blob
 * 直接删除。必须在 `readwrite` 事务中、且事务包含 blobs store 时调用。
 * 不存在的 id（悬空引用）静默跳过。
 */
export async function adjustBlobRefs(
  tx: IDBTransaction,
  ids: Iterable<string>,
  delta: 1 | -1,
): Promise<void> {
  const store = tx.objectStore(blobStoreName);
  for (const id of new Set(ids)) {
    const rec = await idbReq<BlobRecord | undefined>(store.get(id));
    if (!rec) continue;
    const next = (rec.refCount ?? 0) + delta;
    if (next <= 0) {
      store.delete(id);
      revokeBlobUrl(id);
    } else {
      store.put({ ...rec, refCount: next });
    }
  }
}

/** 判断两组 id 是否等价（reconcile 修复陈旧 attachmentIds 用）。 */
function sameIds(a: string[] | undefined, b: string[]): boolean {
  const left = new Set(a ?? []);
  if (left.size !== b.length) return false;
  return b.every((id) => left.has(id));
}

/**
 * 全库校准附件引用：以**笔记正文**为唯一真相源。
 *
 * 1. 重算每个 blob 的 refCount（同一笔记内多处引用只算 1）；
 * 2. 修复笔记里陈旧的 `attachmentIds`（例如历史版本/导入数据）；
 * 3. 删除没有任何笔记引用的 blob（历史孤儿、旧版无 refCount 记录、崩溃残留）。
 *
 * 启动与导入备份后调用；全程单事务，避免与并发编辑交错。
 */
export async function reconcileBlobRefs(): Promise<{ kept: number; purged: number }> {
  return withTx([notesStoreName, blobStoreName], "readwrite", async (tx) => {
    const notesTx = tx.objectStore(notesStoreName);
    const blobsTx = tx.objectStore(blobStoreName);

    const notes = await idbReq<Note[]>(notesTx.getAll() as IDBRequest<Note[]>);
    const counts = new Map<string, number>();
    for (const note of notes) {
      const ids = extractBlobRefIds(note.content);
      for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
      if (!sameIds(note.attachmentIds, ids)) {
        notesTx.put({ ...note, attachmentIds: ids });
      }
    }

    const blobs = await idbReq<BlobRecord[]>(blobsTx.getAll() as IDBRequest<BlobRecord[]>);
    let kept = 0;
    let purged = 0;
    for (const rec of blobs) {
      const count = counts.get(rec.id) ?? 0;
      if (count === 0) {
        blobsTx.delete(rec.id);
        revokeBlobUrl(rec.id);
        purged += 1;
      } else {
        kept += 1;
        if ((rec.refCount ?? -1) !== count) {
          blobsTx.put({ ...rec, refCount: count });
        }
      }
    }
    return { kept, purged };
  });
}
