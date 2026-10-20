/**
 * 正文图片资产工具：导入与导出共用。
 *
 * 只负责「找出正文里的图片」与「data URL ↔ Blob」，
 * 是存 IndexedDB 还是上传图床由调用方决定。
 */
import { blobToBase64 } from "./backup";

export type ImageSourceKind = "data" | "clawclip" | "local" | "external";

export interface ImageSource {
  url: string;
  kind: ImageSourceKind;
  /** kind=clawclip 时的附件 id */
  blobId?: string;
}

export const CLAWCLIP_BLOB_PREFIX = "clawclip://blob/";

const WINDOWS_PATH_RE = /^[a-z]:[\\/]/i;
const RELATIVE_PATH_RE = /^\.{0,2}[\\/]/;
const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;

// 交替匹配尖括号包裹的地址与普通地址；title 不进入 URL
const MD_IMAGE_RE = /!\[[^\]]*\]\(\s*(?:<([^>\r\n]+)>|([^\s)]+))(?:\s+["'][^"']*["'])?\s*\)/gi;
const HTML_IMAGE_RE = /<img\b[^>]*\bsrc\s*=\s*(["'])([^"']+)\1[^>]*>/gi;

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

export function isDataImageUrl(url: string): boolean {
  return /^data:image\//i.test(url);
}

/** 是否其它图床/站点的外链（http、https、协议相对地址）。 */
export function isExternalImageUrl(url: string): boolean {
  return /^(?:https?:)?\/\//i.test(url);
}

export function classifyImageUrl(url: string): ImageSourceKind {
  if (isDataImageUrl(url)) return "data";
  if (isExternalImageUrl(url)) return "external";
  if (url.startsWith(CLAWCLIP_BLOB_PREFIX)) return "clawclip";
  if (/^(?:blob:|file:)/i.test(url) || WINDOWS_PATH_RE.test(url) || RELATIVE_PATH_RE.test(url)) {
    return "local";
  }
  // ftp:/mailto: 等其它协议不主动处理
  if (SCHEME_RE.test(url)) return "external";
  return "local";
}

/**
 * 提取正文里的图片地址（Markdown 内联图 + HTML img），按 URL 去重。
 * 非图片 data URL（如 data:text/plain）直接忽略。
 */
export function extractImageSources(content: string): ImageSource[] {
  const out: ImageSource[] = [];
  const seen = new Set<string>();

  const add = (raw: string | undefined) => {
    const url = raw?.trim();
    if (!url || seen.has(url)) return;
    if (/^data:/i.test(url) && !isDataImageUrl(url)) return;
    seen.add(url);
    const kind = classifyImageUrl(url);
    if (kind === "clawclip") {
      const blobId = url.slice(CLAWCLIP_BLOB_PREFIX.length);
      if (!/^[\w-]+$/.test(blobId)) return;
      out.push({ url, kind, blobId });
      return;
    }
    out.push({ url, kind });
  };

  for (const match of content.matchAll(MD_IMAGE_RE)) add(match[1] ?? match[2]);
  for (const match of content.matchAll(HTML_IMAGE_RE)) add(match[2]);
  return out;
}

/** 正文里出现过的内联图片 data URL（Markdown + HTML img，去重）。 */
export function extractDataImageUrls(content: string): string[] {
  return extractImageSources(content)
    .filter((source) => source.kind === "data")
    .map((source) => source.url);
}

/** data URL → Blob（仅接受 image/*；percent 编码与 base64 都支持）。 */
export function dataUrlToBlob(url: string): Blob | null {
  const comma = url.indexOf(",");
  if (comma < 0) return null;
  const meta = url.slice("data:".length, comma);
  const payload = url.slice(comma + 1);
  const [mime, ...flags] = meta.split(";");
  if (!mime?.startsWith("image/")) return null;
  try {
    if (flags.includes("base64")) {
      const binary = atob(payload);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(payload)], { type: mime });
  } catch {
    return null;
  }
}

/** Blob → data URL（导出上传失败时回退为自包含图片）。 */
export async function blobToDataUrl(blob: Blob): Promise<string> {
  const mime = blob.type || "application/octet-stream";
  return `data:${mime};base64,${await blobToBase64(blob)}`;
}

export function extensionForMime(mime: string): string {
  const subtype = mime.split("/")[1]?.split(";")[0]?.trim() ?? "";
  if (subtype === "jpeg") return "jpg";
  if (subtype === "svg+xml") return "svg";
  return subtype || "bin";
}

/** 从 URL 扩展名猜图片 MIME（响应头缺失时用）。 */
export function guessImageMime(url: string): string {
  const path = url.split(/[?#]/)[0] ?? "";
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export function replaceAll(content: string, from: string, to: string): string {
  return content.split(from).join(to);
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
