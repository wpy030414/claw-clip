/**
 * 导出预处理：把「离开应用就会失效」的运行时资源变成可离线打开的产物。
 *
 * 两个问题都出在 `renderForExport()` 的产物上：
 * - 附件图片是 `blob:` object URL，页面一关就失效；
 * - ```mermaid 代码块只有源码 → 渲染成内联 SVG（HTML/PDF）或 PNG（DOCX）。
 *
 * 图片有两种策略（`images`）：
 * - `inline`（DOCX/PDF 等自包含产物）：blob:/http(s): → data URL；
 * - `host`（HTML 导出）：本地图片与内联 base64 上传图床并改写外链，
 *   已有外链原样保留；上传失败时回退为 data URL，保证导出文件仍可看。
 *
 * 只处理导出的副本，不碰预览 DOM。
 */
import { getBlob, getBlobIdForUrl } from "@/data/blobStore";
import { blobToDataUrl, isDataImageUrl, messageOf } from "@/data/imageAssets";
import { isImageMime } from "@/data/imageHost";
import { uploadBlobRecord, uploadDataImage } from "@/data/imageUpload";
import { renderMermaidBlocks } from "@/utils/mermaid";
import { SpeedMeter } from "@/utils/speed";

export interface ExportImageStats {
  /** 参与处理的本地/内联图片数（不含已有外链） */
  total: number;
  uploaded: number;
  reused: number;
  /** 上传失败后回退为 data URL 的图片数 */
  fallbacks: number;
  /** 既无法上传也无法回退的图片数 */
  failed: number;
}

export interface ExportImageProgress {
  done: number;
  total: number;
  detail: string;
}

export interface PrepareExportOptions {
  /** mermaid=svg 用于 HTML/PDF；png 用于 DOCX；none 跳过渲染。默认 svg。 */
  mermaid?: "svg" | "png" | "none";
  /** 图片策略：inline=自包含（默认）；host=上传图床并保留外链（HTML 导出）。 */
  images?: "inline" | "host";
  /** 内联失败（CORS/网络）的外链资源 URL，供 UI 提示「导出文件需联网查看」。 */
  onUnresolved?: (urls: string[]) => void;
  onImageProgress?: (progress: ExportImageProgress) => void;
  onImageSpeed?: (bytesPerSecond: number) => void;
  onImageStats?: (stats: ExportImageStats) => void;
}

/** 解析 HTML → 处理图片 → 渲染 Mermaid → 返回新的 HTML 字符串。 */
export async function prepareExportHtml(
  bodyHtml: string,
  {
    mermaid = "svg",
    images = "inline",
    onUnresolved,
    onImageProgress,
    onImageSpeed,
    onImageStats,
  }: PrepareExportOptions = {},
): Promise<string> {
  const doc = new DOMParser().parseFromString(
    "<!doctype html><html><body></body></html>",
    "text/html",
  );
  doc.body.innerHTML = bodyHtml;

  const unresolved = new Set<string>();
  const imageStats =
    images === "host" ? await hostImages(doc.body, { onImageProgress, onImageSpeed }) : null;
  await inlineResources(doc.body, unresolved, images);

  if (mermaid !== "none") {
    await renderMermaidBlocks(doc.body, {
      mode: mermaid,
      theme: "default",
      htmlLabels: false,
    });
  }

  if (imageStats) onImageStats?.(imageStats);
  onUnresolved?.([...unresolved]);
  return doc.body.innerHTML;
}

/**
 * HTML 导出：本地 blob 与内联 base64 → 图床外链。
 * 已有 http(s) 外链不处理；本地图片上传失败时回退 data URL。
 */
