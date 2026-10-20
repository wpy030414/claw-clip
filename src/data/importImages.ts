/**
 * 导入图片落盘：把导入文档“自带”的图片按用户设置存入 IDB 或上传图床。
 *
 * 处理范围（用户约定）：
 * - `data:image/...` 内联图片：一定处理；
 * - 本地图片（`clawclip://`、`blob:`、`file:`、相对/绝对路径）：尝试读取，
 *   失败时保留原引用；
 * - 其它图床/站点的外链（http/https）：不处理，原样保留。
 *
 * 只修改导入副本的正文；本地 blob 在笔记保存后由引用计数接管，
 * 导入失败时由调用方删除笔记并校准回收。
 */
import type { ImageHostKind } from "@/types/integration";
import { getBlob } from "./blobStore";
import {
  dataUrlToBlob,
  extensionForMime,
  extractImageSources,
  guessImageMime,
  messageOf,
  replaceAll,
  type ImageSource,
} from "./imageAssets";
import { isImageMime, resolveUploadTarget, type UploadTarget } from "./imageHost";
import { uploadBlobRecord } from "./imageUpload";
import { SpeedMeter } from "@/utils/speed";

export interface ImportImageProgress {
  done: number;
  total: number;
  detail: string;
}

export interface ImportImageStats {
  /** 参与处理的图片数（不含外部图床链接） */
  total: number;
  /** 本次新存进 IndexedDB 的图片数（含上传失败后的本地回退） */
  local: number;
  /** 本次新上传到图床的图片数 */
  remote: number;
  /** 复用已有 remoteUrl、未重复上传的图片数 */
  reused: number;
  /** 原本就是本地/外链、无需改动的图片数 */
  kept: number;
  /** 上传失败后回退本地、但已成功导入的图片数 */
  fallbacks: number;
  /** 无法读取或解析、保留原引用的图片数 */
  failed: number;
  errors: string[];
}

export interface ImportImageOptions {
  noteId: string;
  host: ImageHostKind;
  onProgress?: (progress: ImportImageProgress) => void;
  onSpeed?: (bytesPerSecond: number) => void;
  /** 每成功上传一张图片时回调（用于累计图床统计） */
  onRemoteUpload?: (bytes: number) => void;
}

export interface ImportImagesResult {
  content: string;
  stats: ImportImageStats;
}

const MAX_ERRORS = 20;
const FETCH_TIMEOUT_MS = 15_000;

function reportError(stats: ImportImageStats, message: string): void {
  if (stats.errors.length < MAX_ERRORS) stats.errors.push(message);
}

function detailOf(source: ImageSource): string {
  if (source.kind === "data") return "内联图片";
  if (source.kind === "clawclip") return "本地图片";
  try {
    return new URL(source.url).hostname || "本地图片";
  } catch {
    return "本地图片";
  }
}

/** 读取导入正文里的本地图片（blob:/file:/相对路径），失败返回 null。 */
async function fetchLocalImage(url: string): Promise<Blob> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.blob();
    const mime =
      raw.type && raw.type !== "application/octet-stream" ? raw.type : guessImageMime(url);
    if (!isImageMime(mime)) throw new Error("不是图片");
    return raw.type === mime ? raw : new Blob([await raw.arrayBuffer()], { type: mime });
  } catch (error) {
    if ((error as Error | undefined)?.name === "AbortError") throw new Error("读取超时");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/** 按当前图床设置处理一个内存中的图片（DOCX 内嵌图片用）。 */
export async function resolveImportedImage(
  blob: Blob,
  noteId: string,
  host: ImageHostKind,
  onProgress?: (loaded: number, total: number) => void,
): Promise<UploadTarget> {
  const mime = blob.type || "application/octet-stream";
  const file = new File([blob], `import-image.${extensionForMime(mime)}`, { type: mime });
  return resolveUploadTarget(file, noteId, host, { onProgress });
}

/**
 * 处理正文里的图片引用：内联 base64 一定处理；本地图片尽力读取；
 * 外部图床链接保持原样。返回改写后的导入副本。
 */
export async function persistImportedImages(
  content: string,
  { noteId, host, onProgress, onSpeed, onRemoteUpload }: ImportImageOptions,
): Promise<ImportImagesResult> {
  const sources = extractImageSources(content);
  const candidates = sources.filter((source) => source.kind !== "external");
  const stats: ImportImageStats = {
    total: candidates.length,
    local: 0,
    remote: 0,
    reused: 0,
    kept: sources.length - candidates.length,
    fallbacks: 0,
    failed: 0,
    errors: [],
  };
  const replacements = new Map<string, string>();
  const meter = new SpeedMeter();
  let done = 0;

  for (const source of candidates) {
    onProgress?.({ done, total: stats.total, detail: detailOf(source) });
    let loaded = 0;
    const uploadProgress = (nextLoaded: number) => {
      onSpeed?.(meter.add(Math.max(0, nextLoaded - loaded)));
      loaded = nextLoaded;
    };

    try {
      if (source.kind === "clawclip") {
        const record = source.blobId ? await getBlob(source.blobId) : undefined;
        if (!record) throw new Error("本地附件不存在");
        if (!isImageMime(record.mime)) {
          stats.kept += 1;
          continue;
        }
        // 目标本来就是本地：引用仍然有效，无需重复落库
        if (host === "local") {
          stats.kept += 1;
          continue;
        }
        if (record.remoteUrl) {
          replacements.set(source.url, record.remoteUrl);
          stats.reused += 1;
        } else {
          const url = await uploadBlobRecord(record, { onProgress: uploadProgress });
          replacements.set(source.url, url);
          stats.remote += 1;
          onRemoteUpload?.(record.size);
        }
        continue;
      }

      const blob =
        source.kind === "data"
          ? dataUrlToBlob(source.url)
          : source.kind === "local"
            ? await fetchLocalImage(source.url)
            : null;
      if (!blob) throw new Error("无法解析图片");
      if (!isImageMime(blob.type)) {
        stats.kept += 1;
        continue;
      }

      const file = new File([blob], `import-image.${extensionForMime(blob.type)}`, {
        type: blob.type,
      });
      const result = await resolveUploadTarget(file, noteId, host, {
        onProgress: uploadProgress,
      });
      if (result.kind === "remote") {
        stats.remote += 1;
        onRemoteUpload?.(file.size);
      } else {
        stats.local += 1;
        if (result.error) {
          stats.fallbacks += 1;
          reportError(stats, `上传失败（${blob.type}）：${result.error}`);
        }
      }
      replacements.set(source.url, result.target);
    } catch (error) {
      stats.failed += 1;
      reportError(stats, `读取失败（${detailOf(source)}）：${messageOf(error)}`);
    } finally {
      done += 1;
      onProgress?.({ done, total: stats.total, detail: detailOf(source) });
    }
  }

  let result = content;
  for (const [from, to] of replacements) {
    result = replaceAll(result, from, to);
  }
  return { content: result, stats };
}

/** 导入前估算需要处理的图片数（用于申请阻塞式进度浮层，不含外部链接）。 */
export function countImportImageCandidates(content: string): number {
  return extractImageSources(content).filter((source) => source.kind !== "external").length;
}
