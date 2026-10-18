/**
 * 导入 / 导出（MD / DOCX / PDF）。
 *
 * - 导出 MD：直接下载正文（附件保留 clawclip:// 引用，仍由应用内解析）。
 * - 导出 HTML：单文件自包含——Mermaid 内联 SVG、附件 data URL、公式走原生 MathML。
 * - 导出 DOCX：渲染 HTML → docx；公式经 `docx/math` 转成 Word 原生 OMML，
 *   Mermaid 转高清 PNG，图片按原始比例缩放。
 * - 导出 PDF：同源 HTML（强制浅色纸面）→ 隐藏 iframe → 浏览器打印，
 *   产出可选中/搜索的矢量 PDF，由用户「另存为 PDF」。
 * - 导入 MD / DOCX / PDF：DOCX 用 mammoth→HTML→turndown；PDF 用 pdf.js 抽文本 +
 *   字号/行距启发式重建标题与段落。
 *
 * 重型依赖（docx / docx/math / mammoth / turndown / pdfjs-dist）全部动态 import，
 * 不进入首屏包体。
 */

import { katexTex, katexToMath, loadMathApi } from "./export/math";
import { buildHtmlDocument } from "./export/html";
import { buildPrintDocument, printHtmlDocument } from "./export/print";
import { prepareExportHtml } from "./export/prepare";

export { buildHtmlDocument, buildPrintDocument, prepareExportHtml, printHtmlDocument };
export type { BuildHtmlOptions } from "./export/html";

export interface ImportedDocument {
  title: string;
  content: string;
}

/** 触发浏览器下载。 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 给浏览器一点时间开始下载再回收 URL
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(filename: string, text: string, mime = "text/markdown"): void {
  downloadBlob(filename, new Blob([text], { type: `${mime};charset=utf-8` }));
}

/** 文件名安全化（去掉路径分隔符与保留字符）。 */
export function safeFilename(name: string, ext: string): string {
  const base = name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "未命名";
  return `${base}.${ext}`;
}

/* ------------------------------------------------------------------ */
/* DOCX 导出                                                           */
/* ------------------------------------------------------------------ */

type DocxChild = unknown;

const HEADING_RE = /^h([1-6])$/;

function isElement(node: Node): node is HTMLElement {
  return node.nodeType === Node.ELEMENT_NODE;
}

/** 行内节点 → docx TextRun 列表（加粗/斜体/删除线/行内代码/链接）。 */
function inlineRuns(
  node: Node,
  style: {
    bold?: boolean;
    italics?: boolean;
    strike?: boolean;
    code?: boolean;
    link?: boolean;
  } = {},
): DocxChild[] {
  // 延迟到函数内 require 会破坏 ESM；由调用方传入构造器集合
  const { TextRun } = docxApi;
  const runs: DocxChild[] = [];

  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent ?? "";
      if (!text) continue;
      runs.push(
        new TextRun({
          text,
          bold: style.bold,
          italics: style.italics,
          strike: style.strike,
          font: style.code ? "Courier New" : undefined,
          size: style.code ? 20 : undefined,
          color: style.link ? "0563C1" : undefined,
          shading: style.code ? { fill: "ECE6F0" } : undefined,
        }),
      );
      continue;
    }
    if (!isElement(child)) continue;
    const tag = child.tagName.toLowerCase();
    // 公式：KaTeX 会同时输出 MathML 与 HTML 两份内容，直接递归会把公式拆成
    // 重复的字符 + 原始 TeX。这里优先转成 Word 原生公式，失败才回退 TeX 文本。
    if (tag === "span" && child.classList.contains("katex")) {
      const math = katexToMath(child);
      if (math) {
        runs.push(math);
        continue;
      }
      const tex = katexTex(child);
      if (tex) {
        runs.push(new TextRun({ text: tex, font: "Courier New", size: 20 }));
        continue;
      }
    }
    if (tag === "span" && child.classList.contains("katex-error")) {
      runs.push(new TextRun({ text: child.textContent ?? "", color: "CC0000" }));
      continue;
    }
    if (tag === "br") {
      runs.push(new TextRun({ break: 1 }));
      continue;
    }
    if (tag === "img") continue; // 图片在块级处理
    const next = { ...style };
    if (tag === "strong" || tag === "b") next.bold = true;
    if (tag === "em" || tag === "i") next.italics = true;
    if (tag === "del" || tag === "s") next.strike = true;
    if (tag === "code") next.code = true;
    if (tag === "a") next.link = true;
    runs.push(...inlineRuns(child, next));
  }
  return runs;
}

