/**
 * 图床批量迁移：本地图片 ↔ 外链图片，并更新正文引用。
 *
 * 事务语义（重要）：
 * - 单张图片的每一步都可重入：上传 → 写笔记（引用计数与笔记更新在同一 IDB 事务）；
 *   下载 → 写 blob → 写笔记。任何一步失败都不会留下悬空引用。
 * - 整批不是原子的（远端上传/下载无法回滚），但**逐张一致**：中途刷新后重新执行，
 *   已迁移的图片不会重复处理（上传复用 `remoteUrl`，下载复用 `sourceUrl`），
 *   未迁移的保持原样。
 * - 因此 UI 用阻塞式进度浮层 + beforeunload 提醒，但真正兜底的是这里的幂等设计。
 */
import { globalConfig } from "@/config";
import type { BlobRecord } from "@/types/blob";
import type { Note } from "@/types/note";
import { BLOB_URL_SCHEME, extractBlobRefIds, saveBlob, setBlobRemoteUrl } from "./blobStore";
import { datasource } from "./datasource";
import { getAllOf } from "./db";
import { isImageMime, uploadToScdn } from "./imageHost";
import { SpeedMeter } from "@/utils/speed";

export interface MigrationProgress {
  done: number;
  total: number;
  /** 当前处理的图片说明（MIME / 域名） */
  detail: string;
}

export interface MigrationResult {
  /** 成功迁移的图片数 */
  migrated: number;
  /** 失败数（图片保持原状） */
  failed: number;
  /** 处理过程中收集的错误（最多保留 20 条） */
  errors: string[];
}

export interface MigrationOptions {
  onProgress?: (progress: MigrationProgress) => void;
  /** 当前估算网络速度（字节/秒），供阻塞式进度浮层显示 */
  onSpeed?: (bytesPerSecond: number) => void;
}

const MAX_ERRORS = 20;

