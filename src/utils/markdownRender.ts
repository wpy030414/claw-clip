/**
 * Markdown 渲染管线（markdown-it + 扩展插件 + highlight.js）。
 *
 * 支持的扩展语法：
 * - GFM：表格、删除线、任务列表、自动链接
 * - 脚注、定义列表、上标/下标、==高亮==
 * - KaTeX 行内/块级公式（$...$ / $$...$$）
 * - 代码块语法高亮（highlight.js 常用语言子集，随主题换色）
 *
 * 安全：`html:false` —— 不渲染正文里的原始 HTML，避免 XSS；
 * 预览/打印/导出都复用本管线的输出，保证「编辑所见 = 打印所得」。
 */
import MarkdownIt from "markdown-it";
import type { MarkdownIt as MarkdownItInstance } from "markdown-it";
import footnote from "markdown-it-footnote";
import taskLists from "markdown-it-task-lists";
import deflist from "markdown-it-deflist";
import sub from "markdown-it-sub";
import sup from "markdown-it-sup";
import mark from "markdown-it-mark";
import katex from "@vscode/markdown-it-katex";
import hljsModule from "highlight.js/lib/common";

/**
 * CJS/ESM 互操作兜底：Vite 对 CommonJS 插件可能返回 `{ default: fn }`，
 * 直接 md.use(mod) 会报 "plugin.apply is not a function"。
 */
function asPlugin(mod: unknown): (md: MarkdownItInstance, ...args: unknown[]) => void {
  const m = mod as { default?: unknown };
  return (typeof mod === "function" ? mod : m.default) as (
    md: MarkdownItInstance,
    ...args: unknown[]
  ) => void;
}

const hljs = ((hljsModule as unknown as { default?: typeof hljsModule }).default ??
  hljsModule) as typeof hljsModule;

const md: MarkdownItInstance = new MarkdownIt({
  html: false,
  linkify: true,
  typographer: true,
  breaks: false,
  highlight(code: string, lang: string): string {
    if (lang && hljs.getLanguage(lang)) {
      try {
        const html = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
        return `<pre class="hljs"><code class="language-${lang}">${html}</code></pre>`;
      } catch {
        /* 回退到转义输出 */
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(code)}</code></pre>`;
  },
});

md.use(asPlugin(footnote))
  .use(asPlugin(taskLists), { enabled: true, label: true })
  .use(asPlugin(deflist))
  .use(asPlugin(sub))
  .use(asPlugin(sup))
  .use(asPlugin(mark))
  .use(asPlugin(katex), { throwOnError: false });

/** 渲染 Markdown → HTML 字符串。 */
export function renderMarkdown(source: string): string {
  return md.render(source);
}

/** 渲染单行（标题/摘要等场景）。 */
export function renderInline(source: string): string {
  return md.renderInline(source);
}