async function hostImages(
  root: HTMLElement,
  { onImageProgress, onImageSpeed }: Pick<PrepareExportOptions, "onImageProgress" | "onImageSpeed">,
): Promise<ExportImageStats> {
  const images = Array.from(root.querySelectorAll("img[src]")).filter((img) => {
    const src = img.getAttribute("src") ?? "";
    return src.startsWith("blob:") || isDataImageUrl(src);
  });
  const stats: ExportImageStats = {
    total: images.length,
    uploaded: 0,
    reused: 0,
    fallbacks: 0,
    failed: 0,
  };
  const meter = new SpeedMeter();
  let done = 0;

  for (const img of images) {
    const src = img.getAttribute("src") ?? "";
    const detail = src.startsWith("blob:") ? "本地图片" : "内联图片";
    onImageProgress?.({ done, total: stats.total, detail });
    let loaded = 0;
    const onProgress = (nextLoaded: number) => {
      onImageSpeed?.(meter.add(Math.max(0, nextLoaded - loaded)));
      loaded = nextLoaded;
    };

    if (src.startsWith("blob:")) {
      const id = getBlobIdForUrl(src);
      const record = id ? await getBlob(id) : undefined;
      if (!record || !isImageMime(record.mime)) {
        stats.failed += 1;
      } else if (record.remoteUrl) {
        img.setAttribute("src", record.remoteUrl);
        stats.reused += 1;
      } else {
        try {
          const url = await uploadBlobRecord(record, { onProgress });
          img.setAttribute("src", url);
          stats.uploaded += 1;
        } catch (error) {
          try {
            img.setAttribute("src", await blobToDataUrl(record.data));
            stats.fallbacks += 1;
          } catch {
            stats.failed += 1;
          }
          console.warn("[claw-clip] HTML 导出图片上传失败，已回退内联", messageOf(error));
        }
      }
    } else {
      try {
        const url = await uploadDataImage(src, { onProgress });
        img.setAttribute("src", url);
        stats.uploaded += 1;
      } catch {
        // data URL 本身仍可用，保持原样
        stats.fallbacks += 1;
      }
    }

    done += 1;
    onImageProgress?.({ done, total: stats.total, detail });
  }

  return stats;
}

/** 把 img[src] / a[href] 的 blob:/http(s): 资源内联为 data URL。 */
async function inlineResources(
  root: HTMLElement,
  unresolved: Set<string>,
  images: "inline" | "host",
): Promise<void> {
  const cache = new Map<string, string | null>();

  const toDataUrl = async (url: string): Promise<string | null> => {
    if (cache.has(url)) return cache.get(url) ?? null;
    const data = await fetchAsDataUrl(url);
    if (!data) unresolved.add(url);
    cache.set(url, data);
    return data;
  };

  const jobs: Array<Promise<void>> = [];

  // host 策略已经处理过图片：外链保持原样，失败项也已有 data URL 兜底
  if (images === "inline") {
    for (const img of Array.from(root.querySelectorAll("img[src]"))) {
      const src = img.getAttribute("src") ?? "";
      if (!isInlinable(src)) continue;
      jobs.push(
        toDataUrl(src).then((data) => {
          if (data) img.setAttribute("src", data);
        }),
      );
    }
  }

  for (const a of Array.from(root.querySelectorAll("a[href]"))) {
    const href = a.getAttribute("href") ?? "";
    if (!isInlinable(href)) continue;
    jobs.push(
      toDataUrl(href).then((data) => {
        if (data) {
          a.setAttribute("href", data);
          if (!a.hasAttribute("download")) {
            a.setAttribute("download", a.textContent?.trim() || "附件");
          }
        }
      }),
    );
  }

  await Promise.all(jobs);
}

/** 只内联运行时 URL；data:/锚点/应用内协议与外链保持原样。 */
function isInlinable(url: string): boolean {
  return url.startsWith("blob:") || /^https?:\/\//i.test(url);
}

async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const mime = blob.type || guessMime(url);
    return await blobToDataUrl(new Blob([await blob.arrayBuffer()], { type: mime }));
  } catch (err) {
    console.warn("[claw-clip] 导出内联资源失败，保留原 URL", url, err);
    return null;
  }
}

const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  bmp: "image/bmp",
  avif: "image/avif",
  pdf: "application/pdf",
  txt: "text/plain;charset=utf-8",
  md: "text/markdown;charset=utf-8",
};

function guessMime(url: string): string {
  const ext = url.split(/[?#]/)[0].split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}