/** docx 构造器集合（动态 import 后注入，避免把 docx 打进首屏）。 */
let docxApi: typeof import("docx");

type DocxImageType = "jpg" | "png" | "gif" | "bmp";

/** 解码图片（`decode()` 在个别浏览器对 SVG 会失败，回退 onload）。 */
function decodeImage(img: HTMLImageElement): Promise<void> {
  if (typeof img.decode === "function") {
    return img.decode().catch(
      () =>
        new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("图片解码失败"));
        }),
    );
  }
  return new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("图片解码失败"));
  });
}

function supportedImageType(mime: string): DocxImageType | null {
  if (mime.includes("jpeg") || mime.includes("jpg")) return "jpg";
  if (mime.includes("png")) return "png";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("bmp")) return "bmp";
  return null;
}

/** 读取图片二进制与自然尺寸；webp/svg 等 Word 不支持的格式统一栅格化为 PNG。 */
async function loadImage(
  src: string,
): Promise<{ data: ArrayBuffer; type: DocxImageType; width: number; height: number } | null> {
  const res = await fetch(src);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try {
    await decodeImage(img);
    const width = img.naturalWidth || 480;
    const height = img.naturalHeight || 320;
    const supported = supportedImageType(blob.type);
    if (supported) {
      return { data: await blob.arrayBuffer(), type: supported, width, height };
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, width, height);
    const png = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!png) return null;
    return { data: await png.arrayBuffer(), type: "png", width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 图片 → 居中段落：按原始宽高比缩放到文档可用宽度内，不再固定 480×320。 */
async function imageParagraph(src: string): Promise<DocxChild | null> {
  if (!src || src.startsWith("clawclip://")) return null;
  try {
    const { Paragraph, ImageRun } = docxApi;
    const image = await loadImage(src);
    if (!image) return null;
    // 不放大：只在大图时等比缩小（A4 正文宽度约 480pt）
    const scale = Math.min(480 / image.width, 640 / image.height, 1);
    return new Paragraph({
      children: [
        new ImageRun({
          data: image.data,
          type: image.type,
          transformation: {
            width: Math.max(1, Math.round(image.width * scale)),
            height: Math.max(1, Math.round(image.height * scale)),
          },
        }),
      ],
    });
  } catch {
    return null;
  }
}

/** HTML 元素 → docx 块级元素（列表）。 */
/** GitHub 警报框类型 → DOCX 语义色（与预览 CSS 保持一致）。 */
const ALERT_DOCX_COLORS: Record<string, string> = {
  note: "0969DA",
  tip: "1A7F37",
  important: "8250DF",
  warning: "9A6700",
  caution: "CF222E",
};

async function blockChildren(el: Element, depth = 0): Promise<DocxChild[]> {
  const { Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun, WidthType, AlignmentType } =
    docxApi;
  const tag = el.tagName.toLowerCase();
  const heading = tag.match(HEADING_RE);
  if (heading) {
    return [
      new Paragraph({
        heading: HeadingLevel[`HEADING_${heading[1]}` as keyof typeof HeadingLevel],
        children: inlineRuns(el) as never,
      }),
    ];
  }
  if (tag === "p") {
    // 块级公式：<p class="katex-block"><span class="katex-display">…
    if (el.classList.contains("katex-block") || el.querySelector(":scope > .katex-display")) {
      const katex = el.querySelector(".katex");
      const math = katex ? katexToMath(katex) : null;
      if (math) {
        return [
          new Paragraph({
            children: [math as never],
            alignment: AlignmentType.CENTER,
            spacing: { before: 120, after: 120 },
          }),
        ];
      }
    }
    const imgs = Array.from(el.querySelectorAll("img"));
    const text = (el.textContent ?? "").trim();
    const out: DocxChild[] = [];
    if (text) out.push(new Paragraph({ children: inlineRuns(el) as never }));
    for (const img of imgs) {
      const p = await imageParagraph(img.getAttribute("src") ?? "");
      if (p) out.push(p);
    }
    return out.length ? out : [new Paragraph({ text: "" })];
  }
  if (el.classList.contains("md-alert")) {
    // 警报框：标题加粗并带左侧色条，正文按普通块递归（列表/图片等不丢）
    const type =
      Object.keys(ALERT_DOCX_COLORS).find((key) => el.classList.contains(`md-alert-${key}`)) ??
      "note";
    const color = ALERT_DOCX_COLORS[type];
    const titleEl = el.querySelector(":scope > .md-alert-title");
    const titleText = (titleEl?.textContent ?? "").trim();
    const out: DocxChild[] = [];
    if (titleText) {
      out.push(
        new Paragraph({
          children: [new TextRun({ text: titleText, bold: true, color })],
          indent: { left: 240 },
          spacing: { before: 120, after: 60 },
          border: {
            left: { style: docxApi.BorderStyle.SINGLE, size: 18, space: 10, color },
          },
        }),
      );
    }
    for (const child of Array.from(el.children)) {
      if (child === titleEl) continue;
      out.push(...(await blockChildren(child, depth)));
    }
    return out.length ? out : [new Paragraph({ text: "" })];
  }
  if (tag === "ul" || tag === "ol") {
    const out: DocxChild[] = [];
    for (const li of Array.from(el.children)) {
      if (li.tagName.toLowerCase() !== "li") continue;
      const nested = Array.from(li.children).filter((c) =>
        ["ul", "ol"].includes(c.tagName.toLowerCase()),
      );
      const clone = li.cloneNode(true) as HTMLElement;
      clone.querySelectorAll("ul, ol").forEach((n) => n.remove());
      out.push(
        new Paragraph({
          children: inlineRuns(clone) as never,
          bullet: tag === "ul" ? { level: depth } : undefined,
          numbering: tag === "ol" ? { reference: "default-numbering", level: depth } : undefined,
        }),
      );
      for (const sub of nested) out.push(...(await blockChildren(sub, depth + 1)));
    }
    return out.length ? out : [new Paragraph({ text: "" })];
  }
  if (tag === "blockquote") {
    return [
      new Paragraph({
        children: inlineRuns(el, { italics: true }) as never,
        indent: { left: 720 },
        shading: { fill: "F7F2FA" },
        border: {
          left: { style: docxApi.BorderStyle.SINGLE, size: 12, space: 8, color: "6750A4" },
        },
      }),
    ];
  }
  if (tag === "pre") {
    const code = (el.textContent ?? "").replace(/\n$/, "");
    return code.split("\n").map(
      (line) =>
        new Paragraph({
          children: [new TextRun({ text: line || " ", font: "Courier New", size: 20 })],
          shading: { fill: "ECE6F0" },
          spacing: { before: 0, after: 0, line: 276 },
        }),
    );
  }
  if (tag === "table") {
    const rows: DocxChild[] = [];
    for (const tr of Array.from(el.querySelectorAll("tr"))) {
      const cells: DocxChild[] = [];
      for (const cell of Array.from(tr.children)) {
        if (!["td", "th"].includes(cell.tagName.toLowerCase())) continue;
        cells.push(
          new TableCell({
            shading: cell.tagName.toLowerCase() === "th" ? { fill: "F3EDF7" } : undefined,
            children: [
              new Paragraph({
                children: inlineRuns(cell, {
                  bold: cell.tagName.toLowerCase() === "th",
                }) as never,
              }),
            ],
          }),
        );
      }
      if (cells.length) rows.push(new TableRow({ children: cells as never }));
    }
    return rows.length
      ? [
          new Table({
            rows: rows as never,
            width: { size: 100, type: WidthType.PERCENTAGE },
          }),
        ]
      : [];
  }
  if (tag === "img") {
    const p = await imageParagraph(el.getAttribute("src") ?? "");
    return p ? [p] : [];
  }
  if (tag === "hr") return [new Paragraph({ thematicBreak: true })];
  // 兜底：当作普通段落
  const text = (el.textContent ?? "").trim();
  return text ? [new Paragraph({ children: inlineRuns(el) as never })] : [];
}

export interface HtmlToDocxOptions {
  /** 外链图片下载失败（CORS/网络）时的回调，UI 可提示「已跳过」。 */
  onUnresolved?: (urls: string[]) => void;
}

/** HTML → DOCX Blob。 */
export async function htmlToDocx(
  html: string,
  title: string,
  options: HtmlToDocxOptions = {},
): Promise<Blob> {
  docxApi = await import("docx");
  await loadMathApi();
  const { Document, Packer, Paragraph, TextRun } = docxApi;
  // 自包含处理（幂等）：附件 blob:/http → data URL；Mermaid 代码块 → 高清 PNG
  const prepared = await prepareExportHtml(html, {
    mermaid: "png",
    onUnresolved: options.onUnresolved,
  });
  const dom = new DOMParser().parseFromString(prepared, "text/html");

  const children: DocxChild[] = [];
  for (const el of Array.from(dom.body.children)) {
    children.push(...(await blockChildren(el)));
  }
  if (children.length === 0) {
    children.push(new Paragraph({ children: [new TextRun(title)] }));
  }

  const { BorderStyle } = docxApi;
  const bodyFont = { ascii: "PingFang SC", eastAsia: "PingFang SC", hAnsi: "PingFang SC" };
  const doc = new Document({
    title,
    styles: {
      default: {
        document: {
          run: { font: bodyFont, size: 23, color: "1D1B20" },
          paragraph: { spacing: { line: 360, before: 0, after: 120 } },
        },
        heading1: {
          run: { font: bodyFont, size: 45, bold: true, color: "1D1B20" },
          paragraph: {
            keepNext: true,
            spacing: { before: 360, after: 160 },
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 6, space: 6, color: "CAC4D0" },
            },
          },
        },
        heading2: {
          run: { font: bodyFont, size: 34, bold: true, color: "1D1B20" },
          paragraph: {
            keepNext: true,
            spacing: { before: 300, after: 140 },
            border: {
              bottom: { style: BorderStyle.SINGLE, size: 6, space: 6, color: "CAC4D0" },
            },
          },
        },
        heading3: {
          run: { font: bodyFont, size: 29, bold: true, color: "1D1B20" },
          paragraph: { keepNext: true, spacing: { before: 260, after: 120 } },
        },
        heading4: {
          run: { font: bodyFont, size: 25, bold: true, color: "1D1B20" },
          paragraph: { keepNext: true, spacing: { before: 220, after: 100 } },
        },
        heading5: {
          run: { font: bodyFont, size: 23, bold: true, color: "1D1B20" },
          paragraph: { keepNext: true, spacing: { before: 200, after: 80 } },
        },
        heading6: {
          run: { font: bodyFont, size: 23, bold: true, color: "1D1B20" },
          paragraph: { keepNext: true, spacing: { before: 200, after: 80 } },
        },
        listParagraph: {
          paragraph: { spacing: { line: 340, after: 60 } },
        },
      },
    },
    numbering: {
      config: [
        {
          reference: "default-numbering",
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: "start",
              suffix: docxApi.LevelSuffix.TAB,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } },
            },
          ],
        },
      ],
    },
    sections: [
      {
        properties: {
          page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } },
        },
        children: children as never,
      },
    ],
  });
  return Packer.toBlob(doc);
}

