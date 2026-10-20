/**
 * Markdown 文本工具：标题派生 / 字数统计 / 摘要截取。
 *
 * 均为「够用就好」的轻量实现，不引入完整 md AST 解析器（列表页投影场景
 * 追求零依赖、低开销；编辑器/预览用同一套字数语义，保证列表与顶栏一致）。
 *
 * 三者都先剥离文档开头的 YAML front matter：元数据不是正文，不能进入
 * 标题、摘要、字数，也不能让关闭分隔线被当成 Setext 标题。
 */
import { parseFrontMatter, stripFrontMatter } from "@/utils/frontMatter";

/** 去掉常见 Markdown 标记，返回近似纯文本（用于字数统计与摘要）。 */
function stripMarkdown(md: string): string {
  return (
    md
      // 围栏代码块整块剔除（``` … ```）
      .replace(/```[\s\S]*?```/g, " ")
      // 图片：只留 alt 文本
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
      // 链接：只留链接文字
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // clawclip:// 附件引用整体剔除
      .replace(/clawclip:\/\/blob\/[\w-]+/g, " ")
      // 行内代码去反引号
      .replace(/`([^`]*)`/g, "$1")
      // 标题/引用/列表符号
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s{0,3}>\s?/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      // 强调/删除线标记
      .replace(/(\*\*|__|\*|_|~~)/g, "")
      // 表格分隔线整行剔除
      .replace(/^\s*\|?\s*:?-{3,}.*$/gm, " ")
      // 水平分割线
      .replace(/^\s*([-*_]\s*){3,}$/gm, " ")
  );
}

/**
 * 从正文派生标题：
 * 1. front matter 的 `title`（显式标题，不截断）；
 * 2. 首个 ATX 标题的文本；
 * 3. 否则取首个非空行的前 30 字；
 * 4. 否则 '无标题'。
 */
export function deriveTitle(content: string): string {
  const frontMatter = parseFrontMatter(content);
  if (frontMatter.title) {
    return frontMatter.title.replace(/\s+/g, " ").trim();
  }

  const body = frontMatter.present ? content.slice(frontMatter.end) : content;
  const lines = body.split("\n");
  for (const line of lines) {
    const h = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/);
    if (h) {
      const text = stripMarkdown(h[1]).trim();
      if (text) return text.length > 30 ? text.slice(0, 30) : text;
    }
  }
  for (const line of lines) {
    const t = stripMarkdown(line).trim();
    if (t) return t.length > 30 ? t.slice(0, 30) : t;
  }
  return "无标题";
}

/**
 * CJK 字符匹配：基本汉字(U+4E00-9FFF)、扩展A(U+3400-4DBF)、
 * 日文假名(U+3040-30FF)、韩文音节(U+AC00-D7AF)。
 */
const CJK_RE = /[㐀-䶿぀-ヿ一-鿿가-힯]/g;

/**
 * 统计字数（简化实现）：去掉 Markdown 标记后，
 * CJK 字符按「每字 1 个」计，连续的西文/数字串按「每词 1 个」计，
 * 其余空白与标点不计。
 */
export function countWords(content: string): number {
  const text = stripMarkdown(stripFrontMatter(content));
  const cjk = text.match(CJK_RE);
  const words = text
    // 先把 CJK 字符抠掉，剩下的按空白切词
    .replace(CJK_RE, " ")
    .split(/\s+/)
    .filter((w) => /[\w'’-]/.test(w));
  return (cjk?.length ?? 0) + words.length;
}

/** 生成摘要：去 Markdown 标记、压平空白后取前 80 字纯文本。 */
export function makeExcerpt(content: string, max = 80): string {
  const text = stripMarkdown(stripFrontMatter(content)).replace(/\s+/g, " ").trim();
  return text.length > max ? text.slice(0, max) : text;
}
