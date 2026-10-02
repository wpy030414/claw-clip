/**
 * 附件 blob 存取 + object URL 生命周期管理（方案 §5.4）。
 *
 * 正文里用自定义协议 `clawclip://blob/<id>` 持久引用附件（object URL 是
 * 运行时产物、刷新即失效，不能写进 Markdown）；渲染前经 `hydrateMarkdown()`
 * 批量换成 object URL，`urlCache` 去重复用，切笔记/卸载时 `releaseBlobUrls()`
 * 统一 revoke 防泄漏。
 */
import { globalConfig } from "@/config";
import type { BlobRecord } from "@/types/blob";
import { newId } from "@/utils/id";
import { idbReq } from "@/utils/idb";
import { withTx } from "./db";

/** 正文附件引用协议前缀（供编辑器 upload.handler 等别处拼接引用） */
export const BLOB_URL_SCHEME = "clawclip://blob/";

/** 匹配正文中所有 clawclip://blob/<id> 引用（id 为 UUID/降级 id：字母数字-_） */
const BLOB_REF_RE = /clawclip:\/\/blob\/([\w-]+)/g;

/** object URL 缓存：blobId → objectURL。同一附件多处引用只建一次 URL。 */
const urlCache = new Map<string, string>();
/** 反向映射：objectURL → blobId。dehydrate（渲染态→存储态）用。 */
const urlToId = new Map<string, string>();

const blobStoreName = globalConfig.storeNames.blobs;

/** 保存附件二进制，返回 blob id（正文用 `BLOB_URL_SCHEME + id` 引用）。 */
export async function saveBlob(noteId: string, file: Blob): Promise<string> {
  const id = newId();
  const record: BlobRecord = {
    id,
    noteId,
    mime: file.type || "application/octet-stream",
    size: file.size,
    data: file,
    createdAt: Date.now(),
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

/** 按 noteId 索引级联删除某笔记的全部附件（并顺手 revoke 对应 object URL）。 */
export async function deleteBlobsOfNote(noteId: string): Promise<void> {
  await withTx(blobStoreName, "readwrite", async (tx) => {
    const store = tx.objectStore(blobStoreName);
    const keys = await idbReq(store.index("noteId").getAllKeys(noteId));
    for (const key of keys) {
      const id = String(key);
      store.delete(id);
      const url = urlCache.get(id);
      if (url !== undefined) {
        URL.revokeObjectURL(url);
        urlCache.delete(id);
      }
    }
  });
}
