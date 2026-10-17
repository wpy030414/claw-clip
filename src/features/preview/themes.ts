/**
 * 预览 / 打印主题 CSS。
 *
 * 预览与打印共用同一套渲染结果（见 ARCHITECTURE「编辑/预览/导出同源」）：
 * 用户可在设置里追加自定义 CSS（settings.previewCss），用于调整字体、字号、
 * 页边距、标题样式等「印刷效果」。
 */

/** 内置排版：类书籍排版，兼顾中英文与代码/表格/公式。 */
export const DEFAULT_PREVIEW_CSS = `
.md-preview-content {
  max-width: 860px;
  margin: 0 auto;
  padding: 32px 40px 64px;
  color: var(--md-sys-color-on-surface, #1d1b20);
  font-family: "Iowan Old Style", "Palatino Linotype", Palatino, "Songti SC",
    "Noto Serif CJK SC", "Source Han Serif SC", Georgia, serif;
  font-size: 16px;
  line-height: 1.85;
  overflow-wrap: break-word;
}
.md-preview-content > *:first-child { margin-top: 0; }
.md-preview-content h1, .md-preview-content h2, .md-preview-content h3,
.md-preview-content h4, .md-preview-content h5, .md-preview-content h6 {
  font-family: "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", system-ui, sans-serif;
  line-height: 1.35;
  margin: 1.6em 0 0.6em;
  color: var(--md-sys-color-on-surface, #1d1b20);
}
.md-preview-content h1 { font-size: 2em; border-bottom: 1px solid var(--md-sys-color-outline-variant, #cac4d0); padding-bottom: 0.3em; }
.md-preview-content h2 { font-size: 1.55em; }
.md-preview-content h3 { font-size: 1.28em; }
.md-preview-content h4 { font-size: 1.1em; }
.md-preview-content p { margin: 0.9em 0; }
.md-preview-content a { color: var(--md-sys-color-primary, #6750a4); text-decoration: underline; }
.md-preview-content strong { font-weight: 700; }
.md-preview-content em { font-style: italic; }
.md-preview-content del { opacity: 0.7; }
.md-preview-content mark { background: var(--md-sys-color-tertiary-container, #ffd8e4); color: inherit; padding: 0 2px; }
.md-preview-content ul, .md-preview-content ol { margin: 0.8em 0; padding-left: 1.6em; }
.md-preview-content li { margin: 0.25em 0; }
.md-preview-content li > input[type="checkbox"] { margin-right: 0.5em; }
.md-preview-content blockquote {
  margin: 1em 0; padding: 0.2em 1em;
  border-left: 4px solid var(--md-sys-color-primary, #6750a4);
  color: var(--md-sys-color-on-surface-variant, #49454f);
  background: var(--md-sys-color-surface-container-low, #f7f2fa);
}
.md-preview-content hr { border: none; border-top: 1px solid var(--md-sys-color-outline-variant, #cac4d0); margin: 2em 0; }
.md-preview-content img { max-width: 100%; height: auto; border-radius: 6px; }
.md-preview-content code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.9em;
  padding: 0.15em 0.35em;
  border-radius: 4px;
  background: var(--md-sys-color-surface-container-high, #ece6f0);
}
.md-preview-content pre.hljs {
  margin: 1em 0;
  padding: 14px 16px;
  overflow-x: auto;
  border-radius: 10px;
  background: var(--md-sys-color-surface-container-high, #ece6f0);
  line-height: 1.6;
}
.md-preview-content pre.hljs code { background: transparent; padding: 0; font-size: 0.88em; }
.md-preview-content table {
  border-collapse: collapse; margin: 1.2em 0; width: 100%; font-size: 0.94em;
}
.md-preview-content th, .md-preview-content td {
  border: 1px solid var(--md-sys-color-outline-variant, #cac4d0);
  padding: 8px 12px; text-align: left; vertical-align: top;
}
.md-preview-content th { background: var(--md-sys-color-surface-container, #f3edf7); font-weight: 600; }
.md-preview-content .footnotes { font-size: 0.88em; opacity: 0.85; }
.md-preview-content .katex-display { overflow-x: auto; overflow-y: hidden; padding: 0.4em 0; }
.md-preview-content .mermaid-rendered svg { max-width: 100%; height: auto; }

@media print {
  .md-preview-content { max-width: none; padding: 0; font-size: 11.5pt; }
  .md-preview-content pre.hljs { white-space: pre-wrap; }
  .md-preview-content h1, .md-preview-content h2, .md-preview-content h3 { break-after: avoid; }
  .md-preview-content table, .md-preview-content pre, .md-preview-content blockquote { break-inside: avoid; }
}
`;

/** 默认主题 + 用户自定义 CSS（自定义在后，可覆盖内置规则）。 */
export function composePreviewCss(custom: string): string {
  return custom.trim()
    ? `${DEFAULT_PREVIEW_CSS}\n/* === 自定义预览主题 === */\n${custom}`
    : DEFAULT_PREVIEW_CSS;
}
