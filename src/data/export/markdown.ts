/**
 * Markdown 导出预处理：把导出副本里的图片转成图床外链，避免 .md 体积失控。
 *
 * - 本地附件 `clawclip://blob/<id>`：图片上传 img.scdn.io，复用 `remoteUrl` 缓存；
 * - 历史导入遗留的内联 `data:image/...`：解码后上传，替换为外链；
 * - 非图片附件、已有外链保持原样；
 * - 上传失败保留原引用（本地图或内联 base64），由调用方提示用户。
 *
 * 只处理导出副本，不改笔记正文；上传成功的外链写回 BlobRecord.remoteUrl。
 */
import { BLOB_URL_SCHEME, extractBlobRefIds, getBlob } from "@/data/blobStore";
import { extractDataImageUrls, messageOf } from "@/data/imageAssets";
import { isImageMime } from "@/data/imageHost";
import { uploadBlobRecord, uploadDataImage } from "@/data/imageUpload";
import type { BlobRecord } from "@/types/blob";
import { SpeedMeter } from "@/utils/speed";

export { extractDataImageUrls };

export interface MarkdownExportProgress {
  done: number;
  total: number;
  detail: string;
}

export interface MarkdownExportStats {
  /** 参与处理的图片总数（本地引用 + 内联 data URL） */
  total: number;
  /** 本次新上传到图床的图片数 */
  uploaded: number;
  /** 复用 remoteUrl 缓存、未重复上传的本地图片数 */
  reused: number;
  /** 上传失败、保留原引用的图片数 */
  failed: number;
  errors: string[];
}

export interface MarkdownExportOptions {
  onProgress?: (progress: MarkdownExportProgress) => void;
  onSpeed?: (bytesPerSecond: number) => void;
}

export interface MarkdownExportResult {
  content: string;
  stats: MarkdownExportStats;
}

const MAX_ERRORS = 20;

/**
 * 图片候选数：用于导出前申请阻塞式进度浮层。
 * 本地附件里可能混有非图片，实际总数以 prepareMarkdownExport 的 onProgress 为准。
 */
export function countMarkdownImageCandidates(content: string): number {
  return new Set(extractBlobRefIds(content)).size + extractDataImageUrls(content).length;
}

export async function prepareMarkdownExport(
  content: string,
  { onProgress, onSpeed }: MarkdownExportOptions = {},
): Promise<MarkdownExportResult> {
  const stats: MarkdownExportStats = {
    total: 0,
    uploaded: 0,
    reused: 0,
    failed: 0,
    errors: [],
  };
  const replacements = new Map<string, string>();
  const meter = new SpeedMeter();

  const records = await Promise.all(
    [...new Set(extractBlobRefIds(content))].map(async (id) => ({ id, record: await getBlob(id) })),
  );
  const localImages = records.filter(
    (item): item is { id: string; record: BlobRecord } =>
      item.record !== undefined && isImageMime(item.record.mime),
  );
  const dataImages = extractDataImageUrls(content);
  stats.total = localImages.length + dataImages.length;

  let done = 0;
  const report = (detail: string) => {
    onProgress?.({ done, total: stats.total, detail });
  };

  for (const { id, record } of localImages) {
    report(record.mime || "image");
    if (record.remoteUrl) {
      replacements.set(`${BLOB_URL_SCHEME}${id}`, record.remoteUrl);
      stats.reused += 1;
    } else {
      try {
        let loaded = 0;
        const url = await uploadBlobRecord(record, {
          onProgress: (nextLoaded) => {
            onSpeed?.(meter.add(Math.max(0, nextLoaded - loaded)));
            loaded = nextLoaded;
          },
        });
        replacements.set(`${BLOB_URL_SCHEME}${id}`, url);
        stats.uploaded += 1;
      } catch (error) {
        stats.failed += 1;
        if (stats.errors.length < MAX_ERRORS) {
          stats.errors.push(`上传失败（${record.mime}）：${messageOf(error)}`);
        }
      }
    }
    done += 1;
  }

  for (const dataUrl of dataImages) {
    report("内联图片");
    try {
      let loaded = 0;
      const url = await uploadDataImage(dataUrl, {
        onProgress: (nextLoaded) => {
          onSpeed?.(meter.add(Math.max(0, nextLoaded - loaded)));
          loaded = nextLoaded;
        },
      });
      replacements.set(dataUrl, url);
      stats.uploaded += 1;
    } catch (error) {
      stats.failed += 1;
      if (stats.errors.length < MAX_ERRORS) {
        stats.errors.push(`上传失败（内联图片）：${messageOf(error)}`);
      }
    }
    done += 1;
  }

  let result = content;
  for (const [from, to] of replacements) result = result.split(from).join(to);
  onProgress?.({ done: stats.total, total: stats.total, detail: "完成" });
  return { content: result, stats };
}
