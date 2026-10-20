/**
 * YAML front matter 的轻量识别与已知字段投影。
 *
 * 只做三件事：
 * 1. 判断文档开头是否存在**闭合**的 front matter，并给出它在原文中的区间；
 * 2. 原样剥离（供标题/摘要/字数/搜索/渲染使用）；
 * 3. 用行级解析提取 `title` / `tags` 两个已知键。
 *
 * 这不是 YAML 解析器：未知键、注释、键序、引号风格一律不解释、不重写；
 * 正文里的 front matter 原文永远是唯一持久真相。解析失败也绝不抛错，
 * 最多是取不到已知键（用户正在输入、YAML 暂时不合法时不能阻塞保存与预览）。
 *
 * 识别规则（与常见实现对齐）：
 * - 可选 BOM；
 * - 首行必须是 `---`（允许行尾空白，不允许前导缩进）；
 * - 后续出现独立成行的 `---` 或 `...` 才算闭合；
 * - 找不到闭合分隔线时**整段当普通正文**——实时编辑敲下第一行 `---` 时，
 *   预览不能因此变成空白。
 */

export interface ParsedFrontMatter {
  /** 是否存在闭合的 front matter 区块。 */
  present: boolean;
  /** 区块在原文中的结束偏移（不含）；无区块时为 0。 */
  end: number;
  /** 区块占用的行数（从文档首行算起）；无区块时为 0。 */
  lineCount: number;
  /** 区块原文（含可选 BOM 与首尾分隔线）；无区块时为空串。 */
  raw: string;
  /** `title` 键的字符串值；缺失或为空时为 null。 */
  title: string | null;
  /** `tags` 键归一化后的标签；键缺失或为空时为 []。 */
  tags: string[];
  /** 是否出现 `tags` 键（用于区分「显式清空」与「没有声明」）。 */
  hasTags: boolean;
}

const EMPTY: ParsedFrontMatter = {
  present: false,
  end: 0,
  lineCount: 0,
  raw: "",
  title: null,
  tags: [],
  hasTags: false,
};

const OPEN_RE = /^---[ \t]*$/;
const CLOSE_RE = /^(?:---|\.\.\.)[ \t]*$/;

interface SourceLine {
  /** 去掉行尾 `\r` 后的行文本。 */
  text: string;
  /** 行尾（不含换行符）在原文中的偏移。 */
  end: number;
  /** 下一行起始偏移；最后一行等于原文长度。 */
  next: number;
}

/** 读取从 `start` 开始的一行，兼容 CRLF。 */
function readLine(source: string, start: number): SourceLine {
  let end = source.indexOf("\n", start);
  if (end < 0) end = source.length;
  const text =
    end > start && source[end - 1] === "\r"
      ? source.slice(start, end - 1)
      : source.slice(start, end);
  return { text, end, next: end < source.length ? end + 1 : end };
}

/**
 * 识别并解析文档开头的 front matter。
 *
 * 返回值中的 `end` / `lineCount` 始终基于**原始 source**（含 BOM 与 CRLF），
 * 可直接用于切片与 markdown-it 的行号跳转。
 */
export function parseFrontMatter(source: string): ParsedFrontMatter {
  if (!source) return EMPTY;

  const start = source.startsWith("﻿") ? 1 : 0;
  const first = readLine(source, start);
  if (!OPEN_RE.test(first.text)) return EMPTY;

  const contentLines: string[] = [];
  let cursor = first.next;
  let lineCount = 1;

  // 逐行找闭合分隔线；找不到就整体退回普通正文
  while (cursor <= source.length) {
    const line = readLine(source, cursor);
    lineCount += 1;

    if (CLOSE_RE.test(line.text)) {
      const end = line.next;
      const known = parseKnownKeys(contentLines);
      return {
        present: true,
        end,
        lineCount,
        raw: source.slice(0, end),
        ...known,
      };
    }

    contentLines.push(line.text);
    if (line.end >= source.length) break; // 最后一行且未闭合
    cursor = line.next;
  }

  return EMPTY;
}

/** 剥离 front matter，返回正文；没有区块时原样返回。 */
export function stripFrontMatter(source: string): string {
  const info = parseFrontMatter(source);
  return info.present ? source.slice(info.end) : source;
}

interface KnownKeys {
  title: string | null;
  tags: string[];
  hasTags: boolean;
}

