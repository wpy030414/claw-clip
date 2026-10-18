/**
 * 导出预处理：把「离开应用就会失效」的运行时资源变成自包含的 HTML。
 *
 * 两个问题都出在 `renderForExport()` 的产物上：
 * - 附件图片是 `blob:` object URL，页面一关就失效 → 转成 data URL；
 * - ```mermaid 代码块只有源码 → 渲染成内联 SVG（HTML/PDF）或 PNG（DOCX）。
 *
 * 只处理导出的副本，不碰预览 DOM。
 */
import { blobToBase64 } from "@/data/backup";
import { renderMermaidBlocks } from "@/utils/mermaid";

export interface PrepareExportOptions {
  /** mermaid=svg 用于 HTML/PDF；png 用于 DOCX；none 跳过渲染。默认 svg。 */
  mermaid?: "svg" | "png" | "none";
  /** 内联失败（CORS/网络）的外链资源 URL，供 UI 提示「导出文件需联网查看」。 */
  onUnresolved?: (urls: string[]) => void;
}

/** 解析 HTML → 内联图片/附件 → 渲染 Mermaid → 返回新的 HTML 字符串。 */
export async function prepareExportHtml(
  bodyHtml: string,
  { mermaid = "svg", onUnresolved }: PrepareExportOptions = {},
): Promise<string> {
  const doc = new DOMParser().parseFromString(
    "<!doctype html><html><body></body></html>",
    "text/html",
  );
  doc.body.innerHTML = bodyHtml;

  const unresolved = new Set<string>();
  await inlineResources(doc.body, unresolved);

  if (mermaid !== "none") {
    await renderMermaidBlocks(doc.body, {
      mode: mermaid,
      theme: "default",
      htmlLabels: false,
    });
  }

  onUnresolved?.([...unresolved]);
  return doc.body.innerHTML;
}

/** 把 img[src] / a[href] 的 blob:/http(s): 资源内联为 data URL。 */
async function inlineResources(root: HTMLElement, unresolved?: Set<string>): Promise<void> {
  const cache = new Map<string, string | null>();

  const toDataUrl = async (url: string): Promise<string | null> => {
    if (cache.has(url)) return cache.get(url) ?? null;
    const data = await fetchAsDataUrl(url);
    if (!data) unresolved?.add(url);
    cache.set(url, data);
    return data;
  };

  const jobs: Array<Promise<void>> = [];

  for (const img of Array.from(root.querySelectorAll("img[src]"))) {
    const src = img.getAttribute("src") ?? "";
    if (!isInlinable(src)) continue;
    jobs.push(
      toDataUrl(src).then((data) => {
        if (data) img.setAttribute("src", data);
      }),
    );
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
    const base64 = await blobToBase64(blob);
    return `data:${mime};base64,${base64}`;
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
