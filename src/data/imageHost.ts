/**
 * img.scdn.io 图床客户端。
 *
 * 接口（见 xat:upload-img 技能 / 官方文档）：
 *   POST https://img.scdn.io/api/v1.php   multipart，文件字段名 `image`，无鉴权
 *   成功：{ success: true, data: { url } }（部分响应顶层也带 url）
 *   限制：约 20MB；5 次 / 5 秒；图片 60 天无人访问会被自动删除。
 *
 * 浏览器直连已确认 CORS 放开；不要手动设置 Content-Type，交给 FormData 生成 boundary。
 */
import type { ImageHostKind } from "@/types/integration";
import { BLOB_URL_SCHEME, saveBlob } from "./blobStore";

export const IMAGE_HOST_ENDPOINT = "https://img.scdn.io/api/v1.php";
export const IMAGE_HOST_MAX_BYTES = 20 * 1024 * 1024;

/** 上传成功后的外链或本地回退目标。 */
export interface UploadTarget {
  /** `clawclip://blob/<id>` 或 https 外链 */
  target: string;
  kind: "local" | "remote";
  /** 从图床回退到本地时的原因 */
  error?: string;
}

export type ImageUploadErrorCode =
  | "too_large"
  | "rate_limit"
  | "network"
  | "timeout"
  | "server"
  | "invalid";

export class ImageUploadError extends Error {
  constructor(
    message: string,
    readonly code: ImageUploadErrorCode,
  ) {
    super(message);
    this.name = "ImageUploadError";
  }
}

const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif|ico|tiff?)$/i;

/** 是否图片：优先 MIME，缺失时按扩展名兜底（拖入的截图/本地文件可能没有 type）。 */
export function isImageFile(file: File): boolean {
  if (file.type) return file.type.startsWith("image/");
  return IMAGE_EXT_RE.test(file.name);
}

export function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 全局限流：服务端限制 5 次 / 5 秒，串行并保证间隔 ≥1050ms。 */
const MIN_INTERVAL_MS = 1050;
let queue: Promise<void> = Promise.resolve();
let lastUploadAt = 0;

/** 仅供测试：重置限流状态，避免用例之间互相等待 1s。 */
export function __resetImageHostThrottle(): void {
  queue = Promise.resolve();
  lastUploadAt = 0;
}

function nextSlot(): Promise<void> {
  const run = queue.then(async () => {
    const wait = lastUploadAt + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastUploadAt = Date.now();
  });
  queue = run.catch(() => undefined);
  return run;
}

function withTimeout(timeoutMs: number, outer?: AbortSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    done: () => {
      clearTimeout(timer);
      outer?.removeEventListener("abort", onAbort);
    },
  };
}

async function postImage(file: File, timeoutMs: number, signal?: AbortSignal) {
  const form = new FormData();
  form.append("image", file, file.name || "image");
  const guard = withTimeout(timeoutMs, signal);
  try {
    return await fetch(IMAGE_HOST_ENDPOINT, { method: "POST", body: form, signal: guard.signal });
  } finally {
    guard.done();
  }
}

/**
 * 上传一张图片，返回外链。失败抛 ImageUploadError。
 * 429 / 5xx / 网络错误最多重试一次。
 */
export async function uploadToScdn(file: File, signal?: AbortSignal): Promise<string> {
  if (file.size > IMAGE_HOST_MAX_BYTES) {
    throw new ImageUploadError("图片超过 20MB，无法上传到图床", "too_large");
  }

  let lastError: ImageUploadError | null = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await nextSlot();
    try {
      const res = await postImage(file, 30_000, signal);
      if (res.status === 413) {
        throw new ImageUploadError("图片超过图床限制（约 20MB）", "too_large");
      }
      if (res.status === 429) {
        lastError = new ImageUploadError("图床限流（5 次/5 秒），请稍后重试", "rate_limit");
        if (attempt === 0) {
          const retryAfter = Number(res.headers.get("retry-after"));
          await sleep(Math.min(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000, 10_000));
          continue;
        }
        throw lastError;
      }
      if (!res.ok) {
        lastError = new ImageUploadError(`图床返回 ${res.status}`, "server");
        if (attempt === 0 && res.status >= 500) continue;
        throw lastError;
      }

      const json = (await res.json().catch(() => null)) as
        | { success?: boolean; url?: string; error?: string; message?: string; data?: { url?: string } }
        | null;
      const url = json?.data?.url ?? json?.url ?? "";
      if (json?.success !== true || !url) {
        throw new ImageUploadError(json?.error || json?.message || "图床返回数据异常", "invalid");
      }
      if (!/^https:\/\//i.test(url)) {
        throw new ImageUploadError("图床返回了非 HTTPS 地址", "invalid");
      }
      return url;
    } catch (error) {
      if (error instanceof ImageUploadError) {
        lastError = error;
        if (attempt === 0 && (error.code === "server" || error.code === "rate_limit")) continue;
        throw error;
      }
      const aborted = (error as Error | undefined)?.name === "AbortError";
      lastError = new ImageUploadError(aborted ? "图床连接超时" : "图床网络异常", aborted ? "timeout" : "network");
      if (attempt === 0) continue;
      throw lastError;
    }
  }
  throw lastError ?? new ImageUploadError("图床上传失败", "network");
}

/**
 * 按当前上传目标处理一个文件。
 *
 * - 非图片 / 目标为本地：存 IndexedDB，返回 `clawclip://blob/<id>`；
 * - 目标为图床且上传成功：返回外链；
 * - 图床失败：回退本地，并在 `error` 中带回原因（调用方提示用户）。
 */
export async function resolveUploadTarget(
  file: File,
  noteId: string,
  host: ImageHostKind,
): Promise<UploadTarget> {
  if (host !== "scdn" || !isImageFile(file)) {
    return { target: `${BLOB_URL_SCHEME}${await saveBlob(noteId, file)}`, kind: "local" };
  }
  try {
    return { target: await uploadToScdn(file), kind: "remote" };
  } catch (error) {
    return {
      target: `${BLOB_URL_SCHEME}${await saveBlob(noteId, file)}`,
      kind: "local",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