/* ------------------------------------------------------------------ */
/* 导入（MD / DOCX / PDF）                                             */
/* ------------------------------------------------------------------ */

async function docxToMarkdown(file: File): Promise<string> {
  const mammoth = await import("mammoth");
  const result = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() });
  const [{ default: TurndownService }, { gfm }] = await Promise.all([
    import("turndown"),
    import("turndown-plugin-gfm"),
  ]);
  const td = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
  });
  td.use(gfm);
  return td.turndown(result.value).trim();
}

/** PDF 文本项 → 行（按 y 分组，按 x 排序）。 */
interface PdfLine {
  text: string;
  y: number;
  size: number;
}

function isCjk(char: string): boolean {
  return /[　-鿿＀-￯]/.test(char);
}

function linesFromPage(
  items: Array<{ str?: string; transform?: number[]; width?: number; height?: number }>,
): PdfLine[] {
  const buckets = new Map<number, Array<{ str: string; x: number; size: number }>>();
  for (const item of items) {
    if (typeof item.str !== "string" || !item.transform) continue;
    const str = item.str;
    if (!str.trim()) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    const size = item.height ?? Math.abs(item.transform[3]) ?? 12;
    const key = Math.round(y / 2) * 2;
    const list = buckets.get(key) ?? [];
    list.push({ str, x, size });
    buckets.set(key, list);
  }

  const lines: PdfLine[] = [];
  for (const [y, parts] of [...buckets.entries()].sort((a, b) => b[0] - a[0])) {
    parts.sort((a, b) => a.x - b.x);
    let text = "";
    for (const part of parts) {
      const piece = part.str;
      if (!text) {
        text = piece;
        continue;
      }
      const prev = text[text.length - 1];
      const next = piece[0];
      // 中文之间不补空格；西文单词之间补一个空格
      text += isCjk(prev) || isCjk(next) ? piece : ` ${piece}`;
    }
    const size = Math.max(...parts.map((p) => p.size));
    lines.push({ text: text.replace(/\s+/g, " ").trim(), y, size });
  }
  return lines.filter((l) => l.text.length > 0);
}