function pushError(result: MigrationResult, message: string): void {
  result.failed += 1;
  if (result.errors.length < MAX_ERRORS) result.errors.push(message);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 正文中的外链图片 URL（Markdown 内联图片 + HTML img），去重。 */
export function extractExternalImageUrls(content: string): string[] {
  const urls = new Set<string>();
  const markdown = /!\[[^\]]*\]\(\s*(https?:\/\/[^\s)]+)(?:\s+["'][^"']*["'])?\s*\)/gi;
  const html = /<img\b[^>]*\bsrc\s*=\s*(["'])(https?:\/\/[^"'\s]+)\1[^>]*>/gi;
  for (const match of content.matchAll(markdown)) urls.add(match[1]);
  for (const match of content.matchAll(html)) urls.add(match[2]);
  return [...urls];
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  tif: "image/tiff",
  tiff: "image/tiff",
};

function guessMimeFromUrl(url: string): string {
  const path = url.split(/[?#]/)[0] ?? "";
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

function replaceAll(content: string, from: string, to: string): string {
  return content.split(from).join(to);
}

/** 流式读取响应体并上报增量字节；环境不支持流时退回 res.blob()。 */
async function readWithProgress(res: Response, onBytes: (bytes: number) => void): Promise<Blob> {
  if (!res.body) return res.blob();
  const reader = res.body.getReader();
  const chunks: BlobPart[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value as unknown as BlobPart);
    onBytes(value.byteLength);
  }
  const type = (res.headers.get("content-type") ?? "").split(";")[0]?.trim() || "";
  return new Blob(chunks, { type });
}

interface NoteDraft {
  note: Note;
  content: string;
}

/**
 * 把所有**被正文引用的本地图片**上传到图床，并把引用替换为外链。
 * 上传成功且所有引用都更新后，本地 blob 会因引用计数归零被自动回收。
 */
export async function migrateLocalImagesToHost(
  options: MigrationOptions = {},
): Promise<MigrationResult> {
  const notes = await getAllOf<Note>(globalConfig.storeNames.notes);
  const blobs = await getAllOf<BlobRecord>(globalConfig.storeNames.blobs);
  const result: MigrationResult = { migrated: 0, failed: 0, errors: [] };

  const drafts = new Map<string, NoteDraft>(
    notes.map((note) => [note.id, { note, content: note.content }]),
  );
  const notesByBlob = new Map<string, Set<string>>();
  for (const note of notes) {
    for (const id of extractBlobRefIds(note.content)) {
      const set = notesByBlob.get(id) ?? new Set<string>();
      set.add(note.id);
      notesByBlob.set(id, set);
    }
  }

  const blobsById = new Map(blobs.map((blob) => [blob.id, blob]));
  const targets = [...notesByBlob.keys()]
    .map((id) => blobsById.get(id))
    .filter((blob): blob is BlobRecord => Boolean(blob) && isImageMime(blob!.mime));

  let done = 0;
  const meter = new SpeedMeter();
  for (const blob of targets) {
    options.onProgress?.({
      done,
      total: targets.length,
      detail: blob.mime || "image",
    });

    let url = blob.remoteUrl;
    try {
      if (!url) {
        const file = new File([blob.data], `image-${blob.id}`, { type: blob.mime });
        let loaded = 0;
        url = await uploadToScdn(file, {
          onProgress: (nextLoaded) => {
            const speed = meter.add(Math.max(0, nextLoaded - loaded));
            loaded = nextLoaded;
            options.onSpeed?.(speed);
          },
        });
        await setBlobRemoteUrl(blob.id, url);
      }
    } catch (error) {
      pushError(result, `上传失败（${blob.mime}）：${messageOf(error)}`);
      done += 1;
      continue;
    }

    try {
      for (const noteId of notesByBlob.get(blob.id) ?? []) {
        const draft = drafts.get(noteId);
        if (!draft) continue;
        const next = replaceAll(draft.content, `${BLOB_URL_SCHEME}${blob.id}`, url);
        if (next === draft.content) continue;
        const updated: Note = {
          ...draft.note,
          content: next,
          attachmentIds: extractBlobRefIds(next),
        };
        await datasource.upsertNote(updated);
        draft.note = updated;
        draft.content = next;
      }
      result.migrated += 1;
    } catch (error) {
      pushError(result, `更新引用失败（${blob.mime}）：${messageOf(error)}`);
    }
    done += 1;
  }

  options.onProgress?.({ done: targets.length, total: targets.length, detail: "完成" });
  return result;
}

/**
 * 把所有正文里的外链图片下载到本地，并把 URL 替换为 `clawclip://blob/<id>`。
 * 远端图片不会被删除（也没有删除权限）；同名 URL 在多条笔记间共享同一个 blob。
 */
export async function migrateHostImagesToLocal(
  options: MigrationOptions = {},
): Promise<MigrationResult> {
  const notes = await getAllOf<Note>(globalConfig.storeNames.notes);
  const blobs = await getAllOf<BlobRecord>(globalConfig.storeNames.blobs);
  const result: MigrationResult = { migrated: 0, failed: 0, errors: [] };

  const drafts = new Map<string, NoteDraft>(
    notes.map((note) => [note.id, { note, content: note.content }]),
  );
  const notesByUrl = new Map<string, Set<string>>();
  for (const note of notes) {
    for (const url of extractExternalImageUrls(note.content)) {
      const set = notesByUrl.get(url) ?? new Set<string>();
      set.add(note.id);
      notesByUrl.set(url, set);
    }
  }

  // 已下载过的同一 URL 直接复用，避免刷新后续跑时重复下载
  const bySource = new Map<string, string>(
    blobs.filter((b) => b.sourceUrl).map((b) => [b.sourceUrl!, b.id]),
  );

  let done = 0;
  const meter = new SpeedMeter();
  for (const [url, noteIds] of notesByUrl) {
    let host = url;
    try {
      host = new URL(url).hostname;
    } catch {
      /* 保留原始 URL 作为说明 */
    }
    options.onProgress?.({ done, total: notesByUrl.size, detail: host });

    try {
      let blobId = bySource.get(url);
      if (!blobId) {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const raw = await readWithProgress(res, (bytes) => {
          options.onSpeed?.(meter.add(bytes));
        });
        const mime =
          raw.type && raw.type !== "application/octet-stream" ? raw.type : guessMimeFromUrl(url);
        const blob = raw.type === mime ? raw : new Blob([await raw.arrayBuffer()], { type: mime });
        const firstNoteId = [...noteIds][0] ?? "";
        blobId = await saveBlob(firstNoteId, blob, { sourceUrl: url });
        bySource.set(url, blobId);
      }

      for (const noteId of noteIds) {
        const draft = drafts.get(noteId);
        if (!draft) continue;
        const next = replaceAll(draft.content, url, `${BLOB_URL_SCHEME}${blobId}`);
        if (next === draft.content) continue;
        const updated: Note = {
          ...draft.note,
          content: next,
          attachmentIds: extractBlobRefIds(next),
        };
        await datasource.upsertNote(updated);
        draft.note = updated;
        draft.content = next;
      }
      result.migrated += 1;
    } catch (error) {
      pushError(result, `下载失败（${host}）：${messageOf(error)}`);
    }
    done += 1;
  }

  options.onProgress?.({ done: notesByUrl.size, total: notesByUrl.size, detail: "完成" });
  return result;
}
