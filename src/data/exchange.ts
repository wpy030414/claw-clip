/**
 * 导入 / 导出（MD / DOCX / PDF）。
 *
 * - 导出 MD：直接下载正文（附件保留 clawclip:// 引用，仍由应用内解析）。
 * - 导出 DOCX：把渲染后的 HTML 转成 docx（标题/段落/列表/表格/代码/图片）。
 * - 导出 PDF：走浏览器打印（打印主题 CSS 已内置），由系统「存为 PDF」。
 * - 导入 MD / DOCX / PDF：DOCX 用 mammoth→HTML→turndown；PDF 用 pdf.js 抽文本 +
 *   字号/行距启发式重建标题与段落。
 *
 * 重型依赖（docx / mammoth / turndown / pdfjs-dist）全部动态 import，
 * 不进入首屏包体。
 */

import hljsLight from "highlight.js/styles/github.css?inline";
import hljsDark from "highlight.js/styles/github-dark.css?inline";

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
  style: { bold?: boolean; italics?: boolean; strike?: boolean; code?: boolean; link?: boolean } = {},
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
        }),
      );
      continue;
    }
    if (!isElement(child)) continue;
    const tag = child.tagName.toLowerCase();
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

async function imageParagraph(src: string): Promise<DocxChild | null> {
  if (!src || src.startsWith("clawclip://")) return null;
  try {
    const { Paragraph, ImageRun } = docxApi;
    const res = await fetch(src);
    const data = await res.arrayBuffer();
    const mime = res.headers.get("content-type") ?? "image/png";
    const type = mime.includes("jpeg") || mime.includes("jpg")
      ? "jpg"
      : mime.includes("gif")
        ? "gif"
        : "png";
    return new Paragraph({
      children: [
        new ImageRun({
          data,
          type: type as "png" | "jpg" | "gif",
          transformation: { width: 480, height: 320 },
        }),
      ],
    });
  } catch {
    return null;
  }
}

/** HTML 元素 → docx 块级元素（列表）。 */
async function blockChildren(el: Element, depth = 0): Promise<DocxChild[]> {
  const { Paragraph, HeadingLevel, Table, TableRow, TableCell, TextRun, WidthType } = docxApi;
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
      }),
    ];
  }
  if (tag === "pre") {
    const code = (el.textContent ?? "").replace(/\n$/, "");
    return code.split("\n").map(
      (line) =>
        new Paragraph({
          children: [new TextRun({ text: line || " ", font: "Courier New", size: 20 })],
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
  if (tag === "hr") return [new Paragraph({ text: "————" })];
  // 兜底：当作普通段落
  const text = (el.textContent ?? "").trim();
  return text ? [new Paragraph({ children: inlineRuns(el) as never })] : [];
}

/** HTML → DOCX Blob。 */
export async function htmlToDocx(html: string, title: string): Promise<Blob> {
  docxApi = await import("docx");
  const { Document, Packer, Paragraph, TextRun } = docxApi;
  const dom = new DOMParser().parseFromString(html, "text/html");

  const children: DocxChild[] = [];
  for (const el of Array.from(dom.body.children)) {
    children.push(...(await blockChildren(el)));
  }
  if (children.length === 0) {
    children.push(new Paragraph({ children: [new TextRun(title)] }));
  }

  const doc = new Document({
    title,
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
            },
          ],
        },
      ],
    },
    sections: [{ properties: {}, children: children as never }],
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

function linesFromPage(items: Array<{ str?: string; transform?: number[]; width?: number; height?: number }>): PdfLine[] {
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

  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
    .promise;
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

/* ------------------------------------------------------------------ */
/* HTML 导出                                                           */
/* ------------------------------------------------------------------ */

/**
 * 生成可单独打开的 HTML 文档（内嵌预览主题与代码高亮样式）。
 *
 * 公式说明：KaTeX 的 CSS 依赖自带字体文件，无法在单文件里零成本内联。
 * 这里关闭 `.katex-html`、改用 KaTeX 同时输出的原生 MathML（现代浏览器均支持），
 * 因此导出的 HTML 不依赖 CDN、也不需要 KaTeX 字体即可显示公式。
 */
export async function buildHtmlDocument(
  title: string,
  bodyHtml: string,
  previewCss: string,
): Promise<string> {
  const safeTitle = title.replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );
  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle}</title>
<style>
:root {
  color-scheme: light dark;
  --md-sys-color-on-surface: #1d1b20;
  --md-sys-color-on-surface-variant: #49454f;
  --md-sys-color-primary: #6750a4;
  --md-sys-color-tertiary-container: #ffd8e4;
  --md-sys-color-outline-variant: #cac4d0;
  --md-sys-color-surface-container-low: #f7f2fa;
  --md-sys-color-surface-container: #f3edf7;
  --md-sys-color-surface-container-high: #ece6f0;
}
@media (prefers-color-scheme: dark) {
  :root {
    --md-sys-color-on-surface: #e6e1e5;
    --md-sys-color-on-surface-variant: #cac4d0;
    --md-sys-color-primary: #d0bcff;
    --md-sys-color-tertiary-container: #633b48;
    --md-sys-color-outline-variant: #49454f;
    --md-sys-color-surface-container-low: #1d1b20;
    --md-sys-color-surface-container: #211f26;
    --md-sys-color-surface-container-high: #2b2930;
  }
  body { background: #121212; }
}
html { background: #fff; }
body { margin: 0; padding: 0; }
/* 单文件导出：用 KaTeX 的原生 MathML 代替依赖字体的 HTML 渲染 */
.katex-html { display: none !important; }
.katex-mathml { display: inline !important; }
.katex-display .katex-mathml { display: block !important; }
@media print { body { background: #fff; } }
</style>
<style media="(prefers-color-scheme: light)">${hljsLight}</style>
<style media="(prefers-color-scheme: dark)">${hljsDark}</style>
<style>${previewCss}</style>
</head>
<body>
<article class="md-preview-content">${bodyHtml}</article>
</body>
</html>`;
}
