import { describe, expect, it } from "vite-plus/test";
import {
  buildCommand,
  markerFromInput,
  wrapSelection,
  type Change,
  type CommandResult,
  type MarkdownCommand,
} from "@/components/editor/markdownCommands";

/** 把命令结果应用到文本上（便于断言）。 */
function run(
  doc: string,
  from: number,
  to: number,
  command: MarkdownCommand,
): { text: string; selection: { anchor: number; head: number } } {
  const result = buildCommand(doc, from, to, command);
  let text = doc;
  for (const change of [...result.changes].sort((a, b) => b.from - a.from)) {
    text = text.slice(0, change.from) + change.insert + text.slice(change.to);
  }
  return { text, selection: result.selection };
}

describe("行内命令", () => {
  it("加粗包裹选中文本", () => {
    const r = run("hello world", 0, 5, "bold");
    expect(r.text).toBe("**hello** world");
    expect(r.selection).toEqual({ anchor: 9, head: 9 });
  });

  it("再次加粗取消标记", () => {
    const r = run("**hello** world", 2, 7, "bold");
    expect(r.text).toBe("hello world");
  });

  it("空选区插入占位文字并选中", () => {
    const r = run("", 0, 0, "bold");
    expect(r.text).toBe("**加粗文字**");
    expect(r.selection).toEqual({ anchor: 2, head: 6 });
  });

  it("斜体 / 删除线 / 行内代码 / 行内公式", () => {
    expect(run("abc", 0, 3, "italic").text).toBe("*abc*");
    expect(run("abc", 0, 3, "strike").text).toBe("~~abc~~");
    expect(run("abc", 0, 3, "inlineCode").text).toBe("`abc`");
    expect(run("x", 0, 1, "math").text).toBe("$x$");
  });

  it("链接保留选中文字", () => {
    const r = run("文档", 0, 2, "link");
    expect(r.text).toBe("[文档](https://)");
  });
});

describe("行前缀命令", () => {
  it("标题切换级别", () => {
    expect(run("# 标题", 0, 0, "h2").text).toBe("## 标题");
    expect(run("## 标题", 0, 0, "h2").text).toBe("标题");
    expect(run("正文", 0, 0, "h1").text).toBe("# 正文");
  });

  it("多行统一加标题前缀", () => {
    const r = run("第一行\n第二行", 0, 7, "h3");
    expect(r.text).toBe("### 第一行\n### 第二行");
  });

  it("引用切换", () => {
    expect(run("引用", 0, 0, "quote").text).toBe("> 引用");
    expect(run("> 引用", 0, 0, "quote").text).toBe("引用");
  });

  it("无序列表切换", () => {
    expect(run("a\nb", 0, 3, "ul").text).toBe("- a\n- b");
    expect(run("- a\n- b", 0, 7, "ul").text).toBe("a\nb");
  });

  it("有序列表自动编号", () => {
    expect(run("a\nb\nc", 0, 5, "ol").text).toBe("1. a\n2. b\n3. c");
    expect(run("1. a\n2. b", 0, 8, "ol").text).toBe("a\nb");
  });

  it("任务清单切换", () => {
    expect(run("待办", 0, 0, "task").text).toBe("- [ ] 待办");
    expect(run("- [ ] 待办", 0, 8, "task").text).toBe("待办");
  });

  it("行前缀修改不改变正文与光标相对位置", () => {
    const r = run("正文内容", 2, 2, "ul");
    expect(r.text).toBe("- 正文内容");
    expect(r.selection).toEqual({ anchor: 4, head: 4 });
  });
});

describe("块级命令", () => {
  it("代码块包裹选中内容", () => {
    const r = run("const a = 1", 0, 11, "codeBlock");
    expect(r.text).toBe("```\nconst a = 1\n```");
  });

  it("表格插入", () => {
    const r = run("", 0, 0, "table");
    expect(r.text).toContain("| 列 1 | 列 2 |");
    expect(r.text).toContain("| --- | --- |");
  });

  it("块级公式", () => {
    expect(run("", 0, 0, "mathBlock").text).toBe("$$\n\n$$");
    expect(run("x^2", 0, 3, "mathBlock").text).toBe("$$\nx^2\n$$");
  });

  it("分隔线自动补空行", () => {
    expect(run("正文", 2, 2, "hr").text).toBe("正文\n\n---");
  });
});

