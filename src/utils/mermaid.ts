/**
 * Mermaid 渲染公共工具：预览、HTML/DOCX/PDF 导出共用同一套渲染逻辑。
 *
 * 为什么抽出来：预览与导出必须看到同一张图；此前 PDF 导出自己复制了一份
 * `renderMermaidForExport()`，HTML/DOCX 则完全没有渲染，导致导出保真度不一致。
 *
 * 约定：
 * - 预览用 `htmlLabels: true`（默认，观感最好）；导出用 `htmlLabels: false`，
 *   避免 `<foreignObject>` 在 canvas 栅格化 / 打印时丢失。
 * - mermaid 的 `initialize()` 是全局状态，`render()` 又是异步的；这里用一条
 *   串行队列把「初始化 + 渲染」包起来，避免预览与导出并发时主题互相覆盖。
 */
import type Mermaid from "mermaid";

type MermaidApi = typeof Mermaid;

/** 导出/预览共用的渲染选项。 */
export interface MermaidRenderOptions {
  theme?: "default" | "dark";
  /** HTML 标签（foreignObject）。导出为 PNG/打印时建议关闭。 */
  htmlLabels?: boolean;
}

let mermaidSeq = 0;

/** 串行队列：避免 initialize 的全局配置被并发渲染覆盖。 */
let queue: Promise<unknown> = Promise.resolve();

function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => undefined);
  return run;
}

/** 把一段 Mermaid 源码渲染为 SVG 字符串。 */
export async function renderMermaidToSvg(
  code: string,
  { theme = "default", htmlLabels = true }: MermaidRenderOptions = {},
): Promise<string> {
  const mermaid = (await import("mermaid")).default as MermaidApi;
  return serialize(async () => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme,
      htmlLabels,
    });
    const id = `clawclip-mermaid-${++mermaidSeq}`;
    const { svg } = await mermaid.render(id, code);
    return svg;
  });
}

/** SVG → PNG data URL（2× 分辨率，供 DOCX 嵌入）。 */
export async function svgToPngDataUrl(
  svg: string,
  scale = 2,
): Promise<{ dataUrl: string; width: number; height: number }> {
  if (typeof document === "undefined") throw new Error("SVG 转 PNG 需要浏览器环境");
  const { width, height } = svgSize(svg);
  const img = new Image();
  img.decoding = "sync";
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await decodeImage(img);

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil(width * scale));
  canvas.height = Math.max(1, Math.ceil(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法创建 Mermaid 画布");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL("image/png"), width, height };
}

/** 从 SVG 的 viewBox / width / height 推断自然尺寸（缺省 800×600）。 */
function svgSize(svg: string): { width: number; height: number } {
  const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
  const root = doc.documentElement;
  const viewBox = root.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
  if (viewBox && viewBox.length === 4 && viewBox.every((n) => Number.isFinite(n))) {
    return { width: viewBox[2], height: viewBox[3] };
  }
  const width = Number.parseFloat(root.getAttribute("width") ?? "");
  const height = Number.parseFloat(root.getAttribute("height") ?? "");
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width, height };
  }
  return { width: 800, height: 600 };
}

function decodeImage(img: HTMLImageElement): Promise<void> {
  if (typeof img.decode === "function") {
    return img.decode().catch(
      () =>
        new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("Mermaid SVG 解码失败"));
        }),
    );
  }
  return new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Mermaid SVG 解码失败"));
  });
}

export interface RenderMermaidBlocksOptions extends MermaidRenderOptions {
  /** svg=内联矢量（HTML/PDF）；png=位图（DOCX）。 */
  mode?: "svg" | "png";
}

/**
 * 把容器内所有 ```mermaid 代码块替换为渲染结果。
 *
 * 返回成功渲染的图表数量；单个图表失败时保留原代码块，不影响整篇。
 */
export async function renderMermaidBlocks(
  root: ParentNode,
  { mode = "svg", theme = "default", htmlLabels }: RenderMermaidBlocksOptions = {},
): Promise<number> {
  const blocks = Array.from(root.querySelectorAll<HTMLElement>("code.language-mermaid"));
  let rendered = 0;

  for (const block of blocks) {
    const code = block.textContent ?? "";
    try {
      const svg = await renderMermaidToSvg(code, {
        theme,
        // PNG 栅格化与打印都要求普通 <text> 标签
        htmlLabels: htmlLabels ?? mode === "svg",
      });
      // PNG 用 <p> 包裹：DOCX 的块级转换把 <p> 内的 img 当图片段落处理
      const holder = document.createElement(mode === "png" ? "p" : "div");
      holder.className = "mermaid-rendered";
      if (mode === "png") {
        const { dataUrl, width, height } = await svgToPngDataUrl(svg);
        const img = document.createElement("img");
        img.src = dataUrl;
        img.alt = "Mermaid 图表";
        img.width = Math.round(width);
        img.height = Math.round(height);
        holder.appendChild(img);
      } else {
        holder.innerHTML = svg;
      }
      (block.closest("pre") ?? block).replaceWith(holder);
      rendered += 1;
    } catch {
      /* 单个图表失败不影响整篇 */
    }
  }

  return rendered;
}