async function pdfToMarkdown(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const allLines: PdfLine[] = [];
  for (let pageNo = 1; pageNo <= pdf.numPages; pageNo++) {
    const page = await pdf.getPage(pageNo);
    const content = await page.getTextContent();
    allLines.push(...linesFromPage(content.items as never));
    allLines.push({ text: "\u0000PAGEBREAK", y: 0, size: 0 });
  }

  const sizes = allLines.filter((l) => l.text !== "\u0000PAGEBREAK").map((l) => l.size);
  sizes.sort((a, b) => a - b);
  const median = sizes[Math.floor(sizes.length / 2)] ?? 12;

  const out: string[] = [];
  let paragraph: string[] = [];
  const flush = () => {
    if (paragraph.length) {
      out.push(paragraph.join(""));
      paragraph = [];
    }
  };

  for (let i = 0; i < allLines.length; i++) {
    const line = allLines[i];
    if (line.text === "\u0000PAGEBREAK") {
      flush();
      continue;
    }
    const ratio = line.size / median;
    if (ratio >= 1.3) {
      flush();
      const level = ratio >= 1.9 ? "#" : ratio >= 1.55 ? "##" : "###";
      out.push(`${level} ${line.text}`);
      continue;
    }
    const bullet = line.text.match(/^[•·▪◦‣]\s*/);
    if (bullet) {
      flush();
      out.push(`- ${line.text.replace(bullet[0], "")}`);
      continue;
    }
    const prev = allLines[i - 1];
    const gap = prev && prev.text !== "\u0000PAGEBREAK" ? prev.y - line.y : 0;
    if (prev && gap > median * 1.7) flush();
    paragraph.push(line.text);
  }
  flush();
  return out.join("\n\n");
}

/** 可导入的扩展名：侧栏拖入、「上传笔记」文件选择共用同一份白名单。 */
export const IMPORT_EXTENSIONS = ["md", "markdown", "txt", "docx", "pdf"] as const;
/** `<input type="file" accept>` 用的扩展名串。 */
export const IMPORT_ACCEPT = IMPORT_EXTENSIONS.map((ext) => `.${ext}`).join(",");

/** 文件名是否属于可导入格式（只看扩展名，不读内容）。 */
export function isImportableFile(file: File): boolean {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  return (IMPORT_EXTENSIONS as readonly string[]).includes(ext);
}

/** 根据扩展名导入文件 → { title, content }。 */
export async function importDocument(file: File): Promise<ImportedDocument> {
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const title = file.name.replace(/\.[^.]+$/, "") || "导入的文档";

  if (ext === "md" || ext === "markdown" || ext === "txt") {
    return { title, content: await file.text() };
  }
  if (ext === "docx") {
    return { title, content: await docxToMarkdown(file) };
  }
  if (ext === "pdf") {
    return { title, content: await pdfToMarkdown(file) };
  }
  throw new Error(`不支持的文件类型：.${ext || "未知"}`);
}
