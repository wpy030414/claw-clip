/**
 * Markdown 工具栏命令（纯函数，便于单测）。
 *
 * 输入「文档 + 选区」，输出 CodeMirror 需要的 `changes` 与新的选区。
 * 不依赖 DOM / EditorView——组件层只负责 dispatch。
 */

export type MarkdownCommand =
  | "bold"
  | "italic"
  | "strike"
  | "inlineCode"
  | "h1"
  | "h2"
  | "h3"
  | "quote"
  | "ul"
  | "ol"
  | "task"
  | "codeBlock"
  | "link"
  | "image"
  | "table"
  | "math"
  | "mathBlock"
  | "hr";

export interface Change {
  from: number;
  to: number;
  insert: string;
}

export interface CommandResult {
  changes: Change[];
  selection: { anchor: number; head: number };
}

/** 把一次改动串映射到旧坐标上（用于保持光标/选区位置）。 */
function mapPosition(changes: Change[], pos: number): number {
  let delta = 0;
  for (const c of changes) {
    if (c.to <= pos) {
      delta += c.insert.length - (c.to - c.from);
      continue;
    }
    if (c.from < pos) {
      // 光标落在被替换区间内部：贴到替换文本末尾
      return c.from + delta + c.insert.length;
    }
    break;
  }
  return pos + delta;
}

function result(changes: Change[], from: number, to: number): CommandResult {
  if (changes.length === 0) return { changes, selection: { anchor: from, head: to } };
  return {
    changes,
    selection: {
      anchor: mapPosition(changes, from),
      head: mapPosition(changes, to),
    },
  };
}

/** 行内包裹：选中文本已带标记则取消，否则包裹（空选区插入占位文字并选中它）。 */
function toggleInline(
  doc: string,
  from: number,
  to: number,
  marker: string,
  placeholder: string,
): CommandResult {
  const len = marker.length;
  const wrappedOutside =
    from >= len &&
    to + len <= doc.length &&
    doc.slice(from - len, from) === marker &&
    doc.slice(to, to + len) === marker;

  if (wrappedOutside) {
    return {
      changes: [{ from: from - len, to: to + len, insert: doc.slice(from, to) }],
      selection: { anchor: from - len, head: from - len + (to - from) },
    };
  }

  const selected = doc.slice(from, to);
  const text = selected || placeholder;
  const insert = `${marker}${text}${marker}`;
  return {
    changes: [{ from, to, insert }],
    selection: selected
      ? { anchor: from + insert.length, head: from + insert.length }
      : { anchor: from + len, head: from + len + text.length },
  };
}

/** 选区覆盖的整行范围：从首行行首到末行行尾（不含换行符）。 */
function lineSpan(doc: string, from: number, to: number): { start: number; end: number } {
  const start = doc.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  let endProbe = to;
  if (to > from && doc[to - 1] === "\n") endProbe = to - 1;
  const nl = doc.indexOf("\n", endProbe);
  const end = nl === -1 ? doc.length : nl;
  return { start, end: Math.max(start, end) };
}

/** 对选区覆盖的每一行单独替换「行首前缀」，正文与光标位置保持不变。 */
function replaceLinePrefixes(
  doc: string,
  from: number,
  to: number,
  build: (line: string, index: number, lines: string[]) => { prefixLen: number; prefix: string },
): CommandResult {
  const { start, end } = lineSpan(doc, from, to);
  const body = doc.slice(start, end);
  const lines = body.split("\n");
  const changes: Change[] = [];

  let offset = start;
  lines.forEach((line, i) => {
    const { prefixLen, prefix } = build(line, i, lines);
    if (prefixLen > 0 || prefix.length > 0) {
      changes.push({ from: offset, to: offset + prefixLen, insert: prefix });
    }
    offset += line.length + 1;
  });

  return result(changes, from, to);
}

