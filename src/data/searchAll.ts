/**
 * 全库搜索：内存过滤 + 相关度排序 + 逐条命中详情。
 *
 * 评分规则（文章级）：标题匹配权重 10，正文匹配权重 1（× 命中次数），标签匹配权重 3。
 * 命中级另有局部相关度，用于「文章为根、命中为叶」树中的叶子排序：
 * 标题 > 标签 > 正文标题行 > 正文。
 *
 * 默认按字面量、大小写不敏感匹配；当输入被一对斜杠包裹（`/exp/`）时切换为正则，
 * 正则在文本中命中的子串（而非输入本身）决定偏移与长度。
 *
 * 每条正文命中都带 UTF-16 字符偏移与高亮片段，供搜索结果精确定位到编辑器。
 * 本地量级（数百~数千条笔记）在内存里过滤完全够用，不引入 FTS。
 */
import { globalConfig } from "@/config";
import type { Note } from "@/types/note";
import { getAllOf } from "./db";

/** 命中类型：整篇标题 / 标签 / 正文。 */
export type SearchMatchKind = "title" | "tag" | "content";

/** 一条可点击的命中（树中的叶子）。 */
export interface SearchMatch {
  kind: SearchMatchKind;
  /** 实际匹配到的文本（保留原文大小写）；标题命中为整篇标题，标签命中为标签名。 */
  text: string;
  /** 正文命中在 `note.content` 中的 UTF-16 起始偏移；标题/标签命中为 null。 */
  offset: number | null;
  /** 匹配长度（UTF-16 code units）。 */
  length: number;
  /** 正文命中是否落在 Markdown 标题行（`#` 开头）。 */
  inHeading: boolean;
  /** 上下文片段（仅正文命中，含 `<mark>` 高亮），标题/标签命中为空串。 */
  snippet: string;
  /** 局部相关度，越高越靠前。 */
  score: number;
}

/** 搜索结果条目（文章为根）。 */
export interface SearchResult {
  id: string;
  title: string;
  tags: string[];
  /** 文章级相关度（用于文章之间排序）。 */
  score: number;
  /** 全部命中数（可能大于 `matches.length`，后者受单篇上限约束）。 */
  matchCount: number;
  /** 按局部相关度降序排列的命中，最多 {@link MAX_MATCHES_PER_NOTE} 条。 */
  matches: SearchMatch[];
  /** 主片段（正文中第一处命中），保留给不需要树结构的调用方。 */
  snippet: string;
  wordCount: number;
  updatedAt: number;
}

export interface SearchOptions {
  /** 当前打开的文章 id：永远排在结果最前面。 */
  currentNoteId?: string | null;
}

/** 首个命中前保留的字符数（结果行很紧凑，保证高亮落在可视区）。 */
const LEADING_RADIUS = 12;
/** 命中后保留的字符数。 */
const TRAILING_RADIUS = 48;
/** 单篇文章最多返回的命中叶子数，避免超大结果拖垮渲染。 */
const MAX_MATCHES_PER_NOTE = 30;
/** 正文最多扫描并暂存的命中数（标题行命中会优先保留）。 */
const MATCH_SCAN_LIMIT = 120;

/** 局部相关度权重。 */
const SCORE_TITLE = 1000;
const SCORE_TAG = 800;
const SCORE_HEADING = 600;
const SCORE_CONTENT = 400;

/** 将纯文本转义为安全的 HTML 片段。 */
function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** 转义正则元字符，让关键词按字面量匹配。 */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 搜索模式：字面量 / 用户显式包裹的正则。 */
export type SearchQueryMode = "plain" | "regex";

/** 编译成功的搜索词。 */
export interface CompiledSearchQuery {
  ok: true;
  mode: SearchQueryMode;
  /** 标题/标签匹配：非全局，可安全重复 `test`。 */
  test: RegExp;
  /** 正文扫描：全局，调用前需要把 `lastIndex` 归零。 */
  global: RegExp;
}

/** 编译失败的搜索词（目前只有非法正则）。 */
export interface InvalidSearchQuery {
  ok: false;
  mode: "regex";
  /** 可直接展示给用户的错误信息。 */
  error: string;
}

/**
 * 解析搜索输入。
 *
 * - 普通模式：整体按字面量匹配，大小写不敏感（与旧行为一致）；
 * - 正则模式：**仅当**输入以一对斜杠包裹时启用，如 `/^\d\d/`；
 *   斜杠不配对、或想搜字面量斜杠时，请直接输入（如 `a/b`）。
 *   正则同样大小写不敏感，并默认开启多行模式（`^`/`$` 匹配每一行的首尾，
 *   与代码编辑器的搜索习惯一致）；正文使用全局副本逐处命中。
 *
 * 输入为空（或只有空白）时返回 `null`。
 */