/** 把任意命令结果落到文本上（含多个插入点的情况）。 */
function apply(doc: string, result: CommandResult): string {
  let text = doc;
  for (const change of [...result.changes].sort((a, b) => b.from - a.from) as Change[]) {
    text = text.slice(0, change.from) + change.insert + text.slice(change.to);
  }
  return text;
}

describe("输入法插入的标记归一", () => {
  it("半角标记原样返回", () => {
    for (const key of ["*", "_", "~", "`", "$", "^", "="]) {
      expect(markerFromInput(key)).toBe(key);
    }
  });

  it("中文标点模式的全角字符归一为半角（Markdown 只认半角）", () => {
    expect(markerFromInput("＊")).toBe("*");
    expect(markerFromInput("＿")).toBe("_");
    expect(markerFromInput("～")).toBe("~");
    expect(markerFromInput("〜")).toBe("~");
    expect(markerFromInput("｀")).toBe("`");
    expect(markerFromInput("＄")).toBe("$");
    expect(markerFromInput("＾")).toBe("^");
    expect(markerFromInput("＝")).toBe("=");
  });

  it("普通字符与多字符输入不算标记", () => {
    expect(markerFromInput("中")).toBeNull();
    expect(markerFromInput("a")).toBeNull();
    expect(markerFromInput("**")).toBeNull();
    expect(markerFromInput("")).toBeNull();
  });
});

describe("直接敲标记包裹选区", () => {
  it("选中文字敲 * → 斜体包裹，且内文仍选中", () => {
    const r = wrapSelection("abc", 0, 3, "*");
    expect(apply("abc", r)).toBe("*abc*");
    // 内文仍选中：连敲第二个 * 才会包裹第二次
    expect(r.selection).toEqual({ anchor: 1, head: 4 });
  });

  it("连敲两次 * → 升级为加粗", () => {
    const first = wrapSelection("abc", 0, 3, "*");
    const text = apply("abc", first);
    const second = wrapSelection(text, first.selection.anchor, first.selection.head, "*");
    expect(apply(text, second)).toBe("**abc**");
    expect(second.selection).toEqual({ anchor: 2, head: 5 });
  });

  it("$ / ~ / ` / _ / ^ / = 同样包裹（$$ ~~ == 由连敲得到）", () => {
    expect(apply("E=mc^2", wrapSelection("E=mc^2", 0, 6, "$"))).toBe("$E=mc^2$");
    expect(apply("abc", wrapSelection("abc", 0, 3, "~"))).toBe("~abc~");
    expect(apply("abc", wrapSelection("abc", 0, 3, "`"))).toBe("`abc`");
    expect(apply("abc", wrapSelection("abc", 0, 3, "_"))).toBe("_abc_");
    expect(apply("x2", wrapSelection("x2", 1, 2, "^"))).toBe("x^2^");
    const firstEq = wrapSelection("abc", 0, 3, "=");
    const withEq = apply("abc", firstEq);
    const secondEq = wrapSelection(withEq, firstEq.selection.anchor, firstEq.selection.head, "=");
    expect(apply(withEq, secondEq)).toBe("==abc==");
  });

  it("选区两端的空白/换行留在标记外（否则预览不渲染）", () => {
    const r = wrapSelection("abc \n", 0, 5, "*");
    expect(apply("abc \n", r)).toBe("*abc* \n");
    expect(r.selection).toEqual({ anchor: 1, head: 4 });

    const line = wrapSelection("斜体文字\n第二行", 0, 5, "*");
    expect(apply("斜体文字\n第二行", line)).toBe("*斜体文字*\n第二行");
  });

  it("空选区或纯空白选区不产生改动：交还给默认输入", () => {
    const empty = wrapSelection("abc", 2, 2, "*");
    expect(empty.changes).toEqual([]);
    expect(empty.selection).toEqual({ anchor: 2, head: 2 });

    const spaces = wrapSelection("a   b", 1, 4, "*");
    expect(spaces.changes).toEqual([]);
  });
});
