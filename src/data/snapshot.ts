/**
 * 云快照组装：把本库打包成适合放进 GitHub Gist 的单文件快照。
 *
 * 策略（用户确认）：
 * - **图片一律转图床**：本地图片先上传到 img.scdn.io，快照里的
 *   `clawclip://blob/<id>` 换成外链；本地笔记与附件保持不动（只转快照）。
 * - **过大的非图片附件只保留本地引用**：快照超过 10MB 时，从最大的非图片附件
 *   开始剔除二进制，正文里的 `clawclip://` 引用保留。
 * - 图床上传失败的图片回退为内嵌 base64；若因此仍超限，再按体积剔除，
 *   确保推送不被 GitHub 的大小限制挡住。
 *
 * 上传结果记入 `BlobRecord.remoteUrl`，后续推送直接复用，不重复上传。
 */
import { globalConfig } from "@/config";
import type { BackupBlob, BackupPayload } from "@/types/backup";
import type { BlobRecord } from "@/types/blob";
import { extractBlobRefIds, BLOB_URL_SCHEME, setBlobRemoteUrl } from "./blobStore";
import { base64ToBlob } from "./backup";
import { CloudSyncError, GIST_READ_LIMIT, serializeSnapshot } from "./cloudSync";
import { datasource } from "./datasource";
import { getAllOf } from "./db";
import { isImageMime, uploadToScdn } from "./imageHost";

export interface SnapshotProgress {
  phase: "images" | "packing";
  done: number;
  total: number;
}

export interface SnapshotStats {
  notes: number;
  folders: number;
  /** 本次新上传到图床的图片数 */
  imagesUploaded: number;
  /** 复用 remoteUrl 缓存、未重复上传的图片数 */
  imagesReused: number;
  /** 上传失败、回退为 base64 的图片数 */
  imagesFailed: number;
  /** 快照最终包含的附件（二进制）数 */
  attachmentsIncluded: number;
  /** 因超限被剔除二进制的附件数 */
  attachmentsOmitted: number;
  /** 被剔除的附件二进制字节数 */
  omittedBytes: number;
  /** 快照文本字节数 */
  bytes: number;
}

export interface BuildSnapshotOptions {
  onProgress?: (progress: SnapshotProgress) => void;
  signal?: AbortSignal;
  /** 快照大小上限（默认 GIST_READ_LIMIT）；单元测试可传入更小的值。 */
  limit?: number;
}

const REF_RE = /clawclip:\/\/blob\/([\w-]+)/g;

function extensionFor(mime: string): string {
  const subtype = mime.split("/")[1]?.split(";")[0]?.trim() ?? "";
  if (subtype === "jpeg") return "jpg";
  if (subtype === "svg+xml") return "svg";
  return subtype || "bin";
}

function replaceRefs(content: string, urls: Map<string, string>): string {
  if (urls.size === 0) return content;
  return content.replace(REF_RE, (match, id: string) => urls.get(id) ?? match);
}

/**
 * 组装云快照。返回的 `content` 可直接交给 pushSnapshot。
 */
export async function buildCloudSnapshot({
  onProgress,
  signal,
  limit = GIST_READ_LIMIT,
}: BuildSnapshotOptions = {}): Promise<{ content: string; stats: SnapshotStats }> {
  const payload = await datasource.exportAll();
  const stats: SnapshotStats = {
    notes: payload.notes.length,
    folders: payload.folders?.length ?? 0,
    imagesUploaded: 0,
    imagesReused: 0,
    imagesFailed: 0,
    attachmentsIncluded: 0,
    attachmentsOmitted: 0,
    omittedBytes: 0,
    bytes: 0,
  };

  // 正文实际引用的附件（attachmentIds 可能陈旧，不作为真相源）
  const referenced = new Set<string>();
  for (const note of payload.notes) {
    for (const id of extractBlobRefIds(note.content)) referenced.add(id);
  }

  // 只打包被正文引用的附件（启动校准前可能残留孤儿，不把它们同步出去）
  const candidates = payload.blobs.filter((blob) => referenced.has(blob.id));

  // remoteUrl 缓存（避免重复上传同一张图）
  const records = await getAllOf<BlobRecord>(globalConfig.storeNames.blobs);
  const recordById = new Map(records.map((record) => [record.id, record]));

  const images = candidates.filter((blob) => isImageMime(blob.mime));
  const remoteUrls = new Map<string, string>();

  let done = 0;
  for (const blob of images) {
    if (signal?.aborted) throw new CloudSyncError("network", "已取消");
    const cached = recordById.get(blob.id)?.remoteUrl;
    if (cached) {
      remoteUrls.set(blob.id, cached);
      stats.imagesReused += 1;
    } else {
      try {
        const file = new File(
          [base64ToBlob(blob.base64, blob.mime)],
          `image-${blob.id}.${extensionFor(blob.mime)}`,
          {
            type: blob.mime,
          },
        );
        const url = await uploadToScdn(file, { signal });
        remoteUrls.set(blob.id, url);
        stats.imagesUploaded += 1;
        await setBlobRemoteUrl(blob.id, url);
      } catch {
        if (signal?.aborted) throw new CloudSyncError("network", "已取消");
        stats.imagesFailed += 1;
      }
    }
    done += 1;
    onProgress?.({ phase: "images", done, total: images.length });
  }

  const notes = payload.notes.map((note) =>
    remoteUrls.size > 0 ? { ...note, content: replaceRefs(note.content, remoteUrls) } : note,
  );

  // 已转外链的图片不再打包；上传失败的回退为 base64 保留在快照里
  let blobs: BackupBlob[] = candidates.filter((blob) => !remoteUrls.has(blob.id));

  const pack = (list: BackupBlob[]) =>
    serializeSnapshot({ ...payload, notes, blobs: list } as BackupPayload);
  let content = pack(blobs);

  /** 从大到小剔除符合条件的附件二进制，直到快照回到上限以内。 */
  const dropUntilFits = (predicate: (blob: BackupBlob) => boolean) => {
    const victims = blobs.filter(predicate).sort((a, b) => b.size - a.size);
    for (const victim of victims) {
      if (new TextEncoder().encode(content).byteLength <= limit) return;
      blobs = blobs.filter((blob) => blob.id !== victim.id);
      stats.attachmentsOmitted += 1;
      stats.omittedBytes += victim.size;
      content = pack(blobs);
    }
  };

  // 先剔除过大的非图片附件（正文保留 clawclip:// 引用），再兜底剔除失败的图片
  dropUntilFits((blob) => !isImageMime(blob.mime));
  dropUntilFits(() => true);

  stats.bytes = new TextEncoder().encode(content).byteLength;
  if (stats.bytes > limit) {
    throw new CloudSyncError(
      "too_large",
      "仅笔记正文已超过 10MB，无法通过 Gist 同步；请改用本地备份",
    );
  }

  stats.attachmentsIncluded = blobs.length;
  onProgress?.({ phase: "packing", done: 1, total: 1 });
  return { content, stats };
}

/** 供 UI 展示：把 `clawclip://blob/<id>` 还原成可读的本地引用说明。 */
export function describeLocalRef(id: string): string {
  return `${BLOB_URL_SCHEME}${id}`;
}
