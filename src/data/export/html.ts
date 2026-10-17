/**
 * 独立 HTML 文档构建：HTML 导出（可单独打开）与 PDF 打印（iframe 打印）共用。
 *
 * 公式统一走 KaTeX 同时输出的原生 MathML：单文件不依赖 KaTeX 字体，也不依赖 CDN。
 * **导出产物强制浅色主题**：不受阅读者系统明暗偏好影响，避免深色 token 在
 * 白底/纸面上出现低对比度；`print` 模式再补上 A4 页边距与分页规则。
 */
import hljsLight from "highlight.js/styles/github.css?inline";

export interface BuildHtmlOptions {
  /** 打印文档：追加 @page 与分页规则。 */
  print?: boolean;
}

const LIGHT_TOKENS = `
  --md-sys-color-on-surface: #1d1b20;
  --md-sys-color-on-surface-variant: #49454f;
  --md-sys-color-primary: #6750a4;
  --md-sys-color-tertiary-container: #ffd8e4;
  --md-sys-color-outline-variant: #cac4d0;
  --md-sys-color-surface-container-low: #f7f2fa;
  --md-sys-color-surface-container: #f3edf7;
  --md-sys-color-surface-container-high: #ece6f0;
`;

const PRINT_RULES = `
@page { size: A4; margin: 16mm 15mm; }
html, body { background: #fff; }
body {
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
.md-preview-content { max-width: none; margin: 0; padding: 0; }
.md-preview-content h1,
.md-preview-content h2,
.md-preview-content h3 { break-after: avoid-page; }
.md-preview-content pre,
.md-preview-content table,
.md-preview-content blockquote,
.md-preview-content img,
.md-preview-content .mermaid-rendered { break-inside: avoid; }
.md-preview-content .katex-display,
.md-preview-content .mermaid-rendered { overflow: visible; }
`;

/**
 * 生成可单独打开的 HTML 文档（内嵌预览主题与代码高亮样式）。
 */
export async function buildHtmlDocument(
  title: string,
  bodyHtml: string,
  previewCss: string,
  { print = false }: BuildHtmlOptions = {},
): Promise<string> {
  const safeTitle = title.replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] ?? c,
  );

  const tokenStyles = `<style>
:root { color-scheme: light;${LIGHT_TOKENS} }
</style>
<style>${hljsLight}</style>`;

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${safeTitle}</title>
${tokenStyles}
<style>
html { background: #fff; }
body { margin: 0; padding: 0; }
/* 单文件导出：用 KaTeX 的原生 MathML 代替依赖字体的 HTML 渲染 */
.katex-html { display: none !important; }
.katex-mathml { display: inline !important; }
.katex-display .katex-mathml { display: block !important; }
</style>
<style>${previewCss}
/* 导出专用：Mermaid 统一浅色底（深色主题下仍可读），并避免阅读/打印时被裁切 */
.md-preview-content .mermaid-rendered {
  background: #fff;
  padding: 10px;
  border-radius: 8px;
  overflow: visible;
}
.md-preview-content .katex-display { overflow: visible; }
</style>
${print ? `<style>${PRINT_RULES}</style>` : ""}
</head>
<body>
<article class="md-preview-content">${bodyHtml}</article>
</body>
</html>`;
}