export function compileSearchQuery(input: string): CompiledSearchQuery | InvalidSearchQuery | null {
  const raw = input.trim();
  if (!raw) return null;

  const isRegex = raw.length >= 2 && raw.startsWith("/") && raw.endsWith("/");
  if (!isRegex) {
    const source = escapeRegExp(raw);
    return {
      ok: true,
      mode: "plain",
      test: new RegExp(source, "i"),
      global: new RegExp(source, "gi"),
    };
  }

  const pattern = raw.slice(1, -1);
  if (!pattern) {
    return { ok: false, mode: "regex", error: "正则表达式不能为空，例如 /^\\d\\d/" };
  }

  try {
    return {
      ok: true,
      mode: "regex",
      test: new RegExp(pattern, "im"),
      global: new RegExp(pattern, "gim"),
    };
  } catch (err) {
    return {
      ok: false,
      mode: "regex",
      error: `正则表达式无效：${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/**
 * 生成一条命中的上下文片段，并只高亮这一条。
 *
 * 窗口被限制在命中所在行内：既能保证高亮落在片段前部（两行内可见），
 * 又不会把相邻行里的其它命中重复带进来，多条命中时叶子之间更易区分。
 */
function buildMatchSnippet(content: string, offset: number, length: number): string {
  const lineStart = content.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const lineBreak = content.indexOf("\n", offset);
  const lineEnd = lineBreak < 0 ? content.length : lineBreak;

  const start = Math.max(lineStart, offset - LEADING_RADIUS);
  const end = Math.min(lineEnd, offset + length + TRAILING_RADIUS);
  return (
    (start > lineStart ? "…" : "") +
    escapeHtml(content.slice(start, offset)) +
    "<mark>" +
    escapeHtml(content.slice(offset, offset + length)) +
    "</mark>" +
    escapeHtml(content.slice(offset + length, end)) +
    (end < lineEnd ? "…" : "")
  );
}

/** 判断正文偏移所在行是否为 Markdown 标题行。 */
function isHeadingLine(content: string, offset: number): boolean {
  const lineStart = content.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  const lineEnd = content.indexOf("\n", offset);
  const line = content.slice(lineStart, lineEnd < 0 ? content.length : lineEnd);
  return /^\s{0,3}#{1,6}\s/.test(line);
}

/** 命中排序：局部相关度降序；同一档按正文出现顺序，标题/标签排在正文前。 */
function compareMatches(a: SearchMatch, b: SearchMatch): number {
  if (b.score !== a.score) return b.score - a.score;
  return (a.offset ?? -1) - (b.offset ?? -1);
}

/**
 * 全库搜索：取所有笔记，按关键词过滤并打分排序。
 *
 * 文章排序：当前打开的文章永远第一；其余按文章级相关度降序，同分时新文章在前。
 * 文章内部：命中按局部相关度降序（标题 > 标签 > 正文标题行 > 正文）。
 */
export async function searchAllNotes(
  keyword: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  const compiled = compileSearchQuery(keyword);
  // 空输入与非法正则都不产生结果；UI 可通过 compileSearchQuery 拿到具体错误。
  if (!compiled || !compiled.ok) return [];

  const { test: containsRe, global: contentRe } = compiled;
  const currentNoteId = options.currentNoteId ?? null;

  const notes = await getAllOf<Note>(globalConfig.storeNames.notes);
  const results: SearchResult[] = [];

  for (const note of notes) {
    const matches: SearchMatch[] = [];
    let matchCount = 0;

    // —— 标题 ——
    const titleHit = note.title.match(containsRe);
    if (titleHit) {
      matchCount++;
      matches.push({
        kind: "title",
        text: note.title,
        offset: null,
        length: titleHit[0].length,
        inHeading: false,
        snippet: "",
        score: SCORE_TITLE,
      });
    }

    // —— 标签 ——
    let tagHitCount = 0;
    for (const tag of note.tags) {
      const tagHit = tag.match(containsRe);
      if (!tagHit) continue;
      tagHitCount++;
      matchCount++;
      matches.push({
        kind: "tag",
        text: tag,
        offset: null,
        length: tagHit[0].length,
        inHeading: false,
        snippet: "",
        score: SCORE_TAG,
      });
    }

    // —— 正文 ——
    // CodeMirror 会把 CRLF / CR 归一成 LF；搜索偏移必须使用同一坐标系，
    // 否则含 Windows 换行的笔记在首行之后会整体错位。
    const content = note.content.includes("\r")
      ? note.content.replace(/\r\n?/g, "\n")
      : note.content;
    let contentHits = 0;
    let primarySnippet = "";
    contentRe.lastIndex = 0;
    for (const m of content.matchAll(contentRe)) {
      const offset = m.index ?? 0;
      const length = m[0].length;
      contentHits++;

      // 零宽匹配（如 /^/）没有可高亮、可跳转的文本，只计入总数，不生成叶子。
      if (length === 0) continue;

      // 超量结果仍要计数，但只为前 MATCH_SCAN_LIMIT 条生成片段
      if (matches.length >= MATCH_SCAN_LIMIT) continue;

      const inHeading = isHeadingLine(content, offset);
      const snippet = buildMatchSnippet(content, offset, length);
      if (!primarySnippet) primarySnippet = snippet;

      matches.push({
        kind: "content",
        text: m[0],
        offset,
        length,
        inHeading,
        snippet,
        score: inHeading ? SCORE_HEADING : SCORE_CONTENT,
      });
    }
    matchCount += contentHits;

    const score = (titleHit ? 10 : 0) + contentHits + (tagHitCount > 0 ? 3 : 0);
    if (score === 0) continue;

    matches.sort(compareMatches);
    results.push({
      id: note.id,
      title: note.title,
      tags: note.tags,
      score,
      matchCount,
      matches: matches.slice(0, MAX_MATCHES_PER_NOTE),
      snippet: primarySnippet,
      wordCount: note.wordCount,
      updatedAt: note.updatedAt,
    });
  }

  results.sort((a, b) => {
    // 当前文章永远置顶，即使它的相关度低于其它文章
    const aCurrent = a.id === currentNoteId ? 1 : 0;
    const bCurrent = b.id === currentNoteId ? 1 : 0;
    if (aCurrent !== bCurrent) return bCurrent - aCurrent;
    if (b.score !== a.score) return b.score - a.score;
    return b.updatedAt - a.updatedAt;
  });

  return results;
}
