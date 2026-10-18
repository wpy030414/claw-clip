import { describe, expect, it } from "vite-plus/test";
import { extractOutline, renderMarkdown } from "@/utils/markdownRender";

describe("renderMarkdown 扩展语法", () => {
  it("GFM 表格", () => {
    const html = renderMarkdown("| A | B |\n|---|---|\n| 1 | 2 |");
    expect(html).toContain("<table>");
    expect(html).toContain("<th>A</th>");
    expect(html).toContain("<td>1</td>");
  });

  it("任务列表渲染为 checkbox", () => {
    const html = renderMarkdown("- [x] 完成\n- [ ] 待办");
    expect(html).toContain('type="checkbox"');
    expect(html).toContain("checked");
  });

  it("脚注", () => {
    const html = renderMarkdown("正文[^1]\n\n[^1]: 脚注内容");
    expect(html).toContain('class="footnotes"');
    expect(html).toContain("脚注内容");
  });

  it("删除线 / 高亮 / 上下标", () => {
    const html = renderMarkdown("~~删~~ ==亮== H~2~O x^2^");
    expect(html).toContain("<s>删</s>");
    expect(html).toContain("<mark>亮</mark>");
    expect(html).toContain("<sub>2</sub>");
    expect(html).toContain("<sup>2</sup>");
  });

  it("KaTeX 行内公式", () => {
    const html = renderMarkdown("$E=mc^2$");
    expect(html).toContain("katex");
  });

  it("代码块语法高亮", () => {
    const html = renderMarkdown("```js\nconst a = 1;\n```");
    expect(html).toContain('class="hljs"');
    expect(html).toContain("hljs-keyword");
  });

  it("mermaid 代码块保留语言类（预览据此渲染图表）", () => {
    const html = renderMarkdown("```mermaid\ngraph TD\n  A --> B\n```");
    expect(html).toContain('class="language-mermaid"');
    expect(html).toContain("graph TD");
  });

  it("手写 HTML 原样保留（不做 XSS 过滤）", () => {
    const html = renderMarkdown(
      '<div class="raw">手写内容</div>\n\n<img src="x" onerror="alert(1)">',
    );
    expect(html).toContain('<div class="raw">手写内容</div>');
    expect(html).toContain('onerror="alert(1)"');
  });
});

describe("extractOutline", () => {
  it("只提取真正的标题：跳过围栏/缩进代码块里的 #", () => {
    const src = [
      "# 一级",
      "",
      "```md",
      "# 代码里的假标题",
      "```",
      "",
      "    # 缩进代码里的假标题",
      "",
      "## 二级",
      "",
      "~~~",
      "# 另一个假标题",
      "~~~",
    ].join("\n");

    const items = extractOutline(src);
    expect(items.map((i) => i.text)).toEqual(["一级", "二级"]);
    expect(items.map((i) => i.level)).toEqual([1, 2]);
  });

  it("支持 Setext 标题，并把行内格式转为纯文本", () => {
    const src = "标题 **加粗**\n===\n\n## 带 `代码` 与 [链接](url)\n";
    const items = extractOutline(src);
    expect(items[0]).toMatchObject({ level: 1, text: "标题 加粗" });
    expect(items[1]).toMatchObject({ level: 2, text: "带 代码 与 链接" });
  });

  it("pos 指向标题所在行的源码偏移", () => {
    const src = "前言\n\n# 标题\n正文";
    const [item] = extractOutline(src);
    expect(src.slice(item.pos, item.pos + 1)).toBe("#");
  });

  it("块引用/列表中的标题也算（预览会渲染为 heading）", () => {
    const src = "> # 引用标题\n\n- ## 列表标题\n";
    expect(extractOutline(src).map((i) => i.text)).toEqual(["引用标题", "列表标题"]);
  });
});

describe("GitHub 警报框", () => {
  it("NOTE：渲染为警报容器 + 标题，标记不残留", () => {
    const html = renderMarkdown("> [!NOTE]\n> 这是注意事项。");
    expect(html).toContain('<div class="md-alert md-alert-note">');
    expect(html).toContain('<p class="md-alert-title">Note</p>');
    expect(html).toContain("<p>这是注意事项。</p>");
    expect(html).not.toContain("[!NOTE]");
  });

  it("五种类型都识别，并带各自的类型类名", () => {
    const cases: Array<[string, string]> = [
      ["NOTE", "note"],
      ["TIP", "tip"],
      ["IMPORTANT", "important"],
      ["WARNING", "warning"],
      ["CAUTION", "caution"],
    ];
    for (const [marker, type] of cases) {
      const html = renderMarkdown(`> [!${marker}]\n> 内容`);
      expect(html).toContain(`md-alert md-alert-${type}`);
      expect(html).toContain(`md-alert-title`);
      expect(html).not.toContain(`[!${marker}]`);
    }
  });

  it("同一行可以写正文；标记后没有正文时只渲染标题", () => {
    expect(renderMarkdown("> [!TIP] 同一行内容")).toContain("<p>同一行内容</p>");
    const bare = renderMarkdown("> [!NOTE]");
    expect(bare).toContain('<p class="md-alert-title">Note</p>');
    expect(bare).not.toContain("<p></p>");
  });

  it("多段正文保持在同一个警报框内", () => {
    const html = renderMarkdown("> [!WARNING]\n>\n> 第一段\n>\n> 第二段");
    expect(html.match(/md-alert md-alert-warning/g)).toHaveLength(1);
    expect(html).toContain("<p>第一段</p>");
    expect(html).toContain("<p>第二段</p>");
  });

  it("普通引用、以及不在首段开头的标记不受影响", () => {
    expect(renderMarkdown("> 普通引用")).toContain("<blockquote>");
    const later = renderMarkdown("> 前言\n>\n> [!NOTE]\n> 内容");
    expect(later).not.toContain("md-alert");
    expect(later).toContain("<blockquote>");
  });

  it("标记大小写不敏感", () => {
    expect(renderMarkdown("> [!note] 小写")).toContain("md-alert md-alert-note");
  });
});
