/**
 * Markdown 渲染管线（markdown-it + 扩展插件 + highlight.js）。
 *
 * 支持的扩展语法：
 * - GFM：表格、删除线、任务列表、自动链接
 * - 脚注、定义列表、上标/下标、==高亮==
 * - GitHub 风格警报框（> [!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION]）
 * - KaTeX 行内/块级公式（$...$ / $$...$$）
 * - 代码块语法高亮（highlight.js 常用语言子集，随主题换色）
 *
 * 原始 HTML：`html:true` —— 正文里手写的 HTML 原样进入输出，供预览/导出渲染。
 * 这是**有意的产品能力**：本应用是本地单用户编辑器，不做 XSS 过滤；
 * 导入不受信任的文档时，其中的脚本/事件属性会在预览中执行，需自行承担风险。
 * 预览/导出都复用本管线的输出，保证「编辑所见 = 导出所得」。
 */
import MarkdownIt from "markdown-it";
import type { MarkdownIt as MarkdownItInstance, Token } from "markdown-it";
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
  html: true,
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
    // 未内置高亮的语言（如 mermaid）也要保留语言类，预览据此识别并渲染图表。
    const langClass = lang ? ` class="language-${md.utils.escapeHtml(lang)}"` : "";
    return `<pre class="hljs"><code${langClass}>${md.utils.escapeHtml(code)}</code></pre>`;
  },
});

/** GitHub 风格警报框：[!NOTE] / [!TIP] / [!IMPORTANT] / [!WARNING] / [!CAUTION]。 */
const ALERT_TITLES: Record<string, string> = {
  note: "Note",
  tip: "Tip",
  important: "Important",
  warning: "Warning",
  caution: "Caution",
};

/** 块引用第一段开头的标记，后面可紧跟正文或换行。 */
const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\r?\n)?/i;

/**
 * 把 `> [!NOTE]` 形式的块引用改写为警报框。
 *
 * 输出结构：`<div class="md-alert md-alert-note">` + 标题段落（`md-alert-title`）
 * + 原文正文。标记独占首行时首段只剩标题；同一行写了内容则内容留在首段。
 * 只认块引用**第一段**开头的标记，普通引用与后续段落里的标记不受影响。
 */
function githubAlerts(md: MarkdownItInstance): void {
  md.core.ruler.after("inline", "github-alerts", (state) => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].type !== "blockquote_open") continue;
      const inline = tokens[i + 2];
      if (tokens[i + 1]?.type !== "paragraph_open" || inline?.type !== "inline") continue;

      const match = ALERT_RE.exec(inline.content);
      if (!match) continue;
      const type = match[1].toLowerCase();
      const title = ALERT_TITLES[type];
      if (!title) continue;

      // 配对的 blockquote_close（支持嵌套引用）
      let depth = 0;
      let close = i;
      for (; close < tokens.length; close++) {
        if (tokens[close].type === "blockquote_open") depth += 1;
        else if (tokens[close].type === "blockquote_close") {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      if (close >= tokens.length) continue;

      tokens[i].tag = "div";
      tokens[i].attrSet("class", `md-alert md-alert-${type}`);
      tokens[close].tag = "div";

      const titleOpen = new state.Token("paragraph_open", "p", 1);
      titleOpen.attrSet("class", "md-alert-title");
      const titleInline = new state.Token("inline", "", 0);
      titleInline.content = title;
      titleInline.children = [
        Object.assign(new state.Token("text", "", 0), { content: title }),
      ];
      const titleClose = new state.Token("paragraph_close", "p", -1);

      const rest = inline.content.slice(match[0].length);
      if (rest.trim() === "") {
        // 标记独占首段：用标题替换掉空段落
        tokens.splice(i + 1, 3, titleOpen, titleInline, titleClose);
      } else {
        // 同一行还有正文：重解析剩余内容，把标题插到前面
        inline.content = rest;
        inline.children = state.md.parseInline(rest, state.env)[0]?.children ?? [];
        tokens.splice(i + 1, 0, titleOpen, titleInline, titleClose);
      }
    }
  });
}

md.use(asPlugin(footnote))
  .use(asPlugin(taskLists), { enabled: true, label: true })
  .use(asPlugin(deflist))
  .use(asPlugin(sub))
  .use(asPlugin(sup))
  .use(asPlugin(mark))
  .use(asPlugin(katex), { throwOnError: false })
  .use(githubAlerts);

/** 渲染 Markdown → HTML 字符串。 */
export function renderMarkdown(source: string): string {
  return md.render(source);
}

/** 渲染单行（标题/摘要等场景）。 */
export function renderInline(source: string): string {
  return md.renderInline(source);
}

/** 大纲条目：level=1..6，pos=标题所在行的源码字符偏移。 */
export interface MarkdownHeading {
  level: number;
  text: string;
  pos: number;
}

/**
 * 从 Markdown 源码提取真正的标题（大纲用）。
 *
 * 必须走解析器而不是逐行正则：``` / ~~~ 围栏代码块、缩进代码块、HTML 块里的
 * `# 不是标题` 都不能进入大纲；同时支持 ATX（`# 标题`）与 Setext（下划线）两种写法。
 */
export function extractOutline(source: string): MarkdownHeading[] {
  const tokens = md.parse(source, {});
  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source.charCodeAt(i) === 10) lineStarts.push(i + 1);
  }

  const headings: MarkdownHeading[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type !== "heading_open") continue;
    const inline = tokens[i + 1];
    headings.push({
      level: Number(token.tag.slice(1)),
      text: inline?.type === "inline" ? inlineText(inline) : "",
      pos: lineStarts[token.map?.[0] ?? 0] ?? 0,
    });
  }
  return headings;
}

/** 标题行内 token → 纯文本（保留链接/行内代码/图片替代文本）。 */
function inlineText(token: Token): string {
  if (!token.children) return token.content;
  let text = "";
  for (const child of token.children) {
    if (
      child.type === "text" ||
      child.type === "code_inline" ||
      child.type === "image" ||
      child.type === "math_inline"
    ) {
      text += child.content;
    } else if (child.type === "softbreak" || child.type === "hardbreak") {
      text += " ";
    }
  }
  return text.trim();
}