const HEADING_RE = /^(#{1,6})\s+/;
const QUOTE_RE = /^>\s?/;
const TASK_RE = /^[-*+]\s+\[[ xX]\]\s+/;
const UL_RE = /^[-*+]\s+(?!\[[ xX]\])/;
const OL_RE = /^\d+\.\s+/;

/** 可直接触发选区包裹的半角标记键。 */
export const MARKER_KEYS: ReadonlySet<string> = new Set(["*", "_", "~", "`", "$", "^", "="]);

/**
 * 中文输入法在中文标点模式下会把标记敲成全角（`＊` `＿` `～` `` ｀ `` `＄`），
 * 有些 IME 还会让 keydown 变成 `Process` / 组合态，拦截不到。
 * 统一按「实际落进文档的字符」归一成 Markdown 需要的半角标记。
 */
const FULLWIDTH_MARKERS: Record<string, string> = {
  "＊": "*", // U+FF0A
  "＿": "_", // U+FF3F
  "～": "~", // U+FF5E
  "〜": "~", // U+301C（日文波浪线，部分输入法使用）
  "｀": "`", // U+FF40
  "＄": "$", // U+FF04
  "＾": "^", // U+FF3E
  "＝": "=", // U+FF1D
};

/** 把实际插入的字符归一为可包裹的标记；不是标记返回 null。 */
export function markerFromInput(text: string): string | null {
  if (MARKER_KEYS.has(text)) return text;
  return FULLWIDTH_MARKERS[text] ?? null;
}

/**
 * 直接用键盘敲标记（`*` `_` `~` `` ` `` `$` `^` `=`）时的选区包裹。
 *
 * 与工具栏的 `toggleInline` 不同：这里**不做取消/占位**，也**保持内文仍被选中**。
 * 保持选区是关键——敲一次 `*` 得到 `*文字*` 且「文字」仍选中，紧接着再敲一个 `*`
 * 就自然升级成 `**文字**`，`~`→`~~`（删除线）、`=`→`==`（高亮）、`` ` ``→`` `` `` 同理。
 *
 * 选区两端的空白（含换行）留在标记外：`* 文字 *`、`*文字` + 换行 + `*` 在 Markdown 里
 * 都不是合法的强调（标记必须紧贴文字），预览会把星号原样显示出来——这正是
 * 「识别到却没渲染」的常见原因（三击选整行/双击选词常把行尾空白或换行一起选进来）。
 * 空选区（或整段都是空白）返回空改动，调用方据此放弃拦截、交还给默认输入。
 */
export function wrapSelection(
  doc: string,
  from: number,
  to: number,
  marker: string,
): CommandResult {
  if (from >= to) return { changes: [], selection: { anchor: from, head: to } };
  let start = from;
  let end = to;
  while (start < end && /\s/.test(doc[start])) start += 1;
  while (end > start && /\s/.test(doc[end - 1])) end -= 1;
  if (start === end) return { changes: [], selection: { anchor: from, head: to } };
  return {
    changes: [
      { from: start, to: start, insert: marker },
      { from: end, to: end, insert: marker },
    ],
    selection: { anchor: start + marker.length, head: end + marker.length },
  };
}

/** 生成工具栏命令对应的编辑操作。 */
export function buildCommand(
  doc: string,
  from: number,
  to: number,
  command: MarkdownCommand,
): CommandResult {
  switch (command) {
    case "bold":
      return toggleInline(doc, from, to, "**", "加粗文字");
    case "italic":
      return toggleInline(doc, from, to, "*", "斜体文字");
    case "strike":
      return toggleInline(doc, from, to, "~~", "删除线文字");
    case "inlineCode":
      return toggleInline(doc, from, to, "`", "行内代码");
    case "math":
      return toggleInline(doc, from, to, "$", "E = mc^2");
    case "link":
      return insertInlineLink(doc, from, to);
    case "image":
      return insertBlock(doc, from, to, "![图片描述](https://)");
    case "table":
      return insertBlock(doc, from, to, "| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |");
    case "hr":
      return insertBlock(doc, from, to, "---");
    case "codeBlock": {
      const selected = doc.slice(from, to);
      const inner = selected || "代码";
      const block = "```\n" + inner + "\n```";
      const pos = insertBlock(doc, from, to, block);
      return pos;
    }
    case "mathBlock": {
      const selected = doc.slice(from, to);
      const block = selected ? `$$\n${selected}\n$$` : "$$\n\n$$";
      return insertBlock(doc, from, to, block);
    }
    case "h1":
    case "h2":
    case "h3": {
      const level = Number(command[1]);
      return replaceLinePrefixes(doc, from, to, (line) => {
        const m = line.match(HEADING_RE);
        const current = m ? m[1].length : 0;
        const prefix = current === level ? "" : `${"#".repeat(level)} `;
        return { prefixLen: m ? m[0].length : 0, prefix };
      });
    }
    case "quote":
      return replaceLinePrefixes(doc, from, to, (line) => {
        const m = line.match(QUOTE_RE);
        return { prefixLen: m ? m[0].length : 0, prefix: m ? "" : "> " };
      });
    case "ul":
      return replaceLinePrefixes(doc, from, to, (line) => {
        const m = line.match(UL_RE);
        return { prefixLen: m ? m[0].length : 0, prefix: m ? "" : "- " };
      });
    case "task":
      return replaceLinePrefixes(doc, from, to, (line) => {
        const m = line.match(TASK_RE);
        if (m) return { prefixLen: m[0].length, prefix: "" };
        const ul = line.match(UL_RE);
        return { prefixLen: ul ? ul[0].length : 0, prefix: "- [ ] " };
      });
    case "ol": {
      const { start, end } = lineSpan(doc, from, to);
      const lines = doc.slice(start, end).split("\n");
      const allOrdered = lines.every((l) => OL_RE.test(l));
      return replaceLinePrefixes(doc, from, to, (line, i) => {
        const m = line.match(OL_RE);
        if (allOrdered) return { prefixLen: m ? m[0].length : 0, prefix: "" };
        return { prefixLen: m ? m[0].length : 0, prefix: `${i + 1}. ` };
      });
    }
    default:
      return { changes: [], selection: { anchor: from, head: to } };
  }
}

function insertInlineLink(doc: string, from: number, to: number): CommandResult {
  const selected = doc.slice(from, to);
  const text = selected || "链接文字";
  const insert = `[${text}](https://)`;
  return {
    changes: [{ from, to, insert }],
    selection: selected
      ? { anchor: from + insert.length, head: from + insert.length }
      : { anchor: from + 1, head: from + 1 + text.length },
  };
}

/** 在光标处插入块级内容，自动补齐前后换行，光标落到块尾。 */
function insertBlock(doc: string, from: number, to: number, block: string): CommandResult {
  const before = from > 0 && doc[from - 1] !== "\n" ? "\n\n" : "";
  const after = to < doc.length && doc[to] !== "\n" ? "\n" : "";
  const insert = before + block + after;
  const anchor = from + before.length + block.length;
  return { changes: [{ from, to, insert }], selection: { anchor, head: anchor } };
}
