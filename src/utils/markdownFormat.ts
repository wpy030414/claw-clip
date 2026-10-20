/**
 * Markdown 格式化（强制校准）：把正文里的「看起来不规整」的语法校准成统一写法。
 *
 * 纯函数、幂等：`formatMarkdown(formatMarkdown(x)) === formatMarkdown(x)`。
 * 只做**语义安全**的规范，不重排表格、不改强调符号、不重编号有序列表，
 * 也绝不改动围栏代码块内部（示例代码必须原样保留）。
 *
 * 规则：
 * 1. 去掉 BOM，`\r\n` / `\r` 统一为 `\n`；
 * 2. 行尾空白：普通行去掉；≥2 个空格（Markdown 硬换行）统一保留为 2 个；
 * 3. ATX 标题：`#标题` / `#   标题` → `# 标题`；
 * 4. 无序列表：`*` / `+` 统一为 `-`，标记后只留一个空格；
 * 5. 任务列表：`[X]` 统一为 `[x]`，`- [ ]` / `- [x]` 后只留一个空格；
 * 6. 有序列表：`1.   文本` / `1)   文本` → `1. 文本`（编号与分隔符原样保留；
 *    `1.文本` 不是合法列表，保持原样以免改变语义）；
 * 7. 引用：`>文本` / `>>文本` → `> 文本` / `> > 文本`；
 * 8. 连续空行压缩为 1 行（围栏代码块内不压缩）；
 * 9. 结尾统一为恰好 1 个换行；空白文档返回空串。
 *
 * **front matter 整段原样跳过**：YAML 块里的 `#` 与 `- ` 不是 Markdown，
 * 一旦进入格式化规则会被改写并破坏元数据。只统一换行（与全文一致），
 * 内容、缩进、键序全部保留；区块与正文之间保证恰好一个空行。
 */
import { parseFrontMatter } from "@/utils/frontMatter";

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const HR_RE = /^\s{0,3}(?:(\*[ \t]*){3,}|(-[ \t]*){3,}|(_[ \t]*){3,})$/;
const HEADING_RE = /^(\s{0,3})(#{1,6})(?!#)([ \t]*)(.*)$/;
const TASK_RE = /^(\s{0,3})[-*+][ \t]+\[([ xX])\][ \t]*(.*)$/;
const UL_RE = /^(\s{0,3})[-*+][ \t]+(.*)$/;
const OL_RE = /^(\s{0,3})(\d+)([.)])[ \t]+(.*)$/;
const QUOTE_RE = /^(\s{0,3})((?:>[ \t]*)+)(.*)$/;

/** 单行规范化（不含空行压缩 / 围栏判断）。 */
function normalizeLine(line: string): string {
  // 硬换行：两个及以上行尾空格统一保留为两个；其余行尾空白去掉
  const hardBreak = / {2,}$/.test(line);
  let next = line.replace(/[ \t]+$/, "");
  if (hardBreak) next += "  ";
  const content = next.replace(/ {2}$/, "");

  // 水平分割线保持原样（避免 `* * *` 被误当成无序列表改写）
  if (HR_RE.test(content)) return next;

  const heading = content.match(HEADING_RE);
  if (heading) {
    const [, indent, hashes, , rest] = heading;
    return `${indent}${hashes}${rest ? ` ${rest}` : ""}${hardBreak ? "  " : ""}`;
  }

  const task = content.match(TASK_RE);
  if (task) {
    const [, indent, state, rest] = task;
    return `${indent}- [${state === " " ? " " : "x"}]${rest ? ` ${rest}` : ""}${
      hardBreak ? "  " : ""
    }`;
  }

  const ul = content.match(UL_RE);
  if (ul) {
    const [, indent, rest] = ul;
    return `${indent}-${rest ? ` ${rest}` : ""}${hardBreak ? "  " : ""}`;
  }

  const ol = content.match(OL_RE);
  if (ol) {
    const [, indent, num, delim, rest] = ol;
    return `${indent}${num}${delim}${rest ? ` ${rest}` : ""}${hardBreak ? "  " : ""}`;
  }

  const quote = content.match(QUOTE_RE);
  if (quote) {
    const [, indent, marks, rest] = quote;
    const depth = (marks.match(/>/g) ?? []).length;
    return `${indent}${Array.from({ length: depth }, () => ">").join(" ")}${
      rest ? ` ${rest}` : ""
    }${hardBreak ? "  " : ""}`;
  }

  return next;
}

/** 强制校准 Markdown 正文格式（幂等）。 */
export function formatMarkdown(source: string): string {
  if (!source.trim()) return "";

  const normalized = source.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const frontMatter = parseFrontMatter(normalized);

  if (!frontMatter.present) return formatBody(normalized);

  // front matter 原文（含分隔线）整段保留，只格式化其后的正文
  const raw = normalized.slice(0, frontMatter.end);
  const body = formatBody(normalized.slice(frontMatter.end));
  // 区块与正文之间统一为一个空行；raw 已自带闭合行的换行
  return body ? `${raw}\n${body}` : raw;
}

/** 格式化纯 Markdown 正文（不含 front matter）。 */
function formatBody(source: string): string {
  if (!source.trim()) return "";

  const out: string[] = [];
  let fence: string | null = null; // 当前所在围栏代码块的标记字符（` 或 ~）

  for (const raw of source.split("\n")) {
    const fenceMatch = raw.match(FENCE_RE);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fence === null) fence = marker;
      else if (fence === marker) fence = null;
      // 围栏行只去行尾空白，内部内容原样保留
      out.push(raw.replace(/[ \t]+$/, ""));
      continue;
    }

    if (fence !== null) {
      out.push(raw); // 代码块内部绝不改动
      continue;
    }

    const line = raw.trim() === "" ? "" : normalizeLine(raw);
    // 连续空行压缩为 1 行（文档开头的空行直接丢弃）
    if (line === "" && (out.length === 0 || out[out.length - 1] === "")) continue;
    out.push(line);
  }

  // 未闭合的围栏代码块里，行尾空行属于代码内容，不能裁掉
  if (fence === null) {
    while (out.length > 0 && out[out.length - 1] === "") out.pop();
  }
  return out.length > 0 ? `${out.join("\n")}\n` : "";
}