/** 只提取关心的顶级键；其余行视而不见。 */
function parseKnownKeys(lines: readonly string[]): KnownKeys {
  let title: string | null = null;
  let tags: string[] = [];
  let hasTags = false;

  for (let i = 0; i < lines.length; i++) {
    const match = /^([A-Za-z0-9_.-]+)[ \t]*:[ \t]*(.*)$/.exec(lines[i]);
    if (!match) continue;

    const key = match[1];
    const rest = match[2];

    if (key === "title" && title === null) {
      const block = /^([|>])[+-]?[ \t]*(?:#.*)?$/.exec(rest.trim());
      if (block) {
        const collected = collectBlockScalar(lines, i + 1, block[1] === "|");
        title = collected.value || null;
        i += collected.consumed;
      } else {
        title = parseScalar(rest) || null;
      }
      continue;
    }

    if (key === "tags") {
      hasTags = true;

      if (rest.trim().startsWith("[")) {
        tags = normalizeTags(splitInlineList(rest));
      } else if (rest.trim() === "" || rest.trim().startsWith("#")) {
        const collected = collectBlockList(lines, i + 1);
        tags = normalizeTags(collected.items);
        i += collected.consumed;
      } else {
        // 引号包裹的标量整体算一个标签；未加引号时才把逗号当分隔符
        const trimmed = rest.trim();
        if (/^["']/.test(trimmed)) {
          tags = normalizeTags([trimmed]);
        } else {
          const plain = parseScalar(rest);
          tags = normalizeTags(plain.includes(",") ? plain.split(",") : [plain]);
        }
      }
    }
  }

  return { title, tags, hasTags };
}

/** 行内数组 `[a, "b", c]`：只按逗号切分，引号内的逗号不切。 */
function splitInlineList(raw: string): string[] {
  const open = raw.indexOf("[");
  if (open < 0) return [raw];
  const close = raw.lastIndexOf("]");
  const inner = close > open ? raw.slice(open + 1, close) : raw.slice(open + 1);

  const items: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let escaped = false;

  for (let i = 0; i < inner.length; i++) {
    const char = inner[i];

    if (quote) {
      current += char;
      if (quote === '"') {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') quote = null;
        continue;
      }
      // 单引号内用 '' 表示一个单引号
      if (char === "'" && inner[i + 1] === "'") {
        current += inner[i + 1];
        i += 1;
        continue;
      }
      if (char === "'") quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
    } else if (char === ",") {
      items.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  items.push(current);
  return items;
}

/** 折叠式块标量（`|` / `>`）：收集缩进块并去掉公共缩进。 */
function collectBlockScalar(
  lines: readonly string[],
  start: number,
  literal: boolean,
): { value: string; consumed: number } {
  const collected: string[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() !== "" && !/^[ \t]/.test(line)) break;
    collected.push(line);
    i += 1;
  }

  while (collected.length > 0 && collected[collected.length - 1].trim() === "") {
    collected.pop();
  }

  const indents = collected
    .filter((line) => line.trim() !== "")
    .map((line) => /^[ \t]*/.exec(line)![0].length);
  const indent = indents.length > 0 ? Math.min(...indents) : 0;
  const content = collected.map((line) => line.slice(indent));
  const value = literal ? content.join("\n") : content.join(" ").replace(/[ \t]+/g, " ");
  return { value: value.trim(), consumed: i - start };
}

/** 块列表（缩进或顶格的 `- item`）：收集连续条目。 */
function collectBlockList(
  lines: readonly string[],
  start: number,
): { items: string[]; consumed: number } {
  const items: string[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i += 1;
      continue;
    }
    const match = /^[ \t]*[-*][ \t]+(.*)$/.exec(line);
    if (!match) break;
    items.push(match[1]);
    i += 1;
  }

  return { items, consumed: i - start };
}

/** 归一化标签：去引号/注释、去 `#` 前缀、去空、保序去重。 */
function normalizeTags(items: readonly string[]): string[] {
  const out: string[] = [];
  for (const item of items) {
    const tag = parseScalar(item).replace(/^#/, "").trim();
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

/** 解析一个 YAML 标量（只覆盖 front matter 里常见的单行写法）。 */
function parseScalar(raw: string): string {
  const text = raw.trim();
  if (!text) return "";

  const doubleQuoted = /^"((?:[^"\\]|\\.)*)"[ \t]*(?:#.*)?$/s.exec(text);
  if (doubleQuoted) {
    try {
      return JSON.parse(`"${doubleQuoted[1]}"`) as string;
    } catch {
      return doubleQuoted[1].replace(/\\(.)/g, "$1");
    }
  }

  const singleQuoted = /^'((?:[^']|'')*)'[ \t]*(?:#.*)?$/s.exec(text);
  if (singleQuoted) return singleQuoted[1].replace(/''/g, "'");

  // 未加引号的标量：空白后的 `#` 起为注释
  return text.replace(/[ \t]+#.*$/, "").trim();
}
