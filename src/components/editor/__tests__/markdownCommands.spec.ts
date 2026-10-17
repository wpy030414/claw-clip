import { describe, expect, it } from "vitest";
import { buildCommand, type MarkdownCommand } from "@/components/editor/markdownCommands";

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
