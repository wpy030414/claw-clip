import { describe, expect, it } from "vitest";
import { renderMarkdown } from "@/utils/markdownRender";

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

  it("原始 HTML 被转义（防 XSS）", () => {
    const html = renderMarkdown('<img src=x onerror="alert(1)">');
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});
